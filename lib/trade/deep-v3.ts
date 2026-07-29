import {
  getAddress,
  isAddress,
  isHex,
  type Address,
  type Hex,
} from "viem";

import {
  assertDeepV3LaunchProvenance,
  assertDeepV3ReleaseRuntime,
  deepV3AutomationReadAbi,
  deepV3HookReadAbi,
  deepV3LaunchReadAbi,
  deepV3VaultBindingHash,
  deepV3VaultFactoryReadAbi,
  deepV3VaultReadAbi,
  DEEP_V3_FIXED_POLICY,
  resolveVerifiedDeepV3ReadRelease,
  type DeepV3LaunchProvenance,
  type VerifiedDeepV3ReadRelease,
} from "../onchain/deep-v3-read-model";
import { uerc20ReadAbi } from "../onchain/abis";

const ZERO_ADDRESS =
  "0x0000000000000000000000000000000000000000" as Address;

export type DeepV3TradeRuntimeClient = {
  getChainId(): Promise<number>;
  getCode(args: {
    address: Address;
    blockNumber?: bigint;
  }): Promise<Hex | undefined>;
  readContract(args: {
    address: Address;
    abi: readonly unknown[];
    functionName: string;
    args?: readonly unknown[];
    blockNumber?: bigint;
  }): Promise<unknown>;
};

function sameAddress(left: string, right: string) {
  return left.toLowerCase() === right.toLowerCase();
}

function sameHex(left: string, right: string) {
  return left.toLowerCase() === right.toLowerCase();
}

function address(value: unknown, label: string): Address {
  if (typeof value !== "string" || !isAddress(value)) {
    throw new Error(`Invalid ${label}`);
  }
  const normalized = getAddress(value);
  if (sameAddress(normalized, ZERO_ADDRESS)) {
    throw new Error(`Invalid ${label}`);
  }
  return normalized;
}

function bytes32(value: unknown, label: string): Hex {
  if (
    typeof value !== "string" ||
    !isHex(value, { strict: true }) ||
    value.length !== 66
  ) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

function uint(value: unknown, label: string) {
  if (typeof value === "bigint" && value >= 0n) return value;
  if (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
  ) {
    return BigInt(value);
  }
  throw new Error(`Invalid ${label}`);
}

function bool(value: unknown, label: string) {
  if (typeof value !== "boolean") throw new Error(`Invalid ${label}`);
  return value;
}

function tuple(value: unknown, length: number, label: string) {
  if (!Array.isArray(value) || value.length !== length) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

export function resolveDeepV3TradeBoundary(
  candidate: DeepV3LaunchProvenance,
  release: VerifiedDeepV3ReadRelease,
) {
  const canonical = assertDeepV3LaunchProvenance(candidate, release);
  const poolKey = {
    currency0: ZERO_ADDRESS,
    currency1: canonical.tokenAddress,
    fee: DEEP_V3_FIXED_POLICY.lpFeePips,
    tickSpacing: DEEP_V3_FIXED_POLICY.tickSpacing,
    hooks: release.addresses.feeHook,
  } as const;
  return {
    release,
    candidate: canonical,
    poolKey,
    poolId: canonical.poolId,
    routing: {
      kind: "uniswap-v4-single-pool" as const,
      poolManager: release.officialDependencies.poolManager.address,
      stateView: release.officialDependencies.stateView.address,
      quoter: release.officialDependencies.v4Quoter.address,
      universalRouter:
        release.officialDependencies.universalRouter.address,
      permit2: release.officialDependencies.permit2.address,
    },
  };
}

export function resolveManifestGatedDeepV3TradeBoundary(input: {
  manifest: unknown;
  chainId: number;
  candidate: DeepV3LaunchProvenance;
}) {
  const release = resolveVerifiedDeepV3ReadRelease(
    input.manifest,
    input.chainId,
  );
  if (!release) {
    throw new Error("Deep V3 trading requires the verified live release");
  }
  return resolveDeepV3TradeBoundary(input.candidate, release);
}

export function buildDeepV3ExactPoolRoute(
  boundary: ReturnType<typeof resolveDeepV3TradeBoundary>,
  side: "buy" | "sell",
) {
  if (side === "buy") {
    return {
      ...boundary.routing,
      poolKey: boundary.poolKey,
      poolId: boundary.poolId,
      currencyIn: ZERO_ADDRESS,
      currencyOut: boundary.candidate.tokenAddress,
      zeroForOne: true,
      requiresPermit2: false,
    } as const;
  }
  return {
    ...boundary.routing,
    poolKey: boundary.poolKey,
    poolId: boundary.poolId,
    currencyIn: boundary.candidate.tokenAddress,
    currencyOut: ZERO_ADDRESS,
    zeroForOne: false,
    requiresPermit2: true,
  } as const;
}

async function read(
  client: DeepV3TradeRuntimeClient,
  contract: Address,
  abi: readonly unknown[],
  functionName: string,
  args?: readonly unknown[],
  blockNumber?: bigint,
) {
  return client.readContract({
    address: contract,
    abi,
    functionName,
    ...(args ? { args } : {}),
    ...(blockNumber === undefined ? {} : { blockNumber }),
  });
}

/**
 * Checks the event-derived candidate against the immutable launcher, factory,
 * hook, vault and automation bindings before quote or transaction preparation.
 */
export async function assertDeepV3TradeRuntime(
  client: DeepV3TradeRuntimeClient,
  release: VerifiedDeepV3ReadRelease,
  candidate: DeepV3LaunchProvenance,
  blockNumber?: bigint,
) {
  const boundary = resolveDeepV3TradeBoundary(candidate, release);
  await assertDeepV3ReleaseRuntime(client, release, blockNumber);
  const [tokenCode, vaultCode] = await Promise.all([
    client.getCode({
      address: boundary.candidate.tokenAddress,
      ...(blockNumber === undefined ? {} : { blockNumber }),
    }),
    client.getCode({
      address: boundary.candidate.vaultAddress,
      ...(blockNumber === undefined ? {} : { blockNumber }),
    }),
  ]);
  if (!tokenCode || tokenCode === "0x" || !vaultCode || vaultCode === "0x") {
    throw new Error("Deep V3 token or vault runtime is missing");
  }

  const [
    tokenCreator,
    launcherVault,
    launcherHash,
    factoryRecognized,
    factoryConfigurationHash,
    factoryBindingHash,
    hookPoolConfigRaw,
    vaultFactory,
    vaultHook,
    vaultPoolId,
    vaultToken,
    vaultConfigurationHash,
    automationRegistered,
  ] = await Promise.all([
    read(
      client,
      boundary.candidate.tokenAddress,
      uerc20ReadAbi,
      "creator",
      undefined,
      blockNumber,
    ),
    read(
      client,
      release.addresses.launcher,
      deepV3LaunchReadAbi,
      "growthVaultOf",
      [boundary.candidate.tokenAddress],
      blockNumber,
    ),
    read(
      client,
      release.addresses.launcher,
      deepV3LaunchReadAbi,
      "launchHashOf",
      [boundary.candidate.tokenAddress],
      blockNumber,
    ),
    read(
      client,
      release.addresses.growthVaultFactory,
      deepV3VaultFactoryReadAbi,
      "isFactoryVault",
      [boundary.candidate.vaultAddress],
      blockNumber,
    ),
    read(
      client,
      release.addresses.growthVaultFactory,
      deepV3VaultFactoryReadAbi,
      "configurationHashOf",
      [boundary.candidate.vaultAddress],
      blockNumber,
    ),
    read(
      client,
      release.addresses.growthVaultFactory,
      deepV3VaultFactoryReadAbi,
      "vaultBindingHash",
      [boundary.candidate.vaultAddress],
      blockNumber,
    ),
    read(
      client,
      release.addresses.feeHook,
      deepV3HookReadAbi,
      "poolFeeConfig",
      [boundary.poolId],
      blockNumber,
    ),
    read(
      client,
      boundary.candidate.vaultAddress,
      deepV3VaultReadAbi,
      "FACTORY",
      undefined,
      blockNumber,
    ),
    read(
      client,
      boundary.candidate.vaultAddress,
      deepV3VaultReadAbi,
      "feeHook",
      undefined,
      blockNumber,
    ),
    read(
      client,
      boundary.candidate.vaultAddress,
      deepV3VaultReadAbi,
      "poolId",
      undefined,
      blockNumber,
    ),
    read(
      client,
      boundary.candidate.vaultAddress,
      deepV3VaultReadAbi,
      "token",
      undefined,
      blockNumber,
    ),
    read(
      client,
      boundary.candidate.vaultAddress,
      deepV3VaultReadAbi,
      "configurationHash",
      undefined,
      blockNumber,
    ),
    read(
      client,
      release.addresses.automation,
      deepV3AutomationReadAbi,
      "isRegisteredVault",
      [boundary.candidate.vaultAddress],
      blockNumber,
    ),
  ]);

  const poolConfig = tuple(
    hookPoolConfigRaw,
    4,
    "Deep V3 hook pool configuration",
  );
  const expectedBinding = deepV3VaultBindingHash({
    chainId: release.chainId,
    factory: release.addresses.growthVaultFactory,
    vault: boundary.candidate.vaultAddress,
    hook: release.addresses.feeHook,
    poolId: boundary.poolId,
    token: boundary.candidate.tokenAddress,
  });
  if (
    !sameAddress(
      address(tokenCreator, "Deep V3 token creator"),
      release.addresses.launcher,
    ) ||
    !sameAddress(
      address(launcherVault, "Deep V3 launcher vault"),
      boundary.candidate.vaultAddress,
    ) ||
    !sameHex(
      bytes32(launcherHash, "Deep V3 launcher launch hash"),
      boundary.candidate.launchHash,
    ) ||
    !bool(factoryRecognized, "Deep V3 factory vault status") ||
    !sameHex(
      bytes32(
        factoryConfigurationHash,
        "Deep V3 factory configuration hash",
      ),
      boundary.candidate.vaultConfigurationHash,
    ) ||
    !sameHex(
      bytes32(factoryBindingHash, "Deep V3 factory binding hash"),
      expectedBinding,
    ) ||
    !sameAddress(
      address(poolConfig[0], "Deep V3 configured vault"),
      boundary.candidate.vaultAddress,
    ) ||
    !sameAddress(
      address(poolConfig[1], "Deep V3 registrar"),
      release.addresses.launcher,
    ) ||
    uint(poolConfig[2], "Deep V3 pool lifecycle") !== 5n ||
    !sameAddress(
      address(vaultFactory, "Deep V3 vault factory"),
      release.addresses.growthVaultFactory,
    ) ||
    !sameAddress(
      address(vaultHook, "Deep V3 vault hook"),
      release.addresses.feeHook,
    ) ||
    !sameHex(
      bytes32(vaultPoolId, "Deep V3 vault PoolId"),
      boundary.poolId,
    ) ||
    !sameAddress(
      address(vaultToken, "Deep V3 vault token"),
      boundary.candidate.tokenAddress,
    ) ||
    !sameHex(
      bytes32(
        vaultConfigurationHash,
        "Deep V3 vault configuration hash",
      ),
      boundary.candidate.vaultConfigurationHash,
    ) ||
    !bool(automationRegistered, "Deep V3 automation registration")
  ) {
    throw new Error("Deep V3 trade topology does not match the release");
  }
}
