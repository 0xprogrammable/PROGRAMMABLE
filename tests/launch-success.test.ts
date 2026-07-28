import { describe, expect, it } from "vitest";

import {
  findClassicV3IndexedLaunch,
  findIndexedLaunch,
} from "../components/launch-builder";

const transactionHash = `0x${"12".repeat(32)}`;
const tokenAddress = "0x1111111111111111111111111111111111111111";

describe("launch success indexing", () => {
  it("finds the token created by the submitted transaction", () => {
    expect(
      findIndexedLaunch(
        {
          tokens: [
            {
              launchTransactionHash: transactionHash,
              tokenAddress,
              name: "Test",
              symbol: "TEST",
              href: `/token/${tokenAddress}`,
            },
          ],
        },
        transactionHash.toUpperCase(),
      ),
    ).toEqual({
      address: tokenAddress,
      href: `/token/${tokenAddress}`,
      name: "Test",
      symbol: "TEST",
    });
  });

  it("ignores unrelated and malformed token records", () => {
    expect(
      findIndexedLaunch(
        {
          tokens: [
            {
              launchTransactionHash: `0x${"34".repeat(32)}`,
              tokenAddress,
              name: "Other",
              symbol: "OTHER",
            },
            {
              launchTransactionHash: transactionHash,
              tokenAddress: "not-an-address",
              name: "Broken",
              symbol: "BAD",
            },
          ],
        },
        transactionHash,
      ),
    ).toBeNull();
  });

  it("finds a confirmed Classic V3 launch without the V2 indexer", () => {
    expect(
      findClassicV3IndexedLaunch({
        status: "ready",
        launch: {
          tokenAddress,
          name: "Directional",
          symbol: "DIR",
          launchTransactionHash: transactionHash,
        },
      }),
    ).toEqual({
      address: tokenAddress,
      href: `/token/${tokenAddress}`,
      name: "Directional",
      symbol: "DIR",
    });
    expect(
      findClassicV3IndexedLaunch({ status: "ready", launch: null }),
    ).toBeNull();
  });
});
