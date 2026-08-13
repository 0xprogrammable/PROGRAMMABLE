import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalJson,
  exactAbiEntry,
  requireNoScopedHighOrMedium,
  scopeSlitherDetectors,
  sourceClosureCommitment,
  verifySemanticAssertions
} from "../hookemon-reusable-profile-v2-core.mjs";

function fixture() {
  const value = {
    activationAllowed: false,
    deploymentAddresses: null,
    releaseActivationTransaction: null,
    reviewedInput: {
      activationAllowed: false,
      productBoundary: {
        durableTechnicalApproval: [
          "complete contract graph and runtime set",
          "29,000 project plus 1,000 Programmable inclusive quote-fee policy",
          "position timelock and approved multisig holder semantics"
        ],
        websiteSelectedAfterApproval: ["tokenName", "tokenSymbol", "applicant and funding wallet"],
        hiddenManualPerLaunchTransition: false,
        registryPrivilegedPreauthorizationPerLaunch: false
      },
      atomicOrder: ["registryRegisterFromSameBlockAuthorityConsumption"],
      securitySemantics: {
        repositoryOnce: "blocks every later route",
        rollback: "rolls back every effect",
        registryWriter: "the only WRITER_ROLE account"
      },
      sourceRevisions: {
        sharedShardsAuthority: {
          remoteReachabilityProven: false,
          localFrozenSourceBundle: { commit: "8afe4548", tree: "19393b3a" }
        }
      },
      externalActivationGates: { sharedAuthorityCanonicalPublicationEvidence: null },
      evidenceRequirements: {
        measuredKernelRegistrationGas: 8_100_000,
        kernelRegistrationGasRegressionMaximum: 8_200_000,
        profileRuntimeByteRegressionMaximum: 22_000,
        slitherVersion: "0.11.5",
        slitherReportSha256: "raw",
        slitherReportByteLength: 123,
        slitherTotalDetectorInstances: 1
      }
    },
    artifacts: [{
      contractName: "ProgrammableExactHookemonReusableNormalCreateProfileV2",
      eip170Required: true,
      eip170Margin: 1,
      runtimeCodeLength: 21_900
    }],
    evidenceBindings: {
      sharedAuthorityProvenance: {
        content: {
          remoteReachabilityProven: false,
          releasePublicationGate: { satisfied: false },
          sourceBundle: { files: [{}, {}, {}, {}, {}] }
        }
      },
      productionSourceClosure: {
        derivation: "solc-metadata-sources-union-v1",
        artifactSet: ["Profile"],
        commitmentSha256: null,
        files: [
          { path: "src/router_vnext/Profile.sol", classification: "first-party-production", sha256: "a", solcKeccak256: "0x1" },
          { path: "src/router_vnext/ProgrammableTokenIdentityPolicyV1.sol", classification: "first-party-production", sha256: "b", solcKeccak256: "0x2" }
        ]
      },
      slitherTriage: {
        content: {
          activationAllowed: false,
          tool: { slither: "0.11.5" },
          rawReport: { sha256: "raw", byteLength: 123, detectorInstances: 1, success: true },
          scope: {
            productionSourceClosureCommitmentSha256: null,
            analyzedFirstPartyPaths: [
              "src/router_vnext/Profile.sol",
              "src/router_vnext/ProgrammableTokenIdentityPolicyV1.sol"
            ],
            scopedDetectorIds: ["detector-a"],
            scopedDetectorSetCommitmentSha256: "9df4896a8a16f88934c9e9d73d44e734357af79348eecd599908133510c72205",
            byImpact: { High: 0, Medium: 0, Low: 0, Informational: 1 },
            detectorInstances: 1,
            lowDetectorInstances: 0,
            lowTriage: [],
            actionableHighFindings: 0,
            actionableMediumFindings: 0,
            untriagedHighOrMediumFindings: 0
          }
        }
      },
      tests: {
        content: {
          focusedSharedAuthorityRegistryLifecycle: {
            kernelRegistrationGasUsed: 8_100_000,
            kernelRegistrationGasRegressionMaximum: 8_200_000,
            profileRuntimeByteRegressionMaximum: 22_000
          }
        }
      }
    }
  };
  value.evidenceBindings.productionSourceClosure.commitmentSha256 =
    sourceClosureCommitment(value.evidenceBindings.productionSourceClosure);
  value.evidenceBindings.slitherTriage.content.scope.productionSourceClosureCommitmentSha256 =
    value.evidenceBindings.productionSourceClosure.commitmentSha256;
  return value;
}

test("semantic fixture is accepted", () => assert.deepEqual(verifySemanticAssertions(fixture()), []));

test("activation, provenance, source closure, Slither, revenue and size mutations fail closed", () => {
  for (const mutate of [
    (value) => { value.activationAllowed = true; },
    (value) => { value.reviewedInput.productBoundary.hiddenManualPerLaunchTransition = true; },
    (value) => { value.reviewedInput.securitySemantics.repositoryOnce = "same route only"; },
    (value) => { value.reviewedInput.productBoundary.durableTechnicalApproval.splice(1, 1); },
    (value) => { value.reviewedInput.sourceRevisions.sharedShardsAuthority.remoteReachabilityProven = true; },
    (value) => { value.evidenceBindings.sharedAuthorityProvenance.content.remoteReachabilityProven = true; },
    (value) => { value.evidenceBindings.sharedAuthorityProvenance.content.sourceBundle.files.pop(); },
    (value) => { value.reviewedInput.externalActivationGates.sharedAuthorityCanonicalPublicationEvidence = { transaction: "invented" }; },
    (value) => { delete value.evidenceBindings.slitherTriage; },
    (value) => { value.evidenceBindings.slitherTriage.content.scope.analyzedFirstPartyPaths.pop(); },
    (value) => { value.evidenceBindings.productionSourceClosure.files[1].sha256 = "changed"; value.evidenceBindings.productionSourceClosure.commitmentSha256 = "changed"; },
    (value) => { value.evidenceBindings.slitherTriage.content.scope.byImpact.Medium = 1; },
    (value) => { value.evidenceBindings.slitherTriage.content.scope.scopedDetectorIds.push("detector-b"); },
    (value) => { value.evidenceBindings.slitherTriage.content.tool.slither = "0.11.4"; },
    (value) => { value.evidenceBindings.slitherTriage.content.rawReport.sha256 = "changed"; },
    (value) => { value.evidenceBindings.slitherTriage.content.rawReport.byteLength = 124; },
    (value) => { value.evidenceBindings.slitherTriage.content.rawReport.detectorInstances = 2; },
    (value) => { value.artifacts[0].eip170Margin = -1; },
    (value) => { value.reviewedInput.evidenceRequirements.measuredKernelRegistrationGas = 8_300_000; },
    (value) => { value.artifacts[0].runtimeCodeLength = 22_001; },
    (value) => { value.evidenceBindings.tests.content.focusedSharedAuthorityRegistryLifecycle.kernelRegistrationGasUsed = 8_099_999; }
  ]) {
    const value = structuredClone(fixture());
    mutate(value);
    assert.notDeepEqual(verifySemanticAssertions(value), []);
  }
});

test("a raw Policy Medium can never be represented as a zero-Medium scoped result", () => {
  const policyPath = "src/router_vnext/ProgrammableTokenIdentityPolicyV1.sol";
  const rawFixture = [{
    id: "policy-medium",
    check: "uninitialized-local",
    impact: "Medium",
    elements: [{ source_mapping: { filename_relative: policyPath, lines: [67] } }]
  }];
  const scoped = scopeSlitherDetectors(rawFixture, [policyPath]);
  assert.equal(scoped.length, 1);
  assert.throws(() => requireNoScopedHighOrMedium(scoped), /uninitialized-local:policy-medium/u);
});

test("canonical JSON is key-order independent", () => {
  assert.equal(canonicalJson({ b: 2, a: { d: 4, c: 3 } }), canonicalJson({ a: { c: 3, d: 4 }, b: 2 }));
});

test("exact ABI comparison rejects type, order, mutability and indexed mutations", () => {
  const expected = {
    type: "function",
    name: "consumePermit",
    stateMutability: "nonpayable",
    inputs: [{ name: "permit", type: "tuple", components: [{ name: "nonce", type: "uint256" }] }],
    outputs: [{ name: "permitDigest", type: "bytes32" }]
  };
  assert.ok(exactAbiEntry([expected], expected));
  for (const mutation of [
    { ...expected, stateMutability: "view" },
    { ...expected, outputs: [] },
    { ...expected, inputs: [{ name: "permit", type: "bytes" }] },
    { ...expected, inputs: [{ name: "permit", type: "tuple", components: [{ name: "nonce", type: "uint64" }] }] }
  ]) assert.equal(exactAbiEntry([expected], mutation), false);
  const event = { type: "event", name: "Registered", anonymous: false, inputs: [{ name: "id", type: "bytes32", indexed: true }] };
  assert.equal(exactAbiEntry([event], { ...event, inputs: [{ ...event.inputs[0], indexed: false }] }), false);
});
