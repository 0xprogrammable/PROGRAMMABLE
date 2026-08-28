#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

import {
  canonicalAddress,
  createClassicV4ReleaseManifest,
  normalizeHex,
  stableStringify,
} from "../../scripts/classic-v4-release-core.mjs";
import {
  loadClassicV4ReleaseArtifactContext,
  resolveClassicV4ReleaseValidation,
} from "./classic-v4-release-validation.mjs";
import { verifyClassicV4LifecycleCanary } from "./verify-classic-v4-lifecycle-canary.mjs";
import {
  assertFreshDeploymentEvidence,
  assertFreshSourceEvidence,
  verifyClassicV4ReleasePrerequisites,
} from "./verify-classic-v4-release-prerequisites.mjs";

export { assertFreshDeploymentEvidence, assertFreshSourceEvidence };

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptPath), "..", "..");
const canonicalOutput = path.join(
  repositoryRoot,
  "contracts/deployments/mainnet-classic-v4.json",
);
const deploymentSchemaPath = path.join(
  repositoryRoot,
  "contracts/deployments/schema/classic-v4-deployment-evidence-v1.schema.json",
);
const releaseSchemaPath = path.join(
  repositoryRoot,
  "contracts/deployments/schema/classic-v4-release-v1.schema.json",
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
      `${forbidden.split("=", 1)[0]} is forbidden; capture never signs or broadcasts`,
    );
  }
  const parsed = {
    plan: null,
    deploymentEvidence: null,
    sourceEvidence: null,
    canaryPlan: null,
    transactions: null,
    lifecycleEvidence: null,
    verificationBlock: null,
    rpcA: null,
    rpcB: null,
    write: false,
    output: canonicalOutput,
    wallet: null,
    acknowledgement: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--write") {
      parsed.write = true;
      continue;
    }
    const separator = argument.indexOf("=");
    const key = separator === -1 ? argument : argument.slice(0, separator);
    const inlineValue = separator === -1 ? null : argument.slice(separator + 1);
    const known = [
      "--plan",
      "--deployment-evidence",
      "--source-evidence",
      "--canary-plan",
      "--transactions",
      "--lifecycle-evidence",
      "--verification-block",
      "--rpc-a",
      "--rpc-b",
      "--output",
      "--wallet",
      "--acknowledge-manifest-digest",
    ];
    if (!known.includes(key)) fail(`Unknown argument: ${key}`);
    const value = inlineValue ?? argv[++index];
    if (!value || value.startsWith("--")) fail(`Missing value for ${key}`);
    if (key === "--plan") parsed.plan = value;
    if (key === "--deployment-evidence") parsed.deploymentEvidence = value;
    if (key === "--source-evidence") parsed.sourceEvidence = value;
    if (key === "--canary-plan") parsed.canaryPlan = value;
    if (key === "--transactions") parsed.transactions = value;
    if (key === "--lifecycle-evidence") parsed.lifecycleEvidence = value;
    if (key === "--verification-block") parsed.verificationBlock = Number(value);
    if (key === "--rpc-a") parsed.rpcA = value;
    if (key === "--rpc-b") parsed.rpcB = value;
    if (key === "--output") parsed.output = value;
    if (key === "--wallet") parsed.wallet = value;
    if (key === "--acknowledge-manifest-digest") {
      parsed.acknowledgement = value;
    }
  }
  for (const key of [
    "plan",
    "deploymentEvidence",
    "sourceEvidence",
    "canaryPlan",
    "transactions",
    "lifecycleEvidence",
  ]) {
    if (!parsed[key])
      fail(
        `--${key.replace(/[A-Z]/g, (x) => `-${x.toLowerCase()}`)} is required`,
      );
    if (!path.isAbsolute(parsed[key])) fail(`${key} path must be absolute`);
  }
  if (
    !Number.isSafeInteger(parsed.verificationBlock) ||
    parsed.verificationBlock <= 0
  ) {
    fail("--verification-block must be a positive integer");
  }
  if (!parsed.rpcA || !parsed.rpcB) {
    fail("--rpc-a and --rpc-b are required");
  }
  return parsed;
}

async function readJson(file, label) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    fail(`Unable to read ${label}: ${error.message}`);
  }
}

function compileSchema(schema) {
  return new Ajv2020({
    allErrors: true,
    strict: true,
    validateFormats: false,
  }).compile(schema);
}

function assertSchema(validate, value, label) {
  if (!validate(value)) {
    fail(
      `${label} schema failed: ${validate.errors
        .map((error) => `${error.instancePath || "/"} ${error.message}`)
        .join("; ")}`,
    );
  }
}

function latestEvidenceTimestamp(...evidence) {
  const timestamps = evidence.map((entry) => Date.parse(entry.checkedAt));
  if (timestamps.some(Number.isNaN)) fail("Evidence checkedAt is invalid");
  return new Date(Math.max(...timestamps)).toISOString();
}

export function assertFreshLifecycleEvidence(saved, freshlyVerified) {
  if (stableStringify(freshlyVerified) !== stableStringify(saved)) {
    fail(
      "Lifecycle evidence differs from the fresh independent two-RPC verification",
    );
  }
}

async function writeAcknowledgedManifest(manifest, options) {
  if (path.resolve(options.output) !== canonicalOutput) {
    fail(
      "Classic V4 release output must use the canonical Mainnet manifest path",
    );
  }
  if (
    !options.wallet ||
    canonicalAddress(options.wallet, "wallet") !==
      canonicalAddress(manifest.addresses.deployer, "deployer")
  ) {
    fail("--write requires the explicit human wallet matching the deployer");
  }
  if (
    normalizeHex(options.acknowledgement) !==
    normalizeHex(manifest.manifestDigest)
  ) {
    fail(
      "--write requires --acknowledge-manifest-digest from a fresh check run",
    );
  }
  await writeFile(canonicalOutput, `${JSON.stringify(manifest, null, 2)}\n`, {
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
    suppliedCanary,
    suppliedTransactions,
    lifecycleEvidence,
    deploymentSchema,
    releaseSchema,
  ] = await Promise.all([
    readJson(options.plan, "preparation plan"),
    readJson(options.deploymentEvidence, "deployment evidence"),
    readJson(options.sourceEvidence, "source evidence"),
    readJson(options.canaryPlan, "canary plan"),
    readJson(options.transactions, "lifecycle transactions"),
    readJson(options.lifecycleEvidence, "lifecycle evidence"),
    readJson(deploymentSchemaPath, "deployment evidence schema"),
    readJson(releaseSchemaPath, "release schema"),
  ]);
  const artifactContext = await loadClassicV4ReleaseArtifactContext(plan);
  const { artifacts } = artifactContext;
  const releaseValidation = resolveClassicV4ReleaseValidation(plan);
  releaseValidation.validateArtifacts(plan, artifacts, artifactContext);
  assertSchema(
    compileSchema(deploymentSchema),
    deploymentEvidence,
    "Deployment evidence",
  );
  await verifyClassicV4ReleasePrerequisites({
    endpoints: [options.rpcA, options.rpcB],
    plan,
    deploymentEvidence,
    sourceEvidence,
    artifacts,
    artifactContext,
  });
  const freshlyVerifiedLifecycleEvidence =
    await verifyClassicV4LifecycleCanary({
      endpoints: [options.rpcA, options.rpcB],
      verificationBlock: options.verificationBlock,
      plan,
      deploymentEvidence,
      sourceEvidence,
      suppliedCanary,
      suppliedTransactions,
      artifacts,
      artifactContext,
    });
  assertFreshLifecycleEvidence(
    lifecycleEvidence,
    freshlyVerifiedLifecycleEvidence,
  );
  const manifestInput = {
    plan,
    deploymentEvidence,
    sourceEvidence,
    lifecycleEvidence: freshlyVerifiedLifecycleEvidence,
    capturedAt: latestEvidenceTimestamp(
      deploymentEvidence,
      sourceEvidence,
      freshlyVerifiedLifecycleEvidence,
    ),
  };
  const manifest = releaseValidation.createReleaseManifest
    ? releaseValidation.createReleaseManifest(manifestInput)
    : createClassicV4ReleaseManifest(manifestInput);
  assertSchema(compileSchema(releaseSchema), manifest, "Release manifest");
  if (options.write) await writeAcknowledgedManifest(manifest, options);
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
}

if (process.argv[1] === scriptPath) {
  main().catch((error) => {
    process.stderr.write(
      `Classic V4 release capture failed: ${error.message}\n`,
    );
    process.exitCode = 1;
  });
}
