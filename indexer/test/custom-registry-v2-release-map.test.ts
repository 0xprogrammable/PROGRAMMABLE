import { describe, expect, it } from "vitest";

import {
  CUSTOM_REGISTRY_V2_PRELAUNCH_SOURCE,
  requireLiveCustomRegistryV2Source,
} from "../src/lib/custom-registry-v2-release-map.js";

describe("Custom Registry V2 prelaunch source binding", () => {
  it("does not invent a deployment source or legacy release identity", () => {
    expect(CUSTOM_REGISTRY_V2_PRELAUNCH_SOURCE).toEqual({
      contractName: "CustomRegistryV2",
      generation: "2",
      status: "prelaunch",
      active: false,
      address: null,
      startBlock: null,
      runtimeCodeKeccak256: null,
    });
    expect(() => requireLiveCustomRegistryV2Source(
      CUSTOM_REGISTRY_V2_PRELAUNCH_SOURCE,
    )).toThrow(/not live-bound/u);
  });

  it("accepts only a fully populated generation 2 live source", () => {
    expect(requireLiveCustomRegistryV2Source({
      ...CUSTOM_REGISTRY_V2_PRELAUNCH_SOURCE,
      status: "live",
      active: true,
      address: `0x${"11".repeat(20)}`,
      startBlock: 25_700_000,
      runtimeCodeKeccak256: `0x${"22".repeat(32)}`,
    })).toMatchObject({
      contractName: "CustomRegistryV2",
      startBlock: 25_700_000,
    });
    for (const [address, runtimeCodeKeccak256] of [
      [`0x${"00".repeat(20)}`, `0x${"22".repeat(32)}`],
      [`0x${"11".repeat(20)}`, `0x${"00".repeat(32)}`],
    ] as const) {
      expect(() => requireLiveCustomRegistryV2Source({
        ...CUSTOM_REGISTRY_V2_PRELAUNCH_SOURCE,
        status: "live",
        active: true,
        address,
        startBlock: 25_700_000,
        runtimeCodeKeccak256,
      })).toThrow(/not live-bound/u);
    }
  });
});
