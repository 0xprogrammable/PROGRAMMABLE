import assert from "node:assert/strict";
import test from "node:test";

import type { Address, Hex } from "viem";

import {
  CanonicalEventBuffer,
  emptyEventIndexerCheckpoint,
  eventIndexerConfigurationDigest,
  ProgrammableSdkError,
  type CanonicalEvmBlock,
  type CanonicalEvmLog,
  type EventIndexerOptions,
} from "../src/index.js";

const CORE = "0x1111111111111111111111111111111111111111" as Address;
const TOPIC = `0x${"ab".repeat(32)}` as Hex;
const hash = (byte: number): Hex => `0x${byte.toString(16).padStart(2, "0").repeat(32)}` as Hex;

function options(overrides: Partial<EventIndexerOptions> = {}): EventIndexerOptions {
  return {
    chainId: 46630,
    coreAddress: CORE,
    allowedTopic0: [TOPIC],
    confirmationDepth: 1,
    maxBufferedBlocks: 8,
    maxBufferedLogs: 32,
    maxLogsPerBlock: 8,
    maxLogDataBytes: 256,
    maxBackfillBlockSpan: 4,
    authenticationPolicyId: "test.rpc-log-inclusion.v1",
    eventSchemaId: "test.core-foundation-events.v1",
    authenticateBlockHeader: (block) => block.chainId === 46630 && block.hash !== hash(0xff),
    authenticate: (entry) => entry.transactionHash !== hash(0xfe),
    ...overrides,
  };
}

function log(
  blockNumber: bigint,
  blockHash: Hex,
  transactionIndex: number,
  logIndex: number,
  overrides: Partial<CanonicalEvmLog> = {},
): CanonicalEvmLog {
  return {
    chainId: 46630,
    address: CORE,
    blockNumber,
    blockHash,
    transactionHash: hash(0x80 + Number(blockNumber) + transactionIndex),
    transactionIndex,
    logIndex,
    topics: [TOPIC],
    data: `0x${logIndex.toString(16).padStart(2, "0")}`,
    ...overrides,
  };
}

function block(
  number: bigint,
  blockHash: Hex,
  parentHash: Hex,
  logs: readonly CanonicalEvmLog[] = [log(number, blockHash, 0, 0)],
): CanonicalEvmBlock {
  return { chainId: 46630, number, hash: blockHash, parentHash, logs };
}

function errorCode(code: string): (error: unknown) => boolean {
  return (error: unknown) => error instanceof ProgrammableSdkError && error.code === code;
}

function changingGetProxy<T extends object>(target: T) {
  const descriptorReads = new Map<PropertyKey, number>();
  const getReads = new Map<PropertyKey, number>();
  const proxy = new Proxy(target, {
    get(current, key, receiver) {
      const reads = (getReads.get(key) ?? 0) + 1;
      getReads.set(key, reads);
      return reads === 1 ? Reflect.get(current, key, receiver) : undefined;
    },
    getOwnPropertyDescriptor(current, key) {
      descriptorReads.set(key, (descriptorReads.get(key) ?? 0) + 1);
      return Reflect.getOwnPropertyDescriptor(current, key);
    },
  });
  return { proxy, descriptorReads, getReads };
}

function assertOwnDescriptorsReadOnce(
  target: object,
  trace: ReturnType<typeof changingGetProxy>,
): void {
  const keys = Reflect.ownKeys(target);
  assert.equal(trace.descriptorReads.size, keys.length);
  for (const key of keys) assert.equal(trace.descriptorReads.get(key), 1, String(key));
  assert.equal(trace.getReads.size, 0);
}

function installEnumerableAccessor(target: object, key: PropertyKey, value: unknown): () => number {
  let reads = 0;
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    get: () => {
      reads += 1;
      return value;
    },
  });
  return () => reads;
}

test("indexer authenticates, sorts and deduplicates exact logs", () => {
  const buffer = new CanonicalEventBuffer(options());
  const blockHash = hash(1);
  const late = log(1n, blockHash, 1, 2);
  const early = log(1n, blockHash, 0, 1);
  const result = buffer.ingestBlock(block(1n, blockHash, hash(0), [late, early, early]));
  assert.equal(result.status, "applied");
  assert.deepEqual(result.appliedLogs.map((entry) => entry.transactionIndex), [0, 1]);
  assert.equal(buffer.bufferedLogCount, 2);
  assert.equal(buffer.ingestBlock(block(1n, blockHash, hash(0), [late, early, early])).status, "duplicate");
});

test("indexer snapshots Proxy-backed public record inputs exactly once", () => {
  const expectedDigest = eventIndexerConfigurationDigest(
    options({
      externalFinalityPolicy: {
        policyId: "test.proxy-finality.v1",
        isFinalized: () => false,
      },
    }),
  );
  const tracedConfiguration = () => {
    const topicTarget = [TOPIC] as [Hex, ...Hex[]];
    const topicTrace = changingGetProxy(topicTarget);
    const policyTarget = {
      policyId: "test.proxy-finality.v1",
      isFinalized: () => false,
    };
    const policyTrace = changingGetProxy(policyTarget);
    const configurationTarget = options({
      allowedTopic0: topicTrace.proxy,
      externalFinalityPolicy: policyTrace.proxy,
    });
    const configurationTrace = changingGetProxy(configurationTarget);
    return { configurationTarget, configurationTrace, topicTarget, topicTrace, policyTarget, policyTrace };
  };

  const digestInput = tracedConfiguration();
  assert.equal(eventIndexerConfigurationDigest(digestInput.configurationTrace.proxy), expectedDigest);
  assertOwnDescriptorsReadOnce(digestInput.configurationTarget, digestInput.configurationTrace);
  assertOwnDescriptorsReadOnce(digestInput.topicTarget, digestInput.topicTrace);
  assertOwnDescriptorsReadOnce(digestInput.policyTarget, digestInput.policyTrace);

  const constructorInput = tracedConfiguration();
  assert.doesNotThrow(() => new CanonicalEventBuffer(constructorInput.configurationTrace.proxy));
  assertOwnDescriptorsReadOnce(constructorInput.configurationTarget, constructorInput.configurationTrace);
  assertOwnDescriptorsReadOnce(constructorInput.topicTarget, constructorInput.topicTrace);
  assertOwnDescriptorsReadOnce(constructorInput.policyTarget, constructorInput.policyTrace);

  const configuration = options({ confirmationDepth: 0 });
  const checkpointTarget = emptyEventIndexerCheckpoint({
    chainId: 46630,
    coreAddress: CORE,
    blockNumber: 0n,
    blockHash: hash(0),
    configurationDigest: eventIndexerConfigurationDigest(configuration),
    checkpointBasis: "confirmation-depth-only",
  });
  const checkpointTrace = changingGetProxy(checkpointTarget);
  assert.doesNotThrow(() => new CanonicalEventBuffer(configuration, checkpointTrace.proxy));
  assertOwnDescriptorsReadOnce(checkpointTarget, checkpointTrace);

  const topicTarget = [TOPIC];
  const topicTrace = changingGetProxy(topicTarget);
  const logTarget = log(1n, hash(1), 0, 0, { topics: topicTrace.proxy });
  const logTrace = changingGetProxy(logTarget);
  const logsTarget = [logTrace.proxy];
  const logsTrace = changingGetProxy(logsTarget);
  const blockTarget = block(1n, hash(1), hash(0), logsTrace.proxy);
  const blockTrace = changingGetProxy(blockTarget);
  const buffer = new CanonicalEventBuffer(configuration);
  assert.equal(buffer.ingestBlock(blockTrace.proxy).status, "applied");
  assertOwnDescriptorsReadOnce(blockTarget, blockTrace);
  assertOwnDescriptorsReadOnce(logsTarget, logsTrace);
  assertOwnDescriptorsReadOnce(logTarget, logTrace);
  assertOwnDescriptorsReadOnce(topicTarget, topicTrace);

  const canonicalOptionsTarget = { checkpointEligibleOnly: true };
  const canonicalOptionsTrace = changingGetProxy(canonicalOptionsTarget);
  assert.equal(buffer.canonicalLogs(canonicalOptionsTrace.proxy).length, 1);
  assertOwnDescriptorsReadOnce(canonicalOptionsTarget, canonicalOptionsTrace);

  const checkpoint = buffer.checkpointAt(1n, hash(0xaa));
  const observedTarget = {
    blockNumber: checkpoint.blockNumber,
    blockHash: checkpoint.blockHash,
    stateDigest: checkpoint.stateDigest,
  };
  const observedTrace = changingGetProxy(observedTarget);
  assert.equal(buffer.reconcileCheckpoint(observedTrace.proxy), true);
  assertOwnDescriptorsReadOnce(observedTarget, observedTrace);

  const emptyInputTarget = {
    chainId: 46630,
    coreAddress: CORE,
    blockNumber: 0n,
    blockHash: hash(0),
    configurationDigest: eventIndexerConfigurationDigest(configuration),
    checkpointBasis: "confirmation-depth-only" as const,
  };
  const emptyInputTrace = changingGetProxy(emptyInputTarget);
  assert.equal(emptyEventIndexerCheckpoint(emptyInputTrace.proxy).chainId, 46630);
  assertOwnDescriptorsReadOnce(emptyInputTarget, emptyInputTrace);
});

test("indexer rejects enumerable accessors without invoking them", () => {
  const assertUnread = (invoke: () => unknown, reads: () => number): void => {
    assert.throws(invoke, errorCode("SDK_INPUT_ACCESSOR_REJECTED"));
    assert.equal(reads(), 0);
  };

  const configurationWithAccessor = options() as unknown as Record<string, unknown>;
  assertUnread(
    () => new CanonicalEventBuffer(configurationWithAccessor as unknown as EventIndexerOptions),
    installEnumerableAccessor(configurationWithAccessor, "chainId", 46630),
  );

  const policyWithAccessor = {
    policyId: "test.accessor-finality.v1",
    isFinalized: () => false,
  } as Record<string, unknown>;
  assertUnread(
    () =>
      new CanonicalEventBuffer(
        options({
          externalFinalityPolicy: policyWithAccessor as unknown as NonNullable<
            EventIndexerOptions["externalFinalityPolicy"]
          >,
        }),
      ),
    installEnumerableAccessor(policyWithAccessor, "policyId", "test.accessor-finality.v1"),
  );

  const configuration = options({ confirmationDepth: 0 });
  const checkpointWithAccessor = {
    ...emptyEventIndexerCheckpoint({
      chainId: 46630,
      coreAddress: CORE,
      blockNumber: 0n,
      blockHash: hash(0),
      configurationDigest: eventIndexerConfigurationDigest(configuration),
      checkpointBasis: "confirmation-depth-only",
    }),
  } as Record<string, unknown>;
  assertUnread(
    () =>
      new CanonicalEventBuffer(
        configuration,
        checkpointWithAccessor as unknown as ConstructorParameters<typeof CanonicalEventBuffer>[1],
      ),
    installEnumerableAccessor(
      checkpointWithAccessor,
      "schema",
      "programmable.dex-evm.event-indexer-checkpoint.v1",
    ),
  );

  const blockWithAccessor = block(1n, hash(1), hash(0)) as unknown as Record<string, unknown>;
  assertUnread(
    () =>
      new CanonicalEventBuffer(configuration).ingestBlock(
        blockWithAccessor as unknown as CanonicalEvmBlock,
      ),
    installEnumerableAccessor(blockWithAccessor, "number", 1n),
  );

  const logWithAccessor = log(1n, hash(1), 0, 0) as unknown as Record<string, unknown>;
  assertUnread(
    () =>
      new CanonicalEventBuffer(configuration).ingestBlock(
        block(1n, hash(1), hash(0), [logWithAccessor as unknown as CanonicalEvmLog]),
      ),
    installEnumerableAccessor(logWithAccessor, "data", "0x00"),
  );

  const topicsWithAccessor = [TOPIC];
  assertUnread(
    () =>
      new CanonicalEventBuffer(configuration).ingestBlock(
        block(1n, hash(1), hash(0), [
          log(1n, hash(1), 0, 0, { topics: topicsWithAccessor }),
        ]),
      ),
    installEnumerableAccessor(topicsWithAccessor, 0, TOPIC),
  );

  const canonicalOptionsWithAccessor = {} as Record<string, unknown>;
  assertUnread(
    () =>
      new CanonicalEventBuffer(configuration).canonicalLogs(
        canonicalOptionsWithAccessor as { readonly checkpointEligibleOnly?: boolean },
      ),
    installEnumerableAccessor(canonicalOptionsWithAccessor, "checkpointEligibleOnly", true),
  );

  const buffer = new CanonicalEventBuffer(configuration);
  buffer.ingestBlock(block(1n, hash(1), hash(0)));
  const checkpoint = buffer.checkpointAt(1n, hash(0xaa));
  const observedWithAccessor = {
    blockNumber: checkpoint.blockNumber,
    blockHash: checkpoint.blockHash,
    stateDigest: checkpoint.stateDigest,
  } as Record<string, unknown>;
  assertUnread(
    () =>
      buffer.reconcileCheckpoint(
        observedWithAccessor as unknown as Parameters<typeof buffer.reconcileCheckpoint>[0],
      ),
    installEnumerableAccessor(observedWithAccessor, "blockHash", checkpoint.blockHash),
  );

  const emptyInputWithAccessor = {
    chainId: 46630,
    coreAddress: CORE,
    blockNumber: 0n,
    blockHash: hash(0),
    configurationDigest: eventIndexerConfigurationDigest(configuration),
    checkpointBasis: "confirmation-depth-only" as const,
  } as Record<string, unknown>;
  assertUnread(
    () =>
      emptyEventIndexerCheckpoint(
        emptyInputWithAccessor as unknown as Parameters<typeof emptyEventIndexerCheckpoint>[0],
      ),
    installEnumerableAccessor(emptyInputWithAccessor, "chainId", 46630),
  );
});

test("indexer returns reverse-canonical rollback logs for a reorg", () => {
  const buffer = new CanonicalEventBuffer(options());
  const one = block(1n, hash(1), hash(0));
  const two = block(2n, hash(2), hash(1));
  const three = block(3n, hash(3), hash(2));
  buffer.ingestBlock(one);
  buffer.ingestBlock(two);
  buffer.ingestBlock(three);

  const alternateThree = block(3n, hash(0x33), hash(2));
  const shallow = buffer.ingestBlock(alternateThree);
  assert.deepEqual(shallow.rolledBackLogs.map((entry) => entry.blockHash), [hash(3)]);

  const alternateTwo = block(2n, hash(0x22), hash(1));
  const deep = buffer.ingestBlock(alternateTwo);
  assert.deepEqual(deep.rolledBackLogs.map((entry) => entry.blockHash), [hash(0x33), hash(2)]);
  assert.equal(buffer.head?.hash, hash(0x22));
});

test("indexer fails closed for untrusted headers, addresses and topics", () => {
  const buffer = new CanonicalEventBuffer(options());
  assert.throws(
    () => buffer.ingestBlock(block(1n, hash(0xff), hash(0))),
    errorCode("INDEXER_BLOCK_HEADER_AUTHENTICATION_FAILED"),
  );
  assert.throws(
    () =>
      buffer.ingestBlock(
        block(1n, hash(1), hash(0), [
          log(1n, hash(1), 0, 0, { address: "0x2222222222222222222222222222222222222222" }),
        ]),
      ),
    errorCode("INDEXER_LOG_ADDRESS_MISMATCH"),
  );
  assert.throws(
    () =>
      buffer.ingestBlock(
        block(1n, hash(1), hash(0), [log(1n, hash(1), 0, 0, { topics: [hash(0xcd)] })]),
      ),
    errorCode("INDEXER_TOPIC_NOT_ALLOWED"),
  );
});

test("indexer requires exact synchronous header and log-inclusion authentication", () => {
  assert.throws(
    () =>
      new CanonicalEventBuffer(options({ authenticate: () => false })).ingestBlock(
        block(1n, hash(1), hash(0)),
      ),
    errorCode("INDEXER_LOG_AUTHENTICATION_FAILED"),
  );
  assert.throws(
    () =>
      new CanonicalEventBuffer(
        options({
          authenticate: (async () => false) as unknown as EventIndexerOptions["authenticate"],
        }),
      ).ingestBlock(block(1n, hash(1), hash(0))),
    errorCode("INDEXER_LOG_AUTHENTICATION_FAILED"),
  );
  assert.throws(
    () =>
      new CanonicalEventBuffer(
        options({
          authenticateBlockHeader: (async () => false) as unknown as EventIndexerOptions["authenticateBlockHeader"],
        }),
      ).ingestBlock(block(1n, hash(1), hash(0))),
    errorCode("INDEXER_BLOCK_HEADER_AUTHENTICATION_FAILED"),
  );
});

test("indexer rejects wrong-chain empty blocks before header authentication", () => {
  const buffer = new CanonicalEventBuffer(
    options({ authenticateBlockHeader: () => true }),
  );
  assert.throws(
    () => buffer.ingestBlock({ ...block(1n, hash(1), hash(0), []), chainId: 1 }),
    errorCode("INDEXER_BLOCK_CHAIN_MISMATCH"),
  );
  assert.equal(buffer.bufferedBlockCount, 0);
  assert.throws(
    () => buffer.ingestBlock({ ...block(1n, hash(1), hash(0), []), number: 1 as unknown as bigint }),
    errorCode("INDEXER_BLOCK_NUMBER_INVALID"),
  );
});

test("indexer rejects malformed and partial-byte log data", () => {
  for (const data of ["0xzz", "0x0"] as readonly Hex[]) {
    const buffer = new CanonicalEventBuffer(options());
    assert.throws(
      () =>
        buffer.ingestBlock(
          block(1n, hash(1), hash(0), [log(1n, hash(1), 0, 0, { data })]),
        ),
      errorCode("INDEXER_DATA_HEX_INVALID"),
    );
    assert.equal(buffer.bufferedBlockCount, 0);
  }
  const malformedHash = `0x${"a".repeat(63)}` as Hex;
  assert.throws(
    () => new CanonicalEventBuffer(options()).ingestBlock(block(1n, malformedHash, hash(0), [])),
    errorCode("INDEXER_HASH_INVALID"),
  );
});

test("indexer rejects conflicting duplicate positions", () => {
  const buffer = new CanonicalEventBuffer(options());
  const blockHash = hash(1);
  const first = log(1n, blockHash, 0, 0);
  const conflict = { ...first, transactionHash: hash(0xee) };
  assert.throws(
    () => buffer.ingestBlock(block(1n, blockHash, hash(0), [first, conflict])),
    errorCode("INDEXER_CONFLICTING_LOG_POSITION"),
  );
});

test("indexer enforces global logIndex and transaction identity coherence", () => {
  const sameGlobalPosition = new CanonicalEventBuffer(options());
  assert.throws(
    () =>
      sameGlobalPosition.ingestBlock(
        block(1n, hash(1), hash(0), [log(1n, hash(1), 0, 0), log(1n, hash(1), 1, 0)]),
      ),
    errorCode("INDEXER_CONFLICTING_LOG_POSITION"),
  );

  const oneIndexTwoHashes = new CanonicalEventBuffer(options());
  assert.throws(
    () =>
      oneIndexTwoHashes.ingestBlock(
        block(1n, hash(1), hash(0), [
          log(1n, hash(1), 0, 0),
          log(1n, hash(1), 0, 1, { transactionHash: hash(0xee) }),
        ]),
      ),
    errorCode("INDEXER_TRANSACTION_IDENTITY_INCOHERENT"),
  );

  const oneHashTwoIndexes = new CanonicalEventBuffer(options());
  const sharedHash = hash(0xdd);
  assert.throws(
    () =>
      oneHashTwoIndexes.ingestBlock(
        block(1n, hash(1), hash(0), [
          log(1n, hash(1), 0, 0, { transactionHash: sharedHash }),
          log(1n, hash(1), 1, 1, { transactionHash: sharedHash }),
        ]),
      ),
    errorCode("INDEXER_TRANSACTION_IDENTITY_INCOHERENT"),
  );

  const decreasingTransactionIndex = new CanonicalEventBuffer(options());
  assert.throws(
    () =>
      decreasingTransactionIndex.ingestBlock(
        block(1n, hash(1), hash(0), [log(1n, hash(1), 1, 0), log(1n, hash(1), 0, 1)]),
      ),
    errorCode("INDEXER_LOG_ORDER_INCOHERENT"),
  );
});

test("indexer enforces max and max-plus-one block and log boundaries atomically", () => {
  const buffer = new CanonicalEventBuffer(
    options({ confirmationDepth: 0, maxBufferedBlocks: 2, maxBufferedLogs: 2, maxLogsPerBlock: 1 }),
  );
  buffer.ingestBlock(block(1n, hash(1), hash(0)));
  buffer.ingestBlock(block(2n, hash(2), hash(1)));
  assert.throws(
    () => buffer.ingestBlock(block(3n, hash(3), hash(2))),
    errorCode("INDEXER_MAX_BUFFERED_BLOCKS_EXCEEDED"),
  );
  assert.equal(buffer.head?.number, 2n);
  assert.equal(buffer.bufferedLogCount, 2);

  const logBound = new CanonicalEventBuffer(options({ maxLogsPerBlock: 1 }));
  assert.throws(
    () =>
      logBound.ingestBlock(
        block(1n, hash(1), hash(0), [log(1n, hash(1), 0, 0), log(1n, hash(1), 1, 1)]),
      ),
    errorCode("INDEXER_MAX_LOGS_PER_BLOCK_EXCEEDED"),
  );
  assert.equal(logBound.bufferedBlockCount, 0);

  const dataAtBound = new CanonicalEventBuffer(options({ maxLogDataBytes: 1 }));
  assert.equal(
    dataAtBound.ingestBlock(
      block(1n, hash(1), hash(0), [log(1n, hash(1), 0, 0, { data: "0xaa" })]),
    ).status,
    "applied",
  );
  const dataAboveBound = new CanonicalEventBuffer(options({ maxLogDataBytes: 1 }));
  assert.throws(
    () =>
      dataAboveBound.ingestBlock(
        block(1n, hash(1), hash(0), [log(1n, hash(1), 0, 0, { data: "0xaabb" })]),
      ),
    errorCode("INDEXER_MAX_LOG_DATA_BYTES_EXCEEDED"),
  );

  const topicBound = new CanonicalEventBuffer(options());
  assert.doesNotThrow(() =>
    topicBound.ingestBlock(
      block(1n, hash(1), hash(0), [
        log(1n, hash(1), 0, 0, { topics: [TOPIC, hash(1), hash(2), hash(3)] }),
      ]),
    ),
  );
  const topicsAboveBound = new CanonicalEventBuffer(options());
  assert.throws(
    () =>
      topicsAboveBound.ingestBlock(
        block(1n, hash(1), hash(0), [
          log(1n, hash(1), 0, 0, {
            topics: [TOPIC, hash(1), hash(2), hash(3), hash(4)],
          }),
        ]),
      ),
    errorCode("INDEXER_TOO_MANY_LOG_TOPICS"),
  );
});

test("confirmation-depth checkpoint supports bounded restart and backfill", () => {
  const configuration = options({ confirmationDepth: 1 });
  const buffer = new CanonicalEventBuffer(configuration);
  const one = block(1n, hash(1), hash(0));
  const two = block(2n, hash(2), hash(1));
  buffer.ingestBlock(one);
  buffer.ingestBlock(two);
  assert.equal(buffer.checkpointEligibleHead?.number, 1n);
  assert.equal(buffer.checkpointEligibleHead?.basis, "confirmation-depth-only");
  const checkpoint = buffer.checkpointAt(1n, hash(0xaa));
  assert.equal(checkpoint.checkpointBasis, "confirmation-depth-only");

  const restarted = new CanonicalEventBuffer(configuration, checkpoint);
  assert.equal(
    restarted.reconcileCheckpoint({
      blockNumber: 1n,
      blockHash: hash(1),
      stateDigest: hash(0xaa),
    }),
    true,
  );
  assert.equal(
    restarted.reconcileCheckpoint({
      blockNumber: 1n,
      blockHash: hash(1),
      stateDigest: hash(0xab),
    }),
    false,
  );
  assert.throws(
    () => new CanonicalEventBuffer(options({ confirmationDepth: 2 }), checkpoint),
    errorCode("INDEXER_CHECKPOINT_POLICY_MISMATCH"),
  );
  assert.throws(
    () =>
      new CanonicalEventBuffer(
        options({ allowedTopic0: [hash(0xcd)] }),
        checkpoint,
      ),
    errorCode("INDEXER_CHECKPOINT_POLICY_MISMATCH"),
  );
  restarted.ingestBlock(two);
  assert.deepEqual(restarted.nextBackfillRange(10n), { fromBlock: 3n, toBlock: 6n });
});

test("restart reorg can replace the first post-checkpoint block", () => {
  const configuration = options({ confirmationDepth: 0 });
  const initial = new CanonicalEventBuffer(configuration);
  initial.ingestBlock(block(1n, hash(1), hash(0)));
  const checkpoint = initial.checkpointAt(1n, hash(0xaa));
  const restarted = new CanonicalEventBuffer(configuration, checkpoint);
  restarted.ingestBlock(block(2n, hash(2), hash(1)));
  restarted.ingestBlock(block(3n, hash(3), hash(2)));
  const replacement = restarted.ingestBlock(block(2n, hash(0x22), hash(1)));
  assert.deepEqual(
    replacement.rolledBackLogs.map((entry) => entry.blockHash),
    [hash(3), hash(2)],
  );
  assert.equal(restarted.head?.hash, hash(0x22));
});

test("checkpoint-eligible log view is empty until the policy admits a block", () => {
  const buffer = new CanonicalEventBuffer(options({ confirmationDepth: 1 }));
  buffer.ingestBlock(block(1n, hash(1), hash(0)));
  assert.equal(buffer.checkpointEligibleHead, undefined);
  assert.equal(buffer.canonicalLogs().length, 1);
  assert.deepEqual(buffer.canonicalLogs({ checkpointEligibleOnly: true }), []);
});

test("external finality policy is explicit and persisted in checkpoints", () => {
  const configuration = options({
    confirmationDepth: 0,
    externalFinalityPolicy: {
      policyId: "test.authenticated-finalized-tag.v1",
      isFinalized: (candidate, head) => candidate.number + 2n <= head.number,
    },
  });
  const buffer = new CanonicalEventBuffer(configuration);
  buffer.ingestBlock(block(1n, hash(1), hash(0)));
  buffer.ingestBlock(block(2n, hash(2), hash(1)));
  buffer.ingestBlock(block(3n, hash(3), hash(2)));
  assert.equal(buffer.checkpointEligibleHead?.number, 1n);
  assert.equal(buffer.checkpointEligibleHead?.basis, "externally-authenticated-finality");
  const checkpoint = buffer.checkpointAt(1n, hash(0xbb));
  assert.equal(checkpoint.finalityPolicyId, "test.authenticated-finalized-tag.v1");
  assert.doesNotThrow(() => new CanonicalEventBuffer(configuration, checkpoint));
  assert.throws(
    () => new CanonicalEventBuffer(options(), checkpoint),
    errorCode("INDEXER_CHECKPOINT_POLICY_MISMATCH"),
  );
});

test("external finality requires exact boolean decisions forming a prefix", () => {
  const nonPrefix = new CanonicalEventBuffer(
    options({
      externalFinalityPolicy: {
        policyId: "test.non-prefix.v1",
        isFinalized: (candidate) => candidate.number === 3n,
      },
    }),
  );
  nonPrefix.ingestBlock(block(1n, hash(1), hash(0)));
  nonPrefix.ingestBlock(block(2n, hash(2), hash(1)));
  nonPrefix.ingestBlock(block(3n, hash(3), hash(2)));
  assert.throws(() => nonPrefix.checkpointEligibleHead, errorCode("INDEXER_FINALITY_PREFIX_INVALID"));

  const asynchronous = new CanonicalEventBuffer(
    options({
      externalFinalityPolicy: {
        policyId: "test.async-finality.v1",
        isFinalized: (async () => false) as unknown as NonNullable<
          EventIndexerOptions["externalFinalityPolicy"]
        >["isFinalized"],
      },
    }),
  );
  asynchronous.ingestBlock(block(1n, hash(1), hash(0)));
  assert.throws(
    () => asynchronous.checkpointEligibleHead,
    errorCode("INDEXER_FINALITY_RESULT_INVALID"),
  );
});

test("external finality cannot regress or authorize rollback of a reported-finalized block", () => {
  let finalizedThrough = 2n;
  const buffer = new CanonicalEventBuffer(
    options({
      confirmationDepth: 0,
      externalFinalityPolicy: {
        policyId: "test.monotonic-finality.v1",
        isFinalized: (candidate) => candidate.number <= finalizedThrough,
      },
    }),
  );
  buffer.ingestBlock(block(1n, hash(1), hash(0)));
  buffer.ingestBlock(block(2n, hash(2), hash(1)));
  buffer.ingestBlock(block(3n, hash(3), hash(2)));
  assert.deepEqual(buffer.checkpointEligibleHead, {
    number: 2n,
    hash: hash(2),
    basis: "externally-authenticated-finality",
  });

  finalizedThrough = 1n;
  assert.throws(() => buffer.checkpointEligibleHead, errorCode("INDEXER_FINALITY_REGRESSION"));

  finalizedThrough = 2n;
  assert.throws(
    () => buffer.ingestBlock(block(2n, hash(0x22), hash(1))),
    errorCode("INDEXER_FINALIZED_BLOCK_ROLLBACK_REJECTED"),
  );
  assert.deepEqual(buffer.head, { number: 3n, hash: hash(3) });
});

test("indexer outputs and checkpoints cannot mutate internal state", () => {
  const configuration = options({ confirmationDepth: 0 });
  const buffer = new CanonicalEventBuffer(configuration);
  const applied = buffer.ingestBlock(block(1n, hash(1), hash(0)));
  assert.throws(() => {
    (applied.appliedLogs as CanonicalEvmLog[]).pop();
  }, TypeError);
  assert.throws(() => {
    (applied.appliedLogs[0] as { data: Hex }).data = "0xffff";
  }, TypeError);
  assert.equal(buffer.canonicalLogs()[0]?.data, "0x00");

  const checkpoint = buffer.checkpointAt(1n, hash(0xaa));
  assert.throws(() => {
    (checkpoint as { stateDigest: Hex }).stateDigest = hash(0xbb);
  }, TypeError);
  assert.equal(buffer.checkpoint?.stateDigest, hash(0xaa));
});

test("indexer requires an exact non-empty topic set and coherent limits", () => {
  assert.throws(
    () => new CanonicalEventBuffer(options({ allowedTopic0: [] as unknown as [Hex, ...Hex[]] })),
    /allowedTopic0/,
  );
  assert.throws(
    () => new CanonicalEventBuffer(options({ confirmationDepth: 8, maxBufferedBlocks: 8 })),
    errorCode("INDEXER_LIMIT_INVALID"),
  );
});

test("empty checkpoint constructor validates sequence and policy metadata", () => {
  const checkpointInput = {
    chainId: 46630,
    coreAddress: CORE,
    blockNumber: 0n,
    blockHash: hash(0),
    configurationDigest: eventIndexerConfigurationDigest(options()),
    checkpointBasis: "confirmation-depth-only" as const,
  };
  assert.throws(
    () => emptyEventIndexerCheckpoint({ ...checkpointInput, blockNumber: -1n }),
    errorCode("INDEXER_CHECKPOINT_SEQUENCE_INVALID"),
  );
  assert.throws(
    () => emptyEventIndexerCheckpoint({ ...checkpointInput, blockNumber: 0 as unknown as bigint }),
    errorCode("INDEXER_CHECKPOINT_SEQUENCE_INVALID"),
  );
  assert.throws(
    () => emptyEventIndexerCheckpoint({ ...checkpointInput, finalityPolicyId: "unexpected" }),
    errorCode("INDEXER_CHECKPOINT_POLICY_INVALID"),
  );
  assert.throws(
    () =>
      emptyEventIndexerCheckpoint({
        ...checkpointInput,
        checkpointBasis: "externally-authenticated-finality",
      }),
    errorCode("INDEXER_CHECKPOINT_POLICY_INVALID"),
  );
  const external = emptyEventIndexerCheckpoint({
    ...checkpointInput,
    checkpointBasis: "externally-authenticated-finality",
    finalityPolicyId: "rpc.finalized-tag.authenticated.v1",
  });
  assert.equal(external.finalityPolicyId, "rpc.finalized-tag.authenticated.v1");
});
