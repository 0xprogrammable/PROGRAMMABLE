import "server-only";

import {
  createPublicClient,
  decodeEventLog,
  http,
  keccak256,
  type Abi,
  type Hex,
  type PublicClient,
} from "viem";
import { mainnet } from "viem/chains";

import registryAbiArtifact from
  "@/docs/security/abi/ProgrammableCustomRegistryV2.json";
import { CUSTOM_REGISTRY_V2_EVENT_ABI } from
  "@/lib/data-pipeline/custom-registry-v2-event-manifest";
import { canonicalizeJson, type JsonValue } from
  "../projection-target/canonical-json";
import type {
  VerifiedApprovalArtifactV3,
  VerifiedRegistryLifecycleV2,
} from "./generic-launch-projector-v2";

const ABI = registryAbiArtifact.abi as Abi;
const ZERO_HASH32 = `0x${"00".repeat(32)}` as const;

export interface GenericLaunchRegistryReleaseV2 {
  readonly registryAddress: `0x${string}`;
  readonly registryRuntimeCodeKeccak256: `0x${string}`;
  readonly registryPolicyCommitment: `0x${string}`;
  readonly deploymentBlock: string;
  readonly minimumFinalityBlocks: string;
}

interface ProviderObservationV2 {
  readonly lifecycle: VerifiedRegistryLifecycleV2;
  readonly bindingEvidence: Readonly<{
    approvalState: unknown;
    launchState: unknown;
    launchDescriptor: unknown;
    eventArguments: readonly unknown[];
  }>;
}

interface RegistryProviderReaderV2 {
  head(): Promise<bigint>;
  blockHash(blockNumber: bigint): Promise<`0x${string}`>;
  observe(input: Readonly<{
    approval: VerifiedApprovalArtifactV3;
    release: GenericLaunchRegistryReleaseV2;
    commonHead: bigint;
    commonHeadHash: `0x${string}`;
    signal: AbortSignal;
  }>): Promise<ProviderObservationV2>;
}

export function createDualRpcGenericLaunchRegistryReaderV2(input: Readonly<{
  release: GenericLaunchRegistryReleaseV2;
  rpcUrls: readonly [string, string];
  providerFactory?: (url: string) => RegistryProviderReaderV2;
}>): (request: Readonly<{
  approval: VerifiedApprovalArtifactV3;
  signal: AbortSignal;
}>) => Promise<VerifiedRegistryLifecycleV2> {
  validateRelease(input.release);
  if (input.rpcUrls.length !== 2 || input.rpcUrls[0] === input.rpcUrls[1]) {
    throw new TypeError("Generic launch Registry RPC quorum is invalid");
  }
  const factory = input.providerFactory ?? createViemRegistryProviderV2;
  const providers = input.rpcUrls.map(factory) as
    [RegistryProviderReaderV2, RegistryProviderReaderV2];
  return async (request) => {
    request.signal.throwIfAborted();
    const heads = await Promise.all(providers.map((provider) => provider.head()));
    const commonHead = heads[0] < heads[1] ? heads[0] : heads[1];
    if (commonHead < BigInt(input.release.deploymentBlock)) {
      throw new TypeError("Generic launch Registry common head predates deployment");
    }
    const hashes = await Promise.all(
      providers.map((provider) => provider.blockHash(commonHead)),
    );
    if (hashes[0] !== hashes[1]) {
      throw new TypeError("Generic launch Registry common head quorum disagrees");
    }
    const observations = await Promise.all(providers.map((provider) =>
      provider.observe({
        approval: request.approval,
        release: input.release,
        commonHead,
        commonHeadHash: hashes[0],
        signal: request.signal,
      })));
    if (canonicalizeJson(observations[0] as unknown as JsonValue)
      !== canonicalizeJson(observations[1] as unknown as JsonValue)) {
      throw new TypeError("Generic launch Registry provider evidence disagrees");
    }
    return observations[0].lifecycle;
  };
}

function createViemRegistryProviderV2(url: string): RegistryProviderReaderV2 {
  const endpoint = new URL(url);
  if (endpoint.protocol !== "https:" || endpoint.username !== ""
    || endpoint.password !== "" || endpoint.hash !== "") {
    throw new TypeError("Generic launch Registry RPC endpoint is invalid");
  }
  const client = createPublicClient({
    chain: mainnet,
    transport: http(endpoint.toString(), {
      batch: false,
      retryCount: 0,
      timeout: 15_000,
    }),
  });
  return Object.freeze({
    async head() { return await client.getBlockNumber(); },
    async blockHash(blockNumber: bigint) {
      const block = await client.getBlock({ blockNumber, includeTransactions: false });
      if (block.hash === null) throw new TypeError("Registry block is not canonical");
      return block.hash.toLowerCase() as `0x${string}`;
    },
    async observe(request: Readonly<{
      approval: VerifiedApprovalArtifactV3;
      release: GenericLaunchRegistryReleaseV2;
      commonHead: bigint;
      commonHeadHash: `0x${string}`;
      signal: AbortSignal;
    }>) {
      return await observeProvider(client, request);
    },
  });
}

async function observeProvider(
  client: PublicClient,
  input: Readonly<{
    approval: VerifiedApprovalArtifactV3;
    release: GenericLaunchRegistryReleaseV2;
    commonHead: bigint;
    commonHeadHash: `0x${string}`;
    signal: AbortSignal;
  }>,
): Promise<ProviderObservationV2> {
  input.signal.throwIfAborted();
  const address = input.release.registryAddress;
  if (input.approval.registry.chainId !== "1"
    || input.approval.registry.generation !== "2"
    || input.approval.registry.address !== address
    || input.approval.registry.runtimeCodeKeccak256
      !== input.release.registryRuntimeCodeKeccak256
    || input.approval.registry.minimumFinalityBlocks
      !== input.release.minimumFinalityBlocks
    || input.approval.registryOnchainPolicyCommitment
      !== input.release.registryPolicyCommitment) {
    throw new TypeError("Approval artifact is not bound to the Registry release");
  }
  const fromBlock = BigInt(input.release.deploymentBlock);
  const [logs, approvalStateRaw, launchStateRaw, descriptorRaw, primaryTx,
    primaryReceipt, primaryBlock, primaryCode] = await Promise.all([
    client.getLogs({ address, fromBlock, toBlock: input.commonHead }),
    client.readContract({
      address, abi: ABI, functionName: "approvalState",
      args: [input.approval.approvalId], blockNumber: input.commonHead,
    }),
    client.readContract({
      address, abi: ABI, functionName: "launchState",
      args: [input.approval.launchId], blockNumber: input.commonHead,
    }),
    client.readContract({
      address, abi: ABI, functionName: "launchDescriptor",
      args: [input.approval.launchId], blockNumber: input.commonHead,
    }),
    client.getTransaction({ hash: input.approval.primaryFinality.transactionHash }),
    client.getTransactionReceipt({
      hash: input.approval.primaryFinality.transactionHash,
    }),
    client.getBlock({
      blockNumber: BigInt(input.approval.primaryFinality.blockNumber),
      includeTransactions: false,
    }),
    client.getBytecode({
      address: input.approval.descriptor.primaryContract,
      blockNumber: input.commonHead,
    }),
  ]);
  input.signal.throwIfAborted();
  if (primaryReceipt.status !== "success"
    || primaryTx.from.toLowerCase() !== input.approval.descriptor.launchWallet
    || primaryReceipt.transactionHash.toLowerCase()
      !== input.approval.primaryFinality.transactionHash
    || primaryReceipt.blockHash.toLowerCase() !== input.approval.primaryFinality.blockHash
    || primaryReceipt.blockNumber.toString() !== input.approval.primaryFinality.blockNumber
    || primaryReceipt.contractAddress?.toLowerCase()
      !== input.approval.descriptor.primaryContract
    || primaryBlock.hash?.toLowerCase() !== input.approval.primaryFinality.blockHash
    || primaryCode === undefined
    || keccak256(primaryCode) !== input.approval.descriptor.primaryRuntimeCodeHash) {
    throw new TypeError("Primary launch receipt/runtime evidence is invalid");
  }
  const events = decodeLifecycleLogs(logs, input.approval);
  const approvalState = approvalStateEvidence(approvalStateRaw);
  const launchState = launchStateEvidence(launchStateRaw);
  const launchDescriptor = descriptorEvidence(descriptorRaw);
  assertApprovalState(approvalState, input.approval);
  assertDescriptor(launchDescriptor, input.approval);
  const primaryLaunch = Object.freeze({
    transactionHash: primaryReceipt.transactionHash.toLowerCase() as `0x${string}`,
    sender: primaryTx.from.toLowerCase() as `0x${string}`,
    blockHash: primaryReceipt.blockHash.toLowerCase() as `0x${string}`,
    blockNumber: primaryReceipt.blockNumber.toString(),
    transactionIndex: primaryReceipt.transactionIndex.toString(),
    status: "success" as const,
  });
  if (events.revocation !== null || launchState.status === "3") {
    if (events.revocation === null || launchState.status !== "3"
      || launchState.revokedAtBlock === "0"
      || launchState.revocationEvidenceHash === ZERO_HASH32
      || events.revocation.args.revocationEvidenceHash
        !== launchState.revocationEvidenceHash
      || events.revocation.args.revokedAtBlock !== launchState.revokedAtBlock) {
      throw new TypeError("Registry revocation evidence is inconsistent");
    }
    return Object.freeze({
      lifecycle: Object.freeze({
        status: "revoked" as const,
        latestCommonHead: input.commonHead.toString(),
        latestCommonHeadHash: input.commonHeadHash,
        revokedAtBlock: launchState.revokedAtBlock,
        revocationEvidenceHash:
          launchState.revocationEvidenceHash as `0x${string}`,
      }),
      bindingEvidence: Object.freeze({
        approvalState, launchState, launchDescriptor,
        eventArguments: events.arguments,
      }),
    });
  }
  if (launchState.status !== "2" || launchState.revokedAtBlock !== "0"
    || launchState.revocationEvidenceHash !== ZERO_HASH32
    || events.authorization === null || events.registration === null
    || events.descriptor === null || events.descriptorEvidence === null
    || events.finalization === null) {
    throw new TypeError("Registry lifecycle is not finalized and non-revoked");
  }
  assertFinalizedEventJoins(events, input.approval, launchState, approvalState);
  const finalizedLog = events.finalization!;
  const finalityArgs = finalizedLog.args;
  const [observedBlock, confirmedBlock] = await Promise.all([
    client.getBlock({
      blockNumber: BigInt(finalityArgs.observedAtBlock),
      includeTransactions: false,
    }),
    client.getBlock({
      blockNumber: BigInt(finalityArgs.confirmedHeadBlock),
      includeTransactions: false,
    }),
  ]);
  if (observedBlock.hash?.toLowerCase() !== finalityArgs.observedBlockHash
    || confirmedBlock.hash?.toLowerCase() !== finalityArgs.confirmedHeadBlockHash
    || finalityArgs.observedAtBlock !== launchState.observedAtBlock
    || finalityArgs.finalizedAtBlock !== launchState.finalizedAtBlock
    || finalityArgs.finalizedAtBlock !== finalizedLog.blockNumber
    || BigInt(finalityArgs.confirmedHeadBlock)
      < BigInt(finalityArgs.observedAtBlock)
        + BigInt(input.release.minimumFinalityBlocks)) {
    throw new TypeError("Registry finalized block evidence is invalid");
  }
  const auth = evidence(events.authorization, "CustomLaunchApprovalAuthorizedV2");
  const registered = evidence(events.registration, "CustomLaunchRegisteredV2");
  const descriptor = evidence(events.descriptor, "CustomLaunchDescriptorCommittedV2");
  const descriptorEvidenceEvent = evidence(
    events.descriptorEvidence,
    "CustomLaunchDescriptorEvidenceCommittedV2",
  );
  const finalized = evidence(events.finalization, "CustomLaunchFinalizedV2");
  assertLifecycleOrder(primaryLaunch, auth, [
    registered, descriptor, descriptorEvidenceEvent,
  ], finalized, input.commonHead, BigInt(input.release.minimumFinalityBlocks));
  return Object.freeze({
    lifecycle: Object.freeze({
      status: "finalized" as const,
      registryAddress: address,
      registryRuntimeCodeKeccak256: input.release.registryRuntimeCodeKeccak256,
      registryPolicyCommitment: input.release.registryPolicyCommitment,
      minimumFinalityBlocks: input.release.minimumFinalityBlocks,
      primaryLaunch,
      authorization: auth,
      registration: Object.freeze([
        registered, descriptor, descriptorEvidenceEvent,
      ]) as readonly [
        typeof registered, typeof descriptor, typeof descriptorEvidenceEvent,
      ],
      finalization: finalized,
      latestCommonHead: input.commonHead.toString(),
      latestCommonHeadHash: input.commonHeadHash,
      revokedAtBlock: "0" as const,
      revocationEvidenceHash: ZERO_HASH32,
    }),
    bindingEvidence: Object.freeze({
      approvalState, launchState, launchDescriptor,
      eventArguments: events.arguments,
    }),
  });
}

type DecodedLifecycleLog = Readonly<{
  eventName: string;
  transactionHash: `0x${string}`;
  blockHash: `0x${string}`;
  blockNumber: string;
  transactionIndex: string;
  logIndex: string;
  removed: false;
  args: Readonly<Record<string, string>>;
}>;

function decodeLifecycleLogs(
  logs: Awaited<ReturnType<PublicClient["getLogs"]>>,
  approval: VerifiedApprovalArtifactV3,
) {
  const selected: DecodedLifecycleLog[] = [];
  for (const log of logs) {
    if (log.blockHash === null || log.blockNumber === null
      || log.transactionHash === null || log.transactionIndex === null
      || log.logIndex === null || log.removed) continue;
    let decoded: Readonly<{ eventName: string; args: unknown }>;
    try {
      decoded = decodeEventLog({
        abi: CUSTOM_REGISTRY_V2_EVENT_ABI,
        data: log.data,
        topics: log.topics,
        strict: true,
      }) as Readonly<{ eventName: string; args: unknown }>;
    } catch {
      continue;
    }
    if (!decoded.eventName.startsWith("CustomLaunch")) continue;
    const args = normalizeArgs(decoded.args);
    if (args.approvalId !== approval.approvalId
      && args.launchId !== approval.launchId) continue;
    selected.push(Object.freeze({
      eventName: decoded.eventName,
      transactionHash: log.transactionHash.toLowerCase() as `0x${string}`,
      blockHash: log.blockHash.toLowerCase() as `0x${string}`,
      blockNumber: log.blockNumber.toString(),
      transactionIndex: log.transactionIndex.toString(),
      logIndex: log.logIndex.toString(),
      removed: false,
      args,
    }));
  }
  selected.sort(compareLog);
  const one = (name: string) => {
    const matches = selected.filter((entry) => entry.eventName === name);
    if (matches.length > 1) throw new TypeError(`Registry ${name} is duplicated`);
    return matches[0] ?? null;
  };
  return Object.freeze({
    authorization: one("CustomLaunchApprovalAuthorizedV2"),
    registration: one("CustomLaunchRegisteredV2"),
    descriptor: one("CustomLaunchDescriptorCommittedV2"),
    descriptorEvidence: one("CustomLaunchDescriptorEvidenceCommittedV2"),
    finalization: one("CustomLaunchFinalizedV2"),
    revocation: one("CustomLaunchRevokedV2"),
    arguments: Object.freeze(selected.map((entry) => Object.freeze({
      eventName: entry.eventName,
      transactionHash: entry.transactionHash,
      blockHash: entry.blockHash,
      blockNumber: entry.blockNumber,
      transactionIndex: entry.transactionIndex,
      logIndex: entry.logIndex,
      args: entry.args,
    }))),
  });
}

function normalizeArgs(value: unknown): Readonly<Record<string, string>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Registry event arguments are invalid");
  }
  const output: Record<string, string> = {};
  for (const [key, candidate] of Object.entries(value)) {
    if (typeof candidate === "bigint") output[key] = candidate.toString();
    else if (typeof candidate === "number") output[key] = String(candidate);
    else if (typeof candidate === "string") output[key] = candidate.toLowerCase();
    else throw new TypeError("Registry event argument is invalid");
  }
  return Object.freeze(output);
}

function tuple(value: unknown, names: readonly string[]): Readonly<Record<string, string>> {
  if (value === null || typeof value !== "object") {
    throw new TypeError("Registry state tuple is invalid");
  }
  const source = value as Readonly<Record<string, unknown>>;
  const output: Record<string, string> = {};
  names.forEach((name, index) => {
    const candidate = source[name] ?? source[String(index)];
    if (typeof candidate === "bigint" || typeof candidate === "number") {
      output[name] = String(candidate);
    } else if (typeof candidate === "boolean") {
      output[name] = candidate ? "true" : "false";
    } else if (typeof candidate === "string") {
      output[name] = candidate.toLowerCase();
    } else throw new TypeError(`Registry state ${name} is invalid`);
  });
  return Object.freeze(output);
}

function approvalStateEvidence(value: unknown) {
  return tuple(value, [
    "descriptorHash", "validAfterBlock", "expiresAtBlock",
    "approvalEvidenceHash", "consumed",
  ]);
}

function launchStateEvidence(value: unknown) {
  return tuple(value, [
    "status", "observedAtBlock", "finalizedAtBlock", "revokedAtBlock",
    "transitionSequence", "descriptorHash", "approvalId",
    "approvalEvidenceHash", "registrationEvidenceHash",
    "finalityEvidenceHash", "revocationEvidenceHash",
  ]);
}

function descriptorEvidence(value: unknown) {
  return tuple(value, [
    "chainId", "launchWallet", "primaryContract", "primaryRuntimeCodeHash",
    "componentSetHash", "sourceArtifactHash", "configurationHash",
    "launchPlanHash", "projectCommitment", "marketMode", "protocolFeeBps",
  ]);
}

function assertApprovalState(
  state: Readonly<Record<string, string>>,
  approval: VerifiedApprovalArtifactV3,
) {
  if (state.descriptorHash !== approval.descriptorHash
    || state.approvalEvidenceHash !== approval.approvalEvidenceHash
    || state.validAfterBlock !== approval.authorization.validAfterBlock
    || state.expiresAtBlock !== approval.authorization.expiresAtBlock
    || state.consumed !== "true") {
    throw new TypeError("Registry approval state does not match Approval artifact");
  }
}

function assertDescriptor(
  state: Readonly<Record<string, string>>,
  approval: VerifiedApprovalArtifactV3,
) {
  const descriptor = approval.descriptor;
  if (state.chainId !== "1" || state.launchWallet !== descriptor.launchWallet
    || state.primaryContract !== descriptor.primaryContract
    || state.primaryRuntimeCodeHash !== descriptor.primaryRuntimeCodeHash
    || state.componentSetHash !== descriptor.componentSetHash
    || state.sourceArtifactHash !== descriptor.sourceArtifactHash
    || state.configurationHash !== descriptor.configurationHash
    || state.launchPlanHash !== descriptor.launchPlanHash
    || state.projectCommitment !== descriptor.projectCommitment
    || state.marketMode !== String(descriptor.marketModeValue)
    || state.protocolFeeBps !== String(descriptor.protocolFeeBps)) {
    throw new TypeError("Registry descriptor state does not match Approval artifact");
  }
}

function assertFinalizedEventJoins(
  events: ReturnType<typeof decodeLifecycleLogs>,
  approval: VerifiedApprovalArtifactV3,
  launchState: Readonly<Record<string, string>>,
  approvalState: Readonly<Record<string, string>>,
) {
  const auth = events.authorization!;
  const registered = events.registration!;
  const descriptor = events.descriptor!;
  const evidenceEvent = events.descriptorEvidence!;
  const finalization = events.finalization!;
  if (auth.args.approvalId !== approval.approvalId
    || auth.args.descriptorHash !== approval.descriptorHash
    || auth.args.approvalEvidenceHash !== approval.approvalEvidenceHash
    || auth.args.validAfterBlock !== approvalState.validAfterBlock
    || auth.args.expiresAtBlock !== approvalState.expiresAtBlock
    || registered.args.launchId !== approval.launchId
    || registered.args.descriptorHash !== approval.descriptorHash
    || registered.args.primaryContract !== approval.descriptor.primaryContract
    || registered.args.approvalId !== approval.approvalId
    || registered.args.approvalEvidenceHash !== approval.approvalEvidenceHash
    || descriptor.args.launchId !== approval.launchId
    || descriptor.args.descriptorHash !== approval.descriptorHash
    || descriptor.args.primaryContract !== approval.descriptor.primaryContract
    || descriptor.args.launchWallet !== approval.descriptor.launchWallet
    || descriptor.args.primaryRuntimeCodeHash
      !== approval.descriptor.primaryRuntimeCodeHash
    || descriptor.args.componentSetHash !== approval.descriptor.componentSetHash
    || descriptor.args.projectCommitment !== approval.descriptor.projectCommitment
    || descriptor.args.marketMode !== String(approval.descriptor.marketModeValue)
    || descriptor.args.protocolFeeBps !== String(approval.descriptor.protocolFeeBps)
    || evidenceEvent.args.launchId !== approval.launchId
    || evidenceEvent.args.sourceArtifactHash !== approval.descriptor.sourceArtifactHash
    || evidenceEvent.args.configurationHash !== approval.descriptor.configurationHash
    || evidenceEvent.args.launchPlanHash !== approval.descriptor.launchPlanHash
    || finalization.args.launchId !== approval.launchId
    || finalization.args.descriptorHash !== approval.descriptorHash
    || launchState.descriptorHash !== approval.descriptorHash
    || launchState.approvalId !== approval.approvalId
    || launchState.approvalEvidenceHash !== approval.approvalEvidenceHash
    || launchState.registrationEvidenceHash
      !== registered.args.registrationEvidenceHash
    || launchState.finalityEvidenceHash !== finalization.args.finalityEvidenceHash) {
    throw new TypeError("Registry lifecycle evidence does not join Approval artifact");
  }
}

function evidence<Name extends string>(log: DecodedLifecycleLog, eventName: Name) {
  if (log.eventName !== eventName) throw new TypeError("Registry event name is invalid");
  return Object.freeze({
    eventName,
    transactionHash: log.transactionHash,
    blockHash: log.blockHash,
    blockNumber: log.blockNumber,
    transactionIndex: log.transactionIndex,
    logIndex: log.logIndex,
    removed: false as const,
  });
}

function assertLifecycleOrder(
  primary: Readonly<{ blockNumber: string; transactionIndex: string }>,
  authorization: Readonly<{ blockNumber: string; transactionIndex: string; logIndex: string }>,
  registration: readonly Readonly<{
    transactionHash: string; blockHash: string; blockNumber: string;
    transactionIndex: string; logIndex: string;
  }>[],
  finalization: Readonly<{ blockNumber: string; transactionIndex: string; logIndex: string }>,
  commonHead: bigint,
  minimumFinality: bigint,
) {
  if (comparePosition(primary, authorization) > 0
    || comparePosition(authorization, registration[0]!) >= 0
    || registration.some((value) => value.transactionHash !== registration[0]!.transactionHash
      || value.blockHash !== registration[0]!.blockHash
      || value.blockNumber !== registration[0]!.blockNumber
      || value.transactionIndex !== registration[0]!.transactionIndex)
    || BigInt(registration[0]!.logIndex) >= BigInt(registration[1]!.logIndex)
    || BigInt(registration[1]!.logIndex) >= BigInt(registration[2]!.logIndex)
    || comparePosition(registration[2]!, finalization) >= 0
    || commonHead < BigInt(finalization.blockNumber) + minimumFinality) {
    throw new TypeError("Registry lifecycle chronology/finality is invalid");
  }
}

function comparePosition(
  left: Readonly<{ blockNumber: string; transactionIndex: string; logIndex?: string }>,
  right: Readonly<{ blockNumber: string; transactionIndex: string; logIndex?: string }>,
) {
  for (const key of ["blockNumber", "transactionIndex", "logIndex"] as const) {
    const a = BigInt(left[key] ?? "0");
    const b = BigInt(right[key] ?? "0");
    if (a < b) return -1;
    if (a > b) return 1;
  }
  return 0;
}

function compareLog(left: DecodedLifecycleLog, right: DecodedLifecycleLog) {
  return comparePosition(left, right);
}

function validateRelease(value: GenericLaunchRegistryReleaseV2) {
  if (!/^0x[0-9a-f]{40}$/u.test(value.registryAddress)
    || value.registryAddress === `0x${"00".repeat(20)}`
    || !/^0x[0-9a-f]{64}$/u.test(value.registryRuntimeCodeKeccak256)
    || !/^0x[0-9a-f]{64}$/u.test(value.registryPolicyCommitment)
    || !/^[1-9][0-9]{0,77}$/u.test(value.deploymentBlock)
    || !/^[1-9][0-9]{0,2}$/u.test(value.minimumFinalityBlocks)) {
    throw new TypeError("Generic launch Registry release is invalid");
  }
}

void (null as unknown as Hex);
