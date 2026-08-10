import { readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  SHARDS_MANUAL_ROUTER_COMPILE_INPUT_HASH_V1,
  createShardsManualRouterPublishFetchV1,
  isExactShardsManualRouterPublishRequestV1,
} from "../lib/server/custom-launch/manual-router-shards-publish-transport-v1";

const QUICKNODE =
  "https://programmable.ethereum.quiknode.pro/exact-shards-test-key/";
const ALCHEMY = "https://eth-mainnet.g.alchemy.com/v2/test-key";

describe("Shards manual Router publish transport", () => {
  it("pins the signed-artifact route above the serialized provider budget", async () => {
    const route = await readFile(new URL(
      "../app/api/custom-launch/manual/signed-artifacts/route.ts",
      import.meta.url,
    ), "utf8");

    expect(route).toContain("export const maxDuration = 300;");
  });

  it("retries only exact QuickNode HTTP 429 responses with the frozen delays", async () => {
    let now = 10_000;
    const waits: number[] = [];
    const responses = [429, 429, 200];
    const delegate = vi.fn<typeof fetch>(async () =>
      new Response(null, { status: responses.shift() }));
    const transport = createShardsManualRouterPublishFetchV1({
      fetch: delegate,
      quickNodeUrl: QUICKNODE,
      clock: {
        nowMilliseconds: () => now,
        async wait(milliseconds) {
          waits.push(milliseconds);
          now += milliseconds;
        },
      },
    });

    await expect(transport(QUICKNODE, { method: "POST", body: "{}" }))
      .resolves.toMatchObject({ status: 200 });
    expect(delegate).toHaveBeenCalledTimes(3);
    expect(waits).toEqual([1_000, 2_000]);
  });

  it("returns the final QuickNode 429 after the bounded attempts", async () => {
    let now = 20_000;
    const waits: number[] = [];
    const delegate = vi.fn<typeof fetch>(async () =>
      new Response(null, { status: 429 }));
    const transport = createShardsManualRouterPublishFetchV1({
      fetch: delegate,
      quickNodeUrl: QUICKNODE,
      clock: {
        nowMilliseconds: () => now,
        async wait(milliseconds) {
          waits.push(milliseconds);
          now += milliseconds;
        },
      },
    });

    await expect(transport(QUICKNODE)).resolves.toMatchObject({ status: 429 });
    expect(delegate).toHaveBeenCalledTimes(3);
    expect(waits).toEqual([1_000, 2_000]);
  });

  it("does not retry exceptions or non-QuickNode traffic", async () => {
    const failure = new TypeError("transport failed");
    const quickNodeDelegate = vi.fn<typeof fetch>().mockRejectedValue(failure);
    const quickNodeTransport = createShardsManualRouterPublishFetchV1({
      fetch: quickNodeDelegate,
      quickNodeUrl: QUICKNODE,
    });
    await expect(quickNodeTransport(QUICKNODE)).rejects.toBe(failure);
    expect(quickNodeDelegate).toHaveBeenCalledTimes(1);

    const input = new Request(ALCHEMY, { method: "POST", body: "{}" });
    const init = { headers: { "x-test": "unchanged" } };
    const genericDelegate = vi.fn<typeof fetch>(async () =>
      new Response(null, { status: 429 }));
    const genericTransport = createShardsManualRouterPublishFetchV1({
      fetch: genericDelegate,
      quickNodeUrl: QUICKNODE,
    });
    await expect(genericTransport(input, init)).resolves.toMatchObject({
      status: 429,
    });
    const lookalikeQuickNodeUrl = `${QUICKNODE}different-path`;
    await expect(genericTransport(lookalikeQuickNodeUrl)).resolves.toMatchObject({
      status: 429,
    });
    expect(genericDelegate).toHaveBeenCalledTimes(2);
    expect(genericDelegate).toHaveBeenCalledWith(input, init);
    expect(genericDelegate).toHaveBeenCalledWith(
      lookalikeQuickNodeUrl,
      undefined,
    );
  });

  it("serializes exact QuickNode traffic with a one-second start gap", async () => {
    let now = 30_000;
    let active = 0;
    let maximumActive = 0;
    let releaseFirst: (() => void) | undefined;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let call = 0;
    const delegate = vi.fn<typeof fetch>(async () => {
      call += 1;
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      if (call === 1) await firstBlocked;
      active -= 1;
      return new Response(null, { status: 200 });
    });
    const waits: number[] = [];
    const transport = createShardsManualRouterPublishFetchV1({
      fetch: delegate,
      quickNodeUrl: QUICKNODE,
      clock: {
        nowMilliseconds: () => now,
        async wait(milliseconds) {
          waits.push(milliseconds);
          now += milliseconds;
        },
      },
    });

    const first = transport(QUICKNODE);
    await vi.waitFor(() => expect(delegate).toHaveBeenCalledTimes(1));
    const second = transport(QUICKNODE);
    await Promise.resolve();
    expect(delegate).toHaveBeenCalledTimes(1);
    releaseFirst?.();
    await Promise.all([first, second]);

    expect(maximumActive).toBe(1);
    expect(delegate).toHaveBeenCalledTimes(2);
    expect(waits).toEqual([1_000]);
  });

  it("selects the transport only from the verified exact Shards hash", () => {
    expect(isExactShardsManualRouterPublishRequestV1({
      signedArtifact: { prepared: {
        compileInputHash: SHARDS_MANUAL_ROUTER_COMPILE_INPUT_HASH_V1,
      } },
    })).toBe(true);
    expect(isExactShardsManualRouterPublishRequestV1({
      signedArtifact: { prepared: {
        compileInputHash: `sha256:${"0".repeat(64)}`,
      } },
    })).toBe(false);
  });
});
