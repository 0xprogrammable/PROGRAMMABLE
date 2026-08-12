import { describe, expect, it, vi } from "vitest";

import {
  ApplicantRefreshUserUnavailableErrorV1,
  createApplicantRefreshUserGateV1,
} from "../lib/custom-launch/applicant-refresh-user-gate-v1";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe("Applicant refreshUser gate", () => {
  it("coalesces concurrent refreshes and reuses one short-lived success", async () => {
    let now = 1_000;
    const pending = deferred<{ id: string }>();
    const source = vi.fn(() => pending.promise);
    const gate = createApplicantRefreshUserGateV1({
      source,
      now: () => now,
      cacheTtlMs: 5_000,
    });

    const first = gate.refresh("same-authority");
    const second = gate.refresh("same-authority");
    expect(second).toBe(first);
    await Promise.resolve();
    expect(source).toHaveBeenCalledTimes(1);

    pending.resolve({ id: "did:privy:applicant" });
    await expect(first).resolves.toEqual({ id: "did:privy:applicant" });
    await expect(gate.refresh("same-authority"))
      .resolves.toEqual({ id: "did:privy:applicant" });
    expect(source).toHaveBeenCalledTimes(1);

    now += 5_001;
    await gate.refresh("same-authority");
    expect(source).toHaveBeenCalledTimes(2);
  });

  it("never reuses a success for another authority key", async () => {
    const source = vi.fn(async () => ({ id: crypto.randomUUID() }));
    const gate = createApplicantRefreshUserGateV1({
      source,
      rateLimitCooldownMs: 0,
    });

    await gate.refresh("authority-a");
    await gate.refresh("authority-b");
    expect(source).toHaveBeenCalledTimes(2);
  });

  it("does not overlap provider calls for interleaved authority keys", async () => {
    let now = 1_000;
    const first = deferred<{ id: string }>();
    const source = vi.fn(() => first.promise);
    const gate = createApplicantRefreshUserGateV1({
      source,
      now: () => now,
      rateLimitCooldownMs: 4_000,
    });

    const authorityA = gate.refresh("authority-a");
    await expect(gate.refresh("authority-b")).rejects.toMatchObject({
      code: "applicant_session_rate_limited",
      retryable: true,
      status: 429,
    });
    expect(gate.refresh("authority-a")).toBe(authorityA);
    await Promise.resolve();
    expect(source).toHaveBeenCalledTimes(1);

    first.resolve({ id: "did:privy:authority-a" });
    await expect(authorityA).resolves.toEqual({
      id: "did:privy:authority-a",
    });
    await expect(gate.refresh("authority-b"))
      .rejects.toBeInstanceOf(ApplicantRefreshUserUnavailableErrorV1);
    expect(source).toHaveBeenCalledTimes(1);

    now += 4_001;
    await gate.refresh("authority-b");
    expect(source).toHaveBeenCalledTimes(2);
  });

  it("does not cache null results or ordinary failures", async () => {
    const source = vi.fn<() => Promise<{ id: string } | null>>()
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error("provider unavailable"))
      .mockResolvedValueOnce({ id: "did:privy:applicant" });
    const gate = createApplicantRefreshUserGateV1({
      source,
      rateLimitCooldownMs: 0,
    });

    await expect(gate.refresh("authority")).resolves.toBeNull();
    await expect(gate.refresh("authority")).rejects.toThrow(
      "provider unavailable",
    );
    await expect(gate.refresh("authority")).resolves.toEqual({
      id: "did:privy:applicant",
    });
    expect(source).toHaveBeenCalledTimes(3);
  });

  it("turns a provider 429 into bounded retryable capacity state", async () => {
    let now = 10_000;
    const source = vi.fn<() => Promise<{ id: string }>>()
      .mockRejectedValueOnce(Object.assign(new Error("limited"), {
        privyErrorCode: "too_many_requests",
        status: 429,
      }))
      .mockResolvedValueOnce({ id: "did:privy:applicant" });
    const gate = createApplicantRefreshUserGateV1({
      source,
      now: () => now,
      rateLimitCooldownMs: 4_000,
    });

    await expect(gate.refresh("authority")).rejects.toMatchObject({
      code: "applicant_session_rate_limited",
      retryable: true,
      status: 429,
    });
    await expect(gate.refresh("authority"))
      .rejects.toBeInstanceOf(ApplicantRefreshUserUnavailableErrorV1);
    expect(source).toHaveBeenCalledTimes(1);

    now += 4_001;
    await expect(gate.refresh("authority")).resolves.toEqual({
      id: "did:privy:applicant",
    });
    expect(source).toHaveBeenCalledTimes(2);
  });

  it("invalidates cached authority without letting stale completion win", async () => {
    let now = 1_000;
    const first = deferred<{ id: string }>();
    const second = deferred<{ id: string }>();
    const source = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const gate = createApplicantRefreshUserGateV1({
      source,
      now: () => now,
      rateLimitCooldownMs: 4_000,
    });

    const stale = gate.refresh("authority");
    gate.invalidate();
    await expect(gate.refresh("authority"))
      .rejects.toBeInstanceOf(ApplicantRefreshUserUnavailableErrorV1);
    first.resolve({ id: "stale" });
    await expect(stale).resolves.toEqual({ id: "stale" });

    now += 4_001;
    const current = gate.refresh("authority");
    expect(gate.refresh("authority")).toBe(current);
    second.resolve({ id: "current" });
    await expect(current).resolves.toEqual({ id: "current" });
    await expect(gate.refresh("authority")).resolves.toEqual({ id: "current" });
    expect(source).toHaveBeenCalledTimes(2);
  });
});
