export const PACKAGE_VERSION = "2.0.0";
export const PACK_CONFIG_SCHEMA_V1 = "programmable.launch-pack-config.v1";
export const PACK_CONFIG_SCHEMA_V2 = "programmable.launch-pack-config.v2";
export const PACK_CONFIG_SCHEMA = PACK_CONFIG_SCHEMA_V1;
export const CREATE_REQUEST_SCHEMA_V1 = "programmable.custom-launch-create-request.v1";
export const CREATE_REQUEST_SCHEMA_V2 = "programmable.custom-launch-create-request.v2";
export const CREATE_REQUEST_SCHEMA = CREATE_REQUEST_SCHEMA_V1;
export const SOURCE_DESCRIPTOR_SCHEMA = "2.0.0";
export const SOURCE_MANIFEST_SCHEMA = "2.0.0";
export const GRAPH_BUNDLE_SCHEMA = "programmable.custom-graph-bundle.v1";
export const AGENT_ATTESTATION_SCHEMA_V1 = "programmable.agent-launch-attestation.v1";
export const AGENT_ATTESTATION_SCHEMA_V2 = "programmable.agent-launch-attestation.v2";
export const AGENT_ATTESTATION_SCHEMA = AGENT_ATTESTATION_SCHEMA_V1;
export const SOURCE_BUNDLE_CONTENT_SCHEMA = "programmable.source-bundle-content.v1";
export const LAUNCH_PROFILE_SELECTION_SCHEMA =
  "programmable.fee-enforced-launch-profile-selection.v1";
export const LAUNCH_PROFILE_BINDING_SCHEMA =
  "programmable.fee-enforced-launch-profile-binding.v1";
export const LAUNCH_PROFILE_SCHEMA = "programmable.fee-enforced-launch-profile.v1";
export const LAUNCH_PROFILE_ID =
  "programmable.fee-enforced-isolated-after-swap.zero-delta.v1";
export const LAUNCH_PROFILE_REVISION = 3;
export const LAUNCH_PROFILE_VERSION = "2.0.0";
export const LAUNCH_PROFILE_HASH_DOMAIN = "programmable.fee-enforced-launch-profile.v2";
export const LAUNCH_INTENT_HASH_DOMAIN = "programmable.custom-launch-intent.v2";

export const API_ORIGIN = "https://api.programmable.market";
export const CREATE_PATH_V1 = "/v1/custom-launches";
export const CREATE_PATH_V2 = "/v2/custom-launches";
export const CREATE_PATH = CREATE_PATH_V1;
export const READY_PATH = "/readyz";
export const OPENAPI_URL_V1 = "https://programmable.market/openapi/custom-launch-v1.json";
export const OPENAPI_URL_V2 = "https://programmable.market/openapi/custom-launch-v2.json";
export const OPENAPI_URL = OPENAPI_URL_V2;
export const GUIDE_URL = "https://programmable.market/docs/developers/custom-launch";
export const API_KEYS_URL = "https://programmable.market/developers/api-keys";
export const RELEASE_TAG_V1 = "programmable-launch-v1.0.1";
export const RELEASE_TARBALL_V1 = "programmable-launch-1.0.1.tgz";
export const RELEASE_URL_V1 =
  `https://github.com/0xprogrammable/PROGRAMMABLE/releases/download/${RELEASE_TAG_V1}/${RELEASE_TARBALL_V1}`;
export const RELEASE_TAG = "programmable-launch-v2.0.0";
export const RELEASE_TARBALL = "programmable-launch-2.0.0.tgz";
export const RELEASE_URL =
  `https://github.com/0xprogrammable/PROGRAMMABLE/releases/download/${RELEASE_TAG}/${RELEASE_TARBALL}`;

export const MAINNET_CHAIN_ID = "1";
export const ROUTER = "0x8622DD5bAb44185f2A458ac90384Ac99248f8d56";
export const GRAPH_FACTORY = "0xB012e4A8F2c5FC4E8E4faCA9D5Ad6FfF13FBA887";
export const POOL_MANAGER = "0x000000000004444c5dc75cB358380D2e3dE08A90";
export const GRAPH_TARGET_SALT_TYPE =
  "ProgrammableCreate2GraphTargetSaltV1(uint256 chainId,address factory,bytes32 routeNamespace,bytes32 routeNonce,bytes32 targetIdHash,bytes32 applicantSalt,address authorizedLauncher)";
export const API_ROUTE_NAMESPACE_TYPE =
  "ProgrammableApiCustomGraphRouteNamespaceV1(bytes32 sourceBundleSha256,address launchWallet,address router,address graphFactory)";

export const MAX_REQUEST_BYTES = 8_388_608;
export const MAX_STANDARD_JSON_INPUT_BYTES = 5_242_880;
export const MAX_TOTAL_STANDARD_JSON_INPUT_BYTES = 5_242_880;
export const MAX_GRAPH_TARGETS = 16;
export const MAX_TARGET_INIT_CODE_BYTES = 49_152;
export const MAX_TARGET_RUNTIME_CODE_BYTES = 24_576;
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
