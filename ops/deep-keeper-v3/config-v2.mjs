import { getAddress } from "viem";

export const DEEP_V3_KEEPER_V2_RELEASE =
  "deep-keeper-v3-ops-v2";
export const DEEP_V3_KEEPER_V2_CONTROL_PATH =
  "ops/deep-keeper-v3/control-v2.json";
export const DEEP_V3_KEEPER_V2_LEGACY_CONTROL_PATH =
  "ops/deep-keeper-v3/control-v1.json";
export const DEEP_V3_KEEPER_V2_MANIFEST_PATH =
  "contracts/deployments/mainnet-deep-full-range-v3.json";
export const DEEP_V3_KEEPER_V2_INTERVAL_MS = 300_000;
export const DEEP_V3_KEEPER_V2_SCAN_PAGE_SIZE = 32;
export const DEEP_V3_KEEPER_V2_MAX_SCAN_PAGES = 2;
export const DEEP_V3_KEEPER_V2_MAX_CANDIDATES = 4;
export const DEEP_V3_KEEPER_V2_MAX_NEW_SUBMISSIONS = 1;
export const DEEP_V3_KEEPER_V2_MAX_ACTIVE_PENDING = 8;
export const DEEP_V3_KEEPER_V2_MAX_OPERATOR_INCIDENTS = 8;
export const DEEP_V3_KEEPER_V2_MAX_HISTORY = 64;
export const DEEP_V3_KEEPER_V2_CONFIRMATIONS = 12;
export const DEEP_V3_KEEPER_V2_MAX_TRANSACTION_GAS =
  18_000_000n;
export const DEEP_V3_KEEPER_V2_MAX_TOTAL_GAS_PER_TICK =
  18_000_000n;
export const DEEP_V3_KEEPER_V2_MAX_COMPOUND_NATIVE =
  250_000_000_000_000_000n;
export const DEEP_V3_KEEPER_V2_ABSENT_GRACE_MS =
  30 * 60 * 1_000;
export const DEEP_V3_KEEPER_V2_SAFE_REPLAY_MS =
  23 * 60 * 60 * 1_000;
export const DEEP_V3_KEEPER_V2_REPLAY_COOLDOWN_MS =
  30 * 60 * 1_000;
export const DEEP_V3_KEEPER_V2_MAX_SIGNER_REQUEST_LIFETIME_MS =
  95_000;

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const PRIVATE_KEY_ENV_NAMES = [
  "DEEP_V3_KEEPER_V2_PRIVATE_KEY",
  "DEEP_V3_KEEPER_V2_MNEMONIC",
  "DEEP_V3_KEEPER_PRIVATE_KEY",
  "DEEP_V3_KEEPER_MNEMONIC",
  "DEEP_V3_PRIVATE_KEY",
  "DEEP_V3_MNEMONIC",
  "DEEP_KEEPER_PRIVATE_KEY",
  "DEEP_KEEPER_MNEMONIC",
  "PRIVATE_KEY",
  "MNEMONIC",
];

export class DeepV3KeeperV2ConfigError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "DeepV3KeeperV2ConfigError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new DeepV3KeeperV2ConfigError(code, message);
}

function exactBoolean(value, label) {
  if (value === undefined || value === "") return false;
  if (value === "true") return true;
  if (value === "false") return false;
  fail("INVALID_CONFIG", `${label} must be exactly true or false`);
}

function requiredAddress(value, label) {
  if (!ADDRESS_PATTERN.test(value ?? "")) {
    fail("INVALID_CONFIG", `${label} must be an address`);
  }
  return getAddress(value);
}

function optionalAddress(value, label) {
  if (value === undefined || value === "") return null;
  return requiredAddress(value, label);
}

function requiredHash(value, label) {
  if (!HASH_PATTERN.test(value ?? "")) {
    fail("INVALID_CONFIG", `${label} must be 32 bytes`);
  }
  return value.toLowerCase();
}

function requiredHttpsUrl(value, label) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") throw new Error();
    return parsed.toString();
  } catch {
    fail("INVALID_CONFIG", `${label} must be an HTTPS URL`);
  }
}

function optionalUnsignedBigInt(value, label) {
  if (value === undefined || value === "") return 0n;
  try {
    const parsed = BigInt(value);
    if (parsed < 0n) throw new Error();
    return parsed;
  } catch {
    fail("INVALID_CONFIG", `${label} must be an unsigned integer`);
  }
}

function optionalUnsignedInteger(value, label) {
  if (value === undefined || value === "") return 0;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    fail("INVALID_CONFIG", `${label} must be an unsigned integer`);
  }
  return parsed;
}

function requireExactInteger(value, expected, label) {
  const parsed =
    value === undefined || value === "" ? expected : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed !== expected) {
    fail("INVALID_CONFIG", `${label} must be exactly ${expected}`);
  }
  return parsed;
}

function requireEconomicPolicy(config) {
  if (!config.enabled) return;
  const missing =
    config.minGrowthToMaxGasRatioBps === 0 ||
    config.maxFeePerGasWei === 0n ||
    config.maxTotalDebitWeiPerTick === 0n ||
    config.maxTotalDebitWeiPerDay === 0n ||
    config.signerBalanceFloorWei === 0n;
  if (missing) {
    fail(
      "ECONOMIC_POLICY_DISABLED",
      "Enabled execution requires every reviewed economic liveness limit",
    );
  }
  if (
    config.maxTotalDebitWeiPerDay <
    config.maxTotalDebitWeiPerTick
  ) {
    fail(
      "INVALID_CONFIG",
      "Daily maximum debit must cover at least one tick",
    );
  }
}

function deploymentCommit(env, enabled) {
  const vercelCommit = String(env.VERCEL_GIT_COMMIT_SHA ?? "")
    .trim()
    .toLowerCase();
  const configuredCommit = String(
    env.DEEP_V3_KEEPER_V2_DEPLOYMENT_COMMIT ?? "",
  )
    .trim()
    .toLowerCase();
  if (enabled && !vercelCommit) {
    fail(
      "INVALID_CONFIG",
      "Enabled execution requires VERCEL_GIT_COMMIT_SHA",
    );
  }
  if (
    vercelCommit &&
    configuredCommit &&
    vercelCommit !== configuredCommit
  ) {
    fail(
      "INVALID_CONFIG",
      "Configured deployment commit does not match VERCEL_GIT_COMMIT_SHA",
    );
  }
  const value = vercelCommit || configuredCommit;
  if (!value && !enabled) return null;
  if (!COMMIT_PATTERN.test(value)) {
    fail(
      "INVALID_CONFIG",
      "Enabled execution requires an immutable deployment commit",
    );
  }
  return value;
}

export function parseDeepV3KeeperV2Config(env = process.env) {
  for (const name of PRIVATE_KEY_ENV_NAMES) {
    if (env[name]) {
      fail(
        "PRIVATE_KEY_REJECTED",
        `${name} is not accepted; use the dedicated remote policy wallet`,
      );
    }
  }

  const legacyEnabled = exactBoolean(
    env.DEEP_V3_KEEPER_ENABLED,
    "DEEP_V3_KEEPER_ENABLED",
  );
  const legacySends = exactBoolean(
    env.DEEP_V3_KEEPER_SEND_TRANSACTIONS,
    "DEEP_V3_KEEPER_SEND_TRANSACTIONS",
  );
  const enabled = exactBoolean(
    env.DEEP_V3_KEEPER_V2_ENABLED,
    "DEEP_V3_KEEPER_V2_ENABLED",
  );
  const sendTransactions = exactBoolean(
    env.DEEP_V3_KEEPER_V2_SEND_TRANSACTIONS,
    "DEEP_V3_KEEPER_V2_SEND_TRANSACTIONS",
  );
  if (legacyEnabled || legacySends) {
    fail(
      "LEGACY_WRITER_ACTIVE",
      "The legacy Deep V3 writer must be disabled before ops v2",
    );
  }
  if (enabled !== sendTransactions) {
    fail(
      "INVALID_CONFIG",
      "Activation requires both ops v2 execution flags to match",
    );
  }

  const rpcUrls = String(env.DEEP_V3_KEEPER_V2_RPC_URLS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value, index) =>
      requiredHttpsUrl(
        value,
        `DEEP_V3_KEEPER_V2_RPC_URLS[${index}]`,
      ),
    );
  if (
    rpcUrls.length !== 2 ||
    new Set(rpcUrls).size !== 2 ||
    new URL(rpcUrls[0]).hostname ===
      new URL(rpcUrls[1]).hostname
  ) {
    fail(
      "INVALID_CONFIG",
      "DEEP_V3_KEEPER_V2_RPC_URLS must contain two independent HTTPS hosts",
    );
  }

  const signerAddress = optionalAddress(
    env.DEEP_V3_KEEPER_V2_SIGNER_ADDRESS,
    "DEEP_V3_KEEPER_V2_SIGNER_ADDRESS",
  );
  const privyWalletId =
    env.DEEP_V3_KEEPER_V2_PRIVY_WALLET_ID?.trim() || null;
  if (privyWalletId && !/^[a-z0-9]{24}$/.test(privyWalletId)) {
    fail(
      "INVALID_CONFIG",
      "DEEP_V3_KEEPER_V2_PRIVY_WALLET_ID must be a Privy wallet ID",
    );
  }
  if (enabled && (!signerAddress || !privyWalletId)) {
    fail(
      "INVALID_CONFIG",
      "Enabled execution requires the dedicated Privy policy wallet",
    );
  }

  const releaseManifest =
    env.DEEP_V3_KEEPER_V2_RELEASE_MANIFEST ??
    DEEP_V3_KEEPER_V2_MANIFEST_PATH;
  if (releaseManifest !== DEEP_V3_KEEPER_V2_MANIFEST_PATH) {
    fail(
      "INVALID_CONFIG",
      `DEEP_V3_KEEPER_V2_RELEASE_MANIFEST must be ${DEEP_V3_KEEPER_V2_MANIFEST_PATH}`,
    );
  }

  const config = {
    releaseVersion: DEEP_V3_KEEPER_V2_RELEASE,
    controlPath: DEEP_V3_KEEPER_V2_CONTROL_PATH,
    legacyControlPath: DEEP_V3_KEEPER_V2_LEGACY_CONTROL_PATH,
    enabled,
    sendTransactions,
    legacyEnabled,
    legacySends,
    deploymentCommit: deploymentCommit(env, enabled),
    chainId: requireExactInteger(
      env.DEEP_V3_KEEPER_V2_CHAIN_ID,
      1,
      "DEEP_V3_KEEPER_V2_CHAIN_ID",
    ),
    releaseManifest,
    automationAddress: requiredAddress(
      env.DEEP_V3_KEEPER_V2_AUTOMATION_ADDRESS,
      "DEEP_V3_KEEPER_V2_AUTOMATION_ADDRESS",
    ),
    automationRuntimeHash: requiredHash(
      env.DEEP_V3_KEEPER_V2_AUTOMATION_RUNTIME_HASH,
      "DEEP_V3_KEEPER_V2_AUTOMATION_RUNTIME_HASH",
    ),
    launcherAddress: requiredAddress(
      env.DEEP_V3_KEEPER_V2_LAUNCHER_ADDRESS,
      "DEEP_V3_KEEPER_V2_LAUNCHER_ADDRESS",
    ),
    launcherRuntimeHash: requiredHash(
      env.DEEP_V3_KEEPER_V2_LAUNCHER_RUNTIME_HASH,
      "DEEP_V3_KEEPER_V2_LAUNCHER_RUNTIME_HASH",
    ),
    vaultFactoryAddress: requiredAddress(
      env.DEEP_V3_KEEPER_V2_VAULT_FACTORY_ADDRESS,
      "DEEP_V3_KEEPER_V2_VAULT_FACTORY_ADDRESS",
    ),
    vaultFactoryRuntimeHash: requiredHash(
      env.DEEP_V3_KEEPER_V2_VAULT_FACTORY_RUNTIME_HASH,
      "DEEP_V3_KEEPER_V2_VAULT_FACTORY_RUNTIME_HASH",
    ),
    executorAddress: requiredAddress(
      env.DEEP_V3_KEEPER_V2_EXECUTOR_ADDRESS,
      "DEEP_V3_KEEPER_V2_EXECUTOR_ADDRESS",
    ),
    executorRuntimeHash: requiredHash(
      env.DEEP_V3_KEEPER_V2_EXECUTOR_RUNTIME_HASH,
      "DEEP_V3_KEEPER_V2_EXECUTOR_RUNTIME_HASH",
    ),
    sourceCommitment: requiredHash(
      env.DEEP_V3_KEEPER_V2_SOURCE_COMMITMENT,
      "DEEP_V3_KEEPER_V2_SOURCE_COMMITMENT",
    ),
    opsSourceCommitment: requiredHash(
      env.DEEP_V3_KEEPER_V2_OPS_SOURCE_COMMITMENT,
      "DEEP_V3_KEEPER_V2_OPS_SOURCE_COMMITMENT",
    ),
    rpcUrls: Object.freeze(rpcUrls),
    intervalMs: DEEP_V3_KEEPER_V2_INTERVAL_MS,
    scanPageSize: DEEP_V3_KEEPER_V2_SCAN_PAGE_SIZE,
    maxScanPages: DEEP_V3_KEEPER_V2_MAX_SCAN_PAGES,
    maxCandidatesPerBatch:
      DEEP_V3_KEEPER_V2_MAX_CANDIDATES,
    maxNewSubmissionsPerTick:
      DEEP_V3_KEEPER_V2_MAX_NEW_SUBMISSIONS,
    maxActivePendingBatches:
      DEEP_V3_KEEPER_V2_MAX_ACTIVE_PENDING,
    maxOperatorIncidents:
      DEEP_V3_KEEPER_V2_MAX_OPERATOR_INCIDENTS,
    maxHistoryEntries: DEEP_V3_KEEPER_V2_MAX_HISTORY,
    confirmations: DEEP_V3_KEEPER_V2_CONFIRMATIONS,
    maxTransactionGas:
      DEEP_V3_KEEPER_V2_MAX_TRANSACTION_GAS,
    maxTotalGasPerTick:
      DEEP_V3_KEEPER_V2_MAX_TOTAL_GAS_PER_TICK,
    maximumCompoundNativeWei:
      DEEP_V3_KEEPER_V2_MAX_COMPOUND_NATIVE,
    minGrowthToMaxGasRatioBps: optionalUnsignedInteger(
      env.DEEP_V3_KEEPER_V2_MIN_GROWTH_TO_MAX_GAS_RATIO_BPS,
      "DEEP_V3_KEEPER_V2_MIN_GROWTH_TO_MAX_GAS_RATIO_BPS",
    ),
    maxFeePerGasWei: optionalUnsignedBigInt(
      env.DEEP_V3_KEEPER_V2_MAX_FEE_PER_GAS_WEI,
      "DEEP_V3_KEEPER_V2_MAX_FEE_PER_GAS_WEI",
    ),
    maxTotalDebitWeiPerTick: optionalUnsignedBigInt(
      env.DEEP_V3_KEEPER_V2_MAX_TOTAL_DEBIT_WEI_PER_TICK,
      "DEEP_V3_KEEPER_V2_MAX_TOTAL_DEBIT_WEI_PER_TICK",
    ),
    maxTotalDebitWeiPerDay: optionalUnsignedBigInt(
      env.DEEP_V3_KEEPER_V2_MAX_TOTAL_DEBIT_WEI_PER_DAY,
      "DEEP_V3_KEEPER_V2_MAX_TOTAL_DEBIT_WEI_PER_DAY",
    ),
    signerBalanceFloorWei: optionalUnsignedBigInt(
      env.DEEP_V3_KEEPER_V2_SIGNER_BALANCE_FLOOR_WEI,
      "DEEP_V3_KEEPER_V2_SIGNER_BALANCE_FLOOR_WEI",
    ),
    signerLanes: Object.freeze(
      signerAddress && privyWalletId
        ? [
            Object.freeze({
              id: "lane-0",
              partitionId: "partition-0",
              partitionIndex: 0,
              partitionCount: 1,
              signerAddress,
              privyWalletId,
            }),
          ]
        : [],
    ),
  };

  requireEconomicPolicy(config);
  if (config.minGrowthToMaxGasRatioBps > 10_000_000) {
    fail(
      "INVALID_CONFIG",
      "Growth-to-gas ratio exceeds the reviewed representation",
    );
  }
  if (
    signerAddress &&
    [
      config.automationAddress,
      config.launcherAddress,
      config.vaultFactoryAddress,
      config.executorAddress,
    ].some(
      (address) =>
        address.toLowerCase() === signerAddress.toLowerCase(),
    )
  ) {
    fail(
      "INVALID_CONFIG",
      "The signer must not be a protocol contract",
    );
  }

  return Object.freeze(config);
}
