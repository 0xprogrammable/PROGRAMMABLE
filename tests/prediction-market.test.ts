import { describe, expect, it } from "vitest";
import { toFunctionSelector } from "viem";

import {
  buildPredictionPermitTypedData,
  PREDICTION_BOOTSTRAP_USDG_ATOMS,
  PREDICTION_MAXIMUM_DURATION_SECONDS,
  ROBINHOOD_CHAIN_ID,
  ROBINHOOD_USDG_ADDRESS,
  buildUsdgPermitTypedData,
  defaultPredictionObservationUtc,
  encodePredictionMarketCreation,
  formatPredictionCountdown,
  getExpectedUsdgPermitDomainSeparator,
  parsePredictionPermitSignature,
  parseBtcUsdThreshold,
  parseUtcObservation,
  serializePredictionPermitTypedData,
  serializeUsdgPermitTypedData,
  validatePredictionMarketDraft,
} from "../lib/prediction-market";
import {
  ROBINHOOD_V4_POOL_MANAGER_ADDRESS,
  ROBINHOOD_V4_POOL_MANAGER_RUNTIME_CODE_HASH,
  ROBINHOOD_V4_QUOTER_RUNTIME_CODE_HASH,
  ROBINHOOD_V4_STATE_VIEW_RUNTIME_CODE_HASH,
  assertPredictionLaunchSnapshot,
  assertPredictionLaunchSnapshotsMatch,
  parsePredictionMarketReleaseConfig,
  requestPredictionMarketSourceMatches,
  type PredictionLaunchSnapshot,
} from "../lib/prediction-market-chain";
import { ROBINHOOD_MULTICALL3_RUNTIME_CODE_HASH } from "../lib/chains";

const nowMs = Date.UTC(2026, 7, 22, 12, 0, 0);
const owner = "0x1111111111111111111111111111111111111111";
const factory = "0x2222222222222222222222222222222222222222";

describe("BTC prediction market launch model", () => {
  it("parses the Chainlink 8-decimal threshold without floating point", () => {
    expect(parseBtcUsdThreshold("60000")).toBe(6_000_000_000_000n);
    expect(parseBtcUsdThreshold("60000.125")).toBe(6_000_012_500_000n);
    expect(parseBtcUsdThreshold("0")).toBeNull();
    expect(parseBtcUsdThreshold("1.000000001")).toBeNull();
    expect(parseBtcUsdThreshold("6e4")).toBeNull();
  });

  it("treats the date-time input as UTC and rejects normalized dates", () => {
    expect(parseUtcObservation("2026-08-24T13:30")).toBe(1_787_578_200);
    expect(parseUtcObservation("2026-02-30T13:30")).toBeNull();
    expect(parseUtcObservation("2026-08-24 13:30")).toBeNull();
    expect(parseUtcObservation("1969-12-31T23:59")).toBeNull();
  });

  it("requires strictly more than 24 hours and derives the exact cutoff", () => {
    const boundary = validatePredictionMarketDraft(
      { observationUtc: "2026-08-23T12:00", thresholdUsd: "60000" },
      nowMs,
    );
    const valid = validatePredictionMarketDraft(
      { observationUtc: "2026-08-23T12:01", thresholdUsd: "60000.125" },
      nowMs,
    );

    expect(boundary).toEqual({
      ok: false,
      errors: {
        observationUtc: "The result time must be more than 24 hours from now.",
      },
    });
    expect(valid.ok).toBe(true);
    if (!valid.ok) throw new Error("Expected valid prediction market");
    expect(valid.market.cutoffTime).toBe(valid.market.observationTime - 60);
    expect(valid.market.thresholdLabel).toBe("$60,000.125");
    expect(valid.market.marketTitle).toBe(
      "Will BTC be at or above $60,000.125 on Aug 23, 2026 at 12:01 UTC?",
    );
  });

  it("rejects result times beyond the immutable 30-day market horizon", () => {
    const beyondMaximum = new Date(
      nowMs + (PREDICTION_MAXIMUM_DURATION_SECONDS + 60) * 1_000,
    ).toISOString().slice(0, 16);

    expect(
      validatePredictionMarketDraft(
        { observationUtc: beyondMaximum, thresholdUsd: "60000" },
        nowMs,
      ),
    ).toEqual({
      ok: false,
      errors: {
        observationUtc: "The result time must be no more than 30 days from now.",
      },
    });
  });

  it("uses a stable UTC default and human countdown", () => {
    expect(defaultPredictionObservationUtc(nowMs)).toBe("2026-08-24T12:00");
    expect(formatPredictionCountdown(1_787_576_400, nowMs)).toBe(
      "2 days 1 hour",
    );
  });

  it("builds the exact Global Dollar permit domain and fixed seed", () => {
    const typedData = buildUsdgPermitTypedData({
      deadline: 1_800_000_000n,
      factoryAddress: factory,
      nonce: 7n,
      owner,
    });

    expect(typedData.domain).toEqual({
      chainId: ROBINHOOD_CHAIN_ID,
      name: "Global Dollar",
      verifyingContract: ROBINHOOD_USDG_ADDRESS,
      version: "1",
    });
    expect(typedData.message).toMatchObject({
      owner,
      spender: factory,
      value: PREDICTION_BOOTSTRAP_USDG_ATOMS,
      nonce: 7n,
    });

    expect(() =>
      buildUsdgPermitTypedData({
        deadline: 1_800_000_000n,
        factoryAddress: factory,
        nonce: -1n,
        owner,
      }),
    ).toThrow("Permit nonce or deadline is outside uint256 bounds");
  });

  it("serializes and parses the exact wallet permit without losing uint256 values", () => {
    const typedData = buildUsdgPermitTypedData({
      deadline: 1_800_000_000n,
      factoryAddress: factory,
      nonce: 7n,
      owner,
    });
    const serialized = JSON.parse(serializeUsdgPermitTypedData(typedData));

    expect(serialized.domain).toMatchObject({
      chainId: 4_663,
      name: "Global Dollar",
      version: "1",
    });
    expect(serialized.message).toMatchObject({
      deadline: "1800000000",
      nonce: "7",
      value: "2000000",
    });
    expect(getExpectedUsdgPermitDomainSeparator()).toBe(
      "0x7a3d7400b27830f4f91c2c16a082486d67c1befecaec2f53b33f1f35d5b62036",
    );

    expect(
      parsePredictionPermitSignature(
        `0x${"11".repeat(32)}${"22".repeat(32)}1b`,
        1_800_000_000n,
      ),
    ).toEqual({
      deadline: 1_800_000_000n,
      r: `0x${"11".repeat(32)}`,
      s: `0x${"22".repeat(32)}`,
      v: 27,
    });
  });

  it("binds trade permits to the exact token, router, value, and nonce", () => {
    const token = "0x3333333333333333333333333333333333333333";
    const router = "0x4444444444444444444444444444444444444444";
    const typedData = buildPredictionPermitTypedData({
      deadline: 1_800_000_000n,
      nonce: 9n,
      owner,
      spender: router,
      tokenAddress: token,
      tokenName: "BTC above $60,000 · YES",
      value: 123_456n,
    });
    const serialized = JSON.parse(
      serializePredictionPermitTypedData(typedData),
    );

    expect(serialized.domain).toMatchObject({
      chainId: ROBINHOOD_CHAIN_ID,
      name: "BTC above $60,000 · YES",
      verifyingContract: token,
      version: "1",
    });
    expect(serialized.message).toMatchObject({
      deadline: "1800000000",
      nonce: "9",
      owner,
      spender: router,
      value: "123456",
    });
  });

  it("encodes the one-transaction permit creation call", () => {
    const validation = validatePredictionMarketDraft(
      { observationUtc: "2026-08-24T12:00", thresholdUsd: "60000" },
      nowMs,
    );
    if (!validation.ok) throw new Error("Expected valid prediction market");

    const transaction = encodePredictionMarketCreation({
      factoryAddress: factory,
      market: validation.market,
      permit: {
        deadline: 1_800_000_000n,
        r: `0x${"11".repeat(32)}`,
        s: `0x${"22".repeat(32)}`,
        v: 27,
      },
    });

    expect(transaction.to).toBe(factory);
    expect(transaction.value).toBe(0n);
    expect(transaction.data.slice(0, 10)).toBe(
      toFunctionSelector(
        "createMarketWithPermit(uint32,int192,uint256,uint8,bytes32,bytes32)",
      ),
    );
  });

  it("rejects malformed permit and market bounds before wallet submission", () => {
    const validation = validatePredictionMarketDraft(
      { observationUtc: "2026-08-24T12:00", thresholdUsd: "60000" },
      nowMs,
    );
    if (!validation.ok) throw new Error("Expected valid prediction market");

    expect(() =>
      encodePredictionMarketCreation({
        factoryAddress: factory,
        market: validation.market,
        permit: {
          deadline: 1_800_000_000n,
          r: `0x${"11".repeat(32)}`,
          s: `0x${"22".repeat(32)}`,
          v: Number.NaN,
        },
      }),
    ).toThrow("Permit signature is invalid");

    expect(() =>
      encodePredictionMarketCreation({
        factoryAddress: factory,
        market: validation.market,
        permit: {
          deadline: 1_800_000_000n,
          r: `0x${"11".repeat(32)}`,
          s: `0x${"22".repeat(32)}`,
          v: 1,
        },
      }),
    ).toThrow("Permit signature is invalid");

    expect(() =>
      encodePredictionMarketCreation({
        factoryAddress: factory,
        market: validation.market,
        permit: {
          deadline: 0n,
          r: `0x${"11".repeat(32)}`,
          s: `0x${"22".repeat(32)}`,
          v: 27,
        },
      }),
    ).toThrow("Prediction market or permit bounds are invalid");
  });
});

describe("prediction market release boundary", () => {
  const runtimeCodeHash = `0x${"ab".repeat(32)}` as const;
  const routerRuntimeCodeHash = `0x${"bc".repeat(32)}` as const;
  const hookRuntimeCodeHash = `0x${"cd".repeat(32)}` as const;
  const predictionQuoterRuntimeCodeHash = `0x${"de".repeat(32)}` as const;
  const predictionQuoterAddress =
    "0x7777777777777777777777777777777777777777";
  const secondaryRpcUrl =
    "https://robinhood-mainnet.g.alchemy.com/v2/test_api_key_1234";
  const release = {
    deploymentBlock: 900n,
    factoryAddress: factory,
    hookRuntimeCodeHash,
    predictionQuoterAddress,
    predictionQuoterRuntimeCodeHash,
    routerRuntimeCodeHash,
    runtimeCodeHash,
    secondaryRpcUrl,
  } as const;
  const marketValidation = validatePredictionMarketDraft(
    { observationUtc: "2026-08-24T12:00", thresholdUsd: "60000" },
    nowMs,
  );
  if (!marketValidation.ok) throw new Error("Expected valid prediction market");

  const snapshot = {
    blockNumber: 1_000n,
    blockTimestamp: BigInt(nowMs / 1_000),
    bootstrapCollateral: 2_000_000n,
    collateral: ROBINHOOD_USDG_ADDRESS,
    controller: "0x3333333333333333333333333333333333333333",
    cutoffBeforeObservation: 60n,
    domainSeparator: getExpectedUsdgPermitDomainSeparator(),
    feed: "0xa2c5184bF03d373Dc9dE4876eb4Bce595B460251",
    globalCap: (1n << 256n) - 1n,
    hook: "0x5555555555555555555555555555555555555555",
    hookRuntimeCodeHash,
    manager: ROBINHOOD_V4_POOL_MANAGER_ADDRESS,
    marketCheckpoint: "0x0000000000000000000000000000000000000000",
    marketPoolId: `0x${"00".repeat(32)}`,
    marketVault: "0x0000000000000000000000000000000000000000",
    maximumDuration: 2_592_000n,
    minimumDuration: 86_400n,
    nonce: 4n,
    ownerCollateralBalance: 3_000_000n,
    runtimeCodeHash,
    predictionQuoterFactory: factory,
    predictionQuoterPoolManager: ROBINHOOD_V4_POOL_MANAGER_ADDRESS,
    predictionQuoterRuntimeCodeHash,
    officialMulticallRuntimeCodeHash: ROBINHOOD_MULTICALL3_RUNTIME_CODE_HASH,
    officialPoolManagerRuntimeCodeHash:
      ROBINHOOD_V4_POOL_MANAGER_RUNTIME_CODE_HASH,
    officialQuoterRuntimeCodeHash: ROBINHOOD_V4_QUOTER_RUNTIME_CODE_HASH,
    officialStateViewRuntimeCodeHash:
      ROBINHOOD_V4_STATE_VIEW_RUNTIME_CODE_HASH,
    router: "0x6666666666666666666666666666666666666666",
    routerRuntimeCodeHash,
    semanticKey: `0x${"44".repeat(32)}`,
    tokenDecimals: 6,
    tokenName: "Global Dollar",
    totalExposure: 20_000_000n,
  } as const satisfies PredictionLaunchSnapshot;

  it("stays disabled unless address and reviewed runtime hash are both configured", () => {
    expect(parsePredictionMarketReleaseConfig({})).toBeNull();
    expect(
      parsePredictionMarketReleaseConfig({
        deploymentBlock: "900",
        factoryAddress: factory,
        hookRuntimeCodeHash,
        predictionQuoterAddress,
        predictionQuoterRuntimeCodeHash,
        routerRuntimeCodeHash,
        runtimeCodeHash,
        secondaryRpcUrl,
      }),
    ).toEqual(release);
    expect(() =>
      parsePredictionMarketReleaseConfig({ factoryAddress: factory }),
    ).toThrow("deployment block");
  });

  it("accepts a fully backed launch snapshot only when both RPCs agree", () => {
    assertPredictionLaunchSnapshotsMatch(snapshot, { ...snapshot });
    expect(
      assertPredictionLaunchSnapshot({
        config: release,
        market: marketValidation.market,
        snapshot,
      }),
    ).toMatchObject({
      nonce: 4n,
      semanticKey: snapshot.semanticKey,
    });

    expect(() =>
      assertPredictionLaunchSnapshotsMatch(snapshot, {
        ...snapshot,
        totalExposure: snapshot.totalExposure + 1n,
      }),
    ).toThrow("different market state");
  });

  it("fails closed for an existing market, insufficient seed, or a finite public cap", () => {
    expect(() =>
      assertPredictionLaunchSnapshot({
        config: release,
        market: marketValidation.market,
        snapshot: {
          ...snapshot,
          marketVault: "0x5555555555555555555555555555555555555555",
        },
      }),
    ).toThrow("already exists");
    expect(() =>
      assertPredictionLaunchSnapshot({
        config: release,
        market: marketValidation.market,
        snapshot: { ...snapshot, ownerCollateralBalance: 1_999_999n },
      }),
    ).toThrow("at least 2 USDG");
    expect(() =>
      assertPredictionLaunchSnapshot({
        config: release,
        market: marketValidation.market,
        snapshot: {
          ...snapshot,
          globalCap: 100_000_000_000n,
        },
      }),
    ).toThrow("finite public capacity");
  });

  it("fails closed when the batched-read contract is not the reviewed Multicall", () => {
    expect(() =>
      assertPredictionLaunchSnapshot({
        config: release,
        market: marketValidation.market,
        snapshot: {
          ...snapshot,
          officialMulticallRuntimeCodeHash: `0x${"00".repeat(32)}`,
        },
      }),
    ).toThrow("quote stack could not be verified");
  });

  it("rechecks the maximum market horizon against confirmed chain time", () => {
    expect(() =>
      assertPredictionLaunchSnapshot({
        config: release,
        market: marketValidation.market,
        snapshot: {
          ...snapshot,
          blockTimestamp:
            BigInt(marketValidation.market.observationTime) -
            snapshot.maximumDuration -
            1n,
        },
      }),
    ).toThrow("more than 30 days");
  });
});

describe("prediction market public source reconciliation", () => {
  const confirmedMarket = {
    blockNumber: 1_000n,
    checkpoint: "0x3333333333333333333333333333333333333333",
    noToken: "0x5555555555555555555555555555555555555555",
    poolId: `0x${"66".repeat(32)}`,
    semanticKey: `0x${"77".repeat(32)}`,
    transactionHash: `0x${"88".repeat(32)}`,
    vault: "0x2222222222222222222222222222222222222222",
    yesToken: "0x4444444444444444444444444444444444444444",
  } as const;

  it("does not mistake an accepted similarity request for verified source", async () => {
    const results = await requestPredictionMarketSourceMatches(confirmedMarket, {
      fetcher: (async (_url, init) =>
        init?.method === "POST"
          ? new Response(JSON.stringify({ verificationId: "queued" }), {
              status: 202,
            })
          : new Response("{}", { status: 404 })) as typeof fetch,
      maxWaitMs: 0,
    });

    expect(results).toHaveLength(4);
    expect(results.every((result) => result.requestAccepted)).toBe(true);
    expect(results.every((result) => !result.verified)).toBe(true);
  });

  it("requires a public lookup match even when a similarity request says already verified", async () => {
    const results = await requestPredictionMarketSourceMatches(confirmedMarket, {
      fetcher: (async (_url, init) =>
        init?.method === "POST"
          ? new Response(JSON.stringify({ customCode: "already_verified" }), {
              status: 409,
            })
          : new Response("{}", { status: 404 })) as typeof fetch,
      maxWaitMs: 0,
    });

    expect(results.every((result) => result.requestAccepted)).toBe(true);
    expect(results.every((result) => result.requestStatus === 409)).toBe(true);
    expect(results.every((result) => !result.verified)).toBe(true);
  });

  it("polls the public lookup endpoint until all four contracts are verified", async () => {
    let getCalls = 0;
    let nowMs = 1_000;
    const fetcher = (async (_url, init) => {
      if (init?.method === "POST") {
        return new Response(JSON.stringify({ verificationId: "queued" }), {
          status: 202,
        });
      }
      getCalls += 1;
      return getCalls <= 4
        ? new Response("{}", { status: 404 })
        : new Response(JSON.stringify({ match: "match" }));
    }) as typeof fetch;

    const results = await requestPredictionMarketSourceMatches(confirmedMarket, {
      fetcher,
      maxWaitMs: 1_000,
      now: () => nowMs,
      pollIntervalMs: 100,
      sleep: async (milliseconds) => {
        nowMs += milliseconds;
      },
    });

    expect(results.every((result) => result.verified)).toBe(true);
    expect(results.every((result) => result.match === "match")).toBe(true);
  });
});
