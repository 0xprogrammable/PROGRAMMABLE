import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { canonicalJson } from "./submission-core.mjs";

import {
  APPLICATION_COMPATIBILITY_RESULTS,
  CENTRAL_BASE_BRANCH,
  CENTRAL_REPOSITORY,
  CENTRAL_REPOSITORY_NAME,
  DIGEST_PATTERN,
  GITHUB_APPLICATION_CLIENT_VERSION,
  GITHUB_APPLICATION_STATUSES,
  MAX_RECEIPT_BYTES
} from "./github-application-constants.mjs";

import {
  apiPullNumber,
  arraysEqual,
  assertTransport,
  defaultSleep,
  fail,
  isPlainObject,
  normalizeOptionalPullNumber,
  pathsOverlap,
  requireApplicationId,
  requireBoolean,
  requireBoundedText,
  requireCommit,
  requireDigest,
  requirePullUrl,
  requireRevision,
  resolveDirectory,
  sha256Canonical,
  uniqueStrings
} from "./github-application-primitives.mjs";

import {
  assertViewerMatchesBuilder,
  normalizeCreatedCommit,
  normalizeCreatedTree,
  normalizeForkWriteResponse,
  normalizeNullableRef,
  normalizePull,
  normalizePullWriteResponse,
  normalizeRef,
  normalizeRepository,
  normalizeViewer,
  validateCentralRepository,
  validateFork
} from "./github-application-normalizers.mjs";

import { normalizePreparedApplication } from "./github-application-prepared-core.mjs";

import {
  assertAuthoritySnapshotUnchanged,
  assertOpenDraftPullTarget,
  discoverApplicationPull,
  inspectRecoverableBranch,
  inspectRemoteState,
  publicPullProjection,
  verifyPackageAtRef,
  verifyPullPackage
} from "./github-application-remote-core.mjs";

import { buildStatus } from "./github-application-status-core.mjs";

const MAX_DRAFT_PULL_CREATE_ATTEMPTS = 10;
const DRAFT_PULL_CREATE_RETRY_DELAY_MS = 500;
const MAX_BRANCH_REF_READBACK_RETRIES = 10;
const BRANCH_REF_READBACK_DELAY_MS = 500;

export async function planGitHubApplication({
  operation,
  prepared,
  transport,
  pullRequestNumber = null
}) {
  if (!new Set(["submit", "update"]).has(operation)) {
    fail("USAGE_ERROR", "operation must be submit or update", { exitCode: 2 });
  }
  assertTransport(transport);
  const normalizedPrepared = normalizePreparedApplication(prepared);
  const explicitPull = normalizeOptionalPullNumber(pullRequestNumber);
  const snapshot = await inspectRemoteState({ prepared: normalizedPrepared, transport, explicitPull });
  enforceIntake({ prepared: normalizedPrepared, snapshot, operation });

  const existingPull = snapshot.pullRequest;
  const exactRemotePackage = existingPull === null ? false : snapshot.remotePackage.matchesPrepared;
  if (operation === "update" && existingPull === null) {
    fail("APPLICATION_PULL_REQUEST_NOT_FOUND", "update requires the existing draft application pull request");
  }
  if (operation === "update" && (existingPull.state !== "open" || existingPull.draft !== true)) {
    fail("APPLICATION_PULL_REQUEST_NOT_DRAFT", "update requires one open draft application pull request");
  }
  if (operation === "submit" && existingPull !== null && !exactRemotePackage) {
    fail(
      "APPLICATION_ALREADY_OPEN_USE_UPDATE",
      "an application pull request already exists for this id; use update with its exact pull-request number"
    );
  }

  const externalWrites = [];
  const fork = snapshot.fork;
  const branchRef = snapshot.branchRef;
  const exactBranchPackage = snapshot.branchPackage?.matchesPrepared === true
    && (existingPull !== null || snapshot.branchRecovery?.matchesPrepared === true);
  if (!exactRemotePackage && !exactBranchPackage) {
    if (fork === null) externalWrites.push("create-viewer-fork");
    if (branchRef === null) externalWrites.push("create-application-branch-commit");
    else externalWrites.push("append-application-branch-commit-and-fast-forward");
  }
  if (existingPull === null) externalWrites.push("open-draft-pull-request");
  else if (existingPull.title !== normalizedPrepared.title || existingPull.body !== normalizedPrepared.body) {
    externalWrites.push("update-draft-pull-request-metadata");
  }

  const planWithoutDigest = {
    schemaVersion: GITHUB_APPLICATION_CLIENT_VERSION,
    operation,
    transport: "github-public-pr-beta-not-w2-application",
    activeAccount: snapshot.viewer,
    source: {
      ...normalizedPrepared.source,
      companions: snapshot.companionSources,
      observedPermission: snapshot.sourcePermission,
      repositoryAdministratorOwnershipProven: false,
      note: "GitHub push access proves revision-control capability only; it does not prove repository administrator ownership."
    },
    central: {
      ...normalizedPrepared.central,
      numericRepositoryId: snapshot.centralRepository.id,
      intake: snapshot.intake
    },
    application: {
      id: normalizedPrepared.applicationId,
      revision: normalizedPrepared.applicationRevision,
      directory: normalizedPrepared.applicationDirectory,
      packageDigest: normalizedPrepared.package.digest,
      files: normalizedPrepared.package.files.map(({ path: filePath, byteLength, sha256 }) => ({
        path: filePath,
        byteLength,
        sha256
      }))
    },
    pullRequest: existingPull === null ? null : publicPullProjection(existingPull, snapshot.remotePackage),
    fork: fork === null ? null : {
      numericRepositoryId: fork.id,
      repositorySlug: fork.fullName,
      branch: normalizedPrepared.branch,
      branchHead: branchRef?.commit ?? null,
      branchRecovery: snapshot.branchRecovery
    },
    proposedPullRequest: {
      title: normalizedPrepared.title,
      bodySha256: normalizedPrepared.bodySha256,
      base: `${CENTRAL_REPOSITORY}:${CENTRAL_BASE_BRANCH}`,
      head: `${snapshot.viewer.login}:${normalizedPrepared.branch}`,
      draft: true,
      maintainerCanModify: false
    },
    externalWrites,
    noAutomaticActions: [
      "no-approval",
      "no-merge",
      "no-ready-for-review-transition",
      "no-w2-application",
      "no-launch",
      "no-deployment"
    ],
    confirmation: {
      required: externalWrites.length > 0,
      flag: "--confirm-external-write",
      warning: "A confirmed run creates public Git history. Closing a pull request does not erase that history."
    }
  };
  const confirmationDigest = sha256Canonical(planWithoutDigest);
  return Object.freeze({ ...planWithoutDigest, confirmationDigest });
}

export async function executeGitHubApplication({
  operation,
  prepared,
  transport,
  confirmationDigest,
  pullRequestNumber = null,
  sleep = defaultSleep
}) {
  const normalizedPrepared = normalizePreparedApplication(prepared);
  const plan = await planGitHubApplication({ operation, prepared: normalizedPrepared, transport, pullRequestNumber });
  if (plan.externalWrites.length === 0) {
    const status = await readGitHubApplicationStatus({
      prepared: normalizedPrepared,
      transport,
      pullRequestNumber: plan.pullRequest?.number ?? pullRequestNumber
    });
    return executionResult({ plan, status, actions: [], alreadyApplied: true });
  }
  if (!DIGEST_PATTERN.test(confirmationDigest ?? "") || confirmationDigest !== plan.confirmationDigest) {
    fail(
      "EXTERNAL_WRITE_CONFIRMATION_REQUIRED",
      "rerun the read-only plan and pass its exact confirmation digest with --confirm-external-write",
      { details: { currentConfirmationDigest: plan.confirmationDigest } }
    );
  }

  await assertAuthoritySnapshotUnchanged({ prepared: normalizedPrepared, transport, plan });
  const actions = [];
  let fork = plan.fork === null ? null : {
    id: plan.fork.numericRepositoryId,
    fullName: plan.fork.repositorySlug
  };
  if (plan.externalWrites.includes("create-viewer-fork")) {
    normalizeForkWriteResponse(await transport.createFork(CENTRAL_REPOSITORY));
    actions.push("created-viewer-fork");
    fork = null;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const observed = await transport.getRepository(`${plan.activeAccount.login}/${CENTRAL_REPOSITORY_NAME}`, { allowNotFound: true });
      if (observed !== null) {
        fork = normalizeRepository(observed, "viewer fork");
        validateFork(fork, plan.activeAccount, plan.central.numericRepositoryId);
        break;
      }
      await sleep(500);
    }
    if (fork === null) fail("FORK_NOT_READY", "the new GitHub fork is not readable yet; rerun with a fresh plan");
  }
  if (fork === null) fail("FORK_NOT_READY", "the viewer fork is unavailable");
  const forkSlug = fork.fullName;

  let branchRef = normalizeNullableRef(
    await transport.getRef(forkSlug, normalizedPrepared.branch, { allowNotFound: true }),
    normalizedPrepared.branch
  );
  if (!plan.externalWrites.includes("create-application-branch-commit")
      && !plan.externalWrites.includes("append-application-branch-commit-and-fast-forward")) {
    if (branchRef === null || branchRef.commit !== plan.fork?.branchHead) {
      fail("APPLICATION_BRANCH_CHANGED", "the confirmed application branch disappeared or changed");
    }
    if (plan.pullRequest === null) {
      const recovery = await inspectRecoverableBranch({
        prepared: normalizedPrepared,
        transport,
        viewer: plan.activeAccount,
        branchCommit: branchRef.commit
      });
      if (recovery.matchesPrepared !== true) {
        fail("APPLICATION_BRANCH_RECOVERY_INVALID", "the existing branch is not the exact one-commit recovery package");
      }
      await verifyPackageAtRef({
        prepared: normalizedPrepared,
        transport,
        repository: forkSlug,
        commit: branchRef.commit
      });
    }
  } else {
    const expectedHead = plan.fork?.branchHead ?? null;
    if ((branchRef?.commit ?? null) !== expectedHead) {
      fail("APPLICATION_BRANCH_CHANGED", "the application branch changed after confirmation; create a fresh plan");
    }
    await assertAuthoritySnapshotUnchanged({ prepared: normalizedPrepared, transport, plan });
    const tree = normalizeCreatedTree(await transport.createTree(forkSlug, {
      baseTree: normalizedPrepared.central.baseTree,
      files: normalizedPrepared.package.files
    }));
    const parents = branchRef === null
      ? [normalizedPrepared.central.baseCommit]
      : uniqueStrings([branchRef.commit, normalizedPrepared.central.baseCommit]);
    const commit = normalizeCreatedCommit(await transport.createCommit(forkSlug, {
      message: `chore(builder): ${operation} ${normalizedPrepared.applicationId} revision ${normalizedPrepared.applicationRevision}\n\nPackage: ${normalizedPrepared.package.digest}`,
      tree: tree.sha,
      parents
    }), tree.sha);
    const preRef = normalizeNullableRef(
      await transport.getRef(forkSlug, normalizedPrepared.branch, { allowNotFound: true }),
      normalizedPrepared.branch
    );
    if ((preRef?.commit ?? null) !== (branchRef?.commit ?? null)) {
      fail("APPLICATION_BRANCH_CHANGED", "the application branch raced the confirmed write; no ref was updated");
    }
    await assertAuthoritySnapshotUnchanged({ prepared: normalizedPrepared, transport, plan });
    if (branchRef === null) {
      const writtenRef = normalizeRef(await transport.createRef(forkSlug, {
        branch: normalizedPrepared.branch,
        commit: commit.sha
      }), normalizedPrepared.branch);
      if (writtenRef.commit !== commit.sha) {
        fail("GITHUB_WRITE_VERIFY_FAILED", "GitHub created the application branch at a different commit");
      }
      actions.push("created-application-branch");
    } else {
      const writtenRef = normalizeRef(await transport.updateRef(forkSlug, {
        branch: normalizedPrepared.branch,
        commit: commit.sha
      }), normalizedPrepared.branch);
      if (writtenRef.commit !== commit.sha) {
        fail("GITHUB_WRITE_VERIFY_FAILED", "GitHub updated the application branch to a different commit");
      }
      actions.push("updated-application-branch");
    }
    branchRef = await readBackWrittenBranchAndPackage({
      prepared: normalizedPrepared,
      transport,
      plan,
      fork,
      branch: normalizedPrepared.branch,
      expectedCommit: commit.sha,
      sleep
    });
  }

  await assertAuthoritySnapshotUnchanged({ prepared: normalizedPrepared, transport, plan });
  let pull = plan.pullRequest === null
    ? null
    : normalizePull(await transport.getPull(CENTRAL_REPOSITORY, plan.pullRequest.number));
  if (pull === null) {
    const inspectDraftBoundary = async () => {
      await assertAuthoritySnapshotUnchanged({ prepared: normalizedPrepared, transport, plan });
      await assertExecutionForkUnchanged({ transport, fork, plan });
      const observedRef = normalizeRef(
        await transport.getRef(forkSlug, normalizedPrepared.branch),
        normalizedPrepared.branch
      );
      if (observedRef.commit !== branchRef.commit) {
        fail("APPLICATION_BRANCH_CHANGED", "the application branch changed during draft creation");
      }
      return discoverApplicationPull({
        prepared: normalizedPrepared,
        transport,
        viewer: plan.activeAccount,
        explicitPull: null
      });
    };
    let createdPullNumber = null;
    for (let attempt = 0; attempt < MAX_DRAFT_PULL_CREATE_ATTEMPTS; attempt += 1) {
      if (attempt > 0) await sleep(DRAFT_PULL_CREATE_RETRY_DELAY_MS);
      const duplicateSnapshot = await inspectDraftBoundary();
      if (duplicateSnapshot.pullRequest !== null) {
        if (attempt === 0) {
          fail("APPLICATION_PULL_REQUEST_RACE", "an application pull request appeared after confirmation; no duplicate was opened");
        }
        pull = duplicateSnapshot.pullRequest;
        break;
      }
      const response = await transport.createDraftPull(CENTRAL_REPOSITORY, {
        title: normalizedPrepared.title,
        body: normalizedPrepared.body,
        head: `${plan.activeAccount.login}:${normalizedPrepared.branch}`,
        base: CENTRAL_BASE_BRANCH
      });
      if (response !== null) {
        createdPullNumber = normalizePullWriteResponse(response);
        break;
      }
    }
    if (createdPullNumber === null && pull === null) {
      await sleep(DRAFT_PULL_CREATE_RETRY_DELAY_MS);
      const finalRecovery = await inspectDraftBoundary();
      if (finalRecovery.pullRequest === null) {
        fail("PULL_REQUEST_CREATE_NOT_READY", "GitHub did not accept the exact verified application branch before the bounded retry expired; rerun with a fresh plan");
      }
      pull = finalRecovery.pullRequest;
    }
    if (pull === null) pull = normalizePull(await transport.getPull(CENTRAL_REPOSITORY, createdPullNumber));
    actions.push("opened-draft-pull-request");
  } else if (plan.externalWrites.includes("update-draft-pull-request-metadata")) {
    assertOpenDraftPullTarget({
      pull,
      plan,
      prepared: normalizedPrepared,
      fork,
      requireMetadataMatch: false
    });
    if (pull.head.sha !== branchRef.commit) {
      fail("APPLICATION_BRANCH_CHANGED", "the application pull request head changed before its metadata update");
    }
    const updatedPullNumber = normalizePullWriteResponse(await transport.updatePull(CENTRAL_REPOSITORY, pull.number, {
      title: normalizedPrepared.title,
      body: normalizedPrepared.body
    }));
    if (updatedPullNumber !== pull.number) {
      fail("GITHUB_WRITE_VERIFY_FAILED", "GitHub updated a different pull request");
    }
    pull = normalizePull(await transport.getPull(CENTRAL_REPOSITORY, updatedPullNumber));
    actions.push("updated-draft-pull-request-metadata");
  }

  const finalPull = normalizePull(await transport.getPull(CENTRAL_REPOSITORY, pull.number));
  assertOpenDraftPullTarget({ pull: finalPull, plan, prepared: normalizedPrepared, fork });
  if (finalPull.head.sha !== branchRef.commit) {
    fail("PULL_REQUEST_VERIFY_FAILED", "the draft pull request does not point to the exact application branch commit");
  }
  const remotePackage = await verifyPullPackage({
    prepared: normalizedPrepared,
    transport,
    pull: finalPull,
    requireMatch: true
  });
  const status = await buildStatus({ prepared: normalizedPrepared, transport, pull: finalPull, remotePackage });
  return executionResult({ plan, status, actions, alreadyApplied: false });
}

async function assertExecutionForkUnchanged({ transport, fork, plan }) {
  const observedFork = normalizeRepository(
    await transport.getRepository(fork.fullName),
    "execution fork"
  );
  validateFork(observedFork, plan.activeAccount, plan.central.numericRepositoryId);
  if (
    observedFork.id !== fork.id
    || observedFork.fullName.toLowerCase() !== fork.fullName.toLowerCase()
    || observedFork.owner.login.toLowerCase() !== plan.activeAccount.login.toLowerCase()
  ) {
    fail("FORK_CHANGED", "the exact viewer fork changed during the confirmed GitHub write");
  }
  return observedFork;
}

async function readBackWrittenBranchAndPackage({
  prepared,
  transport,
  plan,
  fork,
  branch,
  expectedCommit,
  sleep
}) {
  for (let retry = 0; retry <= MAX_BRANCH_REF_READBACK_RETRIES; retry += 1) {
    if (retry > 0) await sleep(BRANCH_REF_READBACK_DELAY_MS);
    await assertAuthoritySnapshotUnchanged({ prepared, transport, plan });
    await assertExecutionForkUnchanged({ transport, fork, plan });
    const observed = normalizeNullableRef(
      await transport.getRef(fork.fullName, branch, { allowNotFound: true }),
      branch
    );
    if (observed === null) continue;
    if (observed.commit !== expectedCommit) {
      fail("APPLICATION_BRANCH_VERIFY_FAILED", "the application branch resolved to a different commit after its write");
    }
    const packageReadable = await verifyPackageAtRef({
      prepared,
      transport,
      repository: fork.fullName,
      commit: expectedCommit,
      allowNotFound: true
    });
    if (packageReadable) return observed;
  }
  fail("APPLICATION_BRANCH_NOT_READY", "the exact written application branch and package were not readable before the bounded retry expired");
}

export async function readGitHubApplicationStatus({
  prepared,
  transport,
  pullRequestNumber = null
}) {
  assertTransport(transport);
  const normalizedPrepared = normalizePreparedApplication(prepared);
  const explicitPull = normalizeOptionalPullNumber(pullRequestNumber);
  const viewer = normalizeViewer(await transport.getViewer());
  assertViewerMatchesBuilder(viewer, normalizedPrepared.builder);
  const centralRepository = normalizeRepository(
    await transport.getRepository(CENTRAL_REPOSITORY),
    "central repository"
  );
  validateCentralRepository(centralRepository);
  const discovered = await discoverApplicationPull({
    prepared: normalizedPrepared,
    transport,
    viewer,
    explicitPull,
    explicitOnly: explicitPull !== null
  });
  if (discovered.pullRequest === null) {
    fail("APPLICATION_PULL_REQUEST_NOT_FOUND", "no GitHub application pull request was found for this prepared package");
  }
  if (discovered.pullRequest.base.repositoryId !== centralRepository.id) {
    fail("APPLICATION_PULL_REQUEST_MISMATCH", "the selected pull request targets a different central repository id");
  }
  const remotePackage = await verifyPullPackage({
    prepared: normalizedPrepared,
    transport,
    pull: discovered.pullRequest,
    requireMatch: false
  });
  return buildStatus({
    prepared: normalizedPrepared,
    transport,
    pull: discovered.pullRequest,
    remotePackage
  });
}

export function writeLocalReceipt({ receiptDirectory, sourceRepositoryRoot, receipt }) {
  if (!isPlainObject(receipt)) fail("RECEIPT_INVALID", "receipt payload is invalid");
  const repositoryRoot = resolveDirectory(sourceRepositoryRoot, "source repository root");
  const directory = resolveDirectory(receiptDirectory, "receipt directory");
  if (pathsOverlap(repositoryRoot, directory)) {
    fail("RECEIPT_PATH_INVALID", "the receipt directory must be completely outside the source repository");
  }
  const applicationId = requireApplicationId(receipt.applicationId, "receipt application id");
  const pullRequestNumber = apiPullNumber(receipt.pullRequestNumber);
  const pullRequestUrl = requirePullUrl(receipt.pullRequestUrl);
  if (!pullRequestUrl.endsWith(`/pull/${pullRequestNumber}`)) {
    fail("RECEIPT_INVALID", "receipt pull-request URL and number disagree");
  }
  if (!GITHUB_APPLICATION_STATUSES.includes(receipt.githubStatus)) {
    fail("RECEIPT_INVALID", "receipt GitHub status is unsupported");
  }
  if (!APPLICATION_COMPATIBILITY_RESULTS.includes(receipt.applicationResult)) {
    fail("RECEIPT_INVALID", "receipt application result is unsupported");
  }
  if (!Array.isArray(receipt.externalActionsPerformed) || receipt.externalActionsPerformed.length > 10) {
    fail("RECEIPT_INVALID", "receipt external-action list is malformed");
  }
  const externalActionsPerformed = receipt.externalActionsPerformed.map((value) => (
    requireBoundedText(value, "receipt external action", 100)
  ));
  const confirmationDigest = receipt.confirmationDigest === null
    ? null
    : requireDigest(receipt.confirmationDigest, "receipt confirmation digest");
  const contentWithoutDigest = {
    schemaVersion: GITHUB_APPLICATION_CLIENT_VERSION,
    kind: "programmable-public-github-pr-beta-local-receipt",
    applicationId,
    applicationRevision: requireRevision(receipt.applicationRevision, "receipt application revision"),
    pullRequestNumber: Number(pullRequestNumber),
    pullRequestUrl,
    githubStatus: receipt.githubStatus,
    applicationResult: receipt.applicationResult,
    headCommit: requireCommit(receipt.headCommit, "receipt head commit"),
    packageMatchesPrepared: requireBoolean(receipt.packageMatchesPrepared, "receipt package match"),
    preparedPackageDigest: requireDigest(receipt.preparedPackageDigest, "receipt package digest"),
    confirmationDigest,
    externalActionsPerformed,
    authorityBoundary: "GitHub PR transport receipt only; not W2 submission, approval, audit, deployment, launch, or repository-admin ownership."
  };
  const receiptDigest = sha256Canonical(contentWithoutDigest);
  const content = `${canonicalJson({ ...contentWithoutDigest, receiptDigest })}\n`;
  if (Buffer.byteLength(content, "utf8") > MAX_RECEIPT_BYTES) {
    fail("RECEIPT_INVALID", "the local receipt exceeds the bounded receipt size");
  }
  const filename = `${applicationId}-pr-${pullRequestNumber}-${receiptDigest.slice("sha256:".length, "sha256:".length + 16)}.json`;
  const target = path.join(directory, filename);
  if (fs.existsSync(target)) {
    if (fs.lstatSync(target).isSymbolicLink() || fs.readFileSync(target, "utf8") !== content) {
      fail("RECEIPT_EXISTS", "a different receipt already occupies the deterministic receipt path");
    }
    return { path: target, receiptDigest, created: false };
  }
  const temporary = path.join(directory, `.${filename}.${process.pid}.tmp`);
  try {
    fs.writeFileSync(temporary, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
    fs.renameSync(temporary, target);
  } catch (error) {
    try {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    } catch {
      // The primary bounded receipt error is reported below.
    }
    fail("RECEIPT_WRITE_FAILED", error?.message ?? "the local receipt could not be written");
  }
  return { path: target, receiptDigest, created: true };
}

function enforceIntake({ prepared, snapshot, operation }) {
  const state = snapshot.intake.state;
  if (state === "open") return;
  if (state === "prelaunch") fail("INTAKE_PRELAUNCH", "Public Builder Beta applications are not open yet");
  if (state === "paused-all") fail("INTAKE_PAUSED_ALL", "Public Builder Beta intake is paused for every application change");
  const existingOnBase = prepared.central.priorApplicationRevision !== null;
  if (state === "paused-new" && existingOnBase) return;
  if (state === "paused-new" && snapshot.pullRequest !== null) {
    const exact = snapshot.intake.continuingPullRequests.find((record) => (
      record.pullRequestNumber === String(snapshot.pullRequest.number)
      && record.applicationId === prepared.applicationId
      && record.builderGitHubUserId === prepared.builder.githubUserId
      && record.primaryNumericRepositoryId === prepared.source.numericRepositoryId
      && arraysEqual(
        record.companionNumericRepositoryIds,
        prepared.companions.map(({ numericRepositoryId }) => numericRepositoryId)
      )
    ));
    if (exact) return;
  }
  fail(
    "INTAKE_PAUSED_NEW",
    operation === "update"
      ? "this draft is not an exact trusted continuation while new application ids are paused"
      : "new application ids are paused; no new draft pull request will be opened"
  );
}

function executionResult({ plan, status, actions, alreadyApplied }) {
  return Object.freeze({
    schemaVersion: GITHUB_APPLICATION_CLIENT_VERSION,
    operation: plan.operation,
    applicationId: plan.application.id,
    applicationRevision: plan.application.revision,
    confirmationDigest: plan.confirmationDigest,
    actions,
    alreadyApplied,
    status,
    externalActionsPerformed: actions,
    neverPerformed: ["approve", "merge", "mark-ready", "create-w2-application", "deploy", "launch"]
  });
}
