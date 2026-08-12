import assert from "node:assert/strict";
import test from "node:test";

import {
  assertShardsSecurityReleaseReady,
  buildShardsSecurityPropertiesV2,
} from "../shards-security-properties-v2-core.mjs";

test("real Forge artifacts, tracked manifests, source literals, tests, Git pins and transparent Slither triage bind", async () => {
  const result = await buildShardsSecurityPropertiesV2();
  assert.equal(result.descriptor.verificationSummary.structuralGatePassed, true);
  assert.equal(result.descriptor.verificationSummary.sourceAbiArtifactBindingGatePassed, true);
  assert.equal(result.descriptor.verificationSummary.exactTestEvidenceGatePassed, true);
  assert.equal(result.descriptor.verificationSummary.externalGitObjectResolutionGatePassed, true);
  assert.equal(result.descriptor.componentBinding.components.length, 13);
  assert.equal(result.descriptor.properties.length, 17);
  assert.equal(result.descriptor.slitherEvidence.status, "COMPLETE");
  assert.equal(result.descriptor.slitherEvidence.rawReport.totalDetectorInstances, 286);
  assert.equal(result.descriptor.slitherEvidence.rawReport.byteLength, 10_372_959);
  assert.equal(result.descriptor.slitherEvidence.rawMediumInstances, 9);
  assert.equal(result.descriptor.slitherEvidence.rawMediumTriage.length, 9);
  assert.equal(result.descriptor.slitherEvidence.actionableHighFindings, 0);
  assert.equal(result.descriptor.slitherEvidence.actionableMediumFindings, 0);
  assert.equal(result.descriptor.slitherEvidence.untriagedFindings, 0);
  assert.equal(result.descriptor.assurance.externalAuditClaim, false);
  assert.equal(result.descriptor.assurance.releaseReady, true);
  assert.equal(result.descriptor.activationAllowed, false);
  assert.doesNotThrow(() => assertShardsSecurityReleaseReady(result));
});
