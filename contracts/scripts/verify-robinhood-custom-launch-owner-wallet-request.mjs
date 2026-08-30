#!/usr/bin/env node

import { constants as fsConstants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseStrictJson } from "../../packages/launch/src/canonical-json.mjs";
import { decodeExactUtf8 } from "../../packages/launch/src/io.mjs";
import {
  assertFreshRobinhoodFoundationOwnerEnvelope,
  assertRobinhoodFoundationRpcProviders,
  verifyRobinhoodFoundationOwnerWalletActionTimeState,
} from "./robinhood-custom-launch-owner-envelope-core.mjs";
import {
  exactRobinhoodFoundationSourceIdentity,
  resolveRobinhoodFoundationHostedVerify,
} from "./refresh-robinhood-custom-launch-owner-envelope.mjs";

export const ROBINHOOD_OWNER_WALLET_REQUEST_SCHEMA =
  "programmable.robinhood-custom-launch.owner-wallet-request.v1";

const MAXIMUM_ENVELOPE_BYTES = 2 * 1024 * 1024;
const MAXIMUM_WALLET_REQUEST_BYTES = 128 * 1024;

function fail(message) {
  throw new Error(message);
}

function exactKeys(value, expected, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join("\0") !== [...expected].sort().join("\0")
  ) {
    fail(`${label} has an invalid exact key inventory`);
  }
}

function usage() {
  return (
    "Usage: verify-robinhood-custom-launch-owner-wallet-request.mjs " +
    "--envelope /absolute/protected/envelope.json " +
    "--wallet-request /absolute/protected/wallet-request.json"
  );
}

export function parseRobinhoodOwnerWalletRequestCli(argv) {
  if (!Array.isArray(argv) || argv.length !== 4) fail(usage());
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (
      !new Set(["--envelope", "--wallet-request"]).has(flag) ||
      values.has(flag) ||
      typeof value !== "string" ||
      !path.isAbsolute(value)
    ) {
      fail(usage());
    }
    values.set(flag, value);
  }
  if (values.size !== 2) fail(usage());
  return {
    envelopePath: values.get("--envelope"),
    walletRequestPath: values.get("--wallet-request"),
  };
}

async function readProtectedCanonicalJson({
  configuredRoot,
  candidate,
  maximumBytes,
  label,
}) {
  if (!path.isAbsolute(configuredRoot ?? "") || !path.isAbsolute(candidate)) {
    fail(`${label} path and owner-envelope root must be absolute`);
  }
  const [root, rootMetadata] = await Promise.all([
    realpath(configuredRoot),
    lstat(configuredRoot),
  ]);
  const canonicalCandidate = path.join(root, path.basename(candidate));
  if (
    rootMetadata.isSymbolicLink() ||
    !rootMetadata.isDirectory() ||
    rootMetadata.uid !== process.getuid() ||
    (rootMetadata.mode & 0o777) !== 0o700 ||
    candidate !== canonicalCandidate ||
    path.dirname(candidate) !== root
  ) {
    fail(`${label} must be directly inside the real owner-only 0700 root`);
  }
  let handle;
  try {
    handle = await open(candidate, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const [metadata, pathMetadata] = await Promise.all([
      handle.stat(),
      lstat(candidate),
    ]);
    if (
      !metadata.isFile() ||
      metadata.size < 1 ||
      metadata.size > maximumBytes ||
      metadata.nlink !== 1 ||
      metadata.uid !== process.getuid() ||
      (metadata.mode & 0o777) !== 0o600 ||
      pathMetadata.isSymbolicLink() ||
      pathMetadata.dev !== metadata.dev ||
      pathMetadata.ino !== metadata.ino
    ) {
      fail(`${label} must be one owner-owned 0600 physical file`);
    }
    const bytes = await handle.readFile();
    if (bytes.byteLength !== metadata.size) fail(`${label} changed while read`);
    const value = parseStrictJson(decodeExactUtf8(bytes, label), {
      maximumBytes,
      maximumDepth: 128,
    });
    const canonicalBytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    if (!bytes.equals(canonicalBytes)) {
      fail(`${label} is not canonical one-LF JSON`);
    }
    return value;
  } finally {
    await handle?.close();
  }
}

export function assertCanonicalRobinhoodOwnerWalletRequest(receipt, value) {
  exactKeys(value, ["schemaVersion", "chainId", "request"], "wallet request");
  exactKeys(value.request, ["method", "params"], "wallet request payload");
  if (
    value.schemaVersion !== ROBINHOOD_OWNER_WALLET_REQUEST_SCHEMA ||
    value.chainId !== "0x1237" ||
    value.request.method !== "eth_sendTransaction" ||
    !Array.isArray(value.request.params) ||
    value.request.params.length !== 1
  ) {
    fail("wallet request is not the canonical chain-4663 request");
  }
  const transaction = value.request.params[0];
  exactKeys(
    transaction,
    [
      "chainId",
      "from",
      "to",
      "value",
      "data",
      "nonce",
      "gas",
      "maxFeePerGas",
      "maxPriorityFeePerGas",
      "accessList",
      "type",
    ],
    "wallet transaction",
  );
  const expected = {
    chainId: receipt.transaction.chainId,
    from: receipt.transaction.from,
    to: receipt.transaction.to,
    value: "0x0",
    data: receipt.transaction.input,
    nonce: receipt.transaction.nonceQuantity,
    gas: receipt.transaction.gasQuantity,
    maxFeePerGas: receipt.transaction.maxFeePerGasQuantity,
    maxPriorityFeePerGas: receipt.transaction.maxPriorityFeePerGasQuantity,
    accessList: [],
    type: receipt.transaction.type,
  };
  if (JSON.stringify(transaction) !== JSON.stringify(expected)) {
    fail("wallet transaction differs from the fresh owner envelope");
  }
  return Object.freeze({
    receiptDigest: receipt.receiptDigest,
    expiresAt: receipt.expiresAt,
    sourceCommit: receipt.source.commit,
    sourceTree: receipt.source.tree,
    hostedVerifyRunId: receipt.hostedVerify.runId,
    hostedVerifyArtifactDigest: receipt.hostedVerify.artifactDigest,
    chainId: receipt.chainIdHex,
    from: receipt.transaction.from,
    to: receipt.transaction.to,
    value: "0x0",
    calldataHash: receipt.transaction.inputKeccak256,
    nonce: receipt.transaction.nonce,
    gasLimit: receipt.transaction.gasLimit,
    maxFeePerGas: receipt.transaction.maxFeePerGas,
    maxPriorityFeePerGas: receipt.transaction.maxPriorityFeePerGas,
    accessList: [],
    reviewedMaximumGasCostWei: receipt.gasPolicy.maximumGasCostWei,
    ownerMaximumGasCostWei: receipt.gasPolicy.ownerMaximumGasCostWei,
  });
}

export async function verifyRobinhoodOwnerWalletRequest({
  envelopePath,
  walletRequestPath,
  env = process.env,
  nowMilliseconds = Date.now(),
  sourceIdentity = exactRobinhoodFoundationSourceIdentity,
  hostedVerifyResolver = resolveRobinhoodFoundationHostedVerify,
  rpcClient,
  runtimeCodeHash,
  clock = () => Date.now(),
} = {}) {
  const configuredRoot = env.ROBINHOOD_OWNER_ENVELOPE_ROOT;
  const [receipt, walletRequest] = await Promise.all([
    readProtectedCanonicalJson({
      configuredRoot,
      candidate: envelopePath,
      maximumBytes: MAXIMUM_ENVELOPE_BYTES,
      label: "owner envelope",
    }),
    readProtectedCanonicalJson({
      configuredRoot,
      candidate: walletRequestPath,
      maximumBytes: MAXIMUM_WALLET_REQUEST_BYTES,
      label: "wallet request",
    }),
  ]);
  assertFreshRobinhoodFoundationOwnerEnvelope(receipt, nowMilliseconds);
  const rpcUrls = [
    env.ROBINHOOD_MAINNET_RPC_URL_PRIMARY,
    env.ROBINHOOD_MAINNET_RPC_URL_SECONDARY,
  ];
  const endpointCommitments = [
    env.ROBINHOOD_MAINNET_RPC_COMMITMENT_PRIMARY,
    env.ROBINHOOD_MAINNET_RPC_COMMITMENT_SECONDARY,
  ];
  const bindings = assertRobinhoodFoundationRpcProviders({
    rpcUrls,
    endpointCommitments,
  });
  if (JSON.stringify(bindings) !== JSON.stringify(receipt.rpcProviders)) {
    fail("action-time RPC endpoints differ from the reviewed envelope commitments");
  }
  const currentSource = sourceIdentity();
  if (
    currentSource.commit !== receipt.source.commit ||
    currentSource.tree !== receipt.source.tree ||
    currentSource.clean !== true
  ) {
    fail("action-time protected source differs from the owner envelope");
  }
  const currentHostedVerify = await hostedVerifyResolver({
    source: currentSource,
    expectedHostedVerify: receipt.hostedVerify,
    nowMilliseconds,
  });
  if (JSON.stringify(currentHostedVerify) !== JSON.stringify(receipt.hostedVerify)) {
    fail("action-time hosted Verify proof differs from the owner envelope");
  }
  const summary = assertCanonicalRobinhoodOwnerWalletRequest(
    receipt,
    walletRequest,
  );
  const actionTimeState =
    await verifyRobinhoodFoundationOwnerWalletActionTimeState({
      receipt,
      rpcUrls,
      rpcEndpointCommitments: endpointCommitments,
      ...(rpcClient ? { rpcClient } : {}),
      ...(runtimeCodeHash ? { runtimeCodeHash } : {}),
      clock,
    });
  const closingSource = sourceIdentity();
  if (
    closingSource.commit !== receipt.source.commit ||
    closingSource.tree !== receipt.source.tree ||
    closingSource.clean !== true
  ) {
    fail("protected source changed during action-time wallet verification");
  }
  const closingHostedVerify = await hostedVerifyResolver({
    source: closingSource,
    expectedHostedVerify: receipt.hostedVerify,
    nowMilliseconds: clock(),
  });
  if (
    JSON.stringify(closingHostedVerify) !== JSON.stringify(receipt.hostedVerify)
  ) {
    fail("hosted Verify proof changed during action-time wallet verification");
  }
  const finalSource = sourceIdentity();
  if (
    finalSource.commit !== receipt.source.commit ||
    finalSource.tree !== receipt.source.tree ||
    finalSource.clean !== true
  ) {
    fail("protected source changed during hosted Verify revalidation");
  }
  assertFreshRobinhoodFoundationOwnerEnvelope(receipt, clock());
  return Object.freeze({ ...summary, actionTimeState });
}

export async function runRobinhoodOwnerWalletRequestCli({
  argv = process.argv.slice(2),
  env = process.env,
  now = () => Date.now(),
} = {}) {
  const options = parseRobinhoodOwnerWalletRequestCli(argv);
  const result = await verifyRobinhoodOwnerWalletRequest({
    ...options,
    env,
    nowMilliseconds: now(),
    clock: now,
  });
  process.stdout.write(
    `ROBINHOOD_OWNER_WALLET_REQUEST_VERIFIED ${JSON.stringify(result)}\n`,
  );
  return result;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    await runRobinhoodOwnerWalletRequestCli();
  } catch (error) {
    process.stderr.write(
      `ERROR ${error?.message ?? "owner wallet request verification failed"}\n`,
    );
    process.exitCode = 1;
  }
}
