#!/usr/bin/env node

import { createHash } from "node:crypto";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getAddress, keccak256 } from "viem";

import {
  canonicalizeJson,
  parseStrictJson,
} from "../../packages/launch/src/canonical-json.mjs";
import {
  atomicCreate,
  decodeExactUtf8,
} from "../../packages/launch/src/io.mjs";
import {
  createRobinhoodResponseBudget,
  readRobinhoodBoundedResponse,
} from "./robinhood-custom-launch-capture-v2.mjs";
import { verifyRobinhoodStandardJsonInputs } from "./robinhood-custom-launch-standard-json-core.mjs";

export const ROBINHOOD_BLOCKSCOUT_OBSERVATION_SCHEMA =
  "programmable.robinhood-custom-launch.blockscout-observation.v1";
export const ROBINHOOD_BLOCKSCOUT_DEGRADED_STATUS =
  "PARTIAL_NO_CBOR_NOT_RELEASE_AUTHORITY";

const BLOCKSCOUT_ORIGIN = "https://robinhoodchain.blockscout.com";
const MAXIMUM_RESPONSE_BYTES = 16 * 1024 * 1024;
const RESPONSE_BUDGET_BYTES = 32 * 1024 * 1024;
export const ROBINHOOD_BLOCKSCOUT_TARGETS = Object.freeze([
  Object.freeze({
    contract: "graphFactory",
    address: "0x0B6b3F40f84Df25D3bd69238f937096177DD09Bd",
    name: "ProgrammableCreate2GraphDeployerV1",
    fullyQualifiedName:
      "src/ProgrammableCreate2GraphDeployerV1.sol:ProgrammableCreate2GraphDeployerV1",
    standardJsonInputPath:
      "contracts/spec/robinhood-custom-launch/standard-json/ProgrammableCreate2GraphDeployerV1.standard-input.json",
    expectedRuntimeCodeHash:
      "0xd23692fae59331592048e71a96d4963e170ee56e449683dc9f7fa3f9470018b8",
  }),
  Object.freeze({
    contract: "programmableLaunchStampRouter",
    address: "0x34965F2A2ee9254522232C32F02056E92BE0C98a",
    name: "ProgrammableLaunchStampRouterV1",
    fullyQualifiedName:
      "src/robinhood-custom-launch/ProgrammableLaunchStampRouterV1.sol:ProgrammableLaunchStampRouterV1",
    standardJsonInputPath:
      "contracts/spec/robinhood-custom-launch/standard-json/ProgrammableLaunchStampRouterV1.standard-input.json",
    expectedRuntimeCodeHash:
      "0x1dbbdaaad901ea3c6134dca0d4872a4789b3c071bf8ccfb44edd65d26d817388",
  }),
]);

function fail(message) {
  throw new TypeError(message);
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function framedSha256(domain, value) {
  return sha256(
    Buffer.concat([
      Buffer.from(domain, "utf8"),
      Buffer.from([0]),
      Buffer.from(canonicalizeJson(value), "utf8"),
    ]),
  );
}

function exactHexBytes(value, label) {
  if (typeof value !== "string") fail(`${label} must be hex bytes`);
  const normalized = value.startsWith("0x") ? value.toLowerCase() : `0x${value.toLowerCase()}`;
  if (!/^0x(?:[0-9a-f]{2})+$/u.test(normalized)) {
    fail(`${label} must be nonempty canonical hex bytes`);
  }
  return normalized;
}

function exactConstructorArguments(value, expected, label) {
  if (expected === "0x" && (value === null || value === "" || value === "0x")) {
    return "0x";
  }
  const normalized = exactHexBytes(value, label);
  if (normalized !== expected.toLowerCase()) fail(`${label} differs from reviewed arguments`);
  return normalized;
}

function canonicalSourceMap(response, label) {
  if (typeof response.file_path !== "string" || typeof response.source_code !== "string") {
    fail(`${label} primary source is missing`);
  }
  if (!Array.isArray(response.additional_sources)) {
    fail(`${label} additional source closure is missing`);
  }
  const entries = [[response.file_path, response.source_code]];
  for (const [index, source] of response.additional_sources.entries()) {
    if (
      source === null ||
      typeof source !== "object" ||
      Array.isArray(source) ||
      typeof source.file_path !== "string" ||
      typeof source.source_code !== "string"
    ) {
      fail(`${label} additional source ${index} is invalid`);
    }
    entries.push([source.file_path, source.source_code]);
  }
  if (new Set(entries.map(([sourcePath]) => sourcePath)).size !== entries.length) {
    fail(`${label} source paths are duplicated`);
  }
  return Object.fromEntries(entries.sort(([left], [right]) =>
    Buffer.compare(Buffer.from(left), Buffer.from(right))));
}

export function normalizeRobinhoodBlockscoutObservation({
  target,
  rawResponse,
  responseSha256,
  responseBytes,
  observedAt,
  standardJsonInput,
  standardJsonInputSha256,
  expectedCreationCode,
  expectedConstructorArguments,
}) {
  const label = `${target.contract} Blockscout observation`;
  if (
    rawResponse === null ||
    typeof rawResponse !== "object" ||
    Array.isArray(rawResponse) ||
    rawResponse.is_verified !== true ||
    rawResponse.is_fully_verified !== false ||
    rawResponse.is_partially_verified !== true ||
    rawResponse.is_changed_bytecode !== false ||
    rawResponse.verified_twin_address_hash !== null
  ) {
    fail(`${label} is not the expected no-CBOR PARTIAL classification`);
  }
  const sourceMap = canonicalSourceMap(rawResponse, label);
  const expectedSources = Object.fromEntries(
    Object.entries(standardJsonInput.sources)
      .map(([sourcePath, source]) => [sourcePath, source.content])
      .sort(([left], [right]) => Buffer.compare(Buffer.from(left), Buffer.from(right))),
  );
  if (canonicalizeJson(sourceMap) !== canonicalizeJson(expectedSources)) {
    fail(`${label} source closure differs from reviewed Standard JSON`);
  }
  if (
    rawResponse.name !== target.name ||
    rawResponse.file_path !== target.fullyQualifiedName.split(":", 1)[0] ||
    rawResponse.language !== "solidity" ||
    rawResponse.creation_status !== "success" ||
    !["v0.8.26+commit.8a97fa7a", "0.8.26+commit.8a97fa7a"].includes(
      rawResponse.compiler_version,
    ) ||
    rawResponse.optimization_enabled !== true ||
    ![null, 1000].includes(rawResponse.optimizations_runs) ||
    rawResponse.evm_version !== "cancun" ||
    canonicalizeJson(rawResponse.compiler_settings) !==
      canonicalizeJson(standardJsonInput.settings) ||
    rawResponse.compiler_settings?.metadata?.appendCBOR !== false
  ) {
    fail(`${label} compiler identity/settings differ from reviewed input`);
  }
  const constructorArguments = exactConstructorArguments(
    rawResponse.constructor_args,
    expectedConstructorArguments,
    `${label} constructor arguments`,
  );
  const creationBytecode = exactHexBytes(
    rawResponse.creation_bytecode,
    `${label} creation bytecode`,
  );
  const deployedBytecode = exactHexBytes(
    rawResponse.deployed_bytecode,
    `${label} deployed bytecode`,
  );
  if (
    creationBytecode !== expectedCreationCode.toLowerCase() ||
    keccak256(deployedBytecode) !== target.expectedRuntimeCodeHash
  ) {
    fail(`${label} creation or deployed bytes differ from reviewed bindings`);
  }
  if (
    typeof observedAt !== "string" ||
    !Number.isFinite(Date.parse(observedAt)) ||
    new Date(observedAt).toISOString() !== observedAt ||
    !/^sha256:[0-9a-f]{64}$/u.test(responseSha256 ?? "") ||
    !Number.isSafeInteger(responseBytes) ||
    responseBytes < 1 ||
    responseBytes > MAXIMUM_RESPONSE_BYTES
  ) {
    fail(`${label} response/time evidence is invalid`);
  }
  const normalized = {
    contract: target.contract,
    provider: "blockscout-v2",
    chainId: "4663",
    address: getAddress(target.address),
    status: ROBINHOOD_BLOCKSCOUT_DEGRADED_STATUS,
    releaseAuthority: false,
    exactSourceGateSatisfied: false,
    rationale:
      "appendCBOR=false prevents Blockscout metadata_match/FULL classification",
    observedAt,
    urlPath: `/api/v2/smart-contracts/${target.address}`,
    httpStatus: 200,
    contentType: "application/json",
    responseSha256,
    responseBytes,
    providerLanguage: "solidity",
    providerCreationStatus: "success",
    compilerVersion: "0.8.26+commit.8a97fa7a",
    providerOptimizationsRuns: rawResponse.optimizations_runs,
    compilerSettingsDigest: framedSha256(
      "programmable.robinhood-custom-launch.blockscout-compiler-settings.v1",
      standardJsonInput.settings,
    ),
    sourceFilesDigest: framedSha256(
      "programmable.robinhood-custom-launch.blockscout-source-files.v1",
      sourceMap,
    ),
    standardJsonInputPath: target.standardJsonInputPath,
    standardJsonInputSha256,
    constructorArguments,
    creationCodeKeccak256: keccak256(creationBytecode),
    runtimeCodeKeccak256: keccak256(deployedBytecode),
    providerClassification: {
      isVerified: true,
      isFullyVerified: false,
      isPartiallyVerified: true,
      isChangedBytecode: false,
      verifiedTwinAddressHash: null,
    },
    localByteBindingsVerified: true,
    observationDigest: null,
  };
  normalized.observationDigest = framedSha256(
    "programmable.robinhood-custom-launch.blockscout-normalized-observation.v1",
    { ...normalized, observationDigest: null },
  );
  return Object.freeze(normalized);
}

async function safeOutput(candidate) {
  if (!path.isAbsolute(candidate)) fail("Blockscout observation output must be absolute");
  const parent = await realpath(path.dirname(candidate));
  if (candidate !== path.join(parent, path.basename(candidate))) {
    fail("Blockscout observation output parent must be a real directory");
  }
  try {
    const metadata = await lstat(candidate);
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      fail("Blockscout observation output is unsafe");
    }
    fail("Blockscout observation output already exists");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return candidate;
}

export async function observeRobinhoodCustomLaunchBlockscout({
  outputPath,
  repositoryRoot = fileURLToPath(new URL("../../", import.meta.url)),
  fetchImpl = fetch,
  now = () => new Date(),
  verifyInputs = verifyRobinhoodStandardJsonInputs,
}) {
  const observed = now();
  if (!(observed instanceof Date) || !Number.isFinite(observed.getTime())) {
    fail("Blockscout observation clock is invalid");
  }
  const observedAt = observed.toISOString();
  const verified = await verifyInputs({ requireForgeArtifacts: false });
  const budget = createRobinhoodResponseBudget(RESPONSE_BUDGET_BYTES);
  const observations = [];
  for (const [index, target] of ROBINHOOD_BLOCKSCOUT_TARGETS.entries()) {
    const urlPath = `/api/v2/smart-contracts/${target.address}`;
    const response = await fetchImpl(`${BLOCKSCOUT_ORIGIN}${urlPath}`, {
      method: "GET",
      headers: Object.freeze({ accept: "application/json" }),
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
    if (
      response.status !== 200 ||
      !/^application\/json(?:;.*)?$/iu.test(
        response.headers.get("content-type") ?? "",
      )
    ) {
      fail(`${target.contract} Blockscout returned a non-JSON/non-200 response`);
    }
    const bytes = await readRobinhoodBoundedResponse(response, {
      label: `${target.contract} Blockscout`,
      maximumBytes: MAXIMUM_RESPONSE_BYTES,
      budget,
    });
    const standardJsonPath = path.join(repositoryRoot, target.standardJsonInputPath);
    let handle;
    let standardJsonBytes;
    try {
      handle = await open(standardJsonPath, "r");
      standardJsonBytes = await handle.readFile();
    } finally {
      await handle?.close();
    }
    const standardJsonInput = parseStrictJson(
      decodeExactUtf8(standardJsonBytes, target.standardJsonInputPath),
      { maximumBytes: standardJsonBytes.byteLength, maximumDepth: 256 },
    );
    const rawResponse = parseStrictJson(
      decodeExactUtf8(bytes, `${target.contract} Blockscout response`),
      { maximumBytes: bytes.byteLength, maximumDepth: 256 },
    );
    const commitment = index === 0 ? verified.commitments.graph : verified.commitments.router;
    observations.push(
      normalizeRobinhoodBlockscoutObservation({
        target,
        rawResponse,
        responseSha256: sha256(bytes),
        responseBytes: bytes.byteLength,
        observedAt,
        standardJsonInput,
        standardJsonInputSha256: sha256(standardJsonBytes),
        expectedCreationCode: commitment.creationCode,
        expectedConstructorArguments:
          index === 0 ? "0x" : verified.commitments.router.constructorArguments,
      }),
    );
  }
  const receipt = {
    schemaVersion: ROBINHOOD_BLOCKSCOUT_OBSERVATION_SCHEMA,
    state: ROBINHOOD_BLOCKSCOUT_DEGRADED_STATUS,
    releaseAuthority: false,
    promotionRequirement: false,
    exactSourceAuthority: "protected-hosted-build-finalized-transaction-bytecode",
    chainId: "4663",
    observedAt,
    provider: {
      providerId: "blockscout",
      apiVersion: "v2",
      origin: BLOCKSCOUT_ORIGIN,
    },
    observations,
    observationDigest: null,
  };
  receipt.observationDigest = framedSha256(
    ROBINHOOD_BLOCKSCOUT_OBSERVATION_SCHEMA,
    { ...receipt, observationDigest: null },
  );
  const bytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  await atomicCreate(await safeOutput(outputPath), bytes, 0o600);
  return Object.freeze(receipt);
}

function parseCli(argv) {
  if (argv.length !== 2 || argv[0] !== "--output" || !path.isAbsolute(argv[1])) {
    fail("Usage: observe-robinhood-custom-launch-blockscout.mjs --output /absolute/new.json");
  }
  return { outputPath: argv[1] };
}

const invoked = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invoked === fileURLToPath(import.meta.url)) {
  try {
    const result = await observeRobinhoodCustomLaunchBlockscout(
      parseCli(process.argv.slice(2)),
    );
    process.stdout.write(
      `ROBINHOOD_BLOCKSCOUT_DEGRADED_OBSERVATION ${result.observationDigest} ${result.observedAt}\n`,
    );
  } catch (error) {
    process.stderr.write(
      `ERROR ${error?.message ?? "Blockscout observation failed"}\n`,
    );
    process.exitCode = 1;
  }
}
