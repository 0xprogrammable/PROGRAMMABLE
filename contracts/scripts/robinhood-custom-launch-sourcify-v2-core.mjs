import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { getAddress, keccak256 } from "viem";

import {
  canonicalizeJson,
  parseStrictJson,
} from "../../packages/launch/src/canonical-json.mjs";
import {
  assertAllowedKeys,
  assertExactKeys,
  assertPlainObject,
  decodeExactUtf8,
  sha256Digest,
} from "../../packages/launch/src/io.mjs";
import {
  ROBINHOOD_STANDARD_JSON_ARTIFACTS,
  verifyRobinhoodStandardJsonInputs,
} from "./robinhood-custom-launch-standard-json-core.mjs";
import {
  createRobinhoodResponseBudget,
  readRobinhoodBoundedResponse,
} from "./robinhood-custom-launch-capture-v2.mjs";

const execFileAsync = promisify(execFile);

export const ROBINHOOD_SOURCIFY_PLAN_SCHEMA =
  "programmable.robinhood-custom-launch.sourcify-publication-plan.v1";
export const ROBINHOOD_SOURCIFY_RECEIPT_SCHEMA =
  "programmable.robinhood-custom-launch.sourcify-publication-receipt.v2";
export const ROBINHOOD_SOURCIFY_PROVIDER_CLASSIFICATION =
  "PARTIAL_NO_CBOR_EXACT_BYTES";
export const ROBINHOOD_SOURCIFY_API_ORIGIN = "https://sourcify.dev";
export const ROBINHOOD_SOURCIFY_API_BASE =
  `${ROBINHOOD_SOURCIFY_API_ORIGIN}/server`;
export const ROBINHOOD_SOURCIFY_CHAIN_ID = "4663";
export const ROBINHOOD_SOURCIFY_REPOSITORY = "programmablehq/PROGRAMMABLE";
export const ROBINHOOD_SOURCIFY_PROTECTED_REF = "refs/heads/production";
export const ROBINHOOD_SOURCIFY_LICENSE_ACKNOWLEDGEMENT =
  "I_ACCEPT_IRREVOCABLE_SOURCIFY_SOURCE_PUBLICATION_AND_POSSIBLE_BLOCKSCOUT_VERIFICATION_SUBMISSION";
export const ROBINHOOD_SOURCIFY_LICENSE_NOTICE =
  "By submitting source code for verification, you grant Sourcify (and the Argot Collective) a non-exclusive, worldwide, irrevocable, royalty-free licence to reproduce, store, and publicly display the submitted source code for the purposes of verification, archival, and public inspection.";

const PLAN_DIGEST_DOMAIN =
  "programmable.robinhood-custom-launch.sourcify-publication-plan-digest.v1";
const AUTHORIZATION_DIGEST_DOMAIN =
  "programmable.robinhood-custom-launch.sourcify-publication-authorization.v1";
const RECEIPT_DIGEST_DOMAIN =
  "programmable.robinhood-custom-launch.sourcify-publication-receipt-digest.v2";
const COMPILER_VERSION = "0.8.26+commit.8a97fa7a";
const FOUNDATION_SOURCE_COMMITMENT =
  "0xe87f5edc2dc839bd87a26a80cb53f14b021e603a1753d27aae3a02862058d730";
const OWNER_TRANSACTION_DATA_HASH =
  "0x3ba04469085b17e12843a94c154a335c9c384837f8f6531f179cb4915fd237d9";
const OPENAPI_VERSION = "2.1.0";
const MAX_STANDARD_JSON_BYTES = 1024 * 1024;
const MAX_REQUEST_BYTES = 2 * 1024 * 1024;
const MAX_SMALL_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_CONTRACT_RESPONSE_BYTES = 32 * 1024 * 1024;
const MAX_AGGREGATE_RESPONSE_BYTES = 80 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_JOB_POLLS = 60;
const JOB_POLL_INTERVAL_MS = 2_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const HASH = /^0x[0-9a-f]{64}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;

const TARGETS = Object.freeze([
  Object.freeze({
    key: "graphFactory",
    contract: "graphFactory",
    artifactKey: "graphFactory",
    address: "0x0B6b3F40f84Df25D3bd69238f937096177DD09Bd",
  }),
  Object.freeze({
    key: "router",
    contract: "programmableLaunchStampRouter",
    artifactKey: "router",
    address: "0x34965F2A2ee9254522232C32F02056E92BE0C98a",
  }),
]);

function fail(message) {
  throw new TypeError(message);
}

function framedSha256(domain, value) {
  const payload = Buffer.from(canonicalizeJson(value), "utf8");
  const domainBytes = Buffer.from(domain, "utf8");
  const frame = Buffer.alloc(8);
  frame.writeBigUInt64BE(BigInt(domainBytes.byteLength));
  const payloadFrame = Buffer.alloc(8);
  payloadFrame.writeBigUInt64BE(BigInt(payload.byteLength));
  return `sha256:${createHash("sha256")
    .update(frame)
    .update(domainBytes)
    .update(payloadFrame)
    .update(payload)
    .digest("hex")}`;
}

function exactIso(value, label) {
  if (typeof value !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value)
    || !Number.isFinite(Date.parse(value))) {
    fail(`${label} must be a canonical UTC RFC3339 instant`);
  }
  const canonical = new Date(value).toISOString();
  if (value !== canonical && value !== canonical.replace(/\.000Z$/u, "Z")) {
    fail(`${label} must be a canonical UTC RFC3339 instant`);
  }
  return canonical;
}

function canonicalNow(now) {
  const value = now();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    fail("Sourcify operator clock is invalid");
  }
  return new Date(Math.floor(value.getTime() / 1_000) * 1_000).toISOString();
}

function exactHex(value, label) {
  if (typeof value !== "string" || !/^0x(?:[0-9a-f]{2})*$/u.test(value)) {
    fail(`${label} must be lowercase even-length hex`);
  }
  return value;
}

function exactHash(value, label) {
  if (typeof value !== "string" || !HASH.test(value)) fail(`${label} is invalid`);
  return value;
}

function canonicalAddress(value, expected, label) {
  let normalized;
  try {
    normalized = getAddress(value);
  } catch {
    fail(`${label} is not an address`);
  }
  if (normalized !== value || normalized !== expected) fail(`${label} differs`);
  return normalized;
}

function parseJsonBytes(bytes, label, maximumBytes = bytes.byteLength) {
  return parseStrictJson(decodeExactUtf8(bytes, label), { maximumBytes });
}

function metadataObject(compilation, label) {
  const value = typeof compilation?.metadata === "string"
    ? parseStrictJson(compilation.metadata, {
        maximumBytes: Buffer.byteLength(compilation.metadata, "utf8"),
      })
    : compilation?.metadata;
  assertPlainObject(value, `${label} metadata`);
  return value;
}

function bytecodeObject(compilation, deployed, label) {
  const object = deployed
    ? compilation?.evm?.deployedBytecode?.object
    : compilation?.evm?.bytecode?.object;
  return exactHex(`0x${object ?? ""}`, `${label} bytecode`);
}

function sourceOrigin(value) {
  assertExactKeys(value, [
    "repository", "protectedRef", "revision", "tree", "remote",
    "liveProtectedRevision", "clean",
  ], "Sourcify source origin");
  if (value.repository !== ROBINHOOD_SOURCIFY_REPOSITORY
    || value.protectedRef !== ROBINHOOD_SOURCIFY_PROTECTED_REF
    || !/^[0-9a-f]{40}$/u.test(value.revision)
    || !/^[0-9a-f]{40}$/u.test(value.tree)
    || value.remote !== "https://github.com/programmablehq/PROGRAMMABLE.git"
    || value.liveProtectedRevision !== value.revision
    || value.clean !== true) {
    fail("Sourcify source origin is not exact protected production");
  }
  return structuredClone(value);
}

async function git(repositoryRoot, args, execute = execFileAsync) {
  const result = await execute("git", ["-C", repositoryRoot, ...args], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    timeout: 30_000,
  });
  if (result.stderr.length !== 0 || /[\r\n]/u.test(result.stdout.trim())) {
    fail("Sourcify protected-source Git query returned diagnostics");
  }
  return result.stdout.trim();
}

export async function inspectRobinhoodSourcifyProtectedSource({
  repositoryRoot,
  execute,
}) {
  const root = path.resolve(repositoryRoot);
  const remote = await git(root, ["remote", "get-url", "origin"], execute);
  if (remote !== "https://github.com/programmablehq/PROGRAMMABLE.git") {
    fail("Sourcify publication requires the canonical origin remote");
  }
  const status = await git(root, ["status", "--porcelain=v1", "--untracked-files=all"], execute);
  const revision = await git(root, ["rev-parse", "HEAD^{commit}"], execute);
  const tree = await git(root, ["rev-parse", "HEAD^{tree}"], execute);
  const production = await git(
    root,
    ["rev-parse", "refs/remotes/origin/production^{commit}"],
    execute,
  );
  const remoteProductionLine = await git(
    root,
    ["ls-remote", "--exit-code", "origin", "refs/heads/production"],
    execute,
  );
  const remoteProductionMatch = remoteProductionLine.match(
    /^([0-9a-f]{40})\trefs\/heads\/production$/u,
  );
  const closingRevision = await git(root, ["rev-parse", "HEAD^{commit}"], execute);
  const closingTree = await git(root, ["rev-parse", "HEAD^{tree}"], execute);
  const closingStatus = await git(
    root,
    ["status", "--porcelain=v1", "--untracked-files=all"],
    execute,
  );
  if (status !== "" || closingStatus !== "" || revision !== closingRevision
    || tree !== closingTree || revision !== production
    || remoteProductionMatch?.[1] !== revision) {
    fail("Sourcify publication requires stable clean HEAD equal to live protected production");
  }
  return Object.freeze(sourceOrigin({
    repository: ROBINHOOD_SOURCIFY_REPOSITORY,
    protectedRef: ROBINHOOD_SOURCIFY_PROTECTED_REF,
    revision,
    tree,
    remote,
    liveProtectedRevision: revision,
    clean: true,
  }));
}

function buildTarget({ target, verified, inputBytes, creationTransactionHash }) {
  const artifact = ROBINHOOD_STANDARD_JSON_ARTIFACTS[target.artifactKey];
  const input = verified.inputs[target.artifactKey];
  const compilation = verified.compilations[target.artifactKey];
  const metadata = metadataObject(compilation, target.contract);
  const creationRecompiled = bytecodeObject(compilation, false, target.contract);
  const runtimeRecompiled = bytecodeObject(compilation, true, target.contract);
  const commitment = target.artifactKey === "graphFactory"
    ? verified.commitments.graph
    : verified.commitments.router;
  const creationOnchain = target.artifactKey === "graphFactory"
    ? commitment.creationCode
    : commitment.creationCode;
  const runtimeOnchainHash = target.artifactKey === "graphFactory"
    ? commitment.runtimeCodeHash
    : verified.deployment.contracts.programmableLaunchStampRouter.expectedRuntimeCodeHash;
  const request = {
    stdJsonInput: input,
    compilerVersion: COMPILER_VERSION,
    contractIdentifier: artifact.fqcn,
    creationTransactionHash,
  };
  const requestBytes = Buffer.from(canonicalizeJson(request), "utf8");
  if (requestBytes.byteLength > MAX_REQUEST_BYTES) fail(`${target.contract} request is oversized`);
  return Object.freeze({
    planTarget: Object.freeze({
      contract: target.contract,
      address: target.address,
      fullyQualifiedName: artifact.fqcn,
      standardJsonInputPath: artifact.path,
      standardJsonInputSha256: sha256Digest(inputBytes),
      standardJsonInputByteLength: inputBytes.byteLength,
      sourceCount: Object.keys(input.sources).length,
      metadataSha256: sha256Digest(Buffer.from(canonicalizeJson(metadata), "utf8")),
      requestPath: `/server/v2/verify/${ROBINHOOD_SOURCIFY_CHAIN_ID}/${target.address}`,
      requestBodySha256: sha256Digest(requestBytes),
      requestBodyByteLength: requestBytes.byteLength,
      expectedProviderMatch: "match",
      providerClassification: ROBINHOOD_SOURCIFY_PROVIDER_CLASSIFICATION,
      bytecode: Object.freeze({
        creationRecompiledKeccak256: keccak256(creationRecompiled),
        creationOnchainKeccak256: keccak256(creationOnchain),
        runtimeRecompiledKeccak256: keccak256(runtimeRecompiled),
        runtimeOnchainKeccak256: runtimeOnchainHash,
      }),
    }),
    request,
    requestBytes,
    input,
    metadata,
    expected: Object.freeze({
      creationRecompiled,
      creationOnchain,
      runtimeRecompiled,
      runtimeOnchainHash,
      immutableReferences: compilation?.evm?.deployedBytecode?.immutableReferences ?? {},
      constructorArguments: target.artifactKey === "router"
        ? commitment.constructorArguments
        : "0x",
    }),
  });
}

export async function prepareRobinhoodSourcifyPublication({
  repositoryRoot,
  creationTransactionHash,
  verifyStandardJson = verifyRobinhoodStandardJsonInputs,
  inspectSource = inspectRobinhoodSourcifyProtectedSource,
  read = readFile,
}) {
  exactHash(creationTransactionHash, "creation transaction hash");
  const root = path.resolve(repositoryRoot);
  const [verified, observedSource] = await Promise.all([
    verifyStandardJson(),
    inspectSource({ repositoryRoot: root }),
  ]);
  const exactSource = sourceOrigin(observedSource);
  const preparedTargets = [];
  for (const target of TARGETS) {
    const artifact = ROBINHOOD_STANDARD_JSON_ARTIFACTS[target.artifactKey];
    const bytes = await read(path.join(root, artifact.path));
    if (bytes.byteLength < 1 || bytes.byteLength > MAX_STANDARD_JSON_BYTES
      || sha256Digest(bytes) !== `sha256:${artifact.sha256.slice(2)}`) {
      fail(`${target.contract} Standard JSON bytes drifted`);
    }
    preparedTargets.push(buildTarget({
      target,
      verified,
      inputBytes: bytes,
      creationTransactionHash,
    }));
  }
  const closingSource = sourceOrigin(await inspectSource({ repositoryRoot: root }));
  if (canonicalizeJson(closingSource) !== canonicalizeJson(exactSource)) {
    fail("Sourcify protected source changed while preparing publication bytes");
  }
  const unsigned = {
    schemaVersion: ROBINHOOD_SOURCIFY_PLAN_SCHEMA,
    provider: "sourcify-v2",
    apiOrigin: ROBINHOOD_SOURCIFY_API_ORIGIN,
    chainId: ROBINHOOD_SOURCIFY_CHAIN_ID,
    chainDeploymentId: "robinhood-mainnet-custom-launch-v1",
    creationTransactionHash,
    sourceOrigin: exactSource,
    compilerVersion: COMPILER_VERSION,
    foundationSourceCommitment: verified.sourceCommitment,
    ownerTransactionDataHash: verified.ownerTransaction.dataHash,
    legalNoticeSha256: sha256Digest(Buffer.from(ROBINHOOD_SOURCIFY_LICENSE_NOTICE, "utf8")),
    externalEffects: Object.freeze({
      sourcify: "irreversible-public-source-publication-and-license-grant",
      blockscout: "possible-automatic-verification-submission-writeOrWarn",
      blockscoutReleaseAuthority: false,
    }),
    targets: preparedTargets.map(({ planTarget }) => planTarget),
    planDigest: null,
  };
  unsigned.planDigest = framedSha256(PLAN_DIGEST_DOMAIN, unsigned);
  const plan = Object.freeze(structuredClone(unsigned));
  return Object.freeze({ plan, preparedTargets: Object.freeze(preparedTargets) });
}

export function validateRobinhoodSourcifyPublicationPlan(plan) {
  assertExactKeys(plan, [
    "schemaVersion", "provider", "apiOrigin", "chainId", "chainDeploymentId",
    "creationTransactionHash", "sourceOrigin", "compilerVersion",
    "foundationSourceCommitment", "ownerTransactionDataHash", "legalNoticeSha256",
    "externalEffects", "targets", "planDigest",
  ], "Sourcify publication plan");
  if (plan.schemaVersion !== ROBINHOOD_SOURCIFY_PLAN_SCHEMA
    || plan.provider !== "sourcify-v2"
    || plan.apiOrigin !== ROBINHOOD_SOURCIFY_API_ORIGIN
    || plan.chainId !== ROBINHOOD_SOURCIFY_CHAIN_ID
    || plan.chainDeploymentId !== "robinhood-mainnet-custom-launch-v1"
    || plan.compilerVersion !== COMPILER_VERSION
    || !HASH.test(plan.creationTransactionHash)
    || plan.foundationSourceCommitment !== FOUNDATION_SOURCE_COMMITMENT
    || plan.ownerTransactionDataHash !== OWNER_TRANSACTION_DATA_HASH
    || plan.legalNoticeSha256
      !== sha256Digest(Buffer.from(ROBINHOOD_SOURCIFY_LICENSE_NOTICE, "utf8"))
    || !Array.isArray(plan.targets) || plan.targets.length !== TARGETS.length) {
    fail("Sourcify publication plan identity differs");
  }
  sourceOrigin(plan.sourceOrigin);
  if (canonicalizeJson(plan.externalEffects) !== canonicalizeJson({
    sourcify: "irreversible-public-source-publication-and-license-grant",
    blockscout: "possible-automatic-verification-submission-writeOrWarn",
    blockscoutReleaseAuthority: false,
  })) {
    fail("Sourcify publication external effects differ");
  }
  for (const [index, target] of plan.targets.entries()) {
    const expected = TARGETS[index];
    const artifact = ROBINHOOD_STANDARD_JSON_ARTIFACTS[expected.artifactKey];
    assertExactKeys(target, [
      "contract", "address", "fullyQualifiedName", "standardJsonInputPath",
      "standardJsonInputSha256", "standardJsonInputByteLength", "sourceCount",
      "metadataSha256", "requestPath", "requestBodySha256",
      "requestBodyByteLength", "expectedProviderMatch", "providerClassification",
      "bytecode",
    ], `Sourcify target ${index}`);
    assertExactKeys(target.bytecode, [
      "creationRecompiledKeccak256", "creationOnchainKeccak256",
      "runtimeRecompiledKeccak256", "runtimeOnchainKeccak256",
    ], `Sourcify target ${index} bytecode`);
    canonicalAddress(target.address, expected.address, `Sourcify target ${index} address`);
    if (target.contract !== expected.contract
      || target.fullyQualifiedName !== artifact.fqcn
      || target.standardJsonInputPath !== artifact.path
      || target.standardJsonInputSha256 !== `sha256:${artifact.sha256.slice(2)}`
      || target.sourceCount !== artifact.sourceCount
      || target.expectedProviderMatch !== "match"
      || target.providerClassification !== ROBINHOOD_SOURCIFY_PROVIDER_CLASSIFICATION
      || target.requestPath
        !== `/server/v2/verify/${ROBINHOOD_SOURCIFY_CHAIN_ID}/${expected.address}`
      || !SHA256.test(target.standardJsonInputSha256)
      || !SHA256.test(target.metadataSha256)
      || !SHA256.test(target.requestBodySha256)
      || !Number.isSafeInteger(target.standardJsonInputByteLength)
      || target.standardJsonInputByteLength < 1
      || target.standardJsonInputByteLength > MAX_STANDARD_JSON_BYTES
      || !Number.isSafeInteger(target.requestBodyByteLength)
      || target.requestBodyByteLength < 1
      || target.requestBodyByteLength > MAX_REQUEST_BYTES
      || !Number.isSafeInteger(target.sourceCount) || target.sourceCount < 1
      || Object.values(target.bytecode).some((value) => !HASH.test(value))
      || target.bytecode.creationRecompiledKeccak256 !== artifact.baseCreationCodeHash
      || target.bytecode.creationOnchainKeccak256 !== (
        expected.artifactKey === "router"
          ? artifact.constructorAppendedCreationCodeHash
          : artifact.baseCreationCodeHash
      )
      || target.bytecode.runtimeRecompiledKeccak256 !== artifact.baseRuntimeCodeHash
      || target.bytecode.runtimeOnchainKeccak256 !== (
        expected.artifactKey === "router"
          ? artifact.deployedRuntimeCodeHash
          : artifact.baseRuntimeCodeHash
      )) {
      fail(`Sourcify target ${index} identity differs`);
    }
  }
  const preimage = { ...structuredClone(plan), planDigest: null };
  if (plan.planDigest !== framedSha256(PLAN_DIGEST_DOMAIN, preimage)) {
    fail("Sourcify publication plan digest differs");
  }
  return Object.freeze(structuredClone(plan));
}

export function robinhoodSourcifyPublicationAuthorizationDigest(plan) {
  const validated = validateRobinhoodSourcifyPublicationPlan(plan);
  return framedSha256(AUTHORIZATION_DIGEST_DOMAIN, {
    planDigest: validated.planDigest,
    legalNoticeSha256: validated.legalNoticeSha256,
    externalEffects: validated.externalEffects,
  });
}

function validatePreparedPublication(prepared) {
  assertExactKeys(prepared, ["plan", "preparedTargets"], "prepared Sourcify publication");
  const plan = validateRobinhoodSourcifyPublicationPlan(prepared.plan);
  if (!Array.isArray(prepared.preparedTargets)
    || prepared.preparedTargets.length !== plan.targets.length) {
    fail("prepared Sourcify target inventory differs");
  }
  for (const [index, target] of prepared.preparedTargets.entries()) {
    assertExactKeys(target, [
      "planTarget", "request", "requestBytes", "input", "metadata", "expected",
    ], `prepared Sourcify target ${index}`);
    if (canonicalizeJson(target.planTarget) !== canonicalizeJson(plan.targets[index])
      || !(target.requestBytes instanceof Uint8Array)
      || target.requestBytes.byteLength !== target.planTarget.requestBodyByteLength
      || sha256Digest(target.requestBytes) !== target.planTarget.requestBodySha256
      || canonicalizeJson(target.request) !== decodeExactUtf8(
        target.requestBytes,
        `prepared Sourcify target ${index} request`,
      )
      || target.request.creationTransactionHash !== plan.creationTransactionHash
      || canonicalizeJson(target.request.stdJsonInput) !== canonicalizeJson(target.input)) {
      fail(`prepared Sourcify target ${index} differs from its exact plan`);
    }
  }
  return plan;
}

async function jsonResponse(response, { label, maximumBytes, budget, statuses }) {
  if (!statuses.includes(response?.status)
    || !/^application\/json(?:;\s*charset=utf-8)?$/iu.test(
      response?.headers?.get?.("content-type") ?? "",
    )) {
    await response?.body?.cancel?.("unexpected Sourcify response").catch(() => {});
    fail(`${label} returned an unexpected HTTP response`);
  }
  const bytes = await readRobinhoodBoundedResponse(response, {
    label,
    maximumBytes,
    budget,
  });
  return Object.freeze({
    status: response.status,
    bytes,
    value: parseJsonBytes(bytes, label),
    sha256: sha256Digest(bytes),
  });
}

async function requestJson(request, url, init, options) {
  let response;
  try {
    response = await request(url, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    fail(`${options.label} request failed: ${error.message}`);
  }
  return jsonResponse(response, options);
}

function validateProviderApi(openapi, chains) {
  assertPlainObject(openapi, "Sourcify OpenAPI");
  if (openapi.info?.version !== OPENAPI_VERSION
    || typeof openapi.info?.description !== "string"
    || !openapi.info.description.includes(ROBINHOOD_SOURCIFY_LICENSE_NOTICE)
    || openapi.paths?.["/v2/verify/{chainId}/{address}"]?.post?.responses?.["202"] === undefined
    || openapi.paths?.["/v2/verify/{verificationId}"]?.get?.responses?.["200"] === undefined
    || openapi.paths?.["/v2/contract/{chainId}/{address}"]?.get?.responses?.["200"] === undefined) {
    fail("Sourcify OpenAPI or publication license drifted");
  }
  if (!Array.isArray(chains)) fail("Sourcify chains response is invalid");
  const matches = chains.filter((entry) => String(entry?.chainId) === ROBINHOOD_SOURCIFY_CHAIN_ID);
  if (matches.length !== 1 || matches[0].name !== "Robinhood Chain"
    || matches[0].supported !== true) {
    fail("Sourcify no longer reports unique supported Robinhood Chain 4663");
  }
}

async function providerPreflight(request, budget) {
  const [openapi, chains] = await Promise.all([
    requestJson(request, `${ROBINHOOD_SOURCIFY_API_BASE}/api-docs/swagger.json`, {
      method: "GET", headers: { accept: "application/json" },
    }, {
      label: "Sourcify OpenAPI", maximumBytes: 5 * 1024 * 1024,
      budget, statuses: [200],
    }),
    requestJson(request, `${ROBINHOOD_SOURCIFY_API_BASE}/chains`, {
      method: "GET", headers: { accept: "application/json" },
    }, {
      label: "Sourcify chains", maximumBytes: MAX_SMALL_RESPONSE_BYTES,
      budget, statuses: [200],
    }),
  ]);
  validateProviderApi(openapi.value, chains.value);
  return Object.freeze({
    openapiSha256: openapi.sha256,
    chainsSha256: chains.sha256,
  });
}

function noCbor(value, label) {
  assertPlainObject(value, label);
  if (Object.keys(value).length !== 0) fail(`${label} must be empty for appendCBOR=false`);
}

function linkFree(value, label) {
  assertPlainObject(value, label);
  if (Object.keys(value).length !== 0) fail(`${label} must be empty`);
}

function applyExpectedTransformations(readback, prepared, label) {
  const creation = readback.creationBytecode;
  const runtime = readback.runtimeBytecode;
  assertPlainObject(creation, `${label}.creationBytecode`);
  assertPlainObject(runtime, `${label}.runtimeBytecode`);
  const recompiledCreation = exactHex(
    creation.recompiledBytecode,
    `${label} recompiled creation bytecode`,
  );
  const onchainCreation = exactHex(
    creation.onchainBytecode,
    `${label} onchain creation bytecode`,
  );
  const recompiledRuntime = exactHex(
    runtime.recompiledBytecode,
    `${label} recompiled runtime bytecode`,
  );
  const onchainRuntime = exactHex(
    runtime.onchainBytecode,
    `${label} onchain runtime bytecode`,
  );
  noCbor(creation.cborAuxdata, `${label} creation CBOR auxdata`);
  noCbor(runtime.cborAuxdata, `${label} runtime CBOR auxdata`);
  linkFree(creation.linkReferences, `${label} creation links`);
  linkFree(runtime.linkReferences, `${label} runtime links`);
  if (keccak256(recompiledCreation) !== prepared.planTarget.bytecode.creationRecompiledKeccak256
    || keccak256(onchainCreation) !== prepared.planTarget.bytecode.creationOnchainKeccak256
    || keccak256(recompiledRuntime) !== prepared.planTarget.bytecode.runtimeRecompiledKeccak256
    || keccak256(onchainRuntime) !== prepared.planTarget.bytecode.runtimeOnchainKeccak256) {
    fail(`${label} exact creation/runtime bytecode closure differs`);
  }
  if (recompiledCreation !== prepared.expected.creationRecompiled
    || onchainCreation !== prepared.expected.creationOnchain
    || recompiledRuntime !== prepared.expected.runtimeRecompiled) {
    fail(`${label} retained bytecode differs from the independently compiled bytes`);
  }
  const creationTransformations = creation.transformations;
  const creationValues = creation.transformationValues;
  if (!Array.isArray(creationTransformations)) fail(`${label} creation transformations are invalid`);
  assertPlainObject(creationValues, `${label} creation transformation values`);
  if (prepared.expected.constructorArguments === "0x") {
    if (creationTransformations.length !== 0 || Object.keys(creationValues).length !== 0
      || recompiledCreation !== onchainCreation) {
      fail(`${label} unexpected creation transformations`);
    }
  } else {
    if (creationTransformations.length !== 1
      || canonicalizeJson(creationTransformations[0]) !== canonicalizeJson({
        type: "insert",
        offset: (recompiledCreation.length - 2) / 2,
        reason: "constructorArguments",
      })
      || canonicalizeJson(creationValues)
        !== canonicalizeJson({ constructorArguments: prepared.expected.constructorArguments })
      || `${recompiledCreation}${prepared.expected.constructorArguments.slice(2)}`
        !== onchainCreation) {
      fail(`${label} constructor-argument transformation differs`);
    }
  }
  const immutableReferences = runtime.immutableReferences ?? {};
  if (canonicalizeJson(immutableReferences)
      !== canonicalizeJson(prepared.expected.immutableReferences)) {
    fail(`${label} immutable reference map differs`);
  }
  const runtimeTransformations = runtime.transformations;
  const runtimeValues = runtime.transformationValues;
  if (!Array.isArray(runtimeTransformations)) fail(`${label} runtime transformations are invalid`);
  assertPlainObject(runtimeValues, `${label} runtime transformation values`);
  const expectedTransforms = [];
  for (const [id, references] of Object.entries(prepared.expected.immutableReferences)) {
    if (!Array.isArray(references)) fail(`${label} compiled immutable references are invalid`);
    for (const reference of references) {
      expectedTransforms.push({ id, type: "replace", offset: reference.start, reason: "immutable" });
    }
  }
  expectedTransforms.sort((left, right) => left.offset - right.offset || left.id.localeCompare(right.id));
  const sortedRuntime = [...runtimeTransformations]
    .sort((left, right) => left.offset - right.offset || String(left.id).localeCompare(String(right.id)));
  if (canonicalizeJson(sortedRuntime) !== canonicalizeJson(expectedTransforms)) {
    fail(`${label} runtime transformations are not exactly the compiled immutables`);
  }
  if (expectedTransforms.length === 0) {
    if (Object.keys(runtimeValues).length !== 0 || recompiledRuntime !== onchainRuntime) {
      fail(`${label} unexpected runtime transformation values`);
    }
  } else {
    assertExactKeys(runtimeValues, ["immutables"], `${label} runtime transformation values`);
    assertPlainObject(runtimeValues.immutables, `${label} immutable values`);
    const expectedIds = Object.keys(prepared.expected.immutableReferences).sort();
    if (Object.keys(runtimeValues.immutables).sort().join("\0") !== expectedIds.join("\0")) {
      fail(`${label} immutable values differ`);
    }
    const populated = Buffer.from(recompiledRuntime.slice(2), "hex");
    for (const id of expectedIds) {
      const references = prepared.expected.immutableReferences[id];
      const value = exactHex(runtimeValues.immutables[id], `${label} immutable ${id}`);
      for (const reference of references) {
        if ((value.length - 2) / 2 !== reference.length) {
          fail(`${label} immutable ${id} length differs`);
        }
        Buffer.from(value.slice(2), "hex").copy(populated, reference.start);
      }
    }
    if (`0x${populated.toString("hex")}` !== onchainRuntime) {
      fail(`${label} immutable transformations do not reconstruct onchain runtime`);
    }
  }
  return Object.freeze({
    creationRecompiledKeccak256: keccak256(recompiledCreation),
    creationOnchainKeccak256: keccak256(onchainCreation),
    runtimeRecompiledKeccak256: keccak256(recompiledRuntime),
    runtimeOnchainKeccak256: keccak256(onchainRuntime),
    transformationPolicy: "constructor-arguments-and-compiled-immutables-only",
  });
}

export function validateRobinhoodSourcifyReadback({
  value,
  responseSha256,
  prepared,
  creationTransactionHash,
}) {
  const label = `Sourcify ${prepared.planTarget.contract}`;
  assertPlainObject(value, label);
  canonicalAddress(value.address, prepared.planTarget.address, `${label} address`);
  if (value.chainId !== ROBINHOOD_SOURCIFY_CHAIN_ID
    || value.match !== "match" || value.creationMatch !== "match"
    || value.runtimeMatch !== "match"
    || typeof value.matchId !== "string" || !/^[1-9][0-9]*$/u.test(value.matchId)
    || typeof value.verifiedAt !== "string") {
    fail(`${label} must be provider match/match/match for appendCBOR=false`);
  }
  const verifiedAt = exactIso(value.verifiedAt, `${label}.verifiedAt`);
  assertPlainObject(value.compilation, `${label}.compilation`);
  if (value.compilation.language !== "Solidity"
    || value.compilation.compiler !== "solc"
    || value.compilation.compilerVersion !== COMPILER_VERSION
    || value.compilation.name
      !== prepared.planTarget.fullyQualifiedName.split(":").at(-1)
    || value.compilation.fullyQualifiedName !== prepared.planTarget.fullyQualifiedName
    || canonicalizeJson(value.compilation.compilerSettings)
      !== canonicalizeJson(prepared.input.settings)
    || canonicalizeJson(value.stdJsonInput) !== canonicalizeJson(prepared.input)
    || canonicalizeJson(value.sources) !== canonicalizeJson(
      Object.fromEntries(Object.entries(prepared.input.sources).map(([name, source]) => [
        name, { content: source.content },
      ])),
    )
    || sha256Digest(Buffer.from(canonicalizeJson(value.metadata), "utf8"))
      !== prepared.planTarget.metadataSha256
    || value.deployment?.transactionHash !== creationTransactionHash) {
    fail(`${label} source/compiler/settings/metadata/transaction closure differs`);
  }
  const bytes = applyExpectedTransformations(value, prepared, label);
  if (!SHA256.test(responseSha256)) fail(`${label} response digest is invalid`);
  return Object.freeze({
    contract: prepared.planTarget.contract,
    address: prepared.planTarget.address,
    providerMatch: "match",
    creationMatch: "match",
    runtimeMatch: "match",
    providerClassification: ROBINHOOD_SOURCIFY_PROVIDER_CLASSIFICATION,
    matchId: value.matchId,
    verifiedAt,
    responseSha256,
    standardJsonInputSha256: prepared.planTarget.standardJsonInputSha256,
    metadataSha256: prepared.planTarget.metadataSha256,
    ...bytes,
  });
}

function validateMissingReadback(value, prepared) {
  assertAllowedKeys(value,
    ["match", "creationMatch", "runtimeMatch", "chainId", "address"],
    ["verifiedAt", "matchId"],
    `Sourcify missing ${prepared.planTarget.contract}`,
  );
  canonicalAddress(value.address, prepared.planTarget.address, "Sourcify missing address");
  if (value.chainId !== ROBINHOOD_SOURCIFY_CHAIN_ID || value.match !== null
    || value.creationMatch !== null || value.runtimeMatch !== null
    || value.verifiedAt !== undefined || value.matchId !== undefined) {
    fail(`Sourcify missing ${prepared.planTarget.contract} response differs`);
  }
}

async function readback(request, prepared, transactionHash, budget, validateReadback) {
  const response = await requestJson(
    request,
    `${ROBINHOOD_SOURCIFY_API_BASE}/v2/contract/${ROBINHOOD_SOURCIFY_CHAIN_ID}/${prepared.planTarget.address}?fields=all`,
    { method: "GET", headers: { accept: "application/json" } },
    {
      label: `Sourcify ${prepared.planTarget.contract} readback`,
      maximumBytes: MAX_CONTRACT_RESPONSE_BYTES,
      budget,
      statuses: [200, 404],
    },
  );
  if (response.status === 404) {
    validateMissingReadback(response.value, prepared);
    return Object.freeze({ state: "missing", responseSha256: response.sha256 });
  }
  return Object.freeze({
    state: "verified",
    evidence: validateReadback({
      value: response.value,
      responseSha256: response.sha256,
      prepared,
      creationTransactionHash: transactionHash,
    }),
  });
}

function validateTicket(value) {
  assertExactKeys(value, ["verificationId"], "Sourcify verification ticket");
  if (typeof value.verificationId !== "string" || !UUID.test(value.verificationId)) {
    fail("Sourcify verification ticket ID is invalid");
  }
  return value.verificationId;
}

function validateAlreadyVerified(value) {
  assertExactKeys(value, ["customCode", "message", "errorId"], "Sourcify conflict");
  if (value.customCode !== "already_verified" || typeof value.message !== "string"
    || value.message.length < 1 || value.message.length > 2_048
    || typeof value.errorId !== "string" || !UUID.test(value.errorId)) {
    fail("Sourcify conflict is not canonical already_verified");
  }
}

function boundedProviderString(value, label, maximumLength = 4_096) {
  if (value === undefined) return null;
  if (typeof value !== "string" || value.length < 1 || value.length > maximumLength
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) {
    fail(`${label} is invalid`);
  }
  return value;
}

function externalBlockscout(value) {
  if (value === undefined) return null;
  assertPlainObject(value, "Sourcify externalVerifications");
  assertAllowedKeys(value, [], ["etherscan", "blockscout", "routescan"],
    "Sourcify externalVerifications");
  const blockscout = value.blockscout;
  if (blockscout === undefined) return null;
  assertAllowedKeys(blockscout, [], [
    "verificationId", "error", "statusUrl", "explorerUrl",
  ], "Sourcify external Blockscout verification");
  const normalized = {
    verificationId: boundedProviderString(
      blockscout.verificationId,
      "Sourcify external Blockscout verificationId",
      512,
    ),
    error: boundedProviderString(
      blockscout.error,
      "Sourcify external Blockscout error",
      8_192,
    ),
    statusUrl: boundedProviderString(
      blockscout.statusUrl,
      "Sourcify external Blockscout statusUrl",
    ),
    explorerUrl: boundedProviderString(
      blockscout.explorerUrl,
      "Sourcify external Blockscout explorerUrl",
    ),
  };
  for (const [key, candidate] of [
    ["statusUrl", normalized.statusUrl],
    ["explorerUrl", normalized.explorerUrl],
  ]) {
    if (candidate !== null) {
      let parsed;
      try {
        parsed = new URL(candidate);
      } catch {
        fail(`Sourcify external Blockscout ${key} is not a URL`);
      }
      if (parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "") {
        fail(`Sourcify external Blockscout ${key} is not credential-free HTTPS`);
      }
    }
  }
  return Object.freeze(normalized);
}

async function pollJob(request, prepared, verificationId, budget, sleep) {
  for (let attempt = 1; attempt <= MAX_JOB_POLLS; attempt += 1) {
    const response = await requestJson(
      request,
      `${ROBINHOOD_SOURCIFY_API_BASE}/v2/verify/${verificationId}`,
      { method: "GET", headers: { accept: "application/json" } },
      {
        label: `Sourcify ${prepared.planTarget.contract} job`,
        maximumBytes: MAX_SMALL_RESPONSE_BYTES,
        budget,
        statuses: [200],
      },
    );
    const value = response.value;
    assertAllowedKeys(value,
      ["isJobCompleted", "verificationId"],
      ["error", "jobStartTime", "jobFinishTime", "compilationTime", "contract", "externalVerifications"],
      "Sourcify job",
    );
    if (value.verificationId !== verificationId || typeof value.isJobCompleted !== "boolean") {
      fail("Sourcify job identity differs");
    }
    if (value.contract !== undefined) {
      assertPlainObject(value.contract, "Sourcify job contract");
      canonicalAddress(value.contract.address, prepared.planTarget.address, "Sourcify job address");
      if (value.contract.chainId !== ROBINHOOD_SOURCIFY_CHAIN_ID) {
        fail("Sourcify job chain differs");
      }
    }
    if (value.isJobCompleted) {
      if (value.error !== undefined
        || value.contract?.match !== "match"
        || value.contract?.creationMatch !== "match"
        || value.contract?.runtimeMatch !== "match") {
        fail("Sourcify job did not complete with appendCBOR=false match/match/match");
      }
      return Object.freeze({
        verificationId,
        jobResponseSha256: response.sha256,
        externalBlockscout: externalBlockscout(value.externalVerifications),
      });
    }
    if (value.error !== undefined
      || (value.contract !== undefined && (
        value.contract.match !== null || value.contract.creationMatch !== null
        || value.contract.runtimeMatch !== null
      ))) {
      fail("Sourcify pending job returned a terminal result");
    }
    if (attempt === MAX_JOB_POLLS) fail("Sourcify verification job timed out");
    await sleep(JOB_POLL_INTERVAL_MS);
  }
  fail("Sourcify verification job poll limit exhausted");
}

export async function inspectRobinhoodSourcifyPublication({
  prepared,
  request = fetch,
  validateReadback = validateRobinhoodSourcifyReadback,
}) {
  const plan = validatePreparedPublication(prepared);
  const budget = createRobinhoodResponseBudget(MAX_AGGREGATE_RESPONSE_BYTES);
  const api = await providerPreflight(request, budget);
  const targets = [];
  for (const target of prepared.preparedTargets) {
    const result = await readback(
      request,
      target,
      plan.creationTransactionHash,
      budget,
      validateReadback,
    );
    targets.push(Object.freeze({
      contract: target.planTarget.contract,
      state: result.state,
      evidence: result.evidence ?? null,
    }));
  }
  return Object.freeze({
    mode: "review-only",
    externalAction: false,
    plan,
    authorizationDigest: robinhoodSourcifyPublicationAuthorizationDigest(plan),
    legalNotice: ROBINHOOD_SOURCIFY_LICENSE_NOTICE,
    externalEffects: plan.externalEffects,
    providerApi: api,
    targets: Object.freeze(targets),
  });
}

export async function submitRobinhoodSourcifyPublication({
  prepared,
  authorizationDigest,
  licenseAcknowledgement,
  request = fetch,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  now = () => new Date(),
  revalidateSource = async () => {},
  validateReadback = validateRobinhoodSourcifyReadback,
  onBeforePost = async () => {
    fail("Sourcify POST requires a durable onBeforePost checkpoint");
  },
  onExactTargetReadback = async () => {},
}) {
  const plan = validatePreparedPublication(prepared);
  const expectedAuthorization = robinhoodSourcifyPublicationAuthorizationDigest(plan);
  if (authorizationDigest !== expectedAuthorization
    || licenseAcknowledgement !== ROBINHOOD_SOURCIFY_LICENSE_ACKNOWLEDGEMENT) {
    fail("Sourcify submission requires the exact reviewed publication and legal acknowledgement");
  }
  const budget = createRobinhoodResponseBudget(MAX_AGGREGATE_RESPONSE_BYTES);
  const api = await providerPreflight(request, budget);
  const results = [];
  for (const target of prepared.preparedTargets) {
    const before = await readback(
      request,
      target,
      plan.creationTransactionHash,
      budget,
      validateReadback,
    );
    if (before.state === "verified") {
      const result = Object.freeze({
        contract: target.planTarget.contract,
        submission: "already-verified-read-only",
        verificationId: null,
        jobResponseSha256: null,
        externalBlockscout: null,
        evidence: before.evidence,
      });
      results.push(result);
      await onExactTargetReadback(result, plan);
      continue;
    }
    await revalidateSource(plan.sourceOrigin);
    await onBeforePost(target.planTarget, plan);
    const post = await requestJson(
      request,
      `${ROBINHOOD_SOURCIFY_API_BASE}${target.planTarget.requestPath.slice("/server".length)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: target.requestBytes,
      },
      {
        label: `Sourcify ${target.planTarget.contract} submission`,
        maximumBytes: MAX_SMALL_RESPONSE_BYTES,
        budget,
        statuses: [202, 409],
      },
    );
    let job = null;
    let submission;
    if (post.status === 202) {
      const verificationId = validateTicket(post.value);
      job = await pollJob(request, target, verificationId, budget, sleep);
      submission = "submitted-and-completed";
    } else {
      validateAlreadyVerified(post.value);
      submission = "concurrent-already-verified";
    }
    const after = await readback(
      request,
      target,
      plan.creationTransactionHash,
      budget,
      validateReadback,
    );
    if (after.state !== "verified") fail(`${target.planTarget.contract} readback remained missing`);
    const result = Object.freeze({
      contract: target.planTarget.contract,
      submission,
      verificationId: job?.verificationId ?? null,
      jobResponseSha256: job?.jobResponseSha256 ?? null,
      externalBlockscout: job?.externalBlockscout ?? null,
      evidence: after.evidence,
    });
    results.push(result);
    await onExactTargetReadback(result, plan);
  }
  return buildRobinhoodSourcifyReceipt({
    plan,
    api,
    results,
    externalActionThisRun: results.some(({ submission }) =>
      new Set(["submitted-and-completed", "concurrent-already-verified"]).has(submission)),
    now,
  });
}

function buildRobinhoodSourcifyReceipt({
  plan,
  api,
  results,
  externalActionThisRun,
  now,
}) {
  const unsigned = {
    schemaVersion: ROBINHOOD_SOURCIFY_RECEIPT_SCHEMA,
    provider: "sourcify-v2",
    providerClassification: ROBINHOOD_SOURCIFY_PROVIDER_CLASSIFICATION,
    chainId: ROBINHOOD_SOURCIFY_CHAIN_ID,
    creationTransactionHash: plan.creationTransactionHash,
    sourceOrigin: plan.sourceOrigin,
    planDigest: plan.planDigest,
    authorizationDigest: robinhoodSourcifyPublicationAuthorizationDigest(plan),
    legalNoticeSha256: plan.legalNoticeSha256,
    externalEffects: plan.externalEffects,
    externalActionThisRun,
    observedAt: canonicalNow(now),
    providerApi: api,
    targets: results,
    receiptDigest: null,
  };
  unsigned.receiptDigest = framedSha256(RECEIPT_DIGEST_DOMAIN, unsigned);
  return Object.freeze(unsigned);
}

export async function attestRobinhoodSourcifyPublication({
  prepared,
  request = fetch,
  now = () => new Date(),
  validateReadback = validateRobinhoodSourcifyReadback,
}) {
  const plan = validatePreparedPublication(prepared);
  const budget = createRobinhoodResponseBudget(MAX_AGGREGATE_RESPONSE_BYTES);
  const api = await providerPreflight(request, budget);
  const results = [];
  for (const target of prepared.preparedTargets) {
    const read = await readback(
      request,
      target,
      plan.creationTransactionHash,
      budget,
      validateReadback,
    );
    if (read.state !== "verified") {
      fail(`${target.planTarget.contract} remains missing during read-only recovery`);
    }
    results.push(Object.freeze({
      contract: target.planTarget.contract,
      submission: "recovered-read-only",
      verificationId: null,
      jobResponseSha256: null,
      externalBlockscout: null,
      evidence: read.evidence,
    }));
  }
  return buildRobinhoodSourcifyReceipt({
    plan,
    api,
    results,
    externalActionThisRun: false,
    now,
  });
}

export const ROBINHOOD_SOURCIFY_LIMITS = Object.freeze({
  maximumStandardJsonBytes: MAX_STANDARD_JSON_BYTES,
  maximumRequestBytes: MAX_REQUEST_BYTES,
  maximumSmallResponseBytes: MAX_SMALL_RESPONSE_BYTES,
  maximumContractResponseBytes: MAX_CONTRACT_RESPONSE_BYTES,
  maximumAggregateResponseBytes: MAX_AGGREGATE_RESPONSE_BYTES,
  requestTimeoutMilliseconds: REQUEST_TIMEOUT_MS,
  maximumJobPolls: MAX_JOB_POLLS,
  jobPollIntervalMilliseconds: JOB_POLL_INTERVAL_MS,
});
