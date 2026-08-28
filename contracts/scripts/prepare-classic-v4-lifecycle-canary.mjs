#!/usr/bin/env node

import { readFile, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import { decodeFunctionResult, keccak256 } from "viem";

import {
  CLASSIC_V4_DIGEST_DOMAINS,
  buildClassicV4LifecycleAuthorizationRequest,
  buildClassicV4LifecycleCanaryPlan,
  buildClassicV4LifecycleReleaseCandidate,
  canonicalAddress,
  classicV4LaunchStampRouterAbi,
  digestJson,
  normalizeHex,
} from "../../scripts/classic-v4-release-core.mjs";
import {
  loadClassicV4ReleaseArtifactContext,
  resolveClassicV4ReleaseValidation,
} from "./classic-v4-release-validation.mjs";
import { verifyClassicV4ReleasePrerequisites } from "./verify-classic-v4-release-prerequisites.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptPath), "..", "..");
const deploymentSchemaPath = path.join(
  repositoryRoot,
  "contracts/deployments/schema/classic-v4-deployment-evidence-v1.schema.json",
);

function fail(message) {
  throw new Error(message);
}

function parseArguments(argv) {
  const forbidden = argv.find(
    (argument) =>
      argument === "--broadcast" ||
      argument === "--private-key" ||
      argument.startsWith("--private-key=") ||
      argument === "--mnemonic" ||
      argument.startsWith("--mnemonic="),
  );
  if (forbidden) {
    fail(
      `${forbidden.split("=", 1)[0]} is forbidden; canary preparation never signs or broadcasts`,
    );
  }
  const parsed = {
    plan: null,
    deploymentEvidence: null,
    sourceEvidence: null,
    launchAuthorization: null,
    authorizationRequestOnly: false,
    rpcA: null,
    rpcB: null,
    wallet: null,
    write: false,
    output: null,
    acknowledgement: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--write") {
      parsed.write = true;
      continue;
    }
    if (argument === "--authorization-request-only") {
      parsed.authorizationRequestOnly = true;
      continue;
    }
    const separator = argument.indexOf("=");
    const key = separator === -1 ? argument : argument.slice(0, separator);
    const inlineValue = separator === -1 ? null : argument.slice(separator + 1);
    const known = [
      "--plan",
      "--deployment-evidence",
      "--source-evidence",
      "--launch-authorization",
      "--rpc-a",
      "--rpc-b",
      "--wallet",
      "--output",
      "--acknowledge-plan-digest",
    ];
    if (!known.includes(key)) fail(`Unknown argument: ${key}`);
    const value = inlineValue ?? argv[++index];
    if (!value || value.startsWith("--")) fail(`Missing value for ${key}`);
    if (key === "--plan") parsed.plan = value;
    if (key === "--deployment-evidence") parsed.deploymentEvidence = value;
    if (key === "--source-evidence") parsed.sourceEvidence = value;
    if (key === "--launch-authorization") parsed.launchAuthorization = value;
    if (key === "--rpc-a") parsed.rpcA = value;
    if (key === "--rpc-b") parsed.rpcB = value;
    if (key === "--wallet") parsed.wallet = value;
    if (key === "--output") parsed.output = value;
    if (key === "--acknowledge-plan-digest") parsed.acknowledgement = value;
  }
  for (const key of ["plan", "deploymentEvidence", "sourceEvidence"]) {
    if (!parsed[key]) fail(`${key} is required`);
    if (!path.isAbsolute(parsed[key])) fail(`${key} path must be absolute`);
  }
  if (Boolean(parsed.launchAuthorization) === parsed.authorizationRequestOnly) {
    fail(
      "Use exactly one of --launch-authorization or --authorization-request-only",
    );
  }
  if (parsed.launchAuthorization && !path.isAbsolute(parsed.launchAuthorization)) {
    fail("launchAuthorization path must be absolute");
  }
  if (
    parsed.authorizationRequestOnly &&
    (parsed.write || parsed.output || parsed.acknowledgement)
  ) {
    fail("Authorization request mode is read-only");
  }
  if (!parsed.wallet) fail("--wallet is required");
  if (!parsed.rpcA || !parsed.rpcB) fail("--rpc-a and --rpc-b are required");
  return parsed;
}

async function readJson(file, label) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    fail(`Unable to read ${label}: ${error.message}`);
  }
}

function assertSchema(schema, value, label) {
  const validate = new Ajv2020({
    allErrors: true,
    strict: true,
    validateFormats: false,
  }).compile(schema);
  if (!validate(value)) {
    fail(
      `${label} schema failed: ${validate.errors
        .map((error) => `${error.instancePath || "/"} ${error.message}`)
        .join("; ")}`,
    );
  }
}

async function rpc(endpoint, method, params) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    fail(`Classic authorization ${method} returned HTTP ${response.status}`);
  }
  const payload = await response.json();
  if (payload?.error || payload?.result === undefined) {
    fail(`Classic authorization ${method} failed`);
  }
  return payload.result;
}

function blockTag(value) {
  return `0x${BigInt(value).toString(16)}`;
}

function decodeStampHash(value) {
  try {
    return decodeFunctionResult({
      abi: classicV4LaunchStampRouterAbi,
      functionName: "launchAndStampV1",
      data: value,
    });
  } catch {
    fail("Classic Router simulation returned an invalid stamp hash");
  }
}

async function verifySignedAuthorizationAtEndpoint(endpoint, canaryPlan) {
  const authorization = canaryPlan.launchAuthorization;
  const transaction = authorization.transaction;
  const pinnedTag = blockTag(authorization.simulation.blockNumber);
  const [chainId, pinnedBlock, latestBlock, pinnedRouterCode, latestRouterCode] =
    await Promise.all([
      rpc(endpoint, "eth_chainId", []),
      rpc(endpoint, "eth_getBlockByNumber", [pinnedTag, false]),
      rpc(endpoint, "eth_getBlockByNumber", ["latest", false]),
      rpc(endpoint, "eth_getCode", [
        canaryPlan.launchStampRouterBinding.address,
        pinnedTag,
      ]),
      rpc(endpoint, "eth_getCode", [
        canaryPlan.launchStampRouterBinding.address,
        "latest",
      ]),
    ]);
  if (
    BigInt(chainId) !== 1n ||
    !pinnedBlock ||
    !latestBlock ||
    BigInt(pinnedBlock.number) !== BigInt(authorization.simulation.blockNumber) ||
    normalizeHex(pinnedBlock.hash) !== normalizeHex(authorization.simulation.blockHash) ||
    BigInt(pinnedBlock.timestamp) !== BigInt(authorization.simulation.blockTimestamp) ||
    BigInt(latestBlock.timestamp) < BigInt(authorization.validAfter) ||
    BigInt(latestBlock.timestamp) > BigInt(authorization.deadline) ||
    normalizeHex(keccak256(pinnedRouterCode)) !==
      normalizeHex(canaryPlan.launchStampRouterBinding.runtimeCodeHash) ||
    normalizeHex(keccak256(latestRouterCode)) !==
      normalizeHex(canaryPlan.launchStampRouterBinding.runtimeCodeHash)
  ) {
    fail("Classic signed authorization block or active time window differs");
  }
  const request = {
    from: transaction.from,
    to: transaction.to,
    value: blockTag(transaction.valueWei),
    data: transaction.calldata,
  };
  const [pinnedResult, latestResult] = await Promise.all([
    rpc(endpoint, "eth_call", [request, pinnedTag]),
    rpc(endpoint, "eth_call", [request, "latest"]),
  ]);
  const expectedStampHash = normalizeHex(authorization.simulation.stampHash);
  if (
    normalizeHex(decodeStampHash(pinnedResult)) !== expectedStampHash ||
    normalizeHex(decodeStampHash(latestResult)) !== expectedStampHash
  ) {
    fail("Classic signed Router simulation differs from the authorization artifact");
  }
  return {
    pinnedBlockHash: normalizeHex(pinnedBlock.hash),
    stampHash: expectedStampHash,
  };
}

async function writeAcknowledgedPlan(canaryPlan, options) {
  if (!options.output || !path.isAbsolute(options.output)) {
    fail("--write requires an absolute --output path");
  }
  if (
    canonicalAddress(options.wallet, "wallet") !== canaryPlan.operatorWallet
  ) {
    fail("Canary wallet binding differs");
  }
  if (
    normalizeHex(options.acknowledgement) !==
    normalizeHex(canaryPlan.planDigest)
  ) {
    fail("--write requires --acknowledge-plan-digest from a fresh check run");
  }
  const output = path.resolve(options.output);
  const relative = path.relative(repositoryRoot, output);
  if (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  ) {
    fail("The canary plan must be written outside the source repository");
  }
  const parent = path.dirname(output);
  const [realParent, parentStats] = await Promise.all([
    realpath(parent),
    stat(parent),
  ]);
  if (!parentStats.isDirectory() || realParent !== parent) {
    fail("The output parent must be an existing real directory");
  }
  await writeFile(output, `${JSON.stringify(canaryPlan, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  const [
    plan,
    deploymentEvidence,
    sourceEvidence,
    deploymentSchema,
  ] = await Promise.all([
    readJson(options.plan, "preparation plan"),
    readJson(options.deploymentEvidence, "deployment evidence"),
    readJson(options.sourceEvidence, "source evidence"),
    readJson(deploymentSchemaPath, "deployment evidence schema"),
  ]);
  const artifactContext = await loadClassicV4ReleaseArtifactContext(plan);
  const { artifacts } = artifactContext;
  const releaseValidation = resolveClassicV4ReleaseValidation(plan);
  releaseValidation.validateArtifacts(plan, artifacts, artifactContext);
  assertSchema(deploymentSchema, deploymentEvidence, "Deployment evidence");
  releaseValidation.validateDeploymentEvidence(plan, deploymentEvidence);
  releaseValidation.validateSourceEvidence(
    plan,
    deploymentEvidence,
    sourceEvidence,
  );
  await verifyClassicV4ReleasePrerequisites({
    endpoints: [options.rpcA, options.rpcB],
    plan,
    deploymentEvidence,
    sourceEvidence,
    artifacts,
    artifactContext,
  });
  const candidate = buildClassicV4LifecycleReleaseCandidate(
    plan,
    deploymentEvidence,
    sourceEvidence,
  );
  const authorizationRequest = buildClassicV4LifecycleAuthorizationRequest(
    candidate,
    options.wallet,
  );
  if (options.authorizationRequestOnly) {
    process.stdout.write(`${JSON.stringify(authorizationRequest, null, 2)}\n`);
    return;
  }
  const launchAuthorization = await readJson(
    options.launchAuthorization,
    "Classic signed authorization",
  );
  const canaryPlan = buildClassicV4LifecycleCanaryPlan(
    candidate,
    options.wallet,
    launchAuthorization,
  );
  const simulations = await Promise.all(
    [options.rpcA, options.rpcB].map((endpoint) =>
      verifySignedAuthorizationAtEndpoint(endpoint, canaryPlan),
    ),
  );
  if (
    digestJson(simulations[0], CLASSIC_V4_DIGEST_DOMAINS.generic) !==
    digestJson(simulations[1], CLASSIC_V4_DIGEST_DOMAINS.generic)
  ) {
    fail("Independent RPCs disagree on the signed Classic Router authorization");
  }
  if (options.write) await writeAcknowledgedPlan(canaryPlan, options);
  process.stdout.write(`${JSON.stringify(canaryPlan, null, 2)}\n`);
}

if (process.argv[1] === scriptPath) {
  main().catch((error) => {
    process.stderr.write(
      `Classic V4 canary preparation failed: ${error.message}\n`,
    );
    process.exitCode = 1;
  });
}
