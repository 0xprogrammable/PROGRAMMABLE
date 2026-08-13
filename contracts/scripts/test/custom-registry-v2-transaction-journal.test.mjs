import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import {
  assertExactSerializedEip1559Transaction,
  assertSignedAttemptWindow,
  assertTrustedTimeEvidence,
  appendDurableJsonLine,
  loadDurableJsonLines,
} from "../custom-registry-v2-transaction-journal.mjs";

const keyA = `0x${"11".repeat(32)}`;
const keyB = `0x${"22".repeat(32)}`;
const accountA = privateKeyToAccount(keyA);
const reviewed = {
  chainId: 1,
  type: "eip1559",
  from: accountA.address,
  to: null,
  input: "0x1234",
  valueWei: "0",
  nonce: 7,
  gasLimit: "100000",
  maxFeePerGas: "10",
  maxPriorityFeePerGas: "1",
};
const sign = async (mutation = {}, key = keyA) => {
  const type = mutation.type ?? reviewed.type;
  const transaction = {
    chainId: mutation.chainId ?? reviewed.chainId,
    type,
    ...(Object.hasOwn(mutation, "to")
      ? { to: mutation.to }
      : reviewed.to === null
        ? {}
        : { to: reviewed.to }),
    data: mutation.input ?? reviewed.input,
    value: BigInt(mutation.valueWei ?? reviewed.valueWei),
    nonce: mutation.nonce ?? reviewed.nonce,
    gas: BigInt(mutation.gasLimit ?? reviewed.gasLimit),
    ...(type === "legacy"
      ? { gasPrice: 10n }
      : {
          maxFeePerGas: BigInt(mutation.maxFeePerGas ?? reviewed.maxFeePerGas),
          maxPriorityFeePerGas: BigInt(
            mutation.maxPriorityFeePerGas ?? reviewed.maxPriorityFeePerGas,
          ),
        }),
  };
  return privateKeyToAccount(key).signTransaction(transaction);
};

test("recovers the signer and binds every exact EIP-1559 transaction field", async () => {
  const exact = await sign();
  await assert.doesNotReject(() =>
    assertExactSerializedEip1559Transaction({
      serializedTransaction: exact,
      transactionHash: keccak256(exact),
      expected: reviewed,
    }),
  );
  const mutations = [
    [{ chainId: 2 }],
    [{ type: "legacy" }],
    [{ to: "0x0000000000000000000000000000000000000001" }],
    [{ input: "0x5678" }],
    [{ valueWei: "1" }],
    [{ nonce: 8 }],
    [{ gasLimit: "100001" }],
    [{ maxFeePerGas: "11" }],
    [{ maxPriorityFeePerGas: "2" }],
    [{}, keyB],
  ];
  for (const [mutation, key] of mutations) {
    const serializedTransaction = await sign(mutation, key);
    await assert.rejects(
      () =>
        assertExactSerializedEip1559Transaction({
          serializedTransaction,
          transactionHash: keccak256(serializedTransaction),
          expected: reviewed,
        }),
      /differs from exact reviewed plan/u,
    );
  }
});

test("authorization binds signing and first attempt, never inclusion", () => {
  const authorization = {
    notBeforeTimestamp: 100,
    firstAttemptExpiresAtTimestamp: 400,
  };
  assertSignedAttemptWindow({
    authorization,
    signedAt: 100,
    firstAttemptAt: 400,
  });
  for (const values of [
    { signedAt: 99, firstAttemptAt: 100 },
    { signedAt: 100, firstAttemptAt: 401 },
  ]) {
    assert.throws(
      () => assertSignedAttemptWindow({ authorization, ...values }),
      /outside authorization/u,
    );
  }
});

test("trusted time evidence binds its exact adjusted timestamp", () => {
  const evidence = {
    source: "sntp:time.apple.com",
    systemTimeMilliseconds: 100_000,
    offsetMilliseconds: 250,
    uncertaintyMilliseconds: 50,
    adjustedTimeMilliseconds: 100_250,
    adjustedTimestamp: 100,
  };
  assert.doesNotThrow(() => assertTrustedTimeEvidence(evidence, 100));
  assert.throws(
    () =>
      assertTrustedTimeEvidence(
        { ...evidence, adjustedTimeMilliseconds: 100_251 },
        100,
      ),
    /trusted time evidence/u,
  );
});

test("journal recovery ignores only a torn trailing record", async () => {
  const directory = await mkdtemp("/tmp/registry-v2-journal-test-");
  try {
    const journalPath = path.join(directory, "journal.jsonl");
    await writeFile(
      journalPath,
      `${JSON.stringify({ event: "JOURNAL_OPEN" })}\n${JSON.stringify({ event: "SIGNED_NOT_CONFIRMED" })}\n{"event":"TORN`,
    );
    assert.deepEqual(await loadDurableJsonLines(journalPath), [
      { event: "JOURNAL_OPEN" },
      { event: "SIGNED_NOT_CONFIRMED" },
    ]);
    await loadDurableJsonLines(journalPath, {
      repairTrailingTornRecord: true,
    });
    await appendDurableJsonLine(journalPath, { event: "RECOVERY_FOUND" });
    assert.deepEqual(await loadDurableJsonLines(journalPath), [
      { event: "JOURNAL_OPEN" },
      { event: "SIGNED_NOT_CONFIRMED" },
      { event: "RECOVERY_FOUND" },
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
