import {
  ACTIVE_CONTRACT_MANIFEST_V1,
  CONTRACT_ID,
  OWNER,
  REPOSITORY,
  SHA256
} from "./resolve-contract-definitions.mjs";
import {
  assertExactKeys,
  deepFreeze,
  isPlainObject,
  normalizeDefaultBranch,
  normalizeRemotePath,
  unsafeText
} from "./resolve-contract-shared.mjs";

export function normalizeContractRepositoryV1(value) {
  if (typeof value !== "string" || unsafeText(value)) {
    throw new TypeError("repository must be an owner/name slug or canonical public GitHub URL");
  }
  let slug = value;
  if (value.startsWith("https://")) {
    let url;
    try {
      url = new URL(value);
    } catch {
      throw new TypeError("repository must be an owner/name slug or canonical public GitHub URL");
    }
    const segments = url.pathname.split("/").filter(Boolean);
    if (
      url.protocol !== "https:"
      || url.hostname.toLowerCase() !== "github.com"
      || url.port !== ""
      || url.username !== ""
      || url.password !== ""
      || url.search !== ""
      || url.hash !== ""
      || segments.length !== 2
    ) {
      throw new TypeError("repository must be an owner/name slug or canonical public GitHub URL");
    }
    slug = segments.join("/");
  }
  const segments = slug.split("/");
  const owner = segments[0]?.toLowerCase();
  const repository = segments[1]?.toLowerCase();
  if (
    segments.length !== 2
    || !OWNER.test(owner ?? "")
    || owner.includes("--")
    || !REPOSITORY.test(repository ?? "")
    || repository === "."
    || repository === ".."
    || repository.endsWith(".git")
    || !/[a-z0-9]/u.test(repository)
  ) {
    throw new TypeError("repository must be an owner/name slug or canonical public GitHub URL");
  }
  return Object.freeze({
    owner,
    repository,
    slug: `${owner}/${repository}`,
    repositoryUri: `https://github.com/${owner}/${repository}`
  });
}

export function validateActiveContractManifestV1(value, { defaultBranch } = {}) {
  if (!isPlainObject(value)) throw new TypeError("active contract manifest must be an object");
  assertExactKeys(
    value,
    ["$schema", "schemaVersion", "kind", "contractId", "defaultBranch", "artifacts"],
    "active contract manifest"
  );
  if (value.$schema !== ACTIVE_CONTRACT_MANIFEST_V1.schema) {
    throw new TypeError("active contract manifest $schema is unsupported");
  }
  if (value.schemaVersion !== ACTIVE_CONTRACT_MANIFEST_V1.schemaVersion) {
    throw new TypeError("active contract manifest schemaVersion is unsupported");
  }
  if (value.kind !== ACTIVE_CONTRACT_MANIFEST_V1.kind) {
    throw new TypeError("active contract manifest kind is unsupported");
  }
  if (!CONTRACT_ID.test(value.contractId ?? "") || value.contractId.length > 128) {
    throw new TypeError("active contract manifest contractId must be a bounded lowercase slug");
  }
  const normalizedBranch = normalizeDefaultBranch(value.defaultBranch);
  if (defaultBranch !== undefined && normalizedBranch !== defaultBranch) {
    throw new TypeError("active contract manifest defaultBranch does not match the repository default branch");
  }
  if (!isPlainObject(value.artifacts)) throw new TypeError("active contract manifest artifacts must be an object");
  assertExactKeys(value.artifacts, ACTIVE_CONTRACT_MANIFEST_V1.roles, "active contract manifest artifacts");

  const paths = new Set();
  let artifactCount = 0;
  const artifacts = {};
  for (const role of ACTIVE_CONTRACT_MANIFEST_V1.roles) {
    const records = value.artifacts[role];
    if (
      !Array.isArray(records)
      || records.length === 0
      || records.length > ACTIVE_CONTRACT_MANIFEST_V1.maximumArtifactsPerRole
    ) {
      throw new TypeError(`active contract manifest ${role} must contain between one and four artifacts`);
    }
    artifacts[role] = records.map((record, index) => {
      if (!isPlainObject(record)) throw new TypeError(`active contract manifest ${role}[${index}] must be an object`);
      assertExactKeys(record, ["path", "sha256"], `active contract manifest ${role}[${index}]`);
      const artifactPath = normalizeRemotePath(record.path, `${role}[${index}].path`);
      if (paths.has(artifactPath)) throw new TypeError("active contract manifest artifact paths must be unique");
      paths.add(artifactPath);
      if (!SHA256.test(record.sha256 ?? "")) {
        throw new TypeError(`active contract manifest ${role}[${index}].sha256 is invalid`);
      }
      artifactCount += 1;
      return Object.freeze({ path: artifactPath, sha256: record.sha256 });
    });
    Object.freeze(artifacts[role]);
  }
  if (artifactCount > ACTIVE_CONTRACT_MANIFEST_V1.maximumArtifacts) {
    throw new TypeError("active contract manifest contains too many artifacts");
  }
  return deepFreeze({
    $schema: value.$schema,
    schemaVersion: value.schemaVersion,
    kind: value.kind,
    contractId: value.contractId,
    defaultBranch: normalizedBranch,
    artifacts
  });
}
