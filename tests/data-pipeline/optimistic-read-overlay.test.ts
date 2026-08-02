import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  mergeOptimisticTokenCorpus,
  optimisticOverlayHeaders,
  selectEligibleOptimisticOverlay,
  withOptimisticOverlayDisclosure,
  type OptimisticLaunchRow,
  type OptimisticMarketRow,
  type OptimisticOverlayBlockEvidence,
} from "../../lib/data-pipeline/optimistic-read-overlay.server";
import type { LauncherToken } from "../../lib/tokens";

const POOL_A = `0x${"11".repeat(32)}` as const;
const POOL_B = `0x${"22".repeat(32)}` as const;
const BLOCK_A = `0x${"33".repeat(32)}` as const;
const BLOCK_B = `0x${"44".repeat(32)}` as const;
const TRANSACTION_A = `0x${"55".repeat(32)}` as const;
const TRANSACTION_B = `0x${"66".repeat(32)}` as const;
const TOKEN_A = "0x1111111111111111111111111111111111111111" as const;
const TOKEN_B = "0x2222222222222222222222222222222222222222" as const;
const HOOK = "0x3333333333333333333333333333333333333333" as const;

function evidence(
  blockNumber = "100",
  blockHash = BLOCK_A,
): OptimisticOverlayBlockEvidence {
  return {
    eligibility: "eligible",
    source: "dual-rpc-head",
    finality: "safe",
    chainId: 1,
    blockNumber,
    blockHash,
    primaryBlockNumber: blockNumber,
    primaryBlockHash: blockHash,
    secondaryBlockNumber: blockNumber,
    secondaryBlockHash: blockHash,
    confirmations: 12,
    finalityDepth: 12,
    observedAt: "2026-08-02T08:00:00.000Z",
  };
}

function optimisticEvidence(
  blockNumber = "100",
  blockHash = BLOCK_A,
  confirmations = 0,
): OptimisticOverlayBlockEvidence {
  return {
    ...evidence(blockNumber, blockHash),
    eligibility: "optimistic",
    finality: "optimistic",
    confirmations,
    observedAt: "2026-08-02T07:59:30.000Z",
  };
}

function token(input: {
  poolId?: typeof POOL_A | typeof POOL_B;
  tokenAddress?: typeof TOKEN_A | typeof TOKEN_B;
  transactionHash?: typeof TRANSACTION_A | typeof TRANSACTION_B;
  logIndex?: number;
  blockNumber?: string;
  symbol?: string;
} = {}): LauncherToken {
  return {
    id: input.tokenAddress ?? TOKEN_A,
    name: `Token ${input.symbol ?? "A"}`,
    symbol: input.symbol ?? "A",
    tokenAddress: input.tokenAddress ?? TOKEN_A,
    hookAddress: HOOK,
    poolId: input.poolId ?? POOL_A,
    launchBlockNumber: input.blockNumber ?? "100",
    launchTransactionHash: input.transactionHash ?? TRANSACTION_A,
    launchTransactionIndex: 0,
    launchLogIndex: input.logIndex ?? 7,
    launchedAt: "2026-08-02T07:59:00.000Z",
    totalSwapFeeBps: 100,
    liquidityPath: "meme",
  };
}

function launch(input: Partial<OptimisticLaunchRow> = {}): OptimisticLaunchRow {
  const selectedToken = input.token ?? token();
  return {
    kind: "launch",
    evidence: input.evidence ?? evidence(selectedToken.launchBlockNumber),
    event: input.event ?? {
      transactionHash: selectedToken.launchTransactionHash!,
      logIndex: selectedToken.launchLogIndex!,
    },
    poolId: input.poolId ?? selectedToken.poolId,
    tokenAddress: input.tokenAddress ?? selectedToken.tokenAddress,
    token: selectedToken,
  };
}

function market(input: Partial<OptimisticMarketRow> = {}): OptimisticMarketRow {
  return {
    kind: "market",
    evidence: input.evidence ?? evidence("101"),
    event: input.event ?? { transactionHash: TRANSACTION_B, logIndex: 8 },
    poolId: input.poolId ?? POOL_A,
    tokenAddress: input.tokenAddress ?? TOKEN_A,
    market: input.market ?? {
      tokenPriceEth: "0.0001",
      tokenPriceEthWei: "100000000000000",
      marketCapEth: "100",
      marketCapEthWei: "100000000000000000000",
      indexedValuationBlockNumber: "101",
      grossVolumeEth: "3.5",
      grossVolumeWei: "3500000000000000000",
      swapCount: 4,
      currentTick: 12,
    },
  };
}

describe("optimistic read overlay", () => {
  it("selects only explicitly eligible safe dual-RPC rows", () => {
    const underConfirmed = launch({
      evidence: { ...evidence(), confirmations: 11 },
    });
    const disagreement = market({
      evidence: { ...evidence("101"), secondaryBlockHash: BLOCK_B },
    });
    const headDisagreement = market({
      evidence: { ...evidence("101"), secondaryBlockNumber: "102" },
    });
    const unapproved = launch({
      evidence: { ...evidence(), eligibility: "pending" },
    });
    const wrongChain = launch({
      evidence: { ...evidence(), chainId: 11_155_111 },
    });

    const selected = selectEligibleOptimisticOverlay({
      chainId: 1,
      rows: [
        launch(),
        market(),
        underConfirmed,
        disagreement,
        headDisagreement,
        unapproved,
        wrongChain,
      ],
    });

    expect(selected.launches).toHaveLength(1);
    expect(selected.markets).toHaveLength(1);
    expect(selected.rejected.map((row) => row.reason)).toEqual([
      "insufficient-finality",
      "rpc-disagreement",
      "rpc-disagreement",
      "not-explicitly-eligible",
      "invalid-block-evidence",
    ]);
  });

  it("rejects competing hashes at the same chain height across pools", () => {
    const otherPoolToken = token({
      poolId: POOL_B,
      tokenAddress: TOKEN_B,
      transactionHash: TRANSACTION_B,
      logIndex: 4,
      symbol: "B",
    });
    const selected = selectEligibleOptimisticOverlay({
      chainId: 1,
      rows: [
        launch(),
        launch({
          evidence: evidence("100", BLOCK_B),
          token: otherPoolToken,
        }),
      ],
    });

    expect(selected.launches).toHaveLength(0);
    expect(selected.rejected.map((row) => row.reason)).toEqual([
      "ambiguous-block",
      "ambiguous-block",
    ]);
  });

  it("fails closed when one pool or event maps to conflicting launch identities", () => {
    const samePoolDifferentEvent = launch({
      token: token({ transactionHash: TRANSACTION_B, logIndex: 9 }),
    });
    const sameEventDifferentPool = launch({
      poolId: POOL_B,
      tokenAddress: TOKEN_B,
      token: token({ poolId: POOL_B, tokenAddress: TOKEN_B }),
    });

    const selected = selectEligibleOptimisticOverlay({
      chainId: 1,
      rows: [launch(), samePoolDifferentEvent, sameEventDifferentPool],
    });

    expect(selected.launches).toHaveLength(0);
    expect(selected.rejected).toHaveLength(3);
    expect(
      selected.rejected.every((row) =>
        ["ambiguous-event", "ambiguous-pool", "ambiguous-token"].includes(
          row.reason,
        ),
      ),
    ).toBe(true);
  });

  it("adds a new launch, applies its newest market row and preserves canonical input", () => {
    const canonical = token({
      poolId: POOL_B,
      tokenAddress: TOKEN_B,
      transactionHash: TRANSACTION_B,
      logIndex: 3,
      symbol: "B",
    });
    const olderMarket = market({
      evidence: optimisticEvidence("101", BLOCK_A, 1),
      market: {
        tokenPriceEth: "0.0001",
        indexedValuationBlockNumber: "101",
      },
    });
    const newestMarket = market({
      evidence: optimisticEvidence("102", BLOCK_B, 0),
      event: { transactionHash: TRANSACTION_B, logIndex: 10 },
      market: {
        tokenPriceEth: "0.0002",
        indexedValuationBlockNumber: "102",
        swapCount: 5,
      },
    });
    const selected = selectEligibleOptimisticOverlay({
      chainId: 1,
      rows: [
        launch({ evidence: optimisticEvidence("100", BLOCK_A, 2) }),
        olderMarket,
        newestMarket,
      ],
    });

    const result = mergeOptimisticTokenCorpus({
      canonicalTokens: [canonical],
      overlay: selected,
    });

    expect(result.tokens).toHaveLength(2);
    expect(result.tokens[0]).toEqual(canonical);
    expect(result.tokens[0]).not.toBe(canonical);
    expect(result.tokens[1]).toMatchObject({
      poolId: POOL_A,
      tokenPriceEth: "0.0002",
      indexedValuationBlockNumber: "102",
      swapCount: 5,
    });
    expect(result.disclosure).toMatchObject({
      active: true,
      source: "dual-rpc-head",
      finality: "optimistic",
      safeConfirmationThreshold: 12,
    });
    expect(result.disclosure.applied.map((row) => row.kind)).toEqual([
      "launch",
      "market",
    ]);
  });

  it("patches a canonical pool with newer market data without duplicating it", () => {
    const canonical = { ...token(), indexedValuationBlockNumber: "100" };
    const selected = selectEligibleOptimisticOverlay({
      chainId: 1,
      rows: [market()],
    });
    const result = mergeOptimisticTokenCorpus({
      canonicalTokens: [canonical],
      overlay: selected,
    });

    expect(result.tokens).toHaveLength(1);
    expect(result.tokens[0]).toMatchObject({
      poolId: POOL_A,
      tokenPriceEthWei: "100000000000000",
      grossVolumeWei: "3500000000000000000",
      swapCount: 4,
    });
    expect(result.disclosure.applied).toHaveLength(1);
  });

  it("overlays newer optimistic market fields without mutating canonical identity", () => {
    const canonical = {
      ...token(),
      creatorAddress: TOKEN_B,
      launchModel: "classic" as const,
      indexedValuationBlockNumber: "100",
      tokenPriceEth: "0.5",
      swapCount: 99,
    };
    const identity = {
      id: canonical.id,
      tokenAddress: canonical.tokenAddress,
      hookAddress: canonical.hookAddress,
      poolId: canonical.poolId,
      creatorAddress: canonical.creatorAddress,
      launchTransactionHash: canonical.launchTransactionHash,
      launchLogIndex: canonical.launchLogIndex,
      launchModel: canonical.launchModel,
      totalSwapFeeBps: canonical.totalSwapFeeBps,
    };
    const selected = selectEligibleOptimisticOverlay({
      chainId: 1,
      rows: [
        market({
          evidence: optimisticEvidence("101", BLOCK_A, 1),
          market: {
            tokenPriceEth: "0.0001",
            tokenPriceEthWei: "100000000000000",
            indexedValuationBlockNumber: "101",
            swapCount: 4,
            // A structurally wider DB object must not escape the whitelist.
            tokenAddress: TOKEN_B,
            poolId: POOL_B,
            totalSwapFeeBps: 9_999,
          } as unknown as OptimisticMarketRow["market"],
        }),
      ],
    });
    const result = mergeOptimisticTokenCorpus({
      canonicalTokens: [canonical],
      overlay: selected,
    });

    expect(result.tokens).toHaveLength(1);
    expect(result.tokens[0]).toMatchObject({
      ...identity,
      tokenPriceEth: "0.0001",
      tokenPriceEthWei: "100000000000000",
      indexedValuationBlockNumber: "101",
      swapCount: 4,
    });
    expect(result.tokens[0]).not.toHaveProperty("tokenAddress", TOKEN_B);
    expect(result.tokens[0]?.tokenAddress).toBe(TOKEN_A);
    expect(result.tokens[0]?.poolId).toBe(POOL_A);
    expect(result.tokens[0]?.totalSwapFeeBps).toBe(100);
    expect(result.disclosure.finality).toBe("optimistic");
    expect(result.disclosure.applied).toHaveLength(1);
    expect(result.rejected).toHaveLength(0);
  });

  it("rejects equal or older optimistic market blocks", () => {
    const canonical = {
      ...token(),
      indexedValuationBlockNumber: "101",
      tokenPriceEth: "0.5",
    };
    for (const blockNumber of ["101", "100"]) {
      const selected = selectEligibleOptimisticOverlay({
        chainId: 1,
        rows: [
          market({
            evidence: optimisticEvidence(blockNumber, BLOCK_A, 1),
            market: {
              tokenPriceEth: "0.0001",
              indexedValuationBlockNumber: blockNumber,
            },
          }),
        ],
      });
      const result = mergeOptimisticTokenCorpus({
        canonicalTokens: [canonical],
        overlay: selected,
      });

      expect(result.tokens).toEqual([canonical]);
      expect(result.disclosure.active).toBe(false);
      expect(result.rejected.at(-1)?.reason).toBe("stale-market");
    }
  });

  it("promotes duplicate evidence from optimistic to safe at confirmation 12", () => {
    const optimisticLaunch = launch({
      evidence: optimisticEvidence("100", BLOCK_A, 11),
    });
    const safeLaunch = launch({ evidence: evidence("100", BLOCK_A) });
    const optimisticMarket = market({
      evidence: optimisticEvidence("101", BLOCK_A, 11),
    });
    const safeMarket = market({ evidence: evidence("101", BLOCK_A) });
    const selected = selectEligibleOptimisticOverlay({
      chainId: 1,
      rows: [optimisticLaunch, safeLaunch, optimisticMarket, safeMarket],
    });

    expect(selected.launches).toHaveLength(1);
    expect(selected.launches[0]?.evidence.finality).toBe("safe");
    expect(selected.markets).toHaveLength(1);
    expect(selected.markets[0]?.evidence.finality).toBe("safe");

    const result = mergeOptimisticTokenCorpus({
      canonicalTokens: [],
      overlay: selected,
    });
    expect(result.disclosure.finality).toBe("safe");
    expect(
      result.disclosure.applied.every((row) => row.finality === "safe"),
    ).toBe(true);
  });

  it("rejects same-height market forks and market state before launch", () => {
    const forked = market({
      evidence: optimisticEvidence("101", BLOCK_B, 1),
      event: { transactionHash: TRANSACTION_A, logIndex: 10 },
    });
    const forkSelection = selectEligibleOptimisticOverlay({
      chainId: 1,
      rows: [
        market({ evidence: optimisticEvidence("101", BLOCK_A, 1) }),
        forked,
      ],
    });
    expect(forkSelection.markets).toHaveLength(0);
    expect(
      forkSelection.rejected.every((row) => row.reason === "ambiguous-pool"),
    ).toBe(true);

    const early = selectEligibleOptimisticOverlay({
      chainId: 1,
      rows: [
        market({
          evidence: evidence("99"),
          market: { indexedValuationBlockNumber: "99", swapCount: 1 },
        }),
      ],
    });
    const result = mergeOptimisticTokenCorpus({
      canonicalTokens: [token()],
      overlay: early,
    });
    expect(result.tokens[0]).not.toHaveProperty("swapCount");
    expect(result.rejected.at(-1)?.reason).toBe("market-before-launch");
  });

  it("never replaces a conflicting canonical launch identity", () => {
    const canonical = token({ transactionHash: TRANSACTION_B, logIndex: 1 });
    const selected = selectEligibleOptimisticOverlay({
      chainId: 1,
      rows: [launch()],
    });
    const result = mergeOptimisticTokenCorpus({
      canonicalTokens: [canonical],
      overlay: selected,
    });

    expect(result.tokens).toEqual([canonical]);
    expect(result.disclosure.active).toBe(false);
    expect(result.rejected.at(-1)?.reason).toBe("canonical-conflict");
  });

  it("exposes additive disclosure and compact response headers", () => {
    const selected = selectEligibleOptimisticOverlay({
      chainId: 1,
      rows: [launch(), market()],
    });
    const result = mergeOptimisticTokenCorpus({
      canonicalTokens: [],
      overlay: selected,
    });
    const body = withOptimisticOverlayDisclosure(
      { status: "ready", tokens: result.tokens },
      result.disclosure,
    );

    expect(body.status).toBe("ready");
    expect(body.optimisticOverlay.applied).toHaveLength(2);
    expect(optimisticOverlayHeaders(result.disclosure)).toMatchObject({
      "x-programmable-overlay": "optimistic-read-overlay-v1",
      "x-programmable-overlay-source": "dual-rpc-head",
      "x-programmable-overlay-finality": "safe",
      "x-programmable-overlay-block": "101",
      "x-programmable-overlay-rows": "2",
    });
  });
});
