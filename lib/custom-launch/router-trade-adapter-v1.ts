import type {
  DiscoverableLaunchMarketV2,
  DiscoverableMarketTradeCapabilityV1,
} from "./contract-v2";
import {
  isLaunchStampProvenanceV1,
  type CanonicalTokenExploreEntry,
  type LaunchStampProvenanceV1,
} from "../tokens";

export const FADE_ROUTER_TRADE_ADAPTER_ID =
  "router-custom-fade-decay-fee-trade-v1" as const;
export const FADE_ROUTER_TRADE_PROJECT_ID =
  "sha256:e7bf1306fc05ef655e3ebebe9566ff86c74b4de21465c3d836cbf3f497865c2d" as const;
export const FADE_ROUTER_TRADE_MARKET_ID = "fade-eth-v4" as const;

const NATIVE_ETH = "0x0000000000000000000000000000000000000000";
const FADE_LAUNCH_ID =
  "0x6d6ed0e1e69a7cd6afa177e3454c9e32eed61cbd3f855ee56aff1915a6776fc2";
const FADE_STAMP_HASH =
  "0x5ef9eda88dc8269156b0bea01ae306f3e546b95f719ea17c821003aaa8e0c7e2";
const FADE_TOKEN = "0x69d278968abf120f878f2e1e016ab615d3686c19";
const FADE_HOOK = "0xd7451a039373f54e493dee42a751fecbfafba0cc";
const FADE_POOL_ID =
  "0x6b6f0f8348bb08c7cbaa45cd48b4531e3a206ac7eabcc5355d9ffdd21c4b579a";
const FADE_CREATOR = "0x2Bb333d48DFAF1596D9036671d2E43168994249E";
const FADE_TOKEN_RUNTIME_KECCAK256 =
  "0xe48c3827d558866b3d761d78b7d29416f24d277120ef1a7ce6a360962b917596";
const FADE_TOKEN_RUNTIME_SHA256 =
  "sha256:20697fc6e8fbf4fd55a4b032c0c6f5d01548f283a52b6e72562ec17462cc8fea";
const FADE_HOOK_RUNTIME_KECCAK256 =
  "0xff70a4d3d889b730a064b270fc187f0cba40582f1fa6f5875893066b17a1257b";
const FADE_HOOK_RUNTIME_SHA256 =
  "sha256:d9ca0682a57b21a166e76b8e5482d31ddaca84d42b5b64a6f3ea9d5a29c8519b";
const FADE_ROUTE_LAUNCHER = "0xB012e4A8F2c5FC4E8E4faCA9D5Ad6FfF13FBA887";
const FADE_ROUTE_LAUNCHER_RUNTIME_KECCAK256 =
  "0xd23692fae59331592048e71a96d4963e170ee56e449683dc9f7fa3f9470018b8";
const FADE_POOL_KEY_HASH =
  "0x171e45dee03686a5fb5b737fb688bed60401c209b5034a09112f7a0bddf8d799";

const POOL_MANAGER = "0x000000000004444c5dc75cB358380D2e3dE08A90";
const POOL_MANAGER_RUNTIME_KECCAK256 =
  "0x785f1014552b7ce7d5fb7d0c970ca60edee94fd00425d7ca21609acac7ce1293";
const POOL_MANAGER_RUNTIME_SHA256 =
  "sha256:3316c7b1c67095ef6fc9b7e62fc754ad1e46e1c9119564ea4f5615a252af893e";
const PERMIT2 = "0x000000000022d473030f116ddee9f6b43ac78ba3";
const PERMIT2_RUNTIME_KECCAK256 =
  "0xc67d1657868aa5146eaf24fb879fb1fdec3d2d493b3683a61c9c2f4fb2851131";
const PERMIT2_RUNTIME_SHA256 =
  "sha256:62f01f46295c143ebea4d1cf12be2085d8b93d53f86d95afba4f016ee2d694ba";
const V4_QUOTER = "0x52f0e24d1c21c8a0cb1e5a5dd6198556bd9e1203";
const V4_QUOTER_RUNTIME_KECCAK256 =
  "0x06de58fa119c5deaa7a667fb92d3894e25d9160e62fb82c8d86d43b47eefe441";
const V4_QUOTER_RUNTIME_SHA256 =
  "sha256:cc07fd0a59bf60c8390ea38225aab5d6b74feaf08fc140f32ce9dc6f43432416";
const STATE_VIEW = "0x7ffe42c4a5deea5b0fec41c94c136cf115597227";
const STATE_VIEW_RUNTIME_KECCAK256 =
  "0xd7947778589cf4aac9a092a4451292a2056380941635ab7006d3c691d8dfd878";
const STATE_VIEW_RUNTIME_SHA256 =
  "sha256:afb76fbf22525470301fdd914354516e10e64e11872c773ee33b1834e1beb2ef";
const UNIVERSAL_ROUTER = "0xd92a36b0000531ef3063ded4de20a0783308446c";
const UNIVERSAL_ROUTER_RUNTIME_KECCAK256 =
  "0x41ccd905c8e4de29ce9536ff49233b79e3085a0987d490664e703ee1e7b1dc49";
const UNIVERSAL_ROUTER_RUNTIME_SHA256 =
  "sha256:368c03384235ca17609879850457e53729c5c4dc9a0ea15f3c48ac151a5363c1";

const CHAIN_PROFILE_ID = "ethereum-mainnet-v4";
const CHAIN_PROFILE_HASH =
  "sha256:e77d55f168e98d535ef4ec8b560047613dd1742b8ca3896073aa4c6e24c3f6a0";
const PLAN_BINDING_HASH =
  "sha256:056d7ff50d0cf56c180f4ed2a4392d4d6dbd2754378d94da571412bf2850adb3";
const POOL_KEY_EVIDENCE_HASH =
  "sha256:af2729810168c38129d3a5eb727502001c90831b60cdb6f7398496a19272891c";
const MARKET_VERIFICATION_BINDING_HASH =
  "sha256:c9b2ebc562a4435242caf7c97277568a5169bff6097652137cf0187e3a16d4ba";
const HOOK_IDENTITY_EVIDENCE_HASH =
  "sha256:ac8499c37e85c1d091fb54cc24b6b0f1b303f52b0b1c446d37283a5dd6a60e2f";
const TRADE_CAPABILITY_BINDING_HASH =
  "sha256:2bf52e6d8c476c5d7aa0cbb4724ef9e2e9e132b60c4ffdb5cb9522f89749bbff";

function dependency(input: Readonly<{
  role: DiscoverableMarketTradeCapabilityV1["dependencies"][number]["role"];
  dependencyId: string;
  capabilityId: string;
  address: string;
  runtimeCodeKeccak256: string;
  runtimeCodeSha256: `sha256:${string}`;
  reviewEvidenceBindingHash: `sha256:${string}`;
  interfaceEvidenceBindingHash: `sha256:${string}`;
}>) {
  return Object.freeze({
    role: input.role,
    dependencyId: input.dependencyId,
    capabilityId: input.capabilityId,
    chainProfileId: CHAIN_PROFILE_ID,
    identity: Object.freeze({ namespace: "eip155:1", value: input.address }),
    runtimeCodeKeccak256: input.runtimeCodeKeccak256,
    runtimeCodeSha256: input.runtimeCodeSha256,
    reviewEvidenceBindingHash: input.reviewEvidenceBindingHash,
    interfaceEvidenceBindingHash: input.interfaceEvidenceBindingHash,
  });
}

export const FADE_ROUTER_TRADE_CAPABILITY_V1 = Object.freeze({
  schemaVersion: "programmable.discoverable-market-trade-capability.v1",
  capabilityId: "trade:router-custom-fade-decay-fee-v1",
  adapterId: "uniswap-v4-universal-router-exact-input:v1",
  chainId: "1",
  chainProfileId: CHAIN_PROFILE_ID,
  chainProfileHash: CHAIN_PROFILE_HASH,
  marketId: FADE_ROUTER_TRADE_MARKET_ID,
  baseAssetId: "fade-token",
  quoteAssetId: "native-eth",
  poolKey: Object.freeze({
    poolId: FADE_POOL_ID,
    currency0AssetId: "native-eth",
    currency0: Object.freeze({ namespace: "eip155:1", value: NATIVE_ETH }),
    currency1AssetId: "fade-token",
    currency1: Object.freeze({ namespace: "eip155:1", value: FADE_TOKEN }),
    feeRaw: "0",
    tickSpacing: "200",
    hooksAssetId: "fade-decay-fee-hook",
    hooks: Object.freeze({ namespace: "eip155:1", value: FADE_HOOK }),
  }),
  routerGeneration: "universal-router:v2.2",
  dependencies: Object.freeze([
    dependency({
      role: "uniswap-permit2",
      dependencyId: "dependency:uniswap-permit2",
      capabilityId: "capability:uniswap-permit2:v1",
      address: PERMIT2,
      runtimeCodeKeccak256: PERMIT2_RUNTIME_KECCAK256,
      runtimeCodeSha256: PERMIT2_RUNTIME_SHA256,
      reviewEvidenceBindingHash:
        "sha256:70ffca0aced1f7a2e8842483a54dd57c090e8da90fc2b4bffa3c900d953f86ce",
      interfaceEvidenceBindingHash:
        "sha256:fabf8227e5429a9dcd5a3700cd40ba23b7c7cbb45b0ac38c184593c412cbd5de",
    }),
    dependency({
      role: "uniswap-v4-quoter",
      dependencyId: "dependency:uniswap-v4-quoter",
      capabilityId: "capability:uniswap-v4-quoter:v1",
      address: V4_QUOTER,
      runtimeCodeKeccak256: V4_QUOTER_RUNTIME_KECCAK256,
      runtimeCodeSha256: V4_QUOTER_RUNTIME_SHA256,
      reviewEvidenceBindingHash:
        "sha256:24b337a9844afb5e57468173f3b2e8e2573a1fdeac25967f8e62b7859c114272",
      interfaceEvidenceBindingHash:
        "sha256:984c780482d3ad20eca3ba99aa93e81fd59989acbe2f61f839335df8abb0cb5f",
    }),
    dependency({
      role: "uniswap-v4-state-view",
      dependencyId: "dependency:uniswap-v4-state-view",
      capabilityId: "capability:uniswap-v4-state-view:v1",
      address: STATE_VIEW,
      runtimeCodeKeccak256: STATE_VIEW_RUNTIME_KECCAK256,
      runtimeCodeSha256: STATE_VIEW_RUNTIME_SHA256,
      reviewEvidenceBindingHash:
        "sha256:d6f44a2e55b451a2e6e6d6b30a4bb28267f5b9d3ac4aa0b281742c3b5bb2ada1",
      interfaceEvidenceBindingHash:
        "sha256:810dbfd68ff00702a78b117b06be1522e93127d783112679667e6bd17be62d6b",
    }),
    dependency({
      role: "uniswap-v4-universal-router",
      dependencyId: "dependency:uniswap-v4-universal-router-v2.2",
      capabilityId: "capability:uniswap-v4-universal-router:v2.2",
      address: UNIVERSAL_ROUTER,
      runtimeCodeKeccak256: UNIVERSAL_ROUTER_RUNTIME_KECCAK256,
      runtimeCodeSha256: UNIVERSAL_ROUTER_RUNTIME_SHA256,
      reviewEvidenceBindingHash:
        "sha256:4666d30380b144cb2d1e3a8f3dd93918e1956c8656586b72755032bd0f008b8b",
      interfaceEvidenceBindingHash:
        "sha256:17130fae6990f8cf31237b7a46d30a6057842887622521c2283f59ceb60f6b2b",
    }),
  ]),
  supportedSides: Object.freeze(["base-to-quote", "quote-to-base"]),
  sideBindings: Object.freeze([
    Object.freeze({
      side: "base-to-quote",
      inputAssetId: "fade-token",
      outputAssetId: "native-eth",
      zeroForOne: false,
      inputCurrencyKind: "erc20",
      settlementAction: "SETTLE_ALL",
      takeAction: "TAKE_ALL",
    }),
    Object.freeze({
      side: "quote-to-base",
      inputAssetId: "native-eth",
      outputAssetId: "fade-token",
      zeroForOne: true,
      inputCurrencyKind: "native",
      settlementAction: "SETTLE_ALL",
      takeAction: "TAKE_ALL",
    }),
  ]),
  exactness: "exact-input",
  hookDataPolicy: Object.freeze({
    kind: "empty",
    data: "0x",
    hookDataHash:
      "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  }),
  actionPolicy: Object.freeze({
    swapAction: "SWAP_EXACT_IN_SINGLE",
    settleAction: "SETTLE_ALL",
    takeAction: "TAKE_ALL",
    multiHop: false,
    exactOutput: false,
  }),
  quotePolicy: Object.freeze({
    adapterId: "uniswap-v4-quoter-exact-input:v1",
    executionMode: "offchain-static-call-only",
    currentStateRequired: true,
    maximumQuoteAgeSeconds: 30,
  }),
  slippagePolicy: Object.freeze({
    kind: "user-bounded-minimum-output",
    amountOutMinimumRequired: true,
    maximumSlippageBps: 500,
  }),
  deadlinePolicy: Object.freeze({
    kind: "bounded-user-deadline",
    deadlineRequired: true,
    maximumHorizonSeconds: 300,
  }),
  approvalPolicy: Object.freeze({
    erc20Input: "erc20-approve-permit2-then-permit2-approve-router",
    nativeInput: "transaction-value",
  }),
  recipientPolicy: "connected-wallet-only",
  planBindingHash: PLAN_BINDING_HASH,
  status: "verified",
  poolKeyEvidenceHash: POOL_KEY_EVIDENCE_HASH,
  marketVerificationBindingHash: MARKET_VERIFICATION_BINDING_HASH,
  hookAssetIdentityEvidenceHash: HOOK_IDENTITY_EVIDENCE_HASH,
  tradeCapabilityBindingHash: TRADE_CAPABILITY_BINDING_HASH,
} as const satisfies DiscoverableMarketTradeCapabilityV1);

export const FADE_ROUTER_TRADE_MARKET_V1 = Object.freeze({
  marketId: FADE_ROUTER_TRADE_MARKET_ID,
  kind: "uniswap-v4-hooked-pool",
  status: "active",
  marketAssetId: "fade-eth-v4-pool",
  baseAssetId: "fade-token",
  quoteAssetId: "native-eth",
  marketEvidenceHash: MARKET_VERIFICATION_BINDING_HASH,
  verification: Object.freeze({
    status: "verified",
    verifierAdapterId: FADE_ROUTER_TRADE_ADAPTER_ID,
    verifierBindingHash: MARKET_VERIFICATION_BINDING_HASH,
  }),
  uniswapV4: Object.freeze({
    poolId: FADE_POOL_ID,
    poolManager: Object.freeze({ namespace: "eip155:1", value: POOL_MANAGER }),
    poolManagerReviewEvidenceBindingHash:
      "sha256:2f30365fc3399433bd15e153cabe6ef36df7bcfd82ad1790c076f86062520b9f",
    poolManagerInterfaceEvidenceBindingHash:
      "sha256:db0a2ee136c5ec485d3b455b8ca262a1b381ca5e964b167fa1a57292ead342c3",
    poolManagerRuntimeCodeKeccak256: POOL_MANAGER_RUNTIME_KECCAK256,
    poolManagerRuntimeCodeSha256: POOL_MANAGER_RUNTIME_SHA256,
    currency0AssetId: "native-eth",
    currency1AssetId: "fade-token",
    feeRaw: "0",
    dynamicFee: false,
    tickSpacing: "200",
    hooksAssetId: "fade-decay-fee-hook",
    poolKeyEvidenceHash: POOL_KEY_EVIDENCE_HASH,
  }),
  tradeCapability: FADE_ROUTER_TRADE_CAPABILITY_V1,
} as const satisfies DiscoverableLaunchMarketV2);

export type RouterTradeAdapterV1 = Readonly<{
  adapterId: typeof FADE_ROUTER_TRADE_ADAPTER_ID;
  projectId: typeof FADE_ROUTER_TRADE_PROJECT_ID;
  chainId: "1";
  chainProfileId: typeof CHAIN_PROFILE_ID;
  chainProfileHash: typeof CHAIN_PROFILE_HASH;
  launchId: typeof FADE_LAUNCH_ID;
  stampHash: typeof FADE_STAMP_HASH;
  tokenAddress: typeof FADE_TOKEN;
  tokenRuntimeCodeKeccak256: typeof FADE_TOKEN_RUNTIME_KECCAK256;
  tokenRuntimeCodeSha256: typeof FADE_TOKEN_RUNTIME_SHA256;
  hookAddress: typeof FADE_HOOK;
  hookRuntimeCodeKeccak256: typeof FADE_HOOK_RUNTIME_KECCAK256;
  hookRuntimeCodeSha256: typeof FADE_HOOK_RUNTIME_SHA256;
  market: typeof FADE_ROUTER_TRADE_MARKET_V1;
}>;

export const FADE_ROUTER_TRADE_ADAPTER_V1 = Object.freeze({
  adapterId: FADE_ROUTER_TRADE_ADAPTER_ID,
  projectId: FADE_ROUTER_TRADE_PROJECT_ID,
  chainId: "1",
  chainProfileId: CHAIN_PROFILE_ID,
  chainProfileHash: CHAIN_PROFILE_HASH,
  launchId: FADE_LAUNCH_ID,
  stampHash: FADE_STAMP_HASH,
  tokenAddress: FADE_TOKEN,
  tokenRuntimeCodeKeccak256: FADE_TOKEN_RUNTIME_KECCAK256,
  tokenRuntimeCodeSha256: FADE_TOKEN_RUNTIME_SHA256,
  hookAddress: FADE_HOOK,
  hookRuntimeCodeKeccak256: FADE_HOOK_RUNTIME_KECCAK256,
  hookRuntimeCodeSha256: FADE_HOOK_RUNTIME_SHA256,
  market: FADE_ROUTER_TRADE_MARKET_V1,
} as const satisfies RouterTradeAdapterV1);

function sameHex(left: unknown, right: unknown) {
  return typeof left === "string" && typeof right === "string"
    && left.toLowerCase() === right.toLowerCase();
}

function exactExclusiveComponent(
  stamp: LaunchStampProvenanceV1,
  input: Readonly<{
    address: string;
    kind: "token" | "hook";
    runtimeCodeHash: string;
  }>,
) {
  return stamp.components.some((component) =>
    component.kind === input.kind
    && component.scope === "exclusive"
    && sameHex(component.address, input.address)
    && sameHex(component.runtimeCodeHash, input.runtimeCodeHash)
    && component.exclusiveProof !== null
    && sameHex(component.exclusiveProof.launchId, stamp.launchId)
    && sameHex(component.exclusiveProof.stampHash, stamp.stampHash));
}

/**
 * Router discovery is not a generic trading capability. Only this exact,
 * finalized FADE stamp resolves to the reviewed empty-hookData route.
 */
export function resolveRouterTradeAdapterV1(
  entry: CanonicalTokenExploreEntry,
): RouterTradeAdapterV1 | null {
  const stamp = entry.launchStampProvenance;
  const category = entry.launchCategoryProvenance;
  if (
    !stamp
    || entry.exploreKind !== "token"
    || entry.launchModel !== "custom-graph"
    || entry.launchModelVersion !== "programmable-launch-stamp-router-v1"
    || entry.totalSwapFeeBps !== null
    || entry.tokenDecimals !== 18
    || category.category !== "custom"
    || category.source !== "canonical-launch-stamp-router"
    || stamp.kind !== "custom-graph"
    || !isLaunchStampProvenanceV1(stamp, {
      chainId: 1,
      tokenAddress: FADE_TOKEN,
      hookAddress: FADE_HOOK,
      poolId: FADE_POOL_ID,
      launchWallet: FADE_CREATOR,
    })
    || !sameHex(entry.tokenAddress, FADE_TOKEN)
    || !sameHex(entry.hookAddress, FADE_HOOK)
    || !sameHex(entry.poolId, FADE_POOL_ID)
    || !sameHex(stamp.launchId, FADE_LAUNCH_ID)
    || !sameHex(stamp.stampHash, FADE_STAMP_HASH)
    || !sameHex(category.launchId, stamp.launchId)
    || !sameHex(category.stampHash, stamp.stampHash)
    || !sameHex(category.routerAddress, stamp.routerAddress)
    || !sameHex(category.transactionHash, stamp.transactionHash)
    || !sameHex(category.blockHash, stamp.blockHash)
    || category.blockNumber !== stamp.blockNumber
    || category.transactionIndex !== stamp.transactionIndex
    || category.logIndex !== stamp.launchLogIndex
    || !sameHex(stamp.routeLauncherAddress, FADE_ROUTE_LAUNCHER)
    || !sameHex(
      stamp.routeLauncherRuntimeCodeHash,
      FADE_ROUTE_LAUNCHER_RUNTIME_KECCAK256,
    )
    || !sameHex(stamp.poolKeyHash, FADE_POOL_KEY_HASH)
    || !sameHex(stamp.poolKey.currency0, NATIVE_ETH)
    || !sameHex(stamp.poolKey.currency1, FADE_TOKEN)
    || stamp.poolKey.fee !== 0
    || stamp.poolKey.tickSpacing !== 200
    || !sameHex(stamp.poolKey.hooks, FADE_HOOK)
    || !exactExclusiveComponent(stamp, {
      address: FADE_TOKEN,
      kind: "token",
      runtimeCodeHash: FADE_TOKEN_RUNTIME_KECCAK256,
    })
    || !exactExclusiveComponent(stamp, {
      address: FADE_HOOK,
      kind: "hook",
      runtimeCodeHash: FADE_HOOK_RUNTIME_KECCAK256,
    })
  ) return null;

  return FADE_ROUTER_TRADE_ADAPTER_V1;
}

export function routerTradeAdapterForProjectIdV1(projectId: string) {
  return projectId === FADE_ROUTER_TRADE_PROJECT_ID
    ? FADE_ROUTER_TRADE_ADAPTER_V1
    : null;
}

export type RouterTradeProjectV1 = Readonly<{
  customProjectId: typeof FADE_ROUTER_TRADE_PROJECT_ID;
  markets: readonly Readonly<{
    marketId: typeof FADE_ROUTER_TRADE_MARKET_ID;
    kind: string;
    status: "active";
    poolId: typeof FADE_POOL_ID;
    baseAsset: Readonly<{
      assetId: "fade-token";
      identity: Readonly<{ namespace: "eip155:1"; value: typeof FADE_TOKEN }>;
      name: "FADE";
      symbol: "FADE";
      decimals: 18;
    }>;
    quoteAsset: Readonly<{
      assetId: "native-eth";
      identity: Readonly<{ namespace: "eip155:1"; value: typeof NATIVE_ETH }>;
      name: "Ether";
      symbol: "ETH";
      decimals: 18;
    }>;
    tradeCapability: typeof FADE_ROUTER_TRADE_CAPABILITY_V1;
  }>[];
}>;

const FADE_ROUTER_TRADE_PROJECT_V1 = Object.freeze({
  customProjectId: FADE_ROUTER_TRADE_PROJECT_ID,
  markets: Object.freeze([Object.freeze({
    marketId: FADE_ROUTER_TRADE_MARKET_ID,
    kind: FADE_ROUTER_TRADE_MARKET_V1.kind,
    status: "active",
    poolId: FADE_POOL_ID,
    baseAsset: Object.freeze({
      assetId: "fade-token",
      identity: Object.freeze({ namespace: "eip155:1", value: FADE_TOKEN }),
      name: "FADE",
      symbol: "FADE",
      decimals: 18,
    }),
    quoteAsset: Object.freeze({
      assetId: "native-eth",
      identity: Object.freeze({ namespace: "eip155:1", value: NATIVE_ETH }),
      name: "Ether",
      symbol: "ETH",
      decimals: 18,
    }),
    tradeCapability: FADE_ROUTER_TRADE_CAPABILITY_V1,
  })]),
} as const satisfies RouterTradeProjectV1);

export function routerTradeProjectForEntryV1(
  entry: CanonicalTokenExploreEntry,
): RouterTradeProjectV1 | null {
  return resolveRouterTradeAdapterV1(entry) === null
    ? null
    : FADE_ROUTER_TRADE_PROJECT_V1;
}
