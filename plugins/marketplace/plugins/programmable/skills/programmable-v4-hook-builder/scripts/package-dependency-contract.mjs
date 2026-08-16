const CONTROL_OR_BIDI_PATTERN = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u;
const COMMIT_PATTERN = /^[0-9a-fA-F]{40}$/u;

export const NPM_PACKAGE_NAME_PATTERN_SOURCE = "^(?:@(?!\\.{1,2}/)[a-z0-9._~-]+/(?!\\.{1,2}$)[a-z0-9._~-]+|[a-z0-9~-][a-z0-9._~-]*)$";
export const EXACT_PACKAGE_VERSION_PATTERN_SOURCE = "^[0-9]+\\.[0-9]+\\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\\+[0-9A-Za-z.-]+)?$";
export const SHA512_INTEGRITY_PATTERN_SOURCE = "^sha512-[A-Za-z0-9+/]+={0,2}$";
export const OFFICIAL_UNISWAP_SDK_REPOSITORY = "https://github.com/Uniswap/sdks.git";
export const EXTERNAL_PACKAGE_SOURCE_CLASS = "external-package-local";
export const EXTERNAL_PACKAGE_EVIDENCE_STATE = "builder-declared-local-package-bytes";
export const OFFICIAL_UNISWAP_SDK_PACKAGES = Object.freeze([
  "@uniswap/permit2-sdk",
  "@uniswap/router-sdk",
  "@uniswap/sdk-core",
  "@uniswap/universal-router-sdk",
  "@uniswap/v4-sdk"
]);
const officialUniswapSdkPackages = new Set(OFFICIAL_UNISWAP_SDK_PACKAGES);

const npmPackageNamePattern = new RegExp(NPM_PACKAGE_NAME_PATTERN_SOURCE, "u");
const exactPackageVersionPattern = new RegExp(EXACT_PACKAGE_VERSION_PATTERN_SOURCE, "u");
const sha512IntegrityPattern = new RegExp(SHA512_INTEGRITY_PATTERN_SOURCE, "u");

export function isCanonicalNpmPackageName(value) {
  if (!(typeof value === "string"
    && value.length > 0
    && Buffer.byteLength(value, "utf8") <= 214
    && value.normalize("NFC") === value
    && npmPackageNamePattern.test(value))) return false;
  const segments = value.startsWith("@") ? value.slice(1).split("/") : [value];
  return segments.every((segment) => segment !== "." && segment !== "..");
}

export function isExactPackageDependency(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (!isCanonicalNpmPackageName(value.packageName)) return false;
  if (typeof value.version !== "string" || !exactPackageVersionPattern.test(value.version)) return false;
  if (typeof value.integrity !== "string" || !sha512IntegrityPattern.test(value.integrity)) return false;

  const repositoryIsNull = value.repository === null;
  const revisionIsNull = value.revision === null;
  if (repositoryIsNull !== revisionIsNull) return false;
  if (!repositoryIsNull) {
    if (!isCanonicalHttpsRepository(value.repository) || !COMMIT_PATTERN.test(value.revision ?? "")) return false;
  }

  return !isOfficialUniswapSdkPackage(value.packageName)
    || (value.repository === OFFICIAL_UNISWAP_SDK_REPOSITORY && COMMIT_PATTERN.test(value.revision ?? ""));
}

export function isOfficialUniswapSdkPackage(packageName) {
  return officialUniswapSdkPackages.has(packageName);
}

export function isExactDeclaredPackageSpecifier(specifier, packageName) {
  if (typeof specifier !== "string" || !isCanonicalNpmPackageName(packageName)) return false;
  if (specifier === packageName) return true;
  if (packageName === "@uniswap/v4-sdk") return false;
  if (!specifier.startsWith(`${packageName}/`)) return false;
  const subpath = specifier.slice(packageName.length + 1);
  if (
    subpath.length === 0
    || subpath.includes("\\")
    || subpath.includes("?")
    || subpath.includes("#")
    || subpath.includes("%")
    || CONTROL_OR_BIDI_PATTERN.test(subpath)
  ) return false;
  return subpath.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

export function packageRootPath(packageName) {
  if (!isCanonicalNpmPackageName(packageName)) return null;
  return `node_modules/${packageName}`;
}

export function isExactPackageFilePath(repositoryPath, packageName) {
  const root = packageRootPath(packageName);
  if (root === null || typeof repositoryPath !== "string" || !repositoryPath.startsWith(`${root}/`)) return false;
  const subpath = repositoryPath.slice(root.length + 1);
  return subpath.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

export function buildExternalPackageBinding(dependency) {
  if (!isExactPackageDependency(dependency)) throw new Error("external package dependency is not exactly bound");
  return {
    packageName: dependency.packageName,
    version: dependency.version,
    integrity: dependency.integrity,
    repository: dependency.repository,
    revision: dependency.revision,
    evidenceState: EXTERNAL_PACKAGE_EVIDENCE_STATE,
    integrityVerified: false,
    centralSourceVerified: false
  };
}

export function isExternalPackageReviewRecord(record) {
  if (
    !record
    || typeof record !== "object"
    || record.sourceClass !== EXTERNAL_PACKAGE_SOURCE_CLASS
    || record.kind !== "solidity-package-dependency-import"
    || !record.packageDependency
    || record.packageDependency.evidenceState !== EXTERNAL_PACKAGE_EVIDENCE_STATE
    || record.packageDependency.integrityVerified !== false
    || record.packageDependency.centralSourceVerified !== false
  ) return false;
  const dependency = {
    packageName: record.packageDependency.packageName,
    version: record.packageDependency.version,
    integrity: record.packageDependency.integrity,
    repository: record.packageDependency.repository,
    revision: record.packageDependency.revision
  };
  return isExactPackageDependency(dependency)
    && isExactPackageFilePath(record.path, dependency.packageName);
}

function isCanonicalHttpsRepository(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 2_048 || CONTROL_OR_BIDI_PATTERN.test(value)) {
    return false;
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.hostname.length > 0
      && url.username === ""
      && url.password === ""
      && url.search === ""
      && url.hash === "";
  } catch {
    return false;
  }
}
