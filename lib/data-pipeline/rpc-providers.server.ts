import "server-only";

import {
  createPublicClient,
  http,
  type Hex,
} from "viem";
import { mainnet } from "viem/chains";

import type {
  CandidateRpcClient,
  CandidateRpcProvider,
} from "./dual-rpc";
import { invalidInput } from "./errors";
import { rpcProviderCommitment } from "./rpc-provider-commitments";

type Environment = Readonly<Record<string, string | undefined>>;

const ALCHEMY_HOST = "eth-mainnet.g.alchemy.com";
const ALCHEMY_API_PATH = /^\/v2\/[A-Za-z0-9_-]{8,256}$/u;
const QUICKNODE_API_PATH = /^\/[A-Za-z0-9_-]{8,256}\/?$/u;
const QUICKNODE_HOST =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+quiknode\.pro$/u;
const BROWSER_FORBIDDEN_RPC_NAMES = [
  "NEXT_PUBLIC_PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL",
  "NEXT_PUBLIC_PROGRAMMABLE_QUICKNODE_MAINNET_RPC_URL",
] as const;
const PRODUCTION_PROVIDER_PAIRS = new WeakSet<object>();

export function assertProductionDualRpcProviders(
  providers: unknown,
): void {
  const productionMarkerPresent =
    process.env.NODE_ENV === "production" ||
    process.env.VERCEL_ENV === "production";
  if (process.env.NODE_ENV === "test" && !productionMarkerPresent) return;
  if (
    providers === null ||
    (typeof providers !== "object" && typeof providers !== "function") ||
    !PRODUCTION_PROVIDER_PAIRS.has(providers)
  ) {
    throw invalidInput("rpc", "untrusted-provider-pair");
  }
}

function credentialPath(value: URL, provider: "alchemy" | "quicknode") {
  return provider === "alchemy"
    ? value.pathname.slice("/v2/".length)
    : value.pathname.replace(/^\//u, "").replace(/\/$/u, "");
}

function productionRpcUrl(
  value: string | undefined,
  provider: "alchemy" | "quicknode",
): URL {
  if (typeof value !== "string" || value.length < 1 || value.length > 1_024) {
    throw invalidInput("config", "rpc-provider-url");
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw invalidInput("config", "rpc-provider-url");
  }

  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.port !== "" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw invalidInput("config", "rpc-provider-url");
  }

  if (
    (provider === "alchemy" &&
      (parsed.hostname !== ALCHEMY_HOST ||
        !ALCHEMY_API_PATH.test(parsed.pathname))) ||
    (provider === "quicknode" &&
      (!QUICKNODE_HOST.test(parsed.hostname) ||
        !QUICKNODE_API_PATH.test(parsed.pathname))) ||
    credentialPath(parsed, provider) === "docs-demo"
  ) {
    throw invalidInput("config", "rpc-provider-url");
  }

  return parsed;
}

function candidateRpcClient(endpoint: string): CandidateRpcClient {
  const client = createPublicClient({
    chain: mainnet,
    transport: http(endpoint, {
      batch: false,
      fetchOptions: { redirect: "error" },
      retryCount: 0,
      timeout: 5_000,
    }),
  });

  return Object.freeze({
    getChainId: () => client.getChainId(),
    getBlockNumber: () => client.getBlockNumber(),
    async getBlock({ blockNumber }) {
      const block = await client.getBlock({ blockNumber });
      return {
        number: block.number,
        hash: block.hash,
        timestamp: block.timestamp,
      };
    },
    async getTransactionReceipt({ hash }) {
      const receipt = await client.getTransactionReceipt({ hash });
      return {
        status: receipt.status,
        blockNumber: receipt.blockNumber,
        blockHash: receipt.blockHash,
        transactionHash: receipt.transactionHash,
        transactionIndex: receipt.transactionIndex,
        logs: receipt.logs.map((log) => ({
          address: log.address,
          blockNumber: log.blockNumber,
          blockHash: log.blockHash,
          transactionHash: log.transactionHash,
          transactionIndex: log.transactionIndex,
          logIndex: log.logIndex,
          removed: log.removed ?? false,
          topics: log.topics as readonly Hex[],
          data: log.data,
        })),
      };
    },
    getBytecode: ({ address, blockNumber }) =>
      client.getBytecode({ address, blockNumber }),
  });
}

/**
 * Creates the only production provider pair accepted by the background
 * projector. Provider identity is derived from strict endpoint validation,
 * never from caller-supplied labels.
 */
export function createProductionDualRpcProviders(
  env: Environment = process.env,
): readonly [CandidateRpcProvider, CandidateRpcProvider] {
  if (BROWSER_FORBIDDEN_RPC_NAMES.some((name) => env[name])) {
    throw invalidInput("config", "browser-rpc-provider-url");
  }
  const alchemy = productionRpcUrl(
    env.PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL,
    "alchemy",
  );
  const quicknode = productionRpcUrl(
    env.PROGRAMMABLE_QUICKNODE_MAINNET_RPC_URL,
    "quicknode",
  );

  if (alchemy.origin === quicknode.origin) {
    throw invalidInput("config", "rpc-provider-independence");
  }

  const alchemyCommitment = rpcProviderCommitment(
    "endpoint",
    alchemy.toString(),
  );
  const quicknodeCommitment = rpcProviderCommitment(
    "endpoint",
    quicknode.toString(),
  );
  const alchemyOriginCommitment = rpcProviderCommitment(
    "origin",
    alchemy.origin,
  );
  const quicknodeOriginCommitment = rpcProviderCommitment(
    "origin",
    quicknode.origin,
  );

  const providers = Object.freeze([
    Object.freeze({
      identity: `alchemy-mainnet-${alchemyCommitment.slice(2, 34)}`,
      vendorGroup: "alchemy",
      endpointCommitment: alchemyCommitment,
      endpointOriginCommitment: alchemyOriginCommitment,
      client: candidateRpcClient(alchemy.toString()),
    }),
    Object.freeze({
      identity: `quicknode-mainnet-${quicknodeCommitment.slice(2, 34)}`,
      vendorGroup: "quicknode",
      endpointCommitment: quicknodeCommitment,
      endpointOriginCommitment: quicknodeOriginCommitment,
      client: candidateRpcClient(quicknode.toString()),
    }),
  ] as const);
  PRODUCTION_PROVIDER_PAIRS.add(providers);
  return providers;
}
