import "server-only";

import { encodeAbiParameters, keccak256 } from "viem";

import { CircuitBreaker } from "./circuit";
import {
  canonicalAddress,
  canonicalBytes32,
  canonicalRawData,
  parseNonnegativeIntegerText,
  type HexAddress,
  type HexBytes32,
  type HexData,
} from "./codecs";
import { loadDataPipelineConfig } from "./config";
import {
  DataPipelineError,
  invalidInput,
  validationError,
} from "./errors";
import { decodeManifestEvent } from "./event-manifest";
import { getDataPipelineReleaseBinding } from "./release-binding.server";
import {
  boundedJsonRequest,
  type DataPipelineFetcher,
} from "./request";

const CANDIDATE_QUERY = `
  query ProgrammableCandidate($candidateId: String!) {
    ChainEvent_by_pk(id: $candidateId) {
      id
      downstreamLogicalId
      receiptLogOrdinal
      chainId
      blockNumber
      blockHash
      blockTimestamp
      transactionHash
      transactionIndex
      blockGlobalLogIndex
      sourceAddress
      contractName
      eventName
      model
      releaseVersion
      topics
      data
      decodedPayload
      payloadHash
    }
  }
`;

const CANDIDATES_AFTER_QUERY = `
  query ProgrammableCandidatesAfter(
    $afterBlock: numeric!
    $afterLogIndex: Int!
    $first: Int!
  ) {
    ChainEvent(
      where: {
        _or: [
          { blockNumber: { _gt: $afterBlock } }
          {
            _and: [
              { blockNumber: { _eq: $afterBlock } }
              { blockGlobalLogIndex: { _gt: $afterLogIndex } }
            ]
          }
        ]
      }
      order_by: [{ blockNumber: asc }, { blockGlobalLogIndex: asc }]
      limit: $first
    ) {
      id
      downstreamLogicalId
      receiptLogOrdinal
      chainId
      blockNumber
      blockHash
      blockTimestamp
      transactionHash
      transactionIndex
      blockGlobalLogIndex
      sourceAddress
      contractName
      eventName
      model
      releaseVersion
      topics
      data
      decodedPayload
      payloadHash
    }
  }
`;

const PROGRESS_QUERY = `
  query ProgrammableIndexerProgress($stateId: String!) {
    _meta(where: { chainId: { _eq: 1 } }) {
      chainId
      progressBlock
      bufferBlock
      sourceBlock
      isReady
      eventsProcessed
    }
    IndexerState_by_pk(id: $stateId) {
      id
      schemaVersion
      deployment
      sourceCommit
      configSha256
      schemaSha256
      handlerSha256
      sourceRegistrySha256
      eventSetSha256
      eventCount
      chainId
      progressBlock
      progressBlockHash
      progressTimestamp
      progressTransactionHash
      progressOccurrenceId
    }
  }
`;

const INDEXER_STATE_ID = "ethereum-mainnet";
const SCHEMA_VERSION = "1";
const RELEASE_BINDING = getDataPipelineReleaseBinding();

type ReviewedModel = "classic" | "stock-paired";
type ReviewedReleaseVersion =
  | "classic-v2"
  | "classic-v3"
  | "stock-paired-v1"
  | "stock-paired-v2"
  | "stock-paired-v3";
type ReviewedRelease = {
  model: ReviewedModel;
  releaseVersion: ReviewedReleaseVersion;
  sourceContracts: readonly string[];
  dynamicContracts: readonly string[];
  startBlock: bigint;
};

function reviewedModel(value: string): ReviewedModel {
  if (value !== "classic" && value !== "stock-paired") {
    throw new Error("Unsupported data pipeline model binding");
  }
  return value;
}

function reviewedReleaseVersion(value: string): ReviewedReleaseVersion {
  if (
    ![
      "classic-v2",
      "classic-v3",
      "stock-paired-v1",
      "stock-paired-v2",
      "stock-paired-v3",
    ].includes(value)
  ) {
    throw new Error("Unsupported data pipeline release binding");
  }
  return value as ReviewedReleaseVersion;
}

const REVIEWED_RELEASES: readonly ReviewedRelease[] =
  RELEASE_BINDING.releases.map((release) => {
    const sourceStarts = release.sourceContracts.map((contractName) => {
      const source = RELEASE_BINDING.sources.find(
        (candidate) => candidate.contractName === contractName,
      );
      if (!source) throw new Error("Incomplete data pipeline source binding");
      return BigInt(source.startBlock);
    });
    return {
      model: reviewedModel(release.model),
      releaseVersion: reviewedReleaseVersion(release.releaseVersion),
      sourceContracts: release.sourceContracts,
      dynamicContracts: release.dynamicContracts,
      startBlock: sourceStarts.reduce(
        (minimum, current) => (current < minimum ? current : minimum),
        sourceStarts[0],
      ),
    };
  });

const REVIEWED_STATIC_SOURCES = new Map(
  RELEASE_BINDING.sources.map((source) => {
    const releases = REVIEWED_RELEASES.filter((release) =>
      release.sourceContracts.includes(source.contractName),
    );
    if (releases.length === 0) {
      throw new Error("Orphaned data pipeline source binding");
    }
    return [
      source.address,
      {
        contractName: source.contractName,
        startBlock: BigInt(source.startBlock),
        releases,
      },
    ] as const;
  }),
);

const REVIEWED_DYNAMIC_SOURCES = new Map<string, ReviewedRelease[]>();
for (const release of REVIEWED_RELEASES) {
  for (const contractName of release.dynamicContracts) {
    const releases = REVIEWED_DYNAMIC_SOURCES.get(contractName) ?? [];
    releases.push(release);
    REVIEWED_DYNAMIC_SOURCES.set(contractName, releases);
  }
}

const CANDIDATE_PATTERN =
  /^1:(0x[0-9a-f]{64}):(0x[0-9a-f]{64}):(0|[1-9]\d*)$/;
const GRAPHQL_INT_MAXIMUM = 0x7fff_ffff;
const DEFAULT_CANDIDATE_PAGE_LIMIT = 25;
const MAXIMUM_CANDIDATE_PAGE_LIMIT = 32;

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function onlyKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function strictSafeInteger(value: unknown, maximum = Number.MAX_SAFE_INTEGER) {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > maximum
  ) {
    throw validationError("envio", "placement");
  }
  return value;
}

function strictString(value: unknown, pattern: RegExp, operation: string) {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw validationError("envio", operation);
  }
  return value;
}

export type EnvioCandidate = {
  candidateId: string;
  chainId: 1;
  blockNumber: string;
  blockHash: HexBytes32;
  blockTimestamp: string;
  transactionHash: HexBytes32;
  transactionIndex: number;
  blockGlobalLogIndex: number;
  sourceAddress: HexAddress;
  contractName: string;
  eventName: string;
  releaseHint: {
    model: "classic" | "stock-paired" | "unresolved";
    releaseVersion: string;
  };
  orderedTopics: HexBytes32[];
  rawData: HexData;
  decodedPayload: Record<string, unknown>;
  payloadHash: HexBytes32;
};

export type EnvioCandidateCursor = {
  blockNumber: string;
  blockGlobalLogIndex: number;
};

function canonicalCandidateCursor(
  value: EnvioCandidateCursor,
): EnvioCandidateCursor {
  let blockNumber: string;
  try {
    blockNumber = parseNonnegativeIntegerText(value?.blockNumber);
  } catch {
    throw invalidInput("envio", "candidate-cursor");
  }
  if (
    !Number.isSafeInteger(value?.blockGlobalLogIndex) ||
    value.blockGlobalLogIndex < -1 ||
    value.blockGlobalLogIndex > GRAPHQL_INT_MAXIMUM
  ) {
    throw invalidInput("envio", "candidate-cursor");
  }
  return { blockNumber, blockGlobalLogIndex: value.blockGlobalLogIndex };
}

function placementAfter(
  candidate: Pick<EnvioCandidate, "blockNumber" | "blockGlobalLogIndex">,
  cursor: EnvioCandidateCursor,
) {
  const candidateBlock = BigInt(candidate.blockNumber);
  const cursorBlock = BigInt(cursor.blockNumber);
  return (
    candidateBlock > cursorBlock ||
    (candidateBlock === cursorBlock &&
      candidate.blockGlobalLogIndex > cursor.blockGlobalLogIndex)
  );
}

function validateSource(input: {
  sourceAddress: HexAddress;
  contractName: string;
  blockNumber: bigint;
  model: string;
  releaseVersion: string;
}) {
  const source = REVIEWED_STATIC_SOURCES.get(input.sourceAddress);
  if (source) {
    if (
      source.contractName !== input.contractName ||
      input.blockNumber < source.startBlock
    ) {
      throw validationError("envio", "source-provenance");
    }
    const exact = source.releases.some(
      (release) =>
        release.model === input.model &&
        release.releaseVersion === input.releaseVersion,
    );
    const unresolved =
      input.releaseVersion === "unresolved" &&
      source.releases.length > 1 &&
      source.releases.every((release) => release.model === input.model);
    if (!exact && !unresolved) {
      throw validationError("envio", "source-release-provenance");
    }
    return;
  }

  const dynamicReleases = REVIEWED_DYNAMIC_SOURCES.get(input.contractName);
  if (!dynamicReleases) {
    throw validationError("envio", "dynamic-source-provenance");
  }
  const exact = dynamicReleases.some(
    (release) =>
      release.model === input.model &&
      release.releaseVersion === input.releaseVersion &&
      input.blockNumber >= release.startBlock,
  );
  const unresolved =
    input.releaseVersion === "unresolved" &&
    dynamicReleases.length > 1 &&
    dynamicReleases.every((release) => release.model === input.model) &&
    dynamicReleases.some((release) => input.blockNumber >= release.startBlock);
  if (!exact && !unresolved) {
    throw validationError("envio", "dynamic-source-release-provenance");
  }
}

function parseCandidate(
  value: unknown,
  requestedCandidateId: string,
): EnvioCandidate {
  const keys = [
    "id",
    "downstreamLogicalId",
    "receiptLogOrdinal",
    "chainId",
    "blockNumber",
    "blockHash",
    "blockTimestamp",
    "transactionHash",
    "transactionIndex",
    "blockGlobalLogIndex",
    "sourceAddress",
    "contractName",
    "eventName",
    "model",
    "releaseVersion",
    "topics",
    "data",
    "decodedPayload",
    "payloadHash",
  ] as const;
  if (
    !isRecord(value) ||
    !onlyKeys(value, keys) ||
    value.downstreamLogicalId !== null ||
    value.receiptLogOrdinal !== null ||
    value.chainId !== 1 ||
    value.id !== requestedCandidateId ||
    typeof value.id !== "string"
  ) {
    throw validationError("envio", "candidate");
  }
  const match = CANDIDATE_PATTERN.exec(value.id);
  if (!match) throw validationError("envio", "candidate-id");
  const blockNumber = parseNonnegativeIntegerText(value.blockNumber);
  const blockHash = canonicalBytes32(value.blockHash);
  const transactionHash = canonicalBytes32(value.transactionHash);
  const blockGlobalLogIndex = strictSafeInteger(
    value.blockGlobalLogIndex,
    GRAPHQL_INT_MAXIMUM,
  );
  if (
    match[1] !== blockHash ||
    match[2] !== transactionHash ||
    BigInt(match[3]) !== BigInt(blockGlobalLogIndex)
  ) {
    throw validationError("envio", "candidate-placement");
  }
  const sourceAddress = canonicalAddress(value.sourceAddress);
  const contractName = strictString(
    value.contractName,
    /^[A-Za-z][A-Za-z0-9]{0,63}$/,
    "contract-name",
  );
  const eventName = strictString(
    value.eventName,
    /^[A-Za-z][A-Za-z0-9]{0,95}$/,
    "event-name",
  );
  const model = strictString(
    value.model,
    /^(classic|stock-paired|unresolved)$/,
    "model",
  ) as "classic" | "stock-paired" | "unresolved";
  const releaseVersion = strictString(
    value.releaseVersion,
    /^(classic-v[23]|stock-paired-v[123]|unresolved)$/,
    "release-version",
  );
  validateSource({
    sourceAddress,
    contractName,
    blockNumber: BigInt(blockNumber),
    model,
    releaseVersion,
  });
  if (
    !Array.isArray(value.topics) ||
    value.topics.length < 1 ||
    value.topics.length > 4
  ) {
    throw validationError("envio", "topics");
  }
  const orderedTopics = value.topics.map((topic) => canonicalBytes32(topic));
  const rawData = canonicalRawData(value.data);
  const payloadHash = canonicalBytes32(value.payloadHash);
  const recomputedPayloadHash = keccak256(
    encodeAbiParameters(
      [{ type: "bytes32[]" }, { type: "bytes" }],
      [orderedTopics, rawData],
    ),
  );
  if (payloadHash !== recomputedPayloadHash) {
    throw validationError("envio", "payload-hash");
  }
  let decodedPayload: unknown;
  try {
    decodedPayload =
      typeof value.decodedPayload === "string"
        ? JSON.parse(value.decodedPayload)
        : null;
  } catch {
    throw validationError("envio", "decoded-payload");
  }
  if (!isRecord(decodedPayload)) {
    throw validationError("envio", "decoded-payload");
  }
  let locallyDecodedPayload: Record<string, unknown>;
  try {
    locallyDecodedPayload = decodeManifestEvent({
      contractName,
      eventName,
      topics: orderedTopics,
      data: rawData,
      providerPayload: decodedPayload,
    });
  } catch {
    throw validationError("envio", "event-abi");
  }

  return {
    candidateId: value.id,
    chainId: 1,
    blockNumber,
    blockHash,
    blockTimestamp: parseNonnegativeIntegerText(value.blockTimestamp),
    transactionHash,
    transactionIndex: strictSafeInteger(
      value.transactionIndex,
      GRAPHQL_INT_MAXIMUM,
    ),
    blockGlobalLogIndex,
    sourceAddress,
    contractName,
    eventName,
    releaseHint: { model, releaseVersion },
    orderedTopics,
    rawData,
    decodedPayload: locallyDecodedPayload,
    payloadHash,
  };
}

export type EnvioProgress = {
  chainId: 1;
  deployment: string;
  schemaVersion: "1";
  progressBlock: string;
  bufferBlock: string;
  sourceBlock: string;
  eventsProcessed: string;
  lastHandledEventBlock: string;
  lastHandledEventBlockHash: HexBytes32;
  lastHandledEventTimestamp: string;
  lastHandledEventTransactionHash: HexBytes32;
  lastHandledEventOccurrenceId: string;
  requiredBlock: string;
  lagBlocks: string;
  isReady: boolean;
};

function parseProgress(
  metaValue: unknown,
  value: unknown,
  requiredBlock: string,
): EnvioProgress {
  const keys = [
    "id",
    "schemaVersion",
    "deployment",
    "sourceCommit",
    "configSha256",
    "schemaSha256",
    "handlerSha256",
    "sourceRegistrySha256",
    "eventSetSha256",
    "eventCount",
    "chainId",
    "progressBlock",
    "progressBlockHash",
    "progressTimestamp",
    "progressTransactionHash",
    "progressOccurrenceId",
  ] as const;
  if (
    !isRecord(value) ||
    !onlyKeys(value, keys) ||
    value.id !== INDEXER_STATE_ID ||
    value.schemaVersion !== SCHEMA_VERSION ||
    value.chainId !== 1 ||
    value.deployment !== RELEASE_BINDING.envio.deploymentLabel ||
    value.sourceCommit !== RELEASE_BINDING.envio.sourceCommit ||
    value.configSha256 !== RELEASE_BINDING.envio.configSha256 ||
    value.schemaSha256 !== RELEASE_BINDING.envio.schemaSha256 ||
    value.handlerSha256 !== RELEASE_BINDING.envio.handlerSha256 ||
    value.sourceRegistrySha256 !==
      RELEASE_BINDING.envio.sourceRegistrySha256 ||
    value.eventSetSha256 !== RELEASE_BINDING.envio.eventSetSha256 ||
    value.eventCount !== RELEASE_BINDING.envio.eventCount ||
    !Array.isArray(metaValue) ||
    metaValue.length !== 1 ||
    !isRecord(metaValue[0]) ||
    !onlyKeys(metaValue[0], [
      "chainId",
      "progressBlock",
      "bufferBlock",
      "sourceBlock",
      "isReady",
      "eventsProcessed",
    ])
  ) {
    throw validationError("envio", "progress");
  }
  const meta = metaValue[0];
  const officialProgress = strictSafeInteger(meta.progressBlock);
  const bufferBlock = strictSafeInteger(meta.bufferBlock);
  const sourceBlock = strictSafeInteger(meta.sourceBlock);
  const eventsProcessed = strictSafeInteger(meta.eventsProcessed);
  if (
    meta.chainId !== 1 ||
    typeof meta.isReady !== "boolean" ||
    officialProgress > bufferBlock ||
    bufferBlock > sourceBlock
  ) {
    throw validationError("envio", "progress-meta");
  }
  const lastHandledEventBlock = parseNonnegativeIntegerText(
    value.progressBlock,
  );
  if (BigInt(lastHandledEventBlock) > BigInt(officialProgress)) {
    throw validationError("envio", "progress-order");
  }
  const canonicalRequired = parseNonnegativeIntegerText(requiredBlock);
  const progressOccurrenceId = strictString(
    value.progressOccurrenceId,
    CANDIDATE_PATTERN,
    "progress-occurrence",
  );
  const occurrenceMatch = CANDIDATE_PATTERN.exec(progressOccurrenceId);
  if (!occurrenceMatch) {
    throw validationError("envio", "progress-occurrence");
  }
  const progressBlockHash = canonicalBytes32(value.progressBlockHash);
  const progressTransactionHash = canonicalBytes32(
    value.progressTransactionHash,
  );
  if (
    occurrenceMatch[1] !== progressBlockHash ||
    occurrenceMatch[2] !== progressTransactionHash
  ) {
    throw validationError("envio", "progress-occurrence-identity");
  }
  const progress = BigInt(officialProgress);
  const required = BigInt(canonicalRequired);
  return {
    chainId: 1,
    deployment: RELEASE_BINDING.envio.deploymentLabel,
    schemaVersion: "1",
    progressBlock: String(officialProgress),
    bufferBlock: String(bufferBlock),
    sourceBlock: String(sourceBlock),
    eventsProcessed: String(eventsProcessed),
    lastHandledEventBlock,
    lastHandledEventBlockHash: progressBlockHash,
    lastHandledEventTimestamp: parseNonnegativeIntegerText(
      value.progressTimestamp,
    ),
    lastHandledEventTransactionHash: progressTransactionHash,
    lastHandledEventOccurrenceId: progressOccurrenceId,
    requiredBlock: canonicalRequired,
    lagBlocks: (required > progress ? required - progress : 0n).toString(),
    isReady: meta.isReady && progress >= required,
  };
}

export function createEnvioClient(options: {
  endpoint: string;
  token?: string;
  fetcher?: DataPipelineFetcher;
  circuit?: CircuitBreaker;
}) {
  const config = loadDataPipelineConfig({
    PROGRAMMABLE_ENVIO_GRAPHQL_URL: options.endpoint,
    PROGRAMMABLE_ENVIO_GRAPHQL_TOKEN: options.token,
  });
  if (!config.envio.endpoint) {
    throw invalidInput("config", "envio-config");
  }
  const circuit =
    options.circuit ?? new CircuitBreaker({ dependency: "envio" });
  const request = (body: unknown) =>
    boundedJsonRequest<unknown>({
      dependency: "envio",
      endpoint: config.envio.endpoint!,
      timeoutMs: config.envio.timeoutMs,
      maximumBodyBytes: config.envio.maximumBodyBytes,
      fetcher: options.fetcher,
      headers: config.envio.token
        ? { authorization: `Bearer ${config.envio.token}` }
        : undefined,
      body,
    });

  return Object.freeze({
    async readCandidate(
      candidateId: string,
    ): Promise<EnvioCandidate | null> {
      if (!CANDIDATE_PATTERN.test(candidateId)) {
        throw invalidInput("envio", "candidate-id");
      }
      return circuit.execute(async () => {
        const response = await request({
          query: CANDIDATE_QUERY,
          variables: { candidateId },
        });
        if (
          !isRecord(response) ||
          !onlyKeys(response, ["data"]) ||
          !isRecord(response.data) ||
          !onlyKeys(response.data, ["ChainEvent_by_pk"])
        ) {
          throw validationError("envio", "candidate-response");
        }
        if (response.data.ChainEvent_by_pk === null) return null;
        try {
          return parseCandidate(response.data.ChainEvent_by_pk, candidateId);
        } catch (error) {
          if (error instanceof DataPipelineError) {
            throw validationError("envio", "candidate-response");
          }
          throw error;
        }
      });
    },

    async readCandidatesAfter(input: {
      cursor: EnvioCandidateCursor;
      limit?: number;
    }): Promise<EnvioCandidate[]> {
      const cursor = canonicalCandidateCursor(input?.cursor);
      const limit = input?.limit ?? DEFAULT_CANDIDATE_PAGE_LIMIT;
      if (
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > MAXIMUM_CANDIDATE_PAGE_LIMIT
      ) {
        throw invalidInput("envio", "candidate-page-limit");
      }
      return circuit.execute(async () => {
        const response = await request({
          query: CANDIDATES_AFTER_QUERY,
          variables: {
            afterBlock: cursor.blockNumber,
            afterLogIndex: cursor.blockGlobalLogIndex,
            first: limit,
          },
        });
        if (
          !isRecord(response) ||
          !onlyKeys(response, ["data"]) ||
          !isRecord(response.data) ||
          !onlyKeys(response.data, ["ChainEvent"]) ||
          !Array.isArray(response.data.ChainEvent) ||
          response.data.ChainEvent.length > limit
        ) {
          throw validationError("envio", "candidate-page-response");
        }
        try {
          const result: EnvioCandidate[] = [];
          let previous = cursor;
          for (const row of response.data.ChainEvent) {
            if (!isRecord(row) || typeof row.id !== "string") {
              throw validationError("envio", "candidate-page-row");
            }
            const parsed = parseCandidate(row, row.id);
            if (!placementAfter(parsed, previous)) {
              throw validationError("envio", "candidate-page-order");
            }
            result.push(parsed);
            previous = {
              blockNumber: parsed.blockNumber,
              blockGlobalLogIndex: parsed.blockGlobalLogIndex,
            };
          }
          return result;
        } catch (error) {
          if (error instanceof DataPipelineError) {
            throw validationError("envio", "candidate-page-response");
          }
          throw error;
        }
      });
    },

    async readProgress(input: {
      requiredBlock: string;
    }): Promise<EnvioProgress> {
      const requiredBlock = parseNonnegativeIntegerText(input.requiredBlock);
      return circuit.execute(async () => {
        const response = await request({
          query: PROGRESS_QUERY,
          variables: { stateId: INDEXER_STATE_ID },
        });
        if (
          !isRecord(response) ||
          !onlyKeys(response, ["data"]) ||
          !isRecord(response.data) ||
          !onlyKeys(response.data, ["_meta", "IndexerState_by_pk"]) ||
          response.data.IndexerState_by_pk === null
        ) {
          throw validationError("envio", "progress-response");
        }
        try {
          return parseProgress(
            response.data._meta,
            response.data.IndexerState_by_pk,
            requiredBlock,
          );
        } catch (error) {
          if (error instanceof DataPipelineError) {
            throw validationError("envio", "progress-response");
          }
          throw error;
        }
      });
    },

    circuitSnapshot: () => circuit.snapshot(),
  });
}
