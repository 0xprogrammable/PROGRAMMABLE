import { describe, expect, it } from "vitest";

import { findIndexedLaunch } from "../components/launch-builder";

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
});
