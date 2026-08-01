import "server-only";

import {
  createPublicClient,
  http,
  type Hex,
} from "viem";
import { mainnet } from "viem/chains";

import type {
  CandidateRpcRewardSnapshot,
  CandidateRpcClient,
  CandidateRpcProvider,
} from "./dual-rpc";
import { invalidInput } from "./errors";
import {
  canonicalProjectorRpcEndpoint,
  projectorRpcDeploymentCommitment,
  projectorRpcSchemaCommitment,
} from "./projector-provider-commitments";
import {
  expectedRewardRpcCallCount,
  PROJECTOR_REWARD_RPC_CALL_CONTRACT_V1,
  type ProjectorRewardRpcModel,
} from "./projector-reward-rpc-contract";
import { rpcProviderCommitment } from "./rpc-provider-commitments";

type Environment = Readonly<Record<string, string | undefined>>;

const BROWSER_FORBIDDEN_RPC_NAMES = [
  "NEXT_PUBLIC_PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL",
  "NEXT_PUBLIC_PROGRAMMABLE_QUICKNODE_MAINNET_RPC_URL",
] as const;
const PRODUCTION_PROVIDER_PAIRS = new WeakSet<object>();
const ERC20_METADATA_ABI = [
  {
    type: "function",
    name: "name",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
] as const;
const REWARD_VAULT_ABI = [
  {
    type: "function",
    name: "poolId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "configurationEpoch",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint64" }],
  },
  {
    type: "function",
    name: "activeConfigurationHash",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "configurationHash",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "totalCreatorFeesReceived",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "totalCreatorFeesClaimed",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "beneficiaryCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "beneficiaryAt",
    stateMutability: "view",
    inputs: [{ name: "index", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "shareBpsAt",
    stateMutability: "view",
    inputs: [{ name: "index", type: "uint256" }],
    outputs: [{ name: "", type: "uint16" }],
  },
  {
    type: "function",
    name: "shareBpsOf",
    stateMutability: "view",
    inputs: [{ name: "beneficiary", type: "address" }],
    outputs: [{ name: "", type: "uint16" }],
  },
  {
    type: "function",
    name: "payoutAddressOf",
    stateMutability: "view",
    inputs: [{ name: "beneficiary", type: "address" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "claimable",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "claimedBy",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

type RewardFunctionName =
  (typeof REWARD_VAULT_ABI)[number]["name"];

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
    getBytecode: (request) =>
      "blockHash" in request && request.blockHash !== undefined
        ? client.getBytecode({
            address: request.address,
            blockHash: request.blockHash,
            requireCanonical: true,
          })
        : client.getBytecode({
            address: request.address,
            blockNumber: request.blockNumber,
          }),
    async readErc20Metadata({ address, blockNumber }) {
      const [name, symbol] = await Promise.all([
        client.readContract({
          address,
          abi: ERC20_METADATA_ABI,
          functionName: "name",
          blockNumber,
        }),
        client.readContract({
          address,
          abi: ERC20_METADATA_ABI,
          functionName: "symbol",
          blockNumber,
        }),
      ]);
      return { name, symbol };
    },
    async readRewardSnapshot({
      model,
      vault,
      blockNumber,
      blockHash,
      balanceAccounts,
    }): Promise<CandidateRpcRewardSnapshot> {
      const contract = PROJECTOR_REWARD_RPC_CALL_CONTRACT_V1.models[model];
      if (
        !contract ||
        balanceAccounts.length < 1 ||
        balanceAccounts.length > contract.maximumBalanceAccounts
      ) {
        throw invalidInput("rpc", "reward-snapshot-request");
      }
      let rpcCallCount = 0;
      const decimal = (value: unknown): unknown =>
        typeof value === "bigint" ? value.toString() : value;
      const read = async (
        functionName: RewardFunctionName,
        args: readonly unknown[] = [],
      ): Promise<unknown> => {
        rpcCallCount += 1;
        return client.readContract({
          address: vault,
          abi: REWARD_VAULT_ABI,
          functionName,
          args,
          blockHash,
          requireCanonical: true,
        } as never);
      };
      const [
        poolId,
        configurationEpoch,
        configurationHash,
        totalCreatorFeesReceived,
        totalCreatorFeesClaimed,
        beneficiaryCountRaw,
      ] = model === "classic-v3"
        ? await Promise.all([
            read("poolId"),
            read("configurationEpoch"),
            read("activeConfigurationHash"),
            read("totalCreatorFeesReceived"),
            read("totalCreatorFeesClaimed"),
            read("beneficiaryCount"),
          ])
        : [
            ...await Promise.all([
              read("poolId"),
              read("configurationHash"),
              read("totalCreatorFeesReceived"),
              read("totalCreatorFeesClaimed"),
              read("beneficiaryCount"),
            ]).then(
              ([pool, hash, received, claimed, count]) =>
                [pool, null, hash, received, claimed, count] as const,
            ),
          ];
      if (typeof beneficiaryCountRaw !== "bigint") {
        throw invalidInput("rpc", "reward-beneficiary-count");
      }
      const beneficiaryCount = Number(beneficiaryCountRaw);
      if (
        !Number.isSafeInteger(beneficiaryCount) ||
        beneficiaryCount < 1 ||
        beneficiaryCount > contract.maximumAllocations
      ) {
        throw invalidInput("rpc", "reward-beneficiary-count");
      }
      const allocations = await Promise.all(
        Array.from({ length: beneficiaryCount }, async (_value, index) => {
          const beneficiary = await read("beneficiaryAt", [BigInt(index)]);
          if (model === "classic-v3") {
            const shareBps = await read("shareBpsAt", [BigInt(index)]);
            return Object.freeze({
              allocationIndex: index,
              beneficiary,
              payoutAddress: beneficiary,
              shareBps: decimal(shareBps),
            });
          }
          const [shareBps, payoutAddress] = await Promise.all([
            read("shareBpsOf", [beneficiary]),
            read("payoutAddressOf", [beneficiary]),
          ]);
          return Object.freeze({
            allocationIndex: index,
            beneficiary,
            payoutAddress,
            shareBps: decimal(shareBps),
          });
        }),
      );
      const payoutByAccount = new Map(
        allocations.map(({ beneficiary, payoutAddress }) => [
          beneficiary,
          payoutAddress,
        ]),
      );
      const balances = await Promise.all(
        balanceAccounts.map(async (account) => {
          const [claimableAccrued, claimedTotal] = await Promise.all([
            read("claimable", [account]),
            read("claimedBy", [account]),
          ]);
          return Object.freeze({
            account,
            payoutAddress:
              model === "classic-v3"
                ? account
                : payoutByAccount.get(account) ?? account,
            claimableAccrued: decimal(claimableAccrued),
            claimedTotal: decimal(claimedTotal),
          });
        }),
      );
      if (
        rpcCallCount !==
          expectedRewardRpcCallCount(
            model as ProjectorRewardRpcModel,
            beneficiaryCount,
            balanceAccounts.length,
          )
      ) {
        throw invalidInput("rpc", "reward-call-contract");
      }
      return Object.freeze({
        model,
        vault,
        blockNumber: blockNumber.toString(),
        blockHash,
        poolId,
        configurationEpoch: decimal(configurationEpoch),
        configurationHash,
        totalCreatorFeesReceived: decimal(totalCreatorFeesReceived),
        totalCreatorFeesClaimed: decimal(totalCreatorFeesClaimed),
        beneficiaryCount: beneficiaryCountRaw.toString(),
        allocations: Object.freeze(allocations),
        balances: Object.freeze(balances),
        rpcCallCount,
      });
    },
    async getLogs({ addresses, fromBlock, toBlock }) {
      const logs = await client.getLogs({
        address: [...addresses],
        fromBlock,
        toBlock,
      });
      return logs.map((log) => ({
        address: log.address,
        blockNumber: log.blockNumber,
        blockHash: log.blockHash,
        transactionHash: log.transactionHash,
        transactionIndex: log.transactionIndex,
        logIndex: log.logIndex,
        removed: log.removed ?? false,
        topics: log.topics as readonly Hex[],
        data: log.data,
      }));
    },
  });
}

function productionRpcConfiguration(env: Environment) {
  if (BROWSER_FORBIDDEN_RPC_NAMES.some((name) => env[name])) {
    throw invalidInput("config", "browser-rpc-provider-url");
  }
  const alchemyEndpoint = canonicalProjectorRpcEndpoint(
    env.PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL,
    "alchemy",
  );
  const quicknodeEndpoint = canonicalProjectorRpcEndpoint(
    env.PROGRAMMABLE_QUICKNODE_MAINNET_RPC_URL,
    "quicknode",
  );
  const alchemy = new URL(alchemyEndpoint);
  const quicknode = new URL(quicknodeEndpoint);
  if (alchemy.origin === quicknode.origin) {
    throw invalidInput("config", "rpc-provider-independence");
  }
  const schemaCommitment = projectorRpcSchemaCommitment();
  return Object.freeze({
    alchemy,
    quicknode,
    schemaCommitment,
    alchemyDeploymentCommitment: projectorRpcDeploymentCommitment(
      alchemy.toString(),
    ),
    quicknodeDeploymentCommitment: projectorRpcDeploymentCommitment(
      quicknode.toString(),
    ),
  });
}

export function productionRpcProjectorCommitments(
  env: Environment = process.env,
) {
  const configuration = productionRpcConfiguration(env);
  return Object.freeze({
    alchemy: Object.freeze({
      deploymentCommitment: configuration.alchemyDeploymentCommitment,
      schemaCommitment: configuration.schemaCommitment,
    }),
    quicknode: Object.freeze({
      deploymentCommitment: configuration.quicknodeDeploymentCommitment,
      schemaCommitment: configuration.schemaCommitment,
    }),
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
  const configuration = productionRpcConfiguration(env);
  const { alchemy, quicknode } = configuration;

  const alchemyCommitment = configuration.alchemyDeploymentCommitment;
  const quicknodeCommitment = configuration.quicknodeDeploymentCommitment;
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
