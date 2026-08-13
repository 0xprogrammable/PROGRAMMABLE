#!/usr/bin/env node

import {
  parseCustomLaunchDeploymentProbeArguments,
  probeCustomLaunchDeployment,
} from "./custom-launch-deployment-probe-core.mjs";
import {
  createCustomLaunchCanaryEvidence,
  writeCustomLaunchCanaryEvidence,
} from "./custom-launch-canary-evidence.mjs";
import {
  createCustomLaunchDarkReleaseEvidence,
  writeCustomLaunchDarkReleaseEvidence,
} from "./custom-launch-dark-release-evidence.mjs";

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
  if (runnerArguments.darkReleaseEvidenceOutput !== undefined) {
    const evidence = createCustomLaunchDarkReleaseEvidence({
      probeResult: result,
      targetUrl: probeInput.baseUrl,
      deploymentId: runnerArguments.deploymentId,
      websiteCommitSha: probeInput.expectedCommitSha,
      approvalServicePackageArtifactHash:
        probeInput.expectedApprovalServicePackageArtifactHash,
      reviewAuthorityMode: probeInput.expectedApprovalServiceReviewAuthorityMode,
      releaseSubjectSha256: runnerArguments.releaseSubjectSha256,
      detachedRecordSha256: runnerArguments.detachedRecordSha256,
      crossRepositoryAttestationCommitSha:
        runnerArguments.crossRepositoryAttestationCommitSha,
      crossRepositoryBindingDocumentSha256:
        runnerArguments.crossRepositoryBindingDocumentSha256,
    });
    await writeCustomLaunchDarkReleaseEvidence(
      runnerArguments.darkReleaseEvidenceOutput,
      evidence,
    );
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
  let darkReleaseEvidenceOutput;
  let deploymentId;
  let releaseSubjectSha256;
  let detachedRecordSha256;
  let crossRepositoryAttestationCommitSha;
  let crossRepositoryBindingDocumentSha256;
  for (const argument of argv) {
    if (argument.startsWith("--evidence-output=") && evidenceOutput === undefined) {
      evidenceOutput = argument.slice("--evidence-output=".length);
    } else if (argument.startsWith("--deployment-id=") && deploymentId === undefined) {
      deploymentId = argument.slice("--deployment-id=".length);
    } else if (
      argument.startsWith("--dark-release-evidence-output=")
      && darkReleaseEvidenceOutput === undefined
    ) {
      darkReleaseEvidenceOutput = argument.slice(
        "--dark-release-evidence-output=".length,
      );
    } else if (
      argument.startsWith("--release-subject-sha256=")
      && releaseSubjectSha256 === undefined
    ) {
      releaseSubjectSha256 = argument.slice("--release-subject-sha256=".length);
    } else if (
      argument.startsWith("--detached-record-sha256=")
      && detachedRecordSha256 === undefined
    ) {
      detachedRecordSha256 = argument.slice("--detached-record-sha256=".length);
    } else if (
      argument.startsWith("--cross-repository-attestation-commit-sha=")
      && crossRepositoryAttestationCommitSha === undefined
    ) {
      crossRepositoryAttestationCommitSha = argument.slice(
        "--cross-repository-attestation-commit-sha=".length,
      );
    } else if (
      argument.startsWith("--cross-repository-binding-document-sha256=")
      && crossRepositoryBindingDocumentSha256 === undefined
    ) {
      crossRepositoryBindingDocumentSha256 = argument.slice(
        "--cross-repository-binding-document-sha256=".length,
      );
    } else {
      probeArguments.push(argument);
    }
  }
  if (evidenceOutput !== undefined && darkReleaseEvidenceOutput !== undefined) {
    throw new TypeError("Canary and dark release evidence outputs are mutually exclusive");
  }
  if (evidenceOutput !== undefined && deploymentId === undefined) {
    throw new TypeError("Canary evidence output and deployment id must be provided together");
  }
  const darkReleaseBindings = [
    releaseSubjectSha256,
    detachedRecordSha256,
    crossRepositoryAttestationCommitSha,
    crossRepositoryBindingDocumentSha256,
  ];
  if (
    darkReleaseEvidenceOutput !== undefined
    && (deploymentId === undefined || darkReleaseBindings.some((value) => value === undefined))
  ) {
    throw new TypeError(
      "Dark release evidence requires deployment and exact release-record bindings",
    );
  }
  if (
    darkReleaseEvidenceOutput === undefined
    && darkReleaseBindings.some((value) => value !== undefined)
  ) {
    throw new TypeError("Dark release bindings require a dark release evidence output");
  }
  if (
    deploymentId !== undefined
    && evidenceOutput === undefined
    && darkReleaseEvidenceOutput === undefined
  ) {
    throw new TypeError("Deployment id requires an evidence output");
  }
  return Object.freeze({
    probeArguments: Object.freeze(probeArguments),
    evidenceOutput,
    darkReleaseEvidenceOutput,
    deploymentId,
    releaseSubjectSha256,
    detachedRecordSha256,
    crossRepositoryAttestationCommitSha,
    crossRepositoryBindingDocumentSha256,
  });
}
