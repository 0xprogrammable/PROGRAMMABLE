import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createMigrationRequestGate,
  gasSponsorshipDisplayKind,
  gasSponsorshipErrorMessage,
  gasSponsorshipFailure,
  gasSponsorshipState,
  hasEnoughMigrationGas,
  parseGasSponsorshipResponse,
  sponsorshipRetryAfterMs,
  waitForMigrationRetry,
  type MainTokenGasSponsorshipResponse,
  type MainTokenGasSponsorshipStatus,
} from "../components/main-token-migration";

const SCHEMA =
  "programmable-main-token-migration-gas-sponsorship/v1" as const;
const WALLET = "0x1111111111111111111111111111111111111111";
const OTHER_WALLET = "0x2222222222222222222222222222222222222222";
const TX_HASH = `0x${"ab".repeat(32)}` as const;

function response(
  status: MainTokenGasSponsorshipStatus,
  overrides: Partial<MainTokenGasSponsorshipResponse> = {},
) {
  return {
    schema: SCHEMA,
    status,
    walletAddress: WALLET,
    topUpWei: "42000",
    transactionHash: TX_HASH,
    estimatedTransferGas: "100000",
    ...overrides,
  };
}

describe("main token migration gas sponsorship UI contract", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("accepts only the exact schema and connected wallet", () => {
    expect(parseGasSponsorshipResponse(response("confirmed"), WALLET)).toEqual({
      schema: SCHEMA,
      status: "confirmed",
      walletAddress: WALLET,
      topUpWei: "42000",
      transactionHash: TX_HASH,
      estimatedTransferGas: "100000",
    });

    for (const malformed of [
      response("confirmed", { walletAddress: OTHER_WALLET }),
      { ...response("confirmed"), schema: "wrong" },
      { ...response("confirmed"), status: "ready" },
      { ...response("confirmed"), topUpWei: "-1" },
      { ...response("confirmed"), topUpWei: "01" },
      { ...response("confirmed"), estimatedTransferGas: "1e5" },
      { ...response("confirmed"), transactionHash: "0x1234" },
      { ...response("confirmed"), transactionHash: null },
      { ...response("not_needed"), topUpWei: "1", transactionHash: null },
      { ...response("eligible"), transactionHash: TX_HASH },
      { ...response("confirmed"), unexpected: true },
    ]) {
      expect(() => parseGasSponsorshipResponse(malformed, WALLET)).toThrow(
        "gas sponsorship response is invalid",
      );
    }
  });

  it("maps every server status without treating submitted funding as ready", () => {
    expect(gasSponsorshipState(response("eligible"))).toEqual({
      kind: "eligible",
      account: WALLET,
    });
    expect(gasSponsorshipState(response("submitted"))).toEqual({
      kind: "requested",
      account: WALLET,
      transactionHash: TX_HASH,
    });
    expect(gasSponsorshipState(response("pending"))).toEqual({
      kind: "funding-confirming",
      account: WALLET,
      transactionHash: TX_HASH,
    });
    expect(gasSponsorshipState(response("confirmed"))).toEqual({
      kind: "balance-confirming",
      account: WALLET,
      transactionHash: TX_HASH,
    });
    expect(gasSponsorshipState(response("not_needed"))).toEqual({
      kind: "not-needed",
      account: WALLET,
    });
    const confirmed = gasSponsorshipState(response("confirmed"));
    expect(gasSponsorshipDisplayKind(confirmed, false)).toBe(
      "balance-confirming",
    );
    expect(gasSponsorshipDisplayKind(confirmed, true)).toBe("ready");
  });

  it("requires the freshly observed ETH balance to cover the full reserve", () => {
    const gasPriceWei = 2_000_000_000n;
    const exactReserveWei = gasPriceWei * 100_000n;

    expect(hasEnoughMigrationGas(exactReserveWei, gasPriceWei)).toBe(true);
    expect(hasEnoughMigrationGas(exactReserveWei - 1n, gasPriceWei)).toBe(false);
    expect(hasEnoughMigrationGas(0n, gasPriceWei)).toBe(false);
    expect(hasEnoughMigrationGas(exactReserveWei, 0n)).toBe(false);
    expect(hasEnoughMigrationGas(-1n, gasPriceWei)).toBe(false);
  });

  it("honors the full Retry-After minimum and falls back safely", () => {
    expect(sponsorshipRetryAfterMs(new Response())).toBe(3_000);
    expect(sponsorshipRetryAfterMs(new Response(null, {
      headers: { "retry-after": "0" },
    }))).toBe(1_000);
    expect(sponsorshipRetryAfterMs(new Response(null, {
      headers: { "retry-after": "2.2" },
    }))).toBe(2_200);
    expect(sponsorshipRetryAfterMs(new Response(null, {
      headers: { "retry-after": "999" },
    }))).toBe(999_000);
    expect(sponsorshipRetryAfterMs(new Response(null, {
      headers: { "retry-after": "60" },
    }))).toBe(60_000);
    expect(sponsorshipRetryAfterMs(new Response(null, {
      headers: { "retry-after": "not-a-date" },
    }))).toBe(3_000);
    expect(sponsorshipRetryAfterMs(new Response(null, {
      headers: { "retry-after": "Infinity" },
    }))).toBe(3_000);

    vi.spyOn(Date, "now").mockReturnValue(
      Date.parse("2026-08-30T12:00:00.000Z"),
    );
    expect(sponsorshipRetryAfterMs(new Response(null, {
      headers: { "retry-after": "Sun, 30 Aug 2026 12:00:07 GMT" },
    }))).toBe(7_000);
    expect(sponsorshipRetryAfterMs(new Response(null, {
      headers: { "retry-after": "Sun, 30 Aug 2026 12:05:00 GMT" },
    }))).toBe(300_000);
  });

  it("splits waits beyond the browser timer range without retrying early", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const complete = vi.fn();
    const waiting = waitForMigrationRetry(2_147_484_647).then(complete);
    await vi.advanceTimersByTimeAsync(2_147_483_647);
    expect(complete).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(999);
    expect(complete).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await waiting;
    expect(complete).toHaveBeenCalledOnce();
  });

  it("serializes one wallet's reads and submits while preserving its cooldown", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const gate = createMigrationRequestGate();
    let releaseRead!: () => void;
    const readPending = new Promise<void>((resolve) => { releaseRead = resolve; });
    const read = gate.run(WALLET, async () => {
      await readPending;
      gate.defer(WALLET, 60_000);
      return "read";
    });
    const submit = vi.fn(async () => "submitted");
    const submitted = gate.run(WALLET.toUpperCase(), submit);
    await gate.run(OTHER_WALLET, async () => "independent");
    expect(submit).not.toHaveBeenCalled();
    releaseRead();
    await read;
    await vi.advanceTimersByTimeAsync(59_999);
    expect(submit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(submitted).resolves.toBe("submitted");
    expect(submit).toHaveBeenCalledOnce();
  });

  it("does not issue an aborted queued read and releases a failed request", async () => {
    const gate = createMigrationRequestGate();
    let releaseFirst!: () => void;
    const firstPending = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const first = gate.run(WALLET, async () => { await firstPending; });
    const controller = new AbortController();
    const queuedRead = vi.fn(async () => "should not run");
    const queued = gate.run(WALLET, queuedRead, controller.signal);
    const aborted = expect(queued).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    releaseFirst();
    await first;
    await aborted;
    expect(queuedRead).not.toHaveBeenCalled();
    await expect(gate.run(WALLET, async () => {
      throw new Error("Temporary failure");
    })).rejects.toThrow("Temporary failure");
    await expect(gate.run(WALLET, async () => "recovered")).resolves.toBe("recovered");
  });

  it("preserves the safe server message and request ID", async () => {
    const response = () => new Response(JSON.stringify({
      error: {
        code: "submission_unknown",
        message:
          "The gas top-up needs a status review. No second top-up was sent.",
        requestId: "123e4567-e89b-12d3-a456-426614174000",
      },
    }), {
      status: 503,
      headers: { "content-type": "application/json" },
    });
    await expect(gasSponsorshipErrorMessage(response())).resolves.toBe(
      "The gas top-up needs a status review. No second top-up was sent. " +
      "Request ID: 123e4567-e89b-12d3-a456-426614174000",
    );
    await expect(gasSponsorshipFailure(response())).resolves.toEqual({
      message:
        "The gas top-up needs a status review. No second top-up was sent. " +
        "Request ID: 123e4567-e89b-12d3-a456-426614174000",
      retryable: true,
    });
  });

  it("keeps only closed or failed sponsorship terminal", async () => {
    const requestId = "123e4567-e89b-12d3-a456-426614174000";
    for (const [code, expected, retryable] of [
      [
        "submission_unknown",
        "The gas top-up status could not be confirmed. Check again shortly. No second top-up will be sent.",
        true,
      ],
      [
        "sponsorship_closed",
        "Gas sponsorship is closed for this migration window.",
        false,
      ],
      [
        "sponsorship_failed",
        "The gas top-up could not be confirmed. Contact migration support before trying again.",
        false,
      ],
    ] as const) {
      const failure = await gasSponsorshipFailure(new Response(JSON.stringify({
        error: { code, message: "x".repeat(241), requestId },
      }), {
        status: 503,
        headers: { "content-type": "application/json" },
      }));
      expect(failure).toEqual({
        message: `${expected} Request ID: ${requestId}`,
        retryable,
      });
    }
  });
});
