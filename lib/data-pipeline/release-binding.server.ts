import "server-only";

import releaseBindingJson from "../../config/data-pipeline-release.v1.json";

type HexAddress = `0x${string}`;
type HexHash = `0x${string}`;

const ZERO_SOURCE_COMMIT = "0".repeat(40);
const ZERO_SHA256 = `0x${"00".repeat(32)}`;

const EXPECTED_MODEL_BY_RELEASE = Object.freeze({
  "classic-v2": "classic",
  "classic-v3": "classic",
  "stock-paired-v1": "stock-paired",
  "stock-paired-v2": "stock-paired",
  "stock-paired-v3": "stock-paired",
} as const);

export type DataPipelineSourceBinding = {
  contractName: string;
  address: HexAddress;
  startBlock: number;
  runtimeCodeHash: HexHash;
};

export type DataPipelineModelRelease = {
  model: string;
  releaseVersion: string;
  activationBlock: number;
  sourceContracts: string[];
  dynamicContracts: string[];
};

export type DataPipelineReleaseBinding = {
  schemaVersion: 1;
  chainId: 1;
  startBlock: number;
  confirmations: 12;
  envio: {
    deploymentLabel: string;
    graphqlEndpoint: string;
    schemaVersion: "1";
    sourceCommit: string;
    configSha256: HexHash;
    schemaSha256: HexHash;
    handlerSha256: HexHash;
    sourceRegistrySha256: HexHash;
    eventSetSha256: HexHash;
    eventCount: number;
  };
  uniswapV4Subgraph: {
    subgraphId: string;
    deployment: string;
  };
  sources: DataPipelineSourceBinding[];
  releases: DataPipelineModelRelease[];
};

function invalidBinding(): never {
  throw new Error("Invalid data pipeline release binding");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function boundedString(value: unknown, pattern: RegExp, maximum: number) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum ||
    !pattern.test(value)
  ) {
    return invalidBinding();
  }
  return value;
}

function positiveSafeInteger(value: unknown) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    return invalidBinding();
  }
  return value;
}

function sha256(value: unknown): HexHash {
  const commitment = boundedString(
    value,
    /^0x[0-9a-f]{64}$/,
    66,
  ) as HexHash;
  if (commitment === ZERO_SHA256) return invalidBinding();
  return commitment;
}

function sourceCommit(value: unknown) {
  const commitment = boundedString(value, /^[0-9a-f]{40}$/, 40);
  if (commitment === ZERO_SOURCE_COMMIT) return invalidBinding();
  return commitment;
}

function address(value: unknown): HexAddress {
  return boundedString(value, /^0x[0-9a-f]{40}$/, 42) as HexAddress;
}

function stringList(value: unknown) {
  if (!Array.isArray(value) || value.length > 32) return invalidBinding();
  const output = value.map((item) =>
    boundedString(item, /^[A-Za-z][A-Za-z0-9]*$/, 96),
  );
  if (new Set(output).size !== output.length) return invalidBinding();
  return output;
}

export function parseDataPipelineReleaseBinding(
  value: unknown,
): DataPipelineReleaseBinding {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "schemaVersion",
      "chainId",
      "startBlock",
      "confirmations",
      "envio",
      "uniswapV4Subgraph",
      "sources",
      "releases",
    ]) ||
    value.schemaVersion !== 1 ||
    value.chainId !== 1 ||
    value.confirmations !== 12 ||
    !isRecord(value.envio) ||
    !hasOnlyKeys(value.envio, [
      "deploymentLabel",
      "graphqlEndpoint",
      "schemaVersion",
      "sourceCommit",
      "configSha256",
      "schemaSha256",
      "handlerSha256",
      "sourceRegistrySha256",
      "eventSetSha256",
      "eventCount",
    ]) ||
    value.envio.schemaVersion !== "1" ||
    !isRecord(value.uniswapV4Subgraph) ||
    !hasOnlyKeys(value.uniswapV4Subgraph, ["subgraphId", "deployment"]) ||
    !Array.isArray(value.sources) ||
    value.sources.length === 0 ||
    value.sources.length > 128 ||
    !Array.isArray(value.releases) ||
    value.releases.length === 0 ||
    value.releases.length > 64
  ) {
    return invalidBinding();
  }

  const startBlock = positiveSafeInteger(value.startBlock);
  const sources = value.sources.map((source): DataPipelineSourceBinding => {
    if (
      !isRecord(source) ||
      !hasOnlyKeys(source, [
        "contractName",
        "address",
        "startBlock",
        "runtimeCodeHash",
      ])
    ) {
      return invalidBinding();
    }
    const sourceStartBlock = positiveSafeInteger(source.startBlock);
    if (sourceStartBlock < startBlock) return invalidBinding();
    return {
      contractName: boundedString(
        source.contractName,
        /^[A-Za-z][A-Za-z0-9]*$/,
        96,
      ),
      address: address(source.address),
      startBlock: sourceStartBlock,
      runtimeCodeHash: sha256(source.runtimeCodeHash),
    };
  });
  if (
    new Set(sources.map(({ contractName }) => contractName)).size !==
      sources.length ||
    new Set(sources.map(({ address: sourceAddress }) => sourceAddress)).size !==
      sources.length
  ) {
    return invalidBinding();
  }
  const sourceNames = new Set(sources.map(({ contractName }) => contractName));

  const releases = value.releases.map((release): DataPipelineModelRelease => {
    if (
      !isRecord(release) ||
      !hasOnlyKeys(release, [
        "model",
        "releaseVersion",
        "activationBlock",
        "sourceContracts",
        "dynamicContracts",
      ])
    ) {
      return invalidBinding();
    }
    const sourceContracts = stringList(release.sourceContracts);
    if (
      sourceContracts.length === 0 ||
      sourceContracts.some((contractName) => !sourceNames.has(contractName))
    ) {
      return invalidBinding();
    }
    const model = boundedString(
      release.model,
      /^[a-z][a-z0-9-]*$/,
      64,
    );
    const releaseVersion = boundedString(
        release.releaseVersion,
        /^[a-z][a-z0-9-]*$/,
        64,
      );
    if (
      !(releaseVersion in EXPECTED_MODEL_BY_RELEASE) ||
      EXPECTED_MODEL_BY_RELEASE[
        releaseVersion as keyof typeof EXPECTED_MODEL_BY_RELEASE
      ] !== model
    ) {
      return invalidBinding();
    }
    const activationBlock = positiveSafeInteger(release.activationBlock);
    const maximumSourceStart = sourceContracts.reduce((maximum, name) => {
      const source = sources.find((candidate) => candidate.contractName === name);
      return source && source.startBlock > maximum
        ? source.startBlock
        : maximum;
    }, 0);
    if (activationBlock < maximumSourceStart) return invalidBinding();
    return {
      model,
      releaseVersion,
      activationBlock,
      sourceContracts,
      dynamicContracts: stringList(release.dynamicContracts),
    };
  });
  if (
    new Set(releases.map(({ releaseVersion }) => releaseVersion)).size !==
    releases.length
  ) {
    return invalidBinding();
  }

  const sourceModels = new Map<string, Set<string>>();
  const dynamicModels = new Map<string, Set<string>>();
  for (const release of releases) {
    for (const contractName of release.sourceContracts) {
      const models = sourceModels.get(contractName) ?? new Set<string>();
      models.add(release.model);
      sourceModels.set(contractName, models);
    }
    for (const contractName of release.dynamicContracts) {
      if (sourceNames.has(contractName)) return invalidBinding();
      const models = dynamicModels.get(contractName) ?? new Set<string>();
      models.add(release.model);
      dynamicModels.set(contractName, models);
    }
  }
  if (
    sourceModels.size !== sourceNames.size ||
    [...sourceModels.values()].some((models) => models.size !== 1) ||
    [...dynamicModels.values()].some((models) => models.size !== 1)
  ) {
    return invalidBinding();
  }

  return {
    schemaVersion: 1,
    chainId: 1,
    startBlock,
    confirmations: 12,
    envio: {
      deploymentLabel: boundedString(
        value.envio.deploymentLabel,
        /^[a-z0-9][a-z0-9-]*$/,
        128,
      ),
      graphqlEndpoint: boundedString(
        value.envio.graphqlEndpoint,
        /^https:\/\/indexer\.hyperindex\.xyz\/[a-z0-9]{7,64}\/v1\/graphql$/,
        256,
      ),
      schemaVersion: "1",
      sourceCommit: sourceCommit(value.envio.sourceCommit),
      configSha256: sha256(value.envio.configSha256),
      schemaSha256: sha256(value.envio.schemaSha256),
      handlerSha256: sha256(value.envio.handlerSha256),
      sourceRegistrySha256: sha256(value.envio.sourceRegistrySha256),
      eventSetSha256: sha256(value.envio.eventSetSha256),
      eventCount: positiveSafeInteger(value.envio.eventCount),
    },
    uniswapV4Subgraph: {
      subgraphId: boundedString(
        value.uniswapV4Subgraph.subgraphId,
        /^[1-9A-HJ-NP-Za-km-z]+$/,
        96,
      ),
      deployment: boundedString(
        value.uniswapV4Subgraph.deployment,
        /^[1-9A-HJ-NP-Za-km-z]+$/,
        96,
      ),
    },
    sources,
    releases,
  };
}

let cachedBinding: DataPipelineReleaseBinding | undefined;

export function getDataPipelineReleaseBinding() {
  cachedBinding ??= parseDataPipelineReleaseBinding(releaseBindingJson);
  return cachedBinding;
}
