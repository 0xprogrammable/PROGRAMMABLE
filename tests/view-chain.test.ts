import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_VIEW_CHAIN_ID,
  VIEW_CHAIN_COOKIE_NAME,
  VIEW_CHAIN_STORAGE_KEY,
  isViewChainId,
  parseViewChainId,
  serializeViewChainCookie,
  tryParseViewChainId,
} from "../lib/view-chain";
import { resolveExploreChainId } from "../lib/explore-chain";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("view chain", () => {
  it("accepts only Ethereum and Robinhood and fails invalid state to Ethereum", () => {
    expect(DEFAULT_VIEW_CHAIN_ID).toBe(1);
    expect(isViewChainId(1)).toBe(true);
    expect(isViewChainId(4663)).toBe(true);
    expect(isViewChainId("4663")).toBe(false);
    expect(tryParseViewChainId("1")).toBe(1);
    expect(tryParseViewChainId("4663")).toBe(4663);
    expect(tryParseViewChainId("8453")).toBeNull();
    expect(tryParseViewChainId("11155111")).toBeNull();
    expect(parseViewChainId(null)).toBe(1);
    expect(parseViewChainId("invalid")).toBe(1);
  });

  it("serializes a long-lived, site-wide preference cookie", () => {
    expect(VIEW_CHAIN_COOKIE_NAME).toBe("programmable-view-chain");
    expect(VIEW_CHAIN_STORAGE_KEY).toBe("programmable:view-chain:v1");
    expect(serializeViewChainCookie(4663)).toContain(
      "programmable-view-chain=4663",
    );
    expect(serializeViewChainCookie(4663)).toContain("Path=/");
    expect(serializeViewChainCookie(4663)).toContain("SameSite=Lax");
  });

  it("normalizes unavailable Explore preferences to Ethereum", () => {
    expect(resolveExploreChainId(1)).toBe(1);
    expect(resolveExploreChainId(4663)).toBe(1);
    expect(resolveExploreChainId(8453)).toBe(1);
    expect(resolveExploreChainId("invalid")).toBe(1);
  });

  it("resolves the server cookie only inside chain-bound product routes", () => {
    const provider = read("components/view-chain.tsx");
    const shell = read("components/app-shell.tsx");
    const layout = read("app/layout.tsx");
    const resolvedLayout = read("components/resolved-view-chain-layout.tsx");
    const routeBoundary = read("components/view-chain-route-boundary.tsx");

    expect(provider).toContain("window.localStorage.getItem");
    expect(provider).toContain(
      "readViewChainCookie() ?? readStoredViewChain() ?? initialViewChainId",
    );
    expect(provider).toContain("window.addEventListener(\"storage\"");
    expect(provider).toContain("document.cookie = serializeViewChainCookie");
    expect(provider).not.toContain("useWallet");
    expect(provider).not.toContain("switchNetwork");
    expect(provider).not.toContain("disconnect");
    expect(shell.indexOf("<ViewChainProvider")).toBeLessThan(
      shell.indexOf("<WalletProvider>"),
    );
    expect(provider).toContain(
      "const resolvedViewChainId = useSyncExternalStore(",
    );
    expect(provider).toContain(
      "const getServerSnapshot = useCallback((): ViewChainId | null => null",
    );
    expect(provider).toContain(
      "const hydrated = resolvedViewChainId !== null",
    );
    expect(provider).toContain("persistViewChain(viewChainId)");
    expect(layout).not.toContain('from "next/headers"');
    expect(layout).not.toContain("cookies()");
    expect(resolvedLayout).toContain('import { cookies } from "next/headers"');
    expect(resolvedLayout).toContain("const requestCookies = await cookies()");
    expect(resolvedLayout).toContain(
      "requestCookies.get(VIEW_CHAIN_COOKIE_NAME)?.value",
    );
    expect(routeBoundary).toContain(
      "const resolvedViewChainId = hydrated ? viewChainId : initialViewChainId",
    );
    expect(routeBoundary).toContain("initialViewChainId === null");
    expect(routeBoundary).toContain("<ViewChainPending />");
    expect(routeBoundary).toContain("resolvedViewChainId === 4663");
    for (const routeLayout of [
      "app/profile/layout.tsx",
      "app/launch/layout.tsx",
    ]) {
      expect(read(routeLayout)).toContain(
        "ResolvedViewChainLayout as default",
      );
    }
    expect(existsSync("app/token/layout.tsx")).toBe(false);
  });

  it("scopes the truthful chain selector to Explore instead of the header", () => {
    const navigation = read("components/site-navigation.tsx");
    const explore = read("components/explore-view.tsx");
    const selector = read("components/explore-chain-selector.tsx");
    const styles = read("components/explore-chain-selector.module.css");

    expect(navigation).not.toContain("HeaderChainToggle");
    expect(navigation).not.toContain("switchNetwork");
    expect(explore).toContain("<ExploreChainSelector />");
    expect(selector).toContain('aria-haspopup="listbox"');
    expect(selector).toContain('role="listbox"');
    expect(selector).toContain('role="option"');
    expect(selector).toContain('label: "Ethereum"');
    expect(selector).toContain('label: "Robinhood"');
    expect(selector).toContain('label: "Base"');
    expect(selector.match(/available: false/gu)).toHaveLength(2);
    expect(selector).toContain("setViewChainId(option.viewChainId)");
    expect(selector).not.toContain("useWallet");
    expect(selector).not.toContain("switchNetwork");
    expect(styles).toContain("/brand/networks/robinhood-feather-white.svg");
    expect(styles).toMatch(/\.trigger\s*\{[^}]*min-height:\s*44px;/s);
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
  });
});
