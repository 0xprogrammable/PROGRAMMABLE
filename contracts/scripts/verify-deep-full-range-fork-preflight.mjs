#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..", "..");
const contractsRoot = path.join(root, "contracts");
const quick = process.argv.includes("--quick");

function run(label, command, args, options = {}) {
  const startedAt = Date.now();
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    env: { ...process.env, ...options.env },
    encoding: "utf8",
    stdio: "pipe",
  });
  if (result.status !== 0) {
    process.stderr.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    throw new Error(`${label} failed with status ${result.status}`);
  }
  let testCount;
  if (options.expectedTests !== undefined) {
    const summary = result.stdout.match(
      /: ([0-9]+) tests passed, ([0-9]+) failed, [0-9]+ skipped \(([0-9]+) total tests\)/,
    );
    if (
      !summary ||
      Number(summary[1]) !== options.expectedTests ||
      Number(summary[2]) !== 0 ||
      Number(summary[3]) !== options.expectedTests
    ) {
      process.stderr.write(result.stdout ?? "");
      throw new Error(
        `${label} test count drifted from ${options.expectedTests}`,
      );
    }
    testCount = options.expectedTests;
  }
  return {
    label,
    command: [command, ...args].join(" "),
    durationMs: Date.now() - startedAt,
    status: "passed",
    ...(testCount === undefined ? {} : { testCount }),
  };
}

const checks = [
  run(
    "release manifest",
    process.execPath,
    [
      "contracts/scripts/verify-deep-full-range-release-manifest.mjs",
      "--offline",
    ],
  ),
  run(
    "deterministic deployment fork",
    "forge",
    [
      "test",
      "--offline",
      "--match-path",
      "test/DeployMainnetDeepFullRangeInfrastructureV1.t.sol",
      "-vv",
    ],
    { cwd: contractsRoot, expectedTests: 4 },
  ),
  run(
    "official dependency behavior fork",
    "forge",
    [
      "test",
      "--match-contract",
      "LiquidityGrowthFullRangeMainnetForkTest",
      "-vv",
    ],
    { cwd: contractsRoot, expectedTests: 6 },
  ),
];

if (!quick) {
  checks.push(
    run(
      "full-range suites",
      "forge",
      [
        "test",
        "--match-path",
        "test/LiquidityGrowthFullRange*.t.sol",
        "-vv",
      ],
      { cwd: contractsRoot, expectedTests: 50 },
    ),
    run(
      "full-range invariants",
      "forge",
      [
        "test",
        "--match-path",
        "test/invariant/LiquidityGrowthFullRangeInvariant.t.sol",
        "-vv",
      ],
      {
        cwd: contractsRoot,
        env: { FOUNDRY_PROFILE: "ci" },
        expectedTests: 9,
      },
    ),
  );
}

process.stdout.write(
  `${JSON.stringify(
    {
      status: "passed-local-preflight",
      releaseEligible: false,
      deploymentForkBlock: 25_622_180,
      behaviorForkBlock: 25_612_664,
      note:
        "Fork results are local evidence only. Mainnet activation still requires receipts, deployed runtime hashes, source verification and lifecycle evidence.",
      checks,
    },
    null,
    2,
  )}\n`,
);
