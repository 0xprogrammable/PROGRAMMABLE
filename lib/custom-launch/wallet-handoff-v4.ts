import {
  concatHex,
  decodeAbiParameters,
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  isAddress,
  keccak256,
  parseAbi,
  sha256,
  stringToHex,
  toBytes,
  toHex,
  type Address,
  type Hex,
} from "viem";

export const CUSTOM_LAUNCH_EXACT_WALLET_TRANSACTION_SCHEMA_V4 =
  "programmable.exact-wallet-transaction.v4" as const;
export const CUSTOM_LAUNCH_WALLET_REVIEW_SCHEMA_V4 =
  "programmable.custom-launch-wallet-review.v4" as const;
export const CUSTOM_LAUNCH_ROBINHOOD_CHAIN_ID_V4 = "4663" as const;
export const CUSTOM_LAUNCH_ROBINHOOD_CAIP2_V4 = "eip155:4663" as const;
export const CUSTOM_LAUNCH_ROBINHOOD_CHAIN_ID_HEX_V4 = "0x1237" as const;
export const CUSTOM_LAUNCH_ROBINHOOD_DEPLOYMENT_ID_V4 =
  "robinhood-mainnet-custom-launch-v1" as const;
export const CUSTOM_LAUNCH_WALLET_TRANSACTION_SELECTOR_V4 =
  "0xe5f6b8cd" as const;

const TRANSACTION_PREIMAGE_DOMAIN_V4 =
  "programmable.exact-wallet-transaction-preimage.v4" as const;
const PROFILE_DOMAIN_V4 = "programmable.custom-launch-profile-ref.v4" as const;
const UINT256_MAXIMUM = (1n << 256n) - 1n;
const UINT64_MAXIMUM = (1n << 64n) - 1n;
const MINIMUM_SUBMISSION_WINDOW_SECONDS = 30n;
const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/u;
const LOWER_BYTES32 = /^0x[0-9a-f]{64}$/u;
const NONZERO_LOWER_BYTES32 = /^0x(?!0{64}$)[0-9a-f]{64}$/u;
const LOWER_HEX_DATA = /^0x(?:[0-9a-f]{2})*$/u;
const CANONICAL_UINT = /^(?:0|[1-9][0-9]*)$/u;
const FINALITY_POLICY_DIGEST =
  "sha256:537d531423d1285a3808556a57303ec68f1e6bdeea3c9aaf6320f9e5a0e47153" as const;
const FOUNDATION_SOURCE_COMMITMENT =
  "0xe87f5edc2dc839bd87a26a80cb53f14b021e603a1753d27aae3a02862058d730" as const;
const SAFE_CONFIGURATION_SCHEMA = "programmable.safe-configuration-evidence.v1" as const;
const ADMISSION_DESCRIPTOR_DIGEST =
  "sha256:99b4ccabdaaf143bad28a8f6af441a1b93e1f113d0179236328b7fa594d1f948" as const;
const ADMISSION_POLICY_DIGEST =
  "sha256:31e6b286ca839b31cb1edfe30c05d9f334892f3d84377961dc10b93959c7e216" as const;
const ADMISSION_BINDING_DIGEST =
  "sha256:f31643e6e9ff6d5409d59a2fc3ac7fb5ac9cfcb3af08e95c9478bc95ddfa66a2" as const;
const ADMISSION_SCHEMA_DIGEST =
  "sha256:a28a6de6208d6ba7b65b4b706174509570955ba9ce9714624bcb2046ab7beae7" as const;
const PROFILE_DIGEST =
  "sha256:484b1dc6e9091804fabc230f2b3a7504940fa00264f8e66e82a66a951e71f1a0" as const;
const SAFE_FALLBACK_HANDLER_RUNTIME_CODE_HASH =
  "0x7c6007a5d711cea8dfd5d91f5940ec29c7f200fe511eb1fc1397b367af3c42f9" as const;
const SAFE_MODULES_END_SENTINEL =
  "0x0000000000000000000000000000000000000001" as const;
const SAFE_SINGLETON_ADDRESS = "0x41675C099F32341bf84BFc5382aF534df5C7461a" as const;
const SAFE_SINGLETON_RUNTIME_CODE_HASH =
  "0x1fe2df852ba3299d6534ef416eefa406e56ced995bca886ab7a553e6d0c5e1c4" as const;
const SAFE_FALLBACK_HANDLER_ADDRESS = "0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99" as const;
const SAFE_SOURCE_COMMITMENT_DOMAIN = "programmable.safe-source-commitment.v1" as const;
const SAFE_SOURCE_COMMITMENT_SUBJECT = deepFreeze({
  schemaVersion: SAFE_SOURCE_COMMITMENT_DOMAIN,
  repository: "safe-global/safe-deployments",
  commit: "0974182c16c57ca6fe2b9bba8cffb8a7e55fb83c",
  version: "1.4.1",
  proxy: {
    sourceIdentity: "SafeProxy",
    address: "0xeD617CE7f82e2AB589aDeFFD319D1D872Bc8De06",
    runtimeCodeHash:
      "0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c",
  },
  singleton: {
    sourceIdentity: "Safe",
    address: "0x41675C099F32341bf84BFc5382aF534df5C7461a",
    runtimeCodeHash:
      "0x1fe2df852ba3299d6534ef416eefa406e56ced995bca886ab7a553e6d0c5e1c4",
  },
  fallbackHandler: {
    sourceIdentity: "CompatibilityFallbackHandler",
    address: "0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99",
    runtimeCodeHash:
      "0x7c6007a5d711cea8dfd5d91f5940ec29c7f200fe511eb1fc1397b367af3c42f9",
  },
  sourcifyExactMatchClaimed: false,
});
const SAFE_SOURCE_COMMITMENT = framedSha256(
  SAFE_SOURCE_COMMITMENT_DOMAIN,
  SAFE_SOURCE_COMMITMENT_SUBJECT,
);
if (SAFE_SOURCE_COMMITMENT
    !== "sha256:4591dc35029cba2a869f91919cb3cf7e7c68f26727cc68e4b03d99cdf1bc2ebb") {
  throw new Error("pinned Safe source commitment subject drifted");
}
const ATOMIC_DEPLOYMENT_EVIDENCE_SCHEMA =
  "programmable.robinhood-atomic-root-deployment-evidence.v1" as const;
const ATOMIC_RECEIPT_LOGS_SCHEMA =
  "programmable.robinhood-atomic-root-deployment-receipt-logs.v1" as const;
const ATOMIC_PROVIDER_READBACK_SCHEMA =
  "programmable.robinhood-atomic-root-deployment-provider-readback.v1" as const;
const ATOMIC_RUNTIME_TRANSITION_PROVIDER_READBACK_SCHEMA =
  "programmable.robinhood-atomic-root-runtime-transition-provider-readback.v1" as const;
const ATOMIC_RESULT_STATE_SCHEMA =
  "programmable.robinhood-atomic-root-deployment-result-state.v1" as const;
const ROBINHOOD_MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11" as const;
const ATOMIC_DEPLOYMENT_SELECTOR = "0x82ad56cb" as const;
const ATOMIC_DEPLOYMENT_CALLDATA_HASH =
  "0x3ba04469085b17e12843a94c154a335c9c384837f8f6531f179cb4915fd237d9" as const;
const ATOMIC_DEPLOYMENT_CALLDATA_BYTES = 33_412 as const;
const EMPTY_RUNTIME_CODE_HASH =
  "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470" as const;
const EXTERNAL_DEPLOYMENT_PROVIDER_READBACK_SCHEMA =
  "programmable.custom-launch-deployment-provider-readback.v1" as const;
const UNISWAP_REGISTRY_SOURCE = deepFreeze({
  repository: "Uniswap/contracts",
  commit: "4cfc406c8e34da3ce04e60657a7825075b64fd22",
  path: "deployments/json/4663.json",
  rawUrl:
    "https://raw.githubusercontent.com/Uniswap/contracts/4cfc406c8e34da3ce04e60657a7825075b64fd22/deployments/json/4663.json",
  sha256: "sha256:21964cefbfc24b0ee89e7427acf74d223ce5a50aeb4216a9bac361a6148dea15",
});
const SAFE_OWNERS = Object.freeze([
  "0x032b1c7b96793717F0BD2f11eb86cd10CdefC4a3",
  "0x2Bb333d48DFAF1596D9036671d2E43168994249E",
] as const);
const ROBINHOOD_ETHEREUM_ROLLUP = "0x23A19d23e89166adedbDcB432518AB01e4272D94" as const;
const ROBINHOOD_ETHEREUM_SEQUENCER_INBOX =
  "0xBd0D173EEb87D57A09521c24388a12789F33ba96" as const;
const PERMIT2_GENESIS_SOURCE_URL =
  "https://cdn.robinhood.com/assets/generated_assets/hoodchain_docsite/chain-node-configs/robinhood-genesis.json" as const;
const PERMIT2_GENESIS_SOURCE_DIGEST =
  "sha256:353e6f6441b47695b41cee0c3645cde8dd7492d2f7f574bfb6aa4371e41bb6ba" as const;
const PERMIT2_GENESIS_RUNTIME_CODE_BYTES = 9_152 as const;

const LAUNCH_AND_STAMP_ABI_V4 = parseAbi([
  "function launchAndStampV1((uint256 chainId,address router,address launchWallet,uint8 kind,bytes32 routePayloadHash,bytes32 expectedResultHash,bytes32 stampRequestHash,bytes32 nonce,uint64 validAfter,uint64 deadline,uint256 value) permit,(bytes32 launchId,address token,bytes32 tokenRuntimeCodeHash,(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bytes32 hookRuntimeCodeHash,(uint8 resultIndex,address account,bytes32 runtimeCodeHash,uint8 kind,uint8 scope)[] components) stampRequest,bytes routePayload,bytes signature) payable returns (bytes32 stampHash)",
]);

const CUSTOM_GRAPH_ROUTE_PARAMETERS = [{
  name: "route",
  type: "tuple",
  components: [
    { name: "routeNamespace", type: "bytes32" },
    { name: "routeNonce", type: "bytes32" },
    { name: "topologyHash", type: "bytes32" },
    { name: "graphCommitment", type: "bytes32" },
    {
      name: "targets",
      type: "tuple[]",
      components: [
        { name: "targetIdHash", type: "bytes32" },
        { name: "applicantSalt", type: "bytes32" },
        { name: "deploymentValue", type: "uint256" },
        { name: "initializerValue", type: "uint256" },
        { name: "initCode", type: "bytes" },
        { name: "initializerCalldata", type: "bytes" },
      ],
    },
    {
      name: "expectedOutputs",
      type: "tuple[]",
      components: [
        { name: "targetIndex", type: "uint8" },
        { name: "targetIdHash", type: "bytes32" },
        { name: "account", type: "address" },
        { name: "runtimeCodeHash", type: "bytes32" },
      ],
    },
    { name: "expectedGraphDeploymentHash", type: "bytes32" },
  ],
}] as const;

const EXPECTED_GRAPH_OUTPUT_TYPEHASH = keccak256(toBytes(
  "ProgrammableExpectedGraphOutputV1(uint8 targetIndex,bytes32 targetIdHash,address account,bytes32 runtimeCodeHash)",
));
const EXPECTED_GRAPH_RESULT_TYPEHASH = keccak256(toBytes(
  "ProgrammableExpectedGraphResultV1(bytes32 expectedOutputsHash,bytes32 graphDeploymentHash)",
));
const COMPONENT_TYPEHASH = keccak256(toBytes(
  "ProgrammableLaunchComponentV1(uint8 resultIndex,address account,bytes32 runtimeCodeHash,uint8 kind,uint8 scope)",
));
const POOL_KEY_TYPEHASH = keccak256(toBytes(
  "ProgrammablePoolKeyV1(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)",
));
const STAMP_REQUEST_TYPEHASH = keccak256(toBytes(
  "ProgrammableStampRequestV1(bytes32 launchId,address token,bytes32 tokenRuntimeCodeHash,bytes32 poolKeyHash,bytes32 hookRuntimeCodeHash,bytes32 componentSetHash)",
));

function rootBinding(addressValue: string, runtimeCodeHash: Hex) {
  return Object.freeze({ address: getAddress(addressValue), runtimeCodeHash });
}

export const CUSTOM_LAUNCH_ROBINHOOD_TRUST_ROOTS_V4 = deepFreeze({
  programmableLaunchStampRouter: rootBinding(
    "0x34965F2A2ee9254522232C32F02056E92BE0C98a",
    "0x1dbbdaaad901ea3c6134dca0d4872a4789b3c071bf8ccfb44edd65d26d817388",
  ),
  permitAuthority: rootBinding(
    "0xeD617CE7f82e2AB589aDeFFD319D1D872Bc8De06",
    "0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c",
  ),
  graphFactory: rootBinding(
    "0x0B6b3F40f84Df25D3bd69238f937096177DD09Bd",
    "0xd23692fae59331592048e71a96d4963e170ee56e449683dc9f7fa3f9470018b8",
  ),
  poolManager: rootBinding(
    "0x8366a39CC670B4001A1121B8F6A443A643e40951",
    "0xbd3881180b547f5fe817545743cfb4343e96b1bc6640dcd70c106b0066e95626",
  ),
  positionManager: rootBinding(
    "0x58daec3116aae6D93017bAAea7749052E8a04fA7",
    "0xc873e135dc9aaec88489cfbad146b4cb49d6a32e0d80326377784b7ba17670b2",
  ),
  stateView: rootBinding(
    "0xF3334192D15450CdD385c8B70e03f9A6bD9E673b",
    "0x7d9c591e0956fd89d98feb4ffcfe8bf1f7a62bd485edd979fa21d104b49878a6",
  ),
  v4Quoter: rootBinding(
    "0x8Dc178eFB8111BB0973Dd9d722ebeFF267c98F94",
    "0xd707b1da8cb165e5ea35a3b4450d971eb562ec171e23492aa117036b78a868f6",
  ),
  permit2: rootBinding(
    "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    "0x5208783f52488f7d3493e5e38311ab707c1d75457fe472a19b0b4d57d66a7fca",
  ),
  universalRouter: rootBinding(
    "0x06AfBA43Fd06227fA663b0DAecF536f6EaA6bf99",
    "0xbe8e8191bb42d843c2e948a5a55772eaab864ce01e54dcd47c9d089170b302d5",
  ),
});

export const CUSTOM_LAUNCH_ROBINHOOD_ROUTER_V4 =
  CUSTOM_LAUNCH_ROBINHOOD_TRUST_ROOTS_V4.programmableLaunchStampRouter.address;
export const CUSTOM_LAUNCH_ROBINHOOD_ROUTER_RUNTIME_CODE_HASH_V4 =
  CUSTOM_LAUNCH_ROBINHOOD_TRUST_ROOTS_V4.programmableLaunchStampRouter.runtimeCodeHash;
export const CUSTOM_LAUNCH_ROBINHOOD_UNIVERSAL_ROUTER_V4 =
  CUSTOM_LAUNCH_ROBINHOOD_TRUST_ROOTS_V4.universalRouter.address;

const TRUST_ROOT_KEYS = Object.freeze(Object.keys(
  CUSTOM_LAUNCH_ROBINHOOD_TRUST_ROOTS_V4,
));
const EXTERNAL_ROOT_KEYS = Object.freeze([
  "poolManager", "positionManager", "stateView", "v4Quoter", "universalRouter",
] as const);
const EXTERNAL_ROOT_DEPLOYMENTS = deepFreeze({
  poolManager: {
    ...CUSTOM_LAUNCH_ROBINHOOD_TRUST_ROOTS_V4.poolManager,
    transactionHash: "0x4fb28d4935866f462582c6c931c6f2705e55f5be5eb178c7d8d9329a95c44c41",
    startBlock: "9070",
  },
  positionManager: {
    ...CUSTOM_LAUNCH_ROBINHOOD_TRUST_ROOTS_V4.positionManager,
    transactionHash: "0x228c18ada6cb46b4fbcc18f4ec1519953415393e256fa8349aafbd5a2db037c8",
    startBlock: "9073",
  },
  stateView: {
    ...CUSTOM_LAUNCH_ROBINHOOD_TRUST_ROOTS_V4.stateView,
    transactionHash: "0x3d61e2c9eeb482385b1aa436b9e8f812167ea579cc390e4f93bc5abde00582f4",
    startBlock: "9075",
  },
  v4Quoter: {
    ...CUSTOM_LAUNCH_ROBINHOOD_TRUST_ROOTS_V4.v4Quoter,
    transactionHash: "0x6bf436d72a17f87284ddcab43094689bd320dfb39b535213b9a0b669fabc4ab4",
    startBlock: "9074",
  },
  universalRouter: {
    ...CUSTOM_LAUNCH_ROBINHOOD_TRUST_ROOTS_V4.universalRouter,
    transactionHash: "0xdfb76494e158d8dea4376160315239271636a18515207fd4526e574bc7eeb456",
    startBlock: "3347899",
  },
});
const TRANSACTION_KEYS = Object.freeze([
  "schemaVersion", "chainId", "caip2", "apiVersion", "chainDeploymentId",
  "chainDeploymentDescriptorDigest", "chainDeployment", "profile",
  "finalityPolicy", "from", "to", "valueWei", "calldata", "selector",
  "transactionPreimageHash", "routerRuntimeCodeHash", "expiresAt",
  "commitments", "launchSummary",
]);
const COMMITMENT_KEYS = Object.freeze([
  "sourceBuild", "graph", "metadata", "verification", "fundingPermit", "launchIntent",
]);
const SUMMARY_KEYS = Object.freeze([
  "chainName", "controller", "name", "symbol", "fundingMode", "valueWei",
]);
const EXPECTED_KEYS = Object.freeze([
  "chainDeployment", "chainDeploymentDescriptorDigest", "profile", "launchWallet",
  "nonce", "permitWindow", "funding", "projectMetadata", "commitments",
  "preparedArtifact",
]);
const PERMIT_KEYS = Object.freeze([
  "chainId", "router", "launchWallet", "kind", "routePayloadHash",
  "expectedResultHash", "stampRequestHash", "nonce", "validAfter", "deadline",
  "valueWei",
]);
const STAMP_KEYS = Object.freeze([
  "launchId", "token", "tokenRuntimeCodeHash", "poolKey", "hookRuntimeCodeHash",
  "components",
]);
const POOL_KEYS = Object.freeze([
  "currency0", "currency1", "fee", "tickSpacing", "hooks",
]);
const COMPONENT_KEYS = Object.freeze([
  "resultIndex", "account", "runtimeCodeHash", "kind", "scope",
]);
const PREPARED_ARTIFACT_KEYS = Object.freeze([
  "permit", "stampRequest", "routePayload", "permitSignature",
]);
const BACKEND_PREPARED_ARTIFACT_KEYS = Object.freeze([
  "schemaVersion", "verificationBundleHash", "unboundGraphBundleHash",
  "projectMetadata", "projectMetadataHash", "graphBundleHash",
  "sourceBundleSha256", "chainBindings", "callerConstraints", "timing",
  "route", "predictedComponents", "market", "stampRequest",
  "stampRequestHash", "permit", "permitDigest", "unsignedRouterTransaction",
  "claims", "artifactHash",
]);
const WALLET_REQUEST_KEYS = Object.freeze(["chainId", "from", "to", "data", "value"]);
const REVIEW_KEYS = Object.freeze([
  "schemaVersion", "chainId", "caip2", "chainDeploymentDescriptorDigest",
  "profileDigest", "walletRequest", "valueWei", "transactionPreimageHash",
  "routerRuntimeCodeHash", "expiresAt", "commitments",
]);

export type CustomLaunchCommitmentsV4 = Readonly<{
  sourceBuild: `sha256:${string}`;
  graph: `sha256:${string}`;
  metadata: `sha256:${string}`;
  verification: `sha256:${string}`;
  fundingPermit: `sha256:${string}`;
  launchIntent: `sha256:${string}`;
}>;

export type CustomLaunchPreparedArtifactV4 = Readonly<{
  permit: Readonly<{
    chainId: string;
    router: Address;
    launchWallet: Address;
    kind: 1;
    routePayloadHash: Hex;
    expectedResultHash: Hex;
    stampRequestHash: Hex;
    nonce: Hex;
    validAfter: string;
    deadline: string;
    valueWei: string;
  }>;
  stampRequest: Readonly<{
    launchId: Hex;
    token: Address;
    tokenRuntimeCodeHash: Hex;
    poolKey: Readonly<{
      currency0: Address;
      currency1: Address;
      fee: number;
      tickSpacing: number;
      hooks: Address;
    }>;
    hookRuntimeCodeHash: Hex;
    components: readonly Readonly<{
      resultIndex: number;
      account: Address;
      runtimeCodeHash: Hex;
      kind: number;
      scope: 1;
    }>[];
  }>;
  routePayload: Hex;
  permitSignature: Hex;
}>;

export type CustomLaunchWalletExpectedV4 = Readonly<{
  chainDeployment: unknown;
  chainDeploymentDescriptorDigest: Hex;
  profile: unknown;
  launchWallet: Address;
  nonce: Hex;
  permitWindow: Readonly<{ validAfter: string; deadline: string }>;
  funding: Readonly<{
    mode: "none" | "wallet-transaction-value";
    valueWei: string;
  }>;
  projectMetadata: Readonly<{ name: string; symbol: string }>;
  commitments: CustomLaunchCommitmentsV4;
  preparedArtifact: CustomLaunchPreparedArtifactV4;
}>;

export type CustomLaunchEip1193ProviderV4 = Readonly<{
  request(input: Readonly<{
    method: string;
    params?: readonly unknown[];
  }>): Promise<unknown>;
}>;

export type CustomLaunchWalletRequestV4 = Readonly<{
  chainId: typeof CUSTOM_LAUNCH_ROBINHOOD_CHAIN_ID_HEX_V4;
  from: Address;
  to: Address;
  data: Hex;
  value: Hex;
}>;

export type CustomLaunchWalletReviewV4 = Readonly<{
  schemaVersion: typeof CUSTOM_LAUNCH_WALLET_REVIEW_SCHEMA_V4;
  chainId: typeof CUSTOM_LAUNCH_ROBINHOOD_CHAIN_ID_V4;
  caip2: typeof CUSTOM_LAUNCH_ROBINHOOD_CAIP2_V4;
  chainDeploymentDescriptorDigest: Hex;
  profileDigest: `sha256:${string}`;
  walletRequest: CustomLaunchWalletRequestV4;
  valueWei: string;
  transactionPreimageHash: `sha256:${string}`;
  routerRuntimeCodeHash:
    typeof CUSTOM_LAUNCH_ROBINHOOD_ROUTER_RUNTIME_CODE_HASH_V4;
  expiresAt: string;
  commitments: CustomLaunchCommitmentsV4;
}>;

export class CustomLaunchWalletHandoffErrorV4 extends Error {
  constructor() {
    super(
      "The Robinhood Chain transaction failed the wallet safety checks. Refresh the request and try again.",
    );
    this.name = "CustomLaunchWalletHandoffErrorV4";
  }
}

/**
 * Loads fresh public capabilities and an authenticated resource through caller
 * callbacks, validates the exact locally reviewed artifact, then rereads the
 * chain/account around a same-provider Router bytecode check. It never signs
 * or broadcasts.
 */
export async function prepareCustomLaunchWalletReviewV4(input: Readonly<{
  provider: CustomLaunchEip1193ProviderV4;
  loadFreshCapabilities: () => Promise<unknown>;
  loadFreshResource: () => Promise<unknown>;
  expected: CustomLaunchWalletExpectedV4;
  now?: Date;
}>): Promise<CustomLaunchWalletReviewV4> {
  const expected = assertExpectedBindings(input.expected);
  let capabilitiesValue: unknown;
  let resourceValue: unknown;
  try {
    capabilitiesValue = await input.loadFreshCapabilities();
    resourceValue = await input.loadFreshResource();
  } catch {
    return invalid();
  }
  const capabilities = assertFreshCapabilities(capabilitiesValue, expected);
  const transaction = assertResourceAndTransaction(
    resourceValue,
    expected,
    input.now ?? new Date(),
  );
  const walletRequest = deepFreeze({
    chainId: CUSTOM_LAUNCH_ROBINHOOD_CHAIN_ID_HEX_V4,
    from: expected.launchWallet,
    to: CUSTOM_LAUNCH_ROBINHOOD_ROUTER_V4,
    data: transaction.calldata,
    value: toHex(BigInt(transaction.valueWei)),
  } satisfies CustomLaunchWalletRequestV4);
  await assertProviderState(
    input.provider,
    expected.launchWallet,
    capabilities.routerRuntimeCodeHash,
  );
  return deepFreeze({
    schemaVersion: CUSTOM_LAUNCH_WALLET_REVIEW_SCHEMA_V4,
    chainId: CUSTOM_LAUNCH_ROBINHOOD_CHAIN_ID_V4,
    caip2: CUSTOM_LAUNCH_ROBINHOOD_CAIP2_V4,
    chainDeploymentDescriptorDigest: expected.chainDeploymentDescriptorDigest,
    profileDigest: expected.profile.profileDigest,
    walletRequest,
    valueWei: transaction.valueWei,
    transactionPreimageHash: transaction.transactionPreimageHash,
    routerRuntimeCodeHash: capabilities.routerRuntimeCodeHash,
    expiresAt: transaction.expiresAt,
    commitments: expected.commitments,
  });
}

/** Final read-only gate for the instant immediately before an owner send. */
export async function revalidateCustomLaunchWalletRequestV4(input: Readonly<{
  provider: CustomLaunchEip1193ProviderV4;
  review: unknown;
  candidate: unknown;
}>): Promise<CustomLaunchWalletRequestV4> {
  const review = exactReview(input.review);
  const candidate = assertCustomLaunchWalletRequestUnchangedV4(review, input.candidate);
  await assertProviderState(input.provider, candidate.from, review.routerRuntimeCodeHash);
  return candidate;
}

export function assertCustomLaunchWalletRequestUnchangedV4(
  reviewValue: unknown,
  requestValue: unknown,
): CustomLaunchWalletRequestV4 {
  const review = exactReview(reviewValue);
  const expectedRequest = exactWalletRequest(review.walletRequest);
  const candidate = exactWalletRequest(requestValue);
  if (canonicalJson(candidate) !== canonicalJson(expectedRequest)) return invalid();
  return candidate;
}

export function exactWalletTransactionPreimageHashV4(
  transactionWithoutHash: unknown,
): `sha256:${string}` {
  const framed = `${TRANSACTION_PREIMAGE_DOMAIN_V4}\0${canonicalJson(transactionWithoutHash)}`;
  return `sha256:${sha256(stringToHex(framed)).slice(2)}`;
}

export function encodeCustomLaunchWalletCalldataV4(artifactValue: unknown): Hex {
  const artifact = exactPreparedArtifact(artifactValue);
  return encodeFunctionData({
    abi: LAUNCH_AND_STAMP_ABI_V4,
    functionName: "launchAndStampV1",
    args: [{
      chainId: BigInt(artifact.permit.chainId),
      router: artifact.permit.router,
      launchWallet: artifact.permit.launchWallet,
      kind: artifact.permit.kind,
      routePayloadHash: artifact.permit.routePayloadHash,
      expectedResultHash: artifact.permit.expectedResultHash,
      stampRequestHash: artifact.permit.stampRequestHash,
      nonce: artifact.permit.nonce,
      validAfter: BigInt(artifact.permit.validAfter),
      deadline: BigInt(artifact.permit.deadline),
      value: BigInt(artifact.permit.valueWei),
    }, artifact.stampRequest, artifact.routePayload, artifact.permitSignature],
  });
}

export function deriveCustomLaunchArtifactHashesV4(input: Readonly<{
  routePayload: Hex;
  stampRequest: unknown;
}>): Readonly<{
  routePayloadHash: Hex;
  expectedResultHash: Hex;
  stampRequestHash: Hex;
}> {
  const routePayload = exactHex(input.routePayload, true);
  const stampRequest = exactStampRequest(input.stampRequest);
  const route = decodeCanonicalRoute(routePayload);
  return deepFreeze({
    routePayloadHash: keccak256(routePayload),
    expectedResultHash: expectedResultHash(route),
    stampRequestHash: stampRequestHash(stampRequest),
  });
}

/** Builds independent expected bindings from one already-reviewed resource. */
export function deriveCustomLaunchWalletExpectedV4(
  resourceValue: unknown,
): CustomLaunchWalletExpectedV4 {
  const resource = record(resourceValue);
  const chainDeployment = exactChainDeployment(resource.chainDeployment);
  const chainDeploymentDescriptorDigest = exactLowerBytes32(
    resource.chainDeploymentDescriptorDigest,
  );
  if (chainDeploymentDigest(chainDeployment) !== chainDeploymentDescriptorDigest) return invalid();
  const profile = exactProfile(resource.profile);
  const controller = exactRecord(resource.controller, ["namespace", "address"]);
  const launchWallet = canonicalAddress(controller.address);
  const fundingValue = exactRecord(resource.funding, ["schemaVersion", "mode", "valueWei"]);
  const valueWei = canonicalUint(fundingValue.valueWei, UINT256_MAXIMUM).source;
  if (controller.namespace !== CUSTOM_LAUNCH_ROBINHOOD_CAIP2_V4
    || fundingValue.schemaVersion !== "programmable.custom-launch-funding-intent.v2"
    || !new Set(["none", "wallet-transaction-value"]).has(String(fundingValue.mode))
    || ((fundingValue.mode === "none") !== (valueWei === "0"))) return invalid();
  const projectMetadata = record(resource.projectMetadata);
  const token = exactRecord(projectMetadata.token, ["name", "symbol"]);
  const commitments = exactCommitments(resource.commitments);
  const transaction = exactTransaction(resource.walletTransaction);
  const preparedArtifact = exactBackendPreparedArtifact(
    resource.preparedArtifact,
    transaction.calldata,
    commitments,
    chainDeployment,
  );
  if (transaction.from !== launchWallet
    || transaction.valueWei !== valueWei
    || transaction.calldata !== encodeCustomLaunchWalletCalldataV4(preparedArtifact)) {
    return invalid();
  }
  return deepFreeze({
    chainDeployment,
    chainDeploymentDescriptorDigest,
    profile,
    launchWallet,
    nonce: preparedArtifact.permit.nonce,
    permitWindow: {
      validAfter: preparedArtifact.permit.validAfter,
      deadline: preparedArtifact.permit.deadline,
    },
    funding: {
      mode: fundingValue.mode as "none" | "wallet-transaction-value",
      valueWei,
    },
    projectMetadata: {
      name: boundedText(token.name, 1, 256),
      symbol: boundedText(token.symbol, 1, 64),
    },
    commitments,
    preparedArtifact,
  });
}

function assertExpectedBindings(value: unknown) {
  const expected = exactRecord(value, EXPECTED_KEYS);
  const chainDeployment = exactChainDeployment(expected.chainDeployment);
  const chainDeploymentDescriptorDigest = exactLowerBytes32(
    expected.chainDeploymentDescriptorDigest,
  );
  if (chainDeploymentDigest(chainDeployment) !== chainDeploymentDescriptorDigest) return invalid();
  const profile = exactProfile(expected.profile);
  const launchWallet = canonicalAddress(expected.launchWallet);
  const nonce = exactLowerBytes32(expected.nonce);
  const permitWindow = exactRecord(expected.permitWindow, ["validAfter", "deadline"]);
  const validAfter = canonicalUint(permitWindow.validAfter, UINT64_MAXIMUM);
  const deadline = canonicalUint(permitWindow.deadline, UINT64_MAXIMUM);
  const funding = exactRecord(expected.funding, ["mode", "valueWei"]);
  const valueWei = canonicalUint(funding.valueWei, UINT256_MAXIMUM);
  const projectMetadata = exactRecord(expected.projectMetadata, ["name", "symbol"]);
  const commitments = exactCommitments(expected.commitments);
  const preparedArtifact = exactPreparedArtifact(expected.preparedArtifact);
  if (deadline.parsed <= validAfter.parsed
    || !new Set(["none", "wallet-transaction-value"]).has(String(funding.mode))
    || ((funding.mode === "none") !== (valueWei.parsed === 0n))
    || preparedArtifact.permit.launchWallet !== launchWallet
    || preparedArtifact.permit.nonce !== nonce
    || preparedArtifact.permit.validAfter !== validAfter.source
    || preparedArtifact.permit.deadline !== deadline.source
    || preparedArtifact.permit.valueWei !== valueWei.source) return invalid();
  return deepFreeze({
    chainDeployment,
    chainDeploymentDescriptorDigest,
    profile,
    launchWallet,
    nonce,
    permitWindow: { validAfter: validAfter.source, deadline: deadline.source },
    funding: {
      mode: funding.mode as "none" | "wallet-transaction-value",
      valueWei: valueWei.source,
    },
    projectMetadata: {
      name: boundedText(projectMetadata.name, 1, 256),
      symbol: boundedText(projectMetadata.symbol, 1, 64),
    },
    commitments,
    preparedArtifact,
  });
}

function assertFreshCapabilities(
  value: unknown,
  expected: ReturnType<typeof assertExpectedBindings>,
) {
  const capabilities = exactRecord(value, [
    "schemaVersion", "apiVersion", "serverTime", "readinessUrl", "chain",
    "chainDeployment", "chainDeploymentDescriptorDigest", "profile", "routes",
    "authentication", "graph", "funding", "metadataImage", "toolchains",
    "readiness", "safety", "walletHandoff",
  ]);
  const chain = exactRecord(capabilities.chain, ["id", "caip2", "name"]);
  const readiness = exactRecord(capabilities.readiness, ["status", "reasonCodes"]);
  const metadataImage = exactRecord(capabilities.metadataImage, [
    "schemaVersion", "mediaTypes", "maximumBytes", "maximumDimension",
    "maximumPixels", "gifFrames",
  ]);
  const walletHandoff = exactRecord(capabilities.walletHandoff, [
    "schemaVersion", "separateWalletSignatureRequired", "walletHandoffBaseUrl",
  ]);
  const deployment = exactChainDeployment(capabilities.chainDeployment);
  const profile = exactProfile(capabilities.profile);
  if (capabilities.schemaVersion !== "programmable.custom-launch-capabilities.v2"
    || capabilities.apiVersion !== "v4"
    || !canonicalTimestamp(capabilities.serverTime)
    || capabilities.readinessUrl !== "/readyz"
    || chain.id !== CUSTOM_LAUNCH_ROBINHOOD_CHAIN_ID_V4
    || chain.caip2 !== CUSTOM_LAUNCH_ROBINHOOD_CAIP2_V4
    || chain.name !== "Robinhood Chain Mainnet"
    || capabilities.chainDeploymentDescriptorDigest
      !== expected.chainDeploymentDescriptorDigest
    || chainDeploymentDigest(deployment) !== expected.chainDeploymentDescriptorDigest
    || canonicalJson(deployment) !== canonicalJson(expected.chainDeployment)
    || canonicalJson(profile) !== canonicalJson(expected.profile)
    || readiness.status !== "ready"
    || !Array.isArray(readiness.reasonCodes)
    || readiness.reasonCodes.length !== 0
    || metadataImage.schemaVersion
      !== "programmable.project-metadata-image-capability.v1"
    || canonicalJson(metadataImage.mediaTypes) !== canonicalJson(["image/png", "image/gif"])
    || metadataImage.maximumBytes !== 5_242_880
    || metadataImage.maximumDimension !== 8_192
    || metadataImage.maximumPixels !== 4_194_304
    || metadataImage.gifFrames !== 1
    || walletHandoff.schemaVersion
      !== CUSTOM_LAUNCH_EXACT_WALLET_TRANSACTION_SCHEMA_V4
    || walletHandoff.separateWalletSignatureRequired !== true
    || walletHandoff.walletHandoffBaseUrl
      !== "https://programmable.market/developers/api-keys"
    || !Array.isArray(capabilities.toolchains)
    || capabilities.toolchains.length === 0) return invalid();
  return deepFreeze({
    routerRuntimeCodeHash:
      deployment.contracts.programmableLaunchStampRouter.runtimeCodeHash,
  });
}

function assertResourceAndTransaction(
  resourceValue: unknown,
  expected: ReturnType<typeof assertExpectedBindings>,
  now: Date,
) {
  const resource = record(resourceValue);
  const deployment = exactChainDeployment(resource.chainDeployment);
  const profile = exactProfile(resource.profile);
  const controller = exactRecord(resource.controller, ["namespace", "address"]);
  if (resource.schemaVersion !== "programmable.custom-launch.v4"
    || resource.apiVersion !== "v4"
    || resource.chainId !== CUSTOM_LAUNCH_ROBINHOOD_CHAIN_ID_V4
    || resource.caip2 !== CUSTOM_LAUNCH_ROBINHOOD_CAIP2_V4
    || resource.chainDeploymentId !== CUSTOM_LAUNCH_ROBINHOOD_DEPLOYMENT_ID_V4
    || resource.chainDeploymentDescriptorDigest !== expected.chainDeploymentDescriptorDigest
    || chainDeploymentDigest(deployment) !== expected.chainDeploymentDescriptorDigest
    || canonicalJson(deployment) !== canonicalJson(expected.chainDeployment)
    || canonicalJson(profile) !== canonicalJson(expected.profile)
    || controller.namespace !== CUSTOM_LAUNCH_ROBINHOOD_CAIP2_V4
    || canonicalAddress(controller.address) !== expected.launchWallet
    || !new Set(["wallet_action_required", "awaiting_wallet_signature"]).has(
      String(resource.status),
    )
    || resource.sourceBuildCommitment !== expected.commitments.sourceBuild
    || resource.graphCommitment !== expected.commitments.graph
    || resource.metadataCommitment !== expected.commitments.metadata
    || canonicalJson(exactCommitments(resource.commitments))
      !== canonicalJson(expected.commitments)) return invalid();

  const transaction = exactTransaction(resource.walletTransaction);
  const backendArtifact = exactBackendPreparedArtifact(
    resource.preparedArtifact,
    transaction.calldata,
    expected.commitments,
    expected.chainDeployment,
  );
  if (resource.walletTransactionPreimageHash !== transaction.transactionPreimageHash
    || transaction.chainDeploymentDescriptorDigest
      !== expected.chainDeploymentDescriptorDigest
    || canonicalJson(transaction.chainDeployment) !== canonicalJson(expected.chainDeployment)
    || canonicalJson(transaction.profile) !== canonicalJson(expected.profile)
    || canonicalJson(transaction.finalityPolicy)
      !== canonicalJson(expected.chainDeployment.finality)
    || transaction.from !== expected.launchWallet
    || transaction.to !== CUSTOM_LAUNCH_ROBINHOOD_ROUTER_V4
    || transaction.to === CUSTOM_LAUNCH_ROBINHOOD_UNIVERSAL_ROUTER_V4
    || transaction.valueWei !== expected.funding.valueWei
    || canonicalJson(transaction.commitments) !== canonicalJson(expected.commitments)
    || transaction.launchSummary.controller !== expected.launchWallet
    || transaction.launchSummary.name !== expected.projectMetadata.name
    || transaction.launchSummary.symbol !== expected.projectMetadata.symbol
    || transaction.launchSummary.fundingMode !== expected.funding.mode
    || transaction.launchSummary.valueWei !== expected.funding.valueWei
    || canonicalJson(backendArtifact) !== canonicalJson(expected.preparedArtifact)
    || transaction.calldata !== encodeCustomLaunchWalletCalldataV4(expected.preparedArtifact)) {
    return invalid();
  }
  assertDecodedCalldata(transaction.calldata, expected.preparedArtifact);
  const expiresAt = canonicalIsoTimestamp(transaction.expiresAt);
  const nowMilliseconds = now.getTime();
  if (!Number.isFinite(nowMilliseconds)
    || BigInt(Math.floor(expiresAt.milliseconds / 1_000))
      !== BigInt(expected.permitWindow.deadline)
    || BigInt(Math.floor(nowMilliseconds / 1_000))
      < BigInt(expected.permitWindow.validAfter)
    || BigInt(expected.permitWindow.deadline)
      <= BigInt(Math.floor(nowMilliseconds / 1_000)) + MINIMUM_SUBMISSION_WINDOW_SECONDS) {
    return invalid();
  }
  return deepFreeze({
    calldata: transaction.calldata,
    valueWei: transaction.valueWei,
    expiresAt: transaction.expiresAt,
    transactionPreimageHash: transaction.transactionPreimageHash,
  });
}

function exactTransaction(value: unknown) {
  const transaction = exactRecord(value, TRANSACTION_KEYS);
  const deployment = exactChainDeployment(transaction.chainDeployment);
  const profile = exactProfile(transaction.profile);
  const finalityPolicy = exactFinalityPolicy(transaction.finalityPolicy);
  const from = canonicalAddress(transaction.from);
  const to = canonicalAddress(transaction.to);
  const valueWei = canonicalUint(transaction.valueWei, UINT256_MAXIMUM).source;
  const calldata = exactHex(transaction.calldata, false);
  const commitments = exactCommitments(transaction.commitments);
  const summaryValue = exactRecord(transaction.launchSummary, SUMMARY_KEYS);
  const summary = deepFreeze({
    chainName: summaryValue.chainName,
    controller: canonicalAddress(summaryValue.controller),
    name: boundedText(summaryValue.name, 1, 256),
    symbol: boundedText(summaryValue.symbol, 1, 64),
    fundingMode: summaryValue.fundingMode,
    valueWei: canonicalUint(summaryValue.valueWei, UINT256_MAXIMUM).source,
  });
  const transactionPreimageHash = exactSha256(transaction.transactionPreimageHash);
  if (transaction.schemaVersion !== CUSTOM_LAUNCH_EXACT_WALLET_TRANSACTION_SCHEMA_V4
    || transaction.chainId !== CUSTOM_LAUNCH_ROBINHOOD_CHAIN_ID_V4
    || transaction.caip2 !== CUSTOM_LAUNCH_ROBINHOOD_CAIP2_V4
    || transaction.apiVersion !== "v4"
    || transaction.chainDeploymentId !== CUSTOM_LAUNCH_ROBINHOOD_DEPLOYMENT_ID_V4
    || transaction.chainDeploymentDescriptorDigest !== chainDeploymentDigest(deployment)
    || canonicalJson(finalityPolicy) !== canonicalJson(deployment.finality)
    || transaction.selector !== CUSTOM_LAUNCH_WALLET_TRANSACTION_SELECTOR_V4
    || calldata.slice(0, 10) !== CUSTOM_LAUNCH_WALLET_TRANSACTION_SELECTOR_V4
    || transaction.routerRuntimeCodeHash
      !== CUSTOM_LAUNCH_ROBINHOOD_ROUTER_RUNTIME_CODE_HASH_V4
    || summary.chainName !== "Robinhood Chain Mainnet"
    || !new Set(["none", "wallet-transaction-value"]).has(String(summary.fundingMode))
    || summary.valueWei !== valueWei) return invalid();
  const withoutHash = {
    schemaVersion: transaction.schemaVersion,
    chainId: transaction.chainId,
    caip2: transaction.caip2,
    apiVersion: transaction.apiVersion,
    chainDeploymentId: transaction.chainDeploymentId,
    chainDeploymentDescriptorDigest: transaction.chainDeploymentDescriptorDigest,
    chainDeployment: deployment,
    profile,
    finalityPolicy,
    from,
    to,
    valueWei,
    calldata,
    selector: transaction.selector,
    routerRuntimeCodeHash: transaction.routerRuntimeCodeHash,
    expiresAt: canonicalIsoTimestamp(transaction.expiresAt).source,
    commitments,
    launchSummary: summary,
  };
  if (exactWalletTransactionPreimageHashV4(withoutHash) !== transactionPreimageHash) {
    return invalid();
  }
  return deepFreeze({ ...withoutHash, transactionPreimageHash });
}

function assertDecodedCalldata(
  calldata: Hex,
  artifact: CustomLaunchPreparedArtifactV4,
) {
  try {
    const decoded = decodeFunctionData({ abi: LAUNCH_AND_STAMP_ABI_V4, data: calldata });
    if (decoded.functionName !== "launchAndStampV1" || decoded.args.length !== 4) {
      return invalid();
    }
    const canonical = encodeFunctionData({
      abi: LAUNCH_AND_STAMP_ABI_V4,
      functionName: "launchAndStampV1",
      args: [decoded.args[0], decoded.args[1], decoded.args[2], decoded.args[3]],
    });
    const decodedPermit = normalizeDecodedPermit(decoded.args[0]);
    const decodedStamp = normalizeDecodedStamp(decoded.args[1]);
    if (canonical !== calldata
      || canonicalJson(decodedPermit) !== canonicalJson(artifact.permit)
      || canonicalJson(decodedStamp) !== canonicalJson(artifact.stampRequest)
      || decoded.args[2] !== artifact.routePayload
      || decoded.args[3] !== artifact.permitSignature) return invalid();
  } catch (error) {
    if (error instanceof CustomLaunchWalletHandoffErrorV4) throw error;
    return invalid();
  }
}

function exactPreparedArtifact(value: unknown): CustomLaunchPreparedArtifactV4 {
  const artifact = exactRecord(value, PREPARED_ARTIFACT_KEYS);
  const permitValue = exactRecord(artifact.permit, PERMIT_KEYS);
  const stampRequest = exactStampRequest(artifact.stampRequest);
  const routePayload = exactHex(artifact.routePayload, true);
  const permitSignature = exactHex(artifact.permitSignature, true);
  const permit = deepFreeze({
    chainId: canonicalUint(permitValue.chainId, UINT256_MAXIMUM).source,
    router: canonicalAddress(permitValue.router),
    launchWallet: canonicalAddress(permitValue.launchWallet),
    kind: permitValue.kind as 1,
    routePayloadHash: exactLowerBytes32(permitValue.routePayloadHash),
    expectedResultHash: exactLowerBytes32(permitValue.expectedResultHash),
    stampRequestHash: exactLowerBytes32(permitValue.stampRequestHash),
    nonce: exactLowerBytes32(permitValue.nonce),
    validAfter: canonicalUint(permitValue.validAfter, UINT64_MAXIMUM).source,
    deadline: canonicalUint(permitValue.deadline, UINT64_MAXIMUM).source,
    valueWei: canonicalUint(permitValue.valueWei, UINT256_MAXIMUM).source,
  });
  const hashes = deriveCustomLaunchArtifactHashesV4({ routePayload, stampRequest });
  const route = decodeCanonicalRoute(routePayload);
  const totalValue = route.targets.reduce(
    (sum, target) => sum + target.deploymentValue + target.initializerValue,
    0n,
  );
  const byResult = new Map(stampRequest.components.map((component) => [
    component.resultIndex,
    component,
  ]));
  const tokenComponents = stampRequest.components.filter(({ kind }) => kind === 1);
  const hookComponents = stampRequest.components.filter(({ kind }) => kind === 2);
  if (permit.chainId !== CUSTOM_LAUNCH_ROBINHOOD_CHAIN_ID_V4
    || permit.router !== CUSTOM_LAUNCH_ROBINHOOD_ROUTER_V4
    || permit.kind !== 1
    || permit.routePayloadHash !== hashes.routePayloadHash
    || permit.expectedResultHash !== hashes.expectedResultHash
    || permit.stampRequestHash !== hashes.stampRequestHash
    || permit.valueWei !== totalValue.toString()
    || byResult.size !== route.expectedOutputs.length
    || route.expectedOutputs.some((output) => {
      const component = byResult.get(Number(output.targetIndex));
      return component === undefined
        || component.account !== getAddress(output.account)
        || component.runtimeCodeHash !== output.runtimeCodeHash;
    })
    || tokenComponents.length !== 1
    || hookComponents.length !== 1
    || stampRequest.token !== tokenComponents[0]?.account
    || stampRequest.tokenRuntimeCodeHash !== tokenComponents[0]?.runtimeCodeHash
    || stampRequest.poolKey.hooks !== hookComponents[0]?.account
    || stampRequest.hookRuntimeCodeHash !== hookComponents[0]?.runtimeCodeHash
    || !/^0x[0-9a-f]{130}$/u.test(permitSignature)) return invalid();
  return deepFreeze({ permit, stampRequest, routePayload, permitSignature });
}

function exactBackendPreparedArtifact(
  value: unknown,
  calldata: Hex,
  commitments: CustomLaunchCommitmentsV4,
  chainDeployment: ReturnType<typeof exactChainDeployment>,
): CustomLaunchPreparedArtifactV4 {
  const artifact = exactRecord(value, BACKEND_PREPARED_ARTIFACT_KEYS);
  if (artifact.schemaVersion !== "programmable.prepared-custom-graph-launch.v1") return invalid();
  const artifactHash = exactSha256(artifact.artifactHash);
  const { artifactHash: _ignored, ...preimage } = artifact;
  const recomputed = `sha256:${sha256(stringToHex(canonicalJson(preimage))).slice(2)}`;
  if (artifactHash !== recomputed
    || exactSha256(artifact.graphBundleHash) !== commitments.graph
    || exactSha256(artifact.projectMetadataHash) !== commitments.metadata
    || exactSha256(artifact.verificationBundleHash) !== commitments.verification
    || exactSha256(artifact.sourceBundleSha256) !== artifact.sourceBundleSha256) {
    return invalid();
  }
  let decoded;
  try {
    decoded = decodeFunctionData({ abi: LAUNCH_AND_STAMP_ABI_V4, data: calldata });
  } catch {
    return invalid();
  }
  if (decoded.functionName !== "launchAndStampV1") return invalid();
  const routeValue = exactRecord(artifact.route, [
    "routeNamespace", "routeNonce", "topologyHash", "graphCommitment",
    "totalValueWei", "routePayload", "routePayloadHash",
    "expectedGraphDeploymentHash", "targets",
  ]);
  const compact = exactPreparedArtifact({
    permit: artifact.permit,
    stampRequest: artifact.stampRequest,
    routePayload: routeValue.routePayload,
    permitSignature: decoded.args[3],
  });
  const chainBindings = exactRecord(artifact.chainBindings, [
    "chainId", "router", "routerRuntimeCodeHash", "permitAuthority",
    "permitAuthorityRuntimeCodeHash", "graphFactory", "graphFactoryRuntimeCodeHash",
    "poolManager", "poolManagerRuntimeCodeHash",
  ]);
  const roots = chainDeployment.contracts;
  if (chainBindings.chainId !== CUSTOM_LAUNCH_ROBINHOOD_CHAIN_ID_V4
    || canonicalAddress(chainBindings.router) !== roots.programmableLaunchStampRouter.address
    || exactLowerBytes32(chainBindings.routerRuntimeCodeHash)
      !== roots.programmableLaunchStampRouter.runtimeCodeHash
    || canonicalAddress(chainBindings.permitAuthority) !== roots.permitAuthority.address
    || exactLowerBytes32(chainBindings.permitAuthorityRuntimeCodeHash)
      !== roots.permitAuthority.runtimeCodeHash
    || canonicalAddress(chainBindings.graphFactory) !== roots.graphFactory.address
    || exactLowerBytes32(chainBindings.graphFactoryRuntimeCodeHash)
      !== roots.graphFactory.runtimeCodeHash
    || canonicalAddress(chainBindings.poolManager) !== roots.poolManager.address
    || exactLowerBytes32(chainBindings.poolManagerRuntimeCodeHash)
      !== roots.poolManager.runtimeCodeHash
    || routeValue.routeNonce !== compact.permit.nonce
    || routeValue.totalValueWei !== compact.permit.valueWei
    || routeValue.routePayloadHash !== compact.permit.routePayloadHash
    || artifact.stampRequestHash !== compact.permit.stampRequestHash) return invalid();
  const unsigned = exactRecord(artifact.unsignedRouterTransaction, [
    "chainId", "from", "to", "valueWei", "functionName", "selector",
    "calldataWithEmptySignature", "signatureState", "preimageHash",
  ]);
  const unsignedPreimage = {
    chainId: unsigned.chainId,
    from: unsigned.from,
    to: unsigned.to,
    valueWei: unsigned.valueWei,
    functionName: unsigned.functionName,
    selector: unsigned.selector,
    calldataWithEmptySignature: unsigned.calldataWithEmptySignature,
    signatureState: unsigned.signatureState,
  };
  const expectedEmptyCalldata = encodeFunctionData({
    abi: LAUNCH_AND_STAMP_ABI_V4,
    functionName: "launchAndStampV1",
    args: [decoded.args[0], decoded.args[1], decoded.args[2], "0x"],
  });
  if (unsigned.chainId !== compact.permit.chainId
    || canonicalAddress(unsigned.from) !== compact.permit.launchWallet
    || canonicalAddress(unsigned.to) !== compact.permit.router
    || unsigned.valueWei !== compact.permit.valueWei
    || unsigned.functionName !== "launchAndStampV1"
    || unsigned.selector !== CUSTOM_LAUNCH_WALLET_TRANSACTION_SELECTOR_V4
    || unsigned.calldataWithEmptySignature !== expectedEmptyCalldata
    || unsigned.signatureState !== "permit-authority-signature-required"
    || exactSha256(unsigned.preimageHash)
      !== `sha256:${sha256(stringToHex(canonicalJson(unsignedPreimage))).slice(2)}`) {
    return invalid();
  }
  return compact;
}

function exactStampRequest(value: unknown) {
  const stamp = exactRecord(value, STAMP_KEYS);
  const pool = exactRecord(stamp.poolKey, POOL_KEYS);
  if (!Array.isArray(stamp.components)
    || stamp.components.length < 3
    || stamp.components.length > 16) return invalid();
  const components = stamp.components.map((componentValue) => {
    const component = exactRecord(componentValue, COMPONENT_KEYS);
    if (!Number.isSafeInteger(component.resultIndex)
      || Number(component.resultIndex) < 0
      || Number(component.resultIndex) > 255
      || !Number.isSafeInteger(component.kind)
      || Number(component.kind) < 0
      || Number(component.kind) > 2
      || component.scope !== 1) return invalid();
    return deepFreeze({
      resultIndex: Number(component.resultIndex),
      account: canonicalAddress(component.account),
      runtimeCodeHash: exactLowerBytes32(component.runtimeCodeHash),
      kind: Number(component.kind),
      scope: 1 as const,
    });
  });
  if (!Number.isSafeInteger(pool.fee)
    || Number(pool.fee) < 0
    || Number(pool.fee) > 0xffffff
    || !Number.isSafeInteger(pool.tickSpacing)
    || Number(pool.tickSpacing) < -8_388_608
    || Number(pool.tickSpacing) > 8_388_607) return invalid();
  return deepFreeze({
    launchId: exactLowerBytes32(stamp.launchId),
    token: canonicalAddress(stamp.token),
    tokenRuntimeCodeHash: exactLowerBytes32(stamp.tokenRuntimeCodeHash),
    poolKey: {
      currency0: canonicalAddress(pool.currency0),
      currency1: canonicalAddress(pool.currency1),
      fee: Number(pool.fee),
      tickSpacing: Number(pool.tickSpacing),
      hooks: canonicalAddress(pool.hooks),
    },
    hookRuntimeCodeHash: exactLowerBytes32(stamp.hookRuntimeCodeHash),
    components,
  });
}

function normalizeDecodedPermit(permit: Readonly<Record<string, unknown>>) {
  return deepFreeze({
    chainId: String(permit.chainId),
    router: getAddress(String(permit.router)),
    launchWallet: getAddress(String(permit.launchWallet)),
    kind: Number(permit.kind),
    routePayloadHash: permit.routePayloadHash,
    expectedResultHash: permit.expectedResultHash,
    stampRequestHash: permit.stampRequestHash,
    nonce: permit.nonce,
    validAfter: String(permit.validAfter),
    deadline: String(permit.deadline),
    valueWei: String(permit.value),
  });
}

function normalizeDecodedStamp(stamp: Readonly<Record<string, unknown>>) {
  const pool = stamp.poolKey as Readonly<Record<string, unknown>>;
  const components = stamp.components as readonly Readonly<Record<string, unknown>>[];
  return deepFreeze({
    launchId: stamp.launchId,
    token: getAddress(String(stamp.token)),
    tokenRuntimeCodeHash: stamp.tokenRuntimeCodeHash,
    poolKey: {
      currency0: getAddress(String(pool.currency0)),
      currency1: getAddress(String(pool.currency1)),
      fee: Number(pool.fee),
      tickSpacing: Number(pool.tickSpacing),
      hooks: getAddress(String(pool.hooks)),
    },
    hookRuntimeCodeHash: stamp.hookRuntimeCodeHash,
    components: components.map((component) => ({
      resultIndex: Number(component.resultIndex),
      account: getAddress(String(component.account)),
      runtimeCodeHash: component.runtimeCodeHash,
      kind: Number(component.kind),
      scope: Number(component.scope),
    })),
  });
}

function decodeCanonicalRoute(routePayload: Hex) {
  try {
    const [route] = decodeAbiParameters(CUSTOM_GRAPH_ROUTE_PARAMETERS, routePayload);
    if (encodeAbiParameters(CUSTOM_GRAPH_ROUTE_PARAMETERS, [route]) !== routePayload
      || route.targets.length < 3
      || route.targets.length > 16
      || route.expectedOutputs.length !== route.targets.length
      || route.expectedOutputs.some((output, index) => output.targetIndex !== index
        || output.targetIdHash !== route.targets[index]?.targetIdHash)) return invalid();
    return route;
  } catch (error) {
    if (error instanceof CustomLaunchWalletHandoffErrorV4) throw error;
    return invalid();
  }
}

function expectedResultHash(route: ReturnType<typeof decodeCanonicalRoute>): Hex {
  const outputHashes = route.expectedOutputs.map((output) => abiHash(
    ["bytes32", "uint8", "bytes32", "address", "bytes32"],
    [
      EXPECTED_GRAPH_OUTPUT_TYPEHASH,
      output.targetIndex,
      output.targetIdHash,
      output.account,
      output.runtimeCodeHash,
    ],
  ));
  return abiHash(
    ["bytes32", "bytes32", "bytes32"],
    [EXPECTED_GRAPH_RESULT_TYPEHASH, packedHash(outputHashes), route.expectedGraphDeploymentHash],
  );
}

function stampRequestHash(stamp: ReturnType<typeof exactStampRequest>): Hex {
  const poolKeyHash = abiHash(
    ["bytes32", "address", "address", "uint24", "int24", "address"],
    [
      POOL_KEY_TYPEHASH,
      stamp.poolKey.currency0,
      stamp.poolKey.currency1,
      stamp.poolKey.fee,
      stamp.poolKey.tickSpacing,
      stamp.poolKey.hooks,
    ],
  );
  const componentHashes = stamp.components.map((component) => abiHash(
    ["bytes32", "uint8", "address", "bytes32", "uint8", "uint8"],
    [
      COMPONENT_TYPEHASH,
      component.resultIndex,
      component.account,
      component.runtimeCodeHash,
      component.kind,
      component.scope,
    ],
  ));
  return abiHash(
    ["bytes32", "bytes32", "address", "bytes32", "bytes32", "bytes32", "bytes32"],
    [
      STAMP_REQUEST_TYPEHASH,
      stamp.launchId,
      stamp.token,
      stamp.tokenRuntimeCodeHash,
      poolKeyHash,
      stamp.hookRuntimeCodeHash,
      packedHash(componentHashes),
    ],
  );
}

function abiHash(types: readonly string[], values: readonly unknown[]): Hex {
  return keccak256(encodeAbiParameters(
    types.map((type) => ({ type })) as never,
    values as never,
  ));
}

function packedHash(values: readonly Hex[]): Hex {
  return keccak256(values.length === 0 ? "0x" : concatHex(values));
}

function exactChainDeployment(value: unknown) {
  const deployment = exactRecord(value, [
    "schemaVersion", "chainDeploymentId", "chainId", "caip2", "finality",
    "foundationSourceCommitment", "deploymentEvidence", "permit2GenesisProvenance",
    "permitAuthoritySourceProvenance", "externalRootDeploymentEvidence", "contracts",
  ]);
  const finality = exactFinalityPolicy(deployment.finality);
  const deploymentEvidence = exactAtomicDeploymentEvidence(deployment.deploymentEvidence);
  const blockNumber = deploymentEvidence.blockNumber;
  if (deployment.schemaVersion !== "programmable.custom-launch-chain-deployment.v1"
    || deployment.chainDeploymentId !== CUSTOM_LAUNCH_ROBINHOOD_DEPLOYMENT_ID_V4
    || deployment.chainId !== CUSTOM_LAUNCH_ROBINHOOD_CHAIN_ID_V4
    || deployment.caip2 !== CUSTOM_LAUNCH_ROBINHOOD_CAIP2_V4
    || deployment.foundationSourceCommitment !== FOUNDATION_SOURCE_COMMITMENT) return invalid();
  const contractsValue = exactRecord(deployment.contracts, TRUST_ROOT_KEYS);
  const contracts = Object.fromEntries(TRUST_ROOT_KEYS.map((name) => {
    const binding = exactRecord(contractsValue[name], ["address", "runtimeCodeHash"]);
    const expected = CUSTOM_LAUNCH_ROBINHOOD_TRUST_ROOTS_V4[
      name as keyof typeof CUSTOM_LAUNCH_ROBINHOOD_TRUST_ROOTS_V4
    ];
    if (canonicalAddress(binding.address) !== expected.address
      || exactLowerBytes32(binding.runtimeCodeHash) !== expected.runtimeCodeHash) {
      return invalid();
    }
    return [name, expected];
  }));
  const permit2Provenance = exactRecord(deployment.permit2GenesisProvenance, [
    "schemaVersion", "kind", "address", "startBlock", "genesisSourceUrl",
    "genesisSourceDigest", "allocRuntimeCodeBytes", "providerReadbacks", "evidenceDigest",
  ]);
  if (permit2Provenance.schemaVersion
      !== "programmable.custom-launch-genesis-provenance.v1"
    || permit2Provenance.kind !== "genesis-predeploy"
    || canonicalAddress(permit2Provenance.address)
      !== CUSTOM_LAUNCH_ROBINHOOD_TRUST_ROOTS_V4.permit2.address
    || permit2Provenance.startBlock !== "0"
    || permit2Provenance.genesisSourceUrl !== PERMIT2_GENESIS_SOURCE_URL
    || permit2Provenance.genesisSourceDigest !== PERMIT2_GENESIS_SOURCE_DIGEST
    || permit2Provenance.allocRuntimeCodeBytes !== PERMIT2_GENESIS_RUNTIME_CODE_BYTES
    || !Array.isArray(permit2Provenance.providerReadbacks)
    || permit2Provenance.providerReadbacks.length !== 2) return invalid();
  const permit2ProviderReadbacks = [
    exactPermit2GenesisProviderReadback(
      permit2Provenance.providerReadbacks[0], "drpc", "drpc.org",
    ),
    exactPermit2GenesisProviderReadback(
      permit2Provenance.providerReadbacks[1], "alchemy", "alchemy.com",
    ),
  ];
  if (permit2ProviderReadbacks[0].blockHash !== permit2ProviderReadbacks[1].blockHash) {
    return invalid();
  }
  const permit2ProvenancePreimage = deepFreeze({
    schemaVersion: "programmable.custom-launch-genesis-provenance.v1" as const,
    kind: "genesis-predeploy" as const,
    address: CUSTOM_LAUNCH_ROBINHOOD_TRUST_ROOTS_V4.permit2.address,
    startBlock: "0" as const,
    genesisSourceUrl: PERMIT2_GENESIS_SOURCE_URL,
    genesisSourceDigest: PERMIT2_GENESIS_SOURCE_DIGEST,
    allocRuntimeCodeBytes: PERMIT2_GENESIS_RUNTIME_CODE_BYTES,
    providerReadbacks: permit2ProviderReadbacks,
  });
  if (exactSha256(permit2Provenance.evidenceDigest)
      !== framedSha256(permit2ProvenancePreimage.schemaVersion, permit2ProvenancePreimage)) {
    return invalid();
  }
  const permitAuthorityProvenance = exactRecord(
    deployment.permitAuthoritySourceProvenance,
    [
      "schemaVersion", "kind", "address", "transactionHash", "blockNumber",
      "blockHash", "sourceCommitment", "evidenceDigest", "configurationEvidence",
    ],
  );
  const permitAuthorityBlock = canonicalUint(
    permitAuthorityProvenance.blockNumber,
    UINT256_MAXIMUM,
  ).source;
  if (permitAuthorityProvenance.schemaVersion
      !== "programmable.custom-launch-deployment-evidence.v1"
    || permitAuthorityProvenance.kind !== "official-source-pinned"
    || canonicalAddress(permitAuthorityProvenance.address)
      !== CUSTOM_LAUNCH_ROBINHOOD_TRUST_ROOTS_V4.permitAuthority.address
    || exactLowerBytes32(permitAuthorityProvenance.transactionHash)
      === `0x${"0".repeat(64)}`
    || permitAuthorityBlock === "0"
    || exactLowerBytes32(permitAuthorityProvenance.blockHash)
      === `0x${"0".repeat(64)}`
    || permitAuthorityProvenance.sourceCommitment !== SAFE_SOURCE_COMMITMENT) return invalid();
  const configurationEvidence = exactSafeConfigurationEvidence(
    permitAuthorityProvenance.configurationEvidence,
  );
  const permitAuthorityProvenancePreimage = deepFreeze({
    schemaVersion: "programmable.custom-launch-deployment-evidence.v1" as const,
    kind: "official-source-pinned" as const,
    address: CUSTOM_LAUNCH_ROBINHOOD_TRUST_ROOTS_V4.permitAuthority.address,
    transactionHash: exactLowerBytes32(permitAuthorityProvenance.transactionHash),
    blockNumber: permitAuthorityBlock,
    blockHash: exactLowerBytes32(permitAuthorityProvenance.blockHash),
    sourceCommitment: SAFE_SOURCE_COMMITMENT,
    configurationEvidence,
  });
  const permitAuthorityEvidenceDigest = exactSha256(permitAuthorityProvenance.evidenceDigest);
  if (permitAuthorityEvidenceDigest !== framedSha256(
    permitAuthorityProvenancePreimage.schemaVersion,
    permitAuthorityProvenancePreimage,
  )) return invalid();
  if (configurationEvidence.proxyRuntimeCodeHash
      !== CUSTOM_LAUNCH_ROBINHOOD_TRUST_ROOTS_V4.permitAuthority.runtimeCodeHash) {
    return invalid();
  }
  if (deploymentEvidence.transactionHash !== permitAuthorityProvenance.transactionHash
    || blockNumber !== permitAuthorityBlock
    || deploymentEvidence.blockHash !== permitAuthorityProvenance.blockHash
    || configurationEvidence.blockNumber !== blockNumber
    || configurationEvidence.blockHash !== deploymentEvidence.blockHash
    || configurationEvidence.ethereumFinalityEvidence.l2Checkpoint.blockNumber !== blockNumber
    || configurationEvidence.ethereumFinalityEvidence.l2Checkpoint.blockHash
      !== deploymentEvidence.blockHash
    || canonicalJson(configurationEvidence.ethereumFinalityEvidence)
      !== canonicalJson(deploymentEvidence.ethereumFinalityEvidence)) return invalid();
  for (const result of deploymentEvidence.resultingContracts) {
    const binding = contracts[result.contract];
    if (result.address !== binding.address || result.runtimeCodeHash !== binding.runtimeCodeHash) {
      return invalid();
    }
  }
  if (deploymentEvidence.resultingContracts[0].stateEvidenceDigest
      !== configurationEvidence.atomicRootStateEvidenceDigest) return invalid();
  const externalRootDeploymentEvidence = exactExternalRootDeploymentEvidence(
    deployment.externalRootDeploymentEvidence,
  );
  return deepFreeze({
    schemaVersion: deployment.schemaVersion,
    chainDeploymentId: deployment.chainDeploymentId,
    chainId: deployment.chainId,
    caip2: deployment.caip2,
    finality,
    foundationSourceCommitment: deployment.foundationSourceCommitment,
    deploymentEvidence,
    permit2GenesisProvenance: {
      ...permit2ProvenancePreimage,
      evidenceDigest: permit2Provenance.evidenceDigest,
    },
    permitAuthoritySourceProvenance: {
      ...permitAuthorityProvenancePreimage,
      evidenceDigest: permitAuthorityEvidenceDigest,
    },
    externalRootDeploymentEvidence,
    contracts,
  });
}

function exactAtomicDeploymentEvidence(value: unknown) {
  const evidence = exactRecord(value, [
    "schemaVersion", "deploymentId", "chainId", "coveredContracts", "transactionHash",
    "from", "to", "valueWei", "selector", "calldataHash", "calldataBytes",
    "nonce", "transactionIndex", "receiptStatus", "blockNumber", "blockHash",
    "receiptLogs", "receiptLogsDigest", "providerReadbacks", "resultingContracts",
    "ethereumFinalityEvidence", "evidenceDigest", "sourceVerification",
  ]);
  const sourceVerification = exactRecord(evidence.sourceVerification, [
    "sourcifyProviderMatchCoveredContracts",
    "exactByteSourceBuildTransactionCoveredContracts",
    "officialSourcePinnedCoveredContracts",
  ]);
  const transactionHash = exactLowerBytes32(evidence.transactionHash);
  const from = canonicalAddress(evidence.from);
  const blockNumber = canonicalUint(evidence.blockNumber, UINT256_MAXIMUM).source;
  const blockHash = exactLowerBytes32(evidence.blockHash);
  const nonce = canonicalUint(evidence.nonce, UINT256_MAXIMUM).source;
  const transactionIndex = canonicalUint(evidence.transactionIndex, UINT256_MAXIMUM).source;
  if (evidence.schemaVersion !== ATOMIC_DEPLOYMENT_EVIDENCE_SCHEMA
    || evidence.deploymentId !== CUSTOM_LAUNCH_ROBINHOOD_DEPLOYMENT_ID_V4
    || evidence.chainId !== CUSTOM_LAUNCH_ROBINHOOD_CHAIN_ID_V4
    || canonicalJson(evidence.coveredContracts)
      !== canonicalJson(["programmableLaunchStampRouter", "graphFactory", "permitAuthority"])
    || canonicalJson(sourceVerification.sourcifyProviderMatchCoveredContracts)
      !== canonicalJson(["programmableLaunchStampRouter", "graphFactory"])
    || canonicalJson(
      sourceVerification.exactByteSourceBuildTransactionCoveredContracts,
    )
      !== canonicalJson(["programmableLaunchStampRouter", "graphFactory"])
    || canonicalJson(sourceVerification.officialSourcePinnedCoveredContracts)
      !== canonicalJson(["permitAuthority"])
    || transactionHash === `0x${"0".repeat(64)}`
    || !SAFE_OWNERS.includes(from as never)
    || canonicalAddress(evidence.to) !== ROBINHOOD_MULTICALL3
    || evidence.valueWei !== "0"
    || evidence.selector !== ATOMIC_DEPLOYMENT_SELECTOR
    || evidence.calldataHash !== ATOMIC_DEPLOYMENT_CALLDATA_HASH
    || evidence.calldataBytes !== ATOMIC_DEPLOYMENT_CALLDATA_BYTES
    || evidence.receiptStatus !== "1"
    || blockNumber === "0"
    || blockHash === `0x${"0".repeat(64)}`
    || !Array.isArray(evidence.receiptLogs) || evidence.receiptLogs.length > 1_024
    || !Array.isArray(evidence.providerReadbacks) || evidence.providerReadbacks.length !== 2
    || !Array.isArray(evidence.resultingContracts) || evidence.resultingContracts.length !== 3) {
    return invalid();
  }
  const receiptLogs = evidence.receiptLogs.map((item) => {
    const log = exactRecord(item, ["address", "topics", "data", "logIndex"]);
    if (!Array.isArray(log.topics) || log.topics.length > 4) return invalid();
    const topics = log.topics.map((topic) => {
      const normalized = exactLowerBytes32(topic);
      if (normalized === `0x${"0".repeat(64)}`) return invalid();
      return normalized;
    });
    return deepFreeze({
      address: canonicalAddress(log.address),
      topics,
      data: exactHex(log.data, true),
      logIndex: canonicalUint(log.logIndex, UINT256_MAXIMUM).source,
    });
  });
  if (new Set(receiptLogs.map(({ logIndex }) => logIndex)).size !== receiptLogs.length
    || receiptLogs.some((entry, index) => index > 0
      && BigInt(entry.logIndex) <= BigInt(receiptLogs[index - 1].logIndex))) return invalid();
  const receiptLogsDigest = exactSha256(evidence.receiptLogsDigest);
  if (receiptLogsDigest !== framedSha256(ATOMIC_RECEIPT_LOGS_SCHEMA, receiptLogs)) {
    return invalid();
  }
  const providerReadbacks = [
    exactAtomicProviderReadback(evidence.providerReadbacks[0], transactionHash, "drpc", "drpc.org"),
    exactAtomicProviderReadback(
      evidence.providerReadbacks[1], transactionHash, "alchemy", "alchemy.com",
    ),
  ];
  const resultingContracts = [
    exactAtomicDeploymentResult(
      evidence.resultingContracts[0], "permitAuthority", blockNumber, blockHash,
    ),
    exactAtomicDeploymentResult(
      evidence.resultingContracts[1], "graphFactory", blockNumber, blockHash,
    ),
    exactAtomicDeploymentResult(
      evidence.resultingContracts[2], "programmableLaunchStampRouter", blockNumber, blockHash,
    ),
  ];
  const ethereumFinalityEvidence = exactEthereumFinalityEvidence(
    evidence.ethereumFinalityEvidence,
  );
  if (ethereumFinalityEvidence.l2Checkpoint.blockNumber !== blockNumber
    || ethereumFinalityEvidence.l2Checkpoint.blockHash !== blockHash) return invalid();
  const preimage = deepFreeze({
    schemaVersion: ATOMIC_DEPLOYMENT_EVIDENCE_SCHEMA,
    deploymentId: CUSTOM_LAUNCH_ROBINHOOD_DEPLOYMENT_ID_V4,
    chainId: CUSTOM_LAUNCH_ROBINHOOD_CHAIN_ID_V4,
    coveredContracts: ["programmableLaunchStampRouter", "graphFactory", "permitAuthority"],
    transactionHash,
    from,
    to: ROBINHOOD_MULTICALL3,
    valueWei: "0" as const,
    selector: ATOMIC_DEPLOYMENT_SELECTOR,
    calldataHash: ATOMIC_DEPLOYMENT_CALLDATA_HASH,
    calldataBytes: ATOMIC_DEPLOYMENT_CALLDATA_BYTES,
    nonce,
    transactionIndex,
    receiptStatus: "1" as const,
    blockNumber,
    blockHash,
    receiptLogs,
    receiptLogsDigest,
    providerReadbacks,
    resultingContracts,
    ethereumFinalityEvidence,
    sourceVerification: {
      sourcifyProviderMatchCoveredContracts: [
        "programmableLaunchStampRouter", "graphFactory",
      ],
      exactByteSourceBuildTransactionCoveredContracts: [
        "programmableLaunchStampRouter", "graphFactory",
      ],
      officialSourcePinnedCoveredContracts: ["permitAuthority"],
    },
  });
  const evidenceDigest = exactSha256(evidence.evidenceDigest);
  if (evidenceDigest !== framedSha256(ATOMIC_DEPLOYMENT_EVIDENCE_SCHEMA, preimage)) {
    return invalid();
  }
  return deepFreeze({ ...preimage, evidenceDigest });
}

function exactAtomicProviderReadback(
  value: unknown,
  transactionHash: Hex,
  providerId: "drpc" | "alchemy",
  trustDomain: "drpc.org" | "alchemy.com",
) {
  const readback = exactRecord(value, [
    "providerId", "trustDomain", "transactionHash", "transactionResponseDigest",
    "transactionReceiptDigest", "evidenceDigest",
  ]);
  if (readback.providerId !== providerId || readback.trustDomain !== trustDomain
    || exactLowerBytes32(readback.transactionHash) !== transactionHash) return invalid();
  const preimage = deepFreeze({
    providerId,
    trustDomain,
    transactionHash,
    transactionResponseDigest: exactSha256(readback.transactionResponseDigest),
    transactionReceiptDigest: exactSha256(readback.transactionReceiptDigest),
  });
  const evidenceDigest = exactSha256(readback.evidenceDigest);
  if (evidenceDigest !== framedSha256(ATOMIC_PROVIDER_READBACK_SCHEMA, preimage)) {
    return invalid();
  }
  return deepFreeze({ ...preimage, evidenceDigest });
}

function exactAtomicDeploymentResult(
  value: unknown,
  contract: "permitAuthority" | "graphFactory" | "programmableLaunchStampRouter",
  deploymentBlockNumber: string,
  deploymentBlockHash: Hex,
) {
  const result = exactRecord(value, [
    "contract", "address", "runtimeCodeHash", "previousBlockRuntimeCodeHash",
    "providerReadbacks", "stateEvidenceDigest",
  ]);
  const expected = CUSTOM_LAUNCH_ROBINHOOD_TRUST_ROOTS_V4[contract];
  if (result.contract !== contract
    || canonicalAddress(result.address) !== expected.address
    || exactLowerBytes32(result.runtimeCodeHash) !== expected.runtimeCodeHash
    || result.previousBlockRuntimeCodeHash !== EMPTY_RUNTIME_CODE_HASH
    || !Array.isArray(result.providerReadbacks)
    || result.providerReadbacks.length !== 2) return invalid();
  const providerReadbacks = [
    exactAtomicRuntimeTransitionReadback(
      result.providerReadbacks[0], contract, expected, deploymentBlockNumber,
      deploymentBlockHash, "drpc", "drpc.org",
    ),
    exactAtomicRuntimeTransitionReadback(
      result.providerReadbacks[1], contract, expected, deploymentBlockNumber,
      deploymentBlockHash, "alchemy", "alchemy.com",
    ),
  ];
  if (providerReadbacks[0].preDeploymentBlockHash
      !== providerReadbacks[1].preDeploymentBlockHash) return invalid();
  const preimage = deepFreeze({
    contract,
    address: expected.address,
    runtimeCodeHash: expected.runtimeCodeHash,
    previousBlockRuntimeCodeHash: EMPTY_RUNTIME_CODE_HASH,
    providerReadbacks,
  });
  const stateEvidenceDigest = exactSha256(result.stateEvidenceDigest);
  if (stateEvidenceDigest !== framedSha256(ATOMIC_RESULT_STATE_SCHEMA, preimage)) return invalid();
  return deepFreeze({ ...preimage, stateEvidenceDigest });
}

function exactAtomicRuntimeTransitionReadback(
  value: unknown,
  contract: "permitAuthority" | "graphFactory" | "programmableLaunchStampRouter",
  expected: Readonly<{ address: string; runtimeCodeHash: Hex }>,
  deploymentBlockNumber: string,
  deploymentBlockHash: Hex,
  providerId: "drpc" | "alchemy",
  trustDomain: "drpc.org" | "alchemy.com",
) {
  const readback = exactRecord(value, [
    "schemaVersion", "providerId", "trustDomain", "contract", "address",
    "preDeploymentBlockNumber", "preDeploymentBlockHash",
    "preDeploymentRuntimeCodeHash", "deploymentBlockNumber", "deploymentBlockHash",
    "deploymentRuntimeCodeHash", "evidenceDigest",
  ]);
  const preDeploymentBlockNumber = (BigInt(deploymentBlockNumber) - 1n).toString();
  const preDeploymentBlockHash = exactLowerBytes32(readback.preDeploymentBlockHash);
  if (readback.schemaVersion !== ATOMIC_RUNTIME_TRANSITION_PROVIDER_READBACK_SCHEMA
    || readback.providerId !== providerId
    || readback.trustDomain !== trustDomain
    || readback.contract !== contract
    || canonicalAddress(readback.address) !== expected.address
    || readback.preDeploymentBlockNumber !== preDeploymentBlockNumber
    || preDeploymentBlockHash === `0x${"0".repeat(64)}`
    || readback.preDeploymentRuntimeCodeHash !== EMPTY_RUNTIME_CODE_HASH
    || readback.deploymentBlockNumber !== deploymentBlockNumber
    || exactLowerBytes32(readback.deploymentBlockHash) !== deploymentBlockHash
    || exactLowerBytes32(readback.deploymentRuntimeCodeHash) !== expected.runtimeCodeHash) {
    return invalid();
  }
  const preimage = deepFreeze({
    schemaVersion: ATOMIC_RUNTIME_TRANSITION_PROVIDER_READBACK_SCHEMA,
    providerId,
    trustDomain,
    contract,
    address: expected.address,
    preDeploymentBlockNumber,
    preDeploymentBlockHash,
    preDeploymentRuntimeCodeHash: EMPTY_RUNTIME_CODE_HASH,
    deploymentBlockNumber,
    deploymentBlockHash,
    deploymentRuntimeCodeHash: expected.runtimeCodeHash,
  });
  const evidenceDigest = exactSha256(readback.evidenceDigest);
  if (evidenceDigest !== framedSha256(
    ATOMIC_RUNTIME_TRANSITION_PROVIDER_READBACK_SCHEMA,
    preimage,
  )) return invalid();
  return deepFreeze({ ...preimage, evidenceDigest });
}

function exactExternalRootDeploymentEvidence(value: unknown) {
  if (!Array.isArray(value) || value.length !== EXTERNAL_ROOT_KEYS.length) return invalid();
  return deepFreeze(value.map((item, index) => {
    const contract = EXTERNAL_ROOT_KEYS[index];
    const expected = EXTERNAL_ROOT_DEPLOYMENTS[contract];
    const evidence = exactRecord(item, [
      "schemaVersion", "contract", "kind", "address", "runtimeCodeHash",
      "transactionHash", "startBlock", "blockHash", "registrySource",
      "providerReadbacks", "evidenceDigest",
    ]);
    const registrySource = exactRecord(
      evidence.registrySource,
      ["repository", "commit", "path", "rawUrl", "sha256"],
    );
    const blockHash = exactLowerBytes32(evidence.blockHash);
    if (evidence.schemaVersion !== "programmable.custom-launch-deployment-evidence.v1"
      || evidence.contract !== contract
      || evidence.kind !== "exact-observed-deployment"
      || canonicalAddress(evidence.address) !== expected.address
      || exactLowerBytes32(evidence.runtimeCodeHash) !== expected.runtimeCodeHash
      || exactLowerBytes32(evidence.transactionHash) !== expected.transactionHash
      || evidence.startBlock !== expected.startBlock
      || blockHash === `0x${"0".repeat(64)}`
      || canonicalJson(registrySource) !== canonicalJson(UNISWAP_REGISTRY_SOURCE)
      || !Array.isArray(evidence.providerReadbacks)
      || evidence.providerReadbacks.length !== 2) return invalid();
    const providerReadbacks = [
      exactExternalRootProviderReadback(
        evidence.providerReadbacks[0], expected, "drpc", "drpc.org",
      ),
      exactExternalRootProviderReadback(
        evidence.providerReadbacks[1], expected, "alchemy", "alchemy.com",
      ),
    ];
    if (providerReadbacks[0].blockHash !== providerReadbacks[1].blockHash
      || blockHash !== providerReadbacks[0].blockHash) return invalid();
    const preimage = deepFreeze({
      schemaVersion: "programmable.custom-launch-deployment-evidence.v1" as const,
      contract,
      kind: "exact-observed-deployment" as const,
      address: expected.address,
      runtimeCodeHash: expected.runtimeCodeHash,
      transactionHash: expected.transactionHash,
      startBlock: expected.startBlock,
      blockHash,
      registrySource: UNISWAP_REGISTRY_SOURCE,
      providerReadbacks,
    });
    const evidenceDigest = exactSha256(evidence.evidenceDigest);
    if (evidenceDigest !== framedSha256(preimage.schemaVersion, preimage)) return invalid();
    return deepFreeze({ ...preimage, evidenceDigest });
  }));
}

function exactExternalRootProviderReadback(
  value: unknown,
  expected: Readonly<{
    transactionHash: string;
    startBlock: string;
    runtimeCodeHash: Hex;
  }>,
  providerId: "drpc" | "alchemy",
  trustDomain: "drpc.org" | "alchemy.com",
) {
  const readback = exactRecord(value, [
    "providerId", "trustDomain", "transactionHash", "blockNumber", "blockHash",
    "runtimeCodeHash", "transactionReceiptDigest", "evidenceDigest",
  ]);
  if (readback.providerId !== providerId || readback.trustDomain !== trustDomain
    || exactLowerBytes32(readback.transactionHash) !== expected.transactionHash
    || readback.blockNumber !== expected.startBlock
    || exactLowerBytes32(readback.runtimeCodeHash) !== expected.runtimeCodeHash) return invalid();
  const preimage = deepFreeze({
    providerId,
    trustDomain,
    transactionHash: expected.transactionHash,
    blockNumber: expected.startBlock,
    blockHash: exactLowerBytes32(readback.blockHash),
    runtimeCodeHash: expected.runtimeCodeHash,
    transactionReceiptDigest: exactSha256(readback.transactionReceiptDigest),
  });
  if (preimage.blockHash === `0x${"0".repeat(64)}`) return invalid();
  const evidenceDigest = exactSha256(readback.evidenceDigest);
  if (evidenceDigest !== framedSha256(EXTERNAL_DEPLOYMENT_PROVIDER_READBACK_SCHEMA, preimage)) {
    return invalid();
  }
  return deepFreeze({ ...preimage, evidenceDigest });
}

function exactSafeConfigurationEvidence(value: unknown) {
  const evidence = exactRecord(value, [
    "schemaVersion", "finalized", "blockNumber", "blockHash", "proxyRuntimeCodeHash",
    "singleton", "fallbackHandler", "fallbackHandlerRuntimeCodeHash", "owners", "threshold", "nonce", "modules", "modulesNext", "guard",
    "singletonSlot", "fallbackHandlerSlot", "guardSlot", "primaryProvider",
    "secondaryProvider", "atomicRootStateEvidenceDigest",
    "ethereumFinalityEvidence", "evidenceDigest",
  ]);
  const blockNumber = canonicalUint(evidence.blockNumber, UINT256_MAXIMUM).source;
  const nonce = canonicalUint(evidence.nonce, UINT256_MAXIMUM).source;
  const singleton = exactRecord(evidence.singleton, [
    "address", "runtimeCodeHash", "version", "sourceCommitment",
  ]);
  if (evidence.schemaVersion !== SAFE_CONFIGURATION_SCHEMA
    || evidence.finalized !== true
    || blockNumber === "0"
    || exactLowerBytes32(evidence.blockHash) === `0x${"0".repeat(64)}`
    || exactLowerBytes32(evidence.proxyRuntimeCodeHash)
      !== CUSTOM_LAUNCH_ROBINHOOD_TRUST_ROOTS_V4.permitAuthority.runtimeCodeHash
    || singleton.version !== "1.4.1"
    || exactLowerBytes32(singleton.runtimeCodeHash) !== SAFE_SINGLETON_RUNTIME_CODE_HASH
    || exactSha256(singleton.sourceCommitment) !== SAFE_SOURCE_COMMITMENT
    || canonicalAddress(singleton.address) !== SAFE_SINGLETON_ADDRESS
    || canonicalAddress(evidence.fallbackHandler) !== SAFE_FALLBACK_HANDLER_ADDRESS
    || evidence.fallbackHandlerRuntimeCodeHash
      !== SAFE_FALLBACK_HANDLER_RUNTIME_CODE_HASH
    || !Array.isArray(evidence.owners)
    || canonicalJson(evidence.owners) !== canonicalJson(SAFE_OWNERS)
    || !Array.isArray(evidence.modules)
    || evidence.modules.length !== 0
    || evidence.modulesNext !== SAFE_MODULES_END_SENTINEL
    || evidence.threshold !== 1
    || nonce !== "0"
    || evidence.guard !== null) return invalid();
  const owners = evidence.owners.map((owner) => canonicalAddress(owner));
  const modules = evidence.modules.map((module) => canonicalAddress(module));
  if (new Set(owners).size !== owners.length || new Set(modules).size !== modules.length) {
    return invalid();
  }
  const primaryProvider = exactSafeConfigurationProvider(
    evidence.primaryProvider,
    "drpc",
    "drpc.org",
  );
  const secondaryProvider = exactSafeConfigurationProvider(
    evidence.secondaryProvider,
    "alchemy",
    "alchemy.com",
  );
  const singletonSlot = exactLowerBytes32(evidence.singletonSlot);
  const fallbackHandlerSlot = exactLowerBytes32(evidence.fallbackHandlerSlot);
  const guardSlot = exactLowerBytes32(evidence.guardSlot);
  if (storageWordAddress(singletonSlot) !== SAFE_SINGLETON_ADDRESS.toLowerCase()
    || storageWordAddress(fallbackHandlerSlot) !== SAFE_FALLBACK_HANDLER_ADDRESS.toLowerCase()
    || storageWordAddress(guardSlot) !== null) return invalid();
  const ethereumFinalityEvidence = exactEthereumFinalityEvidence(
    evidence.ethereumFinalityEvidence,
  );
  if (ethereumFinalityEvidence.l2Checkpoint.blockNumber !== blockNumber
    || ethereumFinalityEvidence.l2Checkpoint.blockHash !== evidence.blockHash) return invalid();
  const withoutDigest = deepFreeze({
    schemaVersion: SAFE_CONFIGURATION_SCHEMA,
    finalized: true as const,
    blockNumber,
    blockHash: exactLowerBytes32(evidence.blockHash),
    proxyRuntimeCodeHash:
      CUSTOM_LAUNCH_ROBINHOOD_TRUST_ROOTS_V4.permitAuthority.runtimeCodeHash,
    singleton: {
      address: SAFE_SINGLETON_ADDRESS,
      runtimeCodeHash: SAFE_SINGLETON_RUNTIME_CODE_HASH,
      version: "1.4.1",
      sourceCommitment: SAFE_SOURCE_COMMITMENT,
    },
    fallbackHandler: SAFE_FALLBACK_HANDLER_ADDRESS,
    fallbackHandlerRuntimeCodeHash: SAFE_FALLBACK_HANDLER_RUNTIME_CODE_HASH,
    owners,
    threshold: 1,
    nonce: "0",
    modules,
    modulesNext: SAFE_MODULES_END_SENTINEL,
    guard: null,
    singletonSlot,
    fallbackHandlerSlot,
    guardSlot,
    primaryProvider,
    secondaryProvider,
    atomicRootStateEvidenceDigest: exactSha256(evidence.atomicRootStateEvidenceDigest),
    ethereumFinalityEvidence,
  });
  const evidenceDigest = exactSha256(evidence.evidenceDigest);
  if (evidenceDigest !== framedSha256(SAFE_CONFIGURATION_SCHEMA, withoutDigest)) return invalid();
  return deepFreeze({ ...withoutDigest, evidenceDigest });
}

function exactEthereumFinalityEvidence(value: unknown) {
  const evidence = exactRecord(value, [
    "schemaVersion", "profile", "l2Checkpoint", "batchNumber", "l2Providers",
    "ethereumProviders", "rollup", "sequencerInbox", "postingTransactionHash",
    "postingBlockNumber", "postingBlockHash", "postingLogIndex",
    "ethereumFinalizedCheckpoint", "observedAt", "evidenceDigest",
  ]);
  const l2Checkpoint = exactRecord(evidence.l2Checkpoint, ["blockNumber", "blockHash"]);
  const finalizedCheckpoint = exactRecord(
    evidence.ethereumFinalizedCheckpoint,
    ["blockNumber", "blockHash", "tag"],
  );
  const l2Block = canonicalUint(l2Checkpoint.blockNumber, UINT256_MAXIMUM).source;
  const batchNumber = canonicalUint(evidence.batchNumber, UINT256_MAXIMUM).source;
  const postingBlockNumber = canonicalUint(
    evidence.postingBlockNumber,
    UINT256_MAXIMUM,
  ).source;
  const postingLogIndex = canonicalUint(evidence.postingLogIndex, UINT256_MAXIMUM).source;
  const finalizedBlockNumber = canonicalUint(
    finalizedCheckpoint.blockNumber,
    UINT256_MAXIMUM,
  ).source;
  if (evidence.schemaVersion
      !== "programmable.robinhood-l2-checkpoint-ethereum-finality.v1"
    || l2Block === "0"
    || batchNumber === "0"
    || postingBlockNumber === "0"
    || finalizedBlockNumber === "0"
    || finalizedCheckpoint.tag !== "finalized"
    || BigInt(finalizedBlockNumber) < BigInt(postingBlockNumber)
    || !Array.isArray(evidence.l2Providers)
    || evidence.l2Providers.length !== 2
    || !Array.isArray(evidence.ethereumProviders)
    || evidence.ethereumProviders.length !== 2) return invalid();
  const l2Providers = [
    exactL2FinalityProvider(evidence.l2Providers[0], "drpc", "drpc.org"),
    exactL2FinalityProvider(evidence.l2Providers[1], "alchemy", "alchemy.com"),
  ];
  const ethereumProviders = [
    exactEthereumFinalityProvider(evidence.ethereumProviders[0], "drpc", "drpc.org"),
    exactEthereumFinalityProvider(
      evidence.ethereumProviders[1], "quicknode", "quicknode.com",
    ),
  ];
  if (canonicalAddress(evidence.rollup) !== ROBINHOOD_ETHEREUM_ROLLUP
    || canonicalAddress(evidence.sequencerInbox) !== ROBINHOOD_ETHEREUM_SEQUENCER_INBOX) {
    return invalid();
  }
  const preimage = deepFreeze({
    schemaVersion: "programmable.robinhood-l2-checkpoint-ethereum-finality.v1" as const,
    profile: exactProfile(evidence.profile),
    l2Checkpoint: {
      blockNumber: l2Block,
      blockHash: exactLowerBytes32(l2Checkpoint.blockHash),
    },
    batchNumber,
    l2Providers,
    ethereumProviders,
    rollup: ROBINHOOD_ETHEREUM_ROLLUP,
    sequencerInbox: ROBINHOOD_ETHEREUM_SEQUENCER_INBOX,
    postingTransactionHash: exactLowerBytes32(evidence.postingTransactionHash),
    postingBlockNumber,
    postingBlockHash: exactLowerBytes32(evidence.postingBlockHash),
    postingLogIndex,
    ethereumFinalizedCheckpoint: {
      blockNumber: finalizedBlockNumber,
      blockHash: exactLowerBytes32(finalizedCheckpoint.blockHash),
      tag: "finalized" as const,
    },
    observedAt: canonicalIsoTimestamp(evidence.observedAt).source,
  });
  const evidenceDigest = exactSha256(evidence.evidenceDigest);
  if (evidenceDigest !== framedSha256(preimage.schemaVersion, preimage)) return invalid();
  return deepFreeze({ ...preimage, evidenceDigest });
}

function exactL2FinalityProvider(
  value: unknown,
  providerId: "drpc" | "alchemy",
  trustDomain: "drpc.org" | "alchemy.com",
) {
  const provider = exactRecord(value, ["providerId", "trustDomain", "l1Confirmations"]);
  const l1Confirmations = canonicalUint(provider.l1Confirmations, UINT256_MAXIMUM).source;
  if (provider.providerId !== providerId || provider.trustDomain !== trustDomain
    || l1Confirmations === "0") return invalid();
  return deepFreeze({ providerId, trustDomain, l1Confirmations });
}

function exactEthereumFinalityProvider(
  value: unknown,
  providerId: "drpc" | "quicknode",
  trustDomain: "drpc.org" | "quicknode.com",
) {
  const provider = exactRecord(value, ["providerId", "trustDomain"]);
  if (provider.providerId !== providerId || provider.trustDomain !== trustDomain) return invalid();
  return deepFreeze({ providerId, trustDomain });
}

function storageWordAddress(value: Hex): string | null {
  const hex = value.slice(2);
  if (!/^0{24}[0-9a-f]{40}$/u.test(hex)) return invalid();
  const address = hex.slice(24);
  return /^0{40}$/u.test(address) ? null : `0x${address}`;
}

function exactSafeConfigurationProvider(
  value: unknown,
  providerId: string,
  trustDomain: string,
) {
  const provider = exactRecord(value, ["providerId", "trustDomain", "evidenceDigest"]);
  if (provider.providerId !== providerId || provider.trustDomain !== trustDomain) return invalid();
  return deepFreeze({
    providerId,
    trustDomain,
    evidenceDigest: exactSha256(provider.evidenceDigest),
  });
}

function exactPermit2GenesisProviderReadback(
  value: unknown,
  providerId: "drpc" | "alchemy",
  trustDomain: "drpc.org" | "alchemy.com",
) {
  const readback = exactRecord(value, [
    "schemaVersion", "providerId", "trustDomain", "blockNumber", "blockHash",
    "runtimeCodeHash", "evidenceDigest",
  ]);
  if (readback.schemaVersion !== "programmable.custom-launch-genesis-provider-readback.v1"
    || readback.providerId !== providerId
    || readback.trustDomain !== trustDomain
    || readback.blockNumber !== "0"
    || readback.runtimeCodeHash
      !== CUSTOM_LAUNCH_ROBINHOOD_TRUST_ROOTS_V4.permit2.runtimeCodeHash) return invalid();
  const preimage = deepFreeze({
    schemaVersion: "programmable.custom-launch-genesis-provider-readback.v1" as const,
    providerId,
    trustDomain,
    blockNumber: "0" as const,
    blockHash: exactLowerBytes32(readback.blockHash),
    runtimeCodeHash: CUSTOM_LAUNCH_ROBINHOOD_TRUST_ROOTS_V4.permit2.runtimeCodeHash,
  });
  const evidenceDigest = exactSha256(readback.evidenceDigest);
  if (evidenceDigest !== framedSha256(preimage.schemaVersion, preimage)) return invalid();
  return deepFreeze({ ...preimage, evidenceDigest });
}

function framedSha256(domain: string, value: unknown): `sha256:${string}` {
  return `sha256:${sha256(stringToHex(`${domain}\0${canonicalJson(value)}`)).slice(2)}`;
}

function chainDeploymentDigest(value: unknown): Hex {
  return keccak256(stringToHex(canonicalJson(exactChainDeployment(value))));
}

function exactFinalityPolicy(value: unknown) {
  const policy = exactRecord(value, [
    "schemaVersion", "policyId", "policyRevision", "policyDigest",
  ]);
  if (policy.schemaVersion !== "programmable.custom-launch-finality-policy-ref.v1"
    || policy.policyId !== "robinhood-stage-finality-v1"
    || policy.policyRevision !== 1
    || policy.policyDigest !== FINALITY_POLICY_DIGEST) return invalid();
  return deepFreeze({
    schemaVersion: policy.schemaVersion,
    policyId: policy.policyId,
    policyRevision: policy.policyRevision,
    policyDigest: policy.policyDigest,
  });
}

function exactProfile(value: unknown) {
  const profile = exactRecord(value, [
    "schemaVersion", "structuralProfileId", "businessProfileId",
    "admissionDescriptorDigest", "admissionPolicyDigest", "admissionBindingDigest",
    "admissionSchemaDigest",
    "profileRevision", "profileVersion", "profileDigest",
  ]);
  if (profile.schemaVersion !== "programmable.custom-launch-profile-ref.v4"
    || profile.structuralProfileId
      !== "programmable.custom-launch.robinhood-mainnet.v1"
    || profile.businessProfileId !== "robinhood-production-launch"
    || profile.admissionDescriptorDigest !== ADMISSION_DESCRIPTOR_DIGEST
    || profile.admissionPolicyDigest !== ADMISSION_POLICY_DIGEST
    || profile.admissionBindingDigest !== ADMISSION_BINDING_DIGEST
    || profile.admissionSchemaDigest !== ADMISSION_SCHEMA_DIGEST
    || profile.profileRevision !== 1
    || profile.profileVersion !== "4.0.0"
    || profile.profileDigest !== PROFILE_DIGEST) return invalid();
  const withoutDigest = deepFreeze({
    schemaVersion: profile.schemaVersion,
    structuralProfileId: profile.structuralProfileId,
    businessProfileId: profile.businessProfileId,
    admissionDescriptorDigest: ADMISSION_DESCRIPTOR_DIGEST,
    admissionPolicyDigest: ADMISSION_POLICY_DIGEST,
    admissionBindingDigest: ADMISSION_BINDING_DIGEST,
    admissionSchemaDigest: ADMISSION_SCHEMA_DIGEST,
    profileRevision: profile.profileRevision,
    profileVersion: profile.profileVersion,
  });
  if (framedSha256(PROFILE_DOMAIN_V4, withoutDigest) !== PROFILE_DIGEST) return invalid();
  return deepFreeze({ ...withoutDigest, profileDigest: PROFILE_DIGEST });
}

function exactCommitments(value: unknown): CustomLaunchCommitmentsV4 {
  const commitments = exactRecord(value, COMMITMENT_KEYS);
  return deepFreeze(Object.fromEntries(COMMITMENT_KEYS.map((key) => [
    key,
    exactSha256(commitments[key]),
  ])) as CustomLaunchCommitmentsV4);
}

function exactReview(value: unknown): CustomLaunchWalletReviewV4 {
  const review = exactRecord(value, REVIEW_KEYS);
  if (review.schemaVersion !== CUSTOM_LAUNCH_WALLET_REVIEW_SCHEMA_V4
    || review.chainId !== CUSTOM_LAUNCH_ROBINHOOD_CHAIN_ID_V4
    || review.caip2 !== CUSTOM_LAUNCH_ROBINHOOD_CAIP2_V4
    || exactLowerBytes32(review.chainDeploymentDescriptorDigest)
      !== review.chainDeploymentDescriptorDigest
    || review.routerRuntimeCodeHash
      !== CUSTOM_LAUNCH_ROBINHOOD_ROUTER_RUNTIME_CODE_HASH_V4) return invalid();
  return deepFreeze({
    schemaVersion: review.schemaVersion,
    chainId: review.chainId,
    caip2: review.caip2,
    chainDeploymentDescriptorDigest: review.chainDeploymentDescriptorDigest,
    profileDigest: exactSha256(review.profileDigest),
    walletRequest: exactWalletRequest(review.walletRequest),
    valueWei: canonicalUint(review.valueWei, UINT256_MAXIMUM).source,
    transactionPreimageHash: exactSha256(review.transactionPreimageHash),
    routerRuntimeCodeHash: review.routerRuntimeCodeHash,
    expiresAt: canonicalIsoTimestamp(review.expiresAt).source,
    commitments: exactCommitments(review.commitments),
  });
}

function exactWalletRequest(value: unknown): CustomLaunchWalletRequestV4 {
  const request = exactRecord(value, WALLET_REQUEST_KEYS);
  const from = canonicalAddress(request.from);
  const to = canonicalAddress(request.to);
  const data = exactHex(request.data, true);
  if (request.chainId !== CUSTOM_LAUNCH_ROBINHOOD_CHAIN_ID_HEX_V4
    || to !== CUSTOM_LAUNCH_ROBINHOOD_ROUTER_V4
    || data.slice(0, 10) !== CUSTOM_LAUNCH_WALLET_TRANSACTION_SELECTOR_V4
    || typeof request.value !== "string"
    || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/u.test(request.value)
    || toHex(BigInt(request.value)) !== request.value) return invalid();
  return deepFreeze({
    chainId: CUSTOM_LAUNCH_ROBINHOOD_CHAIN_ID_HEX_V4,
    from,
    to,
    data,
    value: request.value as Hex,
  });
}

async function assertProviderState(
  provider: CustomLaunchEip1193ProviderV4,
  expectedAccount: Address,
  expectedRuntimeCodeHash: Hex,
) {
  try {
    const chainBefore = await provider.request({ method: "eth_chainId" });
    const accountsBefore = await provider.request({ method: "eth_accounts" });
    const codeBefore = await provider.request({
      method: "eth_getCode",
      params: [CUSTOM_LAUNCH_ROBINHOOD_ROUTER_V4, "latest"],
    });
    const chainFinal = await provider.request({ method: "eth_chainId" });
    const accountsFinal = await provider.request({ method: "eth_accounts" });
    const codeFinal = await provider.request({
      method: "eth_getCode",
      params: [CUSTOM_LAUNCH_ROBINHOOD_ROUTER_V4, "latest"],
    });
    for (const chain of [chainBefore, chainFinal]) {
      if (chain !== CUSTOM_LAUNCH_ROBINHOOD_CHAIN_ID_HEX_V4) return invalid();
    }
    for (const accounts of [accountsBefore, accountsFinal]) {
      if (!Array.isArray(accounts) || accounts.length === 0
        || canonicalAddress(accounts[0]) !== expectedAccount) return invalid();
    }
    for (const code of [codeBefore, codeFinal]) {
      const runtime = exactHex(code, true);
      if (runtime === "0x" || keccak256(runtime) !== expectedRuntimeCodeHash) return invalid();
    }
  } catch (error) {
    if (error instanceof CustomLaunchWalletHandoffErrorV4) throw error;
    return invalid();
  }
}

function exactRecord(
  value: unknown,
  expectedKeys: readonly string[],
): Readonly<Record<string, unknown>> {
  const result = record(value);
  const keys = Object.keys(result);
  if (keys.length !== expectedKeys.length
    || keys.some((key) => !expectedKeys.includes(key))) return invalid();
  return result;
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (value === null || Array.isArray(value) || typeof value !== "object") return invalid();
  return value as Readonly<Record<string, unknown>>;
}

function canonicalAddress(value: unknown): Address {
  if (typeof value !== "string" || !isAddress(value)) return invalid();
  const address = getAddress(value);
  if (address !== value) return invalid();
  return address;
}

function exactHex(value: unknown, allowEmpty: boolean): Hex {
  if (typeof value !== "string" || !LOWER_HEX_DATA.test(value)
    || (!allowEmpty && value === "0x")) return invalid();
  return value as Hex;
}

function exactLowerBytes32(value: unknown): Hex {
  if (typeof value !== "string" || !LOWER_BYTES32.test(value)) return invalid();
  return value as Hex;
}

function exactSha256(value: unknown): `sha256:${string}` {
  if (typeof value !== "string" || !SHA256_DIGEST.test(value)) return invalid();
  return value as `sha256:${string}`;
}

function canonicalUint(value: unknown, maximum: bigint) {
  if (typeof value !== "string" || !CANONICAL_UINT.test(value)) return invalid();
  const parsed = BigInt(value);
  if (parsed > maximum) return invalid();
  return Object.freeze({ source: value, parsed });
}

function canonicalIsoTimestamp(value: unknown) {
  if (typeof value !== "string") return invalid();
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    return invalid();
  }
  return Object.freeze({ source: value, milliseconds });
}

function canonicalTimestamp(value: unknown) {
  try {
    canonicalIsoTimestamp(value);
    return true;
  } catch {
    return false;
  }
}

function boundedText(value: unknown, minimum: number, maximum: number) {
  if (typeof value !== "string" || value.length < minimum || value.length > maximum
    || value.trim() !== value || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) return invalid();
  return value;
}

function utf8Compare(left: string, right: string): number {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  const length = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    if (leftBytes[index] !== rightBytes[index]) {
      return leftBytes[index] - rightBytes[index];
    }
  }
  return leftBytes.length - rightBytes.length;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalJsonValue(value));
}

function canonicalJsonValue(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const candidate = (value as Record<string, unknown>)[key];
      if (candidate === undefined) return invalid();
      result[key] = canonicalJsonValue(candidate);
    }
    return result;
  }
  return invalid();
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function invalid(): never {
  throw new CustomLaunchWalletHandoffErrorV4();
}
