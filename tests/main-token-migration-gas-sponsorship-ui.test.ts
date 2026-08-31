import { afterEach, describe, expect, it, vi } from "vitest";

import {
  gasSponsorshipDisplayKind,
  gasSponsorshipErrorMessage,
  gasSponsorshipFailure,
  gasSponsorshipState,
  hasEnoughMigrationGas,
  parseGasSponsorshipResponse,
  sponsorshipRetryAfterMs,
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
  afterEach(() => vi.restoreAllMocks());

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

  it("bounds Retry-After polling and falls back safely", () => {
    expect(sponsorshipRetryAfterMs(new Response())).toBe(3_000);
    expect(sponsorshipRetryAfterMs(new Response(null, {
      headers: { "retry-after": "0" },
    }))).toBe(1_000);
    expect(sponsorshipRetryAfterMs(new Response(null, {
      headers: { "retry-after": "2.2" },
    }))).toBe(2_200);
    expect(sponsorshipRetryAfterMs(new Response(null, {
      headers: { "retry-after": "999" },
    }))).toBe(15_000);
    expect(sponsorshipRetryAfterMs(new Response(null, {
      headers: { "retry-after": "not-a-date" },
    }))).toBe(3_000);

    vi.spyOn(Date, "now").mockReturnValue(
      Date.parse("2026-08-30T12:00:00.000Z"),
    );
    expect(sponsorshipRetryAfterMs(new Response(null, {
      headers: { "retry-after": "Sun, 30 Aug 2026 12:00:07 GMT" },
    }))).toBe(7_000);
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
      retryable: false,
    });
  });

  it("keeps terminal failures terminal even without usable server copy", async () => {
    const requestId = "123e4567-e89b-12d3-a456-426614174000";
    for (const [code, expected] of [
      [
        "submission_unknown",
        "The gas top-up status could not be confirmed. Check again shortly. No second top-up will be sent.",
      ],
      [
        "sponsorship_closed",
        "Gas sponsorship is closed for this migration window.",
      ],
      [
        "sponsorship_failed",
        "The gas top-up could not be confirmed. Contact migration support before trying again.",
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
        retryable: false,
      });
    }
  });
});
