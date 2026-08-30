import { MAIN_TOKEN_MIGRATION_POLICY } from "./main-token-migration-snapshot-core.mjs";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;
const BYTES32 = /^0x[0-9a-fA-F]{64}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/u;
const POSITIVE_DECIMAL = /^[1-9][0-9]*$/u;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_BYTES32 = `0x${"0".repeat(64)}`;
const ZERO_SHA256 = `sha256:${"0".repeat(64)}`;

const ACTIVATION_KEYS = Object.freeze([
  "deadlineTimestampExclusive",
  "enabled",
  "targetDesignSha256",
  "migrationWallet",
  "migrationDistributorAddress",
  "migrationDistributorRuntimeCodeKeccak256",
  "minimumPublicLeadSeconds",
  "releaseId",
  "schema",
  "snapshotBoundaryRule",
  "sourceChainId",
  "sourceTokenAddress",
  "sourceTokenDecimals",
  "sourceTokenRuntimeCodeKeccak256",
  "sourceTokenTotalSupplyRaw",
  "sponsorEligibilityBlockHash",
  "sponsorEligibilityBlockNumber",
  "targetChainId",
  "targetTokenAddress",
  "targetTokenRuntimeCodeKeccak256",
  "targetTokenTotalSupplyRaw",
  "windowDurationSeconds",
  "windowStartTimestamp",
].sort());

function reject(message) {
  throw new Error(`Migration activation rejected: ${message}`);
}

function exactPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value) {
  if (!exactPlainObject(value)) return false;
  const actual = Object.keys(value).sort();
  return actual.length === ACTIVATION_KEYS.length &&
    actual.every((key, index) => key === ACTIVATION_KEYS[index]);
}

function decimal(value, label, positive = false) {
  const pattern = positive ? POSITIVE_DECIMAL : DECIMAL;
  if (!pattern.test(String(value ?? ""))) {
    reject(`${label} is not an exact decimal integer`);
  }
  return BigInt(value);
}

function exactAddress(value, expected, label) {
  if (!ADDRESS.test(String(value ?? "")) ||
    value.toLowerCase() !== expected.toLowerCase()) {
    reject(`${label} is not the frozen address`);
  }
}

function deploymentAddress(value, label) {
  if (!ADDRESS.test(String(value ?? "")) ||
    value.toLowerCase() === ZERO_ADDRESS) {
    reject(`${label} is not a deployed contract address`);
  }
  return value.toLowerCase();
}

function runtimeCodeHash(value, label) {
  const normalized = String(value ?? "").toLowerCase();
  if (!BYTES32.test(normalized) || normalized === ZERO_BYTES32) {
    reject(`${label} is not a runtime-code hash`);
  }
  return normalized;
}

export function parseMainTokenMigrationActivationManifest(
  payload,
  options = {},
) {
  if (!exactKeys(payload)) reject("manifest fields are not exact");
  if (payload.schema !== MAIN_TOKEN_MIGRATION_POLICY.activationSchema) {
    reject("schema is not supported");
  }
  if (payload.releaseId !== MAIN_TOKEN_MIGRATION_POLICY.releaseId) {
    reject("releaseId is not frozen");
  }
  if (payload.enabled !== true && payload.enabled !== false) {
    reject("enabled is not boolean");
  }
  if (options.requireEnabled === true && payload.enabled !== true) {
    reject("manifest is not enabled");
  }
  if (decimal(payload.sourceChainId, "sourceChainId") !==
    MAIN_TOKEN_MIGRATION_POLICY.chainId) {
    reject("source chain is not Ethereum mainnet");
  }
  exactAddress(
    payload.sourceTokenAddress,
    MAIN_TOKEN_MIGRATION_POLICY.tokenAddress,
    "sourceTokenAddress",
  );
  if (String(payload.sourceTokenRuntimeCodeKeccak256 ?? "").toLowerCase() !==
    MAIN_TOKEN_MIGRATION_POLICY.tokenRuntimeCodeKeccak256) {
    reject("source runtime hash is not frozen");
  }
  if (decimal(payload.sourceTokenDecimals, "sourceTokenDecimals") !==
    MAIN_TOKEN_MIGRATION_POLICY.tokenDecimals) {
    reject("source token decimals are not frozen");
  }
  if (decimal(payload.sourceTokenTotalSupplyRaw, "sourceTokenTotalSupplyRaw") !==
    MAIN_TOKEN_MIGRATION_POLICY.tokenTotalSupplyRaw) {
    reject("source token supply is not frozen");
  }
  if (decimal(payload.targetChainId, "targetChainId") !==
    MAIN_TOKEN_MIGRATION_POLICY.targetChainId) {
    reject("target chain is not Robinhood Chain mainnet");
  }
  if (decimal(payload.targetTokenTotalSupplyRaw, "targetTokenTotalSupplyRaw") !==
    MAIN_TOKEN_MIGRATION_POLICY.targetTokenTotalSupplyRaw) {
    reject("target token supply is not frozen");
  }
  exactAddress(
    payload.migrationWallet,
    MAIN_TOKEN_MIGRATION_POLICY.migrationWallet,
    "migrationWallet",
  );
  if (decimal(payload.windowDurationSeconds, "windowDurationSeconds") !==
    MAIN_TOKEN_MIGRATION_POLICY.windowSeconds) {
    reject("window duration is not frozen");
  }
  if (payload.snapshotBoundaryRule !==
    MAIN_TOKEN_MIGRATION_POLICY.snapshotBoundaryRule) {
    reject("snapshot boundary rule is not frozen");
  }
  if (decimal(payload.minimumPublicLeadSeconds, "minimumPublicLeadSeconds") !==
    MAIN_TOKEN_MIGRATION_POLICY.minimumPublicLeadSeconds) {
    reject("minimum public lead is not frozen");
  }

  const mutableFields = [
    payload.windowStartTimestamp,
    payload.deadlineTimestampExclusive,
    payload.sponsorEligibilityBlockNumber,
    payload.sponsorEligibilityBlockHash,
    payload.targetTokenAddress,
    payload.targetTokenRuntimeCodeKeccak256,
    payload.migrationDistributorAddress,
    payload.migrationDistributorRuntimeCodeKeccak256,
    payload.targetDesignSha256,
  ];
  if (payload.enabled === false) {
    if (mutableFields.some((value) => value !== null)) {
      reject("disabled manifest contains activation values");
    }
    return Object.freeze({
      enabled: false,
      releaseId: payload.releaseId,
      schema: payload.schema,
      snapshotBoundaryRule: payload.snapshotBoundaryRule,
    });
  }

  const windowStartTimestamp = decimal(
    payload.windowStartTimestamp,
    "windowStartTimestamp",
    true,
  );
  const deadlineTimestampExclusive = decimal(
    payload.deadlineTimestampExclusive,
    "deadlineTimestampExclusive",
    true,
  );
  const sponsorEligibilityBlockNumber = decimal(
    payload.sponsorEligibilityBlockNumber,
    "sponsorEligibilityBlockNumber",
    true,
  );
  if (!BYTES32.test(String(payload.sponsorEligibilityBlockHash ?? "")) ||
    String(payload.sponsorEligibilityBlockHash).toLowerCase() === ZERO_BYTES32) {
    reject("sponsor eligibility block hash is malformed");
  }
  const targetTokenAddress = deploymentAddress(
    payload.targetTokenAddress,
    "targetTokenAddress",
  );
  const migrationDistributorAddress = deploymentAddress(
    payload.migrationDistributorAddress,
    "migrationDistributorAddress",
  );
  if (targetTokenAddress === migrationDistributorAddress ||
    [MAIN_TOKEN_MIGRATION_POLICY.tokenAddress,
      MAIN_TOKEN_MIGRATION_POLICY.migrationWallet]
      .some((address) => address.toLowerCase() === targetTokenAddress ||
        address.toLowerCase() === migrationDistributorAddress)) {
    reject("target contracts are not distinct from frozen release addresses");
  }
  const targetTokenRuntimeCodeKeccak256 = runtimeCodeHash(
    payload.targetTokenRuntimeCodeKeccak256,
    "targetTokenRuntimeCodeKeccak256",
  );
  const migrationDistributorRuntimeCodeKeccak256 = runtimeCodeHash(
    payload.migrationDistributorRuntimeCodeKeccak256,
    "migrationDistributorRuntimeCodeKeccak256",
  );
  if (!SHA256.test(String(payload.targetDesignSha256 ?? "")) ||
    payload.targetDesignSha256 === ZERO_SHA256) {
    reject("target design SHA-256 is malformed");
  }
  if (windowStartTimestamp + MAIN_TOKEN_MIGRATION_POLICY.windowSeconds !==
    deadlineTimestampExclusive) {
    reject("deadline is not exactly 96 hours after the window start");
  }

  return Object.freeze({
    deadlineTimestampExclusive,
    enabled: true,
    minimumPublicLeadSeconds:
      MAIN_TOKEN_MIGRATION_POLICY.minimumPublicLeadSeconds,
    releaseId: payload.releaseId,
    schema: payload.schema,
    snapshotBoundaryRule: payload.snapshotBoundaryRule,
    targetChainId: MAIN_TOKEN_MIGRATION_POLICY.targetChainId,
    targetTokenAddress,
    targetTokenRuntimeCodeKeccak256,
    targetTokenTotalSupplyRaw:
      MAIN_TOKEN_MIGRATION_POLICY.targetTokenTotalSupplyRaw,
    migrationDistributorAddress,
    migrationDistributorRuntimeCodeKeccak256,
    targetDesignSha256: payload.targetDesignSha256,
    sponsorEligibilityBlockHash:
      payload.sponsorEligibilityBlockHash.toLowerCase(),
    sponsorEligibilityBlockNumber,
    windowStartTimestamp,
  });
}

export function verifyMainTokenMigrationPromotionWindow(
  payload,
  nowTimestamp,
) {
  const activation = parseMainTokenMigrationActivationManifest(payload, {
    requireEnabled: true,
  });
  const now = typeof nowTimestamp === "bigint"
    ? nowTimestamp
    : decimal(nowTimestamp, "current timestamp");
  if (now < 0n ||
    now + activation.minimumPublicLeadSeconds >
      activation.windowStartTimestamp) {
    reject("minimum public lead time has been missed");
  }
  return activation;
}
