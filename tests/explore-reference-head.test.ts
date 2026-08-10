import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  parseExploreReferenceHead,
  readExploreReferenceHeadWithinRouteBudget,
} from "../lib/explore-reference-head.server";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("Explore freshness reference", () => {
  const response = {
    schemaVersion: "2.0.0",
    status: "ready",
    snapshot: {
      blockNumber: "25726215",
      blockHash: `0x${"ab".repeat(32)}`,
      indexedAt: "2026-08-10T17:55:45.000Z",
      finality: "confirmed",
    },
  };

  it("accepts only a confirmed canonical v2 snapshot", () => {
    expect(parseExploreReferenceHead(response)).toEqual(response.snapshot);
    expect(parseExploreReferenceHead({
      ...response,
      snapshot: { ...response.snapshot, finality: "latest" },
    })).toBeNull();
    expect(parseExploreReferenceHead({
      ...response,
      snapshot: { ...response.snapshot, blockHash: "0x1234" },
    })).toBeNull();
  });

  it("never adds the independent 2.5 second timeout as a route waterfall", async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () => new Promise<Response>(() => undefined),
    );
    const read = readExploreReferenceHeadWithinRouteBudget();

    await vi.advanceTimersByTimeAsync(150);
    await expect(read).resolves.toBeNull();
  });
});
