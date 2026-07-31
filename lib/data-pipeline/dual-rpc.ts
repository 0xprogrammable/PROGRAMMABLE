import "server-only";

import { encodeAbiParameters, keccak256, toBytes, type Hex } from "viem";

import {
  canonicalAddress,
  canonicalBytes32,
  canonicalRawData,
  parseNonnegativeIntegerText,
  type HexAddress,
  type HexBytes32,
} from "./codecs";
import {
  DataPipelineError,
  dataPipelineError,
  invalidInput,
  validationError,
} from "./errors";
import type { EnvioCandidate } from "./envio";
import { getDataPipelineReleaseBinding } from "./release-binding.server";
import { assertProductionDualRpcProviders } from "./rpc-providers.server";

export type CandidateRpcBlock = {
  number: bigint | null;
  hash: Hex | null;
  timestamp: bigint;
};

export type CandidateRpcLog = {
  address: Hex;
  blockNumber: bigint | null;
  blockHash: Hex | null;
  transactionHash: Hex | null;
  transactionIndex: number | null;
  logIndex: number | null;
  removed?: boolean;
  topics: readonly Hex[];
  data: Hex;
};

export type CandidateRpcReceipt = {
  status: "success" | "reverted";
  blockNumber: bigint;
  blockHash: Hex;
  transactionHash: Hex;
  transactionIndex: number;
  logs: readonly CandidateRpcLog[];
};

export type CandidateRpcClient = {
  getChainId(): Promise<number>;
  getBlockNumber(): Promise<bigint>;
  getBlock(input: { blockNumber: bigint }): Promise<CandidateRpcBlock>;
  getTransactionReceipt(input: {
    hash: HexBytes32;
  }): Promise<CandidateRpcReceipt>;
  getBytecode(input: {
    address: HexAddress;
    blockNumber: bigint;
  }): Promise<Hex | undefined>;
};

export type CandidateRpcProvider = {
  identity: string;
  vendorGroup: string;
  endpointCommitment: HexBytes32;
  endpointOriginCommitment: HexBytes32;
  client: CandidateRpcClient;
};

export type DynamicSourceAttestation = {
  sourceAddress: HexAddress;
  contractName: string;
  model: "classic" | "stock-paired";
  releaseVersion: string;
  activationBlock: string;
  runtimeCodeHash: HexBytes32;
  factoryOccurrenceFingerprint: HexBytes32;
};

export type DualRpcCandidateEvidence = {
  chainId: 1;
  candidateId: string;
  sourceAddress: HexAddress;
  contractName: string;
  eventName: string;
  model: "classic" | "stock-paired" | "unresolved";
  releaseVersion: string;
  payloadHash: HexBytes32;
  rawLogCommitment: HexBytes32;
  factoryOccurrenceFingerprint: HexBytes32 | null;
  providerIdentities: readonly [string, string];
  providerVendorGroups: readonly [string, string];
  providerEndpointCommitments: readonly [HexBytes32, HexBytes32];
  providerOriginCommitments: readonly [HexBytes32, HexBytes32];
  providerHeads: readonly [string, string];
  safeBlockNumber: string;
  safeBlockHash: HexBytes32;
  candidateBlockNumber: string;
  candidateBlockHash: HexBytes32;
  candidateBlockTimestamp: string;
  transactionHash: HexBytes32;
  transactionIndex: number;
  receiptCommitment: HexBytes32;
  sourceCodeHash: HexBytes32;
  receiptLogOrdinal: number;
};

export type DualRpcCandidateBatchEvidence = {
  chainId: 1;
  providerIdentities: readonly [string, string];
  providerVendorGroups: readonly [string, string];
  providerEndpointCommitments: readonly [HexBytes32, HexBytes32];
  providerOriginCommitments: readonly [HexBytes32, HexBytes32];
  providerHeads: readonly [string, string];
  safeBlockNumber: string;
  safeBlockHash: HexBytes32;
  candidates: readonly DualRpcCandidateEvidence[];
};

const RELEASE_BINDING = getDataPipelineReleaseBinding();
const PROVIDER_IDENTITY_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const CANDIDATE_ID_PATTERN =
  /^1:(0x[0-9a-f]{64}):(0x[0-9a-f]{64}):(0|[1-9]\d*)$/;
const DEFAULT_RPC_CONCURRENCY = 4;
const DEFAULT_RPC_ATTEMPTS = 3;
const DEFAULT_RPC_BACKOFF_MS = 50;

function safeInteger(value: unknown, operation: string) {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > 0x7fff_ffff
  ) {
    throw validationError("rpc", operation);
  }
  return value;
}

function nonnegativeBigint(value: unknown, operation: string) {
  if (typeof value !== "bigint" || value < 0n) {
    throw validationError("rpc", operation);
  }
  return value;
}

function rpcBytes32(value: unknown, operation: string) {
  try {
    return canonicalBytes32(value);
  } catch {
    throw validationError("rpc", operation);
  }
}

function rpcAddress(value: unknown, operation: string) {
  try {
    return canonicalAddress(value);
  } catch {
    throw validationError("rpc", operation);
  }
}

function rpcData(value: unknown, operation: string) {
  try {
    return canonicalRawData(value);
  } catch {
    throw validationError("rpc", operation);
  }
}

function canonicalBlock(
  value: CandidateRpcBlock,
  expectedNumber: bigint,
  operation: string,
) {
  if (
    value === null ||
    typeof value !== "object" ||
    value.number !== expectedNumber ||
    value.hash === null
  ) {
    throw validationError("rpc", operation);
  }
  return {
    number: expectedNumber,
    hash: rpcBytes32(value.hash, operation),
    timestamp: nonnegativeBigint(value.timestamp, operation),
  };
}

function sameHex(left: string, right: string) {
  return left.toLowerCase() === right.toLowerCase();
}

function canonicalReceipt(input: {
  receipt: CandidateRpcReceipt;
  candidate: EnvioCandidate;
  candidateBlockNumber: bigint;
}) {
  const { receipt, candidate, candidateBlockNumber } = input;
  if (
    receipt === null ||
    typeof receipt !== "object" ||
    receipt.status !== "success" ||
    receipt.blockNumber !== candidateBlockNumber ||
    !sameHex(rpcBytes32(receipt.blockHash, "receipt"), candidate.blockHash) ||
    !sameHex(
      rpcBytes32(receipt.transactionHash, "receipt"),
      candidate.transactionHash,
    ) ||
    safeInteger(receipt.transactionIndex, "receipt") !==
      candidate.transactionIndex ||
    !Array.isArray(receipt.logs) ||
    receipt.logs.length === 0 ||
    receipt.logs.length > 10_000
  ) {
    throw validationError("rpc", "receipt");
  }

  let previousLogIndex = -1;
  let selectedOrdinal = -1;
  const receiptLogs = receipt.logs as readonly CandidateRpcLog[];
  const logs = receiptLogs.map((log, ordinal) => {
    if (
      log === null ||
      typeof log !== "object" ||
      log.blockNumber !== candidateBlockNumber ||
      log.blockHash === null ||
      log.transactionHash === null ||
      log.transactionIndex === null ||
      log.logIndex === null ||
      log.removed !== false ||
      !Array.isArray(log.topics) ||
      log.topics.length < 1 ||
      log.topics.length > 4
    ) {
      throw validationError("rpc", "receipt-log");
    }
    const logIndex = safeInteger(log.logIndex, "receipt-log");
    if (logIndex <= previousLogIndex) {
      throw validationError("rpc", "receipt-log-order");
    }
    previousLogIndex = logIndex;
    const transactionIndex = safeInteger(
      log.transactionIndex,
      "receipt-log",
    );
    const blockHash = rpcBytes32(log.blockHash, "receipt-log");
    const transactionHash = rpcBytes32(
      log.transactionHash,
      "receipt-log",
    );
    const address = rpcAddress(log.address, "receipt-log");
    const topics = log.topics.map((topic) =>
      rpcBytes32(topic, "receipt-log"),
    );
    const data = rpcData(log.data, "receipt-log");
    if (
      !sameHex(blockHash, candidate.blockHash) ||
      !sameHex(transactionHash, candidate.transactionHash) ||
      transactionIndex !== candidate.transactionIndex
    ) {
      throw validationError("rpc", "receipt-log-placement");
    }
    if (logIndex === candidate.blockGlobalLogIndex) {
      if (selectedOrdinal !== -1) {
        throw validationError("rpc", "receipt-log-duplicate");
      }
      selectedOrdinal = ordinal;
      if (
        !sameHex(address, candidate.sourceAddress) ||
        data !== candidate.rawData ||
        topics.length !== candidate.orderedTopics.length ||
        topics.some(
          (topic, index) => topic !== candidate.orderedTopics[index],
        )
      ) {
        throw validationError("rpc", "candidate-log");
      }
    }
    return [
      address,
      blockHash,
      transactionHash,
      transactionIndex,
      logIndex,
      topics,
      data,
    ] as const;
  });
  if (selectedOrdinal < 0) {
    throw validationError("rpc", "candidate-log-missing");
  }

  const preimage = JSON.stringify([
    receipt.status,
    candidateBlockNumber.toString(),
    candidate.blockHash,
    candidate.transactionHash,
    candidate.transactionIndex,
    logs,
  ]);
  return {
    commitment: keccak256(toBytes(preimage)),
    selectedOrdinal,
  };
}

function providerIdentity(value: unknown) {
  if (typeof value !== "string" || !PROVIDER_IDENTITY_PATTERN.test(value)) {
    throw invalidInput("rpc", "provider-identity");
  }
  return value;
}

function rpcExecutionPolicy(
  input:
    | {
        maxConcurrency?: number;
        maxAttempts?: number;
        baseBackoffMs?: number;
        sleep?: (milliseconds: number) => Promise<void>;
      }
    | undefined,
) {
  const maxConcurrency = input?.maxConcurrency ?? DEFAULT_RPC_CONCURRENCY;
  const maxAttempts = input?.maxAttempts ?? DEFAULT_RPC_ATTEMPTS;
  const baseBackoffMs = input?.baseBackoffMs ?? DEFAULT_RPC_BACKOFF_MS;
  if (
    !Number.isSafeInteger(maxConcurrency) ||
    maxConcurrency < 1 ||
    maxConcurrency > 8 ||
    !Number.isSafeInteger(maxAttempts) ||
    maxAttempts < 1 ||
    maxAttempts > 3 ||
    !Number.isSafeInteger(baseBackoffMs) ||
    baseBackoffMs < 0 ||
    baseBackoffMs > 1_000 ||
    (input?.sleep !== undefined && typeof input.sleep !== "function")
  ) {
    throw invalidInput("rpc", "execution-policy");
  }
  return {
    maxConcurrency,
    maxAttempts,
    baseBackoffMs,
    sleep:
      input?.sleep ??
      ((milliseconds: number) =>
        new Promise<void>((resolve) => setTimeout(resolve, milliseconds))),
  };
}

async function retryRpc<T>(
  operation: () => Promise<T>,
  policy: ReturnType<typeof rpcExecutionPolicy>,
) {
  let lastError: unknown;
  for (let attempt = 0; attempt < policy.maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt + 1 < policy.maxAttempts) {
        await policy.sleep(policy.baseBackoffMs * 2 ** attempt);
      }
    }
  }
  throw lastError;
}

async function boundedRpcMap<Input, Output>(
  values: readonly Input[],
  concurrency: number,
  operation: (value: Input) => Promise<Output>,
) {
  const output = new Array<Output>(values.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await operation(values[index]!);
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, values.length) },
      () => worker(),
    ),
  );
  return output;
}

function validateDynamicAttestation(
  value: DynamicSourceAttestation,
): DynamicSourceAttestation {
  let activationBlock: string;
  try {
    activationBlock = parseNonnegativeIntegerText(value?.activationBlock);
  } catch {
    throw invalidInput("rpc", "dynamic-source-attestation");
  }
  const sourceAddress = rpcAddress(
    value?.sourceAddress,
    "dynamic-source-attestation",
  );
  const runtimeCodeHash = rpcBytes32(
    value?.runtimeCodeHash,
    "dynamic-source-attestation",
  );
  const factoryOccurrenceFingerprint = rpcBytes32(
    value?.factoryOccurrenceFingerprint,
    "dynamic-source-attestation",
  );
  if (
    typeof value?.contractName !== "string" ||
    !/^[A-Za-z][A-Za-z0-9]{0,95}$/.test(value.contractName) ||
    (value.model !== "classic" && value.model !== "stock-paired") ||
    typeof value.releaseVersion !== "string"
  ) {
    throw invalidInput("rpc", "dynamic-source-attestation");
  }
  const release = RELEASE_BINDING.releases.find(
    (candidate) =>
      candidate.model === value.model &&
      candidate.releaseVersion === value.releaseVersion &&
      candidate.dynamicContracts.includes(value.contractName),
  );
  if (
    !release ||
    BigInt(activationBlock) < BigInt(release.activationBlock)
  ) {
    throw invalidInput("rpc", "dynamic-source-attestation");
  }
  return {
    sourceAddress,
    contractName: value.contractName,
    model: value.model,
    releaseVersion: value.releaseVersion,
    activationBlock,
    runtimeCodeHash,
    factoryOccurrenceFingerprint,
  };
}

function validateCandidateBoundary(input: {
  candidate: EnvioCandidate;
  dynamicAttestations: readonly DynamicSourceAttestation[];
}) {
  const { candidate } = input;
  if (candidate === null || typeof candidate !== "object") {
    throw invalidInput("rpc", "candidate");
  }
  let blockNumber: bigint;
  let timestamp: bigint;
  try {
    blockNumber = BigInt(parseNonnegativeIntegerText(candidate.blockNumber));
    timestamp = BigInt(
      parseNonnegativeIntegerText(candidate.blockTimestamp),
    );
  } catch {
    throw invalidInput("rpc", "candidate");
  }
  const blockHash = rpcBytes32(candidate.blockHash, "candidate");
  const transactionHash = rpcBytes32(
    candidate.transactionHash,
    "candidate",
  );
  const sourceAddress = rpcAddress(candidate.sourceAddress, "candidate");
  const payloadHash = rpcBytes32(candidate.payloadHash, "candidate");
  const logIndex = safeInteger(
    candidate.blockGlobalLogIndex,
    "candidate-placement",
  );
  const idMatch = CANDIDATE_ID_PATTERN.exec(candidate.candidateId);
  if (
    candidate.chainId !== RELEASE_BINDING.chainId ||
    !idMatch ||
    idMatch[1] !== blockHash ||
    idMatch[2] !== transactionHash ||
    BigInt(idMatch[3]) !== BigInt(logIndex) ||
    typeof candidate.contractName !== "string" ||
    !/^[A-Za-z][A-Za-z0-9]{0,95}$/.test(candidate.contractName) ||
    typeof candidate.eventName !== "string" ||
    !/^[A-Za-z][A-Za-z0-9]{0,95}$/.test(candidate.eventName) ||
    !Array.isArray(candidate.orderedTopics) ||
    candidate.orderedTopics.length < 1 ||
    candidate.orderedTopics.length > 4
  ) {
    throw validationError("rpc", "candidate-envelope");
  }
  const topics = candidate.orderedTopics.map((topic) =>
    rpcBytes32(topic, "candidate-topic"),
  );
  const rawData = rpcData(candidate.rawData, "candidate-data");
  const recomputedPayloadHash = keccak256(
    encodeAbiParameters(
      [{ type: "bytes32[]" }, { type: "bytes" }],
      [topics, rawData],
    ),
  );
  if (payloadHash !== recomputedPayloadHash) {
    throw validationError("rpc", "candidate-payload");
  }
  const model = candidate.releaseHint?.model;
  const releaseVersion = candidate.releaseHint?.releaseVersion;
  if (
    (model !== "classic" &&
      model !== "stock-paired" &&
      model !== "unresolved") ||
    typeof releaseVersion !== "string"
  ) {
    throw validationError("rpc", "candidate-release");
  }
  const staticSource = RELEASE_BINDING.sources.find(
    (source) => source.address === sourceAddress,
  );
  let expectedRuntimeCodeHash: HexBytes32;
  let factoryOccurrenceFingerprint: HexBytes32 | null = null;
  if (staticSource) {
    if (
      staticSource.contractName !== candidate.contractName ||
      blockNumber < BigInt(staticSource.startBlock)
    ) {
      throw validationError("rpc", "candidate-source");
    }
    const releases = RELEASE_BINDING.releases.filter(
      (release) =>
        release.sourceContracts.includes(candidate.contractName) &&
        release.model === model &&
        blockNumber >= BigInt(release.activationBlock),
    );
    const exact = releases.some(
      (release) => release.releaseVersion === releaseVersion,
    );
    const unresolved =
      releaseVersion === "unresolved" && releases.length > 1;
    if (!exact && !unresolved) {
      throw validationError("rpc", "candidate-release");
    }
    expectedRuntimeCodeHash = staticSource.runtimeCodeHash;
  } else {
    const matching = input.dynamicAttestations.filter(
      (attestation) =>
        attestation.sourceAddress === sourceAddress &&
        attestation.contractName === candidate.contractName &&
        attestation.model === model &&
        blockNumber >= BigInt(attestation.activationBlock) &&
        (attestation.releaseVersion === releaseVersion ||
          releaseVersion === "unresolved"),
    );
    if (matching.length !== 1) {
      throw validationError("rpc", "dynamic-source-lineage");
    }
    expectedRuntimeCodeHash = matching[0]!.runtimeCodeHash;
    factoryOccurrenceFingerprint =
      matching[0]!.factoryOccurrenceFingerprint;
  }
  return {
    candidate: {
      ...candidate,
      blockHash,
      transactionHash,
      sourceAddress,
      orderedTopics: topics,
      rawData,
      payloadHash,
    },
    blockNumber,
    timestamp,
    expectedRuntimeCodeHash,
    factoryOccurrenceFingerprint,
  };
}

export async function verifyEnvioCandidateBatchWithDualRpc(input: {
  candidates: readonly EnvioCandidate[];
  providers: readonly [CandidateRpcProvider, CandidateRpcProvider];
  dynamicSourceAttestations?: readonly DynamicSourceAttestation[];
  rpcPolicy?: {
    maxConcurrency?: number;
    maxAttempts?: number;
    baseBackoffMs?: number;
    sleep?: (milliseconds: number) => Promise<void>;
  };
}): Promise<DualRpcCandidateBatchEvidence> {
  assertProductionDualRpcProviders(input.providers);
  const firstIdentity = providerIdentity(input.providers?.[0]?.identity);
  const secondIdentity = providerIdentity(input.providers?.[1]?.identity);
  const firstVendor = providerIdentity(input.providers?.[0]?.vendorGroup);
  const secondVendor = providerIdentity(input.providers?.[1]?.vendorGroup);
  const firstEndpointCommitment = rpcBytes32(
    input.providers?.[0]?.endpointCommitment,
    "provider-endpoint-commitment",
  );
  const secondEndpointCommitment = rpcBytes32(
    input.providers?.[1]?.endpointCommitment,
    "provider-endpoint-commitment",
  );
  const firstOriginCommitment = rpcBytes32(
    input.providers?.[0]?.endpointOriginCommitment,
    "provider-origin-commitment",
  );
  const secondOriginCommitment = rpcBytes32(
    input.providers?.[1]?.endpointOriginCommitment,
    "provider-origin-commitment",
  );
  if (
    firstIdentity === secondIdentity ||
    firstVendor === secondVendor ||
    firstEndpointCommitment === secondEndpointCommitment ||
    firstOriginCommitment === secondOriginCommitment
  ) {
    throw invalidInput("rpc", "provider-independence");
  }
  const clients = [input.providers[0].client, input.providers[1].client] as const;
  if (
    clients.some((client) => client === null || typeof client !== "object") ||
    clients[0] === clients[1]
  ) {
    throw invalidInput("rpc", "provider-client");
  }
  const policy = rpcExecutionPolicy(input.rpcPolicy);
  if (
    !Array.isArray(input.candidates) ||
    input.candidates.length < 1 ||
    input.candidates.length > 32
  ) {
    throw invalidInput("rpc", "candidate-batch");
  }
  if (
    input.dynamicSourceAttestations !== undefined &&
    !Array.isArray(input.dynamicSourceAttestations)
  ) {
    throw invalidInput("rpc", "dynamic-source-attestations");
  }
  const dynamicAttestations = (
    input.dynamicSourceAttestations ?? []
  ).map(validateDynamicAttestation);
  if (
    dynamicAttestations.length > 128 ||
    new Set(
      dynamicAttestations.map(
        (attestation) =>
          `${attestation.sourceAddress}:${attestation.releaseVersion}`,
      ),
    ).size !== dynamicAttestations.length
  ) {
    throw invalidInput("rpc", "dynamic-source-attestations");
  }

  const seenCandidateIds = new Set<string>();
  let previousBlock = -1n;
  let previousLogIndex = -1;
  const candidates = input.candidates.map((candidate) => {
    const validated = validateCandidateBoundary({
      candidate,
      dynamicAttestations,
    });
    const { blockNumber } = validated;
    const logIndex = safeInteger(
      validated.candidate.blockGlobalLogIndex,
      "candidate-placement",
    );
    if (
      seenCandidateIds.has(validated.candidate.candidateId) ||
      blockNumber < previousBlock ||
      (blockNumber === previousBlock && logIndex <= previousLogIndex)
    ) {
      throw validationError("rpc", "candidate-batch-order");
    }
    seenCandidateIds.add(validated.candidate.candidateId);
    previousBlock = blockNumber;
    previousLogIndex = logIndex;
    return validated;
  });

  try {
    const states = await Promise.all(
      clients.map(async (client) => {
        const [chainId, head] = await Promise.all([
          retryRpc(() => client.getChainId(), policy),
          retryRpc(() => client.getBlockNumber(), policy),
        ]);
        return { chainId, head };
      }),
    );
    if (
      states.some(
        (state) =>
          state.chainId !== RELEASE_BINDING.chainId ||
          typeof state.head !== "bigint" ||
          state.head < 0n,
      )
    ) {
      throw validationError("rpc", "provider-state");
    }
    const lowestHead =
      states[0].head < states[1].head ? states[0].head : states[1].head;
    const confirmations = BigInt(RELEASE_BINDING.confirmations);
    if (lowestHead < confirmations) {
      throw validationError("rpc", "safe-head");
    }
    const safeBlockNumber = lowestHead - confirmations;
    if (candidates.some(({ blockNumber }) => blockNumber > safeBlockNumber)) {
      throw validationError("rpc", "candidate-finality");
    }

    const blockNumbers = [
      ...new Set([
        safeBlockNumber.toString(),
        ...candidates.map(({ blockNumber }) => blockNumber.toString()),
      ]),
    ].map((value) => BigInt(value));
    const transactionHashes = [
      ...new Set(
        candidates.map(({ candidate }) => candidate.transactionHash),
      ),
    ];
    const codeRequests = [
      ...new Map(
        candidates.map(({ candidate, blockNumber }) => [
          `${blockNumber}:${candidate.sourceAddress}`,
          {
            address: candidate.sourceAddress,
            blockNumber,
          },
        ]),
      ).entries(),
    ];
    const providerData = await Promise.all(
      clients.map(async (client) => {
        const blocks = await boundedRpcMap(
          blockNumbers,
          policy.maxConcurrency,
          async (blockNumber) => [
            blockNumber.toString(),
            await retryRpc(
              () => client.getBlock({ blockNumber }),
              policy,
            ),
          ] as const,
        );
        const receipts = await boundedRpcMap(
          transactionHashes,
          policy.maxConcurrency,
          async (transactionHash) => [
            transactionHash,
            await retryRpc(
              () => client.getTransactionReceipt({ hash: transactionHash }),
              policy,
            ),
          ] as const,
        );
        const bytecodes = await boundedRpcMap(
          codeRequests,
          policy.maxConcurrency,
          async ([key, request]) => [
            key,
            await retryRpc(() => client.getBytecode(request), policy),
          ] as const,
        );
        return {
          blocks: new Map(blocks),
          receipts: new Map(receipts),
          bytecodes: new Map(bytecodes),
        };
      }),
    );

    const safe = providerData.map((data) =>
      canonicalBlock(
        data.blocks.get(safeBlockNumber.toString())!,
        safeBlockNumber,
        "safe-block",
      ),
    );
    if (
      safe[0].hash !== safe[1].hash ||
      safe[0].timestamp !== safe[1].timestamp
    ) {
      throw validationError("rpc", "safe-block-agreement");
    }

    const providerIdentities = [firstIdentity, secondIdentity] as const;
    const providerVendorGroups = [firstVendor, secondVendor] as const;
    const providerEndpointCommitments = [
      firstEndpointCommitment,
      secondEndpointCommitment,
    ] as const;
    const providerOriginCommitments = [
      firstOriginCommitment,
      secondOriginCommitment,
    ] as const;
    const providerHeads = [
      states[0].head.toString(),
      states[1].head.toString(),
    ] as const;
    const evidence = candidates.map(({
      candidate,
      blockNumber,
      timestamp,
      expectedRuntimeCodeHash,
      factoryOccurrenceFingerprint,
    }) => {
      const blocks = providerData.map((data) =>
        canonicalBlock(
          data.blocks.get(blockNumber.toString())!,
          blockNumber,
          "candidate-block",
        ),
      );
      if (
        blocks.some(
          (block) =>
            block.hash !== candidate.blockHash ||
            block.timestamp !== timestamp,
        ) ||
        blocks[0].hash !== blocks[1].hash ||
        blocks[0].timestamp !== blocks[1].timestamp
      ) {
        throw validationError("rpc", "candidate-block-agreement");
      }

      const canonicalReceipts = providerData.map((data) =>
        canonicalReceipt({
          receipt: data.receipts.get(candidate.transactionHash)!,
          candidate,
          candidateBlockNumber: blockNumber,
        }),
      );
      if (
        canonicalReceipts[0].commitment !==
          canonicalReceipts[1].commitment ||
        canonicalReceipts[0].selectedOrdinal !==
          canonicalReceipts[1].selectedOrdinal
      ) {
        throw validationError("rpc", "receipt-agreement");
      }

      const codeKey = `${blockNumber}:${candidate.sourceAddress}`;
      const code = providerData.map((data) => {
        const value = data.bytecodes.get(codeKey);
        if (value === undefined) throw validationError("rpc", "source-code");
        const canonical = rpcData(value, "source-code");
        if (canonical === "0x") throw validationError("rpc", "source-code");
        return canonical;
      });
      if (code[0] !== code[1]) {
        throw validationError("rpc", "source-code-agreement");
      }
      const sourceCodeHash = keccak256(code[0]);
      if (sourceCodeHash !== expectedRuntimeCodeHash) {
        throw validationError("rpc", "source-code-release");
      }
      const rawLogCommitment = keccak256(
        encodeAbiParameters(
          [{ type: "address" }, { type: "bytes32[]" }, { type: "bytes" }],
          [
            candidate.sourceAddress,
            candidate.orderedTopics,
            candidate.rawData,
          ],
        ),
      );

      return {
        chainId: 1,
        candidateId: candidate.candidateId,
        sourceAddress: candidate.sourceAddress,
        contractName: candidate.contractName,
        eventName: candidate.eventName,
        model: candidate.releaseHint.model,
        releaseVersion: candidate.releaseHint.releaseVersion,
        payloadHash: candidate.payloadHash,
        rawLogCommitment,
        factoryOccurrenceFingerprint,
        providerIdentities,
        providerVendorGroups,
        providerEndpointCommitments,
        providerOriginCommitments,
        providerHeads,
        safeBlockNumber: safeBlockNumber.toString(),
        safeBlockHash: safe[0].hash,
        candidateBlockNumber: blockNumber.toString(),
        candidateBlockHash: blocks[0].hash,
        candidateBlockTimestamp: timestamp.toString(),
        transactionHash: candidate.transactionHash,
        transactionIndex: candidate.transactionIndex,
        receiptCommitment: canonicalReceipts[0].commitment,
        sourceCodeHash,
        receiptLogOrdinal: canonicalReceipts[0].selectedOrdinal,
      } satisfies DualRpcCandidateEvidence;
    });

    return {
      chainId: 1,
      providerIdentities,
      providerVendorGroups,
      providerEndpointCommitments,
      providerOriginCommitments,
      providerHeads,
      safeBlockNumber: safeBlockNumber.toString(),
      safeBlockHash: safe[0].hash,
      candidates: evidence,
    };
  } catch (error) {
    if (error instanceof DataPipelineError) throw error;
    throw dataPipelineError({
      dependency: "rpc",
      code: "dependency_unavailable",
      retryable: true,
      countsTowardCircuit: true,
    });
  }
}

export async function verifyEnvioCandidateWithDualRpc(input: {
  candidate: EnvioCandidate;
  providers: readonly [CandidateRpcProvider, CandidateRpcProvider];
  dynamicSourceAttestations?: readonly DynamicSourceAttestation[];
  rpcPolicy?: {
    maxConcurrency?: number;
    maxAttempts?: number;
    baseBackoffMs?: number;
    sleep?: (milliseconds: number) => Promise<void>;
  };
}): Promise<DualRpcCandidateEvidence> {
  const result = await verifyEnvioCandidateBatchWithDualRpc({
    candidates: [input.candidate],
    providers: input.providers,
    dynamicSourceAttestations: input.dynamicSourceAttestations,
    rpcPolicy: input.rpcPolicy,
  });
  return result.candidates[0]!;
}
