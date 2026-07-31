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
  boundedJsonRequest,
  type DataPipelineFetcher,
} from "./request";

const CANDIDATE_QUERY = `
  query ProgrammableCandidate($candidateId: ID!) {
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

const PROGRESS_QUERY = `
  query ProgrammableIndexerProgress($stateId: ID!) {
    IndexerState_by_pk(id: $stateId) {
      id
      schemaVersion
      deployment
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

const STATIC_SOURCES = new Map<
  string,
  {
    contractName: string;
    startBlock: bigint;
    model: "classic" | "stock-paired";
    releaseVersion:
      | "classic-v2"
      | "classic-v3"
      | "stock-paired-v1"
      | "stock-paired-v2"
      | "stock-paired-v3";
  }
>([
  [
    "0x025a386eaa79f6067d29848fd05ccc71beab20cc",
    {
      contractName: "ClassicV2Hook",
      startBlock: 25_624_130n,
      model: "classic",
      releaseVersion: "classic-v2",
    },
  ],
  [
    "0xd240d06f8586eb799f20056054e5b527405e6bad",
    {
      contractName: "ClassicV2Launcher",
      startBlock: 25_624_131n,
      model: "classic",
      releaseVersion: "classic-v2",
    },
  ],
  [
    "0xf28967f9dfac3ca21384b59d6d75c8106b3eab2a",
    {
      contractName: "ClassicV3RewardVaultFactory",
      startBlock: 25_639_538n,
      model: "classic",
      releaseVersion: "classic-v3",
    },
  ],
  [
    "0xde21b9c0cc0afdb9be20e8236113f066bb8c66f4",
    {
      contractName: "ClassicV3VestingWalletFactory",
      startBlock: 25_639_564n,
      model: "classic",
      releaseVersion: "classic-v3",
    },
  ],
  [
    "0x35fe236ea82f7cf525c9719d7df8f49f94d720cc",
    {
      contractName: "ClassicV3Hook",
      startBlock: 25_639_591n,
      model: "classic",
      releaseVersion: "classic-v3",
    },
  ],
  [
    "0xc3bd04aac2fb2ba58efd7eb673e544e0b80de770",
    {
      contractName: "ClassicV3Launcher",
      startBlock: 25_639_596n,
      model: "classic",
      releaseVersion: "classic-v3",
    },
  ],
  [
    "0x195750f33cad5ef2df857a53226b421297a1e79e",
    {
      contractName: "StockV1Launcher",
      startBlock: 25_637_469n,
      model: "stock-paired",
      releaseVersion: "stock-paired-v1",
    },
  ],
  [
    "0xfa5f17389ca28d071781d59750b32c842ab6a54b",
    {
      contractName: "StockV1EthCoordinator",
      startBlock: 25_637_469n,
      model: "stock-paired",
      releaseVersion: "stock-paired-v1",
    },
  ],
  [
    "0x7773d183fe7b60d4f1885047fa42b815a62fe0cc",
    {
      contractName: "StockV1Hook",
      startBlock: 25_637_469n,
      model: "stock-paired",
      releaseVersion: "stock-paired-v1",
    },
  ],
  [
    "0xd430d9162c153afdf9e4caca6d2317e72a044441",
    {
      contractName: "StockV1RewardVaultFactory",
      startBlock: 25_637_469n,
      model: "stock-paired",
      releaseVersion: "stock-paired-v1",
    },
  ],
  [
    "0x5ea6be24838061ba45dbe8d82de1b267dc240daf",
    {
      contractName: "StockV2Launcher",
      startBlock: 25_640_338n,
      model: "stock-paired",
      releaseVersion: "stock-paired-v2",
    },
  ],
  [
    "0xfb9e1034df6161088e8f358502b19e7515c30fd2",
    {
      contractName: "StockV2EthCoordinator",
      startBlock: 25_640_338n,
      model: "stock-paired",
      releaseVersion: "stock-paired-v2",
    },
  ],
  [
    "0x0573879f72d8ee8b0e5a4ec5e8bcdb2fcab9e51c",
    {
      contractName: "StockV3Launcher",
      startBlock: 25_642_745n,
      model: "stock-paired",
      releaseVersion: "stock-paired-v3",
    },
  ],
  [
    "0xddc3abbab0df7f1189310a4f70e7e365796b74e2",
    {
      contractName: "StockV3EthCoordinator",
      startBlock: 25_642_745n,
      model: "stock-paired",
      releaseVersion: "stock-paired-v3",
    },
  ],
]);

const SHARED_STOCK_SOURCES = new Map<
  string,
  { contractName: string; startBlock: bigint }
>([
  [
    "0x90c67c1e866f86526f0e338459cd435e1f23a0cc",
    { contractName: "StockV2V3Hook", startBlock: 25_640_338n },
  ],
  [
    "0x52d70971d6653a754c29385a2a6f241a481952d4",
    {
      contractName: "StockV2V3RewardVaultFactory",
      startBlock: 25_640_338n,
    },
  ],
]);

const CANDIDATE_PATTERN =
  /^1:(0x[0-9a-f]{64}):(0x[0-9a-f]{64}):(0|[1-9]\d*)$/;

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

function validateSource(input: {
  sourceAddress: HexAddress;
  contractName: string;
  blockNumber: bigint;
  model: string;
  releaseVersion: string;
}) {
  const source = STATIC_SOURCES.get(input.sourceAddress);
  if (source) {
    if (
      source.contractName !== input.contractName ||
      input.blockNumber < source.startBlock ||
      source.model !== input.model ||
      source.releaseVersion !== input.releaseVersion
    ) {
      throw validationError("envio", "source-provenance");
    }
    return;
  }
  const shared = SHARED_STOCK_SOURCES.get(input.sourceAddress);
  if (shared) {
    if (
      shared.contractName !== input.contractName ||
      input.blockNumber < shared.startBlock ||
      input.model !== "stock-paired" ||
      !["stock-paired-v2", "stock-paired-v3", "unresolved"].includes(
        input.releaseVersion,
      )
    ) {
      throw validationError("envio", "shared-source-provenance");
    }
    return;
  }
  const dynamicValid =
    (input.contractName === "ClassicV3RewardVault" &&
      input.model === "classic" &&
      input.releaseVersion === "classic-v3") ||
    (input.contractName === "StockV1RewardVault" &&
      input.model === "stock-paired" &&
      input.releaseVersion === "stock-paired-v1") ||
    (input.contractName === "StockV2V3RewardVault" &&
      input.model === "stock-paired" &&
      ["stock-paired-v2", "stock-paired-v3", "unresolved"].includes(
        input.releaseVersion,
      ));
  if (!dynamicValid || input.blockNumber < 25_624_130n) {
    throw validationError("envio", "dynamic-source-provenance");
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
    0xffff_ffff,
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
    transactionIndex: strictSafeInteger(value.transactionIndex, 0xffff_ffff),
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
  progressBlockHash: HexBytes32;
  progressTimestamp: string;
  progressTransactionHash: HexBytes32;
  progressOccurrenceId: string;
  requiredBlock: string;
  lagBlocks: string;
  isReady: boolean;
};

function parseProgress(value: unknown, requiredBlock: string): EnvioProgress {
  const keys = [
    "id",
    "schemaVersion",
    "deployment",
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
    typeof value.deployment !== "string" ||
    !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(value.deployment)
  ) {
    throw validationError("envio", "progress");
  }
  const progressBlock = parseNonnegativeIntegerText(value.progressBlock);
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
  const progress = BigInt(progressBlock);
  const required = BigInt(canonicalRequired);
  return {
    chainId: 1,
    deployment: value.deployment,
    schemaVersion: "1",
    progressBlock,
    progressBlockHash,
    progressTimestamp: parseNonnegativeIntegerText(value.progressTimestamp),
    progressTransactionHash,
    progressOccurrenceId,
    requiredBlock: canonicalRequired,
    lagBlocks: (required > progress ? required - progress : 0n).toString(),
    isReady: progress >= required,
  };
}

export function createEnvioClient(options: {
  endpoint: string;
  token: string;
  fetcher?: DataPipelineFetcher;
  circuit?: CircuitBreaker;
}) {
  const config = loadDataPipelineConfig({
    PROGRAMMABLE_ENVIO_GRAPHQL_URL: options.endpoint,
    PROGRAMMABLE_ENVIO_GRAPHQL_TOKEN: options.token,
  });
  if (!config.envio.endpoint || !config.envio.token) {
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
      headers: { authorization: `Bearer ${config.envio.token!}` },
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
          !onlyKeys(response.data, ["IndexerState_by_pk"]) ||
          response.data.IndexerState_by_pk === null
        ) {
          throw validationError("envio", "progress-response");
        }
        try {
          return parseProgress(
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
