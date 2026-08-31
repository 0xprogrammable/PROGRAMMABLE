import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  assertGaslessRecoveryProgress,
  createMigrationRequestGate,
  gasSponsorshipDisplayKind,
  gasSponsorshipErrorMessage,
  gasSponsorshipFailure,
  gasSponsorshipState,
  gaslessTransferFailure,
  gaslessRecoveryIdempotencyKey,
  gaslessTransferIdempotencyKey,
  hasEnoughMigrationGas,
  migrationGaslessResumeAmount,
  migrationTransferRoute,
  parseGaslessTransferResponse,
  parseGasSponsorshipResponse,
  persistGaslessRecoveryProgress,
  sponsorshipRetryAfterMs,
  waitForMigrationRetry,
  storedGaslessTransferProgress,
  type MainTokenGasSponsorshipResponse,
  type MainTokenGasSponsorshipStatus,
  type StoredGaslessTransferProgress,
} from "../components/main-token-migration";
import {
  MAIN_TOKEN_MIGRATION_RELEASE_ID,
  MAIN_TOKEN_TOTAL_SUPPLY_RAW,
} from "../lib/main-token-migration";

const SCHEMA =
  "programmable-main-token-migration-gas-sponsorship/v1" as const;
const WALLET = "0x1111111111111111111111111111111111111111";
const OTHER_WALLET = "0x2222222222222222222222222222222222222222";
const TX_HASH = `0x${"ab".repeat(32)}` as const;
const PARENT_BINDING = `sha256:${"ac".repeat(32)}` as const;
const CHILD_BINDING = `sha256:${"bc".repeat(32)}` as const;
const PROGRESS_KEY = `programmable:main-token-migration:gasless-progress:${MAIN_TOKEN_MIGRATION_RELEASE_ID}`;
const NEW_REQUEST_KEY = "gasless-new-request-123456789";

function gaslessResponse(status: string, overrides: Record<string, unknown> = {}) {
  return {
    schema: "programmable-main-token-migration-gasless-transfer/v1",
    status,
    walletAddress: WALLET,
    amountRaw: "100",
    sponsorAddress: OTHER_WALLET,
    nonce: "0",
    permitDeadline: "1788160000",
    requestBindingHash: PARENT_BINDING,
    permitTransactionHash: TX_HASH,
    transferTransactionHash: null,
    transferBlockNumber: null,
    previousRequestBindingHash: PARENT_BINDING,
    ...overrides,
  };
}

function recoveryStorage(progress: StoredGaslessTransferProgress) {
  const values = new Map<string, string>([[PROGRESS_KEY, JSON.stringify(progress)]]);
  const localStorage = {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
    removeItem: vi.fn((key: string) => { values.delete(key); }),
  };
  vi.stubGlobal("window", { localStorage, dispatchEvent: vi.fn() });
  return { values, localStorage };
}

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
    vi.unstubAllGlobals();
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

  it("routes current EOAs without ETH to token-bound gasless checks", () => {
    const input = {
      accountCodeStatus: "eoa" as const,
      nativeBalanceWei: 0n,
      gasPriceWei: 2_000_000_000n,
      resumingGasless: false,
    };
    expect(migrationTransferRoute(input)).toBe("gasless");
    expect(migrationTransferRoute({
      ...input,
      nativeBalanceWei: 100_000n * input.gasPriceWei,
    })).toBe("wallet");
    expect(migrationTransferRoute({
      ...input,
      accountCodeStatus: "delegated",
      nativeBalanceWei: 100_000n * input.gasPriceWei,
    })).toBe("gasless");
    expect(migrationTransferRoute({
      ...input,
      accountCodeStatus: "contract",
    })).toBe("unsupported");
  });

  it("does not infer readiness from an unknown gas balance or wallet code", () => {
    const input = {
      accountCodeStatus: "eoa" as const,
      nativeBalanceWei: 0n,
      gasPriceWei: 2_000_000_000n,
      resumingGasless: false,
    };
    for (const change of [
      { nativeBalanceWei: null },
      { nativeBalanceWei: -1n },
      { gasPriceWei: null },
      { gasPriceWei: 0n },
      { accountCodeStatus: "unavailable" as const },
      { accountCodeStatus: "checking" as const },
    ]) {
      expect(migrationTransferRoute({ ...input, ...change })).toBe("checking");
    }
    expect(migrationTransferRoute({
      ...input,
      accountCodeStatus: "checking",
      nativeBalanceWei: null,
      gasPriceWei: null,
      resumingGasless: true,
    })).toBe("gasless");
    expect(migrationTransferRoute({
      ...input,
      accountCodeStatus: "contract",
      resumingGasless: true,
    })).toBe("unsupported");
  });

  it("resumes only the same wallet's exact saved amount even after its balance is spent", () => {
    const saved = { account: WALLET, amountRaw: "2000000000000000000" };
    expect(migrationGaslessResumeAmount(saved, WALLET)).toBe(2_000_000_000_000_000_000n);
    expect(migrationGaslessResumeAmount(saved, OTHER_WALLET)).toBeNull();
    expect(migrationGaslessResumeAmount(saved, null)).toBeNull();
    expect(migrationGaslessResumeAmount(null, WALLET)).toBeNull();
    const account = `0x${"ab".repeat(20)}`;
    expect(migrationGaslessResumeAmount({ ...saved, account },
      `0x${"AB".repeat(20)}`)).toBe(2_000_000_000_000_000_000n);
    for (const amountRaw of ["0", "01", "-1", "1e18", " 1", "9".repeat(29),
      (MAIN_TOKEN_TOTAL_SUPPLY_RAW + 1n).toString()]) {
      expect(migrationGaslessResumeAmount({ ...saved, amountRaw }, WALLET)).toBeNull();
    }
  });

  it("never replaces a missing saved gasless request key while resuming", () => {
    const localStorage = { getItem: vi.fn(() => null), setItem: vi.fn() };
    const randomUUID = vi.fn(() => "new-key-must-not-be-used");
    vi.stubGlobal("window", { localStorage, crypto: { randomUUID } });
    const keys = new Map<string, string>();
    expect(() => gaslessTransferIdempotencyKey(WALLET, keys, true)).toThrow(
      "saved migration request key is unavailable",
    );
    expect(randomUUID).not.toHaveBeenCalled();
    expect(localStorage.setItem).not.toHaveBeenCalled();
    expect(keys.size).toBe(0);
    localStorage.getItem.mockImplementation(() => { throw new Error("Storage unavailable"); });
    expect(() => gaslessTransferIdempotencyKey(WALLET, keys, true)).toThrow(
      "saved migration request key is unavailable",
    );
    expect(randomUUID).not.toHaveBeenCalled();
  });

  it("reuses the saved gasless request key for every reconciliation", () => {
    const key = "gasless-existing-request-123456789";
    const localStorage = { getItem: vi.fn(() => key), setItem: vi.fn() };
    vi.stubGlobal("window", { localStorage });
    const keys = new Map<string, string>();
    expect(gaslessTransferIdempotencyKey(WALLET, keys, true)).toBe(key);
    expect(localStorage.getItem).toHaveBeenCalledWith(
      `programmable:main-token-migration:gasless:${MAIN_TOKEN_MIGRATION_RELEASE_ID}:${WALLET}`,
    );
    expect(gaslessTransferIdempotencyKey(WALLET, keys, true)).toBe(key);
    expect(localStorage.getItem).toHaveBeenCalledOnce();
    expect(localStorage.setItem).not.toHaveBeenCalled();
  });

  it("recognizes only the exact server missing-request code for bounded pre-submit recovery", async () => {
    const requestId = "123e4567-e89b-12d3-a456-426614174000";
    await expect(gaslessTransferFailure(new Response(JSON.stringify({
      error: { code: "gasless_request_not_found", message: "Saved request not found.", requestId },
    }), { status: 409 }))).resolves.toEqual({
      code: "gasless_request_not_found",
      message: `Saved request not found. Request ID: ${requestId}`,
    });
    await expect(gaslessTransferFailure(new Response(JSON.stringify({
      error: { code: "gasless_request_not_found\n", message: "x".repeat(241) },
    }), { status: 409 }))).resolves.toEqual({
      code: "",
      message: "The gasless transfer is temporarily unavailable.",
    });
  });

  it("persists only signed requests and never drops a pending marker on cancellation", () => {
    const source = readFileSync(new URL("../components/main-token-migration.tsx", import.meta.url), "utf8");
    const review = source.slice(source.indexOf("  async function reviewGaslessTransfer("),
      source.indexOf("  async function reviewTransfer()"));
    expect(review.indexOf("const permit = await signMainTokenMigrationPermit")).toBeLessThan(
      review.indexOf("const progress = recoveryReview?.previousRequestBindingHash"),
    );
    expect(review.indexOf("persistGaslessRecoveryProgress(recoveryReview.progress")).toBeLessThan(
      review.indexOf('action: recoveryReview?.previousRequestBindingHash ? "submit_recovery" : "submit"'),
    );
    const beforeConfirmation = review.slice(0, review.indexOf('result.status === "confirmed"'));
    expect(beforeConfirmation).not.toContain("clearGaslessTransferProgress()");
    expect(review).toContain('action: "resume"');
    const resume = review.slice(review.indexOf("if (resumeExisting)"), review.indexOf("} else {"));
    expect(resume).toContain("previousRequestBindingHash: savedProgress.previousRequestBindingHash");
    expect(review).toContain("resumeExisting || preservePendingRequest");
    expect(review).toContain('resumeExisting && response.status === 409 &&');
    expect(review).toContain('failure.code === "gasless_request_not_found" && trustedTransferWindowOpen()');
    expect(review).not.toContain("await reviewGaslessTransfer(");
    expect(review).toContain("setGaslessRecoveryReview({");
    expect(source).not.toContain('Gasless transfer available');
  });

  it("accepts recovery only with an exact server predecessor and no possible transfer hash", () => {
    const offer = gaslessResponse("recovery_available");
    expect(parseGaslessTransferResponse(offer, WALLET, 100n).status).toBe("recovery_available");
    for (const change of [
      { previousRequestBindingHash: CHILD_BINDING },
      { previousRequestBindingHash: undefined },
      { requestBindingHash: CHILD_BINDING },
      { transferTransactionHash: TX_HASH },
      { transferBlockNumber: "10" },
      { walletAddress: OTHER_WALLET },
      { amountRaw: "101" },
      { extra: true },
    ]) {
      expect(() => parseGaslessTransferResponse({ ...offer, ...change }, WALLET, 100n)).toThrow();
    }
    expect(parseGaslessTransferResponse({ ...offer, permitTransactionHash: null }, WALLET, 100n)
      .permitTransactionHash).toBeNull();
  });

  it("binds recovery wallet review to the exact parent rather than accepting any fresh approval", () => {
    const prepared = gaslessResponse("signature_required", {
      requestBindingHash: CHILD_BINDING,
      permitTransactionHash: null,
    });
    expect(parseGaslessTransferResponse(prepared, WALLET, 100n, PARENT_BINDING)
      .previousRequestBindingHash).toBe(PARENT_BINDING);
    expect(() => parseGaslessTransferResponse(prepared, WALLET, 100n, CHILD_BINDING)).toThrow();
    expect(() => parseGaslessTransferResponse(prepared, WALLET, 100n)).toThrow();
    const withoutParent: Record<string, unknown> = { ...prepared };
    delete withoutParent.previousRequestBindingHash;
    expect(() => parseGaslessTransferResponse(withoutParent, WALLET, 100n, PARENT_BINDING)).toThrow();
    expect(parseGaslessTransferResponse(withoutParent, WALLET, 100n).status).toBe("signature_required");
  });

  it("atomically saves a recovery key with its parent and restores that exact request after refresh", () => {
    const old: StoredGaslessTransferProgress = {
      schema: "programmable-main-token-migration-gasless-ui/v1", account: WALLET, amountRaw: "100",
    };
    const { localStorage, values } = recoveryStorage(old);
    expect(storedGaslessTransferProgress()).toEqual(old);
    const recovered = persistGaslessRecoveryProgress(old, NEW_REQUEST_KEY, PARENT_BINDING);
    expect(recovered).toEqual({ ...old, schema: "programmable-main-token-migration-gasless-ui/v2",
      idempotencyKey: NEW_REQUEST_KEY, previousRequestBindingHash: PARENT_BINDING });
    expect(localStorage.setItem).toHaveBeenCalledOnce();
    expect(localStorage.setItem).toHaveBeenCalledWith(PROGRESS_KEY, JSON.stringify(recovered));
    expect(storedGaslessTransferProgress()).toEqual(recovered);
    expect(values.get(PROGRESS_KEY)).not.toContain("permitSignature");
    expect(localStorage.removeItem).not.toHaveBeenCalled();
  });

  it("uses the same fresh recovery key across tabs for one parent and a new key for the next parent", () => {
    const firstTab = gaslessRecoveryIdempotencyKey(PARENT_BINDING);
    const secondTab = gaslessRecoveryIdempotencyKey(PARENT_BINDING);
    expect(firstTab).toBe(secondTab);
    expect(firstTab).toMatch(/^[a-zA-Z0-9:_-]{16,200}$/u);
    expect(firstTab).not.toBe(gaslessRecoveryIdempotencyKey(CHILD_BINDING));
    expect(() => gaslessRecoveryIdempotencyKey("sha256:invalid")).toThrow();
  });

  it("preserves the original request when saving a signed recovery fails", () => {
    const old: StoredGaslessTransferProgress = {
      schema: "programmable-main-token-migration-gasless-ui/v1", account: WALLET, amountRaw: "100",
    };
    const { localStorage, values } = recoveryStorage(old);
    localStorage.setItem.mockImplementation(() => { throw new Error("Storage is full"); });
    expect(() => persistGaslessRecoveryProgress(old, NEW_REQUEST_KEY, PARENT_BINDING))
      .toThrow("Nothing was submitted");
    expect(values.get(PROGRESS_KEY)).toBe(JSON.stringify(old));
    expect(storedGaslessTransferProgress()).toEqual(old);
    expect(localStorage.removeItem).not.toHaveBeenCalled();
  });

  it("does not overwrite a newer attempt from another tab or accept malformed v2 progress", () => {
    const old: StoredGaslessTransferProgress = {
      schema: "programmable-main-token-migration-gasless-ui/v1", account: WALLET, amountRaw: "100",
    };
    const { values, localStorage } = recoveryStorage(old);
    const newer = persistGaslessRecoveryProgress(old, NEW_REQUEST_KEY, PARENT_BINDING);
    localStorage.setItem.mockClear();
    expect(() => assertGaslessRecoveryProgress(old)).toThrow("changed in another tab");
    expect(() => persistGaslessRecoveryProgress(old, "gasless-third-request-123456789", CHILD_BINDING)).toThrow();
    expect(localStorage.setItem).not.toHaveBeenCalled();
    expect(storedGaslessTransferProgress()).toEqual(newer);
    for (const change of [{ idempotencyKey: "short" }, { previousRequestBindingHash: "wrong" },
      { amountRaw: (MAIN_TOKEN_TOTAL_SUPPLY_RAW + 1n).toString() }, { permitSignature: TX_HASH }]) {
      values.set(PROGRESS_KEY, JSON.stringify({ ...newer, ...change }));
      expect(storedGaslessTransferProgress()).toBeNull();
    }
  });

  it("requires a distinct user action for fresh recovery and keeps status checks available after closure", () => {
    const source = readFileSync(new URL("../components/main-token-migration.tsx", import.meta.url), "utf8");
    expect(source).toContain('gaslessRecoveryReview && trustedTransferWindowOpen()');
    expect(source).toContain('gaslessRecoveryReview && transferWindowOpen');
    expect(source).toContain('"Review new transfer"');
    expect(source).toContain('data-status={canResumeGaslessTransfer ? "unavailable" : "eoa"}');
    const click = source.slice(source.indexOf("  async function reviewTransfer()"),
      source.indexOf("  async function reviewTransferOnce()"));
    expect(click.indexOf("transferInFlightRef.current = true")).toBeLessThan(click.indexOf("await reviewTransferOnce()"));
    const sign = source.slice(source.indexOf("const permit = await signMainTokenMigrationPermit"),
      source.indexOf('for (let attempt = 0; attempt < 60; attempt += 1)'));
    expect(sign.indexOf("!trustedTransferWindowOpen()")).toBeLessThan(sign.indexOf("persistGaslessRecoveryProgress("));
    expect(sign).not.toContain("clearGaslessTransferProgress");
    expect(source).toContain('(!transferWindowOpen && !canResumeGaslessTransfer)');
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
