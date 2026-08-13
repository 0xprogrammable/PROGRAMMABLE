import assert from "node:assert/strict";
import test from "node:test";
import { canonicalJson, exactAbiEntry, verifySemanticAssertions } from "../hookemon-reusable-profile-v2-core.mjs";

function fixture() {
  return {
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
      evidenceRequirements: {
        measuredKernelRegistrationGas: 8_100_000,
        kernelRegistrationGasRegressionMaximum: 8_200_000,
        profileRuntimeByteRegressionMaximum: 22_000
      }
    },
    artifacts: [{
      contractName: "ProgrammableExactHookemonReusableNormalCreateProfileV2",
      eip170Required: true,
      eip170Margin: 1,
      runtimeCodeLength: 21_900
    }],
    evidenceBindings: {
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
}

test("semantic fixture is accepted", () => assert.deepEqual(verifySemanticAssertions(fixture()), []));

test("activation, hidden transition, repo-once, revenue and size mutations fail closed", () => {
  for (const mutate of [
    (value) => { value.activationAllowed = true; },
    (value) => { value.reviewedInput.productBoundary.hiddenManualPerLaunchTransition = true; },
    (value) => { value.reviewedInput.securitySemantics.repositoryOnce = "same route only"; },
    (value) => { value.reviewedInput.productBoundary.durableTechnicalApproval.splice(1, 1); },
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
