import { describe, expect, it } from "vitest";

import {
  candidateOccurrenceId,
  downstreamLogicalEventId,
} from "../src/lib/ids.js";

describe("candidateOccurrenceId", () => {
  it("uses the fork placement and block-global log index", () => {
    expect(
      candidateOccurrenceId(
        {
          chainId: 1,
          blockHash:
            "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
          transactionHash:
            "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
          blockGlobalLogIndex: 17,
        },
      ),
    ).toBe(
      "1:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb:17",
    );
  });

  it("creates another candidate when the same transaction is re-mined", () => {
    const first = candidateOccurrenceId({
      chainId: 1,
      blockHash: `0x${"11".repeat(32)}`,
      transactionHash: `0x${"22".repeat(32)}`,
      blockGlobalLogIndex: 9,
    });
    const reMined = candidateOccurrenceId({
      chainId: 1,
      blockHash: `0x${"33".repeat(32)}`,
      transactionHash: `0x${"22".repeat(32)}`,
      blockGlobalLogIndex: 4,
    });

    expect(reMined).not.toBe(first);
  });

  it("rejects malformed hashes and invalid block-global indexes", () => {
    expect(() =>
      candidateOccurrenceId({
        chainId: 1,
        blockHash: "0x1234",
        transactionHash: `0x${"22".repeat(32)}`,
        blockGlobalLogIndex: 0,
      }),
    ).toThrow(/block hash/i);
    expect(() =>
      candidateOccurrenceId({
        chainId: 1,
        blockHash: `0x${"11".repeat(32)}`,
        transactionHash: `0x${"22".repeat(32)}`,
        blockGlobalLogIndex: -1,
      }),
    ).toThrow(/log index/i);
  });
});

describe("downstreamLogicalEventId", () => {
  it("depends on a verified receipt-local ordinal rather than block placement", () => {
    const transactionHash = `0x${"44".repeat(32)}`;

    expect(
      downstreamLogicalEventId({
        chainId: 1,
        transactionHash,
        receiptLogOrdinal: 3,
      }),
    ).toBe(
      `1:${transactionHash}:3`,
    );
  });

  it("requires the downstream worker to supply a receipt-local ordinal", () => {
    expect(() =>
      downstreamLogicalEventId({
        chainId: 1,
        transactionHash: `0x${"44".repeat(32)}`,
        receiptLogOrdinal: undefined as unknown as number,
      }),
    ).toThrow(/receipt-local ordinal/i);
  });
});
