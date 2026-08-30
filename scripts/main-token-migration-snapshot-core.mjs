import { createHash } from "node:crypto";

export const MAIN_TOKEN_MIGRATION_POLICY = Object.freeze({
  activationSchema: "programmable-main-token-migration-activation/v2",
  schema: "programmable-main-token-migration-snapshot/v2",
  releaseId: "v4-ethereum-to-robinhood-96h-2026-v1",
  chainId: 1n,
  ethereumGenesisHash:
    "0xd4e56740f876aef8c010b86a40d5f56745a118d0906a34e69aec8c0db1cb8fa3",
  tokenAddress: "0x7987f03462200b3D8A072E02C89A8A41dCB124EE",
  tokenRuntimeCodeKeccak256:
    "0x4fe466386aeebe507f6bcfc58e046a0632e4687699fa5bd28c4b7ec6333141ad",
  migrationWallet: "0x228Be90653fDDAa408fB6cf9ca0AEC311dbE9A0D",
  tokenSymbol: "V4",
  tokenDecimals: 18n,
  tokenTotalSupplyRaw: 1_000_000_000_000_000_000_000_000_000n,
  targetChainId: 4663n,
  targetTokenTotalSupplyRaw: 1_000_000_000_000_000_000_000_000_000n,
  windowSeconds: 96n * 60n * 60n,
  minimumPublicLeadSeconds: 15n * 60n,
  snapshotBoundaryRule: "first-canonical-block-at-or-after-timestamp",
  transferTopic:
    "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
  cutoffRule: "block.timestamp >= windowStart && block.timestamp < deadline",
  conversionRule: "1:1 raw token units",
});

const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;
const BYTES32 = /^0x[0-9a-fA-F]{64}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const BYTECODE = /^0x(?:[0-9a-fA-F]{2})*$/u;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/u;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_BYTES32 = `0x${"0".repeat(64)}`;
const ZERO_SHA256 = `sha256:${"0".repeat(64)}`;
const TARGET_DELIVERY_KEYS = Object.freeze([
  "chainId",
  "targetDesignSha256",
  "distributorAddress",
  "distributorRuntimeCodeKeccak256",
  "tokenAddress",
  "tokenRuntimeCodeKeccak256",
  "tokenTotalSupplyRaw",
].sort());
const UINT64_MASK = (1n << 64n) - 1n;
const KECCAK_RATE_BYTES = 136;
const KECCAK_ROTATIONS = Object.freeze([
  0, 1, 62, 28, 27,
  36, 44, 6, 55, 20,
  3, 10, 43, 25, 39,
  41, 45, 15, 21, 8,
  18, 2, 61, 56, 14,
]);
const KECCAK_ROUND_CONSTANTS = Object.freeze([
  0x0000000000000001n, 0x0000000000008082n,
  0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n,
  0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n,
  0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn,
  0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n,
  0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n,
  0x0000000080000001n, 0x8000000080008008n,
]);

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

function rotateLeft64(value, shift) {
  if (shift === 0) return value & UINT64_MASK;
  const offset = BigInt(shift);
  return ((value << offset) | (value >> (64n - offset))) & UINT64_MASK;
}

function keccakF1600(state) {
  for (const roundConstant of KECCAK_ROUND_CONSTANTS) {
    const columnParity = new Array(5);
    for (let x = 0; x < 5; x += 1) {
      columnParity[x] =
        state[x] ^ state[x + 5] ^ state[x + 10] ^ state[x + 15] ^ state[x + 20];
    }
    for (let x = 0; x < 5; x += 1) {
      const delta = columnParity[(x + 4) % 5] ^ rotateLeft64(columnParity[(x + 1) % 5], 1);
      for (let y = 0; y < 5; y += 1) state[x + 5 * y] ^= delta;
    }

    const rotated = new Array(25).fill(0n);
    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) {
        rotated[y + 5 * ((2 * x + 3 * y) % 5)] = rotateLeft64(
          state[x + 5 * y],
          KECCAK_ROTATIONS[x + 5 * y],
        );
      }
    }
    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) {
        const index = x + 5 * y;
        state[index] = (
          rotated[index] ^
          ((~rotated[(x + 1) % 5 + 5 * y]) & rotated[(x + 2) % 5 + 5 * y])
        ) & UINT64_MASK;
      }
    }
    state[0] ^= roundConstant;
  }
}

export function keccak256Bytecode(value) {
  if (!BYTECODE.test(value)) fail("token runtime bytecode is malformed");
  const bytes = Buffer.from(value.slice(2), "hex");
  const paddedLength = Math.ceil((bytes.length + 1) / KECCAK_RATE_BYTES) * KECCAK_RATE_BYTES;
  const padded = Buffer.alloc(paddedLength);
  bytes.copy(padded);
  padded[bytes.length] ^= 0x01;
  padded[padded.length - 1] ^= 0x80;

  const state = new Array(25).fill(0n);
  for (let offset = 0; offset < padded.length; offset += KECCAK_RATE_BYTES) {
    for (let index = 0; index < KECCAK_RATE_BYTES; index += 1) {
      state[Math.floor(index / 8)] ^=
        BigInt(padded[offset + index]) << (8n * BigInt(index % 8));
    }
    keccakF1600(state);
  }

  const output = Buffer.alloc(32);
  for (let index = 0; index < output.length; index += 1) {
    output[index] = Number(
      (state[Math.floor(index / 8)] >> (8n * BigInt(index % 8))) & 0xffn,
    );
  }
  return `0x${output.toString("hex")}`;
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

function normalizeSenderCodeObservation(value, index) {
  const label = `Sender code observation ${index}`;
  if (!exactPlainObject(value)) fail(`${label} is malformed`);
  const address = String(value.address ?? "");
  if (!ADDRESS.test(address)) fail(`${label}.address is malformed`);
  const runtimeCode = String(value.runtimeCode ?? "").toLowerCase();
  if (!BYTECODE.test(runtimeCode)) fail(`${label}.runtimeCode is malformed`);
  return {
    address: address.toLowerCase(),
    blockHash: exactHash(value.blockHash, `${label}.blockHash`),
    blockNumber: unsignedBigInt(value.blockNumber, `${label}.blockNumber`),
    runtimeCode,
  };
}

function normalizeTransactionSenderObservation(value, index) {
  const label = `Transaction sender observation ${index}`;
  if (!exactPlainObject(value)) fail(`${label} is malformed`);
  const from = String(value.from ?? "");
  if (!ADDRESS.test(from)) fail(`${label}.from is malformed`);
  return {
    blockHash: exactHash(value.blockHash, `${label}.blockHash`),
    blockNumber: unsignedBigInt(value.blockNumber, `${label}.blockNumber`),
    from: from.toLowerCase(),
    transactionHash: exactHash(
      value.transactionHash,
      `${label}.transactionHash`,
    ),
  };
}

function senderBlockKey(address, blockNumber) {
  return `${address}:${blockNumber.toString()}`;
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
    fail("deadline is not exactly 96 hours after the window start");
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
  const openingRuntimeCodeKeccak256 = keccak256Bytecode(openingRuntimeCode);
  const closingRuntimeCodeKeccak256 = keccak256Bytecode(closingRuntimeCode);
  if (
    openingRuntimeCodeKeccak256 !== MAIN_TOKEN_MIGRATION_POLICY.tokenRuntimeCodeKeccak256 ||
    closingRuntimeCodeKeccak256 !== MAIN_TOKEN_MIGRATION_POLICY.tokenRuntimeCodeKeccak256
  ) {
    fail("source token runtime bytecode does not match the frozen keccak256");
  }
  const openingWalletCode = String(input.openingWalletCode ?? "").toLowerCase();
  const closingWalletCode = String(input.closingWalletCode ?? "").toLowerCase();
  if (openingWalletCode !== "0x" || closingWalletCode !== "0x") {
    fail("migration wallet is not an unchanged plain Ethereum account");
  }
  const openingWalletTransactionCount = unsignedBigInt(
    input.openingWalletTransactionCount,
    "openingWalletTransactionCount",
  );
  const closingWalletTransactionCount = unsignedBigInt(
    input.closingWalletTransactionCount,
    "closingWalletTransactionCount",
  );
  if (openingWalletTransactionCount !== 0n || closingWalletTransactionCount !== 0n) {
    fail("migration wallet transaction count is not zero throughout the window");
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
  if (!Array.isArray(input.senderCodeObservations)) {
    fail("senderCodeObservations is not an array");
  }
  const requiredSenderBlocks = new Map();
  const requiredTransactions = new Map();
  for (const log of logs) {
    if (
      log.to !== migrationWallet ||
      log.from === migrationWallet ||
      log.from === ZERO_ADDRESS ||
      log.amountRaw === 0n
    ) {
      continue;
    }
    const key = senderBlockKey(log.from, log.blockNumber);
    const prior = requiredSenderBlocks.get(key);
    if (prior && prior.blockHash !== log.blockHash) {
      fail(`sender block ${key} has conflicting block hashes`);
    }
    if (!prior) {
      requiredSenderBlocks.set(key, {
        address: log.from,
        blockHash: log.blockHash,
        blockNumber: log.blockNumber,
      });
    }
    const priorTransaction = requiredTransactions.get(log.txHash);
    if (
      priorTransaction &&
      (
        priorTransaction.blockHash !== log.blockHash ||
        priorTransaction.blockNumber !== log.blockNumber
      )
    ) {
      fail(`transaction ${log.txHash} has conflicting block identity`);
    }
    if (!priorTransaction) {
      requiredTransactions.set(log.txHash, {
        blockHash: log.blockHash,
        blockNumber: log.blockNumber,
        transactionHash: log.txHash,
      });
    }
  }
  const senderCodeObservations = new Map();
  for (const [index, value] of input.senderCodeObservations.entries()) {
    const observation = normalizeSenderCodeObservation(value, index);
    const key = senderBlockKey(observation.address, observation.blockNumber);
    const required = requiredSenderBlocks.get(key);
    if (!required) fail(`Sender code observation ${index} is not required by an eligible transfer`);
    if (observation.blockHash !== required.blockHash) {
      fail(`Sender code observation ${index} block hash disagrees with its transfer`);
    }
    if (senderCodeObservations.has(key)) {
      fail(`sender code observation ${key} was provided more than once`);
    }
    senderCodeObservations.set(key, observation);
  }
  for (const key of requiredSenderBlocks.keys()) {
    if (!senderCodeObservations.has(key)) {
      fail(`sender code observation ${key} is missing`);
    }
  }
  if (!Array.isArray(input.transactionSenderObservations)) {
    fail("transactionSenderObservations is not an array");
  }
  const transactionSenderObservations = new Map();
  for (const [index, value] of input.transactionSenderObservations.entries()) {
    const observation = normalizeTransactionSenderObservation(value, index);
    const required = requiredTransactions.get(observation.transactionHash);
    if (!required) {
      fail(`Transaction sender observation ${index} is not required by an eligible transfer`);
    }
    if (
      observation.blockHash !== required.blockHash ||
      observation.blockNumber !== required.blockNumber
    ) {
      fail(`Transaction sender observation ${index} block identity disagrees with its transfer`);
    }
    if (transactionSenderObservations.has(observation.transactionHash)) {
      fail(`transaction sender observation ${observation.transactionHash} was provided more than once`);
    }
    transactionSenderObservations.set(observation.transactionHash, observation);
  }
  for (const transactionHash of requiredTransactions.keys()) {
    if (!transactionSenderObservations.has(transactionHash)) {
      fail(`transaction sender observation ${transactionHash} is missing`);
    }
  }

  const observationRows = [...senderCodeObservations.values()]
    .sort((left, right) => {
      const addressOrder = left.address.localeCompare(right.address);
      if (addressOrder !== 0) return addressOrder;
      return left.blockNumber < right.blockNumber
        ? -1
        : left.blockNumber > right.blockNumber
          ? 1
          : 0;
    })
    .map((observation) => ({
      address: observation.address,
      blockHash: observation.blockHash,
      blockNumber: observation.blockNumber.toString(),
      classification: observation.runtimeCode === "0x" ? "automatic" : "manual_review",
      runtimeCode: observation.runtimeCode,
    }));
  const observationsBySender = new Map();
  for (const observation of observationRows) {
    const prior = observationsBySender.get(observation.address) ?? [];
    prior.push(observation);
    observationsBySender.set(observation.address, prior);
  }

  const transactionObservationRows = [...transactionSenderObservations.values()]
    .sort((left, right) => left.transactionHash.localeCompare(right.transactionHash))
    .map((observation) => ({
      blockHash: observation.blockHash,
      blockNumber: observation.blockNumber.toString(),
      from: observation.from,
      transactionHash: observation.transactionHash,
    }));
  const transactionSenderMismatchCounts = new Map();
  for (const log of logs) {
    if (
      log.to !== migrationWallet ||
      log.from === migrationWallet ||
      log.from === ZERO_ADDRESS ||
      log.amountRaw === 0n
    ) {
      continue;
    }
    const observation = transactionSenderObservations.get(log.txHash);
    if (observation.from !== log.from) {
      transactionSenderMismatchCounts.set(
        log.from,
        (transactionSenderMismatchCounts.get(log.from) ?? 0n) + 1n,
      );
    }
  }

  const automaticAllocations = [];
  const manualReviewAllocations = [];
  for (const allocation of allocationRows) {
    const observations = observationsBySender.get(allocation.address) ?? [];
    const nonEmptyCodeObservationCount = observations.reduce(
      (count, observation) => count + (observation.runtimeCode === "0x" ? 0 : 1),
      0,
    );
    const transactionSenderMismatchEventCount =
      transactionSenderMismatchCounts.get(allocation.address) ?? 0n;
    if (
      nonEmptyCodeObservationCount === 0 &&
      transactionSenderMismatchEventCount === 0n
    ) {
      automaticAllocations.push(allocation);
    } else {
      const reviewReasons = [];
      if (nonEmptyCodeObservationCount > 0) reviewReasons.push("runtime_code_observed");
      if (transactionSenderMismatchEventCount > 0n) {
        reviewReasons.push("transaction_sender_mismatch");
      }
      manualReviewAllocations.push({
        ...allocation,
        nonEmptyCodeObservationCount: nonEmptyCodeObservationCount.toString(),
        reviewReasons,
        transactionSenderMismatchEventCount:
          transactionSenderMismatchEventCount.toString(),
      });
    }
  }
  const automaticAllocationRaw = automaticAllocations.reduce(
    (sum, allocation) => sum + BigInt(allocation.amountRaw),
    0n,
  );
  const manualReviewAllocationRaw = manualReviewAllocations.reduce(
    (sum, allocation) => sum + BigInt(allocation.amountRaw),
    0n,
  );
  const combinedAllocationRaw = automaticAllocationRaw + manualReviewAllocationRaw;
  if (combinedAllocationRaw !== inboundRaw) {
    fail("automatic and manual-review allocations do not reconcile with inbound transfers");
  }
  const eligibleEventCount = allocationRows.reduce(
    (sum, allocation) => sum + BigInt(allocation.eventCount),
    0n,
  );

  return {
    automaticAllocations,
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
      automaticAllocationCount: automaticAllocations.length.toString(),
      deduplicatedTransferEventCount: logs.length.toString(),
      eligibleInboundEventCount: eligibleEventCount.toString(),
      manualReviewAllocationCount: manualReviewAllocations.length.toString(),
      senderCodeObservationCount: observationRows.length.toString(),
      transactionSenderMismatchEventCount: [...transactionSenderMismatchCounts.values()]
        .reduce((sum, count) => sum + count, 0n)
        .toString(),
      transactionSenderObservationCount: transactionObservationRows.length.toString(),
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
      contractSenderHandling: "manual review; never automatically allocated",
      conversion: MAIN_TOKEN_MIGRATION_POLICY.conversionRule,
      custodyTypeObserved: "plain account with no runtime code",
      cutoff: MAIN_TOKEN_MIGRATION_POLICY.cutoffRule,
      snapshotBoundaryRule: MAIN_TOKEN_MIGRATION_POLICY.snapshotBoundaryRule,
      deadlineTimestampExclusive: deadlineTimestamp.toString(),
      migrationWallet,
      releaseId: MAIN_TOKEN_MIGRATION_POLICY.releaseId,
      sourceTokenAddress: tokenAddress,
      transactionSenderHandling:
        "automatic only when every Transfer.from equals its Ethereum transaction.from",
      windowDurationSeconds: MAIN_TOKEN_MIGRATION_POLICY.windowSeconds.toString(),
      windowStartTimestamp: windowStartTimestamp.toString(),
    },
    reconciliation: {
      automaticAllocationRaw: automaticAllocationRaw.toString(),
      closingBalanceRaw: closingBalanceRaw.toString(),
      combinedAllocationRaw: combinedAllocationRaw.toString(),
      expectedClosingBalanceRaw: expectedClosingBalanceRaw.toString(),
      inboundRaw: inboundRaw.toString(),
      manualReviewAllocationRaw: manualReviewAllocationRaw.toString(),
      matches: true,
      openingBalanceRaw: openingBalanceRaw.toString(),
      outboundRaw: outboundRaw.toString(),
    },
    manualReviewAllocations,
    migrationWalletEvidence: {
      address: migrationWallet,
      closingRuntimeCode: closingWalletCode,
      closingTransactionCount: closingWalletTransactionCount.toString(),
      openingRuntimeCode: openingWalletCode,
      openingTransactionCount: openingWalletTransactionCount.toString(),
    },
    schema: MAIN_TOKEN_MIGRATION_POLICY.schema,
    sourceToken: {
      address: tokenAddress,
      decimals: openingDecimals.toString(),
      runtimeCodeSha256: sha256Bytecode(openingRuntimeCode),
      runtimeCodeKeccak256: openingRuntimeCodeKeccak256,
      symbol: MAIN_TOKEN_MIGRATION_POLICY.tokenSymbol,
      totalSupplyRaw: openingTotalSupplyRaw.toString(),
    },
    senderCodeObservations: observationRows,
    transactionSenderObservations: transactionObservationRows,
  };
}

export function buildMainTokenMigrationSnapshotArtifact(
  snapshot,
  independentRpcAgreement,
  targetDelivery,
) {
  if (independentRpcAgreement !== true) {
    fail("two independent RPC snapshots were not confirmed byte-identical");
  }
  const targetDeliveryKeys = exactPlainObject(targetDelivery)
    ? Object.keys(targetDelivery).sort()
    : [];
  if (!exactPlainObject(targetDelivery) ||
    targetDeliveryKeys.length !== TARGET_DELIVERY_KEYS.length ||
    !targetDeliveryKeys.every(
      (key, index) => key === TARGET_DELIVERY_KEYS[index],
    ) ||
    typeof targetDelivery.chainId !== "bigint" ||
    targetDelivery.chainId !==
      MAIN_TOKEN_MIGRATION_POLICY.targetChainId ||
    typeof targetDelivery.tokenTotalSupplyRaw !== "bigint" ||
    targetDelivery.tokenTotalSupplyRaw !==
      MAIN_TOKEN_MIGRATION_POLICY.targetTokenTotalSupplyRaw ||
    typeof targetDelivery.tokenAddress !== "string" ||
    !ADDRESS.test(targetDelivery.tokenAddress) ||
    targetDelivery.tokenAddress.toLowerCase() === ZERO_ADDRESS ||
    typeof targetDelivery.tokenRuntimeCodeKeccak256 !== "string" ||
    !BYTES32.test(targetDelivery.tokenRuntimeCodeKeccak256) ||
    targetDelivery.tokenRuntimeCodeKeccak256.toLowerCase() === ZERO_BYTES32 ||
    typeof targetDelivery.distributorAddress !== "string" ||
    !ADDRESS.test(targetDelivery.distributorAddress) ||
    targetDelivery.distributorAddress.toLowerCase() === ZERO_ADDRESS ||
    targetDelivery.distributorAddress.toLowerCase() ===
      targetDelivery.tokenAddress.toLowerCase() ||
    typeof targetDelivery.distributorRuntimeCodeKeccak256 !== "string" ||
    !BYTES32.test(
      targetDelivery.distributorRuntimeCodeKeccak256,
    ) ||
    targetDelivery.distributorRuntimeCodeKeccak256.toLowerCase() ===
      ZERO_BYTES32 ||
    typeof targetDelivery.targetDesignSha256 !== "string" ||
    !SHA256.test(targetDelivery.targetDesignSha256) ||
    targetDelivery.targetDesignSha256 === ZERO_SHA256) {
    fail("target delivery commitment is incomplete or malformed");
  }
  const normalizedTargetDelivery = {
    chainId: MAIN_TOKEN_MIGRATION_POLICY.targetChainId.toString(),
    targetDesignSha256: targetDelivery.targetDesignSha256,
    distributorAddress: targetDelivery.distributorAddress.toLowerCase(),
    distributorRuntimeCodeKeccak256:
      targetDelivery.distributorRuntimeCodeKeccak256.toLowerCase(),
    tokenAddress: targetDelivery.tokenAddress.toLowerCase(),
    tokenRuntimeCodeKeccak256:
      targetDelivery.tokenRuntimeCodeKeccak256.toLowerCase(),
    tokenTotalSupplyRaw:
      MAIN_TOKEN_MIGRATION_POLICY.targetTokenTotalSupplyRaw.toString(),
  };
  return {
    canonicalization: "recursively sorted JSON object keys; UTF-8; no whitespace",
    rpcAgreement: {
      independentEndpointCount: "2",
      snapshotsIdentical: true,
    },
    snapshot,
    snapshotSha256: sha256CanonicalJson(snapshot),
    targetDelivery: normalizedTargetDelivery,
  };
}
