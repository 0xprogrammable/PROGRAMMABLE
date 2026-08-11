import { createPublicClient, http, type Hex } from "viem";
import { mainnet, sepolia } from "viem/chains";

import {
  isOperationalRpcFailoverEligible,
  OperationalRpcUnavailableError,
  withOperationalRpcFailover,
} from "./operational-rpc-failover.server";
import type { ReadyOnchainDeployment } from "./types";

type RpcRole = "primary" | "secondary";
type ProviderStatus =
  | "available"
  | "stale"
  | "unavailable"
  | "invalid"
  | "unknown";

export const OPERATIONAL_RPC_MAX_HEAD_AGE_SECONDS = 5 * 60;
export const OPERATIONAL_RPC_MAX_FUTURE_SKEW_SECONDS = 60;

type RpcHealthClient = Readonly<{
  getChainId: () => Promise<number>;
  getBlockNumber: () => Promise<bigint>;
  getBlock: (input: Readonly<{ blockNumber: bigint }>) => Promise<{
    number: bigint | null;
    hash: Hex | null;
    timestamp: bigint;
  }>;
}>;

export type OperationalRpcHealthDependencies = Readonly<{
  createClient: (rpcUrl: string) => RpcHealthClient;
  nowMs: () => number;
}>;

export type OperationalRpcHealth = Readonly<{
  status: "healthy" | "degraded" | "unhealthy";
  chainId: number;
  read: Readonly<{
    status: "available" | "unavailable" | "blocked";
    servedBy: RpcRole | null;
    failoverUsed: boolean;
  }>;
  providers: Readonly<{
    primary: Readonly<{
      status: ProviderStatus;
      head: string | null;
      headAgeSeconds: number | null;
    }>;
    secondary: Readonly<{
      status: ProviderStatus;
      head: string | null;
      headAgeSeconds: number | null;
    }>;
  }>;
  freshness: Readonly<{ maxHeadAgeSeconds: number }>;
  quorum: Readonly<{
    status: "verified" | "unavailable" | "mismatch";
  }>;
  confirmedBlock: Readonly<{
    number: string;
    hash: Hex;
  }> | null;
}>;

type ProviderProbe = {
  status: ProviderStatus;
  head: bigint | null;
  headAgeSeconds: number | null;
  client: RpcHealthClient | null;
};

type ConfirmedProviderResult =
  | Readonly<{ status: "available"; hash: Hex }>
  | Readonly<{
      status: Exclude<ProviderStatus, "available">;
      hash: null;
    }>;

class RpcHealthIntegrityError extends Error {
  override name = "RpcHealthIntegrityError";

  constructor() {
    super("Operational RPC integrity validation failed");
  }
}

function defaultDependencies(
  deployment: ReadyOnchainDeployment,
): OperationalRpcHealthDependencies {
  const chain = deployment.chainId === 1 ? mainnet : sepolia;
  return {
    nowMs: Date.now,
    createClient: (rpcUrl) =>
      createPublicClient({
        chain,
        transport: http(rpcUrl, {
          retryCount: 0,
          timeout: 12_000,
        }),
      }),
  };
}

function publicProvider(probe: ProviderProbe) {
  return {
    status: probe.status,
    head: probe.head?.toString() ?? null,
    headAgeSeconds: probe.headAgeSeconds,
  } as const;
}

function result(
  deployment: ReadyOnchainDeployment,
  probes: Readonly<Record<RpcRole, ProviderProbe>>,
  input: Readonly<{
    status: OperationalRpcHealth["status"];
    readStatus: OperationalRpcHealth["read"]["status"];
    servedBy: RpcRole | null;
    quorumStatus: OperationalRpcHealth["quorum"]["status"];
    confirmedBlock?: OperationalRpcHealth["confirmedBlock"];
  }>,
): OperationalRpcHealth {
  return {
    status: input.status,
    chainId: deployment.chainId,
    read: {
      status: input.readStatus,
      servedBy: input.servedBy,
      failoverUsed: input.servedBy === "secondary",
    },
    providers: {
      primary: publicProvider(probes.primary),
      secondary: publicProvider(probes.secondary),
    },
    freshness: {
      maxHeadAgeSeconds: OPERATIONAL_RPC_MAX_HEAD_AGE_SECONDS,
    },
    quorum: { status: input.quorumStatus },
    confirmedBlock: input.confirmedBlock ?? null,
  };
}

function confirmedBlockNumber(head: bigint, confirmations: bigint) {
  return head > confirmations ? head - confirmations : 0n;
}

function validBlockHash(hash: unknown): hash is Hex {
  return typeof hash === "string" && /^0x[0-9a-fA-F]{64}$/u.test(hash);
}

/**
 * Reports operational read availability separately from two-provider quorum.
 * One fixed provider may keep reads available while health remains explicitly
 * degraded; wrong-chain or conflicting confirmed data always fails closed.
 */
export async function readOperationalRpcHealth(
  deployment: ReadyOnchainDeployment,
  dependencies = defaultDependencies(deployment),
): Promise<OperationalRpcHealth> {
  const probes: Record<RpcRole, ProviderProbe> = {
    primary: {
      status: "unknown",
      head: null,
      headAgeSeconds: null,
      client: null,
    },
    secondary: {
      status: "unknown",
      head: null,
      headAgeSeconds: null,
      client: null,
    },
  };
  const secondaryUrl = deployment.rpcUrlSecondary;
  if (!secondaryUrl || secondaryUrl === deployment.rpcUrl) {
    return result(deployment, probes, {
      status: "unhealthy",
      readStatus: "blocked",
      servedBy: null,
      quorumStatus: "unavailable",
    });
  }
  const nowMs = dependencies.nowMs();
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
    return result(deployment, probes, {
      status: "unhealthy",
      readStatus: "blocked",
      servedBy: null,
      quorumStatus: "unavailable",
    });
  }
  const observedAtSeconds = BigInt(Math.floor(nowMs / 1_000));

  const roleForUrl = (rpcUrl: string): RpcRole => {
    if (rpcUrl === deployment.rpcUrl) return "primary";
    if (rpcUrl === secondaryUrl) return "secondary";
    throw new RpcHealthIntegrityError();
  };

  const probeProvider = async (role: RpcRole, rpcUrl: string) => {
    const client = dependencies.createClient(rpcUrl);
    probes[role].client = client;
    try {
      const [chainId, head] = await Promise.all([
        client.getChainId(),
        client.getBlockNumber(),
      ]);
      if (chainId !== deployment.chainId || head < 0n) {
        probes[role].status = "invalid";
        probes[role].head = head;
        throw new RpcHealthIntegrityError();
      }
      probes[role].head = head;
      const headBlock = await client.getBlock({ blockNumber: head });
      if (
        headBlock.number !== head ||
        !validBlockHash(headBlock.hash) ||
        typeof headBlock.timestamp !== "bigint" ||
        headBlock.timestamp < 0n ||
        headBlock.timestamp >
          observedAtSeconds +
            BigInt(OPERATIONAL_RPC_MAX_FUTURE_SKEW_SECONDS)
      ) {
        probes[role].status = "invalid";
        throw new RpcHealthIntegrityError();
      }
      const headAge =
        observedAtSeconds > headBlock.timestamp
          ? observedAtSeconds - headBlock.timestamp
          : 0n;
      probes[role].headAgeSeconds = Number(headAge);
      probes[role].status =
        headAge > BigInt(OPERATIONAL_RPC_MAX_HEAD_AGE_SECONDS)
          ? "stale"
          : "available";
      return role;
    } catch (error) {
      if (error instanceof RpcHealthIntegrityError) throw error;
      if (isOperationalRpcFailoverEligible(error)) {
        probes[role].status = "unavailable";
        throw error;
      }
      probes[role].status = "invalid";
      throw new RpcHealthIntegrityError();
    }
  };

  let operationalRole: RpcRole;
  try {
    operationalRole = await withOperationalRpcFailover(
      deployment,
      async (candidate) => {
        const role = roleForUrl(candidate.rpcUrl);
        return probeProvider(role, candidate.rpcUrl);
      },
    );
  } catch (error) {
    if (
      error instanceof OperationalRpcUnavailableError ||
      isOperationalRpcFailoverEligible(error)
    ) {
      return result(deployment, probes, {
        status: "unhealthy",
        readStatus: "unavailable",
        servedBy: null,
        quorumStatus: "unavailable",
      });
    }
    return result(deployment, probes, {
      status: "unhealthy",
      readStatus: "blocked",
      servedBy: null,
      quorumStatus: "mismatch",
    });
  }

  if (operationalRole === "primary") {
    try {
      await probeProvider("secondary", secondaryUrl);
    } catch (error) {
      if (!isOperationalRpcFailoverEligible(error)) {
        return result(deployment, probes, {
          status: "unhealthy",
          readStatus: "blocked",
          servedBy: null,
          quorumStatus: "mismatch",
        });
      }
    }
  }

  const confirmProvider = async (
    role: RpcRole,
    blockNumber: bigint,
  ): Promise<ConfirmedProviderResult> => {
    const probe = probes[role];
    if (probe.status !== "available" || !probe.client) {
      return {
        status:
          probe.status === "available" ? "invalid" : probe.status,
        hash: null,
      };
    }
    try {
      const block = await probe.client.getBlock({ blockNumber });
      if (
        block.number !== blockNumber ||
        !validBlockHash(block.hash)
      ) {
        probe.status = "invalid";
        return { status: "invalid", hash: null } as const;
      }
      return { status: "available", hash: block.hash } as const;
    } catch (error) {
      if (isOperationalRpcFailoverEligible(error)) {
        probe.status = "unavailable";
        return { status: "unavailable", hash: null } as const;
      }
      probe.status = "invalid";
      return { status: "invalid", hash: null } as const;
    }
  };

  const availableRoles = (["primary", "secondary"] as const).filter(
    (role) => probes[role].status === "available",
  );
  if (availableRoles.length === 2) {
    const primaryHead = probes.primary.head!;
    const secondaryHead = probes.secondary.head!;
    const lowestHead =
      primaryHead < secondaryHead ? primaryHead : secondaryHead;
    const blockNumber = confirmedBlockNumber(
      lowestHead,
      deployment.confirmations,
    );
    const [primaryBlock, secondaryBlock] = await Promise.all([
      confirmProvider("primary", blockNumber),
      confirmProvider("secondary", blockNumber),
    ]);

    if (
      primaryBlock.status === "invalid" ||
      secondaryBlock.status === "invalid"
    ) {
      return result(deployment, probes, {
        status: "unhealthy",
        readStatus: "blocked",
        servedBy: null,
        quorumStatus: "mismatch",
      });
    }
    if (
      primaryBlock.status === "available" &&
      secondaryBlock.status === "available"
    ) {
      if (primaryBlock.hash.toLowerCase() !== secondaryBlock.hash.toLowerCase()) {
        return result(deployment, probes, {
          status: "unhealthy",
          readStatus: "blocked",
          servedBy: null,
          quorumStatus: "mismatch",
        });
      }
      return result(deployment, probes, {
        status: "healthy",
        readStatus: "available",
        servedBy: "primary",
        quorumStatus: "verified",
        confirmedBlock: {
          number: blockNumber.toString(),
          hash: primaryBlock.hash,
        },
      });
    }

    const survivingRole =
      primaryBlock.status === "available"
        ? "primary"
        : secondaryBlock.status === "available"
          ? "secondary"
          : null;
    const survivingBlock =
      survivingRole === "primary" ? primaryBlock : secondaryBlock;
    if (survivingRole && survivingBlock.status === "available") {
      return result(deployment, probes, {
        status: "degraded",
        readStatus: "available",
        servedBy: survivingRole,
        quorumStatus: "unavailable",
        confirmedBlock: {
          number: blockNumber.toString(),
          hash: survivingBlock.hash,
        },
      });
    }
    return result(deployment, probes, {
      status: "unhealthy",
      readStatus: "unavailable",
      servedBy: null,
      quorumStatus: "unavailable",
    });
  }

  if (availableRoles.length === 1) {
    const role = availableRoles[0]!;
    const blockNumber = confirmedBlockNumber(
      probes[role].head!,
      deployment.confirmations,
    );
    const block = await confirmProvider(role, blockNumber);
    if (block.status === "available") {
      return result(deployment, probes, {
        status: "degraded",
        readStatus: "available",
        servedBy: role,
        quorumStatus: "unavailable",
        confirmedBlock: {
          number: blockNumber.toString(),
          hash: block.hash,
        },
      });
    }
    return result(deployment, probes, {
      status: "unhealthy",
      readStatus: block.status === "invalid" ? "blocked" : "unavailable",
      servedBy: null,
      quorumStatus:
        block.status === "invalid" ? "mismatch" : "unavailable",
    });
  }

  return result(deployment, probes, {
    status: "unhealthy",
    readStatus: "unavailable",
    servedBy: null,
    quorumStatus: "unavailable",
  });
}
