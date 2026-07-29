#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  STOCK_PAIRED_V2_MANIFEST_PATH,
  loadStockPairedV2ReleasePlan,
} from "../../scripts/stock-paired-v2-mainnet-operator-core.mjs";
import {
  STOCK_PAIRED_V2_COMPILER_VERSION,
  assertStockPairedV2DependencyTree,
  assertStockPairedV2ReleaseSnapshot,
  assertStockPairedV2StandardJson,
  stockPairedV2ForgeArguments,
  stockPairedV2PublicLifecycleVerified,
  stockPairedV2SourceRecords,
  stockPairedV2SourceVerificationComplete,
  stockPairedV2VerificationEnvironment,
} from "./stock-paired-v2-source-verification-core.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const contractsRoot = path.join(root, "contracts");
const manifestPath = path.join(root, STOCK_PAIRED_V2_MANIFEST_PATH);
const evidencePath = path.resolve(
  process.env.STOCK_PAIRED_V2_RELEASE_EVIDENCE_PATH ??
    path.join(root, "tmp/stock-paired-v2-mainnet-release-evidence.json"),
);
const submit = process.argv.includes("--submit");
const capture = process.argv.includes("--capture");
const captureSourcifyOnly = process.argv.includes("--capture-sourcify-only");
const write = process.argv.includes("--write");
const REQUEST_TIMEOUT_MS = 15_000;
const verificationEnvironment =
  stockPairedV2VerificationEnvironment(contractsRoot);

function parseEtherscanSource(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Etherscan returned no source");
  }
  const trimmed = value.trim();
  if (trimmed.startsWith("{{") && trimmed.endsWith("}}")) {
    return JSON.parse(trimmed.slice(1, -1));
  }
  if (trimmed.startsWith("{")) {
    const parsed = JSON.parse(trimmed);
    if (parsed.language && parsed.sources) return parsed;
  }
  throw new Error("Etherscan did not return standard-json source");
}

function standardJson(record) {
  const output = execFileSync(
    "forge",
    [
      "verify-contract",
      "--show-standard-json-input",
      record.address,
      record.fqcn,
    ],
    {
      cwd: contractsRoot,
      encoding: "utf8",
      env: verificationEnvironment,
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  return assertStockPairedV2StandardJson(record, JSON.parse(output));
}

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalJson);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalJson(entry)]),
    );
  }
  return value;
}

function compilationSettings(settings) {
  const compilation = { ...settings };
  delete compilation.outputSelection;
  if (
    compilation.libraries &&
    Object.keys(compilation.libraries).length === 0
  ) {
    delete compilation.libraries;
  }
  return canonicalJson(compilation);
}

export function assertStockPairedV2SourceInput(
  record,
  localInput,
  remoteValue,
) {
  const remoteInput = assertStockPairedV2StandardJson(
    record,
    parseEtherscanSource(remoteValue),
  );
  if (
    JSON.stringify(compilationSettings(remoteInput.settings)) !==
    JSON.stringify(compilationSettings(localInput.settings))
  ) {
    throw new Error(`${record.field} compiler input settings differ`);
  }
  for (const [sourcePath, source] of Object.entries(localInput.sources)) {
    if (remoteInput.sources[sourcePath]?.content !== source.content) {
      throw new Error(`${record.field} source differs at ${sourcePath}`);
    }
  }
}

async function etherscanRecord(record, localInput) {
  const key = process.env.ETHERSCAN_API_KEY?.trim();
  if (!key) {
    throw new Error("ETHERSCAN_API_KEY is required for source capture");
  }
  const query = new URL("https://api.etherscan.io/v2/api");
  query.searchParams.set("chainid", "1");
  query.searchParams.set("module", "contract");
  query.searchParams.set("action", "getsourcecode");
  query.searchParams.set("address", record.address);
  query.searchParams.set("apikey", key);
  const response = await fetch(query, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Etherscan returned HTTP ${response.status}`);
  }
  const payload = await response.json();
  const source = payload?.result?.[0];
  if (
    payload?.status !== "1" ||
    source?.ContractName !== record.contractName ||
    source?.CompilerVersion !== STOCK_PAIRED_V2_COMPILER_VERSION ||
    source?.OptimizationUsed !== "1" ||
    source?.Runs !== "1000" ||
    source?.EVMVersion !== "cancun" ||
    source?.Proxy !== "0" ||
    source?.Implementation !== "" ||
    (source?.ConstructorArguments ?? "").toLowerCase() !==
      record.encodedConstructorArguments.slice(2).toLowerCase()
  ) {
    throw new Error(`${record.field} Etherscan metadata does not match`);
  }
  assertStockPairedV2SourceInput(record, localInput, source.SourceCode);
  return {
    status: "exact-match",
    url: `https://etherscan.io/address/${record.address}#code`,
  };
}

async function sourcifyRecord(record) {
  const url = `https://sourcify.dev/server/v2/contract/1/${record.address}`;
  const response = await fetch(url, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(
      `${record.field} Sourcify returned HTTP ${response.status}`,
    );
  }
  const payload = await response.json();
  if (
    payload?.match !== "match" ||
    payload?.creationMatch !== "match" ||
    payload?.runtimeMatch !== "match"
  ) {
    throw new Error(`${record.field} is not an exact Sourcify match`);
  }
  return {
    status: "match",
    creationMatch: payload.creationMatch,
    runtimeMatch: payload.runtimeMatch,
    verifiedAt: payload.verifiedAt ?? null,
    url,
  };
}

async function writeJsonAtomic(file, value) {
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, file);
}

function requireCapturedDeployment(manifest, plan, releaseCommit) {
  if (
    manifest.releaseCommit !== releaseCommit ||
    manifest.sourceCommitment !== plan.sourceCommitment ||
    !String(manifest.status ?? "").startsWith("deployed-") ||
    manifest.lifecycleEvidence?.deploymentTransactionsVerified !== true ||
    manifest.lifecycleEvidence?.runtimeBindingsVerified !== true ||
    manifest.lifecycleEvidence?.ethCoordinatorDeploymentVerified !== true
  ) {
    throw new Error(
      "Capture the finalized Stock-Paired V2 deployment before source submission or capture",
    );
  }
}

async function resolveRelease() {
  const [manifest, evidence] = await Promise.all([
    readFile(manifestPath, "utf8").then(JSON.parse),
    readFile(evidencePath, "utf8").then(JSON.parse),
  ]);
  const releaseCommit =
    process.env.STOCK_PAIRED_V2_RELEASE_COMMIT?.trim() ||
    manifest.releaseCommit ||
    evidence.releaseCommit;
  assertStockPairedV2ReleaseSnapshot(root, releaseCommit);
  const plan = await loadStockPairedV2ReleasePlan(root, {
    releaseCommit,
  });
  if (
    evidence.releaseCommit !== releaseCommit ||
    evidence.planDigest !== plan.planDigest ||
    evidence.sourceCommitment !== plan.sourceCommitment
  ) {
    throw new Error(
      "The Stock-Paired V2 verification inputs belong to different releases",
    );
  }
  return { manifest, plan, releaseCommit };
}

export function buildStockPairedV2SourceCapture(manifest, sourceVerification) {
  const sourceVerified =
    stockPairedV2SourceVerificationComplete(sourceVerification);
  const lifecycleVerified = stockPairedV2PublicLifecycleVerified(manifest);
  const releaseEligible = sourceVerified && lifecycleVerified;
  let status;
  if (releaseEligible) {
    status = "deployment-source-and-lifecycle-verified";
  } else if (sourceVerified) {
    status = "deployed-source-verified-public-canary-pending";
  } else if (lifecycleVerified) {
    status = "deployed-sourcify-and-lifecycle-verified-etherscan-pending";
  } else {
    status = "deployed-sourcify-verified-etherscan-and-public-canary-pending";
  }
  return {
    ...manifest,
    status,
    sourceVerification,
    lifecycleEvidence: {
      ...manifest.lifecycleEvidence,
      releaseEligible,
    },
  };
}

export function etherscanForSourcifyOnlyCapture(existingRecord) {
  return existingRecord?.etherscan?.status === "exact-match"
    ? existingRecord.etherscan
    : { status: "pending", url: null };
}

export async function main() {
  if ([submit, capture, captureSourcifyOnly].filter(Boolean).length > 1) {
    throw new Error(
      "Choose one of --submit, --capture, or --capture-sourcify-only",
    );
  }
  if (write && !capture && !captureSourcifyOnly) {
    throw new Error("--write requires --capture or --capture-sourcify-only");
  }

  const { manifest, plan, releaseCommit } = await resolveRelease();
  assertStockPairedV2DependencyTree(contractsRoot);
  const records = stockPairedV2SourceRecords(plan);
  const localInputs = new Map(
    records.map((record) => [record.field, standardJson(record)]),
  );

  if (submit || capture || captureSourcifyOnly) {
    requireCapturedDeployment(manifest, plan, releaseCommit);
  }

  if (submit) {
    for (const record of records) {
      for (const verifier of ["etherscan", "sourcify"]) {
        const result = spawnSync(
          "forge",
          stockPairedV2ForgeArguments(
            record,
            verifier,
            process.env.ETHERSCAN_API_KEY,
          ),
          {
            cwd: contractsRoot,
            encoding: "utf8",
            env: verificationEnvironment,
            stdio: "inherit",
          },
        );
        if (result.status !== 0) {
          throw new Error(
            `${record.field} ${verifier} verification submission failed`,
          );
        }
      }
    }
    console.log("All seven source-verification submissions completed.");
    return;
  }

  if (!capture && !captureSourcifyOnly) {
    console.log(
      JSON.stringify(
        {
          mode: "review",
          externalAction: false,
          releaseCommit,
          sourceCommitment: plan.sourceCommitment,
          contracts: records.map((record) => ({
            field: record.field,
            address: record.address,
            fqcn: record.fqcn,
            encodedConstructorArguments: record.encodedConstructorArguments,
            constructorArgumentBytes: record.constructorArgumentBytes,
            constructorArgumentHash: record.constructorArgumentHash,
            sourceCount: localInputs.get(record.field).sources
              ? Object.keys(localInputs.get(record.field).sources).length
              : 0,
          })),
          next: "Capture the finalized deployment manifest, then use --submit only with explicit approval.",
        },
        null,
        2,
      ),
    );
    return;
  }

  const sourceVerification = {};
  for (const record of records) {
    const sourcify = await sourcifyRecord(record);
    const etherscan = captureSourcifyOnly
      ? etherscanForSourcifyOnlyCapture(
          manifest.sourceVerification?.[record.field],
        )
      : await etherscanRecord(record, localInputs.get(record.field));
    const fullyVerified = etherscan.status === "exact-match";
    sourceVerification[record.field] = {
      status: fullyVerified ? "verified" : "sourcify-verified",
      fqcn: record.fqcn,
      encodedConstructorArguments: record.encodedConstructorArguments,
      constructorArgumentHash: record.constructorArgumentHash,
      etherscan,
      sourcify,
    };
  }
  sourceVerification.status = records.every(
    (record) => sourceVerification[record.field].status === "verified",
  )
    ? "verified"
    : "sourcify-verified-etherscan-pending";

  const updated = buildStockPairedV2SourceCapture(manifest, sourceVerification);
  const releaseEligible = updated.lifecycleEvidence.releaseEligible;
  if (write) {
    await writeJsonAtomic(manifestPath, updated);
  }
  console.log(
    JSON.stringify(
      {
        mode: write ? "write" : "dry-run",
        externalAction: false,
        releaseCommit,
        sourceVerification,
        releaseEligible,
        status: updated.status,
        nextGate: releaseEligible
          ? null
          : captureSourcifyOnly
            ? "Complete and independently capture the public Mainnet canary lifecycle; Etherscan exact-match capture remains pending."
            : "Complete and independently capture the public Mainnet canary lifecycle.",
      },
      null,
      2,
    ),
  );
  if (!write) {
    console.error("Dry run only. Add --write after reviewing the evidence.");
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error?.stack ?? error);
    process.exitCode = 1;
  });
}
