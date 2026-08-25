export const PACKAGE_VERSION = "1.0.0";
export const PACK_CONFIG_SCHEMA = "programmable.launch-pack-config.v1";
export const CREATE_REQUEST_SCHEMA = "programmable.custom-launch-create-request.v1";
export const SOURCE_DESCRIPTOR_SCHEMA = "2.0.0";
export const SOURCE_MANIFEST_SCHEMA = "2.0.0";
export const GRAPH_BUNDLE_SCHEMA = "programmable.custom-graph-bundle.v1";
export const AGENT_ATTESTATION_SCHEMA = "programmable.agent-launch-attestation.v1";
export const SOURCE_BUNDLE_CONTENT_SCHEMA = "programmable.source-bundle-content.v1";

export const API_ORIGIN = "https://api.programmable.market";
export const CREATE_PATH = "/v1/custom-launches";
export const READY_PATH = "/readyz";
export const OPENAPI_URL = "https://programmable.market/openapi/custom-launch-v1.json";
export const GUIDE_URL = "https://programmable.market/docs/developers/custom-launch";
export const API_KEYS_URL = "https://programmable.market/developers/api-keys";
export const RELEASE_TAG = "programmable-launch-v1.0.0";
export const RELEASE_TARBALL = "programmable-launch-1.0.0.tgz";
export const RELEASE_URL =
  `https://github.com/0xprogrammable/PROGRAMMABLE/releases/download/${RELEASE_TAG}/${RELEASE_TARBALL}`;

export const MAINNET_CHAIN_ID = "1";
export const ROUTER = "0x8622DD5bAb44185f2A458ac90384Ac99248f8d56";
export const GRAPH_FACTORY = "0xB012e4A8F2c5FC4E8E4faCA9D5Ad6FfF13FBA887";
export const GRAPH_TARGET_SALT_TYPE =
  "ProgrammableCreate2GraphTargetSaltV1(uint256 chainId,address factory,bytes32 routeNamespace,bytes32 routeNonce,bytes32 targetIdHash,bytes32 applicantSalt,address authorizedLauncher)";
export const API_ROUTE_NAMESPACE_TYPE =
  "ProgrammableApiCustomGraphRouteNamespaceV1(bytes32 sourceBundleSha256,address launchWallet,address router,address graphFactory)";

export const MAX_REQUEST_BYTES = 8_388_608;
export const MAX_STANDARD_JSON_INPUT_BYTES = 5_242_880;
export const MAX_TOTAL_STANDARD_JSON_INPUT_BYTES = 5_242_880;
export const MAX_GRAPH_TARGETS = 16;
export const MAX_TARGET_INIT_CODE_BYTES = 49_152;
export const MAX_TARGET_INITIALIZER_BYTES = 131_072;
export const MAX_GRAPH_INPUT_BYTES = 524_288;

export const TERMINAL_STATUSES = new Set(["finalized", "failed", "cancelled"]);
export const WALLET_HANDOFF_STATUS = "authorized";

export const HOOK_PERMISSIONS = Object.freeze([
  "beforeInitialize",
  "afterInitialize",
  "beforeAddLiquidity",
  "afterAddLiquidity",
  "beforeRemoveLiquidity",
  "afterRemoveLiquidity",
  "beforeSwap",
  "afterSwap",
  "beforeDonate",
  "afterDonate",
  "beforeSwapReturnDelta",
  "afterSwapReturnDelta",
  "afterAddLiquidityReturnDelta",
  "afterRemoveLiquidityReturnDelta",
]);

export const HOOK_PERMISSION_BITS = Object.freeze({
  beforeInitialize: 13,
  afterInitialize: 12,
  beforeAddLiquidity: 11,
  afterAddLiquidity: 10,
  beforeRemoveLiquidity: 9,
  afterRemoveLiquidity: 8,
  beforeSwap: 7,
  afterSwap: 6,
  beforeDonate: 5,
  afterDonate: 4,
  beforeSwapReturnDelta: 3,
  afterSwapReturnDelta: 2,
  afterAddLiquidityReturnDelta: 1,
  afterRemoveLiquidityReturnDelta: 0,
});
