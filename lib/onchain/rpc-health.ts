import { createPublicClient, http, type Hex } from "viem";
import { mainnet, sepolia } from "viem/chains";

import {
  createRpcCallBudget,
  preserveTypedHttpError,
  withBoundedRpcRetry,
  type RpcRetryOptions,
} from "./rpc-resilience";
import type { ReadyOnchainDeployment } from "./types";

export type IndependentRpcHealth = {
  chainId: number;
  heads: [string, string];
  confirmedBlock: {
    number: string;
    hash: Hex;
  };
};

type RpcHealthClient = Readonly<{
  getChainId: () => Promise<number>;
  getBlockNumber: () => Promise<bigint>;
  getBlock: (parameters: {
    blockNumber: bigint;
  }) => Promise<{ hash: Hex | null }>;
}>;

export async function readRpcHealthFromClients(
  deployment: ReadyOnchainDeployment,
  clients: readonly [RpcHealthClient, RpcHealthClient],
  retryOptions: RpcRetryOptions = {},
): Promise<IndependentRpcHealth> {
  const deadlineMs = retryOptions.deadlineMs ?? 20_000;
  const budgets = clients.map((_, providerIndex) =>
    createRpcCallBudget({
      providerId: `RPC provider ${providerIndex + 1}`,
      operationName: "independent RPC health",
      maximumCalls: 9,
      deadlineMs,
    }),
  );
  const read = <T>(
    providerIndex: number,
    operationName: string,
    operation: () => Promise<T>,
  ) =>
    withBoundedRpcRetry(operation, {
      providerId: `RPC provider ${providerIndex + 1}`,
      operationName,
      retryOptions,
      budget: budgets[providerIndex],
    });

  const states = await Promise.all(
    clients.map(async (client, providerIndex) => {
      const chainId = await read(providerIndex, "eth_chainId", () =>
        client.getChainId(),
      );
      if (chainId !== deployment.chainId) {
        throw new Error("RPC chain does not match the deployment manifest");
      }
      const head = await read(providerIndex, "eth_blockNumber", () =>
        client.getBlockNumber(),
      );
      return { chainId, head };
    }),
  );

  const lowestHead =
    states[0].head < states[1].head ? states[0].head : states[1].head;
  const confirmedBlockNumber =
    lowestHead > deployment.confirmations
      ? lowestHead - deployment.confirmations
      : 0n;
  const blocks = await Promise.all(
    clients.map((client, providerIndex) =>
      read(providerIndex, "eth_getBlockByNumber", () =>
        client.getBlock({ blockNumber: confirmedBlockNumber }),
      ),
    ),
  );
  const hash = blocks[0].hash;
  if (
    !hash ||
    !blocks[1].hash ||
    blocks[1].hash.toLowerCase() !== hash.toLowerCase()
  ) {
    throw new Error("Independent RPCs disagree on the confirmed block");
  }

  return {
    chainId: deployment.chainId,
    heads: [states[0].head.toString(), states[1].head.toString()],
    confirmedBlock: {
      number: confirmedBlockNumber.toString(),
      hash,
    },
  };
}

export async function readIndependentRpcHealth(
  deployment: ReadyOnchainDeployment,
): Promise<IndependentRpcHealth> {
  const secondaryRpcUrl = deployment.rpcUrlSecondary;
  if (!secondaryRpcUrl) {
    throw new Error("Independent RPC health requires two RPC URLs");
  }

  const chain =
    deployment.chainId === 1 ? mainnet : sepolia;
  const clients = [
    createPublicClient({
      chain,
      transport: http(deployment.rpcUrl, {
        onFetchResponse: (response) =>
          preserveTypedHttpError(response, deployment.rpcUrl),
        retryCount: 0,
        timeout: 5_000,
      }),
    }),
    createPublicClient({
      chain,
      transport: http(secondaryRpcUrl, {
        onFetchResponse: (response) =>
          preserveTypedHttpError(response, secondaryRpcUrl),
        retryCount: 0,
        timeout: 5_000,
      }),
    }),
  ] as const;
  return readRpcHealthFromClients(deployment, clients);
}
