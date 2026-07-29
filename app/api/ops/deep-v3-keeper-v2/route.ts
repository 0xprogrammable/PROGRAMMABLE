import "server-only";

import { PrivyClient } from "@privy-io/node";
import {
  createPublicClient,
  decodeEventLog,
  http,
  keccak256,
  type Address,
  type Hex,
} from "viem";
import { mainnet } from "viem/chains";

import {
  handleDeepV3KeeperV2Request,
  type DeepV3KeeperV2RouteDependencies,
} from "./handler";
import {
  parseDeepV3KeeperV2Config,
  type DeepV3KeeperV2Config,
} from "../../../../ops/deep-keeper-v3/config-v2.mjs";
import {
  acquireDeepV3KeeperV2Control,
  assertDeepV3KeeperV2Control,
  createDeepV3KeeperV2State,
  inspectDeepV3LegacyControl,
  inspectStableDeepV3LegacyControl,
  releaseDeepV3KeeperV2Control,
  validateDeepV3KeeperV2State,
  writeDeepV3KeeperV2State,
  type DeepV3KeeperV2Control,
  type DeepV3KeeperV2State,
} from "../../../../ops/deep-keeper-v3/control-v2.mjs";
import {
  DEEP_V3_V2_AUTOMATION_ABI,
  DEEP_V3_V2_EXECUTOR_ABI,
  DEEP_V3_V2_LAUNCHER_ABI,
  DEEP_V3_V2_VAULT_ABI,
  runDeepV3KeeperV2Cycle,
} from "../../../../ops/deep-keeper-v3/core-v2.mjs";
import { createPrivyDeepV3KeeperV2Wallet } from "../../../../ops/deep-keeper-v3/privy-wallet-v2.mjs";
import { evaluateDeepV3KeeperV2ReleaseGate } from "../../../../ops/deep-keeper-v3/release-gate-v2.mjs";
import opsV2SourceBinding from "../../../../ops/deep-keeper-v3/ops-v2-source-binding.json";
import reviewedOpsV2Binding from "../../../../ops/deep-keeper-v3/reviewed-ops-v2-binding.json";
import deepV3ReleaseManifest from "../../../../contracts/deployments/mainnet-deep-full-range-v3.json";
import { createDeepV3KeeperV2ControlStore } from "./storage";

export const dynamic = "force-dynamic";
export const maxDuration = 120;
export const runtime = "nodejs";

const RPC_TIMEOUT_MS = 12_000;
const RPC_RETRY_COUNT = 1;
const CYCLE_DEADLINE_MS = 100_000;
const SIGNER_REQUEST_EXPIRY_BUFFER_MS = 5_000;
const CURRENT_OPS_SOURCE_COMMITMENT =
  opsV2SourceBinding.opsSourceCommitment;

class DeepV3KeeperV2DeadlineError extends Error {
  readonly code = "CYCLE_DEADLINE";

  constructor() {
    super("Deep V3 keeper v2 cycle deadline elapsed");
    this.name = "DeepV3KeeperV2DeadlineError";
  }
}

function assertBefore(deadlineMs: number) {
  if (Date.now() >= deadlineMs) {
    throw new DeepV3KeeperV2DeadlineError();
  }
}

async function loadRelease() {
  return deepV3ReleaseManifest as unknown;
}

function signerEnvironment(config: DeepV3KeeperV2Config) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  const appSecret = process.env.PRIVY_APP_SECRET;
  const lane = config.signerLanes[0];
  if (
    !config.enabled ||
    !config.sendTransactions ||
    !appId ||
    !appSecret ||
    !lane
  ) {
    throw new Error("Keeper signer is unavailable");
  }
  return {
    appId,
    appSecret,
    walletId: lane.privyWalletId,
    signerAddress: lane.signerAddress,
  };
}

function createReader(url: string) {
  const client = createPublicClient({
    chain: mainnet,
    transport: http(url, {
      retryCount: RPC_RETRY_COUNT,
      timeout: RPC_TIMEOUT_MS,
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
        gasLimit: block.gasLimit,
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
        DEEP_V3_V2_EXECUTOR_ABI,
        "automation",
        [],
        blockNumber,
      );
    },
    readAutomationLauncher(address: Address, blockNumber: bigint) {
      return read(
        address,
        DEEP_V3_V2_AUTOMATION_ABI,
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
        DEEP_V3_V2_AUTOMATION_ABI,
        "vaultFactory",
        [],
        blockNumber,
      );
    },
    readLauncherAutomation(address: Address, blockNumber: bigint) {
      return read(
        address,
        DEEP_V3_V2_LAUNCHER_ABI,
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
        DEEP_V3_V2_LAUNCHER_ABI,
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
        DEEP_V3_V2_AUTOMATION_ABI,
        "registeredVaultCount",
        [],
        blockNumber,
      )) as bigint;
    },
    async scanAutomation(
      address: Address,
      cursor: bigint,
      limit: bigint,
      blockNumber: bigint,
    ) {
      const [ready, nextCursor] = (await read(
        address,
        DEEP_V3_V2_AUTOMATION_ABI,
        "scan",
        [cursor, limit],
        blockNumber,
      )) as [
        readonly { vault: Address; action: number }[],
        bigint,
      ];
      return {
        ready: ready.map(({ vault, action }) => ({
          vault,
          action: Number(action),
        })),
        nextCursor,
      };
    },
    async readVaultWorkState(
      address: Address,
      blockNumber: bigint,
    ) {
      const [
        action,
        hookGrowthFees,
        pendingNative,
        nextEligibleTimestamp,
        rollingCapacity,
        blockedReason,
      ] = (await read(
        address,
        DEEP_V3_V2_VAULT_ABI,
        "workState",
        [],
        blockNumber,
      )) as [number, bigint, bigint, bigint, bigint, Hex];
      return {
        action: Number(action),
        hookGrowthFees,
        pendingNative,
        nextEligibleTimestamp,
        rollingCapacity,
        blockedReason,
      };
    },
    getBalance(address: Address, blockNumber: bigint) {
      return client.getBalance({ address, blockNumber });
    },
    getConfirmedTransactionCount(
      address: Address,
      blockNumber: bigint,
    ) {
      return client.getTransactionCount({ address, blockNumber });
    },
    getPendingTransactionCount(address: Address) {
      return client.getTransactionCount({
        address,
        blockTag: "pending",
      });
    },
    async simulateExecute(
      address: Address,
      candidates: readonly unknown[],
      account: Address,
      blockNumber: bigint,
    ) {
      const result = await client.simulateContract({
        address,
        abi: DEEP_V3_V2_EXECUTOR_ABI,
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
        abi: DEEP_V3_V2_EXECUTOR_ABI,
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
          nonce: transaction.nonce,
          gas: transaction.gas,
          maxFeePerGas: transaction.maxFeePerGas,
          maxPriorityFeePerGas:
            transaction.maxPriorityFeePerGas,
          chainId: transaction.chainId,
          type: transaction.type,
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
    candidateResults(
      receipt: {
        logs: readonly {
          address: Address;
          data: Hex;
          topics: readonly Hex[];
        }[];
      },
      executorAddress: Address,
    ) {
      const results = [];
      for (const log of receipt.logs) {
        if (
          log.address.toLowerCase() !==
          executorAddress.toLowerCase()
        ) {
          continue;
        }
        try {
          const decoded = decodeEventLog({
            abi: DEEP_V3_V2_EXECUTOR_ABI,
            eventName: "CandidateResult",
            data: log.data,
            topics: [...log.topics] as [Hex, ...Hex[]],
          });
          const args = decoded.args as {
            batchHash: Hex;
            candidateIndex: bigint;
            vault: Address;
            executor: Address;
            expectedAction: number;
            actualAction: number;
            outcome: number;
          };
          results.push({
            batchHash: args.batchHash,
            candidateIndex: Number(args.candidateIndex),
            vault: args.vault,
            executor: args.executor,
            expectedAction: Number(args.expectedAction),
            actualAction: Number(args.actualAction),
            outcome: Number(args.outcome),
          });
        } catch {
          continue;
        }
      }
      return results;
    },
  };
}

async function executeEligibleCycle(
  _release: unknown,
  configValue: unknown,
): Promise<
  Awaited<
    ReturnType<
      DeepV3KeeperV2RouteDependencies["executeEligibleCycle"]
    >
  >
> {
  const config = configValue as DeepV3KeeperV2Config;
  const deadlineMs = Date.now() + CYCLE_DEADLINE_MS;
  const signerRequestExpiryMs =
    deadlineMs - SIGNER_REQUEST_EXPIRY_BUFFER_MS;
  const signer = signerEnvironment(config);
  const store = createDeepV3KeeperV2ControlStore();
  let control: DeepV3KeeperV2Control | null = null;
  try {
    assertBefore(deadlineMs);
    const legacy = await store.read(config.legacyControlPath);
    const migration = inspectDeepV3LegacyControl(
      legacy?.value ?? null,
      Date.now(),
    );
    assertBefore(deadlineMs);
    control = await acquireDeepV3KeeperV2Control({
      store,
      nowMs: Date.now(),
    });
    if (!control) return { kind: "busy" };
    const legacyAfterAcquire = await store.read(
      config.legacyControlPath,
    );
    inspectStableDeepV3LegacyControl(
      legacy,
      legacyAfterAcquire,
      Date.now(),
    );
    const assertLegacyStable = async () => {
      const currentLegacy = await store.read(
        config.legacyControlPath,
      );
      inspectStableDeepV3LegacyControl(
        legacyAfterAcquire,
        currentLegacy,
        Date.now(),
      );
      return true;
    };
    const baseState =
      control.state === null
        ? createDeepV3KeeperV2State(config, {
            ...migration,
            importedAtMs: Date.now(),
          })
        : validateDeepV3KeeperV2State(control.state, config);
    const state: DeepV3KeeperV2State = {
      ...baseState,
      fencingGeneration: control.generation,
    };
    const assertFence = async () => {
      assertBefore(deadlineMs);
      await assertLegacyStable();
      return assertDeepV3KeeperV2Control({
        store,
        control: control!,
        nowMs: Date.now(),
      });
    };
    const persistState = (next: DeepV3KeeperV2State) => {
      assertBefore(deadlineMs);
      return writeDeepV3KeeperV2State({
        store,
        control: control!,
        state: next,
        config,
        nowMs: Date.now(),
      });
    };
    const readers = config.rpcUrls.map(createReader);
    const wallet = createPrivyDeepV3KeeperV2Wallet({
      client: new PrivyClient({
        appId: signer.appId,
        appSecret: signer.appSecret,
      }),
      walletId: signer.walletId,
      signerAddress: signer.signerAddress,
      executorAddress: config.executorAddress,
      chainId: config.chainId,
    });
    const result = await runDeepV3KeeperV2Cycle({
      config,
      state,
      readers,
      wallet,
      nowMs: Date.now(),
      requestExpiryMs: signerRequestExpiryMs,
      persistState,
      assertFence,
    });
    return { kind: "completed", result };
  } finally {
    if (control) {
      try {
        await releaseDeepV3KeeperV2Control({
          store,
          control,
          nowMs: Date.now(),
        });
      } catch {
        console.error("Deep V3 keeper v2 control release failed");
      }
    }
  }
}

export async function GET(request: Request) {
  return handleDeepV3KeeperV2Request(request, {
    cronSecret: process.env.CRON_SECRET,
    loadRelease,
    parseConfig: () => parseDeepV3KeeperV2Config(process.env),
    evaluateReleaseGate: (release, config) =>
      evaluateDeepV3KeeperV2ReleaseGate(
        release,
        config as DeepV3KeeperV2Config,
        reviewedOpsV2Binding,
        CURRENT_OPS_SOURCE_COMMITMENT,
      ),
    executeEligibleCycle,
    logFailure(errorName, errorCode) {
      console.error("Deep V3 keeper v2 cycle failed", {
        errorName,
        errorCode,
      });
    },
  });
}
