import assert from "node:assert/strict";
import childProcess from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  analyzeDrift,
  collectLiveObservations,
  DriftInputError
} from "../check-upstream-drift.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const script = path.resolve(testDirectory, "..", "check-upstream-drift.mjs");
const skillRoot = path.resolve(testDirectory, "..", "..");
const commitA = "a".repeat(40);
const commitB = "b".repeat(40);
const digestA = "1".repeat(64);
const digestB = "2".repeat(64);

test("reviewed UniRoute and AI Toolkit successors stay exact and synchronized across canonical references", () => {
  const canonicalSnapshot = JSON.parse(
    fs.readFileSync(path.join(skillRoot, "references", "upstream-sources.json"), "utf8")
  );
  const references = new Map(
    canonicalSnapshot.observedOfficialSources.map((source) => [source.repository, source])
  );
  const expected = [
    {
      repository: "https://github.com/Uniswap/uniroute-public.git",
      commit: "0e002a0bcb35624df416a9bba7705aef66eb2c52",
      previous: "2cf851e7bb5ed0e722da9edc027aeeafae525f38",
      documents: ["upstream-sources.md", "routing-and-discovery.md", "official-model-patterns.md"]
    },
    {
      repository: "https://github.com/Uniswap/ai-toolkit.git",
      commit: "f0812c1d0a52ef4bcbda873d2e7eefa374a3fcf6",
      previous: "9b405c71e42d0cec4026f2c158edf99716600baa",
      documents: ["upstream-sources.md"]
    }
  ];

  for (const expectation of expected) {
    const source = references.get(expectation.repository);
    assert.ok(source, expectation.repository);
    assert.equal(source.commit, expectation.commit);
    assert.equal(source.previousObservedCommit, expectation.previous);
    assert.equal(source.compatibilitySet, null);
    assert.equal(source.notAResolvedBaseline, true);
    for (const document of expectation.documents) {
      const contents = fs.readFileSync(path.join(skillRoot, "references", document), "utf8");
      assert.match(contents, new RegExp(expectation.commit), `${document} must use ${expectation.commit}`);
    }
  }
});

test("current SDK, Universal Router, and contracts heads stay observational and preserve tested pins", () => {
  const snapshot = JSON.parse(
    fs.readFileSync(path.join(skillRoot, "references", "upstream-sources.json"), "utf8")
  );
  const observed = new Map(snapshot.observedOfficialSources.map((source) => [source.repository, source]));
  const tested = new Map(snapshot.programmableTestedBaseline.map((source) => [source.repository, source.commit]));

  assert.equal(
    tested.get("https://github.com/Uniswap/v4-core.git"),
    "59d3ecf53afa9264a16bba0e38f4c5d2231f80bc"
  );
  assert.equal(
    tested.get("https://github.com/Uniswap/v4-periphery.git"),
    "ad04c9f24a170accf5ea1b2836bbafd514537ca6"
  );
  const packages = new Map(snapshot.sdkPackages.map((entry) => [entry.name, entry]));
  assert.deepEqual(packages.get("@uniswap/v4-sdk"), {
    name: "@uniswap/v4-sdk",
    version: "2.3.1",
    integrity: "sha512-RByok7qIy7B4A3z2lIru5gTxQVZcmP2wqOsmbV+bTrUkFr8ABjzan0DD/pW64x3akiUe4WnxeX/yMvnq04uBJA==",
    gitHead: "57f126ee4ae5d435938569ad22c489e4a0262ca2",
    license: "MIT"
  });
  assert.equal(packages.get("@uniswap/sdk-core").version, "7.19.0");
  assert.equal(packages.get("@uniswap/universal-router-sdk").version, "5.11.2");

  const sdk = observed.get("https://github.com/Uniswap/sdks.git");
  assert.equal(sdk.commit, "d4e9116c61b9e39c74c5704d0224d91ff55d34d3");
  assert.equal(sdk.previousObservedCommit, "1e30c3265f3cfb818ed912833f3e65630c8b3490");
  assert.equal(sdk.observedAt, "2026-08-03");
  assert.equal(sdk.compatibilitySet, null);
  assert.match(sdk.note, /v4-sdk remains 2\.3\.1/u);

  const router = observed.get("https://github.com/Uniswap/universal-router.git");
  assert.equal(router.commit, "d203e7f5525aeae385800f9490b93886711701df");
  assert.equal(router.previousObservedCommit, "9e9a780a3c17b61fc78a1a73c85684859dda1bad");
  assert.equal(router.observedAt, "2026-08-03T22:10:41Z");
  assert.equal(router.compatibilitySet, null);
  assert.equal(router.dependencyEdgeSource, "repository-gitlinks-at-observed-commit");
  assert.deepEqual(router.dependencyEdges, [
    {
      repository: "https://github.com/Uniswap/v4-periphery.git",
      commit: "363226d9e1e2180b67bf6857023dbaad751010c5"
    },
    {
      repository: "https://github.com/Uniswap/permit2.git",
      commit: "cc56ad0f3439c502c246fc5cfcc3db92bb8b7219"
    }
  ]);
  assert.match(router.note, /bounds command-input decoding/u);
  assert.match(router.note, /PoolManager as callback caller and Universal Router as callback sender/u);

  const contracts = observed.get("https://github.com/Uniswap/contracts.git");
  assert.equal(contracts.commit, "0ecb1fcaed7cf36b3f33524e09c07efe5387f9b5");
  assert.equal(contracts.previousObservedCommit, "580e74a1e1bced14c09ab66f9e6d7e3ebdd61ac4");
  assert.equal(contracts.observedAt, "2026-08-03T22:10:41Z");
  assert.equal(contracts.deploymentSnapshotSourceCommit, "37936185dee7decf681360ec799c124e0e034672");
  assert.equal(contracts.compatibilitySet, null);
  assert.deepEqual(contracts.dependencyEdges, [
    {
      repository: "https://github.com/Uniswap/universal-router.git",
      commit: "d203e7f5525aeae385800f9490b93886711701df"
    },
    {
      repository: "https://github.com/Uniswap/v4-periphery.git",
      commit: "545a5d2a87228167edde48f3b9eda122d1e3c4d6"
    }
  ]);
  const deploymentsFeed = snapshot.observedOfficialFeeds.find(({ name }) => name === "Uniswap Deployments Feed");
  assert.equal(
    deploymentsFeed.sha256,
    "225d2c77b3b53a9c9c1a8663359577bd1f52ed0c139e10e7ee846687959282d2"
  );
  assert.equal(deploymentsFeed.source.commit, "37936185dee7decf681360ec799c124e0e034672");

  const modelPatterns = fs.readFileSync(
    path.join(skillRoot, "references", "official-model-patterns.md"),
    "utf8"
  );
  assert.match(modelPatterns, /d203e7f5525aeae385800f9490b93886711701df/u);
  assert.match(modelPatterns, /already-unlocked/u);
  assert.match(modelPatterns, /static head, dynamic offset, dynamic length/u);

  const sourcePolicy = fs.readFileSync(
    path.join(skillRoot, "references", "upstream-sources.md"),
    "utf8"
  );
  for (const revision of [sdk.commit, router.commit, contracts.commit]) {
    assert.match(sourcePolicy, new RegExp(revision), `upstream-sources.md must use ${revision}`);
  }
  assert.match(sourcePolicy, /v4-periphery@363226d9e1e2180b67bf6857023dbaad751010c5/u);
  assert.match(sourcePolicy, /@uniswap\/v4-sdk` package remains `2\.3\.1/u);
  assert.match(sourcePolicy, /No deployment, provider route, release/u);
  assert.match(sourcePolicy, /is not retroactive deployment\s+provenance/u);
});

test("local Fee V2 router evidence is bound to its exact package lock and remains non-production", () => {
  const snapshot = JSON.parse(fs.readFileSync(
    path.join(skillRoot, "references", "upstream-snapshot-2026-08-07.json"),
    "utf8"
  ));
  const lane = snapshot.compatibilityLanes.find(({ id }) => id === "programmable-fee-v2-local-router-evidence");
  assert.ok(lane);
  assert.equal(lane.status, "LOCAL_EXECUTION_EVIDENCE_NO_FORK_OR_DEPLOYMENT");
  const lockBytes = fs.readFileSync(path.join(
    skillRoot,
    "assets",
    "reference-kernels",
    "programmable-volume-fee-v2",
    "package-lock.json"
  ));
  assert.equal(crypto.createHash("sha256").update(lockBytes).digest("hex"), lane.packageLockSha256);
  const lock = JSON.parse(lockBytes.toString("utf8"));
  for (const entry of lane.packages) {
    const record = lock.packages[`node_modules/${entry.name}`];
    assert.ok(record, entry.name);
    assert.equal(record.version, entry.version, entry.name);
    assert.equal(record.integrity, entry.integrity, entry.name);
  }
  for (const [name, lockPath] of [
    ["Permit2", "node_modules/@uniswap/permit2"],
    ["solmate-permit2", "node_modules/solmate-permit2"]
  ]) {
    const entry = lane.gitDependencies.find((candidate) => candidate.name === name);
    assert.ok(entry, name);
    assert.equal(lock.packages[lockPath].integrity, entry.integrity, name);
  }
  assert.equal(lane.execution.routerRoutes, "8/8");
  assert.equal(lane.execution.forkEvidence, false);
  assert.equal(lane.execution.deploymentEvidence, false);
  assert.deepEqual(lane.advisories, {
    critical: 0,
    high: 10,
    moderate: 9,
    low: 17,
    scope: "PINNED_OFFLINE_SDK_TEST_TREE_NOT_PRODUCTION_RUNTIME",
    fixed: false
  });
});

test("offline observations produce a deterministic clean result without live inputs", () => {
  const fixture = createFixture();
  try {
    const snapshotPath = writeJson(fixture, "snapshot.json", snapshot());
    const observationsPath = writeJson(fixture, "observations.json", observations());
    const args = ["--snapshot", snapshotPath, "--observations", observationsPath, "--json"];
    const first = run(args, { NO_PROXY: "*", HTTPS_PROXY: "http://127.0.0.1:1" });
    const second = run(args, { NO_PROXY: "*", HTTPS_PROXY: "http://127.0.0.1:1" });

    assert.equal(first.status, 0, first.stderr);
    assert.equal(first.stderr, "");
    assert.equal(first.stdout, second.stdout);
    assert.deepEqual(JSON.parse(first.stdout), {
      status: "clean",
      snapshotDate: "2026-07-31",
      compared: { repositories: 1, feeds: 1 },
      findings: []
    });
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test("repository and feed drift findings are complete and stably sorted", () => {
  const changed = observations();
  changed.repositories[0] = {
    ...changed.repositories[0],
    defaultBranch: "next",
    ref: "refs/heads/next",
    commit: commitB,
    archived: true,
    license: "GPL-3.0"
  };
  changed.feeds[0].sha256 = digestB;

  const result = analyzeDrift(snapshot(), changed);
  assert.equal(result.status, "drift");
  assert.deepEqual(
    result.findings.map((finding) => finding.code),
    [
      "feed-sha256-drift",
      "archived-drift",
      "commit-drift",
      "default-branch-drift",
      "license-drift",
      "ref-drift"
    ]
  );
});

test("relevant new organization repositories are flagged while archived repositories are ignored", () => {
  const observed = observations();
  observed.repositories.push(
    {
      repository: "https://github.com/Uniswap/v4-new-source",
      defaultBranch: "main",
      ref: "refs/heads/main",
      commit: null,
      archived: false,
      license: "MIT"
    },
    {
      repository: "https://github.com/Uniswap/hook-archive",
      defaultBranch: "main",
      ref: "refs/heads/main",
      commit: null,
      archived: true,
      license: null
    },
    {
      repository: "https://github.com/Uniswap/interface",
      defaultBranch: "main",
      ref: "refs/heads/main",
      commit: null,
      archived: false,
      license: "GPL-3.0"
    }
  );

  const result = analyzeDrift(snapshot(), observed);
  assert.deepEqual(result.findings, [
    {
      code: "untracked-relevant-repository",
      repository: "https://github.com/Uniswap/v4-new-source.git",
      expected: "recorded or explicitly classified",
      actual: "untracked"
    }
  ]);
});

test("missing tracked records drift and duplicate observations fail closed", () => {
  const missing = observations();
  missing.repositories = [];
  assert.equal(analyzeDrift(snapshot(), missing).findings[0].code, "tracked-repository-missing");

  const duplicate = observations();
  duplicate.repositories.push({ ...duplicate.repositories[0], repository: "https://github.com/uniswap/docs" });
  assert.throws(() => analyzeDrift(snapshot(), duplicate), DriftInputError);
});

test("malformed snapshots exit 2 and help performs no comparison", () => {
  const fixture = createFixture();
  try {
    const invalid = snapshot();
    invalid.observedOfficialSources.push({ ...invalid.observedOfficialSources[0] });
    const snapshotPath = writeJson(fixture, "snapshot.json", invalid);
    const observationsPath = writeJson(fixture, "observations.json", observations());
    const failed = run(["--snapshot", snapshotPath, "--observations", observationsPath]);
    const help = run(["--help"]);

    assert.equal(failed.status, 2);
    assert.match(failed.stderr, /duplicate tracked repository/);
    assert.equal(failed.stdout, "");
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /Usage: check-upstream-drift\.mjs/);
    assert.equal(help.stderr, "");
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test("offline snapshot and observation files reject every decoded duplicate-key form without echoing values", () => {
  const secret = "upstream-private-key-must-not-echo";
  const sources = [
    `{"schemaVersion":2,"schemaVersion":2,"privateKey":"${secret}"}`,
    `{"schemaVersion":2,"schemaVersion":3,"privateKey":"${secret}"}`,
    `{"schemaVersion":2,"schema\\u0056ersion":3,"privateKey":"${secret}"}`
  ];
  for (const source of sources) {
    const fixture = createFixture();
    try {
      const snapshotPath = path.join(fixture, "snapshot.json");
      const observationsPath = path.join(fixture, "observations.json");
      const referencePath = path.join(fixture, "deployment-reference.json");
      fs.writeFileSync(snapshotPath, source);
      fs.writeFileSync(observationsPath, `${JSON.stringify(observations())}\n`);
      assertDuplicateFailure(run(["--snapshot", snapshotPath, "--observations", observationsPath, "--json"]), secret);

      fs.writeFileSync(snapshotPath, `${JSON.stringify(snapshot())}\n`);
      fs.writeFileSync(observationsPath, source);
      assertDuplicateFailure(run(["--snapshot", snapshotPath, "--observations", observationsPath, "--json"]), secret);

      fs.writeFileSync(observationsPath, `${JSON.stringify(observations())}\n`);
      fs.writeFileSync(referencePath, source);
      assertDuplicateFailure(run([
        "--snapshot", snapshotPath,
        "--observations", observationsPath,
        "--deployment-reference", referencePath,
        "--json"
      ]), secret);
    } finally {
      fs.rmSync(fixture, { recursive: true, force: true });
    }
  }
});

test("live GitHub and official deployment-feed responses reject decoded duplicate keys before semantics", async () => {
  const canonicalSnapshot = JSON.parse(fs.readFileSync(path.join(skillRoot, "references", "upstream-sources.json"), "utf8"));
  const launchpadReference = JSON.parse(fs.readFileSync(
    path.join(skillRoot, "references", "official-launchpad-deployments.json"),
    "utf8"
  ));
  const secret = "upstream-network-private-key-must-not-echo";
  const duplicateObjects = [
    `{"records":[],"records":[],"privateKey":"${secret}"}`,
    `{"records":[],"records":[{}],"privateKey":"${secret}"}`,
    `{"records":[],"rec\\u006frds":[{}],"privateKey":"${secret}"}`
  ];
  const duplicateArrays = [
    `[{"html_url":"https://github.com/Uniswap/docs","html_url":"https://github.com/Uniswap/docs","privateKey":"${secret}"}]`,
    `[{"html_url":"https://github.com/Uniswap/docs","html_url":"https://github.com/Uniswap/v4-core","privateKey":"${secret}"}]`,
    `[{"html_url":"https://github.com/Uniswap/docs","html_\\u0075rl":"https://github.com/Uniswap/v4-core","privateKey":"${secret}"}]`
  ];

  for (const source of duplicateArrays) {
    await assert.rejects(
      collectLiveObservations(canonicalSnapshot, async () => byteResponse(source)),
      (error) => {
        assert.ok(error instanceof DriftInputError);
        assert.equal(String(error.message).includes(secret), false);
        return true;
      }
    );
  }

  const repositories = canonicalSnapshot.observedOfficialSources.map((source) => ({
    html_url: source.repository.replace(/\.git$/u, ""),
    default_branch: source.defaultBranch,
    archived: source.archived,
    license: { spdx_id: source.license ?? null }
  }));
  for (const duplicate of duplicateObjects) {
    const fetchImplementation = async (url) => {
      const target = String(url);
      if (target.includes("/orgs/") && target.includes("/repos?")) return byteResponse(JSON.stringify(repositories));
      const commitSource = canonicalSnapshot.observedOfficialSources.find((source) => {
        const repository = source.repository.replace(/^https:\/\/github\.com\//u, "").replace(/\.git$/u, "");
        return target.includes(`/repos/${repository}/commits/`);
      });
      if (commitSource) return byteResponse(JSON.stringify({ sha: commitSource.commit }));
      if (target === launchpadReference.sources.find(({ authorityKind }) => authorityKind === "official-deployment-feed").url) {
        return byteResponse(duplicate);
      }
      throw new Error(`unexpected URL ${target}`);
    };
    await assert.rejects(
      collectLiveObservations(canonicalSnapshot, fetchImplementation, { launchpadReference }),
      (error) => {
        assert.ok(error instanceof DriftInputError);
        assert.equal(String(error.message).includes(secret), false);
        return true;
      }
    );
  }
});

test("live drift observations use an optional GitHub token only for GitHub API reads", async () => {
  const requests = [];
  const fetchImplementation = async (url, init) => {
    const target = String(url);
    requests.push({ target, headers: init.headers });
    if (target.includes("/orgs/Uniswap/repos?")) {
      return byteResponse(JSON.stringify([{
        html_url: "https://github.com/Uniswap/docs",
        default_branch: "main",
        archived: false,
        license: { spdx_id: "MIT" }
      }]));
    }
    if (target.includes("/repos/Uniswap/docs/commits/main")) {
      return byteResponse(JSON.stringify({ sha: commitA }));
    }
    if (target === "https://example.test/feed.json") return byteResponse("{}");
    throw new Error(`unexpected URL ${target}`);
  };

  const result = await collectLiveObservations(snapshot(), fetchImplementation, {
    githubToken: "test-read-only-token"
  });
  assert.equal(result.repositories.length, 1);
  assert.equal(result.feeds.length, 1);
  const apiRequests = requests.filter(({ target }) => target.startsWith("https://api.github.com/"));
  assert.ok(apiRequests.length >= 2);
  assert.equal(apiRequests.every(({ headers }) => headers.Authorization === "Bearer test-read-only-token"), true);
  const feedRequest = requests.find(({ target }) => target === "https://example.test/feed.json");
  assert.ok(feedRequest);
  assert.equal(Object.hasOwn(feedRequest.headers, "Authorization"), false);
  await assert.rejects(
    collectLiveObservations(snapshot(), fetchImplementation, { githubToken: "bad\ntoken" }),
    /bounded single-line/u
  );
});

function snapshot() {
  return {
    schemaVersion: 2,
    snapshotDate: "2026-07-31",
    driftPolicy: {
      organization: "Uniswap",
      repositoryNamePatterns: ["^v4-", "hook"],
      ignoreArchivedRepositories: true
    },
    observedOfficialFeeds: [
      {
        name: "Official feed",
        url: "https://example.test/feed.json",
        sha256: digestA
      }
    ],
    observedOfficialSources: [
      {
        name: "Uniswap Documentation",
        repository: "https://github.com/Uniswap/docs.git",
        defaultBranch: "main",
        trackedRef: "refs/heads/main",
        commit: commitA,
        archived: false,
        license: "MIT"
      }
    ]
  };
}

function observations() {
  return {
    repositories: [
      {
        repository: "https://github.com/Uniswap/docs",
        defaultBranch: "main",
        ref: "refs/heads/main",
        commit: commitA,
        archived: false,
        license: "MIT"
      }
    ],
    feeds: [
      {
        url: "https://example.test/feed.json",
        sha256: digestA
      }
    ]
  };
}

function createFixture() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "programmable-upstream-drift-"));
}

function writeJson(directory, name, value) {
  const target = path.join(directory, name);
  fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
  return target;
}

function run(args, environment = {}) {
  return childProcess.spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...environment },
    shell: false
  });
}

function byteResponse(source) {
  const bytes = Buffer.from(source, "utf8");
  return {
    status: 200,
    ok: true,
    headers: { get: (name) => name.toLowerCase() === "content-length" ? String(bytes.length) : null },
    async arrayBuffer() {
      return bytes;
    }
  };
}

function assertDuplicateFailure(result, privateValue) {
  assert.equal(result.status, 2);
  assert.equal(result.stdout, "");
  assert.equal(`${result.stdout}${result.stderr}`.includes(privateValue), false);
}
