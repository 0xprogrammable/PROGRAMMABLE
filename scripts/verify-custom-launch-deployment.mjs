#!/usr/bin/env node

import {
  parseCustomLaunchDeploymentProbeArguments,
  probeCustomLaunchDeployment,
} from "./custom-launch-deployment-probe-core.mjs";
import {
  createCustomLaunchCanaryEvidence,
  writeCustomLaunchCanaryEvidence,
} from "./custom-launch-canary-evidence.mjs";

try {
  const runnerArguments = parseRunnerArguments(process.argv.slice(2));
  const probeInput = parseCustomLaunchDeploymentProbeArguments(
    runnerArguments.probeArguments,
  );
  const result = await probeCustomLaunchDeployment(
    probeInput,
  );
  if (runnerArguments.evidenceOutput !== undefined) {
    const evidence = createCustomLaunchCanaryEvidence({
      probeResult: result,
      targetUrl: probeInput.baseUrl,
      deploymentId: runnerArguments.deploymentId,
      websiteCommitSha: probeInput.expectedCommitSha,
      approvalServicePackageArtifactHash:
        probeInput.expectedApprovalServicePackageArtifactHash,
      reviewAuthorityMode: probeInput.expectedApprovalServiceReviewAuthorityMode,
      ownApplicationHandle: probeInput.ownApplicationHandle,
      foreignApplicationHandle: probeInput.foreignApplicationHandle,
    });
    await writeCustomLaunchCanaryEvidence(runnerArguments.evidenceOutput, evidence);
  }
  process.stdout.write(
    `Custom launch deployment ${result.status} at ${result.baseUrl}`
    + ` (authenticated canary: ${result.authenticatedCanary})\n`,
  );
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown deployment probe failure";
  process.stderr.write(`Custom launch deployment probe failed: ${message}\n`);
  process.exitCode = 1;
}

function parseRunnerArguments(argv) {
  const probeArguments = [];
  let evidenceOutput;
  let deploymentId;
  for (const argument of argv) {
    if (argument.startsWith("--evidence-output=") && evidenceOutput === undefined) {
      evidenceOutput = argument.slice("--evidence-output=".length);
    } else if (argument.startsWith("--deployment-id=") && deploymentId === undefined) {
      deploymentId = argument.slice("--deployment-id=".length);
    } else {
      probeArguments.push(argument);
    }
  }
  if ((evidenceOutput === undefined) !== (deploymentId === undefined)) {
    throw new TypeError("Canary evidence output and deployment id must be provided together");
  }
  return Object.freeze({
    probeArguments: Object.freeze(probeArguments),
    evidenceOutput,
    deploymentId,
  });
}
