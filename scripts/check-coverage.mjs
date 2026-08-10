#!/usr/bin/env node

import fs from "node:fs";
import crypto from "node:crypto";
import process from "node:process";

const reportPath = process.argv[2] ?? "lcov.info";
const exceptionManifestPath = process.argv[3];
const inputsOnly = process.argv.includes("--inputs-only");
const minimum = {
  lines: 85,
  functions: 80,
  branches: 25
};

const exceptionManifest = exceptionManifestPath
  ? JSON.parse(fs.readFileSync(exceptionManifestPath, "utf8"))
  : { schemaVersion: 1, sourceExceptions: [], requiredTests: [] };

if (
  exceptionManifest.schemaVersion !== 1 ||
  !Array.isArray(exceptionManifest.sourceExceptions) ||
  !Array.isArray(exceptionManifest.requiredTests) ||
  (exceptionManifestPath &&
    (exceptionManifest.sourceExceptions.length === 0 || exceptionManifest.requiredTests.length === 0))
) {
  throw new Error("invalid coverage exception manifest");
}

const exceptionPaths = new Map();
for (const entry of [...exceptionManifest.sourceExceptions, ...exceptionManifest.requiredTests]) {
  if (
    !entry ||
    typeof entry.path !== "string" ||
    !/^(src|test)\/[A-Za-z0-9_./-]+\.sol$/.test(entry.path) ||
    typeof entry.sha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(entry.sha256)
  ) {
    throw new Error("invalid coverage exception entry");
  }
  if (exceptionPaths.has(entry.path)) {
    throw new Error(`duplicate coverage exception path: ${entry.path}`);
  }

  const actualSha256 = crypto.createHash("sha256").update(fs.readFileSync(entry.path)).digest("hex");
  if (actualSha256 !== entry.sha256) {
    throw new Error(`coverage exception input changed: ${entry.path}`);
  }
  exceptionPaths.set(entry.path, entry);
}

if (inputsOnly) {
  console.log(`coverage exception inputs verified: ${exceptionPaths.size}`);
  process.exit(0);
}

const sourceExceptions = new Map(exceptionManifest.sourceExceptions.map((entry) => [entry.path, entry]));
const observedSourceExceptions = new Set();

const report = fs.readFileSync(reportPath, "utf8");
const totals = {
  lines: { found: 0, hit: 0 },
  functions: { found: 0, hit: 0 },
  branches: { found: 0, hit: 0 }
};

for (const record of report.split("end_of_record")) {
  const source = record.match(/^SF:(.+)$/m)?.[1];
  const normalizedSource = source?.replaceAll("\\", "/");
  if (
    !normalizedSource ||
    (!normalizedSource.startsWith("src/") && !normalizedSource.includes("/src/"))
  ) {
    continue;
  }

  const repositorySource = normalizedSource.includes("/src/")
    ? `src/${normalizedSource.split("/src/").at(-1)}`
    : normalizedSource;
  if (sourceExceptions.has(repositorySource)) {
    const lineHits = Number(record.match(/^LH:(\d+)$/m)?.[1] ?? 0);
    const functionHits = Number(record.match(/^FNH:(\d+)$/m)?.[1] ?? 0);
    const branchHits = Number(record.match(/^BRH:(\d+)$/m)?.[1] ?? 0);
    if (lineHits !== 0 || functionHits !== 0 || branchHits !== 0) {
      throw new Error(`coverage exception is no longer a zero-map and must be retired: ${repositorySource}`);
    }
    observedSourceExceptions.add(repositorySource);
    console.log(`coverage source-map exception: ${repositorySource} (hash-bound exact fork tests required)`);
    continue;
  }

  add("lines", "LF", "LH");
  add("functions", "FNF", "FNH");
  add("branches", "BRF", "BRH");

  function add(category, foundKey, hitKey) {
    totals[category].found += Number(record.match(new RegExp(`^${foundKey}:(\\d+)$`, "m"))?.[1] ?? 0);
    totals[category].hit += Number(record.match(new RegExp(`^${hitKey}:(\\d+)$`, "m"))?.[1] ?? 0);
  }
}

for (const sourcePath of sourceExceptions.keys()) {
  if (!observedSourceExceptions.has(sourcePath)) {
    throw new Error(`coverage exception source missing from report: ${sourcePath}`);
  }
}

const failures = [];
for (const [category, values] of Object.entries(totals)) {
  if (values.found === 0) {
    failures.push(`${category}: report contains no source data`);
    continue;
  }

  const percentage = (values.hit / values.found) * 100;
  console.log(`${category}: ${percentage.toFixed(2)}% (${values.hit}/${values.found}), minimum ${minimum[category]}%`);
  if (percentage < minimum[category]) {
    failures.push(`${category}: ${percentage.toFixed(2)}% is below ${minimum[category]}%`);
  }
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}
