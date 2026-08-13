import "server-only";

import type { Hex } from "viem";

import { rpcProviderCommitment } from "../data-pipeline/rpc-provider-commitments";

type Environment = Readonly<Record<string, string | undefined>>;
type SupportedChainId = 1 | 11_155_111;
type ActionRpcVendor =
  | "alchemy"
  | "quicknode"
  | "infura"
  | "drpc"
  | "publicnode"
  | "mevblocker"
  | "sepolia-org"
  | "blastapi"
  | "ankr";

export type ActionRpcProvider = Readonly<{
  /** Server-only transport value. Deliberately non-enumerable at runtime. */
  endpoint: string;
  identity: string;
  vendorGroup: ActionRpcVendor;
  endpointCommitment: Hex;
  endpointOriginCommitment: Hex;
}>;

type QuorumInput = Readonly<{
  chainId: SupportedChainId;
  primary: string | null | undefined;
  secondary?: string | null | undefined;
  fallbacks?: readonly string[];
  maximumProviders?: number;
}>;

export class ActionRpcQuorumError extends Error {
  readonly code:
    | "invalid-provider"
    | "provider-not-independent"
    | "quorum-unavailable";

  constructor(
    code: ActionRpcQuorumError["code"],
    message = "Independent Ethereum RPC providers are unavailable",
  ) {
    super(message);
    this.name = "ActionRpcQuorumError";
    this.code = code;
  }

  toJSON() {
    return { name: this.name, code: this.code };
  }
}

const CREDENTIAL = /^[A-Za-z0-9_-]{8,256}$/u;
const QUICKNODE_HOST =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.ethereum-mainnet\.quiknode\.pro$/u;
const BLAST_API_HOST =
  /^(?:eth-mainnet|eth-sepolia)(?:\.public)?\.blastapi\.io$/u;

function hasOnlySearchParameters(value: URL, allowed: readonly string[]) {
  return [...value.searchParams.keys()].every((key) => allowed.includes(key));
}

function paidDrpcMatches(value: URL, chainId: SupportedChainId) {
  if (
    chainId === 1 &&
    value.hostname === "lb.drpc.live" &&
    /^\/ethereum\/[A-Za-z0-9_-]{8,512}\/?$/u.test(value.pathname) &&
    value.search === ""
  ) {
    return true;
  }
  if (
    value.hostname !== "lb.drpc.org" ||
    value.pathname !== "/ogrpc" ||
    !hasOnlySearchParameters(value, ["network", "dkey"]) ||
    value.searchParams.size !== 2
  ) {
    return false;
  }
  const expectedNetwork = chainId === 1 ? "ethereum" : "sepolia";
  const key = value.searchParams.get("dkey") ?? "";
  return (
    value.searchParams.get("network") === expectedNetwork &&
    CREDENTIAL.test(key)
  );
}

function providerVendor(
  value: URL,
  chainId: SupportedChainId,
): ActionRpcVendor | null {
  const noQuery = value.search === "";
  const rootPath = value.pathname === "/";
  const expectedAlchemyHost =
    chainId === 1
      ? "eth-mainnet.g.alchemy.com"
      : "eth-sepolia.g.alchemy.com";
  if (
    value.hostname === expectedAlchemyHost &&
    noQuery &&
    /^\/v2\/[A-Za-z0-9_-]{8,256}$/u.test(value.pathname)
  ) {
    return "alchemy";
  }
  if (
    QUICKNODE_HOST.test(value.hostname) &&
    noQuery &&
    /^\/[A-Za-z0-9_-]{8,256}\/?$/u.test(value.pathname)
  ) {
    return "quicknode";
  }
  const expectedInfuraHost =
    chainId === 1 ? "mainnet.infura.io" : "sepolia.infura.io";
  if (
    value.hostname === expectedInfuraHost &&
    noQuery &&
    /^\/v3\/[A-Za-z0-9_-]{8,256}$/u.test(value.pathname)
  ) {
    return "infura";
  }
  const expectedDrpcHost = chainId === 1 ? "eth.drpc.org" : "sepolia.drpc.org";
  if (
    (value.hostname === expectedDrpcHost && rootPath && noQuery) ||
    paidDrpcMatches(value, chainId)
  ) {
    return "drpc";
  }
  const expectedPublicnodeHost =
    chainId === 1
      ? "ethereum-rpc.publicnode.com"
      : "ethereum-sepolia-rpc.publicnode.com";
  if (value.hostname === expectedPublicnodeHost && rootPath && noQuery) {
    return "publicnode";
  }
  if (
    chainId === 1 &&
    value.hostname === "rpc.mevblocker.io" &&
    rootPath &&
    noQuery
  ) {
    return "mevblocker";
  }
  if (
    chainId === 11_155_111 &&
    value.hostname === "rpc.sepolia.org" &&
    rootPath &&
    noQuery
  ) {
    return "sepolia-org";
  }
  if (
    BLAST_API_HOST.test(value.hostname) &&
    value.hostname.startsWith(chainId === 1 ? "eth-mainnet" : "eth-sepolia") &&
    noQuery &&
    (rootPath || /^\/[A-Za-z0-9_-]{8,256}\/?$/u.test(value.pathname))
  ) {
    return "blastapi";
  }
  const expectedAnkrPath = chainId === 1 ? "eth" : "eth_sepolia";
  if (
    value.hostname === "rpc.ankr.com" &&
    noQuery &&
    new RegExp(
      `^/${expectedAnkrPath}(?:/[A-Za-z0-9_-]{8,256})?/?$`,
      "u",
    ).test(value.pathname)
  ) {
    return "ankr";
  }
  return null;
}

function parseProvider(
  endpoint: string | null | undefined,
  chainId: SupportedChainId,
): ActionRpcProvider {
  if (typeof endpoint !== "string" || endpoint.length < 1 || endpoint.length > 1_024) {
    throw new ActionRpcQuorumError("invalid-provider");
  }
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new ActionRpcQuorumError("invalid-provider");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.port !== "" ||
    parsed.hash !== ""
  ) {
    throw new ActionRpcQuorumError("invalid-provider");
  }
  const vendorGroup = providerVendor(parsed, chainId);
  if (!vendorGroup) {
    throw new ActionRpcQuorumError("invalid-provider");
  }

  const canonicalEndpoint = parsed.toString();
  const endpointCommitment = rpcProviderCommitment(
    "endpoint",
    canonicalEndpoint,
  );
  const endpointOriginCommitment = rpcProviderCommitment(
    "origin",
    parsed.origin.toLowerCase(),
  );
  const provider = {
    identity: `${vendorGroup}-${endpointCommitment.slice(2, 34)}`,
    vendorGroup,
    endpointCommitment,
    endpointOriginCommitment,
  } as ActionRpcProvider;
  Object.defineProperty(provider, "endpoint", {
    value: canonicalEndpoint,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return Object.freeze(provider);
}

function sameEndpoint(left: ActionRpcProvider, right: ActionRpcProvider) {
  return left.endpointCommitment === right.endpointCommitment;
}

function sameProvider(left: ActionRpcProvider, right: ActionRpcProvider) {
  return (
    left.vendorGroup === right.vendorGroup ||
    left.endpointOriginCommitment === right.endpointOriginCommitment
  );
}

/**
 * Resolves a server-side RPC quorum. The configured primary and secondary must
 * represent different vendors and origins. Extra fallbacks can improve
 * availability, but aliases of an already selected provider never add a vote.
 */
export function createActionRpcQuorum(
  input: QuorumInput,
): readonly ActionRpcProvider[] {
  const maximumProviders = input.maximumProviders ?? Number.MAX_SAFE_INTEGER;
  if (!Number.isSafeInteger(maximumProviders) || maximumProviders < 2) {
    throw new ActionRpcQuorumError("quorum-unavailable");
  }

  const primary = parseProvider(input.primary, input.chainId);
  const selected: ActionRpcProvider[] = [primary];
  if (input.secondary) {
    const secondary = parseProvider(input.secondary, input.chainId);
    if (sameEndpoint(primary, secondary) || sameProvider(primary, secondary)) {
      throw new ActionRpcQuorumError("provider-not-independent");
    }
    selected.push(secondary);
  }

  for (const endpoint of input.fallbacks ?? []) {
    if (selected.length >= maximumProviders) break;
    const fallback = parseProvider(endpoint, input.chainId);
    if (
      selected.some(
        (provider) =>
          sameEndpoint(provider, fallback) || sameProvider(provider, fallback),
      )
    ) {
      continue;
    }
    selected.push(fallback);
  }

  if (selected.length < 2) {
    throw new ActionRpcQuorumError("quorum-unavailable");
  }
  return Object.freeze(selected.slice(0, maximumProviders));
}

export function tradeActionRpcProviders(
  chainId: SupportedChainId,
  env: Environment = process.env,
) {
  if (chainId === 1) {
    const primary =
      env.ETHEREUM_RPC_URL ?? "https://ethereum-rpc.publicnode.com";
    const secondary =
      env.ETHEREUM_RPC_URL_B ??
      env.ETHEREUM_RPC_URL_SECONDARY ??
      (primary === "https://ethereum-rpc.publicnode.com"
        ? "https://rpc.mevblocker.io"
        : "https://ethereum-rpc.publicnode.com");
    return createActionRpcQuorum({
      chainId,
      primary,
      secondary,
      maximumProviders: 2,
    });
  }
  const primary =
    env.SEPOLIA_RPC_URL ??
    "https://ethereum-sepolia-rpc.publicnode.com";
  const secondary =
    env.SEPOLIA_RPC_URL_B ??
    env.SEPOLIA_RPC_URL_SECONDARY ??
    (primary === "https://ethereum-sepolia-rpc.publicnode.com"
      ? "https://rpc.sepolia.org"
      : "https://ethereum-sepolia-rpc.publicnode.com");
  return createActionRpcQuorum({
    chainId,
    primary,
    secondary,
    maximumProviders: 2,
  });
}

/**
 * Keeps protocol-revenue execution isolated from the RPCs used by user-facing
 * trade preparation. The selected defaults are independently operated and
 * have both been verified against the live ERC-7715 delegation path.
 */
export function protocolRevenueRpcProviders(
  env: Environment = process.env,
) {
  const primary =
    env.PROTOCOL_REVENUE_RPC_URL_A ?? "https://eth.drpc.org";
  const secondary =
    env.PROTOCOL_REVENUE_RPC_URL_B ??
    "https://ethereum-rpc.publicnode.com";
  return createActionRpcQuorum({
    chainId: 1,
    primary,
    secondary,
    fallbacks: ["https://rpc.mevblocker.io"],
    maximumProviders: 2,
  });
}

export function creatorClaimRpcProviders(
  deployment: Readonly<{
    chainId: number;
    rpcUrl: string;
    rpcUrlSecondary: string | null;
  }>,
) {
  if (deployment.chainId !== 1 && deployment.chainId !== 11_155_111) {
    throw new ActionRpcQuorumError("invalid-provider");
  }
  const chainId = deployment.chainId as SupportedChainId;
  return createActionRpcQuorum({
    chainId,
    primary: deployment.rpcUrl,
    secondary: deployment.rpcUrlSecondary,
    fallbacks:
      chainId === 1
        ? [
            "https://ethereum-rpc.publicnode.com",
            "https://rpc.mevblocker.io",
          ]
        : [
            "https://ethereum-sepolia-rpc.publicnode.com",
            "https://rpc.sepolia.org",
          ],
    maximumProviders: 4,
  });
}

export function classicV3ActionRpcProviders(
  environment: "production" | "rehearsal",
  env: Environment = process.env,
) {
  const chainId = environment === "production" ? 1 : 11_155_111;
  const primary =
    environment === "production"
      ? env.ETHEREUM_RPC_URL ?? "https://eth.drpc.org"
      : env.SEPOLIA_RPC_URL ?? "https://sepolia.drpc.org";
  const secondary =
    environment === "production"
      ? env.ETHEREUM_RPC_URL_B ??
        env.ETHEREUM_RPC_URL_SECONDARY ??
        "https://ethereum-rpc.publicnode.com"
      : env.SEPOLIA_RPC_URL_B ??
        env.SEPOLIA_RPC_URL_SECONDARY ??
        "https://ethereum-sepolia-rpc.publicnode.com";
  return createActionRpcQuorum({
    chainId,
    primary,
    secondary,
    fallbacks:
      environment === "production"
        ? ["https://rpc.mevblocker.io"]
        : ["https://rpc.sepolia.org"],
    maximumProviders: 2,
  });
}

export function stockPairedActionRpcProviders(
  env: Environment = process.env,
) {
  const primary =
    env.ETHEREUM_RPC_URL ?? "https://ethereum-rpc.publicnode.com";
  const secondary =
    env.ETHEREUM_RPC_URL_B ??
    env.ETHEREUM_RPC_URL_SECONDARY ??
    (primary === "https://ethereum-rpc.publicnode.com"
      ? "https://rpc.mevblocker.io"
      : "https://ethereum-rpc.publicnode.com");
  return createActionRpcQuorum({
    chainId: 1,
    primary,
    secondary,
    fallbacks: [
      "https://ethereum-rpc.publicnode.com",
      "https://rpc.mevblocker.io",
      "https://eth.drpc.org",
    ],
    maximumProviders: 5,
  });
}
