#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFile, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CLASSIC_V4_LAUNCHER_UPGRADE_DEPLOYER,
  CLASSIC_V4_LAUNCHER_UPGRADE_DIGEST_DOMAINS,
  CLASSIC_V4_LAUNCHER_UPGRADE_SOURCE_TARGET,
  computeClassicV4LauncherUpgradeBuildCommitments,
  validateClassicV4LauncherUpgradePlan,
  validateClassicV4LauncherUpgradeReceiptEvidence,
} from "../../scripts/classic-v4-launcher-upgrade-core.mjs";
import {
  CLASSIC_V4_FINALITY_CONFIRMATIONS,
  canonicalAddress,
  digestJson,
  normalizeHex,
} from "../../scripts/classic-v4-release-core.mjs";
import { loadClassicV4LauncherUpgradeSealedBuild } from "./prepare-classic-v4-launcher-upgrade.mjs";
import {
  captureEtherscan,
  captureSourcify,
} from "./verify-classic-v4-mainnet-sources.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptPath), "..", "..");
const contractsRoot = path.join(repositoryRoot, "contracts");
const SOURCE_EVIDENCE_DOMAIN =
  "programmable.classic-v4-launcher-upgrade.source-evidence.v1";

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function assertExactKeys(value, expected, label) {
  const actual = Object.keys(value ?? {}).sort();
  const wanted = [...expected].sort();
  assert(
    actual.length === wanted.length &&
      actual.every((key, index) => key === wanted[index]),
    `${label} keys differ`,
  );
}

function assertBytes32(value, label) {
  assert(/^0x[0-9a-f]{64}$/i.test(value ?? ""), `Invalid ${label}`);
}

function assertIsoTimestamp(value, label) {
  const timestamp = Date.parse(value);
  assert(
    typeof value === "string" &&
      !Number.isNaN(timestamp) &&
      new Date(timestamp).toISOString() === value,
    `Invalid ${label}`,
  );
}

export function validateClassicV4LauncherFinalityEvidence({
  plan,
  receiptEvidence,
  finalityEvidence,
}) {
  validateClassicV4LauncherUpgradeReceiptEvidence(plan, receiptEvidence);
  assertExactKeys(
    finalityEvidence,
    [
      "schemaVersion",
      "status",
      "chainId",
      "planDigest",
      "receiptEvidenceDigest",
      "sourceCommitment",
      "verificationBlock",
      "verificationBlockHash",
      "checkedAt",
      "independentRpcCount",
      "confirmations",
      "transactionHash",
      "contractAddress",
      "runtimeCodeHash",
      "runtimeTemplateHash",
      "dependencyRuntimeVerified",
      "dependencyBindingsVerified",
      "constructorBindingsVerified",
      "canonicalRouterVerified",
      "evidenceDigest",
    ],
    "Classic V4 launcher finality evidence",
  );
  assertIsoTimestamp(finalityEvidence.checkedAt, "finality checkedAt");
  assertBytes32(
    finalityEvidence.verificationBlockHash,
    "verification block hash",
  );
  assertBytes32(finalityEvidence.runtimeCodeHash, "runtime code hash");
  assertBytes32(finalityEvidence.runtimeTemplateHash, "runtime template hash");
  const confirmations =
    finalityEvidence.verificationBlock - receiptEvidence.blockNumber + 1;
  assert(
    finalityEvidence.schemaVersion === 1 &&
      finalityEvidence.status === "finalized" &&
      finalityEvidence.chainId === 1 &&
      normalizeHex(finalityEvidence.planDigest) ===
        normalizeHex(plan.planDigest) &&
      normalizeHex(finalityEvidence.receiptEvidenceDigest) ===
        normalizeHex(receiptEvidence.evidenceDigest) &&
      normalizeHex(finalityEvidence.sourceCommitment) ===
        normalizeHex(plan.sourceCommitment) &&
      Number.isSafeInteger(finalityEvidence.verificationBlock) &&
      finalityEvidence.verificationBlock >= receiptEvidence.blockNumber &&
      finalityEvidence.confirmations === confirmations &&
      confirmations >= CLASSIC_V4_FINALITY_CONFIRMATIONS &&
      finalityEvidence.independentRpcCount === 2 &&
      normalizeHex(finalityEvidence.transactionHash) ===
        normalizeHex(receiptEvidence.transactionHash) &&
      canonicalAddress(finalityEvidence.contractAddress) ===
        canonicalAddress(plan.predictedAddress) &&
      normalizeHex(finalityEvidence.runtimeTemplateHash) ===
        normalizeHex(plan.runtimeTemplate.runtimeTemplateHash) &&
      finalityEvidence.dependencyRuntimeVerified === true &&
      finalityEvidence.dependencyBindingsVerified === true &&
      finalityEvidence.constructorBindingsVerified === true &&
      finalityEvidence.canonicalRouterVerified === true,
    "Classic V4 launcher finality evidence identity differs",
  );
  const { evidenceDigest, ...unsignedEvidence } = finalityEvidence;
  assert(
    normalizeHex(evidenceDigest) ===
      normalizeHex(
        digestJson(
          unsignedEvidence,
          CLASSIC_V4_LAUNCHER_UPGRADE_DIGEST_DOMAINS.verificationEvidence,
        ),
      ),
    "Classic V4 launcher finality evidence digest differs",
  );
  return finalityEvidence;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    fail(`${url.origin}${url.pathname} returned HTTP ${response.status}`);
  }
  return response.json();
}

export async function verifyClassicV4LauncherSourceProviders({
  plan,
  receiptEvidence,
  finalityEvidence,
  artifact,
  checkedAt = new Date().toISOString(),
  fetchJsonClient = fetchJson,
  etherscanApiKey = process.env.ETHERSCAN_API_KEY?.trim() || null,
}) {
  validateClassicV4LauncherUpgradePlan(plan, artifact);
  validateClassicV4LauncherFinalityEvidence({
    plan,
    receiptEvidence,
    finalityEvidence,
  });
  assertIsoTimestamp(checkedAt, "source verification checkedAt");
  const build = computeClassicV4LauncherUpgradeBuildCommitments(artifact);
  assert(
    normalizeHex(build.sourceClosureDigest) ===
      normalizeHex(plan.sourceClosureDigest),
    "MemeLaunchV4 source closure differs from the launcher plan",
  );
  const address = canonicalAddress(plan.predictedAddress);
  let sourcifyPayload;
  const sourcify = await captureSourcify(address, artifact, async (url) => {
    sourcifyPayload = await fetchJsonClient(url);
    return sourcifyPayload;
  });
  const sourcifyRecord = {
    ...sourcify,
    matchFields: {
      match: sourcifyPayload.match,
      creationMatch: sourcifyPayload.creationMatch,
      runtimeMatch: sourcifyPayload.runtimeMatch,
    },
    sourceClosure: "exact",
    queryUrl: `${sourcify.url}?fields=sources`,
  };
  let etherscanRecord = null;
  if (etherscanApiKey) {
    const etherscan = await captureEtherscan(
      address,
      CLASSIC_V4_LAUNCHER_UPGRADE_SOURCE_TARGET,
      plan.constructorArguments,
      artifact,
      fetchJsonClient,
      etherscanApiKey,
    );
    etherscanRecord = {
      ...etherscan,
      matchFields: {
        metadata: "exact-match",
        constructorArguments: "exact-match",
        sourceClosure: "exact-match",
      },
      sourceClosure: "exact",
    };
  }
  const unsignedEvidence = {
    schemaVersion: 1,
    status: etherscanRecord
      ? "sourcify-and-etherscan-verified"
      : "sourcify-verified",
    chainId: 1,
    checkedAt,
    releaseCommit: plan.releaseCommit,
    releaseTree: plan.releaseTree,
    planDigest: plan.planDigest,
    receiptEvidenceDigest: receiptEvidence.evidenceDigest,
    finalityEvidenceDigest: finalityEvidence.evidenceDigest,
    sourceCommitment: plan.sourceCommitment,
    sourceClosureDigest: build.sourceClosureDigest,
    sourceCount: build.sourceCount,
    contract: {
      address,
      contractName: CLASSIC_V4_LAUNCHER_UPGRADE_SOURCE_TARGET.contractName,
      fqcn: CLASSIC_V4_LAUNCHER_UPGRADE_SOURCE_TARGET.fqcn,
      encodedConstructorArguments: plan.constructorArguments,
      deploymentTransaction: receiptEvidence.transactionHash,
      deploymentBlock: receiptEvidence.blockNumber,
      runtimeCodeHash: finalityEvidence.runtimeCodeHash,
      runtimeTemplateHash: finalityEvidence.runtimeTemplateHash,
    },
    providers: {
      sourcify: sourcifyRecord,
      etherscan: etherscanRecord,
    },
  };
  return {
    ...unsignedEvidence,
    evidenceDigest: digestJson(unsignedEvidence, SOURCE_EVIDENCE_DOMAIN),
  };
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
      `${forbidden.split("=", 1)[0]} is forbidden; this helper never signs or deploys`,
    );
  }
  const options = {
    plan: null,
    receiptEvidence: null,
    finalityEvidence: null,
    mode: "verify",
    write: false,
    output: null,
    wallet: null,
    acknowledgement: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (
      ["--review", "--submit-sourcify", "--submit-etherscan"].includes(argument)
    ) {
      assert(options.mode === "verify", "Choose one source helper mode");
      options.mode = argument.slice(2);
      continue;
    }
    if (argument === "--write") {
      options.write = true;
      continue;
    }
    const separator = argument.indexOf("=");
    const key = separator === -1 ? argument : argument.slice(0, separator);
    const inline = separator === -1 ? null : argument.slice(separator + 1);
    if (
      ![
        "--plan",
        "--receipt-evidence",
        "--finality-evidence",
        "--output",
        "--wallet",
        "--acknowledge-evidence-digest",
      ].includes(key)
    ) {
      fail(`Unknown argument: ${key}`);
    }
    const value = inline ?? argv[++index];
    if (!value || value.startsWith("--")) fail(`Missing value for ${key}`);
    if (key === "--plan") options.plan = value;
    if (key === "--receipt-evidence") options.receiptEvidence = value;
    if (key === "--finality-evidence") options.finalityEvidence = value;
    if (key === "--output") options.output = value;
    if (key === "--wallet") options.wallet = value;
    if (key === "--acknowledge-evidence-digest")
      options.acknowledgement = value;
  }
  for (const [label, value] of [
    ["plan", options.plan],
    ["receipt-evidence", options.receiptEvidence],
    ["finality-evidence", options.finalityEvidence],
  ]) {
    if (!value || !path.isAbsolute(value))
      fail(`--${label} must be an absolute path`);
  }
  if (options.mode !== "verify" && options.write) {
    fail("--write is only valid in source verification mode");
  }
  return options;
}

async function readJson(file, label) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    fail(`Unable to read ${label}: ${error.message}`);
  }
}

async function writeAcknowledgedEvidence(evidence, options) {
  if (!options.output || !path.isAbsolute(options.output)) {
    fail("--write requires an absolute --output path");
  }
  if (
    !options.wallet ||
    canonicalAddress(options.wallet, "wallet") !==
      canonicalAddress(CLASSIC_V4_LAUNCHER_UPGRADE_DEPLOYER)
  ) {
    fail("--write requires the explicit dev wallet");
  }
  if (
    normalizeHex(options.acknowledgement) !==
    normalizeHex(evidence.evidenceDigest)
  ) {
    fail(
      "--write requires --acknowledge-evidence-digest from a fresh verification run",
    );
  }
  const output = path.resolve(options.output);
  const relative = path.relative(repositoryRoot, output);
  if (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  ) {
    fail("Source evidence must be written outside the source repository");
  }
  const parent = path.dirname(output);
  const [realParent, parentStats] = await Promise.all([
    realpath(parent),
    stat(parent),
  ]);
  if (!parentStats.isDirectory() || realParent !== parent) {
    fail("Source evidence output parent must be an existing real directory");
  }
  await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
}

function submitSources({ verifier, plan }) {
  const argumentsList = [
    "verify-contract",
    "--watch",
    "--chain",
    "1",
    "--compiler-version",
    "0.8.26",
    "--num-of-optimizations",
    "1000",
    "--evm-version",
    "cancun",
    "--verifier",
    verifier,
    "--constructor-args",
    plan.constructorArguments,
  ];
  const environment = { ...process.env };
  if (verifier === "etherscan") {
    const key = environment.ETHERSCAN_API_KEY?.trim();
    assert(key, "ETHERSCAN_API_KEY is required for Etherscan submission");
    argumentsList.push("--etherscan-api-key", key);
  } else {
    delete environment.ETHERSCAN_API_KEY;
  }
  argumentsList.push(
    plan.predictedAddress,
    CLASSIC_V4_LAUNCHER_UPGRADE_SOURCE_TARGET.fqcn,
  );
  const result = spawnSync("forge", argumentsList, {
    cwd: contractsRoot,
    env: environment,
    encoding: "utf8",
    stdio: "inherit",
  });
  assert(result.status === 0, `MemeLaunchV4 ${verifier} submission failed`);
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  const [plan, receiptEvidence, finalityEvidence] = await Promise.all([
    readJson(options.plan, "launcher upgrade plan"),
    readJson(options.receiptEvidence, "launcher receipt evidence"),
    readJson(options.finalityEvidence, "launcher finality evidence"),
  ]);
  const artifact = await loadClassicV4LauncherUpgradeSealedBuild(plan);
  validateClassicV4LauncherFinalityEvidence({
    plan,
    receiptEvidence,
    finalityEvidence,
  });
  const build = computeClassicV4LauncherUpgradeBuildCommitments(artifact);
  if (options.mode === "review") {
    process.stdout.write(
      `${JSON.stringify(
        {
          mode: "review-only",
          externalAction: false,
          chainId: 1,
          address: plan.predictedAddress,
          fqcn: CLASSIC_V4_LAUNCHER_UPGRADE_SOURCE_TARGET.fqcn,
          planDigest: plan.planDigest,
          receiptEvidenceDigest: receiptEvidence.evidenceDigest,
          finalityEvidenceDigest: finalityEvidence.evidenceDigest,
          sourceCommitment: plan.sourceCommitment,
          sourceClosureDigest: build.sourceClosureDigest,
          sourceCount: build.sourceCount,
          next: ["--submit-sourcify", "--submit-etherscan", "verify"],
        },
        null,
        2,
      )}\n`,
    );
    return;
  }
  if (
    options.mode === "submit-sourcify" ||
    options.mode === "submit-etherscan"
  ) {
    submitSources({
      verifier: options.mode === "submit-sourcify" ? "sourcify" : "etherscan",
      plan,
    });
    return;
  }
  const evidence = await verifyClassicV4LauncherSourceProviders({
    plan,
    receiptEvidence,
    finalityEvidence,
    artifact,
  });
  if (options.write) await writeAcknowledgedEvidence(evidence, options);
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
}

if (process.argv[1] === scriptPath) {
  main().catch((error) => {
    process.stderr.write(
      `Classic V4 launcher source verification failed: ${error.message}\n`,
    );
    process.exitCode = 1;
  });
}
