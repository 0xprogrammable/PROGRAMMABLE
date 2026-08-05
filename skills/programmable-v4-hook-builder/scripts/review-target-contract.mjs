const CONTROL_OR_BIDI_PATTERN = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u;
const ENCODED_SEPARATOR_PATTERN = /%2f|%5c/iu;
const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[a-z]:\//iu;
const SOLIDITY_SOURCE_EXTENSION = /\.sol$/iu;

export const REVIEW_TARGET_CONTRACT_V1 = Object.freeze({
  maximumFiles: 512,
  maximumFileBytes: 2_000_000,
  maximumTotalBytes: 20_000_000,
  maximumPathDepth: 24,
  maximumPathBytes: 1_024,
  maximumImportResolutions: 8_192,
  maximumClosureDiagnostics: 512,
  maximumClosureDiagnosticDetailBytes: 500
});

export const REVIEW_TARGET_CLOSURE_METHOD_V1 =
  "declared-bytes-and-resolved-solidity-and-javascript-imports-v9";

export const REVIEW_TARGET_CLOSURE_DIAGNOSTIC_CODES = Object.freeze([
  "COMPANION_CLOSURE_REVIEW_REQUIRED",
  "DECLARED_FILE_SEMANTIC_CLOSURE_UNAVAILABLE",
  "JAVASCRIPT_ALIAS_RESOLUTION_UNPROVEN",
  "JAVASCRIPT_DYNAMIC_IMPORT_UNPROVEN",
  "JAVASCRIPT_IMPORT_META_GLOB_UNPROVEN",
  "JAVASCRIPT_PACKAGE_DEPENDENCY_UNBOUND",
  "JAVASCRIPT_RUNTIME_LOADER_UNPROVEN",
  "JAVASCRIPT_SYNTAX_CLOSURE_UNPROVEN",
  "SOLIDITY_BUILD_PROFILE_REVIEW_REQUIRED",
  "SOLIDITY_IMPORT_RESOLUTION_UNPROVEN"
]);

const closureDiagnosticCodes = new Set(REVIEW_TARGET_CLOSURE_DIAGNOSTIC_CODES);

export function isCanonicalReviewTargetPath(value) {
  if (
    typeof value !== "string"
    || value.length === 0
    || Buffer.byteLength(value, "utf8") > REVIEW_TARGET_CONTRACT_V1.maximumPathBytes
    || value.normalize("NFC") !== value
    || hasUnpairedSurrogate(value)
    || value.startsWith("/")
    || WINDOWS_ABSOLUTE_PATH_PATTERN.test(value)
    || value.endsWith("/")
    || value.includes("\\")
    || CONTROL_OR_BIDI_PATTERN.test(value)
    || ENCODED_SEPARATOR_PATTERN.test(value)
  ) {
    return false;
  }
  const segments = value.split("/");
  return segments.length <= REVIEW_TARGET_CONTRACT_V1.maximumPathDepth
    && segments.every((segment) => (
      segment.length > 0
      && segment !== "."
      && segment !== ".."
      && segment.toLowerCase() !== ".git"
    ));
}

export function isClosedReviewTargetClosure(value) {
  if (!isPlainObject(value) || !hasExactKeys(value, ["diagnostics", "status"])) return false;
  if (!new Set(["complete", "incomplete"]).has(value.status)) return false;
  if (
    !Array.isArray(value.diagnostics)
    || value.diagnostics.length > REVIEW_TARGET_CONTRACT_V1.maximumClosureDiagnostics
    || (value.status === "complete") !== (value.diagnostics.length === 0)
  ) return false;

  let previousKey = null;
  for (const diagnostic of value.diagnostics) {
    if (!isPlainObject(diagnostic) || !hasExactKeys(diagnostic, ["code", "detail", "path"])) return false;
    if (!closureDiagnosticCodes.has(diagnostic.code)) return false;
    if (!isCanonicalReviewTargetPath(diagnostic.path)) return false;
    if (
      typeof diagnostic.detail !== "string"
      || diagnostic.detail.length === 0
      || Buffer.byteLength(diagnostic.detail, "utf8") > REVIEW_TARGET_CONTRACT_V1.maximumClosureDiagnosticDetailBytes
      || diagnostic.detail.normalize("NFC") !== diagnostic.detail
      || hasUnpairedSurrogate(diagnostic.detail)
      || CONTROL_OR_BIDI_PATTERN.test(diagnostic.detail)
    ) return false;
    const key = `${diagnostic.code}\0${diagnostic.path}\0${diagnostic.detail}`;
    if (previousKey !== null && compareUtf8(previousKey, key) >= 0) return false;
    previousKey = key;
  }
  return true;
}

export function declaredSourceAndTestPaths(submission) {
  const implementation = submission?.implementation ?? {};
  const customExecution = submission?.hook?.customExecution ?? {};
  const integration = submission?.integration ?? {};
  const routing = integration.routingAndDiscoverability ?? {};
  const reconstruction = integration.dataReconstruction ?? {};
  const handoff = integration.platformHandoff ?? {};
  const paths = [
    ...arrayValues(implementation.sourcePaths),
    ...arrayValues(implementation.testPaths),
    ...arrayValues(customExecution.moduleSourcePaths),
    ...arrayValues(integration.appSourcePaths),
    ...arrayValues(integration.integrationTestPaths),
    ...arrayValues(routing.sourcePaths),
    ...arrayValues(routing.testPaths),
    ...arrayValues(reconstruction.sourcePaths),
    ...arrayValues(reconstruction.testPaths),
    handoff.websiteRegistryPath,
    ...arrayValues(handoff.uiSourcePaths),
    ...arrayValues(handoff.apiSourcePaths),
    ...arrayValues(handoff.indexerSourcePaths),
    ...arrayValues(handoff.testPaths),
    ...arrayValues(submission?.capabilityExtensions).flatMap((extension) => [
      ...arrayValues(extension?.sourcePaths),
      ...arrayValues(extension?.testPaths)
    ])
  ].filter((entry) => typeof entry === "string" && entry.length > 0);
  return [...new Set(paths)].sort(compareUtf8);
}

export function declaredSoliditySourceAndTestPaths(submission) {
  return declaredSourceAndTestPaths(submission).filter((entry) => SOLIDITY_SOURCE_EXTENSION.test(entry));
}

export function isSourceOrTestReviewKind(kind) {
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
    || kind === "custom-execution-module-source"
    || kind?.startsWith("capability-source:")
    || kind?.startsWith("capability-test:")
    || kind?.startsWith("solidity-")
    || kind?.startsWith("javascript-");
}

export function isGitLfsPointer(contents) {
  if (!(contents instanceof Uint8Array) || contents.byteLength < 42 || contents.byteLength > 4_096) {
    return false;
  }
  const prefix = Buffer.from(contents).subarray(0, 128).toString("utf8");
  return /^(?:\uFEFF)?version https:\/\/git-lfs\.github\.com\/spec\/v1(?:\r?\n|$)/u.test(prefix);
}

function hasUnpairedSurrogate(value) {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint >= 0xd800 && codePoint <= 0xdfff) return true;
  }
  return false;
}

function arrayValues(value) {
  return Array.isArray(value) ? value : [];
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, expected) {
  const keys = Object.keys(value).sort(compareUtf8);
  return keys.length === expected.length
    && keys.every((key, index) => key === expected[index]);
}
