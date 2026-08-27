import type {
  CanonicalTokenExploreEntry,
  LaunchStampProvenanceV1,
} from "../lib/tokens";

const LAUNCH_ID =
  "0xe253f3bd22fcb3d6cb20b9d408287e30f0f1aeeb56426b779425c35fd6411de9" as const;
const STAMP_HASH =
  "0x55fbb83ac4599303b146cb4a2f7c1c906d8b3e9fe4fbbe5bf9cf44e905cc3ce0" as const;
const TOKEN = "0xFAce73B63787960282f2d4682d3752Beb25271Ad" as const;
const HOOK = "0x07a16735325723fEa4f4a52ED5E9da687766A0Cc" as const;
const POOL_ID =
  "0x9c74d6183b1ee526a62db562a81da3bf579b5bd6bff5066ae985265a7028e010" as const;

const exclusiveProof = Object.freeze({ launchId: LAUNCH_ID, stampHash: STAMP_HASH });

export const shardRouterTradeStamp = Object.freeze({
  schemaVersion: "programmable.launch-stamp-provenance.v1",
  chainId: 1,
  routerAddress: "0x8622DD5bAb44185f2A458ac90384Ac99248f8d56",
  routerRuntimeCodeHash:
    "0x40e27ecf201761d5eb66bc4f2d5c6124831ef078d7baf458ca5f41b1a8108546",
  routerStartBlock: "25717612",
  finalityConfirmations: 64,
  kind: "custom-graph",
  launchId: LAUNCH_ID,
  stampHash: STAMP_HASH,
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
  poolId: POOL_ID,
  poolKey: Object.freeze({
    currency0: "0x0000000000000000000000000000000000000000",
    currency1: TOKEN,
    fee: 0,
    tickSpacing: 60,
    hooks: HOOK,
  }),
  poolKeyHash:
    "0x0175cb3f34e2c37f757216a259adea4ab10baf3f9095c67d9481800222fd17f0",
  componentSetHash:
    "0x4d4617e5d86bfb2b1ed32b5405748fb9e145301bc94f2d6c0fed75b6d7d1181b",
  routePayloadHash:
    "0xeffcfc0e6ed62584d058cc4341759b9ab53d10adfa2a7025a9602cd0348b7f8a",
  routeLauncherAddress: "0xB012e4A8F2c5FC4E8E4faCA9D5Ad6FfF13FBA887",
  routeLauncherRuntimeCodeHash:
    "0xd23692fae59331592048e71a96d4963e170ee56e449683dc9f7fa3f9470018b8",
  expectedResultHash:
    "0xd24ddbf3de8bff936bc6ca619d27fe2f7724a11a468bc270d943e94a7fa0c97b",
  permitDigest:
    "0x3a0b99a166eebd77e96dbcbf1a6743ed36086a9fa670033cd38044cc5ccddd65",
  components: Object.freeze([
    Object.freeze({
      address: HOOK,
      kind: "hook",
      scope: "exclusive",
      runtimeCodeHash:
        "0x168f82b0d458a35676522562489b2fec71929e4717c3d98b4893ef63e69e8da6",
      logIndex: 261,
      exclusiveProof,
    }),
    Object.freeze({
      address: "0x92822e03D9cc1b2b497647B159ce5207Cd721527",
      kind: "other",
      scope: "exclusive",
      runtimeCodeHash:
        "0xeda14b13a8bccff56fc8ea69839a1c37992dbda04299127721aec624eda17fdf",
      logIndex: 262,
      exclusiveProof,
    }),
    Object.freeze({
      address: "0xb3138020C5bEa016E82e67738BD18b2EC70f64c0",
      kind: "other",
      scope: "exclusive",
      runtimeCodeHash:
        "0xfd5ec0db7c4fa4c9fa81b1a9af1407b349309455922e0792fdd567a1b1f64984",
      logIndex: 263,
      exclusiveProof,
    }),
    Object.freeze({
      address: "0xc19bB8D28683F188A05767233c62E29292734Af1",
      kind: "other",
      scope: "exclusive",
      runtimeCodeHash:
        "0x56ab6967c0eaaaadaf1b99e55e57187535b6b64e40fd7f7d5d03614de20a9a51",
      logIndex: 264,
      exclusiveProof,
    }),
    Object.freeze({
      address: TOKEN,
      kind: "token",
      scope: "exclusive",
      runtimeCodeHash:
        "0xb2737fd93f2ff31e850e2be773e6e7a92a239b28091be1d4b122ff864cd7aae8",
      logIndex: 265,
      exclusiveProof,
    }),
  ]),
  tokenProof: Object.freeze({
    tokenAddress: TOKEN,
    launchId: LAUNCH_ID,
    stampHash: STAMP_HASH,
  }),
  poolProof: Object.freeze({
    poolManagerAddress: "0x000000000004444c5dc75cB358380D2e3dE08A90",
    poolId: POOL_ID,
    launchId: LAUNCH_ID,
    stampHash: STAMP_HASH,
  }),
} as const satisfies LaunchStampProvenanceV1);

export const shardRouterTradeEntry = Object.freeze({
  exploreKind: "token",
  id: `1:${TOKEN.toLowerCase()}`,
  name: "Shard",
  symbol: "SHARD",
  tokenAddress: TOKEN,
  hookAddress: HOOK,
  poolId: POOL_ID,
  creatorAddress: shardRouterTradeStamp.launchWallet,
  launchBlockNumber: shardRouterTradeStamp.blockNumber,
  launchTransactionHash: shardRouterTradeStamp.transactionHash,
  launchTransactionIndex: shardRouterTradeStamp.transactionIndex,
  launchLogIndex: shardRouterTradeStamp.launchLogIndex,
  launchedAt: "2026-08-27T08:37:35.000Z",
  tokenDecimals: 18,
  totalSwapFeeBps: null,
  launchModel: "custom-graph",
  launchModelVersion: "programmable-launch-stamp-router-v1",
  launchStampProvenance: shardRouterTradeStamp,
  liquidityPath: "programmable-v4",
  launchCategoryProvenance: Object.freeze({
    schemaVersion: "programmable.explore-launch-category-provenance.v1",
    category: "custom",
    source: "canonical-launch-stamp-router",
    launchId: LAUNCH_ID,
    stampHash: STAMP_HASH,
    routerAddress: shardRouterTradeStamp.routerAddress,
    transactionHash: shardRouterTradeStamp.transactionHash,
    blockHash: shardRouterTradeStamp.blockHash,
    blockNumber: shardRouterTradeStamp.blockNumber,
    transactionIndex: shardRouterTradeStamp.transactionIndex,
    logIndex: shardRouterTradeStamp.launchLogIndex,
  }),
} as const satisfies CanonicalTokenExploreEntry);
