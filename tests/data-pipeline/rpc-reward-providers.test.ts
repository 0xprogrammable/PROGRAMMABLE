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

const ALCHEMY = "https://eth-mainnet.g.alchemy.com/v2/alchemy-test-key";
const QUICKNODE =
  "https://programmable.ethereum.quiknode.pro/quicknode-test-token/";
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
        return args[0] === 0n ? 4_000n : 6_000n;
      }
      if (functionName === "claimable") {
        return args[0] === alice ? 0n : 9n;
      }
      if (functionName === "claimedBy") {
        return args[0] === alice ? 4n : 0n;
      }
      throw new Error("unexpected function");
    });
    const providers = createProductionDualRpcProviders({
      PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL: ALCHEMY,
      PROGRAMMABLE_QUICKNODE_MAINNET_RPC_URL: QUICKNODE,
    });

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
});
