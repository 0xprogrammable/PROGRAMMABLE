import { isAddress } from "viem";

import {
  MAIN_TOKEN_ADDRESS,
  MAIN_TOKEN_DECIMALS,
  MAIN_TOKEN_MIGRATION_ACTIVATION_SCHEMA,
  MAIN_TOKEN_MIGRATION_CHAIN_ID,
  MAIN_TOKEN_MIGRATION_MINIMUM_PUBLIC_LEAD_SECONDS,
  MAIN_TOKEN_MIGRATION_RELEASE_ID,
  MAIN_TOKEN_MIGRATION_SNAPSHOT_BOUNDARY_RULE,
  MAIN_TOKEN_MIGRATION_TARGET_CHAIN_ID,
  MAIN_TOKEN_MIGRATION_TARGET_TOKEN_TOTAL_SUPPLY_RAW,
  MAIN_TOKEN_MIGRATION_WALLET,
  MAIN_TOKEN_MIGRATION_WINDOW_SECONDS,
  MAIN_TOKEN_RUNTIME_CODE_KECCAK256,
  MAIN_TOKEN_TOTAL_SUPPLY_RAW,
} from "./main-token-migration";

const exactKeys = [
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
] as const;
const decimalIntegerPattern = /^(?:0|[1-9][0-9]*)$/u;
const positiveIntegerPattern = /^[1-9][0-9]*$/u;
const bytes32Pattern = /^0x[0-9a-fA-F]{64}$/u;
const sha256Pattern = /^sha256:[0-9a-f]{64}$/u;
const zeroAddress = "0x0000000000000000000000000000000000000000";
const zeroBytes32 = `0x${"0".repeat(64)}`;
const zeroSha256 = `sha256:${"0".repeat(64)}`;

export type MainTokenMigrationWindow = Readonly<{
  enabled: boolean;
  startAt: number | null;
  deadlineAt: number | null;
}>;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>) {
  const actual = Object.keys(value).sort();
  const expected = [...exactKeys].sort();
  return actual.length === expected.length &&
    actual.every((key, index) => key === expected[index]);
}

function string(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function parseMainTokenMigrationActivation(
  input: unknown,
): MainTokenMigrationWindow {
  if (!record(input) || !hasExactKeys(input)) {
    return Object.freeze({ enabled: false, startAt: null, deadlineAt: null });
  }

  const sourceTokenAddress = string(input.sourceTokenAddress);
  const migrationWallet = string(input.migrationWallet);
  const startValue = string(input.windowStartTimestamp);
  const deadlineValue = string(input.deadlineTimestampExclusive);
  const targetTokenAddress = string(input.targetTokenAddress);
  const distributorAddress = string(input.migrationDistributorAddress);
  const targetRuntimeHash = string(input.targetTokenRuntimeCodeKeccak256);
  const distributorRuntimeHash = string(
    input.migrationDistributorRuntimeCodeKeccak256,
  );
  const targetDesignSha256 = string(input.targetDesignSha256);
  const sponsorBlock = string(input.sponsorEligibilityBlockNumber);
  const sponsorHash = string(input.sponsorEligibilityBlockHash);

  const startSeconds =
    startValue !== null && decimalIntegerPattern.test(startValue)
      ? Number(startValue)
      : Number.NaN;
  const deadlineSeconds =
    deadlineValue !== null && decimalIntegerPattern.test(deadlineValue)
      ? Number(deadlineValue)
      : Number.NaN;
  const safeStart = Number.isSafeInteger(startSeconds) &&
    startSeconds <= Math.floor(Number.MAX_SAFE_INTEGER / 1_000);
  const safeDeadline = Number.isSafeInteger(deadlineSeconds) &&
    deadlineSeconds <= Math.floor(Number.MAX_SAFE_INTEGER / 1_000);
  const startAt = safeStart ? startSeconds * 1_000 : null;
  const deadlineAt = safeDeadline ? deadlineSeconds * 1_000 : null;

  const normalizedTarget = targetTokenAddress?.toLowerCase() ?? null;
  const normalizedDistributor = distributorAddress?.toLowerCase() ?? null;
  const exactPolicy =
    input.enabled === true &&
    input.schema === MAIN_TOKEN_MIGRATION_ACTIVATION_SCHEMA &&
    input.releaseId === MAIN_TOKEN_MIGRATION_RELEASE_ID &&
    input.sourceChainId === String(MAIN_TOKEN_MIGRATION_CHAIN_ID) &&
    sourceTokenAddress !== null &&
    sourceTokenAddress.toLowerCase() === MAIN_TOKEN_ADDRESS.toLowerCase() &&
    string(input.sourceTokenRuntimeCodeKeccak256)?.toLowerCase() ===
      MAIN_TOKEN_RUNTIME_CODE_KECCAK256 &&
    input.sourceTokenDecimals === String(MAIN_TOKEN_DECIMALS) &&
    input.sourceTokenTotalSupplyRaw === MAIN_TOKEN_TOTAL_SUPPLY_RAW.toString() &&
    input.targetChainId === String(MAIN_TOKEN_MIGRATION_TARGET_CHAIN_ID) &&
    input.targetTokenTotalSupplyRaw ===
      MAIN_TOKEN_MIGRATION_TARGET_TOKEN_TOTAL_SUPPLY_RAW.toString() &&
    migrationWallet !== null &&
    migrationWallet.toLowerCase() === MAIN_TOKEN_MIGRATION_WALLET.toLowerCase() &&
    input.windowDurationSeconds === String(MAIN_TOKEN_MIGRATION_WINDOW_SECONDS) &&
    input.snapshotBoundaryRule === MAIN_TOKEN_MIGRATION_SNAPSHOT_BOUNDARY_RULE &&
    input.minimumPublicLeadSeconds ===
      String(MAIN_TOKEN_MIGRATION_MINIMUM_PUBLIC_LEAD_SECONDS);
  const exactWindow =
    startAt !== null &&
    deadlineAt !== null &&
    deadlineAt - startAt === MAIN_TOKEN_MIGRATION_WINDOW_SECONDS * 1_000;
  const exactSponsor =
    sponsorBlock !== null &&
    positiveIntegerPattern.test(sponsorBlock) &&
    sponsorHash !== null &&
    bytes32Pattern.test(sponsorHash) &&
    sponsorHash.toLowerCase() !== zeroBytes32;
  const exactTarget =
    targetTokenAddress !== null &&
    isAddress(targetTokenAddress, { strict: true }) &&
    normalizedTarget !== zeroAddress &&
    normalizedTarget !== MAIN_TOKEN_ADDRESS.toLowerCase() &&
    normalizedTarget !== MAIN_TOKEN_MIGRATION_WALLET.toLowerCase() &&
    targetRuntimeHash !== null &&
    bytes32Pattern.test(targetRuntimeHash) &&
    targetRuntimeHash.toLowerCase() !== zeroBytes32 &&
    distributorAddress !== null &&
    isAddress(distributorAddress, { strict: true }) &&
    normalizedDistributor !== zeroAddress &&
    normalizedDistributor !== normalizedTarget &&
    normalizedDistributor !== MAIN_TOKEN_ADDRESS.toLowerCase() &&
    normalizedDistributor !== MAIN_TOKEN_MIGRATION_WALLET.toLowerCase() &&
    distributorRuntimeHash !== null &&
    bytes32Pattern.test(distributorRuntimeHash) &&
    distributorRuntimeHash.toLowerCase() !== zeroBytes32 &&
    targetDesignSha256 !== null &&
    sha256Pattern.test(targetDesignSha256) &&
    targetDesignSha256 !== zeroSha256;

  return Object.freeze({
    enabled: exactPolicy && exactWindow && exactSponsor && exactTarget,
    startAt,
    deadlineAt,
  });
}

export function isMainTokenMigrationActivationEnabled(input: unknown) {
  return parseMainTokenMigrationActivation(input).enabled;
}
