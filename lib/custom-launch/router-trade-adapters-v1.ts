import type {
  DiscoverableLaunchMarketV2,
  DiscoverableMarketTradeCapabilityV1,
} from "./contract-v2";
import {
  FADE_ROUTER_TRADE_ADAPTER_V1,
  FADE_ROUTER_TRADE_PROJECT_ID,
  resolveRouterTradeAdapterV1 as resolveFadeRouterTradeAdapterV1,
  routerTradeProjectForEntryV1 as fadeRouterTradeProjectForEntryV1,
} from "./router-trade-adapter-v1";
import {
  isLaunchStampProvenanceV1,
  type CanonicalTokenExploreEntry,
  type LaunchStampProvenanceV1,
} from "../tokens";
import { canonicalSha256 } from "../server/projection-target/hashing";

type Sha256Digest = `sha256:${string}`;

export type RouterTradeRuntimeTargetV1 = Readonly<{
  label: string;
  address: string;
  runtimeCodeKeccak256: `0x${string}`;
  runtimeCodeSha256: Sha256Digest;
}>;

export type RouterTradeSourceEvidenceV1 = Readonly<{
  repository: string;
  commit: string;
  tree: string;
  sourcePath: string;
  sourceSha256: Sha256Digest;
  compilerVersion: string;
  evmVersion: string;
  optimizerEnabled: true;
  optimizerRuns: number;
  metadataBytecodeHash: "none";
  metadataAppendCbor: false;
  exactTokenRuntimeMatch: true;
  noTransferTax: true;
  noPause: true;
  noBlocklist: true;
}>;

export type RouterTradeExecutionEvidenceV1 = Readonly<{
  kind: "pinned-mainnet-fork-buy-and-sell";
  blockNumber: string;
  blockHash: `0x${string}`;
  universalRouter: string;
  universalRouterCommand: "0x10";
  actions: readonly ["SWAP_EXACT_IN_SINGLE", "SETTLE_ALL", "TAKE_ALL"];
  hookData: "0x";
  buy: Readonly<{
    amountIn: string;
    quotedAmountOut: string;
    executedAmountOut: string;
    routeCalldataHash: `0x${string}`;
    estimatedGas: string;
    executedGas: string;
  }>;
  sell: Readonly<{
    amountIn: string;
    quotedAmountOut: string;
    executedAmountOut: string;
    routeCalldataHash: `0x${string}`;
    estimatedGas: string;
    executedGas: string;
  }>;
  quoteMatchedExecution: true;
  noMainnetBroadcast: true;
}>;

export type RouterTradeProjectV1 = Readonly<{
  customProjectId: Sha256Digest;
  markets: readonly Readonly<{
    marketId: string;
    kind: string;
    status: "active";
    poolId: string;
    baseAsset: Readonly<{
      assetId: string;
      identity: Readonly<{ namespace: "eip155:1"; value: string }>;
      name: string;
      symbol: string;
      decimals: number;
    }>;
    quoteAsset: Readonly<{
      assetId: string;
      identity: Readonly<{ namespace: "eip155:1"; value: string }>;
      name: string;
      symbol: string;
      decimals: number;
    }>;
    tradeCapability: Readonly<DiscoverableMarketTradeCapabilityV1>;
  }>[];
}>;

export type RouterTradeAdapterV1 = Readonly<{
  adapterId: string;
  projectId: Sha256Digest;
  chainId: "1";
  chainProfileId: string;
  chainProfileHash: Sha256Digest;
  launchId: `0x${string}`;
  stampHash: `0x${string}`;
  tokenAddress: string;
  tokenRuntimeCodeKeccak256: `0x${string}`;
  tokenRuntimeCodeSha256: Sha256Digest;
  hookAddress: string;
  hookRuntimeCodeKeccak256: `0x${string}`;
  hookRuntimeCodeSha256: Sha256Digest;
  runtimeTargets: readonly RouterTradeRuntimeTargetV1[];
  sourceEvidence: RouterTradeSourceEvidenceV1 | null;
  executionEvidence: RouterTradeExecutionEvidenceV1 | null;
  market: Readonly<DiscoverableLaunchMarketV2>;
  project: RouterTradeProjectV1;
}>;

const NATIVE_ETH = "0x0000000000000000000000000000000000000000";
const ROUTER = "0x8622dd5bab44185f2a458ac90384ac99248f8d56";
const ROUTER_RUNTIME_KECCAK256 =
  "0x40e27ecf201761d5eb66bc4f2d5c6124831ef078d7baf458ca5f41b1a8108546";
const ROUTER_RUNTIME_SHA256 =
  "sha256:0b0e89074bff270bd5bf80ca9642f748dca1857d1ab643cbce65f4f663937ec7";
const GRAPH_LAUNCHER = "0xb012e4a8f2c5fc4e8e4faca9d5ad6fff13fba887";
const GRAPH_LAUNCHER_RUNTIME_KECCAK256 =
  "0xd23692fae59331592048e71a96d4963e170ee56e449683dc9f7fa3f9470018b8";
const GRAPH_LAUNCHER_RUNTIME_SHA256 =
  "sha256:bf848fd04d0fc1bcb9d4d206a70ad7f6348c16b6127dadc97a09ad5f9a5c7fe6";

const SHARD_ROUTER_TRADE_ADAPTER_ID =
  "router-custom-shards-v1-trade-v1" as const;
export const SHARD_ROUTER_TRADE_MARKET_ID = "shard-eth-v4" as const;

const SHARD_LAUNCH_ID =
  "0xe253f3bd22fcb3d6cb20b9d408287e30f0f1aeeb56426b779425c35fd6411de9" as const;
const SHARD_STAMP_HASH =
  "0x55fbb83ac4599303b146cb4a2f7c1c906d8b3e9fe4fbbe5bf9cf44e905cc3ce0" as const;
const SHARD_TOKEN = "0xface73b63787960282f2d4682d3752beb25271ad" as const;
const SHARD_HOOK = "0x07a16735325723fea4f4a52ed5e9da687766a0cc" as const;
const SHARD_POOL_ID =
  "0x9c74d6183b1ee526a62db562a81da3bf579b5bd6bff5066ae985265a7028e010" as const;
const SHARD_CREATOR = "0xceebb3a6543cebeb2ed66963897a0abea52a50cc" as const;
const SHARD_POOL_KEY_HASH =
  "0x0175cb3f34e2c37f757216a259adea4ab10baf3f9095c67d9481800222fd17f0" as const;
const SHARD_COMPONENT_SET_HASH =
  "0x4d4617e5d86bfb2b1ed32b5405748fb9e145301bc94f2d6c0fed75b6d7d1181b" as const;
const SHARD_ROUTE_PAYLOAD_HASH =
  "0xeffcfc0e6ed62584d058cc4341759b9ab53d10adfa2a7025a9602cd0348b7f8a" as const;
const SHARD_EXPECTED_RESULT_HASH =
  "0xd24ddbf3de8bff936bc6ca619d27fe2f7724a11a468bc270d943e94a7fa0c97b" as const;
const SHARD_PERMIT_DIGEST =
  "0x3a0b99a166eebd77e96dbcbf1a6743ed36086a9fa670033cd38044cc5ccddd65" as const;
const SHARD_TOKEN_RUNTIME_KECCAK256 =
  "0xb2737fd93f2ff31e850e2be773e6e7a92a239b28091be1d4b122ff864cd7aae8" as const;
const SHARD_TOKEN_RUNTIME_SHA256 =
  "sha256:16a72db1a7482fc5dfd1c227e9f2308a3be224378feef7227b36b76418d94baa" as const;
const SHARD_HOOK_RUNTIME_KECCAK256 =
  "0x168f82b0d458a35676522562489b2fec71929e4717c3d98b4893ef63e69e8da6" as const;
const SHARD_HOOK_RUNTIME_SHA256 =
  "sha256:64010636d11620eb3e646793b19a051573097bd1859958b6413e6c6c15469493" as const;

const SHARD_COMPONENTS = Object.freeze([
  Object.freeze({
    label: "SHARD hook",
    address: SHARD_HOOK,
    kind: "hook" as const,
    logIndex: 261,
    runtimeCodeKeccak256: SHARD_HOOK_RUNTIME_KECCAK256,
    runtimeCodeSha256: SHARD_HOOK_RUNTIME_SHA256,
  }),
  Object.freeze({
    label: "SHARD NFT",
    address: "0x92822e03d9cc1b2b497647b159ce5207cd721527",
    kind: "other" as const,
    logIndex: 262,
    runtimeCodeKeccak256:
      "0xeda14b13a8bccff56fc8ea69839a1c37992dbda04299127721aec624eda17fdf",
    runtimeCodeSha256:
      "sha256:7b190926781870f0695cbd4723619fbb4fc4e9f39bb2e0cd7b50feac1ea1c91c",
  }),
  Object.freeze({
    label: "SHARD exclusive component 3",
    address: "0xb3138020c5bea016e82e67738bd18b2ec70f64c0",
    kind: "other" as const,
    logIndex: 263,
    runtimeCodeKeccak256:
      "0xfd5ec0db7c4fa4c9fa81b1a9af1407b349309455922e0792fdd567a1b1f64984",
    runtimeCodeSha256:
      "sha256:9b4d13808ee23d7299a3fcab0d30c81840845f9749bd3dbc793b39cab83ca9df",
  }),
  Object.freeze({
    label: "SHARD renderer",
    address: "0xc19bb8d28683f188a05767233c62e29292734af1",
    kind: "other" as const,
    logIndex: 264,
    runtimeCodeKeccak256:
      "0x56ab6967c0eaaaadaf1b99e55e57187535b6b64e40fd7f7d5d03614de20a9a51",
    runtimeCodeSha256:
      "sha256:5f16a25fa0e1c4d6907516d13ad10235b07353fd991b24d3a391f8bd6447110d",
  }),
  Object.freeze({
    label: "SHARD token",
    address: SHARD_TOKEN,
    kind: "token" as const,
    logIndex: 265,
    runtimeCodeKeccak256: SHARD_TOKEN_RUNTIME_KECCAK256,
    runtimeCodeSha256: SHARD_TOKEN_RUNTIME_SHA256,
  }),
]);

const SHARD_EXCLUSIVE_PROOF = Object.freeze({
  launchId: SHARD_LAUNCH_ID,
  stampHash: SHARD_STAMP_HASH,
});

/**
 * Exact finalized Router evidence document reviewed for this adapter. The
 * evidence hashes below intentionally bind this complete canonical preimage,
 * rather than treating a runtime digest as if it proved asset or PoolKey
 * identity on its own.
 */
export const SHARD_REVIEWED_LAUNCH_STAMP_EVIDENCE_V1 = Object.freeze({
  schemaVersion: "programmable.launch-stamp-provenance.v1",
  chainId: 1,
  routerAddress: "0x8622DD5bAb44185f2A458ac90384Ac99248f8d56",
  routerRuntimeCodeHash: ROUTER_RUNTIME_KECCAK256,
  routerStartBlock: "25717612",
  finalityConfirmations: 64,
  kind: "custom-graph",
  launchId: SHARD_LAUNCH_ID,
  stampHash: SHARD_STAMP_HASH,
  launchWallet: "0xceeBB3A6543CeBEB2ED66963897A0abEA52A50cC",
  transactionHash:
    "0x629d864a7b5e5d75bb334d23f253b12559a2b73ea368a0d1726ec11d64067325",
  blockNumber: "25845408",
  blockHash:
    "0x5c1a2b58f2ea51ce4cba85eadeefe1d52df46beeffabe690407ece05d44a281f",
  transactionIndex: 25,
  routeLogIndex: 266,
  launchLogIndex: 267,
  finalizedAtBlockNumber: "25845472",
  finalizedAtBlockHash:
    "0x27a50f4ef518dd04bfe23cb666f633436fe4b6ed684f168c1b95fa1e7741c16a",
  poolManagerAddress: "0x000000000004444c5dc75cB358380D2e3dE08A90",
  poolId: SHARD_POOL_ID,
  poolKey: Object.freeze({
    currency0: NATIVE_ETH,
    currency1: "0xFAce73B63787960282f2d4682d3752Beb25271Ad",
    fee: 0,
    tickSpacing: 60,
    hooks: "0x07a16735325723fEa4f4a52ED5E9da687766A0Cc",
  }),
  poolKeyHash: SHARD_POOL_KEY_HASH,
  componentSetHash: SHARD_COMPONENT_SET_HASH,
  routePayloadHash: SHARD_ROUTE_PAYLOAD_HASH,
  routeLauncherAddress: "0xB012e4A8F2c5FC4E8E4faCA9D5Ad6FfF13FBA887",
  routeLauncherRuntimeCodeHash: GRAPH_LAUNCHER_RUNTIME_KECCAK256,
  expectedResultHash: SHARD_EXPECTED_RESULT_HASH,
  permitDigest: SHARD_PERMIT_DIGEST,
  components: Object.freeze([
    Object.freeze({
      address: "0x07a16735325723fEa4f4a52ED5E9da687766A0Cc",
      kind: "hook",
      scope: "exclusive",
      runtimeCodeHash: SHARD_HOOK_RUNTIME_KECCAK256,
      logIndex: 261,
      exclusiveProof: SHARD_EXCLUSIVE_PROOF,
    }),
    Object.freeze({
      address: "0x92822e03D9cc1b2b497647B159ce5207Cd721527",
      kind: "other",
      scope: "exclusive",
      runtimeCodeHash:
        "0xeda14b13a8bccff56fc8ea69839a1c37992dbda04299127721aec624eda17fdf",
      logIndex: 262,
      exclusiveProof: SHARD_EXCLUSIVE_PROOF,
    }),
    Object.freeze({
      address: "0xb3138020C5bEa016E82e67738BD18b2EC70f64c0",
      kind: "other",
      scope: "exclusive",
      runtimeCodeHash:
        "0xfd5ec0db7c4fa4c9fa81b1a9af1407b349309455922e0792fdd567a1b1f64984",
      logIndex: 263,
      exclusiveProof: SHARD_EXCLUSIVE_PROOF,
    }),
    Object.freeze({
      address: "0xc19bB8D28683F188A05767233c62E29292734Af1",
      kind: "other",
      scope: "exclusive",
      runtimeCodeHash:
        "0x56ab6967c0eaaaadaf1b99e55e57187535b6b64e40fd7f7d5d03614de20a9a51",
      logIndex: 264,
      exclusiveProof: SHARD_EXCLUSIVE_PROOF,
    }),
    Object.freeze({
      address: "0xFAce73B63787960282f2d4682d3752Beb25271Ad",
      kind: "token",
      scope: "exclusive",
      runtimeCodeHash: SHARD_TOKEN_RUNTIME_KECCAK256,
      logIndex: 265,
      exclusiveProof: SHARD_EXCLUSIVE_PROOF,
    }),
  ]),
  tokenProof: Object.freeze({
    tokenAddress: "0xFAce73B63787960282f2d4682d3752Beb25271Ad",
    launchId: SHARD_LAUNCH_ID,
    stampHash: SHARD_STAMP_HASH,
  }),
  poolProof: Object.freeze({
    poolManagerAddress: "0x000000000004444c5dc75cB358380D2e3dE08A90",
    poolId: SHARD_POOL_ID,
    launchId: SHARD_LAUNCH_ID,
    stampHash: SHARD_STAMP_HASH,
  }),
} as const satisfies LaunchStampProvenanceV1);

export const SHARD_REVIEWED_LAUNCH_STAMP_EVIDENCE_HASH = canonicalSha256(
  SHARD_REVIEWED_LAUNCH_STAMP_EVIDENCE_V1.schemaVersion,
  SHARD_REVIEWED_LAUNCH_STAMP_EVIDENCE_V1,
);

// Router-only projects have no Registry project id. Their public project
// identity is therefore the authenticated canonical LaunchStamp evidence
// digest itself, not a second project-specific alias.
export const SHARD_ROUTER_TRADE_PROJECT_ID =
  SHARD_REVIEWED_LAUNCH_STAMP_EVIDENCE_HASH;

const SHARD_SOURCE_EVIDENCE = Object.freeze({
  repository: "https://github.com/chaosxcode/shards-v1.git",
  commit: "d9533609fadae8fcf9e57076520f5814c2026f9d",
  tree: "c4a465696579fc101730513aa3a0195b3757f15a",
  sourcePath: "src/ShardTokenV1.sol",
  sourceSha256:
    "sha256:5c53920c52c69a87b38159d8a06285a2006e69773543ad72f2b5eb92f63ee22d",
  compilerVersion: "0.8.26+commit.8a97fa7a",
  evmVersion: "cancun",
  optimizerEnabled: true,
  optimizerRuns: 1_000,
  metadataBytecodeHash: "none",
  metadataAppendCbor: false,
  exactTokenRuntimeMatch: true,
  noTransferTax: true,
  noPause: true,
  noBlocklist: true,
} as const satisfies RouterTradeSourceEvidenceV1);

const FADE_RUNTIME_TARGETS = Object.freeze([
  Object.freeze({
    label: "FADE token",
    address: FADE_ROUTER_TRADE_ADAPTER_V1.tokenAddress,
    runtimeCodeKeccak256:
      FADE_ROUTER_TRADE_ADAPTER_V1.tokenRuntimeCodeKeccak256,
    runtimeCodeSha256: FADE_ROUTER_TRADE_ADAPTER_V1.tokenRuntimeCodeSha256,
  }),
  Object.freeze({
    label: "FADE hook",
    address: FADE_ROUTER_TRADE_ADAPTER_V1.hookAddress,
    runtimeCodeKeccak256:
      FADE_ROUTER_TRADE_ADAPTER_V1.hookRuntimeCodeKeccak256,
    runtimeCodeSha256: FADE_ROUTER_TRADE_ADAPTER_V1.hookRuntimeCodeSha256,
  }),
] as const satisfies readonly RouterTradeRuntimeTargetV1[]);

const fadeProject = fadeRouterTradeProjectForEntryV1 as (
  entry: CanonicalTokenExploreEntry,
) => RouterTradeProjectV1 | null;

const FADE_REVIEWED_ROUTER_TRADE_ADAPTER_V1 = Object.freeze({
  ...FADE_ROUTER_TRADE_ADAPTER_V1,
  runtimeTargets: FADE_RUNTIME_TARGETS,
  sourceEvidence: null,
  executionEvidence: null,
  project: Object.freeze({
    customProjectId: FADE_ROUTER_TRADE_PROJECT_ID,
    markets: Object.freeze([]),
  }),
} as const satisfies RouterTradeAdapterV1);

function reviewedTradeCapabilityV1(input: Readonly<{
  capabilityId: string;
  marketId: string;
  baseAssetId: string;
  quoteAssetId: string;
  poolKey: DiscoverableMarketTradeCapabilityV1["poolKey"];
  supportedSides: DiscoverableMarketTradeCapabilityV1["supportedSides"];
  dependencies: DiscoverableMarketTradeCapabilityV1["dependencies"];
  chainProfileId: string;
  chainProfileHash: Sha256Digest;
  poolKeyEvidenceHash: Sha256Digest;
  marketVerificationBindingHash: Sha256Digest;
  hookAssetIdentityEvidenceHash: Sha256Digest;
}>): Readonly<DiscoverableMarketTradeCapabilityV1> {
  const sideBindings = Object.freeze(input.supportedSides.map((side) => {
    const baseIsCurrency0 = input.poolKey.currency0AssetId === input.baseAssetId;
    const zeroForOne = side === "base-to-quote"
      ? baseIsCurrency0
      : !baseIsCurrency0;
    const inputAssetId = side === "base-to-quote"
      ? input.baseAssetId
      : input.quoteAssetId;
    const outputAssetId = side === "base-to-quote"
      ? input.quoteAssetId
      : input.baseAssetId;
    const inputCurrency = zeroForOne
      ? input.poolKey.currency0
      : input.poolKey.currency1;
    return Object.freeze({
      side,
      inputAssetId,
      outputAssetId,
      zeroForOne,
      inputCurrencyKind: inputCurrency.value === NATIVE_ETH
        ? "native" as const
        : "erc20" as const,
      settlementAction: "SETTLE_ALL" as const,
      takeAction: "TAKE_ALL" as const,
    });
  }));
  const hookDataPolicy = Object.freeze({
    kind: "empty" as const,
    data: "0x" as const,
    hookDataHash: canonicalSha256(
      "programmable.discoverable-market-trade-capability-hook-data.v1",
      { data: "0x" },
    ),
  });
  const actionPolicy = Object.freeze({
    swapAction: "SWAP_EXACT_IN_SINGLE" as const,
    settleAction: "SETTLE_ALL" as const,
    takeAction: "TAKE_ALL" as const,
    multiHop: false as const,
    exactOutput: false as const,
  });
  const quotePolicy = Object.freeze({
    adapterId: "uniswap-v4-quoter-exact-input:v1" as const,
    executionMode: "offchain-static-call-only" as const,
    currentStateRequired: true as const,
    maximumQuoteAgeSeconds: 30,
  });
  const slippagePolicy = Object.freeze({
    kind: "user-bounded-minimum-output" as const,
    amountOutMinimumRequired: true as const,
    maximumSlippageBps: 500,
  });
  const deadlinePolicy = Object.freeze({
    kind: "bounded-user-deadline" as const,
    deadlineRequired: true as const,
    maximumHorizonSeconds: 300,
  });
  const approvalPolicy = Object.freeze({
    erc20Input: "erc20-approve-permit2-then-permit2-approve-router" as const,
    nativeInput: "transaction-value" as const,
  });
  const plan = Object.freeze({
    schemaVersion:
      "programmable.discoverable-market-trade-capability-plan.v1" as const,
    capabilityId: input.capabilityId,
    adapterId: "uniswap-v4-universal-router-exact-input:v1" as const,
    chainId: "1",
    chainProfileId: input.chainProfileId,
    chainProfileHash: input.chainProfileHash,
    marketId: input.marketId,
    baseAssetId: input.baseAssetId,
    quoteAssetId: input.quoteAssetId,
    poolKey: input.poolKey,
    routerGeneration: "universal-router:v2.2",
    dependencies: input.dependencies,
    supportedSides: input.supportedSides,
    sideBindings,
    exactness: "exact-input" as const,
    hookDataPolicy,
    actionPolicy,
    quotePolicy,
    slippagePolicy,
    deadlinePolicy,
    approvalPolicy,
    recipientPolicy: "connected-wallet-only" as const,
  });
  const planBindingHash = canonicalSha256(
    "programmable.discoverable-market-trade-capability-plan-binding.v1",
    plan,
  );
  const final = Object.freeze({
    ...plan,
    schemaVersion:
      "programmable.discoverable-market-trade-capability.v1" as const,
    planBindingHash,
    status: "verified" as const,
    poolKeyEvidenceHash: input.poolKeyEvidenceHash,
    marketVerificationBindingHash: input.marketVerificationBindingHash,
    hookAssetIdentityEvidenceHash: input.hookAssetIdentityEvidenceHash,
  });
  return Object.freeze({
    ...final,
    tradeCapabilityBindingHash: canonicalSha256(
      "programmable.discoverable-market-trade-capability-binding.v1",
      final,
    ),
  });
}

const FADE_CAPABILITY = FADE_ROUTER_TRADE_ADAPTER_V1.market.tradeCapability!;

const SHARD_EXECUTION_EVIDENCE = Object.freeze({
  kind: "pinned-mainnet-fork-buy-and-sell",
  blockNumber: "25845702",
  blockHash:
    "0x9b66ed9e03b143acf510a9bf60c8c9fed0a1beecc07184f8501167407e2bb0fe",
  universalRouter: "0xd92a36b0000531ef3063ded4de20a0783308446c",
  universalRouterCommand: "0x10",
  actions: Object.freeze([
    "SWAP_EXACT_IN_SINGLE",
    "SETTLE_ALL",
    "TAKE_ALL",
  ]),
  hookData: "0x",
  buy: Object.freeze({
    amountIn: "10000000000000",
    quotedAmountOut: "5536509674431677",
    executedAmountOut: "5536509674431677",
    routeCalldataHash:
      "0xf4105d6a4978a9b4c1362fa87304a2c4cf039fc7f311681220ce576e5b84822c",
    estimatedGas: "204152",
    executedGas: "195629",
  }),
  sell: Object.freeze({
    amountIn: "1000000000000000000",
    quotedAmountOut: "1770030683891720",
    executedAmountOut: "1770030683891720",
    routeCalldataHash:
      "0x3396e7d033168d0083b6f4cbe85b5a0d9f21c56c576a2c37ad8dc54584caedd7",
    estimatedGas: "212512",
    executedGas: "196948",
  }),
  quoteMatchedExecution: true,
  noMainnetBroadcast: true,
} as const satisfies RouterTradeExecutionEvidenceV1);

export const SHARD_ROUTER_TRADE_CAPABILITY_V1 = reviewedTradeCapabilityV1({
  capabilityId: "trade:router-custom-shards-v1",
  marketId: SHARD_ROUTER_TRADE_MARKET_ID,
  baseAssetId: "shard-token",
  quoteAssetId: "native-eth",
  poolKey: Object.freeze({
    poolId: SHARD_POOL_ID,
    currency0AssetId: "native-eth",
    currency0: Object.freeze({ namespace: "eip155:1", value: NATIVE_ETH }),
    currency1AssetId: "shard-token",
    currency1: Object.freeze({ namespace: "eip155:1", value: SHARD_TOKEN }),
    feeRaw: "0",
    tickSpacing: "60",
    hooksAssetId: "shards-v1-hook",
    hooks: Object.freeze({ namespace: "eip155:1", value: SHARD_HOOK }),
  }),
  dependencies: FADE_CAPABILITY.dependencies,
  supportedSides: Object.freeze(["base-to-quote", "quote-to-base"]),
  chainProfileId: FADE_CAPABILITY.chainProfileId,
  chainProfileHash: FADE_CAPABILITY.chainProfileHash,
  poolKeyEvidenceHash: SHARD_REVIEWED_LAUNCH_STAMP_EVIDENCE_HASH,
  marketVerificationBindingHash: SHARD_REVIEWED_LAUNCH_STAMP_EVIDENCE_HASH,
  hookAssetIdentityEvidenceHash: SHARD_REVIEWED_LAUNCH_STAMP_EVIDENCE_HASH,
});

export const SHARD_ROUTER_TRADE_MARKET_V1 = Object.freeze({
  marketId: SHARD_ROUTER_TRADE_MARKET_ID,
  kind: "uniswap-v4-hooked-pool",
  status: "active",
  marketAssetId: "shard-eth-v4-pool",
  baseAssetId: "shard-token",
  quoteAssetId: "native-eth",
  marketEvidenceHash: SHARD_REVIEWED_LAUNCH_STAMP_EVIDENCE_HASH,
  verification: Object.freeze({
    status: "verified",
    verifierAdapterId: SHARD_ROUTER_TRADE_ADAPTER_ID,
    verifierBindingHash: SHARD_REVIEWED_LAUNCH_STAMP_EVIDENCE_HASH,
  }),
  uniswapV4: Object.freeze({
    poolId: SHARD_POOL_ID,
    poolManager: FADE_ROUTER_TRADE_ADAPTER_V1.market.uniswapV4!.poolManager,
    poolManagerReviewEvidenceBindingHash:
      FADE_ROUTER_TRADE_ADAPTER_V1.market.uniswapV4!
        .poolManagerReviewEvidenceBindingHash,
    poolManagerInterfaceEvidenceBindingHash:
      FADE_ROUTER_TRADE_ADAPTER_V1.market.uniswapV4!
        .poolManagerInterfaceEvidenceBindingHash,
    poolManagerRuntimeCodeKeccak256:
      FADE_ROUTER_TRADE_ADAPTER_V1.market.uniswapV4!
        .poolManagerRuntimeCodeKeccak256,
    poolManagerRuntimeCodeSha256:
      FADE_ROUTER_TRADE_ADAPTER_V1.market.uniswapV4!
        .poolManagerRuntimeCodeSha256,
    currency0AssetId: "native-eth",
    currency1AssetId: "shard-token",
    feeRaw: "0",
    dynamicFee: false,
    tickSpacing: "60",
    hooksAssetId: "shards-v1-hook",
    poolKeyEvidenceHash: SHARD_REVIEWED_LAUNCH_STAMP_EVIDENCE_HASH,
  }),
  tradeCapability: SHARD_ROUTER_TRADE_CAPABILITY_V1,
} as const satisfies DiscoverableLaunchMarketV2);

const SHARD_ROUTER_TRADE_PROJECT_V1 = Object.freeze({
  customProjectId: SHARD_ROUTER_TRADE_PROJECT_ID,
  markets: Object.freeze([Object.freeze({
    marketId: SHARD_ROUTER_TRADE_MARKET_ID,
    kind: SHARD_ROUTER_TRADE_MARKET_V1.kind,
    status: "active" as const,
    poolId: SHARD_POOL_ID,
    baseAsset: Object.freeze({
      assetId: "shard-token",
      identity: Object.freeze({ namespace: "eip155:1" as const, value: SHARD_TOKEN }),
      name: "Shard",
      symbol: "SHARD",
      decimals: 18,
    }),
    quoteAsset: Object.freeze({
      assetId: "native-eth",
      identity: Object.freeze({ namespace: "eip155:1" as const, value: NATIVE_ETH }),
      name: "Ether",
      symbol: "ETH",
      decimals: 18,
    }),
    tradeCapability: SHARD_ROUTER_TRADE_CAPABILITY_V1,
  })]),
} as const satisfies RouterTradeProjectV1);

const SHARD_RUNTIME_TARGETS = Object.freeze([
  Object.freeze({
    label: "Launch Stamp Router",
    address: ROUTER,
    runtimeCodeKeccak256: ROUTER_RUNTIME_KECCAK256,
    runtimeCodeSha256: ROUTER_RUNTIME_SHA256,
  }),
  Object.freeze({
    label: "Graph launcher",
    address: GRAPH_LAUNCHER,
    runtimeCodeKeccak256: GRAPH_LAUNCHER_RUNTIME_KECCAK256,
    runtimeCodeSha256: GRAPH_LAUNCHER_RUNTIME_SHA256,
  }),
  ...SHARD_COMPONENTS.map((component) => Object.freeze({
    label: component.label,
    address: component.address,
    runtimeCodeKeccak256: component.runtimeCodeKeccak256,
    runtimeCodeSha256: component.runtimeCodeSha256,
  })),
] as const satisfies readonly RouterTradeRuntimeTargetV1[]);

export const SHARD_ROUTER_TRADE_ADAPTER_V1 = Object.freeze({
  adapterId: SHARD_ROUTER_TRADE_ADAPTER_ID,
  projectId: SHARD_ROUTER_TRADE_PROJECT_ID,
  chainId: "1",
  chainProfileId: FADE_CAPABILITY.chainProfileId,
  chainProfileHash: FADE_CAPABILITY.chainProfileHash,
  launchId: SHARD_LAUNCH_ID,
  stampHash: SHARD_STAMP_HASH,
  tokenAddress: SHARD_TOKEN,
  tokenRuntimeCodeKeccak256: SHARD_TOKEN_RUNTIME_KECCAK256,
  tokenRuntimeCodeSha256: SHARD_TOKEN_RUNTIME_SHA256,
  hookAddress: SHARD_HOOK,
  hookRuntimeCodeKeccak256: SHARD_HOOK_RUNTIME_KECCAK256,
  hookRuntimeCodeSha256: SHARD_HOOK_RUNTIME_SHA256,
  runtimeTargets: SHARD_RUNTIME_TARGETS,
  sourceEvidence: SHARD_SOURCE_EVIDENCE,
  executionEvidence: SHARD_EXECUTION_EVIDENCE,
  market: SHARD_ROUTER_TRADE_MARKET_V1,
  project: SHARD_ROUTER_TRADE_PROJECT_V1,
} as const satisfies RouterTradeAdapterV1);

function sameHex(left: unknown, right: unknown) {
  return typeof left === "string" && typeof right === "string"
    && left.toLowerCase() === right.toLowerCase();
}

function exactShardComponents(stamp: LaunchStampProvenanceV1) {
  return stamp.components.length === SHARD_COMPONENTS.length
    && SHARD_COMPONENTS.every((expected, index) => {
      const component = stamp.components[index];
      return component !== undefined
        && component.kind === expected.kind
        && component.scope === "exclusive"
        && component.logIndex === expected.logIndex
        && sameHex(component.address, expected.address)
        && sameHex(
          component.runtimeCodeHash,
          expected.runtimeCodeKeccak256,
        )
        && component.exclusiveProof !== null
        && sameHex(component.exclusiveProof.launchId, SHARD_LAUNCH_ID)
        && sameHex(component.exclusiveProof.stampHash, SHARD_STAMP_HASH);
    });
}

function resolveShardRouterTradeAdapterV1(
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
      tokenAddress: SHARD_TOKEN,
      hookAddress: SHARD_HOOK,
      poolId: SHARD_POOL_ID,
      launchWallet: SHARD_CREATOR,
    })
    || !sameHex(entry.tokenAddress, SHARD_TOKEN)
    || !sameHex(entry.hookAddress, SHARD_HOOK)
    || !sameHex(entry.poolId, SHARD_POOL_ID)
    || !sameHex(stamp.routerAddress, ROUTER)
    || !sameHex(stamp.routerRuntimeCodeHash, ROUTER_RUNTIME_KECCAK256)
    || stamp.routerStartBlock !== "25717612"
    || stamp.finalityConfirmations !== 64
    || !sameHex(stamp.launchId, SHARD_LAUNCH_ID)
    || !sameHex(stamp.stampHash, SHARD_STAMP_HASH)
    || !sameHex(stamp.launchWallet, SHARD_CREATOR)
    || !sameHex(
      stamp.transactionHash,
      "0x629d864a7b5e5d75bb334d23f253b12559a2b73ea368a0d1726ec11d64067325",
    )
    || stamp.blockNumber !== "25845408"
    || !sameHex(
      stamp.blockHash,
      "0x5c1a2b58f2ea51ce4cba85eadeefe1d52df46beeffabe690407ece05d44a281f",
    )
    || stamp.transactionIndex !== 25
    || stamp.routeLogIndex !== 266
    || stamp.launchLogIndex !== 267
    || stamp.finalizedAtBlockNumber !== "25845472"
    || !sameHex(
      stamp.finalizedAtBlockHash,
      "0x27a50f4ef518dd04bfe23cb666f633436fe4b6ed684f168c1b95fa1e7741c16a",
    )
    || !sameHex(
      stamp.poolManagerAddress,
      "0x000000000004444c5dc75cb358380d2e3de08a90",
    )
    || !sameHex(stamp.poolId, SHARD_POOL_ID)
    || !sameHex(stamp.poolKeyHash, SHARD_POOL_KEY_HASH)
    || !sameHex(stamp.poolKey.currency0, NATIVE_ETH)
    || !sameHex(stamp.poolKey.currency1, SHARD_TOKEN)
    || stamp.poolKey.fee !== 0
    || stamp.poolKey.tickSpacing !== 60
    || !sameHex(stamp.poolKey.hooks, SHARD_HOOK)
    || !sameHex(stamp.componentSetHash, SHARD_COMPONENT_SET_HASH)
    || !sameHex(stamp.routePayloadHash, SHARD_ROUTE_PAYLOAD_HASH)
    || !sameHex(stamp.routeLauncherAddress, GRAPH_LAUNCHER)
    || !sameHex(
      stamp.routeLauncherRuntimeCodeHash,
      GRAPH_LAUNCHER_RUNTIME_KECCAK256,
    )
    || !sameHex(stamp.expectedResultHash, SHARD_EXPECTED_RESULT_HASH)
    || !sameHex(stamp.permitDigest, SHARD_PERMIT_DIGEST)
    || !exactShardComponents(stamp)
    || !sameHex(category.launchId, stamp.launchId)
    || !sameHex(category.stampHash, stamp.stampHash)
    || !sameHex(category.routerAddress, stamp.routerAddress)
    || !sameHex(category.transactionHash, stamp.transactionHash)
    || !sameHex(category.blockHash, stamp.blockHash)
    || category.blockNumber !== stamp.blockNumber
    || category.transactionIndex !== stamp.transactionIndex
    || category.logIndex !== stamp.launchLogIndex
  ) return null;
  return SHARD_ROUTER_TRADE_ADAPTER_V1;
}

const ROUTER_TRADE_ADAPTERS = Object.freeze([
  Object.freeze({
    adapter: FADE_REVIEWED_ROUTER_TRADE_ADAPTER_V1,
    resolve(entry: CanonicalTokenExploreEntry) {
      const resolved = resolveFadeRouterTradeAdapterV1(entry);
      if (resolved === null) return null;
      const project = fadeProject(entry);
      return project === null
        ? null
        : Object.freeze({
            ...FADE_REVIEWED_ROUTER_TRADE_ADAPTER_V1,
            project,
          });
    },
  }),
  Object.freeze({
    adapter: SHARD_ROUTER_TRADE_ADAPTER_V1,
    resolve: resolveShardRouterTradeAdapterV1,
  }),
]);

export function resolveRouterTradeAdapterV1(
  entry: CanonicalTokenExploreEntry,
): RouterTradeAdapterV1 | null {
  for (const reviewed of ROUTER_TRADE_ADAPTERS) {
    const adapter = reviewed.resolve(entry);
    if (adapter !== null) return adapter;
  }
  return null;
}

export function routerTradeAdapterForProjectIdV1(projectId: string) {
  return ROUTER_TRADE_ADAPTERS.find(
    ({ adapter }) => adapter.projectId === projectId,
  )?.adapter ?? null;
}

export function routerTradeProjectForEntryV1(
  entry: CanonicalTokenExploreEntry,
): RouterTradeProjectV1 | null {
  return resolveRouterTradeAdapterV1(entry)?.project ?? null;
}
