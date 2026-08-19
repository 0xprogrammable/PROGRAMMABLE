export const ACTIVE_CONTRACT_MANIFEST_V1 = Object.freeze({
  schema: "urn:programmable:active-contract-manifest:1.0.0",
  schemaVersion: "1.0.0",
  kind: "programmable-active-contract",
  roles: Object.freeze(["workflow", "validator", "package", "policy"]),
  maximumArtifactsPerRole: 4,
  maximumArtifacts: 16
});

export const RESOLVE_CONTRACT_V1 = Object.freeze({
  schemaVersion: "1.0.0",
  kind: "programmable-active-contract-resolution",
  defaultTimeoutMs: 10_000,
  minimumTimeoutMs: 10,
  maximumTimeoutMs: 30_000,
  maximumRequests: 24,
  maximumResponseBytes: 67_108_864,
  maximumTreeResponseBytes: 8_388_608,
  maximumJsonResponseBytes: 1_048_576,
  maximumArtifactBytes: 2_097_152,
  maximumManifestBytes: 65_536,
  manifestCandidates: Object.freeze([
    ".programmable/active-contract.json",
    ".github/programmable-active-contract.json",
    "contracts/programmable-active-contract.json"
  ]),
  conventionCandidates: Object.freeze({
    workflow: Object.freeze([
      ".github/workflows/verify-hook-builder.yml",
      ".github/workflows/verify-hook-builder.yaml",
      ".github/workflows/intake.yml",
      ".github/workflows/intake.yaml",
      ".github/workflows/verify.yml",
      ".github/workflows/verify.yaml"
    ]),
    validator: Object.freeze([
      "scripts/verify-public-hook-application.mjs",
      "scripts/verify-public-hook-application-core.mjs",
      "scripts/verify-application.mjs",
      "scripts/validate-application.mjs"
    ]),
    package: Object.freeze([
      "contracts/public-pr-application-v3/3.0.0/contract.json",
      "contracts/public-pr-application-v3/3.0.0/schema.json",
      "contracts/registry-acceptance-v3/3.0.0/schema.json",
      "vendor/programmable-v4-hook-builder-v3-snapshot/references/public-pr-application-v3.schema.json",
      "vendor/programmable-v4-hook-builder/references/public-pr-application.schema.json",
      "references/public-pr-application-v3.schema.json",
      "references/public-pr-application.schema.json"
    ]),
    policy: Object.freeze([
      "references/approval-criteria.md",
      "references/programmable-fee-policy-v2.md",
      "vendor/programmable-v4-hook-builder-v3-snapshot/references/programmable-fee-policy-v2.md",
      "vendor/programmable-v4-hook-builder-v3-snapshot/references/programmable-fee-policy.md",
      "vendor/programmable-v4-hook-builder/references/programmable-fee-policy.md",
      "docs/builder/PUBLIC_GITHUB_PR_BETA.md"
    ])
  })
});

export const LOWER_HEX_40 = /^[0-9a-f]{40}$/u;
export const SHA256 = /^sha256:[0-9a-f]{64}$/u;
export const CONTRACT_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
export const OWNER = /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/u;
export const REPOSITORY = /^[a-z0-9._-]{1,100}$/u;
export const OPAQUE_DECIMAL = /^(?:0|[1-9][0-9]{0,63})$/u;
export const REGULAR_BLOB_MODES = new Set(["100644", "100755"]);

export class ContractResolutionError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = "ContractResolutionError";
    this.code = code;
    this.kind = options.kind ?? "resolution";
    this.retryable = options.retryable === true;
    this.status = options.status ?? null;
    this.retryAfterSeconds = options.retryAfterSeconds ?? null;
  }
}
