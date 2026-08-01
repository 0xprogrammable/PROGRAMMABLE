import crypto from "node:crypto";
import fs from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";
import { spawnSafeGitSync } from "./repository-root.mjs";
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
import { buildRuntimeAssetReview } from "./runtime-assets-core.mjs";

const packageFiles = ["submission.json", "compatibility-report.json", "PROPOSAL.md", "THREAT_MODEL.md", "TEST_PLAN.md", "EVIDENCE.md"];
// Solidity accepts bare, named, wildcard, aliased and compact imports. Parse
// the complete statement after comments are stripped so none of those forms
// can hide a local source file from the review closure.
const solidityImport = /\bimport\b[^;]*?["']([^"']+)["'](?:\s+as\s+[A-Za-z_$][\w$]*)?\s*;/g;
const javascriptSourceExtension = /\.(?:[cm]?[jt]sx?)$/i;
const declarativeReviewExtension = /\.(?:json|md|txt|ya?ml)$/i;
const javascriptResolutionExtensions = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".d.ts", ".json"];
const MAX_JAVASCRIPT_TOKENS = 100_000;
const MAX_JAVASCRIPT_TEMPLATE_DEPTH = 64;
const nodeBuiltinSpecifiers = new Set(builtinModules.flatMap((specifier) => (
  specifier.startsWith("node:") ? [specifier, specifier.slice(5)] : [specifier, `node:${specifier}`]
)));

class UnsupportedClosureError extends Error {
  constructor(closureCode, message) {
    super(message);
    this.name = "UnsupportedClosureError";
    this.closureCode = closureCode;
  }
}

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
  if (includePackageArtifacts) for (const dependency of submission.dependencies?.onchain ?? []) {
    if (dependency?.deploymentEvidencePath) addRepositoryPath(dependency.deploymentEvidencePath, `deployment-evidence:${dependency.name ?? "unidentified"}`);
  }
  if (includePackageArtifacts) for (const [field, kind] of [
    ["specificationPath", "specification"],
    ["testEvidencePath", "test-evidence"],
    ["dependencyLockPath", "dependency-lock"]
  ]) {
    if (implementation[field]) addRepositoryPath(implementation[field], kind);
  }

  if (includePackageArtifacts && implementation.gateStatusPath) {
    if (!isCanonicalReviewTargetPath(implementation.gateStatusPath)) throw new Error(`unsafe gate status path: ${implementation.gateStatusPath}`);
    const gateStatusPath = path.resolve(repository, implementation.gateStatusPath);
    if (!inside(repository, gateStatusPath)) throw new Error(`gate status path escapes the repository: ${implementation.gateStatusPath}`);
    const gateStatusEntry = inspectRepositoryEntry(repository, gateStatusPath);
    if (!gateStatusEntry.stat.isFile()) throw new Error(`gate status entry is not a file: ${implementation.gateStatusPath}`);
    const gateStatus = JSON.parse(decodeReviewText(
      readValidatedFile(gateStatusEntry.path, gateStatusEntry.stat, implementation.gateStatusPath),
      implementation.gateStatusPath
    ));
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

function extractJavaScriptDependencies(source, importer, declaredPackages) {
  const tokens = tokenizeJavaScript(source, importer);
  const dependencies = [];
  const declaredPackageNames = new Set(declaredPackages);
  rejectUnsupportedRuntimeLoaders(tokens, importer);

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type !== "identifier") continue;

    if (token.value === "import" && tokens[index - 1]?.value !== ".") {
      const next = tokens[index + 1];
      if (next?.value === ".") {
        if (
          tokens[index + 2]?.value === "meta"
          && tokens[index + 3]?.value === "."
          && /^glob(?:Eager)?$/.test(tokens[index + 4]?.value ?? "")
          && tokens[index + 5]?.value === "("
        ) {
          throw new UnsupportedClosureError(
            "JAVASCRIPT_IMPORT_META_GLOB_UNPROVEN",
            `unsupported local JavaScript dependency syntax import.meta.${tokens[index + 4].value}: ${importer}`
          );
        }
        continue;
      }
      if (next?.value === "(") {
        const call = readLiteralDependencyCall(
          tokens,
          index + 1,
          "dynamic import",
          importer,
          { allowAdditionalArguments: true }
        );
        addSpecifier(call.specifier, "javascript-dynamic-import");
        index = call.endIndex;
        continue;
      }
      if (next?.type === "string") {
        addSpecifier(readModuleSpecifier(next, importer), "javascript-import");
        index += 1;
        continue;
      }

      const declaration = readStaticImport(tokens, index, importer);
      if (declaration) {
        addSpecifier(declaration.specifier, "javascript-import");
        index = declaration.endIndex;
        continue;
      }
      continue;
    }

    if (token.value === "export" && tokens[index - 1]?.value !== ".") {
      const declaration = readStaticReExport(tokens, index, importer);
      if (declaration) {
        if (declaration.specifier !== null) addSpecifier(declaration.specifier, "javascript-re-export");
        index = declaration.endIndex;
      }
      continue;
    }

    if (token.value === "require") {
      const next = tokens[index + 1];
      if (next?.value === "(") {
        const call = readLiteralDependencyCall(tokens, index + 1, "require", importer);
        addSpecifier(call.specifier, "javascript-require");
        index = call.endIndex;
        continue;
      }
      if (next?.value === ".") {
        const method = tokens[index + 2];
        if (method?.value === "resolve" && tokens[index + 3]?.value === "(") {
          const call = readLiteralDependencyCall(tokens, index + 3, "require.resolve", importer);
          addSpecifier(call.specifier, "javascript-require-resolve");
          index = call.endIndex;
          continue;
        }
        if (tokens[index + 3]?.value === "(") {
          throw new UnsupportedClosureError(
            "JAVASCRIPT_RUNTIME_LOADER_UNPROVEN",
            `unsupported local JavaScript dependency syntax require.${String(method?.value)}: ${importer}`
          );
        }
        continue;
      }
      throw new UnsupportedClosureError(
        "JAVASCRIPT_RUNTIME_LOADER_UNPROVEN",
        `unsupported indirect require reference: ${importer}`
      );
    }
  }

  return dependencies;

  function addSpecifier(specifier, kind) {
    if (unsupportedLocalJavaScriptAlias(specifier)) {
      throw new UnsupportedClosureError(
        "JAVASCRIPT_ALIAS_RESOLUTION_UNPROVEN",
        `unsupported local JavaScript import alias: ${specifier}`
      );
    }
    if (
      !isLocalJavaScriptSpecifier(specifier)
      && !nodeBuiltinSpecifiers.has(specifier)
      && ![...declaredPackageNames].some((packageName) => isExactDeclaredPackageSpecifier(specifier, packageName))
    ) {
      throw new UnsupportedClosureError(
        "JAVASCRIPT_PACKAGE_DEPENDENCY_UNBOUND",
        `bare JavaScript import is not bound by an exact package dependency: ${specifier}`
      );
    }
    dependencies.push({ specifier, kind });
  }
}

export function analyzeJavaScriptModuleDependencies(source, importer, declaredPackages = []) {
  if (typeof source !== "string" || !isCanonicalReviewTargetPath(importer)) {
    throw new Error("JavaScript closure analysis input is invalid");
  }
  const packageNames = [...declaredPackages];
  if (packageNames.some((entry) => !isCanonicalNpmPackageName(entry))) {
    throw new Error("JavaScript closure analysis package input is invalid");
  }
  return extractJavaScriptDependencies(source, importer, packageNames)
    .map((entry) => Object.freeze({ ...entry }));
}

function rejectUnsupportedRuntimeLoaders(tokens, importer) {
  const runtimeLoaders = new Set([
    "createRequire",
    "getBuiltinModule",
    "_load",
    "__webpack_require__",
    "__non_webpack_require__"
  ]);
  const dynamicEvaluators = new Set(["eval", "Function"]);
  const computedLoaderProperties = new Set([
    "require",
    "import",
    "createRequire",
    "_load",
    "eval",
    "Function",
    "constructor"
  ]);

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type === "identifier" && runtimeLoaders.has(token.value)) {
      throw new UnsupportedClosureError(
        "JAVASCRIPT_RUNTIME_LOADER_UNPROVEN",
        `unsupported runtime JavaScript loader ${token.value}: ${importer}`
      );
    }
    if (token.type === "identifier" && dynamicEvaluators.has(token.value)) {
      throw new UnsupportedClosureError(
        "JAVASCRIPT_RUNTIME_LOADER_UNPROVEN",
        `unsupported dynamic JavaScript evaluation ${token.value}: ${importer}`
      );
    }
    if (token.value === "[") {
      const property = constantComputedProperty(tokens, index, importer);
      if (property && computedLoaderProperties.has(property.value)) {
        throw new UnsupportedClosureError(
          "JAVASCRIPT_RUNTIME_LOADER_UNPROVEN",
          `unsupported computed JavaScript loader property ${property.value}: ${importer}`
        );
      }
    }
  }
}

function constantComputedProperty(tokens, openingIndex, importer) {
  let cursor = openingIndex + 1;
  let value = "";
  let sawString = false;
  while (cursor < tokens.length) {
    const token = tokens[cursor];
    if (token.value === "]") {
      return sawString ? { value, endIndex: cursor } : null;
    }
    if (token.type !== "string") return null;
    if (token.hasEscape) {
      throw new UnsupportedClosureError(
        "JAVASCRIPT_SYNTAX_CLOSURE_UNPROVEN",
        `unsupported escaped computed JavaScript property: ${importer}`
      );
    }
    value += token.value;
    sawString = true;
    cursor += 1;
    if (tokens[cursor]?.value === "]") continue;
    if (tokens[cursor]?.value !== "+") return null;
    cursor += 1;
  }
  return null;
}

function readStaticImport(tokens, importIndex, importer) {
  let cursor = importIndex + 1;
  if (tokens[cursor]?.value === "type" && tokens[cursor + 1]?.value !== "from") cursor += 1;

  if (tokens[cursor]?.type === "identifier") {
    cursor += 1;
    if (tokens[cursor]?.value === "=") return null;
    if (tokens[cursor]?.value === ",") cursor += 1;
  }

  if (tokens[cursor]?.value === "*") {
    cursor += 1;
    if (tokens[cursor]?.value !== "as" || tokens[cursor + 1]?.type !== "identifier") {
      throw new UnsupportedClosureError(
        "JAVASCRIPT_SYNTAX_CLOSURE_UNPROVEN",
        `unsupported static JavaScript import syntax: ${importer}`
      );
    }
    cursor += 2;
  } else if (tokens[cursor]?.value === "{") {
    cursor = closingTokenIndex(tokens, cursor, "{", "}", importer) + 1;
  }

  if (tokens[cursor]?.value !== "from" || tokens[cursor + 1]?.type !== "string") {
    throw new UnsupportedClosureError(
      "JAVASCRIPT_SYNTAX_CLOSURE_UNPROVEN",
      `unsupported static JavaScript import syntax: ${importer}`
    );
  }
  return {
    specifier: readModuleSpecifier(tokens[cursor + 1], importer),
    endIndex: cursor + 1
  };
}

function readStaticReExport(tokens, exportIndex, importer) {
  let cursor = exportIndex + 1;
  if (tokens[cursor]?.value === "type") cursor += 1;
  if (tokens[cursor]?.value === "*") {
    cursor += 1;
    if (tokens[cursor]?.value === "as") {
      if (tokens[cursor + 1]?.type !== "identifier") {
        throw new UnsupportedClosureError(
          "JAVASCRIPT_SYNTAX_CLOSURE_UNPROVEN",
          `unsupported static JavaScript re-export syntax: ${importer}`
        );
      }
      cursor += 2;
    }
  } else if (tokens[cursor]?.value === "{") {
    cursor = closingTokenIndex(tokens, cursor, "{", "}", importer) + 1;
  } else {
    return null;
  }
  if (tokens[cursor]?.value !== "from") {
    return {
      specifier: null,
      endIndex: cursor - 1
    };
  }
  if (tokens[cursor + 1]?.type !== "string") {
    throw new UnsupportedClosureError(
      "JAVASCRIPT_SYNTAX_CLOSURE_UNPROVEN",
      `static JavaScript re-export must use one string literal: ${importer}`
    );
  }
  return {
    specifier: readModuleSpecifier(tokens[cursor + 1], importer),
    endIndex: cursor + 1
  };
}

function closingTokenIndex(tokens, openingIndex, opening, closing, importer) {
  let depth = 0;
  for (let index = openingIndex; index < tokens.length; index += 1) {
    if (tokens[index].value === opening) depth += 1;
    if (tokens[index].value === closing) {
      depth -= 1;
      if (depth === 0) return index;
    }
    if (tokens[index].value === ";" && depth > 0) break;
  }
  throw new Error(`unterminated static JavaScript module declaration: ${importer}`);
}

function readLiteralDependencyCall(
  tokens,
  openingIndex,
  label,
  importer,
  { allowAdditionalArguments = false } = {}
) {
  const argument = tokens[openingIndex + 1];
  if (argument?.type !== "string") {
    throw new UnsupportedClosureError(
      label === "dynamic import"
        ? "JAVASCRIPT_DYNAMIC_IMPORT_UNPROVEN"
        : "JAVASCRIPT_RUNTIME_LOADER_UNPROVEN",
      `${label} must use one string literal: ${importer}`
    );
  }
  let cursor = openingIndex + 2;
  if (tokens[cursor]?.value !== ")") {
    if (!allowAdditionalArguments || tokens[cursor]?.value !== ",") {
      throw new UnsupportedClosureError(
        label === "dynamic import"
          ? "JAVASCRIPT_DYNAMIC_IMPORT_UNPROVEN"
          : "JAVASCRIPT_RUNTIME_LOADER_UNPROVEN",
        `${label} must use one string literal: ${importer}`
      );
    }
    cursor += 1;
    if (tokens[cursor]?.value !== ")") {
      let depth = 1;
      for (; cursor < tokens.length; cursor += 1) {
        if (tokens[cursor].value === "(") depth += 1;
        if (tokens[cursor].value === ")") {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      if (depth !== 0) throw new Error(`unterminated ${label} call: ${importer}`);
    }
  }
  return {
    specifier: readModuleSpecifier(argument, importer),
    endIndex: openingIndex + 1
  };
}

function readModuleSpecifier(token, importer) {
  if (token.hasEscape) {
    throw new UnsupportedClosureError(
      "JAVASCRIPT_SYNTAX_CLOSURE_UNPROVEN",
      `JavaScript module specifier may not contain escapes: ${importer}`
    );
  }
  if (token.value.length === 0) throw new Error(`JavaScript module specifier may not be empty: ${importer}`);
  return token.value;
}

function unsupportedLocalJavaScriptAlias(specifier) {
  return specifier.startsWith("/")
    || specifier.startsWith("file:")
    || /^(?:@\/|~\/|#|src\/|app\/|components\/|models\/|submissions\/|scripts\/)/.test(specifier);
}

function isLocalJavaScriptSpecifier(specifier) {
  return specifier === "." || specifier === ".." || specifier.startsWith("./") || specifier.startsWith("../");
}

function tokenizeJavaScript(source, importer) {
  const tokens = [];
  let index = 0;
  let templateDepth = 0;

  if (source.startsWith("#!")) {
    const lineEnd = source.indexOf("\n");
    index = lineEnd === -1 ? source.length : lineEnd + 1;
  }
  scanCode(false);
  return tokens;

  function scanCode(stopAtTemplateExpression) {
    let braceDepth = 0;
    while (index < source.length) {
      const current = source[index];
      const next = source[index + 1];
      if (/\s/.test(current)) {
        index += 1;
        continue;
      }
      if (current === "/" && next === "/") {
        index += 2;
        while (index < source.length && source[index] !== "\n") index += 1;
        continue;
      }
      if (current === "/" && next === "*") {
        index += 2;
        const closing = source.indexOf("*/", index);
        if (closing === -1) throw new Error(`unterminated JavaScript block comment: ${importer}`);
        index = closing + 2;
        continue;
      }
      if (current === "'" || current === '"') {
        pushToken(readJavaScriptString(current));
        continue;
      }
      if (current === "`") {
        scanTemplate();
        pushToken({ type: "literal", value: "template-literal" });
        continue;
      }
      if (current === "/" && canStartRegularExpression(tokens.at(-1))) {
        skipRegularExpression();
        pushToken({ type: "literal", value: "regular-expression" });
        continue;
      }
      if (isJavaScriptIdentifierStart(current)) {
        const start = index;
        index += 1;
        while (index < source.length && isJavaScriptIdentifierPart(source[index])) index += 1;
        pushToken({ type: "identifier", value: source.slice(start, index) });
        continue;
      }
      if (current === "\\" && source[index + 1] === "u") {
        throw new UnsupportedClosureError(
          "JAVASCRIPT_SYNTAX_CLOSURE_UNPROVEN",
          `escaped JavaScript identifiers are not supported: ${importer}`
        );
      }
      const twoCharacterPunctuator = source.slice(index, index + 2);
      if (twoCharacterPunctuator === "++" || twoCharacterPunctuator === "--") {
        pushToken({ type: "punctuator", value: twoCharacterPunctuator });
        index += 2;
        continue;
      }
      if (stopAtTemplateExpression && current === "}" && braceDepth === 0) {
        index += 1;
        return;
      }
      if (stopAtTemplateExpression && current === "{") braceDepth += 1;
      if (stopAtTemplateExpression && current === "}") braceDepth -= 1;
      pushToken({ type: "punctuator", value: current });
      index += 1;
    }
    if (stopAtTemplateExpression) throw new Error(`unterminated JavaScript template expression: ${importer}`);
  }

  function readJavaScriptString(quote) {
    index += 1;
    let value = "";
    let hasEscape = false;
    while (index < source.length) {
      const current = source[index];
      if (current === quote) {
        index += 1;
        return { type: "string", value, hasEscape };
      }
      if (current === "\n" || current === "\r") {
        throw new Error(`unterminated JavaScript string literal: ${importer}`);
      }
      if (current === "\\") {
        hasEscape = true;
        value += current;
        index += 1;
        if (index >= source.length) break;
        value += source[index];
        index += 1;
        continue;
      }
      value += current;
      index += 1;
    }
    throw new Error(`unterminated JavaScript string literal: ${importer}`);
  }

  function scanTemplate() {
    templateDepth += 1;
    if (templateDepth > MAX_JAVASCRIPT_TEMPLATE_DEPTH) {
      throw new Error(`JavaScript source exceeds ${MAX_JAVASCRIPT_TEMPLATE_DEPTH} nested template literals: ${importer}`);
    }
    try {
      index += 1;
      while (index < source.length) {
        const current = source[index];
        const next = source[index + 1];
        if (current === "\\") {
          index += 2;
          continue;
        }
        if (current === "`") {
          index += 1;
          return;
        }
        if (current === "$" && next === "{") {
          index += 2;
          scanCode(true);
          continue;
        }
        index += 1;
      }
      throw new Error(`unterminated JavaScript template literal: ${importer}`);
    } finally {
      templateDepth -= 1;
    }
  }

  function skipRegularExpression() {
    index += 1;
    let inClass = false;
    while (index < source.length) {
      const current = source[index];
      if (current === "\\") {
        index += 2;
        continue;
      }
      if (current === "[") inClass = true;
      if (current === "]") inClass = false;
      if (current === "/" && !inClass) {
        index += 1;
        while (/[A-Za-z]/.test(source[index] ?? "")) index += 1;
        return;
      }
      if (current === "\n" || current === "\r") break;
      index += 1;
    }
    throw new Error(`unterminated JavaScript regular expression: ${importer}`);
  }

  function pushToken(token) {
    if (tokens.length >= MAX_JAVASCRIPT_TOKENS) {
      throw new Error(`JavaScript source exceeds ${MAX_JAVASCRIPT_TOKENS} lexical tokens: ${importer}`);
    }
    tokens.push(token);
  }
}

function canStartRegularExpression(previous) {
  if (!previous) return true;
  if (previous.type === "identifier") {
    return new Set(["await", "case", "delete", "do", "else", "in", "instanceof", "new", "of", "return", "throw", "typeof", "void", "yield"]).has(previous.value);
  }
  if (previous.value === "++" || previous.value === "--") return false;
  return new Set(["(", "[", "{", ",", ":", ";", "=", "!", "?", "&", "|", "+", "-", "*", "%", "^", "~", "<", ">"]).has(previous.value);
}

function isJavaScriptIdentifierStart(value) {
  return /[A-Za-z_$]/.test(value);
}

function isJavaScriptIdentifierPart(value) {
  return /[A-Za-z0-9_$]/.test(value);
}

export function stripSolidityComments(source) {
  let output = "";
  let mode = "code";
  let quote = null;
  for (let index = 0; index < source.length; index += 1) {
    const current = source[index];
    const next = source[index + 1];
    if (mode === "line-comment") {
      if (current === "\n") {
        output += "\n";
        mode = "code";
      } else output += " ";
      continue;
    }
    if (mode === "block-comment") {
      if (current === "*" && next === "/") {
        output += "  ";
        index += 1;
        mode = "code";
      } else output += current === "\n" ? "\n" : " ";
      continue;
    }
    if (mode === "string") {
      output += current;
      if (current === "\\") {
        if (next !== undefined) {
          output += next;
          index += 1;
        }
      } else if (current === quote) {
        mode = "code";
        quote = null;
      }
      continue;
    }
    if (current === "/" && next === "/") {
      output += "  ";
      index += 1;
      mode = "line-comment";
    } else if (current === "/" && next === "*") {
      output += "  ";
      index += 1;
      mode = "block-comment";
    } else {
      output += current;
      if (current === '"' || current === "'") {
        mode = "string";
        quote = current;
      }
    }
  }
  return output;
}

function inspectRepositoryEntry(repository, target, { allowMissing = false } = {}) {
  const absolute = path.resolve(target);
  if (!inside(repository, absolute)) throw new Error(`review target resolves outside the repository: ${absolute}`);
  const relativePath = path.relative(repository, absolute).replaceAll(path.sep, "/");
  const segments = relativePath === "" ? [] : relativePath.split("/");
  let current = repository;
  let stat = fs.lstatSync(repository);

  for (const [index, segment] of segments.entries()) {
    current = path.join(current, segment);
    stat = lstatOrNull(current);
    if (!stat) {
      if (allowMissing) return null;
      throw new Error(`review target file does not exist: ${relativePath}`);
    }
    const currentRelative = path.relative(repository, current).replaceAll(path.sep, "/");
    if (stat.isSymbolicLink()) throw new Error(`review target contains a symbolic link: ${currentRelative}`);
    if (index < segments.length - 1 && !stat.isDirectory()) {
      throw new Error(`review target path component is not a directory: ${currentRelative}`);
    }
  }

  return { path: absolute, relativePath, stat };
}

function readValidatedFile(file, expectedStat, repositoryPath) {
  const noFollow = fs.constants.O_NOFOLLOW ?? 0;
  let descriptor;
  try {
    descriptor = fs.openSync(file, fs.constants.O_RDONLY | noFollow);
  } catch (error) {
    if (error?.code === "ELOOP") throw new Error(`review target contains a symbolic link: ${repositoryPath}`);
    throw error;
  }
  try {
    const openedStat = fs.fstatSync(descriptor);
    if (!openedStat.isFile()) throw new Error(`review target entry is not a file: ${repositoryPath}`);
    if (
      openedStat.dev !== expectedStat.dev
      || openedStat.ino !== expectedStat.ino
      || openedStat.size !== expectedStat.size
    ) {
      throw new Error(`review target file changed while it was being validated: ${repositoryPath}`);
    }
    if (openedStat.size > REVIEW_TARGET_CONTRACT_V1.maximumFileBytes) throw new Error(`review target file exceeds ${REVIEW_TARGET_CONTRACT_V1.maximumFileBytes} bytes: ${repositoryPath}`);
    const contents = fs.readFileSync(descriptor);
    if (contents.byteLength !== openedStat.size) {
      throw new Error(`review target file changed while it was being read: ${repositoryPath}`);
    }
    return contents;
  } finally {
    fs.closeSync(descriptor);
  }
}

function decodeReviewText(contents, repositoryPath) {
  if (!Buffer.isBuffer(contents)) throw new Error(`review target file was not captured: ${repositoryPath}`);
  const source = contents.toString("utf8");
  if (source.includes("\0")) throw new Error(`review target text file contains a NUL byte: ${repositoryPath}`);
  return source;
}

export function validateDependencyLock(
  lock,
  externalImports,
  { submission, testedBaselineLock, importResolutions = [], repositoryRoot = null } = {}
) {
  const errors = [];
  if (!lock || typeof lock !== "object" || Array.isArray(lock)) return ["dependency lock must be an object"];
  if (lock.schemaVersion !== 1) errors.push("dependency lock schemaVersion must be 1");
  if (!["programmable-tested", "model-specific-pinned", "model-specific-reviewed"].includes(lock.baseline)) errors.push("dependency lock baseline must be programmable-tested, model-specific-pinned or model-specific-reviewed");
  const compiler = lock.compiler ?? {};
  for (const field of ["solidity", "sourceRepository", "sourceRevision", "sourceTree", "evmVersion", "optimizer", "optimizerRuns", "viaIR", "metadataBytecodeHash", "cborMetadata", "ffi"]) {
    if (compiler[field] === null || compiler[field] === undefined) errors.push(`dependency lock compiler.${field} is required`);
  }
  if (typeof compiler.sourceRepository !== "string" || !compiler.sourceRepository.startsWith("https://github.com/")) errors.push("dependency lock compiler.sourceRepository must be an HTTPS GitHub repository");
  if (!/^[a-fA-F0-9]{40}$/.test(compiler.sourceRevision ?? "")) errors.push("dependency lock compiler.sourceRevision must be an exact 40-character commit");
  if (!/^[a-fA-F0-9]{40}$/.test(compiler.sourceTree ?? "")) errors.push("dependency lock compiler.sourceTree must be an exact 40-character tree");
  if (submission) {
    if (compiler.solidity !== submission.target?.solidityVersion) errors.push("dependency lock compiler.solidity differs from submission.target.solidityVersion");
    if (compiler.evmVersion !== submission.target?.evmVersion) errors.push("dependency lock compiler.evmVersion differs from submission.target.evmVersion");
    if (lock.baseline !== submission.target?.dependencyBaseline) errors.push("dependency lock baseline differs from submission.target.dependencyBaseline");
  }
  if (lock.baseline === "programmable-tested") {
    const expected = {
      solidity: "0.8.26",
      sourceRepository: "https://github.com/argotorg/solidity.git",
      sourceRevision: "8a97fa7a1db1ec509221ead6fea6802c684ee887",
      sourceTree: "4ecc702563263869217d8a42262d09bd6015f597",
      evmVersion: "cancun",
      optimizer: true,
      optimizerRuns: 1000,
      viaIR: false,
      metadataBytecodeHash: "none",
      cborMetadata: false,
      ffi: false
    };
    for (const [field, value] of Object.entries(expected)) if (compiler[field] !== value) errors.push(`programmable-tested baseline requires compiler.${field}=${JSON.stringify(value)}`);
    if (!testedBaselineLock || testedBaselineLock.baseline !== "programmable-tested") {
      errors.push("trusted programmable-tested baseline definition is unavailable");
    } else {
      const expectedNames = new Set((testedBaselineLock.dependencies ?? []).map((dependency) => dependency.name));
      for (const dependency of lock.dependencies ?? []) if (!expectedNames.has(dependency?.name)) errors.push(`programmable-tested baseline contains unreviewed extra dependency ${String(dependency?.name)}`);
      if ((lock.dependencies ?? []).length !== expectedNames.size) errors.push("programmable-tested baseline dependency count differs from the trusted definition");
      for (const expectedDependency of testedBaselineLock.dependencies ?? []) {
        const actual = (lock.dependencies ?? []).find((dependency) => dependency.name === expectedDependency.name);
        if (!actual) {
          errors.push(`programmable-tested baseline is missing ${expectedDependency.name}`);
          continue;
        }
        for (const field of ["repository", "revision", "packageVersion", "integrity", "sourceTree", "license", "importPrefixes"]) {
          if (canonicalJson(actual[field]) !== canonicalJson(expectedDependency[field])) errors.push(`programmable-tested baseline ${expectedDependency.name}.${field} differs from the trusted definition`);
        }
      }
    }
  } else if (lock.baseline === "model-specific-reviewed") {
    errors.push("model-specific-reviewed cannot be self-attested by a public prototype; a maintainer must register one coherent dependency baseline before intake can pass");
  }
  const dependencies = Array.isArray(lock.dependencies) ? lock.dependencies : [];
  if (dependencies.length === 0) errors.push("dependency lock requires at least one dependency");
  for (const [index, dependency] of dependencies.entries()) {
    const context = `dependency lock dependencies[${index}]`;
    if (typeof dependency.name !== "string" || dependency.name.length === 0) errors.push(`${context}.name is required`);
    if (typeof dependency.repository !== "string" || !dependency.repository.startsWith("https://")) errors.push(`${context}.repository must be an HTTPS URL`);
    if (dependency.revision !== null && !/^[a-fA-F0-9]{40}$/.test(dependency.revision ?? "")) errors.push(`${context}.revision must be an exact 40-character commit`);
    if (dependency.revision === null && (typeof dependency.packageVersion !== "string" || typeof dependency.integrity !== "string")) {
      errors.push(`${context} needs an exact revision or an exact package version with integrity`);
    }
    if (dependency.revision !== null && !/^[a-fA-F0-9]{40}$/.test(dependency.sourceTree ?? "")) errors.push(`${context}.sourceTree must bind the exact Git tree for a revision dependency`);
    if (dependency.revision === null && !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(dependency.integrity ?? "")) errors.push(`${context}.integrity must be an exact sha512 package integrity`);
    if (dependency.packageVersion && /[~^*xX><=| ]/.test(dependency.packageVersion)) errors.push(`${context}.packageVersion must be exact`);
    if (typeof dependency.license !== "string" || dependency.license.length === 0) errors.push(`${context}.license is required`);
    if (!Array.isArray(dependency.importPrefixes)) errors.push(`${context}.importPrefixes must be an array`);
    for (const prefix of dependency.importPrefixes ?? []) {
      if (typeof prefix !== "string" || prefix.length < 3 || !prefix.endsWith("/") || ["@/", "src/", "test/", "lib/"].includes(prefix)) {
        errors.push(`${context}.importPrefixes contains an unsafe or overly broad prefix: ${String(prefix)}`);
      }
    }
  }
  const prefixes = dependencies.flatMap((dependency) => dependency.importPrefixes ?? []);
  const resolutionsBySpecifier = new Map();
  for (const resolution of importResolutions ?? []) {
    if (!resolutionsBySpecifier.has(resolution.specifier)) resolutionsBySpecifier.set(resolution.specifier, []);
    resolutionsBySpecifier.get(resolution.specifier).push(resolution);
  }
  for (const specifier of externalImports) {
    const matchingDependencies = dependencies.filter((dependency) => (
      (dependency.importPrefixes ?? []).some((prefix) => typeof prefix === "string" && prefix.length > 0 && specifier.startsWith(prefix))
    ));
    const matches = prefixes.filter((prefix) => typeof prefix === "string" && prefix.length > 0 && specifier.startsWith(prefix));
    if (matches.length === 0) {
      errors.push(`external import is not covered by the dependency lock: ${specifier}`);
    } else if (matches.length !== 1) {
      errors.push(`external import is ambiguously covered by ${matches.length} dependency prefixes: ${specifier}`);
    } else {
      const dependency = matchingDependencies[0];
      const resolutions = resolutionsBySpecifier.get(specifier) ?? [];
      if (resolutions.length === 0) {
        errors.push(`external import has no resolved compiler source in the review target: ${specifier}`);
        continue;
      }
      for (const resolution of resolutions) {
        if (!(dependency.importPrefixes ?? []).includes(resolution.remappingPrefix)) {
          errors.push(`external import ${specifier} uses undeclared remapping prefix ${String(resolution.remappingPrefix)}`);
        }
        if (resolution.kind !== "solidity-dependency-import" && resolution.kind !== "solidity-package-dependency-import") {
          errors.push(`external import ${specifier} resolves outside a pinned dependency checkout: ${String(resolution.resolvedPath)}`);
        }
      }
    }
  }
  const verifiedCheckouts = new Set();
  const verifiedSources = new Set();
  for (const resolution of importResolutions ?? []) {
    if (resolution.kind !== "solidity-dependency-import" && resolution.kind !== "solidity-package-dependency-import") continue;
    const matchingDependencies = dependencies.filter((dependency) => (
      (dependency.importPrefixes ?? []).includes(resolution.remappingPrefix)
    ));
    if (matchingDependencies.length === 0) {
      errors.push(`resolved dependency source ${String(resolution.resolvedPath)} has no dependency for remapping prefix ${String(resolution.remappingPrefix)}`);
      continue;
    }
    if (matchingDependencies.length !== 1) {
      errors.push(`resolved dependency source ${String(resolution.resolvedPath)} is ambiguously covered by ${matchingDependencies.length} dependencies`);
      continue;
    }
    if (resolution.kind === "solidity-package-dependency-import") {
      const declaredPackage = (submission?.integration?.sdkDependencies ?? []).find((dependency) => (
        dependency?.packageName === resolution.packageName
      ));
      if (!declaredPackage || !isExactPackageDependency(declaredPackage)) {
        errors.push(`resolved package source ${String(resolution.resolvedPath)} has no exact package declaration`);
        continue;
      }
      const lockedPackage = matchingDependencies[0];
      for (const [field, declaredField] of [
        ["packageVersion", "version"],
        ["integrity", "integrity"],
        ["repository", "repository"],
        ["revision", "revision"]
      ]) {
        if (lockedPackage[field] !== declaredPackage[declaredField]) {
          errors.push(`dependency ${lockedPackage.name} ${field} differs from the exact package declaration`);
        }
      }
      continue;
    }
    if (!repositoryRoot) {
      errors.push(`resolved dependency source ${String(resolution.resolvedPath)} cannot verify its checkout without a repository root`);
      continue;
    }
    verifyDependencyCheckout(
      matchingDependencies[0],
      resolution,
      repositoryRoot,
      errors,
      verifiedCheckouts,
      verifiedSources
    );
  }
  return errors;
}

export function parseRemappings(source) {
  const records = [];
  const prefixes = new Set();
  for (const [index, rawLine] of source.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0 || separator !== line.lastIndexOf("=")) {
      throw new Error(`invalid remappings.txt entry on line ${index + 1}`);
    }
    const prefix = line.slice(0, separator).trim();
    const target = line.slice(separator + 1).trim();
    if (prefix.includes(":")) throw new Error(`context-specific remappings are not supported on line ${index + 1}`);
    if (!prefix.endsWith("/") || prefix.includes("\\") || prefix.startsWith("/") || prefix.split("/").includes("..")) {
      throw new Error(`unsafe Solidity remapping prefix on line ${index + 1}`);
    }
    if (!safeRelativeDirectory(target)) throw new Error(`unsafe Solidity remapping target on line ${index + 1}`);
    if (prefixes.has(prefix)) throw new Error(`duplicate Solidity remapping prefix ${prefix}`);
    prefixes.add(prefix);
    records.push({ prefix, target });
  }
  return records.sort((left, right) => right.prefix.length - left.prefix.length || left.prefix.localeCompare(right.prefix));
}

function hasFoundryRemappingsSetting(source) {
  return source.split(/\r?\n/).some((line) => /^\s*remappings\s*=/.test(line.replace(/#.*$/, "")));
}

function verifyDependencyCheckout(
  dependency,
  resolution,
  repositoryRoot,
  errors,
  verifiedCheckouts,
  verifiedSources
) {
  const repositoryInput = path.resolve(repositoryRoot);
  const repositoryInputStat = lstatOrNull(repositoryInput);
  if (!repositoryInputStat?.isDirectory() || repositoryInputStat.isSymbolicLink()) {
    errors.push(`dependency ${dependency.name} repository root is not a real directory`);
    return;
  }
  const repository = fs.realpathSync(repositoryInput);
  const resolved = path.resolve(repository, resolution.resolvedPath);
  let resolvedEntry;
  try {
    resolvedEntry = inspectRepositoryEntry(repository, resolved);
  } catch (error) {
    errors.push(`external import ${resolution.specifier} resolves to an invalid dependency source: ${error.message}`);
    return;
  }
  if (!resolvedEntry.stat.isFile()) {
    errors.push(`external import ${resolution.specifier} does not resolve to a dependency file`);
    return;
  }
  let checkout;
  try {
    checkout = findGitCheckout(path.dirname(resolved), repository);
  } catch (error) {
    errors.push(`external import ${resolution.specifier} has an invalid Git checkout: ${error.message}`);
    return;
  }
  if (!checkout) {
    errors.push(`external import ${resolution.specifier} is not inside a Git checkout pinned by the dependency lock`);
    return;
  }
  const cacheKey = `${checkout}\0${dependency.name}`;
  if (!verifiedCheckouts.has(cacheKey)) {
    verifiedCheckouts.add(cacheKey);
    const revision = runGit(checkout, ["rev-parse", "HEAD"]);
    if (revision !== dependency.revision) {
      errors.push(`dependency ${dependency.name} checkout revision differs from the dependency lock`);
    }
    const tree = runGit(checkout, ["rev-parse", "HEAD^{tree}"]);
    if (tree !== dependency.sourceTree) {
      errors.push(`dependency ${dependency.name} checkout tree differs from the dependency lock`);
    }
    const status = runGit(checkout, ["status", "--porcelain", "--untracked-files=all"]);
    if (status !== "") errors.push(`dependency ${dependency.name} checkout contains modified or untracked files`);
    const remote = runGit(checkout, ["remote", "get-url", "origin"]);
    if (!sameRepository(remote, dependency.repository)) {
      errors.push(`dependency ${dependency.name} checkout origin differs from the dependency lock`);
    }
  }

  if (!inside(checkout, resolved)) {
    errors.push(`dependency ${dependency.name} resolved source is outside its Git checkout`);
    return;
  }
  const checkoutPath = path.relative(checkout, resolved).replaceAll(path.sep, "/");
  if (!isCanonicalReviewTargetPath(checkoutPath)) {
    errors.push(`dependency ${dependency.name} resolved source has an unsafe checkout path`);
    return;
  }
  const sourceKey = `${cacheKey}\0${checkoutPath}`;
  if (verifiedSources.has(sourceKey)) return;
  verifiedSources.add(sourceKey);

  const headObject = `HEAD:${checkoutPath}`;
  const headType = runGit(checkout, ["cat-file", "-t", headObject]);
  if (headType !== "blob") {
    errors.push(`dependency ${dependency.name} resolved source ${checkoutPath} is not a blob in HEAD`);
    return;
  }
  const headBlob = runGit(checkout, ["rev-parse", "--verify", headObject]);
  const workingBlob = runGit(checkout, ["hash-object", "--no-filters", "--", checkoutPath]);
  if (!headBlob || !workingBlob) {
    errors.push(`dependency ${dependency.name} could not bind resolved source ${checkoutPath} to its HEAD blob`);
  } else if (workingBlob !== headBlob) {
    errors.push(`dependency ${dependency.name} resolved source ${checkoutPath} differs from its HEAD blob`);
  }
}

function findGitCheckout(start, repository) {
  let current = path.resolve(start);
  while (inside(repository, current) && current !== repository) {
    const markerPath = path.join(current, ".git");
    const marker = lstatOrNull(markerPath);
    if (marker?.isSymbolicLink()) {
      throw new Error(`Git metadata is a symbolic link: ${path.relative(repository, markerPath).replaceAll(path.sep, "/")}`);
    }
    if (marker) return current;
    current = path.dirname(current);
  }
  return null;
}

function runGit(directory, args) {
  const result = spawnSafeGitSync(["-C", directory, ...args], {
    encoding: "utf8",
    timeout: 5000
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

function sameRepository(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const normalize = (value) => value.trim().replace(/^git@github\.com:/i, "https://github.com/").replace(/\.git\/?$/i, "").replace(/\/$/, "").toLowerCase();
  return normalize(left) === normalize(right);
}

function safeRelativeDirectory(value) {
  return typeof value === "string"
    && value.endsWith("/")
    && isCanonicalReviewTargetPath(value.slice(0, -1));
}

function lstatOrNull(target) {
  try {
    return fs.lstatSync(target);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return null;
    throw error;
  }
}

function inside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
