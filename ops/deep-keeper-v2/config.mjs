import { getAddress } from "viem";

export const DEEP_V2_RELEASE_MANIFEST_PATH =
  "contracts/deployments/mainnet-deep-full-range-v2.json";
export const DEEP_V2_KEEPER_INTERVAL_MS = 300_000;
export const DEEP_V2_KEEPER_DEFAULT_MAX_BATCH_SIZE = 4;
export const DEEP_V2_KEEPER_MAX_OPERATIONAL_BATCH_SIZE = 8;
export const DEEP_V2_KEEPER_DEFAULT_MAX_GAS = 4_500_000n;
export const DEEP_V2_KEEPER_EXTENDED_BATCH_MIN_GAS = 9_000_000n;
export const DEEP_V2_KEEPER_DEFAULT_VAULT_SUBSIDY_CAP_WEI =
  30_000_000_000_000_000n;
export const DEEP_V2_KEEPER_DEFAULT_SIMULATION_ACCOUNT =
  "0x000000000000000000000000000000000000dEaD";

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const PRIVATE_KEY_ENV_NAMES = [
  "DEEP_V2_KEEPER_PRIVATE_KEY",
  "DEEP_V2_KEEPER_MNEMONIC",
  "DEEP_V2_PRIVATE_KEY",
  "DEEP_V2_MNEMONIC",
  "DEEP_KEEPER_PRIVATE_KEY",
  "DEEP_KEEPER_MNEMONIC",
  "PRIVATE_KEY",
  "MNEMONIC",
];

export class DeepV2KeeperConfigError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "DeepV2KeeperConfigError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new DeepV2KeeperConfigError(code, message);
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

function requiredHash(value, label) {
  if (!HASH_PATTERN.test(value ?? "")) {
    fail("INVALID_CONFIG", `${label} must be 32 bytes`);
  }
  return value.toLowerCase();
}

function integer(value, fallback, label, minimum, maximum) {
  const parsed = value === undefined || value === "" ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    fail(
      "INVALID_CONFIG",
      `${label} must be an integer from ${minimum} to ${maximum}`,
    );
  }
  return parsed;
}

function positiveBigInt(value, fallback, label) {
  const raw = value === undefined || value === "" ? fallback : value;
  try {
    const parsed = BigInt(raw);
    if (parsed <= 0n) throw new Error();
    return parsed;
  } catch {
    fail("INVALID_CONFIG", `${label} must be a positive integer`);
  }
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

/**
 * Parses only the Deep V2 namespace. This intentionally does not fall back to
 * V1 variables, so the two release lines cannot be cross-wired by deployment
 * configuration.
 */
export function parseDeepV2KeeperConfig(env = process.env) {
  for (const name of PRIVATE_KEY_ENV_NAMES) {
    if (env[name]) {
      fail(
        "PRIVATE_KEY_REJECTED",
        `${name} is not accepted; use a dedicated remote policy wallet`,
      );
    }
  }

  const enabled = exactBoolean(
    env.DEEP_V2_KEEPER_ENABLED,
    "DEEP_V2_KEEPER_ENABLED",
  );
  const sendTransactions = exactBoolean(
    env.DEEP_V2_KEEPER_SEND_TRANSACTIONS,
    "DEEP_V2_KEEPER_SEND_TRANSACTIONS",
  );
  if (enabled !== sendTransactions) {
    fail(
      "INVALID_CONFIG",
      "Activation requires both DEEP_V2_KEEPER_ENABLED=true and DEEP_V2_KEEPER_SEND_TRANSACTIONS=true",
    );
  }

  const chainId = integer(
    env.DEEP_V2_KEEPER_CHAIN_ID,
    1,
    "DEEP_V2_KEEPER_CHAIN_ID",
    1,
    Number.MAX_SAFE_INTEGER,
  );
  if (chainId !== 1) {
    fail(
      "INVALID_CONFIG",
      "The production Deep V2 keeper is pinned to Ethereum Mainnet",
    );
  }

  const rpcUrls = String(env.DEEP_V2_KEEPER_RPC_URLS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value, index) =>
      requiredHttpsUrl(value, `DEEP_V2_KEEPER_RPC_URLS[${index}]`),
    );
  if (rpcUrls.length !== 2 || new Set(rpcUrls).size !== 2) {
    fail(
      "INVALID_CONFIG",
      "DEEP_V2_KEEPER_RPC_URLS must contain two distinct HTTPS endpoints",
    );
  }
  if (new URL(rpcUrls[0]).hostname === new URL(rpcUrls[1]).hostname) {
    fail(
      "INVALID_CONFIG",
      "DEEP_V2_KEEPER_RPC_URLS must use independent RPC hosts",
    );
  }

  const signerAddress = env.DEEP_V2_KEEPER_SIGNER_ADDRESS
    ? requiredAddress(
        env.DEEP_V2_KEEPER_SIGNER_ADDRESS,
        "DEEP_V2_KEEPER_SIGNER_ADDRESS",
      )
    : null;
  const signerRpcUrl = env.DEEP_V2_KEEPER_SIGNER_RPC_URL
    ? requiredHttpsUrl(
        env.DEEP_V2_KEEPER_SIGNER_RPC_URL,
        "DEEP_V2_KEEPER_SIGNER_RPC_URL",
      )
    : null;
  const privyWalletId =
    env.DEEP_V2_KEEPER_PRIVY_WALLET_ID?.trim() || null;
  if (privyWalletId && !/^[a-z0-9]{24}$/.test(privyWalletId)) {
    fail(
      "INVALID_CONFIG",
      "DEEP_V2_KEEPER_PRIVY_WALLET_ID must be a Privy wallet ID",
    );
  }
  if (
    enabled &&
    (!signerAddress || !privyWalletId || Boolean(signerRpcUrl))
  ) {
    fail(
      "INVALID_CONFIG",
      "Enabled execution requires a dedicated signer address and the replay-safe Privy policy wallet",
    );
  }
  if (
    signerAddress &&
    [
      env.DEEP_V2_KEEPER_AUTOMATION_ADDRESS,
      env.DEEP_V2_KEEPER_COORDINATOR_ADDRESS,
    ].some(
      (address) =>
        typeof address === "string" &&
        address.toLowerCase() === signerAddress.toLowerCase(),
    )
  ) {
    fail(
      "INVALID_CONFIG",
      "The dedicated signer must not be a protocol contract",
    );
  }
  if (signerRpcUrl && rpcUrls.includes(signerRpcUrl)) {
    fail(
      "INVALID_CONFIG",
      "The signer RPC must be separate from both read RPCs",
    );
  }

  const intervalMs = integer(
    env.DEEP_V2_KEEPER_INTERVAL_MS,
    DEEP_V2_KEEPER_INTERVAL_MS,
    "DEEP_V2_KEEPER_INTERVAL_MS",
    1,
    Number.MAX_SAFE_INTEGER,
  );
  if (intervalMs !== DEEP_V2_KEEPER_INTERVAL_MS) {
    fail(
      "INVALID_CONFIG",
      `DEEP_V2_KEEPER_INTERVAL_MS must be exactly ${DEEP_V2_KEEPER_INTERVAL_MS}`,
    );
  }

  const releaseManifest =
    env.DEEP_V2_KEEPER_RELEASE_MANIFEST || DEEP_V2_RELEASE_MANIFEST_PATH;
  if (releaseManifest !== DEEP_V2_RELEASE_MANIFEST_PATH) {
    fail(
      "INVALID_CONFIG",
      `DEEP_V2_KEEPER_RELEASE_MANIFEST must be ${DEEP_V2_RELEASE_MANIFEST_PATH}`,
    );
  }

  const maxBatchSize = integer(
    env.DEEP_V2_KEEPER_MAX_BATCH_SIZE,
    DEEP_V2_KEEPER_DEFAULT_MAX_BATCH_SIZE,
    "DEEP_V2_KEEPER_MAX_BATCH_SIZE",
    1,
    DEEP_V2_KEEPER_MAX_OPERATIONAL_BATCH_SIZE,
  );
  const maxGas = positiveBigInt(
    env.DEEP_V2_KEEPER_MAX_GAS,
    DEEP_V2_KEEPER_DEFAULT_MAX_GAS,
    "DEEP_V2_KEEPER_MAX_GAS",
  );
  if (
    maxBatchSize > DEEP_V2_KEEPER_DEFAULT_MAX_BATCH_SIZE &&
    maxGas < DEEP_V2_KEEPER_EXTENDED_BATCH_MIN_GAS
  ) {
    fail(
      "INVALID_CONFIG",
      `Batches above ${DEEP_V2_KEEPER_DEFAULT_MAX_BATCH_SIZE} require DEEP_V2_KEEPER_MAX_GAS of at least ${DEEP_V2_KEEPER_EXTENDED_BATCH_MIN_GAS}`,
    );
  }

  return Object.freeze({
    enabled,
    chainId,
    releaseManifest,
    automationAddress: requiredAddress(
      env.DEEP_V2_KEEPER_AUTOMATION_ADDRESS,
      "DEEP_V2_KEEPER_AUTOMATION_ADDRESS",
    ),
    automationRuntimeHash: requiredHash(
      env.DEEP_V2_KEEPER_AUTOMATION_RUNTIME_HASH,
      "DEEP_V2_KEEPER_AUTOMATION_RUNTIME_HASH",
    ),
    coordinatorAddress: requiredAddress(
      env.DEEP_V2_KEEPER_COORDINATOR_ADDRESS,
      "DEEP_V2_KEEPER_COORDINATOR_ADDRESS",
    ),
    coordinatorRuntimeHash: requiredHash(
      env.DEEP_V2_KEEPER_COORDINATOR_RUNTIME_HASH,
      "DEEP_V2_KEEPER_COORDINATOR_RUNTIME_HASH",
    ),
    coordinatorSourceCommitment: requiredHash(
      env.DEEP_V2_KEEPER_COORDINATOR_SOURCE_COMMITMENT,
      "DEEP_V2_KEEPER_COORDINATOR_SOURCE_COMMITMENT",
    ),
    rpcUrls: Object.freeze(rpcUrls),
    signerAddress,
    signerRpcUrl,
    privyWalletId,
    simulationAccount: env.DEEP_V2_KEEPER_SIMULATION_ACCOUNT
      ? requiredAddress(
          env.DEEP_V2_KEEPER_SIMULATION_ACCOUNT,
          "DEEP_V2_KEEPER_SIMULATION_ACCOUNT",
        )
      : DEEP_V2_KEEPER_DEFAULT_SIMULATION_ACCOUNT,
    confirmations: integer(
      env.DEEP_V2_KEEPER_CONFIRMATIONS,
      12,
      "DEEP_V2_KEEPER_CONFIRMATIONS",
      2,
      128,
    ),
    intervalMs,
    maxBatchSize,
    scanLimit: integer(
      env.DEEP_V2_KEEPER_SCAN_LIMIT,
      maxBatchSize,
      "DEEP_V2_KEEPER_SCAN_LIMIT",
      1,
      maxBatchSize,
    ),
    maxGas,
    maxFeePerGasWei: positiveBigInt(
      env.DEEP_V2_KEEPER_MAX_FEE_PER_GAS_WEI,
      100_000_000_000n,
      "DEEP_V2_KEEPER_MAX_FEE_PER_GAS_WEI",
    ),
    maxSignerBalanceWei: positiveBigInt(
      env.DEEP_V2_KEEPER_MAX_SIGNER_BALANCE_WEI,
      500_000_000_000_000_000n,
      "DEEP_V2_KEEPER_MAX_SIGNER_BALANCE_WEI",
    ),
    vaultSubsidyCapWei: positiveBigInt(
      env.DEEP_V2_KEEPER_VAULT_SUBSIDY_CAP_WEI,
      DEEP_V2_KEEPER_DEFAULT_VAULT_SUBSIDY_CAP_WEI,
      "DEEP_V2_KEEPER_VAULT_SUBSIDY_CAP_WEI",
    ),
    pendingTimeoutMs: integer(
      env.DEEP_V2_KEEPER_PENDING_TIMEOUT_MS,
      30 * 60 * 1000,
      "DEEP_V2_KEEPER_PENDING_TIMEOUT_MS",
      10 * 60 * 1000,
      2 * 60 * 60 * 1000,
    ),
    stateFile:
      env.DEEP_V2_KEEPER_STATE_FILE ||
      "./var/deep-v2-keeper-state.json",
  });
}
