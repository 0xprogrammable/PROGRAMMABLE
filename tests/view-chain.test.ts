import { readFileSync } from "node:fs";
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

  it("keeps view persistence outside the wallet provider without making the root layout dynamic", () => {
    const provider = read("components/view-chain.tsx");
    const shell = read("components/app-shell.tsx");
    const layout = read("app/layout.tsx");

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
    expect(provider).toContain(
      "const viewChainId = resolvedViewChainId ?? initialViewChainId",
    );
    expect(provider).toContain("persistViewChain(viewChainId)");
    expect(layout).not.toContain('from "next/headers"');
    expect(layout).not.toContain("cookies()");
  });

  it("renders one alternate-chain option before the hamburger as an accessible disclosure", () => {
    const navigation = read("components/site-navigation.tsx");
    const styles = read("components/site-navigation.module.css");

    expect(navigation.indexOf("<HeaderChainSelector")).toBeLessThan(
      navigation.indexOf("ref={menuButtonRef}"),
    );
    expect(navigation).toContain("viewChainId === 1 ? 4663 : 1");
    expect(navigation).toContain("Public index coming soon");
    expect(navigation).toContain("aria-controls={panelId}");
    expect(navigation).toContain("aria-expanded={open}");
    expect(navigation).toContain('role="group"');
    expect(navigation).not.toContain('role="menu"');
    expect(navigation).toContain("inert={open ? undefined : true}");
    expect(navigation).toContain('if (event.key !== "Escape") return;');
    expect(navigation).toContain("chainButtonRef.current?.focus()");
    expect(navigation).toContain("!chainSelectorRef.current?.contains");
    expect(navigation).not.toContain("setViewChainId(alternateViewChainId);\n              disconnect");
    expect(styles).toMatch(
      /\.chainTrigger\s*\{[^}]*height:\s*48px;[^}]*width:\s*48px;/s,
    );
    expect(styles).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.chainPopover,/,
    );
  });
});
