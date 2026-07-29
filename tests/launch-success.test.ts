import { describe, expect, it } from "vitest";

import {
  findClassicV3IndexedLaunch,
  findDeepV3IndexedLaunch,
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

  it("accepts Deep success only from the confirmed V3 provenance response", () => {
    expect(
      findDeepV3IndexedLaunch(
        {
          status: "ready",
          launch: {
            tokenAddress,
            name: "Deep",
            symbol: "DEEP",
            deepReleaseVersion: "deep-full-range-v3",
            deepV3Provenance: {
              deepReleaseVersion: "deep-full-range-v3",
              launchModel: "deep",
              launcher:
                "0x2222222222222222222222222222222222222222",
              creator:
                "0x3333333333333333333333333333333333333333",
              tokenAddress,
              vaultAddress:
                "0x4444444444444444444444444444444444444444",
              hookAddress:
                "0x5555555555555555555555555555555555555555",
              positionRecipient:
                "0x6666666666666666666666666666666666666666",
              positionTokenId: "42",
              poolId: `0x${"66".repeat(32)}`,
              launchHash: `0x${"77".repeat(32)}`,
              vaultConfigurationHash: `0x${"88".repeat(32)}`,
              blockNumber: "123",
              blockHash: `0x${"99".repeat(32)}`,
              transactionHash,
              transactionIndex: 2,
              logIndex: 5,
            },
          },
        },
        transactionHash,
      ),
    ).toEqual({
      address: tokenAddress,
      href: `/token/${tokenAddress}`,
      name: "Deep",
      symbol: "DEEP",
    });

    expect(
      findDeepV3IndexedLaunch(
        {
          status: "ready",
          launch: {
            tokenAddress,
            name: "Deep",
            symbol: "DEEP",
            deepV3Provenance: {
              deepReleaseVersion: "deep-full-range-v3",
              launchModel: "deep",
              launcher:
                "0x2222222222222222222222222222222222222222",
              creator:
                "0x3333333333333333333333333333333333333333",
              tokenAddress,
              vaultAddress:
                "0x4444444444444444444444444444444444444444",
              hookAddress:
                "0x5555555555555555555555555555555555555555",
              positionRecipient:
                "0x6666666666666666666666666666666666666666",
              positionTokenId: "42",
              poolId: `0x${"66".repeat(32)}`,
              launchHash: `0x${"77".repeat(32)}`,
              vaultConfigurationHash: `0x${"88".repeat(32)}`,
              blockNumber: "123",
              blockHash: `0x${"99".repeat(32)}`,
              transactionHash,
              transactionIndex: 2,
              logIndex: 5,
            },
          },
        },
        transactionHash,
      ),
    ).toBeNull();

    expect(
      findDeepV3IndexedLaunch(
        {
          status: "ready",
          launch: {
            tokenAddress,
            name: "Deep",
            symbol: "DEEP",
            launchTransactionHash: transactionHash,
          },
        },
        transactionHash,
      ),
    ).toBeNull();
  });
});
