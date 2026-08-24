import type {
  CanonicalTokenExploreEntry,
  LaunchStampProvenanceV1,
} from "../lib/tokens";

const LAUNCH_ID =
  "0x6d6ed0e1e69a7cd6afa177e3454c9e32eed61cbd3f855ee56aff1915a6776fc2" as const;
const STAMP_HASH =
  "0x5ef9eda88dc8269156b0bea01ae306f3e546b95f719ea17c821003aaa8e0c7e2" as const;
const TOKEN = "0x69D278968AbF120F878F2E1E016Ab615D3686c19" as const; // gitleaks:allow -- public Ethereum token address
const HOOK = "0xd7451a039373f54e493deE42A751fEcBfAFBa0cc" as const;
const POOL_ID =
  "0x6b6f0f8348bb08c7cbaa45cd48b4531e3a206ac7eabcc5355d9ffdd21c4b579a" as const;

const exclusiveProof = Object.freeze({ launchId: LAUNCH_ID, stampHash: STAMP_HASH });

export const fadeRouterTradeStamp = Object.freeze({
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
  launchWallet: "0x2Bb333d48DFAF1596D9036671d2E43168994249E",
  transactionHash:
    "0x59d166bd641913fd8bf83ef577f723969a179048835351aaea8c5d70ec246c27",
  blockNumber: "25827140",
  blockHash:
    "0x8e7f9140383d730cdcedcc78424a3cebedbe3b3619da1e7ecbea71517e46c514",
  transactionIndex: 209,
  routeLogIndex: 640,
  launchLogIndex: 641,
  finalizedAtBlockNumber: "25827615",
  finalizedAtBlockHash:
    "0xaae6a172c32ce6aafa1cdb5f420b9570bb68a092eb00027d07e97e100f35f322",
  poolManagerAddress: "0x000000000004444c5dc75cB358380D2e3dE08A90",
  poolId: POOL_ID,
  poolKey: Object.freeze({
    currency0: "0x0000000000000000000000000000000000000000",
    currency1: TOKEN,
    fee: 0,
    tickSpacing: 200,
    hooks: HOOK,
  }),
  poolKeyHash:
    "0x171e45dee03686a5fb5b737fb688bed60401c209b5034a09112f7a0bddf8d799",
  componentSetHash:
    "0x7cecab66ba13aeb688e0de537d545f1941ad3aacc038faa6a95f177cede0a11f",
  routePayloadHash:
    "0x5cc88cf84405e85792948d055107ef8577fa133f09884b04dbc24bc6718ac433",
  routeLauncherAddress: "0xB012e4A8F2c5FC4E8E4faCA9D5Ad6FfF13FBA887",
  routeLauncherRuntimeCodeHash:
    "0xd23692fae59331592048e71a96d4963e170ee56e449683dc9f7fa3f9470018b8",
  expectedResultHash:
    "0x9c0451b12156de5ab07ff860bcf68475246f429f247f1aeafbfbc653314fd495",
  permitDigest:
    "0x860bb940a82bc6eb9bb24de64217bbd76a6813cc57c18ae843f0359b9c37bf7e",
  components: Object.freeze([
    Object.freeze({
      address: "0x487b8299CD2C5cBb638615F18482B0d3B44A6026",
      kind: "other",
      scope: "exclusive",
      runtimeCodeHash:
        "0xcefd10b60f990984bb60c98eb53e66048bfd36da9b48200e8535f5ca39d58fb2",
      logIndex: 636,
      exclusiveProof,
    }),
    Object.freeze({
      address: "0x5c5B5342696b197A21564ecDDB97915933eF6C9B",
      kind: "other",
      scope: "exclusive",
      runtimeCodeHash:
        "0x9a924353c9d1c0302a190a1e930b02cfddf3e9ccbc9cc441eb5f7f62c39df78e",
      logIndex: 637,
      exclusiveProof,
    }),
    Object.freeze({
      address: TOKEN,
      kind: "token",
      scope: "exclusive",
      runtimeCodeHash:
        "0xe48c3827d558866b3d761d78b7d29416f24d277120ef1a7ce6a360962b917596",
      logIndex: 638,
      exclusiveProof,
    }),
    Object.freeze({
      address: HOOK,
      kind: "hook",
      scope: "exclusive",
      runtimeCodeHash:
        "0xff70a4d3d889b730a064b270fc187f0cba40582f1fa6f5875893066b17a1257b",
      logIndex: 639,
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

export const fadeRouterTradeEntry = Object.freeze({
  exploreKind: "token",
  id: `1:${TOKEN.toLowerCase()}`,
  name: "FADE",
  symbol: "FADE",
  tokenAddress: TOKEN,
  hookAddress: HOOK,
  poolId: POOL_ID,
  creatorAddress: fadeRouterTradeStamp.launchWallet,
  launchBlockNumber: fadeRouterTradeStamp.blockNumber,
  launchTransactionHash: fadeRouterTradeStamp.transactionHash,
  launchTransactionIndex: fadeRouterTradeStamp.transactionIndex,
  launchLogIndex: fadeRouterTradeStamp.launchLogIndex,
  launchedAt: "2026-08-24T19:29:47.000Z",
  tokenDecimals: 18,
  totalSwapFeeBps: null,
  launchModel: "custom-graph",
  launchModelVersion: "programmable-launch-stamp-router-v1",
  launchStampProvenance: fadeRouterTradeStamp,
  liquidityPath: "programmable-v4",
  launchCategoryProvenance: Object.freeze({
    schemaVersion: "programmable.explore-launch-category-provenance.v1",
    category: "custom",
    source: "canonical-launch-stamp-router",
    launchId: LAUNCH_ID,
    stampHash: STAMP_HASH,
    routerAddress: fadeRouterTradeStamp.routerAddress,
    transactionHash: fadeRouterTradeStamp.transactionHash,
    blockHash: fadeRouterTradeStamp.blockHash,
    blockNumber: fadeRouterTradeStamp.blockNumber,
    transactionIndex: fadeRouterTradeStamp.transactionIndex,
    logIndex: fadeRouterTradeStamp.launchLogIndex,
  }),
} as const satisfies CanonicalTokenExploreEntry);
