import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import {
  assertBroadcastObservationEvidence,
  assertDispatchAuthorizedJournal,
  assertDispatchIntentEvidence,
  assertExactSerializedEip1559Transaction,
  assertSignedDispatchIntentWindow,
  assertTransactionDiscoveryEvidence,
  assertTrustedTimeAfter,
  assertTrustedTimeEvidence,
  appendDurableJsonLine,
  createDurableJsonLines,
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
const timeEvidence = (
  adjustedTimeMilliseconds,
  uncertaintyMilliseconds = 0,
) => ({
  source: "sntp:time.apple.com",
  systemTimeMilliseconds: adjustedTimeMilliseconds,
  offsetMilliseconds: 0,
  uncertaintyMilliseconds,
  adjustedTimeMilliseconds,
  adjustedTimestamp: Math.floor(adjustedTimeMilliseconds / 1_000),
});

test("trusted release intervals must not overlap", () => {
  const prior = timeEvidence(200_000, 1_000);
  assert.throws(
    () => assertTrustedTimeAfter(timeEvidence(201_500, 500), prior),
    /overlaps/u,
  );
  assert.doesNotThrow(() =>
    assertTrustedTimeAfter(timeEvidence(201_501, 500), prior),
  );
});

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

test("authorization binds the durable dispatch intent, never prior staging or later inclusion", () => {
  const authorization = {
    notBeforeTimestamp: 100,
    dispatchIntentExpiresAtTimestamp: 400,
  };
  assertSignedDispatchIntentWindow({
    authorization,
    dispatchIntentTrustedTime: timeEvidence(400_900),
  });
  for (const values of [
    {
      dispatchIntentTrustedTime: timeEvidence(99_999),
    },
    {
      dispatchIntentTrustedTime: timeEvidence(401_000),
    },
    {
      dispatchIntentTrustedTime: timeEvidence(400_999, 2),
    },
  ]) {
    assert.throws(
      () => assertSignedDispatchIntentWindow({ authorization, ...values }),
      /outside authorization/u,
    );
  }
});

test("provider response and recovery discovery evidence bind time, hash, IDs, and origins", () => {
  const authorization = {
    notBeforeTimestamp: 100,
    dispatchIntentExpiresAtTimestamp: 400,
  };
  const signedTrustedTime = timeEvidence(100_100);
  const providerBindings = [
    { providerId: "provider-a", rpcOrigin: "https://rpc-a.example" },
    { providerId: "provider-b", rpcOrigin: "https://rpc-b.example" },
  ];
  const transactionHash = `0x${"11".repeat(32)}`;
  const response = {
    event: "BROADCAST_PROVIDER_RESPONSES",
    requestStartedAtTimestamp: 101,
    requestStartedTrustedTime: timeEvidence(101_100),
    responseObservedAtTimestamp: 101,
    responseObservedTrustedTime: timeEvidence(101_900),
    transactionHash,
    providerResponses: [
      { ...providerBindings[0], status: "fulfilled", transactionHash },
      { ...providerBindings[1], status: "rejected", errorName: "RpcError" },
    ],
  };
  assert.doesNotThrow(() =>
    assertBroadcastObservationEvidence({
      evidence: response,
      event: "BROADCAST_PROVIDER_RESPONSES",
      transactionHash,
      providerBindings,
    }),
  );
  for (const mutation of [
    { requestStartedTrustedTime: undefined },
    {
      providerResponses: response.providerResponses.map((entry, index) =>
        index === 0 ? { ...entry, rpcOrigin: "https://evil.example" } : entry,
      ),
    },
    {
      providerResponses: response.providerResponses.map((entry) => ({
        ...entry,
        status: "unknown",
      })),
    },
  ]) {
    assert.throws(
      () =>
        assertBroadcastObservationEvidence({
          evidence: { ...response, ...mutation },
          event: "BROADCAST_PROVIDER_RESPONSES",
          transactionHash,
          providerBindings,
        }),
      /evidence is invalid|trusted time/u,
    );
  }
  const discovery = {
    event: "RECOVERY_TRANSACTION_DISCOVERY",
    discoveredAtTimestamp: 102,
    discoveredTrustedTime: timeEvidence(102_100),
    transactionHash,
    providers: providerBindings.map((binding) => ({
      ...binding,
      found: true,
      transactionHash,
      blockNumber: null,
    })),
  };
  assert.doesNotThrow(() =>
    assertTransactionDiscoveryEvidence({
      evidence: discovery,
      transactionHash,
      providerBindings,
    }),
  );
  assert.throws(
    () =>
      assertTransactionDiscoveryEvidence({
        evidence: {
          ...discovery,
          providers: discovery.providers.map((entry, index) =>
            index === 1 ? { ...entry, found: false } : entry,
          ),
        },
        transactionHash,
        providerBindings,
      }),
    /discovery evidence is invalid/u,
  );
});

test("one exact durable dispatch intent is the only recovery authority", async () => {
  const serializedTransaction = await sign();
  const transactionHash = keccak256(serializedTransaction);
  const authorizationSha256 = `0x${"aa".repeat(32)}`;
  const stagedTransactionSha256 = `0x${"bb".repeat(32)}`;
  const authorization = {
    notBeforeTimestamp: 100,
    dispatchIntentExpiresAtTimestamp: 400,
    authorizationSemantics: "exact-staged-raw-dispatch-intent",
  };
  const signed = {
    event: "SIGNED_NOT_CONFIRMED",
    transactionHash,
    stagedTransactionSha256,
    serializedTransaction,
  };
  const intent = {
    event: "DISPATCH_INTENT_ACTIVATED",
    transactionHash,
    authorizationSha256,
    authorizationSemantics: authorization.authorizationSemantics,
    activatedAtTimestamp: 200,
    activatedTrustedTime: timeEvidence(200_100),
    exactSerializedTransactionOnly: true,
    changedTransactionRequiresFreshAuthorization: true,
    workflowCancellationAllowed: false,
  };
  assert.doesNotThrow(() =>
    assertDispatchIntentEvidence({
      evidence: intent,
      transactionHash,
      authorizationSha256,
      authorization,
    }),
  );
  const records = [
    {
      schemaVersion: "receipt.v1",
      event: "JOURNAL_OPEN",
      authorizationSha256,
      stagedTransactionSha256,
    },
    signed,
    intent,
  ];
  assert.doesNotThrow(() =>
    assertDispatchAuthorizedJournal({
      records,
      schemaVersion: "receipt.v1",
      signedEvent: "SIGNED_NOT_CONFIRMED",
      transactionHash,
      stagedTransactionSha256,
      authorizationSha256,
      authorization,
      broadcastProviderBindings: [],
      discoveryProviderBindings: [],
      allowedTailEvents: [],
    }),
  );
  for (const invalid of [
    records.slice(0, 2),
    [...records, intent],
    [records[0], intent, signed],
    [
      records[0],
      signed,
      { ...intent, transactionHash: `0x${"cc".repeat(32)}` },
    ],
    [...records, { event: "REPLACE_TRANSACTION", transactionHash }],
  ]) {
    assert.throws(
      () =>
        assertDispatchAuthorizedJournal({
          records: invalid,
          schemaVersion: "receipt.v1",
          signedEvent: "SIGNED_NOT_CONFIRMED",
          transactionHash,
          stagedTransactionSha256,
          authorizationSha256,
          authorization,
          broadcastProviderBindings: [],
          discoveryProviderBindings: [],
          allowedTailEvents: [],
        }),
      /dispatch-authorized|durable dispatch/u,
    );
  }
});

test("journal rejects observations before intent and duplicate initial observations", async () => {
  const serializedTransaction = await sign();
  const transactionHash = keccak256(serializedTransaction);
  const authorizationSha256 = `0x${"aa".repeat(32)}`;
  const stagedTransactionSha256 = `0x${"bb".repeat(32)}`;
  const authorization = {
    notBeforeTimestamp: 100,
    dispatchIntentExpiresAtTimestamp: 400,
    authorizationSemantics: "exact-staged-raw-dispatch-intent",
  };
  const providerBindings = [
    {
      providerId: "provider-a",
      rpcOrigin: "https://rpc-a.example",
      rpcEndpointSha256: `0x${"cc".repeat(32)}`,
    },
  ];
  const base = [
    {
      schemaVersion: "receipt.v1",
      event: "JOURNAL_OPEN",
      authorizationSha256,
      stagedTransactionSha256,
    },
    {
      event: "SIGNED_NOT_CONFIRMED",
      transactionHash,
      stagedTransactionSha256,
      serializedTransaction,
    },
    {
      event: "DISPATCH_INTENT_ACTIVATED",
      transactionHash,
      authorizationSha256,
      authorizationSemantics: authorization.authorizationSemantics,
      activatedAtTimestamp: 200,
      activatedTrustedTime: timeEvidence(200_100),
      exactSerializedTransactionOnly: true,
      changedTransactionRequiresFreshAuthorization: true,
      workflowCancellationAllowed: false,
    },
  ];
  const response = {
    event: "BROADCAST_PROVIDER_RESPONSES",
    requestStartedAtTimestamp: 201,
    requestStartedTrustedTime: timeEvidence(201_100),
    responseObservedAtTimestamp: 202,
    responseObservedTrustedTime: timeEvidence(202_100),
    transactionHash,
    providerResponses: [
      { ...providerBindings[0], status: "fulfilled", transactionHash },
    ],
  };
  const check = (records) =>
    assertDispatchAuthorizedJournal({
      records,
      schemaVersion: "receipt.v1",
      signedEvent: "SIGNED_NOT_CONFIRMED",
      transactionHash,
      stagedTransactionSha256,
      authorizationSha256,
      authorization,
      broadcastProviderBindings: providerBindings,
      discoveryProviderBindings: providerBindings,
      allowedTailEvents: [],
    });
  assert.doesNotThrow(() => check([...base, response]));
  assert.throws(
    () =>
      check([
        ...base,
        {
          ...response,
          requestStartedAtTimestamp: 150,
          requestStartedTrustedTime: timeEvidence(150_100),
          responseObservedAtTimestamp: 151,
          responseObservedTrustedTime: timeEvidence(151_100),
        },
      ]),
    /overlaps/u,
  );
  assert.throws(
    () => check([...base, response, response]),
    /journal is invalid/u,
  );
  const recovery = {
    ...response,
    event: "RECOVERY_EXACT_REBROADCAST",
    requestStartedAtTimestamp: 203,
    requestStartedTrustedTime: timeEvidence(203_100),
    responseObservedAtTimestamp: 204,
    responseObservedTrustedTime: timeEvidence(204_100),
  };
  assert.doesNotThrow(() => check([...base, response, recovery]));
  assert.throws(
    () =>
      check([
        ...base,
        recovery,
        {
          ...recovery,
          requestStartedAtTimestamp: 202,
          requestStartedTrustedTime: timeEvidence(202_100),
          responseObservedAtTimestamp: 203,
          responseObservedTrustedTime: timeEvidence(203_100),
        },
      ]),
    /overlaps/u,
  );
  const receipt = {
    event: "RECEIPT_SEEN_AWAITING_FINALIZED_VERIFICATION",
    observedAtTimestamp: 203,
    transactionHash,
    blockNumber: "123",
    blockHash: `0x${"dd".repeat(32)}`,
  };
  assert.doesNotThrow(() =>
    assertDispatchAuthorizedJournal({
      records: [...base, response, receipt],
      schemaVersion: "receipt.v1",
      signedEvent: "SIGNED_NOT_CONFIRMED",
      transactionHash,
      stagedTransactionSha256,
      authorizationSha256,
      authorization,
      broadcastProviderBindings: providerBindings,
      discoveryProviderBindings: providerBindings,
      allowedTailEvents: ["RECEIPT_SEEN_AWAITING_FINALIZED_VERIFICATION"],
    }),
  );
  assert.throws(
    () =>
      assertDispatchAuthorizedJournal({
        records: [...base, receipt, response],
        schemaVersion: "receipt.v1",
        signedEvent: "SIGNED_NOT_CONFIRMED",
        transactionHash,
        stagedTransactionSha256,
        authorizationSha256,
        authorization,
        broadcastProviderBindings: providerBindings,
        discoveryProviderBindings: providerBindings,
        allowedTailEvents: ["RECEIPT_SEEN_AWAITING_FINALIZED_VERIFICATION"],
      }),
    /journal is invalid/u,
  );
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

test("dispatch activation publishes header signed transaction and intent as one durable unit", async () => {
  const directory = await mkdtemp("/tmp/registry-v2-activation-");
  const journal = path.join(directory, "journal.jsonl");
  const records = [
    { event: "JOURNAL_OPEN" },
    { event: "SIGNED" },
    { event: "INTENT" },
  ];
  try {
    await createDurableJsonLines(journal, records);
    assert.deepEqual(await loadDurableJsonLines(journal), records);
    await assert.rejects(createDurableJsonLines(journal, records), /EEXIST/u);
    assert.deepEqual(await loadDurableJsonLines(journal), records);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
