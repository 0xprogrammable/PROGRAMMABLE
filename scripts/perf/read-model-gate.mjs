#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  evaluateReadModelReleaseEvidence,
  loadReadModelReleaseEvidence,
  parseReadModelLoadProfile,
} from "./read-model-gate-core.mjs";
import {
  verifyLiveCacheAndKeyContracts,
  verifyLiveRollbackTarget,
  verifyLiveVercelBinding,
} from "./read-model-live-verifier.mjs";
import { expectedProductionProviderBindings } from "./read-model-provider-binding.mjs";
import { evaluateReadModelSourceContracts } from "./read-model-source-contracts.mjs";

function parseArguments(argv) {
  let evidencePath;
  let requireReleaseEvidence = false;
  let ifPresent = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--evidence") {
      evidencePath = argv[index + 1];
      if (!evidencePath || evidencePath.startsWith("--")) {
        throw new Error("--evidence requires a bundle path");
      }
      index += 1;
      continue;
    }
    if (argument === "--require-release-evidence") {
      requireReleaseEvidence = true;
      continue;
    }
    if (argument === "--if-present") {
      ifPresent = true;
      continue;
    }
    throw new Error(`unsupported argument: ${argument}`);
  }
  if (!requireReleaseEvidence) {
    throw new Error("the gate only accepts --require-release-evidence mode");
  }
  return { evidencePath, ifPresent };
}

function output(value, exitCode) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  process.exitCode = exitCode;
}

async function main() {
  const rootDirectory = process.cwd();
  const args = parseArguments(process.argv.slice(2));
  const evidencePath =
    args.evidencePath ??
    process.env.PROGRAMMABLE_READ_MODEL_PERF_EVIDENCE_PATH;
  if (!evidencePath && args.ifPresent) {
    output(
      {
        schemaVersion: 1,
        mode: "release",
        status: "skipped",
        releaseEvidenceAccepted: false,
        reason: "no exact release evidence was explicitly provided",
      },
      0,
    );
    return;
  }
  if (!evidencePath) {
    throw new Error(
      "PROGRAMMABLE_READ_MODEL_PERF_EVIDENCE_PATH or --evidence is required",
    );
  }
  const profile = parseReadModelLoadProfile(
    JSON.parse(
      readFileSync(
        resolve(rootDirectory, "config/read-model-release-profile.v1.json"),
        "utf8",
      ),
    ),
  );
  const gitHead = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: rootDirectory,
    encoding: "utf8",
  }).trim();
  const expectedProviders = expectedProductionProviderBindings();
  const bundle = loadReadModelReleaseEvidence({
    profile,
    evidencePath: resolve(rootDirectory, evidencePath),
  });
  const expectedTargetUrl = process.env.PROGRAMMABLE_READ_MODEL_TARGET_URL;
  const expectedDeploymentId =
    process.env.PROGRAMMABLE_READ_MODEL_VERCEL_DEPLOYMENT_ID;
  if (!expectedTargetUrl || !expectedDeploymentId) {
    throw new Error(
      "PROGRAMMABLE_READ_MODEL_TARGET_URL and PROGRAMMABLE_READ_MODEL_VERCEL_DEPLOYMENT_ID are required",
    );
  }
  const exactWorkflowTarget =
    new URL(bundle.evidence.target.url).toString() ===
      new URL(expectedTargetUrl).toString() &&
    bundle.evidence.target.vercelDeploymentId === expectedDeploymentId;
  const evidenceResult = evaluateReadModelReleaseEvidence(bundle, {
    gitHead,
    expectedProviders,
  });
  const sourceResult = evaluateReadModelSourceContracts(
    rootDirectory,
    profile,
  );
  const [vercelResult, rollbackResult, cacheResult] = await Promise.all([
    verifyLiveVercelBinding({
      evidence: bundle.evidence,
      gitHead,
      token: process.env.VERCEL_TOKEN,
      teamId: process.env.VERCEL_ORG_ID,
      projectId: process.env.VERCEL_PROJECT_ID,
    }),
    verifyLiveRollbackTarget({
      stagedDeploymentId: bundle.evidence.target.vercelDeploymentId,
      token: process.env.VERCEL_TOKEN,
      teamId: process.env.VERCEL_ORG_ID,
      projectId: process.env.VERCEL_PROJECT_ID,
      productionDomain:
        process.env.PROGRAMMABLE_PRODUCTION_DOMAIN ?? "programmable.family",
    }),
    verifyLiveCacheAndKeyContracts({
      profile,
      evidence: bundle.evidence,
      datasetManifest: bundle.datasetManifest,
    }),
  ]);
  const failures = [
    ...(exactWorkflowTarget
      ? []
      : [
          {
            id: "workflow-target-binding",
            detail: "evidence does not target the staged deployment",
          },
        ]),
    ...evidenceResult.failures,
    ...sourceResult.failures,
    ...vercelResult.failures,
    ...rollbackResult.failures,
    ...cacheResult.failures,
  ];
  output(
    {
      schemaVersion: 1,
      profileId: profile.profileId,
      mode: "release",
      status: failures.length === 0 ? "accepted" : "rejected",
      releaseEvidenceAccepted: failures.length === 0,
      checks: [
        {
          id: "workflow-target-binding",
          status: exactWorkflowTarget ? "pass" : "fail",
          detail: "evidence targets the staged deployment",
        },
        ...evidenceResult.checks,
        ...sourceResult.checks,
        ...vercelResult.checks,
        ...rollbackResult.checks,
        ...cacheResult.checks,
      ],
      failures,
      artifactDigests: evidenceResult.artifactDigests,
    },
    failures.length === 0 ? 0 : 1,
  );
}

main().catch((error) => {
  output(
    {
      schemaVersion: 1,
      mode: "release",
      status: "rejected",
      releaseEvidenceAccepted: false,
      checks: [],
      failures: [
        {
          id: "gate-input",
          detail: error instanceof Error ? error.message : "invalid input",
        },
      ],
    },
    1,
  );
});
