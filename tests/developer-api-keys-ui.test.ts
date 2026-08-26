import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  mergeApiKeySummaries,
  type ApiKeySummary,
} from "../components/developer-api-keys";
import {
  mergeLaunchResources,
  parseHistoryPage,
  selectMonotonicLaunchResource,
  type LaunchResource,
  type LaunchStatus,
} from "../components/developer-launch-history";

import {
  PROGRAMMABLE_AGENT_SETUP_LINKS_V1,
  PROGRAMMABLE_AGENT_SETUP_TEXT_V1,
} from "../lib/custom-launch/agent-setup-v1";

const apiKeysSource = readFileSync(
  new URL("../components/developer-api-keys.tsx", import.meta.url),
  "utf8",
);
const apiKeysStyles = readFileSync(
  new URL("../components/developer-api-keys.module.css", import.meta.url),
  "utf8",
);
const historySource = readFileSync(
  new URL("../components/developer-launch-history.tsx", import.meta.url),
  "utf8",
);
const historyStyles = readFileSync(
  new URL("../components/developer-launch-history.module.css", import.meta.url),
  "utf8",
);
const walletProviderSource = readFileSync(
  new URL("../components/wallet-provider.tsx", import.meta.url),
  "utf8",
);

function apiKey(
  id: string,
  overrides: Partial<ApiKeySummary> = {},
): ApiKeySummary {
  return {
    id,
    label: id,
    keyPrefix: `pm_${id}`,
    scopes: ["custom-launch:create", "custom-launch:read"],
    createdAt: "2026-08-25T10:00:00.000Z",
    expiresAt: "2026-11-23T10:00:00.000Z",
    lastUsedAt: null,
    revokedAt: null,
    ...overrides,
  };
}

function launch(
  requestId: string,
  status: LaunchStatus,
  updatedAt: string,
): LaunchResource {
  return {
    schemaVersion: "programmable.custom-launch.v1",
    launchId: requestId,
    requestId,
    onchainLaunchId: null,
    routeId: "custom-launch:create:v1",
    ownerWallet: "0x0000000000000000000000000000000000000001",
    status,
    launchProfileHash: null,
    launchIntentHash: null,
    fundingIntentHash: null,
    createdAt: "2026-08-25T10:00:00.000Z",
    updatedAt,
    output: null,
    failure: null,
  };
}

describe("developer API key interface", () => {
  it("keeps the first view compact and focused on key management", () => {
    expect(apiKeysSource).toContain("<h1>API keys</h1>");
    expect(apiKeysSource).toContain('aria-label="Developer access view"');
    expect(apiKeysSource).toContain('aria-pressed={activeSection === "keys"}');
    expect(apiKeysSource).toContain('aria-pressed={activeSection === "history"}');
    expect(apiKeysSource).toContain('activeSection === "keys" ?');
    expect(apiKeysSource).not.toContain("launchPath");
    expect(apiKeysSource).not.toContain("Fee claims and automated buybacks");
    expect(apiKeysSource).not.toContain("Key owner");
    expect(apiKeysSource).not.toContain("activeCount");

    expect(apiKeysStyles).toMatch(
      /\.workspace\s*\{[^}]*align-items:\s*start;/su,
    );
    expect(apiKeysStyles).toMatch(
      /\.workspace\s*\{[^}]*grid-template-columns:\s*repeat\(2,/su,
    );
    expect(apiKeysStyles).not.toContain("height: clamp(");
    expect(apiKeysStyles).not.toMatch(
      /\.keyList\s*\{[^}]*overflow-y:\s*auto;/su,
    );
    expect(apiKeysStyles).toContain("--api-panel: var(--webde-surface)");
    expect(apiKeysStyles).toContain("--api-line: var(--webde-line)");
    expect(apiKeysStyles).not.toContain("liquid-glass");
  });

  it("uses a styled expiry listbox with complete keyboard and form behavior", () => {
    const expirySelectSource = apiKeysSource.slice(
      apiKeysSource.indexOf("function ExpirySelect"),
      apiKeysSource.indexOf("export function DeveloperApiKeys"),
    );

    expect(apiKeysSource).toContain('aria-haspopup="listbox"');
    expect(apiKeysSource).toContain('role="listbox"');
    expect(apiKeysSource).toContain('role="option"');
    expect(apiKeysSource).toContain('name="expiresInDays"');
    expect(apiKeysSource).toContain('type="hidden"');
    expect(apiKeysSource).toContain('event.key === "ArrowDown"');
    expect(apiKeysSource).toContain('event.key === "ArrowUp"');
    expect(apiKeysSource).toContain('event.key === "Home"');
    expect(apiKeysSource).toContain('event.key === "End"');
    expect(apiKeysSource).toContain('event.key === "Escape"');
    expect(expirySelectSource).toContain("onBlurCapture={(event) => {");
    expect(expirySelectSource).toContain(
      "event.currentTarget.contains(event.relatedTarget)",
    );
    expect(expirySelectSource).not.toContain('event.key === "Tab"');
    expect(apiKeysStyles).toContain(".expiryTrigger");
    expect(apiKeysStyles).toContain(".expiryMenu");
    expect(apiKeysStyles).not.toContain("appearance: auto");
  });

  it("preserves wallet authority and one-time secret handling", () => {
    expect(apiKeysSource).toContain(
      "API keys cannot sign or broadcast wallet transactions.",
    );
    expect(apiKeysSource).toContain("Save this key now");
    expect(apiKeysSource).toContain("It will not be shown again.");
    expect(apiKeysSource).toContain("data-confirm-revoke");
    expect(apiKeysSource).toContain('event.key === "Escape"');
    expect(apiKeysSource).toContain("revealRef.current?.focus()");
    expect(apiKeysSource).toContain("confirmRevokeRef.current?.focus()");
    expect(apiKeysSource).toContain("Copy agent setup");
    expect(apiKeysSource).toContain("PROGRAMMABLE_AGENT_SETUP_TEXT_V1");
    expect(PROGRAMMABLE_AGENT_SETUP_TEXT_V1).toContain("$PROGRAMMABLE_API_KEY");
    expect(PROGRAMMABLE_AGENT_SETUP_TEXT_V1).toContain(
      PROGRAMMABLE_AGENT_SETUP_LINKS_V1.cli,
    );
    expect(PROGRAMMABLE_AGENT_SETUP_TEXT_V1).toContain(
      PROGRAMMABLE_AGENT_SETUP_LINKS_V1.guide,
    );
    expect(PROGRAMMABLE_AGENT_SETUP_TEXT_V1).toContain(
      PROGRAMMABLE_AGENT_SETUP_LINKS_V1.openApi,
    );
    expect(PROGRAMMABLE_AGENT_SETUP_TEXT_V1).toContain(
      PROGRAMMABLE_AGENT_SETUP_LINKS_V1.openApiV3Preview,
    );
    expect(PROGRAMMABLE_AGENT_SETUP_TEXT_V1).toContain(
      PROGRAMMABLE_AGENT_SETUP_LINKS_V1.openApiV1Compatibility,
    );
    expect(PROGRAMMABLE_AGENT_SETUP_TEXT_V1).toContain(
      "For V2, stop at authorized",
    );
    expect(PROGRAMMABLE_AGENT_SETUP_TEXT_V1).toContain(
      "awaiting_funding_authorization",
    );
    expect(PROGRAMMABLE_AGENT_SETUP_TEXT_V1).toContain(
      "fresh, separate review and wallet signature for the exact Router transaction",
    );
    expect(PROGRAMMABLE_AGENT_SETUP_TEXT_V1).toContain(
      "do not submit until discovery advertises it as live",
    );
    expect(PROGRAMMABLE_AGENT_SETUP_TEXT_V1).not.toContain("pm_live_");
  });

  it("offers named loading, failure, empty and recovery states", () => {
    expect(apiKeysSource).toContain("Loading wallet session");
    expect(apiKeysSource).toContain("Wallet access is unavailable");
    expect(apiKeysSource).toContain("Reload page");
    expect(apiKeysSource).toContain("Loading API keys");
    expect(apiKeysSource).toContain("Unable to load keys");
    expect(apiKeysSource).toContain("No keys yet");
    expect(apiKeysSource).toContain("Try again");
    expect(apiKeysSource).toContain("API keys refreshed.");
    expect(apiKeysSource).toContain("Refresh keys");
    expect(apiKeysSource).toContain("data-spinning=");
    expect(apiKeysSource).toContain("8_000");
    expect(apiKeysStyles).toContain("@media (prefers-reduced-motion: reduce)");
    expect(apiKeysStyles).toContain("min-height: 44px");
  });

  it("keeps mutation results when a stale key list arrives", () => {
    const revoked = apiKey("revoked", {
      lastUsedAt: "2026-08-25T10:02:00.000Z",
      revokedAt: "2026-08-25T10:03:00.000Z",
    });
    const created = apiKey("created");
    const staleRevoked = apiKey("revoked", {
      lastUsedAt: "2026-08-25T10:04:00.000Z",
    });
    const serverOnly = apiKey("server-only");

    const merged = mergeApiKeySummaries(
      [created, revoked],
      [staleRevoked, serverOnly],
    );

    expect(merged.map((candidate) => candidate.id)).toEqual([
      "revoked",
      "server-only",
      "created",
    ]);
    expect(merged[0]?.revokedAt).toBe(revoked.revokedAt);
    expect(merged[0]?.lastUsedAt).toBe(staleRevoked.lastUsedAt);
    expect(apiKeysSource).toContain(
      "const readGeneration = ++apiKeyReadGenerationRef.current;",
    );
    expect(apiKeysSource.match(
      /readGeneration !== apiKeyReadGenerationRef\.current/gu,
    )).toHaveLength(2);
    expect(apiKeysSource.match(
      /refreshApiKeysAfterMutation\(account\);/gu,
    )).toHaveLength(2);
    expect(apiKeysSource).toContain(
      'loadApiKeys(walletAddress, undefined, "mutation")',
    );
  });
});

describe("developer launch history interface", () => {
  it("accepts compact authorized V2 list rows and defers output to detail", () => {
    const resource = {
      schemaVersion: "programmable.custom-launch.v2",
      launchId: "50000000-0000-4000-8000-000000000005",
      requestId: "50000000-0000-4000-8000-000000000005",
      onchainLaunchId: null,
      routeId: "custom-launch:create:v2",
      ownerWallet: "0x0000000000000000000000000000000000000001",
      status: "authorized",
      requestHash: `sha256:${"11".repeat(32)}`,
      launchProfileHash: `sha256:${"22".repeat(32)}`,
      launchIntentHash: `sha256:${"33".repeat(32)}`,
      createdAt: "2026-08-25T10:00:00.000Z",
      updatedAt: "2026-08-25T10:01:00.000Z",
      output: null,
      failure: null,
    } as const;
    const { requestHash: _requestHash, ...projectedResource } = resource;
    expect(parseHistoryPage({
      schemaVersion: "programmable.custom-launch-history.v1",
      launches: [resource],
      nextCursor: null,
    }, resource.ownerWallet)).toEqual({
      launches: [{ ...projectedResource, fundingIntentHash: null }],
      nextCursor: null,
    });
    expect(historySource).toContain(
      "const current = await readLaunchResource(launch);",
    );
  });

  it("stays behind the compact view switch and keeps the signing boundary clear", () => {
    expect(historySource).toContain("Launch history");
    expect(historySource).toContain(
      "A launch is onchain only after the\n        wallet signs and broadcasts it.",
    );
    expect(historySource).toContain("Check onchain status");
    expect(historySource).toContain("Review and sign in wallet");
    expect(historySource).toContain("sendCustomLaunchWalletAction(action)");
    expect(historySource).toContain("startStatusPolling(current)");
    expect(historySource).toContain('launch.routeId === "custom-launch:create:v2"');
    expect(historySource).toContain("prepareCustomLaunchWalletActionV2(");
    expect(historySource).toContain("&version=${version}");
    expect(historySource).toContain("Wallet action required");
    expect(historySource).toContain(
      "Review and sign the prepared transaction in your wallet.",
    );
    expect(historySource).not.toContain("Your agent&apos;s first accepted request");
    expect(historyStyles).not.toContain("height: clamp(");
    expect(historyStyles).toContain("background: var(--webde-surface)");
    expect(historyStyles).toContain("background: var(--webde-surface-raised)");
    expect(historyStyles).not.toContain("liquid-glass");
    expect(historyStyles).not.toMatch(
      /\.launchList\s*\{[^}]*overflow-y:\s*auto;/su,
    );
  });

  it("announces loading and refreshed status without changing wallet authority", () => {
    expect(historySource).toContain("Loading launch history");
    expect(historySource).toContain("Launch status updated.");
    expect(historySource).toContain("Launch history refreshed.");
    expect(historySource).toContain("Refresh history");
    expect(historySource).toContain('aria-live="polite"');
    expect(historySource).toContain("state === \"loading\" || loadingMore || refreshing");
    expect(historySource).toContain("Prepared transaction");
  });

  it("releases a stalled history refresh with a clear retry state", () => {
    expect(historySource).toContain("launchHistoryRefreshTimeoutMs = 12_000");
    expect(historySource).toContain(
      "controller.abort(launchHistoryRefreshTimeoutReason)",
    );
    expect(historySource).toContain(
      "Launch history refresh took too long. Try again.",
    );
    expect(historySource).toContain(
      "Launch history refresh timed out.",
    );
    expect(historySource).toContain("setRefreshing(false)");
  });

  it("hydrates compact V3 rows and rechecks the reviewed bytes before either wallet action", () => {
    expect(historySource).toContain(
      "const reviewLaunch = reviewResourceForLaunch(",
    );
    expect(historySource).toContain("Load funding review");
    expect(historySource).toContain("Load Router review");
    expect(historySource).toContain("Review and sign USDC authorization");
    expect(historySource).toContain("Review and sign in wallet");
    expect(historySource).not.toContain("Send reviewed Router transaction");
    expect(historySource).toContain(
      "onClick={() => void loadWalletReview(launch)}",
    );
    expect(historySource).toContain("reviewLaunch.output !== null");

    const hydrationStart = historySource.indexOf(
      "const loadWalletReview = async",
    );
    const hydrationEnd = historySource.indexOf(
      "const startV3PreparationPolling",
      hydrationStart,
    );
    const hydrationBoundary = historySource.slice(hydrationStart, hydrationEnd);
    const validatedHydrationWrite = hydrationBoundary.indexOf(
      "setHydratedReviews((reviews) => Object.freeze({",
    );
    expect(validatedHydrationWrite).toBeGreaterThan(
      hydrationBoundary.indexOf("fundingAuthorizationReview(current)"),
    );
    expect(validatedHydrationWrite).toBeGreaterThan(
      hydrationBoundary.indexOf("routerTransactionReview(current)"),
    );
    expect(historySource).toContain(
      '? routerReview?.walletAction ?? null\n              : walletTransaction(reviewLaunch)',
    );

    const fundingStart = historySource.indexOf(
      "const submitFundingAuthorization = async",
    );
    const fundingEnd = historySource.indexOf(
      "const submitWalletTransaction = async",
      fundingStart,
    );
    const fundingBoundary = historySource.slice(fundingStart, fundingEnd);
    expect(fundingBoundary.indexOf("sameFundingAuthorization(")).toBeGreaterThan(-1);
    expect(fundingBoundary.indexOf("signCustomLaunchFundingAuthorization(")).toBeGreaterThan(
      fundingBoundary.indexOf("sameFundingAuthorization("),
    );

    const routerStart = fundingEnd;
    const routerEnd = historySource.indexOf("return (", routerStart);
    const routerBoundary = historySource.slice(routerStart, routerEnd);
    expect(routerBoundary.indexOf("sameRouterReview(")).toBeGreaterThan(-1);
    expect(routerBoundary.indexOf("sendCustomLaunchWalletAction(action)")).toBeGreaterThan(
      routerBoundary.indexOf("sameRouterReview("),
    );
  });

  it("never lets a stale list regress a single-resource launch status", () => {
    const submitted = launch(
      "request-a",
      "submitted",
      "2026-08-25T10:03:00.000Z",
    );
    const staleAuthorized = launch(
      "request-a",
      "authorized",
      "2026-08-25T10:04:00.000Z",
    );
    const finalized = launch(
      "request-b",
      "finalized",
      "2026-08-25T10:05:00.000Z",
    );
    const olderSubmitted = launch(
      "request-b",
      "submitted",
      "2026-08-25T10:04:00.000Z",
    );

    expect(selectMonotonicLaunchResource(
      submitted,
      staleAuthorized,
    )).toBe(submitted);
    expect(selectMonotonicLaunchResource(
      staleAuthorized,
      submitted,
    )).toBe(submitted);
    expect(selectMonotonicLaunchResource(
      finalized,
      olderSubmitted,
    )).toBe(finalized);

    const merged = mergeLaunchResources(
      [submitted, finalized],
      [staleAuthorized],
      true,
    );
    expect(merged).toEqual([submitted, finalized]);
  });

  it("advances V2 through simulation without colliding with a V1 UUID", () => {
    const v1 = launch(
      "shared-request",
      "prepared",
      "2026-08-25T10:01:00.000Z",
    );
    const simulating = {
      ...v1,
      schemaVersion: "programmable.custom-launch.v2" as const,
      routeId: "custom-launch:create:v2" as const,
      status: "simulating" as const,
      launchProfileHash: `sha256:${"11".repeat(32)}` as const,
      launchIntentHash: `sha256:${"22".repeat(32)}` as const,
    };
    const authorized = {
      ...simulating,
      status: "authorized" as const,
      updatedAt: "2026-08-25T10:02:00.000Z",
    };

    expect(selectMonotonicLaunchResource(simulating, authorized))
      .toBe(authorized);
    expect(mergeLaunchResources([v1], [simulating], false))
      .toEqual([v1, simulating]);
  });

  it("rechecks the Custom launch action at the final wallet boundary", () => {
    const start = walletProviderSource.indexOf(
      "const sendCustomLaunchWalletAction = useCallback",
    );
    const end = walletProviderSource.indexOf(
      "const readTradeBalances = useCallback",
      start,
    );
    const boundary = walletProviderSource.slice(start, end);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(boundary.indexOf("assertCustomLaunchWalletActionV1(")).toBeGreaterThan(-1);
    expect(boundary.indexOf("sendBrowserWalletAction(checked)")).toBeGreaterThan(
      boundary.indexOf("assertCustomLaunchWalletActionV1("),
    );
  });
});
