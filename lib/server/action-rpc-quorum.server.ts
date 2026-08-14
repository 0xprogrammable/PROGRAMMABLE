import "server-only";

import type { Hex } from "viem";

import { rpcProviderCommitment } from "../data-pipeline/rpc-provider-commitments";
import {
  WEBSITE_MAINNET_RPC_ENV,
  productionMainnetRpcPair,
} from
  "../onchain/website-rpc-providers.server";

type Environment = Readonly<Record<string, string | undefined>>;
type SupportedChainId = 1 | 11_155_111;
type ActionRpcVendor =
  | "alchemy"
  | "quicknode"
  | "infura"
  | "drpc"
  | "publicnode"
  | "mevblocker"
  | "tenderly"
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

type CommittedProviderInput = Readonly<{
  chainId: SupportedChainId;
  endpoint: string | null | undefined;
  endpointCommitment: string | null | undefined;
}>;

export class ActionRpcProviderError extends Error {
  readonly code:
    | "invalid-provider"
    | "commitment-mismatch";

  constructor(
    code: ActionRpcProviderError["code"],
    message = "The configured Ethereum RPC is unavailable",
  ) {
    super(message);
    this.name = "ActionRpcProviderError";
    this.code = code;
  }

  toJSON() {
    return { name: this.name, code: this.code };
  }
}

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
    chainId === 1 &&
    value.hostname === "mainnet.gateway.tenderly.co" &&
    rootPath &&
    noQuery
  ) {
    return "tenderly";
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

function isPrivateActionProvider(provider: ActionRpcProvider) {
  if (provider.vendorGroup !== "drpc") {
    return (
      provider.vendorGroup === "alchemy" ||
      provider.vendorGroup === "quicknode" ||
      provider.vendorGroup === "infura"
    );
  }
  return provider.endpoint.includes("lb.drpc.");
}

/**
 * Resolves exactly one private action transport and binds it to an
 * independently configured endpoint commitment. No secondary or fallback is
 * consulted.
 */
export function createCommittedActionRpcProvider(
  input: CommittedProviderInput,
): ActionRpcProvider {
  let provider: ActionRpcProvider;
  try {
    provider = parseProvider(input.endpoint, input.chainId);
  } catch {
    throw new ActionRpcProviderError("invalid-provider");
  }
  if (!isPrivateActionProvider(provider)) {
    throw new ActionRpcProviderError("invalid-provider");
  }
  if (
    typeof input.endpointCommitment !== "string" ||
    !/^0x[0-9a-f]{64}$/u.test(input.endpointCommitment) ||
    provider.endpointCommitment !== input.endpointCommitment
  ) {
    throw new ActionRpcProviderError("commitment-mismatch");
  }
  return provider;
}

function productionActionRpcProvider(env: Environment) {
  if (env[WEBSITE_MAINNET_RPC_ENV.primaryProvider] !== "drpc") {
    throw new ActionRpcProviderError("invalid-provider");
  }
  return createCommittedActionRpcProvider({
    chainId: 1,
    endpoint: env[WEBSITE_MAINNET_RPC_ENV.primaryUrl],
    endpointCommitment: env[WEBSITE_MAINNET_RPC_ENV.primaryCommitment],
  });
}

export function tradeActionRpcProvider(
  chainId: SupportedChainId,
  env: Environment = process.env,
) {
  if (chainId === 1) return productionActionRpcProvider(env);
  return createCommittedActionRpcProvider({
    chainId,
    endpoint: env.SEPOLIA_RPC_URL,
    endpointCommitment:
      env.PROGRAMMABLE_SEPOLIA_RPC_ENDPOINT_COMMITMENT ??
      env.SEPOLIA_RPC_ENDPOINT_COMMITMENT,
  });
}

export function creatorClaimRpcProvider(
  deployment: Readonly<{ chainId: number }>,
  env: Environment = process.env,
) {
  if (deployment.chainId !== 1 && deployment.chainId !== 11_155_111) {
    throw new ActionRpcProviderError("invalid-provider");
  }
  return tradeActionRpcProvider(deployment.chainId, env);
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

function productionActionRpcProviders(env: Environment) {
  try {
    const binding = productionMainnetRpcPair(env);
    const providers = createActionRpcQuorum({
      chainId: 1,
      primary: binding.primary.url,
      secondary: binding.secondary.url,
      maximumProviders: 2,
    });
    const [primary, secondary] = providers;
    if (
      primary?.vendorGroup !== "drpc" ||
      secondary?.vendorGroup !== "quicknode" ||
      primary.endpointCommitment !== binding.primary.endpointCommitment ||
      secondary.endpointCommitment !== binding.secondary.endpointCommitment
    ) {
      throw new ActionRpcQuorumError("quorum-unavailable");
    }
    return providers;
  } catch {
    throw new ActionRpcQuorumError("quorum-unavailable");
  }
}

export function tradeActionRpcProviders(
  chainId: SupportedChainId,
  env: Environment = process.env,
) {
  if (chainId === 1) {
    return productionActionRpcProviders(env);
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
 * Production execution shares the same role-bound private pair as Website
 * reads. This avoids an uncommitted public fallback in a money-moving path.
 */
export function protocolRevenueRpcProviders(
  env: Environment = process.env,
) {
  return productionActionRpcProviders(env);
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
    fallbacks: chainId === 1
      ? []
      : [
          "https://ethereum-sepolia-rpc.publicnode.com",
          "https://rpc.sepolia.org",
        ],
    maximumProviders: chainId === 1 ? 2 : 4,
  });
}

export function classicV3ActionRpcProviders(
  environment: "production" | "rehearsal",
  env: Environment = process.env,
) {
  const chainId = environment === "production" ? 1 : 11_155_111;
  if (environment === "production") {
    return productionActionRpcProviders(env);
  }
  const primary =
    env.SEPOLIA_RPC_URL ?? "https://sepolia.drpc.org";
  const secondary =
    env.SEPOLIA_RPC_URL_B ??
    env.SEPOLIA_RPC_URL_SECONDARY ??
    "https://ethereum-sepolia-rpc.publicnode.com";
  return createActionRpcQuorum({
    chainId,
    primary,
    secondary,
    fallbacks: ["https://rpc.sepolia.org"],
    maximumProviders: 2,
  });
}

export function classicV3ActionRpcProvider(
  environment: "production" | "rehearsal",
  env: Environment = process.env,
) {
  return tradeActionRpcProvider(
    environment === "production" ? 1 : 11_155_111,
    env,
  );
}

export function stockPairedActionRpcProviders(
  env: Environment = process.env,
) {
  return productionActionRpcProviders(env);
}

export function stockPairedActionRpcProvider(
  env: Environment = process.env,
) {
  return tradeActionRpcProvider(1, env);
}
