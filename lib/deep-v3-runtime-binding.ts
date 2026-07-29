import {
  getAddress,
  isAddress,
  isHex,
  keccak256,
  type Address,
  type Hex,
} from "viem";

import {
  DEEP_V3_FIXED_POLICY,
  deepV3AutomationReadAbi,
  deepV3GrowthVaultFactoryReadAbi,
  deepV3GrowthVaultImplementationReadAbi,
  deepV3HookFactoryReadAbi,
  deepV3HookReadAbi,
  deepV3KeeperExecutorReadAbi,
  deepV3LaunchAbi,
  deepV3LockedPositionFactoryReadAbi,
} from "./deep-v3";

const HOOK_FLAG_MASK = (1n << 14n) - 1n;
const DEEP_V3_REQUIRED_HOOK_FLAGS = 0x3aec;

export type DeepV3RuntimeRelease = {
  chainId: 1;
  startBlock: number;
  addresses: {
    treasury: Address;
    lockedPositionFactory: Address;
    zapPlanner: Address;
    growthVaultFactory: Address;
    growthVaultImplementation: Address;
    hookFactory: Address;
    feeHook: Address;
    launcher: Address;
    positionPlanner: Address;
    automation: Address;
    keeperExecutor: Address;
  };
  runtimeCodeHashes: {
    lockedPositionFactory: Hex;
    zapPlanner: Hex;
    growthVaultFactory: Hex;
    growthVaultImplementation: Hex;
    hookFactory: Hex;
    feeHook: Hex;
    launcher: Hex;
    positionPlanner: Hex;
    automation: Hex;
    keeperExecutor: Hex;
  };
  officialDependencies: {
    poolManager: { address: Address; runtimeCodeHash: Hex };
    positionManager: { address: Address; runtimeCodeHash: Hex };
    uerc20Factory: { address: Address; runtimeCodeHash: Hex };
  };
};

export type DeepV3RuntimeBindingClient = {
  getChainId(): Promise<number>;
  getFinalizedBlock(): Promise<{ number: bigint; hash: Hex | null }>;
  getBlock(input: {
    blockNumber: bigint;
  }): Promise<{ number: bigint; hash: Hex | null }>;
  getCode(input: {
    address: Address;
    blockNumber: bigint;
  }): Promise<Hex | undefined>;
  readContract(input: {
    address: Address;
    abi: readonly unknown[];
    functionName: string;
    args?: readonly unknown[];
    blockNumber: bigint;
  }): Promise<unknown>;
};

function validHash(value: unknown): value is Hex {
  return (
    typeof value === "string" &&
    isHex(value, { strict: true }) &&
    value.length === 66
  );
}

function sameAddress(left: unknown, right: Address) {
  return (
    typeof left === "string" &&
    isAddress(left) &&
    getAddress(left) === getAddress(right)
  );
}

function sameValue(left: unknown, right: unknown) {
  if (typeof left === "bigint" || typeof right === "bigint") {
    try {
      return BigInt(left as string | number | bigint) === BigInt(
        right as string | number | bigint,
      );
    } catch {
      return false;
    }
  }
  return left === right;
}

function validRuntimeRelease(
  value: DeepV3RuntimeRelease,
): value is DeepV3RuntimeRelease {
  const addresses = [
    ...Object.values(value.addresses),
    ...Object.values(value.officialDependencies).map(
      (dependency) => dependency.address,
    ),
  ];
  const hashes = [
    ...Object.values(value.runtimeCodeHashes),
    ...Object.values(value.officialDependencies).map(
      (dependency) => dependency.runtimeCodeHash,
    ),
  ];
  return (
    value.chainId === 1 &&
    Number.isSafeInteger(value.startBlock) &&
    value.startBlock > 0 &&
    addresses.every((address) => isAddress(address)) &&
    hashes.every(validHash)
  );
}

async function verifyRuntime(
  clients: readonly [
    DeepV3RuntimeBindingClient,
    DeepV3RuntimeBindingClient,
  ],
  blockNumber: bigint,
  address: Address,
  expectedHash: Hex,
  label: string,
) {
  const codes = await Promise.all(
    clients.map((client) => client.getCode({ address, blockNumber })),
  );
  if (
    !codes[0] ||
    codes[0] === "0x" ||
    !codes[1] ||
    codes[1] === "0x" ||
    codes[0].toLowerCase() !== codes[1].toLowerCase()
  ) {
    throw new Error(
      `Independent Deep V3 RPCs disagree on the ${label} runtime`,
    );
  }
  if (keccak256(codes[0]).toLowerCase() !== expectedHash.toLowerCase()) {
    throw new Error(
      `Deep V3 ${label} runtime does not match the reviewed release`,
    );
  }
}

type ReadExpectation = {
  address: Address;
  abi: readonly unknown[];
  functionName: string;
  args?: readonly unknown[];
  expected: unknown;
  label: string;
};

async function verifyRead(
  clients: readonly [
    DeepV3RuntimeBindingClient,
    DeepV3RuntimeBindingClient,
  ],
  blockNumber: bigint,
  expectation: ReadExpectation,
) {
  const values = await Promise.all(
    clients.map((client) =>
      client.readContract({
        address: expectation.address,
        abi: expectation.abi,
        functionName: expectation.functionName,
        args: expectation.args,
        blockNumber,
      }),
    ),
  );
  if (
    !sameValue(values[0], values[1]) ||
    (typeof expectation.expected === "string" &&
    isAddress(expectation.expected)
      ? !sameAddress(values[0], expectation.expected)
      : !sameValue(values[0], expectation.expected))
  ) {
    throw new Error(
      `Deep V3 ${expectation.label} does not match the reviewed release`,
    );
  }
}

export async function assertDeepV3RuntimeBinding(input: {
  clients: readonly DeepV3RuntimeBindingClient[];
  release: DeepV3RuntimeRelease;
}): Promise<{ blockNumber: bigint; blockHash: Hex }> {
  if (
    input.clients.length !== 2 ||
    !validRuntimeRelease(input.release)
  ) {
    throw new Error("Deep V3 runtime release binding is invalid");
  }
  const clients = input.clients as readonly [
    DeepV3RuntimeBindingClient,
    DeepV3RuntimeBindingClient,
  ];
  const release = input.release;
  const chainIds = await Promise.all(
    clients.map((client) => client.getChainId()),
  );
  if (chainIds.some((chainId) => chainId !== release.chainId)) {
    throw new Error("Deep V3 runtime RPC chain does not match the release");
  }

  const finalized = await Promise.all(
    clients.map((client) => client.getFinalizedBlock()),
  );
  if (
    finalized.some(
      (block) =>
        block.number < BigInt(release.startBlock) ||
        !validHash(block.hash),
    )
  ) {
    throw new Error(
      "Deep V3 finalized block predates the reviewed deployment",
    );
  }
  const blockNumber =
    finalized[0].number < finalized[1].number
      ? finalized[0].number
      : finalized[1].number;
  const blocks = await Promise.all(
    clients.map((client) => client.getBlock({ blockNumber })),
  );
  if (
    blocks.some(
      (block) =>
        block.number !== blockNumber || !validHash(block.hash),
    ) ||
    blocks[0].hash?.toLowerCase() !== blocks[1].hash?.toLowerCase()
  ) {
    throw new Error(
      "Independent Deep V3 RPCs disagree on the finalized block",
    );
  }

  const runtimeTargets = [
    ...Object.entries(release.officialDependencies).map(
      ([label, dependency]) => ({
        label: `official ${label}`,
        address: dependency.address,
        hash: dependency.runtimeCodeHash,
      }),
    ),
    ...Object.entries(release.runtimeCodeHashes).map(
      ([label, hash]) => ({
        label,
        address:
          label === "lockedPositionFactory"
            ? release.addresses.lockedPositionFactory
            : release.addresses[
                label as Exclude<
                  keyof DeepV3RuntimeRelease["addresses"],
                  "treasury" | "lockedPositionFactory"
                >
              ],
        hash,
      }),
    ),
  ];
  await Promise.all(
    runtimeTargets.map((target) =>
      verifyRuntime(
        clients,
        blockNumber,
        target.address,
        target.hash,
        target.label,
      ),
    ),
  );

  const { addresses, officialDependencies: official } = release;
  const reads: ReadExpectation[] = [
    {
      address: addresses.launcher,
      abi: deepV3LaunchAbi,
      functionName: "poolManager",
      expected: official.poolManager.address,
      label: "launcher PoolManager",
    },
    {
      address: addresses.launcher,
      abi: deepV3LaunchAbi,
      functionName: "positionManager",
      expected: official.positionManager.address,
      label: "launcher PositionManager",
    },
    {
      address: addresses.launcher,
      abi: deepV3LaunchAbi,
      functionName: "tokenFactory",
      expected: official.uerc20Factory.address,
      label: "launcher UERC20Factory",
    },
    {
      address: addresses.launcher,
      abi: deepV3LaunchAbi,
      functionName: "feeHook",
      expected: addresses.feeHook,
      label: "launcher hook",
    },
    {
      address: addresses.launcher,
      abi: deepV3LaunchAbi,
      functionName: "growthVaultFactory",
      expected: addresses.growthVaultFactory,
      label: "launcher vault factory",
    },
    {
      address: addresses.launcher,
      abi: deepV3LaunchAbi,
      functionName: "positionPlanner",
      expected: addresses.positionPlanner,
      label: "launcher position planner",
    },
    {
      address: addresses.launcher,
      abi: deepV3LaunchAbi,
      functionName: "automation",
      expected: addresses.automation,
      label: "launcher automation",
    },
    {
      address: addresses.launcher,
      abi: deepV3LaunchAbi,
      functionName: "positionForwarderFactory",
      expected: addresses.lockedPositionFactory,
      label: "launcher locked position factory",
    },
    {
      address: addresses.launcher,
      abi: deepV3LaunchAbi,
      functionName: "TOKEN_SUPPLY",
      expected: DEEP_V3_FIXED_POLICY.tokenSupplyWei,
      label: "token supply",
    },
    {
      address: addresses.launcher,
      abi: deepV3LaunchAbi,
      functionName: "MIN_INITIAL_BUY_WEI",
      expected: DEEP_V3_FIXED_POLICY.minimumInitialBuyWei,
      label: "minimum initial buy",
    },
    {
      address: addresses.launcher,
      abi: deepV3LaunchAbi,
      functionName: "MIN_INITIAL_BUY_SQRT_PRICE_LIMIT_X96",
      expected:
        DEEP_V3_FIXED_POLICY.minimumInitialBuySqrtPriceLimitX96,
      label: "initial buy price limit",
    },
    {
      address: addresses.feeHook,
      abi: deepV3HookReadAbi,
      functionName: "poolManager",
      expected: official.poolManager.address,
      label: "hook PoolManager",
    },
    {
      address: addresses.feeHook,
      abi: deepV3HookReadAbi,
      functionName: "positionManager",
      expected: official.positionManager.address,
      label: "hook PositionManager",
    },
    {
      address: addresses.feeHook,
      abi: deepV3HookReadAbi,
      functionName: "growthVaultFactory",
      expected: addresses.growthVaultFactory,
      label: "hook vault factory",
    },
    {
      address: addresses.feeHook,
      abi: deepV3HookReadAbi,
      functionName: "launcherFeeRecipient",
      expected: addresses.treasury,
      label: "Programmable treasury",
    },
    {
      address: addresses.feeHook,
      abi: deepV3HookReadAbi,
      functionName: "TOTAL_HOOK_FEE_BPS",
      expected: DEEP_V3_FIXED_POLICY.totalHookFeeBps,
      label: "total hook fee",
    },
    {
      address: addresses.feeHook,
      abi: deepV3HookReadAbi,
      functionName: "GROWTH_FEE_BPS",
      expected: DEEP_V3_FIXED_POLICY.growthFeeBps,
      label: "growth fee",
    },
    {
      address: addresses.feeHook,
      abi: deepV3HookReadAbi,
      functionName: "PROGRAMMABLE_FEE_BPS",
      expected: DEEP_V3_FIXED_POLICY.programmableFeeBps,
      label: "Programmable fee",
    },
    {
      address: addresses.feeHook,
      abi: deepV3HookReadAbi,
      functionName: "TRANSFER_TAX_BPS",
      expected: DEEP_V3_FIXED_POLICY.transferTaxBps,
      label: "transfer tax",
    },
    {
      address: addresses.feeHook,
      abi: deepV3HookReadAbi,
      functionName: "maxAbsTickDelta",
      expected: DEEP_V3_FIXED_POLICY.maximumInitialBuyImpactTicks,
      label: "hook tick delta",
    },
    {
      address: addresses.hookFactory,
      abi: deepV3HookFactoryReadAbi,
      functionName: "ALL_HOOK_MASK",
      expected: HOOK_FLAG_MASK,
      label: "hook mask",
    },
    {
      address: addresses.hookFactory,
      abi: deepV3HookFactoryReadAbi,
      functionName: "REQUIRED_HOOK_FLAGS",
      expected: DEEP_V3_REQUIRED_HOOK_FLAGS,
      label: "hook permissions",
    },
    {
      address: addresses.hookFactory,
      abi: deepV3HookFactoryReadAbi,
      functionName: "isFactoryHook",
      args: [addresses.feeHook],
      expected: true,
      label: "factory hook provenance",
    },
    {
      address: addresses.growthVaultFactory,
      abi: deepV3GrowthVaultFactoryReadAbi,
      functionName: "implementation",
      expected: addresses.growthVaultImplementation,
      label: "vault implementation",
    },
    {
      address: addresses.growthVaultFactory,
      abi: deepV3GrowthVaultFactoryReadAbi,
      functionName: "planner",
      expected: addresses.zapPlanner,
      label: "zap planner",
    },
    {
      address: addresses.growthVaultImplementation,
      abi: deepV3GrowthVaultImplementationReadAbi,
      functionName: "FACTORY",
      expected: addresses.growthVaultFactory,
      label: "vault factory",
    },
    {
      address: addresses.automation,
      abi: deepV3AutomationReadAbi,
      functionName: "vaultFactory",
      expected: addresses.growthVaultFactory,
      label: "automation vault factory",
    },
    {
      address: addresses.automation,
      abi: deepV3AutomationReadAbi,
      functionName: "launcher",
      expected: addresses.launcher,
      label: "automation launcher",
    },
    {
      address: addresses.automation,
      abi: deepV3AutomationReadAbi,
      functionName: "OBSERVATION_CARDINALITY_TARGET",
      expected:
        DEEP_V3_FIXED_POLICY.oracleObservationCardinalityTarget,
      label: "oracle cardinality",
    },
    {
      address: addresses.keeperExecutor,
      abi: deepV3KeeperExecutorReadAbi,
      functionName: "automation",
      expected: addresses.automation,
      label: "keeper automation",
    },
    {
      address: addresses.keeperExecutor,
      abi: deepV3KeeperExecutorReadAbi,
      functionName: "MAX_BATCH_SIZE",
      expected: 4n,
      label: "keeper batch size",
    },
    {
      address: addresses.lockedPositionFactory,
      abi: deepV3LockedPositionFactoryReadAbi,
      functionName: "positionManager",
      expected: official.positionManager.address,
      label: "locked position factory PositionManager",
    },
  ];
  await Promise.all(
    reads.map((expectation) =>
      verifyRead(clients, blockNumber, expectation),
    ),
  );

  return {
    blockNumber,
    blockHash: blocks[0].hash as Hex,
  };
}

export function requireIndependentDeepV3RpcUrls(
  primary: string | undefined,
  secondary: string | undefined,
): readonly [string, string] {
  const endpoints = [primary?.trim(), secondary?.trim()];
  if (!endpoints[0] || !endpoints[1]) {
    throw new Error("Deep V3 launch verification requires two RPC URLs");
  }
  let urls: [URL, URL];
  try {
    urls = [new URL(endpoints[0]), new URL(endpoints[1])];
  } catch {
    throw new Error(
      "Deep V3 launch verification requires valid RPC URLs",
    );
  }
  if (urls.some((url) => url.protocol !== "https:")) {
    throw new Error(
      "Deep V3 launch verification requires HTTPS RPC URLs",
    );
  }
  if (urls[0].hostname.toLowerCase() === urls[1].hostname.toLowerCase()) {
    throw new Error(
      "Deep V3 launch verification requires independent RPC providers",
    );
  }
  return [endpoints[0], endpoints[1]];
}
