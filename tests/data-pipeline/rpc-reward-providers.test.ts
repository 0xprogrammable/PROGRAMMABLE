import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readContract: vi.fn(),
  createPublicClient: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    createPublicClient: mocks.createPublicClient,
  };
});

import { createProductionDualRpcProviders } from "../../lib/data-pipeline/rpc-providers.server";
import { productionMainnetRpcEnvironment } from "../../lib/onchain/website-rpc-providers.server";

const DRPC = "https://lb.drpc.live/ethereum/drpc-test-key";
const QUICKNODE =
  "https://programmable.ethereum-mainnet.quiknode.pro/quicknode-test-token/";
const PRODUCTION_RPC_ENVIRONMENT = productionMainnetRpcEnvironment(
  DRPC,
  QUICKNODE,
);
const address = (digit: string) =>
  `0x${digit.repeat(40)}` as `0x${string}`;
const bytes32 = (digit: string) =>
  `0x${digit.repeat(64)}` as `0x${string}`;

describe("production reward-vault RPC reader", () => {
  beforeEach(() => {
    mocks.readContract.mockReset();
    mocks.createPublicClient.mockReset();
    mocks.createPublicClient.mockReturnValue({
      readContract: mocks.readContract,
    });
  });

  it("uses only committed call shapes at the requested historical block", async () => {
    const vault = address("7");
    const alice = address("1");
    const bob = address("2");
    const blockHash = bytes32("9");
    mocks.readContract.mockImplementation(async ({ functionName, args }) => {
      if (functionName === "poolId") return bytes32("3");
      if (functionName === "configurationEpoch") return 2n;
      if (functionName === "activeConfigurationHash") return bytes32("4");
      if (functionName === "totalCreatorFeesReceived") return 13n;
      if (functionName === "totalCreatorFeesClaimed") return 4n;
      if (functionName === "beneficiaryCount") return 2n;
      if (functionName === "beneficiaryAt") return bob;
      if (functionName === "shareBpsAt") {
        return args[0] === 0n ? 4_000 : 6_000;
      }
      if (functionName === "claimable") {
        return args[0] === alice ? 0n : 9n;
      }
      if (functionName === "claimedBy") {
        return args[0] === alice ? 4n : 0n;
      }
      throw new Error("unexpected function");
    });
    const providers = createProductionDualRpcProviders(
      PRODUCTION_RPC_ENVIRONMENT,
    );

    const snapshot = await providers[0].client.readRewardSnapshot!({
      model: "classic-v3",
      vault,
      blockNumber: 100n,
      blockHash,
      balanceAccounts: [alice, bob],
    });

    expect(snapshot).toMatchObject({
      model: "classic-v3",
      vault,
      blockNumber: "100",
      blockHash,
      beneficiaryCount: "2",
      rpcCallCount: 14,
      balances: [
        { account: alice, claimableAccrued: "0", claimedTotal: "4" },
        { account: bob, claimableAccrued: "9", claimedTotal: "0" },
      ],
    });
    expect(mocks.readContract).toHaveBeenCalledTimes(14);
    for (const [request] of mocks.readContract.mock.calls) {
      expect(request).toMatchObject({
        address: vault,
        blockHash,
        requireCanonical: true,
      });
      expect(request).not.toHaveProperty("blockNumber");
    }
    expect(
      [...new Set(
        mocks.readContract.mock.calls.map(
          ([request]) => request.functionName,
        ),
      )].sort(),
    ).toEqual([
      "activeConfigurationHash",
      "beneficiaryAt",
      "beneficiaryCount",
      "claimable",
      "claimedBy",
      "configurationEpoch",
      "poolId",
      "shareBpsAt",
      "totalCreatorFeesClaimed",
      "totalCreatorFeesReceived",
    ]);
  });

  it("caps physical reward reads at eight in flight per provider", async () => {
    const vault = address("7");
    const beneficiary = address("1");
    const blockHash = bytes32("9");
    const accounts = Array.from({ length: 48 }, (_value, index) =>
      `0x${(index + 1).toString(16).padStart(40, "0")}` as `0x${string}`
    );
    let inFlight = 0;
    let maximumInFlight = 0;
    mocks.readContract.mockImplementation(async ({ functionName }) => {
      inFlight += 1;
      maximumInFlight = Math.max(maximumInFlight, inFlight);
      await new Promise<void>((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      if (functionName === "poolId") return bytes32("3");
      if (functionName === "configurationEpoch") return 1n;
      if (functionName === "activeConfigurationHash") return bytes32("4");
      if (functionName === "totalCreatorFeesReceived") return 0n;
      if (functionName === "totalCreatorFeesClaimed") return 0n;
      if (functionName === "beneficiaryCount") return 1n;
      if (functionName === "beneficiaryAt") return beneficiary;
      if (functionName === "shareBpsAt") return 10_000n;
      if (functionName === "claimable" || functionName === "claimedBy") {
        return 0n;
      }
      throw new Error("unexpected function");
    });
    const providers = createProductionDualRpcProviders(
      PRODUCTION_RPC_ENVIRONMENT,
    );

    const snapshot = await providers[0].client.readRewardSnapshot!({
      model: "classic-v3",
      vault,
      blockNumber: 100n,
      blockHash,
      balanceAccounts: accounts,
    });

    expect(snapshot.rpcCallCount).toBe(104);
    expect(mocks.readContract).toHaveBeenCalledTimes(104);
    expect(maximumInFlight).toBeGreaterThan(1);
    expect(maximumInFlight).toBeLessThanOrEqual(8);
  }, 10_000);

  it("shares one eight-call limit across mixed single and batch reads", async () => {
    const blockHash = bytes32("9");
    const transactionHash = bytes32("8");
    const token = address("7");
    let inFlight = 0;
    let maximumInFlight = 0;
    const physical = async <T>(value: T): Promise<T> => {
      inFlight += 1;
      maximumInFlight = Math.max(maximumInFlight, inFlight);
      await new Promise<void>((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      return value;
    };
    const block = { number: 100n, hash: blockHash, timestamp: 1_000n };
    const receipt = {
      status: "success" as const,
      blockNumber: 100n,
      blockHash,
      transactionHash,
      transactionIndex: 0,
      logs: [],
    };
    const singleClient = {
      getBlock: vi.fn(async () => physical(block)),
      getTransactionReceipt: vi.fn(async () => physical(receipt)),
      getBytecode: vi.fn(async () => physical("0x60" as const)),
      request: vi.fn(async () => physical([])),
      readContract: mocks.readContract,
    };
    const batchClient = {
      getBlock: vi.fn(async () => physical(block)),
      getTransactionReceipt: vi.fn(async () => physical(receipt)),
      getBytecode: vi.fn(async () => physical("0x60" as const)),
      request: vi.fn(async () => physical([])),
      readContract: mocks.readContract,
    };
    mocks.createPublicClient
      .mockReset()
      .mockReturnValueOnce(singleClient)
      .mockReturnValueOnce(batchClient)
      .mockReturnValueOnce(singleClient)
      .mockReturnValueOnce(batchClient);
    const providers = createProductionDualRpcProviders(
      PRODUCTION_RPC_ENVIRONMENT,
    );
    const blockNumbers = Array.from({ length: 20 }, (_value, index) =>
      BigInt(101 + index)
    );
    const hashes = Array.from({ length: 20 }, (_value, index) =>
      `0x${(index + 1).toString(16).padStart(64, "0")}` as `0x${string}`
    );
    const bytecodeRequests = blockNumbers.map(() => ({
      address: token,
      blockHash,
      requireCanonical: true as const,
    }));
    const logFilter = {
      addresses: [token],
      topic0: [bytes32("6")],
      fromBlock: 100n,
      toBlock: 100n,
    };

    await Promise.all([
      providers[0].client.getBlock({ blockNumber: 100n }),
      providers[0].client.getBlocks!({ blockNumbers }),
      providers[0].client.getTransactionReceipt({ hash: transactionHash }),
      providers[0].client.getTransactionReceipts!({ hashes }),
      providers[0].client.getBytecode({ address: token, blockNumber: 100n }),
      providers[0].client.getBytecodes!({ requests: bytecodeRequests }),
      providers[0].client.getLogs!(logFilter),
      providers[0].client.getLogsBatch!({
        requests: Array.from({ length: 20 }, () => logFilter),
      }),
    ]);

    expect(maximumInFlight).toBeGreaterThan(1);
    expect(maximumInFlight).toBeLessThanOrEqual(8);
    expect(batchClient.getBlock).toHaveBeenCalledTimes(20);
    expect(batchClient.getTransactionReceipt).toHaveBeenCalledTimes(20);
    expect(batchClient.getBytecode).toHaveBeenCalledTimes(20);
    expect(batchClient.request).toHaveBeenCalledTimes(20);
  }, 10_000);

  it("reads factory authentication and CREATE2 helpers at the exact block", async () => {
    const factory = address("6");
    const vault = address("7");
    const feeHook = address("8");
    const alice = address("1");
    const blockHash = bytes32("9");
    const salt = bytes32("a");
    const poolId = bytes32("3");
    const configurationHash = bytes32("4");
    const initCodeHash = bytes32("5");
    const ctoAuthority = address("a");
    mocks.readContract.mockImplementation(async ({ functionName }) => {
      if (functionName === "configurationHashOf") return configurationHash;
      if (functionName === "ctoAuthority") return ctoAuthority;
      if (functionName === "initCodeHash") return initCodeHash;
      if (functionName === "predict") return vault;
      throw new Error("unexpected function");
    });
    const providers = createProductionDualRpcProviders(
      PRODUCTION_RPC_ENVIRONMENT,
    );

    await expect(
      providers[0].client.readClassicRewardFactorySnapshot!({
        factory,
        vault,
        blockNumber: 100n,
        blockHash,
        salt,
        feeHook,
        poolId,
        beneficiaries: [alice],
        sharesBps: [10_000],
      }),
    ).resolves.toEqual({
      factory,
      vault,
      blockNumber: "100",
      blockHash,
      configurationHash,
      ctoAuthority,
      initCodeHash,
      predictedVault: vault,
      rpcCallCount: 4,
    });
    expect(mocks.readContract).toHaveBeenCalledTimes(4);
    for (const [request] of mocks.readContract.mock.calls) {
      expect(request).toMatchObject({
        address: factory,
        blockHash,
        requireCanonical: true,
      });
      expect(request).not.toHaveProperty("blockNumber");
    }
  });
});
