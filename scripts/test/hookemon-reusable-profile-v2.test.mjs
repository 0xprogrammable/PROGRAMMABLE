import assert from "node:assert/strict";
import test from "node:test";
import {
  ACTUAL_V2_COMMAND,
  ACTUAL_V2_FORGE_COMMIT,
  ACTUAL_V2_FORGE_VERSION,
  ACTUAL_V2_SOLC_VERSION,
  ACTUAL_V2_TEST_NAMES,
  ACTUAL_V2_TEST_SOURCE,
  actualV2ReceiptErrors,
  canonicalJson,
  exactAbiEntry,
  requireNoScopedHighOrMedium,
  scopeSlitherDetectors,
  sha256,
  sourceClosureCommitment,
  verifySemanticAssertions
} from "../hookemon-reusable-profile-v2-core.mjs";

function fixture() {
  const sharedCommit = "8afe4548553b406bd0374b3a8958f1a186104b11";
  const sharedTree = "19393b3a1010db11de4b45d686580ee8b52f79f5";
  const publicationEvidence = {
    repository: "0xprogrammable/programmable",
    branch: "codex/shards-registry-gen2-freeze-8afe454-20260813",
    commit: sharedCommit,
    tree: sharedTree,
    commitUrl: `https://github.com/0xprogrammable/programmable/commit/${sharedCommit}`,
    authenticatedGitHubApiResolvedExactCommitAndTree: true,
    anonymousGitHubApiResolvedExactCommitAndTree: true,
    authenticatedGitHubApiResolvedExactBranchHead: true
  };
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
          remoteReachabilityProven: true,
          localFrozenSourceBundle: { commit: sharedCommit, tree: sharedTree }
        },
        foundryDependencyLock: {
          path: "dependencies/foundry-dependencies-v1.json",
          sha256: "lock",
          pinCount: 12,
          libTracked: false
        },
        testedCandidateSourceRevision: { commit: "3a7ce454", tree: "5db55cca" }
      },
      externalActivationGates: { sharedAuthorityCanonicalPublicationEvidence: publicationEvidence },
      evidenceRequirements: {
        measuredKernelRegistrationGas: 8_100_000,
        kernelRegistrationGasRegressionMaximum: 8_200_000,
        profileRuntimeByteRegressionMaximum: 22_000,
        actualV2ReceiptPath: "security/receipts/hookemon-v2-actual-e2e-receipt-v1.json",
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
          claimedCanonicalRemote: "https://github.com/0xprogrammable/programmable.git",
          remoteReachabilityProven: true,
          releasePublicationGate: {
            satisfied: true,
            repository: publicationEvidence.repository,
            branch: publicationEvidence.branch,
            commit: publicationEvidence.commit,
            tree: publicationEvidence.tree,
            commitUrl: publicationEvidence.commitUrl,
            verification: {
              authenticatedGitHubApiResolvedExactCommitAndTree: true,
              anonymousGitHubApiResolvedExactCommitAndTree: true,
              authenticatedGitHubApiResolvedExactBranchHead: true
            }
          },
          sourceBundle: { files: [{}, {}, {}, {}, {}] }
        }
      },
      foundryDependencyLock: {
        sha256: "lock",
        content: { activationAllowed: false, dependencies: Array.from({ length: 12 }, (_, index) => ({ index })) }
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
      },
      actualV2Receipt: {
        path: "security/receipts/hookemon-v2-actual-e2e-receipt-v1.json",
        sha256: "receipt",
        content: {
          receiptClass: "LOCAL_ISOLATED_INTEGRATION_NOT_PRODUCTION_AUTHORITY_PROOF",
          activationAllowed: false,
          testedSourceRevision: { commit: "3a7ce454", tree: "5db55cca" },
          toolchain: {
            forgeVersion: ACTUAL_V2_FORGE_VERSION,
            forgeCommit: ACTUAL_V2_FORGE_COMMIT,
            solcVersion: ACTUAL_V2_SOLC_VERSION
          },
          command: ACTUAL_V2_COMMAND,
          result: { passed: 3, failed: 0, skipped: 0 },
          testNames: ACTUAL_V2_TEST_NAMES,
          rawLog: {
            path: "security/receipts/hookemon-v2-actual-e2e-abcdef01.log",
            sha256: "abcdef0123456789",
            byteLength: 642
          },
          limitations: ["Route integration evidence, not production signer or governance configuration."]
        }
      },
      actualV2RawLog: {
        path: "security/receipts/hookemon-v2-actual-e2e-abcdef01.log",
        sha256: "abcdef0123456789",
        byteLength: 642
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
    (value) => { value.reviewedInput.sourceRevisions.sharedShardsAuthority.remoteReachabilityProven = false; },
    (value) => { value.evidenceBindings.sharedAuthorityProvenance.content.remoteReachabilityProven = false; },
    (value) => { value.evidenceBindings.sharedAuthorityProvenance.content.releasePublicationGate.branch = "unbound"; },
    (value) => { value.evidenceBindings.sharedAuthorityProvenance.content.sourceBundle.files.pop(); },
    (value) => { delete value.evidenceBindings.foundryDependencyLock; },
    (value) => { value.evidenceBindings.foundryDependencyLock.content.dependencies.pop(); },
    (value) => { value.reviewedInput.sourceRevisions.foundryDependencyLock.libTracked = true; },
    (value) => { delete value.evidenceBindings.actualV2Receipt; },
    (value) => { value.evidenceBindings.actualV2Receipt.content.receiptClass = "PRODUCTION_AUTHORITY_PROOF"; },
    (value) => { value.evidenceBindings.actualV2Receipt.content.toolchain.forgeVersion = "1.7.0"; },
    (value) => { value.evidenceBindings.actualV2Receipt.content.result.failed = 1; },
    (value) => { value.evidenceBindings.actualV2Receipt.content.testNames.pop(); },
    (value) => { value.evidenceBindings.actualV2RawLog.sha256 = "changed"; },
    (value) => { value.evidenceBindings.actualV2RawLog.path = "security/receipts/unbound.log"; },
    (value) => { value.reviewedInput.externalActivationGates.sharedAuthorityCanonicalPublicationEvidence.commit = "invented"; },
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

function receiptFixture() {
  const rawLog = Buffer.from([
    ...ACTUAL_V2_TEST_NAMES.map((name) => `[PASS] ${name}() (gas: 1)`),
    "Suite result: ok. 3 passed; 0 failed; 0 skipped; finished in 1.00s",
    "Ran 1 test suite in 1.00s: 3 tests passed, 0 failed, 0 skipped (3 total tests)",
    ""
  ].join("\n"));
  const rawLogSha256 = sha256(rawLog);
  const expected = {
    testedSourceCommit: "a".repeat(40),
    testedSourceTree: "b".repeat(40),
    testSourceSha256: "c".repeat(64),
    productionSourceClosure: "d".repeat(64),
    dependencyLockPath: "dependencies/foundry-dependencies-v1.json",
    dependencyLockSha256: "e".repeat(64),
    foundryConfigSha256: "f".repeat(64),
    remappingsSha256: "0".repeat(64),
    sourceBundleCommitmentSha256: "1".repeat(64)
  };
  const receipt = {
    receiptClass: "LOCAL_ISOLATED_INTEGRATION_NOT_PRODUCTION_AUTHORITY_PROOF",
    activationAllowed: false,
    deploymentAddresses: null,
    releaseActivationTransaction: null,
    testedSourceRevision: { commit: expected.testedSourceCommit, tree: expected.testedSourceTree },
    isolatedCheckout: {
      method: `git archive ${expected.testedSourceCommit}`,
      preexistingLibPresent: false,
      dependencyHydrationCommand: "node scripts/hydrate-hookemon-v2-dependencies.mjs lib",
      dependencyVerificationResult: "12 exact clean Git commit and tree pins"
    },
    toolchain: {
      forgeVersion: ACTUAL_V2_FORGE_VERSION,
      forgeCommit: ACTUAL_V2_FORGE_COMMIT,
      solcVersion: ACTUAL_V2_SOLC_VERSION
    },
    command: ACTUAL_V2_COMMAND,
    exitCode: 0,
    testSource: { path: ACTUAL_V2_TEST_SOURCE, sha256: expected.testSourceSha256 },
    sourceBoundary: {
      productionSourceClosureCommitmentSha256: expected.productionSourceClosure,
      dependencyLock: { path: expected.dependencyLockPath, sha256: expected.dependencyLockSha256 },
      foundryConfigSha256: expected.foundryConfigSha256,
      remappingsSha256: expected.remappingsSha256,
      frozenSharedAuthoritySourceBundleCommitmentSha256: expected.sourceBundleCommitmentSha256
    },
    rawLog: {
      path: `security/receipts/hookemon-v2-actual-e2e-${rawLogSha256.slice(0, 8)}.log`,
      sha256: rawLogSha256,
      byteLength: rawLog.length
    },
    result: { passed: 3, failed: 0, skipped: 0 },
    testNames: ACTUAL_V2_TEST_NAMES,
    limitations: ["This proves route integration, not production signer or governance configuration."]
  };
  return { receipt, rawLog, expected };
}

test("content-addressed actual V2 receipt validates command, toolchain, source boundary and raw passes", () => {
  const value = receiptFixture();
  assert.deepEqual(actualV2ReceiptErrors(value.receipt, value.rawLog, value.expected), []);
  for (const mutate of [
    (receipt) => { receipt.receiptClass = "PRODUCTION_AUTHORITY_PROOF"; },
    (receipt) => { receipt.activationAllowed = true; },
    (receipt) => { receipt.command = "forge test"; },
    (receipt) => { receipt.toolchain.forgeCommit = "2".repeat(40); },
    (receipt) => { receipt.result.failed = 1; },
    (receipt) => { receipt.testNames.pop(); },
    (receipt) => { receipt.rawLog.path = "security/receipts/unbound.log"; },
    (receipt) => { receipt.rawLog.sha256 = "3".repeat(64); },
    (receipt) => { receipt.testedSourceRevision.commit = "4".repeat(40); },
    (receipt) => { receipt.sourceBoundary.dependencyLock.sha256 = "5".repeat(64); },
    (receipt) => { receipt.sourceBoundary.frozenSharedAuthoritySourceBundleCommitmentSha256 = "6".repeat(64); },
    (receipt) => { receipt.isolatedCheckout.preexistingLibPresent = true; },
    (receipt) => { receipt.limitations = []; }
  ]) {
    const receipt = structuredClone(value.receipt);
    mutate(receipt);
    assert.notDeepEqual(actualV2ReceiptErrors(receipt, value.rawLog, value.expected), []);
  }
  const omittedPass = Buffer.from(value.rawLog.toString("utf8").replace(`[PASS] ${ACTUAL_V2_TEST_NAMES[0]}() (gas: 1)\n`, ""));
  assert.notDeepEqual(actualV2ReceiptErrors(value.receipt, omittedPass, value.expected), []);
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
