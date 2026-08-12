import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveDependencyAwareSecurityAssessment,
  inspectDependencyPointerCoverage
} from "../application-dependency-core.mjs";

const emptyCoverage = Object.freeze({
  schemaVersion: "1.0.0",
  pointerCount: 0,
  pointerRecordsSha256: "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  sourceCriticalDereferenceState: "NONE",
  counts: Object.freeze({
    symlink: 0,
    gitlink: 0,
    gitLfs: 0,
    internalVerified: 0,
    targetVerified: 0,
    unresolved: 0,
    sourceCritical: 0,
    runtimeAssetDelegated: 0,
    unclassified: 0
  })
});

test("coverage inspection is closed and treats legacy missing reports as a hold", () => {
  assert.deepEqual(inspectDependencyPointerCoverage([
    { repositoryRef: "primary", verificationReport: { dependencyPointerCoverage: emptyCoverage } }
  ]), {
    state: "VERIFIED",
    missingRepositoryRefs: [],
    unresolvedRepositoryRefs: []
  });

  assert.deepEqual(inspectDependencyPointerCoverage([
    { repositoryRef: "legacy", verificationReport: {} }
  ]), {
    state: "LEGACY_MISSING",
    missingRepositoryRefs: ["legacy"],
    unresolvedRepositoryRefs: []
  });

  const extended = structuredClone(emptyCoverage);
  extended.unexpected = true;
  assert.throws(
    () => inspectDependencyPointerCoverage([{ repositoryRef: "primary", verificationReport: { dependencyPointerCoverage: extended } }]),
    (error) => error?.code === "DEPENDENCY_POINTER_COVERAGE_INVALID"
  );

  const unaccountedPointer = structuredClone(emptyCoverage);
  unaccountedPointer.pointerCount = 1;
  unaccountedPointer.pointerRecordsSha256 = `sha256:${"a".repeat(64)}`;
  unaccountedPointer.counts.gitLfs = 1;
  unaccountedPointer.counts.unresolved = 1;
  assert.throws(
    () => inspectDependencyPointerCoverage([{ repositoryRef: "primary", verificationReport: { dependencyPointerCoverage: unaccountedPointer } }]),
    (error) => error?.code === "DEPENDENCY_POINTER_COVERAGE_INVALID"
  );

  const callerDelegated = structuredClone(unaccountedPointer);
  callerDelegated.counts.runtimeAssetDelegated = 1;
  assert.throws(
    () => inspectDependencyPointerCoverage([{ repositoryRef: "primary", verificationReport: { dependencyPointerCoverage: callerDelegated } }]),
    (error) => error?.code === "DEPENDENCY_POINTER_COVERAGE_INVALID"
  );
});

test("coverage inspection requires unique nonempty refs and exact declared primary plus companions", () => {
  assert.throws(
    () => inspectDependencyPointerCoverage([
      { repositoryRef: null, verificationReport: { dependencyPointerCoverage: emptyCoverage } }
    ]),
    (error) => error?.code === "DEPENDENCY_POINTER_COVERAGE_INVALID"
  );
  assert.throws(
    () => inspectDependencyPointerCoverage([
      { repositoryRef: "primary", verificationReport: { dependencyPointerCoverage: emptyCoverage } },
      { repositoryRef: "primary", verificationReport: { dependencyPointerCoverage: emptyCoverage } }
    ]),
    (error) => error?.code === "DEPENDENCY_POINTER_COVERAGE_INVALID"
  );
  assert.throws(
    () => inspectDependencyPointerCoverage([
      { repositoryRef: "unknown", verificationReport: { dependencyPointerCoverage: emptyCoverage } }
    ], { declaredRepositoryRefs: ["primary"] }),
    (error) => error?.code === "DEPENDENCY_POINTER_COVERAGE_REPOSITORY_MISMATCH"
  );
  assert.throws(
    () => inspectDependencyPointerCoverage([
      { repositoryRef: "primary", verificationReport: { dependencyPointerCoverage: emptyCoverage } }
    ], { declaredRepositoryRefs: ["primary", "companion"] }),
    (error) => error?.code === "DEPENDENCY_POINTER_COVERAGE_REPOSITORY_MISMATCH"
  );
});

test("coverage state cannot contradict closed resolution counts and never echoes repository content", () => {
  const privateMarker = "private-source-marker-never-echo";
  for (const contradictory of [
    pointerCoverage({
      state: "VERIFIED",
      internalVerified: 0,
      targetVerified: 0,
      unresolved: 1
    }),
    pointerCoverage({
      state: "UNRESOLVED",
      internalVerified: 1,
      targetVerified: 0,
      unresolved: 0
    })
  ]) {
    assert.throws(
      () => inspectDependencyPointerCoverage([{
        repositoryRef: privateMarker,
        verificationReport: { dependencyPointerCoverage: contradictory }
      }]),
      (error) => {
        assert.equal(error?.code, "DEPENDENCY_POINTER_COVERAGE_INVALID");
        assert.equal(String(error?.message).includes(privateMarker), false);
        return true;
      }
    );
  }
});

test("coverage state accepts fully resolved, fully unresolved, and mixed source-critical pointers", () => {
  for (const [repositoryRef, pointerSummary, expectedState] of [
    ["resolved", pointerCoverage({
      pointerCount: 2,
      state: "VERIFIED",
      internalVerified: 1,
      targetVerified: 1,
      unresolved: 0
    }), "VERIFIED"],
    ["unresolved", pointerCoverage({
      state: "UNRESOLVED",
      internalVerified: 0,
      targetVerified: 0,
      unresolved: 1
    }), "UNRESOLVED"],
    ["mixed", pointerCoverage({
      pointerCount: 2,
      state: "UNRESOLVED",
      internalVerified: 1,
      targetVerified: 0,
      unresolved: 1
    }), "UNRESOLVED"]
  ]) {
    assert.deepEqual(inspectDependencyPointerCoverage([{
      repositoryRef,
      verificationReport: { dependencyPointerCoverage: pointerSummary }
    }]), {
      state: expectedState,
      missingRepositoryRefs: [],
      unresolvedRepositoryRefs: expectedState === "UNRESOLVED" ? [repositoryRef] : []
    });
  }
});

test("unresolved source-critical targets mechanically lower security to one exact partial reason", () => {
  const draft = sourceAssessedDraft();
  const sourceCoverage = [coverage("primary", unresolvedCoverage())];
  const derived = deriveDependencyAwareSecurityAssessment({
    draft,
    application: application(),
    sourceCoverage
  });

  assert.equal(derived.dependencyDisposition, "UNRESOLVED");
  assert.equal(derived.securityAssessment.assessment.state, "partial");
  assert.equal(derived.securityAssessment.assessment.reasonCode, "DEPENDENCY_TARGETS_UNRESOLVED");
  assert.equal(derived.securityAssessment.assessment.sourceCoverage, null);
  assert.deepEqual(derived.securityAssessment.assessment.evidenceRefs, [
    "review/source-closure/source-closure-manifest.v1.json",
    "source-verification.primary.v1.json"
  ]);
  assert.deepEqual(derived.securityAssessment.layers.source.evidenceRefs, [
    "review/source-closure/source-closure-manifest.v1.json",
    "source-review.json",
    "source-verification.primary.v1.json"
  ]);
  assert.equal(draft.assessment.state, "source-assessed");
});

test("NONE and VERIFIED dereference states preserve source-assessed coverage", () => {
  const sourceCoverage = [coverage("primary", emptyCoverage)];
  const derived = deriveDependencyAwareSecurityAssessment({
    draft: sourceAssessedDraft(),
    application: application(),
    sourceCoverage
  });

  assert.equal(derived.dependencyDisposition, "VERIFIED");
  assert.equal(derived.securityAssessment.assessment.state, "source-assessed");
  assert.equal(derived.securityAssessment.assessment.reasonCode, null);
  assert.deepEqual(derived.securityAssessment.assessment.sourceCoverage, {
    primaryRepositoryRef: "primary",
    repositories: [{
      repositoryRef: "primary",
      revisionObjectId: "1".repeat(40),
      treeObjectId: "2".repeat(40),
      sourceClosureMode: "manifest",
      sourcePaths: [],
      sourcePathsSha256: null,
      manifestPath: "review/source-closure/source-closure-manifest.v1.json",
      manifestSha256: `sha256:${"3".repeat(64)}`,
      manifestByteLength: 100,
      closureSha256: `sha256:${"4".repeat(64)}`,
      reportPath: "source-verification.primary.v1.json",
      reportSha256: `sha256:${"5".repeat(64)}`,
      reportByteLength: 200,
      result: "VERIFIED"
    }]
  });
});

test("missing pointer coverage cannot be downgraded or treated as verified", () => {
  assert.throws(
    () => deriveDependencyAwareSecurityAssessment({
      draft: sourceAssessedDraft(),
      application: application(),
      sourceCoverage: [{
        ...coverage("primary", emptyCoverage),
        verificationReport: { status: "VERIFIED", sourceClosureVerified: true }
      }]
    }),
    (error) => error?.code === "DEPENDENCY_POINTER_COVERAGE_MISSING"
  );
});

function unresolvedCoverage() {
  return {
    schemaVersion: "1.0.0",
    pointerCount: 1,
    pointerRecordsSha256: `sha256:${"a".repeat(64)}`,
    sourceCriticalDereferenceState: "UNRESOLVED",
    counts: {
      symlink: 0,
      gitlink: 1,
      gitLfs: 0,
      internalVerified: 0,
      targetVerified: 0,
      unresolved: 1,
      sourceCritical: 1,
      runtimeAssetDelegated: 0,
      unclassified: 1
    }
  };
}

function pointerCoverage({
  pointerCount = 1,
  state,
  internalVerified,
  targetVerified,
  unresolved
}) {
  return {
    schemaVersion: "1.0.0",
    pointerCount,
    pointerRecordsSha256: `sha256:${"b".repeat(64)}`,
    sourceCriticalDereferenceState: state,
    counts: {
      symlink: pointerCount,
      gitlink: 0,
      gitLfs: 0,
      internalVerified,
      targetVerified,
      unresolved,
      sourceCritical: pointerCount,
      runtimeAssetDelegated: 0,
      unclassified: 0
    }
  };
}

function sourceAssessedDraft() {
  return {
    schemaVersion: "open-world-security-v1",
    subject: { id: "old", revision: "0".repeat(40), stage: "proposal" },
    assessment: {
      state: "source-assessed",
      reasonCode: null,
      evidenceRefs: [],
      sourceCoverage: { primaryRepositoryRef: "old", repositories: [] }
    },
    layers: {
      source: { evidenceRefs: ["source-review.json"], customProfiles: [] }
    },
    extensions: []
  };
}

function application() {
  return {
    applicationId: "pointer-aware-app",
    stage: "prototype",
    source: {
      primary: { id: "primary", revisionObjectId: "1".repeat(40) },
      companions: []
    }
  };
}

function coverage(repositoryRef, dependencyPointerCoverage) {
  return {
    repositoryRef,
    revisionObjectId: "1".repeat(40),
    treeObjectId: "2".repeat(40),
    sourceClosureMode: "manifest",
    sourcePaths: [],
    sourcePathsSha256: null,
    manifestPath: "review/source-closure/source-closure-manifest.v1.json",
    manifestSha256: `sha256:${"3".repeat(64)}`,
    manifestByteLength: 100,
    closureSha256: `sha256:${"4".repeat(64)}`,
    verificationReportPath: `source-verification.${repositoryRef}.v1.json`,
    verificationReportSha256: `sha256:${"5".repeat(64)}`,
    verificationReportByteLength: 200,
    verificationReport: {
      status: "VERIFIED",
      sourceClosureVerified: true,
      dependencyPointerCoverage
    }
  };
}
