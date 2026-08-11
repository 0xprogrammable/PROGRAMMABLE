import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { hydrateMissingCanonicalTokenSupplyV1 } from
  "../lib/market-data/canonical-token-supply.server";
import type { ReadyOnchainDeployment } from "../lib/onchain/types";
import type { ExploreEntry } from "../lib/tokens";

const PCAN_ADDRESS = "0x9deeb39d2590b0cad5fc473f755c5f97dcc8f7ce" as const;
const BLOCK_HASH = `0x${"11".repeat(32)}` as const;
const SUPPLY = 1_000_000n * 10n ** 18n;

const deployment = {
  environment: "production",
  releaseVersion: "classic-v2",
  chainId: 1,
  status: "ready",
  launcher: "0x1111111111111111111111111111111111111111",
  feeHook: "0x2222222222222222222222222222222222222222",
  launcherRuntimeCodeHash: `0x${"11".repeat(32)}`,
  feeHookRuntimeCodeHash: `0x${"22".repeat(32)}`,
  deploymentBlock: 1n,
  stateView: "0x3333333333333333333333333333333333333333",
  stateViewRuntimeCodeHash: `0x${"33".repeat(32)}`,
  rpcUrl: "https://primary.example/rpc",
  rpcUrlSecondary: "https://secondary.example/rpc",
  confirmations: 12n,
  logBlockRange: 5_000n,
} satisfies ReadyOnchainDeployment;

const entry = {
  exploreKind: "token",
  tokenAddress: PCAN_ADDRESS,
} as unknown as ExploreEntry;

function supplyClient(input: Readonly<{
  blockHash?: `0x${string}`;
  decimals?: number;
  totalSupply?: bigint;
}> = {}) {
  return {
    getBlockNumber: vi.fn(async () => 112n),
    getBlock: vi.fn(async () => ({
      hash: input.blockHash ?? BLOCK_HASH,
      number: 100n,
    })),
    readContract: vi.fn(async ({ functionName }: { functionName: string }) =>
      functionName === "decimals"
        ? input.decimals ?? 18
        : input.totalSupply ?? SUPPLY),
  };
}

describe("canonical token supply hydration", () => {
  it("hydrates missing supply only when both fixed readers agree", async () => {
    const primary = supplyClient();
    const secondary = supplyClient();
    const createClient = vi.fn((rpcUrl: string) =>
      rpcUrl === deployment.rpcUrl ? primary : secondary);

    const [hydrated] = await hydrateMissingCanonicalTokenSupplyV1([entry], {
      deployment,
      createClient,
    });

    expect(hydrated).toMatchObject({
      tokenAddress: PCAN_ADDRESS,
      tokenDecimals: 18,
      totalSupplyRaw: SUPPLY.toString(),
    });
    expect(createClient).toHaveBeenCalledTimes(2);
    expect(primary.readContract).toHaveBeenCalledTimes(2);
    expect(secondary.readContract).toHaveBeenCalledTimes(2);
  });

  it("leaves identity unchanged when the two readers disagree", async () => {
    const primary = supplyClient();
    const secondary = supplyClient({ totalSupply: SUPPLY - 1n });

    await expect(hydrateMissingCanonicalTokenSupplyV1([entry], {
      deployment,
      createClient: (rpcUrl) =>
        rpcUrl === deployment.rpcUrl ? primary : secondary,
    })).resolves.toEqual([entry]);
  });

  it("accepts two matching fixed readers when one candidate is unavailable", async () => {
    const unavailable = supplyClient();
    unavailable.getBlock.mockRejectedValue(new Error("unavailable"));
    const first = supplyClient();
    const second = supplyClient();
    const [hydrated] = await hydrateMissingCanonicalTokenSupplyV1([entry], {
      deployment,
      additionalRpcUrls: ["https://third.example/rpc"],
      createClient: (rpcUrl) => rpcUrl === deployment.rpcUrl
        ? unavailable
        : rpcUrl === deployment.rpcUrlSecondary
          ? first
          : second,
    });

    expect(hydrated).toMatchObject({
      tokenDecimals: 18,
      totalSupplyRaw: SUPPLY.toString(),
    });
  });

  it("does not read supply without two available fixed readers", async () => {
    const unavailable = supplyClient();
    unavailable.getBlockNumber.mockRejectedValue(new Error("unavailable"));
    const createClient = vi.fn((rpcUrl: string) =>
      rpcUrl === deployment.rpcUrl ? supplyClient() : unavailable);

    await expect(hydrateMissingCanonicalTokenSupplyV1([entry], {
      deployment,
      createClient,
    })).resolves.toEqual([entry]);
    expect(createClient).toHaveBeenCalledTimes(2);
  });

  it("does not re-read an already canonical supply", async () => {
    const canonicalEntry = {
      ...entry,
      tokenDecimals: 18,
      totalSupplyRaw: SUPPLY.toString(),
    } as ExploreEntry;
    const createClient = vi.fn();

    await expect(hydrateMissingCanonicalTokenSupplyV1([canonicalEntry], {
      deployment,
      createClient,
    })).resolves.toEqual([canonicalEntry]);
    expect(createClient).not.toHaveBeenCalled();
  });
});
