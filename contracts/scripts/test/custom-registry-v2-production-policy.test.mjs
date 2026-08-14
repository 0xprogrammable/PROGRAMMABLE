import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertCustomRegistryV2ProductionConstructor,
  loadCustomRegistryV2ProductionPolicy,
} from "../custom-registry-v2-production-policy.mjs";
import {
  assertProductionPolicyApprovalBinding,
} from "../custom-registry-v2-safe-controller-guards.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

test("binds the production constructor to exact committed policy bytes", async () => {
  const loaded = await loadCustomRegistryV2ProductionPolicy(root);
  assert.match(loaded.registryPolicyCommitment, /^0x[0-9a-f]{64}$/u);
  assert.doesNotThrow(() =>
    assertCustomRegistryV2ProductionConstructor(
      {
        initialAdminDelay: 172800n,
        minimumFinalityBlocks: 12n,
        registryPolicyCommitment: loaded.registryPolicyCommitment,
      },
      loaded,
    ),
  );
  assert.throws(
    () =>
      assertCustomRegistryV2ProductionConstructor(
        {
          initialAdminDelay: 172800n,
          minimumFinalityBlocks: 3n,
          registryPolicyCommitment: loaded.registryPolicyCommitment,
        },
        loaded,
      ),
    /committed production policy/u,
  );
});

test("binds the merged Approval policy split and rejects historical release metadata", async () => {
  const loaded = await loadCustomRegistryV2ProductionPolicy(root);
  assert.equal(
    loaded.policy.approvalDescriptorBinding.schema,
    "programmable.approval-registry-descriptor-binding.v3",
  );
  assert.equal(
    loaded.policy.approvalDescriptorBinding.approvalRepository.commit,
    "3c61bbb77cc7c3efb3fe4c8f9aca841dc55c9db0",
  );
  assert.equal(
    loaded.policy.approvalDescriptorBinding.approvalRepository.sourceHead,
    "69fec69f661d224f7aa78264cbc2fc02ff20ae28",
  );
  assert.equal(
    loaded.policy.approvalDescriptorBinding.artifacts.schemaSha256,
    "0x1a3449647184822eedb8a291911918880fb048355fda3877654cfc502cd78ca5",
  );
  assert.deepEqual(
    loaded.policy.approvalDescriptorBinding.policyCommitmentFields,
    [
      "approvalDescriptorSchemaPolicyCommitment",
      "registryOnchainPolicyCommitment",
    ],
  );
  const historical = structuredClone(loaded.policy);
  historical.approvalDescriptorBinding.approvalRepository.commit =
    "129211556fcae902839f214bba8c4d4788dc9908";
  assert.throws(
    () =>
      assertProductionPolicyApprovalBinding({
        bytes: Buffer.from(`${JSON.stringify(historical)}\n`),
      }),
    /Approval policy binding is invalid/u,
  );
});
