import "server-only";

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PrivyClient } from "@privy-io/node";
import {
  BlobNotFoundError,
  BlobPreconditionFailedError,
  get,
  put,
} from "@vercel/blob";
import {
  decodeEventLog,
  getAddress,
  keccak256,
  type Address,
  type Hex,
  createPublicClient,
  http,
} from "viem";
import { mainnet } from "viem/chains";

import {
  handleDeepV3KeeperRequest,
  type DeepV3KeeperRouteDependencies,
} from "./handler";
import { createPrivyKeeperWallet } from "../../../../ops/deep-keeper/privy-wallet.mjs";
import {
  DEEP_V3_RELEASE_MANIFEST_PATH,
  parseDeepV3KeeperConfig,
  type DeepV3KeeperConfig,
} from "../../../../ops/deep-keeper-v3/config.mjs";
import {
  acquireDeepV3KeeperControl,
  assertDeepV3KeeperControl,
  createDeepV3KeeperState,
  releaseDeepV3KeeperControl,
  validateDeepV3KeeperState,
  writeDeepV3KeeperState,
  type DeepV3KeeperControl,
  type DeepV3KeeperControlStore,
  type DeepV3KeeperState,
} from "../../../../ops/deep-keeper-v3/control.mjs";
import {
  DEEP_V3_AUTOMATION_ABI,
  DEEP_V3_EXECUTOR_ABI,
  DEEP_V3_LAUNCHER_ABI,
  runDeepV3KeeperCycle,
} from "../../../../ops/deep-keeper-v3/core.mjs";
import { evaluateDeepV3KeeperReleaseGate } from "../../../../ops/deep-keeper-v3/release-gate.mjs";
import reviewedReleaseBinding from "../../../../ops/deep-keeper-v3/reviewed-release-binding.json";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const runtime = "nodejs";

const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const DEEP_V3_RELEASE_MANIFEST_FILE = resolve(
  process.cwd(),
  "contracts/deployments/mainnet-deep-full-range-v3.json",
);

if (
  DEEP_V3_RELEASE_MANIFEST_PATH !==
  "contracts/deployments/mainnet-deep-full-range-v3.json"
) {
  throw new Error("Deep V3 manifest path drifted");
}

function missingFile(error: unknown) {
  return (
    error instanceof Error &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

async function loadRelease() {
  let contents: Buffer;
  try {
    contents = await readFile(
      DEEP_V3_RELEASE_MANIFEST_FILE,
    );
  } catch (error) {
    if (missingFile(error)) return null;
    throw error;
  }
  if (
    contents.byteLength === 0 ||
    contents.byteLength > MAX_MANIFEST_BYTES
  ) {
    throw new Error("Invalid release manifest");
  }
  const release: unknown = JSON.parse(contents.toString("utf8"));
  if (
    release === null ||
    typeof release !== "object" ||
    Array.isArray(release)
  ) {
    throw new Error("Invalid release manifest");
  }
  return release;
}

function blobToken() {
  const token = process.env.OPS_BLOB_READ_WRITE_TOKEN;
  if (!token) throw new Error("Keeper storage is unavailable");
  return token;
}

function createControlStore(): DeepV3KeeperControlStore {
  const token = blobToken();
  return {
    async read(path) {
      try {
        const result = await get(path, {
          access: "private",
          token,
          useCache: false,
        });
        if (!result) return null;
        if (result.statusCode !== 200 || !result.stream) {
          throw new Error("Keeper storage read failed");
        }
        return {
          value: await new Response(result.stream).text(),
          etag: result.blob.etag,
        };
      } catch (error) {
        if (error instanceof BlobNotFoundError) return null;
        throw error;
      }
    },
    async putIfAbsent(path, value) {
      try {
        const result = await put(path, value, {
          access: "private",
          contentType: "application/json",
          addRandomSuffix: false,
          allowOverwrite: false,
          cacheControlMaxAge: 0,
          token,
        });
        return { etag: result.etag };
      } catch (error) {
        if (error instanceof BlobPreconditionFailedError) return null;
        throw error;
      }
    },
    async putIfMatch(path, value, etag) {
      try {
        const result = await put(path, value, {
          access: "private",
          contentType: "application/json",
          addRandomSuffix: false,
          allowOverwrite: true,
          ifMatch: etag,
          cacheControlMaxAge: 0,
          token,
        });
        return { etag: result.etag };
      } catch (error) {
        if (error instanceof BlobPreconditionFailedError) return null;
        throw error;
      }
    },
  };
}

function signerEnvironment(config: DeepV3KeeperConfig) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  const appSecret = process.env.PRIVY_APP_SECRET;
  if (
    !config.enabled ||
    !appId ||
    !appSecret ||
    !config.privyWalletId ||
    !config.signerAddress
  ) {
    throw new Error("Keeper signer is unavailable");
  }
  return {
    appId,
    appSecret,
    walletId: config.privyWalletId,
    signerAddress: config.signerAddress,
  };
}

function createReader(url: string) {
  const client = createPublicClient({
    chain: mainnet,
    transport: http(url, {
      retryCount: 2,
      timeout: 15_000,
    }),
  });
  const read = (
    address: Address,
    abi: readonly unknown[],
    functionName: string,
    args: readonly unknown[],
    blockNumber: bigint,
  ) =>
    client.readContract({
      address,
      abi,
      functionName,
      args,
      blockNumber,
    } as never);

  return {
    getChainId: () => client.getChainId(),
    getBlockNumber: () => client.getBlockNumber(),
    getBlock: (blockNumber: bigint) =>
      client.getBlock({ blockNumber }).then((block) => ({
        number: block.number,
        hash: block.hash,
      })),
    async getRuntimeHash(address: Address, blockNumber: bigint) {
      const code = await client.getCode({ address, blockNumber });
      if (!code || code === "0x") {
        throw new Error("Reviewed runtime is missing");
      }
      return keccak256(code);
    },
    readExecutorAutomation(address: Address, blockNumber: bigint) {
      return read(
        address,
        DEEP_V3_EXECUTOR_ABI,
        "automation",
        [],
        blockNumber,
      );
    },
    readAutomationLauncher(address: Address, blockNumber: bigint) {
      return read(
        address,
        DEEP_V3_AUTOMATION_ABI,
        "launcher",
        [],
        blockNumber,
      );
    },
    readAutomationVaultFactory(
      address: Address,
      blockNumber: bigint,
    ) {
      return read(
        address,
        DEEP_V3_AUTOMATION_ABI,
        "vaultFactory",
        [],
        blockNumber,
      );
    },
    readLauncherAutomation(address: Address, blockNumber: bigint) {
      return read(
        address,
        DEEP_V3_LAUNCHER_ABI,
        "automation",
        [],
        blockNumber,
      );
    },
    readLauncherVaultFactory(
      address: Address,
      blockNumber: bigint,
    ) {
      return read(
        address,
        DEEP_V3_LAUNCHER_ABI,
        "growthVaultFactory",
        [],
        blockNumber,
      );
    },
    async readRegisteredVaultCount(
      address: Address,
      blockNumber: bigint,
    ) {
      return (await read(
        address,
        DEEP_V3_AUTOMATION_ABI,
        "registeredVaultCount",
        [],
        blockNumber,
      )) as bigint;
    },
    async readRegisteredVaultAt(
      address: Address,
      index: bigint,
      blockNumber: bigint,
    ) {
      return (await read(
        address,
        DEEP_V3_AUTOMATION_ABI,
        "registeredVaultAt",
        [index],
        blockNumber,
      )) as Address;
    },
    async assessVault(
      address: Address,
      vault: Address,
      blockNumber: bigint,
    ) {
      return Number(
        await read(
          address,
          DEEP_V3_AUTOMATION_ABI,
          "assessVault",
          [vault],
          blockNumber,
        ),
      );
    },
    getBalance(address: Address, blockNumber: bigint) {
      return client.getBalance({ address, blockNumber });
    },
    async simulateExecute(
      address: Address,
      candidates: readonly unknown[],
      account: Address,
      blockNumber: bigint,
    ) {
      const result = await client.simulateContract({
        address,
        abi: DEEP_V3_EXECUTOR_ABI,
        functionName: "execute",
        args: [candidates],
        account,
        blockNumber,
      } as never);
      const [, attempted, succeeded] = result.result as [
        Hex,
        bigint,
        bigint,
      ];
      return { attempted, succeeded };
    },
    estimateExecuteGas(
      address: Address,
      candidates: readonly unknown[],
      account: Address,
      blockNumber: bigint,
    ) {
      return client.estimateContractGas({
        address,
        abi: DEEP_V3_EXECUTOR_ABI,
        functionName: "execute",
        args: [candidates],
        account,
        blockNumber,
      } as never);
    },
    async estimateFees() {
      const fees = await client.estimateFeesPerGas();
      if (
        fees.maxFeePerGas === undefined ||
        fees.maxPriorityFeePerGas === undefined
      ) {
        throw new Error("EIP-1559 fee estimate is unavailable");
      }
      return {
        maxFeePerGas: fees.maxFeePerGas,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      };
    },
    async getReceipt(transactionHash: Hex) {
      try {
        const receipt = await client.getTransactionReceipt({
          hash: transactionHash,
        });
        return {
          transactionHash: receipt.transactionHash,
          status: receipt.status,
          blockNumber: receipt.blockNumber,
          blockHash: receipt.blockHash,
          gasUsed: receipt.gasUsed,
          effectiveGasPrice: receipt.effectiveGasPrice,
          from: receipt.from,
          to: receipt.to,
          logs: receipt.logs,
        };
      } catch (error) {
        if (
          error instanceof Error &&
          error.name === "TransactionReceiptNotFoundError"
        ) {
          return null;
        }
        throw error;
      }
    },
    async getTransaction(transactionHash: Hex) {
      try {
        const transaction = await client.getTransaction({
          hash: transactionHash,
        });
        return {
          hash: transaction.hash,
          from: transaction.from,
          to: transaction.to,
          value: transaction.value,
          input: transaction.input,
        };
      } catch (error) {
        if (
          error instanceof Error &&
          error.name === "TransactionNotFoundError"
        ) {
          return null;
        }
        throw error;
      }
    },
    productiveAction(
      receipt: { logs: readonly { address: Address; data: Hex; topics: readonly Hex[] }[] },
      executor: Address,
      vault: Address,
      signer: Address,
    ) {
      const matches: number[] = [];
      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== executor.toLowerCase()) {
          continue;
        }
        try {
          const decoded = decodeEventLog({
            abi: DEEP_V3_EXECUTOR_ABI,
            eventName: "CandidateResult",
            data: log.data,
            topics: [...log.topics] as [Hex, ...Hex[]],
          });
          const args = decoded.args as {
            candidateIndex: bigint;
            vault: Address;
            executor: Address;
            expectedAction: number;
            actualAction: number;
            outcome: number;
          };
          if (
            args.candidateIndex === 0n &&
            getAddress(args.vault) === getAddress(vault) &&
            getAddress(args.executor) === getAddress(signer) &&
            Number(args.expectedAction) === Number(args.actualAction) &&
            Number(args.outcome) === 4
          ) {
            matches.push(Number(args.actualAction));
          }
        } catch {
          continue;
        }
      }
      return matches.length === 1 ? matches[0] : null;
    },
  };
}

async function executeEligibleCycle(
  _release: unknown,
  configValue: unknown,
): Promise<
  Awaited<
    ReturnType<
      DeepV3KeeperRouteDependencies["executeEligibleCycle"]
    >
  >
> {
  const config = configValue as DeepV3KeeperConfig;
  const signer = signerEnvironment(config);
  const store = createControlStore();
  let control: DeepV3KeeperControl | null = null;
  try {
    control = await acquireDeepV3KeeperControl({
      store,
      nowMs: Date.now(),
    });
    if (!control) return { kind: "busy" };
    const baseState =
      control.state === null
        ? createDeepV3KeeperState(config)
        : validateDeepV3KeeperState(control.state, config);
    const state: DeepV3KeeperState = {
      ...baseState,
      fencingGeneration: control.generation,
    };
    const assertFence = () =>
      assertDeepV3KeeperControl({
        store,
        control: control!,
        nowMs: Date.now(),
      });
    const persistState = (next: DeepV3KeeperState) =>
      writeDeepV3KeeperState({
        store,
        control: control!,
        state: next,
        config,
        nowMs: Date.now(),
      });
    const readers = config.rpcUrls.map(createReader);
    const wallet = createPrivyKeeperWallet({
      client: new PrivyClient({
        appId: signer.appId,
        appSecret: signer.appSecret,
      }),
      walletId: signer.walletId,
      signerAddress: signer.signerAddress,
      coordinatorAddress: config.executorAddress,
      chainId: config.chainId,
    });
    const result = await runDeepV3KeeperCycle({
      config,
      state,
      readers,
      wallet,
      nowMs: Date.now(),
      persistState,
      assertFence,
    });
    return { kind: "completed", result };
  } finally {
    if (control) {
      try {
        await releaseDeepV3KeeperControl({
          store,
          control,
          nowMs: Date.now(),
        });
      } catch {
        console.error("Deep V3 keeper control release failed");
      }
    }
  }
}

export async function GET(request: Request) {
  return handleDeepV3KeeperRequest(request, {
    cronSecret: process.env.CRON_SECRET,
    loadRelease,
    parseConfig: () => parseDeepV3KeeperConfig(process.env),
    evaluateReleaseGate: (release, config) =>
      evaluateDeepV3KeeperReleaseGate(
        release,
        config as DeepV3KeeperConfig,
        reviewedReleaseBinding,
      ),
    executeEligibleCycle,
    logFailure(errorName, errorCode) {
      console.error("Deep V3 keeper cycle failed", {
        errorName,
        errorCode,
      });
    },
  });
}
