import { describe, expect, it } from "vitest";

import { shouldReplaceDurableSnapshot } from "../lib/onchain/durable-model";

describe("durable onchain snapshot replacement", () => {
  const current = {
    blockNumber: "100",
    blockHash: `0x${"11".repeat(32)}` as `0x${string}`,
  };

  it("advances and replaces a same-height reorg, but never rolls back", () => {
    expect(
      shouldReplaceDurableSnapshot(current, {
        blockNumber: "101",
        blockHash: `0x${"22".repeat(32)}`,
      }),
    ).toBe(true);
    expect(
      shouldReplaceDurableSnapshot(current, {
        blockNumber: "100",
        blockHash: `0x${"22".repeat(32)}`,
      }),
    ).toBe(true);
    expect(shouldReplaceDurableSnapshot(current, current)).toBe(false);
    expect(
      shouldReplaceDurableSnapshot(current, {
        blockNumber: "99",
        blockHash: `0x${"33".repeat(32)}`,
      }),
    ).toBe(false);
  });
});
