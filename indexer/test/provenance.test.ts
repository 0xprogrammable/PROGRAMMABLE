import type { EvmEvent } from "envio";
import { describe, expect, it } from "vitest";

import { eventProvenance } from "../src/lib/provenance.js";

const HASH_A = `0x${"11".repeat(32)}`;
const HASH_B = `0x${"22".repeat(32)}`;
const ADDRESS = `0x${"33".repeat(20)}`;

function eventWithPlacement(
  transactionIndex: number,
  logIndex: number,
): EvmEvent {
  return {
    chainId: 1,
    block: {
      number: 1n,
      hash: HASH_A,
      timestamp: 2n,
    },
    transaction: {
      hash: HASH_B,
      transactionIndex,
    },
    logIndex,
    srcAddress: ADDRESS,
  } as unknown as EvmEvent;
}

describe("event provenance placement", () => {
  it("stores the complete uint32 placement as exact bigint values", () => {
    expect(
      eventProvenance(eventWithPlacement(0xffff_ffff, 0xffff_ffff)),
    ).toMatchObject({
      transactionIndex: 4_294_967_295n,
      blockGlobalLogIndex: 4_294_967_295n,
    });
  });

  it.each([
    [0x1_0000_0000, 0],
    [0, 0x1_0000_0000],
  ])("rejects placement outside uint32", (transactionIndex, logIndex) => {
    expect(() =>
      eventProvenance(eventWithPlacement(transactionIndex, logIndex)),
    ).toThrow(/unsigned 32-bit integer/i);
  });
});
