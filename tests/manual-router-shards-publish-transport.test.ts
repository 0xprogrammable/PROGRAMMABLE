import { readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  SHARDS_MANUAL_ROUTER_ALCHEMY_API_KEY_COMMITMENT_V1,
  SHARDS_MANUAL_ROUTER_ALCHEMY_ENDPOINT_V1,
  SHARDS_MANUAL_ROUTER_COMPILE_INPUT_HASH_V1,
  createShardsManualRouterAlchemyBearerFetchForBindingV1,
  createShardsManualRouterAlchemyBearerFetchV1,
  createShardsManualRouterPublishFetchV1,
  isExactShardsManualRouterPublishRequestV1,
  shardsManualRouterAlchemyApiKeyCommitmentV1,
} from "../lib/server/custom-launch/manual-router-shards-publish-transport-v1";

const QUICKNODE =
  "https://programmable.ethereum.quiknode.pro/exact-shards-test-key/";
const ALCHEMY = "https://eth-mainnet.g.alchemy.com/v2/test-key";

describe("Shards manual Router publish transport", () => {
  it("injects one committed Bearer key only on the fixed Alchemy endpoint", async () => {
    const key = "alcht_synthetic_access_key_for_focused_test";
    const commitment = shardsManualRouterAlchemyApiKeyCommitmentV1(key);
    const delegate = vi.fn<typeof fetch>(async (input) => {
      const request = new Request(input);
      expect(request.url).toBe(SHARDS_MANUAL_ROUTER_ALCHEMY_ENDPOINT_V1);
      expect(request.headers.get("authorization")).toBe(`Bearer ${key}`);
      expect(request.headers.get("content-type")).toBe("application/json");
      return new Response(null, { status: 200 });
    });
    const transport = createShardsManualRouterAlchemyBearerFetchForBindingV1({
      fetch: delegate,
      apiKey: key,
      apiKeyCommitment: commitment,
      expectedApiKeyCommitment: commitment,
    });

    await expect(transport(SHARDS_MANUAL_ROUTER_ALCHEMY_ENDPOINT_V1, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    })).resolves.toMatchObject({ status: 200 });
    expect(delegate).toHaveBeenCalledTimes(1);
  });

  it("fails closed on key drift without leaking key bytes", () => {
    const key = "alcht_synthetic_access_key_that_must_not_leak";
    let observed: unknown;
    try {
      createShardsManualRouterAlchemyBearerFetchV1({
        fetch,
        apiKey: key,
        apiKeyCommitment:
          shardsManualRouterAlchemyApiKeyCommitmentV1(key),
      });
    } catch (error) {
      observed = error;
    }
    expect(observed).toBeInstanceOf(TypeError);
    expect(String(observed)).not.toContain(key);
    expect(SHARDS_MANUAL_ROUTER_ALCHEMY_API_KEY_COMMITMENT_V1)
      .toBe("sha256:5419a7a33826708ccae3c7e29aca5e6bab25e6bc5e52a14c22141c4d0cc7ec87");
  });

  it("rejects a committed key outside the audited alcht_ family", () => {
    const key = "not_alcht_but_otherwise_well_formed_key";
    const commitment = shardsManualRouterAlchemyApiKeyCommitmentV1(key);
    expect(() => createShardsManualRouterAlchemyBearerFetchForBindingV1({
      fetch,
      apiKey: key,
      apiKeyCommitment: commitment,
      expectedApiKeyCommitment: commitment,
    })).toThrow("access key is invalid");
  });

  it("does not retry Alchemy 401 or alter nonexact provider traffic", async () => {
    const key = "alcht_synthetic_access_key_for_pass_through";
    const commitment = shardsManualRouterAlchemyApiKeyCommitmentV1(key);
    const delegate = vi.fn<typeof fetch>(async () =>
      new Response(null, { status: 401 }));
    const transport = createShardsManualRouterAlchemyBearerFetchForBindingV1({
      fetch: delegate,
      apiKey: key,
      apiKeyCommitment: commitment,
      expectedApiKeyCommitment: commitment,
    });

    await expect(transport(SHARDS_MANUAL_ROUTER_ALCHEMY_ENDPOINT_V1))
      .resolves.toMatchObject({ status: 401 });
    const request = new Request(ALCHEMY, { method: "POST", body: "{}" });
    const init = { headers: { "x-pass-through": "exact" } };
    await expect(transport(request, init)).resolves.toMatchObject({ status: 401 });
    expect(delegate).toHaveBeenCalledTimes(2);
    expect(delegate).toHaveBeenLastCalledWith(request, init);
  });

  it("rejects caller-supplied authorization on the exact endpoint", () => {
    const key = "alcht_synthetic_access_key_for_ambiguity";
    const commitment = shardsManualRouterAlchemyApiKeyCommitmentV1(key);
    const delegate = vi.fn<typeof fetch>();
    const transport = createShardsManualRouterAlchemyBearerFetchForBindingV1({
      fetch: delegate,
      apiKey: key,
      apiKeyCommitment: commitment,
      expectedApiKeyCommitment: commitment,
    });

    expect(() => transport(SHARDS_MANUAL_ROUTER_ALCHEMY_ENDPOINT_V1, {
      headers: { authorization: "Bearer competing" },
    })).toThrow("authorization is ambiguous");
    expect(delegate).not.toHaveBeenCalled();
  });

  it("composes exact Alchemy Bearer auth with QuickNode FIFO/429 handling", async () => {
    const key = "alcht_synthetic_combined_transport_key";
    const commitment = shardsManualRouterAlchemyApiKeyCommitmentV1(key);
    let now = 50_000;
    const waits: number[] = [];
    let quickNodeAttempts = 0;
    const delegate = vi.fn<typeof fetch>(async (input) => {
      const request = new Request(input);
      if (request.url === QUICKNODE) {
        quickNodeAttempts += 1;
        expect(request.headers.has("authorization")).toBe(false);
        return new Response(null, {
          status: quickNodeAttempts === 1 ? 429 : 200,
        });
      }
      if (request.url === SHARDS_MANUAL_ROUTER_ALCHEMY_ENDPOINT_V1) {
        expect(request.headers.get("authorization")).toBe(`Bearer ${key}`);
        return new Response(null, { status: 200 });
      }
      expect(request.headers.has("authorization")).toBe(false);
      return new Response(null, { status: 401 });
    });
    const quickNode = createShardsManualRouterPublishFetchV1({
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
    const combined = createShardsManualRouterAlchemyBearerFetchForBindingV1({
      fetch: quickNode,
      apiKey: key,
      apiKeyCommitment: commitment,
      expectedApiKeyCommitment: commitment,
    });

    await expect(combined(SHARDS_MANUAL_ROUTER_ALCHEMY_ENDPOINT_V1))
      .resolves.toMatchObject({ status: 200 });
    await expect(combined(QUICKNODE)).resolves.toMatchObject({ status: 200 });
    await expect(combined(`${SHARDS_MANUAL_ROUTER_ALCHEMY_ENDPOINT_V1}/lookalike`))
      .resolves.toMatchObject({ status: 401 });
    expect(quickNodeAttempts).toBe(2);
    expect(waits).toEqual([1_000]);
  });

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
