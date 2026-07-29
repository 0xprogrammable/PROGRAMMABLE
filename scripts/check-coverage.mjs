#!/usr/bin/env node

import fs from "node:fs";
import process from "node:process";

const reportPath = process.argv[2] ?? "lcov.info";
const minimum = {
  lines: 85,
  functions: 80,
  branches: 25
};

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

  add("lines", "LF", "LH");
  add("functions", "FNF", "FNH");
  add("branches", "BRF", "BRH");

  function add(category, foundKey, hitKey) {
    totals[category].found += Number(record.match(new RegExp(`^${foundKey}:(\\d+)$`, "m"))?.[1] ?? 0);
    totals[category].hit += Number(record.match(new RegExp(`^${hitKey}:(\\d+)$`, "m"))?.[1] ?? 0);
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
