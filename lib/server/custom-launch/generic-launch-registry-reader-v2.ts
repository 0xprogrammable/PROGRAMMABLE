import "server-only";

import {
  createPublicClient,
  BlockNotFoundError,
  decodeEventLog,
  http,
  keccak256,
  TransactionNotFoundError,
  TransactionReceiptNotFoundError,
  type Abi,
  type AbiEvent,
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
import { canonicalSha256 } from "../projection-target/hashing";
import type {
  GenericLaunchMaterializationStoreV2,
  VerifiedApprovalArtifactV3,
  VerifiedRegistryLifecycleV2,
} from "./generic-launch-projector-v2";

const ABI = registryAbiArtifact.abi as Abi;
const ZERO_HASH32 = `0x${"00".repeat(32)}` as const;
const MAXIMUM_LOG_WINDOW_BLOCKS = 5_000n;
const MAXIMUM_INITIAL_LOG_BLOCKS = 250_000n;

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
    previous: Awaited<ReturnType<
      GenericLaunchMaterializationStoreV2["getLatestLifecycle"]
    >>;
    signal: AbortSignal;
  }>): Promise<ProviderObservationV2>;
}

export function createDualRpcGenericLaunchRegistryReaderV2(input: Readonly<{
  release: GenericLaunchRegistryReleaseV2;
  rpcUrls: readonly [string, string];
  providerFactory?: (url: string) => RegistryProviderReaderV2;
}>): (request: Readonly<{
  approval: VerifiedApprovalArtifactV3;
  previous: Awaited<ReturnType<
    GenericLaunchMaterializationStoreV2["getLatestLifecycle"]
  >>;
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
        previous: request.previous,
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
      previous: Awaited<ReturnType<
        GenericLaunchMaterializationStoreV2["getLatestLifecycle"]
      >>;
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
    previous: Awaited<ReturnType<
      GenericLaunchMaterializationStoreV2["getLatestLifecycle"]
    >>;
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
  const previousHead = input.previous === null
    ? null
    : BigInt(input.previous.observationCommonHead);
  const previousBlock = previousHead === null || previousHead > input.commonHead
    ? null
    : await client.getBlock({
      blockNumber: previousHead,
      includeTransactions: false,
    });
  const [approvalStateRaw, launchStateRaw, descriptorRaw, primaryTx,
    primaryReceipt, primaryBlock, primaryCode] = await Promise.all([
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
    missingOnReorg(client.getTransaction({
      hash: input.approval.primaryFinality.transactionHash,
    })),
    missingOnReorg(client.getTransactionReceipt({
      hash: input.approval.primaryFinality.transactionHash,
    })),
    missingOnReorg(client.getBlock({
      blockNumber: BigInt(input.approval.primaryFinality.blockNumber),
      includeTransactions: false,
    })),
    client.getBytecode({
      address: input.approval.descriptor.primaryContract,
      blockNumber: input.commonHead,
    }),
  ]);
  const initialFromBlock = BigInt(input.approval.primaryFinality.blockNumber)
    > fromBlock ? BigInt(input.approval.primaryFinality.blockNumber) : fromBlock;
  let logs = await readBoundedLifecycleLogs(
    client,
    address,
    previousHead === null
      ? initialFromBlock
      : previousHead + 1n,
    input.commonHead,
    input.approval,
    previousHead !== null,
    input.signal,
  );
  input.signal.throwIfAborted();
  const approvalState = approvalStateEvidence(approvalStateRaw);
  const launchState = launchStateEvidence(launchStateRaw);
  const launchDescriptor = descriptorEvidence(descriptorRaw);
  let events = decodeLifecycleLogs(logs, input.approval);
  if (input.previous !== null
    && input.previous.approvalId !== input.approval.approvalId
    && approvalState.consumed === "true"
    && launchState.approvalId === input.approval.approvalId) {
    throw new TypeError("Canonical consumed Registry Approval identity changed");
  }
  if (approvalState.consumed !== "true"
    || launchState.approvalId !== input.approval.approvalId) {
    if (input.previous?.approvalId === input.approval.approvalId) {
      return invalidatedObservation(input, {
        approvalState,
        launchState,
        launchDescriptor,
        eventArguments: events.arguments,
        previousCanonicalApprovalId: input.previous.approvalId,
      });
    }
    return Object.freeze({
      lifecycle: Object.freeze({
        status: "unconsumed" as const,
        latestCommonHead: input.commonHead.toString(),
        latestCommonHeadHash: input.commonHeadHash,
        observationCommonHead: input.commonHead.toString(),
        observationCommonHeadHash: input.commonHeadHash,
      }),
      bindingEvidence: Object.freeze({
        approvalState, launchState, launchDescriptor,
        eventArguments: events.arguments,
      }),
    });
  }
  if (input.previous !== null && (previousHead! > input.commonHead
    || previousBlock?.hash?.toLowerCase()
      !== input.previous.observationCommonHeadHash)) {
    return invalidatedObservation(input, {
      approvalState,
      launchState,
      launchDescriptor,
      eventArguments: events.arguments,
      previousObservation: {
        blockNumber: input.previous.observationCommonHead,
        expectedBlockHash: input.previous.observationCommonHeadHash,
        actualBlockHash: previousBlock?.hash?.toLowerCase() ?? null,
      },
    });
  }
  const primaryObservation = Object.freeze({
    transactionHash: primaryTx?.hash.toLowerCase() ?? null,
    sender: primaryTx?.from.toLowerCase() ?? null,
    receiptTransactionHash: primaryReceipt?.transactionHash.toLowerCase() ?? null,
    receiptBlockHash: primaryReceipt?.blockHash.toLowerCase() ?? null,
    receiptBlockNumber: primaryReceipt?.blockNumber.toString() ?? null,
    receiptContractAddress: primaryReceipt?.contractAddress?.toLowerCase() ?? null,
    receiptStatus: primaryReceipt?.status ?? null,
    blockHash: primaryBlock?.hash?.toLowerCase() ?? null,
    runtimeCodeKeccak256: primaryCode === undefined ? null : keccak256(primaryCode),
  });
  if (primaryReceipt === null || primaryTx === null || primaryBlock === null
    || primaryReceipt.status !== "success"
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
    return invalidatedObservation(input, {
      approvalState,
      launchState,
      launchDescriptor,
      eventArguments: events.arguments,
      primaryObservation,
    });
  }
  if (input.previous?.state === "invalidated"
    && (launchState.status === "2" || launchState.status === "3")) {
    logs = await readBoundedLifecycleLogs(
      client,
      address,
      initialFromBlock,
      input.commonHead,
      input.approval,
      false,
      input.signal,
    );
    events = decodeLifecycleLogs(logs, input.approval);
  }
  const primaryLaunch = Object.freeze({
    transactionHash: primaryReceipt.transactionHash.toLowerCase() as `0x${string}`,
    sender: primaryTx.from.toLowerCase() as `0x${string}`,
    blockHash: primaryReceipt.blockHash.toLowerCase() as `0x${string}`,
    blockNumber: primaryReceipt.blockNumber.toString(),
    transactionIndex: primaryReceipt.transactionIndex.toString(),
    status: "success" as const,
  });
  if (input.previous?.state === "revoked" && events.revocation === null
    && launchState.status === "3"
    && input.previous.approvalId === input.approval.approvalId
    && input.previous.descriptorHash === input.approval.descriptorHash) {
    assertApprovalState(approvalState, input.approval);
    assertDescriptor(launchDescriptor, input.approval);
    const stableEvidenceHash = canonicalSha256(
      "programmable.generic-launch-registry-lifecycle-evidence.v2",
      {
        approvalId: input.approval.approvalId,
        launchId: input.approval.launchId,
        descriptorHash: input.approval.descriptorHash,
        status: "revoked",
        revokedAtBlock: launchState.revokedAtBlock,
        revocationEvidenceHash: launchState.revocationEvidenceHash,
      },
    );
    if (stableEvidenceHash !== input.previous.lifecycleEvidenceHash
      || launchState.revokedAtBlock === "0"
      || launchState.revocationEvidenceHash === ZERO_HASH32) {
      throw new TypeError("Stored Registry revocation evidence is inconsistent");
    }
    return Object.freeze({
      lifecycle: Object.freeze({
        status: "revoked" as const,
        latestCommonHead: input.previous.observationCommonHead,
        latestCommonHeadHash: input.previous.observationCommonHeadHash,
        revokedAtBlock: launchState.revokedAtBlock,
        revocationEvidenceHash:
          launchState.revocationEvidenceHash as `0x${string}`,
        observationCommonHead: input.commonHead.toString(),
        observationCommonHeadHash: input.commonHeadHash,
      }),
      bindingEvidence: Object.freeze({
        approvalState, launchState, launchDescriptor,
        eventArguments: events.arguments,
      }),
    });
  }
  if (events.revocation !== null || launchState.status === "3") {
    assertApprovalState(approvalState, input.approval);
    assertDescriptor(launchDescriptor, input.approval);
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
        observationCommonHead: input.commonHead.toString(),
        observationCommonHeadHash: input.commonHeadHash,
      }),
      bindingEvidence: Object.freeze({
        approvalState, launchState, launchDescriptor,
        eventArguments: events.arguments,
      }),
    });
  }
  if (input.previous?.state === "finalized" && input.previous.record !== null
    && launchState.status === "2" && launchState.revokedAtBlock === "0"
    && launchState.revocationEvidenceHash === ZERO_HASH32
    && events.revocation === null) {
    assertApprovalState(approvalState, input.approval);
    assertDescriptor(launchDescriptor, input.approval);
    const prior = input.previous.record.sourceProjection.lifecycle;
    return Object.freeze({
      lifecycle: Object.freeze({
        status: "finalized" as const,
        registryAddress: prior.registryAddress,
        registryRuntimeCodeKeccak256: prior.registryRuntimeCodeKeccak256,
        registryPolicyCommitment: prior.registryPolicyCommitment,
        minimumFinalityBlocks: prior.minimumFinalityBlocks,
        primaryLaunch: prior.primaryLaunch,
        authorization: prior.authorization,
        registration: prior.registration,
        finalization: prior.finalization,
        latestCommonHead: prior.latestCommonHead,
        latestCommonHeadHash: prior.latestCommonHeadHash,
        revokedAtBlock: "0" as const,
        revocationEvidenceHash: ZERO_HASH32,
        observationCommonHead: input.commonHead.toString(),
        observationCommonHeadHash: input.commonHeadHash,
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
    return invalidatedObservation(input, {
      approvalState,
      launchState,
      launchDescriptor,
      eventArguments: events.arguments,
      primaryObservation,
    });
  }
  assertApprovalState(approvalState, input.approval);
  assertDescriptor(launchDescriptor, input.approval);
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
      observationCommonHead: input.commonHead.toString(),
      observationCommonHeadHash: input.commonHeadHash,
    }),
    bindingEvidence: Object.freeze({
      approvalState, launchState, launchDescriptor,
      eventArguments: events.arguments,
    }),
  });
}

function invalidatedObservation(
  input: Readonly<{
    commonHead: bigint;
    commonHeadHash: `0x${string}`;
  }>,
  bindingEvidence: ProviderObservationV2["bindingEvidence"] & Readonly<{
    primaryObservation?: unknown;
    previousObservation?: unknown;
    previousCanonicalApprovalId?: unknown;
  }>,
): ProviderObservationV2 {
  const invalidationEvidenceHash = canonicalSha256(
    "programmable.generic-launch-registry-invalidation-evidence.v2",
    bindingEvidence as unknown as JsonValue,
  );
  const launchState = bindingEvidence.launchState as Readonly<{
    status?: unknown;
  }>;
  const registryStatus = typeof launchState.status === "string"
    ? launchState.status
    : "0";
  return Object.freeze({
    lifecycle: Object.freeze({
      status: "invalidated" as const,
      latestCommonHead: input.commonHead.toString(),
      latestCommonHeadHash: input.commonHeadHash,
      registryStatus,
      invalidationEvidenceHash,
      observationCommonHead: input.commonHead.toString(),
      observationCommonHeadHash: input.commonHeadHash,
    }),
    bindingEvidence: Object.freeze(bindingEvidence),
  });
}

async function missingOnReorg<T>(promise: Promise<T>): Promise<T | null> {
  try {
    return await promise;
  } catch (error) {
    if (error instanceof TransactionNotFoundError
      || error instanceof TransactionReceiptNotFoundError
      || error instanceof BlockNotFoundError) return null;
    throw error;
  }
}

async function readBoundedLifecycleLogs(
  client: PublicClient,
  address: `0x${string}`,
  fromBlock: bigint,
  toBlock: bigint,
  approval: VerifiedApprovalArtifactV3,
  incremental: boolean,
  signal: AbortSignal,
) {
  const logs: Awaited<ReturnType<PublicClient["getLogs"]>> = [];
  if (fromBlock > toBlock) return logs;
  if (!incremental && toBlock - fromBlock + 1n > MAXIMUM_INITIAL_LOG_BLOCKS) {
    throw new TypeError("Registry initial lifecycle evidence exceeds its bound");
  }
  for (let start = fromBlock; start <= toBlock;) {
    signal.throwIfAborted();
    const end = start + MAXIMUM_LOG_WINDOW_BLOCKS - 1n < toBlock
      ? start + MAXIMUM_LOG_WINDOW_BLOCKS - 1n
      : toBlock;
    const filters = (incremental ? [
      ["CustomLaunchRevokedV2", {
        launchId: approval.launchId,
        descriptorHash: approval.descriptorHash,
      }],
    ] : [
      ["CustomLaunchApprovalAuthorizedV2", {
        approvalId: approval.approvalId,
        descriptorHash: approval.descriptorHash,
      }],
      ["CustomLaunchRegisteredV2", {
        launchId: approval.launchId,
        descriptorHash: approval.descriptorHash,
        primaryContract: approval.descriptor.primaryContract,
      }],
      ["CustomLaunchDescriptorCommittedV2", {
        launchId: approval.launchId,
        descriptorHash: approval.descriptorHash,
        primaryContract: approval.descriptor.primaryContract,
      }],
      ["CustomLaunchDescriptorEvidenceCommittedV2", {
        launchId: approval.launchId,
        sourceArtifactHash: approval.descriptor.sourceArtifactHash,
        configurationHash: approval.descriptor.configurationHash,
      }],
      ["CustomLaunchFinalizedV2", {
        launchId: approval.launchId,
        descriptorHash: approval.descriptorHash,
      }],
      ["CustomLaunchRevokedV2", {
        launchId: approval.launchId,
        descriptorHash: approval.descriptorHash,
      }],
    ]) as readonly (readonly [string, Readonly<Record<string, `0x${string}`>>])[];
    for (const [name, args] of filters) {
      const event = registryEvent(name);
      const window = await client.getLogs({
        address,
        event,
        args,
        fromBlock: start,
        toBlock: end,
        strict: true,
      });
      if (window.length > 1) {
        throw new TypeError(`Registry ${name} evidence exceeds its bound`);
      }
      logs.push(...window);
    }
    start = end + 1n;
  }
  signal.throwIfAborted();
  return logs;
}

function registryEvent(name: string): AbiEvent {
  const event = CUSTOM_REGISTRY_V2_EVENT_ABI.find((candidate) =>
    candidate.type === "event" && candidate.name === name);
  if (event === undefined) throw new TypeError("Registry event ABI is unavailable");
  return event as AbiEvent;
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
