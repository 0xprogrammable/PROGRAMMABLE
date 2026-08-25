import assert from "node:assert/strict";
import test from "node:test";

import {
  assertDeployableRuntimeCode,
  assertNoDelegatingRuntimeOpcodes,
  materializeRuntimeCode,
  normalizeRuntimeMaterialization,
} from "../src/runtime-immutables.mjs";

const ZERO_RUNTIME = `0x${"00".repeat(96)}`;

test("runtime code obeys the EIP-170 deployed-size boundary", () => {
  assert.equal(assertDeployableRuntimeCode(`0x${"00".repeat(24_576)}`, "maximum"), 24_576);
  assert.throws(
    () => assertDeployableRuntimeCode(`0x${"00".repeat(24_577)}`, "oversized"),
    /EIP_170_RUNTIME_CODE_SIZE_EXCEEDED.*24577 bytes.*24576/,
  );
});

test("runtime materialization fills every exact compiler range after target resolution", () => {
  const plan = normalizeRuntimeMaterialization({
    runtimeCode: ZERO_RUNTIME,
    immutableReferences: {
      "7": [{ start: 0, length: 32 }, { start: 64, length: 32 }],
      "8": [{ start: 32, length: 32 }],
    },
    runtimeImmutables: [
      { immutableId: "8", abiType: "uint256", literal: "1000" },
      { immutableId: "7", abiType: "address", target: "future-target" },
    ],
    label: "synthetic runtime",
  });
  const materialized = materializeRuntimeCode(
    plan,
    new Map([["future-target", "0x1111111111111111111111111111111111111111"]]),
    "synthetic runtime",
  );
  const words = materialized.slice(2).match(/.{64}/g);
  assert.equal(words[0], `0000000000000000000000001111111111111111111111111111111111111111`);
  assert.equal(words[1], `${1000n.toString(16).padStart(64, "0")}`);
  assert.equal(words[2], words[0]);
});

test("runtime materialization rejects missing and extra immutable ids", () => {
  const references = { "7": [{ start: 0, length: 32 }] };
  assert.throws(
    () => normalizeRuntimeMaterialization({
      runtimeCode: ZERO_RUNTIME,
      immutableReferences: references,
      runtimeImmutables: [],
      label: "missing",
    }),
    /exactly cover compiler immutableReferences/,
  );
  assert.throws(
    () => normalizeRuntimeMaterialization({
      runtimeCode: ZERO_RUNTIME,
      immutableReferences: references,
      runtimeImmutables: [
        { immutableId: "7", abiType: "bool", literal: true },
        { immutableId: "8", abiType: "bool", literal: false },
      ],
      label: "extra",
    }),
    /exactly cover compiler immutableReferences/,
  );
});

test("runtime materialization rejects overlap, non-32-byte refs, and nonzero templates", () => {
  assert.throws(
    () => normalizeRuntimeMaterialization({
      runtimeCode: ZERO_RUNTIME,
      immutableReferences: {
        "7": [{ start: 0, length: 32 }],
        "8": [{ start: 16, length: 32 }],
      },
      runtimeImmutables: [
        { immutableId: "7", abiType: "bool", literal: true },
        { immutableId: "8", abiType: "bool", literal: false },
      ],
      label: "overlap",
    }),
    /overlap/,
  );
  assert.throws(
    () => normalizeRuntimeMaterialization({
      runtimeCode: ZERO_RUNTIME,
      immutableReferences: { "7": [{ start: 0, length: 20 }] },
      runtimeImmutables: [{ immutableId: "7", abiType: "address", literal: "0x1111111111111111111111111111111111111111" }],
      label: "short",
    }),
    /32-byte reference/,
  );
  assert.throws(
    () => normalizeRuntimeMaterialization({
      runtimeCode: `0x01${"00".repeat(95)}`,
      immutableReferences: { "7": [{ start: 0, length: 32 }] },
      runtimeImmutables: [{ immutableId: "7", abiType: "bool", literal: true }],
      label: "nonzero",
    }),
    /not zero-filled/,
  );
});

test("runtime target references are address-only and must resolve", () => {
  assert.throws(
    () => normalizeRuntimeMaterialization({
      runtimeCode: ZERO_RUNTIME,
      immutableReferences: { "7": [{ start: 0, length: 32 }] },
      runtimeImmutables: [{ immutableId: "7", abiType: "uint256", target: "future-target" }],
      label: "wrong type",
    }),
    /requires an address ABI type/,
  );
  const plan = normalizeRuntimeMaterialization({
    runtimeCode: ZERO_RUNTIME,
    immutableReferences: { "7": [{ start: 0, length: 32 }] },
    runtimeImmutables: [{ immutableId: "7", abiType: "address", target: "future-target" }],
    label: "unresolved",
  });
  assert.throws(
    () => materializeRuntimeCode(plan, new Map(), "unresolved"),
    /references unknown target/,
  );
});

test("custom-module opcode gate skips PUSH data but rejects executable delegation opcodes", () => {
  assert.doesNotThrow(() => assertNoDelegatingRuntimeOpcodes(
    "0x60f460f260ff00",
    "push-only bytes",
  ));
  for (const [runtime, mnemonic] of [
    ["0x5bf400", "DELEGATECALL"],
    ["0x5bf200", "CALLCODE"],
    ["0x5bff00", "SELFDESTRUCT"],
  ]) {
    assert.throws(
      () => assertNoDelegatingRuntimeOpcodes(runtime, "executable opcode"),
      new RegExp(mnemonic),
    );
  }
});
