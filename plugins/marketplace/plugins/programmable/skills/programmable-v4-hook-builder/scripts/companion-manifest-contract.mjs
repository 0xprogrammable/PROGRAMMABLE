import crypto from "node:crypto";
import path from "node:path";
import { TextDecoder } from "node:util";

import {
  GITHUB_PUBLIC_SOURCE_CONTRACT_V1,
  parseBoundedLosslessJson,
  validateGitHubPublicSourceRequestV1
} from "./github-public-source-core.mjs";
import { isCanonicalNpmPackageName } from "./package-dependency-contract.mjs";
import { analyzeJavaScriptModuleDependencies } from "./review-target-core.mjs";
import { isCanonicalReviewTargetPath } from "./review-target-contract.mjs";
import { canonicalJson } from "./submission-core.mjs";

export const COMPANION_MANIFEST_V2 = Object.freeze({
  schemaVersion: "2.0.0",
  closureMethod: "npm-package-lock-v3-static-module-closure-v1",
  maximumPaths: GITHUB_PUBLIC_SOURCE_CONTRACT_V1.limits.pathsTotal,
  maximumLockPackages: 8_192
});

const V1_KEYS = Object.freeze([
  "contractPaths",
  "repositoryUri",
  "revisionObjectId",
  "schemaVersion",
  "sourcePaths"
]);
const V2_KEYS = Object.freeze([
  "build",
  "closureMethod",
  "githubActionsRunIds",
  "numericRepositoryId",
  "repositoryUri",
  "revisionObjectId",
  "runtimePaths",
  "schemaVersion",
  "sourcePaths",
  "testPaths",
  "treeObjectId"
]);
const BUILD_KEYS = Object.freeze([
  "buildScript",
  "configurationPaths",
  "packageLockPath",
  "packageManifestPath",
  "testScript"
]);
const OPAQUE_ID_PATTERN = /^[1-9][0-9]{0,63}$/u;
const GIT_OBJECT_PATTERN = /^[0-9a-f]{40}$/u;
const SCRIPT_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,63}$/u;
const EXACT_VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;
const SHA512_INTEGRITY_PATTERN = /^sha512-[A-Za-z0-9+/]+={0,2}$/u;
const SHA256_RECEIPT_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const ACTION_SHA_PATTERN = /^[0-9a-f]{40}$/u;
const JAVASCRIPT_EXTENSION = /\.(?:[cm]?[jt]sx?)$/iu;
const HTML_EXTENSION = /\.html?$/iu;
const CSS_EXTENSION = /\.css$/iu;
const SHADER_EXTENSION = /\.(?:glsl|vert|frag|wgsl)$/iu;
const JAVASCRIPT_RESOLUTION_EXTENSIONS = Object.freeze([
  ".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".d.ts", ".json",
  ".css", ".html", ".glsl", ".vert", ".frag", ".wgsl"
]);
const CONTROL_OR_BIDI_PATTERN = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u;
const STRICT_UTF8 = new TextDecoder("utf-8", { fatal: true });

export function normalizeCompanionManifest(input) {
  if (!isPlainObject(input)) invalid("companion manifest must be a JSON object");
  if (input.schemaVersion === "1.0.0") return normalizeV1(input);
  if (input.schemaVersion === COMPANION_MANIFEST_V2.schemaVersion) return normalizeV2(input);
  invalid("companion manifest schemaVersion is unsupported");
}

export function verifyCompanionManifestV2Closure(manifest, records, githubActionsEvidence) {
  const normalized = normalizeV2(manifest).manifestV2;
  if (!(records instanceof Map)) invalid("companion v2 exact Git object records are unavailable");

  const closurePaths = manifestClosurePaths(normalized);
  const bytesByPath = new Map();
  const objectRecords = [];
  for (const filePath of closurePaths) {
    const record = records.get(filePath);
    if (!isExactObjectRecord(record)) invalid(`companion v2 path is not an exact regular Git blob: ${filePath}`);
    const bytes = Buffer.from(record.bytes);
    bytesByPath.set(filePath, bytes);
    objectRecords.push({ path: filePath, mode: record.mode, objectId: record.objectId, bytes: bytes.length });
  }

  const packageManifest = parseBoundedJson(bytesByPath.get(normalized.build.packageManifestPath), "package manifest");
  const packageLock = parseBoundedJson(bytesByPath.get(normalized.build.packageLockPath), "package lock");
  const npmClosure = validateNpmClosure({ packageManifest, packageLock, build: normalized.build });
  const directPackageNames = npmClosure.directPackageNames;
  const declaredPaths = new Set(closurePaths);
  const moduleResolutions = [];

  for (const importer of [
    ...normalized.sourcePaths,
    ...normalized.testPaths,
    ...normalized.runtimePaths,
    ...normalized.build.configurationPaths
  ]) {
    const bytes = bytesByPath.get(importer);
    if (JAVASCRIPT_EXTENSION.test(importer)) {
      const source = decodeText(bytes, importer);
      let dependencies;
      try {
        dependencies = analyzeJavaScriptModuleDependencies(source, importer, directPackageNames);
      } catch (error) {
        invalid(`companion JavaScript closure is incomplete at ${importer}: ${boundedMessage(error?.message)}`);
      }
      for (const dependency of dependencies) {
        if (!isLocalSpecifier(dependency.specifier)) continue;
        const resolvedPath = resolveDeclaredDependency(importer, dependency.specifier, declaredPaths);
        moduleResolutions.push({
          importer,
          kind: dependency.kind,
          resolvedPath,
          specifier: dependency.specifier
        });
      }
      continue;
    }
    if (HTML_EXTENSION.test(importer)) {
      for (const specifier of extractHtmlDependencies(decodeText(bytes, importer), importer)) {
        moduleResolutions.push({
          importer,
          kind: "html-resource",
          resolvedPath: resolveDeclaredDependency(importer, specifier, declaredPaths, { rootRelative: true }),
          specifier
        });
      }
      continue;
    }
    if (CSS_EXTENSION.test(importer)) {
      for (const specifier of extractCssDependencies(decodeText(bytes, importer), importer)) {
        moduleResolutions.push({
          importer,
          kind: "css-resource",
          resolvedPath: resolveDeclaredDependency(importer, specifier, declaredPaths, { rootRelative: true }),
          specifier
        });
      }
      continue;
    }
    if (SHADER_EXTENSION.test(importer)) {
      for (const specifier of extractShaderDependencies(decodeText(bytes, importer), importer)) {
        moduleResolutions.push({
          importer,
          kind: "shader-include",
          resolvedPath: resolveDeclaredDependency(importer, specifier, declaredPaths),
          specifier
        });
      }
      continue;
    }
    if (!isDeclarativeOrAssetPath(importer)) {
      invalid(`companion v2 source, test, or build configuration language is unsupported: ${importer}`);
    }
  }

  const evidence = normalizeSuccessfulEvidence(githubActionsEvidence, normalized.githubActionsRunIds, normalized);
  const workflowReceipts = validateClosureWorkflows(evidence, records, normalized.build);
  for (const receipt of workflowReceipts) {
    if (!objectRecords.some(({ path: objectPath }) => objectPath === receipt.workflowPath)) {
      const record = records.get(receipt.workflowPath);
      objectRecords.push({
        path: receipt.workflowPath,
        mode: record.mode,
        objectId: record.objectId,
        bytes: Buffer.from(record.bytes).length
      });
    }
  }
  objectRecords.sort((left, right) => compareUtf8(left.path, right.path));
  moduleResolutions.sort((left, right) => (
    compareUtf8(left.importer, right.importer)
    || compareUtf8(left.specifier, right.specifier)
    || compareUtf8(left.resolvedPath, right.resolvedPath)
    || compareUtf8(left.kind, right.kind)
  ));
  const preimage = {
    schemaVersion: normalized.schemaVersion,
    closureMethod: normalized.closureMethod,
    repositoryUri: normalized.repositoryUri,
    numericRepositoryId: normalized.numericRepositoryId,
    revisionObjectId: normalized.revisionObjectId,
    treeObjectId: normalized.treeObjectId,
    objects: objectRecords,
    moduleResolutions,
    npmDependencyResolutions: npmClosure.dependencyResolutions,
    workflowReceipts,
    githubActionsEvidence: evidence.map(({ conclusion, runId, workflowPath }) => ({ conclusion, runId, workflowPath }))
  };
  return deepFreeze({
    schemaVersion: "1.0.0",
    status: "verified",
    closureMethod: normalized.closureMethod,
    repositoryUri: normalized.repositoryUri,
    numericRepositoryId: normalized.numericRepositoryId,
    revisionObjectId: normalized.revisionObjectId,
    treeObjectId: normalized.treeObjectId,
    fileCount: objectRecords.length,
    packageCount: packageCount(packageLock),
    dependencyEdgeCount: npmClosure.dependencyResolutions.length,
    moduleResolutionCount: moduleResolutions.length,
    successfulGitHubActionsRunIds: evidence.map(({ runId }) => runId),
    workflowReceipts,
    closureHash: `sha256:${crypto.createHash("sha256").update(canonicalJson(preimage)).digest("hex")}`
  });
}

export function validateCompanionClosureReceipts(input, sourceRequest) {
  if (!Array.isArray(input) || !isPlainObject(sourceRequest) || !Array.isArray(sourceRequest.companions)) {
    invalid("companion closure receipts and source request must be arrays of exact authorities");
  }
  const expected = sourceRequest.companions.filter(
    (companion) => Array.isArray(companion.githubActionsRunIds) && companion.githubActionsRunIds.length > 0
  );
  if (input.length !== expected.length) invalid("companion closure receipts do not cover every v2 source authority");
  const normalized = input.map((receipt, index) => normalizeClosureReceipt(receipt, expected[index]));
  for (let index = 1; index < normalized.length; index += 1) {
    if (compareUtf8(normalized[index - 1].repositoryUri, normalized[index].repositoryUri) >= 0) {
      invalid("companion closure receipts are not unique and sorted by repository URI");
    }
  }
  return deepFreeze(normalized);
}

function normalizeV1(input) {
  assertExactKeys(input, V1_KEYS, "companion manifest fields do not match the closed v1 contract");
  let source;
  try {
    source = validateGitHubPublicSourceRequestV1({
      schemaVersion: "1.0.0",
      primary: {
        repositoryUri: input.repositoryUri,
        numericRepositoryId: "1",
        revisionObjectId: input.revisionObjectId,
        treeObjectId: "0".repeat(40),
        sourcePaths: input.sourcePaths,
        contractPaths: input.contractPaths,
        githubActionsRunIds: []
      },
      companions: []
    }).primary;
  } catch {
    invalid("companion manifest does not satisfy the closed v1 source contract");
  }
  return deepFreeze({
    schemaVersion: "1.0.0",
    source: {
      repositoryUri: source.repositoryUri,
      revisionObjectId: source.revisionObjectId,
      sourcePaths: source.sourcePaths,
      contractPaths: source.contractPaths
    },
    manifestV2: null,
    closureStatus: "incomplete"
  });
}

function normalizeV2(input) {
  assertExactKeys(input, V2_KEYS, "companion manifest fields do not match the closed v2 contract");
  if (input.closureMethod !== COMPANION_MANIFEST_V2.closureMethod) {
    invalid("companion manifest v2 closureMethod is unsupported");
  }
  if (!OPAQUE_ID_PATTERN.test(input.numericRepositoryId ?? "")) invalid("companion repository id is invalid");
  if (!GIT_OBJECT_PATTERN.test(input.revisionObjectId ?? "") || !GIT_OBJECT_PATTERN.test(input.treeObjectId ?? "")) {
    invalid("companion commit and tree ids must be full lowercase Git object ids");
  }
  if (!isPlainObject(input.build)) invalid("companion build closure must be an object");
  assertExactKeys(input.build, BUILD_KEYS, "companion build closure fields do not match the closed v2 contract");
  if (!SCRIPT_NAME_PATTERN.test(input.build.buildScript ?? "") || !SCRIPT_NAME_PATTERN.test(input.build.testScript ?? "")) {
    invalid("companion build and test script names are invalid");
  }
  if (input.build.buildScript === input.build.testScript) invalid("companion build and test scripts must be distinct");

  const sourcePaths = normalizePathArray(input.sourcePaths, "sourcePaths", { minimum: 1 });
  const testPaths = normalizePathArray(input.testPaths, "testPaths", { minimum: 1 });
  if (!sourcePaths.some((entry) => JAVASCRIPT_EXTENSION.test(entry))) {
    invalid("companion v2 requires at least one JavaScript or TypeScript source path");
  }
  if (!testPaths.some((entry) => JAVASCRIPT_EXTENSION.test(entry))) {
    invalid("companion v2 requires at least one JavaScript or TypeScript test path");
  }
  const runtimePaths = normalizePathArray(input.runtimePaths, "runtimePaths");
  const configurationPaths = normalizePathArray(input.build.configurationPaths, "build.configurationPaths");
  const packageManifestPath = normalizePath(input.build.packageManifestPath, "build.packageManifestPath");
  const packageLockPath = normalizePath(input.build.packageLockPath, "build.packageLockPath");
  if (!packageManifestPath.endsWith("package.json") || !packageLockPath.endsWith("package-lock.json")) {
    invalid("companion v2 uses npm package.json and package-lock.json closure only");
  }
  if (packageManifestPath === packageLockPath) invalid("companion package manifest and lock paths must differ");
  const githubActionsRunIds = normalizeOpaqueIdArray(input.githubActionsRunIds, { minimum: 1 });
  const allPaths = [
    ...sourcePaths,
    ...testPaths,
    ...runtimePaths,
    ...configurationPaths,
    packageManifestPath,
    packageLockPath
  ].sort(compareUtf8);
  if (allPaths.length > COMPANION_MANIFEST_V2.maximumPaths) invalid("companion v2 path closure exceeds 512 files");
  assertUniqueSorted(allPaths, "companion v2 path categories must not overlap");

  const publicSourcePaths = [...sourcePaths, ...testPaths, ...runtimePaths].sort(compareUtf8);
  const publicContractPaths = [packageManifestPath, packageLockPath, ...configurationPaths].sort(compareUtf8);
  let source;
  try {
    source = validateGitHubPublicSourceRequestV1({
      schemaVersion: "1.0.0",
      primary: {
        repositoryUri: input.repositoryUri,
        numericRepositoryId: input.numericRepositoryId,
        revisionObjectId: input.revisionObjectId,
        treeObjectId: input.treeObjectId,
        sourcePaths: publicSourcePaths,
        contractPaths: publicContractPaths,
        githubActionsRunIds
      },
      companions: []
    }).primary;
  } catch {
    invalid("companion manifest v2 does not satisfy the exact public source contract");
  }
  const manifestV2 = {
    schemaVersion: COMPANION_MANIFEST_V2.schemaVersion,
    closureMethod: COMPANION_MANIFEST_V2.closureMethod,
    repositoryUri: source.repositoryUri,
    numericRepositoryId: source.numericRepositoryId,
    revisionObjectId: source.revisionObjectId,
    treeObjectId: source.treeObjectId,
    sourcePaths,
    testPaths,
    runtimePaths,
    build: {
      packageManifestPath,
      packageLockPath,
      configurationPaths,
      buildScript: input.build.buildScript,
      testScript: input.build.testScript
    },
    githubActionsRunIds
  };
  return deepFreeze({
    schemaVersion: COMPANION_MANIFEST_V2.schemaVersion,
    source,
    manifestV2,
    closureStatus: "declared"
  });
}

function validateNpmClosure({ packageManifest, packageLock, build }) {
  if (!isPlainObject(packageManifest) || !isPlainObject(packageManifest.scripts)) {
    invalid("companion package.json must contain a scripts object");
  }
  for (const scriptName of [build.buildScript, build.testScript]) {
    const command = packageManifest.scripts[scriptName];
    if (
      typeof command !== "string"
      || command.length === 0
      || Buffer.byteLength(command, "utf8") > 4_096
      || CONTROL_OR_BIDI_PATTERN.test(command)
    ) invalid(`companion package.json is missing a bounded ${scriptName} script`);
    for (const lifecycleName of [`pre${scriptName}`, `post${scriptName}`]) {
      if (packageManifest.scripts[lifecycleName] !== undefined) {
        invalid(`companion v2 build evidence does not accept implicit npm lifecycle script: ${lifecycleName}`);
      }
    }
  }
  if (packageManifest.workspaces !== undefined) {
    invalid("companion v2 npm closure does not accept workspaces; use one closed companion package per manifest");
  }
  if (!isPlainObject(packageLock) || losslessInteger(packageLock.lockfileVersion) !== 3 || !isPlainObject(packageLock.packages)) {
    invalid("companion package-lock.json must use lockfileVersion 3 with a packages map");
  }
  const entries = Object.entries(packageLock.packages);
  if (entries.length < 1 || entries.length > COMPANION_MANIFEST_V2.maximumLockPackages) {
    invalid("companion npm lock package count is outside the v2 bounds");
  }
  const root = packageLock.packages[""];
  if (!isPlainObject(root)) invalid("companion package-lock.json is missing the root package record");

  const dependencySections = ["dependencies", "devDependencies", "optionalDependencies"];
  const directPackageNames = new Set();
  for (const section of dependencySections) {
    const manifestDependencies = normalizeDependencySpecMap(packageManifest[section], `package.json.${section}`);
    const lockDependencies = normalizeDependencySpecMap(root[section], `package-lock.json.packages[\"\"].${section}`);
    if (canonicalJson(manifestDependencies) !== canonicalJson(lockDependencies)) {
      invalid(`companion package.json and package-lock.json disagree on ${section}`);
    }
    for (const packageName of Object.keys(manifestDependencies)) directPackageNames.add(packageName);
  }
  if (packageManifest.peerDependencies !== undefined || root.peerDependencies !== undefined) {
    invalid("companion v2 npm closure does not accept unresolved peer dependency authority");
  }

  const packageRecords = new Map(entries);
  const dependencyResolutions = [];
  for (const [packagePath, record] of entries) {
    if (packagePath === "") continue;
    if (!isCanonicalLockPackagePath(packagePath) || !isPlainObject(record) || record.link === true) {
      invalid(`companion npm lock contains an unsupported package record: ${boundedMessage(packagePath)}`);
    }
    if (!EXACT_VERSION_PATTERN.test(record.version ?? "") || !isSha512Integrity(record.integrity)) {
      invalid(`companion npm lock package is not bound by exact version and sha512 integrity: ${boundedMessage(packagePath)}`);
    }
    if (record.resolved !== undefined && !isCanonicalNpmRegistryTarball(record.resolved)) {
      invalid(`companion npm lock package origin is unsupported: ${boundedMessage(packagePath)}`);
    }
    if (record.bundleDependencies !== undefined || record.bundledDependencies !== undefined) {
      invalid(`companion npm lock package uses unsupported bundled dependency authority: ${boundedMessage(packagePath)}`);
    }
    for (const section of ["dependencies", "optionalDependencies", "peerDependencies"]) {
      const dependencies = normalizeDependencySpecMap(record[section], `package-lock.json.packages[${JSON.stringify(packagePath)}].${section}`);
      for (const packageName of Object.keys(dependencies)) {
        const resolvedPath = resolveLockDependency(packagePath, packageName, packageRecords);
        dependencyResolutions.push({
          importerPackagePath: packagePath,
          packageName,
          resolvedPackagePath: resolvedPath,
          section
        });
      }
    }
  }
  for (const packageName of directPackageNames) {
    const record = packageLock.packages[`node_modules/${packageName}`];
    if (!isPlainObject(record) || !EXACT_VERSION_PATTERN.test(record.version ?? "") || !isSha512Integrity(record.integrity)) {
      invalid(`companion direct dependency is absent from the exact npm lock: ${packageName}`);
    }
  }
  dependencyResolutions.sort((left, right) => (
    compareUtf8(left.importerPackagePath, right.importerPackagePath)
    || compareUtf8(left.section, right.section)
    || compareUtf8(left.packageName, right.packageName)
    || compareUtf8(left.resolvedPackagePath, right.resolvedPackagePath)
  ));
  return {
    directPackageNames: [...directPackageNames].sort(compareUtf8),
    dependencyResolutions
  };
}

function resolveLockDependency(importerPackagePath, packageName, packageRecords) {
  let cursor = importerPackagePath;
  while (true) {
    const candidate = `${cursor === "" ? "" : `${cursor}/`}node_modules/${packageName}`;
    if (packageRecords.has(candidate)) return candidate;
    const marker = cursor.lastIndexOf("/node_modules/");
    if (marker >= 0) {
      cursor = cursor.slice(0, marker);
      continue;
    }
    if (cursor !== "") {
      cursor = "";
      continue;
    }
    break;
  }
  invalid(`companion npm lock dependency target is absent: ${boundedMessage(importerPackagePath)} -> ${packageName}`);
}

function normalizeSuccessfulEvidence(input, expectedRunIds, manifest) {
  if (!Array.isArray(input) || input.length !== expectedRunIds.length) {
    invalid("companion GitHub Actions evidence is unavailable or overbroad");
  }
  const byId = new Map(input.map((entry) => [entry?.runId, entry]));
  if (byId.size !== input.length) invalid("companion GitHub Actions evidence contains duplicate run ids");
  const output = [];
  for (const runId of expectedRunIds) {
    const evidence = byId.get(runId);
    if (
      !isPlainObject(evidence)
      || evidence.status !== "completed"
      || evidence.conclusion !== "success"
      || evidence.headRevision !== manifest.revisionObjectId
      || evidence.headTree !== manifest.treeObjectId
      || !isCanonicalReviewTargetPath(evidence.workflowPath)
    ) invalid(`companion GitHub Actions run is not a successful exact-revision receipt: ${runId}`);
    output.push(evidence);
  }
  return output;
}

function normalizeClosureReceipt(receipt, authority) {
  if (!isPlainObject(receipt) || !isPlainObject(authority)) invalid("companion closure receipt is invalid");
  assertExactKeys(receipt, [
    "closureHash",
    "closureMethod",
    "dependencyEdgeCount",
    "fileCount",
    "moduleResolutionCount",
    "numericRepositoryId",
    "packageCount",
    "repositoryUri",
    "revisionObjectId",
    "schemaVersion",
    "status",
    "successfulGitHubActionsRunIds",
    "treeObjectId",
    "workflowReceipts"
  ], "companion closure receipt fields do not match the closed contract");
  if (
    receipt.schemaVersion !== "1.0.0"
    || receipt.status !== "verified"
    || receipt.closureMethod !== COMPANION_MANIFEST_V2.closureMethod
    || receipt.repositoryUri !== authority.repositoryUri
    || receipt.numericRepositoryId !== authority.numericRepositoryId
    || receipt.revisionObjectId !== authority.revisionObjectId
    || receipt.treeObjectId !== authority.treeObjectId
    || !SHA256_RECEIPT_PATTERN.test(receipt.closureHash ?? "")
  ) invalid("companion closure receipt does not match its exact source authority");
  for (const field of ["fileCount", "packageCount", "dependencyEdgeCount", "moduleResolutionCount"]) {
    if (!Number.isInteger(receipt[field]) || receipt[field] < 0 || receipt[field] > 1_000_000) {
      invalid("companion closure receipt count is invalid");
    }
  }
  if (
    !Array.isArray(receipt.successfulGitHubActionsRunIds)
    || canonicalJson(receipt.successfulGitHubActionsRunIds) !== canonicalJson(authority.githubActionsRunIds)
    || !Array.isArray(receipt.workflowReceipts)
    || receipt.workflowReceipts.length !== authority.githubActionsRunIds.length
  ) invalid("companion closure receipt does not cover the exact declared Actions runs");
  const workflowReceipts = receipt.workflowReceipts.map((workflowReceipt, index) => {
    if (!isPlainObject(workflowReceipt)) invalid("companion workflow receipt is invalid");
    assertExactKeys(workflowReceipt, [
      "buildScript",
      "runId",
      "testScript",
      "workflowObjectId",
      "workflowPath"
    ], "companion workflow receipt fields do not match the closed contract");
    if (
      workflowReceipt.runId !== authority.githubActionsRunIds[index]
      || !isCanonicalReviewTargetPath(workflowReceipt.workflowPath)
      || !workflowReceipt.workflowPath.startsWith(".github/workflows/")
      || !GIT_OBJECT_PATTERN.test(workflowReceipt.workflowObjectId ?? "")
      || !SCRIPT_NAME_PATTERN.test(workflowReceipt.buildScript ?? "")
      || !SCRIPT_NAME_PATTERN.test(workflowReceipt.testScript ?? "")
      || workflowReceipt.buildScript === workflowReceipt.testScript
    ) invalid("companion workflow receipt is not an exact build and test authority");
    return { ...workflowReceipt };
  });
  return {
    schemaVersion: receipt.schemaVersion,
    status: receipt.status,
    closureMethod: receipt.closureMethod,
    repositoryUri: receipt.repositoryUri,
    numericRepositoryId: receipt.numericRepositoryId,
    revisionObjectId: receipt.revisionObjectId,
    treeObjectId: receipt.treeObjectId,
    fileCount: receipt.fileCount,
    packageCount: receipt.packageCount,
    dependencyEdgeCount: receipt.dependencyEdgeCount,
    moduleResolutionCount: receipt.moduleResolutionCount,
    successfulGitHubActionsRunIds: [...receipt.successfulGitHubActionsRunIds],
    workflowReceipts,
    closureHash: receipt.closureHash
  };
}

function validateClosureWorkflows(evidence, records, build) {
  const workingDirectory = path.posix.dirname(build.packageManifestPath);
  if (workingDirectory !== path.posix.dirname(build.packageLockPath)) {
    invalid("companion package.json and package-lock.json must share one npm working directory");
  }
  return evidence.map((entry) => {
    const record = records.get(entry.workflowPath);
    if (!isExactObjectRecord(record)) {
      invalid(`companion closure workflow is not an exact regular Git blob: ${entry.workflowPath}`);
    }
    const workflow = parseBoundedJson(Buffer.from(record.bytes), `companion closure workflow ${entry.workflowPath}`);
    assertExactKeys(workflow, ["jobs", "name", "on", "permissions"], "companion closure workflow fields are unsupported");
    if (typeof workflow.name !== "string" || workflow.name.length < 1 || workflow.name.length > 120) {
      invalid("companion closure workflow name is invalid");
    }
    const events = normalizeWorkflowEvents(workflow.on);
    if (!events.includes(entry.event)) invalid("companion closure workflow receipt event is not declared by the exact workflow");
    if (!isPlainObject(workflow.permissions)) invalid("companion closure workflow permissions are invalid");
    assertExactKeys(workflow.permissions, ["contents"], "companion closure workflow permissions must be contents-read only");
    if (workflow.permissions.contents !== "read") invalid("companion closure workflow permissions must be contents-read only");
    if (!isPlainObject(workflow.jobs)) invalid("companion closure workflow jobs are invalid");
    assertExactKeys(workflow.jobs, ["programmable-companion-closure"], "companion closure workflow must contain exactly one unconditional job");
    const job = workflow.jobs["programmable-companion-closure"];
    if (!isPlainObject(job)) invalid("companion closure workflow job is invalid");
    assertExactKeys(job, ["runs-on", "steps", "timeout-minutes"], "companion closure workflow job fields are unsupported");
    const timeoutMinutes = losslessInteger(job["timeout-minutes"]);
    if (job["runs-on"] !== "ubuntu-24.04" || timeoutMinutes === null || timeoutMinutes < 1 || timeoutMinutes > 30) {
      invalid("companion closure workflow runner or timeout is outside the closed profile");
    }
    if (!Array.isArray(job.steps) || job.steps.length !== 5) {
      invalid("companion closure workflow must contain the five exact checkout, Node, install, build and test steps");
    }
    validatePinnedActionStep(job.steps[0], "actions/checkout");
    validateSetupNodeStep(job.steps[1], build.packageLockPath);
    validateRunStep(job.steps[2], "npm ci --ignore-scripts --no-audit --no-fund", workingDirectory);
    validateRunStep(job.steps[3], `npm run ${build.buildScript}`, workingDirectory);
    validateRunStep(job.steps[4], `npm run ${build.testScript}`, workingDirectory);
    return {
      runId: entry.runId,
      workflowPath: entry.workflowPath,
      workflowObjectId: record.objectId,
      buildScript: build.buildScript,
      testScript: build.testScript
    };
  }).sort((left, right) => compareUtf8(left.runId, right.runId));
}

function normalizeWorkflowEvents(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 3) {
    invalid("companion closure workflow on must be a bounded JSON event array");
  }
  const allowed = new Set(["pull_request", "push", "workflow_dispatch"]);
  const normalized = value.map((entry) => {
    if (typeof entry !== "string" || !allowed.has(entry)) invalid("companion closure workflow event is unsupported");
    return entry;
  });
  if (!isStrictlySorted(normalized)) invalid("companion closure workflow events must be unique and sorted");
  return normalized;
}

function validatePinnedActionStep(step, action) {
  if (!isPlainObject(step)) invalid("companion closure workflow action step is invalid");
  assertExactKeys(step, ["uses"], "companion closure workflow action step fields are unsupported");
  const prefix = `${action}@`;
  if (typeof step.uses !== "string" || !step.uses.startsWith(prefix) || !ACTION_SHA_PATTERN.test(step.uses.slice(prefix.length))) {
    invalid(`companion closure workflow ${action} action is not pinned to a full commit`);
  }
}

function validateSetupNodeStep(step, packageLockPath) {
  if (!isPlainObject(step)) invalid("companion closure workflow setup-node step is invalid");
  assertExactKeys(step, ["uses", "with"], "companion closure workflow setup-node fields are unsupported");
  const prefix = "actions/setup-node@";
  if (typeof step.uses !== "string" || !step.uses.startsWith(prefix) || !ACTION_SHA_PATTERN.test(step.uses.slice(prefix.length))) {
    invalid("companion closure workflow setup-node action is not pinned to a full commit");
  }
  if (!isPlainObject(step.with)) invalid("companion closure workflow setup-node inputs are invalid");
  assertExactKeys(step.with, ["cache", "cache-dependency-path", "node-version"], "companion closure workflow setup-node inputs are unsupported");
  if (
    step.with.cache !== "npm"
    || step.with["cache-dependency-path"] !== packageLockPath
    || !EXACT_VERSION_PATTERN.test(step.with["node-version"] ?? "")
  ) invalid("companion closure workflow must pin Node and the exact npm lock path");
}

function validateRunStep(step, command, workingDirectory) {
  if (!isPlainObject(step)) invalid("companion closure workflow run step is invalid");
  const expectedKeys = workingDirectory === "." ? ["run"] : ["run", "working-directory"];
  assertExactKeys(step, expectedKeys, "companion closure workflow run step fields are unsupported");
  if (step.run !== command || (workingDirectory !== "." && step["working-directory"] !== workingDirectory)) {
    invalid(`companion closure workflow does not execute the exact required command: ${command}`);
  }
}

function normalizeDependencySpecMap(value, label) {
  if (value === undefined) return Object.create(null);
  if (!isPlainObject(value)) invalid(`${label} must be an object`);
  const output = Object.create(null);
  for (const key of Object.keys(value).sort(compareUtf8)) {
    if (
      !isCanonicalNpmPackageName(key)
      || typeof value[key] !== "string"
      || value[key].length === 0
      || /^(?:file|git|git\+|https?|workspace|link|npm):/iu.test(value[key])
    ) {
      invalid(`${label} contains an invalid dependency declaration`);
    }
    output[key] = value[key];
  }
  return output;
}

function resolveDeclaredDependency(importer, specifier, declaredPaths, { rootRelative = false } = {}) {
  const cleanSpecifier = stripResourceSuffix(specifier);
  if (!rootRelative && !isLocalSpecifier(cleanSpecifier)) {
    invalid(`companion local dependency specifier is unsupported: ${boundedMessage(specifier)}`);
  }
  const base = rootRelative && cleanSpecifier.startsWith("/")
    ? cleanSpecifier.slice(1)
    : path.posix.normalize(path.posix.join(path.posix.dirname(importer), cleanSpecifier));
  if (!isCanonicalReviewTargetPath(base)) invalid(`companion dependency escapes the repository: ${boundedMessage(specifier)}`);
  const candidates = [base];
  if (path.posix.extname(base) === "") {
    for (const extension of JAVASCRIPT_RESOLUTION_EXTENSIONS) candidates.push(`${base}${extension}`);
    for (const extension of JAVASCRIPT_RESOLUTION_EXTENSIONS) candidates.push(`${base}/index${extension}`);
  }
  const matches = [...new Set(candidates)].filter((candidate) => declaredPaths.has(candidate));
  if (matches.length !== 1) {
    invalid(`companion dependency must resolve to exactly one declared closure path: ${importer} -> ${boundedMessage(specifier)}`);
  }
  return matches[0];
}

function extractHtmlDependencies(source, importer) {
  if (/<script\b(?![^>]*\bsrc\s*=)[^>]*>[\s\S]*?<\/script\s*>/iu.test(source)) {
    invalid(`companion inline HTML scripts are outside the v2 static closure method: ${importer}`);
  }
  if (
    /<style\b|\sstyle\s*=|\bsrcset\s*=|\b(?:poster|data|action|formaction)\s*=|<base\b|<meta\b[^>]*http-equiv\s*=\s*["']?refresh|\son[a-z]+\s*=/iu.test(source)
  ) invalid(`companion HTML contains an unsupported active or multi-resource form: ${importer}`);
  const dependencies = [];
  const assignments = [...source.matchAll(/\b(?:src|href)\s*=/giu)];
  const attribute = /\b(?:src|href)\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s"'`=<>]+))/giu;
  let parsed = 0;
  for (const match of source.matchAll(attribute)) {
    parsed += 1;
    const specifier = match[1] ?? match[2] ?? match[3];
    if (isExternalResource(specifier)) continue;
    dependencies.push(specifier);
  }
  if (parsed !== assignments.length) invalid(`companion HTML resource attribute syntax is unsupported: ${importer}`);
  return uniqueSorted(dependencies);
}

function extractCssDependencies(source, importer) {
  if (/expression\s*\(|@supports\s+selector\s*\(/iu.test(source)) {
    invalid(`companion CSS uses unsupported dynamic syntax: ${importer}`);
  }
  const dependencies = [];
  const pattern = /@import\s+(?:url\(\s*)?(["'])([^"']+)\1\s*\)?|url\(\s*(["']?)([^)'"\s]+)\3\s*\)/giu;
  for (const match of source.matchAll(pattern)) {
    const specifier = match[2] ?? match[4];
    if (isExternalResource(specifier)) continue;
    dependencies.push(specifier);
  }
  return uniqueSorted(dependencies);
}

function extractShaderDependencies(source, importer) {
  const dependencies = [];
  const pattern = /^\s*#include\s+(["'])([^"']+)\1\s*$/gmu;
  for (const match of source.matchAll(pattern)) dependencies.push(match[2]);
  if (/^\s*#include\s+[^<"'\s]/mu.test(source)) {
    invalid(`companion shader contains an unsupported include form: ${importer}`);
  }
  return uniqueSorted(dependencies);
}

function parseBoundedJson(bytes, label) {
  let source;
  try {
    source = STRICT_UTF8.decode(bytes);
    return parseBoundedLosslessJson(source);
  } catch {
    invalid(`companion ${label} is not bounded duplicate-free UTF-8 JSON`);
  }
}

function normalizePathArray(value, label, { minimum = 0 } = {}) {
  if (!Array.isArray(value) || value.length < minimum || value.length > COMPANION_MANIFEST_V2.maximumPaths) {
    invalid(`companion ${label} count is outside the v2 bounds`);
  }
  const paths = value.map((entry) => normalizePath(entry, label));
  if (!isStrictlySorted(paths)) invalid(`companion ${label} must use unique unsigned UTF-8 order`);
  return paths;
}

function normalizeOpaqueIdArray(value, { minimum = 0 } = {}) {
  if (!Array.isArray(value) || value.length < minimum || value.length > 16 || value.some((entry) => !OPAQUE_ID_PATTERN.test(entry))) {
    invalid("companion githubActionsRunIds are invalid");
  }
  if (!isStrictlySorted(value)) invalid("companion githubActionsRunIds must use unique unsigned UTF-8 order");
  return [...value];
}

function normalizePath(value, label) {
  if (!isCanonicalReviewTargetPath(value)) invalid(`companion ${label} contains an invalid repository path`);
  return value;
}

function manifestClosurePaths(manifest) {
  return [
    ...manifest.sourcePaths,
    ...manifest.testPaths,
    ...manifest.runtimePaths,
    ...manifest.build.configurationPaths,
    manifest.build.packageManifestPath,
    manifest.build.packageLockPath
  ].sort(compareUtf8);
}

function packageCount(packageLock) {
  return isPlainObject(packageLock?.packages) ? Object.keys(packageLock.packages).length - 1 : 0;
}

function isCanonicalLockPackagePath(value) {
  if (!isCanonicalReviewTargetPath(value) || !value.includes("node_modules/")) return false;
  const segments = value.split("/");
  let index = 0;
  while (index < segments.length) {
    if (segments[index] !== "node_modules") return false;
    index += 1;
    const next = segments[index];
    if (!next) return false;
    if (next.startsWith("@")) {
      const scoped = `${next}/${segments[index + 1] ?? ""}`;
      if (!isCanonicalNpmPackageName(scoped)) return false;
      index += 2;
    } else {
      if (!isCanonicalNpmPackageName(next)) return false;
      index += 1;
    }
  }
  return true;
}

function isCanonicalNpmRegistryTarball(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 2_048 || CONTROL_OR_BIDI_PATTERN.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.hostname === "registry.npmjs.org"
      && url.port === ""
      && url.username === ""
      && url.password === ""
      && url.search === ""
      && url.hash === "";
  } catch {
    return false;
  }
}

function isSha512Integrity(value) {
  if (typeof value !== "string" || !SHA512_INTEGRITY_PATTERN.test(value)) return false;
  const encoded = value.slice("sha512-".length);
  try {
    const bytes = Buffer.from(encoded, "base64");
    return bytes.length === 64 && bytes.toString("base64") === encoded;
  } catch {
    return false;
  }
}

function isExactObjectRecord(value) {
  return isPlainObject(value)
    && (value.mode === "100644" || value.mode === "100755")
    && GIT_OBJECT_PATTERN.test(value.objectId ?? "")
    && value.bytes instanceof Uint8Array;
}

function isLocalSpecifier(value) {
  return value === "." || value === ".." || value.startsWith("./") || value.startsWith("../");
}

function stripResourceSuffix(value) {
  if (typeof value !== "string" || value.length === 0 || CONTROL_OR_BIDI_PATTERN.test(value)) {
    invalid("companion resource specifier is invalid");
  }
  return value.split(/[?#]/u, 1)[0];
}

function isExternalResource(value) {
  const lower = value.toLowerCase();
  return lower.startsWith("data:")
    || lower.startsWith("http://")
    || lower.startsWith("https://")
    || value.startsWith("//")
    || value.startsWith("#")
    || lower.startsWith("mailto:")
    || lower.startsWith("tel:");
}

function isDeclarativeOrAssetPath(value) {
  return /\.(?:json|md|txt|ya?ml|toml|svg|png|jpe?g|webp|gif|ico|wasm|mp3|ogg|wav|mp4|webm|woff2?|ttf|otf)$/iu.test(value);
}

function decodeText(bytes, label) {
  try {
    return STRICT_UTF8.decode(bytes);
  } catch {
    invalid(`companion closure text is not UTF-8: ${label}`);
  }
}

function losslessInteger(value) {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (isPlainObject(value) && typeof value.source === "string" && /^(?:0|[1-9][0-9]*)$/u.test(value.source)) {
    const number = Number(value.source);
    return Number.isSafeInteger(number) ? number : null;
  }
  return null;
}

function assertExactKeys(value, expected, message) {
  const keys = Object.keys(value).sort(compareUtf8);
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) invalid(message);
}

function assertUniqueSorted(values, message) {
  for (let index = 1; index < values.length; index += 1) {
    if (values[index - 1] === values[index]) invalid(message);
  }
}

function isStrictlySorted(values) {
  for (let index = 1; index < values.length; index += 1) {
    if (compareUtf8(values[index - 1], values[index]) >= 0) return false;
  }
  return true;
}

function uniqueSorted(values) {
  return [...new Set(values)].sort(compareUtf8);
}

function boundedMessage(value) {
  const text = typeof value === "string" ? value : "invalid input";
  return text.length <= 240 ? text : `${text.slice(0, 237)}...`;
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function invalid(message) {
  throw new Error(message);
}
