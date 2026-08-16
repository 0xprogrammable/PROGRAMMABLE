import assert from "node:assert/strict";
import childProcess from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import zlib from "node:zlib";
import {
  classifyPublicPrApplicationV3RawGitFailure,
  classifyPublicPrApplicationV3SourceManifestFailure,
  classifyPublicPrApplicationV3GitLfsPointer,
  verifyLocalSourceClosureManifestV1
} from "../public-pr-application-v3-core.mjs";
import { safeRawGitArguments } from "../repository-root.mjs";
import { canonicalJson } from "../submission-core.mjs";

test("local source-closure verifier streams more than 4096 entries across fragments", async (t) => {
  const fixture = createClosureFixture(t, { entryCount: 4097, fragmentSize: 997 });
  const report = await verifyFixture(fixture);
  assert.equal(report.status, "VERIFIED", JSON.stringify(report.findings));
  assert.equal(report.sourceClosureVerified, true);
  assert.equal(report.stats.entriesVerified, 4097);
  assert.equal(report.stats.fragmentsVerified, 5);
  assert.equal(report.readOnly, true);
  assert.equal(report.networkAccessed, false);
  assert.equal(report.candidateCodeExecuted, false);
  assert.deepEqual(report.dependencyPointerCoverage, {
    schemaVersion: "1.0.0",
    pointerCount: 0,
    pointerRecordsSha256: "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    sourceCriticalDereferenceState: "NONE",
    counts: {
      symlink: 0,
      gitlink: 0,
      gitLfs: 0,
      internalVerified: 0,
      targetVerified: 0,
      unresolved: 0,
      sourceCritical: 0,
      runtimeAssetDelegated: 0,
      unclassified: 0
    }
  });
});

test("local source-closure verifier fails closed for every content-addressed tamper class", async (t) => {
  const cases = [
    {
      name: "entry blob identity",
      code: "SOURCE_MANIFEST_ENTRY_GIT_IDENTITY_MISMATCH",
      options: { mutateEntries: (entries) => { entries[0].blobObjectId = entries[1].blobObjectId; } }
    },
    {
      name: "entry byte length",
      code: "SOURCE_MANIFEST_ENTRY_SIZE_MISMATCH",
      options: { mutateEntries: (entries) => { entries[0].byteLength += 1; } }
    },
    {
      name: "entry sha256",
      code: "SOURCE_MANIFEST_ENTRY_SHA256_MISMATCH",
      options: { mutateEntries: (entries) => { entries[0].sha256 = `sha256:${"a".repeat(64)}`; } }
    },
    {
      name: "global entry order",
      code: "SOURCE_MANIFEST_FRAGMENT_RANGE_OVERLAP",
      options: { mutateEntries: (entries) => { [entries[1], entries[2]] = [entries[2], entries[1]]; } }
    },
    {
      name: "required role",
      code: "SOURCE_MANIFEST_REQUIRED_ROLE_MISSING",
      options: { mutateEntries: (entries) => { entries[0].roleIds = ["source"]; } }
    },
    {
      name: "role order",
      code: "SOURCE_MANIFEST_ENTRY_ROLES_INVALID",
      options: { mutateEntries: (entries) => { entries[0].roleIds = ["source", "contract"]; } }
    },
    {
      name: "fragment sha256",
      code: "SOURCE_MANIFEST_FRAGMENT_SHA256_MISMATCH",
      options: { mutateFragments: (fragments) => { fragments[0].sha256 = `sha256:${"b".repeat(64)}`; } }
    },
    {
      name: "fragment blob",
      code: "SOURCE_MANIFEST_FRAGMENT_BLOB_MISMATCH",
      options: { mutateFragments: (fragments, context) => { fragments[0].blobObjectId = context.sourceEntries[0].blobObjectId; } }
    },
    {
      name: "closure digest",
      code: "SOURCE_MANIFEST_CLOSURE_SHA256_MISMATCH",
      options: { mutateManifest: (manifest) => { manifest.closureSha256 = `sha256:${"c".repeat(64)}`; } }
    },
    {
      name: "fragment count",
      code: "SOURCE_MANIFEST_FRAGMENT_COUNT_MISMATCH",
      options: { mutateManifest: (manifest) => { manifest.fragmentCount += 1; } }
    },
    {
      name: "noncanonical CRLF",
      code: "SOURCE_MANIFEST_JSONL_CRLF_FORBIDDEN",
      options: { transformFragmentBytes: (bytes) => Buffer.from(bytes.toString("utf8").replaceAll("\n", "\r\n"), "utf8") }
    }
  ];

  for (const tamper of cases) {
    await t.test(tamper.name, async (subtest) => {
      const fixture = createClosureFixture(subtest, { entryCount: 4, fragmentSize: 2, ...tamper.options });
      const report = await verifyFixture(fixture);
      assert.equal(report.sourceClosureVerified, false);
      assert.ok(report.findings.some(({ code }) => code === tamper.code), JSON.stringify(report.findings));
      assert.equal(report.ideaEligibility, "ELIGIBLE_FOR_REVIEW");
      assert.equal(report.approvalGranted, false);
    });
  }
});

test("local source-closure verifier ignores replace refs and never invokes repository Git drivers", async (t) => {
  assert.throws(
    () => safeRawGitArguments(["-C", "/tmp/example", "status", "--porcelain"]),
    /permits only rev-parse, cat-file, and ls-tree/u
  );
  const replacementFixture = createClosureFixture(t, { entryCount: 4, fragmentSize: 2 });
  const originalCommit = replacementFixture.repository.revisionObjectId;
  fs.writeFileSync(path.join(replacementFixture.repositoryRoot, "unrelated.txt"), "replacement tree\n");
  runGit(replacementFixture.repositoryRoot, ["add", "unrelated.txt"]);
  runGit(replacementFixture.repositoryRoot, ["commit", "--quiet", "-m", "replacement candidate"]);
  const replacementCommit = runGit(replacementFixture.repositoryRoot, ["rev-parse", "HEAD"]).trim();
  runGit(replacementFixture.repositoryRoot, ["replace", originalCommit, replacementCommit]);
  const replaced = await verifyFixture(replacementFixture);
  assert.equal(replaced.status, "VERIFIED", JSON.stringify(replaced.findings));

  const configFixture = createClosureFixture(t, { entryCount: 4, fragmentSize: 2 });
  const marker = path.join(configFixture.repositoryRoot, "git-driver-executed.txt");
  runGit(configFixture.repositoryRoot, ["config", "filter.adversarial.clean", `touch ${marker}`]);
  const accepted = await verifyFixture(configFixture);
  assert.equal(accepted.status, "VERIFIED", JSON.stringify(accepted.findings));
  assert.equal(fs.existsSync(marker), false);
});

test("local source-closure resource ceilings hold for split review without rejecting the idea", async (t) => {
  const fixture = createClosureFixture(t, { entryCount: 4, fragmentSize: 2 });
  const report = await verifyFixture(fixture, { maxEntries: 3 });
  assert.equal(report.status, "HOLD_SPLIT_REVIEW");
  assert.equal(report.splitReviewRequired, true);
  assert.equal(report.ideaEligibility, "ELIGIBLE_FOR_REVIEW");
  assert.ok(report.findings.some(({ code, classification }) => (
    code === "SOURCE_MANIFEST_SPLIT_REVIEW_REQUIRED" && classification === "tooling-split-review"
  )));

  const blobBound = await verifyFixture(fixture, { maxSourceBlobBytes: 1 });
  assert.equal(blobBound.status, "HOLD_SPLIT_REVIEW");
  assert.equal(blobBound.ideaEligibility, "ELIGIBLE_FOR_REVIEW");

  const treeBound = await verifyFixture(fixture, { maxTreeEntries: 2 });
  assert.equal(treeBound.status, "HOLD_SPLIT_REVIEW");
  assert.equal(treeBound.ideaEligibility, "ELIGIBLE_FOR_REVIEW");
  assert.ok(treeBound.findings.some(({ code, classification }) => (
    code === "SOURCE_MANIFEST_SPLIT_REVIEW_REQUIRED" && classification === "tooling-split-review"
  )));

  const rawGitObjectBound = await verifyFixture(fixture, {
    rawGitIntegrityLimits: { maxObjectBytes: 1 }
  });
  assert.equal(rawGitObjectBound.status, "HOLD_SPLIT_REVIEW");
  assert.equal(rawGitObjectBound.splitReviewRequired, true);
  assert.equal(rawGitObjectBound.ideaEligibility, "ELIGIBLE_FOR_REVIEW");
  assert.ok(rawGitObjectBound.findings.some(({ code, classification, integrityCode }) => (
    code === "SOURCE_MANIFEST_SPLIT_REVIEW_REQUIRED"
    && classification === "tooling-split-review"
    && integrityCode === "RAW_GIT_RESOURCE_LIMIT"
  )), JSON.stringify(rawGitObjectBound.findings));
});

test("source Git cleanup and deadline fallbacks keep awaited promises live and close race-free", () => {
  const source = fs.readFileSync(new URL("../public-pr-application-v3-source-git.mjs", import.meta.url), "utf8");
  const closeStart = source.indexOf("  async close() {");
  const closeEnd = source.indexOf("\n  }\n}\n\nfunction validateSourceClosureEntry", closeStart);
  assert.ok(closeStart >= 0 && closeEnd > closeStart);
  const closeSource = source.slice(closeStart, closeEnd);
  assert.ok(closeSource.indexOf('this.process.once("close", resolve)') < closeSource.indexOf("this.process.stdin.end()"));
  assert.match(closeSource, /this\.process\.exitCode !== null \|\| this\.process\.signalCode !== null/u);
  assert.match(closeSource, /clearTimeout\(killTimer\)/u);
  assert.doesNotMatch(closeSource, /\.unref/u);

  const deadlineSource = source.slice(source.indexOf("function withDeadline("));
  assert.match(deadlineSource, /const timer = setTimeout/u);
  assert.match(deadlineSource, /clearTimeout\(timer\)/u);
  assert.doesNotMatch(deadlineSource, /\.unref/u);
});

test("raw Git resource and deadline failures are tooling holds while identity failures stay invalid", () => {
  for (const integrityCode of ["RAW_GIT_RESOURCE_LIMIT", "RAW_GIT_DEADLINE", "RAW_GIT_LIMIT_INVALID"]) {
    const error = Object.assign(new Error("bounded verifier stopped"), { code: integrityCode });
    assert.deepEqual(classifyPublicPrApplicationV3RawGitFailure(error), {
      disposition: "split-review",
      integrityCode
    });
  }

  for (const integrityCode of ["RAW_GIT_OBJECT_MISSING", "RAW_GIT_OBJECT_READ_FAILED"]) {
    const error = Object.assign(new Error("object store is unavailable"), { code: integrityCode });
    assert.deepEqual(classifyPublicPrApplicationV3RawGitFailure(error), {
      disposition: "availability",
      integrityCode
    });
  }

  for (const integrityCode of [
    "RAW_GIT_OBJECT_HASH_MISMATCH",
    "RAW_GIT_COMMIT_TREE_MISMATCH",
    "RAW_GIT_OBJECT_IDENTITY_INVALID",
    "RAW_GIT_BATCH_PROTOCOL"
  ]) {
    const error = Object.assign(new Error("raw Git integrity mismatch"), { code: integrityCode });
    assert.deepEqual(classifyPublicPrApplicationV3RawGitFailure(error), {
      disposition: "integrity-invalid",
      integrityCode
    });
  }
});

test("downstream manifest Git availability, resource, and integrity failures retain distinct dispositions", () => {
  for (const integrityCode of ["SOURCE_MANIFEST_RESOURCE_LIMIT", "SOURCE_MANIFEST_WALL_TIME_LIMIT", "ENOBUFS", "ETIMEDOUT"]) {
    assert.deepEqual(
      classifyPublicPrApplicationV3SourceManifestFailure(Object.assign(new Error("bounded"), { code: integrityCode })),
      { disposition: "split-review", integrityCode }
    );
  }
  for (const integrityCode of [
    "SOURCE_MANIFEST_GIT_BATCH_EOF",
    "SOURCE_MANIFEST_GIT_OBJECT_MISSING",
    "SOURCE_MANIFEST_GIT_OBJECT_READ_FAILED",
    "SOURCE_MANIFEST_GIT_TREE_READ_FAILED",
    "ENOENT",
    "EPIPE"
  ]) {
    assert.deepEqual(
      classifyPublicPrApplicationV3SourceManifestFailure(Object.assign(new Error("unavailable"), { code: integrityCode })),
      { disposition: "availability", integrityCode }
    );
  }
  for (const integrityCode of [
    "SOURCE_MANIFEST_GIT_BATCH_PROTOCOL",
    "SOURCE_MANIFEST_GIT_OBJECT_TYPE",
    "SOURCE_MANIFEST_GIT_TREE_PROTOCOL",
    "SOURCE_MANIFEST_ENTRY_SHA256_MISMATCH"
  ]) {
    assert.deepEqual(
      classifyPublicPrApplicationV3SourceManifestFailure(Object.assign(new Error("invalid"), { code: integrityCode })),
      { disposition: "integrity-invalid", integrityCode }
    );
  }
});

test("a missing raw Git object is an availability hold rather than source invalidation", async (t) => {
  const fixture = createClosureFixture(t, { entryCount: 2, fragmentSize: 2 });
  const commitObjectPath = path.join(
    fixture.repositoryRoot,
    ".git",
    "objects",
    fixture.repository.revisionObjectId.slice(0, 2),
    fixture.repository.revisionObjectId.slice(2)
  );
  assert.equal(fs.existsSync(commitObjectPath), true, commitObjectPath);
  fs.unlinkSync(commitObjectPath);

  const report = await verifyFixture(fixture);
  assert.equal(report.status, "INTEGRATION_PENDING");
  assert.equal(report.integrationPending, true);
  assert.equal(report.sourceClosureVerified, false);
  assert.equal(report.ideaEligibility, "ELIGIBLE_FOR_REVIEW");
  assert.ok(report.findings.some(({ code, classification, integrityCode }) => (
    code === "SOURCE_MANIFEST_RAW_GIT_OBJECTS_UNAVAILABLE"
    && classification === "tooling-transport"
    && integrityCode === "RAW_GIT_OBJECT_MISSING"
  )), JSON.stringify(report.findings));
});

test("a missing manifest fragment blob after commit-tree proof stays integration-pending", async (t) => {
  const fixture = createClosureFixture(t, { entryCount: 2, fragmentSize: 2 });
  const fragmentObjectId = fixture.manifest.fragments[0].blobObjectId;
  const fragmentObjectPath = path.join(
    fixture.repositoryRoot,
    ".git",
    "objects",
    fragmentObjectId.slice(0, 2),
    fragmentObjectId.slice(2)
  );
  assert.equal(fs.existsSync(fragmentObjectPath), true, fragmentObjectPath);
  fs.unlinkSync(fragmentObjectPath);

  const report = await verifyFixture(fixture);
  assert.equal(report.status, "INTEGRATION_PENDING", JSON.stringify(report.findings));
  assert.equal(report.integrationPending, true);
  assert.equal(report.sourceClosureVerified, false);
  assert.ok(report.findings.some(({ code, classification, integrityCode }) => (
    code === "SOURCE_MANIFEST_RAW_GIT_OBJECTS_UNAVAILABLE"
    && classification === "tooling-transport"
    && integrityCode === "SOURCE_MANIFEST_GIT_OBJECT_MISSING"
  )), JSON.stringify(report.findings));
});

test("recursive tree closure verifies internal symlinks and retains unresolved Gitlinks without invalidating pointer identity", async (t) => {
  const utf8AndSymlink = createClosureFixture(t, {
    entryCount: 2,
    fragmentSize: 2,
    additionalEntries: [
      { path: "src/rust-über space.rs", bytes: Buffer.from("pub fn value() -> u8 { 1 }\n", "utf8") },
      { path: "src/typescript-link.ts", symlinkTarget: "file-0.txt" }
    ]
  });
  const symlinkReport = await verifyFixture(utf8AndSymlink);
  assert.equal(symlinkReport.status, "VERIFIED", JSON.stringify(symlinkReport.findings));
  assert.equal(symlinkReport.sourceClosureVerified, true);
  assert.equal(symlinkReport.stats.entriesVerified, 4);
  assert.equal(symlinkReport.stats.symlinkEntries, 1);
  assert.equal(symlinkReport.findings.some(({ code }) => code === "SOURCE_MANIFEST_TREE_CLOSURE_MISMATCH"), false);
  assert.deepEqual(symlinkReport.dependencyPointerCoverage.counts, {
    symlink: 1,
    gitlink: 0,
    gitLfs: 0,
    internalVerified: 1,
    targetVerified: 0,
    unresolved: 0,
    sourceCritical: 1,
    runtimeAssetDelegated: 0,
    unclassified: 0
  });
  assert.equal(symlinkReport.dependencyPointerCoverage.sourceCriticalDereferenceState, "VERIFIED");

  const gitlink = createClosureFixture(t, { entryCount: 2, fragmentSize: 2, gitlinkPath: "vendor/companion" });
  const gitlinkReport = await verifyFixture(gitlink);
  assert.equal(gitlinkReport.status, "VERIFIED", JSON.stringify(gitlinkReport.findings));
  assert.equal(gitlinkReport.sourceClosureVerified, true);
  assert.equal(gitlinkReport.stats.gitlinkEntries, 1);
  assert.ok(gitlinkReport.findings.some(({ code }) => code === "SOURCE_MANIFEST_GITLINK_COMPANION_REQUIRED"));
  assert.equal(gitlinkReport.dependencyPointerCoverage.counts.gitlink, 1);
  assert.equal(gitlinkReport.dependencyPointerCoverage.counts.unresolved, 1);
  assert.equal(gitlinkReport.dependencyPointerCoverage.counts.unclassified, 1);
  assert.equal(gitlinkReport.dependencyPointerCoverage.sourceCriticalDereferenceState, "UNRESOLVED");
  assert.equal(gitlinkReport.ideaEligibility, "ELIGIBLE_FOR_REVIEW");
});

test("recursive tree closure rejects an unexpected post-manifest blob", async (t) => {
  const fixture = createClosureFixture(t, {
    entryCount: 2,
    fragmentSize: 2,
    unlistedFiles: { "review/source-closure/unlisted-source.ts": "export const hidden = true;\n" }
  });
  const report = await verifyFixture(fixture);
  assert.equal(report.sourceClosureVerified, false);
  assert.ok(report.findings.some(({ code, unlistedPaths }) => (
    code === "SOURCE_MANIFEST_TREE_CLOSURE_MISMATCH"
    && unlistedPaths.includes("review/source-closure/unlisted-source.ts")
  )), JSON.stringify(report.findings));
});

test("local manifest verifier closes every LFS pointer blob while exposing unresolved target dereference", async (t) => {
  const oid = "a".repeat(64);
  const variants = [
    ["canonical", `version https://git-lfs.github.com/spec/v1\noid sha256:${oid}\nsize 7\n`, "canonical-pointer"],
    ["missing-final-lf", `version https://git-lfs.github.com/spec/v1\noid sha256:${oid}\nsize 7`, "pointer-like"],
    ["crlf", `version https://git-lfs.github.com/spec/v1\r\noid sha256:${oid}\r\nsize 7\r\n`, "pointer-like"],
    ["extra-line", `version https://git-lfs.github.com/spec/v1\noid sha256:${oid}\nsize 7\n\n`, "pointer-like"],
    ["extension", `version https://git-lfs.github.com/spec/v1\next-0-foo sha256:${oid}\noid sha256:${oid}\nsize 7\n`, "pointer-like"],
    ["legacy-hawser", `version https://hawser.github.com/spec/v1\noid sha256:${oid}\nsize 7\n`, "pointer-like"],
    ["malformed", "version https://git-lfs.github.com/spec/v1\noid missing\nsize nope\n", "pointer-like"]
  ];
  for (const [name, source, classification] of variants) {
    await t.test(name, async (subtest) => {
      const bytes = Buffer.from(source, "utf8");
      assert.equal(classifyPublicPrApplicationV3GitLfsPointer(bytes), classification);
      const fixture = createClosureFixture(subtest, {
        entryCount: 1,
        fragmentSize: 2,
        additionalEntries: [{ path: `assets/${name}.bin`, bytes }]
      });
      const report = await verifyFixture(fixture);
      assert.equal(report.status, "VERIFIED", JSON.stringify(report.findings));
      assert.equal(report.sourceClosureVerified, true);
      assert.equal(report.stats.lfsPointerEntries, 1);
      assert.equal(report.dependencyPointerCoverage.counts.gitLfs, 1);
      assert.equal(report.dependencyPointerCoverage.counts.unresolved, 1);
      assert.equal(report.dependencyPointerCoverage.sourceCriticalDereferenceState, "UNRESOLVED");
      assert.ok(report.findings.some(({ code }) => code.startsWith("SOURCE_MANIFEST_GIT_LFS_")));
    });
  }
  assert.equal(
    classifyPublicPrApplicationV3GitLfsPointer(Buffer.from("const url = 'https://git-lfs.github.com/spec/v1';\n")),
    "not-pointer"
  );
});

test("local manifest verifier resolves a valid LFS target only from one stable materialized worktree file", async (t) => {
  const payload = Buffer.from("payload", "utf8");
  const pointer = Buffer.from(
    `version https://git-lfs.github.com/spec/v1\noid ${sha256(payload)}\nsize ${payload.length}\n`,
    "utf8"
  );
  const create = (subtest) => createClosureFixture(subtest, {
    entryCount: 1,
    fragmentSize: 2,
    additionalEntries: [{ path: "assets/hero.bin", bytes: pointer }]
  });

  await t.test("exact target", async (subtest) => {
    const fixture = create(subtest);
    fs.writeFileSync(path.join(fixture.repositoryRoot, "assets", "hero.bin"), payload);
    const report = await verifyFixture(fixture);
    assert.equal(report.status, "VERIFIED", JSON.stringify(report.findings));
    assert.equal(report.sourceClosureVerified, true);
    assert.equal(report.dependencyPointerCoverage.counts.gitLfs, 1);
    assert.equal(report.dependencyPointerCoverage.counts.targetVerified, 1);
    assert.equal(report.dependencyPointerCoverage.counts.unresolved, 0);
    assert.equal(report.dependencyPointerCoverage.sourceCriticalDereferenceState, "VERIFIED");
    assert.equal(report.stats.lfsTargetBytesVerified, payload.length);
    assert.equal(report.candidateCodeExecuted, false);
    assert.equal(report.networkAccessed, false);
    assert.ok(report.findings.some((finding) => (
      finding.code === "SOURCE_MANIFEST_GIT_LFS_TARGET_LOCAL_STABLE_BYTES_ONLY"
      && finding.verificationScope === "LOCAL_STABLE_BYTES_ONLY"
      && finding.networkAccessed === false
      && finding.availabilityVerified === false
      && finding.reproducibilityVerified === false
    )), JSON.stringify(report.findings));
  });

  const unresolvedCases = [
    ["pointer-only", () => {}, {}, "LFS_MATERIALIZED_SIZE_MISMATCH"],
    ["missing", (fixture) => fs.unlinkSync(path.join(fixture.repositoryRoot, "assets", "hero.bin")), {}, "LFS_MATERIALIZED_PATH_UNAVAILABLE"],
    ["hash-mismatch", (fixture) => fs.writeFileSync(path.join(fixture.repositoryRoot, "assets", "hero.bin"), Buffer.from("PAYLOAD")), {}, "LFS_MATERIALIZED_SHA256_MISMATCH"],
    ["final-symlink", (fixture) => {
      const target = path.join(fixture.repositoryRoot, "materialized-hero.bin");
      fs.writeFileSync(target, payload);
      fs.unlinkSync(path.join(fixture.repositoryRoot, "assets", "hero.bin"));
      fs.symlinkSync(target, path.join(fixture.repositoryRoot, "assets", "hero.bin"));
    }, {}, "LFS_MATERIALIZED_PATH_SYMLINK"],
    ["parent-symlink", (fixture) => {
      const external = path.join(fixture.repositoryRoot, "materialized-assets");
      fs.renameSync(path.join(fixture.repositoryRoot, "assets"), external);
      fs.writeFileSync(path.join(external, "hero.bin"), payload);
      fs.symlinkSync(external, path.join(fixture.repositoryRoot, "assets"));
    }, {}, "LFS_MATERIALIZED_PARENT_SYMLINK"],
    ["aggregate-budget", (fixture) => fs.writeFileSync(path.join(fixture.repositoryRoot, "assets", "hero.bin"), payload), { maxMaterializedLfsBytes: payload.length - 1 }, "LFS_MATERIALIZED_AGGREGATE_LIMIT"]
  ];
  for (const [name, prepare, limits, reasonCode] of unresolvedCases) {
    await t.test(name, async (subtest) => {
      const fixture = create(subtest);
      prepare(fixture);
      const report = await verifyFixture(fixture, limits);
      assert.equal(report.status, "VERIFIED", JSON.stringify(report.findings));
      assert.equal(report.sourceClosureVerified, true);
      assert.equal(report.dependencyPointerCoverage.counts.targetVerified, 0);
      assert.equal(report.dependencyPointerCoverage.counts.unresolved, 1);
      assert.equal(report.dependencyPointerCoverage.sourceCriticalDereferenceState, "UNRESOLVED");
      assert.ok(report.findings.some((finding) => (
        finding.code === "SOURCE_MANIFEST_GIT_LFS_DEPENDENCY_REQUIRED"
        && finding.reasonCode === reasonCode
      )), JSON.stringify(report.findings));
    });
  }
});

test("local verifier rejects a corrupt loose root object even when supplied bytes and SHA-256 bindings collude", async (t) => {
  const fixture = createClosureFixture(t, { entryCount: 2, fragmentSize: 2 });
  fixture.manifest.repository.repositoryUri = "https://github.com/example-builder/substituted-source";
  fixture.repository.repositoryUri = fixture.manifest.repository.repositoryUri;
  const substitutedBytes = Buffer.from(`${canonicalJson(fixture.manifest)}\n`, "utf8");
  fixture.repository.sourceManifest.sha256 = sha256(substitutedBytes);
  fixture.repository.sourceManifest.byteLength = substitutedBytes.length;
  overwriteLooseObject(
    fixture.repositoryRoot,
    fixture.repository.sourceManifest.blobObjectId,
    "blob",
    substitutedBytes
  );

  const report = await verifyFixture(fixture);
  assert.equal(report.sourceClosureVerified, false);
  assert.ok(report.findings.some(({ code }) => code === "SOURCE_MANIFEST_GIT_OBJECT_HASH_MISMATCH"), JSON.stringify(report.findings));
});

test("local manifest verifier recomputes the raw commit and every recursive tree identity", async (t) => {
  for (const objectKind of ["commit", "recursive-tree"]) {
    await t.test(objectKind, async (subtest) => {
      const fixture = createClosureFixture(subtest, { entryCount: 2, fragmentSize: 2 });
      const objectId = objectKind === "commit"
        ? fixture.repository.revisionObjectId
        : runGit(fixture.repositoryRoot, ["rev-parse", `${fixture.repository.revisionObjectId}:src`]).trim();
      const type = objectKind === "commit" ? "commit" : "tree";
      const original = childProcess.execFileSync("git", ["-C", fixture.repositoryRoot, "cat-file", type, objectId], {
        encoding: null,
        stdio: ["ignore", "pipe", "pipe"]
      });
      const corrupt = Buffer.from(original);
      corrupt[corrupt.length - 1] ^= 0x01;
      overwriteLooseObject(fixture.repositoryRoot, objectId, type, corrupt);

      const report = await verifyFixture(fixture);
      assert.equal(report.sourceClosureVerified, false);
      assert.equal(report.status, "INVALID");
      assert.equal(report.splitReviewRequired, false);
      assert.ok(
        report.findings.some(({ code }) => code === "SOURCE_MANIFEST_RAW_GIT_INTEGRITY_INVALID"),
        JSON.stringify(report.findings)
      );
    });
  }
});

async function verifyFixture(fixture, limits = {}) {
  return verifyLocalSourceClosureManifestV1({
    repositoryRoot: fixture.repositoryRoot,
    repository: fixture.repository,
    manifest: fixture.manifest,
    requiredEntries: [{ path: fixture.sourceEntries[0].path, roleIds: ["contract"] }],
    requiredPaths: [],
    limits
  });
}

function createClosureFixture(t, {
  entryCount,
  fragmentSize,
  mutateEntries = () => {},
  mutateFragments = () => {},
  mutateManifest = () => {},
  transformFragmentBytes = (bytes) => bytes,
  additionalEntries = [],
  unlistedFiles = {},
  gitlinkPath = null
}) {
  const repositoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-source-closure-"));
  t.after(() => fs.rmSync(repositoryRoot, { recursive: true, force: true }));
  runGit(repositoryRoot, ["init", "--quiet", "--initial-branch=main"]);
  runGit(repositoryRoot, ["config", "user.name", "Source Closure Test"]);
  runGit(repositoryRoot, ["config", "user.email", "source-closure@example.invalid"]);

  const width = String(entryCount - 1).length;
  const sourceBytes = new Map();
  for (let index = 0; index < entryCount; index += 1) {
    const repositoryPath = `src/file-${String(index).padStart(width, "0")}.txt`;
    const bytes = Buffer.from(`source-${index}\n`, "utf8");
    sourceBytes.set(repositoryPath, bytes);
    const absolutePath = path.join(repositoryRoot, ...repositoryPath.split("/"));
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, bytes);
  }
  for (const entry of additionalEntries) {
    const absolutePath = path.join(repositoryRoot, ...entry.path.split("/"));
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    if (typeof entry.symlinkTarget === "string") {
      fs.symlinkSync(entry.symlinkTarget, absolutePath);
      sourceBytes.set(entry.path, Buffer.from(entry.symlinkTarget, "utf8"));
    } else {
      const bytes = Buffer.isBuffer(entry.bytes) ? entry.bytes : Buffer.from(String(entry.bytes ?? ""), "utf8");
      fs.writeFileSync(absolutePath, bytes);
      sourceBytes.set(entry.path, bytes);
    }
  }
  runGit(repositoryRoot, ["add", "--", "."]);
  const sourceIndex = readIndex(repositoryRoot);
  const sourceEntries = [...sourceBytes.entries()]
    .sort(([left], [right]) => Buffer.compare(Buffer.from(left), Buffer.from(right)))
    .map(([repositoryPath, bytes], index) => {
      const gitMode = sourceIndex.get(repositoryPath).mode;
      return {
        path: repositoryPath,
        gitMode,
        blobObjectId: sourceIndex.get(repositoryPath).objectId,
        byteLength: bytes.length,
        sha256: sha256(bytes),
        roleIds: index === 0
          ? ["contract", "source"]
          : gitMode === "120000"
            ? ["source", "symlink"]
            : ["source"]
      };
    });
  mutateEntries(sourceEntries);

  const fragmentDirectory = path.join(repositoryRoot, "review", "source-closure");
  fs.mkdirSync(fragmentDirectory, { recursive: true });
  const fragmentBuilds = [];
  for (let offset = 0, sequence = 0; offset < sourceEntries.length; offset += fragmentSize, sequence += 1) {
    const entries = sourceEntries.slice(offset, offset + fragmentSize);
    const repositoryPath = `review/source-closure/source-fragment-${String(sequence).padStart(5, "0")}.jsonl`;
    const canonicalBytes = Buffer.from(entries.map((entry) => `${canonicalJson(entry)}\n`).join(""), "utf8");
    const bytes = transformFragmentBytes(canonicalBytes, { sequence, entries });
    fs.writeFileSync(path.join(repositoryRoot, ...repositoryPath.split("/")), bytes);
    fragmentBuilds.push({ sequence, entries, repositoryPath, bytes });
  }
  runGit(repositoryRoot, ["add", "--", "review/source-closure"]);
  const stagedIndex = readIndex(repositoryRoot);
  const fragments = fragmentBuilds.map(({ sequence, entries, repositoryPath, bytes }) => ({
    id: `source-fragment-${String(sequence).padStart(5, "0")}`,
    sequence,
    path: repositoryPath,
    sha256: sha256(bytes),
    byteLength: bytes.length,
    blobObjectId: stagedIndex.get(repositoryPath).objectId,
    entryCount: entries.length,
    firstPath: entries[0].path,
    lastPath: entries.at(-1).path
  }));
  mutateFragments(fragments, { sourceEntries, fragmentBuilds });
  const manifest = {
    schemaVersion: "1.0.0",
    repository: {
      numericRepositoryId: "987654321",
      repositoryUri: "https://github.com/example-builder/source-closure-fixture"
    },
    ordering: "repository-path-utf8-bytewise-ascending",
    fragmentEncoding: "canonical-json-lines-v1",
    entrySchemaId: "urn:programmable:source-closure-manifest:1.0.0#/$defs/sourceEntry",
    entryCount: sourceEntries.length,
    fragmentCount: fragments.length,
    closureSha256: sha256(Buffer.concat(fragmentBuilds.map(({ bytes }) => bytes))),
    fragments
  };
  mutateManifest(manifest, { sourceEntries, fragmentBuilds });
  const manifestPath = "review/source-closure/source-closure-manifest.v1.json";
  const manifestBytes = Buffer.from(`${canonicalJson(manifest)}\n`, "utf8");
  fs.writeFileSync(path.join(repositoryRoot, ...manifestPath.split("/")), manifestBytes);
  runGit(repositoryRoot, ["add", "--", manifestPath]);
  for (const [repositoryPath, content] of Object.entries(unlistedFiles)) {
    const absolutePath = path.join(repositoryRoot, ...repositoryPath.split("/"));
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, content);
    runGit(repositoryRoot, ["add", "--", repositoryPath]);
  }
  if (gitlinkPath !== null) {
    runGit(repositoryRoot, ["update-index", "--add", "--cacheinfo", `160000,${"1".repeat(40)},${gitlinkPath}`]);
  }
  runGit(repositoryRoot, ["commit", "--quiet", "-m", "source closure fixture"]);
  const revisionObjectId = runGit(repositoryRoot, ["rev-parse", "HEAD"]).trim();
  const treeObjectId = runGit(repositoryRoot, ["rev-parse", "HEAD^{tree}"]).trim();
  const manifestBlobObjectId = runGit(repositoryRoot, ["rev-parse", `HEAD:${manifestPath}`]).trim();
  const repository = {
    id: "primary",
    numericRepositoryId: manifest.repository.numericRepositoryId,
    repositoryUri: manifest.repository.repositoryUri,
    revisionObjectId,
    treeObjectId,
    sourceClosureMode: "manifest",
    sourcePaths: [],
    sourceManifest: {
      schemaId: "urn:programmable:source-closure-manifest:1.0.0",
      schemaVersion: "1.0.0",
      path: manifestPath,
      sha256: sha256(manifestBytes),
      byteLength: manifestBytes.length,
      blobObjectId: manifestBlobObjectId,
      entryCount: manifest.entryCount,
      fragmentCount: manifest.fragmentCount
    },
    contractPaths: [sourceEntries[0].path],
    githubActionsRunIds: []
  };
  return { repositoryRoot, repository, manifest, sourceEntries };
}

function readIndex(repositoryRoot) {
  const output = childProcess.execFileSync("git", ["-C", repositoryRoot, "ls-files", "-s", "-z"], {
    encoding: null,
    stdio: ["ignore", "pipe", "pipe"]
  });
  const entries = new Map();
  for (const record of output.toString("utf8").split("\0").filter(Boolean)) {
    const match = /^(\d{6}) ([0-9a-f]{40}) (\d+)\t(.+)$/u.exec(record);
    assert.ok(match, record);
    entries.set(match[4], { mode: match[1], objectId: match[2], stage: Number(match[3]) });
  }
  return entries;
}

function sha256(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function runGit(repositoryRoot, argumentsList) {
  return childProcess.execFileSync("git", ["-C", repositoryRoot, ...argumentsList], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function overwriteLooseObject(repositoryRoot, objectId, type, bytes) {
  const objectPath = path.join(repositoryRoot, ".git", "objects", objectId.slice(0, 2), objectId.slice(2));
  assert.equal(fs.existsSync(objectPath), true, objectPath);
  const rawObject = Buffer.concat([Buffer.from(`${type} ${bytes.length}\0`, "ascii"), bytes]);
  fs.chmodSync(objectPath, 0o600);
  fs.writeFileSync(objectPath, zlib.deflateSync(rawObject));
}
