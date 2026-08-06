import { describe, expect, it, vi } from "vitest";

import {
  LaunchAuthorityRefreshBindingErrorV1,
  LaunchAuthorityRefreshFailedErrorV1,
  LaunchAuthorityRefreshSingleFlightV1,
  launchAuthorityNeedsRefreshV1,
  launchAuthorityObservationMatchesSetupV1,
  launchAuthorityRefreshIdempotencyKeyV1,
  launchAuthorityRefreshRequiredV1,
  pollPrincipalLaunchAuthorityRefreshV1,
} from "../lib/custom-launch/launch-authority-refresh-v1";
import type {
  LaunchDescriptorV2,
  LaunchEligibilityViewV2,
  PrincipalCustomLaunchApplicationSummaryV2,
  PrincipalLaunchAuthorityRefreshViewV1,
} from "../lib/custom-launch/contract-v2";

const digest = (digit: string) => `sha256:${digit.repeat(64)}` as const;
const APPLICATION_HANDLE = `github-${"a".repeat(64)}` as const;
const GRANT_ID = "123e4567-e89b-42d3-a456-426614174002";

function application(
  overrides: Partial<PrincipalCustomLaunchApplicationSummaryV2> = {},
): PrincipalCustomLaunchApplicationSummaryV2 {
  return {
    applicationId: "application-1",
    applicationHandle: APPLICATION_HANDLE,
    revisionId: "revision-1",
    repositoryId: "123",
    repositoryFullName: "builder/project",
    pullRequestNumber: 7,
    commitOid: "a".repeat(40),
    state: "ready_for_registration",
    reasonCodes: [],
    actionCodes: [],
    correctionCount: 0,
    correctionPreview: [],
    receiptDigest: digest("5"),
    launchEntitlementBindingHash: digest("1"),
    updatedAt: "2026-08-05T12:00:00.000Z",
    ...overrides,
  };
}

function refresh(
  state: "pending" | "current" | "failed",
  overrides: Partial<PrincipalLaunchAuthorityRefreshViewV1> = {},
): PrincipalLaunchAuthorityRefreshViewV1 {
  return {
    schemaVersion: "programmable.principal-launch-authority-refresh.v1",
    state,
    requestId: digest("2"),
    requestDigest: digest("2"),
    applicationId: "application-1",
    applicationHandle: APPLICATION_HANDLE,
    grantId: GRANT_ID,
    grantBindingHash: digest("1"),
    requestedAt: "2026-08-05T12:00:00.000Z",
    observationHash: state === "current" ? digest("3") : null,
    validUntil: state === "current" ? "2099-08-05T12:10:00.000Z" : null,
    ...overrides,
  };
}

describe("principal launch authority refresh", () => {
  it("uses one deterministic key per generation and a fresh key for explicit retry", () => {
    const first = launchAuthorityRefreshIdempotencyKeyV1({ application: application() });
    const same = launchAuthorityRefreshIdempotencyKeyV1({ application: application() });
    const retry = launchAuthorityRefreshIdempotencyKeyV1({
      application: application(),
      attempt: 1,
    });
    expect(first).toBe(same);
    expect(retry).not.toBe(first);
    expect(first.length).toBeGreaterThanOrEqual(16);
    expect(first.length).toBeLessThanOrEqual(512);
  });

  it("polls the same immutable request until its exact bound observation is current", async () => {
    const snapshots = [refresh("pending"), refresh("current")];
    const launchAuthorityRefresh = vi.fn(async (...input: [
      typeof APPLICATION_HANDLE,
      Readonly<{
        schemaVersion: "programmable.principal-launch-authority-refresh-request.v1";
      }>,
      string,
    ]) => {
      expect(input[0]).toBe(APPLICATION_HANDLE);
      return snapshots.shift()!;
    });
    await expect(pollPrincipalLaunchAuthorityRefreshV1({
      client: { launchAuthorityRefresh },
      application: application(),
      idempotencyKey: "launch-authority-refresh-request-1",
      isActive: () => true,
      delay: async () => {},
      now: () => Date.parse("2026-08-05T12:01:00.000Z"),
    })).resolves.toMatchObject({ state: "current", observationHash: digest("3") });
    expect(launchAuthorityRefresh).toHaveBeenCalledTimes(2);
    expect(launchAuthorityRefresh.mock.calls.map((call) => call[2])).toEqual([
      "launch-authority-refresh-request-1",
      "launch-authority-refresh-request-1",
    ]);
  });

  it("deduplicates a same-tab generation and fails closed on identity mutation", async () => {
    const gate = Promise.withResolvers<PrincipalLaunchAuthorityRefreshViewV1>();
    const singleFlight = new LaunchAuthorityRefreshSingleFlightV1();
    const operation = vi.fn(() => gate.promise);
    const left = singleFlight.run("same-generation", operation);
    const right = singleFlight.run("same-generation", operation);
    expect(operation).toHaveBeenCalledOnce();
    gate.resolve(refresh("current"));
    await expect(Promise.all([left, right])).resolves.toHaveLength(2);

    const snapshots = [
      refresh("pending"),
      refresh("current", { grantBindingHash: digest("9") }),
    ];
    await expect(pollPrincipalLaunchAuthorityRefreshV1({
      client: { launchAuthorityRefresh: async () => snapshots.shift()! },
      application: application(),
      idempotencyKey: "launch-authority-refresh-request-2",
      isActive: () => true,
      delay: async () => {},
    })).rejects.toBeInstanceOf(LaunchAuthorityRefreshBindingErrorV1);
  });

  it("treats failed and expired current observations as terminal for that key", async () => {
    await expect(pollPrincipalLaunchAuthorityRefreshV1({
      client: { launchAuthorityRefresh: async () => refresh("failed") },
      application: application(),
      idempotencyKey: "launch-authority-refresh-request-3",
      isActive: () => true,
      delay: async () => {},
    })).rejects.toBeInstanceOf(LaunchAuthorityRefreshFailedErrorV1);

    await expect(pollPrincipalLaunchAuthorityRefreshV1({
      client: {
        launchAuthorityRefresh: async () => refresh("current", {
          validUntil: "2026-08-05T12:00:30.000Z",
        }),
      },
      application: application(),
      idempotencyKey: "launch-authority-refresh-request-4",
      isActive: () => true,
      delay: async () => {},
      now: () => Date.parse("2026-08-05T12:01:00.000Z"),
    })).rejects.toBeInstanceOf(LaunchAuthorityRefreshBindingErrorV1);
  });

  it("requires renewal before a challenge when either authority view is near expiry", () => {
    const descriptor = {
      validUntil: "2026-08-05T12:00:29.000Z",
    } as LaunchDescriptorV2;
    const eligibility = {
      validUntil: "2026-08-05T12:10:00.000Z",
    } as LaunchEligibilityViewV2;
    expect(launchAuthorityNeedsRefreshV1({
      descriptor,
      eligibility,
      now: Date.parse("2026-08-05T12:00:00.000Z"),
    })).toBe(true);
    expect(launchAuthorityNeedsRefreshV1({
      descriptor: { ...descriptor, validUntil: "2026-08-05T12:00:31.000Z" },
      eligibility,
      now: Date.parse("2026-08-05T12:00:00.000Z"),
    })).toBe(false);
    expect(launchAuthorityRefreshRequiredV1({
      descriptor: { ...descriptor, validUntil: "2026-08-05T12:09:00.000Z" },
      eligibility,
      forceFreshObservation: true,
      refreshCompleted: false,
      now: Date.parse("2026-08-05T12:00:00.000Z"),
    })).toBe(true);
    expect(launchAuthorityRefreshRequiredV1({
      descriptor: { ...descriptor, validUntil: "2026-08-05T12:09:00.000Z" },
      eligibility,
      forceFreshObservation: true,
      refreshCompleted: true,
      now: Date.parse("2026-08-05T12:00:00.000Z"),
    })).toBe(false);
  });

  it("does not accept a stale descriptor after a new observation completes", () => {
    const current = refresh("current");
    const descriptor = {
      grantId: GRANT_ID,
      grantBindingHash: digest("1"),
      validUntil: current.validUntil,
    } as LaunchDescriptorV2;
    const eligibility = {
      grantId: GRANT_ID,
      grantBindingHash: digest("1"),
      validUntil: current.validUntil,
    } as LaunchEligibilityViewV2;
    expect(launchAuthorityObservationMatchesSetupV1({
      refresh: current,
      descriptor,
      eligibility,
    })).toBe(true);
    expect(launchAuthorityObservationMatchesSetupV1({
      refresh: current,
      descriptor: { ...descriptor, validUntil: "2026-08-05T12:05:00.000Z" },
      eligibility,
    })).toBe(false);
  });
});
