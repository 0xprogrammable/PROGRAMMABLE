import {
  concatHex,
  decodeAbiParameters,
  encodeAbiParameters,
  getAddress,
  getCreate2Address,
  hashTypedData,
  isAddress,
  keccak256,
  parseAbiParameters,
  recoverTypedDataAddress,
  serializeTypedData,
  sha256,
  stringToHex,
  toHex,
  type Address,
  type Hex,
} from "viem";

import {
  assertCustomLaunchWalletActionV1,
  CUSTOM_LAUNCH_MAINNET_ROUTER_V1,
  CUSTOM_LAUNCH_WALLET_TRANSACTION_SELECTOR_V1,
  type CustomLaunchWalletActionV1,
} from "./wallet-handoff-v1";
import { customLaunchWalletTransactionPreimageHashV2 } from
  "./wallet-handoff-v2";

export const CUSTOM_LAUNCH_AUTHORIZATION_RESULT_SCHEMA_V3 =
  "programmable.custom-launch-authorization-result.v3" as const;
export const CUSTOM_LAUNCH_FUNDING_CHALLENGE_SCHEMA_V1 =
  "programmable.custom-launch-funding-challenge.v1" as const;
export const CUSTOM_LAUNCH_FUNDING_DESCRIPTOR_SCHEMA_V1 =
  "programmable.funding-authorization-descriptor.v1" as const;
export const CUSTOM_LAUNCH_FUNDING_SIGNATURE_SCHEMA_V1 =
  "programmable.custom-launch-funding-authorization-signature.v1" as const;
export const CUSTOM_LAUNCH_EXACT_WALLET_TRANSACTION_SCHEMA_V3 =
  "programmable.exact-wallet-transaction.v3" as const;
export const CUSTOM_LAUNCH_MAINNET_USDC_V3 = getAddress(
  "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
);

const CUSTOM_GRAPH_FACTORY_V1 = getAddress(
  "0xB012e4A8F2c5FC4E8E4faCA9D5Ad6FfF13FBA887",
);
const UINT256_MAXIMUM = (1n << 256n) - 1n;
const SECP256K1_ORDER =
  0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const SECP256K1_HALF_ORDER =
  0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n;
const MAXIMUM_FUNDING_VALIDITY_SECONDS = 3_600n;
const MINIMUM_WALLET_SUBMISSION_WINDOW_SECONDS = 30n;
const V4_MAXIMUM_STATIC_FEE = 999_999n;
const V4_DYNAMIC_FEE_SENTINEL = 0x800000n;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_BYTES32 = `0x${"0".repeat(64)}`;
const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/u;
const BYTES32 = /^0x[0-9a-f]{64}$/u;
const LOWERCASE_HEX_DATA = /^0x(?:[0-9a-f]{2})+$/u;
const CANONICAL_UINT = /^(?:0|[1-9][0-9]*)$/u;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const FUNDING_SUBMISSION_IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{16,128}$/u;

const OUTPUT_KEYS = Object.freeze([
  "schemaVersion",
  "integrationState",
  "stage",
  "actionRequired",
  "fundingBoundary",
]);
const PLATFORM_ADMISSION_KEYS = Object.freeze([
  "schemaVersion",
  "disposition",
  "reportSha256",
  "warningFindingCodes",
  "routerSimulationRequiredBeforeAuthorization",
  "safetyClaim",
  "feeBehaviorClaim",
]);
const PLATFORM_ADMISSION_WARNING_CODES = new Set([
  "RUNTIME_CALLCODE",
  "RUNTIME_CREATE",
  "RUNTIME_CREATE2",
  "RUNTIME_DELEGATECALL",
  "RUNTIME_SELFDESTRUCT",
  "SOURCE_PROXY_OR_UPGRADE_SURFACE",
  "SOURCE_SELFDESTRUCT_SURFACE",
  "SOURCE_MUTABLE_PAUSE_SURFACE",
  "SOURCE_MUTABLE_BLOCKLIST_SURFACE",
  "SOURCE_MUTABLE_TAX_OR_FEE_SURFACE",
  "SOURCE_MUTABLE_TRANSFER_RESTRICTION",
  "SOURCE_MUTABLE_ADMIN_SURFACE",
  "SOURCE_PUBLIC_MINT_SURFACE",
  "V4_CALLBACK_AUTHENTICATION_REVIEW_REQUIRED",
  "SOURCE_TARGET_ANALYSIS_INCOMPLETE",
]);
const FUNDING_BOUNDARY_KEYS = Object.freeze([
  "approvalTransactionRequired",
  "permit2Used",
  "fundingSignatureProducedByService",
  "walletTransactionBroadcastByService",
]);
const FUNDING_CHALLENGE_KEYS = Object.freeze([
  "schemaVersion",
  "kind",
  "method",
  "fundingIntentHash",
  "fundingAuthorization",
  "typedData",
  "typedDataDigest",
  "submission",
]);
const FUNDING_DESCRIPTOR_KEYS = Object.freeze([
  "schemaVersion",
  "method",
  "token",
  "from",
  "to",
  "value",
  "validAfter",
  "validBefore",
  "nonce",
]);
const TYPED_DATA_KEYS = Object.freeze([
  "domain",
  "primaryType",
  "types",
  "message",
]);
const DOMAIN_KEYS = Object.freeze([
  "name",
  "version",
  "chainId",
  "verifyingContract",
]);
const MESSAGE_KEYS = Object.freeze([
  "from",
  "to",
  "value",
  "validAfter",
  "validBefore",
  "nonce",
]);
const SUBMISSION_KEYS = Object.freeze([
  "method",
  "path",
  "schemaVersion",
]);
const ROUTER_ACTION_KEYS = Object.freeze([
  "kind",
  "transaction",
  "graphCommitment",
  "artifactHash",
  "transactionPreimageHash",
  "permitDigest",
  "initializerCalldataHash",
]);
const EXACT_TRANSACTION_KEYS = Object.freeze([
  "schemaVersion",
  "chainId",
  "from",
  "to",
  "valueWei",
  "calldata",
]);

const RECEIVE_WITH_AUTHORIZATION_TYPES = Object.freeze([
  Object.freeze({ name: "from", type: "address" }),
  Object.freeze({ name: "to", type: "address" }),
  Object.freeze({ name: "value", type: "uint256" }),
  Object.freeze({ name: "validAfter", type: "uint256" }),
  Object.freeze({ name: "validBefore", type: "uint256" }),
  Object.freeze({ name: "nonce", type: "bytes32" }),
]);
const EIP712_DOMAIN_TYPES = Object.freeze([
  Object.freeze({ name: "name", type: "string" }),
  Object.freeze({ name: "version", type: "string" }),
  Object.freeze({ name: "chainId", type: "uint256" }),
  Object.freeze({ name: "verifyingContract", type: "address" }),
]);

const LAUNCH_AND_STAMP_PARAMETERS_V1 = parseAbiParameters(
  "(uint256,address,address,uint8,bytes32,bytes32,bytes32,bytes32,uint64,uint64,uint256),(bytes32,address,bytes32,(address,address,uint24,int24,address),bytes32,(uint8,address,bytes32,uint8,uint8)[]),bytes,bytes",
);
const CUSTOM_GRAPH_ROUTE_PARAMETER_V1 = parseAbiParameters(
  "(bytes32,bytes32,bytes32,bytes32,(bytes32,bytes32,uint256,uint256,bytes,bytes)[],(uint8,bytes32,address,bytes32)[],bytes32)",
);

const GRAPH_TARGET_COMMITMENT_TYPEHASH = keccak256(stringToHex(
  "ProgrammableCreate2GraphTargetCommitmentV1(uint256 targetIndex,bytes32 targetIdHash,bytes32 applicantSalt,uint256 deploymentValue,uint256 initializerValue,bytes32 initCodeHash,bytes32 initializerCalldataHash)",
));
const GRAPH_COMMITMENT_TYPEHASH = keccak256(stringToHex(
  "ProgrammableCreate2GraphCommitmentV1(uint256 chainId,address factory,bytes32 routeNamespace,bytes32 routeNonce,bytes32 topologyHash,address authorizedLauncher,uint256 totalValue,bytes32 targetCommitmentsHash)",
));
const GRAPH_TARGET_SALT_TYPEHASH = keccak256(stringToHex(
  "ProgrammableCreate2GraphTargetSaltV1(uint256 chainId,address factory,bytes32 routeNamespace,bytes32 routeNonce,bytes32 targetIdHash,bytes32 applicantSalt,address authorizedLauncher)",
));
const GRAPH_DEPLOYMENT_ACCUMULATOR_TYPEHASH = keccak256(stringToHex(
  "ProgrammableCreate2GraphDeploymentAccumulatorV1(bytes32 previous,uint256 targetIndex,bytes32 targetIdHash,address deployment,bytes32 effectiveSalt,bytes32 initCodeHash,bytes32 initializerCalldataHash,bytes32 runtimeCodeHash,uint256 deploymentValue,uint256 initializerValue)",
));
const EXPECTED_GRAPH_OUTPUT_TYPEHASH = keccak256(stringToHex(
  "ProgrammableExpectedGraphOutputV1(uint8 targetIndex,bytes32 targetIdHash,address account,bytes32 runtimeCodeHash)",
));
const EXPECTED_GRAPH_RESULT_TYPEHASH = keccak256(stringToHex(
  "ProgrammableExpectedGraphResultV1(bytes32 expectedOutputsHash,bytes32 graphDeploymentHash)",
));
const COMPONENT_TYPEHASH = keccak256(stringToHex(
  "ProgrammableLaunchComponentV1(uint8 resultIndex,address account,bytes32 runtimeCodeHash,uint8 kind,uint8 scope)",
));
const POOL_KEY_TYPEHASH = keccak256(stringToHex(
  "ProgrammablePoolKeyV1(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)",
));
const STAMP_REQUEST_TYPEHASH = keccak256(stringToHex(
  "ProgrammableStampRequestV1(bytes32 launchId,address token,bytes32 tokenRuntimeCodeHash,bytes32 poolKeyHash,bytes32 hookRuntimeCodeHash,bytes32 componentSetHash)",
));

export type CustomLaunchFundingTypedDataV3 = Readonly<{
  domain: Readonly<{
    name: "USD Coin";
    version: "2";
    chainId: 1;
    verifyingContract: Address;
  }>;
  primaryType: "ReceiveWithAuthorization";
  types: Readonly<{
    ReceiveWithAuthorization: typeof RECEIVE_WITH_AUTHORIZATION_TYPES;
  }>;
  message: Readonly<{
    from: Address;
    to: Address;
    value: string;
    validAfter: string;
    validBefore: string;
    nonce: Hex;
  }>;
}>;

export type CustomLaunchFundingAuthorizationV3 = Readonly<{
  chainId: "1";
  launchId: string;
  fundingIntentHash: Hex;
  typedDataDigest: Hex;
  submissionPath: string;
  token: Address;
  from: Address;
  to: Address;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: Hex;
  typedData: CustomLaunchFundingTypedDataV3;
}>;

export type CustomLaunchFundingAuthorizationSubmissionV3 = Readonly<{
  schemaVersion: typeof CUSTOM_LAUNCH_FUNDING_SIGNATURE_SCHEMA_V1;
  fundingIntentHash: Hex;
  typedDataDigest: Hex;
  signature: Hex;
}>;

export type CustomLaunchRouterReviewV3 = Readonly<{
  walletAction: CustomLaunchWalletActionV1;
  graphCommitment: Hex;
  artifactHash: `sha256:${string}`;
  transactionPreimageHash: `sha256:${string}`;
  permitDigest: Hex;
  initializerCalldataHash: Hex;
  selector: typeof CUSTOM_LAUNCH_WALLET_TRANSACTION_SELECTOR_V1;
  calldataLengthBytes: number;
}>;

export class CustomLaunchWalletHandoffErrorV3 extends Error {
  constructor(message = "The V3 wallet request failed the safety checks. Refresh the launch and try again.") {
    super(message);
    this.name = "CustomLaunchWalletHandoffErrorV3";
  }
}

export function prepareCustomLaunchFundingAuthorizationV3(
  output: unknown,
  connectedController: string,
  launchId: string,
  expectedFundingIntentHash: string,
  nowUnixSeconds = BigInt(Math.floor(Date.now() / 1_000)),
): CustomLaunchFundingAuthorizationV3 {
  const controller = requiredAddress(connectedController);
  if (!UUID.test(launchId)) return invalid();
  const outputRecord = authorizationOutputRecord(output);
  assertFundingBoundaryV3(outputRecord.fundingBoundary);
  if (
    outputRecord.schemaVersion !== CUSTOM_LAUNCH_AUTHORIZATION_RESULT_SCHEMA_V3
    || outputRecord.integrationState !== "ready"
    || outputRecord.stage !== "funding-signature-required"
  ) return invalid();

  const challenge = exactRecord(
    outputRecord.actionRequired,
    FUNDING_CHALLENGE_KEYS,
  );
  const descriptor = exactRecord(
    challenge.fundingAuthorization,
    FUNDING_DESCRIPTOR_KEYS,
  );
  const typedData = exactRecord(challenge.typedData, TYPED_DATA_KEYS);
  const domain = exactRecord(typedData.domain, DOMAIN_KEYS);
  const types = exactRecord(typedData.types, ["ReceiveWithAuthorization"]);
  const message = exactRecord(typedData.message, MESSAGE_KEYS);
  const submission = exactRecord(challenge.submission, SUBMISSION_KEYS);

  const fundingIntentHash = exactLowerBytes32(challenge.fundingIntentHash);
  const typedDataDigest = exactLowerBytes32(challenge.typedDataDigest);
  const expectedIntent = exactLowerBytes32(expectedFundingIntentHash);
  const token = requiredAddress(descriptor.token);
  const from = requiredAddress(descriptor.from);
  const to = requiredAddress(descriptor.to);
  const value = canonicalUint256(descriptor.value);
  const validAfter = canonicalUint256(descriptor.validAfter);
  const validBefore = canonicalUint256(descriptor.validBefore);
  const nonce = exactNonzeroLowerBytes32(descriptor.nonce);
  const expectedSubmissionPath =
    `/v3/wallet-admin/custom-launches/${launchId}/funding-authorization`;

  if (
    challenge.schemaVersion !== CUSTOM_LAUNCH_FUNDING_CHALLENGE_SCHEMA_V1
    || challenge.kind !== "wallet-signature"
    || challenge.method !== "eip-3009-receive-with-authorization"
    || fundingIntentHash !== expectedIntent
    || descriptor.schemaVersion !== CUSTOM_LAUNCH_FUNDING_DESCRIPTOR_SCHEMA_V1
    || descriptor.method !== "eip-3009-receive-with-authorization"
    || !sameAddress(token, CUSTOM_LAUNCH_MAINNET_USDC_V3)
    || !sameAddress(from, controller)
    || sameAddress(to, "0x0000000000000000000000000000000000000000")
    || value.parsed === 0n
    || validAfter.parsed >= nowUnixSeconds
    || validBefore.parsed <=
      nowUnixSeconds + MINIMUM_WALLET_SUBMISSION_WINDOW_SECONDS
    || validBefore.parsed <= validAfter.parsed
    || validBefore.parsed - validAfter.parsed > MAXIMUM_FUNDING_VALIDITY_SECONDS
    || submission.method !== "POST"
    || submission.path !== expectedSubmissionPath
    || submission.schemaVersion !== CUSTOM_LAUNCH_FUNDING_SIGNATURE_SCHEMA_V1
    || typedData.primaryType !== "ReceiveWithAuthorization"
    || domain.name !== "USD Coin"
    || domain.version !== "2"
    || domain.chainId !== 1
    || !sameAddress(domain.verifyingContract, token)
    || !exactReceiveWithAuthorizationTypes(types.ReceiveWithAuthorization)
    || !sameAddress(message.from, from)
    || !sameAddress(message.to, to)
    || message.value !== value.source
    || message.validAfter !== validAfter.source
    || message.validBefore !== validBefore.source
    || message.nonce !== nonce
  ) return invalid();

  const normalizedTypedData = Object.freeze({
    domain: Object.freeze({
      name: "USD Coin" as const,
      version: "2" as const,
      chainId: 1 as const,
      verifyingContract: token,
    }),
    primaryType: "ReceiveWithAuthorization" as const,
    types: Object.freeze({
      ReceiveWithAuthorization: RECEIVE_WITH_AUTHORIZATION_TYPES,
    }),
    message: Object.freeze({
      from,
      to,
      value: value.source,
      validAfter: validAfter.source,
      validBefore: validBefore.source,
      nonce,
    }),
  });
  if (fundingTypedDataDigest(normalizedTypedData) !== typedDataDigest) {
    return invalid();
  }
  return Object.freeze({
    chainId: "1" as const,
    launchId,
    fundingIntentHash,
    typedDataDigest,
    submissionPath: expectedSubmissionPath,
    token,
    from,
    to,
    value: value.source,
    validAfter: validAfter.source,
    validBefore: validBefore.source,
    nonce,
    typedData: normalizedTypedData,
  });
}

export function assertCustomLaunchFundingAuthorizationV3(
  input: CustomLaunchFundingAuthorizationV3,
  connectedController: string,
  nowUnixSeconds = BigInt(Math.floor(Date.now() / 1_000)),
): CustomLaunchFundingAuthorizationV3 {
  const controller = requiredAddress(connectedController);
  const token = requiredAddress(input.token);
  const from = requiredAddress(input.from);
  const to = requiredAddress(input.to);
  if (
    input.chainId !== "1"
    || !UUID.test(input.launchId)
    || !sameAddress(from, controller)
    || !sameAddress(token, CUSTOM_LAUNCH_MAINNET_USDC_V3)
    || sameAddress(to, "0x0000000000000000000000000000000000000000")
    || input.submissionPath !==
      `/v3/wallet-admin/custom-launches/${input.launchId}/funding-authorization`
    || exactLowerBytes32(input.fundingIntentHash) !== input.fundingIntentHash
    || exactLowerBytes32(input.typedDataDigest) !== input.typedDataDigest
    || exactNonzeroLowerBytes32(input.nonce) !== input.nonce
  ) return invalid();
  const value = canonicalUint256(input.value);
  const validAfter = canonicalUint256(input.validAfter);
  const validBefore = canonicalUint256(input.validBefore);
  const typedData = exactRecord(input.typedData, TYPED_DATA_KEYS);
  const domain = exactRecord(typedData.domain, DOMAIN_KEYS);
  const types = exactRecord(typedData.types, ["ReceiveWithAuthorization"]);
  const message = exactRecord(typedData.message, MESSAGE_KEYS);
  const normalizedTypedData = Object.freeze({
    domain: Object.freeze({
      name: "USD Coin" as const,
      version: "2" as const,
      chainId: 1 as const,
      verifyingContract: token,
    }),
    primaryType: "ReceiveWithAuthorization" as const,
    types: Object.freeze({
      ReceiveWithAuthorization: RECEIVE_WITH_AUTHORIZATION_TYPES,
    }),
    message: Object.freeze({
      from,
      to,
      value: value.source,
      validAfter: validAfter.source,
      validBefore: validBefore.source,
      nonce: input.nonce,
    }),
  });
  if (
    value.parsed === 0n
    || validAfter.parsed >= nowUnixSeconds
    || validBefore.parsed <=
      nowUnixSeconds + MINIMUM_WALLET_SUBMISSION_WINDOW_SECONDS
    || validBefore.parsed - validAfter.parsed > MAXIMUM_FUNDING_VALIDITY_SECONDS
    || typedData.primaryType !== "ReceiveWithAuthorization"
    || domain.name !== "USD Coin"
    || domain.version !== "2"
    || domain.chainId !== 1
    || !sameAddress(domain.verifyingContract, token)
    || !exactReceiveWithAuthorizationTypes(types.ReceiveWithAuthorization)
    || !sameAddress(message.from, from)
    || !sameAddress(message.to, to)
    || message.value !== value.source
    || message.validAfter !== validAfter.source
    || message.validBefore !== validBefore.source
    || message.nonce !== input.nonce
    || fundingTypedDataDigest(normalizedTypedData) !== input.typedDataDigest
  ) return invalid();
  return input;
}

export function serializeCustomLaunchFundingTypedDataV3(
  input: CustomLaunchFundingAuthorizationV3,
): string {
  const checked = assertCustomLaunchFundingAuthorizationV3(
    input,
    input.from,
    canonicalUint256(input.validAfter).parsed + 1n,
  );
  const serialized = serializeTypedData({
    ...typedDataForViem(checked.typedData),
    domain: {
      ...checked.typedData.domain,
      chainId: 1n,
    },
    types: {
      EIP712Domain: EIP712_DOMAIN_TYPES,
      ReceiveWithAuthorization: RECEIVE_WITH_AUTHORIZATION_TYPES,
    },
  });
  const payload = JSON.parse(serialized) as {
    domain: { chainId: number | string };
  };
  payload.domain.chainId = 1;
  return JSON.stringify(payload);
}

export async function verifyCustomLaunchFundingSignatureV3(
  input: CustomLaunchFundingAuthorizationV3,
  signature: unknown,
): Promise<Hex> {
  const canonical = canonicalFundingSignature(signature);
  let recovered: Address;
  try {
    recovered = await recoverTypedDataAddress({
      ...typedDataForViem(input.typedData),
      signature: canonical,
    });
  } catch {
    return invalid();
  }
  if (!sameAddress(recovered, input.from)) return invalid();
  return canonical;
}

export function createCustomLaunchFundingSubmissionV3(
  input: CustomLaunchFundingAuthorizationV3,
  signature: Hex,
): CustomLaunchFundingAuthorizationSubmissionV3 {
  return Object.freeze({
    schemaVersion: CUSTOM_LAUNCH_FUNDING_SIGNATURE_SCHEMA_V1,
    fundingIntentHash: input.fundingIntentHash,
    typedDataDigest: input.typedDataDigest,
    signature: canonicalFundingSignature(signature),
  });
}

export function assertCustomLaunchFundingIdempotencyKeyV3(value: string) {
  if (!FUNDING_SUBMISSION_IDEMPOTENCY_KEY.test(value)) return invalid();
  return value;
}

export function prepareCustomLaunchRouterReviewV3(
  output: unknown,
  connectedController: string,
): CustomLaunchRouterReviewV3 {
  const outputRecord = authorizationOutputRecord(output);
  assertFundingBoundaryV3(outputRecord.fundingBoundary);
  if (
    outputRecord.schemaVersion !== CUSTOM_LAUNCH_AUTHORIZATION_RESULT_SCHEMA_V3
    || outputRecord.integrationState !== "ready"
    || outputRecord.stage !== "router-transaction-required"
  ) return invalid();
  const required = exactRecord(outputRecord.actionRequired, ROUTER_ACTION_KEYS);
  const transaction = exactRecord(
    required.transaction,
    EXACT_TRANSACTION_KEYS,
  );
  const graphCommitment = exactNonzeroLowerBytes32(required.graphCommitment);
  const artifactHash = exactSha256(required.artifactHash);
  const transactionPreimageHash = exactSha256(
    required.transactionPreimageHash,
  );
  const permitDigest = exactNonzeroLowerBytes32(required.permitDigest);
  const initializerCalldataHash = exactNonzeroLowerBytes32(
    required.initializerCalldataHash,
  );
  const valueWei = canonicalUint256(transaction.valueWei);
  const data = exactLowerHexData(transaction.calldata);
  if (
    required.kind !== "send-router-transaction"
    || transaction.schemaVersion !== CUSTOM_LAUNCH_EXACT_WALLET_TRANSACTION_SCHEMA_V3
    || transaction.chainId !== "1"
  ) return invalid();
  const action = assertCustomLaunchWalletActionV1(Object.freeze({
    chainId: "1" as const,
    from: requiredAddress(transaction.from),
    to: requiredAddress(transaction.to),
    data,
    value: toHex(valueWei.parsed),
    valueWei: valueWei.source,
  }), connectedController);
  if (
    !sameAddress(action.to, CUSTOM_LAUNCH_MAINNET_ROUTER_V1)
    || customLaunchWalletTransactionPreimageHashV2(action)
      !== transactionPreimageHash
  ) return invalid();
  assertExactCustomGraphRouterCalldataV3(
    action,
    graphCommitment,
    permitDigest,
    initializerCalldataHash,
  );
  return Object.freeze({
    walletAction: action,
    graphCommitment,
    artifactHash,
    transactionPreimageHash,
    permitDigest,
    initializerCalldataHash,
    selector: CUSTOM_LAUNCH_WALLET_TRANSACTION_SELECTOR_V1,
    calldataLengthBytes: (action.data.length - 2) / 2,
  });
}

export function prepareCustomLaunchWalletActionV3(
  output: unknown,
  connectedController: string,
): CustomLaunchWalletActionV1 {
  return prepareCustomLaunchRouterReviewV3(output, connectedController)
    .walletAction;
}

function assertExactCustomGraphRouterCalldataV3(
  action: CustomLaunchWalletActionV1,
  expectedGraphCommitment: Hex,
  expectedPermitDigest: Hex,
  expectedInitializerCalldataHash: Hex,
) {
  const calldata = exactLowerHexData(action.data);
  if (calldata.slice(0, 10) !== CUSTOM_LAUNCH_WALLET_TRANSACTION_SELECTOR_V1) {
    return invalid();
  }
  let decoded: readonly unknown[];
  try {
    decoded = decodeAbiParameters(
      LAUNCH_AND_STAMP_PARAMETERS_V1,
      `0x${calldata.slice(10)}`,
    );
    const canonical = `${CUSTOM_LAUNCH_WALLET_TRANSACTION_SELECTOR_V1}${
      encodeAbiParameters(LAUNCH_AND_STAMP_PARAMETERS_V1, decoded as never)
        .slice(2)
    }`;
    if (canonical !== calldata) return invalid();
  } catch {
    return invalid();
  }
  const permit = tuple(decoded[0], 11);
  const stamp = tuple(decoded[1], 6);
  const routePayload = exactLowerHexData(decoded[2]);
  const permitSignature = exactLowerHexData(decoded[3]);
  if ((permitSignature.length - 2) / 2 !== 65) return invalid();

  const permitChainId = requiredBigInt(permit[0]);
  const permitRouter = requiredAddress(permit[1]);
  const permitWallet = requiredAddress(permit[2]);
  const permitKind = requiredBigInt(permit[3]);
  const permitRouteHash = exactLowerBytes32(permit[4]);
  const permitExpectedResultHash = exactLowerBytes32(permit[5]);
  const permitStampHash = exactLowerBytes32(permit[6]);
  const permitNonce = exactNonzeroLowerBytes32(permit[7]);
  const validAfter = requiredBigInt(permit[8]);
  const deadline = requiredBigInt(permit[9]);
  const permitValue = requiredBigInt(permit[10]);
  const permitDigest = hashTypedData({
    domain: {
      name: "ProgrammableLaunchStampRouter",
      version: "1",
      chainId: 1,
      verifyingContract: CUSTOM_LAUNCH_MAINNET_ROUTER_V1,
    },
    primaryType: "ProgrammableLaunchPermitV1",
    types: {
      ProgrammableLaunchPermitV1: [
        { name: "chainId", type: "uint256" },
        { name: "router", type: "address" },
        { name: "launchWallet", type: "address" },
        { name: "kind", type: "uint8" },
        { name: "routePayloadHash", type: "bytes32" },
        { name: "expectedResultHash", type: "bytes32" },
        { name: "stampRequestHash", type: "bytes32" },
        { name: "nonce", type: "bytes32" },
        { name: "validAfter", type: "uint64" },
        { name: "deadline", type: "uint64" },
        { name: "value", type: "uint256" },
      ],
    },
    message: {
      chainId: permitChainId,
      router: permitRouter,
      launchWallet: permitWallet,
      kind: Number(permitKind),
      routePayloadHash: permitRouteHash,
      expectedResultHash: permitExpectedResultHash,
      stampRequestHash: permitStampHash,
      nonce: permitNonce,
      validAfter,
      deadline,
      value: permitValue,
    },
  });
  const now = BigInt(Math.floor(Date.now() / 1_000));
  if (
    permitChainId !== 1n
    || !sameAddress(permitRouter, CUSTOM_LAUNCH_MAINNET_ROUTER_V1)
    || !sameAddress(permitWallet, action.from)
    || permitKind !== 1n
    || permitRouteHash !== keccak256(routePayload)
    || validAfter > now
    || deadline <= now + MINIMUM_WALLET_SUBMISSION_WINDOW_SECONDS
    || permitValue !== BigInt(action.valueWei)
    || permitNonce === ZERO_BYTES32
    || permitDigest !== expectedPermitDigest
  ) return invalid();

  let routeDecoded: readonly unknown[];
  try {
    const decodedRoute = decodeAbiParameters(
      CUSTOM_GRAPH_ROUTE_PARAMETER_V1,
      routePayload,
    );
    const canonicalRoute = encodeAbiParameters(
      CUSTOM_GRAPH_ROUTE_PARAMETER_V1,
      decodedRoute as never,
    );
    if (canonicalRoute !== routePayload) return invalid();
    routeDecoded = tuple(decodedRoute[0], 7);
  } catch {
    return invalid();
  }
  const routeNamespace = exactNonzeroLowerBytes32(routeDecoded[0]);
  const routeNonce = exactNonzeroLowerBytes32(routeDecoded[1]);
  const topologyHash = exactNonzeroLowerBytes32(routeDecoded[2]);
  const graphCommitment = exactNonzeroLowerBytes32(routeDecoded[3]);
  const targets = tupleArray(routeDecoded[4], 3, 16, 6);
  const expectedOutputs = tupleArray(routeDecoded[5], 3, 16, 4);
  const expectedGraphDeploymentHash = exactNonzeroLowerBytes32(routeDecoded[6]);
  if (
    graphCommitment !== expectedGraphCommitment
    || expectedOutputs.length !== targets.length
  ) return invalid();

  let totalValue = 0n;
  const targetCommitments: Hex[] = [];
  const preparedTargets: Array<Readonly<{
    targetIdHash: Hex;
    applicantSalt: Hex;
    deploymentValue: bigint;
    initializerValue: bigint;
    initCodeHash: Hex;
    initializerCalldataHash: Hex;
    predictedAddress: Address;
    effectiveSalt: Hex;
    expectedRuntimeCodeHash: Hex;
  }>> = [];
  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index]!;
    const output = expectedOutputs[index]!;
    const targetIdHash = exactNonzeroLowerBytes32(target[0]);
    const applicantSalt = exactLowerBytes32(target[1]);
    const deploymentValue = requiredBigInt(target[2]);
    const initializerValue = requiredBigInt(target[3]);
    const initCode = exactLowerHexData(target[4]);
    const initializerCalldata = optionalLowerHexData(target[5]);
    const initCodeHash = keccak256(initCode);
    const initializerCalldataHash = keccak256(initializerCalldata);
    const effectiveSalt = abiHash(
      "bytes32,uint256,address,bytes32,bytes32,bytes32,bytes32,address",
      [
        GRAPH_TARGET_SALT_TYPEHASH,
        1n,
        CUSTOM_GRAPH_FACTORY_V1,
        routeNamespace,
        routeNonce,
        targetIdHash,
        applicantSalt,
        CUSTOM_LAUNCH_MAINNET_ROUTER_V1,
      ],
    );
    const predictedAddress = getCreate2Address({
      from: CUSTOM_GRAPH_FACTORY_V1,
      salt: effectiveSalt,
      bytecodeHash: initCodeHash,
    });
    const outputIndex = requiredBigInt(output[0]);
    const outputTargetIdHash = exactNonzeroLowerBytes32(output[1]);
    const outputAddress = requiredAddress(output[2]);
    const expectedRuntimeCodeHash = exactNonzeroLowerBytes32(output[3]);
    if (
      outputIndex !== BigInt(index)
      || outputTargetIdHash !== targetIdHash
      || !sameAddress(outputAddress, predictedAddress)
    ) return invalid();
    totalValue = checkedAdd(totalValue, deploymentValue);
    totalValue = checkedAdd(totalValue, initializerValue);
    targetCommitments.push(abiHash(
      "bytes32,uint256,bytes32,bytes32,uint256,uint256,bytes32,bytes32",
      [
        GRAPH_TARGET_COMMITMENT_TYPEHASH,
        BigInt(index),
        targetIdHash,
        applicantSalt,
        deploymentValue,
        initializerValue,
        initCodeHash,
        initializerCalldataHash,
      ],
    ));
    preparedTargets.push(Object.freeze({
      targetIdHash,
      applicantSalt,
      deploymentValue,
      initializerValue,
      initCodeHash,
      initializerCalldataHash,
      predictedAddress,
      effectiveSalt,
      expectedRuntimeCodeHash,
    }));
  }
  const targetCommitmentsHash = keccak256(encodeAbiParameters(
    parseAbiParameters("bytes32[]"),
    [targetCommitments],
  ));
  const computedGraphCommitment = abiHash(
    "bytes32,uint256,address,bytes32,bytes32,bytes32,address,uint256,bytes32",
    [
      GRAPH_COMMITMENT_TYPEHASH,
      1n,
      CUSTOM_GRAPH_FACTORY_V1,
      routeNamespace,
      routeNonce,
      topologyHash,
      CUSTOM_LAUNCH_MAINNET_ROUTER_V1,
      totalValue,
      targetCommitmentsHash,
    ],
  );
  if (
    computedGraphCommitment !== graphCommitment
    || totalValue !== permitValue
    || !preparedTargets.some((target) =>
      target.initializerCalldataHash === expectedInitializerCalldataHash)
  ) return invalid();

  let graphDeploymentHash = graphCommitment;
  const outputHashes: Hex[] = [];
  for (let index = 0; index < preparedTargets.length; index += 1) {
    const target = preparedTargets[index]!;
    graphDeploymentHash = abiHash(
      "bytes32,bytes32,uint256,bytes32,address,bytes32,bytes32,bytes32,bytes32,uint256,uint256",
      [
        GRAPH_DEPLOYMENT_ACCUMULATOR_TYPEHASH,
        graphDeploymentHash,
        BigInt(index),
        target.targetIdHash,
        target.predictedAddress,
        target.effectiveSalt,
        target.initCodeHash,
        target.initializerCalldataHash,
        target.expectedRuntimeCodeHash,
        target.deploymentValue,
        target.initializerValue,
      ],
    );
    outputHashes.push(abiHash(
      "bytes32,uint8,bytes32,address,bytes32",
      [
        EXPECTED_GRAPH_OUTPUT_TYPEHASH,
        index,
        target.targetIdHash,
        target.predictedAddress,
        target.expectedRuntimeCodeHash,
      ],
    ));
  }
  if (graphDeploymentHash !== expectedGraphDeploymentHash) return invalid();
  const expectedResultHash = abiHash(
    "bytes32,bytes32,bytes32",
    [
      EXPECTED_GRAPH_RESULT_TYPEHASH,
      packedHash(outputHashes),
      graphDeploymentHash,
    ],
  );
  if (expectedResultHash !== permitExpectedResultHash) return invalid();

  const launchId = exactNonzeroLowerBytes32(stamp[0]);
  const token = requiredAddress(stamp[1]);
  const tokenRuntimeCodeHash = exactNonzeroLowerBytes32(stamp[2]);
  const poolKey = tuple(stamp[3], 5);
  const hookRuntimeCodeHash = exactNonzeroLowerBytes32(stamp[4]);
  const components = tupleArray(stamp[5], targets.length, targets.length, 5);
  const currency0 = requiredAddress(poolKey[0]);
  const currency1 = requiredAddress(poolKey[1]);
  const fee = requiredBigInt(poolKey[2]);
  const tickSpacing = requiredBigInt(poolKey[3]);
  const hooks = requiredAddress(poolKey[4]);
  if (
    BigInt(currency0.toLowerCase()) >= BigInt(currency1.toLowerCase())
    || fee < 0n
    || (fee > V4_MAXIMUM_STATIC_FEE && fee !== V4_DYNAMIC_FEE_SENTINEL)
    || tickSpacing < 1n
    || tickSpacing > 32_767n
    || (!sameAddress(currency0, token) && !sameAddress(currency1, token))
    || sameAddress(hooks, ZERO_ADDRESS)
  ) return invalid();

  const seenResultIndices = new Set<number>();
  const componentHashes: Hex[] = [];
  let priorAccount = -1n;
  let tokenCount = 0;
  let hookCount = 0;
  for (const component of components) {
    const resultIndex = Number(requiredBigInt(component[0]));
    const account = requiredAddress(component[1]);
    const runtimeCodeHash = exactNonzeroLowerBytes32(component[2]);
    const kind = Number(requiredBigInt(component[3]));
    const scope = Number(requiredBigInt(component[4]));
    const accountNumeric = BigInt(account.toLowerCase());
    const target = preparedTargets[resultIndex];
    if (
      !target
      || seenResultIndices.has(resultIndex)
      || accountNumeric <= priorAccount
      || !sameAddress(account, target.predictedAddress)
      || runtimeCodeHash !== target.expectedRuntimeCodeHash
      || ![0, 1, 2].includes(kind)
      || scope !== 1
    ) return invalid();
    seenResultIndices.add(resultIndex);
    priorAccount = accountNumeric;
    if (kind === 1) {
      tokenCount += 1;
      if (!sameAddress(account, token) || runtimeCodeHash !== tokenRuntimeCodeHash) {
        return invalid();
      }
    }
    if (kind === 2) {
      hookCount += 1;
      if (!sameAddress(account, hooks) || runtimeCodeHash !== hookRuntimeCodeHash) {
        return invalid();
      }
    }
    componentHashes.push(abiHash(
      "bytes32,uint8,address,bytes32,uint8,uint8",
      [COMPONENT_TYPEHASH, resultIndex, account, runtimeCodeHash, kind, scope],
    ));
  }
  if (
    seenResultIndices.size !== targets.length
    || tokenCount !== 1
    || hookCount !== 1
  ) return invalid();
  const poolKeyHash = abiHash(
    "bytes32,address,address,uint24,int24,address",
    [POOL_KEY_TYPEHASH, currency0, currency1, fee, tickSpacing, hooks],
  );
  const stampHash = abiHash(
    "bytes32,bytes32,address,bytes32,bytes32,bytes32,bytes32",
    [
      STAMP_REQUEST_TYPEHASH,
      launchId,
      token,
      tokenRuntimeCodeHash,
      poolKeyHash,
      hookRuntimeCodeHash,
      packedHash(componentHashes),
    ],
  );
  if (stampHash !== permitStampHash) return invalid();
}

function fundingTypedDataDigest(
  typedData: CustomLaunchFundingTypedDataV3,
): Hex {
  try {
    return hashTypedData(typedDataForViem(typedData));
  } catch {
    return invalid();
  }
}

function typedDataForViem(typedData: CustomLaunchFundingTypedDataV3) {
  return {
    domain: typedData.domain,
    primaryType: typedData.primaryType,
    types: typedData.types,
    message: {
      from: typedData.message.from,
      to: typedData.message.to,
      value: BigInt(typedData.message.value),
      validAfter: BigInt(typedData.message.validAfter),
      validBefore: BigInt(typedData.message.validBefore),
      nonce: typedData.message.nonce,
    },
  } as const;
}

function exactReceiveWithAuthorizationTypes(value: unknown) {
  if (!Array.isArray(value) || value.length !== RECEIVE_WITH_AUTHORIZATION_TYPES.length) {
    return false;
  }
  return value.every((candidate, index) => {
    if (!candidate || Array.isArray(candidate) || typeof candidate !== "object") {
      return false;
    }
    const record = candidate as Record<string, unknown>;
    const expected = RECEIVE_WITH_AUTHORIZATION_TYPES[index]!;
    return Object.keys(record).length === 2
      && record.name === expected.name
      && record.type === expected.type;
  });
}

function canonicalFundingSignature(value: unknown): Hex {
  if (typeof value !== "string" || !/^0x[0-9a-f]{130}$/u.test(value)) {
    return invalid();
  }
  const r = BigInt(`0x${value.slice(2, 66)}`);
  const s = BigInt(`0x${value.slice(66, 130)}`);
  const v = Number.parseInt(value.slice(130, 132), 16);
  if (
    r === 0n
    || r >= SECP256K1_ORDER
    || s === 0n
    || s > SECP256K1_HALF_ORDER
    || (v !== 27 && v !== 28)
  ) return invalid();
  return value as Hex;
}

function assertFundingBoundaryV3(value: unknown) {
  const boundary = exactRecord(value, FUNDING_BOUNDARY_KEYS);
  if (
    boundary.approvalTransactionRequired !== false
    || boundary.permit2Used !== false
    || boundary.fundingSignatureProducedByService !== false
    || boundary.walletTransactionBroadcastByService !== false
  ) return invalid();
}

function authorizationOutputRecord(value: unknown) {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    return invalid();
  }
  const candidate = value as Readonly<Record<string, unknown>>;
  const expectedKeys = Object.hasOwn(candidate, "platformAdmission")
    ? [...OUTPUT_KEYS, "platformAdmission"]
    : OUTPUT_KEYS;
  const output = exactRecord(candidate, expectedKeys);
  if (Object.hasOwn(output, "platformAdmission")) {
    assertPlatformAdmissionStatusV1(output.platformAdmission);
  }
  return output;
}

function assertPlatformAdmissionStatusV1(value: unknown) {
  const status = exactRecord(value, PLATFORM_ADMISSION_KEYS);
  if (!Array.isArray(status.warningFindingCodes)
    || status.warningFindingCodes.some((code) =>
      typeof code !== "string" || !PLATFORM_ADMISSION_WARNING_CODES.has(code))
    || new Set(status.warningFindingCodes).size !== status.warningFindingCodes.length
    || status.schemaVersion !== "programmable.platform-admission-status.v1"
    || status.disposition !== "no_blocking_static_finding"
    || exactSha256(status.reportSha256) !== status.reportSha256
    || status.routerSimulationRequiredBeforeAuthorization !== true
    || status.safetyClaim !== false
    || status.feeBehaviorClaim !== false) {
    return invalid();
  }
}

function exactRecord(
  value: unknown,
  expectedKeys: readonly string[],
): Readonly<Record<string, unknown>> {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    return invalid();
  }
  const record = value as Readonly<Record<string, unknown>>;
  const keys = Object.keys(record);
  if (
    keys.length !== expectedKeys.length
    || keys.some((key) => !expectedKeys.includes(key))
  ) return invalid();
  return record;
}

function tuple(value: unknown, length: number): readonly unknown[] {
  if (!Array.isArray(value) || value.length !== length) return invalid();
  return value;
}

function tupleArray(
  value: unknown,
  minimum: number,
  maximum: number,
  tupleLength: number,
): readonly (readonly unknown[])[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    return invalid();
  }
  return value.map((candidate) => tuple(candidate, tupleLength));
}

function requiredAddress(value: unknown): Address {
  if (typeof value !== "string" || !isAddress(value)) return invalid();
  return getAddress(value);
}

function sameAddress(left: unknown, right: unknown) {
  return typeof left === "string"
    && typeof right === "string"
    && isAddress(left)
    && isAddress(right)
    && left.toLowerCase() === right.toLowerCase();
}

function canonicalUint256(value: unknown) {
  if (typeof value !== "string" || !CANONICAL_UINT.test(value)) return invalid();
  const parsed = BigInt(value);
  if (parsed > UINT256_MAXIMUM) return invalid();
  return Object.freeze({ source: value, parsed });
}

function requiredBigInt(value: unknown) {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return BigInt(value);
  }
  return invalid();
}

function exactLowerBytes32(value: unknown): Hex {
  if (typeof value !== "string" || !BYTES32.test(value)) return invalid();
  return value as Hex;
}

function exactNonzeroLowerBytes32(value: unknown): Hex {
  const result = exactLowerBytes32(value);
  if (result === ZERO_BYTES32) return invalid();
  return result;
}

function exactLowerHexData(value: unknown): Hex {
  if (typeof value !== "string" || !LOWERCASE_HEX_DATA.test(value)) {
    return invalid();
  }
  return value as Hex;
}

function optionalLowerHexData(value: unknown): Hex {
  if (value === "0x") return value;
  return exactLowerHexData(value);
}

function exactSha256(value: unknown): `sha256:${string}` {
  if (typeof value !== "string" || !SHA256_DIGEST.test(value)) return invalid();
  return value as `sha256:${string}`;
}

function checkedAdd(left: bigint, right: bigint) {
  const result = left + right;
  if (left < 0n || right < 0n || result > UINT256_MAXIMUM) return invalid();
  return result;
}

function abiHash(types: string, values: readonly unknown[]): Hex {
  return keccak256(encodeAbiParameters(
    parseAbiParameters(types),
    values as never,
  ));
}

function packedHash(values: readonly Hex[]): Hex {
  return keccak256(values.length === 0 ? "0x" : concatHex(values));
}

function invalid(): never {
  throw new CustomLaunchWalletHandoffErrorV3();
}

// Keeps the browser and backend on the same SHA-256 primitive without ever
// exposing signature bytes in a review model.
export function customLaunchFundingReviewFingerprintV3(
  input: CustomLaunchFundingAuthorizationV3,
): `sha256:${string}` {
  return `sha256:${sha256(stringToHex([
    input.launchId,
    input.fundingIntentHash,
    input.typedDataDigest,
  ].join("\0"))).slice(2)}`;
}
