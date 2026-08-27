#!/usr/bin/env node

import { readFile, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

import {
  CLASSIC_V4_DIGEST_DOMAINS,
  buildClassicV4LifecycleCanaryPlan,
  canonicalAddress,
  digestJson,
  normalizeHex,
  validateClassicV4DeploymentEvidence,
  validateClassicV4PreparationPlan,
  validateClassicV4SourceEvidence,
} from "../../scripts/classic-v4-release-core.mjs";
import { loadClassicV4SealedBuild } from "./prepare-classic-v4-mainnet-release.mjs";
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
    const separator = argument.indexOf("=");
    const key = separator === -1 ? argument : argument.slice(0, separator);
    const inlineValue = separator === -1 ? null : argument.slice(separator + 1);
    const known = [
      "--plan",
      "--deployment-evidence",
      "--source-evidence",
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

function releaseCandidate(plan, deploymentEvidence, sourceEvidence) {
  return {
    internalContractRelease: "classic-v4",
    chainId: 1,
    releaseCommit: plan.releaseCommit,
    sourceCommitment: plan.sourceCommitment,
    releaseBindingDigest: digestJson(
      {
        planDigest: plan.planDigest,
        deploymentEvidence,
        sourceEvidence,
      },
      CLASSIC_V4_DIGEST_DOMAINS.releaseBinding,
    ),
    addresses: {
      deployer: plan.deployer,
      launcherFeeRecipient: plan.launcherFeeRecipient,
      ...Object.fromEntries(
        Object.entries(plan.sharedDependencies).map(([name, value]) => [
          name,
          value.address,
        ]),
      ),
      ...plan.predictedAddresses,
    },
    officialDependencies: plan.officialDependencies,
    verification: {
      deploymentLive: true,
      runtimeCodeVerified: true,
      constructorBindingsVerified: true,
      sourceVerified: true,
    },
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
  const artifacts = await loadClassicV4SealedBuild(plan);
  validateClassicV4PreparationPlan(plan, artifacts);
  assertSchema(deploymentSchema, deploymentEvidence, "Deployment evidence");
  validateClassicV4DeploymentEvidence(plan, deploymentEvidence);
  validateClassicV4SourceEvidence(plan, deploymentEvidence, sourceEvidence);
  await verifyClassicV4ReleasePrerequisites({
    endpoints: [options.rpcA, options.rpcB],
    plan,
    deploymentEvidence,
    sourceEvidence,
    artifacts,
  });
  fail(
    "Canonical Classic Router handoff is not installed: obtain a permit-authority-signed launchAndStampV1 artifact before lifecycle canary preparation",
  );
  const canaryPlan = buildClassicV4LifecycleCanaryPlan(
    releaseCandidate(plan, deploymentEvidence, sourceEvidence),
    options.wallet,
  );
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
