import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readCore: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("../lib/alchemy/router-custom-public.server", () => ({
  readFinalizedRouterCustomIdentitySnapshotCoreV1: mocks.readCore,
  ROUTER_CUSTOM_SNAPSHOT_MAX_IDENTITIES: 10_000,
  ROUTER_CUSTOM_SNAPSHOT_MAXIMUM_BYTES: 16 * 1_024 * 1_024,
}));

import { GET } from
  "../app/api/indexers/v1/router-custom-identities/route";

const snapshot = Object.freeze({
  schemaVersion: "programmable.router-custom-identity-snapshot.v1",
  source: "canonical-launch-stamp-router",
  status: "current",
  generatedAt: "2026-08-25T16:20:39.656Z",
  asOfBlock: "25833303",
  asOfBlockHash: `0x${"8a".repeat(32)}`,
  finalityConfirmations: 12,
  identityCommitment: `sha256:${"c2".repeat(32)}`,
  entries: Object.freeze([
    Object.freeze({
      id: `0x${"6d".repeat(32)}`,
      tokenAddress: "0x1111111111111111111111111111111111111111",
    }),
  ]),
});

describe("Router Custom identity snapshot route", () => {
  beforeEach(() => {
    mocks.readCore.mockReset();
    mocks.readCore.mockResolvedValue(snapshot);
  });

  it("returns the unwrapped core snapshot with public cache metadata", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=0, s-maxage=15, stale-while-revalidate=45",
    );
    expect(response.headers.get("x-programmable-status")).toBe("current");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(await response.json()).toEqual(snapshot);
    expect(mocks.readCore).toHaveBeenCalledTimes(1);
  });

  it("does not add optional fee-policy enrichment to committed entries", async () => {
    const response = await GET();
    const body = await response.json();

    expect(body.entries).toEqual(snapshot.entries);
    expect(body.entries[0]).not.toHaveProperty("platformFeePolicy");
    expect(body.entries[0]).not.toHaveProperty("feePolicyEvidence");
  });

  it("fails closed without exposing reader internals", async () => {
    mocks.readCore.mockRejectedValueOnce(
      new Error("secret provider detail must not escape"),
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await GET();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("retry-after")).toBe("5");
    expect(await response.json()).toEqual({
      error: "Router Custom identities are temporarily unavailable",
    });
    expect(errorSpy).toHaveBeenCalledWith(
      "Router Custom public snapshot unavailable",
      { name: "RouterCustomSnapshotReadError" },
    );
    errorSpy.mockRestore();
  });

  it("rejects a serialized snapshot larger than the 16 MiB bound", async () => {
    mocks.readCore.mockResolvedValueOnce({
      ...snapshot,
      entries: [{ ...snapshot.entries[0], padding: "x".repeat(16 * 1_024 * 1_024) }],
    });

    const response = await GET();

    expect(response.status).toBe(503);
    expect(response.headers.get("x-programmable-status")).toBeNull();
    expect(response.headers.get("retry-after")).toBe("5");
  });

  it("rejects more than 10,000 identities", async () => {
    mocks.readCore.mockResolvedValueOnce({
      ...snapshot,
      entries: Array.from({ length: 10_001 }, () => snapshot.entries[0]),
    });

    const response = await GET();

    expect(response.status).toBe(503);
    expect(response.headers.get("x-programmable-status")).toBeNull();
  });
});
