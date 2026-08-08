import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { assertLaunchSetupBindings } from "../components/custom-launch-experience";
import { CustomLaunchWebsiteRequestErrorV2 } from "../lib/custom-launch/client-v2";
import type {
  BrowserWalletGrantReissueViewV1,
  LaunchDescriptorV2,
  LaunchEligibilityViewV2,
  PrincipalCustomLaunchApplicationSummaryV2,
} from "../lib/custom-launch/contract-v2";
import {
  assertFreshReissuedGrantV1,
  BrowserWalletGrantReissueBindingErrorV1,
  BrowserWalletGrantReissueSingleFlightV1,
  isLaunchPreparationReissueRequiredV1,
  pollBrowserWalletGrantReissueV1,
} from "../lib/custom-launch/grant-reissue-v1";

const OLD_GRANT_ID = "123e4567-e89b-42d3-a456-426614174001";
const NEW_GRANT_ID = "123e4567-e89b-42d3-a456-426614174002";
const REQUEST_ID = "123e4567-e89b-42d3-a456-426614174003";
const TASK_ID = "123e4567-e89b-42d3-a456-426614174004";
const APPLICATION_HANDLE = `github-${"a".repeat(64)}` as const;
const digest = (digit: string) => `sha256:${digit.repeat(64)}` as const;

function reissue(
  state: BrowserWalletGrantReissueViewV1["state"],
): BrowserWalletGrantReissueViewV1 {
  return {
    schemaVersion: "programmable.browser-wallet-grant-reissue.v2",
    state,
    requestId: REQUEST_ID,
    requestDigest: digest("1"),
    analysisTaskId: TASK_ID,
    applicationId: "application-1",
    applicationHandle: APPLICATION_HANDLE,
    oldGrantId: OLD_GRANT_ID,
    newGrantId: state === "ready" ? NEW_GRANT_ID : null,
    newGrantBindingHash: state === "ready" ? digest("2") : null,
    requestedAt: "2026-08-05T12:00:00.000Z",
  };
}

function descriptor(
  fresh = false,
): LaunchDescriptorV2 {
  return {
    schemaVersion: "programmable.launch-route-discovery.v3",
    applicationId: "application-1",
    applicationHandle: APPLICATION_HANDLE,
    grantId: fresh ? NEW_GRANT_ID : OLD_GRANT_ID,
    grantBindingHash: fresh ? digest("2") : digest("3"),
    descriptorHash: fresh ? digest("4") : digest("5"),
    validUntil: fresh
      ? "2026-08-05T13:00:00.000Z"
      : "2026-08-05T12:05:00.000Z",
    configurationSchema: {
      schemaVersion: "programmable.launch-configuration-schema.v2",
      schemaHash: digest("6"),
      fields: [],
    },
    routes: [{
      choiceId: "ethereum",
      chainId: "1",
      chainProfileId: "ethereum-mainnet-v1",
      launchRouteId: "route-1",
      launchRouteBindingHash: digest("7"),
      routeAdapterId: "adapter-1",
      executionMode: "browser-wallet-self-submit",
      walletActionKind: "eip1193-send-transaction",
      walletExecutionKind: "eoa-direct",
      transactionValuePolicy: { kind: "exact", valueWei: "0" },
      feePolicy: {
        schemaVersion: "programmable.custom-launch-fee-policy.v1",
        providerId: "programmable",
        modelId: "custom-contract-graph",
        templateId: "standard-custom",
        semanticVersion: "1.0.0",
        feeMode: "standard-programmable-custom",
        marketPathId: "official-market-path-v1",
        totalRatePpm: 1000,
        totalRateBps: 10,
        chargeMode: "added-on-top",
        normalProgrammableTenBpsApplied: true,
        legs: [{
          role: "programmable",
          ratePpm: 1000,
          rateBps: 10,
          recipient: {
            namespace: "eip155:1",
            value: "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c",
          },
        }],
      },
    }],
    defaultChoiceId: "ethereum",
  };
}

function application(
  overrides: Partial<PrincipalCustomLaunchApplicationSummaryV2> = {},
): PrincipalCustomLaunchApplicationSummaryV2 {
  return {
    applicationId: "application-1",
    applicationHandle: APPLICATION_HANDLE,
    revisionId: "revision-1",
    repositoryId: "42",
    repositoryOwnerId: "309941960",
    repositoryFullName: "builder/project",
    pullRequestNumber: 7,
    commitOid: "a".repeat(40),
    treeOid: "b".repeat(40),
    state: "ready_for_registration",
    reasonCodes: [],
    actionCodes: [],
    correctionCount: 0,
    correctionPreview: [],
    receiptDigest: digest("8"),
    launchEntitlementBindingHash: digest("3"),
    updatedAt: "2026-08-05T12:00:00.000Z",
    ...overrides,
  } as PrincipalCustomLaunchApplicationSummaryV2;
}

function freshApplication(
  overrides: Partial<PrincipalCustomLaunchApplicationSummaryV2> = {},
): PrincipalCustomLaunchApplicationSummaryV2 {
  return application({
    receiptDigest: digest("0"),
    launchEntitlementBindingHash: digest("2"),
    ...overrides,
  });
}

function freshEligibility(): LaunchEligibilityViewV2 {
  return {
    schemaVersion: "programmable.launch-eligibility-view.v3",
    applicationId: "application-1",
    applicationHandle: APPLICATION_HANDLE,
    grantId: NEW_GRANT_ID,
    grantBindingHash: digest("2"),
    state: "active",
    launchAllowed: true,
    receiptDigest: digest("0"),
    validFrom: "2026-08-05T12:00:00.000Z",
    validUntil: "2026-08-05T13:00:00.000Z",
  };
}

describe("browser-wallet grant reissue Website flow", () => {
  it("polls one idempotent request until a fresh exact grant is ready", async () => {
    const responses = [reissue("pending"), reissue("ready")];
    const reissueLaunchGrant = vi.fn(async (input: unknown) => {
      expect(input).toEqual({
        oldGrantId: OLD_GRANT_ID,
        idempotencyKey: "grant-reissue-request-1",
        request: {
          schemaVersion: "programmable.browser-wallet-grant-reissue-request.v1",
        },
      });
      return responses.shift()!;
    });
    const wait = vi.fn(async () => {});

    const result = await pollBrowserWalletGrantReissueV1({
      client: { reissueLaunchGrant },
      oldGrantId: OLD_GRANT_ID,
      applicationId: "application-1",
      applicationHandle: APPLICATION_HANDLE,
      idempotencyKey: "grant-reissue-request-1",
      isActive: () => true,
      maximumAttempts: 2,
      delay: wait,
    });

    expect(result).toEqual({ kind: "ready", snapshot: reissue("ready") });
    expect(reissueLaunchGrant).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledOnce();
    expect(() => assertFreshReissuedGrantV1({
      oldDescriptor: descriptor(),
      freshDescriptor: descriptor(true),
      reissue: result.snapshot,
      originalApplication: application(),
      freshApplication: freshApplication(),
    })).not.toThrow();
  });

  it("accepts the current reissued application and binds its new receipt to fresh eligibility", () => {
    const fresh = freshApplication();
    const freshDescriptor = descriptor(true);
    expect(() => {
      assertFreshReissuedGrantV1({
        oldDescriptor: descriptor(),
        freshDescriptor,
        reissue: reissue("ready"),
        originalApplication: application(),
        freshApplication: fresh,
      });
      assertLaunchSetupBindings({
        application: fresh,
        eligibility: freshEligibility(),
        descriptor: freshDescriptor,
        presentation: null,
      });
    }).not.toThrow();
  });

  it("fails closed when the signed-in GitHub principal cannot access the grant", async () => {
    const reissueLaunchGrant = vi.fn(async () => {
      throw new CustomLaunchWebsiteRequestErrorV2(404, "RESOURCE_NOT_FOUND");
    });
    await expect(pollBrowserWalletGrantReissueV1({
      client: { reissueLaunchGrant },
      oldGrantId: OLD_GRANT_ID,
      applicationId: "application-1",
      applicationHandle: APPLICATION_HANDLE,
      idempotencyKey: "grant-reissue-request-1",
      isActive: () => true,
      delay: async () => {},
    })).rejects.toMatchObject({ status: 404 });
    expect(reissueLaunchGrant).toHaveBeenCalledOnce();
  });

  it("rejects a changed head or revoked approval after reissue", () => {
    const common = {
      oldDescriptor: descriptor(),
      freshDescriptor: descriptor(true),
      reissue: reissue("ready"),
      originalApplication: application(),
    };
    expect(() => assertFreshReissuedGrantV1({
      ...common,
      freshApplication: freshApplication({ commitOid: "b".repeat(40) }),
    })).toThrow(BrowserWalletGrantReissueBindingErrorV1);
    expect(() => assertFreshReissuedGrantV1({
      ...common,
      freshApplication: freshApplication({ treeOid: "c".repeat(40) }),
    })).toThrow(BrowserWalletGrantReissueBindingErrorV1);
    expect(() => assertFreshReissuedGrantV1({
      ...common,
      freshApplication: freshApplication({ repositoryOwnerId: "1" }),
    })).toThrow(BrowserWalletGrantReissueBindingErrorV1);
    expect(() => assertFreshReissuedGrantV1({
      ...common,
      freshApplication: freshApplication({ state: "revoked" }),
    })).toThrow(BrowserWalletGrantReissueBindingErrorV1);
    expect(() => assertFreshReissuedGrantV1({
      ...common,
      freshApplication: freshApplication({ state: "approved" }),
    })).toThrow(BrowserWalletGrantReissueBindingErrorV1);
    expect(() => assertFreshReissuedGrantV1({
      ...common,
      freshApplication: freshApplication({ receiptDigest: null }),
    })).toThrow(BrowserWalletGrantReissueBindingErrorV1);
    expect(() => assertFreshReissuedGrantV1({
      ...common,
      freshApplication: freshApplication({ receiptDigest: digest("8") }),
    })).toThrow(BrowserWalletGrantReissueBindingErrorV1);
    expect(() => assertFreshReissuedGrantV1({
      ...common,
      freshApplication: freshApplication({ launchEntitlementBindingHash: digest("9") }),
    })).toThrow(BrowserWalletGrantReissueBindingErrorV1);
  });

  it("deduplicates repeated clicks while one refresh is in flight", async () => {
    const gate = Promise.withResolvers<ReturnType<typeof reissue>>();
    const task = vi.fn(async () => ({ kind: "ready" as const, snapshot: await gate.promise }));
    const singleFlight = new BrowserWalletGrantReissueSingleFlightV1();
    const first = singleFlight.run(`${APPLICATION_HANDLE}:${OLD_GRANT_ID}`, task);
    const second = singleFlight.run(`${APPLICATION_HANDLE}:${OLD_GRANT_ID}`, task);
    expect(second).toBe(first);
    expect(task).toHaveBeenCalledOnce();
    gate.resolve(reissue("ready"));
    await expect(first).resolves.toMatchObject({ kind: "ready" });
  });

  it("does not share an in-flight refresh across application identities", async () => {
    const gate = Promise.withResolvers<ReturnType<typeof reissue>>();
    const task = vi.fn(async () => ({ kind: "ready" as const, snapshot: await gate.promise }));
    const singleFlight = new BrowserWalletGrantReissueSingleFlightV1();
    const first = singleFlight.run(`${APPLICATION_HANDLE}:${OLD_GRANT_ID}`, task);
    const second = singleFlight.run(`github-${"b".repeat(64)}:${OLD_GRANT_ID}`, task);
    expect(second).not.toBe(first);
    expect(task).toHaveBeenCalledTimes(2);
    gate.resolve(reissue("ready"));
    await Promise.all([first, second]);
  });

  it("returns a bounded pending state instead of silently restarting launch", async () => {
    const reissueLaunchGrant = vi.fn(async () => reissue("pending"));
    const wait = vi.fn(async () => {});
    await expect(pollBrowserWalletGrantReissueV1({
      client: { reissueLaunchGrant },
      oldGrantId: OLD_GRANT_ID,
      applicationId: "application-1",
      applicationHandle: APPLICATION_HANDLE,
      idempotencyKey: "grant-reissue-request-1",
      isActive: () => true,
      maximumAttempts: 2,
      delay: wait,
    })).resolves.toEqual({ kind: "pending", snapshot: reissue("pending") });
    expect(reissueLaunchGrant).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledOnce();
  });

  it("rejects the old descriptor and action authority after a fresh grant exists", () => {
    expect(() => assertFreshReissuedGrantV1({
      oldDescriptor: descriptor(),
      freshDescriptor: descriptor(),
      reissue: reissue("ready"),
      originalApplication: application(),
      freshApplication: freshApplication(),
    })).toThrow(BrowserWalletGrantReissueBindingErrorV1);
  });

  it("starts reissue only for the exact preparation-expiry error", async () => {
    expect(isLaunchPreparationReissueRequiredV1(
      new CustomLaunchWebsiteRequestErrorV2(
        409,
        "LAUNCH_PREPARATION_REISSUE_REQUIRED",
      ),
    )).toBe(true);
    expect(isLaunchPreparationReissueRequiredV1(
      new CustomLaunchWebsiteRequestErrorV2(409, "LAUNCH_SESSION_EXPIRED"),
    )).toBe(false);
    expect(isLaunchPreparationReissueRequiredV1(
      new CustomLaunchWebsiteRequestErrorV2(
        503,
        "LAUNCH_PREPARATION_REISSUE_REQUIRED",
      ),
    )).toBe(false);

    const reissueLaunchGrant = vi.fn(async () => {
      throw new CustomLaunchWebsiteRequestErrorV2(409, "LAUNCH_GRANT_NOT_CURRENT");
    });
    await expect(pollBrowserWalletGrantReissueV1({
      client: { reissueLaunchGrant },
      oldGrantId: OLD_GRANT_ID,
      applicationId: "application-1",
      applicationHandle: APPLICATION_HANDLE,
      idempotencyKey: "grant-reissue-request-1",
      isActive: () => true,
      delay: async () => {},
    })).rejects.toMatchObject({ code: "LAUNCH_GRANT_NOT_CURRENT" });
    expect(reissueLaunchGrant).toHaveBeenCalledOnce();
  });

  it("keeps refresh status accessible without focus theft or transaction replay", () => {
    const source = readFileSync(resolve(
      process.cwd(),
      "components/custom-launch-experience.tsx",
    ), "utf8");
    const refreshStart = source.indexOf("const refreshExpiredGrant");
    const refreshEnd = source.indexOf("async function launch", refreshStart);
    expect(refreshStart).toBeGreaterThan(0);
    expect(refreshEnd).toBeGreaterThan(refreshStart);
    const refreshFlow = source.slice(refreshStart, refreshEnd);

    expect(source).toContain('className={styles.progressCopy} aria-live="polite"');
    expect(source).toContain('role={error ? "alert" : "status"}');
    expect(source).toContain('aria-busy={launchProgress !== "idle"}');
    expect(source).toContain("Check approval status");
    expect(source).toContain('type="button"');
    expect(source).toContain('type="submit" disabled={launchProgress !== "idle"}');
    expect(source).toContain('"Preparing launch"');
    expect(source).not.toContain("errorRef.current?.focus()");
    expect(refreshFlow).not.toContain("sendBrowserWalletAction");
    expect(refreshFlow).not.toContain("signLaunchMessage");
  });
});
