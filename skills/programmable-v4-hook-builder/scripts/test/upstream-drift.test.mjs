import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { analyzeDrift, DriftInputError } from "../check-upstream-drift.mjs";

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
      commit: "3cce57b8ad8aae7ffa72d4947c535321ada60486",
      previous: "beaab6050068be2efa329ce9fbcf76d3a14dabe7",
      documents: ["upstream-sources.md", "routing-and-discovery.md", "official-model-patterns.md"]
    },
    {
      repository: "https://github.com/Uniswap/ai-toolkit.git",
      commit: "9b405c71e42d0cec4026f2c158edf99716600baa",
      previous: "bb873ee808564ed0c917b156b651f4ddda43a4c2",
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
