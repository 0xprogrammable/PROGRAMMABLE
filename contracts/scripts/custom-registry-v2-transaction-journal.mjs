import { execFileSync } from "node:child_process";
import { open, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  getAddress,
  keccak256,
  parseTransaction,
  recoverTransactionAddress,
} from "viem";

const canonicalAddress = (value) =>
  value === null || value === undefined ? null : getAddress(value);

export async function assertExactSerializedEip1559Transaction({
  serializedTransaction,
  transactionHash,
  expected,
}) {
  if (
    !/^0x[0-9a-fA-F]+$/u.test(serializedTransaction ?? "") ||
    keccak256(serializedTransaction) !== transactionHash
  ) {
    throw new Error("serialized transaction hash is invalid");
  }
  const transaction = parseTransaction(serializedTransaction);
  const signer = await recoverTransactionAddress({ serializedTransaction });
  if (
    transaction.type !== "eip1559" ||
    transaction.chainId !== expected.chainId ||
    getAddress(signer) !== getAddress(expected.from) ||
    canonicalAddress(transaction.to) !== canonicalAddress(expected.to) ||
    (transaction.data ?? "0x") !== expected.input ||
    (transaction.value ?? 0n) !== BigInt(expected.valueWei) ||
    transaction.nonce !== expected.nonce ||
    transaction.gas !== BigInt(expected.gasLimit) ||
    transaction.maxFeePerGas !== BigInt(expected.maxFeePerGas) ||
    transaction.maxPriorityFeePerGas !==
      BigInt(expected.maxPriorityFeePerGas) ||
    (transaction.accessList?.length ?? 0) !== 0
  ) {
    throw new Error("serialized transaction differs from exact reviewed plan");
  }
  return { signer: getAddress(signer), transaction };
}

export function trustedNetworkTime() {
  const output = execFileSync("sntp", ["-t", "3", "time.apple.com"], {
    encoding: "utf8",
    maxBuffer: 16 * 1024,
  });
  const match = output.match(
    /^([+-][0-9]+(?:\.[0-9]+)?) \+\/- ([0-9]+(?:\.[0-9]+)?) time\.apple\.com\b/mu,
  );
  if (!match) throw new Error("trusted network time could not be parsed");
  const offsetSeconds = Number(match[1]);
  const uncertaintySeconds = Number(match[2]);
  if (
    !Number.isFinite(offsetSeconds) ||
    !Number.isFinite(uncertaintySeconds) ||
    Math.abs(offsetSeconds) > 5 ||
    uncertaintySeconds > 1
  ) {
    throw new Error("trusted network time exceeds release tolerance");
  }
  const systemTimeMilliseconds = Date.now();
  const adjustedTimeMilliseconds = Math.round(
    systemTimeMilliseconds + offsetSeconds * 1000,
  );
  return {
    source: "sntp:time.apple.com",
    systemTimeMilliseconds,
    offsetMilliseconds: Math.round(offsetSeconds * 1000),
    uncertaintyMilliseconds: Math.ceil(uncertaintySeconds * 1000),
    adjustedTimeMilliseconds,
    adjustedTimestamp: Math.floor(adjustedTimeMilliseconds / 1000),
  };
}

const syncParentDirectory = async (filePath) => {
  const directory = await open(path.dirname(filePath), "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
};

export async function appendDurableJsonLine(
  filePath,
  entry,
  { create = false } = {},
) {
  const line = `${JSON.stringify(entry)}\n`;
  if (create) {
    await writeFile(filePath, line, { flag: "wx", mode: 0o600 });
    const handle = await open(filePath, "r+");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    await syncParentDirectory(filePath);
    return;
  }
  const handle = await open(filePath, "a", 0o600);
  try {
    await handle.writeFile(line);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function loadDurableJsonLines(filePath) {
  const bytes = await readFile(filePath);
  const text = bytes.toString("utf8");
  const hasCompleteFinalRecord = text.endsWith("\n");
  const records = text.split("\n");
  if (hasCompleteFinalRecord) records.pop();
  else records.pop(); // A non-newline-terminated suffix is never authoritative.
  if (records.length === 0 || records.some((line) => !line)) {
    throw new Error("transaction journal has no complete ordered records");
  }
  return records.map((line, index) => {
    try {
      return JSON.parse(line);
    } catch {
      throw new Error(`transaction journal record ${index} is invalid`);
    }
  });
}

export function assertSignedAttemptWindow({
  authorization,
  signedAt,
  firstAttemptAt,
}) {
  const notBefore = authorization.notBeforeTimestamp;
  const expiresAt = authorization.firstAttemptExpiresAtTimestamp;
  if (
    !Number.isSafeInteger(notBefore) ||
    !Number.isSafeInteger(expiresAt) ||
    !Number.isSafeInteger(signedAt) ||
    !Number.isSafeInteger(firstAttemptAt) ||
    signedAt < notBefore ||
    firstAttemptAt < notBefore ||
    signedAt > expiresAt ||
    firstAttemptAt > expiresAt
  ) {
    throw new Error(
      "signing or first broadcast attempt fell outside authorization",
    );
  }
}
