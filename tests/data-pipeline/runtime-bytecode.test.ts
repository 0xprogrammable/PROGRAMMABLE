import { describe, expect, it, vi } from "vitest";
import { keccak256 } from "viem";

vi.mock("server-only", () => ({}));

import {
  immutableReferencesCommitment,
  normalizeRuntimeBytecode,
  runtimeBytecodeEvidence,
} from "../../lib/data-pipeline/runtime-bytecode";

const REFERENCES = [
  { start: 2, length: 2 },
  { start: 7, length: 1 },
] as const;

describe("constructor-immutable runtime normalization", () => {
  it("retains exact instance hashes while producing one template hash", () => {
    const first = runtimeBytecodeEvidence({
      runtimeBytecode: "0x6001aaaabbccdd11",
      expectedByteLength: 8,
      immutableReferences: REFERENCES,
    });
    const second = runtimeBytecodeEvidence({
      runtimeBytecode: "0x6001ffffbbccdd22",
      expectedByteLength: 8,
      immutableReferences: REFERENCES,
    });

    expect(first.exactRuntimeCodeHash).not.toBe(second.exactRuntimeCodeHash);
    expect(first.normalizedRuntimeCodeHash).toBe(
      second.normalizedRuntimeCodeHash,
    );
    expect(first.immutableReferencesCommitment).toBe(
      second.immutableReferencesCommitment,
    );
    expect(normalizeRuntimeBytecode({
      runtimeBytecode: "0x6001aaaabbccdd11",
      expectedByteLength: 8,
      immutableReferences: REFERENCES,
    })).toBe("0x60010000bbccdd00");
  });

  it("does not hide mutations outside compiler-reviewed ranges", () => {
    const first = runtimeBytecodeEvidence({
      runtimeBytecode: "0x6001aaaabbccdd11",
      expectedByteLength: 8,
      immutableReferences: REFERENCES,
    });
    const mutated = runtimeBytecodeEvidence({
      runtimeBytecode: "0x6001aaaabbccfe11",
      expectedByteLength: 8,
      immutableReferences: REFERENCES,
    });

    expect(mutated.normalizedRuntimeCodeHash).not.toBe(
      first.normalizedRuntimeCodeHash,
    );
  });

  it("commits to ordering, offsets, lengths, and runtime length", () => {
    const baseline = immutableReferencesCommitment(REFERENCES, 8);
    expect(baseline).toMatch(/^0x[0-9a-f]{64}$/u);
    expect(
      immutableReferencesCommitment(
        [
          { start: 2, length: 1 },
          { start: 7, length: 1 },
        ],
        8,
      ),
    ).not.toBe(baseline);
    expect(immutableReferencesCommitment(REFERENCES, 9)).not.toBe(baseline);
  });

  it("derives every field from one immutable input snapshot", () => {
    let runtimeReads = 0;
    let lengthReads = 0;
    let referencesReads = 0;
    let firstStartReads = 0;
    let firstLengthReads = 0;
    const approvedRuntime = "0x6001aaaabbccdd11" as const;
    const input = {
      get runtimeBytecode() {
        runtimeReads += 1;
        return runtimeReads === 1
          ? approvedRuntime
          : ("0x6001aaaabbccfe11" as const);
      },
      get expectedByteLength() {
        lengthReads += 1;
        return lengthReads === 1 ? 8 : 7;
      },
      get immutableReferences() {
        referencesReads += 1;
        return [
          {
            get start() {
              firstStartReads += 1;
              return firstStartReads === 1 ? 2 : 4;
            },
            get length() {
              firstLengthReads += 1;
              return firstLengthReads === 1 ? 2 : 1;
            },
          },
          { start: 7, length: 1 },
        ];
      },
    };

    const evidence = runtimeBytecodeEvidence(input);

    expect(runtimeReads).toBe(1);
    expect(lengthReads).toBe(1);
    expect(referencesReads).toBe(1);
    expect(firstStartReads).toBe(1);
    expect(firstLengthReads).toBe(1);
    expect(evidence.exactRuntimeCodeHash).toBe(
      keccak256(approvedRuntime),
    );
    expect(evidence.normalizedRuntimeCodeHash).toBe(
      keccak256("0x60010000bbccdd00"),
    );
    expect(evidence.runtimeByteLength).toBe(8);
  });

  it("reads each proxied immutable-reference element once", () => {
    let elementReads = 0;
    const references = new Proxy([...REFERENCES], {
      get(target, property, receiver) {
        if (property === "0" || property === "1") elementReads += 1;
        return Reflect.get(target, property, receiver);
      },
    });

    runtimeBytecodeEvidence({
      runtimeBytecode: "0x6001aaaabbccdd11",
      expectedByteLength: 8,
      immutableReferences: references,
    });

    expect(elementReads).toBe(2);
  });

  it("pins the compiler-reviewed Classic and Stock reference maps", () => {
    const classicReferences = [
      362, 510, 664, 884, 1092, 1195, 1941, 2469, 3048, 3601, 3645,
      3910, 4012,
    ].map((start) => ({ start, length: 32 }));
    const stockReferences = [
      286, 404, 479, 610, 712, 751, 1258, 1411, 1462, 1604, 2018, 2059,
      2441,
    ].map((start) => ({ start, length: 32 }));

    expect(immutableReferencesCommitment(classicReferences, 6543)).toBe(
      "0x907697f82d7893c5208d35481bff0be82526809b29f52b3e83a1bcda15be583d",
    );
    expect(immutableReferencesCommitment(stockReferences, 3352)).toBe(
      "0xb7a44c4e10798e9027247e4d5e7ac191d3f7b50b8d81a4746ffbd6a337a42ec0",
    );
    expect(() =>
      immutableReferencesCommitment(
        [classicReferences[1]!, classicReferences[0]!],
        6543,
      ),
    ).toThrowError(expect.objectContaining({ code: "invalid_input" }));
  });

  it("accepts the EIP-170 ceiling and rejects one byte above it", () => {
    expect(() =>
      runtimeBytecodeEvidence({
        runtimeBytecode: `0x${"00".repeat(24_576)}`,
        expectedByteLength: 24_576,
        immutableReferences: [{ start: 0, length: 1 }],
      }),
    ).not.toThrow();
    expect(() =>
      runtimeBytecodeEvidence({
        runtimeBytecode: `0x${"00".repeat(24_577)}`,
        expectedByteLength: 24_577,
        immutableReferences: [{ start: 0, length: 1 }],
      }),
    ).toThrowError(expect.objectContaining({ code: "invalid_input" }));
  });

  it.each([
    {
      runtimeBytecode: "0x",
      expectedByteLength: 0,
      immutableReferences: REFERENCES,
    },
    {
      runtimeBytecode: "0x6001aa",
      expectedByteLength: 4,
      immutableReferences: REFERENCES,
    },
    {
      runtimeBytecode: "0x6001aaaabbccdd11",
      expectedByteLength: 8,
      immutableReferences: [
        { start: 2, length: 3 },
        { start: 4, length: 1 },
      ],
    },
    {
      runtimeBytecode: "0x6001aaaabbccdd11",
      expectedByteLength: 8,
      immutableReferences: [{ start: 7, length: 2 }],
    },
  ])("rejects malformed runtime evidence", (input) => {
    expect(() => runtimeBytecodeEvidence({
      ...input,
      runtimeBytecode: input.runtimeBytecode as `0x${string}`,
    })).toThrowError(
      expect.objectContaining({ code: "invalid_input" }),
    );
  });
});
