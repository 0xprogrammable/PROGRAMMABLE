import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  concatHex,
  decodeEventLog,
  decodeFunctionResult,
  encodeDeployData,
  encodeFunctionData,
  getAddress,
  getContractAddress,
  getCreate2Address,
  hexToBytes,
  keccak256,
  parseAbi,
  stringToHex,
} from "viem";

import {
  ROBINHOOD_FIND_BATCH_SELECTOR,
  ROBINHOOD_L1_CONFIRMATIONS_SELECTOR,
  ROBINHOOD_NODE_INTERFACE,
  ROBINHOOD_SEQUENCER_INBOX,
  SEQUENCER_BATCH_DELIVERED_TOPIC,
  validateRobinhoodCredentialedProviderEndpoint,
} from "../contracts/scripts/robinhood-custom-launch-capture-v2.mjs";

export const MAIN_TOKEN_MIGRATION_TARGET_DEPLOYMENT_POLICY = Object.freeze({
  schema: "programmable-main-token-migration-target-deployment/v1",
  postdeploymentSchema:
    "programmable-main-token-migration-target-deployment-receipt/v1",
  targetDesignSchema: "programmable-main-token-migration-target-design/v1",
  chainId: 4_663n,
  chainIdHex: "0x1237",
  sourceChainId: 1n,
  sourceToken: "0x7987f03462200b3D8A072E02C89A8A41dCB124EE",
  tokenName: "Programmable",
  tokenSymbol: "V4",
  tokenDecimals: 18n,
  tokenTotalSupplyRaw: 1_000_000_000n * 10n ** 18n,
  releaseId: "v4-ethereum-to-robinhood-96h-2026-v1",
  snapshotRule:
    "first-canonical-block-at-or-after-timestamp|block.timestamp >= windowStart && block.timestamp < deadline|1:1 raw token units|same EVM recipient only",
  deterministicDeployer: "0x4e59b44847b379578588920cA78FbF26c0B4956C",
  migrationWindowSeconds: 96n * 60n * 60n,
  deterministicDeployerRuntimeCodeKeccak256:
    "0x2fa86add0aed31f33a762c9d88e807c475bd51d0f52bd0955754b2608f7e4989",
  saltDomain: "programmable.main-token-migration.target-deployment.v1",
  artifactPath:
    "contracts/out/ProgrammableV4TokenV1.sol/ProgrammableV4TokenV1.json",
  artifactCompilationTarget:
    "src/robinhood-main-token/ProgrammableV4TokenV1.sol",
  reviewedCreationBytecodeSha256:
    "sha256:73a7cda21221c5e49441f580397263c3a78dee67fd1e7143adcb735cf56cc74d",
  reviewedCreationBytecodeKeccak256:
    "0xf7b11bd106290e41723184977c9b632bc3343e2e1689726f82636fe604afe1bf",
  maximumArtifactBytes: 256 * 1_024,
  maximumInitCodeBytes: 128 * 1_024,
  maximumGasLimit: 8_000_000n,
  gasHeadroomBasisPoints: 2_000n,
  fixedGasHeadroom: 50_000n,
  maximumHeadGap: 4n,
  minimumDeploymentLeadSeconds: 900n,
  requestTimeoutMilliseconds: 12_000,
  operationTimeoutMilliseconds: 45_000,
  envelopeTtlSeconds: 300,
});

const EMPTY_CODE_HASH =
  "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470";
const EMPTY_ADDRESS = "0x0000000000000000000000000000000000000000";
const UINT64_MAX = (1n << 64n) - 1n;
const UINT128_MAX = (1n << 128n) - 1n;
const BASIS_POINTS = 10_000n;
const HASH32 = /^0x[0-9a-f]{64}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const QUANTITY = /^0x(?:0|[1-9a-f][0-9a-f]*)$/u;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/u;

const tokenReadAbi = parseAbi([
  "function MIGRATION_DISTRIBUTOR() view returns (address)",
  "function TARGET_CHAIN_ID() view returns (uint256)",
  "function TOTAL_SUPPLY() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function totalSupply() view returns (uint256)",
]);

const distributorReadAbi = parseAbi([
  "function TOKEN() view returns (address)",
  "function RELEASE_ID_HASH() view returns (bytes32)",
  "function SOURCE_CHAIN_ID() view returns (uint256)",
  "function SOURCE_TOKEN() view returns (address)",
  "function SOURCE_DEADLINE_TIMESTAMP_EXCLUSIVE() view returns (uint256)",
  "function SNAPSHOT_RULE_HASH() view returns (bytes32)",
  "function SEAL_AUTHORITY() view returns (address)",
  "function REMAINDER_RECIPIENT() view returns (address)",
  "function TARGET_CHAIN_ID() view returns (uint256)",
  "function TOKEN_TOTAL_SUPPLY_RAW() view returns (uint256)",
  "function isSealed() view returns (bool)",
  "function merkleRoot() view returns (bytes32)",
  "function sourceSnapshotSha256() view returns (bytes32)",
  "function migrationTotalRaw() view returns (uint256)",
  "function totalDistributedRaw() view returns (uint256)",
]);

const EXPECTED_CONSTRUCTOR_INPUTS = Object.freeze([
  Object.freeze({ name: "releaseIdHash", type: "bytes32" }),
  Object.freeze({ name: "sourceChainId", type: "uint256" }),
  Object.freeze({ name: "sourceToken", type: "address" }),
  Object.freeze({
    name: "sourceDeadlineTimestampExclusive",
    type: "uint256",
  }),
  Object.freeze({ name: "snapshotRuleHash", type: "bytes32" }),
  Object.freeze({ name: "sealAuthority", type: "address" }),
  Object.freeze({ name: "remainderRecipient", type: "address" }),
]);

const FROZEN_SOURCE_PATHS = Object.freeze([
  "contracts/src/robinhood-main-token/ProgrammableV4TokenV1.sol",
  "contracts/src/robinhood-main-token/ProgrammableV4MigrationDistributorV1.sol",
  "scripts/main-token-migration-snapshot-core.mjs",
  "scripts/main-token-migration-distribution-core.mjs",
  "scripts/main-token-migration-distribution.mjs",
]);

const FROZEN_ALLOCATION_TYPE =
  "ProgrammableV4MigrationAllocationV1(uint256 targetChainId,bytes32 releaseIdHash,uint256 sourceChainId,address sourceToken,uint256 sourceDeadlineTimestampExclusive,bytes32 snapshotRuleHash,bytes32 sourceSnapshotSha256,uint256 index,address account,uint256 amountRaw)";

const sequencerBatchDeliveredAbi = Object.freeze([
  Object.freeze({
    type: "event",
    name: "SequencerBatchDelivered",
    inputs: Object.freeze([
      Object.freeze({
        indexed: true,
        name: "batchSequenceNumber",
        type: "uint256",
      }),
      Object.freeze({ indexed: true, name: "beforeAcc", type: "bytes32" }),
      Object.freeze({ indexed: true, name: "afterAcc", type: "bytes32" }),
      Object.freeze({ indexed: false, name: "delayedAcc", type: "bytes32" }),
      Object.freeze({
        indexed: false,
        name: "afterDelayedMessagesRead",
        type: "uint256",
      }),
      Object.freeze({
        indexed: false,
        name: "timeBounds",
        type: "tuple",
        components: Object.freeze([
          Object.freeze({ name: "delayBlocks", type: "uint64" }),
          Object.freeze({ name: "futureBlocks", type: "uint64" }),
          Object.freeze({ name: "delaySeconds", type: "uint64" }),
          Object.freeze({ name: "futureSeconds", type: "uint64" }),
        ]),
      }),
      Object.freeze({ indexed: false, name: "dataLocation", type: "uint8" }),
    ]),
  }),
]);

function fail(message) {
  throw new Error(`Migration target deployment rejected: ${message}`);
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function canonicalize(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("canonical JSON contains a non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalize(entry)).join(",")}]`;
  }
  if (!plainObject(value)) fail("canonical JSON contains a non-JSON value");
  return `{${Object.keys(value)
    .sort()
    .map((key) => {
      const entry = value[key];
      if (
        entry === undefined ||
        typeof entry === "bigint" ||
        typeof entry === "function"
      ) {
        fail("canonical JSON contains an unsupported value");
      }
      return `${JSON.stringify(key)}:${canonicalize(entry)}`;
    })
    .join(",")}}`;
}

export function canonicalTargetDeploymentJson(value) {
  return canonicalize(value);
}

export function sha256CanonicalTargetDeploymentJson(value) {
  return `sha256:${createHash("sha256")
    .update(canonicalTargetDeploymentJson(value), "utf8")
    .digest("hex")}`;
}

function sha256Bytes(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function exactAddress(value, label, { nonzero = true } = {}) {
  let address;
  try {
    address = getAddress(value);
  } catch {
    fail(`${label} is not an address`);
  }
  if (nonzero && address.toLowerCase() === EMPTY_ADDRESS) {
    fail(`${label} is zero`);
  }
  return address;
}

function sameAddress(left, right) {
  return (
    exactAddress(left, "left address").toLowerCase() ===
    exactAddress(right, "right address").toLowerCase()
  );
}

function exactHash(value, label) {
  const hash = String(value ?? "").toLowerCase();
  if (!HASH32.test(hash) || hash === `0x${"00".repeat(32)}`) {
    fail(`${label} is not a nonzero bytes32`);
  }
  return hash;
}

function exactCode(value, label, { empty = false } = {}) {
  const code = String(value ?? "").toLowerCase();
  if (!/^0x(?:[0-9a-f]{2})*$/u.test(code)) fail(`${label} is not bytecode`);
  if (!empty && code === "0x") fail(`${label} is empty`);
  return code;
}

function decimal(value, label, { positive = false } = {}) {
  const canonical = String(value ?? "");
  if (!DECIMAL.test(canonical) || canonical.length > 78) {
    fail(`${label} is not a canonical uint256 decimal`);
  }
  const parsed = BigInt(canonical);
  if ((positive && parsed === 0n) || parsed > (1n << 256n) - 1n) {
    fail(`${label} is outside its uint256 range`);
  }
  return parsed;
}

function quantity(value, label) {
  const canonical = String(value ?? "").toLowerCase();
  if (!QUANTITY.test(canonical)) fail(`${label} is not a canonical quantity`);
  return BigInt(canonical);
}

function toQuantity(value) {
  if (typeof value !== "bigint" || value < 0n) fail("quantity input is invalid");
  return `0x${value.toString(16)}`;
}

function exactBlock(value, label) {
  if (!plainObject(value)) fail(`${label} is missing`);
  const number = quantity(value.number, `${label} number`);
  const timestamp = quantity(value.timestamp, `${label} timestamp`);
  const gasLimit = quantity(value.gasLimit, `${label} gas limit`);
  const hash = exactHash(value.hash, `${label} hash`);
  if (gasLimit === 0n) fail(`${label} gas limit is zero`);
  return { number, timestamp, gasLimit, hash };
}

function exactPendingBlock(value, label) {
  if (!plainObject(value)) fail(`${label} is missing`);
  const parentHash = exactHash(value.parentHash, `${label} parent hash`);
  const timestamp = quantity(value.timestamp, `${label} timestamp`);
  const gasLimit = quantity(value.gasLimit, `${label} gas limit`);
  const baseFeePerGas = quantity(
    value.baseFeePerGas,
    `${label} base fee per gas`,
  );
  if (gasLimit === 0n || baseFeePerGas === 0n) {
    fail(`${label} has no usable gas limit or base fee`);
  }
  return { parentHash, timestamp, gasLimit, baseFeePerGas };
}

function exactHexRequest(value, label) {
  return exactCode(value, label, { empty: true });
}

function exactBoolean(value, expected, label) {
  if (value !== expected) fail(`${label} must be ${expected}`);
}

function nullableRuntimeHash(value, label) {
  if (value === null) return null;
  return exactHash(value, label);
}

export function normalizeMainTokenMigrationTargetDesign(value, ownerFields = null) {
  if (!plainObject(value)) fail("target design is not an object");
  const disabled = value.enabled === false;
  if (
    value.schema !==
      MAIN_TOKEN_MIGRATION_TARGET_DEPLOYMENT_POLICY.targetDesignSchema ||
    (!disabled && value.enabled !== true) ||
    typeof value.state !== "string" ||
    value.state.length < 1 ||
    typeof value.releaseId !== "string" ||
    value.releaseId.length < 1 ||
    value.releaseId.length > 128 ||
    value.releaseId !== MAIN_TOKEN_MIGRATION_TARGET_DEPLOYMENT_POLICY.releaseId
  ) {
    fail("target design is not a frozen migration design");
  }
  const releaseIdHash = exactHash(value.releaseIdHash, "release ID hash");
  if (releaseIdHash !== keccak256(stringToHex(value.releaseId))) {
    fail("release ID hash does not bind the exact release ID bytes");
  }
  if (!plainObject(value.source) || !plainObject(value.target)) {
    fail("target design source or target is missing");
  }
  const sourceChainId = decimal(value.source.chainId, "source chain ID", {
    positive: true,
  });
  const sourceToken = exactAddress(value.source.tokenAddress, "source token");
  if (disabled && !plainObject(ownerFields)) {
    fail("disabled design requires explicit protected owner fields");
  }
  const sourceDeadlineTimestampExclusive = decimal(
    disabled
      ? ownerFields.sourceDeadlineTimestampExclusive
      : value.source.deadlineTimestampExclusive,
    "source deadline",
    { positive: true },
  );
  if (
    sourceDeadlineTimestampExclusive <=
    MAIN_TOKEN_MIGRATION_TARGET_DEPLOYMENT_POLICY.migrationWindowSeconds
  ) {
    fail("source deadline cannot encode a true 96-hour window");
  }
  const sourceWindowStartTimestampInclusive =
    sourceDeadlineTimestampExclusive -
    MAIN_TOKEN_MIGRATION_TARGET_DEPLOYMENT_POLICY.migrationWindowSeconds;
  const sourceTotalSupply = decimal(
    value.source.tokenTotalSupplyRaw,
    "source total supply",
    { positive: true },
  );
  if (
    sourceChainId !== MAIN_TOKEN_MIGRATION_TARGET_DEPLOYMENT_POLICY.sourceChainId ||
    !sameAddress(
      sourceToken,
      MAIN_TOKEN_MIGRATION_TARGET_DEPLOYMENT_POLICY.sourceToken,
    ) ||
    sourceTotalSupply !==
      MAIN_TOKEN_MIGRATION_TARGET_DEPLOYMENT_POLICY.tokenTotalSupplyRaw ||
    value.source.snapshotRule !==
      MAIN_TOKEN_MIGRATION_TARGET_DEPLOYMENT_POLICY.snapshotRule ||
    decimal(value.source.tokenDecimals, "source decimals") !== 18n
  ) {
    fail("source migration domain differs from the frozen design");
  }
  const snapshotRuleHash = exactHash(
    value.source.snapshotRuleHash,
    "snapshot rule hash",
  );
  if (snapshotRuleHash !== keccak256(stringToHex(value.source.snapshotRule))) {
    fail("snapshot rule hash does not bind the exact rule bytes");
  }

  const targetChainId = decimal(value.target.chainId, "target chain ID", {
    positive: true,
  });
  const targetTotalSupply = decimal(
    value.target.tokenTotalSupplyRaw,
    "target total supply",
    { positive: true },
  );
  if (
    targetChainId !== MAIN_TOKEN_MIGRATION_TARGET_DEPLOYMENT_POLICY.chainId ||
    value.target.tokenName !==
      MAIN_TOKEN_MIGRATION_TARGET_DEPLOYMENT_POLICY.tokenName ||
    value.target.tokenSymbol !==
      MAIN_TOKEN_MIGRATION_TARGET_DEPLOYMENT_POLICY.tokenSymbol ||
    decimal(value.target.tokenDecimals, "target decimals") !==
      MAIN_TOKEN_MIGRATION_TARGET_DEPLOYMENT_POLICY.tokenDecimals ||
    targetTotalSupply !==
      MAIN_TOKEN_MIGRATION_TARGET_DEPLOYMENT_POLICY.tokenTotalSupplyRaw
  ) {
    fail("target token shape differs from the frozen one-billion V4 design");
  }
  const tokenAddress =
    value.target.tokenAddress === null
      ? null
      : exactAddress(value.target.tokenAddress, "target token");
  const distributorAddress =
    value.target.distributorAddress === null
      ? null
      : exactAddress(value.target.distributorAddress, "target distributor");
  if (!plainObject(value.authorities)) fail("target authorities are missing");
  const sealAuthority = exactAddress(
    disabled ? ownerFields.sealAuthority : value.authorities.sealAuthority,
    "seal authority",
  );
  const remainderRecipient = exactAddress(
    disabled
      ? ownerFields.remainderRecipient
      : value.authorities.remainderRecipient,
    "remainder recipient",
  );
  if ((tokenAddress && sameAddress(sealAuthority, tokenAddress)) ||
    (distributorAddress && sameAddress(sealAuthority, distributorAddress)) ||
    (tokenAddress && sameAddress(remainderRecipient, tokenAddress)) ||
    (distributorAddress && sameAddress(remainderRecipient, distributorAddress))) {
    fail("target authority is circular with the token or distributor");
  }
  if (
    value.authorities.sealAuthorityPower !==
      "one call at or after the frozen source deadline to bind root, snapshot digest, and migration total" ||
    value.authorities.postSealAdministrativePower !== "none"
  ) {
    fail("target authority powers drifted");
  }
  const distribution = value.distribution;
  const expectedAllocationTypehash = keccak256(stringToHex(FROZEN_ALLOCATION_TYPE));
  if (
    !plainObject(distribution) ||
    distribution.allocationType !== FROZEN_ALLOCATION_TYPE ||
    String(distribution.allocationTypehash).toLowerCase() !==
      expectedAllocationTypehash ||
    distribution.leafHashing !==
      "keccak256(bytes.concat(keccak256(abi.encode(allocation fields))))" ||
    distribution.pairHashing !== "keccak256(sort(bytes32 left, bytes32 right))" ||
    distribution.recipientRule !==
      "exact same EVM address committed in the leaf; caller cannot redirect" ||
    distribution.singleDistribution !== "permissionless" ||
    distribution.batchDistribution !==
      "permissionless, atomic, maximum 64 entries" ||
    distribution.duplicateProtection !==
      "uint256 bitmap indexed by allocation index" ||
    distribution.vesting !== "none" ||
    distribution.rescueOrSweep !== "none"
  ) {
    fail("distribution design drifted");
  }
  const guards = value.activationGuards;
  if (!plainObject(guards)) fail("target activation guards are missing");
  exactBoolean(guards.targetDeploymentBeforeSourceWindowRequired, true, "pre-window deployment guard");
  exactBoolean(guards.fullTargetSupplyLockedInDistributorBeforeSourceWindowRequired, true, "full-supply guard");
  exactBoolean(guards.sealBeforeSourceDeadlineAllowed, false, "early seal guard");
  exactBoolean(guards.sealIsOneTime, true, "one-time seal guard");
  exactBoolean(guards.distributionBeforeSealAllowed, false, "pre-seal distribution guard");
  exactBoolean(guards.deploymentEnabled, !disabled, "deployment gate");
  exactBoolean(guards.sealEnabled, false, "seal gate");
  exactBoolean(guards.distributionEnabled, false, "distribution gate");
  const expectedRemainingOwnerFields = disabled
    ? [
        "source.deadlineTimestampExclusive",
        "authorities.sealAuthority",
        "authorities.remainderRecipient",
      ]
    : [];
  if (!Array.isArray(value.remainingOwnerFields) ||
    JSON.stringify(value.remainingOwnerFields) !==
      JSON.stringify(expectedRemainingOwnerFields)) {
    fail("target design owner-field inventory drifted");
  }
  if (disabled) {
    const deployment = value.deployment;
    if (
      value.state !==
        "design-frozen-deployment-disabled-pending-owner-fields-and-planned-source-window" ||
      value.source.deadlineTimestampExclusive !== null ||
      value.target.tokenAddress !== null ||
      value.target.distributorAddress !== null ||
      value.target.tokenRuntimeCodeKeccak256 !== null ||
      value.target.distributorRuntimeCodeKeccak256 !== null ||
      value.authorities.sealAuthority !== null ||
      value.authorities.remainderRecipient !== null ||
      !plainObject(deployment) ||
      Object.values(deployment).some((entry) => entry !== null && entry !== false)
    ) {
      fail("disabled target design contains mutable deployment evidence");
    }
  } else if (
    value.state !== "deployed-finalized-source-window-pending" ||
    tokenAddress === null ||
    distributorAddress === null
  ) {
    fail("active target design is not a finalized deployed design");
  }
  if (
    value.build?.openzeppelinContractsCommit !==
      "21c8312b022f495ebe3621d5daeed20552b43ff9" ||
    !Array.isArray(value.build?.sources) ||
    JSON.stringify(value.build.sources.map((entry) => entry?.path)) !==
      JSON.stringify(FROZEN_SOURCE_PATHS) ||
    value.build.sources.some(
      (entry) => !SHA256.test(String(entry?.sha256 ?? "")),
    )
  ) {
    fail("target build source inventory drifted");
  }
  return Object.freeze({
    raw: structuredClone(value),
    frozenDesignSha256: sha256CanonicalTargetDeploymentJson(value),
    disabled,
    releaseId: value.releaseId,
    releaseIdHash,
    sourceChainId,
    sourceToken,
    sourceDeadlineTimestampExclusive,
    sourceWindowStartTimestampInclusive,
    snapshotRule: value.source.snapshotRule,
    snapshotRuleHash,
    targetChainId,
    targetTotalSupply,
    tokenAddress,
    distributorAddress,
    tokenRuntimeCodeKeccak256: nullableRuntimeHash(
      value.target.tokenRuntimeCodeKeccak256,
      "target token runtime hash",
    ),
    distributorRuntimeCodeKeccak256: nullableRuntimeHash(
      value.target.distributorRuntimeCodeKeccak256,
      "target distributor runtime hash",
    ),
    sealAuthority,
    remainderRecipient,
  });
}

function exactTokenArtifact(artifact, design) {
  if (!plainObject(artifact)) fail("Foundry token artifact is missing");
  const serializedBytes = Buffer.byteLength(JSON.stringify(artifact), "utf8");
  if (
    serializedBytes < 1 ||
    serializedBytes >
      MAIN_TOKEN_MIGRATION_TARGET_DEPLOYMENT_POLICY.maximumArtifactBytes
  ) {
    fail("Foundry token artifact is outside its size bound");
  }
  const bytecode = exactCode(artifact.bytecode?.object, "token creation bytecode");
  const creationBytecodeSha256 = sha256Bytes(
    Buffer.from(hexToBytes(bytecode)),
  );
  const creationBytecodeKeccak256 = keccak256(bytecode);
  if (
    hexToBytes(bytecode).length >
      MAIN_TOKEN_MIGRATION_TARGET_DEPLOYMENT_POLICY.maximumInitCodeBytes ||
    Object.keys(artifact.bytecode?.linkReferences ?? {}).length !== 0 ||
    creationBytecodeSha256 !==
      MAIN_TOKEN_MIGRATION_TARGET_DEPLOYMENT_POLICY.reviewedCreationBytecodeSha256 ||
    creationBytecodeKeccak256 !==
      MAIN_TOKEN_MIGRATION_TARGET_DEPLOYMENT_POLICY.reviewedCreationBytecodeKeccak256
  ) {
    fail(
      "token creation bytecode is too large, unlinked, or differs from the frozen reviewed build",
    );
  }
  const constructor = artifact.abi?.find((entry) => entry?.type === "constructor");
  const inputs = constructor?.inputs?.map(({ name, type }) => ({ name, type }));
  if (
    constructor?.stateMutability !== "nonpayable" ||
    JSON.stringify(inputs) !== JSON.stringify(EXPECTED_CONSTRUCTOR_INPUTS)
  ) {
    fail("Foundry token constructor ABI drifted");
  }
  const metadata = artifact.metadata;
  const settings = metadata?.settings;
  if (
    metadata?.compiler?.version !== "0.8.26+commit.8a97fa7a" ||
    settings?.optimizer?.enabled !== true ||
    settings?.optimizer?.runs !== 1_000 ||
    settings?.evmVersion !== "cancun" ||
    settings?.metadata?.bytecodeHash !== "none" ||
    settings?.metadata?.appendCBOR !== false ||
    settings?.compilationTarget?.[
      MAIN_TOKEN_MIGRATION_TARGET_DEPLOYMENT_POLICY.artifactCompilationTarget
    ] !== "ProgrammableV4TokenV1" ||
    Object.keys(settings?.libraries ?? {}).length !== 0 ||
    design.raw.build?.solcVersion !== "0.8.26" ||
    design.raw.build?.evmVersion !== "cancun" ||
    design.raw.build?.optimizerEnabled !== true ||
    design.raw.build?.optimizerRuns !== "1000" ||
    design.raw.build?.bytecodeHash !== "none" ||
    design.raw.build?.cborMetadata !== false
  ) {
    fail("Foundry artifact settings differ from the enabled target design");
  }
  return { abi: artifact.abi, bytecode };
}

export function mainTokenMigrationTargetSalt(design) {
  return keccak256(
    stringToHex(
      [
        MAIN_TOKEN_MIGRATION_TARGET_DEPLOYMENT_POLICY.saltDomain,
        design.releaseIdHash,
        design.sourceDeadlineTimestampExclusive.toString(),
        design.snapshotRuleHash,
      ].join("\0"),
    ),
  );
}

export function prepareMainTokenMigrationTargetDeployment({
  targetDesign,
  tokenArtifact,
  owner,
  ownerFields = null,
}) {
  const design = normalizeMainTokenMigrationTargetDesign(
    targetDesign,
    ownerFields,
  );
  const artifact = exactTokenArtifact(tokenArtifact, design);
  const exactOwner = exactAddress(owner, "deployment owner");
  if (!sameAddress(exactOwner, design.sealAuthority)) {
    fail("deployment owner must be the immutable seal authority");
  }
  const constructorArguments = [
    design.releaseIdHash,
    design.sourceChainId,
    design.sourceToken,
    design.sourceDeadlineTimestampExclusive,
    design.snapshotRuleHash,
    design.sealAuthority,
    design.remainderRecipient,
  ];
  const initCode = encodeDeployData({
    abi: artifact.abi,
    bytecode: artifact.bytecode,
    args: constructorArguments,
  });
  if (
    hexToBytes(initCode).length >
    MAIN_TOKEN_MIGRATION_TARGET_DEPLOYMENT_POLICY.maximumInitCodeBytes
  ) {
    fail("constructor-bound token init code exceeds its size bound");
  }
  const salt = mainTokenMigrationTargetSalt(design);
  const initCodeKeccak256 = keccak256(initCode);
  const tokenAddress = getCreate2Address({
    from: MAIN_TOKEN_MIGRATION_TARGET_DEPLOYMENT_POLICY.deterministicDeployer,
    salt,
    bytecodeHash: initCodeKeccak256,
  });
  const distributorAddress = getContractAddress({
    from: tokenAddress,
    nonce: 1n,
  });
  if (
    (design.tokenAddress && !sameAddress(tokenAddress, design.tokenAddress)) ||
    (design.distributorAddress &&
      !sameAddress(distributorAddress, design.distributorAddress))
  ) {
    fail("enabled target design does not bind the deterministic addresses");
  }
  const data = concatHex([salt, initCode]);
  const subject = {
    schema: MAIN_TOKEN_MIGRATION_TARGET_DEPLOYMENT_POLICY.schema,
    state: "prepared-not-signed-not-broadcast",
    chainId: MAIN_TOKEN_MIGRATION_TARGET_DEPLOYMENT_POLICY.chainId.toString(),
    chainIdHex: MAIN_TOKEN_MIGRATION_TARGET_DEPLOYMENT_POLICY.chainIdHex,
    caip2: "eip155:4663",
    frozenTargetDesignSha256: design.frozenDesignSha256,
    releaseId: design.releaseId,
    releaseIdHash: design.releaseIdHash,
    snapshotRuleHash: design.snapshotRuleHash,
    sourceDeadlineTimestampExclusive:
      design.sourceDeadlineTimestampExclusive.toString(),
    sourceWindowStartTimestampInclusive:
      design.sourceWindowStartTimestampInclusive.toString(),
    owner: exactOwner,
    to: MAIN_TOKEN_MIGRATION_TARGET_DEPLOYMENT_POLICY.deterministicDeployer,
    value: "0x0",
    salt,
    creationArtifact: {
      path: MAIN_TOKEN_MIGRATION_TARGET_DEPLOYMENT_POLICY.artifactPath,
      creationBytecodeSha256: sha256Bytes(
        Buffer.from(hexToBytes(artifact.bytecode)),
      ),
      creationBytecodeKeccak256:
        MAIN_TOKEN_MIGRATION_TARGET_DEPLOYMENT_POLICY.reviewedCreationBytecodeKeccak256,
      initCodeBytes: hexToBytes(initCode).length.toString(),
      initCodeKeccak256,
    },
    predicted: {
      token: tokenAddress,
      distributor: distributorAddress,
      distributorDerivation: "CREATE from token constructor nonce 1",
    },
    immutableOwnerBinding: {
      sourceDeadlineTimestampExclusive:
        design.sourceDeadlineTimestampExclusive.toString(),
      sealAuthority: design.sealAuthority,
      remainderRecipient: design.remainderRecipient,
    },
    transactionData: data,
    transactionDataBytes: hexToBytes(data).length.toString(),
    transactionDataKeccak256: keccak256(data),
    automaticSigning: false,
    automaticBroadcast: false,
  };
  return Object.freeze({
    ...subject,
    preparedDigest: sha256CanonicalTargetDeploymentJson(subject),
  });
}

export async function loadMainTokenMigrationTargetDeployment({
  repositoryRoot,
  targetDesignPath,
  owner,
  ownerFields,
}) {
  const artifactPath = resolve(
    repositoryRoot,
    MAIN_TOKEN_MIGRATION_TARGET_DEPLOYMENT_POLICY.artifactPath,
  );
  const [targetDesignBytes, artifactBytes] = await Promise.all([
    readFile(targetDesignPath, "utf8"),
    readFile(artifactPath, "utf8"),
  ]);
  let targetDesign;
  let tokenArtifact;
  try {
    targetDesign = JSON.parse(targetDesignBytes);
    tokenArtifact = JSON.parse(artifactBytes);
  } catch {
    fail("target design or Foundry artifact is not valid JSON");
  }
  normalizeMainTokenMigrationTargetDesign(targetDesign, ownerFields);
  const sourceBytes = await Promise.all(
    targetDesign.build.sources.map((entry) =>
      readFile(resolve(repositoryRoot, entry.path)),
    ),
  );
  targetDesign.build.sources.forEach((entry, index) => {
    if (sha256Bytes(sourceBytes[index]) !== entry.sha256) {
      fail(`frozen source digest drifted for ${entry.path}`);
    }
  });
  return prepareMainTokenMigrationTargetDeployment({
    targetDesign,
    tokenArtifact,
    owner,
    ownerFields,
  });
}

function endpointCommitment(providerId, rpcUrl) {
  return sha256Bytes(
    Buffer.from(
      `programmable.main-token-migration.rpc-endpoint.v1\0${providerId}\0${rpcUrl}`,
      "utf8",
    ),
  );
}

export function normalizeMainTokenMigrationRpcProviders(rpcUrls) {
  if (!Array.isArray(rpcUrls) || rpcUrls.length !== 2) {
    fail("exactly two authenticated Robinhood RPCs are required");
  }
  const pins = [
    {
      providerId: "quicknode",
      role: "primary",
      pattern:
        /^https:\/\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.robinhood-mainnet\.quiknode\.pro\/[A-Za-z0-9_-]{16,256}\/$/u,
    },
    {
      providerId: "alchemy",
      role: "secondary",
      pattern:
        /^https:\/\/robinhood-mainnet\.g\.alchemy\.com\/v2\/[A-Za-z0-9_-]{16,256}$/u,
    },
  ];
  const providers = pins.map((pin, index) => {
    const rpcUrl = rpcUrls[index];
    if (
      typeof rpcUrl !== "string" ||
      rpcUrl !== rpcUrl.trim() ||
      rpcUrl.length > 1_024 ||
      !pin.pattern.test(rpcUrl) ||
      /(?:demo|example|placeholder|docs[-_]?demo)/iu.test(rpcUrl)
    ) {
      fail(`${pin.providerId} RPC is not a credential-bearing production endpoint`);
    }
    let url;
    try {
      url = new URL(rpcUrl);
    } catch {
      fail(`${pin.providerId} RPC URL is invalid`);
    }
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.hash ||
      url.search ||
      (url.port !== "" && url.port !== "443") ||
      url.hostname !== url.hostname.toLowerCase()
    ) {
      fail(`${pin.providerId} RPC violates its network pin`);
    }
    return Object.freeze({
      providerId: pin.providerId,
      role: pin.role,
      trustDomain: pin.providerId === "alchemy" ? "alchemy.com" : "quicknode.com",
      authentication: "provider-credential",
      endpointCommitment: endpointCommitment(pin.providerId, rpcUrl),
      rpcUrl,
    });
  });
  if (providers[0].endpointCommitment === providers[1].endpointCommitment) {
    fail("RPC endpoints are not independent");
  }
  return providers;
}

const RPC_RESPONSE_LIMIT = 2 * 1_024 * 1_024;

export async function mainTokenMigrationTargetRpc({
  providerId,
  rpcUrl,
  method,
  params = [],
  fetchImpl = fetch,
  signal,
}) {
  let response;
  try {
    response = await fetchImpl(rpcUrl, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      redirect: "error",
      signal: signal
        ? AbortSignal.any([
            signal,
            AbortSignal.timeout(
              MAIN_TOKEN_MIGRATION_TARGET_DEPLOYMENT_POLICY.requestTimeoutMilliseconds,
            ),
          ])
        : AbortSignal.timeout(
            MAIN_TOKEN_MIGRATION_TARGET_DEPLOYMENT_POLICY.requestTimeoutMilliseconds,
          ),
    });
  } catch {
    fail(`${providerId} RPC ${method} request failed`);
  }
  const declared = response.headers?.get?.("content-length");
  if (
    response.status !== 200 ||
    !/^application\/json(?:;.*)?$/iu.test(
      response.headers?.get?.("content-type") ?? "",
    ) ||
    (declared !== null &&
      (!DECIMAL.test(declared) || BigInt(declared) > BigInt(RPC_RESPONSE_LIMIT)))
  ) {
    fail(`${providerId} RPC ${method} returned an invalid envelope`);
  }
  if (typeof response.body?.getReader !== "function") {
    fail(`${providerId} RPC ${method} response is not streamable`);
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
        total + value.byteLength > RPC_RESPONSE_LIMIT
      ) {
        await reader.cancel().catch(() => {});
        fail(`${providerId} RPC ${method} response exceeds its bound`);
      }
      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  if (total === 0) {
    fail(`${providerId} RPC ${method} response is empty`);
  }
  const bytes = Buffer.concat(
    chunks.map((chunk) => Buffer.from(chunk)),
    total,
  );
  let payload;
  try {
    payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    fail(`${providerId} RPC ${method} returned invalid JSON`);
  }
  if (
    !plainObject(payload) ||
    payload.jsonrpc !== "2.0" ||
    payload.id !== 1 ||
    Object.hasOwn(payload, "error") ||
    !Object.hasOwn(payload, "result")
  ) {
    fail(`${providerId} RPC ${method} failed`);
  }
  return payload.result;
}

async function rpc(provider, method, params, rpcClient, signal) {
  return rpcClient({
    providerId: provider.providerId,
    rpcUrl: provider.rpcUrl,
    method,
    params,
    signal,
  });
}

function publicProviderBindings(providers) {
  return providers.map(
    ({ providerId, role, trustDomain, authentication, endpointCommitment }) => ({
      providerId,
      role,
      trustDomain,
      authentication,
      endpointCommitment,
    }),
  );
}

function reviewedGasLimit(estimatedGas) {
  if (estimatedGas <= 0n || estimatedGas > UINT64_MAX) {
    fail("deployment gas estimate is invalid");
  }
  const percentage =
    (estimatedGas *
      (BASIS_POINTS +
        MAIN_TOKEN_MIGRATION_TARGET_DEPLOYMENT_POLICY.gasHeadroomBasisPoints) +
      BASIS_POINTS -
      1n) /
    BASIS_POINTS;
  const gasLimit =
    percentage + MAIN_TOKEN_MIGRATION_TARGET_DEPLOYMENT_POLICY.fixedGasHeadroom;
  if (
    gasLimit > MAIN_TOKEN_MIGRATION_TARGET_DEPLOYMENT_POLICY.maximumGasLimit
  ) {
    fail("deployment gas limit exceeds the reviewed cap");
  }
  return gasLimit;
}

function compareBlocks(left, right, label) {
  if (
    left.number !== right.number ||
    left.hash !== right.hash ||
    left.timestamp !== right.timestamp ||
    left.gasLimit !== right.gasLimit
  ) {
    fail(`RPCs disagree on ${label}`);
  }
}

function pendingTransaction(plan, owner) {
  return {
    from: owner,
    to: plan.to,
    value: "0x0",
    data: plan.transactionData,
  };
}

function assertVacancySnapshot(snapshot, plan, label) {
  const deployerCode = exactCode(snapshot.deployerCode, `${label} deployer code`);
  if (
    keccak256(deployerCode) !==
    MAIN_TOKEN_MIGRATION_TARGET_DEPLOYMENT_POLICY.deterministicDeployerRuntimeCodeKeccak256
  ) {
    fail(`${label} deterministic deployer runtime hash drifted`);
  }
  if (
    exactCode(snapshot.tokenCode, `${label} token code`, { empty: true }) !== "0x" ||
    exactCode(snapshot.distributorCode, `${label} distributor code`, {
      empty: true,
    }) !== "0x" ||
    exactCode(snapshot.ownerCode, `${label} owner code`, { empty: true }) !== "0x" ||
    quantity(snapshot.tokenNonce, `${label} token nonce`) !== 0n ||
    quantity(snapshot.distributorNonce, `${label} distributor nonce`) !== 0n
  ) {
    fail(`${label} target vacancy or owner EOA check failed`);
  }
}

function snapshotComparable(snapshot) {
  return {
    deployerCode: snapshot.deployerCode.toLowerCase(),
    tokenCode: snapshot.tokenCode.toLowerCase(),
    distributorCode: snapshot.distributorCode.toLowerCase(),
    ownerCode: snapshot.ownerCode.toLowerCase(),
    tokenNonce: snapshot.tokenNonce.toLowerCase(),
    distributorNonce: snapshot.distributorNonce.toLowerCase(),
  };
}

async function vacancyAt(provider, plan, owner, blockTag, rpcClient, signal) {
  const [deployerCode, tokenCode, distributorCode, ownerCode, tokenNonce, distributorNonce] =
    await Promise.all([
      rpc(provider, "eth_getCode", [plan.to, blockTag], rpcClient, signal),
      rpc(
        provider,
        "eth_getCode",
        [plan.predicted.token, blockTag],
        rpcClient,
        signal,
      ),
      rpc(
        provider,
        "eth_getCode",
        [plan.predicted.distributor, blockTag],
        rpcClient,
        signal,
      ),
      rpc(provider, "eth_getCode", [owner, blockTag], rpcClient, signal),
      rpc(
        provider,
        "eth_getTransactionCount",
        [plan.predicted.token, blockTag],
        rpcClient,
        signal,
      ),
      rpc(
        provider,
        "eth_getTransactionCount",
        [plan.predicted.distributor, blockTag],
        rpcClient,
        signal,
      ),
    ]);
  return {
    deployerCode,
    tokenCode,
    distributorCode,
    ownerCode,
    tokenNonce,
    distributorNonce,
  };
}

export async function preflightMainTokenMigrationTargetDeployment({
  plan,
  rpcUrls,
  maximumFeePerGasWei,
  maximumPriorityFeePerGasWei,
  maximumGasCostWei,
  rpcClient = mainTokenMigrationTargetRpc,
  clock = () => Date.now(),
}) {
  if (
    plan?.schema !== MAIN_TOKEN_MIGRATION_TARGET_DEPLOYMENT_POLICY.schema ||
    !SHA256.test(plan?.preparedDigest ?? "")
  ) {
    fail("prepared target deployment plan is invalid");
  }
  const providers = normalizeMainTokenMigrationRpcProviders(rpcUrls);
  const owner = exactAddress(plan.owner, "prepared owner");
  const feeCeiling = decimal(maximumFeePerGasWei, "maximum fee per gas", {
    positive: true,
  });
  const priorityCeiling = decimal(
    maximumPriorityFeePerGasWei,
    "maximum priority fee per gas",
  );
  const costCeiling = decimal(maximumGasCostWei, "maximum gas cost", {
    positive: true,
  });
  const startedAt = clock();
  if (!Number.isSafeInteger(startedAt)) fail("preflight clock is invalid");
  const signal = AbortSignal.timeout(
    MAIN_TOKEN_MIGRATION_TARGET_DEPLOYMENT_POLICY.operationTimeoutMilliseconds,
  );
  const openings = await Promise.all(
    providers.map(async (provider) => {
      const [chainIdValue, latestValue, finalizedValue, latestNonce, pendingNonce] =
        await Promise.all([
          rpc(provider, "eth_chainId", [], rpcClient, signal),
          rpc(provider, "eth_getBlockByNumber", ["latest", false], rpcClient, signal),
          rpc(
            provider,
            "eth_getBlockByNumber",
            ["finalized", false],
            rpcClient,
            signal,
          ),
          rpc(
            provider,
            "eth_getTransactionCount",
            [owner, "latest"],
            rpcClient,
            signal,
          ),
          rpc(
            provider,
            "eth_getTransactionCount",
            [owner, "pending"],
            rpcClient,
            signal,
          ),
        ]);
      return {
        chainId: quantity(chainIdValue, `${provider.providerId} chain ID`),
        latest: exactBlock(latestValue, `${provider.providerId} latest block`),
        finalized: exactBlock(
          finalizedValue,
          `${provider.providerId} finalized block`,
        ),
        latestNonce: quantity(latestNonce, `${provider.providerId} latest nonce`),
        pendingNonce: quantity(pendingNonce, `${provider.providerId} pending nonce`),
      };
    }),
  );
  for (const [index, opening] of openings.entries()) {
    if (
      opening.chainId !==
        MAIN_TOKEN_MIGRATION_TARGET_DEPLOYMENT_POLICY.chainId ||
      opening.finalized.number > opening.latest.number ||
      opening.latestNonce !== opening.pendingNonce
    ) {
      fail(`${providers[index].providerId} chain, finality, or owner nonce is unsafe`);
    }
  }
  const headGap =
    openings[0].latest.number > openings[1].latest.number
      ? openings[0].latest.number - openings[1].latest.number
      : openings[1].latest.number - openings[0].latest.number;
  if (
    headGap > MAIN_TOKEN_MIGRATION_TARGET_DEPLOYMENT_POLICY.maximumHeadGap ||
    openings[0].pendingNonce !== openings[1].pendingNonce ||
    openings[0].pendingNonce > UINT64_MAX
  ) {
    fail("RPC head or owner nonce agreement failed");
  }
  const nonce = openings[0].pendingNonce;
  const commonFinalizedNumber =
    openings[0].finalized.number < openings[1].finalized.number
      ? openings[0].finalized.number
      : openings[1].finalized.number;
  const commonTag = toQuantity(commonFinalizedNumber);
  const commonBlocks = await Promise.all(
    providers.map((provider) =>
      rpc(
        provider,
        "eth_getBlockByNumber",
        [commonTag, false],
        rpcClient,
        signal,
      ).then((value) => exactBlock(value, `${provider.providerId} common block`)),
    ),
  );
  compareBlocks(commonBlocks[0], commonBlocks[1], "the common finalized block");
  if (
    commonBlocks[0].number !== commonFinalizedNumber ||
    commonBlocks[0].timestamp +
        MAIN_TOKEN_MIGRATION_TARGET_DEPLOYMENT_POLICY.minimumDeploymentLeadSeconds >=
      BigInt(plan.sourceWindowStartTimestampInclusive)
  ) {
    fail("target deployment does not precede the 96-hour source window safely");
  }
  const commonRef = {
    blockHash: commonBlocks[0].hash,
    requireCanonical: true,
  };
  const fixedVacancies = await Promise.all(
    providers.map((provider) =>
      vacancyAt(provider, plan, owner, commonRef, rpcClient, signal),
    ),
  );
  fixedVacancies.forEach((snapshot, index) =>
    assertVacancySnapshot(snapshot, plan, `${providers[index].providerId} finalized`),
  );
  if (
    JSON.stringify(snapshotComparable(fixedVacancies[0])) !==
    JSON.stringify(snapshotComparable(fixedVacancies[1]))
  ) {
    fail("RPCs disagree on finalized deployer, vacancy, or owner EOA state");
  }

  const transaction = pendingTransaction(plan, owner);
  const pendings = await Promise.all(
    providers.map(async (provider) => {
      const [pendingBlockValue, vacancy, callResult, estimateValue, gasPriceValue, priorityValue, balanceValue] =
        await Promise.all([
          rpc(
            provider,
            "eth_getBlockByNumber",
            ["pending", false],
            rpcClient,
            signal,
          ),
          vacancyAt(provider, plan, owner, "pending", rpcClient, signal),
          rpc(provider, "eth_call", [transaction, "pending"], rpcClient, signal),
          rpc(
            provider,
            "eth_estimateGas",
            [transaction, commonRef],
            rpcClient,
            signal,
          ),
          rpc(provider, "eth_gasPrice", [], rpcClient, signal),
          rpc(provider, "eth_maxPriorityFeePerGas", [], rpcClient, signal),
          rpc(
            provider,
            "eth_getBalance",
            [owner, "pending"],
            rpcClient,
            signal,
          ),
        ]);
      assertVacancySnapshot(vacancy, plan, `${provider.providerId} pending`);
      return {
        pendingBlock: exactPendingBlock(
          pendingBlockValue,
          `${provider.providerId} pending block`,
        ),
        vacancy,
        callResult: exactHexRequest(
          callResult,
          `${provider.providerId} simulation result`,
        ),
        estimatedGas: quantity(
          estimateValue,
          `${provider.providerId} gas estimate`,
        ),
        gasPrice: quantity(gasPriceValue, `${provider.providerId} gas price`),
        priorityFee: quantity(
          priorityValue,
          `${provider.providerId} priority fee`,
        ),
        balance: quantity(balanceValue, `${provider.providerId} owner balance`),
      };
    }),
  );
  if (
    pendings[0].pendingBlock.parentHash !== pendings[1].pendingBlock.parentHash ||
    pendings[0].pendingBlock.baseFeePerGas !==
      pendings[1].pendingBlock.baseFeePerGas ||
    pendings[0].pendingBlock.gasLimit !== pendings[1].pendingBlock.gasLimit ||
    JSON.stringify(snapshotComparable(pendings[0].vacancy)) !==
      JSON.stringify(snapshotComparable(pendings[1].vacancy)) ||
    pendings[0].callResult !== pendings[1].callResult ||
    pendings[0].estimatedGas !== pendings[1].estimatedGas
  ) {
    fail("RPCs disagree on pending state, simulation, or gas estimate");
  }
  if (
    pendings.some(
      ({ pendingBlock }) =>
        pendingBlock.timestamp +
          MAIN_TOKEN_MIGRATION_TARGET_DEPLOYMENT_POLICY.minimumDeploymentLeadSeconds >=
        BigInt(plan.sourceWindowStartTimestampInclusive),
    )
  ) {
    fail("pending deployment no longer precedes the 96-hour source window safely");
  }
  if (pendings[0].callResult !== plan.predicted.token.toLowerCase()) {
    fail("deterministic deployer simulation did not return the predicted token");
  }
  const gasLimit = reviewedGasLimit(pendings[0].estimatedGas);
  if (pendings.some(({ pendingBlock }) => gasLimit > pendingBlock.gasLimit)) {
    fail("reviewed gas limit exceeds the pending block gas limit");
  }
  const priorityFee =
    pendings[0].priorityFee > pendings[1].priorityFee
      ? pendings[0].priorityFee
      : pendings[1].priorityFee;
  const gasPrice =
    pendings[0].gasPrice > pendings[1].gasPrice
      ? pendings[0].gasPrice
      : pendings[1].gasPrice;
  const baseEnvelope = 2n * pendings[0].pendingBlock.baseFeePerGas + priorityFee;
  const maxFeePerGas = gasPrice > baseEnvelope ? gasPrice : baseEnvelope;
  if (
    maxFeePerGas <= 0n ||
    maxFeePerGas > UINT128_MAX ||
    priorityFee > maxFeePerGas ||
    maxFeePerGas > feeCeiling ||
    priorityFee > priorityCeiling
  ) {
    fail("deployment fee envelope exceeds the owner-reviewed ceilings");
  }
  const maximumGasCost = gasLimit * maxFeePerGas;
  if (
    maximumGasCost > costCeiling ||
    pendings.some(({ balance }) => balance < maximumGasCost)
  ) {
    fail("owner balance or maximum gas-cost ceiling is insufficient");
  }
  const closings = await Promise.all(
    providers.map(async (provider) => {
      const [pendingNonceValue, vacancy] = await Promise.all([
        rpc(
          provider,
          "eth_getTransactionCount",
          [owner, "pending"],
          rpcClient,
          signal,
        ),
        vacancyAt(provider, plan, owner, "pending", rpcClient, signal),
      ]);
      assertVacancySnapshot(
        vacancy,
        plan,
        `${provider.providerId} closing pending`,
      );
      return {
        pendingNonce: quantity(
          pendingNonceValue,
          `${provider.providerId} closing pending nonce`,
        ),
        vacancy,
      };
    }),
  );
  for (const [index, closing] of closings.entries()) {
    if (
      closing.pendingNonce !== nonce ||
      JSON.stringify(snapshotComparable(closing.vacancy)) !==
        JSON.stringify(snapshotComparable(pendings[index].vacancy))
    ) {
      fail(`${providers[index].providerId} state changed during preflight`);
    }
  }
  if (
    closings[0].pendingNonce !== closings[1].pendingNonce ||
    JSON.stringify(snapshotComparable(closings[0].vacancy)) !==
      JSON.stringify(snapshotComparable(closings[1].vacancy))
  ) {
    fail("RPCs disagree on closing nonce or vacancy state");
  }
  const completedAt = clock();
  if (
    !Number.isSafeInteger(completedAt) ||
    completedAt < startedAt ||
    completedAt - startedAt >
      MAIN_TOKEN_MIGRATION_TARGET_DEPLOYMENT_POLICY.operationTimeoutMilliseconds
  ) {
    fail("deployment preflight exceeded its operation bound");
  }
  const issuedAt = Math.floor(completedAt / 1_000);
  const request = {
    type: "0x2",
    chainId: MAIN_TOKEN_MIGRATION_TARGET_DEPLOYMENT_POLICY.chainIdHex,
    from: owner,
    to: plan.to,
    value: "0x0",
    data: plan.transactionData,
    nonce: toQuantity(nonce),
    gas: toQuantity(gasLimit),
    maxFeePerGas: toQuantity(maxFeePerGas),
    maxPriorityFeePerGas: toQuantity(priorityFee),
  };
  const subject = {
    schema: "programmable-main-token-migration-target-owner-envelope/v1",
    state: "ready-for-owner-wallet-review-not-signed-not-broadcast",
    preparedDigest: plan.preparedDigest,
    frozenTargetDesignSha256: plan.frozenTargetDesignSha256,
    issuedAt: new Date(issuedAt * 1_000).toISOString(),
    expiresAt: new Date(
      (issuedAt +
        MAIN_TOKEN_MIGRATION_TARGET_DEPLOYMENT_POLICY.envelopeTtlSeconds) *
        1_000,
    ).toISOString(),
    rpcProviders: publicProviderBindings(providers),
    finalizedAnchor: {
      blockNumber: commonFinalizedNumber.toString(),
      blockHash: commonBlocks[0].hash,
      blockTimestamp: commonBlocks[0].timestamp.toString(),
    },
    predicted: plan.predicted,
    request,
    simulation: {
      returnDataKeccak256: keccak256(pendings[0].callResult),
      agreedGasEstimate: pendings[0].estimatedGas.toString(),
    },
    gasPolicy: {
      reviewedGasLimit: gasLimit.toString(),
      reviewedMaxFeePerGasWei: maxFeePerGas.toString(),
      reviewedMaxPriorityFeePerGasWei: priorityFee.toString(),
      reviewedMaximumGasCostWei: maximumGasCost.toString(),
      ownerMinimumObservedBalanceWei: (
        pendings[0].balance < pendings[1].balance
          ? pendings[0].balance
          : pendings[1].balance
      ).toString(),
    },
    checks: {
      independentAuthenticatedRpcCount: 2,
      finalizedStateAgreement: true,
      deterministicDeployerRuntimePinned: true,
      targetAndDistributorVacant: true,
      ownerIsExactEoa: true,
      noPendingOwnerTransaction: true,
      closingNonceAndVacancyAgreement: true,
      pendingSimulationAgreement: true,
      gasAndFeeEnvelopeBounded: true,
      ownerBalanceSufficient: true,
    },
    walletReviewRequired: true,
    automaticSigning: false,
    automaticBroadcast: false,
  };
  return Object.freeze({
    ...subject,
    envelopeDigest: sha256CanonicalTargetDeploymentJson(subject),
  });
}

function assertFreshEnvelope(envelope, plan, clock) {
  if (
    envelope?.schema !==
      "programmable-main-token-migration-target-owner-envelope/v1" ||
    envelope.state !==
      "ready-for-owner-wallet-review-not-signed-not-broadcast" ||
    envelope.preparedDigest !== plan.preparedDigest ||
    !SHA256.test(envelope.envelopeDigest ?? "")
  ) {
    fail("owner envelope does not bind the prepared deployment");
  }
  const { envelopeDigest, ...subject } = envelope;
  if (sha256CanonicalTargetDeploymentJson(subject) !== envelopeDigest) {
    fail("owner envelope digest is invalid");
  }
  const issuedAt = Date.parse(envelope.issuedAt);
  const expiresAt = Date.parse(envelope.expiresAt);
  const now = clock();
  if (
    !Number.isSafeInteger(now) ||
    !Number.isSafeInteger(issuedAt) ||
    !Number.isSafeInteger(expiresAt) ||
    new Date(issuedAt).toISOString() !== envelope.issuedAt ||
    new Date(expiresAt).toISOString() !== envelope.expiresAt ||
    expiresAt - issuedAt !==
      MAIN_TOKEN_MIGRATION_TARGET_DEPLOYMENT_POLICY.envelopeTtlSeconds * 1_000 ||
    issuedAt > now ||
    expiresAt <= now
  ) {
    fail("owner envelope is stale");
  }
}

function assertRecordedEnvelope(envelope, plan) {
  if (
    envelope?.schema !==
      "programmable-main-token-migration-target-owner-envelope/v1" ||
    envelope.state !==
      "ready-for-owner-wallet-review-not-signed-not-broadcast" ||
    envelope.preparedDigest !== plan?.preparedDigest ||
    !SHA256.test(envelope?.envelopeDigest ?? "")
  ) {
    fail("recorded owner envelope does not bind the prepared deployment");
  }
  const { envelopeDigest, ...subject } = envelope;
  if (sha256CanonicalTargetDeploymentJson(subject) !== envelopeDigest) {
    fail("recorded owner envelope digest is invalid");
  }
  const request = envelope.request;
  if (
    request?.type !== "0x2" ||
    request.chainId !==
      MAIN_TOKEN_MIGRATION_TARGET_DEPLOYMENT_POLICY.chainIdHex ||
    !sameAddress(request.from, plan.owner) ||
    !sameAddress(request.to, plan.to) ||
    request.value !== "0x0" ||
    String(request.data).toLowerCase() !== plan.transactionData.toLowerCase() ||
    quantity(request.nonce, "recorded request nonce") > UINT64_MAX ||
    quantity(request.gas, "recorded request gas") >
      MAIN_TOKEN_MIGRATION_TARGET_DEPLOYMENT_POLICY.maximumGasLimit ||
    quantity(request.maxFeePerGas, "recorded request maximum fee") > UINT128_MAX ||
    quantity(request.maxPriorityFeePerGas, "recorded request priority fee") >
      quantity(request.maxFeePerGas, "recorded request maximum fee")
  ) {
    fail("recorded owner envelope transaction drifted");
  }
}

export function validateMainTokenMigrationTargetRecordedEnvelope({
  plan,
  envelope,
}) {
  assertRecordedEnvelope(envelope, plan);
  return envelope;
}

export async function revalidateMainTokenMigrationTargetWalletRequest({
  plan,
  envelope,
  connectedAccount,
  walletChainId,
  rpcUrls,
  maximumFeePerGasWei,
  maximumPriorityFeePerGasWei,
  maximumGasCostWei,
  rpcClient = mainTokenMigrationTargetRpc,
  clock = () => Date.now(),
}) {
  assertFreshEnvelope(envelope, plan, clock);
  const account = exactAddress(connectedAccount, "connected wallet");
  if (
    !sameAddress(account, plan.owner) ||
    String(walletChainId).toLowerCase() !==
      MAIN_TOKEN_MIGRATION_TARGET_DEPLOYMENT_POLICY.chainIdHex
  ) {
    fail("connected wallet or chain differs from the target design");
  }
  const fresh = await preflightMainTokenMigrationTargetDeployment({
    plan,
    rpcUrls,
    maximumFeePerGasWei,
    maximumPriorityFeePerGasWei,
    maximumGasCostWei,
    rpcClient,
    clock,
  });
  const expected = envelope.request;
  const actual = fresh.request;
  for (const field of [
    "type",
    "chainId",
    "from",
    "to",
    "value",
    "data",
    "nonce",
    "gas",
    "maxFeePerGas",
    "maxPriorityFeePerGas",
  ]) {
    if (String(expected[field]).toLowerCase() !== String(actual[field]).toLowerCase()) {
      fail(`wallet request ${field} changed; prepare again`);
    }
  }
  return fresh;
}

function normalizedTransaction(value, label) {
  if (!plainObject(value)) fail(`${label} transaction is missing`);
  return {
    hash: exactHash(value.hash, `${label} transaction hash`),
    from: exactAddress(value.from, `${label} transaction sender`),
    to: exactAddress(value.to, `${label} transaction target`),
    input: exactCode(value.input ?? value.data, `${label} transaction input`),
    value: quantity(value.value, `${label} transaction value`),
    nonce: quantity(value.nonce, `${label} transaction nonce`),
    gas: quantity(value.gas, `${label} transaction gas`),
    maxFeePerGas: quantity(
      value.maxFeePerGas,
      `${label} transaction maximum fee`,
    ),
    maxPriorityFeePerGas: quantity(
      value.maxPriorityFeePerGas,
      `${label} transaction priority fee`,
    ),
    type: quantity(value.type, `${label} transaction type`),
    blockNumber: quantity(value.blockNumber, `${label} transaction block`),
    blockHash: exactHash(value.blockHash, `${label} transaction block hash`),
  };
}

function normalizedReceipt(value, label) {
  if (!plainObject(value)) fail(`${label} receipt is missing`);
  return {
    transactionHash: exactHash(
      value.transactionHash,
      `${label} receipt transaction hash`,
    ),
    from: exactAddress(value.from, `${label} receipt sender`),
    to: exactAddress(value.to, `${label} receipt target`),
    status: quantity(value.status, `${label} receipt status`),
    blockNumber: quantity(value.blockNumber, `${label} receipt block`),
    blockHash: exactHash(value.blockHash, `${label} receipt block hash`),
    gasUsed: quantity(value.gasUsed, `${label} receipt gas used`),
    contractAddress:
      value.contractAddress === null
        ? null
        : exactAddress(value.contractAddress, `${label} receipt contract address`),
  };
}

function assertExactFinalTransaction(transaction, receipt, txHash, envelope) {
  const request = envelope.request;
  if (
    transaction.hash !== txHash ||
    receipt.transactionHash !== txHash ||
    !sameAddress(transaction.from, request.from) ||
    !sameAddress(receipt.from, request.from) ||
    !sameAddress(transaction.to, request.to) ||
    !sameAddress(receipt.to, request.to) ||
    transaction.input !== request.data.toLowerCase() ||
    transaction.value !== quantity(request.value, "request value") ||
    transaction.nonce !== quantity(request.nonce, "request nonce") ||
    transaction.gas !== quantity(request.gas, "request gas") ||
    transaction.maxFeePerGas !==
      quantity(request.maxFeePerGas, "request maximum fee") ||
    transaction.maxPriorityFeePerGas !==
      quantity(request.maxPriorityFeePerGas, "request priority fee") ||
    transaction.type !== 2n ||
    transaction.blockNumber !== receipt.blockNumber ||
    transaction.blockHash !== receipt.blockHash ||
    receipt.status !== 1n ||
    receipt.contractAddress !== null ||
    receipt.gasUsed > transaction.gas
  ) {
    fail("finalized transaction or receipt differs from the wallet request");
  }
}

async function readFunction({
  provider,
  address,
  abi,
  functionName,
  args = [],
  blockTag,
  rpcClient,
  signal,
}) {
  const data = encodeFunctionData({ abi, functionName, args });
  const result = exactCode(
    await rpc(
      provider,
      "eth_call",
      [{ to: address, data }, blockTag],
      rpcClient,
      signal,
    ),
    `${provider.providerId} ${functionName} result`,
  );
  try {
    return decodeFunctionResult({ abi, functionName, data: result });
  } catch {
    fail(`${provider.providerId} ${functionName} result is not ABI-decodable`);
  }
}

async function readTargetState(provider, plan, blockTag, rpcClient, signal) {
  const token = plan.predicted.token;
  const distributor = plan.predicted.distributor;
  const [
    tokenCode,
    distributorCode,
    name,
    symbol,
    decimals,
    totalSupply,
    targetChainId,
    totalSupplyConstant,
    migrationDistributor,
    distributorBalance,
    boundToken,
    releaseIdHash,
    sourceChainId,
    sourceToken,
    sourceDeadline,
    snapshotRuleHash,
    sealAuthority,
    remainderRecipient,
    distributorTargetChainId,
    distributorSupplyConstant,
    isSealed,
    merkleRoot,
    sourceSnapshotSha256,
    migrationTotalRaw,
    totalDistributedRaw,
  ] = await Promise.all([
    rpc(provider, "eth_getCode", [token, blockTag], rpcClient, signal),
    rpc(provider, "eth_getCode", [distributor, blockTag], rpcClient, signal),
    readFunction({ provider, address: token, abi: tokenReadAbi, functionName: "name", blockTag, rpcClient, signal }),
    readFunction({ provider, address: token, abi: tokenReadAbi, functionName: "symbol", blockTag, rpcClient, signal }),
    readFunction({ provider, address: token, abi: tokenReadAbi, functionName: "decimals", blockTag, rpcClient, signal }),
    readFunction({ provider, address: token, abi: tokenReadAbi, functionName: "totalSupply", blockTag, rpcClient, signal }),
    readFunction({ provider, address: token, abi: tokenReadAbi, functionName: "TARGET_CHAIN_ID", blockTag, rpcClient, signal }),
    readFunction({ provider, address: token, abi: tokenReadAbi, functionName: "TOTAL_SUPPLY", blockTag, rpcClient, signal }),
    readFunction({ provider, address: token, abi: tokenReadAbi, functionName: "MIGRATION_DISTRIBUTOR", blockTag, rpcClient, signal }),
    readFunction({ provider, address: token, abi: tokenReadAbi, functionName: "balanceOf", args: [distributor], blockTag, rpcClient, signal }),
    readFunction({ provider, address: distributor, abi: distributorReadAbi, functionName: "TOKEN", blockTag, rpcClient, signal }),
    readFunction({ provider, address: distributor, abi: distributorReadAbi, functionName: "RELEASE_ID_HASH", blockTag, rpcClient, signal }),
    readFunction({ provider, address: distributor, abi: distributorReadAbi, functionName: "SOURCE_CHAIN_ID", blockTag, rpcClient, signal }),
    readFunction({ provider, address: distributor, abi: distributorReadAbi, functionName: "SOURCE_TOKEN", blockTag, rpcClient, signal }),
    readFunction({ provider, address: distributor, abi: distributorReadAbi, functionName: "SOURCE_DEADLINE_TIMESTAMP_EXCLUSIVE", blockTag, rpcClient, signal }),
    readFunction({ provider, address: distributor, abi: distributorReadAbi, functionName: "SNAPSHOT_RULE_HASH", blockTag, rpcClient, signal }),
    readFunction({ provider, address: distributor, abi: distributorReadAbi, functionName: "SEAL_AUTHORITY", blockTag, rpcClient, signal }),
    readFunction({ provider, address: distributor, abi: distributorReadAbi, functionName: "REMAINDER_RECIPIENT", blockTag, rpcClient, signal }),
    readFunction({ provider, address: distributor, abi: distributorReadAbi, functionName: "TARGET_CHAIN_ID", blockTag, rpcClient, signal }),
    readFunction({ provider, address: distributor, abi: distributorReadAbi, functionName: "TOKEN_TOTAL_SUPPLY_RAW", blockTag, rpcClient, signal }),
    readFunction({ provider, address: distributor, abi: distributorReadAbi, functionName: "isSealed", blockTag, rpcClient, signal }),
    readFunction({ provider, address: distributor, abi: distributorReadAbi, functionName: "merkleRoot", blockTag, rpcClient, signal }),
    readFunction({ provider, address: distributor, abi: distributorReadAbi, functionName: "sourceSnapshotSha256", blockTag, rpcClient, signal }),
    readFunction({ provider, address: distributor, abi: distributorReadAbi, functionName: "migrationTotalRaw", blockTag, rpcClient, signal }),
    readFunction({ provider, address: distributor, abi: distributorReadAbi, functionName: "totalDistributedRaw", blockTag, rpcClient, signal }),
  ]);
  return {
    tokenRuntimeCode: exactCode(tokenCode, `${provider.providerId} token runtime`),
    distributorRuntimeCode: exactCode(
      distributorCode,
      `${provider.providerId} distributor runtime`,
    ),
    name,
    symbol,
    decimals: BigInt(decimals),
    totalSupply: BigInt(totalSupply),
    targetChainId: BigInt(targetChainId),
    totalSupplyConstant: BigInt(totalSupplyConstant),
    migrationDistributor: exactAddress(
      migrationDistributor,
      `${provider.providerId} migration distributor`,
    ),
    distributorBalance: BigInt(distributorBalance),
    boundToken: exactAddress(boundToken, `${provider.providerId} bound token`),
    releaseIdHash: String(releaseIdHash).toLowerCase(),
    sourceChainId: BigInt(sourceChainId),
    sourceToken: exactAddress(sourceToken, `${provider.providerId} source token`),
    sourceDeadline: BigInt(sourceDeadline),
    snapshotRuleHash: String(snapshotRuleHash).toLowerCase(),
    sealAuthority: exactAddress(sealAuthority, `${provider.providerId} seal authority`),
    remainderRecipient: exactAddress(
      remainderRecipient,
      `${provider.providerId} remainder recipient`,
    ),
    distributorTargetChainId: BigInt(distributorTargetChainId),
    distributorSupplyConstant: BigInt(distributorSupplyConstant),
    isSealed,
    merkleRoot: String(merkleRoot).toLowerCase(),
    sourceSnapshotSha256: String(sourceSnapshotSha256).toLowerCase(),
    migrationTotalRaw: BigInt(migrationTotalRaw),
    totalDistributedRaw: BigInt(totalDistributedRaw),
  };
}

function assertTargetState(state, plan, label) {
  const zeroHash = `0x${"00".repeat(32)}`;
  if (
    state.name !== MAIN_TOKEN_MIGRATION_TARGET_DEPLOYMENT_POLICY.tokenName ||
    state.symbol !== MAIN_TOKEN_MIGRATION_TARGET_DEPLOYMENT_POLICY.tokenSymbol ||
    state.decimals !== MAIN_TOKEN_MIGRATION_TARGET_DEPLOYMENT_POLICY.tokenDecimals ||
    state.totalSupply !== MAIN_TOKEN_MIGRATION_TARGET_DEPLOYMENT_POLICY.tokenTotalSupplyRaw ||
    state.targetChainId !== MAIN_TOKEN_MIGRATION_TARGET_DEPLOYMENT_POLICY.chainId ||
    state.totalSupplyConstant !== MAIN_TOKEN_MIGRATION_TARGET_DEPLOYMENT_POLICY.tokenTotalSupplyRaw ||
    !sameAddress(state.migrationDistributor, plan.predicted.distributor) ||
    state.distributorBalance !== MAIN_TOKEN_MIGRATION_TARGET_DEPLOYMENT_POLICY.tokenTotalSupplyRaw ||
    !sameAddress(state.boundToken, plan.predicted.token) ||
    state.releaseIdHash !== plan.releaseIdHash ||
    state.sourceChainId !== MAIN_TOKEN_MIGRATION_TARGET_DEPLOYMENT_POLICY.sourceChainId ||
    !sameAddress(state.sourceToken, MAIN_TOKEN_MIGRATION_TARGET_DEPLOYMENT_POLICY.sourceToken) ||
    state.sourceDeadline !== BigInt(plan.sourceDeadlineTimestampExclusive) ||
    state.snapshotRuleHash !== plan.snapshotRuleHash ||
    !sameAddress(state.sealAuthority, plan.owner) ||
    !sameAddress(
      state.remainderRecipient,
      plan.immutableOwnerBinding.remainderRecipient,
    ) ||
    state.distributorTargetChainId !== MAIN_TOKEN_MIGRATION_TARGET_DEPLOYMENT_POLICY.chainId ||
    state.distributorSupplyConstant !== MAIN_TOKEN_MIGRATION_TARGET_DEPLOYMENT_POLICY.tokenTotalSupplyRaw ||
    state.isSealed !== false ||
    state.merkleRoot !== zeroHash ||
    state.sourceSnapshotSha256 !== zeroHash ||
    state.migrationTotalRaw !== 0n ||
    state.totalDistributedRaw !== 0n
  ) {
    fail(`${label} deployed token or distributor state drifted`);
  }
}

function publicTargetState(state) {
  return {
    tokenRuntimeCodeKeccak256: keccak256(state.tokenRuntimeCode),
    distributorRuntimeCodeKeccak256: keccak256(state.distributorRuntimeCode),
    tokenName: state.name,
    tokenSymbol: state.symbol,
    tokenDecimals: state.decimals.toString(),
    tokenTotalSupplyRaw: state.totalSupply.toString(),
    distributorTokenBalanceRaw: state.distributorBalance.toString(),
    releaseIdHash: state.releaseIdHash,
    sourceChainId: state.sourceChainId.toString(),
    sourceToken: state.sourceToken,
    sourceDeadlineTimestampExclusive: state.sourceDeadline.toString(),
    snapshotRuleHash: state.snapshotRuleHash,
    sealAuthority: state.sealAuthority,
    remainderRecipient: state.remainderRecipient,
    isSealed: state.isSealed,
  };
}

export function normalizeMainTokenMigrationEthereumRpcProviders(rpcUrls) {
  if (!Array.isArray(rpcUrls) || rpcUrls.length !== 2) {
    fail("terminal finality requires two authenticated Ethereum RPCs");
  }
  const pins = Object.freeze([
    Object.freeze({
      providerId: "drpc",
      role: "primary",
      trustDomain: "drpc.org",
    }),
    Object.freeze({
      providerId: "quicknode",
      role: "secondary",
      trustDomain: "quicknode.com",
    }),
  ]);
  const providers = pins.map((pin, index) => {
    try {
      validateRobinhoodCredentialedProviderEndpoint(
        rpcUrls[index],
        "ethereum",
        pin.providerId,
      );
    } catch {
      fail(`${pin.providerId} Ethereum RPC violates the canonical provider pin`);
    }
    return Object.freeze({
      ...pin,
      authentication: "provider-credential",
      endpointCommitment: endpointCommitment(
        `ethereum-${pin.providerId}`,
        rpcUrls[index],
      ),
      rpcUrl: rpcUrls[index],
    });
  });
  if (providers[0].endpointCommitment === providers[1].endpointCommitment) {
    fail("Ethereum finality providers are not independent");
  }
  return providers;
}

function abiWord(value, label) {
  const data = exactCode(value, label);
  if (hexToBytes(data).length !== 32) fail(`${label} is not one ABI word`);
  return BigInt(data);
}

async function readNitroBatchBinding(
  provider,
  receiptBlockNumber,
  receiptBlockHash,
  rpcClient,
  signal,
) {
  const blockRef = { blockHash: receiptBlockHash, requireCanonical: true };
  const batchData = `${ROBINHOOD_FIND_BATCH_SELECTOR}${receiptBlockNumber
    .toString(16)
    .padStart(64, "0")}`;
  const confirmationsData = `${ROBINHOOD_L1_CONFIRMATIONS_SELECTOR}${receiptBlockHash.slice(2)}`;
  const [batchResult, confirmationsResult] = await Promise.all([
    rpc(
      provider,
      "eth_call",
      [{ to: ROBINHOOD_NODE_INTERFACE, data: batchData }, blockRef],
      rpcClient,
      signal,
    ),
    rpc(
      provider,
      "eth_call",
      [{ to: ROBINHOOD_NODE_INTERFACE, data: confirmationsData }, blockRef],
      rpcClient,
      signal,
    ),
  ]);
  const batchNumber = abiWord(
    batchResult,
    `${provider.providerId} Nitro batch number`,
  );
  const l1Confirmations = abiWord(
    confirmationsResult,
    `${provider.providerId} L1 confirmations`,
  );
  if (batchNumber === 0n || l1Confirmations === 0n) {
    fail(`${provider.providerId} does not prove a posted Nitro batch`);
  }
  return { batchNumber, l1Confirmations };
}

function normalizedPostingLog(value, label) {
  if (!plainObject(value) || !Array.isArray(value.topics)) {
    fail(`${label} is not an Ethereum log`);
  }
  return {
    address: exactAddress(value.address, `${label} address`),
    topics: value.topics.map((topic, index) =>
      exactHash(topic, `${label} topic ${index}`),
    ),
    data: exactCode(value.data, `${label} data`, { empty: true }),
    transactionHash: exactHash(
      value.transactionHash,
      `${label} transaction hash`,
    ),
    transactionIndex: quantity(
      value.transactionIndex,
      `${label} transaction index`,
    ),
    blockNumber: quantity(value.blockNumber, `${label} block number`),
    blockHash: exactHash(value.blockHash, `${label} block hash`),
    logIndex: quantity(value.logIndex, `${label} log index`),
    removed: value.removed === true,
  };
}

function normalizedPostingReceipt(value, label) {
  if (!plainObject(value) || !Array.isArray(value.logs)) {
    fail(`${label} posting receipt is missing`);
  }
  return {
    transactionHash: exactHash(
      value.transactionHash,
      `${label} posting transaction hash`,
    ),
    from: exactAddress(value.from, `${label} posting sender`),
    to: exactAddress(value.to, `${label} posting target`),
    status: quantity(value.status, `${label} posting status`),
    blockNumber: quantity(value.blockNumber, `${label} posting block number`),
    blockHash: exactHash(value.blockHash, `${label} posting block hash`),
    transactionIndex: quantity(
      value.transactionIndex,
      `${label} posting transaction index`,
    ),
    contractAddress:
      value.contractAddress === null
        ? null
        : exactAddress(
            value.contractAddress,
            `${label} posting contract address`,
          ),
    logs: value.logs.map((entry, index) =>
      normalizedPostingLog(entry, `${label} receipt log ${index}`),
    ),
  };
}

function postingLogComparable(value) {
  return {
    ...value,
    transactionIndex: value.transactionIndex.toString(),
    blockNumber: value.blockNumber.toString(),
    logIndex: value.logIndex.toString(),
  };
}

function postingReceiptComparable(value) {
  return {
    ...value,
    status: value.status.toString(),
    blockNumber: value.blockNumber.toString(),
    transactionIndex: value.transactionIndex.toString(),
    logs: value.logs.map(postingLogComparable),
  };
}

async function verifyEthereumTerminalFinality({
  batchNumber,
  ethereumPostingBlock,
  ethereumRpcUrls,
  rpcClient,
  signal,
}) {
  const providers = normalizeMainTokenMigrationEthereumRpcProviders(
    ethereumRpcUrls,
  );
  const postingBlockNumber = decimal(
    ethereumPostingBlock,
    "Ethereum posting block",
    { positive: true },
  );
  const postingBlockTag = toQuantity(postingBlockNumber);
  const batchTopic = `0x${batchNumber.toString(16).padStart(64, "0")}`;
  const observations = await Promise.all(
    providers.map(async (provider) => {
      const [chainIdValue, logsValue] = await Promise.all([
        rpc(provider, "eth_chainId", [], rpcClient, signal),
        rpc(
          provider,
          "eth_getLogs",
          [
            {
              address: ROBINHOOD_SEQUENCER_INBOX,
              fromBlock: postingBlockTag,
              toBlock: postingBlockTag,
              topics: [SEQUENCER_BATCH_DELIVERED_TOPIC, batchTopic],
            },
          ],
          rpcClient,
          signal,
        ),
      ]);
      if (quantity(chainIdValue, `${provider.providerId} Ethereum chain ID`) !== 1n) {
        fail(`${provider.providerId} finality provider is not Ethereum Mainnet`);
      }
      if (!Array.isArray(logsValue) || logsValue.length !== 1) {
        fail(`${provider.providerId} must observe exactly one batch posting log`);
      }
      const log = normalizedPostingLog(
        logsValue[0],
        `${provider.providerId} posting log`,
      );
      if (
        !sameAddress(log.address, ROBINHOOD_SEQUENCER_INBOX) ||
        log.removed ||
        log.topics.length !== 4 ||
        log.topics[0] !== SEQUENCER_BATCH_DELIVERED_TOPIC ||
        log.topics[1] !== batchTopic ||
        log.blockNumber !== postingBlockNumber
      ) {
        fail(`${provider.providerId} posting log is not batch-pinned`);
      }
      let decoded;
      try {
        decoded = decodeEventLog({
          abi: sequencerBatchDeliveredAbi,
          eventName: "SequencerBatchDelivered",
          topics: log.topics,
          data: log.data,
          strict: true,
        });
      } catch {
        fail(`${provider.providerId} posting log cannot be decoded`);
      }
      if (decoded.args.batchSequenceNumber !== batchNumber) {
        fail(`${provider.providerId} posting event batch differs`);
      }
      const [receiptValue, blockValue, finalizedFirstValue] = await Promise.all([
          rpc(
            provider,
            "eth_getTransactionReceipt",
            [log.transactionHash],
            rpcClient,
            signal,
          ),
          rpc(
            provider,
            "eth_getBlockByHash",
            [log.blockHash, false],
            rpcClient,
            signal,
          ),
          rpc(
            provider,
            "eth_getBlockByNumber",
            ["finalized", false],
            rpcClient,
            signal,
          ),
        ]);
      const receipt = normalizedPostingReceipt(
        receiptValue,
        provider.providerId,
      );
      const block = exactBlock(blockValue, `${provider.providerId} posting block`);
      const finalizedFirst = exactBlock(
        finalizedFirstValue,
        `${provider.providerId} first Ethereum finalized block`,
      );
      const finalizedSecondValue = await rpc(
        provider,
        "eth_getBlockByNumber",
        ["finalized", false],
        rpcClient,
        signal,
      );
      const finalizedSecond = exactBlock(
        finalizedSecondValue,
        `${provider.providerId} second Ethereum finalized block`,
      );
      compareBlocks(
        finalizedFirst,
        finalizedSecond,
        `${provider.providerId} stable Ethereum finalized checkpoint`,
      );
      const includedLogs = receipt.logs.filter(
        (candidate) =>
          sameAddress(candidate.address, log.address) &&
          candidate.transactionHash === log.transactionHash &&
          candidate.blockHash === log.blockHash &&
          candidate.logIndex === log.logIndex &&
          JSON.stringify(candidate.topics) === JSON.stringify(log.topics) &&
          candidate.data === log.data,
      );
      if (
        receipt.transactionHash !== log.transactionHash ||
        !sameAddress(receipt.to, ROBINHOOD_SEQUENCER_INBOX) ||
        receipt.status !== 1n ||
        receipt.contractAddress !== null ||
        receipt.blockNumber !== log.blockNumber ||
        receipt.blockHash !== log.blockHash ||
        receipt.transactionIndex !== log.transactionIndex ||
        includedLogs.length !== 1 ||
        block.number !== log.blockNumber ||
        block.hash !== log.blockHash ||
        finalizedFirst.number < block.number
      ) {
        fail(`${provider.providerId} does not prove finalized posting inclusion`);
      }
      return { log, receipt, block, finalized: finalizedFirst };
    }),
  );
  if (
    JSON.stringify(postingLogComparable(observations[0].log)) !==
      JSON.stringify(postingLogComparable(observations[1].log)) ||
    JSON.stringify(postingReceiptComparable(observations[0].receipt)) !==
      JSON.stringify(postingReceiptComparable(observations[1].receipt))
  ) {
    fail("Ethereum providers disagree on the exact batch posting");
  }
  compareBlocks(
    observations[0].block,
    observations[1].block,
    "the Ethereum posting block",
  );
  compareBlocks(
    observations[0].finalized,
    observations[1].finalized,
    "the Ethereum finalized checkpoint",
  );
  return Object.freeze({
    terminalStage: "ethereum_finalized",
    batchNumber: batchNumber.toString(),
    sequencerInbox: ROBINHOOD_SEQUENCER_INBOX,
    postingTransactionHash: observations[0].log.transactionHash,
    postingBlockNumber: observations[0].block.number.toString(),
    postingBlockHash: observations[0].block.hash,
    ethereumFinalizedBlockNumber:
      observations[0].finalized.number.toString(),
    ethereumFinalizedBlockHash: observations[0].finalized.hash,
    rpcProviders: publicProviderBindings(providers),
    independentEthereumRpcAgreement: true,
    finalizedCheckpointStableReread: true,
  });
}

export async function verifyMainTokenMigrationTargetDeploymentFinality({
  plan,
  envelope,
  transactionHash,
  rpcUrls,
  ethereumRpcUrls,
  ethereumPostingBlock,
  rpcClient = mainTokenMigrationTargetRpc,
}) {
  const txHash = exactHash(transactionHash, "submitted transaction hash");
  assertRecordedEnvelope(envelope, plan);
  const providers = normalizeMainTokenMigrationRpcProviders(rpcUrls);
  if (!Array.isArray(ethereumRpcUrls) || ethereumPostingBlock === undefined) {
    fail(
      "Robinhood finalized-tag agreement is insufficient without canonical Ethereum batch finality",
    );
  }
  const signal = AbortSignal.timeout(
    MAIN_TOKEN_MIGRATION_TARGET_DEPLOYMENT_POLICY.operationTimeoutMilliseconds,
  );
  const observations = await Promise.all(
    providers.map(async (provider) => {
      const [chainIdValue, transactionValue, receiptValue, finalizedValue] =
        await Promise.all([
        rpc(provider, "eth_chainId", [], rpcClient, signal),
        rpc(
          provider,
          "eth_getTransactionByHash",
          [txHash],
          rpcClient,
          signal,
        ),
        rpc(
          provider,
          "eth_getTransactionReceipt",
          [txHash],
          rpcClient,
          signal,
        ),
        rpc(
          provider,
          "eth_getBlockByNumber",
          ["finalized", false],
          rpcClient,
          signal,
        ),
      ]);
      if (
        quantity(chainIdValue, `${provider.providerId} Robinhood chain ID`) !==
        MAIN_TOKEN_MIGRATION_TARGET_DEPLOYMENT_POLICY.chainId
      ) {
        fail(`${provider.providerId} terminal provider is not Robinhood Mainnet`);
      }
      if (transactionValue === null || receiptValue === null) {
        fail(`${provider.providerId} transaction is not finalized yet`);
      }
      const transaction = normalizedTransaction(
        transactionValue,
        provider.providerId,
      );
      const receipt = normalizedReceipt(receiptValue, provider.providerId);
      const finalized = exactBlock(
        finalizedValue,
        `${provider.providerId} finalized block`,
      );
      assertExactFinalTransaction(transaction, receipt, txHash, envelope);
      if (finalized.number < receipt.blockNumber) {
        fail(`${provider.providerId} transaction is not finalized yet`);
      }
      const canonicalBlock = exactBlock(
        await rpc(
          provider,
          "eth_getBlockByNumber",
          [toQuantity(receipt.blockNumber), false],
          rpcClient,
          signal,
        ),
        `${provider.providerId} receipt block`,
      );
      if (canonicalBlock.hash !== receipt.blockHash) {
        fail(`${provider.providerId} receipt block is not canonical`);
      }
      const state = await readTargetState(
        provider,
        plan,
        { blockHash: receipt.blockHash, requireCanonical: true },
        rpcClient,
        signal,
      );
      assertTargetState(state, plan, provider.providerId);
      const nitro = await readNitroBatchBinding(
        provider,
        receipt.blockNumber,
        receipt.blockHash,
        rpcClient,
        signal,
      );
      return {
        chainId: MAIN_TOKEN_MIGRATION_TARGET_DEPLOYMENT_POLICY.chainId,
        transaction,
        receipt,
        finalized,
        canonicalBlock,
        state,
        nitro,
      };
    }),
  );
  const comparable = (observation) => ({
    chainId: observation.chainId.toString(),
    transaction: {
      ...observation.transaction,
      nonce: observation.transaction.nonce.toString(),
      gas: observation.transaction.gas.toString(),
      value: observation.transaction.value.toString(),
      maxFeePerGas: observation.transaction.maxFeePerGas.toString(),
      maxPriorityFeePerGas:
        observation.transaction.maxPriorityFeePerGas.toString(),
      type: observation.transaction.type.toString(),
      blockNumber: observation.transaction.blockNumber.toString(),
    },
    receipt: {
      ...observation.receipt,
      status: observation.receipt.status.toString(),
      blockNumber: observation.receipt.blockNumber.toString(),
      gasUsed: observation.receipt.gasUsed.toString(),
    },
    canonicalBlock: {
      ...observation.canonicalBlock,
      number: observation.canonicalBlock.number.toString(),
      timestamp: observation.canonicalBlock.timestamp.toString(),
      gasLimit: observation.canonicalBlock.gasLimit.toString(),
    },
    state: publicTargetState(observation.state),
    nitro: {
      batchNumber: observation.nitro.batchNumber.toString(),
      l1Confirmations: observation.nitro.l1Confirmations.toString(),
    },
  });
  const immutableComparable = (observation) => {
    const value = comparable(observation);
    return { ...value, nitro: { batchNumber: value.nitro.batchNumber } };
  };
  if (
    JSON.stringify(comparable(observations[0])) !==
    JSON.stringify(comparable(observations[1]))
  ) {
    fail("RPCs disagree on the finalized deployment or exact contract state");
  }
  const commonRobinhoodFinalizedNumber =
    observations[0].finalized.number < observations[1].finalized.number
      ? observations[0].finalized.number
      : observations[1].finalized.number;
  const commonRobinhoodFinalizedBlocks = await Promise.all(
    providers.map((provider) =>
      rpc(
        provider,
        "eth_getBlockByNumber",
        [toQuantity(commonRobinhoodFinalizedNumber), false],
        rpcClient,
        signal,
      ).then((value) =>
        exactBlock(value, `${provider.providerId} common finalized block`),
      ),
    ),
  );
  compareBlocks(
    commonRobinhoodFinalizedBlocks[0],
    commonRobinhoodFinalizedBlocks[1],
    "the common Robinhood finalized-tag block",
  );
  if (
    commonRobinhoodFinalizedBlocks[0].number <
    observations[0].receipt.blockNumber
  ) {
    fail("common Robinhood finalized-tag block is behind the deployment");
  }
  const ethereumFinality = await verifyEthereumTerminalFinality({
    batchNumber: observations[0].nitro.batchNumber,
    ethereumPostingBlock,
    ethereumRpcUrls,
    rpcClient,
    signal,
  });
  const closingObservations = await Promise.all(
    providers.map(async (provider) => {
      const [chainIdValue, transactionValue, receiptValue, finalizedValue] =
        await Promise.all([
          rpc(provider, "eth_chainId", [], rpcClient, signal),
          rpc(
            provider,
            "eth_getTransactionByHash",
            [txHash],
            rpcClient,
            signal,
          ),
          rpc(
            provider,
            "eth_getTransactionReceipt",
            [txHash],
            rpcClient,
            signal,
          ),
          rpc(
            provider,
            "eth_getBlockByNumber",
            ["finalized", false],
            rpcClient,
            signal,
          ),
        ]);
      const chainId = quantity(
        chainIdValue,
        `${provider.providerId} closing Robinhood chain ID`,
      );
      const transaction = normalizedTransaction(
        transactionValue,
        `${provider.providerId} closing`,
      );
      const receipt = normalizedReceipt(
        receiptValue,
        `${provider.providerId} closing`,
      );
      const finalized = exactBlock(
        finalizedValue,
        `${provider.providerId} closing finalized block`,
      );
      assertExactFinalTransaction(transaction, receipt, txHash, envelope);
      if (
        chainId !== MAIN_TOKEN_MIGRATION_TARGET_DEPLOYMENT_POLICY.chainId ||
        finalized.number < receipt.blockNumber
      ) {
        fail(`${provider.providerId} closing Robinhood capture is unsafe`);
      }
      const canonicalBlock = exactBlock(
        await rpc(
          provider,
          "eth_getBlockByNumber",
          [toQuantity(receipt.blockNumber), false],
          rpcClient,
          signal,
        ),
        `${provider.providerId} closing receipt block`,
      );
      if (canonicalBlock.hash !== receipt.blockHash) {
        fail(`${provider.providerId} closing receipt block is not canonical`);
      }
      const state = await readTargetState(
        provider,
        plan,
        { blockHash: receipt.blockHash, requireCanonical: true },
        rpcClient,
        signal,
      );
      assertTargetState(state, plan, `${provider.providerId} closing`);
      const nitro = await readNitroBatchBinding(
        provider,
        receipt.blockNumber,
        receipt.blockHash,
        rpcClient,
        signal,
      );
      return {
        chainId,
        transaction,
        receipt,
        finalized,
        canonicalBlock,
        state,
        nitro,
      };
    }),
  );
  if (
    JSON.stringify(comparable(closingObservations[0])) !==
      JSON.stringify(comparable(closingObservations[1])) ||
    JSON.stringify(immutableComparable(closingObservations[0])) !==
      JSON.stringify(immutableComparable(observations[0])) ||
    closingObservations[0].nitro.l1Confirmations <
      observations[0].nitro.l1Confirmations
  ) {
    fail("closing Robinhood transaction, state, or Nitro binding changed");
  }
  const subject = {
    schema:
      MAIN_TOKEN_MIGRATION_TARGET_DEPLOYMENT_POLICY.postdeploymentSchema,
    state: "deployed-ethereum-finalized-source-window-pending",
    preparedDigest: plan.preparedDigest,
    envelopeDigest: envelope.envelopeDigest,
    frozenTargetDesignSha256: plan.frozenTargetDesignSha256,
    rpcProviders: publicProviderBindings(providers),
    transactionHash: txHash,
    blockNumber: observations[0].receipt.blockNumber.toString(),
    blockHash: observations[0].receipt.blockHash,
    finalizedHeads: observations.map((observation, index) => ({
      providerId: providers[index].providerId,
      blockNumber: observation.finalized.number.toString(),
      blockHash: observation.finalized.hash,
    })),
    robinhoodFinalizedTagAgreement: {
      blockNumber: commonRobinhoodFinalizedBlocks[0].number.toString(),
      blockHash: commonRobinhoodFinalizedBlocks[0].hash,
      independentRpcCount: 2,
    },
    terminalFinality: ethereumFinality,
    tokenAddress: plan.predicted.token,
    distributorAddress: plan.predicted.distributor,
    ...publicTargetState(observations[0].state),
    checks: {
      exactWalletTransaction: true,
      receiptStatusSuccessful: true,
      independentlyFinalizedRpcCount: 2,
      terminalFinalityStage: "ethereum_finalized",
      independentEthereumRpcCount: 2,
      exactNitroBatchPostingFinalized: true,
      closingRobinhoodCaptureAgreement: true,
      canonicalReceiptBlockAgreement: true,
      runtimeCodeAgreement: true,
      completeImmutableGetterAgreement: true,
      fullSupplyInDistributor: true,
      distributorUnsealed: true,
    },
  };
  const deployment = {
    transactionHash: txHash,
    blockNumber: observations[0].receipt.blockNumber.toString(),
    blockHash: observations[0].receipt.blockHash,
    finalizedBlockNumber:
      commonRobinhoodFinalizedBlocks[0].number.toString(),
    finalizedBlockHash: commonRobinhoodFinalizedBlocks[0].hash,
    independentRpcAgreement: true,
    tokenMigrationDistributorAddress: plan.predicted.distributor,
    distributorTokenBalanceRaw:
      MAIN_TOKEN_MIGRATION_TARGET_DEPLOYMENT_POLICY.tokenTotalSupplyRaw.toString(),
    distributorIsSealed: false,
    verificationReceiptSha256: null,
  };
  const receiptWithoutDigest = {
    ...subject,
    deployment,
  };
  const verificationReceiptSha256 =
    mainTokenMigrationTargetDeploymentReceiptSha256(receiptWithoutDigest);
  return Object.freeze({
    ...receiptWithoutDigest,
    deployment: { ...deployment, verificationReceiptSha256 },
    verificationReceiptSha256,
  });
}

export function mainTokenMigrationTargetDeploymentReceiptSha256(receipt) {
  if (!plainObject(receipt) || !plainObject(receipt.deployment)) {
    fail("deployment receipt digest input is invalid");
  }
  const subject = Object.fromEntries(
    Object.entries(receipt).filter(
      ([key]) => key !== "verificationReceiptSha256",
    ),
  );
  return sha256CanonicalTargetDeploymentJson({
    ...subject,
    deployment: {
      ...subject.deployment,
      verificationReceiptSha256: null,
    },
  });
}

export const MAIN_TOKEN_MIGRATION_TARGET_READ_ABIS = Object.freeze({
  token: tokenReadAbi,
  distributor: distributorReadAbi,
});

export const MAIN_TOKEN_MIGRATION_TARGET_EMPTY_CODE_HASH = EMPTY_CODE_HASH;
