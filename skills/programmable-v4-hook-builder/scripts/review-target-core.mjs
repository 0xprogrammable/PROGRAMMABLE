import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { canonicalJson, STANDARD_VERSION, submissionHash } from "./submission-core.mjs";
import {
  buildExternalPackageBinding,
  EXTERNAL_PACKAGE_SOURCE_CLASS,
  isExactDeclaredPackageSpecifier,
  isExactPackageDependency,
  isExactPackageFilePath,
  isCanonicalNpmPackageName,
  packageRootPath
} from "./package-dependency-contract.mjs";
import {
  declaredSoliditySourceAndTestPaths,
  isCanonicalReviewTargetPath,
  isClosedReviewTargetClosure,
  isGitLfsPointer,
  isSourceOrTestReviewKind,
  REVIEW_TARGET_CLOSURE_DIAGNOSTIC_CODES,
  REVIEW_TARGET_CLOSURE_METHOD_V1,
  REVIEW_TARGET_CONTRACT_V1
} from "./review-target-contract.mjs";
import { UnsupportedClosureError } from "./review-target-errors.mjs";
import {
  assertNoUnboundBrowserRuntimeLoaders,
  extractJavaScriptDependencies,
  isLocalJavaScriptSpecifier,
  javascriptResolutionExtensions,
  javascriptSourceExtension
} from "./review-target-javascript-core.mjs";
import {
  decodeReviewText,
  hasFoundryRemappingsSetting,
  inside,
  inspectRepositoryEntry,
  lstatOrNull,
  parseRemappings,
  readValidatedFile,
  stripSolidityComments,
  validateDependencyLock
} from "./review-target-repository-core.mjs";
import { parseBoundedStrictJsonBytes } from "./strict-json-core.mjs";
import { buildRuntimeAssetReview } from "./runtime-assets-core.mjs";

export {
  analyzeJavaScriptModuleDependencies,
  assertNoUnboundBrowserRuntimeLoaders
} from "./review-target-javascript-core.mjs";
export {
  parseRemappings,
  stripSolidityComments,
  validateDependencyLock
} from "./review-target-repository-core.mjs";

const packageFiles = ["submission.json", "compatibility-report.json", "PROPOSAL.md", "THREAT_MODEL.md", "TEST_PLAN.md", "EVIDENCE.md"];
// Solidity accepts bare, named, wildcard, aliased and compact imports. Parse
// the complete statement after comments are stripped so none of those forms
// can hide a local source file from the review closure.
const solidityImport = /\bimport\b[^;]*?["']([^"']+)["'](?:\s+as\s+[A-Za-z_$][\w$]*)?\s*;/g;
const declarativeReviewExtension = /\.(?:json|md|txt|ya?ml)$/i;

export function buildReviewTarget({
  repositoryRoot,
  packageRoot,
  submission,
  includePackageArtifacts = true,
  tolerateUnsupportedClosure = submission?.stage === "proposal"
}) {
  const repositoryInput = path.resolve(repositoryRoot);
  const repositoryInputStat = lstatOrNull(repositoryInput);
  if (!repositoryInputStat?.isDirectory() || repositoryInputStat.isSymbolicLink()) {
    throw new Error("repository root must be a real directory, not a symbolic link");
  }
  const repository = fs.realpathSync(repositoryInput);
  const packageInput = path.resolve(packageRoot);
  if (!inside(repositoryInput, packageInput)) throw new Error("submission package resolves outside the repository");
  const packageDirectory = path.resolve(repository, path.relative(repositoryInput, packageInput));
  const packageEntry = inspectRepositoryEntry(repository, packageDirectory);
  if (!packageEntry.stat.isDirectory()) throw new Error("submission package is not a directory");

  const files = new Map();
  const fileContents = new Map();
  const externalImports = new Set();
  const importResolutions = new Map();
  const javascriptImportResolutions = new Map();
  const closureDiagnostics = new Map();
  const queue = [];
  const queuedSources = new Set();
  const declaredPackageDependencies = new Map();
  for (const dependency of submission.integration?.sdkDependencies ?? []) {
    if (!isExactPackageDependency(dependency)) {
      throw new Error(`package dependency is not exactly bound: ${String(dependency?.packageName)}`);
    }
    if (declaredPackageDependencies.has(dependency.packageName)) {
      throw new Error(`package dependency is declared more than once: ${dependency.packageName}`);
    }
    declaredPackageDependencies.set(dependency.packageName, dependency);
  }
  let totalBytes = 0;
  const implementation = submission.implementation ?? {};
  let runtimeAssets = null;
  const runtimeAssetPaths = new Set();
  const hasDeclaredSoliditySource = declaredSoliditySourceAndTestPaths(submission).length > 0;
  let remappings = [];
  if (hasDeclaredSoliditySource) {
    const foundryConfigPath = path.join(repository, "foundry.toml");
    const remappingsPath = path.join(repository, "remappings.txt");
    const foundryConfigEntry = inspectRepositoryEntry(repository, foundryConfigPath, { allowMissing: true });
    const remappingsEntry = inspectRepositoryEntry(repository, remappingsPath, { allowMissing: true });
    if (foundryConfigEntry === null || remappingsEntry === null) {
      if (!tolerateUnsupportedClosure) {
        if (foundryConfigEntry === null) addPath(foundryConfigPath, "compiler-config");
        addPath(remappingsPath, "compiler-remappings");
      } else {
        if (foundryConfigEntry !== null) addPath(foundryConfigPath, "compiler-config");
        if (remappingsEntry !== null) addPath(remappingsPath, "compiler-remappings");
      }
      addClosureDiagnostic(
        "SOLIDITY_BUILD_PROFILE_REVIEW_REQUIRED",
        "foundry.toml",
        "Declared Solidity is byte-bound, but the repository does not expose the root Foundry configuration and remappings required by the deterministic beta scanner."
      );
    } else {
      const foundryConfig = decodeReviewText(addPath(foundryConfigPath, "compiler-config"), "foundry.toml");
      const remappingsSource = decodeReviewText(addPath(remappingsPath, "compiler-remappings"), "remappings.txt");
      if (hasFoundryRemappingsSetting(foundryConfig)) {
        if (!tolerateUnsupportedClosure) {
          throw new Error("foundry.toml may not declare remappings; keep the canonical mapping set in remappings.txt");
        }
        addClosureDiagnostic(
          "SOLIDITY_BUILD_PROFILE_REVIEW_REQUIRED",
          "foundry.toml",
          "Declared Solidity uses a build profile outside the root Foundry and separate remappings contract supported by the deterministic beta scanner."
        );
      } else {
        remappings = parseRemappings(remappingsSource);
      }
    }
  }

  if (includePackageArtifacts) {
    for (const name of packageFiles) addPath(path.join(packageDirectory, name), `package:${name}`);
    const bootstrapPath = path.join(repository, "scripts", "bootstrap-deps.sh");
    if (inspectRepositoryEntry(repository, bootstrapPath, { allowMissing: true })) addPath(bootstrapPath, "dependency-bootstrap");
  }

  if (implementation.runtimeAssetManifestPath) {
    if (!isCanonicalReviewTargetPath(implementation.runtimeAssetManifestPath)) {
      throw new Error(`unsafe runtime asset manifest path: ${implementation.runtimeAssetManifestPath}`);
    }
    const manifestBytes = addPath(
      path.resolve(repository, implementation.runtimeAssetManifestPath),
      "runtime-asset-manifest"
    );
    const review = buildRuntimeAssetReview({
      repositoryRoot: repository,
      manifestPath: implementation.runtimeAssetManifestPath,
      manifestBytes
    });
    for (const evidencePath of review.evidencePaths) {
      addRepositoryPath(evidencePath, "runtime-asset-evidence");
    }
    for (const asset of review.assets) {
      if (asset.repositoryPath !== null) runtimeAssetPaths.add(asset.repositoryPath);
    }
    const { evidencePaths: ignoredEvidencePaths, ...closedReview } = review;
    runtimeAssets = closedReview;
  }

  for (const sourcePath of implementation.sourcePaths ?? []) addRepositoryPath(sourcePath, "source-entry");
  for (const testPath of implementation.testPaths ?? []) addRepositoryPath(testPath, "test-entry");
  if (submission.stage === "prototype") {
    for (const sourcePath of submission.launchPlan?.callDataSourcePaths ?? []) addRepositoryPath(sourcePath, "launch-calldata-source");
    for (const sourcePath of submission.launchPlan?.hookConfigurationSourcePaths ?? []) addRepositoryPath(sourcePath, "launch-hook-configuration-source");
    for (const sourcePath of submission.launchPlan?.liquiditySourcePaths ?? []) addRepositoryPath(sourcePath, "launch-liquidity-source");
    for (const testPath of submission.launchPlan?.testPaths ?? []) addRepositoryPath(testPath, "launch-executor-test");
  }
  for (const sourcePath of submission.integration?.appSourcePaths ?? []) addRepositoryPath(sourcePath, "app-integration-source");
  for (const testPath of submission.integration?.integrationTestPaths ?? []) addRepositoryPath(testPath, "app-integration-test");
  for (const sourcePath of submission.integration?.routingAndDiscoverability?.sourcePaths ?? []) addRepositoryPath(sourcePath, "routing-integration-source");
  for (const testPath of submission.integration?.routingAndDiscoverability?.testPaths ?? []) addRepositoryPath(testPath, "routing-integration-test");
  for (const sourcePath of submission.integration?.dataReconstruction?.sourcePaths ?? []) addRepositoryPath(sourcePath, "data-reconstruction-source");
  for (const testPath of submission.integration?.dataReconstruction?.testPaths ?? []) addRepositoryPath(testPath, "data-reconstruction-test");
  const platformHandoff = submission.integration?.platformHandoff ?? {};
  if (platformHandoff.websiteRegistryPath) addRepositoryPath(platformHandoff.websiteRegistryPath, "platform-handoff-registry");
  for (const sourcePath of platformHandoff.uiSourcePaths ?? []) addRepositoryPath(sourcePath, "platform-handoff-ui-source");
  for (const sourcePath of platformHandoff.apiSourcePaths ?? []) addRepositoryPath(sourcePath, "platform-handoff-api-source");
  for (const sourcePath of platformHandoff.indexerSourcePaths ?? []) addRepositoryPath(sourcePath, "platform-handoff-indexer-source");
  for (const testPath of platformHandoff.testPaths ?? []) addRepositoryPath(testPath, "platform-handoff-test");
  for (const surface of submission.projectSurfaces ?? []) {
    const surfaceId = surface?.id ?? "unidentified";
    for (const sourcePath of surface?.sourcePaths ?? []) addRepositoryPath(sourcePath, `project-surface-source:${surfaceId}`);
    for (const testPath of surface?.testPaths ?? []) addRepositoryPath(testPath, `project-surface-test:${surfaceId}`);
    for (const schemaPath of surface?.schemaPaths ?? []) addRepositoryPath(schemaPath, `project-surface-schema:${surfaceId}`);
    for (const evidencePath of surface?.evidencePaths ?? []) addRepositoryPath(evidencePath, `project-surface-evidence:${surfaceId}`);
  }
  for (const extension of submission.capabilityExtensions ?? []) {
    if (extension?.schemaPath) addRepositoryPath(extension.schemaPath, `capability-schema:${extension.capabilityId ?? "unidentified"}`);
    for (const sourcePath of extension?.sourcePaths ?? []) addRepositoryPath(sourcePath, `capability-source:${extension.capabilityId ?? "unidentified"}`);
    for (const testPath of extension?.testPaths ?? []) addRepositoryPath(testPath, `capability-test:${extension.capabilityId ?? "unidentified"}`);
    for (const evidencePath of extension?.evidencePaths ?? []) addRepositoryPath(evidencePath, `capability-evidence:${extension.capabilityId ?? "unidentified"}`);
  }
  for (const extension of submission.tokenBehaviorExtensions ?? []) {
    const extensionId = extension?.id ?? "unidentified";
    for (const sourcePath of extension?.sourcePaths ?? []) addRepositoryPath(sourcePath, `token-behavior-source:${extensionId}`);
    for (const testPath of extension?.testPaths ?? []) addRepositoryPath(testPath, `token-behavior-test:${extensionId}`);
    for (const evidencePath of extension?.evidencePaths ?? []) addRepositoryPath(evidencePath, `token-behavior-evidence:${extensionId}`);
  }
  if (includePackageArtifacts) for (const dependency of submission.dependencies?.onchain ?? []) {
    if (dependency?.deploymentEvidencePath) addRepositoryPath(dependency.deploymentEvidencePath, `deployment-evidence:${dependency.name ?? "unidentified"}`);
  }
  if (includePackageArtifacts) for (const [field, kind] of [
    ["specificationPath", "specification"],
    ["testEvidencePath", "test-evidence"],
    ["dependencyLockPath", "dependency-lock"],
    ["feeConformanceManifestPath", "fee-conformance-manifest"]
  ]) {
    if (implementation[field]) addRepositoryPath(implementation[field], kind);
  }

  if (includePackageArtifacts && implementation.gateStatusPath) {
    if (!isCanonicalReviewTargetPath(implementation.gateStatusPath)) throw new Error(`unsafe gate status path: ${implementation.gateStatusPath}`);
    const gateStatusPath = path.resolve(repository, implementation.gateStatusPath);
    if (!inside(repository, gateStatusPath)) throw new Error(`gate status path escapes the repository: ${implementation.gateStatusPath}`);
    const gateStatusEntry = inspectRepositoryEntry(repository, gateStatusPath);
    if (!gateStatusEntry.stat.isFile()) throw new Error(`gate status entry is not a file: ${implementation.gateStatusPath}`);
    const gateStatus = parseBoundedStrictJsonBytes(
      readValidatedFile(gateStatusEntry.path, gateStatusEntry.stat, implementation.gateStatusPath)
    );
    for (const gate of gateStatus.gates ?? []) {
      for (const evidence of gate.evidence ?? []) addRepositoryPath(evidence.path, `gate-evidence:${gate.id ?? "unidentified"}`);
    }
  }

  while (queue.length > 0) {
    const { path: file, kind: importerKind, dependencyContext: importerDependencyContext } = queue.shift();
    if (file.endsWith(".sol")) {
      const source = stripSolidityComments(decodeReviewText(fileContents.get(relative(file)), relative(file)));
      for (const match of source.matchAll(solidityImport)) {
        const specifier = match[1];
        let resolution;
        try {
          resolution = resolveSolidityImport(file, specifier, importerKind, importerDependencyContext);
        } catch (error) {
          if (!tolerateUnsupportedClosure || !(error instanceof UnsupportedClosureError)) throw error;
          addClosureDiagnostic(
            error.closureCode,
            relative(file),
            `The deterministic beta scanner cannot resolve Solidity import ${boundedDiagnosticSpecifier(specifier)} under this repository build profile.`
          );
          continue;
        }
        addPath(resolution.path, resolution.kind, resolution.dependencyContext);
        if (resolution.external) {
          externalImports.add(specifier);
        }
        const resolutionContext = resolution.remapping ?? resolution.dependencyContext;
        if (resolution.external || resolution.dependencyContext) {
          const record = {
            specifier,
            importer: relative(file),
            remappingPrefix: resolutionContext?.prefix ?? null,
            remappingTarget: resolutionContext?.target ?? null,
            resolvedPath: relative(resolution.path),
            kind: resolution.kind,
            ...(resolution.dependencyContext?.packageDependency ? {
              packageName: resolution.dependencyContext.packageDependency.packageName
            } : {})
          };
          importResolutions.set(canonicalJson(record), record);
          if (importResolutions.size > REVIEW_TARGET_CONTRACT_V1.maximumImportResolutions) {
            throw new Error(`review target exceeds ${REVIEW_TARGET_CONTRACT_V1.maximumImportResolutions} Solidity import resolutions`);
          }
        }
      }
      continue;
    }
    if (javascriptSourceExtension.test(file)) {
      const importer = relative(file);
      const source = decodeReviewText(fileContents.get(importer), importer);
      let dependencies;
      try {
        dependencies = extractJavaScriptDependencies(source, importer, declaredPackageDependencies.keys());
      } catch (error) {
        if (!tolerateUnsupportedClosure || !(error instanceof UnsupportedClosureError)) throw error;
        addClosureDiagnostic(error.closureCode, importer, boundedDiagnosticMessage(error.message));
        continue;
      }
      for (const dependency of dependencies) {
        if (!isLocalJavaScriptSpecifier(dependency.specifier)) continue;
        const resolution = resolveJavaScriptImport(file, dependency.specifier);
        const resolvedPath = relative(resolution.path);
        const runtimeAsset = runtimeAssetPaths.has(resolvedPath);
        if (resolution.assetQuery && !runtimeAsset) {
          throw new Error(`JavaScript ?url import is not declared by the runtime asset manifest: ${dependency.specifier} from ${importer}`);
        }
        if (!runtimeAsset) addPath(resolution.path, dependency.kind);
        const record = {
          specifier: dependency.specifier,
          importer,
          resolvedPath,
          kind: runtimeAsset ? `${dependency.kind}-runtime-asset-reference` : dependency.kind
        };
        javascriptImportResolutions.set(canonicalJson(record), record);
        if (javascriptImportResolutions.size > REVIEW_TARGET_CONTRACT_V1.maximumImportResolutions) {
          throw new Error(`review target exceeds ${REVIEW_TARGET_CONTRACT_V1.maximumImportResolutions} JavaScript import resolutions`);
        }
      }
    }
  }

  const records = [...files.values()].sort((left, right) => compareUtf8(left.path, right.path));
  const diagnostics = [...closureDiagnostics.values()].sort(compareClosureDiagnostics);
  const closure = {
    status: diagnostics.length === 0 ? "complete" : "incomplete",
    diagnostics
  };
  if (!isClosedReviewTargetClosure(closure)) throw new Error("review target closure diagnostics are invalid");
  const target = {
    schemaVersion: 1,
    standardVersion: STANDARD_VERSION,
    submissionHash: submissionHash(submission),
    closureMethod: REVIEW_TARGET_CLOSURE_METHOD_V1,
    closure,
    files: records,
    externalImports: [...externalImports].sort(compareUtf8),
    importResolutions: [...importResolutions.values()].sort(compareImportResolutionRecords),
    javascriptImportResolutions: [...javascriptImportResolutions.values()].sort(compareImportResolutionRecords)
  };
  if (runtimeAssets !== null) target.runtimeAssets = runtimeAssets;
  return {
    ...target,
    reviewTargetHash: calculateReviewTargetHash(target)
  };

  function addRepositoryPath(relativePath, kind) {
    if (!isCanonicalReviewTargetPath(relativePath)) throw new Error(`unsafe repository-relative path: ${relativePath}`);
    addPath(path.resolve(repository, relativePath), kind);
    if (isDeclaredSourceKind(kind) && !hasDeterministicSemanticClosure(relativePath)) {
      addClosureDiagnostic(
        "DECLARED_FILE_SEMANTIC_CLOSURE_UNAVAILABLE",
        relativePath,
        `${relativePath} is byte-bound, but the deterministic beta scanner has no semantic dependency-closure rule for this declared file type.`
      );
    }
  }

  function addPath(absolutePath, kind, dependencyContext = null) {
    const entry = inspectRepositoryEntry(repository, absolutePath);
    const { stat } = entry;
    if (!stat.isFile()) throw new Error(`review target entry is not a file: ${relative(absolutePath)}`);
    const real = entry.path;
    const repositoryPath = entry.relativePath;
    if (!isCanonicalReviewTargetPath(repositoryPath)) {
      throw new Error(`review target path is not canonical: ${repositoryPath}`);
    }
    if (files.has(repositoryPath)) {
      enqueueSource(real, kind, dependencyContext);
      return fileContents.get(repositoryPath);
    }
    if (stat.size > REVIEW_TARGET_CONTRACT_V1.maximumFileBytes) throw new Error(`review target file exceeds ${REVIEW_TARGET_CONTRACT_V1.maximumFileBytes} bytes: ${repositoryPath}`);
    if (files.size >= REVIEW_TARGET_CONTRACT_V1.maximumFiles) throw new Error(`review target exceeds ${REVIEW_TARGET_CONTRACT_V1.maximumFiles} files`);
    if (totalBytes + stat.size > REVIEW_TARGET_CONTRACT_V1.maximumTotalBytes) throw new Error(`review target exceeds ${REVIEW_TARGET_CONTRACT_V1.maximumTotalBytes} total bytes`);
    const contents = readValidatedFile(real, stat, repositoryPath);
    if (isSourceOrTestReviewKind(kind) && isGitLfsPointer(contents)) {
      throw new Error(`Git LFS pointer is not materialized source/test content: ${repositoryPath}`);
    }
    const externalPackage = dependencyContext?.packageDependency
      ? buildExternalPackageBinding(dependencyContext.packageDependency)
      : null;
    files.set(repositoryPath, {
      path: repositoryPath,
      kind,
      bytes: contents.byteLength,
      sha256: crypto.createHash("sha256").update(contents).digest("hex"),
      ...(externalPackage === null ? {} : {
        sourceClass: EXTERNAL_PACKAGE_SOURCE_CLASS,
        packageDependency: externalPackage
      })
    });
    fileContents.set(repositoryPath, contents);
    totalBytes += contents.byteLength;
    enqueueSource(real, kind, dependencyContext);
    return contents;
  }

  function enqueueSource(file, kind, dependencyContext) {
    const contextKey = dependencyContext ? `${dependencyContext.prefix}\0${dependencyContext.target}` : "";
    const key = `${relative(file)}\0${contextKey}`;
    if (queuedSources.has(key)) return;
    queuedSources.add(key);
    queue.push({ path: file, kind, dependencyContext });
  }

  function resolveSolidityImport(importer, specifier, importerKind, importerDependencyContext) {
    if (specifier.startsWith(".")) {
      const target = path.resolve(path.dirname(importer), specifier);
      if (!inside(repository, target)) throw new Error(`Solidity import escapes the repository: ${specifier}`);
      const packageDependencyContext = importerDependencyContext?.packageDependency
        ? importerDependencyContext
        : null;
      const dependencyImport = importerKind === "solidity-dependency-import"
        || importerKind === "solidity-package-dependency-import"
        || importerDependencyContext !== null;
      if (packageDependencyContext && !inside(packageDependencyContext.packageRoot, target)) {
        throw new Error(`relative Solidity package import escapes its declared package root: ${specifier}`);
      }
      if (!dependencyImport && relative(target).startsWith("lib/")) {
        throw new UnsupportedClosureError(
          "SOLIDITY_IMPORT_RESOLUTION_UNPROVEN",
          `first-party Solidity must import a pinned dependency through its declared prefix: ${specifier}`
        );
      }
      return {
        path: target,
        kind: packageDependencyContext
          ? "solidity-package-dependency-import"
          : dependencyImport ? "solidity-dependency-import" : "solidity-import",
        external: false,
        remapping: null,
        dependencyContext: dependencyImport ? importerDependencyContext : null
      };
    }
    const matchingRemappings = remappings.filter(({ prefix }) => specifier.startsWith(prefix));
    if (matchingRemappings.length > 0) {
      const longest = matchingRemappings[0].prefix.length;
      const equallySpecific = matchingRemappings.filter(({ prefix }) => prefix.length === longest);
      if (equallySpecific.length !== 1) {
        throw new UnsupportedClosureError(
          "SOLIDITY_IMPORT_RESOLUTION_UNPROVEN",
          `ambiguous Solidity remapping for ${specifier}`
        );
      }
      const remapping = equallySpecific[0];
      const suffix = specifier.slice(remapping.prefix.length);
      const target = path.resolve(repository, remapping.target, suffix);
      if (!inside(repository, target)) throw new Error(`Solidity remapping escapes the repository: ${remapping.prefix}`);
      const targetPath = relative(target);
      const packageDependency = declaredPackageForPath(targetPath);
      if (targetPath.startsWith("node_modules/") && packageDependency === null) {
        throw new UnsupportedClosureError(
          "SOLIDITY_IMPORT_RESOLUTION_UNPROVEN",
          `Solidity package import is not bound by an exact package dependency: ${specifier}`
        );
      }
      const dependencyImport = targetPath.startsWith("lib/") || packageDependency !== null;
      const dependencyContext = packageDependency === null
        ? (dependencyImport ? remapping : null)
        : {
            ...remapping,
            packageDependency,
            packageRoot: path.resolve(repository, packageRootPath(packageDependency.packageName))
          };
      return {
        path: target,
        kind: packageDependency !== null
          ? "solidity-package-dependency-import"
          : dependencyImport ? "solidity-dependency-import" : "solidity-remapped-import",
        external: true,
        remapping,
        dependencyContext
      };
    }
    if (/^(?:src|test|spec|contracts|models|submissions)\//.test(specifier)) {
      const target = path.resolve(repository, specifier);
      return { path: target, kind: "solidity-import", external: false, remapping: null, dependencyContext: null };
    }
    throw new UnsupportedClosureError(
      "SOLIDITY_IMPORT_RESOLUTION_UNPROVEN",
      `bare Solidity import has no canonical remapping: ${specifier}`
    );
  }

  function resolveJavaScriptImport(importer, specifier) {
    if (specifier.includes("\0") || specifier.includes("\\") || specifier.includes("#")) {
      throw new Error(`unsupported local JavaScript import specifier: ${specifier} from ${relative(importer)}`);
    }
    const assetQuery = specifier.endsWith("?url");
    if (specifier.includes("?") && !assetQuery) {
      throw new Error(`unsupported local JavaScript import specifier: ${specifier} from ${relative(importer)}`);
    }
    const cleanSpecifier = assetQuery ? specifier.slice(0, -4) : specifier;
    const unresolved = path.resolve(path.dirname(importer), cleanSpecifier);
    if (!inside(repository, unresolved)) {
      throw new Error(`JavaScript import escapes the repository: ${specifier} from ${relative(importer)}`);
    }

    const candidates = new Set();
    const explicitExtension = path.extname(unresolved) !== "";
    addCandidate(unresolved);
    if (!explicitExtension) {
      for (const extension of javascriptResolutionExtensions) addCandidate(`${unresolved}${extension}`);
      for (const extension of javascriptResolutionExtensions) addCandidate(path.join(unresolved, `index${extension}`));
    } else if (
      path.extname(unresolved).toLowerCase() === ".js"
      && /\.(?:ts|tsx|mts|cts)$/i.test(importer)
    ) {
      const withoutJavaScriptExtension = unresolved.slice(0, -3);
      addCandidate(`${withoutJavaScriptExtension}.ts`);
      addCandidate(`${withoutJavaScriptExtension}.tsx`);
    }
    const matches = [...candidates].sort((left, right) => relative(left).localeCompare(relative(right)));
    if (matches.length === 0) {
      throw new Error(`local JavaScript import does not resolve: ${specifier} from ${relative(importer)}`);
    }
    if (matches.length > 1) {
      throw new Error(`local JavaScript import is ambiguous: ${specifier} from ${relative(importer)}`);
    }
    return { path: matches[0], assetQuery };

    function addCandidate(candidate) {
      const stat = lstatOrNull(candidate);
      if (stat?.isFile() || stat?.isSymbolicLink()) candidates.add(candidate);
    }
  }

  function relative(target) {
    return path.relative(repository, target).replaceAll(path.sep, "/");
  }

  function declaredPackageForPath(repositoryPath) {
    const matches = [...declaredPackageDependencies.values()].filter((dependency) => (
      isExactPackageFilePath(repositoryPath, dependency.packageName)
    ));
    if (matches.length > 1) {
      throw new Error(`Solidity package path is ambiguously declared: ${repositoryPath}`);
    }
    return matches[0] ?? null;
  }

  function addClosureDiagnostic(code, repositoryPath, detail) {
    if (!REVIEW_TARGET_CLOSURE_DIAGNOSTIC_CODES.includes(code)) {
      throw new Error(`unknown review target closure diagnostic: ${code}`);
    }
    const diagnostic = {
      code,
      detail: boundedDiagnosticMessage(detail),
      path: repositoryPath
    };
    const key = `${diagnostic.code}\0${diagnostic.path}\0${diagnostic.detail}`;
    closureDiagnostics.set(key, diagnostic);
    if (closureDiagnostics.size > REVIEW_TARGET_CONTRACT_V1.maximumClosureDiagnostics) {
      throw new Error(`review target exceeds ${REVIEW_TARGET_CONTRACT_V1.maximumClosureDiagnostics} closure diagnostics`);
    }
  }
}

export function analyzeRepositoryClosure({ repositoryRoot, packageRoot, submission }) {
  return analyzeRepositoryReview({ repositoryRoot, packageRoot, submission }).closure;
}

export function analyzeRepositoryReview({ repositoryRoot, packageRoot, submission }) {
  const target = buildReviewTarget({
    repositoryRoot,
    packageRoot,
    submission,
    includePackageArtifacts: false,
    tolerateUnsupportedClosure: true
  });
  return {
    closure: target.closure,
    runtimeAssets: target.runtimeAssets ?? null
  };
}

export function appendReviewTargetClosureDiagnostics(reviewTarget, additionalDiagnostics) {
  if (!isClosedReviewTargetClosure(reviewTarget?.closure) || !Array.isArray(additionalDiagnostics)) {
    throw new Error("review target closure extension is invalid");
  }
  const records = new Map();
  for (const diagnostic of [...reviewTarget.closure.diagnostics, ...additionalDiagnostics]) {
    const candidate = {
      code: diagnostic?.code,
      detail: boundedDiagnosticMessage(diagnostic?.detail),
      path: diagnostic?.path
    };
    const singleton = { status: "incomplete", diagnostics: [candidate] };
    if (!isClosedReviewTargetClosure(singleton)) throw new Error("review target closure extension is invalid");
    records.set(`${candidate.code}\0${candidate.path}\0${candidate.detail}`, candidate);
  }
  const diagnostics = [...records.values()].sort(compareClosureDiagnostics);
  const closure = { status: diagnostics.length === 0 ? "complete" : "incomplete", diagnostics };
  if (!isClosedReviewTargetClosure(closure)) throw new Error("review target closure extension is invalid");
  const { reviewTargetHash: ignored, ...preimage } = reviewTarget;
  const extended = { ...preimage, closure };
  return { ...extended, reviewTargetHash: calculateReviewTargetHash(extended) };
}

export function calculateReviewTargetHash(reviewTarget) {
  const { reviewTargetHash: ignored, ...preimage } = reviewTarget ?? {};
  return `sha256:${crypto.createHash("sha256").update(canonicalJson(preimage)).digest("hex")}`;
}

function isDeclaredSourceKind(kind) {
  return kind === "source-entry"
    || kind === "test-entry"
    || kind === "launch-calldata-source"
    || kind === "launch-hook-configuration-source"
    || kind === "launch-liquidity-source"
    || kind === "launch-executor-test"
    || kind === "app-integration-source"
    || kind === "app-integration-test"
    || kind === "routing-integration-source"
    || kind === "routing-integration-test"
    || kind === "data-reconstruction-source"
    || kind === "data-reconstruction-test"
    || kind === "platform-handoff-registry"
    || kind === "platform-handoff-ui-source"
    || kind === "platform-handoff-api-source"
    || kind === "platform-handoff-indexer-source"
    || kind === "platform-handoff-test"
    || kind?.startsWith("capability-source:")
    || kind?.startsWith("capability-test:");
}

function hasDeterministicSemanticClosure(repositoryPath) {
  return repositoryPath.endsWith(".sol")
    || javascriptSourceExtension.test(repositoryPath)
    || declarativeReviewExtension.test(repositoryPath);
}

function boundedDiagnosticSpecifier(value) {
  const normalized = String(value ?? "")
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 160);
  return JSON.stringify(normalized || "unresolved-import");
}

function boundedDiagnosticMessage(value) {
  let normalized = String(value ?? "")
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (normalized.length === 0) normalized = "The deterministic beta scanner cannot prove this declared source closure.";
  while (Buffer.byteLength(normalized, "utf8") > REVIEW_TARGET_CONTRACT_V1.maximumClosureDiagnosticDetailBytes) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

function compareClosureDiagnostics(left, right) {
  return compareUtf8(left.code, right.code)
    || compareUtf8(left.path, right.path)
    || compareUtf8(left.detail, right.detail);
}

function compareImportResolutionRecords(left, right) {
  return compareUtf8(left.specifier, right.specifier)
    || compareUtf8(left.importer, right.importer)
    || compareUtf8(left.resolvedPath, right.resolvedPath)
    || compareUtf8(canonicalJson(left), canonicalJson(right));
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}
