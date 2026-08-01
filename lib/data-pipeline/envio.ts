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
import {
  getDataPipelineReleaseBinding,
  parseDataPipelineReleaseBinding,
  type DataPipelineReleaseBinding,
} from "./release-binding.server";
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
    $afterLogIndex: numeric!
    $afterCandidateId: String!
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
          {
            _and: [
              { blockNumber: { _eq: $afterBlock } }
              { blockGlobalLogIndex: { _eq: $afterLogIndex } }
              { id: { _gt: $afterCandidateId } }
            ]
          }
        ]
      }
      order_by: [
        { blockNumber: asc }
        { blockGlobalLogIndex: asc }
        { id: asc }
      ]
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

const CANDIDATES_WINDOW_QUERY = `
  query ProgrammableCandidatesWindow(
    $afterBlock: numeric!
    $afterLogIndex: numeric!
    $afterCandidateId: String!
    $throughBlock: numeric!
    $first: Int!
  ) {
    ChainEvent(
      where: {
        _and: [
          { blockNumber: { _lte: $throughBlock } }
          {
            _or: [
              { blockNumber: { _gt: $afterBlock } }
              {
                _and: [
                  { blockNumber: { _eq: $afterBlock } }
                  { blockGlobalLogIndex: { _gt: $afterLogIndex } }
                ]
              }
              {
                _and: [
                  { blockNumber: { _eq: $afterBlock } }
                  { blockGlobalLogIndex: { _eq: $afterLogIndex } }
                  { id: { _gt: $afterCandidateId } }
                ]
              }
            ]
          }
        ]
      }
      order_by: [
        { blockNumber: asc }
        { blockGlobalLogIndex: asc }
        { id: asc }
      ]
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
  activationBlock: bigint;
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

type ReviewedEnvioBinding = Readonly<{
  releaseBinding: DataPipelineReleaseBinding;
  releases: readonly ReviewedRelease[];
  staticSources: ReadonlyMap<
    HexAddress,
    Readonly<{
      contractName: string;
      startBlock: bigint;
      releases: readonly ReviewedRelease[];
    }>
  >;
  dynamicSources: ReadonlyMap<string, readonly ReviewedRelease[]>;
}>;

function reviewedEnvioBinding(
  selectedBinding: DataPipelineReleaseBinding,
): ReviewedEnvioBinding {
  const releaseBinding = parseDataPipelineReleaseBinding(selectedBinding);
  const releases: readonly ReviewedRelease[] = releaseBinding.releases.map(
    (release) => {
    return {
      model: reviewedModel(release.model),
      releaseVersion: reviewedReleaseVersion(release.releaseVersion),
      sourceContracts: release.sourceContracts,
      dynamicContracts: release.dynamicContracts,
      activationBlock: BigInt(release.activationBlock),
    };
    },
  );
  const staticSources = new Map(
    releaseBinding.sources.map((source) => {
      const sourceReleases = releases.filter((release) =>
        release.sourceContracts.includes(source.contractName),
      );
      if (sourceReleases.length === 0) {
        throw new Error("Orphaned data pipeline source binding");
      }
      return [
        source.address,
        Object.freeze({
          contractName: source.contractName,
          startBlock: BigInt(source.startBlock),
          releases: Object.freeze(sourceReleases),
        }),
      ] as const;
    }),
  );
  const dynamicSources = new Map<string, readonly ReviewedRelease[]>();
  for (const release of releases) {
    for (const contractName of release.dynamicContracts) {
      dynamicSources.set(
        contractName,
        Object.freeze([...(dynamicSources.get(contractName) ?? []), release]),
      );
    }
  }
  return Object.freeze({
    releaseBinding,
    releases: Object.freeze(releases),
    staticSources,
    dynamicSources,
  });
}

const CANDIDATE_PATTERN =
  /^1:(0x[0-9a-f]{64}):(0x[0-9a-f]{64}):(0|[1-9]\d*)$/;
const UINT32_MAXIMUM = 0xffff_ffff;
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

function strictUint32Decimal(value: unknown, operation: string) {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value)) {
    throw validationError("envio", operation);
  }
  const parsed = BigInt(value);
  if (parsed > BigInt(UINT32_MAXIMUM)) {
    throw validationError("envio", operation);
  }
  return Number(parsed);
}

function graphqlUint32OrGenesis(value: number): string {
  return String(value);
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
  candidateId: string;
};

function canonicalCandidateCursor(
  value: EnvioCandidateCursor,
): EnvioCandidateCursor {
  const inputBlockNumber = value?.blockNumber;
  const blockGlobalLogIndex = value?.blockGlobalLogIndex;
  const candidateId = value?.candidateId;
  let blockNumber: string;
  try {
    blockNumber = parseNonnegativeIntegerText(inputBlockNumber);
  } catch {
    throw invalidInput("envio", "candidate-cursor");
  }
  if (
    !Number.isSafeInteger(blockGlobalLogIndex) ||
    blockGlobalLogIndex < -1 ||
    blockGlobalLogIndex > UINT32_MAXIMUM
  ) {
    throw invalidInput("envio", "candidate-cursor");
  }
  const candidateMatch =
    typeof candidateId === "string"
      ? CANDIDATE_PATTERN.exec(candidateId)
      : null;
  const isGenesisCursor =
    blockGlobalLogIndex === -1 && candidateId === "";
  const isPredecessorBlockCursor =
    blockGlobalLogIndex === UINT32_MAXIMUM && candidateId === "";
  const isTerminalBlockCursor =
    blockGlobalLogIndex === UINT32_MAXIMUM && candidateId === "empty-page";
  const isPlacedCursor =
    blockGlobalLogIndex >= 0 &&
    candidateMatch !== null &&
    BigInt(candidateMatch[3]) === BigInt(blockGlobalLogIndex);
  if (
    !isGenesisCursor &&
    !isPredecessorBlockCursor &&
    !isTerminalBlockCursor &&
    !isPlacedCursor
  ) {
    throw invalidInput("envio", "candidate-cursor");
  }
  return {
    blockNumber,
    blockGlobalLogIndex,
    candidateId,
  };
}

function placementAfter(
  candidate: Pick<
    EnvioCandidate,
    "blockNumber" | "blockGlobalLogIndex" | "candidateId"
  >,
  cursor: EnvioCandidateCursor,
) {
  const candidateBlock = BigInt(candidate.blockNumber);
  const cursorBlock = BigInt(cursor.blockNumber);
  return (
    candidateBlock > cursorBlock ||
    (candidateBlock === cursorBlock &&
      (candidate.blockGlobalLogIndex > cursor.blockGlobalLogIndex ||
        (candidate.blockGlobalLogIndex === cursor.blockGlobalLogIndex &&
          candidate.candidateId > cursor.candidateId)))
  );
}

function parseCandidatePage(input: {
  response: unknown;
  cursor: EnvioCandidateCursor;
  limit: number;
  throughBlock?: string;
  reviewedBinding: ReviewedEnvioBinding;
}): EnvioCandidate[] {
  const { response, cursor, limit, throughBlock, reviewedBinding } = input;
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
      const parsed = parseCandidate(row, row.id, reviewedBinding);
      if (
        !placementAfter(parsed, previous) ||
        (throughBlock !== undefined &&
          BigInt(parsed.blockNumber) > BigInt(throughBlock))
      ) {
        throw validationError("envio", "candidate-page-order");
      }
      result.push(parsed);
      previous = {
        blockNumber: parsed.blockNumber,
        blockGlobalLogIndex: parsed.blockGlobalLogIndex,
        candidateId: parsed.candidateId,
      };
    }
    return result;
  } catch (error) {
    if (error instanceof DataPipelineError) {
      throw validationError("envio", "candidate-page-response");
    }
    throw error;
  }
}

function validateSource(input: {
  sourceAddress: HexAddress;
  contractName: string;
  blockNumber: bigint;
  model: string;
  releaseVersion: string;
}, reviewedBinding: ReviewedEnvioBinding) {
  const source = reviewedBinding.staticSources.get(input.sourceAddress);
  if (source) {
    if (
      source.contractName !== input.contractName ||
      input.blockNumber < source.startBlock
    ) {
      throw validationError("envio", "source-provenance");
    }
    const exact = source.releases.some(
      (release) =>
        source.releases.length === 1 &&
        release.model === input.model &&
        release.releaseVersion === input.releaseVersion &&
        input.blockNumber >= release.activationBlock,
    );
    const activeReleases = source.releases.filter(
      (release) => input.blockNumber >= release.activationBlock,
    );
    const unresolved =
      input.model === "unresolved" &&
      input.releaseVersion === "unresolved" &&
      source.releases.length > 1 &&
      new Set(source.releases.map((release) => release.model)).size === 1 &&
      activeReleases.length > 0;
    if (!exact && !unresolved) {
      throw validationError("envio", "source-release-provenance");
    }
    return;
  }

  const dynamicReleases = reviewedBinding.dynamicSources.get(
    input.contractName,
  );
  if (
    !dynamicReleases ||
    input.model !== "unresolved" ||
    input.releaseVersion !== "unresolved" ||
    dynamicReleases.every(
      (release) => input.blockNumber < release.activationBlock,
    )
  ) {
    throw validationError("envio", "dynamic-source-provenance");
  }
}

function parseCandidate(
  value: unknown,
  requestedCandidateId: string,
  reviewedBinding: ReviewedEnvioBinding,
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
  const blockGlobalLogIndex = strictUint32Decimal(
    value.blockGlobalLogIndex,
    "block-global-log-index",
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
  validateSource(
    {
      sourceAddress,
      contractName,
      blockNumber: BigInt(blockNumber),
      model,
      releaseVersion,
    },
    reviewedBinding,
  );
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
    transactionIndex: strictUint32Decimal(
      value.transactionIndex,
      "transaction-index",
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
  releaseBinding: DataPipelineReleaseBinding,
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
    value.deployment !== releaseBinding.envio.deploymentLabel ||
    value.sourceCommit !== releaseBinding.envio.sourceCommit ||
    value.configSha256 !== releaseBinding.envio.configSha256 ||
    value.schemaSha256 !== releaseBinding.envio.schemaSha256 ||
    value.handlerSha256 !== releaseBinding.envio.handlerSha256 ||
    value.sourceRegistrySha256 !==
      releaseBinding.envio.sourceRegistrySha256 ||
    value.eventSetSha256 !== releaseBinding.envio.eventSetSha256 ||
    value.eventCount !== releaseBinding.envio.eventCount ||
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
    deployment: releaseBinding.envio.deploymentLabel,
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
  releaseBinding?: DataPipelineReleaseBinding;
  fetcher?: DataPipelineFetcher;
  circuit?: CircuitBreaker;
}) {
  const reviewedBinding = reviewedEnvioBinding(
    options.releaseBinding ?? getDataPipelineReleaseBinding(),
  );
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
          return parseCandidate(
            response.data.ChainEvent_by_pk,
            candidateId,
            reviewedBinding,
          );
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
            afterLogIndex: graphqlUint32OrGenesis(
              cursor.blockGlobalLogIndex,
            ),
            afterCandidateId: cursor.candidateId,
            first: limit,
          },
        });
        return parseCandidatePage({
          response,
          cursor,
          limit,
          reviewedBinding,
        });
      });
    },

    async readCandidatesWindow(input: {
      cursor: EnvioCandidateCursor;
      throughBlock: string;
      limit?: number;
    }): Promise<EnvioCandidate[]> {
      const cursor = canonicalCandidateCursor(input?.cursor);
      let throughBlock: string;
      try {
        throughBlock = parseNonnegativeIntegerText(input?.throughBlock);
      } catch {
        throw invalidInput("envio", "candidate-window");
      }
      const limit = input?.limit ?? DEFAULT_CANDIDATE_PAGE_LIMIT;
      if (
        BigInt(throughBlock) < BigInt(cursor.blockNumber) ||
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > MAXIMUM_CANDIDATE_PAGE_LIMIT
      ) {
        throw invalidInput("envio", "candidate-window");
      }
      return circuit.execute(async () => {
        const response = await request({
          query: CANDIDATES_WINDOW_QUERY,
          variables: {
            afterBlock: cursor.blockNumber,
            afterLogIndex: graphqlUint32OrGenesis(
              cursor.blockGlobalLogIndex,
            ),
            afterCandidateId: cursor.candidateId,
            throughBlock,
            first: limit,
          },
        });
        return parseCandidatePage({
          response,
          cursor,
          limit,
          throughBlock,
          reviewedBinding,
        });
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
            reviewedBinding.releaseBinding,
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
