import "server-only";

import {
  canonicalAddress,
  canonicalBytes32,
  parseNonnegativeIntegerText,
  type HexAddress,
  type HexBytes32,
} from "./codecs";
import { loadDataPipelineConfig } from "./config";
import {
  verifyEnvioCandidateBatchWithDualRpc,
  type CandidateRpcProvider,
} from "./dual-rpc";
import {
  createEnvioClient,
  type EnvioCandidate,
  type EnvioCandidateCursor,
} from "./envio";
import {
  DataPipelineError,
  dataPipelineError,
  invalidInput,
  validationError,
} from "./errors";
import {
  createPostgresExecutor,
  type PostgresExecutor,
} from "./postgres";
import { validatedPostgresConnectionString } from "./postgres-connection.server";
import { createProductionDualRpcProviders } from "./rpc-providers.server";

type Environment = Readonly<Record<string, string | undefined>>;

const SMOKE_PROFILE_ID = "read-model-smoke-v1" as const;
const RELEASE_PROFILE_ID = "read-model-release-v1" as const;
const PROJECTOR_LOGIN_ROLE = "programmable_projector_login" as const;
const PROJECTOR_CAPABILITY_ROLE = "programmable_projector" as const;
const API_READER_LOGIN_ROLE = "programmable_api_reader_login" as const;
const API_READER_CAPABILITY_ROLE = "programmable_api_reader" as const;
const PERMISSION_DENIED_SQLSTATE = "42501" as const;
const HARD_DEADLINE_MS = 75_000;
const SMOKE_REQUIRED_CANDIDATE_COUNT = 8;
const RELEASE_REQUIRED_CANDIDATE_COUNT = 32;
const SMOKE_MAX_CALLS_PER_PROVIDER = 42;
const RELEASE_MAX_CALLS_PER_PROVIDER = 128;
const REQUIRED_KEY_COUNT = 100;
const REQUIRED_MODEL_LAUNCH_COUNT = 32;
const RELEASE_TOKEN_KEY_COUNT = 264;
const RELEASE_MINIMUM_ELIGIBLE_LAUNCH_COUNT = 264;
const MAXIMUM_ELIGIBLE_LAUNCH_COUNT = 400;
const ZERO_ADDRESS = `0x${"00".repeat(20)}`;
const ZERO_BYTES32 = `0x${"00".repeat(32)}`;
const SMOKE_REQUEST_KEYS = Object.freeze([
  "schemaVersion",
  "profileId",
  "gitHead",
  "targetUrl",
  "vercelDeploymentId",
  "captureNonce",
] as const);
const RELEASE_REQUEST_KEYS = Object.freeze([
  ...SMOKE_REQUEST_KEYS,
  "issuedAtMs",
] as const);
const CANDIDATE_ID_PATTERN =
  /^1:(0x[0-9a-f]{64}):(0x[0-9a-f]{64}):(?:0|[1-9]\d*)$/u;

type CaptureContract = Readonly<{
  profileId: typeof SMOKE_PROFILE_ID | typeof RELEASE_PROFILE_ID;
  candidateCount: 8 | 32;
  maximumCallsPerProvider: 42 | 128;
  minimumEligibleLaunches: 200 | 264;
  tokenKeyCount: 100 | 264;
}>;

const SMOKE_CAPTURE_CONTRACT: CaptureContract = Object.freeze({
  profileId: SMOKE_PROFILE_ID,
  candidateCount: SMOKE_REQUIRED_CANDIDATE_COUNT,
  maximumCallsPerProvider: SMOKE_MAX_CALLS_PER_PROVIDER,
  minimumEligibleLaunches: 200,
  tokenKeyCount: REQUIRED_KEY_COUNT,
});
const RELEASE_CAPTURE_CONTRACT: CaptureContract = Object.freeze({
  profileId: RELEASE_PROFILE_ID,
  candidateCount: RELEASE_REQUIRED_CANDIDATE_COUNT,
  maximumCallsPerProvider: RELEASE_MAX_CALLS_PER_PROVIDER,
  minimumEligibleLaunches: RELEASE_MINIMUM_ELIGIBLE_LAUNCH_COUNT,
  tokenKeyCount: RELEASE_TOKEN_KEY_COUNT,
});

type PerformanceCaptureRequest = Readonly<{
  schemaVersion: 1 | 2;
  profileId: CaptureContract["profileId"];
  gitHead: string;
  targetUrl: string;
  vercelDeploymentId: string;
  captureNonce: HexBytes32;
  issuedAtMs?: number;
}>;

type DatasetCounts = Readonly<{
  launches: number;
  chainEvents: number;
  marketSnapshots: number;
  marketCandles: number;
  accounts: number;
  rewardRows: number;
}>;

type DatasetKeys = Readonly<{
  tokenAddresses: readonly HexAddress[];
  accountAddresses: readonly HexAddress[];
  classicLaunches: readonly LaunchPathKey[];
  stockLaunches: readonly LaunchPathKey[];
  candidateIds: readonly string[];
}>;

const RELEASE_VERSIONS = Object.freeze([
  "classic-v2",
  "classic-v3",
  "stock-paired-v1",
  "stock-paired-v2",
  "stock-paired-v3",
] as const);
type ReleaseVersion = (typeof RELEASE_VERSIONS)[number];
type ReleaseCounts = Readonly<Record<ReleaseVersion, number>>;

type EligibleLaunch = Readonly<{
  account: HexAddress;
  transactionHash: HexBytes32;
  tokenAddress: HexAddress;
  releaseVersion: ReleaseVersion;
}>;

type AccountEvidence = Readonly<{
  account: HexAddress;
  profileRows: number;
  rewardRows: number;
}>;

type LaunchPathKey = Readonly<{
  account: HexAddress;
  transactionHash: HexBytes32;
}>;

type PerformanceDatasetSeed = Readonly<{
  generatedAt: string;
  counts: DatasetCounts;
  releaseCounts: ReleaseCounts;
  eligibleLaunches: readonly EligibleLaunch[];
  accountEvidence: readonly AccountEvidence[];
  keys: DatasetKeys;
}>;

export type PerformanceAccessEvidence = Readonly<{
  projectorSessionUser: typeof PROJECTOR_LOGIN_ROLE;
  projectorCurrentRole: typeof PROJECTOR_CAPABILITY_ROLE;
  projectorCurrentSettingRole: typeof PROJECTOR_CAPABILITY_ROLE;
  apiReaderSessionUser: typeof API_READER_LOGIN_ROLE;
  apiReaderCurrentRole: typeof API_READER_CAPABILITY_ROLE;
  apiReaderCurrentSettingRole: typeof API_READER_CAPABILITY_ROLE;
  apiReaderDeniedSqlstate: typeof PERMISSION_DENIED_SQLSTATE;
  apiReaderFunctionExecute: false;
  apiReaderViewSelect: false;
}>;

type PerformanceDatasetCapture = Readonly<{
  dataset: PerformanceDatasetSeed;
  accessEvidence: PerformanceAccessEvidence;
}>;

export type PerformanceRpcTraceCall = Readonly<{
  providerIdentity: string;
  providerVendorGroup: string;
  providerEndpointCommitment: HexBytes32;
  providerOriginCommitment: HexBytes32;
  operation:
    | "getChainId"
    | "getBlockNumber"
    | "getBlock"
    | "getTransactionReceipt"
    | "getBytecode";
  attempt: number;
  startedOffsetMs: number;
  durationMs: number;
  outcome: "success" | "error";
}>;

type RpcTraceCapture = Readonly<{
  startedAtMs: number;
  completedAtMs: number;
  candidateBatchSize: number;
  hardDeadlineMs: number;
  maxCallsPerProvider: number;
  elapsedMs: number;
  providerCallCounts: readonly [number, number];
  calls: readonly PerformanceRpcTraceCall[];
  candidateEvidence: readonly RpcCandidateEvidence[];
}>;

type RpcCandidateEvidence = Readonly<{
  candidateId: string;
  candidateBlockNumber: string;
  candidateBlockHash: HexBytes32;
  transactionHash: HexBytes32;
  sourceAddress: HexAddress;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function onlyKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function captureInputFailure(): never {
  throw invalidInput("config", "performance-capture-request");
}

function captureValidationFailure(operation: string): never {
  throw validationError("config", operation);
}

function exactString(
  value: unknown,
  pattern: RegExp,
  maximum: number,
): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximum ||
    !pattern.test(value)
  ) {
    return captureInputFailure();
  }
  return value;
}

export function parseReadModelPerformanceCaptureRequest(
  value: unknown,
  env: Environment = process.env,
): PerformanceCaptureRequest {
  if (!isRecord(value)) {
    return captureInputFailure();
  }
  const contract =
    value.profileId === SMOKE_PROFILE_ID
      ? SMOKE_CAPTURE_CONTRACT
      : value.profileId === RELEASE_PROFILE_ID
        ? RELEASE_CAPTURE_CONTRACT
        : null;
  if (
    contract === null ||
    !onlyKeys(
      value,
      contract === SMOKE_CAPTURE_CONTRACT
        ? SMOKE_REQUEST_KEYS
        : RELEASE_REQUEST_KEYS,
    )
  ) {
    return captureInputFailure();
  }
  const gitHead = exactString(value.gitHead, /^[0-9a-f]{40}$/u, 40);
  const deploymentId = exactString(
    value.vercelDeploymentId,
    /^dpl_[A-Za-z0-9]{20,128}$/u,
    132,
  );
  const vercelHost = exactString(
    env.VERCEL_URL,
    /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*vercel\.app$/u,
    253,
  );
  const expectedTargetUrl = new URL(`https://${vercelHost}`).toString();
  const targetUrl = exactString(
    value.targetUrl,
    /^https:\/\/[a-z0-9.-]+\.vercel\.app\/$/u,
    300,
  );
  let parsedTarget: URL;
  try {
    parsedTarget = new URL(targetUrl);
  } catch {
    return captureInputFailure();
  }
  if (
    value.schemaVersion !==
      (contract === SMOKE_CAPTURE_CONTRACT ? 1 : 2) ||
    gitHead !== env.VERCEL_GIT_COMMIT_SHA ||
    targetUrl !== expectedTargetUrl ||
    parsedTarget.toString() !== targetUrl ||
    parsedTarget.pathname !== "/" ||
    parsedTarget.search !== "" ||
    parsedTarget.hash !== "" ||
    deploymentId !== env.VERCEL_DEPLOYMENT_ID
  ) {
    return captureInputFailure();
  }
  let captureNonce: HexBytes32;
  try {
    captureNonce = canonicalBytes32(value.captureNonce);
  } catch {
    return captureInputFailure();
  }
  let issuedAtMs: number | undefined;
  if (contract === RELEASE_CAPTURE_CONTRACT) {
    issuedAtMs = value.issuedAtMs as number;
    const nowMs = Date.now();
    if (
      !Number.isSafeInteger(issuedAtMs) ||
      issuedAtMs < 1 ||
      issuedAtMs > nowMs + 30_000 ||
      nowMs - issuedAtMs > 60_000
    ) {
      return captureInputFailure();
    }
  }
  return Object.freeze({
    schemaVersion: contract === SMOKE_CAPTURE_CONTRACT ? 1 : 2,
    profileId: contract.profileId,
    gitHead,
    targetUrl,
    vercelDeploymentId: deploymentId,
    captureNonce,
    ...(issuedAtMs === undefined ? {} : { issuedAtMs }),
  });
}

function safeCount(value: unknown, minimum: number, operation: string): number {
  let canonical: string;
  try {
    canonical = parseNonnegativeIntegerText(
      typeof value === "bigint"
        ? value.toString()
        : typeof value === "number" && Number.isSafeInteger(value)
          ? String(value)
          : value,
    );
  } catch {
    return captureValidationFailure(operation);
  }
  const parsed = Number(canonical);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    return captureValidationFailure(operation);
  }
  return parsed;
}

function exactTimestamp(value: unknown): string {
  if (typeof value !== "string") {
    return captureValidationFailure("performance-dataset-generated-at");
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== value) {
    return captureValidationFailure("performance-dataset-generated-at");
  }
  return value;
}

function exactAddresses(
  value: unknown,
  operation: string,
  expectedCount: number,
): readonly HexAddress[] {
  if (!Array.isArray(value) || value.length !== expectedCount) {
    return captureValidationFailure(operation);
  }
  let addresses: HexAddress[];
  try {
    addresses = value.map((entry) => canonicalAddress(entry));
  } catch {
    return captureValidationFailure(operation);
  }
  if (
    addresses.some((address) => address === ZERO_ADDRESS) ||
    new Set(addresses).size !== expectedCount ||
    addresses.some(
      (address, index) => index > 0 && address <= addresses[index - 1]!,
    )
  ) {
    return captureValidationFailure(operation);
  }
  return Object.freeze(addresses);
}

function exactLaunches(
  value: unknown,
  operation: string,
): readonly LaunchPathKey[] {
  if (!Array.isArray(value) || value.length !== REQUIRED_MODEL_LAUNCH_COUNT) {
    return captureValidationFailure(operation);
  }
  const launches = value.map((entry) => {
    if (!isRecord(entry) || !onlyKeys(entry, ["account", "transactionHash"])) {
      return captureValidationFailure(operation);
    }
    let account: HexAddress;
    let transactionHash: HexBytes32;
    try {
      account = canonicalAddress(entry.account);
      transactionHash = canonicalBytes32(entry.transactionHash);
    } catch {
      return captureValidationFailure(operation);
    }
    if (account === ZERO_ADDRESS || transactionHash === ZERO_BYTES32) {
      return captureValidationFailure(operation);
    }
    return Object.freeze({ account, transactionHash });
  });
  const identities = launches.map(
    ({ account, transactionHash }) => `${account}:${transactionHash}`,
  );
  if (
    new Set(identities).size !== REQUIRED_MODEL_LAUNCH_COUNT ||
    identities.some(
      (identity, index) => index > 0 && identity <= identities[index - 1]!,
    )
  ) {
    return captureValidationFailure(operation);
  }
  return Object.freeze(launches);
}

function exactCandidateIds(
  value: unknown,
  expectedCount: number,
): readonly string[] {
  if (!Array.isArray(value) || value.length !== expectedCount) {
    return captureValidationFailure("performance-candidate-ids");
  }
  const ids = value.map((entry) => {
    if (typeof entry !== "string" || !CANDIDATE_ID_PATTERN.test(entry)) {
      return captureValidationFailure("performance-candidate-ids");
    }
    return entry;
  });
  if (new Set(ids).size !== expectedCount) {
    return captureValidationFailure("performance-candidate-ids");
  }
  return Object.freeze(ids);
}

function exactReleaseCounts(value: unknown): ReleaseCounts {
  if (!isRecord(value) || !onlyKeys(value, RELEASE_VERSIONS)) {
    return captureValidationFailure("performance-release-counts");
  }
  return Object.freeze(
    Object.fromEntries(
      RELEASE_VERSIONS.map((releaseVersion) => [
        releaseVersion,
        safeCount(
          value[releaseVersion],
          1,
          "performance-release-count",
        ),
      ]),
    ) as Record<ReleaseVersion, number>,
  );
}

function exactEligibleLaunches(
  value: unknown,
  expectedCount: number,
): readonly EligibleLaunch[] {
  if (!Array.isArray(value) || value.length !== expectedCount) {
    return captureValidationFailure("performance-eligible-launches");
  }
  const launches = value.map((entry) => {
    if (
      !isRecord(entry) ||
      !onlyKeys(entry, [
        "account",
        "transactionHash",
        "tokenAddress",
        "releaseVersion",
      ]) ||
      !RELEASE_VERSIONS.includes(entry.releaseVersion as ReleaseVersion)
    ) {
      return captureValidationFailure("performance-eligible-launch");
    }
    let account: HexAddress;
    let transactionHash: HexBytes32;
    let tokenAddress: HexAddress;
    try {
      account = canonicalAddress(entry.account);
      transactionHash = canonicalBytes32(entry.transactionHash);
      tokenAddress = canonicalAddress(entry.tokenAddress);
    } catch {
      return captureValidationFailure("performance-eligible-launch");
    }
    if (
      account === ZERO_ADDRESS ||
      transactionHash === ZERO_BYTES32 ||
      tokenAddress === ZERO_ADDRESS ||
      entry.account !== account ||
      entry.transactionHash !== transactionHash ||
      entry.tokenAddress !== tokenAddress
    ) {
      return captureValidationFailure("performance-eligible-launch");
    }
    return Object.freeze({
      account,
      transactionHash,
      tokenAddress,
      releaseVersion: entry.releaseVersion as ReleaseVersion,
    });
  });
  if (
    new Set(launches.map(({ transactionHash }) => transactionHash)).size !==
      expectedCount ||
    new Set(launches.map(({ tokenAddress }) => tokenAddress)).size !==
      expectedCount ||
    launches.some((launch, index) => {
      if (index === 0) return false;
      const previous = launches[index - 1]!;
      const previousKey = `${previous.releaseVersion}:${previous.tokenAddress}:${previous.transactionHash}:${previous.account}`;
      const currentKey = `${launch.releaseVersion}:${launch.tokenAddress}:${launch.transactionHash}:${launch.account}`;
      return currentKey <= previousKey;
    })
  ) {
    return captureValidationFailure("performance-eligible-launch-identity");
  }
  return Object.freeze(launches);
}

function exactAccountEvidence(
  value: unknown,
  expectedAccounts: readonly HexAddress[],
  counts: DatasetCounts,
): readonly AccountEvidence[] {
  if (!Array.isArray(value) || value.length !== REQUIRED_KEY_COUNT) {
    return captureValidationFailure("performance-account-evidence");
  }
  let totalProfileRows = 0;
  let totalRewardRows = 0;
  const evidence = value.map((entry, index) => {
    if (
      !isRecord(entry) ||
      !onlyKeys(entry, ["account", "profileRows", "rewardRows"])
    ) {
      return captureValidationFailure("performance-account-evidence");
    }
    let account: HexAddress;
    try {
      account = canonicalAddress(entry.account);
    } catch {
      return captureValidationFailure("performance-account-evidence");
    }
    const profileRows = safeCount(
      entry.profileRows,
      0,
      "performance-account-profile-rows",
    );
    const rewardRows = safeCount(
      entry.rewardRows,
      0,
      "performance-account-reward-rows",
    );
    if (
      account !== expectedAccounts[index] ||
      entry.account !== account ||
      profileRows + rewardRows === 0
    ) {
      return captureValidationFailure("performance-account-evidence");
    }
    totalProfileRows += profileRows;
    totalRewardRows += rewardRows;
    return Object.freeze({ account, profileRows, rewardRows });
  });
  if (
    totalProfileRows > counts.launches ||
    totalRewardRows > counts.rewardRows
  ) {
    return captureValidationFailure("performance-account-evidence-counts");
  }
  return Object.freeze(evidence);
}

function validateDatasetSeed(
  value: unknown,
  contract: CaptureContract,
): PerformanceDatasetSeed {
  if (
    !isRecord(value) ||
    !onlyKeys(value, [
      "generatedAt",
      "counts",
      "releaseCounts",
      "eligibleLaunches",
      "accountEvidence",
      "keys",
    ]) ||
    !isRecord(value.counts) ||
    !onlyKeys(value.counts, [
      "launches",
      "chainEvents",
      "marketSnapshots",
      "marketCandles",
      "accounts",
      "rewardRows",
    ]) ||
    !isRecord(value.keys) ||
    !onlyKeys(value.keys, [
      "tokenAddresses",
      "accountAddresses",
      "classicLaunches",
      "stockLaunches",
      "candidateIds",
    ])
  ) {
    return captureValidationFailure("performance-dataset-shape");
  }
  const launches = safeCount(
    value.counts.launches,
    contract.minimumEligibleLaunches,
    "performance-launch-count",
  );
  if (launches > MAXIMUM_ELIGIBLE_LAUNCH_COUNT) {
    return captureValidationFailure("performance-launch-count");
  }
  const counts = Object.freeze({
    launches,
    chainEvents: safeCount(
      value.counts.chainEvents,
      Math.max(600, 3 * launches),
      "performance-chain-event-count",
    ),
    marketSnapshots: safeCount(
      value.counts.marketSnapshots,
      Math.max(200, launches),
      "performance-market-snapshot-count",
    ),
    marketCandles: safeCount(
      value.counts.marketCandles,
      Math.max(200, launches),
      "performance-market-candle-count",
    ),
    accounts: safeCount(
      value.counts.accounts,
      100,
      "performance-account-count",
    ),
    rewardRows: safeCount(
      value.counts.rewardRows,
      Math.max(200, launches),
      "performance-reward-row-count",
    ),
  });
  const releaseCounts = exactReleaseCounts(value.releaseCounts);
  const releaseTotal = RELEASE_VERSIONS.reduce(
    (total, releaseVersion) => total + releaseCounts[releaseVersion],
    0,
  );
  const classicTotal =
    releaseCounts["classic-v2"] + releaseCounts["classic-v3"];
  const stockTotal =
    releaseCounts["stock-paired-v1"] +
    releaseCounts["stock-paired-v2"] +
    releaseCounts["stock-paired-v3"];
  if (
    releaseTotal !== launches ||
    classicTotal < 32 ||
    classicTotal > 300 ||
    stockTotal < 32 ||
    stockTotal > 100
  ) {
    return captureValidationFailure("performance-release-coverage");
  }
  const eligibleLaunches = exactEligibleLaunches(
    value.eligibleLaunches,
    launches,
  );
  for (const releaseVersion of RELEASE_VERSIONS) {
    if (
      eligibleLaunches.filter(
        (launch) => launch.releaseVersion === releaseVersion,
      ).length !== releaseCounts[releaseVersion]
    ) {
      return captureValidationFailure("performance-release-coverage");
    }
  }
  const keys = Object.freeze({
    tokenAddresses: exactAddresses(
      value.keys.tokenAddresses,
      "performance-token-keys",
      contract.tokenKeyCount,
    ),
    accountAddresses: exactAddresses(
      value.keys.accountAddresses,
      "performance-account-keys",
      REQUIRED_KEY_COUNT,
    ),
    classicLaunches: exactLaunches(
      value.keys.classicLaunches,
      "performance-classic-launch-keys",
    ),
    stockLaunches: exactLaunches(
      value.keys.stockLaunches,
      "performance-stock-launch-keys",
    ),
    candidateIds: exactCandidateIds(
      value.keys.candidateIds,
      contract.candidateCount,
    ),
  });
  return Object.freeze({
    generatedAt: exactTimestamp(value.generatedAt),
    counts,
    releaseCounts,
    eligibleLaunches,
    accountEvidence: exactAccountEvidence(
      value.accountEvidence,
      keys.accountAddresses,
      counts,
    ),
    keys,
  });
}

const ACCESS_EVIDENCE_KEYS = Object.freeze([
  "projectorSessionUser",
  "projectorCurrentRole",
  "projectorCurrentSettingRole",
  "apiReaderSessionUser",
  "apiReaderCurrentRole",
  "apiReaderCurrentSettingRole",
  "apiReaderDeniedSqlstate",
  "apiReaderFunctionExecute",
  "apiReaderViewSelect",
] as const);

function validateAccessEvidence(value: unknown): PerformanceAccessEvidence {
  if (
    !isRecord(value) ||
    !onlyKeys(value, ACCESS_EVIDENCE_KEYS) ||
    value.projectorSessionUser !== PROJECTOR_LOGIN_ROLE ||
    value.projectorCurrentRole !== PROJECTOR_CAPABILITY_ROLE ||
    value.projectorCurrentSettingRole !== PROJECTOR_CAPABILITY_ROLE ||
    value.apiReaderSessionUser !== API_READER_LOGIN_ROLE ||
    value.apiReaderCurrentRole !== API_READER_CAPABILITY_ROLE ||
    value.apiReaderCurrentSettingRole !== API_READER_CAPABILITY_ROLE ||
    value.apiReaderDeniedSqlstate !== PERMISSION_DENIED_SQLSTATE ||
    value.apiReaderFunctionExecute !== false ||
    value.apiReaderViewSelect !== false
  ) {
    return captureValidationFailure("performance-access-evidence");
  }
  return Object.freeze({
    projectorSessionUser: PROJECTOR_LOGIN_ROLE,
    projectorCurrentRole: PROJECTOR_CAPABILITY_ROLE,
    projectorCurrentSettingRole: PROJECTOR_CAPABILITY_ROLE,
    apiReaderSessionUser: API_READER_LOGIN_ROLE,
    apiReaderCurrentRole: API_READER_CAPABILITY_ROLE,
    apiReaderCurrentSettingRole: API_READER_CAPABILITY_ROLE,
    apiReaderDeniedSqlstate: PERMISSION_DENIED_SQLSTATE,
    apiReaderFunctionExecute: false,
    apiReaderViewSelect: false,
  });
}

function sqlState(error: unknown): string | null {
  if (error === null || typeof error !== "object") return null;
  const code = Reflect.get(error, "code");
  return typeof code === "string" && /^[0-9A-Z]{5}$/u.test(code)
    ? code
    : null;
}

function exactDatabaseIdentity(
  rows: readonly Record<string, unknown>[],
  expectedSessionUser: string,
  expectedCurrentRole: string,
  operation: string,
) {
  if (
    rows.length !== 1 ||
    rows[0]?.session_user !== expectedSessionUser ||
    rows[0]?.current_role !== expectedCurrentRole ||
    rows[0]?.current_setting_role !== expectedCurrentRole
  ) {
    return captureValidationFailure(operation);
  }
  return Object.freeze({
    sessionUser: expectedSessionUser,
    currentRole: expectedCurrentRole,
    currentSettingRole: expectedCurrentRole,
  });
}

async function readApiReaderDenialEvidence(
  executor: PostgresExecutor,
): Promise<Pick<
  PerformanceAccessEvidence,
  | "apiReaderSessionUser"
  | "apiReaderCurrentRole"
  | "apiReaderCurrentSettingRole"
  | "apiReaderDeniedSqlstate"
  | "apiReaderFunctionExecute"
  | "apiReaderViewSelect"
>> {
  return executor.transaction(async (transaction) => {
    await transaction.query(
      "set transaction isolation level repeatable read, read only",
    );
    await transaction.query("set local role programmable_api_reader");
    await transaction.query("set local statement_timeout = '5000ms'");
    await transaction.query("set local lock_timeout = '250ms'");
    await transaction.query(
      "set local idle_in_transaction_session_timeout = '6000ms'",
    );
    const identity = exactDatabaseIdentity(
      await transaction.query(
        "select session_user::text as session_user, current_role::text as current_role, current_setting('role', true)::text as current_setting_role",
      ),
      API_READER_LOGIN_ROLE,
      API_READER_CAPABILITY_ROLE,
      "performance-api-reader-role",
    );
    const privilegeRows = await transaction.query<{
      function_execute: unknown;
      view_select: unknown;
    }>(
      "select has_function_privilege(current_user, 'programmable_private.get_read_model_performance_dataset_v1(bigint)'::regprocedure, 'EXECUTE') as function_execute, has_table_privilege(current_user, 'programmable_private.read_model_performance_eligible_launches_v1', 'SELECT') as view_select",
    );
    if (
      privilegeRows.length !== 1 ||
      privilegeRows[0]?.function_execute !== false ||
      privilegeRows[0]?.view_select !== false
    ) {
      return captureValidationFailure("performance-api-reader-privilege");
    }

    await transaction.query("savepoint performance_api_reader_denial");
    let deniedSqlstate: string | null = null;
    try {
      await transaction.query(
        "select * from programmable_private.get_read_model_performance_dataset_v1($1)",
        ["1"],
      );
    } catch (error) {
      deniedSqlstate = sqlState(error);
    }
    await transaction.query("rollback to savepoint performance_api_reader_denial");
    await transaction.query("release savepoint performance_api_reader_denial");
    if (deniedSqlstate !== PERMISSION_DENIED_SQLSTATE) {
      return captureValidationFailure("performance-api-reader-denial");
    }
    return Object.freeze({
      apiReaderSessionUser: identity.sessionUser as typeof API_READER_LOGIN_ROLE,
      apiReaderCurrentRole: identity.currentRole as typeof API_READER_CAPABILITY_ROLE,
      apiReaderCurrentSettingRole:
        identity.currentSettingRole as typeof API_READER_CAPABILITY_ROLE,
      apiReaderDeniedSqlstate: PERMISSION_DENIED_SQLSTATE,
      apiReaderFunctionExecute: false as const,
      apiReaderViewSelect: false as const,
    });
  });
}

export async function readPerformanceDataset(
  env: Environment,
  dependencies: Readonly<{
    createExecutor?: typeof createPostgresExecutor;
  }> = {},
): Promise<PerformanceDatasetCapture> {
  const config = loadDataPipelineConfig(env);
  if (
    !config.postgres.connectionString ||
    !config.postgres.sslCaPem ||
    env.NEXT_PUBLIC_PROGRAMMABLE_PROJECTOR_DATABASE_URL
  ) {
    return captureInputFailure();
  }
  let projectorConnectionString: string;
  try {
    projectorConnectionString = validatedPostgresConnectionString(
      env.PROGRAMMABLE_PROJECTOR_DATABASE_URL,
    );
  } catch {
    return captureInputFailure();
  }
  const createExecutor = dependencies.createExecutor ?? createPostgresExecutor;
  const projectorExecutor = createExecutor({
    connectionString: projectorConnectionString,
    sslCaPem: config.postgres.sslCaPem,
    maxConnections: 1,
    connectTimeoutMs: config.postgres.connectTimeoutMs,
    idleTimeoutMs: config.postgres.idleTimeoutMs,
  });
  const readerExecutor = createExecutor({
    connectionString: config.postgres.connectionString,
    sslCaPem: config.postgres.sslCaPem,
    maxConnections: 1,
    connectTimeoutMs: config.postgres.connectTimeoutMs,
    idleTimeoutMs: config.postgres.idleTimeoutMs,
  });
  try {
    const projectorCapture = await projectorExecutor.transaction(
      async (transaction) => {
      await transaction.query(
        "set transaction isolation level repeatable read, read only",
      );
      await transaction.query("set local role programmable_projector");
      await transaction.query("set local statement_timeout = '5000ms'");
      await transaction.query("set local lock_timeout = '250ms'");
      await transaction.query(
        "set local idle_in_transaction_session_timeout = '6000ms'",
      );
      const identity = exactDatabaseIdentity(
        await transaction.query(
          "select session_user::text as session_user, current_role::text as current_role, current_setting('role', true)::text as current_setting_role",
        ),
        PROJECTOR_LOGIN_ROLE,
        PROJECTOR_CAPABILITY_ROLE,
        "performance-projector-role",
      );
      const rows = await transaction.query(
          "select * from programmable_private.get_read_model_performance_dataset_v1($1)",
          ["1"],
        );
        return Object.freeze({ identity, rows });
      },
    );
    const rows = projectorCapture.rows;
    if (rows.length !== 1) {
      return captureValidationFailure("performance-dataset-row");
    }
    const row = rows[0]!;
    const launchCount = safeCount(
      row.launch_count,
      SMOKE_CAPTURE_CONTRACT.minimumEligibleLaunches,
      "performance-launch-count",
    );
    if (
      safeCount(
        row.eligible_launch_count,
        SMOKE_CAPTURE_CONTRACT.minimumEligibleLaunches,
        "performance-eligible-launch-count",
      ) !== launchCount ||
      safeCount(
        row.candidate_count,
        SMOKE_CAPTURE_CONTRACT.candidateCount,
        "performance-candidate-count",
      ) !== SMOKE_CAPTURE_CONTRACT.candidateCount
    ) {
      return captureValidationFailure("performance-dataset-counts");
    }
    const dataset = validateDatasetSeed({
      generatedAt:
        row.generated_at instanceof Date
          ? row.generated_at.toISOString()
          : row.generated_at,
      counts: {
        launches: launchCount,
        chainEvents: row.chain_event_count,
        marketSnapshots: row.market_snapshot_count,
        marketCandles: row.market_candle_count,
        accounts: row.account_count,
        rewardRows: row.reward_row_count,
      },
      releaseCounts: row.release_coverage,
      eligibleLaunches: row.eligible_launches,
      accountEvidence: row.account_evidence,
      keys: {
        tokenAddresses: row.token_addresses,
        accountAddresses: row.account_addresses,
        classicLaunches: row.classic_launches,
        stockLaunches: row.stock_launches,
        candidateIds: row.candidate_ids,
      },
    }, SMOKE_CAPTURE_CONTRACT);
    const readerEvidence = await readApiReaderDenialEvidence(readerExecutor);
    return Object.freeze({
      dataset,
      accessEvidence: validateAccessEvidence({
        projectorSessionUser: projectorCapture.identity.sessionUser,
        projectorCurrentRole: projectorCapture.identity.currentRole,
        projectorCurrentSettingRole:
          projectorCapture.identity.currentSettingRole,
        ...readerEvidence,
      }),
    });
  } catch (error) {
    if (error instanceof DataPipelineError) throw error;
    throw dataPipelineError({
      dependency: "postgres",
      code: "query_failed",
      retryable: true,
      countsTowardCircuit: true,
    });
  } finally {
    await Promise.allSettled([
      projectorExecutor.close(),
      readerExecutor.close(),
    ]);
  }
}

async function runProductionRpcTrace(input: {
  providers: readonly [CandidateRpcProvider, CandidateRpcProvider];
  env: Environment;
  contract: CaptureContract;
  work: () => Promise<unknown>;
}): Promise<RpcTraceCapture> {
  void input.providers;
  void input.env;
  const result = await input.work();
  if (
    !isRecord(result) ||
    !Array.isArray(result.candidates) ||
    result.candidates.length !== input.contract.candidateCount ||
    !isRecord(result.executionTrace)
  ) {
    return captureValidationFailure("performance-native-rpc-trace");
  }
  return Object.freeze({
    ...(result.executionTrace as Omit<RpcTraceCapture, "candidateEvidence">),
    candidateEvidence: Object.freeze(
      result.candidates.map((candidate) => {
        if (!isRecord(candidate)) {
          return captureValidationFailure("performance-rpc-candidate-evidence");
        }
        return Object.freeze({
          candidateId: candidate.candidateId,
          candidateBlockNumber: candidate.candidateBlockNumber,
          candidateBlockHash: candidate.candidateBlockHash,
          transactionHash: candidate.transactionHash,
          sourceAddress: candidate.sourceAddress,
        }) as RpcCandidateEvidence;
      }),
    ),
  });
}

function safeTraceInteger(value: unknown, maximum: number, operation: string) {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > maximum
  ) {
    return captureValidationFailure(operation);
  }
  return value;
}

function validateTrace(
  trace: RpcTraceCapture,
  providers: readonly [CandidateRpcProvider, CandidateRpcProvider],
  expectedCandidateIds: readonly string[],
  contract: CaptureContract,
): RpcTraceCapture {
  const startedAtMs = safeTraceInteger(
    trace.startedAtMs,
    Number.MAX_SAFE_INTEGER,
    "performance-rpc-started-at",
  );
  const completedAtMs = safeTraceInteger(
    trace.completedAtMs,
    Number.MAX_SAFE_INTEGER,
    "performance-rpc-completed-at",
  );
  const elapsedMs = safeTraceInteger(
    trace.elapsedMs,
    HARD_DEADLINE_MS,
    "performance-rpc-elapsed",
  );
  if (
    completedAtMs < startedAtMs ||
    completedAtMs - startedAtMs !== elapsedMs ||
    trace.candidateBatchSize !== contract.candidateCount ||
    trace.hardDeadlineMs !== HARD_DEADLINE_MS ||
    trace.maxCallsPerProvider !== contract.maximumCallsPerProvider ||
    !Array.isArray(trace.providerCallCounts) ||
    trace.providerCallCounts.length !== 2 ||
    !Array.isArray(trace.calls) ||
    !Array.isArray(trace.candidateEvidence) ||
    trace.candidateEvidence.length !== contract.candidateCount ||
    providers.length !== 2
  ) {
    return captureValidationFailure("performance-rpc-trace");
  }
  const byIdentity = new Map(providers.map((provider) => [provider.identity, provider]));
  const calls = trace.calls.map((call) => {
    const provider = byIdentity.get(call.providerIdentity);
    if (
      !provider ||
      call.providerVendorGroup !== provider.vendorGroup ||
      call.providerEndpointCommitment !== provider.endpointCommitment ||
      call.providerOriginCommitment !== provider.endpointOriginCommitment ||
      ![
        "getChainId",
        "getBlockNumber",
        "getBlock",
        "getTransactionReceipt",
        "getBytecode",
      ].includes(call.operation) ||
      (call.outcome !== "success" && call.outcome !== "error")
    ) {
      return captureValidationFailure("performance-rpc-call");
    }
    return Object.freeze({
      ...call,
      attempt: safeTraceInteger(call.attempt, 128, "performance-rpc-attempt"),
      startedOffsetMs: safeTraceInteger(
        call.startedOffsetMs,
        elapsedMs,
        "performance-rpc-start",
      ),
      durationMs: safeTraceInteger(
        call.durationMs,
        HARD_DEADLINE_MS,
        "performance-rpc-duration",
      ),
    });
  });
  let total = 0;
  const counts: [number, number] = [0, 0];
  const expectedSuccessCounts = Object.freeze({
    getChainId: 1,
    getBlockNumber: 1,
    getBlock: contract.candidateCount + 1,
    getTransactionReceipt: contract.candidateCount,
    getBytecode: contract.candidateCount,
  });
  for (const [index, provider] of providers.entries()) {
    const count = safeTraceInteger(
      trace.providerCallCounts[index],
      contract.maximumCallsPerProvider,
      "performance-rpc-count",
    );
    if (count < 1) return captureValidationFailure("performance-rpc-count");
    counts[index] = count;
    total += count;
    for (const [operation, expected] of Object.entries(expectedSuccessCounts)) {
      const successful = calls.filter(
        (call) =>
          call.providerIdentity === provider.identity &&
          call.operation === operation &&
          call.outcome === "success",
      ).length;
      if (successful !== expected) {
        return captureValidationFailure("performance-rpc-operation-count");
      }
    }
  }
  if (total !== calls.length) {
    return captureValidationFailure("performance-rpc-count");
  }
  const candidateEvidence = trace.candidateEvidence.map((candidate, index) => {
    if (!isRecord(candidate)) {
      return captureValidationFailure("performance-rpc-candidate-evidence");
    }
    const candidateId = candidate.candidateId;
    const idMatch =
      typeof candidateId === "string"
        ? CANDIDATE_ID_PATTERN.exec(candidateId)
        : null;
    let candidateBlockNumber: string;
    let candidateBlockHash: HexBytes32;
    let transactionHash: HexBytes32;
    let sourceAddress: HexAddress;
    try {
      candidateBlockNumber = parseNonnegativeIntegerText(
        candidate.candidateBlockNumber,
      );
      candidateBlockHash = canonicalBytes32(candidate.candidateBlockHash);
      transactionHash = canonicalBytes32(candidate.transactionHash);
      sourceAddress = canonicalAddress(candidate.sourceAddress);
    } catch {
      return captureValidationFailure("performance-rpc-candidate-evidence");
    }
    if (
      !idMatch ||
      candidateId !== expectedCandidateIds[index] ||
      idMatch[1] !== candidateBlockHash ||
      idMatch[2] !== transactionHash ||
      candidate.candidateBlockNumber !== candidateBlockNumber ||
      candidate.candidateBlockHash !== candidateBlockHash ||
      candidate.transactionHash !== transactionHash ||
      candidate.sourceAddress !== sourceAddress
    ) {
      return captureValidationFailure("performance-rpc-candidate-evidence");
    }
    return Object.freeze({
      candidateId,
      candidateBlockNumber,
      candidateBlockHash,
      transactionHash,
      sourceAddress,
    });
  });
  if (
    new Set(candidateEvidence.map(({ candidateId }) => candidateId)).size !==
      contract.candidateCount ||
    new Set(
      candidateEvidence.map(({ candidateBlockNumber }) => candidateBlockNumber),
    ).size !== contract.candidateCount ||
    new Set(candidateEvidence.map(({ transactionHash }) => transactionHash))
      .size !== contract.candidateCount ||
    new Set(
      candidateEvidence.map(
        ({ candidateBlockNumber, sourceAddress }) =>
          `${candidateBlockNumber}:${sourceAddress}`,
      ),
    ).size !== contract.candidateCount ||
    candidateEvidence.some(
      ({ candidateBlockNumber }, index) =>
        index > 0 &&
        BigInt(candidateBlockNumber) <=
          BigInt(candidateEvidence[index - 1]!.candidateBlockNumber),
    )
  ) {
    return captureValidationFailure("performance-rpc-candidate-coverage");
  }
  return Object.freeze({
    startedAtMs,
    completedAtMs,
    candidateBatchSize: contract.candidateCount,
    hardDeadlineMs: HARD_DEADLINE_MS,
    maxCallsPerProvider: contract.maximumCallsPerProvider,
    elapsedMs,
    providerCallCounts: Object.freeze(counts),
    calls: Object.freeze(calls),
    candidateEvidence: Object.freeze(candidateEvidence),
  });
}

async function withDeadline<T>(
  hardDeadlineMs: number,
  work: () => Promise<T>,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () =>
            reject(
              dataPipelineError({
                dependency: "rpc",
                code: "timeout",
                retryable: true,
                countsTowardCircuit: true,
              }),
            ),
          hardDeadlineMs,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export type PerformanceCaptureDependencies = Readonly<{
  readDataset(env: Environment): Promise<PerformanceDatasetCapture>;
  createEnvio: typeof createEnvioClient;
  createProviders: typeof createProductionDualRpcProviders;
  verifyBatch: typeof verifyEnvioCandidateBatchWithDualRpc;
  runRpcTrace: typeof runProductionRpcTrace;
}>;

const DEFAULT_DEPENDENCIES: PerformanceCaptureDependencies = Object.freeze({
  readDataset: readPerformanceDataset,
  createEnvio: createEnvioClient,
  createProviders: createProductionDualRpcProviders,
  verifyBatch: verifyEnvioCandidateBatchWithDualRpc,
  runRpcTrace: runProductionRpcTrace,
});

async function readReleaseCandidates(
  envio: ReturnType<typeof createEnvioClient>,
): Promise<readonly EnvioCandidate[]> {
  const selected: EnvioCandidate[] = [];
  const seenBlocks = new Set<string>();
  let cursor: EnvioCandidateCursor = Object.freeze({
    blockNumber: "0",
    blockGlobalLogIndex: -1,
    candidateId: "",
  });
  for (let pageIndex = 0; pageIndex < 16; pageIndex += 1) {
    const page = await envio.readCandidatesAfter({ cursor, limit: 32 });
    if (page.length === 0) break;
    for (const candidate of page) {
      if (!seenBlocks.has(candidate.blockNumber)) {
        seenBlocks.add(candidate.blockNumber);
        selected.push(candidate);
      }
      if (selected.length === RELEASE_CAPTURE_CONTRACT.candidateCount) {
        return Object.freeze(selected);
      }
    }
    const last = page.at(-1)!;
    cursor = Object.freeze({
      blockNumber: last.blockNumber,
      blockGlobalLogIndex: last.blockGlobalLogIndex,
      candidateId: last.candidateId,
    });
    if (page.length < 32) break;
  }
  return captureValidationFailure("performance-release-candidate-corpus");
}

function releaseDataset(
  seed: PerformanceDatasetSeed,
  candidates: readonly EnvioCandidate[],
): PerformanceDatasetSeed {
  const tokenAddresses = [...new Set(
    seed.eligibleLaunches.map(({ tokenAddress }) => tokenAddress),
  )]
    .sort()
    .slice(0, RELEASE_CAPTURE_CONTRACT.tokenKeyCount);
  return validateDatasetSeed(
    {
      ...seed,
      keys: {
        ...seed.keys,
        tokenAddresses,
        candidateIds: candidates.map(({ candidateId }) => candidateId),
      },
    },
    RELEASE_CAPTURE_CONTRACT,
  );
}

export async function captureReadModelPerformance(
  requestBody: unknown,
  options: Readonly<{
    env?: Environment;
    dependencies?: PerformanceCaptureDependencies;
  }> = {},
) {
  const env = options.env ?? process.env;
  const dependencies = options.dependencies ?? DEFAULT_DEPENDENCIES;
  const request = parseReadModelPerformanceCaptureRequest(requestBody, env);
  const contract =
    request.profileId === RELEASE_PROFILE_ID
      ? RELEASE_CAPTURE_CONTRACT
      : SMOKE_CAPTURE_CONTRACT;
  const capturedDataset = await dependencies.readDataset(env);
  const accessEvidence = validateAccessEvidence(
    capturedDataset.accessEvidence,
  );
  let dataset: PerformanceDatasetSeed | undefined;
  if (contract === SMOKE_CAPTURE_CONTRACT) {
    dataset = validateDatasetSeed(
      capturedDataset.dataset,
      SMOKE_CAPTURE_CONTRACT,
    );
  }
  const envioConfig = loadDataPipelineConfig(env).envio;
  if (!envioConfig.endpoint) return captureInputFailure();
  const envio = dependencies.createEnvio({
    endpoint: envioConfig.endpoint,
    token: envioConfig.token,
  });
  const providers = dependencies.createProviders(env);
  const deadlineStartedAt = Date.now();

  const trace = await withDeadline(HARD_DEADLINE_MS, async () => {
    let freshCandidates: readonly EnvioCandidate[];
    if (contract === RELEASE_CAPTURE_CONTRACT) {
      const candidates = await readReleaseCandidates(envio);
      dataset = releaseDataset(capturedDataset.dataset, candidates);
      freshCandidates = candidates;
    } else {
      const candidates = await Promise.all(
        dataset!.keys.candidateIds.map((candidateId) =>
          envio.readCandidate(candidateId),
        ),
      );
      freshCandidates = candidates.map((candidate, index) => {
        if (
          candidate === null ||
          candidate.candidateId !== dataset!.keys.candidateIds[index]
        ) {
          return captureValidationFailure("performance-envio-candidate");
        }
        return candidate;
      });
    }
    const remaining = HARD_DEADLINE_MS - (Date.now() - deadlineStartedAt);
    if (remaining < 10) {
      return captureValidationFailure("performance-rpc-deadline");
    }
    const rpcTrace = await dependencies.runRpcTrace({
      providers,
      env,
      contract,
      work: async () => {
        return dependencies.verifyBatch({
          candidates: freshCandidates,
          providers,
          rpcPolicy: {
            hardDeadlineMs: remaining,
            maxCallsPerProvider: contract.maximumCallsPerProvider,
          },
        });
      },
    });
    return rpcTrace;
  });
  const validatedTrace = validateTrace(
    trace,
    providers,
    dataset!.keys.candidateIds,
    contract,
  );
  return Object.freeze({
    schemaVersion: 1 as const,
    captureNonce: request.captureNonce,
    datasetManifest: Object.freeze({
      schemaVersion: 1 as const,
      profileId: contract.profileId,
      generatedAt: dataset!.generatedAt,
      counts: dataset!.counts,
      releaseCounts: dataset!.releaseCounts,
      eligibleLaunches: dataset!.eligibleLaunches,
      accountEvidence: dataset!.accountEvidence,
      keys: dataset!.keys,
      accessEvidence,
    }),
    rpcTrace: Object.freeze({
      schemaVersion: 1 as const,
      profileId: contract.profileId,
      gitHead: request.gitHead,
      targetUrl: request.targetUrl,
      vercelDeploymentId: request.vercelDeploymentId,
      captureNonce: request.captureNonce,
      startedAtMs: validatedTrace.startedAtMs,
      completedAtMs: validatedTrace.completedAtMs,
      candidateBatchSize: contract.candidateCount,
      hardDeadlineMs: HARD_DEADLINE_MS,
      maxCallsPerProvider: contract.maximumCallsPerProvider,
      elapsedMs: validatedTrace.elapsedMs,
      providerCallCounts: validatedTrace.providerCallCounts,
      calls: validatedTrace.calls,
      candidateEvidence: validatedTrace.candidateEvidence,
    }),
  });
}
