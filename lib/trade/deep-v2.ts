import {
  getAddress,
  isAddress,
  isHex,
  keccak256,
  type Address,
  type Hex,
} from "viem";

import { computeOfficialV4PoolId } from "../uniswap/liquidity-launcher-sdk";
import {
  getVerifiedDeepV2Release,
  type LaunchModelReleaseManifest,
} from "../launch-model-gating";

export type DeepV2TradeRelease = {
  chainId: 1 | 11_155_111;
  releaseVersion: "deep-full-range-v2";
  launcher: Address;
  launcherRuntimeCodeHash: Hex;
  feeHook: Address;
  feeHookRuntimeCodeHash: Hex;
  growthVaultFactory: Address;
  growthVaultFactoryRuntimeCodeHash: Hex;
  growthVaultImplementation: Address;
  growthVaultImplementationRuntimeCodeHash: Hex;
  automation: Address;
  automationRuntimeCodeHash: Hex;
  poolManager: Address;
  poolManagerRuntimeCodeHash: Hex;
};

export type DeepV2TradeCandidate = {
  deepReleaseVersion: "deep-full-range-v2";
  launchModel: "deep";
  launcher: Address;
  tokenAddress: Address;
  hookAddress: Address;
  poolId: Hex;
};

export type DeepV2TradeRuntimeClient = {
  getChainId(): Promise<number>;
  getCode(args: { address: Address }): Promise<Hex | undefined>;
};

export type DeepV2OfficialTradeStack = {
  chainId: 1 | 11_155_111;
  poolManager: Address;
  poolManagerRuntimeCodeHash: Hex;
};

const ZERO_ADDRESS =
  "0x0000000000000000000000000000000000000000" as Address;

function address(value: unknown, label: string, allowZero = false) {
  if (typeof value !== "string" || !isAddress(value)) {
    throw new Error(`Invalid ${label}`);
  }
  const normalized = getAddress(value);
  if (!allowZero && normalized.toLowerCase() === ZERO_ADDRESS) {
    throw new Error(`Invalid ${label}`);
  }
  return normalized;
}

function runtimeHash(value: unknown, label: string): Hex {
  if (
    typeof value !== "string" ||
    !isHex(value, { strict: true }) ||
    value.length !== 66
  ) {
    throw new Error(`Invalid ${label} runtime hash`);
  }
  return value;
}

function sameAddress(left: string, right: string) {
  return left.toLowerCase() === right.toLowerCase();
}

export function resolveDeepV2TradeBoundary(
  candidate: DeepV2TradeCandidate,
  release: DeepV2TradeRelease,
) {
  if (
    candidate.deepReleaseVersion !== "deep-full-range-v2" ||
    release.releaseVersion !== "deep-full-range-v2"
  ) {
    throw new Error("The token does not belong to the verified Deep V2 release");
  }
  if (candidate.launchModel !== "deep") {
    throw new Error("The token is not a Deep launch");
  }
  if (release.chainId !== 1 && release.chainId !== 11_155_111) {
    throw new Error("Invalid Deep V2 trade chain");
  }

  const launcher = address(release.launcher, "Deep V2 launcher");
  const hook = address(release.feeHook, "Deep V2 hook");
  const factory = address(
    release.growthVaultFactory,
    "Deep V2 vault factory",
  );
  const implementation = address(
    release.growthVaultImplementation,
    "Deep V2 vault implementation",
  );
  const automation = address(
    release.automation,
    "Deep V2 automation",
  );
  const poolManager = address(release.poolManager, "PoolManager");
  runtimeHash(release.launcherRuntimeCodeHash, "Deep V2 launcher");
  runtimeHash(release.feeHookRuntimeCodeHash, "Deep V2 hook");
  runtimeHash(
    release.growthVaultFactoryRuntimeCodeHash,
    "Deep V2 vault factory",
  );
  runtimeHash(
    release.growthVaultImplementationRuntimeCodeHash,
    "Deep V2 vault implementation",
  );
  runtimeHash(
    release.automationRuntimeCodeHash,
    "Deep V2 automation",
  );
  runtimeHash(release.poolManagerRuntimeCodeHash, "PoolManager");

  if (!sameAddress(candidate.launcher, launcher)) {
    throw new Error("The token launcher does not match the Deep V2 release");
  }
  if (!sameAddress(candidate.hookAddress, hook)) {
    throw new Error("The token hook does not match the Deep V2 release");
  }
  const token = address(candidate.tokenAddress, "Deep V2 token");
  if (
    [launcher, hook, factory, implementation, automation, poolManager].some(
      (dependency) => sameAddress(token, dependency),
    )
  ) {
    throw new Error("The Deep V2 token cannot be a protocol contract");
  }
  const poolKey = {
    currency0: ZERO_ADDRESS,
    currency1: token,
    fee: 0,
    tickSpacing: 200,
    hooks: hook,
  } as const;
  const poolId = computeOfficialV4PoolId(poolKey);
  if (
    !isHex(candidate.poolId, { strict: true }) ||
    candidate.poolId.length !== 66 ||
    candidate.poolId.toLowerCase() !== poolId.toLowerCase()
  ) {
    throw new Error("The token PoolId does not match the canonical Deep V2 pool");
  }
  return {
    release: {
      ...release,
      launcher,
      feeHook: hook,
      growthVaultFactory: factory,
      growthVaultImplementation: implementation,
      automation,
      poolManager,
    },
    candidate: {
      ...candidate,
      launcher,
      tokenAddress: token,
      hookAddress: hook,
      poolId,
    },
    poolKey,
    poolId,
  };
}

/**
 * Application entry point. The lower-level PoolKey assertion above never
 * turns an unverified manifest into a usable release.
 */
export function resolveManifestGatedDeepV2TradeBoundary(input: {
  manifest: LaunchModelReleaseManifest;
  chainId: number;
  candidate: DeepV2TradeCandidate;
  official: DeepV2OfficialTradeStack;
}) {
  const verified = getVerifiedDeepV2Release(
    input.manifest,
    input.chainId,
  );
  if (!verified) {
    throw new Error(
      "Deep trading requires an eligible verified Deep V2 release",
    );
  }
  if (
    input.official.chainId !== input.chainId ||
    (input.chainId !== 1 && input.chainId !== 11_155_111)
  ) {
    throw new Error("The pinned PoolManager chain does not match Deep V2");
  }
  const hashes = verified.runtimeCodeHashes;
  const release: DeepV2TradeRelease = {
    chainId: input.chainId,
    releaseVersion: "deep-full-range-v2",
    launcher: address(verified.launcher, "Deep V2 release launcher"),
    launcherRuntimeCodeHash: runtimeHash(
      hashes?.launcher,
      "Deep V2 launcher",
    ),
    feeHook: address(verified.feeHook, "Deep V2 release hook"),
    feeHookRuntimeCodeHash: runtimeHash(
      hashes?.feeHook,
      "Deep V2 hook",
    ),
    growthVaultFactory: address(
      verified.growthVaultFactory,
      "Deep V2 release vault factory",
    ),
    growthVaultFactoryRuntimeCodeHash: runtimeHash(
      hashes?.growthVaultFactory,
      "Deep V2 vault factory",
    ),
    growthVaultImplementation: address(
      verified.growthVaultImplementation,
      "Deep V2 release vault implementation",
    ),
    growthVaultImplementationRuntimeCodeHash: runtimeHash(
      hashes?.growthVaultImplementation,
      "Deep V2 vault implementation",
    ),
    automation: address(
      verified.automation,
      "Deep V2 release automation",
    ),
    automationRuntimeCodeHash: runtimeHash(
      hashes?.automation,
      "Deep V2 automation",
    ),
    poolManager: address(
      input.official.poolManager,
      "pinned PoolManager",
    ),
    poolManagerRuntimeCodeHash: runtimeHash(
      input.official.poolManagerRuntimeCodeHash,
      "PoolManager",
    ),
  };
  return resolveDeepV2TradeBoundary(input.candidate, release);
}

export async function assertDeepV2TradeRuntime(
  client: DeepV2TradeRuntimeClient,
  release: DeepV2TradeRelease,
  candidate: DeepV2TradeCandidate,
): Promise<void> {
  const boundary = resolveDeepV2TradeBoundary(candidate, release);
  const actualChainId = await client.getChainId();
  if (actualChainId !== release.chainId) {
    throw new Error("The runtime RPC chain does not match the Deep V2 release");
  }
  const contracts = [
    [
      "Deep V2 launcher",
      boundary.release.launcher,
      release.launcherRuntimeCodeHash,
    ],
    [
      "Deep V2 hook",
      boundary.release.feeHook,
      release.feeHookRuntimeCodeHash,
    ],
    [
      "Deep V2 vault factory",
      boundary.release.growthVaultFactory,
      release.growthVaultFactoryRuntimeCodeHash,
    ],
    [
      "Deep V2 vault implementation",
      boundary.release.growthVaultImplementation,
      release.growthVaultImplementationRuntimeCodeHash,
    ],
    [
      "Deep V2 automation",
      boundary.release.automation,
      release.automationRuntimeCodeHash,
    ],
    [
      "PoolManager",
      boundary.release.poolManager,
      release.poolManagerRuntimeCodeHash,
    ],
  ] as const;
  const code = await Promise.all([
    ...contracts.map(([, contract]) => client.getCode({ address: contract })),
    client.getCode({ address: boundary.candidate.tokenAddress }),
  ]);
  for (let index = 0; index < contracts.length; index++) {
    const [label, , expectedHash] = contracts[index];
    const runtime = code[index];
    if (
      !runtime ||
      runtime === "0x" ||
      keccak256(runtime).toLowerCase() !== expectedHash.toLowerCase()
    ) {
      throw new Error(`${label} runtime does not match the verified release`);
    }
  }
  if (!code[contracts.length] || code[contracts.length] === "0x") {
    throw new Error("The Deep V2 token runtime is missing");
  }
}
