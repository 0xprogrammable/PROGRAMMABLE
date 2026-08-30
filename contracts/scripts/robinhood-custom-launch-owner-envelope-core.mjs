import { createHash } from "node:crypto";

import {
  decodeAbiParameters,
  getAddress,
  hexToBytes,
  keccak256,
  parseAbiParameters,
} from "viem";

import { canonicalizeJson } from "../../packages/launch/src/canonical-json.mjs";

export const ROBINHOOD_FOUNDATION_OWNER_ENVELOPE_SCHEMA =
  "programmable.robinhood-custom-launch.owner-envelope.v2";
export const ROBINHOOD_FOUNDATION_HOSTED_VERIFY_SCHEMA =
  "programmable.robinhood-custom-launch.hosted-verify-binding.v1";
export const ROBINHOOD_FOUNDATION_OWNER_ENVELOPE_TTL_SECONDS = 300;
export const ROBINHOOD_FOUNDATION_OWNER_ENVELOPE_MINIMUM_REMAINING_TTL_SECONDS = 60;
export const ROBINHOOD_FOUNDATION_OWNER_ENVELOPE_REQUEST_TIMEOUT_MS = 15_000;
export const ROBINHOOD_FOUNDATION_OWNER_ENVELOPE_MAX_OPERATION_MS = 45_000;
export const ROBINHOOD_FOUNDATION_OWNER_ENVELOPE_MAX_HEAD_GAP = 4n;
export const ROBINHOOD_FOUNDATION_OWNER_ENVELOPE_GAS_HEADROOM_BPS = 2_000n;
export const ROBINHOOD_FOUNDATION_OWNER_ENVELOPE_FIXED_GAS_HEADROOM = 50_000n;
export const ROBINHOOD_FOUNDATION_OWNER_ENVELOPE_MAX_GAS_LIMIT = 10_000_000n;

const CHAIN_ID = 4_663n;
const CHAIN_ID_HEX = "0x1237";
const EMPTY_CODE_HASH =
  "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470";
const PREDEPLOYMENT_SHA256 =
  "sha256:2d58b964232d345f82aa7c7d58e678df03bf83828b9d95da42f3cd54ab03319e";
const CHAIN_PROFILE_SHA256 =
  "sha256:a3149f6a013eae1ca0fd932e0da0ddb8b8796d880ef53800830bfaaf49fe56c4";
const FOUNDATION_SOURCE_COMMITMENT =
  "0xe87f5edc2dc839bd87a26a80cb53f14b021e603a1753d27aae3a02862058d730";
const PRODUCTION_SOURCE_COMMIT = "ec0f44d5d60d1bb61b605fc13ddea6e0a29007e6";
const PRODUCTION_SOURCE_TREE = "8d1a83916b50a68ec972ad042803f8f56855e35d";
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";
const OWNER_DATA_HASH =
  "0x3ba04469085b17e12843a94c154a335c9c384837f8f6531f179cb4915fd237d9";
const OWNER_DATA_BYTES = 33_412;
const OWNER_SELECTOR = "0x82ad56cb";
const EXPECTED_CALL_RETURN_HASH =
  "0xd098d176731bf1f115ed94497e5edd7c28dfdfe7e51f343be9c7ed74e9cb65f6";
const UINT64_MAXIMUM = (1n << 64n) - 1n;
const BASIS_POINTS = 10_000n;
const ALLOWED_OWNERS = Object.freeze([
  "0x032b1c7b96793717f0bd2f11eb86cd10cdefc4a3",
  "0x2bb333d48dfaf1596d9036671d2e43168994249e",
]);
const EXPECTED_PREPARED_ADDRESSES = Object.freeze({
  permitAuthority: "0xeD617CE7f82e2AB589aDeFFD319D1D872Bc8De06",
  graphFactory: "0x0B6b3F40f84Df25D3bd69238f937096177DD09Bd",
  router: "0x34965F2A2ee9254522232C32F02056E92BE0C98a",
});
const EXPECTED_COMPONENT_CALLS = Object.freeze([
  Object.freeze({
    to: "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67",
    dataHash:
      "0x3a9a3af8bfaab5ef893202e872e1a720874ef7cdbdd8d9c5d2a813b1eff596d2",
    dataBytes: 548,
  }),
  Object.freeze({
    to: "0x4e59b44847b379578588920cA78FbF26c0B4956C",
    dataHash:
      "0x46b864077a44a112678b7191405cb13ba431298c114d9d00a4d7be477b4c7d79",
    dataBytes: 7_540,
  }),
  Object.freeze({
    to: "0x4e59b44847b379578588920cA78FbF26c0B4956C",
    dataHash:
      "0xedb1a8e23b81c8d71d65967333619d51893e4d0d35c2ae75cde091e47bc14b5e",
    dataBytes: 24_714,
  }),
]);
const EXPECTED_DEPENDENCY_BINDINGS = Object.freeze({
  safeSingleton: Object.freeze({
    address: "0x41675C099F32341bf84BFc5382aF534df5C7461a",
    runtimeCodeHash:
      "0x1fe2df852ba3299d6534ef416eefa406e56ced995bca886ab7a553e6d0c5e1c4",
  }),
  safeProxyFactory: Object.freeze({
    address: "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67",
    runtimeCodeHash:
      "0x50c3cdc4074750a7a974204a716c999edd37482f907608d960b2b025ee0b3317",
  }),
  compatibilityFallbackHandler: Object.freeze({
    address: "0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99",
    runtimeCodeHash:
      "0x7c6007a5d711cea8dfd5d91f5940ec29c7f200fe511eb1fc1397b367af3c42f9",
  }),
  multicall3: Object.freeze({
    address: MULTICALL3,
    runtimeCodeHash:
      "0xd5c15df687b16f2ff992fc8d767b4216323184a2bbc6ee2f9c398c318e770891",
  }),
  deterministicDeployer: Object.freeze({
    address: "0x4e59b44847b379578588920cA78FbF26c0B4956C",
    runtimeCodeHash:
      "0x2fa86add0aed31f33a762c9d88e807c475bd51d0f52bd0955754b2608f7e4989",
  }),
  poolManager: Object.freeze({
    address: "0x8366a39CC670B4001A1121B8F6A443A643e40951",
    runtimeCodeHash:
      "0xbd3881180b547f5fe817545743cfb4343e96b1bc6640dcd70c106b0066e95626",
  }),
});
const EXPECTED_PROVIDER_PINS = Object.freeze([
  Object.freeze({
    role: "primary",
    providerId: "quicknode",
    trustDomain: "quicknode.com",
  }),
  Object.freeze({
    role: "secondary",
    providerId: "alchemy",
    trustDomain: "alchemy.com",
  }),
]);
const EXPECTED_PROVIDER_RECEIPT_BINDINGS = Object.freeze(
  EXPECTED_PROVIDER_PINS.map(({ role, providerId, trustDomain }) =>
    Object.freeze({
      role,
      providerId,
      trustDomain,
      authentication: "provider-credential",
      endpointCommitment: null,
    }),
  ),
);
const EXPECTED_RECEIPT_TOP_LEVEL_KEYS = Object.freeze([
  "broadcastAllowed",
  "caip2",
  "chainId",
  "chainIdHex",
  "checks",
  "expiresAt",
  "gasPolicy",
  "hostedVerify",
  "issuedAt",
  "observation",
  "ownerWalletReviewRequired",
  "preparedAddresses",
  "preparedArtifact",
  "privateKeyAccepted",
  "receiptDigest",
  "rpcProviders",
  "schemaVersion",
  "signingAllowed",
  "simulation",
  "source",
  "state",
  "status",
  "transaction",
]);
const EXPECTED_SOURCE_KEYS = Object.freeze([
  "chainProfileSha256",
  "clean",
  "commit",
  "foundationSourceCommitment",
  "predeploymentSha256",
  "productionBaseCommit",
  "productionBaseTree",
  "tree",
]);
const EXPECTED_PREPARED_ARTIFACT_KEYS = Object.freeze([
  "foundationSourceCommitment",
  "path",
  "sha256",
]);
const EXPECTED_OBSERVATION_KEYS = Object.freeze([
  "closingFeeObservations",
  "closingPendingBlocks",
  "commonAnchor",
  "createdAtTimestamp",
  "elapsedMilliseconds",
  "expiresAtTimestamp",
  "minimumRemainingTtlSeconds",
  "openingFeeObservations",
  "openingHeads",
  "openingPendingBlocks",
  "operationStartedAtTimestamp",
  "ttlSeconds",
]);
const EXPECTED_PENDING_OBSERVATION_KEYS = Object.freeze([
  "baseFeePerGas",
  "blockTimestamp",
  "gasLimit",
  "parentHash",
  "providerId",
]);
const EXPECTED_OPENING_HEAD_KEYS = Object.freeze([
  "blockHash",
  "blockNumber",
  "blockTimestamp",
  "providerId",
]);
const EXPECTED_COMMON_ANCHOR_KEYS = Object.freeze([
  "blockHash",
  "blockNumber",
  "blockTimestamp",
]);
const EXPECTED_FEE_OBSERVATION_KEYS = Object.freeze([
  "gasPrice",
  "maxPriorityFeePerGas",
  "providerId",
]);
const EXPECTED_SIMULATION_KEYS = Object.freeze([
  "agreedGasEstimate",
  "allComponentsSucceeded",
  "blockTag",
  "closingGasEstimates",
  "gasEstimates",
  "returnDataKeccak256",
  "returnedAddresses",
]);
const EXPECTED_CHECK_KEYS = Object.freeze([
  "boundedTimeout",
  "closingGasAgreement",
  "closingSimulationAgreement",
  "closingVacancyVerified",
  "commonBlockAgreement",
  "dependencyRuntimePinsVerified",
  "exactCleanSource",
  "exactFreshDeterministicCompilation",
  "exactPreparedArtifact",
  "feeCeilingUsesOpeningAndClosingProviderMaxima",
  "fixedAndPendingCodeAndNonceVacancyVerified",
  "independentAuthenticatedRpcCount",
  "movingPendingHeadsTolerated",
  "noPendingOwnerTransaction",
  "pendingGasAgreement",
  "pendingNonceAgreement",
  "pendingSimulationAgreement",
  "rpcMethodInventory",
  "rpcResponseBudgetBytes",
  "rpcResponseBytesConsumed",
  "stateRelevantClosingAgreement",
  "stateRelevantOpeningAgreement",
]);
const EXPECTED_GAS_POLICY_KEYS = Object.freeze([
  "balanceReadPerformed",
  "fixedHeadroomGas",
  "fundingVerified",
  "headroomBasisPoints",
  "maximumGasCostWei",
  "maximumGasLimit",
  "observedGasPriceWei",
  "observedMaxPriorityFeePerGasWei",
  "observedPendingBaseFeePerGasWei",
  "ownerMaximumFeePerGasWei",
  "ownerMaximumGasCostWei",
  "ownerMaximumPriorityFeePerGasWei",
  "reviewedGasLimit",
  "reviewedMaxFeePerGasWei",
]);
const EXPECTED_TRANSACTION_KEYS = Object.freeze([
  "chainId",
  "from",
  "gasLimit",
  "gasQuantity",
  "input",
  "inputBytes",
  "inputKeccak256",
  "maxFeePerGas",
  "maxFeePerGasQuantity",
  "maxPriorityFeePerGas",
  "maxPriorityFeePerGasQuantity",
  "nonce",
  "nonceQuantity",
  "selector",
  "to",
  "type",
  "valueWei",
]);
const RPC_RESPONSE_LIMIT_BYTES = Object.freeze({
  eth_chainId: 8 * 1024,
  eth_getBlockByNumber: 128 * 1024,
  eth_getTransactionCount: 8 * 1024,
  eth_getCode: 128 * 1024,
  eth_call: 128 * 1024,
  eth_estimateGas: 8 * 1024,
  eth_gasPrice: 8 * 1024,
  eth_maxPriorityFeePerGas: 8 * 1024,
});
const RPC_AGGREGATE_RESPONSE_LIMIT_BYTES = 4 * 1024 * 1024;

function fail(message) {
  throw new Error(message);
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function hasExactKeys(value, expectedKeys) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join("\0") ===
      [...expectedKeys].sort().join("\0")
  );
}

function ownerEnvelopeReceiptDigest(receipt) {
  return sha256(
    Buffer.concat([
      Buffer.from(
        "programmable.robinhood-custom-launch.owner-envelope.receipt.v2",
        "utf8",
      ),
      Buffer.from([0]),
      Buffer.from(canonicalizeJson(receipt), "utf8"),
    ]),
  );
}

export function normalizeRobinhoodFoundationHostedVerifyBinding(value) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join("\0") !==
      [
        "artifactDigest",
        "artifactId",
        "artifactName",
        "proofCompletedAt",
        "repository",
        "runAttempt",
        "runId",
        "runUrl",
        "schemaVersion",
        "sourceCommit",
        "sourceTree",
        "verificationMode",
        "workflow",
      ]
        .sort()
        .join("\0") ||
    value.schemaVersion !== ROBINHOOD_FOUNDATION_HOSTED_VERIFY_SCHEMA ||
    value.repository !== "programmablehq/programmable" ||
    value.workflow !== ".github/workflows/verify.yml" ||
    value.verificationMode !== "change" ||
    !/^[0-9a-f]{40}$/u.test(value.sourceCommit ?? "") ||
    !/^[0-9a-f]{40}$/u.test(value.sourceTree ?? "") ||
    !Number.isSafeInteger(value.runId) ||
    value.runId < 1 ||
    !Number.isSafeInteger(value.runAttempt) ||
    value.runAttempt < 1 ||
    value.runUrl !==
      `https://github.com/programmablehq/PROGRAMMABLE/actions/runs/${value.runId}` ||
    typeof value.proofCompletedAt !== "string" ||
    !Number.isFinite(Date.parse(value.proofCompletedAt)) ||
    new Date(value.proofCompletedAt).toISOString() !== value.proofCompletedAt ||
    !Number.isSafeInteger(value.artifactId) ||
    value.artifactId < 1 ||
    value.artifactName !==
      `production-verify-proof-${value.runId}-${value.runAttempt}` ||
    !/^sha256:[0-9a-f]{64}$/u.test(value.artifactDigest ?? "")
  ) {
    fail("owner envelope hosted Verify binding is invalid");
  }
  return Object.freeze(structuredClone(value));
}

export function assertFreshRobinhoodFoundationOwnerEnvelope(
  receipt,
  nowMilliseconds = Date.now(),
) {
  if (
    receipt === null ||
    typeof receipt !== "object" ||
    Array.isArray(receipt) ||
    !Number.isSafeInteger(nowMilliseconds)
  ) {
    fail("owner envelope receipt or freshness clock is invalid");
  }
  const { receiptDigest, ...subject } = receipt;
  const issuedAtTimestamp = receipt.observation?.createdAtTimestamp;
  const expiresAtTimestamp = receipt.observation?.expiresAtTimestamp;
  const nowTimestamp = Math.floor(nowMilliseconds / 1_000);
  let transactionIsExact = false;
  const releaseIsExact =
    hasExactKeys(receipt.source, EXPECTED_SOURCE_KEYS) &&
    /^[0-9a-f]{40}$/u.test(receipt.source?.commit ?? "") &&
    /^[0-9a-f]{40}$/u.test(receipt.source?.tree ?? "") &&
    receipt.source?.clean === true &&
    receipt.source?.productionBaseCommit === PRODUCTION_SOURCE_COMMIT &&
    receipt.source?.productionBaseTree === PRODUCTION_SOURCE_TREE &&
    receipt.source?.chainProfileSha256 === CHAIN_PROFILE_SHA256 &&
    receipt.source?.predeploymentSha256 === PREDEPLOYMENT_SHA256 &&
    receipt.source?.foundationSourceCommitment ===
      FOUNDATION_SOURCE_COMMITMENT &&
    hasExactKeys(
      receipt.preparedArtifact,
      EXPECTED_PREPARED_ARTIFACT_KEYS,
    ) &&
    receipt.preparedArtifact?.path ===
      "contracts/deployments/robinhood-custom-launch-v1.predeployment.json" &&
    receipt.preparedArtifact?.sha256 === PREDEPLOYMENT_SHA256 &&
    receipt.preparedArtifact?.foundationSourceCommitment ===
      FOUNDATION_SOURCE_COMMITMENT &&
    JSON.stringify(receipt.preparedAddresses) ===
      JSON.stringify(EXPECTED_PREPARED_ADDRESSES) &&
    Array.isArray(receipt.rpcProviders) &&
    receipt.rpcProviders.length === EXPECTED_PROVIDER_RECEIPT_BINDINGS.length &&
    receipt.rpcProviders.every((binding, index) => {
      const expected = EXPECTED_PROVIDER_RECEIPT_BINDINGS[index];
      return (
        binding?.role === expected.role &&
        binding?.providerId === expected.providerId &&
        binding?.trustDomain === expected.trustDomain &&
        binding?.authentication === expected.authentication &&
        /^sha256:[0-9a-f]{64}$/u.test(binding?.endpointCommitment ?? "") &&
        Object.keys(binding).sort().join("\0") ===
          Object.keys(expected).sort().join("\0")
      );
    }) &&
    new Set(receipt.rpcProviders.map(({ endpointCommitment }) => endpointCommitment))
      .size === EXPECTED_PROVIDER_RECEIPT_BINDINGS.length;
  let hostedVerifyIsExact = false;
  try {
    const hostedVerify = normalizeRobinhoodFoundationHostedVerifyBinding(
      receipt.hostedVerify,
    );
    hostedVerifyIsExact =
      hostedVerify.sourceCommit === receipt.source?.commit &&
      hostedVerify.sourceTree === receipt.source?.tree;
  } catch {
    hostedVerifyIsExact = false;
  }
  let evidenceIsExact = false;
  try {
    const providerIds = EXPECTED_PROVIDER_PINS.map(({ providerId }) => providerId);
    const observation = receipt.observation;
    const openingHeads = observation.openingHeads.map((head, index) => {
      if (
        !hasExactKeys(head, EXPECTED_OPENING_HEAD_KEYS) ||
        head.providerId !== providerIds[index]
      ) {
        fail("receipt opening head is invalid");
      }
      return {
        number: parseDecimalWei(head.blockNumber, "receipt opening block"),
        hash: exactHash(head.blockHash, "receipt opening block hash"),
        timestamp: parseDecimalWei(
          head.blockTimestamp,
          "receipt opening block timestamp",
        ),
      };
    });
    if (openingHeads.length !== providerIds.length) {
      fail("receipt opening head count is invalid");
    }
    if (!hasExactKeys(observation.commonAnchor, EXPECTED_COMMON_ANCHOR_KEYS)) {
      fail("receipt common anchor is invalid");
    }
    const commonAnchor = {
      number: parseDecimalWei(
        observation.commonAnchor.blockNumber,
        "receipt common block",
      ),
      hash: exactHash(
        observation.commonAnchor.blockHash,
        "receipt common block hash",
      ),
      timestamp: parseDecimalWei(
        observation.commonAnchor.blockTimestamp,
        "receipt common block timestamp",
      ),
    };
    const openingMinimum = openingHeads.reduce(
      (minimum, { number }) => (number < minimum ? number : minimum),
      openingHeads[0].number,
    );
    const openingMaximum = openingHeads.reduce(
      (maximum, { number }) => (number > maximum ? number : maximum),
      openingHeads[0].number,
    );
    if (
      openingMaximum - openingMinimum >
        ROBINHOOD_FOUNDATION_OWNER_ENVELOPE_MAX_HEAD_GAP ||
      commonAnchor.number !== openingMinimum ||
      openingHeads.some(
        ({ number, hash, timestamp }) =>
          number === commonAnchor.number &&
          (hash !== commonAnchor.hash || timestamp !== commonAnchor.timestamp),
      )
    ) {
      fail("receipt common anchor differs from the opening heads");
    }
    const normalizePendingObservations = (values, label) => {
      if (!Array.isArray(values) || values.length !== providerIds.length) {
        fail(`receipt ${label} pending observation count is invalid`);
      }
      return values.map((value, index) => {
        if (
          !hasExactKeys(value, EXPECTED_PENDING_OBSERVATION_KEYS) ||
          value.providerId !== providerIds[index]
        ) {
          fail(`receipt ${label} pending observation is invalid`);
        }
        return {
          parentHash: exactHash(
            value.parentHash,
            `receipt ${label} pending parent hash`,
          ),
          timestamp: parseDecimalWei(
            value.blockTimestamp,
            `receipt ${label} pending timestamp`,
          ),
          gasLimit: parseDecimalWei(
            value.gasLimit,
            `receipt ${label} pending gas limit`,
          ),
          baseFeePerGas: parseDecimalWei(
            value.baseFeePerGas,
            `receipt ${label} pending base fee`,
            { positive: false },
          ),
        };
      });
    };
    const openingPendingBlocks = normalizePendingObservations(
      observation.openingPendingBlocks,
      "opening",
    );
    const closingPendingBlocks = normalizePendingObservations(
      observation.closingPendingBlocks,
      "closing",
    );
    const normalizeFeeObservations = (values, label) => {
      if (!Array.isArray(values) || values.length !== providerIds.length) {
        fail(`receipt ${label} fee observation count is invalid`);
      }
      return values.map((value, index) => {
        if (
          !hasExactKeys(value, EXPECTED_FEE_OBSERVATION_KEYS) ||
          value.providerId !== providerIds[index]
        ) {
          fail(`receipt ${label} fee observation is invalid`);
        }
        return {
          gasPrice: parseDecimalWei(
            value.gasPrice,
            `receipt ${label} gas price`,
          ),
          priorityFee: parseDecimalWei(
            value.maxPriorityFeePerGas,
            `receipt ${label} priority fee`,
            { positive: false },
          ),
        };
      });
    };
    const openingFees = normalizeFeeObservations(
      observation.openingFeeObservations,
      "opening",
    );
    const closingFees = normalizeFeeObservations(
      observation.closingFeeObservations,
      "closing",
    );
    const feeObservations = [...openingFees, ...closingFees];
    const simulation = receipt.simulation;
    const agreedGasEstimate = parseDecimalWei(
      simulation.agreedGasEstimate,
      "receipt agreed gas estimate",
    );
    const reviewedGasLimit = parseDecimalWei(
      receipt.transaction?.gasLimit,
      "receipt reviewed gas limit",
    );
    const gasEstimateArrays = [
      simulation.gasEstimates,
      simulation.closingGasEstimates,
    ];
    const expectedReturnedAddresses = Object.values(EXPECTED_PREPARED_ADDRESSES);
    const pendingBaseFeeMaximum = [
      ...openingPendingBlocks,
      ...closingPendingBlocks,
    ].reduce(
      (maximum, { baseFeePerGas }) =>
        baseFeePerGas > maximum ? baseFeePerGas : maximum,
      0n,
    );
    const gasPriceMaximum = feeObservations.reduce(
      (maximum, { gasPrice }) => (gasPrice > maximum ? gasPrice : maximum),
      0n,
    );
    const priorityFeeMaximum = feeObservations.reduce(
      (maximum, { priorityFee }) =>
        priorityFee > maximum ? priorityFee : maximum,
      0n,
    );
    const observedBaseFee = parseDecimalWei(
      receipt.gasPolicy?.observedPendingBaseFeePerGasWei,
      "receipt observed pending base fee",
      { positive: false },
    );
    const observedGasPrice = parseDecimalWei(
      receipt.gasPolicy?.observedGasPriceWei,
      "receipt observed gas price",
    );
    const observedPriorityFee = parseDecimalWei(
      receipt.gasPolicy?.observedMaxPriorityFeePerGasWei,
      "receipt observed priority fee",
      { positive: false },
    );
    const reviewedMaxFee = parseDecimalWei(
      receipt.gasPolicy?.reviewedMaxFeePerGasWei,
      "receipt reviewed maximum fee",
    );
    const expectedMaxFee =
      observedGasPrice > 2n * observedBaseFee + observedPriorityFee
        ? observedGasPrice
        : 2n * observedBaseFee + observedPriorityFee;
    const ownerMaximumFee = parseDecimalWei(
      receipt.gasPolicy?.ownerMaximumFeePerGasWei,
      "receipt owner maximum fee",
    );
    const ownerMaximumPriorityFee = parseDecimalWei(
      receipt.gasPolicy?.ownerMaximumPriorityFeePerGasWei,
      "receipt owner maximum priority fee",
      { positive: false },
    );
    const ownerMaximumGasCost = parseDecimalWei(
      receipt.gasPolicy?.ownerMaximumGasCostWei,
      "receipt owner maximum gas cost",
    );
    const checks = receipt.checks;
    const booleanCheckKeys = EXPECTED_CHECK_KEYS.filter(
      (key) =>
        ![
          "independentAuthenticatedRpcCount",
          "rpcMethodInventory",
          "rpcResponseBudgetBytes",
          "rpcResponseBytesConsumed",
        ].includes(key),
    );
    evidenceIsExact =
      hasExactKeys(observation, EXPECTED_OBSERVATION_KEYS) &&
      Number.isSafeInteger(observation.operationStartedAtTimestamp) &&
      observation.operationStartedAtTimestamp >= 0 &&
      Number.isSafeInteger(observation.createdAtTimestamp) &&
      observation.createdAtTimestamp >= observation.operationStartedAtTimestamp &&
      observation.createdAtTimestamp -
        observation.operationStartedAtTimestamp <=
        Math.ceil(ROBINHOOD_FOUNDATION_OWNER_ENVELOPE_MAX_OPERATION_MS / 1_000) &&
      Math.abs(
        observation.createdAtTimestamp - Number(commonAnchor.timestamp),
      ) <= 120 &&
      Number.isSafeInteger(observation.expiresAtTimestamp) &&
      observation.ttlSeconds ===
        ROBINHOOD_FOUNDATION_OWNER_ENVELOPE_TTL_SECONDS &&
      observation.minimumRemainingTtlSeconds ===
        ROBINHOOD_FOUNDATION_OWNER_ENVELOPE_MINIMUM_REMAINING_TTL_SECONDS &&
      Number.isSafeInteger(observation.elapsedMilliseconds) &&
      observation.elapsedMilliseconds >= 0 &&
      observation.elapsedMilliseconds <=
        ROBINHOOD_FOUNDATION_OWNER_ENVELOPE_MAX_OPERATION_MS &&
      hasExactKeys(simulation, EXPECTED_SIMULATION_KEYS) &&
      simulation.blockTag === "pending" &&
      simulation.returnDataKeccak256 === EXPECTED_CALL_RETURN_HASH &&
      simulation.allComponentsSucceeded === true &&
      Array.isArray(simulation.returnedAddresses) &&
      simulation.returnedAddresses.length ===
        expectedReturnedAddresses.length &&
      simulation.returnedAddresses.every((address, index) =>
        sameAddress(address, expectedReturnedAddresses[index]),
      ) &&
      gasEstimateArrays.every(
        (values) =>
          Array.isArray(values) &&
          values.length === providerIds.length &&
          values.every((value) => value === agreedGasEstimate.toString()),
      ) &&
      reviewedRobinhoodFoundationGasLimit(agreedGasEstimate) ===
        reviewedGasLimit &&
      [...openingPendingBlocks, ...closingPendingBlocks].every(
        ({ gasLimit }) => reviewedGasLimit <= gasLimit,
      ) &&
      hasExactKeys(receipt.gasPolicy, EXPECTED_GAS_POLICY_KEYS) &&
      receipt.gasPolicy.headroomBasisPoints ===
        ROBINHOOD_FOUNDATION_OWNER_ENVELOPE_GAS_HEADROOM_BPS.toString() &&
      receipt.gasPolicy.fixedHeadroomGas ===
        ROBINHOOD_FOUNDATION_OWNER_ENVELOPE_FIXED_GAS_HEADROOM.toString() &&
      receipt.gasPolicy.maximumGasLimit ===
        ROBINHOOD_FOUNDATION_OWNER_ENVELOPE_MAX_GAS_LIMIT.toString() &&
      receipt.gasPolicy.reviewedGasLimit === reviewedGasLimit.toString() &&
      observedBaseFee === pendingBaseFeeMaximum &&
      observedGasPrice === gasPriceMaximum &&
      observedPriorityFee === priorityFeeMaximum &&
      reviewedMaxFee === expectedMaxFee &&
      ownerMaximumFee >= reviewedMaxFee &&
      ownerMaximumPriorityFee >= observedPriorityFee &&
      ownerMaximumGasCost >= reviewedGasLimit * reviewedMaxFee &&
      receipt.gasPolicy.maximumGasCostWei ===
        (reviewedGasLimit * reviewedMaxFee).toString() &&
      receipt.gasPolicy.balanceReadPerformed === false &&
      receipt.gasPolicy.fundingVerified === false &&
      hasExactKeys(checks, EXPECTED_CHECK_KEYS) &&
      booleanCheckKeys.every((key) => checks[key] === true) &&
      checks.independentAuthenticatedRpcCount === providerIds.length &&
      checks.rpcResponseBudgetBytes === RPC_AGGREGATE_RESPONSE_LIMIT_BYTES &&
      Number.isSafeInteger(checks.rpcResponseBytesConsumed) &&
      checks.rpcResponseBytesConsumed >= 0 &&
      checks.rpcResponseBytesConsumed <= RPC_AGGREGATE_RESPONSE_LIMIT_BYTES &&
      JSON.stringify(checks.rpcMethodInventory) ===
        JSON.stringify(Object.keys(RPC_RESPONSE_LIMIT_BYTES));
  } catch {
    evidenceIsExact = false;
  }
  try {
    const input = exactCode(receipt.transaction?.input, "receipt input");
    const from = exactAddress(receipt.transaction?.from, "receipt sender");
    const gasLimit = parseDecimalWei(
      receipt.transaction?.gasLimit,
      "receipt gas limit",
    );
    const nonce = parseDecimalWei(receipt.transaction?.nonce, "receipt nonce", {
      positive: false,
    });
    const maxFeePerGas = parseDecimalWei(
      receipt.transaction?.maxFeePerGas,
      "receipt maximum fee per gas",
    );
    const maxPriorityFeePerGas = parseDecimalWei(
      receipt.transaction?.maxPriorityFeePerGas,
      "receipt maximum priority fee per gas",
      { positive: false },
    );
    transactionIsExact =
      hasExactKeys(receipt.transaction, EXPECTED_TRANSACTION_KEYS) &&
      ALLOWED_OWNERS.includes(from.toLowerCase()) &&
      receipt.transaction?.type === "0x2" &&
      receipt.transaction?.chainId === CHAIN_ID_HEX &&
      sameAddress(receipt.transaction?.to, MULTICALL3) &&
      receipt.transaction?.valueWei === "0" &&
      input.slice(0, 10) === OWNER_SELECTOR &&
      input.length === 2 + OWNER_DATA_BYTES * 2 &&
      receipt.transaction?.inputBytes === OWNER_DATA_BYTES &&
      receipt.transaction?.inputKeccak256 === OWNER_DATA_HASH &&
      keccak256(input) === OWNER_DATA_HASH &&
      receipt.transaction?.selector === OWNER_SELECTOR &&
      parseQuantity(
        receipt.transaction?.nonceQuantity,
        "receipt nonce quantity",
      ) === nonce &&
      nonce <= UINT64_MAXIMUM &&
      parseQuantity(
        receipt.transaction?.gasQuantity,
        "receipt gas quantity",
      ) === gasLimit &&
      gasLimit <= ROBINHOOD_FOUNDATION_OWNER_ENVELOPE_MAX_GAS_LIMIT &&
      parseQuantity(
        receipt.transaction?.maxFeePerGasQuantity,
        "receipt maximum fee quantity",
      ) === maxFeePerGas &&
      parseQuantity(
        receipt.transaction?.maxPriorityFeePerGasQuantity,
        "receipt priority fee quantity",
      ) === maxPriorityFeePerGas &&
      maxPriorityFeePerGas <= maxFeePerGas &&
      receipt.gasPolicy?.reviewedGasLimit === gasLimit.toString() &&
      receipt.gasPolicy?.reviewedMaxFeePerGasWei === maxFeePerGas.toString() &&
      receipt.gasPolicy?.observedMaxPriorityFeePerGasWei ===
        maxPriorityFeePerGas.toString() &&
      receipt.gasPolicy?.maximumGasCostWei ===
        (gasLimit * maxFeePerGas).toString();
  } catch {
    transactionIsExact = false;
  }
  if (
    !hasExactKeys(receipt, EXPECTED_RECEIPT_TOP_LEVEL_KEYS) ||
    receipt.schemaVersion !== ROBINHOOD_FOUNDATION_OWNER_ENVELOPE_SCHEMA ||
    receipt.state !== "prepared-not-signed-not-broadcast" ||
    receipt.status !==
      "READY_FOR_OWNER_WALLET_REVIEW_NO_SIGNING_NO_BROADCAST" ||
    receipt.signingAllowed !== false ||
    receipt.broadcastAllowed !== false ||
    receipt.privateKeyAccepted !== false ||
    receipt.ownerWalletReviewRequired !== true ||
    receipt.chainId !== Number(CHAIN_ID) ||
    receipt.chainIdHex !== CHAIN_ID_HEX ||
    receipt.caip2 !== "eip155:4663" ||
    receipt.gasPolicy?.balanceReadPerformed !== false ||
    receipt.gasPolicy?.fundingVerified !== false ||
    receipt.checks?.exactCleanSource !== true ||
    receipt.checks?.exactPreparedArtifact !== true ||
    receipt.checks?.exactFreshDeterministicCompilation !== true ||
    receipt.checks?.independentAuthenticatedRpcCount !== 2 ||
    receipt.checks?.noPendingOwnerTransaction !== true ||
    receipt.checks?.closingVacancyVerified !== true ||
    receipt.checks?.boundedTimeout !== true ||
    !releaseIsExact ||
    !hostedVerifyIsExact ||
    !evidenceIsExact ||
    !transactionIsExact ||
    !Number.isSafeInteger(issuedAtTimestamp) ||
    !Number.isSafeInteger(expiresAtTimestamp) ||
    nowMilliseconds < 0 ||
    issuedAtTimestamp < 0 ||
    expiresAtTimestamp - issuedAtTimestamp !==
      ROBINHOOD_FOUNDATION_OWNER_ENVELOPE_TTL_SECONDS ||
    receipt.issuedAt !== new Date(issuedAtTimestamp * 1_000).toISOString() ||
    receipt.expiresAt !== new Date(expiresAtTimestamp * 1_000).toISOString() ||
    issuedAtTimestamp > nowTimestamp + 30 ||
    expiresAtTimestamp - nowTimestamp <
      ROBINHOOD_FOUNDATION_OWNER_ENVELOPE_MINIMUM_REMAINING_TTL_SECONDS ||
    !/^sha256:[0-9a-f]{64}$/u.test(receiptDigest ?? "") ||
    ownerEnvelopeReceiptDigest(subject) !== receiptDigest
  ) {
    fail("owner envelope receipt is stale, unsafe, or digest-invalid");
  }
  return receiptDigest;
}

function quantity(value) {
  return `0x${BigInt(value).toString(16)}`;
}

function parseQuantity(value, label) {
  if (
    !/^0x(?:0|[1-9a-f][0-9a-f]*)$/iu.test(value ?? "") ||
    String(value).length > 66
  ) {
    fail(`${label} is not a canonical RPC quantity`);
  }
  const parsed = BigInt(value);
  if (parsed > (1n << 256n) - 1n) {
    fail(`${label} exceeds uint256`);
  }
  return parsed;
}

function exactHash(value, label) {
  if (!/^0x[0-9a-f]{64}$/iu.test(value ?? "")) {
    fail(`${label} is not a hash`);
  }
  return value.toLowerCase();
}

function exactCode(value, label) {
  if (!/^0x(?:[0-9a-f]{2})*$/iu.test(value ?? "")) {
    fail(`${label} is not runtime bytecode`);
  }
  return value.toLowerCase();
}

function exactAddress(value, label) {
  try {
    return getAddress(value);
  } catch {
    fail(`${label} is not an address`);
  }
}

function sameAddress(left, right) {
  return (
    exactAddress(left, "address").toLowerCase() ===
    exactAddress(right, "address").toLowerCase()
  );
}

function exactBlock(value, label) {
  if (!value || typeof value !== "object") fail(`${label} is missing`);
  const number = parseQuantity(value.number, `${label} number`);
  const timestamp = parseQuantity(value.timestamp, `${label} timestamp`);
  const gasLimit = parseQuantity(value.gasLimit, `${label} gas limit`);
  const hash = exactHash(value.hash, `${label} hash`);
  if (gasLimit === 0n) fail(`${label} gas limit is zero`);
  return { number, hash, timestamp, gasLimit };
}

function exactPendingBlock(value, label) {
  if (!value || typeof value !== "object") fail(`${label} is missing`);
  const parentHash = exactHash(value.parentHash, `${label} parent hash`);
  const timestamp = parseQuantity(value.timestamp, `${label} timestamp`);
  const gasLimit = parseQuantity(value.gasLimit, `${label} gas limit`);
  const baseFeePerGas = parseQuantity(
    value.baseFeePerGas,
    `${label} base fee per gas`,
  );
  if (gasLimit === 0n || baseFeePerGas === 0n) {
    fail(`${label} gas limit or base fee is zero`);
  }
  return { parentHash, timestamp, gasLimit, baseFeePerGas };
}

function parseDecimalWei(value, label, { positive = true } = {}) {
  const pattern = positive ? /^[1-9][0-9]*$/u : /^(?:0|[1-9][0-9]*)$/u;
  const canonical = String(value ?? "");
  if (canonical.length > 78 || !pattern.test(canonical)) {
    fail(`${label} must be a canonical decimal wei value`);
  }
  const parsed = BigInt(canonical);
  if (parsed > (1n << 256n) - 1n) {
    fail(`${label} exceeds uint256`);
  }
  return parsed;
}

export function reviewedRobinhoodFoundationGasLimit(estimatedGas) {
  if (
    typeof estimatedGas !== "bigint" ||
    estimatedGas <= 0n ||
    estimatedGas > UINT64_MAXIMUM
  ) {
    fail("foundation gas estimate is invalid or exceeds uint64");
  }
  const percentage =
    (estimatedGas *
      (BASIS_POINTS + ROBINHOOD_FOUNDATION_OWNER_ENVELOPE_GAS_HEADROOM_BPS) +
      BASIS_POINTS -
      1n) /
    BASIS_POINTS;
  const reviewed =
    percentage + ROBINHOOD_FOUNDATION_OWNER_ENVELOPE_FIXED_GAS_HEADROOM;
  if (reviewed > ROBINHOOD_FOUNDATION_OWNER_ENVELOPE_MAX_GAS_LIMIT) {
    fail("foundation gas limit exceeds the reviewed 10,000,000 gas cap");
  }
  return reviewed;
}

function authenticatedProviderBinding(pin, rpcUrl) {
  if (
    typeof rpcUrl !== "string" ||
    rpcUrl.length < 1 ||
    rpcUrl.length > 1_024 ||
    rpcUrl !== rpcUrl.trim()
  ) {
    fail(`${pin.providerId} RPC endpoint is not a bounded canonical URL`);
  }
  let url;
  try {
    url = new URL(rpcUrl);
  } catch {
    fail(`${pin.providerId} RPC endpoint is not a valid URL`);
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port !== "" && url.port !== "443") ||
    url.hash ||
    url.hostname !== url.hostname.toLowerCase()
  ) {
    fail(`${pin.providerId} RPC endpoint violates its provider pin`);
  }
  const quicknode =
    /^https:\/\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.robinhood-mainnet\.quiknode\.pro\/[A-Za-z0-9_-]{16,256}\/$/u.test(
      rpcUrl,
    ) &&
    !url.hostname.startsWith("docs-demo.") &&
    !/^(?:demo|example|placeholder|token|key)$/iu.test(
      url.pathname.slice(1, -1),
    );
  const alchemy =
    /^https:\/\/robinhood-mainnet\.g\.alchemy\.com\/v2\/[A-Za-z0-9_-]{16,256}$/u.test(
      rpcUrl,
    ) &&
    !/docs[-_]?demo/iu.test(url.pathname);
  const authenticated =
    pin.providerId === "alchemy" ? alchemy : quicknode;
  if (!authenticated) {
    fail(`${pin.providerId} RPC endpoint is not credential-bearing`);
  }
  return {
    role: pin.role,
    providerId: pin.providerId,
    trustDomain: pin.trustDomain,
    authentication: "provider-credential",
    rpcOrigin: url.origin,
    endpointCommitment: robinhoodFoundationRpcEndpointCommitment({
      role: pin.role,
      providerId: pin.providerId,
      rpcUrl,
    }),
  };
}

export function robinhoodFoundationRpcEndpointCommitment({
  role,
  providerId,
  rpcUrl,
}) {
  if (
    typeof role !== "string" ||
    typeof providerId !== "string" ||
    typeof rpcUrl !== "string"
  ) {
    fail("RPC endpoint commitment input is invalid");
  }
  return sha256(
    Buffer.concat([
      Buffer.from(
        "programmable.robinhood-custom-launch.rpc-endpoint.v1",
        "utf8",
      ),
      Buffer.from([0]),
      Buffer.from(role, "utf8"),
      Buffer.from([0]),
      Buffer.from(providerId, "utf8"),
      Buffer.from([0]),
      Buffer.from(rpcUrl, "utf8"),
    ]),
  );
}

export function assertRobinhoodFoundationRpcProviders({
  rpcUrls,
  endpointCommitments,
}) {
  if (
    !Array.isArray(rpcUrls) ||
    rpcUrls.length !== 2 ||
    !Array.isArray(endpointCommitments) ||
    endpointCommitments.length !== 2 ||
    endpointCommitments.some(
      (value) => !/^sha256:[0-9a-f]{64}$/u.test(value ?? ""),
    )
  ) {
    fail("exactly two authenticated production RPC providers are required");
  }
  const bindings = EXPECTED_PROVIDER_PINS.map((pin, index) =>
    authenticatedProviderBinding(pin, rpcUrls[index]),
  );
  if (bindings[0].rpcOrigin === bindings[1].rpcOrigin) {
    fail("production RPC origins must be distinct");
  }
  if (
    bindings.some(
      ({ endpointCommitment }, index) =>
        endpointCommitment !== endpointCommitments[index],
    ) ||
    new Set(endpointCommitments).size !== endpointCommitments.length
  ) {
    fail("production RPC endpoint differs from its reviewed commitment");
  }
  return bindings.map(
    ({ role, providerId, trustDomain, authentication, endpointCommitment }) => ({
      role,
      providerId,
      trustDomain,
      authentication,
      endpointCommitment,
    }),
  );
}

export async function robinhoodFoundationRpc({
  providerId,
  rpcUrl,
  method,
  params = [],
  requestTimeoutMs = ROBINHOOD_FOUNDATION_OWNER_ENVELOPE_REQUEST_TIMEOUT_MS,
  operationSignal,
  responseBudget = {
    consumed: 0,
    limit: RPC_AGGREGATE_RESPONSE_LIMIT_BYTES,
  },
  fetchImpl = fetch,
}) {
  const maximumResponseBytes = RPC_RESPONSE_LIMIT_BYTES[method];
  if (
    maximumResponseBytes === undefined ||
    !Number.isSafeInteger(responseBudget?.consumed) ||
    !Number.isSafeInteger(responseBudget?.limit) ||
    responseBudget.consumed < 0 ||
    responseBudget.consumed > responseBudget.limit ||
    responseBudget.limit !== RPC_AGGREGATE_RESPONSE_LIMIT_BYTES ||
    !Number.isSafeInteger(requestTimeoutMs) ||
    requestTimeoutMs < 1 ||
    requestTimeoutMs > ROBINHOOD_FOUNDATION_OWNER_ENVELOPE_REQUEST_TIMEOUT_MS
  ) {
    fail(
      `${providerId} RPC ${method} request is outside the reviewed inventory`,
    );
  }
  let response;
  try {
    const requestSignal = AbortSignal.timeout(requestTimeoutMs);
    response = await fetchImpl(rpcUrl, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      redirect: "error",
      signal: operationSignal
        ? AbortSignal.any([requestSignal, operationSignal])
        : requestSignal,
    });
  } catch {
    fail(`${providerId} RPC ${method} request failed`);
  }
  if (
    response.status !== 200 ||
    !/^application\/json(?:;.*)?$/iu.test(
      response.headers?.get?.("content-type") ?? "",
    ) ||
    typeof response.body?.getReader !== "function"
  ) {
    fail(`${providerId} RPC ${method} returned an invalid HTTP envelope`);
  }
  const declaredLength = response.headers.get("content-length");
  if (
    declaredLength !== null &&
    (!/^[1-9][0-9]*$/u.test(declaredLength) ||
      BigInt(declaredLength) > BigInt(maximumResponseBytes) ||
      BigInt(declaredLength) >
        BigInt(responseBudget.limit - responseBudget.consumed))
  ) {
    await response.body.cancel().catch(() => {});
    fail(`${providerId} RPC ${method} response exceeds its size limit`);
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (
        !(value instanceof Uint8Array) ||
        value.byteLength === 0 ||
        total + value.byteLength > maximumResponseBytes ||
        responseBudget.consumed + value.byteLength > responseBudget.limit
      ) {
        await reader.cancel().catch(() => {});
        fail(`${providerId} RPC ${method} response exceeds its size limit`);
      }
      total += value.byteLength;
      responseBudget.consumed += value.byteLength;
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (total === 0) fail(`${providerId} RPC ${method} response is empty`);
  let payload;
  try {
    payload = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        Buffer.concat(
          chunks.map((chunk) => Buffer.from(chunk)),
          total,
        ),
      ),
    );
  } catch {
    fail(`${providerId} RPC ${method} returned invalid JSON`);
  }
  if (
    payload === null ||
    typeof payload !== "object" ||
    Array.isArray(payload) ||
    payload.jsonrpc !== "2.0" ||
    payload.id !== 1 ||
    Object.hasOwn(payload, "error") ||
    !Object.hasOwn(payload, "result")
  ) {
    fail(`${providerId} RPC ${method} failed`);
  }
  return payload.result;
}

function exactPreparedTransaction({ prepared, deployment }) {
  const owner = exactAddress(prepared?.from, "prepared sender");
  if (!ALLOWED_OWNERS.includes(owner.toLowerCase())) {
    fail("prepared sender is not one of the two reviewed owners");
  }
  if (
    prepared.schemaVersion !==
      "programmable.robinhood-custom-launch.owner-transaction.v1" ||
    prepared.state !== "prepared-not-signed-not-broadcast" ||
    prepared.chainId !== Number(CHAIN_ID) ||
    prepared.caip2 !== "eip155:4663" ||
    !sameAddress(prepared.to, MULTICALL3) ||
    prepared.value !== "0x0" ||
    prepared.data?.slice(0, 10).toLowerCase() !== OWNER_SELECTOR ||
    prepared.dataHash?.toLowerCase() !== OWNER_DATA_HASH ||
    keccak256(prepared.data) !== OWNER_DATA_HASH ||
    prepared.dataBytes !== OWNER_DATA_BYTES ||
    hexToBytes(prepared.data).length !== OWNER_DATA_BYTES ||
    prepared.automaticSigningOrBroadcast !== false ||
    JSON.stringify(prepared.walletTimeEnvelopeFields) !==
      JSON.stringify([
        "nonce",
        "gasLimit",
        "maxFeePerGas",
        "maxPriorityFeePerGas",
      ]) ||
    deployment?.atomicOwnerTransaction?.dataHash !== OWNER_DATA_HASH ||
    deployment.atomicOwnerTransaction.dataBytes !== OWNER_DATA_BYTES ||
    deployment.atomicOwnerTransaction.selector !== OWNER_SELECTOR ||
    deployment.atomicOwnerTransaction.value !== "0" ||
    !sameAddress(deployment.atomicOwnerTransaction.to, MULTICALL3)
  ) {
    fail("prepared owner transaction commitment drifted");
  }
  if (
    prepared.decodedComponentCalls?.length !==
      EXPECTED_COMPONENT_CALLS.length ||
    prepared.decodedComponentCalls.some((call, index) => {
      const expected = EXPECTED_COMPONENT_CALLS[index];
      return (
        !sameAddress(call.to, expected.to) ||
        call.value !== "0x0" ||
        call.dataHash !== expected.dataHash ||
        call.dataBytes !== expected.dataBytes
      );
    })
  ) {
    fail("prepared owner component calls drifted");
  }
  for (const [key, address] of Object.entries(EXPECTED_PREPARED_ADDRESSES)) {
    if (!sameAddress(prepared.preparedAddresses?.[key], address)) {
      fail(`${key} prepared address drifted`);
    }
  }
  return { owner, to: getAddress(MULTICALL3), data: prepared.data };
}

function exactReleaseBindings({
  profile,
  deployment,
  chainProfileSha256,
  predeploymentSha256,
}) {
  if (
    chainProfileSha256 !== CHAIN_PROFILE_SHA256 ||
    predeploymentSha256 !== PREDEPLOYMENT_SHA256 ||
    profile?.schemaVersion !==
      "programmable.robinhood-custom-launch.chain-profile.v1" ||
    profile.chainId !== String(CHAIN_ID) ||
    profile.chainIdHex !== CHAIN_ID_HEX ||
    profile.caip2 !== "eip155:4663" ||
    profile.deploymentState !== "prepared-not-broadcast" ||
    profile.sourceCommitment !== FOUNDATION_SOURCE_COMMITMENT ||
    deployment?.schemaVersion !==
      "programmable.robinhood-custom-launch.deployment.v1" ||
    deployment.chainId !== String(CHAIN_ID) ||
    deployment.caip2 !== "eip155:4663" ||
    deployment.state !== "prepared-not-broadcast" ||
    deployment.live !== false ||
    deployment.foundationSourceCommitment !== FOUNDATION_SOURCE_COMMITMENT ||
    deployment.chainDeploymentDescriptorDigest !== null ||
    deployment.deployment?.sender !== null ||
    deployment.deployment.transactionHash !== null ||
    deployment.deployment.transactionNonce !== null ||
    deployment.deployment.transactionGasLimit !== null ||
    deployment.deployment.transactionMaxFeePerGas !== null ||
    deployment.deployment.transactionMaxPriorityFeePerGas !== null
  ) {
    fail("Robinhood predeployment release binding drifted");
  }
  const dependencyBindings = {
    safeSingleton: profile.contracts.safeInfrastructure.safeSingleton,
    safeProxyFactory: profile.contracts.safeInfrastructure.safeProxyFactory,
    compatibilityFallbackHandler:
      profile.contracts.safeInfrastructure.compatibilityFallbackHandler,
    multicall3: profile.contracts.deploymentInfrastructure.multicall3,
    deterministicDeployer:
      profile.contracts.deploymentInfrastructure.deterministicDeployer,
    poolManager: profile.contracts.uniswap.poolManager,
  };
  const preparedBindings = Object.fromEntries(
    Object.entries(EXPECTED_PREPARED_ADDRESSES).map(([key, address]) => [
      key,
      { address },
    ]),
  );
  for (const [key, binding] of Object.entries(dependencyBindings)) {
    const expected = EXPECTED_DEPENDENCY_BINDINGS[key];
    if (
      !expected ||
      !sameAddress(binding?.address, expected.address) ||
      exactHash(binding?.runtimeCodeHash, `${key} runtime code hash`) !==
        expected.runtimeCodeHash
    ) {
      fail(`${key} dependency pin drifted`);
    }
  }
  for (const [key, address] of Object.entries(EXPECTED_PREPARED_ADDRESSES)) {
    const profileKey = key === "router" ? "programmableLaunchStampRouter" : key;
    const deploymentKey =
      key === "router" ? "programmableLaunchStampRouter" : key;
    if (
      !sameAddress(
        profile.contracts.programmable[profileKey]?.address,
        address,
      ) ||
      !sameAddress(deployment.contracts[deploymentKey]?.address, address)
    ) {
      fail(`${key} release address drifted`);
    }
  }
  return {
    dependencyBindings: EXPECTED_DEPENDENCY_BINDINGS,
    preparedBindings,
  };
}

function verifyCodeSnapshot({
  snapshot,
  dependencies,
  prepared,
  label,
  runtimeCodeHash,
}) {
  for (const [key, binding] of Object.entries(dependencies)) {
    const code = exactCode(snapshot[key], `${label} ${key}`);
    if (code === "0x" || runtimeCodeHash(code) !== binding.runtimeCodeHash) {
      fail(`${label} ${key} runtime code hash drifted`);
    }
  }
  for (const key of Object.keys(prepared)) {
    const code = exactCode(snapshot[key], `${label} ${key}`);
    if (code !== "0x" || keccak256(code) !== EMPTY_CODE_HASH) {
      fail(`${label} ${key} predicted address is occupied`);
    }
  }
}

function verifyVacancyNonces({ snapshot, prepared, label }) {
  for (const key of Object.keys(prepared)) {
    if (parseQuantity(snapshot[key], `${label} ${key} nonce`) !== 0n) {
      fail(`${label} ${key} predicted address nonce is non-zero`);
    }
  }
}

function decodeSimulationReturn(result) {
  const code = exactCode(result, "foundation simulation result");
  if (keccak256(code) !== EXPECTED_CALL_RETURN_HASH) {
    fail("foundation simulation return commitment drifted");
  }
  let decoded;
  try {
    [decoded] = decodeAbiParameters(parseAbiParameters("(bool,bytes)[]"), code);
  } catch {
    fail("foundation simulation result cannot be decoded");
  }
  if (!Array.isArray(decoded) || decoded.length !== 3) {
    fail("foundation simulation did not return three component results");
  }
  const returnedAddresses = decoded.map(([success, returnData], index) => {
    if (success !== true)
      fail(`foundation simulation component ${index} failed`);
    if (index === 0) {
      try {
        return getAddress(
          decodeAbiParameters(parseAbiParameters("address"), returnData)[0],
        );
      } catch {
        fail("foundation simulation Safe return is invalid");
      }
    }
    return exactAddress(returnData, `foundation simulation component ${index}`);
  });
  const expected = Object.values(EXPECTED_PREPARED_ADDRESSES);
  if (
    returnedAddresses.some(
      (address, index) => !sameAddress(address, expected[index]),
    )
  ) {
    fail("foundation simulation returned unexpected deployment addresses");
  }
  return returnedAddresses;
}

async function rpc(
  provider,
  method,
  params,
  rpcClient,
  requestTimeoutMs,
  operationSignal,
  responseBudget,
) {
  return rpcClient({
    providerId: provider.providerId,
    rpcUrl: provider.rpcUrl,
    method,
    params,
    requestTimeoutMs,
    operationSignal: operationSignal ?? provider.operationSignal,
    responseBudget: responseBudget ?? provider.responseBudget,
  });
}

async function readCodes({
  provider,
  bindings,
  blockTag,
  rpcClient,
  requestTimeoutMs,
  operationSignal,
  responseBudget,
}) {
  return Object.fromEntries(
    await Promise.all(
      Object.entries(bindings).map(async ([key, binding]) => [
        key,
        await rpc(
          provider,
          "eth_getCode",
          [binding.address, blockTag],
          rpcClient,
          requestTimeoutMs,
          operationSignal,
          responseBudget,
        ),
      ]),
    ),
  );
}

async function readNonces({
  provider,
  bindings,
  blockTag,
  rpcClient,
  requestTimeoutMs,
  operationSignal,
  responseBudget,
}) {
  return Object.fromEntries(
    await Promise.all(
      Object.entries(bindings).map(async ([key, binding]) => [
        key,
        await rpc(
          provider,
          "eth_getTransactionCount",
          [binding.address, blockTag],
          rpcClient,
          requestTimeoutMs,
          operationSignal,
          responseBudget,
        ),
      ]),
    ),
  );
}

export async function verifyRobinhoodFoundationOwnerWalletActionTimeState({
  receipt,
  rpcUrls,
  rpcEndpointCommitments,
  rpcClient = robinhoodFoundationRpc,
  requestTimeoutMs = ROBINHOOD_FOUNDATION_OWNER_ENVELOPE_REQUEST_TIMEOUT_MS,
  clock = () => Date.now(),
}) {
  assertFreshRobinhoodFoundationOwnerEnvelope(receipt, clock());
  const operationSignal = AbortSignal.timeout(
    ROBINHOOD_FOUNDATION_OWNER_ENVELOPE_MAX_OPERATION_MS,
  );
  const responseBudget = {
    consumed: 0,
    limit: RPC_AGGREGATE_RESPONSE_LIMIT_BYTES,
  };
  const providerBindings = assertRobinhoodFoundationRpcProviders({
    rpcUrls,
    endpointCommitments: rpcEndpointCommitments,
  });
  if (JSON.stringify(providerBindings) !== JSON.stringify(receipt.rpcProviders)) {
    fail("action-time RPC endpoints differ from the owner-envelope commitments");
  }
  const providers = providerBindings.map((binding, index) => ({
    ...binding,
    rpcUrl: rpcUrls[index],
    operationSignal,
    responseBudget,
  }));
  const preparedBindings = Object.fromEntries(
    Object.entries(EXPECTED_PREPARED_ADDRESSES).map(([key, address]) => [
      key,
      { address },
    ]),
  );
  const expectedNonce = parseQuantity(
    receipt.transaction.nonceQuantity,
    "owner-envelope nonce",
  );
  const expectedGasEstimate = parseDecimalWei(
    receipt.simulation.agreedGasEstimate,
    "owner-envelope gas estimate",
  );
  const reviewedGasLimit = parseQuantity(
    receipt.transaction.gasQuantity,
    "owner-envelope gas limit",
  );
  const simulationRequest = {
    from: receipt.transaction.from,
    to: receipt.transaction.to,
    value: "0x0",
    data: receipt.transaction.input,
  };

  const snapshots = await Promise.all(
    providers.map(async (provider) => {
      const [
        chainIdValue,
        latestNonceValue,
        pendingNonceValue,
        codes,
        vacancyNonces,
        callResultValue,
        estimateValue,
      ] = await Promise.all([
        rpc(provider, "eth_chainId", [], rpcClient, requestTimeoutMs),
        rpc(
          provider,
          "eth_getTransactionCount",
          [receipt.transaction.from, "latest"],
          rpcClient,
          requestTimeoutMs,
        ),
        rpc(
          provider,
          "eth_getTransactionCount",
          [receipt.transaction.from, "pending"],
          rpcClient,
          requestTimeoutMs,
        ),
        readCodes({
          provider,
          bindings: preparedBindings,
          blockTag: "pending",
          rpcClient,
          requestTimeoutMs,
        }),
        readNonces({
          provider,
          bindings: preparedBindings,
          blockTag: "pending",
          rpcClient,
          requestTimeoutMs,
        }),
        rpc(
          provider,
          "eth_call",
          [simulationRequest, "pending"],
          rpcClient,
          requestTimeoutMs,
        ),
        rpc(
          provider,
          "eth_estimateGas",
          [simulationRequest, "pending"],
          rpcClient,
          requestTimeoutMs,
        ),
      ]);
      return {
        chainId: parseQuantity(
          chainIdValue,
          `${provider.providerId} action-time chain ID`,
        ),
        latestNonce: parseQuantity(
          latestNonceValue,
          `${provider.providerId} action-time latest nonce`,
        ),
        pendingNonce: parseQuantity(
          pendingNonceValue,
          `${provider.providerId} action-time pending nonce`,
        ),
        codes,
        vacancyNonces,
        callResult: exactCode(
          callResultValue,
          `${provider.providerId} action-time simulation result`,
        ),
        estimatedGas: parseQuantity(
          estimateValue,
          `${provider.providerId} action-time gas estimate`,
        ),
      };
    }),
  );

  for (const [index, snapshot] of snapshots.entries()) {
    const providerId = providers[index].providerId;
    if (
      snapshot.chainId !== CHAIN_ID ||
      snapshot.latestNonce !== expectedNonce ||
      snapshot.pendingNonce !== expectedNonce
    ) {
      fail(
        `${providerId} action-time chain or owner nonce differs from the envelope`,
      );
    }
    verifyCodeSnapshot({
      snapshot: snapshot.codes,
      dependencies: {},
      prepared: preparedBindings,
      label: `${providerId} action-time`,
      runtimeCodeHash: keccak256,
    });
    verifyVacancyNonces({
      snapshot: snapshot.vacancyNonces,
      prepared: preparedBindings,
      label: `${providerId} action-time`,
    });
    const returnedAddresses = decodeSimulationReturn(snapshot.callResult);
    if (
      snapshot.callResult !== snapshots[0].callResult ||
      JSON.stringify(returnedAddresses) !==
        JSON.stringify(receipt.simulation.returnedAddresses) ||
      snapshot.estimatedGas !== expectedGasEstimate ||
      snapshot.estimatedGas > reviewedGasLimit
    ) {
      fail(
        `${providerId} action-time simulation or gas differs from the envelope`,
      );
    }
  }
  if (
    snapshots[0].chainId !== snapshots[1].chainId ||
    snapshots[0].latestNonce !== snapshots[1].latestNonce ||
    snapshots[0].pendingNonce !== snapshots[1].pendingNonce ||
    JSON.stringify(snapshots[0].codes) !==
      JSON.stringify(snapshots[1].codes) ||
    JSON.stringify(snapshots[0].vacancyNonces) !==
      JSON.stringify(snapshots[1].vacancyNonces) ||
    snapshots[0].callResult !== snapshots[1].callResult ||
    snapshots[0].estimatedGas !== snapshots[1].estimatedGas
  ) {
    fail("Robinhood RPCs disagree on action-time owner-wallet state");
  }

  const closings = await Promise.all(
    providers.map(async (provider) => {
      const [
        chainIdValue,
        latestNonceValue,
        pendingNonceValue,
        codes,
        vacancyNonces,
        callResultValue,
        estimateValue,
      ] = await Promise.all([
          rpc(provider, "eth_chainId", [], rpcClient, requestTimeoutMs),
          rpc(
            provider,
            "eth_getTransactionCount",
            [receipt.transaction.from, "latest"],
            rpcClient,
            requestTimeoutMs,
          ),
          rpc(
            provider,
            "eth_getTransactionCount",
            [receipt.transaction.from, "pending"],
            rpcClient,
            requestTimeoutMs,
          ),
          readCodes({
            provider,
            bindings: preparedBindings,
            blockTag: "pending",
            rpcClient,
            requestTimeoutMs,
          }),
          readNonces({
            provider,
            bindings: preparedBindings,
            blockTag: "pending",
            rpcClient,
            requestTimeoutMs,
          }),
          rpc(
            provider,
            "eth_call",
            [simulationRequest, "pending"],
            rpcClient,
            requestTimeoutMs,
          ),
          rpc(
            provider,
            "eth_estimateGas",
            [simulationRequest, "pending"],
            rpcClient,
            requestTimeoutMs,
          ),
        ]);
      return {
        chainId: parseQuantity(
          chainIdValue,
          `${provider.providerId} action-time closing chain ID`,
        ),
        latestNonce: parseQuantity(
          latestNonceValue,
          `${provider.providerId} action-time closing latest nonce`,
        ),
        pendingNonce: parseQuantity(
          pendingNonceValue,
          `${provider.providerId} action-time closing pending nonce`,
        ),
        codes,
        vacancyNonces,
        callResult: exactCode(
          callResultValue,
          `${provider.providerId} action-time closing simulation result`,
        ),
        estimatedGas: parseQuantity(
          estimateValue,
          `${provider.providerId} action-time closing gas estimate`,
        ),
      };
    }),
  );
  for (const [index, closing] of closings.entries()) {
    const providerId = providers[index].providerId;
    if (
      closing.chainId !== CHAIN_ID ||
      closing.chainId !== snapshots[index].chainId ||
      closing.latestNonce !== expectedNonce ||
      closing.pendingNonce !== expectedNonce ||
      closing.latestNonce !== snapshots[index].latestNonce ||
      closing.pendingNonce !== snapshots[index].pendingNonce ||
      JSON.stringify(closing.codes) !== JSON.stringify(snapshots[index].codes) ||
      JSON.stringify(closing.vacancyNonces) !==
        JSON.stringify(snapshots[index].vacancyNonces) ||
      closing.callResult !== snapshots[index].callResult ||
      closing.callResult !== snapshots[0].callResult ||
      closing.estimatedGas !== snapshots[index].estimatedGas ||
      closing.estimatedGas !== expectedGasEstimate ||
      closing.estimatedGas > reviewedGasLimit
    ) {
      fail(`${providerId} action-time state changed during wallet verification`);
    }
    verifyCodeSnapshot({
      snapshot: closing.codes,
      dependencies: {},
      prepared: preparedBindings,
      label: `${providerId} action-time closing`,
      runtimeCodeHash: keccak256,
    });
    verifyVacancyNonces({
      snapshot: closing.vacancyNonces,
      prepared: preparedBindings,
      label: `${providerId} action-time closing`,
    });
  }
  if (
    closings[0].chainId !== closings[1].chainId ||
    closings[0].latestNonce !== closings[1].latestNonce ||
    closings[0].pendingNonce !== closings[1].pendingNonce ||
    JSON.stringify(closings[0].codes) !== JSON.stringify(closings[1].codes) ||
    JSON.stringify(closings[0].vacancyNonces) !==
      JSON.stringify(closings[1].vacancyNonces) ||
    closings[0].callResult !== closings[1].callResult ||
    closings[0].estimatedGas !== closings[1].estimatedGas
  ) {
    fail("Robinhood RPCs disagree on action-time closing owner-wallet state");
  }
  assertFreshRobinhoodFoundationOwnerEnvelope(receipt, clock());
  return Object.freeze({
    chainId: CHAIN_ID_HEX,
    ownerNonce: expectedNonce.toString(),
    providerCount: providers.length,
    preparedAddressCount: Object.keys(preparedBindings).length,
    pendingSimulationVerified: true,
    pendingGasEstimate: expectedGasEstimate.toString(),
    closingSimulationVerified: true,
    closingGasEstimate: expectedGasEstimate.toString(),
    closingVacancyVerified: true,
    rpcResponseBytesConsumed: responseBudget.consumed,
  });
}

function exactSource(source) {
  if (
    !/^[0-9a-f]{40}$/u.test(source?.commit ?? "") ||
    !/^[0-9a-f]{40}$/u.test(source?.tree ?? "") ||
    source.clean !== true
  ) {
    fail("owner envelope requires an exact clean source commit and tree");
  }
  return { commit: source.commit, tree: source.tree, clean: true };
}

export async function prepareRobinhoodFoundationOwnerEnvelope({
  owner,
  prepared,
  profile,
  deployment,
  chainProfileSha256,
  predeploymentSha256,
  source,
  hostedVerify,
  rpcUrls,
  rpcEndpointCommitments,
  maximumFeePerGasWei,
  maximumPriorityFeePerGasWei,
  maximumGasCostWei,
  rpcClient = robinhoodFoundationRpc,
  runtimeCodeHash = keccak256,
  requestTimeoutMs = ROBINHOOD_FOUNDATION_OWNER_ENVELOPE_REQUEST_TIMEOUT_MS,
  clock = () => Date.now(),
}) {
  const startedAtMilliseconds = clock();
  if (!Number.isSafeInteger(startedAtMilliseconds)) {
    fail("owner envelope clock is invalid");
  }
  if (typeof runtimeCodeHash !== "function") {
    fail("runtime code hasher is invalid");
  }
  const operationSignal = AbortSignal.timeout(
    ROBINHOOD_FOUNDATION_OWNER_ENVELOPE_MAX_OPERATION_MS,
  );
  const responseBudget = {
    consumed: 0,
    limit: RPC_AGGREGATE_RESPONSE_LIMIT_BYTES,
  };
  const providerBindings = assertRobinhoodFoundationRpcProviders({
    rpcUrls,
    endpointCommitments: rpcEndpointCommitments,
  });
  const providers = providerBindings.map((binding, index) => ({
    ...binding,
    rpcUrl: rpcUrls[index],
    operationSignal,
    responseBudget,
  }));
  const exactSourceValue = exactSource(source);
  const exactHostedVerify = normalizeRobinhoodFoundationHostedVerifyBinding(
    hostedVerify,
  );
  if (
    exactHostedVerify.sourceCommit !== exactSourceValue.commit ||
    exactHostedVerify.sourceTree !== exactSourceValue.tree
  ) {
    fail("hosted Verify proof does not bind the exact owner-envelope source");
  }
  const release = exactReleaseBindings({
    profile,
    deployment,
    chainProfileSha256,
    predeploymentSha256,
  });
  const transaction = exactPreparedTransaction({ prepared, deployment });
  if (!sameAddress(owner, transaction.owner)) {
    fail("selected owner differs from the prepared sender");
  }
  const ownerMaximumFeePerGasWei = parseDecimalWei(
    maximumFeePerGasWei,
    "owner maximum fee per gas",
  );
  const ownerMaximumPriorityFeePerGasWei = parseDecimalWei(
    maximumPriorityFeePerGasWei,
    "owner maximum priority fee per gas",
    { positive: false },
  );
  const ownerMaximumGasCostWei = parseDecimalWei(
    maximumGasCostWei,
    "owner maximum gas cost",
  );

  const openings = await Promise.all(
    providers.map(async (provider) => {
      const [chainId, headValue, latestNonceValue, pendingNonceValue] =
        await Promise.all([
          rpc(provider, "eth_chainId", [], rpcClient, requestTimeoutMs),
          rpc(
            provider,
            "eth_getBlockByNumber",
            ["latest", false],
            rpcClient,
            requestTimeoutMs,
          ),
          rpc(
            provider,
            "eth_getTransactionCount",
            [transaction.owner, "latest"],
            rpcClient,
            requestTimeoutMs,
          ),
          rpc(
            provider,
            "eth_getTransactionCount",
            [transaction.owner, "pending"],
            rpcClient,
            requestTimeoutMs,
          ),
        ]);
      if (
        parseQuantity(chainId, `${provider.providerId} chain ID`) !== CHAIN_ID
      ) {
        fail(`${provider.providerId} is not Robinhood Chain mainnet`);
      }
      return {
        head: exactBlock(headValue, `${provider.providerId} latest block`),
        latestNonce: parseQuantity(
          latestNonceValue,
          `${provider.providerId} latest nonce`,
        ),
        pendingNonce: parseQuantity(
          pendingNonceValue,
          `${provider.providerId} pending nonce`,
        ),
      };
    }),
  );
  const headGap =
    openings[0].head.number > openings[1].head.number
      ? openings[0].head.number - openings[1].head.number
      : openings[1].head.number - openings[0].head.number;
  if (headGap > ROBINHOOD_FOUNDATION_OWNER_ENVELOPE_MAX_HEAD_GAP) {
    fail("Robinhood RPC heads exceed the reviewed gap");
  }
  if (
    openings.some(
      ({ latestNonce, pendingNonce }) => latestNonce !== pendingNonce,
    ) ||
    openings[0].latestNonce !== openings[1].latestNonce ||
    openings[0].pendingNonce !== openings[1].pendingNonce
  ) {
    fail("owner nonce disagrees or an owner transaction is already pending");
  }
  const nonce = openings[0].pendingNonce;
  if (nonce > UINT64_MAXIMUM) fail("owner nonce exceeds uint64");

  const commonBlockNumber = openings.reduce(
    (minimum, { head }) => (head.number < minimum ? head.number : minimum),
    openings[0].head.number,
  );
  const commonBlockTag = quantity(commonBlockNumber);
  const commonBlocks = await Promise.all(
    providers.map((provider) =>
      rpc(
        provider,
        "eth_getBlockByNumber",
        [commonBlockTag, false],
        rpcClient,
        requestTimeoutMs,
      ).then((value) =>
        exactBlock(value, `${provider.providerId} common block`),
      ),
    ),
  );
  if (
    commonBlocks.some(
      (block) =>
        block.number !== commonBlockNumber ||
        block.hash !== commonBlocks[0].hash ||
        block.timestamp !== commonBlocks[0].timestamp ||
        block.gasLimit !== commonBlocks[0].gasLimit,
    )
  ) {
    fail("Robinhood RPCs disagree on the common fixed block");
  }

  const allBindings = {
    ...release.dependencyBindings,
    ...release.preparedBindings,
  };
  const commonBlockRef = {
    blockHash: commonBlocks[0].hash,
    requireCanonical: true,
  };
  const fixedSnapshots = await Promise.all(
    providers.map(async (provider) => {
      const [codes, vacancyNonces] = await Promise.all([
        readCodes({
          provider,
          bindings: allBindings,
          blockTag: commonBlockRef,
          rpcClient,
          requestTimeoutMs,
        }),
        readNonces({
          provider,
          bindings: release.preparedBindings,
          blockTag: commonBlockRef,
          rpcClient,
          requestTimeoutMs,
        }),
      ]);
      return { codes, vacancyNonces };
    }),
  );
  fixedSnapshots.forEach((snapshot, index) => {
    verifyCodeSnapshot({
      snapshot: snapshot.codes,
      dependencies: release.dependencyBindings,
      prepared: release.preparedBindings,
      label: `${providers[index].providerId} fixed`,
      runtimeCodeHash,
    });
    verifyVacancyNonces({
      snapshot: snapshot.vacancyNonces,
      prepared: release.preparedBindings,
      label: `${providers[index].providerId} fixed`,
    });
  });
  if (JSON.stringify(fixedSnapshots[0]) !== JSON.stringify(fixedSnapshots[1])) {
    fail("Robinhood RPCs disagree on fixed runtime bytes or vacancy nonces");
  }

  const pendingSnapshots = await Promise.all(
    providers.map(async (provider) => {
      const [
        pendingBlockValue,
        gasPriceValue,
        priorityFeeValue,
        codes,
        vacancyNonces,
        callResult,
        estimateValue,
      ] = await Promise.all([
        rpc(
          provider,
          "eth_getBlockByNumber",
          ["pending", false],
          rpcClient,
          requestTimeoutMs,
        ),
        rpc(provider, "eth_gasPrice", [], rpcClient, requestTimeoutMs),
        rpc(
          provider,
          "eth_maxPriorityFeePerGas",
          [],
          rpcClient,
          requestTimeoutMs,
        ),
        readCodes({
          provider,
          bindings: allBindings,
          blockTag: "pending",
          rpcClient,
          requestTimeoutMs,
        }),
        readNonces({
          provider,
          bindings: release.preparedBindings,
          blockTag: "pending",
          rpcClient,
          requestTimeoutMs,
        }),
        rpc(
          provider,
          "eth_call",
          [
            {
              from: transaction.owner,
              to: transaction.to,
              value: "0x0",
              data: transaction.data,
            },
            "pending",
          ],
          rpcClient,
          requestTimeoutMs,
        ),
        rpc(
          provider,
          "eth_estimateGas",
          [
            {
              from: transaction.owner,
              to: transaction.to,
              value: "0x0",
              data: transaction.data,
            },
            "pending",
          ],
          rpcClient,
          requestTimeoutMs,
        ),
      ]);
      verifyCodeSnapshot({
        snapshot: codes,
        dependencies: release.dependencyBindings,
        prepared: release.preparedBindings,
        label: `${provider.providerId} pending`,
        runtimeCodeHash,
      });
      verifyVacancyNonces({
        snapshot: vacancyNonces,
        prepared: release.preparedBindings,
        label: `${provider.providerId} pending`,
      });
      return {
        pendingBlock: exactPendingBlock(
          pendingBlockValue,
          `${provider.providerId} pending block`,
        ),
        gasPrice: parseQuantity(
          gasPriceValue,
          `${provider.providerId} opening gas price`,
        ),
        priorityFee: parseQuantity(
          priorityFeeValue,
          `${provider.providerId} opening priority fee`,
        ),
        codes,
        vacancyNonces,
        callResult: exactCode(
          callResult,
          `${provider.providerId} simulation result`,
        ),
        estimatedGas: parseQuantity(
          estimateValue,
          `${provider.providerId} gas estimate`,
        ),
      };
    }),
  );
  if (
    JSON.stringify(pendingSnapshots[0].codes) !==
      JSON.stringify(pendingSnapshots[1].codes) ||
    JSON.stringify(pendingSnapshots[0].vacancyNonces) !==
      JSON.stringify(pendingSnapshots[1].vacancyNonces) ||
    pendingSnapshots[0].callResult !== pendingSnapshots[1].callResult ||
    pendingSnapshots[0].estimatedGas !== pendingSnapshots[1].estimatedGas
  ) {
    fail("Robinhood RPCs disagree on pending state, simulation, or gas");
  }
  const returnedAddresses = decodeSimulationReturn(
    pendingSnapshots[0].callResult,
  );
  const estimatedGas = pendingSnapshots[0].estimatedGas;
  const gasLimit = reviewedRobinhoodFoundationGasLimit(estimatedGas);
  if (
    commonBlocks.some((block) => gasLimit > block.gasLimit) ||
    pendingSnapshots.some(
      ({ pendingBlock }) => gasLimit > pendingBlock.gasLimit,
    )
  ) {
    fail("foundation gas limit does not fit the common block gas limit");
  }

  const closings = await Promise.all(
    providers.map(async (provider) => {
      const [
        chainIdValue,
        anchorValue,
        pendingBlockValue,
        pendingNonceValue,
        gasPriceValue,
        priorityFeeValue,
        codes,
        vacancyNonces,
        callResult,
        estimateValue,
      ] = await Promise.all([
        rpc(provider, "eth_chainId", [], rpcClient, requestTimeoutMs),
        rpc(
          provider,
          "eth_getBlockByNumber",
          [commonBlockTag, false],
          rpcClient,
          requestTimeoutMs,
        ),
        rpc(
          provider,
          "eth_getBlockByNumber",
          ["pending", false],
          rpcClient,
          requestTimeoutMs,
        ),
        rpc(
          provider,
          "eth_getTransactionCount",
          [transaction.owner, "pending"],
          rpcClient,
          requestTimeoutMs,
        ),
        rpc(provider, "eth_gasPrice", [], rpcClient, requestTimeoutMs),
        rpc(
          provider,
          "eth_maxPriorityFeePerGas",
          [],
          rpcClient,
          requestTimeoutMs,
        ),
        readCodes({
          provider,
          bindings: allBindings,
          blockTag: "pending",
          rpcClient,
          requestTimeoutMs,
        }),
        readNonces({
          provider,
          bindings: release.preparedBindings,
          blockTag: "pending",
          rpcClient,
          requestTimeoutMs,
        }),
        rpc(
          provider,
          "eth_call",
          [
            {
              from: transaction.owner,
              to: transaction.to,
              value: "0x0",
              data: transaction.data,
            },
            "pending",
          ],
          rpcClient,
          requestTimeoutMs,
        ),
        rpc(
          provider,
          "eth_estimateGas",
          [
            {
              from: transaction.owner,
              to: transaction.to,
              value: "0x0",
              data: transaction.data,
            },
            "pending",
          ],
          rpcClient,
          requestTimeoutMs,
        ),
      ]);
      return {
        chainId: parseQuantity(
          chainIdValue,
          `${provider.providerId} closing chain ID`,
        ),
        anchor: exactBlock(
          anchorValue,
          `${provider.providerId} closing anchor`,
        ),
        pendingBlock: exactPendingBlock(
          pendingBlockValue,
          `${provider.providerId} closing pending block`,
        ),
        pendingNonce: parseQuantity(
          pendingNonceValue,
          `${provider.providerId} closing nonce`,
        ),
        gasPrice: parseQuantity(
          gasPriceValue,
          `${provider.providerId} gas price`,
        ),
        priorityFee: parseQuantity(
          priorityFeeValue,
          `${provider.providerId} priority fee`,
        ),
        codes,
        vacancyNonces,
        callResult: exactCode(
          callResult,
          `${provider.providerId} closing simulation result`,
        ),
        estimatedGas: parseQuantity(
          estimateValue,
          `${provider.providerId} closing gas estimate`,
        ),
      };
    }),
  );
  for (const [index, closing] of closings.entries()) {
    if (
      closing.chainId !== CHAIN_ID ||
      closing.anchor.number !== commonBlockNumber ||
      closing.anchor.hash !== commonBlocks[0].hash ||
      closing.pendingNonce !== nonce ||
      JSON.stringify(closing.codes) !==
        JSON.stringify(pendingSnapshots[index].codes) ||
      JSON.stringify(closing.vacancyNonces) !==
        JSON.stringify(pendingSnapshots[index].vacancyNonces) ||
      closing.callResult !== pendingSnapshots[index].callResult ||
      closing.estimatedGas !== pendingSnapshots[index].estimatedGas ||
      closing.estimatedGas !== estimatedGas ||
      gasLimit > closing.pendingBlock.gasLimit
    ) {
      fail(`${providers[index].providerId} state changed during preflight`);
    }
    verifyCodeSnapshot({
      snapshot: closing.codes,
      dependencies: release.dependencyBindings,
      prepared: release.preparedBindings,
      label: `${providers[index].providerId} closing`,
      runtimeCodeHash,
    });
    verifyVacancyNonces({
      snapshot: closing.vacancyNonces,
      prepared: release.preparedBindings,
      label: `${providers[index].providerId} closing`,
    });
  }
  if (
    closings[0].chainId !== closings[1].chainId ||
    closings[0].pendingNonce !== closings[1].pendingNonce ||
    JSON.stringify(closings[0].codes) !== JSON.stringify(closings[1].codes) ||
    JSON.stringify(closings[0].vacancyNonces) !==
      JSON.stringify(closings[1].vacancyNonces) ||
    closings[0].callResult !== closings[1].callResult ||
    closings[0].estimatedGas !== closings[1].estimatedGas
  ) {
    fail(
      "Robinhood RPCs disagree on closing nonce, code, vacancy, simulation, or gas",
    );
  }
  const feeObservations = [...pendingSnapshots, ...closings];
  const maxPriorityFeePerGas = feeObservations.reduce(
    (maximum, { priorityFee }) =>
      priorityFee > maximum ? priorityFee : maximum,
    0n,
  );
  const baseFeePerGas = [
    ...pendingSnapshots.map(({ pendingBlock }) => pendingBlock.baseFeePerGas),
    ...closings.map(({ pendingBlock }) => pendingBlock.baseFeePerGas),
  ].reduce(
    (maximum, value) => (value > maximum ? value : maximum),
    0n,
  );
  const observedGasPrice = feeObservations.reduce(
    (maximum, { gasPrice }) => (gasPrice > maximum ? gasPrice : maximum),
    0n,
  );
  const doubledBaseFeeEnvelope = 2n * baseFeePerGas + maxPriorityFeePerGas;
  const maxFeePerGas =
    observedGasPrice > doubledBaseFeeEnvelope
      ? observedGasPrice
      : doubledBaseFeeEnvelope;
  if (
    maxFeePerGas <= 0n ||
    maxPriorityFeePerGas < 0n ||
    maxPriorityFeePerGas > maxFeePerGas ||
    maxFeePerGas > (1n << 128n) - 1n
  ) {
    fail("Robinhood fee envelope is invalid");
  }
  if (
    maxFeePerGas > ownerMaximumFeePerGasWei ||
    maxPriorityFeePerGas > ownerMaximumPriorityFeePerGasWei
  ) {
    fail("foundation fees exceed an owner-reviewed ceiling");
  }
  const reviewedMaximumGasCostWei = gasLimit * maxFeePerGas;
  if (reviewedMaximumGasCostWei > ownerMaximumGasCostWei) {
    fail("foundation maximum gas cost exceeds the owner-reviewed ceiling");
  }

  const completedAtMilliseconds = clock();
  if (
    !Number.isSafeInteger(completedAtMilliseconds) ||
    completedAtMilliseconds < startedAtMilliseconds ||
    completedAtMilliseconds - startedAtMilliseconds >
      ROBINHOOD_FOUNDATION_OWNER_ENVELOPE_MAX_OPERATION_MS
  ) {
    fail("foundation owner preflight exceeded its bounded operation window");
  }
  const createdAtTimestamp = Math.floor(completedAtMilliseconds / 1_000);
  if (Math.abs(createdAtTimestamp - Number(commonBlocks[0].timestamp)) > 120) {
    fail("local clock disagrees with the Robinhood common block timestamp");
  }
  const expiresAtTimestamp =
    createdAtTimestamp + ROBINHOOD_FOUNDATION_OWNER_ENVELOPE_TTL_SECONDS;

  const receipt = {
    schemaVersion: ROBINHOOD_FOUNDATION_OWNER_ENVELOPE_SCHEMA,
    state: "prepared-not-signed-not-broadcast",
    status: "READY_FOR_OWNER_WALLET_REVIEW_NO_SIGNING_NO_BROADCAST",
    issuedAt: new Date(createdAtTimestamp * 1_000).toISOString(),
    expiresAt: new Date(expiresAtTimestamp * 1_000).toISOString(),
    chainId: Number(CHAIN_ID),
    chainIdHex: CHAIN_ID_HEX,
    caip2: "eip155:4663",
    source: {
      ...exactSourceValue,
      productionBaseCommit: PRODUCTION_SOURCE_COMMIT,
      productionBaseTree: PRODUCTION_SOURCE_TREE,
      chainProfileSha256,
      predeploymentSha256,
      foundationSourceCommitment: FOUNDATION_SOURCE_COMMITMENT,
    },
    hostedVerify: exactHostedVerify,
    preparedArtifact: {
      path: "contracts/deployments/robinhood-custom-launch-v1.predeployment.json",
      sha256: predeploymentSha256,
      foundationSourceCommitment: FOUNDATION_SOURCE_COMMITMENT,
    },
    rpcProviders: providerBindings,
    observation: {
      operationStartedAtTimestamp: Math.floor(startedAtMilliseconds / 1_000),
      createdAtTimestamp,
      expiresAtTimestamp,
      ttlSeconds: ROBINHOOD_FOUNDATION_OWNER_ENVELOPE_TTL_SECONDS,
      minimumRemainingTtlSeconds:
        ROBINHOOD_FOUNDATION_OWNER_ENVELOPE_MINIMUM_REMAINING_TTL_SECONDS,
      elapsedMilliseconds: completedAtMilliseconds - startedAtMilliseconds,
      openingHeads: openings.map(({ head }, index) => ({
        providerId: providerBindings[index].providerId,
        blockNumber: head.number.toString(),
        blockHash: head.hash,
        blockTimestamp: head.timestamp.toString(),
      })),
      commonAnchor: {
        blockNumber: commonBlockNumber.toString(),
        blockHash: commonBlocks[0].hash,
        blockTimestamp: commonBlocks[0].timestamp.toString(),
      },
      openingPendingBlocks: pendingSnapshots.map(({ pendingBlock }, index) => ({
        providerId: providerBindings[index].providerId,
        parentHash: pendingBlock.parentHash,
        blockTimestamp: pendingBlock.timestamp.toString(),
        gasLimit: pendingBlock.gasLimit.toString(),
        baseFeePerGas: pendingBlock.baseFeePerGas.toString(),
      })),
      openingFeeObservations: pendingSnapshots.map(
        ({ gasPrice, priorityFee }, index) => ({
          providerId: providerBindings[index].providerId,
          gasPrice: gasPrice.toString(),
          maxPriorityFeePerGas: priorityFee.toString(),
        }),
      ),
      closingPendingBlocks: closings.map(({ pendingBlock }, index) => ({
        providerId: providerBindings[index].providerId,
        parentHash: pendingBlock.parentHash,
        blockTimestamp: pendingBlock.timestamp.toString(),
        gasLimit: pendingBlock.gasLimit.toString(),
        baseFeePerGas: pendingBlock.baseFeePerGas.toString(),
      })),
      closingFeeObservations: closings.map(
        ({ gasPrice, priorityFee }, index) => ({
          providerId: providerBindings[index].providerId,
          gasPrice: gasPrice.toString(),
          maxPriorityFeePerGas: priorityFee.toString(),
        }),
      ),
    },
    preparedAddresses: EXPECTED_PREPARED_ADDRESSES,
    transaction: {
      type: "0x2",
      chainId: CHAIN_ID_HEX,
      from: transaction.owner,
      to: transaction.to,
      valueWei: "0",
      input: transaction.data,
      inputBytes: OWNER_DATA_BYTES,
      inputKeccak256: OWNER_DATA_HASH,
      selector: OWNER_SELECTOR,
      nonce: nonce.toString(),
      nonceQuantity: quantity(nonce),
      gasLimit: gasLimit.toString(),
      gasQuantity: quantity(gasLimit),
      maxFeePerGas: maxFeePerGas.toString(),
      maxFeePerGasQuantity: quantity(maxFeePerGas),
      maxPriorityFeePerGas: maxPriorityFeePerGas.toString(),
      maxPriorityFeePerGasQuantity: quantity(maxPriorityFeePerGas),
    },
    simulation: {
      blockTag: "pending",
      returnDataKeccak256: EXPECTED_CALL_RETURN_HASH,
      returnedAddresses,
      allComponentsSucceeded: true,
      gasEstimates: pendingSnapshots.map(({ estimatedGas: value }) =>
        value.toString(),
      ),
      closingGasEstimates: closings.map(({ estimatedGas: value }) =>
        value.toString(),
      ),
      agreedGasEstimate: estimatedGas.toString(),
    },
    gasPolicy: {
      headroomBasisPoints:
        ROBINHOOD_FOUNDATION_OWNER_ENVELOPE_GAS_HEADROOM_BPS.toString(),
      fixedHeadroomGas:
        ROBINHOOD_FOUNDATION_OWNER_ENVELOPE_FIXED_GAS_HEADROOM.toString(),
      maximumGasLimit:
        ROBINHOOD_FOUNDATION_OWNER_ENVELOPE_MAX_GAS_LIMIT.toString(),
      reviewedGasLimit: gasLimit.toString(),
      observedPendingBaseFeePerGasWei: baseFeePerGas.toString(),
      observedGasPriceWei: observedGasPrice.toString(),
      observedMaxPriorityFeePerGasWei: maxPriorityFeePerGas.toString(),
      reviewedMaxFeePerGasWei: maxFeePerGas.toString(),
      maximumGasCostWei: reviewedMaximumGasCostWei.toString(),
      ownerMaximumFeePerGasWei: ownerMaximumFeePerGasWei.toString(),
      ownerMaximumPriorityFeePerGasWei:
        ownerMaximumPriorityFeePerGasWei.toString(),
      ownerMaximumGasCostWei: ownerMaximumGasCostWei.toString(),
      balanceReadPerformed: false,
      fundingVerified: false,
    },
    checks: {
      exactCleanSource: true,
      exactPreparedArtifact: true,
      exactFreshDeterministicCompilation: true,
      independentAuthenticatedRpcCount: 2,
      commonBlockAgreement: true,
      movingPendingHeadsTolerated: true,
      stateRelevantOpeningAgreement: true,
      stateRelevantClosingAgreement: true,
      dependencyRuntimePinsVerified: true,
      fixedAndPendingCodeAndNonceVacancyVerified: true,
      pendingSimulationAgreement: true,
      pendingGasAgreement: true,
      pendingNonceAgreement: true,
      noPendingOwnerTransaction: true,
      closingSimulationAgreement: true,
      closingGasAgreement: true,
      feeCeilingUsesOpeningAndClosingProviderMaxima: true,
      closingVacancyVerified: true,
      boundedTimeout: true,
      rpcResponseBudgetBytes: RPC_AGGREGATE_RESPONSE_LIMIT_BYTES,
      rpcResponseBytesConsumed: responseBudget.consumed,
      rpcMethodInventory: Object.keys(RPC_RESPONSE_LIMIT_BYTES),
    },
    ownerWalletReviewRequired: true,
    privateKeyAccepted: false,
    signingAllowed: false,
    broadcastAllowed: false,
  };
  const receiptDigest = ownerEnvelopeReceiptDigest(receipt);
  return { ...receipt, receiptDigest };
}
