import { describe, expect, it } from "vitest";
import {
  LimitExceededRpcError,
  TimeoutError,
  toEventSelector,
  type Address,
  type Hex,
} from "viem";

import {
  PredictionPortfolioReadError,
  createPredictionPortfolioRequest,
  derivePredictionPortfolioPosition,
  isPredictionPortfolioRequestCurrent,
  predictionMarketPortfolioInternal,
  type PredictionPortfolioHistoryEntry,
} from "../lib/prediction-market-portfolio";
import type { PredictionMarketView } from "../lib/prediction-market-trading";

const accountA = "0x1111111111111111111111111111111111111111";
const accountB = "0x2222222222222222222222222222222222222222";
const semanticKey = `0x${"aa".repeat(32)}` as Hex;

function market(
  overrides: Partial<PredictionMarketView> = {},
): PredictionMarketView {
  return {
    accountedLiabilityAtoms: 1_000_000n,
    blockNumber: 100n,
    blockTimestamp: 100n,
    canonicalPoolId: `0x${"bb".repeat(32)}`,
    checkpoint: "0x3333333333333333333333333333333333333333",
    checkpointStatus: "AWAITING",
    cutoff: 101n,
    fallbackChallengeDeadline: 0n,
    fallbackRequestedAt: 0n,
    hardResolutionDeadline: 200n,
    liquidity: 1n,
    noBalanceAtoms: 2n,
    noToken: "0x4444444444444444444444444444444444444444",
    noTokenName: "NO",
    observationTime: 150n,
    poolId: `0x${"bb".repeat(32)}`,
    poolKey: {
      currency0: "0x4444444444444444444444444444444444444444",
      currency1: "0x5555555555555555555555555555555555555555",
      fee: 200,
      hooks: "0x6666666666666666666666666666666666666666",
      tickSpacing: 10,
    },
    probabilityYesBps: 5_000,
    protocolFee: 0,
    resolvedPriceAtoms: 0n,
    resolutionDeadline: 175n,
    router: "0x7777777777777777777777777777777777777777",
    semanticKey,
    sqrtPriceX96: 1n << 96n,
    state: "OPEN",
    thresholdAtoms: 100_000n,
    tick: 0,
    title: "Will BTC finish above the threshold?",
    vault: "0x8888888888888888888888888888888888888888",
    yesBalanceAtoms: 3n,
    yesToken: "0x5555555555555555555555555555555555555555",
    yesTokenName: "YES",
    ...overrides,
  };
}

function log({
  address = "0x9999999999999999999999999999999999999999",
  index,
  transactionHash,
}: {
  address?: Address;
  index: number;
  transactionHash: Hex;
}) {
  return {
    address,
    blockHash: `0x${"cc".repeat(32)}` as Hex,
    blockNumber: 10n,
    data: "0x" as Hex,
    logIndex: index,
    removed: false,
    topics: [`0x${"dd".repeat(32)}` as Hex],
    transactionHash,
    transactionIndex: 1,
  };
}

describe("prediction portfolio request identity", () => {
  it("binds every result and error to both account and request key", () => {
    const current = createPredictionPortfolioRequest(accountA, "request-7");
    const staleKey = createPredictionPortfolioRequest(accountA, "request-6");
    const staleAccount = createPredictionPortfolioRequest(accountB, "request-7");

    expect(isPredictionPortfolioRequestCurrent(current, current)).toBe(true);
    expect(isPredictionPortfolioRequestCurrent({ request: current }, current)).toBe(true);
    expect(isPredictionPortfolioRequestCurrent(staleKey, current)).toBe(false);
    expect(isPredictionPortfolioRequestCurrent(staleAccount, current)).toBe(false);
    expect(isPredictionPortfolioRequestCurrent(current, null)).toBe(false);

    const error = new PredictionPortfolioReadError(
      current,
      new Error("RPC failed at https://secret.example/key"),
    );
    expect(isPredictionPortfolioRequestCurrent(error, current)).toBe(true);
    expect(error.message).not.toContain("https://");
  });

  it("rejects zero accounts and ambiguous request keys before discovery", () => {
    expect(() =>
      createPredictionPortfolioRequest(
        "0x0000000000000000000000000000000000000000",
        "request-1",
      ),
    ).toThrow("wallet address");
    expect(() => createPredictionPortfolioRequest(accountA, "   ")).toThrow(
      "request key",
    );
  });
});

describe("prediction portfolio lifecycle", () => {
  it("distinguishes open trading from an elapsed cutoff at the confirmed block", () => {
    const open = derivePredictionPortfolioPosition(market());
    const closed = derivePredictionPortfolioPosition(
      market({ blockTimestamp: 101n }),
    );

    expect(open).toMatchObject({
      lifecycle: "open",
      redeemableAtoms: 0n,
      result: "pending",
      tradingClosed: false,
    });
    expect(closed).toMatchObject({
      lifecycle: "trading_closed",
      redeemableAtoms: 0n,
      result: "pending",
      tradingClosed: true,
    });
  });

  it("maps final YES, NO, and INVALID to exact vault redemption atoms", () => {
    const yes = derivePredictionPortfolioPosition(
      market({ state: "FINAL_YES", yesBalanceAtoms: 3n, noBalanceAtoms: 0n }),
    );
    const mixed = derivePredictionPortfolioPosition(
      market({ state: "FINAL_YES", yesBalanceAtoms: 3n, noBalanceAtoms: 8n }),
    );
    const no = derivePredictionPortfolioPosition(
      market({ state: "FINAL_NO", yesBalanceAtoms: 7n, noBalanceAtoms: 0n }),
    );
    const invalid = derivePredictionPortfolioPosition(
      market({ state: "FINAL_INVALID", yesBalanceAtoms: 1n, noBalanceAtoms: 0n }),
    );

    expect(yes).toMatchObject({
      finalOutcome: "YES",
      lifecycle: "final_yes",
      redeemableAtoms: 30n,
      result: "won",
    });
    expect(no).toMatchObject({
      finalOutcome: "NO",
      lifecycle: "final_no",
      redeemableAtoms: 0n,
      result: "lost",
    });
    expect(mixed).toMatchObject({
      redeemableAtoms: 30n,
      result: "mixed",
    });
    expect(invalid).toMatchObject({
      finalOutcome: "INVALID",
      lifecycle: "final_invalid",
      redeemableAtoms: 5n,
      result: "neutral",
    });
    expect(yes).not.toHaveProperty("profitAtoms");
  });

  it("does not synthesize a position without a current outcome balance", () => {
    expect(() =>
      derivePredictionPortfolioPosition(
        market({ yesBalanceAtoms: 0n, noBalanceAtoms: 0n }),
      ),
    ).toThrow("positive outcome balance");
  });
});

describe("prediction portfolio event discovery", () => {
  it("pins the deployed event signatures and their indexed field layouts", () => {
    const internal = predictionMarketPortfolioInternal;
    expect(toEventSelector(internal.marketCreatedEvent)).toBe(
      "0x5363df88d9e0be66ba2205029623eaeabb936c765f3871c155adebe782f85e57",
    );
    expect(toEventSelector(internal.marketComponentsEvent)).toBe(
      "0xcd019721cdabfc0b300656539a8065e71f92053c0c964ae940fd1170e2168cba",
    );
    expect(toEventSelector(internal.outcomeBoughtEvent)).toBe(
      "0xb67b7cf42e7ed224ac72001e5c6217d4046938c4b25701bad82e117521539bb4",
    );
    expect(toEventSelector(internal.outcomeSoldEvent)).toBe(
      "0x8cb3335c1e07da3d831aa68d0b87e959be6015b97318f803bded31f993753890",
    );
    expect(toEventSelector(internal.outcomeTransferEvent)).toBe(
      "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
    );
    expect(toEventSelector(internal.predictionSplitEvent)).toBe(
      "0x06225bdd82eadd60c8cb630dbf5258a8124705f704edcd0a6e8dd3177bc6dedd",
    );
    expect(toEventSelector(internal.predictionMergedEvent)).toBe(
      "0xb8c37da3b01e50f1f61e39dd11b34d8aed5d3049d8746eee080f1c89ef88e92e",
    );
    expect(toEventSelector(internal.predictionRedeemedEvent)).toBe(
      "0x764aeeb2d1ec3f2945d6486e2f7e3fae9ac5fe11aa56b7a9d90c92212e33050c",
    );
    expect(internal.outcomeBoughtEvent.inputs.slice(0, 3).every((input) => input.indexed)).toBe(true);
    expect(internal.predictionSplitEvent.inputs.slice(0, 2).every((input) => input.indexed)).toBe(true);
    expect(internal.predictionMergedEvent.inputs.slice(0, 2).every((input) => input.indexed)).toBe(true);
    expect(internal.predictionRedeemedEvent.inputs.slice(0, 2).every((input) => input.indexed)).toBe(true);
  });

  it("chunks inclusive log ranges without gaps or overlaps", () => {
    expect(
      predictionMarketPortfolioInternal.predictionPortfolioBlockRanges(
        100n,
        110n,
        4n,
      ),
    ).toEqual([
      { fromBlock: 100n, toBlock: 103n },
      { fromBlock: 104n, toBlock: 107n },
      { fromBlock: 108n, toBlock: 110n },
    ]);
  });

  it("accepts provider logs in different order but fails closed on disagreement", async () => {
    const internal = predictionMarketPortfolioInternal;
    type ReadArguments = Parameters<typeof internal.readPredictionPortfolioLogs>[0];
    const official = {} as ReadArguments["clients"][number];
    const independent = {} as ReadArguments["clients"][number];
    const clients = [official, independent] as ReadArguments["clients"];
    const first = log({ index: 1, transactionHash: `0x${"01".repeat(32)}` });
    const second = log({ index: 2, transactionHash: `0x${"02".repeat(32)}` });

    const accepted = await internal.readPredictionPortfolioLogs({
      clients,
      fromBlock: 1n,
      read: async (client) =>
        client === official ? [second, first] : [first, second],
      toBlock: 1n,
    });
    expect(accepted.map((entry) => entry.logIndex)).toEqual([1, 2]);

    await expect(
      internal.readPredictionPortfolioLogs({
        clients,
        fromBlock: 1n,
        read: async (client) =>
          client === official ? [first] : [second],
        toBlock: 1n,
      }),
    ).rejects.toThrow("disagree");
  });

  it("reads the whole history first and halves only when a provider rejects it", async () => {
    const internal = predictionMarketPortfolioInternal;
    type ReadArguments = Parameters<typeof internal.readPredictionPortfolioLogs>[0];
    const official = {} as ReadArguments["clients"][number];
    const independent = {} as ReadArguments["clients"][number];
    const clients = [official, independent] as ReadArguments["clients"];
    const attemptedRanges: Array<{ fromBlock: bigint; toBlock: bigint }> = [];

    await expect(internal.readPredictionPortfolioLogs({
      clients,
      fromBlock: 1n,
      read: async (client, range) => {
        if (client === official) attemptedRanges.push(range);
        if (range.toBlock - range.fromBlock + 1n > 50_000n) {
          throw new LimitExceededRpcError(new Error("too many results"));
        }
        return [];
      },
      toBlock: 1_250_001n,
    })).resolves.toEqual([]);

    expect(attemptedRanges[0]).toEqual({ fromBlock: 1n, toBlock: 1_250_001n });
    expect(attemptedRanges.some((range) =>
      range.toBlock - range.fromBlock + 1n <= 50_000n,
    )).toBe(true);
  });

  it("fails fast on transport timeouts instead of multiplying history reads", async () => {
    const internal = predictionMarketPortfolioInternal;
    type ReadArguments = Parameters<typeof internal.readPredictionPortfolioLogs>[0];
    const clients = [{}, {}] as unknown as ReadArguments["clients"];
    let attempts = 0;

    await expect(internal.readPredictionPortfolioLogs({
      clients,
      fromBlock: 1n,
      read: async () => {
        attempts += 1;
        throw new TimeoutError({ body: {}, url: "https://rpc.invalid" });
      },
      toBlock: 1_250_001n,
    })).rejects.toBeInstanceOf(TimeoutError);
    expect(attempts).toBe(2);
  });

  it("fails closed if the snapshot block changes during a portfolio read", async () => {
    const internal = predictionMarketPortfolioInternal;
    type AnchorClients = Parameters<
      typeof internal.assertPredictionPortfolioSnapshotAnchor
    >[0];
    type AnchorSnapshot = Parameters<
      typeof internal.assertPredictionPortfolioSnapshotAnchor
    >[1];
    const canonical = {
      hash: `0x${"11".repeat(32)}` as Hex,
      number: 100n,
      parentHash: `0x${"22".repeat(32)}` as Hex,
      timestamp: 90n,
    };
    const client = (hash: Hex) => ({
      getBlock: async () => ({ ...canonical, hash }),
    });
    const snapshot = {
      blockHash: canonical.hash,
      blockNumber: canonical.number,
      blockTimestamp: canonical.timestamp,
      marketCount: 1n,
      router: "0x7777777777777777777777777777777777777777",
    } satisfies AnchorSnapshot;

    await expect(internal.assertPredictionPortfolioSnapshotAnchor(
      [client(canonical.hash), client(canonical.hash)] as unknown as AnchorClients,
      snapshot,
    )).resolves.toBeUndefined();
    await expect(internal.assertPredictionPortfolioSnapshotAnchor(
      [
        client(`0x${"33".repeat(32)}`),
        client(`0x${"33".repeat(32)}`),
      ] as unknown as AnchorClients,
      snapshot,
    )).rejects.toThrow("changed during");
  });

  it("validates settlement amounts and derives the wallet participant role", () => {
    const internal = predictionMarketPortfolioInternal;

    expect(internal.predictionPortfolioBuyAmountsAreValid({
      collateralInAtoms: 100n,
      collateralRefundAtoms: 20n,
      outcomeAtoms: 8n,
    })).toBe(true);
    expect(internal.predictionPortfolioBuyAmountsAreValid({
      collateralInAtoms: 100n,
      collateralRefundAtoms: 101n,
      outcomeAtoms: 8n,
    })).toBe(false);
    expect(internal.predictionPortfolioSellAmountsAreValid({
      outcomeInAtoms: 100n,
      soldRefundAtoms: 20n,
    })).toBe(true);
    expect(internal.predictionPortfolioSellAmountsAreValid({
      outcomeInAtoms: 100n,
      soldRefundAtoms: 101n,
    })).toBe(false);
    expect(internal.predictionPortfolioPairAmountsAreValid(7n, 70n)).toBe(true);
    expect(internal.predictionPortfolioPairAmountsAreValid(7n, 69n)).toBe(false);
    expect(internal.predictionPortfolioRedemptionAmountsAreValid({
      collateralAtoms: 70n,
      noAtoms: 0n,
      state: "FINAL_YES",
      yesAtoms: 7n,
    })).toBe(true);
    expect(internal.predictionPortfolioRedemptionAmountsAreValid({
      collateralAtoms: 69n,
      noAtoms: 0n,
      state: "FINAL_YES",
      yesAtoms: 7n,
    })).toBe(false);

    expect(internal.predictionPortfolioAccountRole(
      accountA,
      accountA,
      accountA,
      "payer",
    )).toBe("self");
    expect(internal.predictionPortfolioAccountRole(
      accountA,
      accountA,
      accountB,
      "payer",
    )).toBe("payer");
    expect(internal.predictionPortfolioAccountRole(
      accountA,
      accountB,
      accountA,
      "holder",
    )).toBe("recipient");
    expect(internal.predictionPortfolioAccountRole(
      accountA,
      accountB,
      "0x3333333333333333333333333333333333333333",
      "holder",
    )).toBeNull();
  });

  it("fails closed when reviewed router or vault activity names an unknown vault", () => {
    const internal = predictionMarketPortfolioInternal;
    type Component = Parameters<typeof internal.indexPredictionMarketComponents>[0][number];
    const component = {
      checkpoint: "0x3333333333333333333333333333333333333333",
      cutoff: 100n,
      noToken: "0x4444444444444444444444444444444444444444",
      observationTime: 200n,
      poolId: `0x${"11".repeat(32)}`,
      semanticKey: `0x${"22".repeat(32)}`,
      thresholdAtoms: 100_000n,
      vault: "0x5555555555555555555555555555555555555555",
      yesToken: "0x6666666666666666666666666666666666666666",
    } as const satisfies Component;
    const index = internal.indexPredictionMarketComponents([component]);

    expect(internal.requirePredictionPortfolioComponent(
      index,
      component.vault,
      "unknown router market",
    )).toEqual(component);
    expect(() => internal.requirePredictionPortfolioComponent(
      index,
      "0x7777777777777777777777777777777777777777",
      "unknown router market",
    )).toThrow("unknown router market");
    expect(() => internal.requirePredictionPortfolioComponent(
      index,
      "0x8888888888888888888888888888888888888888",
      "unknown vault market",
    )).toThrow("unknown vault market");
  });

  it("suppresses only exact sell/refund transfer legs and keeps batched transfers", () => {
    const internal = predictionMarketPortfolioInternal;
    const transactionHash = `0x${"66".repeat(32)}` as Hex;
    const selectedMarket = market();
    const base = (logIndex: number) => ({
      blockNumber: 10n,
      logIndex,
      market: selectedMarket,
      semanticKey,
      transactionHash,
      transactionIndex: 1,
      vault: selectedMarket.vault,
    });
    const transfer = ({
      direction,
      logIndex,
      outcome,
      outcomeAtoms,
    }: {
      direction: "in" | "out";
      logIndex: number;
      outcome: "YES" | "NO";
      outcomeAtoms: bigint;
    }): Extract<PredictionPortfolioHistoryEntry, { kind: "transfer" }> => ({
      ...base(logIndex),
      direction,
      from: direction === "out" ? accountA : accountB,
      kind: "transfer",
      outcome,
      outcomeAtoms,
      to: direction === "out" ? accountB : accountA,
    });
    const history = [
      transfer({ direction: "out", logIndex: 1, outcome: "YES", outcomeAtoms: 100n }),
      transfer({ direction: "in", logIndex: 2, outcome: "YES", outcomeAtoms: 20n }),
      transfer({ direction: "in", logIndex: 3, outcome: "NO", outcomeAtoms: 30n }),
      transfer({ direction: "in", logIndex: 4, outcome: "YES", outcomeAtoms: 7n }),
      {
        ...base(5),
        collateralAtoms: 500n,
        complementRefundAtoms: 30n,
        kind: "sold",
        outcome: "YES",
        outcomeAtoms: 100n,
        soldRefundAtoms: 20n,
      },
      transfer({ direction: "in", logIndex: 6, outcome: "YES", outcomeAtoms: 20n }),
    ] satisfies PredictionPortfolioHistoryEntry[];

    const visible = internal.suppressPredictionPortfolioTransferLegs(history);

    expect(visible.map((entry) => entry.logIndex)).toEqual([6, 5, 4]);
    expect(visible.find((entry) => entry.kind === "sold")).toMatchObject({
      complementRefundAtoms: 30n,
      outcome: "YES",
      outcomeAtoms: 100n,
      soldRefundAtoms: 20n,
    });
    expect(visible.filter((entry) => entry.kind === "transfer")).toMatchObject([
      { logIndex: 6, outcomeAtoms: 20n },
      { logIndex: 4, outcomeAtoms: 7n },
    ]);
  });

  it("suppresses exact buy, split, merge, and redeem token legs only", () => {
    const internal = predictionMarketPortfolioInternal;
    const selectedMarket = market();
    const base = (transactionHash: Hex, logIndex: number) => ({
      blockNumber: 10n,
      logIndex,
      market: selectedMarket,
      semanticKey,
      transactionHash,
      transactionIndex: 1,
      vault: selectedMarket.vault,
    });
    const transfer = (
      transactionHash: Hex,
      logIndex: number,
      direction: "in" | "out",
      outcome: "YES" | "NO",
      outcomeAtoms: bigint,
    ): Extract<PredictionPortfolioHistoryEntry, { kind: "transfer" }> => ({
      ...base(transactionHash, logIndex),
      direction,
      from: direction === "out" ? accountA : accountB,
      kind: "transfer",
      outcome,
      outcomeAtoms,
      to: direction === "out" ? accountB : accountA,
    });
    const buyHash = `0x${"71".repeat(32)}` as Hex;
    const splitHash = `0x${"72".repeat(32)}` as Hex;
    const mergeHash = `0x${"73".repeat(32)}` as Hex;
    const redeemHash = `0x${"74".repeat(32)}` as Hex;
    const scenarios = [
      {
        eventKind: "bought",
        history: [
          transfer(buyHash, 1, "in", "YES", 100n),
          transfer(buyHash, 2, "in", "NO", 7n),
          {
            ...base(buyHash, 3),
            collateralInAtoms: 1_000n,
            collateralRefundAtoms: 0n,
            kind: "bought",
            outcome: "YES",
            outcomeAtoms: 100n,
          },
        ],
      },
      {
        eventKind: "split",
        history: [
          transfer(splitHash, 1, "in", "YES", 50n),
          transfer(splitHash, 2, "in", "NO", 50n),
          transfer(splitHash, 3, "in", "YES", 7n),
          {
            ...base(splitHash, 4),
            accountRole: "self",
            collateralAtoms: 500n,
            kind: "split",
            outcomeAtoms: 50n,
            payer: accountA,
            recipient: accountA,
          },
        ],
      },
      {
        eventKind: "merged",
        history: [
          transfer(mergeHash, 1, "out", "YES", 40n),
          transfer(mergeHash, 2, "out", "NO", 40n),
          transfer(mergeHash, 3, "in", "YES", 7n),
          {
            ...base(mergeHash, 4),
            accountRole: "self",
            collateralAtoms: 400n,
            holder: accountA,
            kind: "merged",
            outcomeAtoms: 40n,
            recipient: accountA,
          },
        ],
      },
      {
        eventKind: "redeemed",
        history: [
          transfer(redeemHash, 1, "out", "YES", 25n),
          transfer(redeemHash, 2, "out", "NO", 10n),
          transfer(redeemHash, 3, "in", "YES", 7n),
          {
            ...base(redeemHash, 4),
            accountRole: "self",
            collateralAtoms: 250n,
            holder: accountA,
            kind: "redeemed",
            noAtoms: 10n,
            recipient: accountA,
            yesAtoms: 25n,
          },
        ],
      },
    ] as const satisfies readonly Readonly<{
      eventKind: PredictionPortfolioHistoryEntry["kind"];
      history: readonly PredictionPortfolioHistoryEntry[];
    }>[];

    for (const scenario of scenarios) {
      const visible = internal.suppressPredictionPortfolioTransferLegs(
        scenario.history,
      );
      expect(visible.map((entry) => entry.logIndex)).toEqual(
        scenario.eventKind === "bought" ? [3, 2] : [4, 3],
      );
      expect(visible.some((entry) => entry.kind === scenario.eventKind)).toBe(true);
      expect(visible.find((entry) => entry.kind === "transfer")).toMatchObject({
        outcomeAtoms: 7n,
      });
    }
  });

  it("deduplicates the same self-transfer observed in both account topic queries", () => {
    const shared = log({ index: 7, transactionHash: `0x${"03".repeat(32)}` });
    const other = log({ index: 8, transactionHash: `0x${"03".repeat(32)}` });
    expect(
      predictionMarketPortfolioInternal.dedupePortfolioLogs([
        shared,
        shared,
        other,
      ]).map((entry) => entry.logIndex),
    ).toEqual([7, 8]);
  });

  it("keeps direct outcome-token transfers and drops unrelated ERC-20 emitters", () => {
    const outcomeToken = "0x9999999999999999999999999999999999999999";
    const relevant = log({ index: 1, transactionHash: `0x${"04".repeat(32)}` });
    const unrelated = log({
      address: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      index: 2,
      transactionHash: `0x${"05".repeat(32)}`,
    });

    expect(
      predictionMarketPortfolioInternal.filterPredictionOutcomeLogs(
        [unrelated, relevant],
        new Set([outcomeToken.toLowerCase()]),
      ),
    ).toEqual([relevant]);
  });

  it("drops zero-value transfer spam and unrelated token emitters", () => {
    const internal = predictionMarketPortfolioInternal;
    const outcomeToken = "0x9999999999999999999999999999999999999999";
    const positive = {
      ...log({ index: 1, transactionHash: `0x${"04".repeat(32)}` }),
      args: { value: 1n },
    };
    const zero = {
      ...log({ index: 2, transactionHash: `0x${"05".repeat(32)}` }),
      args: { value: 0n },
    };
    const unrelated = {
      ...log({
        address: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        index: 3,
        transactionHash: `0x${"06".repeat(32)}`,
      }),
      args: { value: 10n },
    };

    expect(internal.filterNonzeroPredictionOutcomeTransfers(
      [zero, unrelated, positive],
      new Set([outcomeToken.toLowerCase()]),
    )).toEqual([positive]);
  });

  it("keeps only funded recipient redemption activity", () => {
    const internal = predictionMarketPortfolioInternal;
    const zero = {
      ...log({ index: 1, transactionHash: `0x${"07".repeat(32)}` }),
      args: { collateralAtoms: 0n },
    };
    const funded = {
      ...log({ index: 2, transactionHash: `0x${"08".repeat(32)}` }),
      args: { collateralAtoms: 10n },
    };

    expect(internal.filterFundedPredictionRedemptionRecipients([
      zero,
      funded,
    ])).toEqual([funded]);
  });

  it("isolates one malformed market component without dropping valid markets", () => {
    const internal = predictionMarketPortfolioInternal;
    type Component = Parameters<typeof internal.indexPredictionMarketComponents>[0][number];
    const valid = {
      checkpoint: "0x3333333333333333333333333333333333333333",
      cutoff: 100n,
      noToken: "0x4444444444444444444444444444444444444444",
      observationTime: 200n,
      poolId: `0x${"11".repeat(32)}`,
      semanticKey: `0x${"22".repeat(32)}`,
      thresholdAtoms: 100_000n,
      vault: "0x5555555555555555555555555555555555555555",
      yesToken: "0x6666666666666666666666666666666666666666",
    } as const satisfies Component;
    const malformed = {
      ...valid,
      noToken: "0x8888888888888888888888888888888888888888",
      poolId: `0x${"33".repeat(32)}`,
      semanticKey: `0x${"44".repeat(32)}`,
      vault: "0x0000000000000000000000000000000000000000",
      yesToken: "0x9999999999999999999999999999999999999999",
    } as const satisfies Component;

    const index = internal.indexPredictionMarketComponents([valid, malformed]);
    expect([...index.bySemanticKey.keys()]).toEqual([
      valid.semanticKey.toLowerCase(),
    ]);
    expect(index.failures).toEqual([
      expect.objectContaining({ semanticKey: malformed.semanticKey }),
    ]);
  });
});
