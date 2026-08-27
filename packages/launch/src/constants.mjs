export const PACKAGE_VERSION = "3.3.5";
export const PACK_CONFIG_SCHEMA_V1 = "programmable.launch-pack-config.v1";
export const PACK_CONFIG_SCHEMA_V2 = "programmable.launch-pack-config.v2";
export const PACK_CONFIG_SCHEMA_V3 = "programmable.launch-pack-config.v3";
export const PACK_CONFIG_SCHEMA = PACK_CONFIG_SCHEMA_V3;
export const CREATE_REQUEST_SCHEMA_V1 = "programmable.custom-launch-create-request.v1";
export const CREATE_REQUEST_SCHEMA_V2 = "programmable.custom-launch-create-request.v2";
export const CREATE_REQUEST_SCHEMA_V3 = "programmable.custom-launch-create-request.v3";
export const CREATE_REQUEST_SCHEMA = CREATE_REQUEST_SCHEMA_V3;
export const SOURCE_DESCRIPTOR_SCHEMA = "2.0.0";
export const SOURCE_MANIFEST_SCHEMA = "2.0.0";
export const GRAPH_BUNDLE_SCHEMA = "programmable.custom-graph-bundle.v1";
export const PROJECT_METADATA_INPUT_SCHEMA = "programmable.project-metadata-input.v1";
export const PROJECT_METADATA_SCHEMA = "programmable.project-metadata.v1";
export const PROJECT_TOKEN_METADATA_BINDING_SCHEMA =
  "programmable.project-token-metadata-binding.v1";
export const PROJECT_METADATA_HASH_DOMAIN = PROJECT_METADATA_SCHEMA;
export const PROJECT_METADATA_GRAPH_HASH_DOMAIN =
  "programmable.custom-graph-project-metadata.v1";
export const AGENT_ATTESTATION_SCHEMA_V1 = "programmable.agent-launch-attestation.v1";
export const AGENT_ATTESTATION_SCHEMA_V2 = "programmable.agent-launch-attestation.v2";
export const AGENT_ATTESTATION_SCHEMA = AGENT_ATTESTATION_SCHEMA_V2;
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
export const DIRECT_NATIVE_PROFILE_SELECTION_SCHEMA_V2 =
  "programmable.direct-native-hook-graph-profile-selection.v2";
export const DIRECT_NATIVE_PROFILE_SELECTION_SCHEMA_V3 =
  "programmable.direct-native-hook-graph-profile-selection.v3";
export const DIRECT_NATIVE_PROFILE_SELECTION_SCHEMA =
  DIRECT_NATIVE_PROFILE_SELECTION_SCHEMA_V3;
export const DIRECT_NATIVE_PROFILE_BINDING_SCHEMA_V2 =
  "programmable.direct-native-hook-graph-profile-selection-binding.v2";
export const DIRECT_NATIVE_PROFILE_BINDING_SCHEMA_V3 =
  "programmable.direct-native-hook-graph-profile-selection-binding.v3";
export const DIRECT_NATIVE_PROFILE_BINDING_SCHEMA =
  DIRECT_NATIVE_PROFILE_BINDING_SCHEMA_V3;
export const DIRECT_NATIVE_PROFILE_SCHEMA_V2 =
  "programmable.direct-native-hook-graph-profile.v2";
export const DIRECT_NATIVE_PROFILE_SCHEMA_V3 =
  "programmable.direct-native-hook-graph-profile.v3";
export const DIRECT_NATIVE_PROFILE_SCHEMA = DIRECT_NATIVE_PROFILE_SCHEMA_V3;
export const DIRECT_NATIVE_PROFILE_ID = "programmable.direct-native-hook-graph.v1";
export const DIRECT_NATIVE_PROFILE_REVISION_V2 = 2;
export const DIRECT_NATIVE_PROFILE_REVISION_V3 = 3;
export const DIRECT_NATIVE_PROFILE_REVISION = DIRECT_NATIVE_PROFILE_REVISION_V3;
export const DIRECT_NATIVE_PROFILE_VERSION_V2 = "2.0.0";
export const DIRECT_NATIVE_PROFILE_VERSION_V3_LEGACY = "3.0.0";
export const DIRECT_NATIVE_PROFILE_VERSION_V3_PRE_METADATA = "3.1.0";
export const DIRECT_NATIVE_PROFILE_VERSION_V3 = "3.2.0";
export const DIRECT_NATIVE_PROFILE_VERSION = DIRECT_NATIVE_PROFILE_VERSION_V3;
export const DIRECT_NATIVE_PROFILE_HASH_DOMAIN_V2 =
  "programmable.direct-native-hook-graph-profile.v2";
export const DIRECT_NATIVE_PROFILE_HASH_DOMAIN_V3 =
  "programmable.direct-native-hook-graph-profile.v3";
export const DIRECT_NATIVE_PROFILE_HASH_DOMAIN = DIRECT_NATIVE_PROFILE_HASH_DOMAIN_V3;
export const DIRECT_NATIVE_LAUNCH_INTENT_HASH_DOMAIN_V2 =
  "programmable.direct-native-hook-graph-launch-intent.v2";
export const DIRECT_NATIVE_LAUNCH_INTENT_HASH_DOMAIN_V3 =
  "programmable.direct-native-hook-graph-launch-intent.v3";
export const DIRECT_NATIVE_LAUNCH_INTENT_HASH_DOMAIN =
  DIRECT_NATIVE_LAUNCH_INTENT_HASH_DOMAIN_V3;
export const PLATFORM_FEE_POLICY_SCHEMA =
  "programmable.platform-fee-policy.v1";
export const PLATFORM_FEE_PROOF_POLICY_SCHEMA =
  "programmable.platform-fee-conformance-policy.v1";
export const DIRECT_NATIVE_PLATFORM_ADMISSION_POLICY_SCHEMA =
  "programmable.direct-native-platform-admission-policy.v1";
export const PLATFORM_FEE_BINDING_SCHEMA =
  "programmable.platform-fee-binding.v2";
export const DIRECT_NATIVE_LIQUIDITY_MODEL_INTENT_SCHEMA =
  "programmable.direct-native-liquidity-model-intent.v1";
export const DIRECT_NATIVE_LIQUIDITY_MODEL_ASSESSMENT_SCHEMA =
  "programmable.direct-native-liquidity-model-assessment.v1";
export const LAUNCH_SEEDED_CONCENTRATED_LIQUIDITY_VECTORS = Object.freeze([
  "liquidity.seeded.pool-active-liquidity",
  "liquidity.seeded.position-custody-and-withdrawal",
  "liquidity.seeded.buy-and-sell",
]);
export const HOOK_INVENTORY_CUSTOM_ACCOUNTING_VECTORS = Object.freeze([
  "liquidity.hook-inventory.buy-settlement",
  "liquidity.hook-inventory.sell-settlement",
  "liquidity.hook-inventory.delta-solvency",
  "liquidity.hook-inventory.backing-and-withdrawal",
]);
export const FUNDING_AUTHORIZATION_INPUT_SCHEMA =
  "programmable.funding-authorization-input.v1";
export const FUNDING_AUTHORIZATION_DESCRIPTOR_SCHEMA =
  "programmable.funding-authorization-descriptor.v1";
export const FUNDING_SIGNATURE_PATCH_SCHEMA_V1 =
  "programmable.eip3009-signature-patch.v1";
export const FUNDING_SIGNATURE_PATCH_SCHEMA_V2 =
  "programmable.eip3009-authorization-patch.v2";
export const FUNDING_SIGNATURE_PATCH_SCHEMA = FUNDING_SIGNATURE_PATCH_SCHEMA_V1;
export const FUNDING_AUTHORIZATION_METHOD =
  "eip-3009-receive-with-authorization";
export const FUNDING_WALLET_TRANSACTION_VALUE_METHOD =
  "wallet-transaction-value";
export const FUNDING_INTENT_HASH_DOMAIN =
  "programmable.direct-native-hook-graph.funding-intent.v1";
export const FUNDING_NONCE_DOMAIN =
  "programmable.direct-native-hook-graph.funding-nonce.v1";

export const API_ORIGIN = "https://api.programmable.market";
export const CREATE_PATH_V1 = "/v1/custom-launches";
export const CREATE_PATH_V2 = "/v2/custom-launches";
export const CREATE_PATH_V3 = "/v3/custom-launches";
export const CREATE_PATH = CREATE_PATH_V3;
export const CAPABILITIES_PATH_V3 = "/v3/capabilities";
export const PREFLIGHT_PATH_V3 = "/v3/custom-launches/preflight";
export const PREFLIGHT_SCHEMA_V1 = "programmable.custom-launch-preflight.v1";
export const READY_PATH = "/readyz";
export const OPENAPI_URL_V1 = "https://programmable.market/openapi/custom-launch-v1.json";
export const OPENAPI_URL_V2 = "https://programmable.market/openapi/custom-launch-v2.json";
export const OPENAPI_URL_V3 = "https://programmable.market/openapi/custom-launch-v3.json";
export const OPENAPI_URL = OPENAPI_URL_V3;
export const GUIDE_URL = "https://programmable.market/docs/developers/custom-launch";
export const WALLET_HANDOFF_BASE_URL = "https://programmable.market/developers/api-keys";
export const EXISTING_PROJECT_INTEGRATION_GUIDE_URL =
  `${GUIDE_URL}#existing-project-integration`;
export const AGENT_REMEDIATION_CATALOG_URL =
  "https://programmable.market/policies/custom-launch-agent-remediation-v1.json";
export const CLI_DIAGNOSTIC_SCHEMA = "programmable.launch-cli-diagnostic.v1";
export const API_KEYS_URL = "https://programmable.market/developers/api-keys";
export const RELEASE_TAG_V1 = "programmable-launch-v1.0.1";
export const RELEASE_TARBALL_V1 = "programmable-launch-1.0.1.tgz";
export const RELEASE_URL_V1 =
  `https://github.com/0xprogrammable/PROGRAMMABLE/releases/download/${RELEASE_TAG_V1}/${RELEASE_TARBALL_V1}`;
export const RELEASE_TAG = "programmable-launch-v3.3.5";
export const RELEASE_TARBALL = "programmable-launch-3.3.5.tgz";
export const RELEASE_URL =
  `https://github.com/0xprogrammable/PROGRAMMABLE/releases/download/${RELEASE_TAG}/${RELEASE_TARBALL}`;
export const PACK_CONFIG_V3_CONTRACT_URL =
  "https://programmable.market/schemas/custom-launch/v3/pack-config.json";
export const PACK_CONFIG_V3_EXAMPLE_URL =
  `https://github.com/0xprogrammable/PROGRAMMABLE/blob/${RELEASE_TAG}/packages/launch/examples/direct-native-v3-no-broadcast/README.md`;

export const MAINNET_CHAIN_ID = "1";
export const ROUTER = "0x8622DD5bAb44185f2A458ac90384Ac99248f8d56";
export const PERMIT_AUTHORITY = "0x755509eA6e3F5Ec1aA2E797bb68f1B87DD8b886b";
export const GRAPH_FACTORY = "0xB012e4A8F2c5FC4E8E4faCA9D5Ad6FfF13FBA887";
export const POOL_MANAGER = "0x000000000004444c5dc75cB358380D2e3dE08A90";
export const ROUTER_RUNTIME_CODE_HASH =
  "0x40e27ecf201761d5eb66bc4f2d5c6124831ef078d7baf458ca5f41b1a8108546";
export const PERMIT_AUTHORITY_RUNTIME_CODE_HASH =
  "0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c";
export const GRAPH_FACTORY_RUNTIME_CODE_HASH =
  "0xd23692fae59331592048e71a96d4963e170ee56e449683dc9f7fa3f9470018b8";
export const POOL_MANAGER_RUNTIME_CODE_HASH =
  "0x785f1014552b7ce7d5fb7d0c970ca60edee94fd00425d7ca21609acac7ce1293";
export const MAINNET_USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
export const MAINNET_USDC_RUNTIME_CODE_HASH =
  "0xd80d4b7c890cb9d6a4893e6b52bc34b56b25335cb13716e0d1d31383e6b41505";
export const MAINNET_USDC_DOMAIN_NAME = "USD Coin";
export const MAINNET_USDC_DOMAIN_VERSION = "2";
export const MAINNET_USDC_DOMAIN_SEPARATOR =
  "0x06c37168a7db5138defc7866392bb87a741f9b3d104deb5094588ce041cae335";
export const RECEIVE_WITH_AUTHORIZATION_PRIMARY_TYPE =
  "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)";
export const RECEIVE_WITH_AUTHORIZATION_TYPEHASH =
  "0xd099cc98ef71107a616c4f0f941f04c322d8e254fe26b3c6668db87aae413de8";
export const PLATFORM_FEE_RATE_PPM = "1000";
export const PLATFORM_FEE_DENOMINATOR = "1000000";
export const PLATFORM_FEE_RECIPIENT = "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c";
export const PLATFORM_FEE_CLAIM_AUTHORITY = PLATFORM_FEE_RECIPIENT;
export const GRAPH_TARGET_SALT_TYPE =
  "ProgrammableCreate2GraphTargetSaltV1(uint256 chainId,address factory,bytes32 routeNamespace,bytes32 routeNonce,bytes32 targetIdHash,bytes32 applicantSalt,address authorizedLauncher)";
export const API_ROUTE_NAMESPACE_TYPE =
  "ProgrammableApiCustomGraphRouteNamespaceV1(bytes32 sourceBundleSha256,address launchWallet,address router,address graphFactory)";

export const MAX_REQUEST_BYTES = 8_388_608;
export const MAX_STANDARD_JSON_INPUT_BYTES = 5_242_880;
export const MAX_TOTAL_STANDARD_JSON_INPUT_BYTES = 5_242_880;
export const MAX_STANDARD_JSON_SOURCES = 2_048;
export const DIRECT_NATIVE_REQUIRED_SOLC_VERSION = "0.8.26+commit.8a97fa7a";
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
