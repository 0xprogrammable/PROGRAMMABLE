export const PROGRAMMABLE_DEVELOPER_ORIGIN =
  "https://developers.programmable.family";
export const PROGRAMMABLE_DEVELOPER_REPOSITORY =
  "https://github.com/0xprogrammable/developers";

export const PROGRAMMABLE_PLATFORM_ID = "programmable";
export const PROGRAMMABLE_ACTIVE_API_VERSION = "2";
export const PROGRAMMABLE_COMPAT_API_VERSION = "1";

export const PROGRAMMABLE_LABELS = {
  classic: "Programmable Classic",
  custom: "Programmable Custom",
} as const;

export const PROGRAMMABLE_VERIFIED_DEFINITION =
  "Reviewed against the published Programmable security policy and cryptographically bound to the exact deployed contract revision.";

export const PROGRAMMABLE_FEE_RECIPIENT =
  "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c";

export const PROGRAMMABLE_FINALITY_STATES = [
  "observed",
  "confirmed",
  "finalized",
  "orphaned",
] as const;

export const PROGRAMMABLE_RUNTIME_HASH_SEAM = {
  keccakAlgorithm: "keccak256(runtime bytecode)",
  keccakField: "runtimeCodeKeccak256",
  keccakFormat: "0x-prefixed bytes32",
  sha256Field: "runtimeCodeSha256",
  sha256Format: "sha256:",
} as const;

export const PROGRAMMABLE_FEE_POLICY = {
  nativeCustom: {
    chargeMode: "official market path only",
    programmableShareBps: 10,
    totalBps: 10,
  },
  partnerTemplate: {
    applicability: "active fee-bearing partner-template market path",
    attributionIndependent: true,
    chargeMode: "template enforced",
    noQualifyingMarket: {
      partnerShareBps: 0,
      programmableShareBps: 0,
      status: "no-qualifying-market",
      totalBps: 0,
    },
    partnerShareBps: 15,
    programmableShareBps: 5,
    totalBps: 20,
  },
} as const;

export const PROGRAMMABLE_ENDPOINTS = [
  {
    path: "/.well-known/programmable.json",
    href: "/.well-known/programmable.json",
    label: "Discover the interface",
    note: "Read the active API version, chains and canonical resource URLs.",
  },
  {
    path: "/api/v2/status",
    href: "/api/v2/status",
    label: "Check feed health",
    note: "Read service health, coverage, freshness and finality before ingestion.",
  },
  {
    path: "/api/v2/manifest",
    href: "/api/v2/manifest",
    label: "Resolve deployments",
    note: "Read source addresses, start blocks, generations and compatibility.",
  },
  {
    path: "/api/v2/launches",
    href: "/api/v2/launches",
    label: "Ingest launches",
    note: "Backfill and poll paginated Classic and Custom records.",
  },
  {
    path: "/api/v2/launches/{launchId}",
    href: "/api/v2/launches/eip155:1:0xf5e25accf0e4d58b01b56eaacd427b68fbe4daa3",
    label: "Fetch one launch",
    note: "Resolve any launch, including project-only and multi-asset records.",
  },
  {
    path: "/api/v2/launches/{chainId}/{tokenAddress}",
    href: "/api/v2/launches/1/0x56a96463ead0c0b9b4e4df9e41805bb8877074a6",
    label: "Fetch one token",
    note: "Resolve one token record by chain and contract address.",
  },
  {
    path: "/api/v2/token-list",
    href: "/api/v2/token-list",
    label: "Read the token list",
    note: "Use the finalized token projection for wallet compatibility.",
  },
] as const;

export const PROGRAMMABLE_ACTIVE_API_BASE = `${PROGRAMMABLE_DEVELOPER_ORIGIN}/api/v${PROGRAMMABLE_ACTIVE_API_VERSION}`;
export const PROGRAMMABLE_COMPAT_API_BASE = `${PROGRAMMABLE_DEVELOPER_ORIGIN}/api/v${PROGRAMMABLE_COMPAT_API_VERSION}`;
export const PROGRAMMABLE_WELL_KNOWN_URL = `${PROGRAMMABLE_DEVELOPER_ORIGIN}/.well-known/programmable.json`;
export const PROGRAMMABLE_OPENAPI_URL = `${PROGRAMMABLE_DEVELOPER_ORIGIN}/openapi/programmable-v${PROGRAMMABLE_ACTIVE_API_VERSION}.yaml`;
export const PROGRAMMABLE_SCHEMA_BASE_URL = `${PROGRAMMABLE_DEVELOPER_ORIGIN}/schemas/v${PROGRAMMABLE_ACTIVE_API_VERSION}/`;
