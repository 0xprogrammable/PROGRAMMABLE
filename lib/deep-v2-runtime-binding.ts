import {
  isAddress,
  isHex,
  keccak256,
  parseAbi,
  type Address,
  type Hex,
} from "viem";

export const deepV2KeeperExecutorReadAbi = parseAbi([
  "function automation() view returns (address)",
]);

export type DeepV2RuntimeBindingClient = {
  getChainId(): Promise<number>;
  getFinalizedBlock(): Promise<{ number: bigint; hash: Hex | null }>;
  getBlock(input: {
    blockNumber: bigint;
  }): Promise<{ number: bigint; hash: Hex | null }>;
  getCode(input: {
    address: Address;
    blockNumber: bigint;
  }): Promise<Hex | undefined>;
  readKeeperAutomation(input: {
    address: Address;
    blockNumber: bigint;
  }): Promise<Address>;
  readAutomationLauncher(input: {
    address: Address;
    blockNumber: bigint;
  }): Promise<Address>;
  readLauncherAutomation(input: {
    address: Address;
    blockNumber: bigint;
  }): Promise<Address>;
};

export function requireIndependentDeepV2RpcUrls(
  primary: string | undefined,
  secondary: string | undefined,
): readonly [string, string] {
  const endpoints = [primary?.trim(), secondary?.trim()];
  if (!endpoints[0] || !endpoints[1]) {
    throw new Error("Deep V2 launch verification requires two RPC URLs");
  }
  let urls: [URL, URL];
  try {
    urls = [new URL(endpoints[0]), new URL(endpoints[1])];
  } catch {
    throw new Error("Deep V2 launch verification requires valid RPC URLs");
  }
  if (urls.some((url) => url.protocol !== "https:")) {
    throw new Error("Deep V2 launch verification requires HTTPS RPC URLs");
  }
  if (urls[0].hostname.toLowerCase() === urls[1].hostname.toLowerCase()) {
    throw new Error(
      "Deep V2 launch verification requires independent RPC providers",
    );
  }
  return [endpoints[0], endpoints[1]];
}

type DeepV2RuntimeBindingRelease = {
  launcher: Address;
  automation: Address;
  keeperExecutor: Address;
  deploymentBlock: number;
  keeperExecutorDeploymentBlock: number;
  keeperExecutorRuntimeCodeHash: Hex;
  runtimeCodeHashes: {
    automation: Hex;
  };
};

function validHash(value: unknown): value is Hex {
  return (
    typeof value === "string" &&
    isHex(value, { strict: true }) &&
    value.length === 66
  );
}

function sameHex(left: string, right: string) {
  return left.toLowerCase() === right.toLowerCase();
}

function sameAddress(left: unknown, right: Address) {
  return (
    typeof left === "string" &&
    isAddress(left) &&
    left.toLowerCase() === right.toLowerCase()
  );
}

function validRelease(release: DeepV2RuntimeBindingRelease) {
  return (
    isAddress(release.launcher) &&
    isAddress(release.automation) &&
    isAddress(release.keeperExecutor) &&
    release.automation.toLowerCase() !==
      release.keeperExecutor.toLowerCase() &&
    Number.isSafeInteger(release.deploymentBlock) &&
    release.deploymentBlock > 0 &&
    Number.isSafeInteger(release.keeperExecutorDeploymentBlock) &&
    release.keeperExecutorDeploymentBlock >= release.deploymentBlock &&
    validHash(release.keeperExecutorRuntimeCodeHash) &&
    validHash(release.runtimeCodeHashes.automation)
  );
}

export async function assertDeepV2KeeperRuntimeBinding(input: {
  clients: readonly DeepV2RuntimeBindingClient[];
  chainId: number;
  release: DeepV2RuntimeBindingRelease;
}): Promise<{ blockNumber: bigint; blockHash: Hex }> {
  const { clients, chainId, release } = input;
  if (clients.length !== 2) {
    throw new Error(
      "Deep V2 launch verification requires exactly two RPC clients",
    );
  }
  if (!Number.isSafeInteger(chainId) || chainId <= 0 || !validRelease(release)) {
    throw new Error("Deep V2 runtime release binding is invalid");
  }

  const chainIds = await Promise.all(
    clients.map((client) => client.getChainId()),
  );
  if (chainIds.some((actual) => actual !== chainId)) {
    throw new Error("Deep V2 runtime RPC chain does not match the release");
  }

  const finalized = await Promise.all(
    clients.map((client) => client.getFinalizedBlock()),
  );
  if (
    finalized.some(
      (block) =>
        block.number <= 0n ||
        !block.hash ||
        !validHash(block.hash),
    )
  ) {
    throw new Error("Deep V2 RPC did not return a finalized block");
  }
  const blockNumber =
    finalized[0].number < finalized[1].number
      ? finalized[0].number
      : finalized[1].number;
  if (
    blockNumber < BigInt(release.deploymentBlock) ||
    blockNumber < BigInt(release.keeperExecutorDeploymentBlock)
  ) {
    throw new Error(
      "Deep V2 finalized block predates the reviewed deployment",
    );
  }

  const canonicalBlocks = await Promise.all(
    clients.map((client) => client.getBlock({ blockNumber })),
  );
  const canonicalHash = canonicalBlocks[0].hash;
  if (
    canonicalBlocks.some(
      (block) =>
        block.number !== blockNumber ||
        !block.hash ||
        !validHash(block.hash),
    ) ||
    !canonicalHash ||
    !sameHex(canonicalHash, canonicalBlocks[1].hash as Hex)
  ) {
    throw new Error(
      "Independent Deep V2 RPCs disagree on the finalized block",
    );
  }

  const verifyRuntime = async (
    address: Address,
    expectedHash: Hex,
    label: string,
  ) => {
    const codes = await Promise.all(
      clients.map((client) =>
        client.getCode({ address, blockNumber }),
      ),
    );
    if (
      !codes[0] ||
      codes[0] === "0x" ||
      !codes[1] ||
      codes[1] === "0x" ||
      !sameHex(codes[0], codes[1])
    ) {
      throw new Error(
        `Independent Deep V2 RPCs disagree on the ${label} runtime`,
      );
    }
    if (!sameHex(keccak256(codes[0]), expectedHash)) {
      throw new Error(
        `Deep V2 ${label} runtime does not match the reviewed release`,
      );
    }
  };

  await Promise.all([
    verifyRuntime(
      release.keeperExecutor,
      release.keeperExecutorRuntimeCodeHash,
      "keeper executor",
    ),
    verifyRuntime(
      release.automation,
      release.runtimeCodeHashes.automation,
      "automation",
    ),
  ]);

  const [
    keeperAutomation,
    automationLauncher,
    launcherAutomation,
  ] = await Promise.all([
    Promise.all(
      clients.map((client) =>
        client.readKeeperAutomation({
          address: release.keeperExecutor,
          blockNumber,
        }),
      ),
    ),
    Promise.all(
      clients.map((client) =>
        client.readAutomationLauncher({
          address: release.automation,
          blockNumber,
        }),
      ),
    ),
    Promise.all(
      clients.map((client) =>
        client.readLauncherAutomation({
          address: release.launcher,
          blockNumber,
        }),
      ),
    ),
  ]);

  if (
    keeperAutomation.some(
      (value) => !sameAddress(value, release.automation),
    )
  ) {
    throw new Error(
      "Deep V2 keeper executor automation binding does not match the reviewed release",
    );
  }
  if (
    automationLauncher.some(
      (value) => !sameAddress(value, release.launcher),
    )
  ) {
    throw new Error(
      "Deep V2 automation launcher binding does not match the reviewed release",
    );
  }
  if (
    launcherAutomation.some(
      (value) => !sameAddress(value, release.automation),
    )
  ) {
    throw new Error(
      "Deep V2 launcher automation binding does not match the reviewed release",
    );
  }

  return {
    blockNumber,
    blockHash: canonicalHash,
  };
}
