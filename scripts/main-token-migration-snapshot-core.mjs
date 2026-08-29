import { createHash } from "node:crypto";

export const MAIN_TOKEN_MIGRATION_POLICY = Object.freeze({
  schema: "programmable-main-token-migration-snapshot/v1",
  chainId: 1n,
  ethereumGenesisHash:
    "0xd4e56740f876aef8c010b86a40d5f56745a118d0906a34e69aec8c0db1cb8fa3",
  tokenAddress: "0x7987f03462200b3D8A072E02C89A8A41dCB124EE",
  migrationWallet: "0x14e24Ac373b3E65851627E4e757300Ac9053438C",
  tokenSymbol: "V4",
  tokenDecimals: 18n,
  tokenTotalSupplyRaw: 1_000_000_000_000_000_000_000_000_000n,
  windowSeconds: 72n * 60n * 60n,
  transferTopic:
    "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
  cutoffRule: "block.timestamp >= windowStart && block.timestamp < deadline",
  conversionRule: "1:1 raw token units",
});

const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;
const BYTES32 = /^0x[0-9a-fA-F]{64}$/u;
const BYTECODE = /^0x(?:[0-9a-fA-F]{2})*$/u;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/u;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

function fail(message) {
  throw new Error(`Migration snapshot rejected: ${message}`);
}

function exactPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function canonicalize(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("canonical JSON contains a non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalize(entry)).join(",")}]`;
  }
  if (!exactPlainObject(value)) {
    fail("canonical JSON contains a non-JSON value");
  }
  const entries = Object.keys(value).sort().map((key) => {
    const entry = value[key];
    if (entry === undefined || typeof entry === "bigint" || typeof entry === "function") {
      fail("canonical JSON contains an unsupported value");
    }
    return `${JSON.stringify(key)}:${canonicalize(entry)}`;
  });
  return `{${entries.join(",")}}`;
}

export function canonicalJson(value) {
  return canonicalize(value);
}

export function sha256CanonicalJson(value) {
  return `sha256:${createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")}`;
}

function sha256Bytecode(value) {
  if (!BYTECODE.test(value)) fail("token runtime bytecode is malformed");
  return `sha256:${createHash("sha256").update(Buffer.from(value.slice(2), "hex")).digest("hex")}`;
}

function unsignedBigInt(value, label) {
  if (typeof value === "bigint") {
    if (value < 0n) fail(`${label} is negative`);
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) fail(`${label} is not a safe unsigned integer`);
    return BigInt(value);
  }
  if (typeof value === "string" && DECIMAL.test(value)) return BigInt(value);
  fail(`${label} is not an unsigned decimal integer`);
}

function exactAddress(value, expected, label) {
  if (!ADDRESS.test(String(value ?? ""))) fail(`${label} is malformed`);
  if (value.toLowerCase() !== expected.toLowerCase()) fail(`${label} is not the frozen address`);
  return expected.toLowerCase();
}

function exactHash(value, label) {
  if (!BYTES32.test(String(value ?? ""))) fail(`${label} is malformed`);
  return value.toLowerCase();
}

function normalizeBlock(value, label) {
  if (!exactPlainObject(value)) fail(`${label} is unavailable`);
  return {
    number: unsignedBigInt(value.number, `${label}.number`),
    hash: exactHash(value.hash, `${label}.hash`),
    parentHash: exactHash(value.parentHash, `${label}.parentHash`),
    timestamp: unsignedBigInt(value.timestamp, `${label}.timestamp`),
  };
}

function blockOutput(block) {
  return {
    hash: block.hash,
    number: block.number.toString(),
    parentHash: block.parentHash,
    timestamp: block.timestamp.toString(),
  };
}

function topicAddress(topic, label) {
  const normalized = exactHash(topic, label);
  if (normalized.slice(2, 26) !== "0".repeat(24)) {
    fail(`${label} is not a canonically padded address`);
  }
  return `0x${normalized.slice(26)}`;
}

function normalizeLog(value, index) {
  const label = `Transfer log ${index}`;
  if (!exactPlainObject(value)) fail(`${label} is malformed`);
  if (value.removed !== false) fail(`${label} is removed or lacks a removal marker`);
  exactAddress(value.address, MAIN_TOKEN_MIGRATION_POLICY.tokenAddress, `${label}.address`);
  if (!Array.isArray(value.topics) || value.topics.length !== 3) {
    fail(`${label} does not have exactly three topics`);
  }
  const topic0 = exactHash(value.topics[0], `${label}.topics[0]`);
  if (topic0 !== MAIN_TOKEN_MIGRATION_POLICY.transferTopic) {
    fail(`${label} is not the standard ERC-20 Transfer event`);
  }
  const data = exactHash(value.data, `${label}.data`);
  const txHash = exactHash(value.transactionHash, `${label}.transactionHash`);
  const blockHash = exactHash(value.blockHash, `${label}.blockHash`);
  const blockNumber = unsignedBigInt(value.blockNumber, `${label}.blockNumber`);
  const transactionIndex = unsignedBigInt(
    value.transactionIndex,
    `${label}.transactionIndex`,
  );
  const logIndex = unsignedBigInt(value.logIndex, `${label}.logIndex`);
  return {
    address: MAIN_TOKEN_MIGRATION_POLICY.tokenAddress.toLowerCase(),
    amountRaw: BigInt(data),
    blockHash,
    blockNumber,
    data,
    from: topicAddress(value.topics[1], `${label}.topics[1]`),
    logIndex,
    to: topicAddress(value.topics[2], `${label}.topics[2]`),
    topic0,
    transactionIndex,
    txHash,
  };
}

function normalizedLogFingerprint(log) {
  return [
    log.address,
    log.topic0,
    log.from,
    log.to,
    log.data,
    log.blockNumber.toString(),
    log.blockHash,
    log.transactionIndex.toString(),
    log.logIndex.toString(),
    log.txHash,
  ].join("|");
}

function compareLogs(left, right) {
  if (left.blockNumber !== right.blockNumber) {
    return left.blockNumber < right.blockNumber ? -1 : 1;
  }
  if (left.transactionIndex !== right.transactionIndex) {
    return left.transactionIndex < right.transactionIndex ? -1 : 1;
  }
  if (left.logIndex !== right.logIndex) return left.logIndex < right.logIndex ? -1 : 1;
  return left.txHash.localeCompare(right.txHash);
}

function validateWindow({
  previousBlock,
  startBlock,
  endBlock,
  boundaryBlock,
  finalizedBlock,
  windowStartTimestamp,
  deadlineTimestamp,
}) {
  if (windowStartTimestamp + MAIN_TOKEN_MIGRATION_POLICY.windowSeconds !== deadlineTimestamp) {
    fail("deadline is not exactly 72 hours after the window start");
  }
  if (previousBlock.number + 1n !== startBlock.number) {
    fail("start block is not immediately after the opening-balance block");
  }
  if (endBlock.number + 1n !== boundaryBlock.number) {
    fail("boundary block is not immediately after the end block");
  }
  if (startBlock.number > endBlock.number) fail("start block is after end block");
  if (startBlock.parentHash !== previousBlock.hash) fail("start block ancestry is inconsistent");
  if (boundaryBlock.parentHash !== endBlock.hash) fail("deadline block ancestry is inconsistent");
  if (!(previousBlock.timestamp < windowStartTimestamp)) {
    fail("opening-balance block is not before the window start");
  }
  if (!(startBlock.timestamp >= windowStartTimestamp)) {
    fail("start block is before the window start");
  }
  if (!(endBlock.timestamp < deadlineTimestamp)) {
    fail("end block is not before the exclusive deadline");
  }
  if (!(boundaryBlock.timestamp >= deadlineTimestamp)) {
    fail("boundary block does not reach the exclusive deadline");
  }
  if (finalizedBlock.number < boundaryBlock.number) {
    fail("deadline boundary is not finalized");
  }
  if (finalizedBlock.timestamp < boundaryBlock.timestamp) {
    fail("finalized head timestamp is behind the deadline boundary");
  }
}

export function buildMainTokenMigrationSnapshot(input) {
  if (!exactPlainObject(input)) fail("input is malformed");
  const chainId = unsignedBigInt(input.chainId, "chainId");
  if (chainId !== MAIN_TOKEN_MIGRATION_POLICY.chainId) fail("chainId is not Ethereum mainnet");
  const genesisHash = exactHash(input.genesisHash, "genesisHash");
  if (genesisHash !== MAIN_TOKEN_MIGRATION_POLICY.ethereumGenesisHash) {
    fail("genesis hash is not Ethereum mainnet");
  }
  const tokenAddress = exactAddress(
    input.tokenAddress,
    MAIN_TOKEN_MIGRATION_POLICY.tokenAddress,
    "tokenAddress",
  );
  const migrationWallet = exactAddress(
    input.migrationWallet,
    MAIN_TOKEN_MIGRATION_POLICY.migrationWallet,
    "migrationWallet",
  );
  const windowStartTimestamp = unsignedBigInt(
    input.windowStartTimestamp,
    "windowStartTimestamp",
  );
  const deadlineTimestamp = unsignedBigInt(input.deadlineTimestamp, "deadlineTimestamp");
  const previousBlock = normalizeBlock(input.previousBlock, "previousBlock");
  const startBlock = normalizeBlock(input.startBlock, "startBlock");
  const endBlock = normalizeBlock(input.endBlock, "endBlock");
  const boundaryBlock = normalizeBlock(input.boundaryBlock, "boundaryBlock");
  const finalizedBlock = normalizeBlock(input.finalizedBlock, "finalizedBlock");
  validateWindow({
    previousBlock,
    startBlock,
    endBlock,
    boundaryBlock,
    finalizedBlock,
    windowStartTimestamp,
    deadlineTimestamp,
  });

  const openingRuntimeCode = String(input.openingRuntimeCode ?? "").toLowerCase();
  const closingRuntimeCode = String(input.closingRuntimeCode ?? "").toLowerCase();
  if (!BYTECODE.test(openingRuntimeCode) || openingRuntimeCode === "0x") {
    fail("source token has no valid opening runtime bytecode");
  }
  if (closingRuntimeCode !== openingRuntimeCode) {
    fail("source token runtime bytecode changed during the window");
  }
  const openingWalletCode = String(input.openingWalletCode ?? "").toLowerCase();
  const closingWalletCode = String(input.closingWalletCode ?? "").toLowerCase();
  if (openingWalletCode !== "0x" || closingWalletCode !== "0x") {
    fail("migration wallet is not an unchanged plain Ethereum account");
  }
  const openingDecimals = unsignedBigInt(input.openingDecimals, "openingDecimals");
  const closingDecimals = unsignedBigInt(input.closingDecimals, "closingDecimals");
  if (
    openingDecimals !== MAIN_TOKEN_MIGRATION_POLICY.tokenDecimals ||
    closingDecimals !== MAIN_TOKEN_MIGRATION_POLICY.tokenDecimals
  ) {
    fail("source token decimals are not the frozen value");
  }
  const openingTotalSupplyRaw = unsignedBigInt(
    input.openingTotalSupplyRaw,
    "openingTotalSupplyRaw",
  );
  const closingTotalSupplyRaw = unsignedBigInt(
    input.closingTotalSupplyRaw,
    "closingTotalSupplyRaw",
  );
  if (
    openingTotalSupplyRaw !== MAIN_TOKEN_MIGRATION_POLICY.tokenTotalSupplyRaw ||
    closingTotalSupplyRaw !== MAIN_TOKEN_MIGRATION_POLICY.tokenTotalSupplyRaw
  ) {
    fail("source token total supply is not the frozen value");
  }

  const openingBalanceRaw = unsignedBigInt(input.openingBalanceRaw, "openingBalanceRaw");
  const closingBalanceRaw = unsignedBigInt(input.closingBalanceRaw, "closingBalanceRaw");
  if (openingBalanceRaw !== 0n) fail("migration wallet opening V4 balance is nonzero");

  const allInputLogs = [
    ...(Array.isArray(input.inboundLogs) ? input.inboundLogs : fail("inboundLogs is not an array")),
    ...(Array.isArray(input.outboundLogs) ? input.outboundLogs : fail("outboundLogs is not an array")),
  ];
  const deduplicated = new Map();
  for (const [index, value] of allInputLogs.entries()) {
    const log = normalizeLog(value, index);
    if (log.blockNumber < startBlock.number || log.blockNumber > endBlock.number) {
      fail(`Transfer log ${index} is outside the frozen block range`);
    }
    const key = `${log.txHash}:${log.logIndex.toString()}`;
    const prior = deduplicated.get(key);
    if (prior && normalizedLogFingerprint(prior) !== normalizedLogFingerprint(log)) {
      fail(`duplicate ${key} has conflicting event bytes`);
    }
    if (!prior) deduplicated.set(key, log);
  }
  const logs = [...deduplicated.values()].sort(compareLogs);

  let inboundRaw = 0n;
  let outboundRaw = 0n;
  let zeroValueEventCount = 0n;
  const allocations = new Map();
  const eventRows = [];
  for (const log of logs) {
    const fromWallet = log.from === migrationWallet;
    const toWallet = log.to === migrationWallet;
    if (!fromWallet && !toWallet) fail("Transfer log does not involve the migration wallet");
    const direction = fromWallet && toWallet ? "self" : toWallet ? "inbound" : "outbound";
    if (log.amountRaw === 0n) zeroValueEventCount += 1n;
    if (direction === "self" && log.amountRaw > 0n) {
      fail("migration wallet has a nonzero self-transfer in the window");
    }
    if (direction === "inbound") {
      if (log.from === ZERO_ADDRESS && log.amountRaw > 0n) {
        fail("migration wallet received a nonzero mint in the window");
      }
      inboundRaw += log.amountRaw;
      if (log.amountRaw > 0n) {
        const prior = allocations.get(log.from) ?? { amountRaw: 0n, eventCount: 0n };
        prior.amountRaw += log.amountRaw;
        prior.eventCount += 1n;
        allocations.set(log.from, prior);
      }
    }
    if (direction === "outbound") outboundRaw += log.amountRaw;
    eventRows.push({
      amountRaw: log.amountRaw.toString(),
      blockHash: log.blockHash,
      blockNumber: log.blockNumber.toString(),
      dedupeKey: `${log.txHash}:${log.logIndex.toString()}`,
      direction,
      from: log.from,
      logIndex: log.logIndex.toString(),
      to: log.to,
      transactionHash: log.txHash,
      transactionIndex: log.transactionIndex.toString(),
    });
  }
  if (outboundRaw > 0n) fail("migration wallet has a nonzero outbound transfer in the window");
  const expectedClosingBalanceRaw = openingBalanceRaw + inboundRaw - outboundRaw;
  if (expectedClosingBalanceRaw !== closingBalanceRaw) {
    fail("Transfer logs do not reconcile with the migration wallet V4 balance");
  }

  const allocationRows = [...allocations.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([address, allocation]) => ({
      address,
      amountRaw: allocation.amountRaw.toString(),
      eventCount: allocation.eventCount.toString(),
    }));
  const eligibleEventCount = allocationRows.reduce(
    (sum, allocation) => sum + BigInt(allocation.eventCount),
    0n,
  );

  return {
    allocations: allocationRows,
    anchors: {
      boundaryBlock: blockOutput(boundaryBlock),
      endBlock: blockOutput(endBlock),
      openingBalanceBlock: blockOutput(previousBlock),
      startBlock: blockOutput(startBlock),
    },
    chain: {
      genesisHash,
      id: chainId.toString(),
      name: "Ethereum Mainnet",
    },
    counts: {
      allocationCount: allocationRows.length.toString(),
      deduplicatedTransferEventCount: logs.length.toString(),
      eligibleInboundEventCount: eligibleEventCount.toString(),
      zeroValueEventCount: zeroValueEventCount.toString(),
    },
    events: eventRows,
    finality: {
      requiredThroughBlockHash: boundaryBlock.hash,
      requiredThroughBlockNumber: boundaryBlock.number.toString(),
      status: "verified",
    },
    policy: {
      beneficiary: "ERC-20 Transfer event from address",
      conversion: MAIN_TOKEN_MIGRATION_POLICY.conversionRule,
      custodyTypeObserved: "plain account with no runtime code",
      cutoff: MAIN_TOKEN_MIGRATION_POLICY.cutoffRule,
      deadlineTimestampExclusive: deadlineTimestamp.toString(),
      migrationWallet,
      sourceTokenAddress: tokenAddress,
      windowDurationSeconds: MAIN_TOKEN_MIGRATION_POLICY.windowSeconds.toString(),
      windowStartTimestamp: windowStartTimestamp.toString(),
    },
    reconciliation: {
      closingBalanceRaw: closingBalanceRaw.toString(),
      expectedClosingBalanceRaw: expectedClosingBalanceRaw.toString(),
      inboundRaw: inboundRaw.toString(),
      matches: true,
      openingBalanceRaw: openingBalanceRaw.toString(),
      outboundRaw: outboundRaw.toString(),
    },
    schema: MAIN_TOKEN_MIGRATION_POLICY.schema,
    sourceToken: {
      address: tokenAddress,
      decimals: openingDecimals.toString(),
      runtimeCodeSha256: sha256Bytecode(openingRuntimeCode),
      symbol: MAIN_TOKEN_MIGRATION_POLICY.tokenSymbol,
      totalSupplyRaw: openingTotalSupplyRaw.toString(),
    },
  };
}

export function buildMainTokenMigrationSnapshotArtifact(
  snapshot,
  independentRpcAgreement,
) {
  if (independentRpcAgreement !== true) {
    fail("two independent RPC snapshots were not confirmed byte-identical");
  }
  return {
    canonicalization: "recursively sorted JSON object keys; UTF-8; no whitespace",
    rpcAgreement: {
      independentEndpointCount: "2",
      snapshotsIdentical: true,
    },
    snapshot,
    snapshotSha256: sha256CanonicalJson(snapshot),
  };
}
