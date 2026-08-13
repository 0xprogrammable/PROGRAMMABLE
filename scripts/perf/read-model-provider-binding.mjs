import { keccak256, toBytes } from "viem";

export const PRODUCTION_RPC_ENV = Object.freeze({
  primaryProvider: "PROGRAMMABLE_WEBSITE_MAINNET_RPC_PRIMARY_PROVIDER",
  primaryUrl: "PROGRAMMABLE_WEBSITE_MAINNET_RPC_PRIMARY_URL",
  primaryCommitment:
    "PROGRAMMABLE_WEBSITE_MAINNET_RPC_PRIMARY_ENDPOINT_COMMITMENT",
  secondaryProvider: "PROGRAMMABLE_WEBSITE_MAINNET_RPC_SECONDARY_PROVIDER",
  secondaryUrl: "PROGRAMMABLE_WEBSITE_MAINNET_RPC_SECONDARY_URL",
  secondaryCommitment:
    "PROGRAMMABLE_WEBSITE_MAINNET_RPC_SECONDARY_ENDPOINT_COMMITMENT",
});

const DRPC_HOST = "lb.drpc.live";
const DRPC_PATH = /^\/ethereum\/[A-Za-z0-9_-]{8,512}\/?$/u;
const QUICKNODE_HOST =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.ethereum-mainnet\.quiknode\.pro$/u;
const QUICKNODE_PATH = /^\/[A-Za-z0-9_-]{8,256}\/?$/u;
const HEX_BYTES32 = /^0x[0-9a-f]{64}$/u;
const ENDPOINT_DOMAIN = "programmable:data-pipeline:rpc-endpoint:v1\0";

function endpoint(value, provider) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 1_024 ||
    value !== value.trim()
  ) {
    throw new Error(`${provider} RPC URL is required`);
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${provider} RPC URL is not an approved Mainnet endpoint`);
  }
  const pathValid = provider === "drpc"
    ? parsed.hostname === DRPC_HOST && DRPC_PATH.test(parsed.pathname)
    : QUICKNODE_HOST.test(parsed.hostname) && QUICKNODE_PATH.test(parsed.pathname);
  const credential = provider === "drpc"
    ? parsed.pathname.replace(/^\/ethereum\//u, "").replace(/\/$/u, "")
    : parsed.pathname.replace(/^\//u, "").replace(/\/$/u, "");
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.port !== "" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    !pathValid ||
    credential === "docs-demo"
  ) {
    throw new Error(`${provider} RPC URL is not an approved Mainnet endpoint`);
  }
  return parsed;
}

function endpointCommitment(value) {
  return keccak256(toBytes(`${ENDPOINT_DOMAIN}${value}`));
}

function configuredPair(environment) {
  if (
    environment[PRODUCTION_RPC_ENV.primaryProvider] !== "drpc" ||
    environment[PRODUCTION_RPC_ENV.secondaryProvider] !== "quicknode"
  ) {
    throw new Error("production RPC provider roles are invalid");
  }
  const primary = endpoint(
    environment[PRODUCTION_RPC_ENV.primaryUrl],
    "drpc",
  );
  const secondary = endpoint(
    environment[PRODUCTION_RPC_ENV.secondaryUrl],
    "quicknode",
  );
  if (primary.origin === secondary.origin || primary.toString() === secondary.toString()) {
    throw new Error("dRPC and QuickNode must be independent endpoints");
  }
  return Object.freeze({ primary, secondary });
}

function binding(role, vendorGroup, url, pinnedCommitment) {
  const commitment = endpointCommitment(url.toString());
  if (
    pinnedCommitment !== undefined &&
    pinnedCommitment !== "" &&
    (!HEX_BYTES32.test(pinnedCommitment) || pinnedCommitment !== commitment)
  ) {
    throw new Error(`${role} provider commitment is invalid`);
  }
  return Object.freeze({
    role,
    vendorGroup,
    identity: `${vendorGroup}-mainnet-${commitment.slice(2, 34)}`,
    endpointCommitment: commitment,
  });
}

export function runtimeProductionProviderBindingsFromUrls(environment) {
  const pair = configuredPair(environment);
  return Object.freeze([
    binding(
      "primary",
      "drpc",
      pair.primary,
      environment[PRODUCTION_RPC_ENV.primaryCommitment],
    ),
    binding(
      "secondary",
      "quicknode",
      pair.secondary,
      environment[PRODUCTION_RPC_ENV.secondaryCommitment],
    ),
  ]);
}

/**
 * Returns the already validated private endpoints for bounded release probes.
 * Callers must not serialize, log or persist this result.
 */
export function runtimeProductionProviderEndpoints(environment) {
  const pair = configuredPair(environment);
  runtimeProductionProviderBindingsFromUrls(environment);
  return Object.freeze([pair.primary.toString(), pair.secondary.toString()]);
}

export function expectedProductionProviderBindings(environment = process.env) {
  const pinned = [
    ["primary", "drpc", environment[PRODUCTION_RPC_ENV.primaryCommitment]],
    ["secondary", "quicknode", environment[PRODUCTION_RPC_ENV.secondaryCommitment]],
  ];
  if (pinned.every(([, , value]) => typeof value === "string" && HEX_BYTES32.test(value))) {
    if (pinned[0][2] === pinned[1][2]) {
      throw new Error("dRPC and QuickNode commitments must differ");
    }
    return Object.freeze(pinned.map(([role, vendorGroup, endpointCommitment]) =>
      Object.freeze({
        role,
        vendorGroup,
        identity: `${vendorGroup}-mainnet-${endpointCommitment.slice(2, 34)}`,
        endpointCommitment,
      })
    ));
  }
  if (pinned.some(([, , value]) => value !== undefined && value !== "")) {
    throw new Error("both pinned provider commitments are required");
  }
  return runtimeProductionProviderBindingsFromUrls(environment);
}
