import { describe, expect, it } from "vitest";

import { suppressRouterBoundCustomProjectDuplicates } from
  "../lib/alchemy/router-custom-collision";
import type {
  CustomProjectExploreEntry,
  LauncherToken,
} from "../lib/tokens";
import {
  customGraphToken,
  STAMP_POOL_ID,
  STAMP_TOKEN,
} from "./launch-stamp-surface-fixture";

const tokenAddress = STAMP_TOKEN;
const poolId = STAMP_POOL_ID;

function token(stamped = true) {
  if (stamped) return customGraphToken;
  const legacy = { ...customGraphToken } as LauncherToken;
  delete legacy.launchStampProvenance;
  return legacy;
}

function project(boundPoolId: `0x${string}`) {
  return {
    chainId: "1",
    tokenAddress,
    markets: [{ poolId: boundPoolId }],
  } as unknown as CustomProjectExploreEntry;
}

describe("Router and custom-directory collision policy", () => {
  it("lets the canonical Router record win only for the exact token and pool", () => {
    expect(
      suppressRouterBoundCustomProjectDuplicates(
        [token()],
        [project(poolId)],
      ),
    ).toEqual([]);
  });

  it("fails closed when the same token is bound to a different pool", () => {
    expect(() =>
      suppressRouterBoundCustomProjectDuplicates(
        [token()],
        [project(`0x${"34".repeat(32)}`)],
      )
    ).toThrow("disagree on token pool binding");
  });

  it("does not suppress collisions for an unstamped legacy token", () => {
    const candidate = project(poolId);
    expect(
      suppressRouterBoundCustomProjectDuplicates(
        [token(false)],
        [candidate],
      ),
    ).toEqual([candidate]);
  });

  it("does not relabel a Router Classic launch as a custom project", () => {
    const customStamp = customGraphToken.launchStampProvenance;
    const classic = {
      ...customGraphToken,
      launchModel: "classic",
      launchStampProvenance: {
        ...customStamp,
        kind: "classic",
        components: customStamp.components.map((component) =>
          component.kind === "hook"
            ? {
                ...component,
                scope: "shared-infrastructure" as const,
                exclusiveProof: null,
              }
            : component,
        ),
      },
    } satisfies LauncherToken;
    const candidate = project(poolId);
    expect(
      suppressRouterBoundCustomProjectDuplicates([classic], [candidate]),
    ).toEqual([candidate]);
  });
});
