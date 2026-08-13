import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  link,
  open,
  readFile,
  truncate,
  unlink,
  writeFile,
} from "node:fs/promises";
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

export async function assertStagedTransactionEvidence({
  evidence,
  schemaVersion,
  preflightSha256,
  expectedTransaction,
  planCreatedAtTimestamp,
  planExpiresAtTimestamp,
}) {
  if (
    evidence?.schemaVersion !== schemaVersion ||
    evidence.status !==
      "SIGNED_RAW_TRANSACTION_STAGED_NO_RELEASE_WORKFLOW_AUTHORIZATION" ||
    evidence.chainId !== 1 ||
    evidence.preflightSha256 !== preflightSha256 ||
    evidence.signingAuthorizedByExplicitCli !== true ||
    evidence.networkCallsPerformedByStager !== false ||
    evidence.releaseWorkflowDispatchAuthorityCreated !== false ||
    !Number.isSafeInteger(evidence.signedAtTimestamp) ||
    !Number.isSafeInteger(planCreatedAtTimestamp) ||
    !Number.isSafeInteger(planExpiresAtTimestamp) ||
    evidence.signedAtTimestamp < planCreatedAtTimestamp ||
    evidence.signedAtTimestamp > planExpiresAtTimestamp ||
    !/^0x[0-9a-fA-F]+$/u.test(evidence.serializedTransaction ?? "") ||
    keccak256(evidence.serializedTransaction) !== evidence.transactionHash
  ) {
    throw new Error("staged signed transaction evidence is invalid");
  }
  assertTrustedTimeEvidence(evidence.trustedTime, evidence.signedAtTimestamp);
  await assertExactSerializedEip1559Transaction({
    serializedTransaction: evidence.serializedTransaction,
    transactionHash: evidence.transactionHash,
    expected: expectedTransaction,
  });
  return evidence;
}

export function trustedNetworkTime() {
  const output = execFileSync("/usr/bin/sntp", ["-t", "3", "time.apple.com"], {
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

export function assertTrustedTimeAfter(current, previous) {
  assertTrustedTimeEvidence(current, current?.adjustedTimestamp);
  assertTrustedTimeEvidence(previous, previous?.adjustedTimestamp);
  if (
    current.adjustedTimeMilliseconds - current.uncertaintyMilliseconds <=
    previous.adjustedTimeMilliseconds + previous.uncertaintyMilliseconds
  ) {
    throw new Error("trusted time interval overlaps prior release evidence");
  }
}

export function trustedNetworkTimeAfter(previous) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const current = trustedNetworkTime();
    try {
      assertTrustedTimeAfter(current, previous);
      return current;
    } catch (error) {
      if (!String(error?.message).includes("overlaps")) throw error;
    }
  }
  throw new Error("could not establish non-overlapping trusted release time");
}

export function latestJournalTrustedTime(records) {
  const candidates = records.flatMap((entry) =>
    [
      entry.activatedTrustedTime,
      entry.requestStartedTrustedTime,
      entry.responseObservedTrustedTime,
      entry.discoveredTrustedTime,
    ].filter(Boolean),
  );
  if (candidates.length === 0) {
    throw new Error("transaction journal has no trusted chronological anchor");
  }
  return candidates.reduce((latest, candidate) =>
    candidate.adjustedTimeMilliseconds + candidate.uncertaintyMilliseconds >
    latest.adjustedTimeMilliseconds + latest.uncertaintyMilliseconds
      ? candidate
      : latest,
  );
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

export async function createDurableJsonLines(filePath, entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error("durable transaction activation records are required");
  }
  const bytes = entries.map((entry) => `${JSON.stringify(entry)}\n`).join("");
  const temporaryPath = `${filePath}.activation-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(temporaryPath, bytes, { flag: "wx", mode: 0o600 });
    const handle = await open(temporaryPath, "r+");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    await syncParentDirectory(temporaryPath);
    await link(temporaryPath, filePath);
    await syncParentDirectory(filePath);
  } finally {
    await unlink(temporaryPath).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }
}

export async function loadDurableJsonLines(
  filePath,
  { repairTrailingTornRecord = false } = {},
) {
  const bytes = await readFile(filePath);
  const text = bytes.toString("utf8");
  const hasCompleteFinalRecord = text.endsWith("\n");
  if (!hasCompleteFinalRecord && repairTrailingTornRecord) {
    const authoritativeLength = bytes.lastIndexOf(0x0a) + 1;
    if (authoritativeLength <= 0) {
      throw new Error("transaction journal has no complete ordered records");
    }
    await truncate(filePath, authoritativeLength);
    const handle = await open(filePath, "r+");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    await syncParentDirectory(filePath);
    return loadDurableJsonLines(filePath);
  }
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

export function assertSignedDispatchIntentWindow({
  authorization,
  dispatchIntentTrustedTime,
}) {
  const notBefore = authorization.notBeforeTimestamp;
  const expiresAt = authorization.dispatchIntentExpiresAtTimestamp;
  assertTrustedTimeEvidence(
    dispatchIntentTrustedTime,
    dispatchIntentTrustedTime?.adjustedTimestamp,
  );
  const withinInclusiveSecondWindow = (evidence) =>
    evidence.adjustedTimeMilliseconds - evidence.uncertaintyMilliseconds >=
      notBefore * 1_000 &&
    evidence.adjustedTimeMilliseconds + evidence.uncertaintyMilliseconds <
      (expiresAt + 1) * 1_000;
  if (
    !Number.isSafeInteger(notBefore) ||
    !Number.isSafeInteger(expiresAt) ||
    !withinInclusiveSecondWindow(dispatchIntentTrustedTime)
  ) {
    throw new Error("durable dispatch intent fell outside authorization");
  }
}

export function assertDispatchIntentEvidence({
  evidence,
  transactionHash,
  authorizationSha256,
  authorization,
}) {
  if (
    evidence?.event !== "DISPATCH_INTENT_ACTIVATED" ||
    evidence.transactionHash !== transactionHash ||
    evidence.authorizationSha256 !== authorizationSha256 ||
    evidence.authorizationSemantics !== authorization.authorizationSemantics ||
    evidence.exactSerializedTransactionOnly !== true ||
    evidence.changedTransactionRequiresFreshAuthorization !== true ||
    evidence.workflowCancellationAllowed !== false ||
    !Number.isSafeInteger(evidence.activatedAtTimestamp)
  ) {
    throw new Error("durable dispatch intent evidence is invalid");
  }
  assertTrustedTimeEvidence(
    evidence.activatedTrustedTime,
    evidence.activatedAtTimestamp,
  );
  assertSignedDispatchIntentWindow({
    authorization,
    dispatchIntentTrustedTime: evidence.activatedTrustedTime,
  });
}

export function assertBroadcastObservationEvidence({
  evidence,
  event,
  transactionHash,
  providerBindings,
}) {
  if (
    evidence?.event !== event ||
    evidence.transactionHash !== transactionHash ||
    !Number.isSafeInteger(evidence.requestStartedAtTimestamp) ||
    !Number.isSafeInteger(evidence.responseObservedAtTimestamp) ||
    evidence.responseObservedAtTimestamp < evidence.requestStartedAtTimestamp ||
    evidence.providerResponses?.length !== providerBindings.length ||
    evidence.providerResponses.some(
      (response, index) =>
        response.providerId !== providerBindings[index].providerId ||
        (providerBindings[index].rpcOrigin !== undefined &&
          response.rpcOrigin !== providerBindings[index].rpcOrigin) ||
        (providerBindings[index].rpcEndpointSha256 !== undefined &&
          response.rpcEndpointSha256 !==
            providerBindings[index].rpcEndpointSha256) ||
        (providerBindings[index].sanitizedUrl !== undefined &&
          response.sanitizedUrl !== providerBindings[index].sanitizedUrl) ||
        !["fulfilled", "rejected"].includes(response.status) ||
        (response.status === "fulfilled" &&
          response.transactionHash !== transactionHash) ||
        (response.status === "rejected" &&
          (typeof response.errorName !== "string" || !response.errorName)),
    )
  ) {
    throw new Error("broadcast provider response evidence is invalid");
  }
  assertTrustedTimeEvidence(
    evidence.requestStartedTrustedTime,
    evidence.requestStartedAtTimestamp,
  );
  assertTrustedTimeEvidence(
    evidence.responseObservedTrustedTime,
    evidence.responseObservedAtTimestamp,
  );
}

export function assertTransactionDiscoveryEvidence({
  evidence,
  transactionHash,
  providerBindings,
}) {
  if (
    evidence?.event !== "RECOVERY_TRANSACTION_DISCOVERY" ||
    evidence.transactionHash !== transactionHash ||
    evidence.providers?.length !== providerBindings.length ||
    evidence.providers.some(
      (provider, index) =>
        provider.providerId !== providerBindings[index].providerId ||
        provider.rpcOrigin !== providerBindings[index].rpcOrigin ||
        provider.rpcEndpointSha256 !==
          providerBindings[index].rpcEndpointSha256 ||
        provider.found !== true ||
        provider.transactionHash !== transactionHash,
    )
  ) {
    throw new Error("transaction discovery evidence is invalid");
  }
  assertTrustedTimeEvidence(
    evidence.discoveredTrustedTime,
    evidence.discoveredAtTimestamp,
  );
}

export function assertDispatchAuthorizedJournal({
  records,
  schemaVersion,
  signedEvent,
  transactionHash,
  stagedTransactionSha256,
  authorizationSha256,
  authorization,
  broadcastProviderBindings,
  discoveryProviderBindings,
  allowedTailEvents,
}) {
  const header = records[0];
  const signedRecords = records.filter(({ event }) => event === signedEvent);
  const signed = signedRecords[0];
  const intentRecords = records.filter(
    ({ event }) => event === "DISPATCH_INTENT_ACTIVATED",
  );
  const intent = intentRecords[0];
  const responseRecords = records.filter(({ event }) =>
    ["BROADCAST_PROVIDER_RESPONSES", "RECOVERY_EXACT_REBROADCAST"].includes(
      event,
    ),
  );
  const discoveryRecords = records.filter(
    ({ event }) => event === "RECOVERY_TRANSACTION_DISCOVERY",
  );
  const initialResponseRecords = responseRecords.filter(
    ({ event }) => event === "BROADCAST_PROVIDER_RESPONSES",
  );
  const tailEvents = records.slice(3).map(({ event }) => event);
  const receiptTailIndex = tailEvents.indexOf(
    "RECEIPT_SEEN_AWAITING_FINALIZED_VERIFICATION",
  );
  const completionTailIndex = tailEvents.indexOf(
    "BROADCAST_COMPLETE_AWAITING_FINALIZED_VERIFICATION",
  );
  const firstTerminalTailIndex = [receiptTailIndex, completionTailIndex]
    .filter((index) => index !== -1)
    .reduce((minimum, index) => Math.min(minimum, index), Infinity);
  const allowed = new Set([
    "JOURNAL_OPEN",
    signedEvent,
    "DISPATCH_INTENT_ACTIVATED",
    "BROADCAST_PROVIDER_RESPONSES",
    "RECOVERY_EXACT_REBROADCAST",
    "RECOVERY_TRANSACTION_DISCOVERY",
    ...allowedTailEvents,
  ]);
  if (
    header?.schemaVersion !== schemaVersion ||
    header.event !== "JOURNAL_OPEN" ||
    header.authorizationSha256 !== authorizationSha256 ||
    header.stagedTransactionSha256 !== stagedTransactionSha256 ||
    signedRecords.length !== 1 ||
    records.indexOf(signed) !== 1 ||
    signed?.transactionHash !== transactionHash ||
    signed.stagedTransactionSha256 !== stagedTransactionSha256 ||
    intentRecords.length !== 1 ||
    records.indexOf(intent) !== 2 ||
    initialResponseRecords.length > 1 ||
    discoveryRecords.length > 1 ||
    records.some(({ event }) => !allowed.has(event)) ||
    (firstTerminalTailIndex !== Infinity &&
      tailEvents
        .slice(firstTerminalTailIndex)
        .some((event) =>
          [
            "BROADCAST_PROVIDER_RESPONSES",
            "RECOVERY_EXACT_REBROADCAST",
            "RECOVERY_TRANSACTION_DISCOVERY",
          ].includes(event),
        )) ||
    records.some(
      (entry) =>
        entry.transactionHash !== undefined &&
        entry.transactionHash !== transactionHash,
    )
  ) {
    throw new Error("dispatch-authorized transaction journal is invalid");
  }
  assertDispatchIntentEvidence({
    evidence: intent,
    transactionHash,
    authorizationSha256,
    authorization,
  });
  for (const response of responseRecords) {
    assertBroadcastObservationEvidence({
      evidence: response,
      event: response.event,
      transactionHash,
      providerBindings: broadcastProviderBindings,
    });
    if (records.indexOf(response) < 3) {
      throw new Error("broadcast observation precedes durable dispatch intent");
    }
  }
  for (const discovery of discoveryRecords) {
    assertTransactionDiscoveryEvidence({
      evidence: discovery,
      transactionHash,
      providerBindings: discoveryProviderBindings,
    });
    if (records.indexOf(discovery) < 3) {
      throw new Error("transaction discovery precedes durable dispatch intent");
    }
  }
  let chronologicalAnchor = intent.activatedTrustedTime;
  for (const record of records.slice(3)) {
    if (
      ["BROADCAST_PROVIDER_RESPONSES", "RECOVERY_EXACT_REBROADCAST"].includes(
        record.event,
      )
    ) {
      assertTrustedTimeAfter(
        record.requestStartedTrustedTime,
        chronologicalAnchor,
      );
      assertTrustedTimeAfter(
        record.responseObservedTrustedTime,
        record.requestStartedTrustedTime,
      );
      chronologicalAnchor = record.responseObservedTrustedTime;
    } else if (record.event === "RECOVERY_TRANSACTION_DISCOVERY") {
      assertTrustedTimeAfter(record.discoveredTrustedTime, chronologicalAnchor);
      chronologicalAnchor = record.discoveredTrustedTime;
    }
  }
  const receiptRecords = records.filter(
    ({ event }) => event === "RECEIPT_SEEN_AWAITING_FINALIZED_VERIFICATION",
  );
  const completionRecords = records.filter(
    ({ event }) =>
      event === "BROADCAST_COMPLETE_AWAITING_FINALIZED_VERIFICATION",
  );
  const receipt = receiptRecords[0];
  const completion = completionRecords[0];
  if (
    receiptRecords.length > 1 ||
    completionRecords.length > 1 ||
    (receipt &&
      (records.indexOf(receipt) < 3 ||
        !Number.isSafeInteger(receipt.observedAtTimestamp) ||
        !/^[1-9][0-9]*$/u.test(receipt.blockNumber ?? "") ||
        !/^0x[0-9a-fA-F]{64}$/u.test(receipt.blockHash ?? ""))) ||
    (completion &&
      (!receipt ||
        records.indexOf(completion) <= records.indexOf(receipt) ||
        !Number.isSafeInteger(completion.observedAtTimestamp)))
  ) {
    throw new Error("transaction journal receipt tail is invalid");
  }
  return {
    header,
    signed,
    intent,
    responseRecords,
    discoveryRecords,
    receipt,
    completion,
  };
}

export function assertTrustedTimeEvidence(evidence, expectedTimestamp) {
  if (
    evidence?.source !== "sntp:time.apple.com" ||
    !Number.isSafeInteger(evidence.systemTimeMilliseconds) ||
    !Number.isSafeInteger(evidence.offsetMilliseconds) ||
    !Number.isSafeInteger(evidence.uncertaintyMilliseconds) ||
    !Number.isSafeInteger(evidence.adjustedTimeMilliseconds) ||
    !Number.isSafeInteger(evidence.adjustedTimestamp) ||
    Math.abs(evidence.offsetMilliseconds) > 5_000 ||
    evidence.uncertaintyMilliseconds < 0 ||
    evidence.uncertaintyMilliseconds > 1_000 ||
    evidence.adjustedTimeMilliseconds !==
      evidence.systemTimeMilliseconds + evidence.offsetMilliseconds ||
    evidence.adjustedTimestamp !==
      Math.floor(evidence.adjustedTimeMilliseconds / 1_000) ||
    evidence.adjustedTimestamp !== expectedTimestamp
  ) {
    throw new Error("trusted time evidence is invalid");
  }
}
