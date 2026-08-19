import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { canonicalJson } from "../submission-core.mjs";
import { sha256Bytes } from "../open-world-v2-core.mjs";
import {
  APPLICATION_V3_RECHECK_DIFF_ALLOWLIST,
  APPLICATION_V3_SOURCE_BINDING_FIELDS,
  ApplicationV3PrepareRevisionError,
  prepareApplicationV3Revision
} from "../application-v3-prepare-revision-core.mjs";

const HASH_A = `sha256:${"1".repeat(64)}`;
const HASH_B = `sha256:${"2".repeat(64)}`;
const HASH_C = `sha256:${"3".repeat(64)}`;
const V3_TEMPLATE = JSON.parse(fs.readFileSync(
  new URL("../../assets/templates/open-world-v2/public-pr-application-v3.example.json", import.meta.url),
  "utf8"
));

test("publishes the exact source-binding projection and same-source recheck allowlist", () => {
  assert.deepEqual(APPLICATION_V3_SOURCE_BINDING_FIELDS, [
    "id",
    "numericRepositoryId",
    "repositoryUri",
    "revisionObjectId",
    "treeObjectId",
    "sourceClosureMode",
    "sourcePaths",
    "sourceManifest"
  ]);
  assert.deepEqual(APPLICATION_V3_RECHECK_DIFF_ALLOWLIST, [
    "$.fidelity",
    "$.securityBindings",
    "$.reviewPackage",
    "$.source.verificationReports",
    "$.source.primary.githubActionsRunIds",
    "$.source.companions[*].githubActionsRunIds"
  ]);
  assert.equal(Object.isFrozen(APPLICATION_V3_SOURCE_BINDING_FIELDS), true);
  assert.equal(Object.isFrozen(APPLICATION_V3_RECHECK_DIFF_ALLOWLIST), true);
});

test("prepares revision 1 for a new application without mutating or leaking the draft", () => {
  const applicationDraft = createApplicationDraft({ summary: "PRIVATE-DRAFT-SENTINEL" });
  const originalDraft = structuredClone(applicationDraft);

  const result = prepareApplicationV3Revision({
    applicationDraft,
    predecessor: { kind: "none" }
  });

  assert.deepEqual(applicationDraft, originalDraft);
  assert.notEqual(result.application, applicationDraft);
  assert.equal(result.application.applicationRevision, "1");
  assert.deepEqual(result.application.lineage, { kind: "new", previous: null });
  assert.equal(Object.isFrozen(result.application), true);
  assert.equal(Object.isFrozen(result.application.source.primary), true);

  assert.equal(result.plan.contract, "public-pr-application-v3-revision-plan");
  assert.equal(result.plan.schemaVersion, "1.0.0");
  assert.equal(result.plan.mode, "new-application");
  assert.equal(result.plan.applicationId, "legacy-open-world-example");
  assert.equal(result.plan.applicationRevision, "1");
  assert.deepEqual(result.plan.lineage, { kind: "new", previous: null });
  assert.equal(result.plan.predecessor, null);
  assert.deepEqual(result.plan.target, {
    githubNextAction: "submit",
    pullRequestNumber: null
  });
  assert.match(result.plan.preparedDraftSha256, /^sha256:[0-9a-f]{64}$/u);
  assert.match(result.plan.planSha256, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(result.plan.preparedDraftSha256, sha256Bytes(canonicalBytes(result.application)));
  const { planSha256, ...planPayload } = result.plan;
  assert.equal(planSha256, sha256Bytes(Buffer.from(canonicalJson(planPayload), "utf8")));
  assert.equal(result.plan.dryRun, true);
  assert.equal(result.plan.readOnly, true);
  assert.equal(result.plan.writePerformed, false);
  assert.equal(result.plan.networkAccessed, false);
  assert.equal(result.plan.candidateCodeExecuted, false);
  assert.deepEqual(result.plan.externalActionsPerformed, []);
  assert.equal(result.plan.approvalGranted, false);
  assert.equal(result.plan.launchAuthorizationGranted, false);
  assert.equal(JSON.stringify(result.plan).includes("PRIVATE-DRAFT-SENTINEL"), false);
  assert.equal(Object.isFrozen(result.plan), true);
  assert.equal(Object.isFrozen(result.plan.target), true);
});

test("rejects every manually supplied revision or lineage with privacy-safe errors", () => {
  const manualRevision = createApplicationDraft();
  manualRevision.applicationRevision = "999999999999999999999999999999999999";
  assertPrepareError(
    () => prepareApplicationV3Revision({
      applicationDraft: manualRevision,
      predecessor: { kind: "none" }
    }),
    "PREPARE_REVISION_MANUAL_REVISION_FORBIDDEN",
    "999999999999999999999999999999999999"
  );

  const manualLineage = createApplicationDraft();
  manualLineage.lineage = { kind: "PRIVATE-LINEAGE-SENTINEL", previous: null };
  assertPrepareError(
    () => prepareApplicationV3Revision({
      applicationDraft: manualLineage,
      predecessor: { kind: "none" }
    }),
    "PREPARE_REVISION_MANUAL_LINEAGE_FORBIDDEN",
    "PRIVATE-LINEAGE-SENTINEL"
  );
});

test("rejects a malformed nested draft after derivation and before returning any plan", () => {
  const malformed = createApplicationDraft();
  malformed.reviewState.inheritedApproval = true;
  malformed.summary = "PRIVATE-MALFORMED-DRAFT-SENTINEL";

  assertPrepareError(
    () => prepareApplicationV3Revision({
      applicationDraft: malformed,
      predecessor: { kind: "none" }
    }),
    "PREPARE_REVISION_RESULT_INVALID",
    "PRIVATE-MALFORMED-DRAFT-SENTINEL"
  );
});

test("derives a source-update from exact V3 predecessor bytes with arbitrary-precision revision arithmetic", () => {
  const priorRevision = "9".repeat(256);
  const predecessorApplication = createV3Application({ applicationRevision: priorRevision });
  const predecessorBytes = canonicalBytes(predecessorApplication);
  const applicationDraft = createDraftFromV3(predecessorApplication);
  applicationDraft.source.primary.revisionObjectId = "e".repeat(40);
  applicationDraft.source.primary.treeObjectId = "f".repeat(40);
  const originalDraft = structuredClone(applicationDraft);
  const originalPredecessorBytes = Buffer.from(predecessorBytes);

  const result = prepareApplicationV3Revision({
    applicationDraft,
    predecessor: {
      kind: "v3",
      location: "registry-base",
      applicationBytes: predecessorBytes,
      packageSha256: HASH_C
    }
  });

  assert.deepEqual(applicationDraft, originalDraft);
  assert.deepEqual(predecessorBytes, originalPredecessorBytes);
  assert.equal(result.application.applicationRevision, `1${"0".repeat(256)}`);
  assert.equal(result.application.lineage.kind, "source-update");
  assert.deepEqual(result.application.lineage.previous, {
    applicationContract: "public-pr-application-v3",
    applicationSchemaVersion: 3,
    applicationRevision: priorRevision,
    applicationSha256: sha256Bytes(predecessorBytes),
    packageSha256: HASH_C,
    sourceNumericRepositoryId: "987654321",
    sourceCommit: predecessorApplication.source.primary.revisionObjectId,
    sourceTree: predecessorApplication.source.primary.treeObjectId,
    submissionSchemaId: "urn:programmable:v4-hook-submission:2.0.0",
    submissionStandard: "2.0.0",
    submissionPath: predecessorApplication.policyBindings.submissionPath,
    submissionSha256: predecessorApplication.policyBindings.submissionSha256,
    feePolicyId: "programmable-volume-fee-v2",
    feePolicyVersion: "2.0.0",
    feeApplicability: predecessorApplication.policyBindings.feeApplicability,
    feePolicyInstanceSha256: null
  });
  assert.equal(result.plan.mode, "merged-registry-successor");
  assert.equal(result.plan.sourceChanged, true);
  assert.deepEqual(result.plan.target, {
    githubNextAction: "submit",
    pullRequestNumber: null
  });
  assert.deepEqual(result.plan.predecessor, {
    applicationContract: "public-pr-application-v3",
    applicationRevision: priorRevision,
    applicationSha256: sha256Bytes(predecessorBytes),
    packageSha256: HASH_C,
    location: "registry-base"
  });
});

test("derives recheck for a same-source V3 change and plans an exact open-draft update", () => {
  const predecessorApplication = createV3Application({ applicationRevision: "41" });
  const applicationDraft = createDraftFromV3(predecessorApplication);
  applicationDraft.reviewPackage.records[0].sha256 = HASH_C;

  const result = prepareApplicationV3Revision({
    applicationDraft,
    predecessor: {
      kind: "v3",
      location: "open-draft",
      pullRequestNumber: 42,
      applicationBytes: canonicalBytes(predecessorApplication),
      packageSha256: HASH_B
    }
  });

  assert.equal(result.application.applicationRevision, "42");
  assert.equal(result.application.lineage.kind, "recheck");
  assert.equal(result.plan.mode, "open-draft-update");
  assert.equal(result.plan.sourceChanged, false);
  assert.deepEqual(result.plan.target, {
    githubNextAction: "update",
    pullRequestNumber: 42
  });
});

test("rejects an exact V3 semantic no-op without exposing predecessor or draft content", () => {
  const predecessorApplication = createV3Application({
    applicationRevision: "8",
    summary: "PRIVATE-NOOP-SENTINEL"
  });
  const applicationDraft = createDraftFromV3(predecessorApplication);

  assertPrepareError(
    () => prepareApplicationV3Revision({
      applicationDraft,
      predecessor: {
        kind: "v3",
        location: "registry-base",
        applicationBytes: canonicalBytes(predecessorApplication),
        packageSha256: HASH_B
      }
    }),
    "PREPARE_REVISION_NO_CHANGES",
    "PRIVATE-NOOP-SENTINEL"
  );
});

test("rejects non-canonical V3 predecessor bytes before deriving lineage", () => {
  const predecessorApplication = createV3Application({ applicationRevision: "1" });
  const nonCanonicalBytes = Buffer.from(`${JSON.stringify(predecessorApplication, null, 2)}\n`, "utf8");

  assertPrepareError(
    () => prepareApplicationV3Revision({
      applicationDraft: createDraftFromV3(predecessorApplication),
      predecessor: {
        kind: "v3",
        location: "registry-base",
        applicationBytes: nonCanonicalBytes,
        packageSha256: HASH_B
      }
    }),
    "PREPARE_REVISION_PREDECESSOR_BYTES_NON_CANONICAL"
  );

  const bomPrefixedBytes = Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    canonicalBytes(predecessorApplication)
  ]);
  assertPrepareError(
    () => prepareApplicationV3Revision({
      applicationDraft: createDraftFromV3(predecessorApplication),
      predecessor: {
        kind: "v3",
        location: "registry-base",
        applicationBytes: bomPrefixedBytes,
        packageSha256: HASH_B
      }
    }),
    "PREPARE_REVISION_PREDECESSOR_BYTES_NON_CANONICAL"
  );

  const duplicateBytes = Buffer.from(
    canonicalBytes(predecessorApplication).toString("utf8").replace(
      '"applicationRevision":"1"',
      '"applicationRevision":"1","applicationRevision":"1"'
    ),
    "utf8"
  );
  assertPrepareError(
    () => prepareApplicationV3Revision({
      applicationDraft: createDraftFromV3(predecessorApplication),
      predecessor: {
        kind: "v3",
        location: "registry-base",
        applicationBytes: duplicateBytes,
        packageSha256: HASH_B
      }
    }),
    "PREPARE_REVISION_PREDECESSOR_BYTES_INVALID"
  );
});

test("requires a validator-clean V3 root and an exact tagged predecessor shape", () => {
  const invalidPredecessor = createV3Application({ applicationRevision: "3" });
  invalidPredecessor.reviewState.inheritedApproval = true;
  const applicationDraft = createDraftFromV3(invalidPredecessor);
  applicationDraft.source.primary.revisionObjectId = "e".repeat(40);
  applicationDraft.source.primary.treeObjectId = "f".repeat(40);
  assertPrepareError(
    () => prepareApplicationV3Revision({
      applicationDraft,
      predecessor: {
        kind: "v3",
        location: "registry-base",
        applicationBytes: canonicalBytes(invalidPredecessor),
        packageSha256: HASH_B
      }
    }),
    "PREPARE_REVISION_PREDECESSOR_INVALID"
  );

  assertPrepareError(
    () => prepareApplicationV3Revision({
      applicationDraft: createApplicationDraft(),
      predecessor: { kind: "none", unexpected: "PRIVATE-TAG-SENTINEL" }
    }),
    "PREPARE_REVISION_PREDECESSOR_INVALID",
    "PRIVATE-TAG-SENTINEL"
  );
});

test("classifies only exact repository, commit, tree, and closure mutations as source-update", () => {
  const mutations = [
    ["repository-id", (draft) => { draft.source.primary.numericRepositoryId = "987654322"; }],
    ["repository-uri", (draft) => { draft.source.primary.repositoryUri = "https://github.com/example-builder/renamed-project"; }],
    ["commit", (draft) => { draft.source.primary.revisionObjectId = "e".repeat(40); }],
    ["tree", (draft) => { draft.source.primary.treeObjectId = "f".repeat(40); }],
    ["inline-closure", (draft) => { draft.source.primary.sourcePaths = [...draft.source.primary.sourcePaths, "src/Extra.sol"]; }],
    ["manifest-closure", (draft) => {
      draft.source.primary.sourceClosureMode = "manifest";
      draft.source.primary.sourcePaths = [];
      draft.source.primary.sourceManifest = {
        schemaId: "urn:programmable:source-closure-manifest:1.0.0",
        schemaVersion: "1.0.0",
        path: "source-closure-manifest.v1.json",
        sha256: HASH_C,
        byteLength: 100,
        blobObjectId: "e".repeat(40),
        entryCount: 10,
        fragmentCount: 1
      };
    }],
    ["companion-repository", (draft) => {
      draft.source.companions.push({
        ...structuredClone(draft.source.primary),
        id: "companion-one",
        numericRepositoryId: "987654322",
        repositoryUri: "https://github.com/example-builder/companion-one"
      });
    }]
  ];
  for (const [label, mutate] of mutations) {
    const predecessorApplication = createV3Application({ applicationRevision: "5" });
    const applicationDraft = createDraftFromV3(predecessorApplication);
    mutate(applicationDraft);
    const result = prepareApplicationV3Revision({
      applicationDraft,
      predecessor: {
        kind: "v3",
        location: "registry-base",
        applicationBytes: canonicalBytes(predecessorApplication),
        packageSha256: HASH_B
      }
    });
    assert.equal(result.application.lineage.kind, "source-update", label);
    assert.equal(result.plan.sourceChanged, true, label);
  }
});

test("permits validator-consistent same-source review, security, and verification evidence as recheck", () => {
  const mutations = [
    ["review-package", (draft) => {
      draft.reviewPackage.records.find(({ kind }) => kind === "compatibility-report").sha256 = HASH_C;
    }],
    ["security-binding", (draft) => {
      draft.securityBindings.securityAssessmentSha256 = HASH_C;
      draft.reviewPackage.records.find(({ kind }) => kind === "security-assessment").sha256 = HASH_C;
    }],
    ["github-actions-evidence", (draft) => { draft.source.primary.githubActionsRunIds = ["999"]; }]
  ];
  for (const [label, mutate] of mutations) {
    const predecessorApplication = createV3Application({ applicationRevision: "6" });
    const applicationDraft = createDraftFromV3(predecessorApplication);
    mutate(applicationDraft);
    let result;
    assert.doesNotThrow(() => {
      result = prepareApplicationV3Revision({
        applicationDraft,
        predecessor: {
          kind: "v3",
          location: "registry-base",
          applicationBytes: canonicalBytes(predecessorApplication),
          packageSha256: HASH_B
        }
      });
    }, label);
    assert.equal(result.application.lineage.kind, "recheck", label);
    assert.equal(result.plan.sourceChanged, false, label);
  }
});

test("holds same-source normative product, policy, intent, declaration, or contract-path mutations", () => {
  const mutations = [
    ["product", (draft) => { draft.summary = "PRIVATE-NORMATIVE-PRODUCT-SENTINEL"; }],
    ["policy", (draft) => { draft.policyBindings.programmableFeePolicyVersion = "9.9.9"; }],
    ["intent", (draft) => { draft.intentCapture.facts[0].statement = "PRIVATE-NORMATIVE-INTENT-SENTINEL"; }],
    ["declaration", (draft) => { draft.declarations.publicInformationAcknowledged = false; }],
    ["contract-path", (draft) => { draft.source.primary.contractPaths = ["src/Other.sol"]; }]
  ];
  for (const [, mutate] of mutations) {
    const predecessorApplication = createV3Application({ applicationRevision: "7" });
    const applicationDraft = createDraftFromV3(predecessorApplication);
    mutate(applicationDraft);
    assertPrepareError(
      () => prepareApplicationV3Revision({
        applicationDraft,
        predecessor: {
          kind: "v3",
          location: "registry-base",
          applicationBytes: canonicalBytes(predecessorApplication),
          packageSha256: HASH_B
        }
      }),
      "PREPARE_REVISION_NORMATIVE_CHANGE_REQUIRES_SOURCE_UPDATE",
      "PRIVATE-NORMATIVE"
    );
  }
});

test("derives strict V2 schema-migration lineage from exact application and submission bytes", () => {
  const submission = createV2Submission();
  const submissionBytes = Buffer.from(`${JSON.stringify(submission, null, 2)}\n`, "utf8");
  const predecessorApplication = createV2Application({
    applicationRevision: 1_000_000,
    submissionSha256: sha256Bytes(submissionBytes),
    title: "PRIVATE-V2-PREDECESSOR-SENTINEL"
  });
  const predecessorBytes = canonicalBytes(predecessorApplication);
  const applicationDraft = createApplicationDraft();
  const originalDraft = structuredClone(applicationDraft);
  const originalPredecessorBytes = Buffer.from(predecessorBytes);
  const originalSubmissionBytes = Buffer.from(submissionBytes);

  const result = prepareApplicationV3Revision({
    applicationDraft,
    predecessor: {
      kind: "v2",
      location: "registry-base",
      applicationBytes: predecessorBytes,
      submissionBytes,
      packageSha256: HASH_C
    }
  });

  assert.deepEqual(applicationDraft, originalDraft);
  assert.deepEqual(predecessorBytes, originalPredecessorBytes);
  assert.deepEqual(submissionBytes, originalSubmissionBytes);
  assert.equal(result.application.applicationRevision, "1000001");
  assert.equal(result.application.lineage.kind, "schema-migration");
  assert.deepEqual(result.application.lineage.previous, {
    applicationContract: "public-pr-application-v2",
    applicationSchemaVersion: 2,
    applicationRevision: "1000000",
    applicationSha256: sha256Bytes(predecessorBytes),
    packageSha256: HASH_C,
    sourceNumericRepositoryId: predecessorApplication.source.primary.numericRepositoryId,
    sourceCommit: predecessorApplication.source.primary.revisionObjectId,
    sourceTree: predecessorApplication.source.primary.treeObjectId,
    submissionSchemaId: "urn:programmable:v4-hook-submission:1.6.0",
    submissionStandard: "1.6.0",
    submissionPath: predecessorApplication.programmableFee.submissionBinding.path,
    submissionSha256: sha256Bytes(submissionBytes),
    feePolicyId: "programmable-volume-fee-v1",
    feePolicyVersion: "1.1.0",
    feeApplicability: "unresolved",
    feePolicyInstanceSha256: null
  });
  assert.equal(result.plan.mode, "legacy-schema-migration");
  assert.equal(result.plan.sourceChanged, false);
  assert.equal(JSON.stringify(result.plan).includes("PRIVATE-V2-PREDECESSOR-SENTINEL"), false);
  assert.deepEqual(result.plan.target, {
    githubNextAction: "submit",
    pullRequestNumber: null
  });
});

test("rejects duplicate keys in exact V2 migration submission bytes", () => {
  const submission = createV2Submission();
  const canonicalSubmission = `${JSON.stringify(submission)}\n`;
  const duplicateSubmissionBytes = Buffer.from(
    canonicalSubmission.replace(
      '"standardVersion":"1.6.0"',
      '"standardVersion":"1.5.0","standardVersion":"1.6.0"'
    ),
    "utf8"
  );
  const predecessorApplication = createV2Application({
    applicationRevision: 4,
    submissionSha256: sha256Bytes(duplicateSubmissionBytes)
  });
  assertPrepareError(
    () => prepareApplicationV3Revision({
      applicationDraft: createApplicationDraft(),
      predecessor: {
        kind: "v2",
        location: "registry-base",
        applicationBytes: canonicalBytes(predecessorApplication),
        submissionBytes: duplicateSubmissionBytes,
        packageSha256: HASH_C
      }
    }),
    "PREPARE_REVISION_V2_SUBMISSION_MISMATCH"
  );
});

test("rejects V2 submission drift and unsupported historical contracts with privacy-safe codes", () => {
  const predecessorApplication = createV2Application({
    applicationRevision: 2,
    submissionSha256: HASH_A
  });
  assertPrepareError(
    () => prepareApplicationV3Revision({
      applicationDraft: createApplicationDraft(),
      predecessor: {
        kind: "v2",
        location: "registry-base",
        applicationBytes: canonicalBytes(predecessorApplication),
        submissionBytes: Buffer.from("PRIVATE-V2-SUBMISSION-SENTINEL", "utf8"),
        packageSha256: HASH_C
      }
    }),
    "PREPARE_REVISION_V2_SUBMISSION_MISMATCH",
    "PRIVATE-V2-SUBMISSION-SENTINEL"
  );

  assertPrepareError(
    () => prepareApplicationV3Revision({
      applicationDraft: createApplicationDraft(),
      predecessor: { kind: "v1" }
    }),
    "PREPARE_REVISION_PREDECESSOR_UNSUPPORTED"
  );
});

test("keeps V2 lineage as schema-migration even when the target source binding changes", () => {
  const submissionBytes = Buffer.from(`${JSON.stringify(createV2Submission())}\n`, "utf8");
  const predecessorApplication = createV2Application({
    applicationRevision: 12,
    submissionSha256: sha256Bytes(submissionBytes)
  });
  const applicationDraft = createApplicationDraft();
  applicationDraft.source.primary.revisionObjectId = "e".repeat(40);
  applicationDraft.source.primary.treeObjectId = "f".repeat(40);

  const result = prepareApplicationV3Revision({
    applicationDraft,
    predecessor: {
      kind: "v2",
      location: "registry-base",
      applicationBytes: canonicalBytes(predecessorApplication),
      submissionBytes,
      packageSha256: HASH_C
    }
  });

  assert.equal(result.application.applicationRevision, "13");
  assert.equal(result.application.lineage.kind, "schema-migration");
  assert.equal(result.plan.sourceChanged, true);
});

function createApplicationDraft(overrides = {}) {
  const draft = structuredClone(V3_TEMPLATE);
  delete draft.applicationRevision;
  delete draft.lineage;
  return Object.assign(draft, overrides);
}

function createV3Application({ applicationRevision, ...overrides }) {
  const application = createApplicationDraft(overrides);
  application.applicationRevision = applicationRevision;
  application.lineage = applicationRevision === "1"
    ? { kind: "new", previous: null }
    : { kind: "recheck", previous: previousBindingFixture(applicationRevision, application) };
  return application;
}

function createDraftFromV3(application) {
  const draft = structuredClone(application);
  delete draft.applicationRevision;
  delete draft.lineage;
  return draft;
}

function previousBindingFixture(applicationRevision, application) {
  return {
    applicationContract: "public-pr-application-v3",
    applicationSchemaVersion: 3,
    applicationRevision: (BigInt(applicationRevision) - 1n).toString(),
    applicationSha256: HASH_A,
    packageSha256: HASH_B,
    sourceNumericRepositoryId: application.source.primary.numericRepositoryId,
    sourceCommit: application.source.primary.revisionObjectId,
    sourceTree: application.source.primary.treeObjectId,
    submissionSchemaId: "urn:programmable:v4-hook-submission:2.0.0",
    submissionStandard: "2.0.0",
    submissionPath: application.policyBindings.submissionPath,
    submissionSha256: application.policyBindings.submissionSha256,
    feePolicyId: application.policyBindings.programmableFeePolicyId,
    feePolicyVersion: application.policyBindings.programmableFeePolicyVersion,
    feeApplicability: application.policyBindings.feeApplicability,
    feePolicyInstanceSha256: application.policyBindings.feePolicyInstanceSha256
  };
}

function createV2Submission() {
  return {
    $schema: "urn:programmable:v4-hook-submission:1.6.0",
    schemaVersion: 1,
    standardVersion: "1.6.0",
    stage: "proposal",
    model: {
      id: "legacy-open-world-example",
      name: "Legacy open-world example",
      summary: "A fixed historical source submission for lineage projection."
    }
  };
}

function createV2Application({ applicationRevision, submissionSha256, title = "Legacy predecessor" }) {
  return {
    schemaVersion: 2,
    applicationId: "legacy-open-world-example",
    applicationRevision,
    title,
    builder: {
      githubUserId: V3_TEMPLATE.builder.githubUserId
    },
    source: {
      primary: {
        numericRepositoryId: V3_TEMPLATE.source.primary.numericRepositoryId,
        repositoryUri: V3_TEMPLATE.source.primary.repositoryUri,
        revisionObjectId: V3_TEMPLATE.source.primary.revisionObjectId,
        treeObjectId: V3_TEMPLATE.source.primary.treeObjectId
      }
    },
    programmableFee: {
      policyId: "programmable-volume-fee-v1",
      policyVersion: "1.1.0",
      submissionBinding: {
        path: "submissions/legacy-open-world-example/submission.json",
        sha256: submissionSha256
      }
    }
  };
}

function canonicalBytes(value) {
  return Buffer.from(`${canonicalJson(value)}\n`, "utf8");
}

function assertPrepareError(action, code, forbiddenText = null) {
  assert.throws(action, (error) => {
    assert.equal(error instanceof ApplicationV3PrepareRevisionError, true);
    assert.equal(error.code, code);
    assert.equal(error.exitCode, 1);
    assert.equal(error.writePerformed, false);
    assert.equal(error.networkAccessed, false);
    assert.equal(error.candidateCodeExecuted, false);
    assert.deepEqual(error.externalActionsPerformed, []);
    assert.equal(error.approvalGranted, false);
    assert.equal(error.launchAuthorizationGranted, false);
    if (forbiddenText !== null) {
      assert.equal(error.message.includes(forbiddenText), false);
      assert.equal(JSON.stringify(error.details).includes(forbiddenText), false);
    }
    return true;
  });
}
