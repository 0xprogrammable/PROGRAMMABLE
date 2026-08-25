import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

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

describe("developer API key interface", () => {
  it("keeps the first view compact and focused on key management", () => {
    expect(apiKeysSource).toContain("<h1>API keys</h1>");
    expect(apiKeysSource).toContain('aria-label="Developer access view"');
    expect(apiKeysSource).toContain('aria-pressed={activeSection === "keys"}');
    expect(apiKeysSource).toContain('aria-pressed={activeSection === "history"}');
    expect(apiKeysSource).toContain('activeSection === "keys" ?');
    expect(apiKeysSource).not.toContain("launchPath");
    expect(apiKeysSource).not.toContain("Fee claims and automated buybacks");

    expect(apiKeysStyles).toMatch(
      /\.workspace\s*\{[^}]*align-items:\s*stretch;/su,
    );
    expect(apiKeysStyles).toMatch(
      /\.workspace\s*\{[^}]*grid-template-columns:\s*repeat\(2,/su,
    );
    expect(apiKeysStyles).toContain("height: clamp(");
    expect(apiKeysStyles).toContain("--api-panel: var(--webde-surface)");
    expect(apiKeysStyles).toContain("--api-line: var(--webde-line)");
    expect(apiKeysStyles).not.toContain("liquid-glass");
    expect(apiKeysStyles).toMatch(
      /@media \(max-width: 760px\)[\s\S]*?\.workspace\s*\{[^}]*height:\s*auto;/u,
    );
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
    expect(apiKeysSource).toContain("8_000");
    expect(apiKeysStyles).toContain("@media (prefers-reduced-motion: reduce)");
    expect(apiKeysStyles).toContain("min-height: 44px");
  });
});

describe("developer launch history interface", () => {
  it("stays behind the compact view switch and keeps the signing boundary clear", () => {
    expect(historySource).toContain("Launch history");
    expect(historySource).toContain(
      "A launch is onchain only after the\n        wallet signs and broadcasts it.",
    );
    expect(historySource).toContain("Check onchain status");
    expect(historySource).toContain("Review and sign in wallet");
    expect(historySource).toContain("sendCustomLaunchWalletAction(action)");
    expect(historySource).toContain("startStatusPolling(launch.requestId)");
    expect(historySource).not.toContain("Your agent&apos;s first accepted request");
    expect(historyStyles).toContain("height: clamp(");
    expect(historyStyles).toContain("background: var(--webde-surface)");
    expect(historyStyles).toContain("background: var(--webde-surface-raised)");
    expect(historyStyles).not.toContain("liquid-glass");
    expect(historyStyles).toMatch(
      /\.launchList\s*\{[^}]*overflow-y:\s*auto;/su,
    );
    expect(historyStyles).toMatch(
      /@media \(max-width: 600px\)[\s\S]*?\.history\s*\{[^}]*height:\s*auto;/u,
    );
  });

  it("announces loading and refreshed status without changing wallet authority", () => {
    expect(historySource).toContain("Loading launch history");
    expect(historySource).toContain("Launch status updated.");
    expect(historySource).toContain('aria-live="polite"');
    expect(historySource).toContain('disabled={state === "loading" || loadingMore}');
    expect(historySource).toContain("Prepared transaction");
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
