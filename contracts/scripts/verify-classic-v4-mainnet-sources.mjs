#!/usr/bin/env node

import { readFile, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { keccak256, stringToHex } from "viem";

import {
  CLASSIC_V4_DIGEST_DOMAINS,
  CLASSIC_V4_NEW_CONTRACTS,
  CLASSIC_V4_SOURCE_TARGETS,
  canonicalAddress,
  digestJson,
  validateClassicV4DeploymentEvidence,
  validateClassicV4PreparationPlan,
  validateClassicV4SourceEvidence,
} from "../../scripts/classic-v4-release-core.mjs";
import { loadClassicV4SealedBuild } from "./prepare-classic-v4-mainnet-release.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptPath), "..", "..");
const REQUEST_TIMEOUT_MS = 20_000;

function fail(message) {
  throw new Error(message);
}

function parseArguments(argv) {
  const forbidden = argv.find(
    (argument) =>
      argument === "--submit" ||
      argument === "--broadcast" ||
      argument === "--private-key" ||
      argument.startsWith("--private-key=") ||
      argument === "--mnemonic" ||
      argument.startsWith("--mnemonic="),
  );
  if (forbidden) {
    fail(
      `${forbidden.split("=", 1)[0]} is forbidden; source verification is read-only`,
    );
  }
  const parsed = {
    plan: null,
    deploymentEvidence: null,
    write: false,
    output: null,
    wallet: null,
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
    const known = ["--plan", "--deployment-evidence", "--output", "--wallet"];
    if (!known.includes(key)) fail(`Unknown argument: ${key}`);
    const value = inlineValue ?? argv[++index];
    if (!value || value.startsWith("--")) fail(`Missing value for ${key}`);
    if (key === "--plan") parsed.plan = value;
    if (key === "--deployment-evidence") parsed.deploymentEvidence = value;
    if (key === "--output") parsed.output = value;
    if (key === "--wallet") parsed.wallet = value;
  }
  for (const key of ["plan", "deploymentEvidence"]) {
    if (!parsed[key] || !path.isAbsolute(parsed[key])) {
      fail(`${key} must be an absolute path`);
    }
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

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok)
    fail(`${url.origin}${url.pathname} returned HTTP ${response.status}`);
  return response.json();
}

function artifactCompilerSettings(artifact, field) {
  let metadata;
  try {
    metadata =
      typeof artifact.metadata === "string"
        ? JSON.parse(artifact.metadata)
        : artifact.metadata;
  } catch {
    fail(`${field} artifact metadata is unavailable`);
  }
  return {
    compilerVersion: `v${metadata.compiler.version}`,
    optimizationUsed: metadata.settings.optimizer.enabled ? "1" : "0",
    optimizerRuns: String(metadata.settings.optimizer.runs),
    evmVersion: metadata.settings.evmVersion,
    materialSettings: materialCompilerSettings(metadata.settings),
  };
}

export function materialCompilerSettings(settings) {
  return {
    remappings: settings?.remappings ?? [],
    optimizer: settings?.optimizer,
    evmVersion: settings?.evmVersion,
    viaIR: settings?.viaIR ?? false,
    metadata: settings?.metadata,
    libraries: settings?.libraries ?? {},
    debug: settings?.debug ?? {},
    compilationTarget: settings?.compilationTarget ?? {},
  };
}

function canonicalJson(value) {
  return JSON.stringify(value, (_, item) => {
    if (item === null || Array.isArray(item) || typeof item !== "object") {
      return item;
    }
    return Object.fromEntries(
      Object.entries(item).sort(([left], [right]) => left.localeCompare(right)),
    );
  });
}

function artifactSourceClosure(artifact, label) {
  let metadata;
  try {
    metadata =
      typeof artifact.metadata === "string"
        ? JSON.parse(artifact.metadata)
        : artifact.metadata;
  } catch {
    fail(`${label} artifact metadata is unavailable`);
  }
  if (!metadata?.sources || typeof metadata.sources !== "object") {
    fail(`${label} artifact source closure is unavailable`);
  }
  return metadata.sources;
}

function assertExactProviderSourceClosure(remoteSources, artifact, label) {
  const expectedSources = artifactSourceClosure(artifact, label);
  const actualPaths = Object.keys(remoteSources ?? {}).sort();
  const expectedPaths = Object.keys(expectedSources).sort();
  if (
    actualPaths.length !== expectedPaths.length ||
    !actualPaths.every((sourcePath, index) => sourcePath === expectedPaths[index])
  ) {
    fail(`${label} source path closure differs`);
  }
  for (const sourcePath of expectedPaths) {
    const content = remoteSources[sourcePath]?.content;
    if (
      typeof content !== "string" ||
      keccak256(stringToHex(content)) !==
        expectedSources[sourcePath]?.keccak256?.toLowerCase()
    ) {
      fail(`${label} source bytes differ at ${sourcePath}`);
    }
  }
}

function etherscanStandardJsonInput(sourceCode, label) {
  if (typeof sourceCode !== "string" || sourceCode.trim() === "") {
    fail(`${label} Etherscan source is unavailable`);
  }
  let encoded = sourceCode.trim();
  if (encoded.startsWith("{{") && encoded.endsWith("}}")) {
    encoded = encoded.slice(1, -1);
  }
  let input;
  try {
    input = JSON.parse(encoded);
  } catch {
    fail(`${label} Etherscan source is not Standard JSON`);
  }
  if (
    input?.language !== "Solidity" ||
    !input.sources ||
    typeof input.sources !== "object"
  ) {
    fail(`${label} Etherscan Standard JSON is invalid`);
  }
  return input;
}

export async function captureSourcify(address, artifact, fetchJsonClient) {
  const providerUrl = new URL(
    `https://sourcify.dev/server/v2/contract/1/${address}`,
  );
  const lookupUrl = new URL(providerUrl);
  lookupUrl.searchParams.set("fields", "sources");
  const payload = await fetchJsonClient(lookupUrl);
  const status = assertSourcifyMatch(payload, address, artifact);
  return {
    name: "Sourcify",
    status,
    url: providerUrl.toString(),
  };
}

export function assertSourcifyMatch(payload, address, artifact) {
  let providerAddress;
  try {
    providerAddress = canonicalAddress(payload?.address, "Sourcify address");
  } catch {
    fail(`${address} Sourcify identity differs`);
  }
  if (
    payload?.chainId !== "1" ||
    providerAddress.toLowerCase() !==
      canonicalAddress(address, "requested Sourcify address").toLowerCase()
  ) {
    fail(`${address} Sourcify identity differs`);
  }
  const matchFields = [
    payload?.match,
    payload?.creationMatch,
    payload?.runtimeMatch,
  ];
  if (
    !matchFields.every(
      (status) => status === "match" || status === "exact_match",
    )
  ) {
    fail(`${address} is not a complete Sourcify match`);
  }
  assertExactProviderSourceClosure(
    payload.sources,
    artifact,
    `${address} Sourcify`,
  );
  return matchFields.every((status) => status === "exact_match")
    ? "exact-match"
    : "match";
}

export async function captureEtherscan(
  address,
  target,
  constructorArguments,
  artifact,
  fetchJsonClient,
  etherscanApiKey,
) {
  if (!etherscanApiKey) return null;
  const settings = artifactCompilerSettings(artifact, target.contractName);
  const query = new URL("https://api.etherscan.io/v2/api");
  query.searchParams.set("chainid", "1");
  query.searchParams.set("module", "contract");
  query.searchParams.set("action", "getsourcecode");
  query.searchParams.set("address", address);
  query.searchParams.set("apikey", etherscanApiKey);
  const payload = await fetchJsonClient(query);
  const source = payload?.result?.[0];
  assertExactEtherscanMatch(
    payload,
    source,
    target,
    constructorArguments,
    settings,
    artifact,
  );
  return {
    name: "Etherscan",
    status: "exact-match",
    url: `https://etherscan.io/address/${address}#code`,
  };
}

export function assertExactEtherscanMatch(
  payload,
  source,
  target,
  constructorArguments,
  settings,
  artifact,
) {
  const [contractFileName] = target.fqcn.split(":", 1);
  const standardJsonInput = etherscanStandardJsonInput(
    source?.SourceCode,
    target.contractName,
  );
  const metadata =
    typeof artifact.metadata === "string"
      ? JSON.parse(artifact.metadata)
      : artifact.metadata;
  const expectedMaterialSettings =
    settings.materialSettings ?? materialCompilerSettings(metadata?.settings);
  if (
    payload?.status !== "1" ||
    source?.ContractName !== target.contractName ||
    source?.ContractFileName !== contractFileName ||
    source?.CompilerType !== "solc" ||
    source?.CompilerVersion !== settings.compilerVersion ||
    source?.OptimizationUsed !== settings.optimizationUsed ||
    source?.Runs !== settings.optimizerRuns ||
    source?.EVMVersion !== settings.evmVersion ||
    source?.Proxy !== "0" ||
    source?.Implementation !== "" ||
    source?.SimilarMatch !== "" ||
    (source?.ConstructorArguments ?? "").toLowerCase() !==
      constructorArguments.slice(2).toLowerCase() ||
    typeof source?.SourceCode !== "string" ||
    source.SourceCode.length === 0 ||
    canonicalJson(materialCompilerSettings(standardJsonInput.settings)) !==
      canonicalJson(expectedMaterialSettings)
  ) {
    fail(`${target.contractName} Etherscan metadata differs`);
  }
  assertExactProviderSourceClosure(
    standardJsonInput.sources,
    artifact,
    `${target.contractName} Etherscan`,
  );
}

async function writeEvidence(evidence, plan, options) {
  if (!options.output || !path.isAbsolute(options.output)) {
    fail("--write requires an absolute --output path");
  }
  if (
    !options.wallet ||
    canonicalAddress(options.wallet, "wallet") !==
      canonicalAddress(plan.deployer)
  ) {
    fail("--write requires the explicit human wallet matching the deployer");
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
  if (!parentStats.isDirectory() || realParent !== parent)
    fail("Invalid output parent");
  await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  const [plan, deploymentEvidence] = await Promise.all([
    readJson(options.plan, "preparation plan"),
    readJson(options.deploymentEvidence, "deployment evidence"),
  ]);
  const artifacts = await loadClassicV4SealedBuild(plan);
  const evidence = await verifyClassicV4SourceProviders({
    plan,
    deploymentEvidence,
    artifacts,
  });
  if (options.write) await writeEvidence(evidence, plan, options);
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
}

export async function verifyClassicV4SourceProviders({
  plan,
  deploymentEvidence,
  artifacts,
  checkedAt = new Date().toISOString(),
  fetchJsonClient = fetchJson,
  etherscanApiKey = process.env.ETHERSCAN_API_KEY?.trim() || null,
}) {
  validateClassicV4PreparationPlan(plan, artifacts);
  validateClassicV4DeploymentEvidence(plan, deploymentEvidence);
  const contracts = {};
  for (const name of CLASSIC_V4_NEW_CONTRACTS) {
    const target = CLASSIC_V4_SOURCE_TARGETS[name];
    const deployed = deploymentEvidence.contracts[name];
    const providers = (
      await Promise.all([
        captureSourcify(deployed.address, artifacts[name], fetchJsonClient),
        captureEtherscan(
          deployed.address,
          target,
          plan.constructorArguments[name],
          artifacts[name],
          fetchJsonClient,
          etherscanApiKey,
        ),
      ])
    ).filter(Boolean);
    const status = providers.every(
      (provider) => provider.status === "exact-match",
    )
      ? "exact-match"
      : "match";
    contracts[name] = {
      address: deployed.address,
      contractName: target.contractName,
      fqcn: target.fqcn,
      encodedConstructorArguments: plan.constructorArguments[name],
      deploymentTransaction: deployed.transactionHash,
      deploymentBlock: deployed.blockNumber,
      status,
      providers,
    };
  }
  const unsignedEvidence = {
    schemaVersion: 1,
    chainId: 1,
    planDigest: plan.planDigest,
    sourceCommitment: plan.sourceCommitment,
    status: "verified",
    checkedAt,
    contracts,
  };
  const evidence = {
    ...unsignedEvidence,
    evidenceDigest: digestJson(
      unsignedEvidence,
      CLASSIC_V4_DIGEST_DOMAINS.sourceEvidence,
    ),
  };
  validateClassicV4SourceEvidence(plan, deploymentEvidence, evidence);
  return evidence;
}

if (process.argv[1] === scriptPath) {
  main().catch((error) => {
    process.stderr.write(
      `Classic V4 source verification failed: ${error.message}\n`,
    );
    process.exitCode = 1;
  });
}
