import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import {
  inspectRegistryAcceptanceV3ReviewWithGitHub,
  isFreshRegistryAcceptanceV3TrustedReview,
  RegistryAcceptanceV3GithubVerificationError,
  REGISTRY_ACCEPTANCE_V3_GITHUB_LIMITS,
  verifyRegistryAcceptanceV3ReviewWithGitHub
} from "../registry-acceptance-v3-github-core.mjs";
import { canonicalJson } from "../submission-core.mjs";

const REGISTRY = "0xprogrammable/submit-launch";
const REGISTRY_URI = `https://github.com/${REGISTRY}`;
const REGISTRY_ID = 1320171831;
const PULL_NUMBER = "123";
const HEAD_SHA = "a".repeat(40);
const BASE_SHA = "b".repeat(40);
const MERGE_SHA = "c".repeat(40);
const HEAD_TREE = "d".repeat(40);
const BASE_TREE = "e".repeat(40);
const MAIN_SHA = "01".repeat(20);
const MAIN_TREE = "02".repeat(20);
const MAIN_REGISTRY_TREE = "03".repeat(20);
const MAIN_ACCEPTANCES_TREE = "04".repeat(20);
const MAIN_ACCEPTANCE_APP_TREE = "05".repeat(20);
const MAIN_PROJECTS_TREE = "09".repeat(20);
const MAIN_PROJECT_APP_TREE = "0a".repeat(20);
const REVERTED_MAIN_SHA = "06".repeat(20);
const EMPTY_MAIN_TREE = "07".repeat(20);
const DRIFT_MAIN_SHA = "08".repeat(20);

test("inspection resolver verifies deleted or renamed forks only through the central pull ref and raw Git objects", async (t) => {
  for (const [label, headRepository] of [
    ["deleted", null],
    ["renamed", repositoryJson({ fullName: "renamed-owner/renamed-fork", id: 424242 })]
  ]) {
    await t.test(label, async () => {
      const fixture = resolverFixture({ headRepository });
      const calls = [];
      const receipt = await inspectRegistryAcceptanceV3ReviewWithGitHub({
        fetchImplementation: fixture.fetch({ calls }),
        input: fixture.input
      });
      assert.equal(receipt.result, "INSPECTION_ONLY");
      assert.equal(isFreshRegistryAcceptanceV3TrustedReview(receipt), false);
      assert.equal(isFreshRegistryAcceptanceV3TrustedReview(structuredClone(receipt)), false);
      assert.deepEqual(receipt.projection.pullRequest.head, {
        pullRef: `refs/pull/${PULL_NUMBER}/head`,
        sha: HEAD_SHA
      });
      assert.equal(receipt.projection.pullRequest.state, "MERGED");
      assert.equal(receipt.projection.pullRequest.author.githubUserId, "4242");
      assert.equal(receipt.projection.packageAtHead.repository.numericRepositoryId, String(REGISTRY_ID));
      assert.equal(receipt.projection.packageAtHead.fileCount, 1);
      assert.equal(receipt.projection.packageAtHead.totalBytes, Buffer.byteLength(fixture.applicationContent, "utf8"));
      assert.deepEqual(receipt.registryMain.acceptance, {
        blobObjectId: fixture.acceptanceBlob,
        byteLength: Buffer.byteLength(fixture.acceptanceContent, "utf8"),
        path: "registry/acceptances/resolver-fixture/1.v3.json",
        sha256: sha256Utf8(fixture.acceptanceContent)
      });
      assert.equal(receipt.registryMain.commitObjectId, MAIN_SHA);
      assert.equal(receipt.registryMain.ref, "refs/heads/main");
      assert.equal(receipt.registryMain.index.path, "registry/index.json");
      assert.equal(receipt.registryMain.index.projectRecord.acceptancePath, receipt.registryMain.acceptance.path);
      assert.equal(receipt.registryMain.project.path, "registry/projects/resolver-fixture/project.json");
      assert.equal(receipt.registryMain.project.review.state, "accepted");
      assert.equal(receipt.registryMain.project.programmableFee.feeApplicability, "applicable");
      assert.equal(receipt.authority.evidenceSha256, sha256Utf8(canonicalJson({
        apiOrigin: "https://api.github.com",
        projection: receipt.projection,
        registryMain: receipt.registryMain,
        verifiedAt: receipt.verifiedAt,
        verifier: receipt.authority.verifier
      })));
      assert.match(receipt.projection.packageAtHead.inventorySha256, /^sha256:[0-9a-f]{64}$/u);
      assert.deepEqual(Object.keys(receipt.projection.pullRequest.changeSet).sort(), ["changeSetSha256", "fileCount", "rule"]);
      assert.equal(calls.some(({ pathname }) => pathname.includes("renamed-fork")), false);
      assert.equal(calls.some(({ pathname }) => pathname.includes("/repositories/424242")), false);
      assert.ok(calls.every(({ headers, method }) => method === "GET"
        && headers.get("X-GitHub-Api-Version") === "2026-03-10"));
    });
  }
});

test("pull-author authority survives a GitHub login rename but rejects a different immutable user ID", async () => {
  const renamed = resolverFixture({ pullAuthorLogin: "renamed-builder" });
  const receipt = await inspectRegistryAcceptanceV3ReviewWithGitHub({
    fetchImplementation: renamed.fetch(),
    input: renamed.input
  });
  assert.deepEqual(receipt.projection.pullRequest.author, {
    githubLogin: "renamed-builder",
    githubUserId: "4242"
  });

  const wrongUser = resolverFixture({ pullAuthorUserId: 4243 });
  await assert.rejects(
    () => inspectRegistryAcceptanceV3ReviewWithGitHub({
      fetchImplementation: wrongUser.fetch(),
      input: wrongUser.input
    }),
    hasCode("REGISTRY_REVIEW_PULL_AUTHOR_MISMATCH")
  );
});

test("Registry and maintainer renames preserve numeric authority while pinned-review authority stays exact", async () => {
  const renamed = resolverFixture({
    maintainerLogin: "renamed-maintainer",
    registryFullName: "renamed-owner/renamed-registry"
  });
  const receipt = await inspectRegistryAcceptanceV3ReviewWithGitHub({
    fetchImplementation: renamed.fetch(),
    input: renamed.input
  });
  assert.deepEqual(receipt.projection.repository, {
    fullName: "renamed-owner/renamed-registry",
    numericRepositoryId: String(REGISTRY_ID),
    repositoryUri: "https://github.com/renamed-owner/renamed-registry"
  });
  assert.deepEqual(receipt.projection.review.reviewer, {
    githubLogin: "renamed-maintainer",
    githubUserId: "309941960"
  });

  const wrongMaintainer = resolverFixture({ maintainerUserId: 309941961 });
  await assert.rejects(
    () => inspectRegistryAcceptanceV3ReviewWithGitHub({
      fetchImplementation: wrongMaintainer.fetch(),
      input: wrongMaintainer.input
    }),
    hasCode("REGISTRY_REVIEW_NOT_CURRENT_OWNER_APPROVAL")
  );

  const laterOtherOwner = resolverFixture({ laterOtherOwnerReview: true });
  const laterOtherOwnerReceipt = await inspectRegistryAcceptanceV3ReviewWithGitHub({
    fetchImplementation: laterOtherOwner.fetch(),
    input: laterOtherOwner.input
  });
  assert.equal(laterOtherOwnerReceipt.projection.review.id, "456");
  assert.equal(
    laterOtherOwnerReceipt.projection.review.selectionRule,
    "latest-pinned-reviewer-owner-review-for-current-head-v1"
  );

  const laterPinnedChangeRequest = resolverFixture({ laterPinnedChangeRequest: true });
  await assert.rejects(
    () => inspectRegistryAcceptanceV3ReviewWithGitHub({
      fetchImplementation: laterPinnedChangeRequest.fetch(),
      input: laterPinnedChangeRequest.input
    }),
    hasCode("REGISTRY_REVIEW_NOT_CURRENT_OWNER_APPROVAL")
  );

  const wrongRegistry = resolverFixture({ registryNumericId: REGISTRY_ID + 1 });
  await assert.rejects(
    () => inspectRegistryAcceptanceV3ReviewWithGitHub({
      fetchImplementation: wrongRegistry.fetch(),
      input: wrongRegistry.input
    }),
    hasCode("REGISTRY_REPOSITORY_IDENTITY_MISMATCH")
  );

  const maximumOwner = resolverFixture({ registryFullName: `${"a".repeat(39)}/registry` });
  const maximumOwnerReceipt = await inspectRegistryAcceptanceV3ReviewWithGitHub({
    fetchImplementation: maximumOwner.fetch(),
    input: maximumOwner.input
  });
  assert.equal(maximumOwnerReceipt.projection.repository.fullName, `${"a".repeat(39)}/registry`);

  const overlongOwner = resolverFixture({ registryFullName: `${"a".repeat(40)}/registry` });
  await assert.rejects(
    () => inspectRegistryAcceptanceV3ReviewWithGitHub({
      fetchImplementation: overlongOwner.fetch(),
      input: overlongOwner.input
    }),
    hasCode("REGISTRY_REPOSITORY_IDENTITY_INVALID")
  );
});

test("resolver rejects a false central pull ref, an extra changed path, and live-state TOCTOU drift", async () => {
  for (const [label, options, expectedCode] of [
    ["pull ref", { pullRefSha: "9".repeat(40) }, "REGISTRY_REVIEW_PULL_REF_MISMATCH"],
    ["extra path", { extraAddedPath: true }, "REGISTRY_REVIEW_CHANGE_SET_MISMATCH"],
    ["TOCTOU", { driftMergedAtAfterFirstSnapshot: true }, "REGISTRY_REVIEW_STATE_CHANGED"]
  ]) {
    const fixture = resolverFixture(options);
    await assert.rejects(
      () => inspectRegistryAcceptanceV3ReviewWithGitHub({
        fetchImplementation: fixture.fetch(),
        input: fixture.input
      }),
      hasCode(expectedCode),
      label
    );
  }
});

test("resolver requires the exact acceptance on one stable current central main", async () => {
  for (const [label, options, expectedCode] of [
    ["never on main", { acceptanceNeverOnMain: true }, "REGISTRY_ACCEPTANCE_NOT_ON_CURRENT_MAIN"],
    ["reverted from main", { acceptanceReverted: true }, "REGISTRY_ACCEPTANCE_NOT_ON_CURRENT_MAIN"],
    ["stale main snapshot", { staleMainAfterFirstSnapshot: true }, "REGISTRY_REVIEW_STATE_CHANGED"]
  ]) {
    const fixture = resolverFixture(options);
    await assert.rejects(
      () => inspectRegistryAcceptanceV3ReviewWithGitHub({
        fetchImplementation: fixture.fetch(),
        input: fixture.input
      }),
      hasCode(expectedCode),
      label
    );
  }
});

test("current-main proof rejects superseded, suspended, retired, and orphan acceptance records", async (t) => {
  for (const [label, options] of [
    ["superseded", { activeAcceptanceRevision: "2" }],
    ["suspended", { projectStatus: "suspended" }],
    ["retired", { projectStatus: "retired" }],
    ["orphan", { orphanAcceptance: true }]
  ]) {
    await t.test(label, async () => {
      const fixture = resolverFixture(options);
      await assert.rejects(
        () => inspectRegistryAcceptanceV3ReviewWithGitHub({
          fetchImplementation: fixture.fetch(),
          input: fixture.input
        }),
        hasCode("REGISTRY_PROJECT_NOT_ACTIVE_ON_CURRENT_MAIN")
      );
    });
  }
});

test("current-main proof rejects noncanonical index, project digest drift, and Fee V2 drift", async (t) => {
  for (const [label, options, code] of [
    ["noncanonical index", { noncanonicalIndex: true }, "REGISTRY_INDEX_CURRENT_MAIN_INVALID"],
    ["project digest", { projectDigestMismatch: true }, "REGISTRY_PROJECT_CURRENT_MAIN_INVALID"],
    ["fee drift", { projectFeeDrift: true }, "REGISTRY_PROJECT_FEE_NOT_LAUNCHABLE"]
  ]) {
    await t.test(label, async () => {
      const fixture = resolverFixture(options);
      await assert.rejects(
        () => inspectRegistryAcceptanceV3ReviewWithGitHub({
          fetchImplementation: fixture.fetch(),
          input: fixture.input
        }),
        hasCode(code)
      );
    });
  }
});

test("one monotonic deadline covers multiple slow requests instead of resetting per call", async () => {
  const fixture = resolverFixture({ delayMs: 8 });
  await assert.rejects(
    () => inspectRegistryAcceptanceV3ReviewWithGitHub({
      deadlineMs: 15,
      fetchImplementation: fixture.fetch(),
      input: fixture.input
    }),
    hasCode("REGISTRY_REVIEW_DEADLINE")
  );
});

test("authorizing resolution cannot consume a caller-injected or monkeypatched transport", async () => {
  const fixture = resolverFixture();
  let injectedCalls = 0;
  const priorFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    injectedCalls += 1;
    throw new Error("caller transport must remain outside the authorizing closure");
  };
  try {
    await assert.rejects(
      () => verifyRegistryAcceptanceV3ReviewWithGitHub({
        fetchImplementation: globalThis.fetch,
        input: fixture.input,
        signal: AbortSignal.abort()
      }),
      hasCode("REGISTRY_REVIEW_DEADLINE")
    );
  } finally {
    globalThis.fetch = priorFetch;
  }
  assert.equal(injectedCalls, 0);
});

test("per-response and aggregate request budgets fail closed", async () => {
  const oversized = resolverFixture({ oversizedRepositoryResponse: true });
  await assert.rejects(
    () => inspectRegistryAcceptanceV3ReviewWithGitHub({
      fetchImplementation: oversized.fetch(),
      input: oversized.input
    }),
    hasCode("REGISTRY_REVIEW_API_BOUNDED")
  );

  const cyclic = resolverFixture({ cyclicPackageTree: true });
  const calls = [];
  await assert.rejects(
    () => inspectRegistryAcceptanceV3ReviewWithGitHub({
      fetchImplementation: cyclic.fetch({ calls }),
      input: cyclic.input
    }),
    hasCode("REGISTRY_REVIEW_API_BOUNDED")
  );
  assert.equal(calls.length, REGISTRY_ACCEPTANCE_V3_GITHUB_LIMITS.maxRequests);
});

test("aggregate package bounds fail before network access", async () => {
  const fixture = resolverFixture();
  const application = JSON.parse(fixture.input.artifacts.application.content);
  application.reviewPackage.records = Array.from({ length: 4 }, (_, index) => ({
    byteLength: 4 * 1024 * 1024,
    path: `large-${index}.bin`,
    sha256: `sha256:${String(index + 1).repeat(64)}`,
    source: "application-package"
  }));
  fixture.input.artifacts.application = binding({
    path: fixture.input.artifacts.application.path,
    schemaId: fixture.input.artifacts.application.schemaId,
    value: application
  });
  let fetched = false;
  await assert.rejects(
    () => inspectRegistryAcceptanceV3ReviewWithGitHub({
      fetchImplementation: async () => {
        fetched = true;
        throw new Error("network must not be reached");
      },
      input: fixture.input
    }),
    hasCode("REGISTRY_REVIEW_APPLICATION_INVALID")
  );
  assert.equal(fetched, false);
});

test("GitHub credentials are explicit-only and never silently read from ambient environment", async () => {
  const fixture = resolverFixture();
  const calls = [];
  const prior = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = "ambient-token-must-not-be-used";
  try {
    await inspectRegistryAcceptanceV3ReviewWithGitHub({
      fetchImplementation: fixture.fetch({ calls }),
      input: fixture.input
    });
  } finally {
    if (prior === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = prior;
  }
  assert.ok(calls.every(({ headers }) => headers.has("Authorization") === false));

  calls.length = 0;
  await inspectRegistryAcceptanceV3ReviewWithGitHub({
    fetchImplementation: fixture.fetch({ calls }),
    githubToken: "explicit-test-token",
    input: fixture.input
  });
  assert.ok(calls.every(({ headers }) => headers.get("Authorization") === "Bearer explicit-test-token"));
});

function resolverFixture({
  activeAcceptanceRevision = "1",
  acceptanceNeverOnMain = false,
  acceptanceReverted = false,
  cyclicPackageTree = false,
  delayMs = 0,
  driftMergedAtAfterFirstSnapshot = false,
  extraAddedPath = false,
  headRepository = null,
  laterOtherOwnerReview = false,
  laterPinnedChangeRequest = false,
  maintainerLogin = "0xprogrammable",
  maintainerUserId = 309941960,
  noncanonicalIndex = false,
  orphanAcceptance = false,
  oversizedRepositoryResponse = false,
  projectDigestMismatch = false,
  projectFeeDrift = false,
  projectStatus = "accepted",
  pullAuthorLogin = "fixture-builder",
  pullAuthorUserId = 4242,
  pullRefSha = HEAD_SHA,
  registryFullName = REGISTRY,
  registryNumericId = REGISTRY_ID,
  staleMainAfterFirstSnapshot = false
} = {}) {
  const registryUri = `https://github.com/${registryFullName}`;
  const registryRepository = repositoryJson({ fullName: registryFullName, id: registryNumericId });
  const application = {
    applicationId: "resolver-fixture",
    applicationRevision: "1",
    builder: { githubLogin: "fixture-builder", githubUserId: "4242" },
    source: {
      primary: {
        numericRepositoryId: "9001",
        repositoryUri: "https://github.com/example/resolver-fixture",
        revisionObjectId: "9".repeat(40),
        treeObjectId: "8".repeat(40)
      }
    },
    reviewPackage: { records: [] }
  };
  const applicationPath = "submissions/resolver-fixture/v3/revisions/1/application.v3.json";
  const applicationBinding = binding({
    path: applicationPath,
    schemaId: "urn:programmable:public-pr-application-v3:3.0.0",
    value: application
  });
  const acceptance = {
    $schema: "urn:programmable:registry-acceptance-v3:3.0.0",
    application: {
      applicationId: "resolver-fixture",
      applicationRevision: "1",
      feeApplicability: "applicable",
      feePolicyHash: "0x03cd386824b1c0aa152200e0a470aa0c885f802e257f0f46066de508d241811e",
      feePolicyInstanceSha256: `sha256:${"7".repeat(64)}`
    },
    reviewEvidence: {
      pullRequest: {
        number: PULL_NUMBER,
        url: `${registryUri}/pull/${PULL_NUMBER}`
      }
    }
  };
  const acceptanceBinding = binding({
    path: "registry/acceptances/resolver-fixture/1.v3.json",
    schemaId: "urn:programmable:registry-acceptance-v3:3.0.0",
    value: acceptance
  });
  const applicationBlob = gitBlobObjectId(Buffer.from(applicationBinding.content, "utf8"));
  const acceptanceBlob = gitBlobObjectId(Buffer.from(acceptanceBinding.content, "utf8"));
  const activeAcceptancePath = `registry/acceptances/resolver-fixture/${activeAcceptanceRevision}.v3.json`;
  const activeAcceptanceSha256 = activeAcceptanceRevision === "1"
    ? acceptanceBinding.sha256
    : `sha256:${"6".repeat(64)}`;
  const project = {
    capabilities: [],
    chains: [{ chainId: "1", deploymentEvidence: null, network: "Ethereum", state: "proposed" }],
    discovery: { mechanism: "Resolver fixture", outcomes: [], synonyms: [], tags: [] },
    economics: {
      programmableFee: {
        claimOwner: projectFeeDrift
          ? "0x2Bb333d48DFAF1596D9036671d2E43168994249E"
          : "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c",
        feeApplicability: "applicable",
        feePolicyInstanceSha256: acceptance.application.feePolicyInstanceSha256,
        inclusiveBps: 10,
        policyHash: acceptance.application.feePolicyHash,
        policyId: "programmable-volume-fee-v2",
        policyVersion: "2.0.0",
        requiredForLaunch: true
      },
      summary: "Exact fee fixture."
    },
    hook: { beforeSwapReturnDelta: null, canonicalPoolRequired: false, contractNames: [], permissions: [], upgradeability: "none", used: false },
    id: "resolver-fixture",
    kind: "launch-model",
    name: "Resolver fixture",
    provenance: { importedFrom: `${registryUri}/pull/${PULL_NUMBER}`, observedAt: "2026-08-03T18:00:00Z", recordClass: "maintainer-acceptance" },
    relations: { similarTo: [], supersededBy: null, supersedes: [] },
    review: {
      acceptancePath: activeAcceptancePath,
      applicationPullRequest: `${registryUri}/pull/${PULL_NUMBER}`,
      independentAudit: false,
      limitations: [],
      state: projectStatus === "suspended" ? "suspended" : projectStatus === "retired" ? "retired" : "accepted"
    },
    schemaVersion: "1.1.0",
    source: {
      manifestPath: applicationPath,
      numericRepositoryId: application.source.primary.numericRepositoryId,
      repositoryUri: application.source.primary.repositoryUri,
      revisionObjectId: application.source.primary.revisionObjectId,
      treeObjectId: application.source.primary.treeObjectId
    },
    status: projectStatus,
    statusUpdatedAt: "2026-08-03T18:00:00Z",
    summary: "Resolver fixture project.",
    surfaces: [],
    warnings: []
  };
  const projectContent = `${canonicalJson(project)}\n`;
  const projectBlob = gitBlobObjectId(Buffer.from(projectContent, "utf8"));
  const projectSha256 = projectDigestMismatch ? `sha256:${"5".repeat(64)}` : sha256Utf8(projectContent);
  const projectRecord = {
    acceptancePath: activeAcceptancePath,
    acceptanceSha256: activeAcceptanceSha256,
    capabilities: project.capabilities,
    id: project.id,
    kind: project.kind,
    name: project.name,
    path: "registry/projects/resolver-fixture/project.json",
    sha256: projectSha256,
    status: project.status,
    summary: project.summary,
    surfaces: project.surfaces,
    tags: project.discovery.tags
  };
  const indexRecords = orphanAcceptance
    ? [{ ...projectRecord, acceptancePath: null, acceptanceSha256: null, id: "other-project", path: "registry/projects/other-project/project.json" }]
    : [projectRecord];
  const index = {
    activeIntake: { baseBranch: "main", directory: "submissions", repository: REGISTRY, state: "open" },
    generatedAt: "2026-08-03T18:00:00Z",
    legacyIntake: [],
    records: indexRecords,
    registryDigest: sha256Utf8(canonicalJson({
      acceptances: indexRecords
        .filter(({ acceptancePath }) => acceptancePath !== null)
        .map(({ acceptancePath: entryPath, acceptanceSha256 }) => ({ path: entryPath, sha256: acceptanceSha256 })),
      records: indexRecords
    })),
    schemaVersion: "1.1.0"
  };
  const canonicalIndexContent = `${canonicalJson(index)}\n`;
  const indexContent = noncanonicalIndex ? `${JSON.stringify(index, null, 2)}\n` : canonicalIndexContent;
  const indexBlob = gitBlobObjectId(Buffer.from(indexContent, "utf8"));
  const treeIds = {
    submissions: "f".repeat(40),
    application: "1".repeat(40),
    v3: "2".repeat(40),
    revisions: "3".repeat(40),
    package: "4".repeat(40)
  };
  const trees = new Map([
    [BASE_TREE, []],
    [HEAD_TREE, [
      treeEntry("submissions", treeIds.submissions),
      ...(extraAddedPath ? [blobEntry("README.md", "8".repeat(40))] : [])
    ]],
    [treeIds.submissions, [treeEntry("resolver-fixture", treeIds.application)]],
    [treeIds.application, [treeEntry("v3", treeIds.v3)]],
    [treeIds.v3, [treeEntry("revisions", treeIds.revisions)]],
    [treeIds.revisions, [treeEntry("1", treeIds.package)]],
    [treeIds.package, cyclicPackageTree
      ? [treeEntry("loop", treeIds.package)]
      : [blobEntry("application.v3.json", applicationBlob)]],
    [MAIN_TREE, acceptanceNeverOnMain
      ? []
      : [treeEntry("registry", MAIN_REGISTRY_TREE)]],
    [MAIN_REGISTRY_TREE, [
      treeEntry("acceptances", MAIN_ACCEPTANCES_TREE),
      blobEntry("index.json", indexBlob),
      treeEntry("projects", MAIN_PROJECTS_TREE)
    ]],
    [MAIN_ACCEPTANCES_TREE, [treeEntry("resolver-fixture", MAIN_ACCEPTANCE_APP_TREE)]],
    [MAIN_ACCEPTANCE_APP_TREE, acceptanceReverted
      ? []
      : [blobEntry("1.v3.json", acceptanceBlob)]],
    [MAIN_PROJECTS_TREE, [treeEntry("resolver-fixture", MAIN_PROJECT_APP_TREE)]],
    [MAIN_PROJECT_APP_TREE, [blobEntry("project.json", projectBlob)]],
    [EMPTY_MAIN_TREE, []]
  ]);
  let pullReads = 0;
  let mainReads = 0;
  const calls = [];
  const fetch = ({ calls: observedCalls = calls } = {}) => async (urlValue, options = {}) => {
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    const url = new URL(urlValue);
    const headers = new Headers(options.headers);
    observedCalls.push({ headers, method: options.method, pathname: url.pathname, search: url.search });
    const route = `${url.pathname}${url.search}`;
    if (route === `/repositories/${REGISTRY_ID}`) {
      return jsonResponse(registryRepository, 200, oversizedRepositoryResponse
        ? { contentLength: REGISTRY_ACCEPTANCE_V3_GITHUB_LIMITS.maxApiJsonBytes + 1 }
        : {});
    }
    if (route === `/repos/${registryFullName}/pulls/${PULL_NUMBER}`) {
      pullReads += 1;
      return jsonResponse(pullJson({
        headRepository,
        mergedAt: driftMergedAtAfterFirstSnapshot && pullReads > 1
          ? "2026-08-03T18:00:01Z"
          : "2026-08-03T18:00:00Z",
        pullAuthorLogin,
        pullAuthorUserId,
        registryRepository,
        registryUri
      }));
    }
    if (route === `/repos/${registryFullName}/git/ref/heads/main`) {
      mainReads += 1;
      return jsonResponse({
        ref: "refs/heads/main",
        object: {
          sha: staleMainAfterFirstSnapshot && mainReads > 1
            ? DRIFT_MAIN_SHA
            : acceptanceReverted
              ? REVERTED_MAIN_SHA
              : MAIN_SHA,
          type: "commit"
        }
      });
    }
    if (route === `/repos/${registryFullName}/pulls/${PULL_NUMBER}/reviews?per_page=100&page=1`) {
      return jsonResponse([
        reviewJson({ maintainerLogin, maintainerUserId, registryUri }),
        ...(laterOtherOwnerReview ? [reviewJson({
          id: 457,
          maintainerLogin: "other-owner",
          maintainerUserId: 309941961,
          registryUri,
          state: "CHANGES_REQUESTED",
          submittedAt: "2026-08-03T17:59:30Z"
        })] : []),
        ...(laterPinnedChangeRequest ? [reviewJson({
          id: 458,
          maintainerLogin,
          maintainerUserId,
          registryUri,
          state: "CHANGES_REQUESTED",
          submittedAt: "2026-08-03T17:59:45Z"
        })] : [])
      ]);
    }
    if (route === `/repos/${registryFullName}/git/ref/pull/${PULL_NUMBER}/head`) {
      return jsonResponse({ ref: `refs/pull/${PULL_NUMBER}/head`, object: { sha: pullRefSha, type: "commit" } });
    }
    if (route === `/repos/${registryFullName}/git/commits/${BASE_SHA}`) return jsonResponse({ sha: BASE_SHA, tree: { sha: BASE_TREE } });
    if (route === `/repos/${registryFullName}/git/commits/${HEAD_SHA}`) return jsonResponse({ sha: HEAD_SHA, tree: { sha: HEAD_TREE } });
    if (route === `/repos/${registryFullName}/git/commits/${MAIN_SHA}`) return jsonResponse({ sha: MAIN_SHA, tree: { sha: MAIN_TREE } });
    if (route === `/repos/${registryFullName}/git/commits/${REVERTED_MAIN_SHA}`) return jsonResponse({ sha: REVERTED_MAIN_SHA, tree: { sha: MAIN_TREE } });
    const treeMatch = new RegExp(`^/repos/${escapeRegExp(registryFullName)}/git/trees/([0-9a-f]{40})$`, "u").exec(url.pathname);
    if (treeMatch !== null && trees.has(treeMatch[1])) {
      return jsonResponse({ sha: treeMatch[1], tree: trees.get(treeMatch[1]), truncated: false });
    }
    if (route === `/repos/${registryFullName}/git/blobs/${applicationBlob}`) {
      return jsonResponse({
        content: Buffer.from(applicationBinding.content, "utf8").toString("base64"),
        encoding: "base64",
        sha: applicationBlob,
        size: Buffer.byteLength(applicationBinding.content, "utf8")
      });
    }
    if (route === `/repos/${registryFullName}/git/blobs/${acceptanceBlob}`) {
      return jsonResponse({
        content: Buffer.from(acceptanceBinding.content, "utf8").toString("base64"),
        encoding: "base64",
        sha: acceptanceBlob,
        size: Buffer.byteLength(acceptanceBinding.content, "utf8")
      });
    }
    if (route === `/repos/${registryFullName}/git/blobs/${indexBlob}`) {
      return jsonResponse({
        content: Buffer.from(indexContent, "utf8").toString("base64"),
        encoding: "base64",
        sha: indexBlob,
        size: Buffer.byteLength(indexContent, "utf8")
      });
    }
    if (route === `/repos/${registryFullName}/git/blobs/${projectBlob}`) {
      return jsonResponse({
        content: Buffer.from(projectContent, "utf8").toString("base64"),
        encoding: "base64",
        sha: projectBlob,
        size: Buffer.byteLength(projectContent, "utf8")
      });
    }
    return jsonResponse({ message: `unhandled ${route}` }, 404);
  };
  return {
    acceptanceBlob,
    acceptanceContent: acceptanceBinding.content,
    applicationContent: applicationBinding.content,
    fetch,
    input: { artifacts: { application: applicationBinding, registryAcceptance: acceptanceBinding } }
  };
}

function pullJson({
  headRepository,
  mergedAt,
  pullAuthorLogin,
  pullAuthorUserId,
  registryRepository,
  registryUri
}) {
  return {
    base: { ref: "main", repo: registryRepository, sha: BASE_SHA },
    head: { ref: "deleted-or-renamed-fork-branch", repo: headRepository, sha: HEAD_SHA },
    html_url: `${registryUri}/pull/${PULL_NUMBER}`,
    merge_commit_sha: MERGE_SHA,
    merged: true,
    merged_at: mergedAt,
    number: Number(PULL_NUMBER),
    state: "closed",
    user: { id: pullAuthorUserId, login: pullAuthorLogin }
  };
}

function reviewJson({
  id = 456,
  maintainerLogin = "0xprogrammable",
  maintainerUserId = 309941960,
  registryUri = REGISTRY_URI,
  state = "APPROVED",
  submittedAt = "2026-08-03T17:59:00Z"
} = {}) {
  return {
    author_association: "OWNER",
    body: "",
    commit_id: HEAD_SHA,
    html_url: `${registryUri}/pull/${PULL_NUMBER}#pullrequestreview-${id}`,
    id,
    state,
    submitted_at: submittedAt,
    user: { id: maintainerUserId, login: maintainerLogin }
  };
}

function repositoryJson({ fullName = REGISTRY, id = REGISTRY_ID } = {}) {
  return { full_name: fullName, html_url: `https://github.com/${fullName}`, id };
}

function treeEntry(entryPath, sha) {
  return { mode: "040000", path: entryPath, sha, type: "tree" };
}

function blobEntry(entryPath, sha) {
  return { mode: "100644", path: entryPath, sha, type: "blob" };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function binding({ path, schemaId, value }) {
  const content = `${canonicalJson(value)}\n`;
  return { content, path, schemaId, sha256: sha256Utf8(content) };
}

function gitBlobObjectId(bytes) {
  return crypto.createHash("sha1")
    .update(Buffer.from(`blob ${bytes.length}\0`, "utf8"))
    .update(bytes)
    .digest("hex");
}

function sha256Utf8(value) {
  return `sha256:${crypto.createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function jsonResponse(value, status = 200, { contentLength = null } = {}) {
  const body = JSON.stringify(value);
  return new Response(body, {
    headers: {
      "content-length": String(contentLength ?? Buffer.byteLength(body, "utf8")),
      "content-type": "application/json"
    },
    status
  });
}

function hasCode(code) {
  return (error) => error instanceof RegistryAcceptanceV3GithubVerificationError && error.code === code;
}
