import { keccak256, toBytes } from "viem";

const ALCHEMY_HOST = "eth-mainnet.g.alchemy.com";
const ALCHEMY_API_PATH = /^\/v2\/[A-Za-z0-9_-]{8,256}$/u;
const QUICKNODE_API_PATH = /^\/[A-Za-z0-9_-]{8,256}\/?$/u;
const QUICKNODE_HOST =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+quiknode\.pro$/u;
const DOMAINS = Object.freeze({
  endpoint: "programmable:data-pipeline:rpc-endpoint:v1\0",
  origin: "programmable:data-pipeline:rpc-origin:v1\0",
});
const HEX_BYTES32 = /^0x[0-9a-f]{64}$/u;
const PINNED_COMMITMENT_NAMES = Object.freeze({
  alchemy: "PROGRAMMABLE_ALCHEMY_MAINNET_RPC_ENDPOINT_COMMITMENT",
  quicknode: "PROGRAMMABLE_QUICKNODE_MAINNET_RPC_ENDPOINT_COMMITMENT",
});

function endpoint(value, provider) {
  if (typeof value !== "string" || value.length < 1 || value.length > 1_024) {
    throw new Error(`${provider} RPC URL is required`);
  }
  const parsed = new URL(value);
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.port !== "" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    (provider === "alchemy" &&
      (parsed.hostname !== ALCHEMY_HOST ||
        !ALCHEMY_API_PATH.test(parsed.pathname))) ||
    (provider === "quicknode" &&
      (!QUICKNODE_HOST.test(parsed.hostname) ||
        !QUICKNODE_API_PATH.test(parsed.pathname))) ||
    (provider === "alchemy" && parsed.pathname.slice("/v2/".length) === "docs-demo") ||
    (provider === "quicknode" &&
      parsed.pathname.replace(/^\//u, "").replace(/\/$/u, "") === "docs-demo")
  ) {
    throw new Error(`${provider} RPC URL is not an approved Mainnet endpoint`);
  }
  return parsed;
}

function classifyEndpoint(value) {
  for (const provider of ["alchemy", "quicknode"]) {
    try {
      return { provider, url: endpoint(value, provider) };
    } catch {
      // Try the other approved vendor. Error details never contain the URL.
    }
  }
  throw new Error("legacy RPC URL is not an approved Mainnet endpoint");
}

function optionalEndpoint(value, provider) {
  return value === undefined || value === ""
    ? undefined
    : endpoint(value, provider);
}

function selectedEndpoints(environment) {
  const selected = {
    alchemy: optionalEndpoint(
      environment.PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL,
      "alchemy",
    ),
    quicknode: optionalEndpoint(
      environment.PROGRAMMABLE_QUICKNODE_MAINNET_RPC_URL,
      "quicknode",
    ),
  };
  const fallback = { alchemy: new Map(), quicknode: new Map() };
  for (const value of [
    environment.ETHEREUM_RPC_URL,
    environment.ETHEREUM_RPC_URL_B,
  ]) {
    if (value === undefined || value === "") continue;
    const classified = classifyEndpoint(value);
    fallback[classified.provider].set(
      classified.url.toString(),
      classified.url,
    );
  }
  for (const provider of ["alchemy", "quicknode"]) {
    if (selected[provider]) continue;
    const candidates = [...fallback[provider].values()];
    if (candidates.length !== 1) {
      throw new Error(`one ${provider} Mainnet RPC endpoint is required`);
    }
    selected[provider] = candidates[0];
  }
  return selected;
}

function commitment(kind, value) {
  return keccak256(toBytes(`${DOMAINS[kind]}${value}`));
}

function bindingsFromCommitments(commitments) {
  if (commitments.alchemy === commitments.quicknode) {
    throw new Error("Alchemy and QuickNode commitments must differ");
  }
  return ["alchemy", "quicknode"].map((vendorGroup) => {
    const endpointCommitment = commitments[vendorGroup];
    return Object.freeze({
      vendorGroup,
      identity: `${vendorGroup}-mainnet-${endpointCommitment.slice(2, 34)}`,
      endpointCommitment,
    });
  });
}

export function runtimeProductionProviderBindingsFromUrls(environment) {
  const endpoints = selectedEndpoints(environment);
  if (endpoints.alchemy.origin === endpoints.quicknode.origin) {
    throw new Error("Alchemy and QuickNode must be independent endpoints");
  }
  return bindingsFromCommitments(
    Object.fromEntries(
      Object.entries(endpoints).map(([provider, url]) => [
        provider,
        commitment("endpoint", url.toString()),
      ]),
    ),
  );
}

export function expectedProductionProviderBindings(environment = process.env) {
  const pinned = Object.fromEntries(
    Object.entries(PINNED_COMMITMENT_NAMES).map(([provider, name]) => [
      provider,
      environment[name],
    ]),
  );
  const pinnedCount = Object.values(pinned).filter(
    (value) => value !== undefined && value !== "",
  ).length;
  if (pinnedCount !== 0 && pinnedCount !== 2) {
    throw new Error("both pinned provider commitments are required");
  }
  if (pinnedCount === 2) {
    for (const [provider, value] of Object.entries(pinned)) {
      if (!HEX_BYTES32.test(value)) {
        throw new Error(`${provider} provider commitment is invalid`);
      }
    }
    return bindingsFromCommitments(pinned);
  }
  return runtimeProductionProviderBindingsFromUrls(environment);
}
