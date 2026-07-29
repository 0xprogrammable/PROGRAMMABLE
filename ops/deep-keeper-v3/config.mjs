import { getAddress } from "viem";

export const DEEP_V3_RELEASE_MANIFEST_PATH =
  "contracts/deployments/mainnet-deep-full-range-v3.json";
export const DEEP_V3_KEEPER_INTERVAL_MS = 300_000;
export const DEEP_V3_KEEPER_SCAN_LIMIT = 1;
export const DEEP_V3_KEEPER_BATCH_SIZE = 1;
export const DEEP_V3_KEEPER_CONFIRMATIONS = 12;
export const DEEP_V3_KEEPER_MAX_GAS = 4_500_000n;
export const DEEP_V3_KEEPER_ABSENT_TRANSACTION_GRACE_MS =
  30 * 60 * 1_000;
export const DEEP_V3_KEEPER_SAFE_PRIVY_REPLAY_MS =
  23 * 60 * 60 * 1_000;
export const DEEP_V3_KEEPER_REPLAY_COOLDOWN_MS =
  30 * 60 * 1_000;

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const PRIVATE_KEY_ENV_NAMES = [
  "DEEP_V3_KEEPER_PRIVATE_KEY",
  "DEEP_V3_KEEPER_MNEMONIC",
  "DEEP_V3_PRIVATE_KEY",
  "DEEP_V3_MNEMONIC",
  "DEEP_KEEPER_PRIVATE_KEY",
  "DEEP_KEEPER_MNEMONIC",
  "PRIVATE_KEY",
  "MNEMONIC",
];

export class DeepV3KeeperConfigError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "DeepV3KeeperConfigError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new DeepV3KeeperConfigError(code, message);
}

function exactBoolean(value, label) {
  if (value === undefined || value === "") return false;
  if (value === "true") return true;
  if (value === "false") return false;
  fail("INVALID_CONFIG", `${label} must be exactly true or false`);
}

function exactInteger(value, expected, label) {
  const parsed =
    value === undefined || value === "" ? expected : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed !== expected) {
    fail("INVALID_CONFIG", `${label} must be exactly ${expected}`);
  }
  return parsed;
}

function positiveBigInt(value, fallback, label) {
  try {
    const parsed = BigInt(value === undefined || value === "" ? fallback : value);
    if (parsed <= 0n) throw new Error();
    return parsed;
  } catch {
    fail("INVALID_CONFIG", `${label} must be a positive integer`);
  }
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

function requiredHttpsUrl(value, label) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") throw new Error();
    return parsed.toString();
  } catch {
    fail("INVALID_CONFIG", `${label} must be an HTTPS URL`);
  }
}

export function parseDeepV3KeeperConfig(env = process.env) {
  for (const name of PRIVATE_KEY_ENV_NAMES) {
    if (env[name]) {
      fail(
        "PRIVATE_KEY_REJECTED",
        `${name} is not accepted; use the dedicated remote policy wallet`,
      );
    }
  }

  const enabled = exactBoolean(
    env.DEEP_V3_KEEPER_ENABLED,
    "DEEP_V3_KEEPER_ENABLED",
  );
  const sendTransactions = exactBoolean(
    env.DEEP_V3_KEEPER_SEND_TRANSACTIONS,
    "DEEP_V3_KEEPER_SEND_TRANSACTIONS",
  );
  if (enabled !== sendTransactions) {
    fail(
      "INVALID_CONFIG",
      "Activation requires both Deep V3 execution flags to match",
    );
  }

  const chainId = exactInteger(
    env.DEEP_V3_KEEPER_CHAIN_ID,
    1,
    "DEEP_V3_KEEPER_CHAIN_ID",
  );
  const rpcUrls = String(env.DEEP_V3_KEEPER_RPC_URLS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value, index) =>
      requiredHttpsUrl(value, `DEEP_V3_KEEPER_RPC_URLS[${index}]`),
    );
  if (
    rpcUrls.length !== 2 ||
    new Set(rpcUrls).size !== 2 ||
    new URL(rpcUrls[0]).hostname === new URL(rpcUrls[1]).hostname
  ) {
    fail(
      "INVALID_CONFIG",
      "DEEP_V3_KEEPER_RPC_URLS must contain two independent HTTPS hosts",
    );
  }

  const releaseManifest =
    env.DEEP_V3_KEEPER_RELEASE_MANIFEST ??
    DEEP_V3_RELEASE_MANIFEST_PATH;
  if (releaseManifest !== DEEP_V3_RELEASE_MANIFEST_PATH) {
    fail(
      "INVALID_CONFIG",
      `DEEP_V3_KEEPER_RELEASE_MANIFEST must be ${DEEP_V3_RELEASE_MANIFEST_PATH}`,
    );
  }

  const signerAddress = env.DEEP_V3_KEEPER_SIGNER_ADDRESS
    ? requiredAddress(
        env.DEEP_V3_KEEPER_SIGNER_ADDRESS,
        "DEEP_V3_KEEPER_SIGNER_ADDRESS",
      )
    : null;
  const privyWalletId =
    env.DEEP_V3_KEEPER_PRIVY_WALLET_ID?.trim() || null;
  if (privyWalletId && !/^[a-z0-9]{24}$/.test(privyWalletId)) {
    fail(
      "INVALID_CONFIG",
      "DEEP_V3_KEEPER_PRIVY_WALLET_ID must be a Privy wallet ID",
    );
  }
  if (enabled && (!signerAddress || !privyWalletId)) {
    fail(
      "INVALID_CONFIG",
      "Enabled execution requires the dedicated Privy policy wallet",
    );
  }

  const config = {
    enabled,
    chainId,
    releaseManifest,
    automationAddress: requiredAddress(
      env.DEEP_V3_KEEPER_AUTOMATION_ADDRESS,
      "DEEP_V3_KEEPER_AUTOMATION_ADDRESS",
    ),
    automationRuntimeHash: requiredHash(
      env.DEEP_V3_KEEPER_AUTOMATION_RUNTIME_HASH,
      "DEEP_V3_KEEPER_AUTOMATION_RUNTIME_HASH",
    ),
    launcherAddress: requiredAddress(
      env.DEEP_V3_KEEPER_LAUNCHER_ADDRESS,
      "DEEP_V3_KEEPER_LAUNCHER_ADDRESS",
    ),
    launcherRuntimeHash: requiredHash(
      env.DEEP_V3_KEEPER_LAUNCHER_RUNTIME_HASH,
      "DEEP_V3_KEEPER_LAUNCHER_RUNTIME_HASH",
    ),
    vaultFactoryAddress: requiredAddress(
      env.DEEP_V3_KEEPER_VAULT_FACTORY_ADDRESS,
      "DEEP_V3_KEEPER_VAULT_FACTORY_ADDRESS",
    ),
    vaultFactoryRuntimeHash: requiredHash(
      env.DEEP_V3_KEEPER_VAULT_FACTORY_RUNTIME_HASH,
      "DEEP_V3_KEEPER_VAULT_FACTORY_RUNTIME_HASH",
    ),
    executorAddress: requiredAddress(
      env.DEEP_V3_KEEPER_EXECUTOR_ADDRESS,
      "DEEP_V3_KEEPER_EXECUTOR_ADDRESS",
    ),
    executorRuntimeHash: requiredHash(
      env.DEEP_V3_KEEPER_EXECUTOR_RUNTIME_HASH,
      "DEEP_V3_KEEPER_EXECUTOR_RUNTIME_HASH",
    ),
    sourceCommitment: requiredHash(
      env.DEEP_V3_KEEPER_SOURCE_COMMITMENT,
      "DEEP_V3_KEEPER_SOURCE_COMMITMENT",
    ),
    rpcUrls: Object.freeze(rpcUrls),
    signerAddress,
    privyWalletId,
    intervalMs: exactInteger(
      env.DEEP_V3_KEEPER_INTERVAL_MS,
      DEEP_V3_KEEPER_INTERVAL_MS,
      "DEEP_V3_KEEPER_INTERVAL_MS",
    ),
    scanLimit: exactInteger(
      env.DEEP_V3_KEEPER_SCAN_LIMIT,
      DEEP_V3_KEEPER_SCAN_LIMIT,
      "DEEP_V3_KEEPER_SCAN_LIMIT",
    ),
    maxBatchSize: exactInteger(
      env.DEEP_V3_KEEPER_MAX_BATCH_SIZE,
      DEEP_V3_KEEPER_BATCH_SIZE,
      "DEEP_V3_KEEPER_MAX_BATCH_SIZE",
    ),
    confirmations: exactInteger(
      env.DEEP_V3_KEEPER_CONFIRMATIONS,
      DEEP_V3_KEEPER_CONFIRMATIONS,
      "DEEP_V3_KEEPER_CONFIRMATIONS",
    ),
    maxGas: positiveBigInt(
      env.DEEP_V3_KEEPER_MAX_GAS,
      DEEP_V3_KEEPER_MAX_GAS,
      "DEEP_V3_KEEPER_MAX_GAS",
    ),
    maxFeePerGasWei: positiveBigInt(
      env.DEEP_V3_KEEPER_MAX_FEE_PER_GAS_WEI,
      100_000_000_000n,
      "DEEP_V3_KEEPER_MAX_FEE_PER_GAS_WEI",
    ),
  };
  if (config.maxGas !== DEEP_V3_KEEPER_MAX_GAS) {
    fail(
      "INVALID_CONFIG",
      `DEEP_V3_KEEPER_MAX_GAS must be exactly ${DEEP_V3_KEEPER_MAX_GAS}`,
    );
  }
  if (config.maxFeePerGasWei !== 100_000_000_000n) {
    fail(
      "INVALID_CONFIG",
      "DEEP_V3_KEEPER_MAX_FEE_PER_GAS_WEI must be exactly 100000000000",
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
