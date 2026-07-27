import { createPublicClient, http, type Hex } from "viem";
import { mainnet, sepolia } from "viem/chains";

import type { ReadyOnchainDeployment } from "./types";

export type IndependentRpcHealth = {
  chainId: number;
  heads: [string, string];
  confirmedBlock: {
    number: string;
    hash: Hex;
  };
};

export async function readIndependentRpcHealth(
  deployment: ReadyOnchainDeployment,
): Promise<IndependentRpcHealth> {
  if (!deployment.rpcUrlSecondary) {
    throw new Error("Independent RPC health requires two RPC URLs");
  }

  const chain =
    deployment.chainId === 1 ? mainnet : sepolia;
  const clients = [
    createPublicClient({
      chain,
      transport: http(deployment.rpcUrl, {
        retryCount: 2,
        timeout: 12_000,
      }),
    }),
    createPublicClient({
      chain,
      transport: http(deployment.rpcUrlSecondary, {
        retryCount: 2,
        timeout: 12_000,
      }),
    }),
  ] as const;
  const states = await Promise.all(
    clients.map(async (client) => ({
      chainId: await client.getChainId(),
      head: await client.getBlockNumber(),
    })),
  );
  if (
    states.some((state) => state.chainId !== deployment.chainId)
  ) {
    throw new Error("RPC chain does not match the deployment manifest");
  }

  const lowestHead =
    states[0].head < states[1].head ? states[0].head : states[1].head;
  const confirmedBlockNumber =
    lowestHead > deployment.confirmations
      ? lowestHead - deployment.confirmations
      : 0n;
  const blocks = await Promise.all(
    clients.map((client) =>
      client.getBlock({ blockNumber: confirmedBlockNumber }),
    ),
  );
  const hash = blocks[0].hash;
  if (
    !hash ||
    !blocks[1].hash ||
    blocks[1].hash.toLowerCase() !== hash.toLowerCase()
  ) {
    throw new Error(
      "Independent RPCs disagree on the confirmed block",
    );
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
