import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { isRobinhoodUnavailableRoute } from "../components/view-chain-unavailable";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("Robinhood view-chain scope gate", () => {
  it("gates only Ethereum-bound product data routes", () => {
    expect(isRobinhoodUnavailableRoute("/profile")).toBe(true);
    expect(isRobinhoodUnavailableRoute("/profile/settings")).toBe(true);
    expect(isRobinhoodUnavailableRoute("/launch")).toBe(true);
    expect(isRobinhoodUnavailableRoute("/launch/history")).toBe(true);
    expect(isRobinhoodUnavailableRoute("/token/0x1234")).toBe(true);

    expect(isRobinhoodUnavailableRoute("/explore")).toBe(false);
    expect(isRobinhoodUnavailableRoute("/docs")).toBe(false);
    expect(isRobinhoodUnavailableRoute("/developers")).toBe(false);
    expect(isRobinhoodUnavailableRoute("/")).toBe(false);
    expect(isRobinhoodUnavailableRoute("/tokens")).toBe(false);
  });

  it("switches only the view preference and leaves wallet state untouched", () => {
    const component = read("components/view-chain-unavailable.tsx");
    const transition = read("components/route-transition.tsx");
    const navigation = read("components/site-navigation.tsx");
    const styles = read("components/view-chain-unavailable.module.css");

    expect(transition).toContain("viewChainId === 4663");
    expect(transition).toContain("isRobinhoodUnavailableRoute(pathname)");
    expect(transition).toMatch(/showChainPending\s*\? "pending"/);
    expect(transition).toContain("<ViewChainPending />");
    expect(transition).toContain(
      "const resolvedInitialChain = !previousHydrated.current && hydrated",
    );
    expect(transition).toContain(
      "previousFocusContext.current = focusContext",
    );
    expect(component).toContain("setViewChainId(1)");
    expect(component).toContain("Ethereum remains live");
    expect(component).toContain("Your connected wallet stays connected");
    expect(component).not.toMatch(/useWallet|switchChain|switchNetwork|disconnect/);
    expect(navigation).toContain(
      "if (isRobinhoodUnavailableRoute(pathname)) return;",
    );
    expect(styles).toMatch(/\.action\s*\{[^}]*min-height:\s*44px;/s);
    expect(styles).toMatch(/\.action:focus-visible\s*\{/);
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
  });
});
