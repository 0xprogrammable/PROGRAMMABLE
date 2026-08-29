#!/usr/bin/env node

import { readBoundedResponseText } from "./read-bounded-response.mjs";
import {
  MAIN_TOKEN_MIGRATION_POLICY,
  buildMainTokenMigrationSnapshot,
  buildMainTokenMigrationSnapshotArtifact,
  canonicalJson,
} from "./main-token-migration-snapshot-core.mjs";

const PRIMARY_RPC_ENV = "MAIN_TOKEN_MIGRATION_RPC_URL_PRIMARY";
const SECONDARY_RPC_ENV = "MAIN_TOKEN_MIGRATION_RPC_URL_SECONDARY";
const RPC_TIMEOUT_MS = 30_000;
const RPC_MAXIMUM_RESPONSE_BYTES = 16 * 1024 * 1024;
const DEFAULT_CHUNK_SIZE = 5_000n;
const MAXIMUM_CHUNK_SIZE = 10_000n;
const READ_ONLY_RPC_METHODS = new Set([
  "eth_call",
  "eth_chainId",
  "eth_getBlockByNumber",
  "eth_getCode",
  "eth_getLogs",
]);
const RPC_QUANTITY = /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/u;
const ABI_WORD = /^0x[0-9a-fA-F]{64}$/u;
const BYTECODE = /^0x(?:[0-9a-fA-F]{2})*$/u;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/u;

const USAGE = `Usage:
  ${process.argv[1] ?? "scripts/main-token-migration-snapshot.mjs"} \\
    --start-block <decimal> \\
    --end-block <decimal> \\
    --window-start-timestamp <unix-seconds> \\
    --deadline-timestamp <unix-seconds> \\
    [--chunk-size <1..10000>]

Required environment variables:
  ${PRIMARY_RPC_ENV}
  ${SECONDARY_RPC_ENV}

The two HTTPS origins must be different. The command performs only the
read-only JSON-RPC methods eth_call, eth_chainId, eth_getBlockByNumber,
eth_getCode, and eth_getLogs. It never signs or broadcasts a transaction.

The deadline is exclusive: a Transfer qualifies only when its canonical
Ethereum block timestamp is >= the window start and < the deadline.`;

function reject(message) {
  throw new Error(`Migration snapshot scanner rejected: ${message}`);
}

function parseDecimal(value, label) {
  if (!DECIMAL.test(String(value ?? ""))) reject(`${label} must be an unsigned decimal integer`);
  return BigInt(value);
}

function parseArguments(argv) {
  if (argv.includes("--help")) return { help: true };
  const allowed = new Set([
    "--chunk-size",
    "--deadline-timestamp",
    "--end-block",
    "--start-block",
    "--window-start-timestamp",
  ]);
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!allowed.has(flag)) reject(`unknown argument ${String(flag)}`);
    if (value === undefined || value.startsWith("--")) reject(`${flag} requires a value`);
    if (values.has(flag)) reject(`${flag} was provided more than once`);
    values.set(flag, value);
  }
  for (const flag of [
    "--deadline-timestamp",
    "--end-block",
    "--start-block",
    "--window-start-timestamp",
  ]) {
    if (!values.has(flag)) reject(`${flag} is required`);
  }
  const startBlock = parseDecimal(values.get("--start-block"), "--start-block");
  const endBlock = parseDecimal(values.get("--end-block"), "--end-block");
  if (startBlock === 0n) reject("--start-block must leave a prior opening-balance block");
  if (endBlock < startBlock) reject("--end-block must be at or after --start-block");
  const chunkSize = parseDecimal(
    values.get("--chunk-size") ?? DEFAULT_CHUNK_SIZE.toString(),
    "--chunk-size",
  );
  if (chunkSize === 0n || chunkSize > MAXIMUM_CHUNK_SIZE) {
    reject("--chunk-size must be between 1 and 10000 blocks");
  }
  return {
    chunkSize,
    deadlineTimestamp: parseDecimal(
      values.get("--deadline-timestamp"),
      "--deadline-timestamp",
    ),
    endBlock,
    help: false,
    startBlock,
    windowStartTimestamp: parseDecimal(
      values.get("--window-start-timestamp"),
      "--window-start-timestamp",
    ),
  };
}

function rpcUrlFromEnvironment(name) {
  const raw = process.env[name];
  if (!raw) reject(`${name} is required`);
  let url;
  try {
    url = new URL(raw);
  } catch {
    reject(`${name} is not a valid URL`);
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== ""
  ) {
    reject(`${name} must be an HTTPS URL without embedded credentials or a fragment`);
  }
  return url;
}

function parseRpcQuantity(value, label) {
  if (!RPC_QUANTITY.test(String(value ?? ""))) reject(`${label} is not a canonical RPC quantity`);
  return BigInt(value);
}

function rpcQuantity(value) {
  return `0x${value.toString(16)}`;
}

function parseRpcBlock(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    reject(`${label} is unavailable`);
  }
  return {
    hash: String(value.hash ?? ""),
    number: parseRpcQuantity(value.number, `${label}.number`),
    parentHash: String(value.parentHash ?? ""),
    timestamp: parseRpcQuantity(value.timestamp, `${label}.timestamp`),
  };
}

function normalizeRpcLog(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    reject(`${label} is malformed`);
  }
  return {
    address: value.address,
    blockHash: value.blockHash,
    blockNumber: parseRpcQuantity(value.blockNumber, `${label}.blockNumber`),
    data: value.data,
    logIndex: parseRpcQuantity(value.logIndex, `${label}.logIndex`),
    removed: value.removed,
    topics: value.topics,
    transactionHash: value.transactionHash,
    transactionIndex: parseRpcQuantity(value.transactionIndex, `${label}.transactionIndex`),
  };
}

function blockReference(block) {
  return rpcQuantity(block.number);
}

function paddedAddressTopic(address) {
  return `0x${"0".repeat(24)}${address.slice(2).toLowerCase()}`;
}

function balanceOfCallData(address) {
  return `0x70a08231${"0".repeat(24)}${address.slice(2).toLowerCase()}`;
}

async function jsonRpc(url, state, method, params) {
  if (!READ_ONLY_RPC_METHODS.has(method)) reject(`RPC method ${method} is not read-only allowlisted`);
  state.requestId += 1;
  const requestId = state.requestId;
  let response;
  try {
    response = await fetch(url, {
      body: JSON.stringify({ id: requestId, jsonrpc: "2.0", method, params }),
      headers: { "content-type": "application/json" },
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
    });
  } catch {
    reject(`${state.label} failed during ${method}`);
  }
  const text = await readBoundedResponseText(response, {
    label: `${state.label} ${method} response`,
    maximumBytes: RPC_MAXIMUM_RESPONSE_BYTES,
  });
  if (!response.ok) reject(`${state.label} returned HTTP ${response.status} for ${method}`);
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    reject(`${state.label} returned invalid JSON for ${method}`);
  }
  if (
    payload === null ||
    typeof payload !== "object" ||
    Array.isArray(payload) ||
    payload.jsonrpc !== "2.0" ||
    payload.id !== requestId
  ) {
    reject(`${state.label} returned an invalid JSON-RPC envelope for ${method}`);
  }
  if (payload.error !== undefined) {
    const code = Number.isSafeInteger(payload.error?.code) ? ` (${payload.error.code})` : "";
    reject(`${state.label} returned a JSON-RPC error${code} for ${method}`);
  }
  if (!("result" in payload)) reject(`${state.label} omitted the result for ${method}`);
  return payload.result;
}

async function getBlock(url, state, blockTag, label) {
  return parseRpcBlock(
    await jsonRpc(url, state, "eth_getBlockByNumber", [blockTag, false]),
    label,
  );
}

async function getCode(url, state, address, block, label) {
  const result = String(
    await jsonRpc(url, state, "eth_getCode", [address, blockReference(block)]),
  ).toLowerCase();
  if (!BYTECODE.test(result)) reject(`${label} is malformed`);
  return result;
}

async function tokenWord(url, state, data, block, label) {
  const result = String(
    await jsonRpc(url, state, "eth_call", [
      { data, to: MAIN_TOKEN_MIGRATION_POLICY.tokenAddress },
      blockReference(block),
    ]),
  );
  if (!ABI_WORD.test(result)) reject(`${label} is not one ABI word`);
  return BigInt(result);
}

async function scanLogs(url, state, startBlock, endBlock, chunkSize, topics, label) {
  const logs = [];
  for (let fromBlock = startBlock; fromBlock <= endBlock; fromBlock += chunkSize) {
    const toBlock = fromBlock + chunkSize - 1n < endBlock
      ? fromBlock + chunkSize - 1n
      : endBlock;
    const result = await jsonRpc(url, state, "eth_getLogs", [{
      address: MAIN_TOKEN_MIGRATION_POLICY.tokenAddress,
      fromBlock: rpcQuantity(fromBlock),
      toBlock: rpcQuantity(toBlock),
      topics,
    }]);
    if (!Array.isArray(result)) reject(`${state.label} returned a non-array ${label} log result`);
    for (const [index, log] of result.entries()) {
      logs.push(normalizeRpcLog(log, `${state.label} ${label} log ${index}`));
    }
  }
  return logs;
}

function requireBlockNumber(block, expected, label) {
  if (block.number !== expected) reject(`${label} number does not match the explicit argument`);
}

async function snapshotFromProvider(url, label, options) {
  const state = { label, requestId: 0 };
  const chainId = parseRpcQuantity(
    await jsonRpc(url, state, "eth_chainId", []),
    `${label}.chainId`,
  );
  const genesisBlock = await getBlock(url, state, "0x0", `${label}.genesisBlock`);
  const previousBlock = await getBlock(
    url,
    state,
    rpcQuantity(options.startBlock - 1n),
    `${label}.previousBlock`,
  );
  const startBlock = await getBlock(
    url,
    state,
    rpcQuantity(options.startBlock),
    `${label}.startBlock`,
  );
  const endBlock = await getBlock(
    url,
    state,
    rpcQuantity(options.endBlock),
    `${label}.endBlock`,
  );
  const boundaryBlock = await getBlock(
    url,
    state,
    rpcQuantity(options.endBlock + 1n),
    `${label}.boundaryBlock`,
  );
  const finalizedBlock = await getBlock(url, state, "finalized", `${label}.finalizedBlock`);
  requireBlockNumber(genesisBlock, 0n, `${label}.genesisBlock`);
  requireBlockNumber(previousBlock, options.startBlock - 1n, `${label}.previousBlock`);
  requireBlockNumber(startBlock, options.startBlock, `${label}.startBlock`);
  requireBlockNumber(endBlock, options.endBlock, `${label}.endBlock`);
  requireBlockNumber(boundaryBlock, options.endBlock + 1n, `${label}.boundaryBlock`);

  const walletTopic = paddedAddressTopic(MAIN_TOKEN_MIGRATION_POLICY.migrationWallet);
  const inboundLogs = await scanLogs(
    url,
    state,
    options.startBlock,
    options.endBlock,
    options.chunkSize,
    [MAIN_TOKEN_MIGRATION_POLICY.transferTopic, null, walletTopic],
    "inbound",
  );
  const outboundLogs = await scanLogs(
    url,
    state,
    options.startBlock,
    options.endBlock,
    options.chunkSize,
    [MAIN_TOKEN_MIGRATION_POLICY.transferTopic, walletTopic],
    "outbound",
  );
  const balanceCallData = balanceOfCallData(MAIN_TOKEN_MIGRATION_POLICY.migrationWallet);
  const [
    openingRuntimeCode,
    closingRuntimeCode,
    openingWalletCode,
    closingWalletCode,
    openingDecimals,
    closingDecimals,
    openingTotalSupplyRaw,
    closingTotalSupplyRaw,
    openingBalanceRaw,
    closingBalanceRaw,
  ] = await Promise.all([
    getCode(
      url,
      state,
      MAIN_TOKEN_MIGRATION_POLICY.tokenAddress,
      previousBlock,
      `${label}.openingRuntimeCode`,
    ),
    getCode(
      url,
      state,
      MAIN_TOKEN_MIGRATION_POLICY.tokenAddress,
      endBlock,
      `${label}.closingRuntimeCode`,
    ),
    getCode(
      url,
      state,
      MAIN_TOKEN_MIGRATION_POLICY.migrationWallet,
      previousBlock,
      `${label}.openingWalletCode`,
    ),
    getCode(
      url,
      state,
      MAIN_TOKEN_MIGRATION_POLICY.migrationWallet,
      endBlock,
      `${label}.closingWalletCode`,
    ),
    tokenWord(url, state, "0x313ce567", previousBlock, `${label}.openingDecimals`),
    tokenWord(url, state, "0x313ce567", endBlock, `${label}.closingDecimals`),
    tokenWord(url, state, "0x18160ddd", previousBlock, `${label}.openingTotalSupplyRaw`),
    tokenWord(url, state, "0x18160ddd", endBlock, `${label}.closingTotalSupplyRaw`),
    tokenWord(url, state, balanceCallData, previousBlock, `${label}.openingBalanceRaw`),
    tokenWord(url, state, balanceCallData, endBlock, `${label}.closingBalanceRaw`),
  ]);

  return buildMainTokenMigrationSnapshot({
    boundaryBlock,
    chainId,
    closingBalanceRaw,
    closingDecimals,
    closingRuntimeCode,
    closingTotalSupplyRaw,
    closingWalletCode,
    deadlineTimestamp: options.deadlineTimestamp,
    endBlock,
    finalizedBlock,
    genesisHash: genesisBlock.hash,
    inboundLogs,
    migrationWallet: MAIN_TOKEN_MIGRATION_POLICY.migrationWallet,
    openingBalanceRaw,
    openingDecimals,
    openingRuntimeCode,
    openingTotalSupplyRaw,
    openingWalletCode,
    outboundLogs,
    previousBlock,
    startBlock,
    tokenAddress: MAIN_TOKEN_MIGRATION_POLICY.tokenAddress,
    windowStartTimestamp: options.windowStartTimestamp,
  });
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  const primaryUrl = rpcUrlFromEnvironment(PRIMARY_RPC_ENV);
  const secondaryUrl = rpcUrlFromEnvironment(SECONDARY_RPC_ENV);
  if (primaryUrl.origin === secondaryUrl.origin) {
    reject("primary and secondary RPC endpoints must have different HTTPS origins");
  }
  const [primarySnapshot, secondarySnapshot] = await Promise.all([
    snapshotFromProvider(primaryUrl, "primary RPC", options),
    snapshotFromProvider(secondaryUrl, "secondary RPC", options),
  ]);
  if (canonicalJson(primarySnapshot) !== canonicalJson(secondarySnapshot)) {
    reject("independent RPC snapshots disagree");
  }
  process.stdout.write(
    `${canonicalJson(
      buildMainTokenMigrationSnapshotArtifact(primarySnapshot, true),
    )}\n`,
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "Migration snapshot scanner failed";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
