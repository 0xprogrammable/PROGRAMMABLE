import assert from "node:assert/strict";
import childProcess from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import {
  canonicalJson,
  classifyPublicIntakePullRequest,
  fetchPublicApplicationCandidate,
  hydratePublicApplicationCandidate,
  measureHydrationDirectory,
  preflightPublicApplicationCandidateFetch,
  PUBLIC_BETA_DISCLAIMER,
  runBoundedHydrationGitProcess,
  validatePublicApplicationPackageFiles,
  verifyPublicHookApplication
} from "../verify-public-hook-application-core.mjs";

const PULL_REQUEST_NUMBER = "7";
const BUILDER_USER_ID = "9007199254740993";
const PRIMARY = Object.freeze({
  repositoryUri: "https://github.com/alice/example-hook",
  numericRepositoryId: "123456789",
  revisionObjectId: "a".repeat(40),
  treeObjectId: "b".repeat(40),
  sourcePaths: ["compatibility-report.json", "test/ExampleHook.t.sol"],
  contractPaths: ["src/ExampleHook.sol"],
  githubActionsRunIds: ["123"]
});

test("blobless maintenance classification never materializes an unexpected 100 MB candidate blob", async (t) => {
  const fixture = createRevisionPair(t);
  writeFile(
    fixture.candidate,
    "skills/programmable-v4-hook-builder/SKILL.md",
    "---\nname: programmable-v4-hook-builder\ndescription: candidate data only\n---\n"
  );
  const oversizedPath = path.join(
    fixture.candidate,
    "skills/programmable-v4-hook-builder/assets/unexpected-100mb.bin"
  );
  fs.mkdirSync(path.dirname(oversizedPath), { recursive: true });
  fs.closeSync(fs.openSync(oversizedPath, "w"));
  fs.truncateSync(oversizedPath, 100 * 1024 * 1024);

  const candidateCommit = commitAll(fixture.candidate, "candidate maintenance with unexpected large blob");
  const mergeCommit = createPullRequestMerge(fixture, candidateCommit);
  const oversizedObjectId = blobObjectIdAtPath(
    fixture.candidate,
    "skills/programmable-v4-hook-builder/assets/unexpected-100mb.bin"
  );
  const candidateData = await fetchBloblessPullRequestMerge(fixture, mergeCommit);

  assert.equal(hasObjectWithoutLazyFetch(candidateData, oversizedObjectId), false);
  const classified = classifyPublicIntakePullRequest({
    baseRoot: fixture.base,
    candidateRoot: candidateData,
    expectedBaseCommit: fixture.baseCommit,
    expectedCandidateCommit: candidateCommit,
    expectedMergeCommit: mergeCommit
  });
  assert.equal(classified.mode, "builder-maintenance");
  assert.equal(hasObjectWithoutLazyFetch(candidateData, oversizedObjectId), false);
  assert.equal(fs.existsSync(path.join(candidateData, "skills")), false);
});

test("bounded repository measurement tolerates Git removing a temporary child directory", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "public-hook-measure-race-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const stableBytes = Buffer.from("stable object bytes");
  fs.writeFileSync(path.join(root, "stable-object"), stableBytes);
  const transientDirectory = path.join(root, "temporary-pack");
  fs.mkdirSync(transientDirectory);
  fs.writeFileSync(path.join(transientDirectory, "in-flight.pack"), "temporary bytes");

  const originalLstatSync = fs.lstatSync;
  let removed = false;
  fs.lstatSync = function lstatAndRemoveTemporaryDirectory(target, options) {
    const status = originalLstatSync.call(fs, target, options);
    if (!removed && target === transientDirectory) {
      removed = true;
      fs.rmSync(transientDirectory, { recursive: true, force: true });
    }
    return status;
  };
  try {
    assert.equal(measureHydrationDirectory(root), stableBytes.length);
  } finally {
    fs.lstatSync = originalLstatSync;
  }
  assert.equal(removed, true);
});

test("trusted application validation hydrates only the six closed package blobs", async (t) => {
  const fixture = createRevisionPair(t);
  const packageFiles = makePackage();
  writePackage(fixture.candidate, packageFiles);
  const candidateCommit = commitAll(fixture.candidate, "valid closed application package");
  const mergeCommit = createPullRequestMerge(fixture, candidateCommit);
  const candidateData = await fetchBloblessPullRequestMerge(fixture, mergeCommit);
  const packageObjectIds = [...packageFiles.keys()].map((fileName) =>
    blobObjectIdAtPath(fixture.candidate, `submissions/example-hook/${fileName}`)
  );
  const unrelatedBaseObjectId = blobObjectIdAtPath(fixture.base, "README.md");

  assert.ok(packageObjectIds.every((objectId) => !hasObjectWithoutLazyFetch(candidateData, objectId)));
  assert.equal(hasObjectWithoutLazyFetch(candidateData, unrelatedBaseObjectId), false);

  const hydration = await hydratePublicApplicationCandidate({
    baseRoot: fixture.base,
    candidateRoot: candidateData,
    expectedBaseCommit: fixture.baseCommit,
    expectedCandidateCommit: candidateCommit,
    expectedMergeCommit: mergeCommit,
    pullRequestNumber: PULL_REQUEST_NUMBER,
    repository: "central/repository",
    readToken: "test-read-token"
  }, localHydrationDependencies(fixture));
  assert.deepEqual(
    { result: hydration.result, fileCount: hydration.fileCount },
    { result: "bounded-application-blobs-hydrated", fileCount: 6 }
  );

  const report = await verifyPublicHookApplication({
    baseRoot: fixture.base,
    candidateRoot: candidateData,
    expectedBaseCommit: fixture.baseCommit,
    pullRequestNumber: PULL_REQUEST_NUMBER,
    expectedBuilderLogin: "alice",
    expectedBuilderUserId: BUILDER_USER_ID,
    expectedCandidateCommit: candidateCommit,
    expectedMergeCommit: mergeCommit,
    resolveSource: exactSourceResolver,
    resolveEvidence: exactEvidenceResolver
  });

  assert.equal(report.result, "valid-public-application-package");
  assert.ok(packageObjectIds.every((objectId) => hasObjectWithoutLazyFetch(candidateData, objectId)));
  assert.equal(hasObjectWithoutLazyFetch(candidateData, unrelatedBaseObjectId), false);
  assert.equal(fs.existsSync(path.join(candidateData, "submissions")), false);
});

test("candidate package cannot remove the mandatory companion closure receipt index", () => {
  const packageFiles = makePackage();
  const application = JSON.parse(packageFiles.get("application.json").toString("utf8"));
  delete application.companionClosure;
  packageFiles.set("application.json", jsonBytes(application));
  assert.throws(
    () => validatePublicApplicationPackageFiles({ applicationId: "example-hook", packageFiles }),
    (error) => error?.code === "OBJECT_NOT_CLOSED" && error?.kind === "candidate"
  );
});

test("an allowlisted 100 MB blob is rejected from metadata before hydration", async (t) => {
  const fixture = createRevisionPair(t);
  writePackage(fixture.candidate, makePackage());
  const oversizedPath = path.join(fixture.candidate, "submissions/example-hook/PROPOSAL.md");
  fs.closeSync(fs.openSync(oversizedPath, "w"));
  fs.truncateSync(oversizedPath, 100 * 1024 * 1024);
  const candidateCommit = commitAll(fixture.candidate, "oversized allowlisted application blob");
  const mergeCommit = createPullRequestMerge(fixture, candidateCommit);
  const oversizedObjectId = blobObjectIdAtPath(fixture.candidate, "submissions/example-hook/PROPOSAL.md");
  const candidateData = await fetchBloblessPullRequestMerge(fixture, mergeCommit);

  assert.equal(hasObjectWithoutLazyFetch(candidateData, oversizedObjectId), false);
  await assert.rejects(
    hydratePublicApplicationCandidate({
      baseRoot: fixture.base,
      candidateRoot: candidateData,
      expectedBaseCommit: fixture.baseCommit,
      expectedCandidateCommit: candidateCommit,
      expectedMergeCommit: mergeCommit,
      pullRequestNumber: PULL_REQUEST_NUMBER,
      repository: "central/repository",
      readToken: "test-read-token"
    }, localHydrationDependencies(fixture)),
    (error) => error?.code === "APPLICATION_FILE_TOO_LARGE" && error?.kind === "candidate"
  );
  assert.equal(hasObjectWithoutLazyFetch(candidateData, oversizedObjectId), false);
  assert.equal(fs.existsSync(path.join(candidateData, "submissions")), false);
});

test("bounded hydration enforces a hard child file-size limit", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "public-hook-hydration-fsize-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const outputPath = path.join(root, "oversized.pack");
  const executable = writeExecutable(root, "write-too-much.sh", [
    "#!/bin/bash",
    `dd if=/dev/zero of=${shellQuote(outputPath)} bs=1048576 count=4 status=none`,
    ""
  ].join("\n"));
  const result = await runBoundedHydrationGitProcess({
    gitExecutable: executable,
    gitDirectory: root,
    args: ["backfill", "--sparse"],
    timeoutMs: 5_000,
    maximumOutputBytes: 65_536,
    maximumFileSizeBytes: 64 * 1024,
    maximumRepositoryBytes: 2 * 1024 * 1024
  });
  assert.notEqual(result.status, 0);
  assert.equal(result.fileSizeExceeded, true);
  assert.ok(fs.statSync(outputPath).size <= 64 * 1024);
});

test("bounded hydration timeout kills the complete Git process group", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "public-hook-hydration-process-tree-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const childPidPath = path.join(root, "child.pid");
  const executable = writeExecutable(root, "spawn-child.sh", [
    "#!/bin/bash",
    "sleep 30 &",
    `printf '%s\\n' \"$!\" > ${shellQuote(childPidPath)}`,
    "wait",
    ""
  ].join("\n"));
  const operation = runBoundedHydrationGitProcess({
    gitExecutable: executable,
    gitDirectory: root,
    args: ["backfill", "--sparse"],
    timeoutMs: 5_000,
    maximumOutputBytes: 65_536,
    maximumFileSizeBytes: 64 * 1024,
    maximumRepositoryBytes: 2 * 1024 * 1024
  });
  const childReady = await waitForRegularFile(childPidPath, 4_000);
  const childPid = childReady ? Number(fs.readFileSync(childPidPath, "utf8").trim()) : NaN;
  assert.equal(childReady, true, "the descendant must be running before the timeout assertion");
  assert.ok(Number.isInteger(childPid) && childPid > 1);
  assert.doesNotThrow(() => process.kill(childPid, 0));
  const result = await operation;
  assert.equal(result.timedOut, true);
  await waitForProcessExit(childPid);
});

test("trusted closed intake blocks application data before candidate Git fetch", async (t) => {
  for (const [intakeState, expectedCode] of [
    ["prelaunch", "INTAKE_PRELAUNCH"],
    ["paused-new", "INTAKE_PAUSED_NEW"],
    ["paused-all", "INTAKE_PAUSED_ALL"]
  ]) {
    await t.test(intakeState, async (t2) => {
      const fixture = createRevisionPair(t2, { intakeState });
      const candidateRoot = path.join(fixture.root, "candidate.git");
      const candidateCommit = "b".repeat(40);
      let runFetchCalled = false;
      await assert.rejects(
        fetchPublicApplicationCandidate({
          baseRoot: fixture.base,
          candidateRoot,
          repository: "central/repository",
          pullRequestNumber: PULL_REQUEST_NUMBER,
          expectedBaseCommit: fixture.baseCommit,
          expectedCandidateCommit: candidateCommit,
          readToken: "test-read-token"
        }, {
          fetchImplementation: createPullRequestMetadataFetch({
            baseCommit: fixture.baseCommit,
            candidateCommit,
            files: [{ filename: "submissions/example-hook/application.json", status: "added" }]
          }),
          async runFetch() {
            runFetchCalled = true;
            assert.fail("closed application intake must stop before candidate Git fetch");
          }
        }),
        (error) => error?.code === expectedCode && error?.kind === "system"
      );
      assert.equal(runFetchCalled, false);
      assert.equal(fs.existsSync(candidateRoot), false);
    });
  }
});

test("closed intake metadata preflight still permits maintenance and existing paused-new updates", async (t) => {
  const maintenance = createRevisionPair(t, { intakeState: "prelaunch" });
  const maintenanceHead = "b".repeat(40);
  const maintenanceMerge = "c".repeat(40);
  const maintenanceReport = await preflightPublicApplicationCandidateFetch({
    baseRoot: maintenance.base,
    expectedBaseCommit: maintenance.baseCommit,
    expectedCandidateCommit: maintenanceHead,
    expectedMergeCommit: maintenanceMerge,
    repository: "central/repository",
    pullRequestNumber: PULL_REQUEST_NUMBER,
    readToken: "test-read-token"
  }, {
    fetchImplementation: createPullRequestMetadataFetch({
      baseCommit: maintenance.baseCommit,
      candidateCommit: maintenanceHead,
      mergeCommit: maintenanceMerge,
      files: [{ filename: "skills/programmable-v4-hook-builder/SKILL.md", status: "modified" }]
    })
  });
  assert.equal(maintenanceReport.modeHint, "non-application");

  const update = createRevisionPair(t, { intakeState: "paused-new", existingApplication: true });
  const updateHead = "d".repeat(40);
  const updateMerge = "e".repeat(40);
  const updateReport = await preflightPublicApplicationCandidateFetch({
    baseRoot: update.base,
    expectedBaseCommit: update.baseCommit,
    expectedCandidateCommit: updateHead,
    expectedMergeCommit: updateMerge,
    repository: "central/repository",
    pullRequestNumber: PULL_REQUEST_NUMBER,
    readToken: "test-read-token"
  }, {
    fetchImplementation: createPullRequestMetadataFetch({
      baseCommit: update.baseCommit,
      candidateCommit: updateHead,
      mergeCommit: updateMerge,
      files: [{ filename: "submissions/example-hook/application.json", status: "modified" }]
    })
  });
  assert.equal(updateReport.modeHint, "application-update");
});

test("candidate preflight rejects a programmatic numeric pull-request identity", async (t) => {
  const fixture = createRevisionPair(t, { intakeState: "open" });
  await assert.rejects(
    preflightPublicApplicationCandidateFetch({
      baseRoot: fixture.base,
      expectedBaseCommit: fixture.baseCommit,
      expectedCandidateCommit: "b".repeat(40),
      expectedMergeCommit: "c".repeat(40),
      repository: "central/repository",
      pullRequestNumber: 7,
      readToken: "test-read-token"
    }, {
      fetchImplementation: async () => assert.fail("invalid identity must stop before GitHub metadata")
    }),
    (error) => error?.code === "CANDIDATE_FETCH_ID_INVALID" && error?.kind === "system"
  );
});

test("paused-new preflight permits only the exact trusted PR and application pair", async (t) => {
  const fixture = createRevisionPair(t, {
    intakeState: "paused-new",
    continuingPullRequests: [continuationRecord()]
  });
  const candidateCommit = "b".repeat(40);
  const mergeCommit = "c".repeat(40);
  const files = [...makePackage().keys()].map((fileName) => ({
    filename: `submissions/example-hook/${fileName}`,
    status: "added"
  }));
  const report = await preflightPublicApplicationCandidateFetch({
    baseRoot: fixture.base,
    expectedBaseCommit: fixture.baseCommit,
    expectedCandidateCommit: candidateCommit,
    expectedMergeCommit: mergeCommit,
    repository: "central/repository",
    pullRequestNumber: PULL_REQUEST_NUMBER,
    readToken: "test-read-token"
  }, {
    fetchImplementation: createPullRequestMetadataFetch({
      baseCommit: fixture.baseCommit,
      candidateCommit,
      mergeCommit,
      files
    })
  });
  assert.equal(report.modeHint, "application-continuation");
  assert.equal(report.pullRequestNumber, PULL_REQUEST_NUMBER);
  assert.equal(report.continuationAuthorized, true);

  for (const [name, continuingPullRequests] of [
    ["wrong application", [continuationRecord({ applicationId: "other-hook" })]],
    ["wrong pull request", [continuationRecord({ pullRequestNumber: "8" })]],
    ["empty allowlist", []]
  ]) {
    await t.test(name, async (t2) => {
      const blocked = createRevisionPair(t2, { intakeState: "paused-new", continuingPullRequests });
      await assert.rejects(
        preflightPublicApplicationCandidateFetch({
          baseRoot: blocked.base,
          expectedBaseCommit: blocked.baseCommit,
          expectedCandidateCommit: candidateCommit,
          expectedMergeCommit: mergeCommit,
          repository: "central/repository",
          pullRequestNumber: PULL_REQUEST_NUMBER,
          readToken: "test-read-token"
        }, {
          fetchImplementation: createPullRequestMetadataFetch({
            baseCommit: blocked.baseCommit,
            candidateCommit,
            mergeCommit,
            files
          })
        }),
        (error) => error?.code === "INTAKE_PAUSED_NEW" && error?.kind === "system"
      );
    });
  }
});

test("the 32-record worst-case continuation status stays within its enforced byte bound", async (t) => {
  const companionNumericRepositoryIds = Array.from({ length: 8 }, (_, index) => String(index + 1).repeat(64));
  const continuingPullRequests = Array.from({ length: 32 }, (_, index) => ({
    applicationId: `hook-${String(index).padStart(2, "0")}-${"a".repeat(70)}`,
    builderGitHubUserId: "8".repeat(64),
    companionNumericRepositoryIds,
    primaryNumericRepositoryId: "9".repeat(64),
    pullRequestNumber: (90_000_000_000_000_000_00n + BigInt(index)).toString()
  }));
  const statusSource = `${canonicalJson({
    continuingPullRequests,
    schemaVersion: 2,
    state: "paused-new"
  })}\n`;
  assert.ok(Buffer.byteLength(statusSource, "utf8") <= 32 * 1024);

  const fixture = createRevisionPair(t, { intakeState: "paused-new", continuingPullRequests });
  const candidateCommit = "b".repeat(40);
  const mergeCommit = "c".repeat(40);
  const report = await preflightPublicApplicationCandidateFetch({
    baseRoot: fixture.base,
    expectedBaseCommit: fixture.baseCommit,
    expectedCandidateCommit: candidateCommit,
    expectedMergeCommit: mergeCommit,
    repository: "central/repository",
    pullRequestNumber: PULL_REQUEST_NUMBER,
    readToken: "test-read-token"
  }, {
    fetchImplementation: createPullRequestMetadataFetch({
      baseCommit: fixture.baseCommit,
      candidateCommit,
      mergeCommit,
      files: [{ filename: "skills/programmable-v4-hook-builder/SKILL.md", status: "modified" }]
    })
  });
  assert.equal(report.modeHint, "non-application");
});

test("hydration and final verification rebind a continuation to trusted builder and repository lineage", async (t) => {
  const cases = [
    ["builder", (application) => { application.builder.githubUserId = "999"; }],
    ["primary", (application) => { application.source.primary.numericRepositoryId = "999"; }],
    ["companions", (application) => {
      application.source.companions = [{
        repositoryUri: "https://github.com/alice/companion",
        numericRepositoryId: "987654321",
        revisionObjectId: "c".repeat(40),
        treeObjectId: "d".repeat(40),
        sourcePaths: [],
        contractPaths: [],
        githubActionsRunIds: []
      }];
    }]
  ];
  for (const [name, mutate] of cases) {
    await t.test(name, async (t2) => {
      const fixture = createRevisionPair(t2, {
        intakeState: "paused-new",
        continuingPullRequests: [continuationRecord()]
      });
      const packageFiles = makePackage();
      const application = JSON.parse(packageFiles.get("application.json").toString("utf8"));
      mutate(application);
      packageFiles.set("application.json", jsonBytes(application));
      writePackage(fixture.candidate, packageFiles);
      const candidateCommit = commitAll(fixture.candidate, `continuation ${name} lineage swap`);
      const mergeCommit = createPullRequestMerge(fixture, candidateCommit);
      const candidateData = fetchBloblessPullRequestMergeWithoutIntake(fixture, mergeCommit);
      await assert.rejects(
        hydratePublicApplicationCandidate({
          baseRoot: fixture.base,
          candidateRoot: candidateData,
          expectedBaseCommit: fixture.baseCommit,
          expectedCandidateCommit: candidateCommit,
          expectedMergeCommit: mergeCommit,
          pullRequestNumber: PULL_REQUEST_NUMBER,
          repository: "central/repository",
          readToken: "test-read-token"
        }, localHydrationDependencies(fixture)),
        (error) => error?.code === "INTAKE_CONTINUATION_IDENTITY_MISMATCH" && error?.kind === "candidate"
      );
    });
  }
});

test("a fully bound paused-new continuation passes hydration and final verification", async (t) => {
  const fixture = createRevisionPair(t, {
    intakeState: "paused-new",
    continuingPullRequests: [continuationRecord()]
  });
  writePackage(fixture.candidate, makePackage());
  const candidateCommit = commitAll(fixture.candidate, "exact paused-new continuation");
  const mergeCommit = createPullRequestMerge(fixture, candidateCommit);
  const candidateData = fetchBloblessPullRequestMergeWithoutIntake(fixture, mergeCommit);
  const hydration = await hydratePublicApplicationCandidate({
    baseRoot: fixture.base,
    candidateRoot: candidateData,
    expectedBaseCommit: fixture.baseCommit,
    expectedCandidateCommit: candidateCommit,
    expectedMergeCommit: mergeCommit,
    pullRequestNumber: PULL_REQUEST_NUMBER,
    repository: "central/repository",
    readToken: "test-read-token"
  }, localHydrationDependencies(fixture));
  assert.equal(hydration.continuationAuthorized, true);

  const report = await verifyPublicHookApplication({
    baseRoot: fixture.base,
    candidateRoot: candidateData,
    expectedBaseCommit: fixture.baseCommit,
    expectedBuilderLogin: "alice",
    expectedBuilderUserId: BUILDER_USER_ID,
    expectedCandidateCommit: candidateCommit,
    expectedMergeCommit: mergeCommit,
    pullRequestNumber: PULL_REQUEST_NUMBER,
    resolveSource: exactSourceResolver,
    resolveEvidence: exactEvidenceResolver
  });
  assert.equal(report.continuationAuthorized, true);
  assert.equal(report.pullRequestNumber, PULL_REQUEST_NUMBER);
});

test("paused-new preflight rejects foreign, mixed, renamed, and deleted application paths before fetch", async (t) => {
  const fixture = createRevisionPair(t, { intakeState: "paused-new", existingApplication: true });
  const candidateCommit = "b".repeat(40);
  const mergeCommit = "c".repeat(40);
  const cases = [
    {
      name: "foreign application id",
      files: [{ filename: "submissions/foreign-hook/application.json", status: "modified" }],
      code: "INTAKE_PAUSED_NEW"
    },
    {
      name: "mixed central path",
      files: [
        { filename: "submissions/example-hook/application.json", status: "modified" },
        { filename: "README.md", status: "modified" }
      ],
      code: "CHANGED_PATH_NOT_ALLOWED"
    },
    {
      name: "renamed application path",
      files: [{
        filename: "submissions/example-hook/application.json",
        previous_filename: "submissions/foreign-hook/application.json",
        status: "renamed"
      }],
      code: "CHANGED_PATH_NOT_ALLOWED"
    },
    {
      name: "deleted application path",
      files: [{ filename: "submissions/example-hook/application.json", status: "removed" }],
      code: "CHANGED_PATH_NOT_ALLOWED"
    }
  ];
  for (const entry of cases) {
    await t.test(entry.name, async () => {
      await assert.rejects(
        preflightPublicApplicationCandidateFetch({
          baseRoot: fixture.base,
          expectedBaseCommit: fixture.baseCommit,
          expectedCandidateCommit: candidateCommit,
          repository: "central/repository",
          pullRequestNumber: PULL_REQUEST_NUMBER,
          readToken: "test-read-token"
        }, {
          fetchImplementation: createPullRequestMetadataFetch({
            baseCommit: fixture.baseCommit,
            candidateCommit,
            mergeCommit,
            files: entry.files
          })
        }),
        (error) => error?.code === entry.code
      );
    });
  }
});

test("candidate preflight binds exact GitHub base and head without removed merge metadata", async (t) => {
  const fixture = createRevisionPair(t, { intakeState: "prelaunch" });
  const candidateCommit = "b".repeat(40);
  for (const mismatch of ["base", "head"]) {
    await t.test(mismatch, async () => {
      const observedBase = mismatch === "base" ? "d".repeat(40) : fixture.baseCommit;
      const observedHead = mismatch === "head" ? "d".repeat(40) : candidateCommit;
      await assert.rejects(
        preflightPublicApplicationCandidateFetch({
          baseRoot: fixture.base,
          expectedBaseCommit: fixture.baseCommit,
          expectedCandidateCommit: candidateCommit,
          repository: "central/repository",
          pullRequestNumber: PULL_REQUEST_NUMBER,
          readToken: "test-read-token"
        }, {
          fetchImplementation: createPullRequestMetadataFetch({
            baseCommit: observedBase,
            candidateCommit: observedHead,
            files: [{ filename: "submissions/example-hook/application.json", status: "added" }]
          })
        }),
        (error) => error?.code === "CANDIDATE_PREFLIGHT_ID_MISMATCH" && error?.kind === "system"
      );
    });
  }
});

test("hydration enforces trusted intake state before GitHub tree metadata or backfill", async (t) => {
  const fixture = createRevisionPair(t, { intakeState: "prelaunch" });
  writePackage(fixture.candidate, makePackage());
  const candidateCommit = commitAll(fixture.candidate, "prelaunch application package");
  const mergeCommit = createPullRequestMerge(fixture, candidateCommit);
  const candidateData = fetchBloblessPullRequestMergeWithoutIntake(fixture, mergeCommit);
  let metadataCalled = false;

  await assert.rejects(
    hydratePublicApplicationCandidate({
      baseRoot: fixture.base,
      candidateRoot: candidateData,
      expectedBaseCommit: fixture.baseCommit,
      expectedCandidateCommit: candidateCommit,
      expectedMergeCommit: mergeCommit,
      pullRequestNumber: PULL_REQUEST_NUMBER,
      repository: "central/repository",
      readToken: "test-read-token"
    }, {
      fetchImplementation: async () => {
        metadataCalled = true;
        assert.fail("closed intake must stop before candidate tree metadata");
      }
    }),
    (error) => error?.code === "INTAKE_PRELAUNCH" && error?.kind === "system"
  );
  assert.equal(metadataCalled, false);
});

test("initial candidate fetch derives the merge id and immediately binds the event head", async (t) => {
  const fixture = createRevisionPair(t, { intakeState: "open" });
  writeFile(fixture.candidate, "skills/programmable-v4-hook-builder/SKILL.md", "candidate data\n");
  const candidateCommit = commitAll(fixture.candidate, "candidate revision");
  const mergeCommit = createPullRequestMerge(fixture, candidateCommit);
  git(fixture.candidate, ["update-ref", `refs/pull/${PULL_REQUEST_NUMBER}/merge`, mergeCommit]);
  git(fixture.candidate, ["config", "uploadpack.allowFilter", "true"]);
  const candidateData = path.join(fixture.root, "candidate.git");

  await assert.rejects(
    fetchPublicApplicationCandidate({
      baseRoot: fixture.base,
      candidateRoot: candidateData,
      repository: "central/repository",
      pullRequestNumber: PULL_REQUEST_NUMBER,
      expectedBaseCommit: fixture.baseCommit,
      expectedCandidateCommit: "d".repeat(40),
      readToken: "test-read-token"
    }, {
      remoteUrlForTests: pathToFileURL(fixture.candidate).href,
      allowFileProtocolForTests: true
    }),
    (error) => error?.code === "PR_MERGE_PARENT_MISMATCH" && error?.kind === "system"
  );
  assert.equal(fs.existsSync(candidateData), false);
});

test("initial candidate fetch rejects a giant pack and removes the token-bearing object store", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "public-hook-fetch-giant-pack-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const candidateData = path.join(root, "candidate.git");
  const base = path.join(root, "base");
  fs.mkdirSync(base);
  git(base, ["init", "-b", "main"]);
  configureIdentity(base, "Trusted Test", "trusted@example.invalid");
  writeFile(base, "docs/builder/intake-status.json", `${canonicalJson({ continuingPullRequests: [], schemaVersion: 2, state: "open" })}\n`);
  const baseCommit = commitAll(base, "trusted open intake");
  const executable = writeExecutable(root, "write-giant-pack.sh", [
    "#!/bin/bash",
    `dd if=/dev/zero of=${shellQuote(path.join(candidateData, "objects/pack/untrusted.pack"))} bs=1048576 count=4 status=none`,
    ""
  ].join("\n"));

  await assert.rejects(
    fetchPublicApplicationCandidate({
      baseRoot: base,
      candidateRoot: candidateData,
      repository: "central/repository",
      pullRequestNumber: PULL_REQUEST_NUMBER,
      expectedBaseCommit: baseCommit,
      expectedCandidateCommit: "b".repeat(40),
      readToken: "test-read-token"
    }, {
      remoteUrlForTests: "https://github.com/central/repository.git",
      maximumFileSizeBytes: 64 * 1024,
      maximumRepositoryBytes: 2 * 1024 * 1024,
      runFetch(parameters) {
        return runBoundedHydrationGitProcess({ ...parameters, gitExecutable: executable });
      }
    }),
    (error) => error?.code === "CANDIDATE_FETCH_BOUNDED_FAILURE" && error?.kind === "system"
  );
  assert.equal(fs.existsSync(candidateData), false);
});

test("Linux candidate Git runner hard-stops compressed-pack-style address-space expansion", {
  skip: process.platform !== "linux" || !fs.existsSync("/usr/bin/perl")
}, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "public-hook-fetch-address-space-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const executable = writeExecutable(root, "expand-in-memory.pl", [
    "#!/usr/bin/perl",
    "my $payload = 'x' x (256 * 1024 * 1024);",
    "print STDERR 'allocation unexpectedly succeeded: ' . length($payload) . \"\\n\";",
    ""
  ].join("\n"));

  const result = await runBoundedHydrationGitProcess({
    gitExecutable: executable,
    gitDirectory: root,
    args: ["index-pack", "--stdin"],
    timeoutMs: 5_000,
    maximumOutputBytes: 65_536,
    maximumFileSizeBytes: 2 * 1024 * 1024,
    maximumRepositoryBytes: 2 * 1024 * 1024,
    maximumAddressSpaceBytes: 96 * 1024 * 1024,
    maximumCpuSeconds: 4
  });
  assert.notEqual(result.status, 0);
  assert.equal(result.addressSpaceExceeded, true);
  assert.doesNotMatch(result.stderr.toString("utf8"), /allocation unexpectedly succeeded/u);
});

function makePackage() {
  const submissionPath = "submissions/example-hook/submission.json";
  const programmableFee = makeProgrammableFee();
  const submissionBytes = sourceSubmissionBytes(programmableFee);
  const submissionSha256 = `sha256:${crypto.createHash("sha256").update(submissionBytes).digest("hex")}`;
  const primary = {
    ...PRIMARY,
    sourcePaths: [...new Set([
      ...PRIMARY.sourcePaths,
      "src/ProgrammableFeeHook.sol",
      submissionPath,
      "test/ProgrammableFeeHook.t.sol"
    ])].sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)))
  };
  const files = new Map([
    ["PROPOSAL.md", Buffer.from("# Proposal\nA bounded public application for an exact external GitHub source revision.\n")],
    ["TEST_PLAN.md", Buffer.from("# Test plan\nRun builder-owned unit, fuzz, invariant, static-analysis, and integration evidence.\n")],
    ["THREAT_MODEL.md", Buffer.from("# Threat model\nPoolManager authority, value conservation, custody, exits, and failure paths require review.\n")]
  ]);
  const sourceProjection = {
    numericRepositoryId: PRIMARY.numericRepositoryId,
    revisionObjectId: PRIMARY.revisionObjectId,
    treeObjectId: PRIMARY.treeObjectId
  };
  files.set("compatibility-report.json", jsonBytes({
    schemaVersion: 1,
    applicationId: "example-hook",
    source: sourceProjection,
    result: "architecture-review-required",
    findings: [],
    disclaimer: PUBLIC_BETA_DISCLAIMER
  }));
  files.set("evidence-index.json", jsonBytes({
    schemaVersion: 1,
    applicationId: "example-hook",
    source: sourceProjection,
    attestation: "builder-declared-untrusted",
    evidence: [
      {
        id: "unit-tests",
        kind: "unit",
        status: "passed",
        scope: "Builder-owned checks for the exact declared source revision.",
        url: `${PRIMARY.repositoryUri}/actions/runs/123`,
        sha256: null
      },
      {
        id: "zz-programmable-fee-submission",
        kind: "static-analysis",
        status: "passed",
        scope: "Exact source submission used to recompute the mandatory Programmable fee projection.",
        url: `${PRIMARY.repositoryUri}/blob/${PRIMARY.revisionObjectId}/${submissionPath}`,
        sha256: submissionSha256
      }
    ]
  }));
  files.set("application.json", jsonBytes({
    schemaVersion: 2,
    applicationId: "example-hook",
    applicationRevision: 1,
    stage: "proposal",
    title: "Example external hook application",
    summary: "A public GitHub source binding with a bounded central review package.",
    builder: {
      githubUserId: BUILDER_USER_ID,
      githubLogin: "alice",
      contact: "https://github.com/alice"
    },
    source: {
      schemaVersion: "1.0.0",
      primary: { ...primary, sourcePaths: [...primary.sourcePaths], contractPaths: [...primary.contractPaths], githubActionsRunIds: [...primary.githubActionsRunIds] },
      companions: []
    },
    companionClosure: [],
    programmableFee: {
      ...programmableFee,
      submissionBinding: { path: submissionPath, sha256: submissionSha256 }
    },
    reviewPackage: reviewRecords(files),
    declarations: {
      publicInformationAcknowledged: true,
      noSecretsDeclared: true,
      noApprovalClaim: true,
      noUniswapEndorsementClaim: true
    }
  }));
  return files;
}

function makeProgrammableFee() {
  return {
    policyId: "programmable-volume-fee-v1",
    policyVersion: "1.0.0",
    poolScope: "canonical-launch-pool-key",
    rates: {
      unit: "hundredths-of-bip",
      selectedHundredthsOfBip: 30000,
      minimumEffectiveHundredthsOfBip: 1000,
      effectiveHundredthsOfBip: 30000,
      platformHundredthsOfBip: 1000,
      projectHundredthsOfBip: 29000,
      formula: "effective=max(selected,1000);platform=1000;project=effective-1000",
      lpFeeExcluded: true
    },
    basis: { volume: "gross-quote-side-swap-volume", quoteAsset: "canonical-pool-quote-asset" },
    ownership: {
      owner: "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c",
      immutable: true,
      claimAuthority: "owner-only",
      claimAvailability: "anytime",
      claimDestinationPolicy: "owner-or-owner-selected-per-claim",
      storedMutableRecipient: false,
      builderCanMutate: false,
      projectCanMutate: false,
      administratorCanMutate: false
    },
    collection: {
      status: "implemented",
      integration: "canonical-pool-hook",
      enforcement: "non-bypassable",
      hookFeeMechanismBinding: "hook.feeMechanism",
      supportedSwapModes: [
        "zeroForOne-exactInput",
        "zeroForOne-exactOutput",
        "oneForZero-exactInput",
        "oneForZero-exactOutput"
      ],
      swapModePaths: {
        zeroForOneExactInput: "after-swap-return-delta",
        zeroForOneExactOutput: "after-swap-return-delta",
        oneForZeroExactInput: "after-swap-return-delta",
        oneForZeroExactOutput: "after-swap-return-delta"
      },
      selfCallPolicy: "same-pool-swap-forbidden"
    },
    accounting: {
      accrualMode: "claimable-liability",
      liabilityKeyDimensions: ["poolId", "currency", "owner"],
      crossPoolNetting: false,
      valueFlowId: "programmable-volume-fee",
      collectionEvent: "ProgrammableFeeAccrued(bytes32,address,uint256)",
      claimEvent: "ProgrammableFeeClaimed(address,address,uint256)"
    },
    evidence: {
      sourcePaths: ["src/ProgrammableFeeHook.sol"],
      testPaths: ["test/ProgrammableFeeHook.t.sol"]
    }
  };
}

function sourceSubmissionBytes(programmableFee) {
  return Buffer.from(`${canonicalJson({
    model: { id: "example-hook" },
    programmableFee,
    schemaVersion: 1,
    standardVersion: "1.3.0"
  })}\n`, "utf8");
}

function reviewRecords(files) {
  return [...files.entries()]
    .sort(([left], [right]) => Buffer.compare(Buffer.from(left), Buffer.from(right)))
    .map(([fileName, bytes]) => ({
      path: fileName,
      sha256: `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`,
      byteLength: bytes.length
    }));
}

function jsonBytes(value) {
  return Buffer.from(`${canonicalJson(value)}\n`);
}

function continuationRecord(overrides = {}) {
  return {
    applicationId: "example-hook",
    builderGitHubUserId: BUILDER_USER_ID,
    companionNumericRepositoryIds: [],
    primaryNumericRepositoryId: PRIMARY.numericRepositoryId,
    pullRequestNumber: PULL_REQUEST_NUMBER,
    ...overrides
  };
}

function createRevisionPair(t, {
  intakeState = "open",
  existingApplication = false,
  continuingPullRequests = []
} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "public-hook-blobless-candidate-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const base = path.join(root, "base");
  const candidate = path.join(root, "candidate-source");
  fs.mkdirSync(base);
  git(base, ["init", "-b", "main"]);
  configureIdentity(base, "Trusted Test", "trusted@example.invalid");
  writeFile(base, "README.md", "trusted base\n");
  writeFile(
    base,
    "docs/builder/intake-status.json",
    `${canonicalJson({ continuingPullRequests, schemaVersion: 2, state: intakeState })}\n`
  );
  if (existingApplication) writePackage(base, makePackage());
  const baseCommit = commitAll(base, "trusted base");
  const clone = childProcess.spawnSync("git", ["clone", "--quiet", "--no-hardlinks", base, candidate], {
    encoding: "utf8",
    shell: false,
    env: trustedGitEnvironment()
  });
  assert.equal(clone.status, 0, clone.stderr);
  configureIdentity(candidate, "Candidate Test", "candidate@example.invalid");
  return { root, base, candidate, baseCommit };
}

function createPullRequestMerge(fixture, candidateCommit) {
  git(fixture.candidate, ["fetch", "--quiet", "--no-tags", fixture.base, fixture.baseCommit]);
  const mergedTree = git(fixture.candidate, ["merge-tree", "--write-tree", fixture.baseCommit, candidateCommit]);
  const mergeCommit = git(fixture.candidate, [
    "commit-tree",
    mergedTree,
    "-p", fixture.baseCommit,
    "-p", candidateCommit,
    "-m", "Synthetic GitHub pull request merge"
  ]);
  git(fixture.candidate, ["reset", "--hard", mergeCommit]);
  return mergeCommit;
}

async function fetchBloblessPullRequestMerge(fixture, mergeCommit) {
  const candidateData = path.join(fixture.root, "candidate.git");
  const candidateCommit = git(fixture.candidate, ["rev-parse", `${mergeCommit}^2`]);
  git(fixture.candidate, ["update-ref", `refs/pull/${PULL_REQUEST_NUMBER}/merge`, mergeCommit]);
  git(fixture.candidate, ["config", "uploadpack.allowFilter", "true"]);
  const report = await fetchPublicApplicationCandidate({
    baseRoot: fixture.base,
    candidateRoot: candidateData,
    repository: "central/repository",
    pullRequestNumber: PULL_REQUEST_NUMBER,
    expectedBaseCommit: fixture.baseCommit,
    expectedCandidateCommit: candidateCommit,
    readToken: "test-read-token"
  }, {
    remoteUrlForTests: pathToFileURL(fixture.candidate).href,
    allowFileProtocolForTests: true
  });
  assert.equal(report.result, "exact-blobless-candidate-fetched");
  assert.equal(report.mergeCommit, mergeCommit);
  return candidateData;
}

function fetchBloblessPullRequestMergeWithoutIntake(fixture, mergeCommit) {
  const candidateData = path.join(fixture.root, "candidate.git");
  git(fixture.candidate, ["update-ref", `refs/pull/${PULL_REQUEST_NUMBER}/merge`, mergeCommit]);
  git(fixture.candidate, ["config", "uploadpack.allowFilter", "true"]);
  const init = childProcess.spawnSync("git", ["init", "--quiet", "--bare", candidateData], {
    encoding: "utf8",
    shell: false,
    env: trustedGitEnvironment()
  });
  assert.equal(init.status, 0, init.stderr);
  git(candidateData, ["remote", "add", "origin", pathToFileURL(fixture.candidate).href]);
  git(candidateData, ["config", "remote.origin.promisor", "true"]);
  git(candidateData, ["config", "remote.origin.partialclonefilter", "blob:none"]);
  const fetch = childProcess.spawnSync("git", [
    "-c", "protocol.file.allow=always",
    "-C", candidateData,
    "fetch", "--quiet", "--force", "--no-tags", "--depth=1", "--filter=blob:none",
    "origin", `+refs/pull/${PULL_REQUEST_NUMBER}/merge:refs/heads/candidate-merge`
  ], {
    encoding: "utf8",
    shell: false,
    env: trustedGitEnvironment()
  });
  assert.equal(fetch.status, 0, fetch.stderr);
  git(candidateData, ["symbolic-ref", "HEAD", "refs/heads/candidate-merge"]);
  return candidateData;
}

function createPullRequestMetadataFetch({ baseCommit, candidateCommit, files }) {
  const pullRequestUrl = `https://api.github.com/repos/central/repository/pulls/${PULL_REQUEST_NUMBER}`;
  const documents = new Map([
    [pullRequestUrl, {
      number: Number(PULL_REQUEST_NUMBER),
      state: "open",
      base: { sha: baseCommit, repo: { full_name: "central/repository" } },
      head: { sha: candidateCommit },
      changed_files: files.length
    }],
    [`${pullRequestUrl}/files?per_page=100&page=1`, files]
  ]);
  return async (url, options) => {
    assert.equal(options.method, "GET");
    assert.equal(options.redirect, "error");
    assert.equal(options.headers.Authorization, "Bearer test-read-token");
    assert.equal(options.headers["X-GitHub-Api-Version"], "2026-03-10");
    assert.ok(documents.has(url), `unexpected preflight URL: ${url}`);
    const body = Buffer.from(JSON.stringify(documents.get(url)));
    return {
      status: 200,
      redirected: false,
      url,
      headers: { get(name) { return name.toLowerCase() === "content-length" ? String(body.length) : null; } },
      body: null,
      async arrayBuffer() { return body; }
    };
  };
}

function writePackage(repository, files) {
  for (const [fileName, bytes] of files) {
    writeFile(repository, `submissions/example-hook/${fileName}`, bytes);
  }
}

function writeFile(root, relativePath, contents) {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
}

function configureIdentity(repository, name, email) {
  git(repository, ["config", "user.name", name]);
  git(repository, ["config", "user.email", email]);
}

function commitAll(repository, message) {
  git(repository, ["add", "-A"]);
  git(repository, ["commit", "-m", message]);
  return git(repository, ["rev-parse", "HEAD"]);
}

function blobObjectIdAtPath(repository, relativePath) {
  const output = git(repository, ["ls-tree", "HEAD", "--", relativePath]);
  const match = /^100644 blob ([a-f0-9]{40})\t/u.exec(output);
  assert.ok(match, `expected one regular blob at ${relativePath}`);
  return match[1];
}

function hasObjectWithoutLazyFetch(repository, objectId) {
  const result = childProcess.spawnSync("git", ["-C", repository, "cat-file", "-e", objectId], {
    encoding: "utf8",
    shell: false,
    env: { ...trustedGitEnvironment(), GIT_NO_LAZY_FETCH: "1" }
  });
  assert.ok([0, 1].includes(result.status), result.stderr);
  return result.status === 0;
}

function git(repository, args) {
  const result = childProcess.spawnSync("git", ["-C", repository, ...args], {
    encoding: "utf8",
    shell: false,
    env: trustedGitEnvironment()
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function trustedGitEnvironment() {
  return {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TERMINAL_PROMPT: "0"
  };
}

function localHydrationDependencies(fixture) {
  return {
    allowFileProtocolForTests: true,
    remoteUrlForTests: pathToFileURL(fixture.candidate).href,
    fetchImplementation: createTreeMetadataFetch(fixture.candidate)
  };
}

function createTreeMetadataFetch(repository) {
  const packageTreeObjectId = git(repository, ["rev-parse", "HEAD:submissions/example-hook"]);
  const records = git(repository, ["ls-tree", "-l", "HEAD:submissions/example-hook"])
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const match = /^([0-7]{6}) (blob|tree|commit) ([a-f0-9]{40})\s+([0-9-]+)\t(.+)$/u.exec(line);
      assert.ok(match, `unexpected ls-tree metadata: ${line}`);
      return {
        path: match[5],
        mode: match[1],
        type: match[2],
        sha: match[3],
        size: Number(match[4]),
        url: `https://api.github.com/repos/central/repository/git/blobs/${match[3]}`
      };
    });
  const body = Buffer.from(JSON.stringify({
    sha: packageTreeObjectId,
    url: `https://api.github.com/repos/central/repository/git/trees/${packageTreeObjectId}`,
    truncated: false,
    tree: records
  }));
  return async (url, options) => {
    assert.equal(url, `https://api.github.com/repos/central/repository/git/trees/${packageTreeObjectId}`);
    assert.equal(options.method, "GET");
    assert.equal(options.redirect, "error");
    assert.equal(options.headers.Authorization, "Bearer test-read-token");
    return {
      status: 200,
      redirected: false,
      url,
      headers: { get(name) { return name.toLowerCase() === "content-length" ? String(body.length) : null; } },
      body: null,
      async arrayBuffer() { return body; }
    };
  };
}

function writeExecutable(root, name, source) {
  const target = path.join(root, name);
  fs.writeFileSync(target, source, { mode: 0o700 });
  fs.chmodSync(target, 0o700);
  return target;
}

function shellQuote(value) {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

async function waitForRegularFile(target, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (fs.lstatSync(target).isFile()) return true;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
}

async function waitForProcessExit(pid) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error?.code === "ESRCH") return;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail(`descendant process ${pid} survived the bounded process-group timeout`);
}

async function exactSourceResolver(source) {
  const primary = source.primary;
  return {
    schemaVersion: "1.0.0",
    kind: "github-public-source",
    canonicalProviderOrigin: "https://github.com",
    githubApiVersion: "2026-03-10",
    primary: {
      role: "primary",
      authority: {
        numericRepositoryId: primary.numericRepositoryId,
        revisionObjectId: primary.revisionObjectId,
        treeObjectId: primary.treeObjectId
      },
      display: {
        repositoryUri: primary.repositoryUri,
        owner: "alice",
        repository: "example-hook",
        defaultBranch: "main"
      },
      visibility: "public",
      sourcePaths: [...primary.sourcePaths],
      contractPaths: [...primary.contractPaths],
      githubActionsEvidence: [{
        runId: "123",
        runAttempt: "1",
        workflowId: "456",
        workflowPath: ".github/workflows/ci.yml",
        headRevision: primary.revisionObjectId,
        headTree: primary.treeObjectId,
        event: "push",
        status: "completed",
        conclusion: "success",
        htmlUrl: `${primary.repositoryUri}/actions/runs/123`
      }]
    },
    companions: []
  };
}

async function exactEvidenceResolver({ primary, evidence }) {
  return evidence.map((record) => {
    assert.equal(record.id, "zz-programmable-fee-submission");
    const bytes = sourceSubmissionBytes(makeProgrammableFee());
    return {
      id: record.id,
      path: "submissions/example-hook/submission.json",
      blobObjectId: crypto.createHash("sha1")
        .update(Buffer.from(`blob ${bytes.length}\0`, "utf8"))
        .update(bytes)
        .digest("hex"),
      bytes
    };
  });
}
