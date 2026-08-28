#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as classicV4ReleaseModule from "../../lib/classic-v4-release.ts";
import {
  buildClassicV4ActivationPlan,
  buildClassicV4CatalogReleaseArtifact,
  renderClassicV4IndexerSources,
} from "./activate-classic-v4.mjs";
import {
  LIVE_ENVIO_SURFACE_REFERENCE,
  endpointIdFromUrl,
  parseCandidateIdentity,
  releaseBindingDigest,
} from "./release-candidate.mjs";

const { parseClassicV4PendingRelease } =
  classicV4ReleaseModule.default ?? classicV4ReleaseModule;

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptPath), "..", "..");
const canonicalManifestPath = path.join(
  repositoryRoot,
  "contracts/deployments/mainnet-classic-v4.json",
);
const baseReleaseBindingPath = path.join(
  repositoryRoot,
  "config/data-pipeline-release.v1.json",
);
const releaseMapPath = path.join(
  repositoryRoot,
  "indexer/src/lib/release-map.ts",
);
const envioConfigPath = path.join(repositoryRoot, "indexer/config.yaml");

function fail(message) {
  throw new Error(message);
}

function parseArguments(argv) {
  const options = {
    manifest: canonicalManifestPath,
    identity: null,
    endpoint: null,
    output: null,
  };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") continue;
    const [key, inlineValue] = argument.split("=", 2);
    if (!["--manifest", "--identity", "--endpoint", "--output"].includes(key)) {
      fail(`Unknown argument: ${argument}`);
    }
    if (seen.has(key)) fail(`Duplicate argument: ${key}`);
    seen.add(key);
    const value = inlineValue ?? argv[++index];
    if (!value || value.startsWith("--")) fail(`Missing value for ${key}`);
    if (key === "--manifest") options.manifest = path.resolve(value);
    if (key === "--identity") options.identity = path.resolve(value);
    if (key === "--endpoint") options.endpoint = value;
    if (key === "--output") options.output = path.resolve(value);
  }
  if (!options.identity) fail("--identity is required");
  if (!options.endpoint) fail("--endpoint is required");
  return options;
}

async function readJson(filename, label) {
  let source;
  try {
    source = await readFile(filename, "utf8");
  } catch (error) {
    fail(`${label} is unavailable: ${error.message}`);
  }
  try {
    return JSON.parse(source);
  } catch {
    fail(`${label} is not valid JSON`);
  }
}

export function buildClassicV4ExpandedReleaseBinding(
  plan,
  baseBinding,
  candidateIdentityInput,
  graphqlEndpoint,
) {
  const expectedSourceContracts = [
    "ClassicV3RewardVaultFactory",
    "ClassicV3VestingWalletFactory",
    "ClassicV4Hook",
    "ClassicV4Launcher",
  ];
  if (
    plan?.schemaVersion !== 1 ||
    plan?.chainId !== 1 ||
    plan?.model !== "classic" ||
    plan?.releaseVersion !== "classic-v4" ||
    !Array.isArray(plan.sources) ||
    plan.sources.length !== 2 ||
    plan.sources[0]?.contractName !== "ClassicV4Hook" ||
    plan.sources[1]?.contractName !== "ClassicV4Launcher" ||
    plan.dataPipelineReleaseFragment?.model !== "classic" ||
    plan.dataPipelineReleaseFragment?.releaseVersion !== "classic-v4" ||
    plan.dataPipelineReleaseFragment?.activationBlock !==
      plan.activationBlock ||
    JSON.stringify(plan.dataPipelineReleaseFragment?.sourceContracts) !==
      JSON.stringify(expectedSourceContracts) ||
    JSON.stringify(plan.dataPipelineReleaseFragment?.dynamicContracts) !==
      JSON.stringify(["ClassicV3RewardVault"])
  ) {
    fail("Classic V4 release-binding plan is invalid");
  }
  if (
    !Array.isArray(baseBinding?.sources) ||
    !Array.isArray(baseBinding?.releases) ||
    baseBinding.sources.some(({ contractName }) =>
      ["ClassicV4Hook", "ClassicV4Launcher"].includes(contractName),
    ) ||
    baseBinding.releases.some(
      ({ model, releaseVersion }) =>
        model === "classic" && releaseVersion === "classic-v4",
    )
  ) {
    fail("Base data pipeline binding already contains Classic V4");
  }
  if (
    baseBinding.envio?.deploymentLabel !==
      LIVE_ENVIO_SURFACE_REFERENCE.deployment ||
    baseBinding.envio?.sourceCommit !== LIVE_ENVIO_SURFACE_REFERENCE.sourceCommit ||
    baseBinding.envio?.configSha256 !==
      LIVE_ENVIO_SURFACE_REFERENCE.configSha256 ||
    baseBinding.envio?.eventSetSha256 !==
      LIVE_ENVIO_SURFACE_REFERENCE.eventSetSha256 ||
    baseBinding.envio?.eventCount !== LIVE_ENVIO_SURFACE_REFERENCE.eventCount
  ) {
    fail("Base data pipeline binding is not the frozen live Envio surface");
  }
  const candidateIdentity = parseCandidateIdentity(candidateIdentityInput);
  endpointIdFromUrl(graphqlEndpoint);
  const releaseBinding = {
    schemaVersion: baseBinding.schemaVersion,
    chainId: baseBinding.chainId,
    startBlock: baseBinding.startBlock,
    confirmations: baseBinding.confirmations,
    envio: {
      deploymentLabel: candidateIdentity.deployment,
      graphqlEndpoint,
      schemaVersion: "1",
      sourceCommit: candidateIdentity.sourceCommit,
      configSha256: candidateIdentity.configSha256,
      schemaSha256: candidateIdentity.schemaSha256,
      handlerSha256: candidateIdentity.handlerSha256,
      sourceRegistrySha256: candidateIdentity.sourceRegistrySha256,
      eventSetSha256: candidateIdentity.eventSetSha256,
      eventCount: candidateIdentity.eventCount,
    },
    uniswapV4Subgraph: structuredClone(baseBinding.uniswapV4Subgraph),
    sources: [
      ...structuredClone(baseBinding.sources),
      ...structuredClone(plan.sources),
    ],
    releases: [
      ...structuredClone(baseBinding.releases),
      structuredClone(plan.dataPipelineReleaseFragment),
    ],
  };
  const digest = releaseBindingDigest(releaseBinding);
  buildClassicV4CatalogReleaseArtifact(
    { ...plan, indexerBindingDigest: digest },
    baseBinding,
    releaseBinding,
  );
  return Object.freeze(releaseBinding);
}

export function assertClassicV4IndexerSourceBindings(plan, current) {
  const expected = renderClassicV4IndexerSources(plan, current);
  if (
    expected.releaseMap !== current.releaseMap ||
    expected.envioConfig !== current.envioConfig
  ) {
    fail(
      "Checked-out Classic V4 Envio sources do not match the finalized release manifest",
    );
  }
}

export async function writeClassicV4ReleaseBinding(filename, releaseBinding) {
  await writeFile(filename, `${JSON.stringify(releaseBinding, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
    flush: true,
  });
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  const [manifestInput, candidateIdentity, baseBinding, releaseMap, envioConfig] =
    await Promise.all([
      readJson(options.manifest, "Classic V4 release manifest"),
      readJson(options.identity, "Envio candidate identity"),
      readJson(baseReleaseBindingPath, "base data pipeline release binding"),
      readFile(releaseMapPath, "utf8"),
      readFile(envioConfigPath, "utf8"),
    ]);
  const manifest = parseClassicV4PendingRelease(manifestInput);
  if (!manifest) {
    fail(
      "Classic V4 manifest failed the complete finalized source and lifecycle parser",
    );
  }
  const provisionalPlan = buildClassicV4ActivationPlan(
    manifest,
    baseBinding,
    releaseBindingDigest(baseBinding),
  );
  assertClassicV4IndexerSourceBindings(provisionalPlan, {
    releaseMap,
    envioConfig,
  });
  const releaseBinding = buildClassicV4ExpandedReleaseBinding(
    provisionalPlan,
    baseBinding,
    candidateIdentity,
    options.endpoint,
  );
  const digest = releaseBindingDigest(releaseBinding);
  const finalPlan = buildClassicV4ActivationPlan(manifest, baseBinding, digest);
  assertClassicV4IndexerSourceBindings(finalPlan, {
    releaseMap,
    envioConfig,
  });
  buildClassicV4CatalogReleaseArtifact(
    finalPlan,
    baseBinding,
    releaseBinding,
  );

  const output = `${JSON.stringify(releaseBinding, null, 2)}\n`;
  if (options.output) {
    await writeClassicV4ReleaseBinding(options.output, releaseBinding);
    process.stdout.write(
      `${JSON.stringify({ output: options.output, releaseBindingDigest: digest }, null, 2)}\n`,
    );
    return;
  }
  process.stdout.write(output);
}

if (path.resolve(process.argv[1] ?? "") === scriptPath) {
  main().catch((error) => {
    process.stderr.write(
      `Classic V4 release binding: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
