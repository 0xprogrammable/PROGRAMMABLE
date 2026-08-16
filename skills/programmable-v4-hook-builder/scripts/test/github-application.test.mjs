import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildCanonicalApplicationPullRequestBody,
  CENTRAL_APPLICATION_FILES,
  createGhTransport,
  executeGitHubApplication,
  GitHubApplicationError,
  isSafeGitHubApiEndpoint,
  loadPreparedApplication,
  normalizePreparedApplication,
  parseIntakeStatusBytes,
  planGitHubApplication,
  projectGitHubStatus,
  readGitHubApplicationStatus,
  writeLocalReceipt
} from "../github-application-core.mjs";
import { canonicalJson } from "../submission-core.mjs";

const SOURCE_COMMIT = "1".repeat(40);
const SOURCE_TREE = "2".repeat(40);
const COMPANION_COMMIT = "a".repeat(40);
const COMPANION_TREE = "b".repeat(40);
const CENTRAL_COMMIT = "3".repeat(40);
const CENTRAL_TREE = "4".repeat(40);
const FORK_TREE = "5".repeat(40);
const CREATED_COMMIT = "6".repeat(40);
const UPDATED_COMMIT = "7".repeat(40);
const VIEWER_ID = "101";
const SOURCE_REPOSITORY_ID = "202";
const COMPANION_REPOSITORY_ID = "203";
const CENTRAL_REPOSITORY_ID = "1320171831";
const FORK_REPOSITORY_ID = "404";
const APPLICATION_ID = "example-hook";

test("the prepared six-file package is closed, hash-bound, and path-bound", () => {
  const prepared = normalizePreparedApplication(makePrepared());
  assert.equal(prepared.applicationId, APPLICATION_ID);
  assert.equal(prepared.package.files.length, 6);
  assert.deepEqual(
    prepared.package.files.map(({ relativePath }) => relativePath),
    CENTRAL_APPLICATION_FILES
  );
  assert.match(prepared.package.digest, /^sha256:[0-9a-f]{64}$/u);

  const changedHash = structuredClone(makePrepared());
  changedHash.centralPackage.files[1].content += "tampered\n";
  assert.throws(
    () => normalizePreparedApplication(changedHash),
    errorCode("PREPARED_RESULT_INVALID")
  );

  const escaped = structuredClone(makePrepared());
  escaped.centralPackage.targetDirectory = "../example-hook";
  assert.throws(
    () => normalizePreparedApplication(escaped),
    errorCode("PREPARED_RESULT_INVALID")
  );

  const misleadingBody = structuredClone(makePrepared());
  misleadingBody.body = misleadingBody.body.replace(
    "Application result: `architecture-review-required`",
    "Application result: `approved-and-live`"
  );
  assert.throws(
    () => normalizePreparedApplication(misleadingBody),
    errorCode("PREPARED_RESULT_INVALID")
  );
});

test("submit is read-only by default and emits a stable confirmation digest", async () => {
  const prepared = makePrepared();
  const transport = new FakeTransport({ prepared });
  const first = await planGitHubApplication({ operation: "submit", prepared, transport });
  const second = await planGitHubApplication({ operation: "submit", prepared, transport });
  assert.equal(first.confirmationDigest, second.confirmationDigest);
  assert.deepEqual(first.externalWrites, [
    "create-viewer-fork",
    "create-application-branch-commit",
    "open-draft-pull-request"
  ]);
  assert.equal(transport.writeCalls.length, 0);
  assert.equal(first.source.repositoryAdministratorOwnershipProven, false);
  assert.equal(first.source.observedPermission.push, true);
  assert.equal(first.source.observedPermission.admin, false);
});

test("an exact confirmation creates only a fork, branch commit, and draft PR", async () => {
  const prepared = makePrepared();
  const transport = new FakeTransport({ prepared });
  const plan = await planGitHubApplication({ operation: "submit", prepared, transport });
  const result = await executeGitHubApplication({
    operation: "submit",
    prepared,
    transport,
    confirmationDigest: plan.confirmationDigest,
    sleep: async () => {}
  });
  assert.deepEqual(result.actions, [
    "created-viewer-fork",
    "created-application-branch",
    "opened-draft-pull-request"
  ]);
  assert.equal(result.status.status, "submitted");
  assert.equal(result.status.packageMatchesPrepared, true);
  assert.equal(transport.pull.draft, true);
  assert.equal(transport.pull.state, "open");
  assert.equal(transport.writeCalls.includes("approve"), false);
  assert.equal(transport.writeCalls.includes("merge"), false);
});

test("a transient 404 while reading a newly created ref retries only the readback", async () => {
  const prepared = makePrepared();
  const transport = new FakeTransport({ prepared });
  transport.branchReadbackNotFoundAttempts = 1;
  const plan = await planGitHubApplication({ operation: "submit", prepared, transport });
  const sleeps = [];
  const result = await executeGitHubApplication({
    operation: "submit",
    prepared,
    transport,
    confirmationDigest: plan.confirmationDigest,
    sleep: async (milliseconds) => sleeps.push(milliseconds)
  });

  assert.equal(result.status.status, "submitted");
  assert.deepEqual(sleeps, [500]);
  assert.equal(transport.writeCalls.filter((value) => value === "createRef").length, 1);
  assert.equal(transport.writeCalls.filter((value) => value === "updateRef").length, 0);
  assert.equal(transport.writeCalls.filter((value) => value === "createDraftPull").length, 1);
});

test("persistent 404s after createRef fail without repeating any ref or PR write", async () => {
  const prepared = makePrepared();
  const transport = new FakeTransport({ prepared });
  transport.branchReadbackNotFoundAttempts = 20;
  const plan = await planGitHubApplication({ operation: "submit", prepared, transport });
  const sleeps = [];
  await assert.rejects(() => executeGitHubApplication({
    operation: "submit",
    prepared,
    transport,
    confirmationDigest: plan.confirmationDigest,
    sleep: async (milliseconds) => sleeps.push(milliseconds)
  }), errorCode("APPLICATION_BRANCH_NOT_READY"));

  assert.deepEqual(sleeps, Array(10).fill(500));
  assert.equal(transport.branchReadbackPollCalls, 11);
  assert.equal(transport.writeCalls.filter((value) => value === "createRef").length, 1);
  assert.equal(transport.writeCalls.filter((value) => value === "updateRef").length, 0);
  assert.equal(transport.writeCalls.filter((value) => value === "createDraftPull").length, 0);
});

test("a fresh run recovers a later-visible exact ref without another commit or ref write", async () => {
  const prepared = makePrepared();
  const transport = new FakeTransport({ prepared });
  transport.branchReadbackNotFoundAttempts = 20;
  const firstPlan = await planGitHubApplication({ operation: "submit", prepared, transport });
  await assert.rejects(() => executeGitHubApplication({
    operation: "submit",
    prepared,
    transport,
    confirmationDigest: firstPlan.confirmationDigest,
    sleep: async () => {}
  }), errorCode("APPLICATION_BRANCH_NOT_READY"));
  const commitWrites = transport.writeCalls.filter((value) => value === "createCommit").length;
  const refWrites = transport.writeCalls.filter((value) => value === "createRef").length;

  transport.branchReadbackNotFoundAttempts = 0;
  transport.branchReadbackPending = false;
  const recoveryPlan = await planGitHubApplication({ operation: "submit", prepared, transport });
  assert.deepEqual(recoveryPlan.externalWrites, ["open-draft-pull-request"]);
  const result = await executeGitHubApplication({
    operation: "submit",
    prepared,
    transport,
    confirmationDigest: recoveryPlan.confirmationDigest,
    sleep: async () => {}
  });

  assert.equal(result.status.status, "submitted");
  assert.equal(transport.writeCalls.filter((value) => value === "createCommit").length, commitWrites);
  assert.equal(transport.writeCalls.filter((value) => value === "createRef").length, refWrites);
  assert.equal(transport.writeCalls.filter((value) => value === "createDraftPull").length, 1);
});

test("fork identity drift after createRef blocks readback without repeating the write", async () => {
  const prepared = makePrepared();
  const transport = new FakeTransport({ prepared });
  transport.forkDriftAfterBranchWrite = true;
  const plan = await planGitHubApplication({ operation: "submit", prepared, transport });
  await assert.rejects(() => executeGitHubApplication({
    operation: "submit",
    prepared,
    transport,
    confirmationDigest: plan.confirmationDigest,
    sleep: async () => {}
  }), errorCode("FORK_CHANGED"));

  assert.equal(transport.writeCalls.filter((value) => value === "createRef").length, 1);
  assert.equal(transport.writeCalls.filter((value) => value === "updateRef").length, 0);
  assert.equal(transport.writeCalls.filter((value) => value === "createDraftPull").length, 0);
});

test("authority drift after the first ref 404 blocks the second target-ref poll", async () => {
  const prepared = makePrepared();
  const transport = new FakeTransport({ prepared });
  transport.branchReadbackNotFoundAttempts = 1;
  const plan = await planGitHubApplication({ operation: "submit", prepared, transport });
  await assert.rejects(() => executeGitHubApplication({
    operation: "submit",
    prepared,
    transport,
    confirmationDigest: plan.confirmationDigest,
    sleep: async () => { transport.intakeState = "paused-all"; }
  }), errorCode("INTAKE_STATE_CHANGED"));

  assert.equal(transport.branchReadbackPollCalls, 1);
  assert.equal(transport.writeCalls.filter((value) => value === "createRef").length, 1);
  assert.equal(transport.writeCalls.filter((value) => value === "createDraftPull").length, 0);
});

test("fork drift after the first ref 404 blocks the second target-ref poll", async () => {
  const prepared = makePrepared();
  const transport = new FakeTransport({ prepared });
  transport.branchReadbackNotFoundAttempts = 1;
  const plan = await planGitHubApplication({ operation: "submit", prepared, transport });
  await assert.rejects(() => executeGitHubApplication({
    operation: "submit",
    prepared,
    transport,
    confirmationDigest: plan.confirmationDigest,
    sleep: async () => { transport.forkRepositoryId = "405"; }
  }), errorCode("FORK_CHANGED"));

  assert.equal(transport.branchReadbackPollCalls, 1);
  assert.equal(transport.writeCalls.filter((value) => value === "createRef").length, 1);
  assert.equal(transport.writeCalls.filter((value) => value === "createDraftPull").length, 0);
});

test("a non-404 ref read failure aborts immediately after exactly one ref write", async () => {
  const prepared = makePrepared();
  const transport = new FakeTransport({ prepared });
  transport.branchReadbackError = new GitHubApplicationError(
    "GITHUB_REQUEST_FAILED",
    "gh: upstream reported HTTP 404; final request failed (HTTP 500)"
  );
  const plan = await planGitHubApplication({ operation: "submit", prepared, transport });
  let sleeps = 0;
  await assert.rejects(() => executeGitHubApplication({
    operation: "submit",
    prepared,
    transport,
    confirmationDigest: plan.confirmationDigest,
    sleep: async () => { sleeps += 1; }
  }), errorCode("GITHUB_REQUEST_FAILED"));

  assert.equal(sleeps, 0);
  assert.equal(transport.writeCalls.filter((value) => value === "createRef").length, 1);
  assert.equal(transport.writeCalls.filter((value) => value === "updateRef").length, 0);
  assert.equal(transport.writeCalls.filter((value) => value === "createDraftPull").length, 0);
});

test("a different visible ref commit fails closed without retrying the write", async () => {
  const prepared = makePrepared();
  const transport = new FakeTransport({ prepared });
  transport.branchReadbackWrongCommit = "8".repeat(40);
  const plan = await planGitHubApplication({ operation: "submit", prepared, transport });
  await assert.rejects(() => executeGitHubApplication({
    operation: "submit",
    prepared,
    transport,
    confirmationDigest: plan.confirmationDigest,
    sleep: async () => {}
  }), errorCode("APPLICATION_BRANCH_VERIFY_FAILED"));

  assert.equal(transport.writeCalls.filter((value) => value === "createRef").length, 1);
  assert.equal(transport.writeCalls.filter((value) => value === "updateRef").length, 0);
  assert.equal(transport.writeCalls.filter((value) => value === "createDraftPull").length, 0);
});

test("a wrong commit in the ref-write response fails before the first readback poll", async () => {
  const prepared = makePrepared();
  const transport = new FakeTransport({ prepared });
  transport.branchWriteResponseWrongCommit = "8".repeat(40);
  const plan = await planGitHubApplication({ operation: "submit", prepared, transport });
  await assert.rejects(() => executeGitHubApplication({
    operation: "submit",
    prepared,
    transport,
    confirmationDigest: plan.confirmationDigest,
    sleep: async () => {}
  }), errorCode("GITHUB_WRITE_VERIFY_FAILED"));

  assert.equal(transport.branchReadbackPollCalls, 0);
  assert.equal(transport.writeCalls.filter((value) => value === "createRef").length, 1);
  assert.equal(transport.writeCalls.filter((value) => value === "createDraftPull").length, 0);
});

test("malformed ref readback fails immediately without repeating the write", async () => {
  const prepared = makePrepared();
  const transport = new FakeTransport({ prepared });
  const exactGetRef = transport.getRef.bind(transport);
  transport.getRef = async (...args) => {
    if (transport.branchWriteCompleted && transport.branchReadbackPending) {
      transport.branchReadbackPollCalls += 1;
      return { ref: `refs/heads/${transport.prepared.branch}`, object: { type: "tree", sha: CREATED_COMMIT } };
    }
    return exactGetRef(...args);
  };
  const plan = await planGitHubApplication({ operation: "submit", prepared, transport });
  let sleeps = 0;
  await assert.rejects(() => executeGitHubApplication({
    operation: "submit",
    prepared,
    transport,
    confirmationDigest: plan.confirmationDigest,
    sleep: async () => { sleeps += 1; }
  }), errorCode("GITHUB_OUTPUT_INVALID"));

  assert.equal(sleeps, 0);
  assert.equal(transport.branchReadbackPollCalls, 1);
  assert.equal(transport.writeCalls.filter((value) => value === "createRef").length, 1);
  assert.equal(transport.writeCalls.filter((value) => value === "createDraftPull").length, 0);
});

test("a transient package-content 404 retries the complete read-only write boundary", async () => {
  const prepared = makePrepared();
  const transport = new FakeTransport({ prepared });
  transport.packageReadbackNotFoundAttempts = 1;
  const plan = await planGitHubApplication({ operation: "submit", prepared, transport });
  const sleeps = [];
  const result = await executeGitHubApplication({
    operation: "submit",
    prepared,
    transport,
    confirmationDigest: plan.confirmationDigest,
    sleep: async (milliseconds) => sleeps.push(milliseconds)
  });

  assert.equal(result.status.status, "submitted");
  assert.deepEqual(sleeps, [500]);
  assert.equal(transport.branchReadbackPollCalls, 1);
  assert.equal(transport.packageReadbackCalls, 13);
  assert.equal(transport.writeCalls.filter((value) => value === "createRef").length, 1);
  assert.equal(transport.writeCalls.filter((value) => value === "createDraftPull").length, 1);
});

test("persistent package-content 404s fail without repeating a branch or PR write", async () => {
  const prepared = makePrepared();
  const transport = new FakeTransport({ prepared });
  transport.packageReadbackNotFoundAttempts = 20;
  const plan = await planGitHubApplication({ operation: "submit", prepared, transport });
  const sleeps = [];
  await assert.rejects(() => executeGitHubApplication({
    operation: "submit",
    prepared,
    transport,
    confirmationDigest: plan.confirmationDigest,
    sleep: async (milliseconds) => sleeps.push(milliseconds)
  }), errorCode("APPLICATION_BRANCH_NOT_READY"));

  assert.deepEqual(sleeps, Array(10).fill(500));
  assert.equal(transport.branchReadbackPollCalls, 1);
  assert.equal(transport.packageReadbackCalls, 11);
  assert.equal(transport.writeCalls.filter((value) => value === "createRef").length, 1);
  assert.equal(transport.writeCalls.filter((value) => value === "createDraftPull").length, 0);
});

test("a non-404 package-content failure aborts without retrying any write", async () => {
  const prepared = makePrepared();
  const transport = new FakeTransport({ prepared });
  transport.packageReadbackError = new GitHubApplicationError(
    "GITHUB_REQUEST_FAILED",
    "gh: upstream reported HTTP 404; final request failed (HTTP 500)"
  );
  const plan = await planGitHubApplication({ operation: "submit", prepared, transport });
  let sleeps = 0;
  await assert.rejects(() => executeGitHubApplication({
    operation: "submit",
    prepared,
    transport,
    confirmationDigest: plan.confirmationDigest,
    sleep: async () => { sleeps += 1; }
  }), errorCode("GITHUB_REQUEST_FAILED"));

  assert.equal(sleeps, 0);
  assert.equal(transport.packageReadbackCalls, 1);
  assert.equal(transport.writeCalls.filter((value) => value === "createRef").length, 1);
  assert.equal(transport.writeCalls.filter((value) => value === "createDraftPull").length, 0);
});

test("a transient draft-pull 404 is retried after the exact branch is verified", async () => {
  const prepared = makePrepared();
  const transport = new FakeTransport({ prepared, draftPullNotFoundAttempts: 1 });
  const plan = await planGitHubApplication({ operation: "submit", prepared, transport });
  const sleeps = [];
  const result = await executeGitHubApplication({
    operation: "submit",
    prepared,
    transport,
    confirmationDigest: plan.confirmationDigest,
    sleep: async (milliseconds) => sleeps.push(milliseconds)
  });

  assert.equal(result.status.status, "submitted");
  assert.deepEqual(sleeps, [500]);
  assert.equal(transport.writeCalls.filter((value) => value === "createCommit").length, 1);
  assert.equal(transport.writeCalls.filter((value) => value === "createRef").length, 1);
  assert.equal(transport.writeCalls.filter((value) => value === "createDraftPull").length, 2);
});

test("an ambiguous draft-pull 404 adopts the exact discovered PR without a duplicate POST", async () => {
  const prepared = makePrepared();
  const transport = new FakeTransport({
    prepared,
    draftPullNotFoundAttempts: 1,
    draftPullNotFoundCreatesPullAtAttempt: 1
  });
  const plan = await planGitHubApplication({ operation: "submit", prepared, transport });
  const sleeps = [];
  const result = await executeGitHubApplication({
    operation: "submit",
    prepared,
    transport,
    confirmationDigest: plan.confirmationDigest,
    sleep: async (milliseconds) => sleeps.push(milliseconds)
  });

  assert.equal(result.status.status, "submitted");
  assert.deepEqual(sleeps, [500]);
  assert.equal(transport.writeCalls.filter((value) => value === "createCommit").length, 1);
  assert.equal(transport.writeCalls.filter((value) => value === "createDraftPull").length, 1);
  assert.equal(transport.pull.number, 7);
});

test("authority drift after a draft-pull 404 blocks the retry POST", async () => {
  const prepared = makePrepared();
  const transport = new FakeTransport({ prepared, draftPullNotFoundAttempts: 1 });
  const plan = await planGitHubApplication({ operation: "submit", prepared, transport });
  await assert.rejects(() => executeGitHubApplication({
    operation: "submit",
    prepared,
    transport,
    confirmationDigest: plan.confirmationDigest,
    sleep: async () => { transport.intakeState = "paused-all"; }
  }), errorCode("INTAKE_STATE_CHANGED"));

  assert.equal(transport.writeCalls.filter((value) => value === "createCommit").length, 1);
  assert.equal(transport.writeCalls.filter((value) => value === "createDraftPull").length, 1);
  assert.equal(transport.pull, null);
});

test("fork identity drift after a draft-pull 404 blocks every retry POST", async () => {
  const prepared = makePrepared();
  const transport = new FakeTransport({ prepared, draftPullNotFoundAttempts: 1 });
  const plan = await planGitHubApplication({ operation: "submit", prepared, transport });
  const sleeps = [];
  await assert.rejects(() => executeGitHubApplication({
    operation: "submit",
    prepared,
    transport,
    confirmationDigest: plan.confirmationDigest,
    sleep: async (milliseconds) => {
      sleeps.push(milliseconds);
      transport.forkRepositoryId = "405";
    }
  }), errorCode("FORK_CHANGED"));

  assert.deepEqual(sleeps, [500]);
  assert.equal(transport.writeCalls.filter((value) => value === "createCommit").length, 1);
  assert.equal(transport.writeCalls.filter((value) => value === "createDraftPull").length, 1);
  assert.equal(transport.pull, null);
});

test("a PR created behind the final 404 is recovered without an extra POST", async () => {
  const prepared = makePrepared();
  const transport = new FakeTransport({
    prepared,
    draftPullNotFoundAttempts: 20,
    draftPullNotFoundCreatesPullAtAttempt: 10
  });
  const plan = await planGitHubApplication({ operation: "submit", prepared, transport });
  const sleeps = [];
  const result = await executeGitHubApplication({
    operation: "submit",
    prepared,
    transport,
    confirmationDigest: plan.confirmationDigest,
    sleep: async (milliseconds) => sleeps.push(milliseconds)
  });

  assert.equal(result.status.status, "submitted");
  assert.deepEqual(sleeps, Array(10).fill(500));
  assert.equal(transport.writeCalls.filter((value) => value === "createCommit").length, 1);
  assert.equal(transport.writeCalls.filter((value) => value === "createDraftPull").length, 10);
  assert.equal(transport.pull.number, 7);
});

test("persistent draft-pull 404s stop at the bounded retry without duplicating Git history", async () => {
  const prepared = makePrepared();
  const transport = new FakeTransport({ prepared, draftPullNotFoundAttempts: 20 });
  const plan = await planGitHubApplication({ operation: "submit", prepared, transport });
  const sleeps = [];
  await assert.rejects(() => executeGitHubApplication({
    operation: "submit",
    prepared,
    transport,
    confirmationDigest: plan.confirmationDigest,
    sleep: async (milliseconds) => sleeps.push(milliseconds)
  }), errorCode("PULL_REQUEST_CREATE_NOT_READY"));

  assert.deepEqual(sleeps, Array(10).fill(500));
  assert.equal(transport.writeCalls.filter((value) => value === "createCommit").length, 1);
  assert.equal(transport.writeCalls.filter((value) => value === "createRef").length, 1);
  assert.equal(transport.writeCalls.filter((value) => value === "createDraftPull").length, 10);
  assert.equal(transport.pull, null);
});

test("a later application revision opens with the closed update diff while retaining the full package binding", async () => {
  const prepared = makePrepared({ priorRevision: 1 });
  const normalized = normalizePreparedApplication(prepared);
  const transport = new FakeTransport({ prepared });
  const changedRelativePaths = [
    "application.json",
    "compatibility-report.json",
    "evidence-index.json"
  ];
  transport.getPullFiles = async () => changedRelativePaths.map((relativePath) => ({
    filename: `${normalized.applicationDirectory}/${relativePath}`,
    status: "modified",
    sha: "a".repeat(40)
  }));
  const createDraftPull = transport.createDraftPull.bind(transport);
  transport.createDraftPull = async (...args) => {
    const result = await createDraftPull(...args);
    transport.pull.changed_files = changedRelativePaths.length;
    return result;
  };

  const plan = await planGitHubApplication({ operation: "submit", prepared, transport });
  const result = await executeGitHubApplication({
    operation: "submit",
    prepared,
    transport,
    confirmationDigest: plan.confirmationDigest,
    sleep: async () => {}
  });

  assert.equal(result.status.packageMatchesPrepared, true);
  assert.equal(result.status.applicationRevision, 2);
  assert.deepEqual(result.actions, [
    "created-viewer-fork",
    "created-application-branch",
    "opened-draft-pull-request"
  ]);
});

test("an application update cannot omit a regenerated manifest or evidence file", async () => {
  const prepared = makePrepared({ priorRevision: 1 });
  const normalized = normalizePreparedApplication(prepared);
  const transport = new FakeTransport({ prepared });
  transport.seedExactPull();
  transport.pull.changed_files = 2;
  transport.getPullFiles = async () => [
    "application.json",
    "compatibility-report.json"
  ].map((relativePath) => ({
    filename: `${normalized.applicationDirectory}/${relativePath}`,
    status: "modified",
    sha: "a".repeat(40)
  }));

  await assert.rejects(
    () => planGitHubApplication({ operation: "update", prepared, transport }),
    errorCode("APPLICATION_PULL_REQUEST_PATHS_INVALID")
  );
  assert.equal(transport.writeCalls.length, 0);
});

test("a first application cannot disguise existing files as a new package", async () => {
  const prepared = makePrepared();
  const transport = new FakeTransport({ prepared });
  transport.seedExactPull();
  transport.getPullFiles = async () => transport.prepared.package.files.map(({ path: filePath }) => ({
    filename: filePath,
    status: "modified",
    sha: "a".repeat(40)
  }));

  await assert.rejects(
    () => planGitHubApplication({ operation: "update", prepared, transport }),
    errorCode("APPLICATION_PULL_REQUEST_PATHS_INVALID")
  );
  assert.equal(transport.writeCalls.length, 0);
});

test("a wrong or stale confirmation performs no writes", async () => {
  const prepared = makePrepared();
  const transport = new FakeTransport({ prepared });
  await assert.rejects(
    () => executeGitHubApplication({
      operation: "submit",
      prepared,
      transport,
      confirmationDigest: `sha256:${"0".repeat(64)}`,
      sleep: async () => {}
    }),
    errorCode("EXTERNAL_WRITE_CONFIRMATION_REQUIRED")
  );
  assert.equal(transport.writeCalls.length, 0);
});

test("a central-main race invalidates the confirmed plan before any write", async () => {
  const prepared = makePrepared();
  const transport = new FakeTransport({ prepared });
  const plan = await planGitHubApplication({ operation: "submit", prepared, transport });
  transport.centralCommit = "9".repeat(40);
  await assert.rejects(
    () => executeGitHubApplication({
      operation: "submit",
      prepared,
      transport,
      confirmationDigest: plan.confirmationDigest,
      sleep: async () => {}
    }),
    errorCode("PREPARE_PR_STALE")
  );
  assert.equal(transport.writeCalls.length, 0);
});

test("the active gh account must match the immutable prepared builder id", async () => {
  const prepared = makePrepared();
  const transport = new FakeTransport({ prepared, viewerId: "999" });
  await assert.rejects(
    () => planGitHubApplication({ operation: "submit", prepared, transport }),
    errorCode("WRONG_GITHUB_ACCOUNT")
  );
  assert.equal(transport.writeCalls.length, 0);
});

test("source push access is required but source admin access is not claimed", async () => {
  const prepared = makePrepared();
  const blocked = new FakeTransport({ prepared, sourcePush: false, sourceAdmin: true });
  await assert.rejects(
    () => planGitHubApplication({ operation: "submit", prepared, transport: blocked }),
    errorCode("SOURCE_WRITE_ACCESS_REQUIRED")
  );

  const permitted = new FakeTransport({ prepared, sourcePush: true, sourceAdmin: false });
  const plan = await planGitHubApplication({ operation: "submit", prepared, transport: permitted });
  assert.equal(plan.source.observedPermission.push, true);
  assert.equal(plan.source.observedPermission.admin, false);
  assert.equal(plan.source.repositoryAdministratorOwnershipProven, false);
});

test("public companion sources are bound to their exact repository, commit, and tree", async () => {
  const companion = {
    repositoryUri: "https://github.com/library/dependency",
    numericRepositoryId: COMPANION_REPOSITORY_ID,
    revisionObjectId: COMPANION_COMMIT,
    treeObjectId: COMPANION_TREE,
    sourcePaths: [],
    contractPaths: ["src/Dependency.sol"],
    githubActionsRunIds: []
  };
  const prepared = makePrepared({ companions: [companion] });
  const transport = new FakeTransport({ prepared });
  const plan = await planGitHubApplication({ operation: "submit", prepared, transport });
  assert.deepEqual(plan.source.companions, [{
    repositorySlug: "library/dependency",
    repositoryUrl: "https://github.com/library/dependency",
    numericRepositoryId: COMPANION_REPOSITORY_ID,
    commit: COMPANION_COMMIT,
    tree: COMPANION_TREE,
    public: true,
    exactCommitReachable: true
  }]);

  const originalGetCommit = transport.getGitCommit.bind(transport);
  transport.getGitCommit = async (slug, commit) => (
    slug === "library/dependency"
      ? { sha: COMPANION_COMMIT, tree: { sha: "c".repeat(40) } }
      : originalGetCommit(slug, commit)
  );
  await assert.rejects(
    () => planGitHubApplication({ operation: "submit", prepared, transport }),
    errorCode("SOURCE_COMPANION_REVISION_CHANGED")
  );
});

test("prelaunch, paused-new, and paused-all stop a new draft before writes", async (t) => {
  for (const [state, code] of [
    ["prelaunch", "INTAKE_PRELAUNCH"],
    ["paused-new", "INTAKE_PAUSED_NEW"],
    ["paused-all", "INTAKE_PAUSED_ALL"]
  ]) {
    await t.test(state, async () => {
      const prepared = makePrepared();
      const transport = new FakeTransport({ prepared, intakeState: state });
      await assert.rejects(
        () => planGitHubApplication({ operation: "submit", prepared, transport }),
        errorCode(code)
      );
      assert.equal(transport.writeCalls.length, 0);
    });
  }
});

test("the application client accepts only the released Submit Launch intake schema v2 identity", () => {
  const bytes = Buffer.from(`${canonicalJson({
    continuingPullRequests: [],
    schemaVersion: 2,
    state: "prelaunch"
  })}\n`, "utf8");
  const parsed = parseIntakeStatusBytes(bytes);
  assert.equal(parsed.schemaVersion, 2);
  assert.equal(parsed.state, "prelaunch");
  assert.match(parsed.sha256, /^sha256:[a-f0-9]{64}$/u);

  assert.throws(
    () => parseIntakeStatusBytes(Buffer.from(`${canonicalJson({
      activeIntake: {
        baseBranch: "main",
        directory: "submissions",
        repository: "0xprogrammable/submit-launch",
        state: "open"
      },
      continuingPullRequests: [],
      schemaVersion: 3
    })}\n`, "utf8")),
    errorCode("INTAKE_STATUS_INVALID")
  );
});

test("paused-new permits only the exact trusted unmerged continuation", async () => {
  const prepared = makePrepared();
  const transport = new FakeTransport({ prepared, intakeState: "open" });
  transport.seedExactPull();
  transport.intakeState = "paused-new";
  transport.continuations = [{
    applicationId: APPLICATION_ID,
    builderGitHubUserId: VIEWER_ID,
    companionNumericRepositoryIds: [],
    primaryNumericRepositoryId: SOURCE_REPOSITORY_ID,
    pullRequestNumber: String(transport.pull.number)
  }];
  const plan = await planGitHubApplication({
    operation: "update",
    prepared,
    transport,
    pullRequestNumber: transport.pull.number
  });
  assert.deepEqual(plan.externalWrites, []);

  transport.continuations[0].builderGitHubUserId = "999";
  await assert.rejects(
    () => planGitHubApplication({
      operation: "update",
      prepared,
      transport,
      pullRequestNumber: transport.pull.number
    }),
    errorCode("INTAKE_PAUSED_NEW")
  );
});

test("duplicate application pull requests fail closed", async () => {
  const prepared = makePrepared();
  const transport = new FakeTransport({ prepared });
  transport.seedExactPull();
  transport.extraPull = transport.makePull({ number: 8 });
  await assert.rejects(
    () => planGitHubApplication({ operation: "update", prepared, transport }),
    errorCode("DUPLICATE_APPLICATION_PULL_REQUESTS")
  );
});

test("a foreign pull request copying the canonical title cannot block the builder", async () => {
  const prepared = makePrepared();
  const transport = new FakeTransport({ prepared });
  transport.extraPull = transport.makePull({ number: 8 });
  transport.extraPull.user = { id: "999", login: "attacker" };
  transport.extraPull.head.ref = "copied-title";
  transport.extraPull.head.repo = { id: "998", full_name: "attacker/programmable-registry" };

  const plan = await planGitHubApplication({ operation: "submit", prepared, transport });
  assert.equal(plan.pullRequest, null);
  assert.deepEqual(plan.externalWrites, [
    "create-viewer-fork",
    "create-application-branch-commit",
    "open-draft-pull-request"
  ]);
});

test("a pull-request path traversal record fails closed before any write", async () => {
  const prepared = makePrepared();
  const transport = new FakeTransport({ prepared });
  transport.seedExactPull();
  const originalGetPullFiles = transport.getPullFiles.bind(transport);
  transport.getPullFiles = async (...args) => {
    const files = await originalGetPullFiles(...args);
    files[0].filename = `submissions/${APPLICATION_ID}/../outside.json`;
    return files;
  };
  await assert.rejects(
    () => planGitHubApplication({ operation: "update", prepared, transport }),
    errorCode("GITHUB_OUTPUT_INVALID")
  );
  assert.equal(transport.writeCalls.length, 0);
});

test("update is idempotent and never opens a second pull request", async () => {
  const prepared = makePrepared();
  const transport = new FakeTransport({ prepared });
  transport.seedExactPull();
  const plan = await planGitHubApplication({
    operation: "update",
    prepared,
    transport,
    pullRequestNumber: transport.pull.number
  });
  assert.deepEqual(plan.externalWrites, []);
  const result = await executeGitHubApplication({
    operation: "update",
    prepared,
    transport,
    confirmationDigest: null,
    pullRequestNumber: transport.pull.number
  });
  assert.equal(result.alreadyApplied, true);
  assert.equal(transport.writeCalls.length, 0);
  assert.equal(transport.pull.number, 7);
});

test("update fast-forwards the existing draft and refreshes its metadata without duplication", async () => {
  const prepared = makePrepared();
  const transport = new FakeTransport({ prepared });
  transport.seedExactPull();
  const oldFiles = new Map(transport.commitFiles.get(CREATED_COMMIT));
  oldFiles.set(`submissions/${APPLICATION_ID}/PROPOSAL.md`, "# Proposal\n\nSuperseded bytes.\n");
  transport.commitFiles.set(CREATED_COMMIT, oldFiles);
  transport.pull.body = "superseded public body";
  transport.branchReadbackNotFoundAttempts = 1;

  const plan = await planGitHubApplication({
    operation: "update",
    prepared,
    transport,
    pullRequestNumber: transport.pull.number
  });
  assert.deepEqual(plan.externalWrites, [
    "append-application-branch-commit-and-fast-forward",
    "update-draft-pull-request-metadata"
  ]);
  const sleeps = [];
  const result = await executeGitHubApplication({
    operation: "update",
    prepared,
    transport,
    confirmationDigest: plan.confirmationDigest,
    pullRequestNumber: transport.pull.number,
    sleep: async (milliseconds) => sleeps.push(milliseconds)
  });
  assert.deepEqual(result.actions, [
    "updated-application-branch",
    "updated-draft-pull-request-metadata"
  ]);
  assert.equal(transport.branchCommit, UPDATED_COMMIT);
  assert.equal(transport.pull.number, 7);
  assert.equal(transport.pull.body, normalizePreparedApplication(prepared).body);
  assert.deepEqual(sleeps, [500]);
  assert.equal(transport.writeCalls.filter((value) => value === "createRef").length, 0);
  assert.equal(transport.writeCalls.filter((value) => value === "updateRef").length, 1);
  assert.equal(transport.writeCalls.filter((value) => value === "createDraftPull").length, 0);
});

test("persistent 404s after updateRef never repeat the ref write or update PR metadata", async () => {
  const prepared = makePrepared();
  const transport = new FakeTransport({ prepared });
  transport.seedExactPull();
  const oldFiles = new Map(transport.commitFiles.get(CREATED_COMMIT));
  oldFiles.set(`submissions/${APPLICATION_ID}/PROPOSAL.md`, "# Proposal\n\nSuperseded bytes.\n");
  transport.commitFiles.set(CREATED_COMMIT, oldFiles);
  transport.pull.body = "superseded public body";
  transport.branchReadbackNotFoundAttempts = 20;
  const plan = await planGitHubApplication({
    operation: "update",
    prepared,
    transport,
    pullRequestNumber: transport.pull.number
  });
  const sleeps = [];
  await assert.rejects(() => executeGitHubApplication({
    operation: "update",
    prepared,
    transport,
    confirmationDigest: plan.confirmationDigest,
    pullRequestNumber: transport.pull.number,
    sleep: async (milliseconds) => sleeps.push(milliseconds)
  }), errorCode("APPLICATION_BRANCH_NOT_READY"));

  assert.deepEqual(sleeps, Array(10).fill(500));
  assert.equal(transport.branchReadbackPollCalls, 11);
  assert.equal(transport.writeCalls.filter((value) => value === "createRef").length, 0);
  assert.equal(transport.writeCalls.filter((value) => value === "updateRef").length, 1);
  assert.equal(transport.writeCalls.filter((value) => value === "updatePull").length, 0);
  assert.equal(transport.writeCalls.filter((value) => value === "createDraftPull").length, 0);
});

test("a failed PR creation resumes from the exact branch without another commit", async () => {
  const prepared = makePrepared();
  const transport = new FakeTransport({ prepared, failCreatePullOnce: true });
  const firstPlan = await planGitHubApplication({ operation: "submit", prepared, transport });
  await assert.rejects(
    () => executeGitHubApplication({
      operation: "submit",
      prepared,
      transport,
      confirmationDigest: firstPlan.confirmationDigest,
      sleep: async () => {}
    }),
    errorCode("GITHUB_REQUEST_FAILED")
  );
  assert.equal(transport.branchCommit, CREATED_COMMIT);
  const commitWrites = transport.writeCalls.filter((value) => value === "createCommit").length;

  const recoveryPlan = await planGitHubApplication({ operation: "submit", prepared, transport });
  assert.deepEqual(recoveryPlan.externalWrites, ["open-draft-pull-request"]);
  const result = await executeGitHubApplication({
    operation: "submit",
    prepared,
    transport,
    confirmationDigest: recoveryPlan.confirmationDigest,
    sleep: async () => {}
  });
  assert.equal(result.status.status, "submitted");
  assert.equal(transport.writeCalls.filter((value) => value === "createCommit").length, commitWrites);
});

test("an unverified matching branch is rebuilt instead of opened as a pull request", async () => {
  const prepared = makePrepared();
  const transport = new FakeTransport({ prepared });
  transport.forkExists = true;
  transport.branchCommit = CREATED_COMMIT;
  transport.commitFiles.set(
    CREATED_COMMIT,
    new Map(transport.prepared.package.files.map((record) => [record.path, record.content]))
  );
  const exactComparison = transport.compareBranch.bind(transport);
  transport.compareBranch = async (...args) => {
    const comparison = await exactComparison(...args);
    comparison.files.push({ filename: "unexpected/public.txt", status: "added", sha: "d".repeat(40) });
    return comparison;
  };
  const plan = await planGitHubApplication({ operation: "submit", prepared, transport });
  assert.deepEqual(plan.externalWrites, [
    "append-application-branch-commit-and-fast-forward",
    "open-draft-pull-request"
  ]);
});

test("status maps GitHub signals without inventing approval", async (t) => {
  const base = rawPull({ draft: true });
  for (const [name, mutate, expected] of [
    ["draft", () => ({ pull: base, reviews: [], checks: [] }), "submitted"],
    ["running checks", () => ({ pull: base, reviews: [], checks: [rawCheck({ status: "in_progress" })] }), "checks-running"],
    ["failed check", () => ({ pull: base, reviews: [], checks: [rawCheck({ status: "completed", conclusion: "failure" })] }), "changes-requested"],
    ["review change request", () => ({ pull: base, reviews: [rawReview("CHANGES_REQUESTED")], checks: [] }), "changes-requested"],
    ["untrusted change request", () => ({ pull: base, reviews: [{ ...rawReview("CHANGES_REQUESTED"), user: { id: "902", login: "reviewer" } }], checks: [] }), "submitted"],
    ["missing required checks", () => ({ pull: rawPull({ draft: false }), reviews: [], checks: [] }), "checks-running"],
    ["skipped required check", () => ({ pull: rawPull({ draft: false }), reviews: [], checks: rawRequiredChecks({ publicIntakeConclusion: "skipped" }) }), "checks-running"],
    ["wrong check app", () => ({ pull: rawPull({ draft: false }), reviews: [], checks: rawRequiredChecks({ appId: "999" }) }), "checks-running"],
    ["unrelated optional failure", () => ({ pull: rawPull({ draft: false }), reviews: [], checks: [...rawRequiredChecks(), rawCheck({ id: "899", name: "optional-lint", conclusion: "failure" })] }), "waiting-review"],
    ["architecture label", () => ({ pull: rawPull({ draft: false, labels: ["builder:architecture-review"] }), reviews: [], checks: rawRequiredChecks() }), "architecture-review"],
    ["review label", () => ({ pull: rawPull({ draft: false, labels: ["builder:review-in-progress"] }), reviews: [], checks: rawRequiredChecks() }), "review-in-progress"],
    ["ready", () => ({ pull: rawPull({ draft: false }), reviews: [], checks: rawRequiredChecks() }), "waiting-review"],
    ["merged record", () => ({ pull: rawPull({ state: "closed", draft: false, mergedAt: "2026-08-02T01:02:03Z" }), reviews: [], checks: [] }), "review-record-merged"],
    ["closed", () => ({ pull: rawPull({ state: "closed", draft: false }), reviews: [], checks: [] }), "closed"]
  ]) {
    await t.test(name, () => {
      assert.equal(projectGitHubStatus(mutate()), expected);
    });
  }
});

test("status accepts a full first review page and selects the latest review by immutable id", () => {
  const reviews = Array.from({ length: 98 }, (_, index) => ({
    ...rawReview("COMMENTED"),
    id: String(800 + index),
    user: { id: String(10_000 + index), login: `reviewer-${index}` }
  }));
  reviews.unshift({
    ...rawReview("APPROVED"),
    id: "1000"
  });
  reviews.push({
    ...rawReview("CHANGES_REQUESTED"),
    id: "999"
  });

  assert.equal(reviews.length, 100);
  assert.equal(projectGitHubStatus({
    pull: rawPull({ draft: false }),
    reviews,
    checks: rawRequiredChecks()
  }), "waiting-review");
});

test("status re-reads the PR and reports a different prepared package without calling it approved", async () => {
  const prepared = makePrepared();
  const transport = new FakeTransport({ prepared });
  transport.seedExactPull();
  transport.reviews = [rawReview("CHANGES_REQUESTED")];
  const status = await readGitHubApplicationStatus({
    prepared,
    transport,
    pullRequestNumber: transport.pull.number
  });
  assert.equal(status.status, "changes-requested");
  assert.equal(status.applicationResult, "architecture-review-required");
  assert.deepEqual(status.nextAction, {
    code: "fix-and-update-existing-draft",
    owner: "builder",
    instruction: "Fix the exact failed check or maintainer feedback, rerun the Builder, and update this same pull request."
  });
  assert.equal(status.packageMatchesPrepared, true);
  assert.match(status.authorityBoundary, /not W2 application status/iu);
  assert.deepEqual(status.verificationScope, {
    registryChecks: "application-package-only",
    sourceWorkflowRunCount: 0,
    projectSourceCodeExecutedByRegistry: false,
    sourceWorkflowQualityReviewedByRegistry: false,
    independentAuditPerformed: false,
    deploymentOrLaunchProven: false
  });
  assert.deepEqual(status.checks.required, [
    {
      name: "public-intake",
      state: "missing",
      detailsUrl: null
    },
    {
      name: "Node 24",
      state: "missing",
      detailsUrl: null
    }
  ]);
  assert.equal(transport.writeCalls.length, 0);
});

test("status preserves the canonical trusted Registry check details link", async () => {
  const prepared = makePrepared();
  const transport = new FakeTransport({ prepared });
  transport.seedExactPull();
  transport.checks = rawRequiredChecks();
  const status = await readGitHubApplicationStatus({
    prepared,
    transport,
    pullRequestNumber: transport.pull.number
  });
  assert.deepEqual(status.checks.required.map(({ name, state, detailsUrl }) => ({ name, state, detailsUrl })), [
    {
      name: "public-intake",
      state: "passing",
      detailsUrl: "https://github.com/0xprogrammable/submit-launch/actions/runs/1001/job/801"
    },
    {
      name: "Node 24",
      state: "passing",
      detailsUrl: "https://github.com/0xprogrammable/submit-launch/actions/runs/1001/job/802"
    }
  ]);
});

test("status reports declared source workflow count without calling it code verification", async () => {
  const prepared = makePrepared({ githubActionsRunIds: ["10", "2"] });
  const transport = new FakeTransport({ prepared });
  transport.seedExactPull();
  const status = await readGitHubApplicationStatus({
    prepared,
    transport,
    pullRequestNumber: transport.pull.number
  });

  assert.equal(status.verificationScope.sourceWorkflowRunCount, 2);
  assert.equal(status.verificationScope.projectSourceCodeExecutedByRegistry, false);
  assert.equal(status.verificationScope.sourceWorkflowQualityReviewedByRegistry, false);
});

test("status rejects a noncanonical check details link", async () => {
  const prepared = makePrepared();
  const transport = new FakeTransport({ prepared });
  transport.seedExactPull();
  transport.checks = rawRequiredChecks();
  transport.checks[0].details_url = "https://example.com/not-registry-ci";
  await assert.rejects(
    () => readGitHubApplicationStatus({
      prepared,
      transport,
      pullRequestNumber: transport.pull.number
    }),
    errorCode("GITHUB_OUTPUT_INVALID")
  );
});

test("status exposes a changed remote six-file hash without accepting it as the prepared target", async () => {
  const prepared = makePrepared();
  const transport = new FakeTransport({ prepared });
  transport.seedExactPull();
  const changed = new Map(transport.commitFiles.get(CREATED_COMMIT));
  changed.set(`submissions/${APPLICATION_ID}/TEST_PLAN.md`, "# Test plan\n\nDifferent remote bytes.\n");
  transport.commitFiles.set(CREATED_COMMIT, changed);
  const status = await readGitHubApplicationStatus({
    prepared,
    transport,
    pullRequestNumber: transport.pull.number
  });
  assert.equal(status.packageMatchesPrepared, false);
  assert.equal(status.status, "submitted");
  assert.equal(status.nextAction.code, "refresh-and-update-existing-draft");
});

test("the gh command transport rejects malicious or ambiguous output", async (t) => {
  await t.test("dotted repository names stay valid while exact traversal segments fail closed", async () => {
    const endpoints = [];
    const transport = createGhTransport({
      runner: async ({ args }) => {
        endpoints.push(args.at(-1));
        return { status: 0, stdout: "{}", stderr: "" };
      }
    });

    await transport.getRepository("owner/repo..x");
    await transport.getRepository("owner/..x");
    assert.deepEqual(endpoints, ["repos/owner/repo..x", "repos/owner/..x"]);
    await assert.rejects(() => transport.getRepository("owner/.."), errorCode("INTERNAL_ERROR"));
    assert.equal(endpoints.length, 2);

    assert.equal(isSafeGitHubApiEndpoint("repos/owner/repo..x"), true);
    assert.equal(isSafeGitHubApiEndpoint("repos/owner/..x"), true);
    assert.equal(isSafeGitHubApiEndpoint("search/issues?q=repo..x&per_page=100"), true);
    for (const endpoint of [
      "repos/owner/./secret",
      "repos/owner/../secret",
      "repos/owner/%2e/secret",
      "repos/owner/%2e%2e/secret",
      "repos/owner/%2E./secret",
      "repos/owner/%2e%2e%2Fsecret",
      "repos/owner/%5Csecret",
      "repos/owner/%ZZ",
      "/repos/owner/repository",
      "repos//owner/repository"
    ]) assert.equal(isSafeGitHubApiEndpoint(endpoint), false, endpoint);
  });

  await t.test("two JSON values", async () => {
    const transport = createGhTransport({
      runner: async () => ({ status: 0, stdout: '{"id":101,"login":"builder"}\n{"id":202}', stderr: "" })
    });
    await assert.rejects(() => transport.getViewer(), errorCode("GITHUB_OUTPUT_INVALID"));
  });

  await t.test("oversized output", async () => {
    const transport = createGhTransport({
      runner: async () => ({ status: 0, stdout: "x".repeat(4_000_001), stderr: "" })
    });
    await assert.rejects(() => transport.getViewer(), errorCode("GITHUB_OUTPUT_INVALID"));
  });

  await t.test("runner uses argument arrays and no shell string", async () => {
    let invocation;
    const transport = createGhTransport({
      runner: async (value) => {
        invocation = value;
        return {
          status: 0,
          stdout: canonicalJson({ id: 101, login: "builder", html_url: "https://github.com/builder" }),
          stderr: ""
        };
      }
    });
    await transport.getViewer();
    assert.equal(invocation.command, "gh");
    assert.ok(Array.isArray(invocation.args));
    assert.equal(Object.hasOwn(invocation, "shell"), false);
    assert.deepEqual(invocation.args.slice(0, 3), ["api", "--hostname", "github.com"]);
  });

  await t.test("review reads continue past the first full page", async () => {
    const endpoints = [];
    const firstPage = Array.from({ length: 100 }, (_, index) => ({ id: index + 1 }));
    const transport = createGhTransport({
      runner: async ({ args }) => {
        const endpoint = args.at(-1);
        endpoints.push(endpoint);
        return {
          status: 0,
          stdout: canonicalJson(endpoint.endsWith("page=1") ? firstPage : [{ id: 101 }]),
          stderr: ""
        };
      }
    });
    const reviews = await transport.getPullReviews("0xprogrammable/submit-launch", 7);
    assert.equal(reviews.length, 101);
    assert.match(endpoints[0], /per_page=100&page=1$/u);
    assert.match(endpoints[1], /per_page=100&page=2$/u);
  });

  await t.test("check-run reads continue until the declared immutable-head total is complete", async () => {
    const endpoints = [];
    const firstPage = Array.from({ length: 100 }, (_, index) => ({ id: index + 1 }));
    const transport = createGhTransport({
      runner: async ({ args }) => {
        const endpoint = args.at(-1);
        endpoints.push(endpoint);
        return {
          status: 0,
          stdout: canonicalJson({
            total_count: 101,
            check_runs: endpoint.endsWith("page=1") ? firstPage : [{ id: 101 }]
          }),
          stderr: ""
        };
      }
    });
    const response = await transport.getCheckRuns(
      "0xprogrammable/submit-launch",
      "11".repeat(20)
    );
    assert.equal(response.total_count, 101);
    assert.equal(response.check_runs.length, 101);
    assert.match(endpoints[0], /per_page=100&page=1$/u);
    assert.match(endpoints[1], /per_page=100&page=2$/u);
  });
});

test("the gh command transport preserves the exact multiline application commit message", async () => {
  const message = `chore(builder): submit ${APPLICATION_ID} revision 1\n\nPackage: sha256:${"8".repeat(64)}`;
  let invocation = null;
  const response = { sha: CREATED_COMMIT, tree: { sha: FORK_TREE } };
  const transport = createGhTransport({
    runner: async (value) => {
      invocation = value;
      return { status: 0, stdout: canonicalJson(response), stderr: "" };
    }
  });

  assert.deepEqual(await transport.createCommit("builder/submit-launch", {
    message,
    tree: FORK_TREE,
    parents: [CENTRAL_COMMIT]
  }), response);
  assert.equal(invocation.command, "gh");
  assert.ok(invocation.args.includes("repos/builder/submit-launch/git/commits"));
  assert.deepEqual(JSON.parse(invocation.stdin), {
    message,
    parents: [CENTRAL_COMMIT],
    tree: FORK_TREE
  });
});

test("the gh command transport still rejects carriage returns in commit messages before any write", async () => {
  let calls = 0;
  const transport = createGhTransport({
    runner: async () => {
      calls += 1;
      return { status: 0, stdout: "{}", stderr: "" };
    }
  });

  await assert.rejects(() => transport.createCommit("builder/submit-launch", {
    message: "subject\r\n\r\nbody",
    tree: FORK_TREE,
    parents: [CENTRAL_COMMIT]
  }), errorCode("GITHUB_OUTPUT_INVALID"));
  assert.equal(calls, 0);
});

test("the gh command transport encodes the recovery comparison as one safe API segment", async () => {
  let invocation = null;
  const response = { ahead_by: 1, behind_by: 0, total_commits: 1 };
  const transport = createGhTransport({
    runner: async (value) => {
      invocation = value;
      return { status: 0, stdout: canonicalJson(response), stderr: "" };
    }
  });

  assert.deepEqual(await transport.compareBranch({
    centralRepository: "0xprogrammable/submit-launch",
    baseCommit: CENTRAL_COMMIT,
    headLogin: "builder",
    headBranch: `programmable-builder/${APPLICATION_ID}`
  }), response);
  const endpoint = `repos/0xprogrammable/submit-launch/compare/${CENTRAL_COMMIT}%2E%2E%2Ebuilder%3Aprogrammable-builder%2F${APPLICATION_ID}?per_page=100`;
  assert.ok(invocation.args.includes(endpoint));
  assert.equal(endpoint.includes(".."), false);
});

test("the gh recovery comparison still rejects branch traversal before any request", async (t) => {
  for (const branch of [
    "programmable-builder/../main",
    "programmable-builder//main",
    "programmable-builder/%2e%2e/main"
  ]) {
    await t.test(branch, async () => {
      let calls = 0;
      const transport = createGhTransport({
        runner: async () => {
          calls += 1;
          return { status: 0, stdout: "{}", stderr: "" };
        }
      });
      await assert.rejects(() => transport.compareBranch({
        centralRepository: "0xprogrammable/submit-launch",
        baseCommit: CENTRAL_COMMIT,
        headLogin: "builder",
        headBranch: branch
      }), errorCode("GITHUB_OUTPUT_INVALID"));
      assert.equal(calls, 0);
    });
  }
});

test("the gh transport maps only a terminal 404 for ref and content propagation reads", async () => {
  const terminal404 = createGhTransport({
    runner: async () => ({ status: 1, stdout: "", stderr: "gh: Not Found (HTTP 404)" })
  });
  assert.equal(await terminal404.getRef(
    "builder/submit-launch",
    `programmable-builder/${APPLICATION_ID}`,
    { allowNotFound: true }
  ), null);
  assert.equal(await terminal404.getContent(
    "builder/submit-launch",
    `submissions/${APPLICATION_ID}/application.json`,
    CREATED_COMMIT,
    { allowNotFound: true }
  ), null);

  for (const [stderr, expectedCode] of [
    ["gh: Validation Failed (HTTP 422)", "GITHUB_REQUEST_FAILED"],
    ["gh: upstream reported HTTP 404; final request failed (HTTP 500)", "GITHUB_GET_RETRY_EXHAUSTED"]
  ]) {
    let calls = 0;
    const transport = createGhTransport({
      getAttempts: 1,
      runner: async () => {
        calls += 1;
        return { status: 1, stdout: "", stderr };
      }
    });
    await assert.rejects(() => transport.getRef(
      "builder/submit-launch",
      `programmable-builder/${APPLICATION_ID}`,
      { allowNotFound: true }
    ), errorCode(expectedCode));
    assert.equal(calls, 1);
  }
});

test("the gh command transport exposes only draft-pull 404 as a bounded retry signal", async () => {
  const requests = [];
  const response = { number: 7 };
  const transport = createGhTransport({
    runner: async (value) => {
      requests.push(value);
      if (requests.length === 1) {
        return { status: 1, stdout: "", stderr: "gh: Not Found (HTTP 404)" };
      }
      return { status: 0, stdout: canonicalJson(response), stderr: "" };
    }
  });
  const input = {
    title: `[Builder Beta] ${APPLICATION_ID}`,
    body: "body",
    head: `builder:programmable-builder/${APPLICATION_ID}`,
    base: "main"
  };

  assert.equal(await transport.createDraftPull("0xprogrammable/submit-launch", input), null);
  assert.deepEqual(await transport.createDraftPull("0xprogrammable/submit-launch", input), response);
  assert.equal(requests.length, 2);

  for (const stderr of [
    "gh: Validation Failed (HTTP 422)",
    "gh: resource Not Found upstream (HTTP 500)",
    "gh: upstream reported HTTP 404; final request failed (HTTP 500)"
  ]) {
    let nonNotFoundCalls = 0;
    const nonNotFound = createGhTransport({
      runner: async () => {
        nonNotFoundCalls += 1;
        return { status: 1, stdout: "", stderr };
      }
    });
    await assert.rejects(
      () => nonNotFound.createDraftPull("0xprogrammable/submit-launch", input),
      errorCode("GITHUB_REQUEST_FAILED")
    );
    assert.equal(nonNotFoundCalls, 1);
  }

  const emptySuccess = createGhTransport({
    runner: async () => ({ status: 0, stdout: "", stderr: "" })
  });
  await assert.rejects(
    () => emptySuccess.createDraftPull("0xprogrammable/submit-launch", input),
    errorCode("GITHUB_OUTPUT_INVALID")
  );
});

test("receipts are bounded, idempotent, and cannot enter the source repo", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-github-receipt-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, "source");
  const receipts = path.join(root, "receipts");
  fs.mkdirSync(source);
  fs.mkdirSync(receipts);
  const payload = {
    applicationId: APPLICATION_ID,
    applicationRevision: 1,
    pullRequestNumber: 7,
    pullRequestUrl: "https://github.com/0xprogrammable/submit-launch/pull/7",
    githubStatus: "submitted",
    applicationResult: "architecture-review-required",
    headCommit: CREATED_COMMIT,
    packageMatchesPrepared: true,
    preparedPackageDigest: `sha256:${"a".repeat(64)}`,
    confirmationDigest: `sha256:${"b".repeat(64)}`,
    externalActionsPerformed: ["opened-draft-pull-request"]
  };
  const first = writeLocalReceipt({ receiptDirectory: receipts, sourceRepositoryRoot: source, receipt: payload });
  const second = writeLocalReceipt({ receiptDirectory: receipts, sourceRepositoryRoot: source, receipt: payload });
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(first.path, second.path);
  assert.ok(fs.statSync(first.path).size < 65_536);
  assert.throws(
    () => writeLocalReceipt({ receiptDirectory: source, sourceRepositoryRoot: source, receipt: payload }),
    errorCode("RECEIPT_PATH_INVALID")
  );

  const dotPrefixedInside = path.join(source, "..x-receipts");
  fs.mkdirSync(dotPrefixedInside);
  assert.throws(
    () => writeLocalReceipt({ receiptDirectory: dotPrefixedInside, sourceRepositoryRoot: source, receipt: payload }),
    errorCode("RECEIPT_PATH_INVALID")
  );
});

test("prepared-result containment treats ..x as an in-repository name and a real parent path as outside", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-github-prepared-path-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, "source");
  const insideDirectory = path.join(source, "..x-prepared");
  const insidePath = path.join(insideDirectory, "prepared.json");
  const outsidePath = path.join(root, "prepared.json");
  fs.mkdirSync(insideDirectory, { recursive: true });
  const bytes = `${canonicalJson(makePrepared())}\n`;
  fs.writeFileSync(insidePath, bytes);
  fs.writeFileSync(outsidePath, bytes);

  assert.throws(
    () => loadPreparedApplication(insidePath, { sourceRepositoryRoot: source }),
    errorCode("PREPARED_RESULT_PATH_INVALID")
  );
  assert.equal(
    loadPreparedApplication(outsidePath, { sourceRepositoryRoot: source }).applicationId,
    APPLICATION_ID
  );
});

test("legacy prepared applications reject duplicate decoded keys before canonical or semantic review", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-github-prepared-duplicates-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cases = [
    '{"applicationId":"same","applicationId":"same"}',
    '{"privateKey":"legacy-prepared-secret","privateKey":"redacted"}',
    '{"privateKey":"legacy-prepared-secret","private\\u004bey":"redacted"}'
  ];

  for (const [index, source] of cases.entries()) {
    const target = path.join(root, `prepared-${index}.json`);
    fs.writeFileSync(target, `${source}\n`);
    assert.throws(() => loadPreparedApplication(target), errorCode("PREPARED_RESULT_INVALID"));
  }
});

function makePrepared({ priorRevision = null, companions = [], githubActionsRunIds = [] } = {}) {
  const source = {
    schemaVersion: "1.0.0",
    primary: {
      repositoryUri: "https://github.com/builder/project",
      numericRepositoryId: SOURCE_REPOSITORY_ID,
      revisionObjectId: SOURCE_COMMIT,
      treeObjectId: SOURCE_TREE,
      sourcePaths: ["submissions/example-hook/submission.json"],
      contractPaths: [],
      githubActionsRunIds
    },
    companions: structuredClone(companions)
  };
  const reviewContents = new Map([
    ["PROPOSAL.md", "# Proposal\n\nA concrete proposal.\n"],
    ["TEST_PLAN.md", "# Test plan\n\nA concrete test plan.\n"],
    ["THREAT_MODEL.md", "# Threat model\n\nA concrete threat model.\n"],
    ["compatibility-report.json", `${canonicalJson({ result: "architecture-review-required", schemaVersion: 1 })}\n`],
    ["evidence-index.json", `${canonicalJson({ evidence: [], schemaVersion: 1 })}\n`]
  ]);
  const reviewPackage = [...reviewContents].map(([filePath, content]) => fileRecord(filePath, content));
  const application = {
    schemaVersion: 2,
    applicationId: APPLICATION_ID,
    applicationRevision: priorRevision === null ? 1 : priorRevision + 1,
    stage: "proposal",
    title: "Example hook",
    summary: "An example hook with concrete public review evidence.",
    builder: {
      githubUserId: VIEWER_ID,
      githubLogin: "builder",
      contact: "https://github.com/builder"
    },
    builderTemplate: {
      schemaVersion: "1.0.0",
      source: "manual",
      templateSelection: null
    },
    source,
    companionClosure: [],
    programmableFee: { policyId: "programmable-volume-fee-v1" },
    reviewPackage: reviewPackage.map(({ path: filePath, byteLength, sha256 }) => ({
      path: filePath,
      byteLength,
      sha256
    })),
    declarations: {
      publicInformationAcknowledged: true,
      noSecretsDeclared: true,
      noApprovalClaim: true,
      noUniswapEndorsementClaim: true
    }
  };
  const filesByPath = new Map(reviewPackage.map((record) => [record.path, record]));
  filesByPath.set("application.json", fileRecord("application.json", `${canonicalJson(application)}\n`));
  const files = CENTRAL_APPLICATION_FILES.map((filePath) => filesByPath.get(filePath));
  const revision = application.applicationRevision;
  return {
    title: `[Builder Beta] ${APPLICATION_ID}`,
    body: buildCanonicalApplicationPullRequestBody({
      applicationId: APPLICATION_ID,
      stage: "proposal",
      sourceRepositorySlug: "builder/project",
      sourceRepositoryUrl: "https://github.com/builder/project",
      builderGitHubLogin: "builder",
      builderGitHubUserId: VIEWER_ID,
      sourceRepositoryId: SOURCE_REPOSITORY_ID,
      companionCount: companions.length,
      centralBaseCommit: CENTRAL_COMMIT,
      applicationRevision: revision,
      sourceCommit: SOURCE_COMMIT,
      sourceTree: SOURCE_TREE,
      compatibilityResult: "architecture-review-required",
      centralFileCount: 6
    }).body,
    sourceHead: {
      repositorySlug: "builder/project",
      repositoryUrl: "https://github.com/builder/project",
      branch: "main",
      upstreamBranch: "main",
      remote: "origin",
      commit: SOURCE_COMMIT,
      tree: SOURCE_TREE
    },
    centralPullRequestTarget: {
      repositorySlug: "0xprogrammable/submit-launch",
      repositoryUrl: "https://github.com/0xprogrammable/submit-launch",
      baseBranch: "main",
      baseCommit: CENTRAL_COMMIT,
      baseTree: CENTRAL_TREE,
      applicationDirectory: `submissions/${APPLICATION_ID}`,
      applicationPath: `submissions/${APPLICATION_ID}/application.json`,
      priorApplicationRevision: priorRevision,
      nextApplicationRevision: revision,
      pullRequestHeadCreated: false
    },
    github: {
      owner: "builder",
      repository: "project",
      repositorySlug: "builder/project",
      repositoryId: SOURCE_REPOSITORY_ID,
      repositoryUrl: "https://github.com/builder/project",
      configuredRemoteUrl: "https://github.com/builder/project.git",
      commitUrl: `https://github.com/builder/project/commit/${SOURCE_COMMIT}`,
      publicCommitReachable: true,
      sourceRequest: source,
      sourceResolutionHash: `sha256:${"7".repeat(64)}`,
      sourceResolution: {},
      companionClosure: []
    },
    submission: {
      package: `submissions/${APPLICATION_ID}`,
      modelId: APPLICATION_ID,
      stage: "proposal",
      hash: `sha256:${"8".repeat(64)}`,
      reviewTargetHash: `sha256:${"9".repeat(64)}`,
      preflightDecision: "PROTOTYPE_READY",
      intakeValidated: true
    },
    applicationAdapter: {
      targetPath: `submissions/${APPLICATION_ID}/application.json`,
      applicationRevision: revision,
      schemaStatus: "validator-compatible-six-file-package",
      publicGitHubApplicationReady: true
    },
    centralPackage: {
      targetDirectory: `submissions/${APPLICATION_ID}`,
      stage: "proposal",
      applicationRevision: revision,
      compatibilityResult: "architecture-review-required",
      fileCount: 6,
      fileOrder: [...CENTRAL_APPLICATION_FILES],
      encoding: "utf8",
      generated: true,
      validatorContract: "public-pr-application-v2",
      files
    },
    requiresHumanConfirmation: true,
    localWritesPerformed: [],
    externalReadChecksPerformed: [],
    externalActionsPerformed: []
  };
}

function fileRecord(filePath, content) {
  const bytes = Buffer.from(content, "utf8");
  return {
    path: filePath,
    content,
    byteLength: bytes.length,
    sha256: digest(bytes)
  };
}

class FakeTransport {
  constructor({
    prepared,
    viewerId = VIEWER_ID,
    sourcePush = true,
    sourceAdmin = false,
    intakeState = "open",
    failCreatePullOnce = false,
    draftPullNotFoundAttempts = 0,
    draftPullNotFoundCreatesPullAtAttempt = null
  }) {
    this.prepared = normalizePreparedApplication(prepared);
    this.viewer = { id: viewerId, login: "builder", html_url: "https://github.com/builder" };
    this.sourcePush = sourcePush;
    this.sourceAdmin = sourceAdmin;
    this.intakeState = intakeState;
    this.continuations = [];
    this.centralCommit = CENTRAL_COMMIT;
    this.forkExists = false;
    this.forkRepositoryId = FORK_REPOSITORY_ID;
    this.branchCommit = null;
    this.branchWriteCompleted = false;
    this.branchReadbackPending = false;
    this.branchReadbackNotFoundAttempts = 0;
    this.branchReadbackError = null;
    this.branchReadbackWrongCommit = null;
    this.branchReadbackPollCalls = 0;
    this.branchWriteResponseWrongCommit = null;
    this.forkDriftAfterBranchWrite = false;
    this.packageReadbackNotFoundAttempts = 0;
    this.packageReadbackError = null;
    this.packageReadbackCalls = 0;
    this.commitFiles = new Map();
    this.pendingFiles = null;
    this.pull = null;
    this.extraPull = null;
    this.reviews = [];
    this.checks = [];
    this.writeCalls = [];
    this.failCreatePullOnce = failCreatePullOnce;
    this.draftPullNotFoundAttempts = draftPullNotFoundAttempts;
    this.draftPullNotFoundCreatesPullAtAttempt = draftPullNotFoundCreatesPullAtAttempt;
    this.draftPullCalls = 0;
  }

  async getViewer() {
    return structuredClone(this.viewer);
  }

  async getRepository(slug, { allowNotFound = false } = {}) {
    if (slug === "0xprogrammable/submit-launch") return repository({
      slug,
      id: CENTRAL_REPOSITORY_ID,
      ownerId: "1",
      ownerLogin: "0xprogrammable",
      permissions: { push: false, admin: false, maintain: false }
    });
    if (slug === "builder/project") return repository({
      slug,
      id: SOURCE_REPOSITORY_ID,
      ownerId: VIEWER_ID,
      ownerLogin: "builder",
      permissions: { push: this.sourcePush, admin: this.sourceAdmin, maintain: this.sourcePush }
    });
    const companion = this.prepared.companions.find((record) => record.repositorySlug === slug);
    if (companion !== undefined) return repository({
      slug,
      id: companion.numericRepositoryId,
      ownerId: "2",
      ownerLogin: slug.split("/")[0],
      permissions: { push: false, admin: false, maintain: false }
    });
    if (slug.toLowerCase() === "builder/submit-launch") {
      if (!this.forkExists) {
        if (allowNotFound) return null;
        throw new GitHubApplicationError("GITHUB_REQUEST_FAILED", "fork missing");
      }
      return repository({
        slug: "builder/submit-launch",
        id: this.forkRepositoryId,
        ownerId: VIEWER_ID,
        ownerLogin: "builder",
        fork: true,
        parent: { id: CENTRAL_REPOSITORY_ID, full_name: "0xprogrammable/submit-launch" },
        permissions: { push: true, admin: true, maintain: true }
      });
    }
    if (allowNotFound) return null;
    throw new GitHubApplicationError("GITHUB_REQUEST_FAILED", "repository missing");
  }

  async getGitCommit(slug, commit) {
    if (slug === "builder/project" && commit === SOURCE_COMMIT) {
      return { sha: SOURCE_COMMIT, tree: { sha: SOURCE_TREE } };
    }
    if (slug === "0xprogrammable/submit-launch" && commit === CENTRAL_COMMIT) {
      return { sha: CENTRAL_COMMIT, tree: { sha: CENTRAL_TREE } };
    }
    const companion = this.prepared.companions.find((record) => (
      record.repositorySlug === slug && record.commit === commit
    ));
    if (companion !== undefined) {
      return { sha: companion.commit, tree: { sha: companion.tree } };
    }
    if (slug.toLowerCase() === "builder/submit-launch" && commit === CREATED_COMMIT) {
      return { sha: CREATED_COMMIT, tree: { sha: FORK_TREE } };
    }
    throw new GitHubApplicationError("GITHUB_REQUEST_FAILED", "commit missing");
  }

  async getRef(slug, branch, { allowNotFound = false } = {}) {
    if (slug === "builder/project" && branch === "main") return gitRef("main", SOURCE_COMMIT);
    if (slug === "0xprogrammable/submit-launch" && branch === "main") return gitRef("main", this.centralCommit);
    if (slug.toLowerCase() === "builder/submit-launch" && branch === this.prepared.branch) {
      if (this.branchWriteCompleted && this.branchReadbackPending) {
        this.branchReadbackPollCalls += 1;
        if (this.branchReadbackError !== null) throw this.branchReadbackError;
        if (this.branchReadbackNotFoundAttempts > 0) {
          this.branchReadbackNotFoundAttempts -= 1;
          if (allowNotFound) return null;
          throw new GitHubApplicationError("GITHUB_REQUEST_FAILED", "gh: Not Found (HTTP 404)");
        }
        if (this.branchReadbackWrongCommit !== null) return gitRef(branch, this.branchReadbackWrongCommit);
        this.branchReadbackPending = false;
      }
      if (this.branchCommit === null) {
        if (allowNotFound) return null;
        throw new GitHubApplicationError("GITHUB_REQUEST_FAILED", "branch missing");
      }
      return gitRef(branch, this.branchCommit);
    }
    if (allowNotFound) return null;
    throw new GitHubApplicationError("GITHUB_REQUEST_FAILED", "ref missing");
  }

  async getContent(slug, filePath, ref, { allowNotFound = false } = {}) {
    if (slug === "0xprogrammable/submit-launch" && filePath === "docs/builder/intake-status.json") {
      const content = `${canonicalJson({
        continuingPullRequests: this.continuations,
        schemaVersion: 2,
        state: this.intakeState
      })}\n`;
      return contentResponse(filePath, content);
    }
    if (slug.toLowerCase() === "builder/submit-launch") {
      if (this.branchWriteCompleted) {
        this.packageReadbackCalls += 1;
        if (this.packageReadbackError !== null) throw this.packageReadbackError;
        if (this.packageReadbackNotFoundAttempts > 0) {
          this.packageReadbackNotFoundAttempts -= 1;
          if (allowNotFound) return null;
          throw new GitHubApplicationError("GITHUB_REQUEST_FAILED", "gh: Not Found (HTTP 404)");
        }
      }
      const files = this.commitFiles.get(ref);
      const content = files?.get(filePath);
      if (content === undefined) throw new GitHubApplicationError("GITHUB_REQUEST_FAILED", "content missing");
      return contentResponse(filePath, content);
    }
    throw new GitHubApplicationError("GITHUB_REQUEST_FAILED", "content missing");
  }

  async listPullsByHead() {
    return [this.pull, this.extraPull]
      .filter((pull) => pull?.state === "open")
      .map((pull) => ({ number: pull.number }));
  }

  async searchOpenPulls() {
    return {
      total_count: [this.pull, this.extraPull].filter((pull) => pull?.state === "open").length,
      items: [this.pull, this.extraPull]
        .filter((pull) => pull?.state === "open")
        .map((pull) => ({ number: pull.number }))
    };
  }

  async getPull(_repository, number) {
    const pull = [this.pull, this.extraPull].find((record) => record?.number === Number(number));
    if (!pull) throw new GitHubApplicationError("GITHUB_REQUEST_FAILED", "pull missing");
    return structuredClone(pull);
  }

  async getPullFiles(_repository, number) {
    const pull = [this.pull, this.extraPull].find((record) => record?.number === Number(number));
    if (!pull) throw new GitHubApplicationError("GITHUB_REQUEST_FAILED", "pull missing");
    return this.prepared.package.files.map(({ path: filePath }) => ({
      filename: filePath,
      status: "added",
      sha: "a".repeat(40)
    }));
  }

  async getPullReviews() {
    return structuredClone(this.reviews);
  }

  async getCheckRuns() {
    return { total_count: this.checks.length, check_runs: structuredClone(this.checks) };
  }

  async compareBranch({ baseCommit }) {
    return {
      base_commit: { sha: baseCommit },
      merge_base_commit: { sha: baseCommit },
      ahead_by: 1,
      behind_by: 0,
      total_commits: 1,
      commits: [{ sha: this.branchCommit }],
      files: this.prepared.package.files.map(({ path: filePath }) => ({
        filename: filePath,
        status: "added",
        sha: "a".repeat(40)
      }))
    };
  }

  async createFork() {
    this.writeCalls.push("createFork");
    this.forkExists = true;
    return this.getRepository("builder/submit-launch");
  }

  async createTree(_repository, { files }) {
    this.writeCalls.push("createTree");
    this.pendingFiles = new Map(files.map((record) => [record.path, record.content]));
    return { sha: FORK_TREE };
  }

  async createCommit(_repository, { message, tree, parents }) {
    this.writeCalls.push("createCommit");
    assert.equal(tree, FORK_TREE);
    assert.match(message, /^chore\(builder\): (?:submit|update) /u);
    assert.match(message, /\n\nPackage: sha256:[0-9a-f]{64}$/u);
    assert.ok(Array.isArray(parents));
    assert.ok(parents.length >= 1);
    const commit = this.branchCommit === null ? CREATED_COMMIT : UPDATED_COMMIT;
    this.commitFiles.set(commit, this.pendingFiles);
    return { sha: commit, tree: { sha: FORK_TREE } };
  }

  async createRef(_repository, { branch, commit }) {
    this.writeCalls.push("createRef");
    this.branchCommit = commit;
    this.branchWriteCompleted = true;
    this.branchReadbackPending = true;
    if (this.forkDriftAfterBranchWrite) this.forkRepositoryId = "405";
    return gitRef(branch, this.branchWriteResponseWrongCommit ?? commit);
  }

  async updateRef(_repository, { branch, commit }) {
    this.writeCalls.push("updateRef");
    this.branchCommit = commit;
    this.branchWriteCompleted = true;
    this.branchReadbackPending = true;
    if (this.forkDriftAfterBranchWrite) this.forkRepositoryId = "405";
    if (this.pull !== null) this.pull.head.sha = commit;
    return gitRef(branch, this.branchWriteResponseWrongCommit ?? commit);
  }

  async createDraftPull(_repository, { title, body }) {
    this.writeCalls.push("createDraftPull");
    this.draftPullCalls += 1;
    if (this.draftPullNotFoundAttempts > 0) {
      this.draftPullNotFoundAttempts -= 1;
      if (this.draftPullNotFoundCreatesPullAtAttempt === this.draftPullCalls && this.pull === null) {
        this.pull = this.makePull({ title, body });
      }
      return null;
    }
    if (this.failCreatePullOnce) {
      this.failCreatePullOnce = false;
      throw new GitHubApplicationError("GITHUB_REQUEST_FAILED", "simulated pull failure");
    }
    this.pull = this.makePull({ title, body });
    return { number: this.pull.number };
  }

  async updatePull(_repository, number, { title, body }) {
    this.writeCalls.push("updatePull");
    assert.equal(this.pull.number, Number(number));
    this.pull.title = title;
    this.pull.body = body;
    return { number: this.pull.number };
  }

  seedExactPull() {
    this.forkExists = true;
    this.branchCommit = CREATED_COMMIT;
    this.commitFiles.set(
      CREATED_COMMIT,
      new Map(this.prepared.package.files.map((record) => [record.path, record.content]))
    );
    this.pull = this.makePull();
  }

  makePull({ number = 7, title = this.prepared.title, body = this.prepared.body } = {}) {
    return rawPull({
      number,
      title,
      body,
      headSha: this.branchCommit ?? CREATED_COMMIT,
      headRef: this.prepared.branch
    });
  }
}

function repository({
  slug,
  id,
  ownerId,
  ownerLogin,
  fork = false,
  parent = null,
  permissions
}) {
  return {
    id,
    full_name: slug,
    html_url: `https://github.com/${slug}`,
    private: false,
    fork,
    default_branch: "main",
    owner: { id: ownerId, login: ownerLogin },
    parent,
    permissions
  };
}

function gitRef(branch, commit) {
  return { ref: `refs/heads/${branch}`, object: { type: "commit", sha: commit } };
}

function contentResponse(filePath, content) {
  const bytes = Buffer.from(content, "utf8");
  return {
    type: "file",
    path: filePath,
    encoding: "base64",
    content: bytes.toString("base64"),
    size: bytes.length,
    sha: "a".repeat(40)
  };
}

function rawPull({
  number = 7,
  state = "open",
  draft = true,
  mergedAt = null,
  title = `[Builder Beta] ${APPLICATION_ID}`,
  body = "body",
  headSha = CREATED_COMMIT,
  headRef = `programmable-builder/${APPLICATION_ID}`,
  labels = []
} = {}) {
  return {
    number,
    state,
    draft,
    merged_at: mergedAt,
    html_url: `https://github.com/0xprogrammable/submit-launch/pull/${number}`,
    title,
    body,
    labels: labels.map((name) => ({ name })),
    changed_files: 6,
    user: { id: VIEWER_ID, login: "builder" },
    head: {
      ref: headRef,
      sha: headSha,
      repo: { id: FORK_REPOSITORY_ID, full_name: "builder/submit-launch" }
    },
    base: {
      ref: "main",
      sha: CENTRAL_COMMIT,
      repo: { id: CENTRAL_REPOSITORY_ID, full_name: "0xprogrammable/submit-launch" }
    }
  };
}

function rawReview(state) {
  return {
    id: "901",
    state,
    user: { id: "309941960", login: "0xprogrammable" },
    submitted_at: "2026-08-02T01:02:03Z"
  };
}

function rawCheck({
  id = "801",
  name = "public-intake",
  status = "completed",
  conclusion = "success",
  appId = "15368",
  appSlug = "github-actions",
  detailsUrl = null
} = {}) {
  const resolvedDetailsUrl = detailsUrl ?? `https://github.com/0xprogrammable/submit-launch/actions/runs/1001/job/${id}`;
  return {
    id,
    name,
    status,
    conclusion: status === "completed" ? conclusion : null,
    app: { id: appId, slug: appSlug },
    details_url: resolvedDetailsUrl
  };
}

function rawRequiredChecks({ publicIntakeConclusion = "success", appId = "15368" } = {}) {
  return [
    rawCheck({ id: "801", name: "public-intake", conclusion: publicIntakeConclusion, appId }),
    rawCheck({ id: "802", name: "Node 24", appId })
  ];
}

function digest(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function errorCode(code) {
  return (error) => error instanceof GitHubApplicationError && error.code === code;
}
