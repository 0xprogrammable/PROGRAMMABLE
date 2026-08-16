import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  deriveDependencyPointerCriticality,
  matchGitlinkCompanions,
  parseGitLfsPointer,
  resolveRawGitSymlinks,
  summarizeDependencyPointers,
  verifyStreamedGitLfsObject
} from "../dependency-pointer-core.mjs";

const oid = "a".repeat(64);
const blobA = "1".repeat(40);
const blobB = "2".repeat(40);

test("Git LFS marker/parser recognizes current, legacy, CRLF, no-final-LF, extensions, and malformed markers", () => {
  const cases = [
    {
      name: "ordinary bytes",
      bytes: Buffer.from("pragma solidity ^0.8.26;\n"),
      want: { kind: "ordinary" }
    },
    {
      name: "current LF",
      bytes: Buffer.from(`version https://git-lfs.github.com/spec/v1\noid sha256:${oid}\nsize 7\n`),
      want: {
        kind: "git-lfs",
        parseState: "VALID",
        representation: "CURRENT",
        lineEnding: "LF",
        finalLineFeed: true,
        extensionCount: 0,
        oidSha256: `sha256:${oid}`,
        size: 7
      }
    },
    {
      name: "current CRLF",
      bytes: Buffer.from(`version https://git-lfs.github.com/spec/v1\r\noid sha256:${oid}\r\nsize 0\r\n`),
      want: {
        kind: "git-lfs",
        parseState: "VALID",
        representation: "CURRENT",
        lineEnding: "CRLF",
        finalLineFeed: true,
        extensionCount: 0,
        oidSha256: `sha256:${oid}`,
        size: 0
      }
    },
    {
      name: "current without final LF",
      bytes: Buffer.from(`version https://git-lfs.github.com/spec/v1\noid sha256:${oid}\nsize 9`),
      want: {
        kind: "git-lfs",
        parseState: "VALID",
        representation: "CURRENT",
        lineEnding: "LF",
        finalLineFeed: false,
        extensionCount: 0,
        oidSha256: `sha256:${oid}`,
        size: 9
      }
    },
    {
      name: "legacy marker",
      bytes: Buffer.from(`version https://hawser.github.com/spec/v1\noid sha256:${oid}\nsize 11\n`),
      want: {
        kind: "git-lfs",
        parseState: "VALID",
        representation: "LEGACY",
        lineEnding: "LF",
        finalLineFeed: true,
        extensionCount: 0,
        oidSha256: `sha256:${oid}`,
        size: 11
      }
    },
    {
      name: "extension pointer",
      bytes: Buffer.from(`version https://git-lfs.github.com/spec/v1\next-1-example value\noid sha256:${oid}\nsize 12\n`),
      want: {
        kind: "git-lfs",
        parseState: "VALID",
        representation: "CURRENT",
        lineEnding: "LF",
        finalLineFeed: true,
        extensionCount: 1,
        oidSha256: `sha256:${oid}`,
        size: 12
      }
    }
  ];

  for (const fixture of cases) {
    assert.deepEqual(parseGitLfsPointer(fixture.bytes), fixture.want, fixture.name);
  }

  for (const bytes of [
    Buffer.from("version https://git-lfs.github.com/spec/v1\noid sha256:not-a-digest\nsize 7\n"),
    Buffer.from(`version https://git-lfs.github.com/spec/v1\noid sha256:${oid}\nsize -1\n`),
    Buffer.from(`version https://git-lfs.github.com/spec/v1\r\noid sha256:${oid}\nsize 7\n`),
    Buffer.concat([
      Buffer.from("version https://git-lfs.github.com/spec/v1\n"),
      Buffer.from([0xff])
    ]),
    Buffer.from(`\uFEFFversion https://git-lfs.github.com/spec/v1\noid sha256:${oid}\nsize 7\n`)
  ]) {
    const parsed = parseGitLfsPointer(bytes);
    assert.equal(parsed.kind, "git-lfs");
    assert.equal(parsed.parseState, "MALFORMED");
    assert.equal("oidSha256" in parsed, false);
  }
});

test("raw-Git symlink resolver follows component chains and keeps cycles and escapes privacy-safe", () => {
  const records = resolveRawGitSymlinks({
    entries: [
      { path: "contracts/Hook.sol", mode: "120000", objectId: blobA, bytes: Buffer.from("../src/lib/current/Hook.sol") },
      { path: "src/lib", mode: "120000", objectId: "3".repeat(40), bytes: Buffer.from("../vendor/lib") },
      { path: "vendor/lib/current", mode: "120000", objectId: "4".repeat(40), bytes: Buffer.from("v1") },
      { path: "vendor/lib/v1/Hook.sol", mode: "100644", objectId: blobB },
      { path: "cycle/a", mode: "120000", objectId: "5".repeat(40), bytes: Buffer.from("b") },
      { path: "cycle/b", mode: "120000", objectId: "6".repeat(40), bytes: Buffer.from("a") },
      { path: "external", mode: "120000", objectId: "7".repeat(40), bytes: Buffer.from("../../private/secret") }
    ]
  });
  const byPath = new Map(records.map((record) => [record.path, record]));

  assert.deepEqual(byPath.get("contracts/Hook.sol"), {
    path: "contracts/Hook.sol",
    pointerType: "symlink",
    pointerIdentity: `git-blob:${blobA}`,
    targetSha256: sha256(Buffer.from("../src/lib/current/Hook.sol")),
    resolution: "INTERNAL_VERIFIED",
    reasonCode: "INTERNAL_BLOB_RESOLVED",
    terminalPath: "vendor/lib/v1/Hook.sol",
    terminalMode: "100644",
    terminalIdentity: `git-blob:${blobB}`,
    traversedSymlinkPaths: ["contracts/Hook.sol", "src/lib", "vendor/lib/current"]
  });
  assert.equal(byPath.get("cycle/a").resolution, "UNRESOLVED");
  assert.equal(byPath.get("cycle/a").reasonCode, "SYMLINK_CYCLE");
  assert.equal(byPath.get("external").resolution, "UNRESOLVED");
  assert.equal(byPath.get("external").reasonCode, "TARGET_ESCAPES_REPOSITORY");
  assert.equal("terminalPath" in byPath.get("external"), false);
  assert.equal(JSON.stringify(byPath.get("external")).includes("private/secret"), false);
});

test("Gitlink companion matching requires one exact verified repository closure", () => {
  const commit = "8".repeat(40);
  const base = {
    gitlinks: [{ repositoryRef: "primary", path: "vendor/companion", objectId: commit }]
  };

  assert.deepEqual(matchGitlinkCompanions({
    ...base,
    repositories: [{ id: "companion", revisionObjectId: commit }],
    verifiedRepositoryRefs: ["companion"]
  }), [{
    repositoryRef: "primary",
    path: "vendor/companion",
    pointerType: "gitlink",
    pointerIdentity: `git-commit:${commit}`,
    resolution: "TARGET_VERIFIED",
    reasonCode: "EXACT_COMPANION_VERIFIED",
    companionRepositoryRef: "companion",
    terminalIdentity: `git-commit:${commit}`
  }]);

  assert.equal(matchGitlinkCompanions({ ...base, repositories: [], verifiedRepositoryRefs: [] })[0].reasonCode, "COMPANION_MISSING");
  assert.equal(matchGitlinkCompanions({
    ...base,
    repositories: [
      { id: "companion-a", revisionObjectId: commit },
      { id: "companion-b", revisionObjectId: commit }
    ],
    verifiedRepositoryRefs: ["companion-a", "companion-b"]
  })[0].reasonCode, "COMPANION_AMBIGUOUS");
  assert.equal(matchGitlinkCompanions({
    ...base,
    repositories: [{ id: "companion", revisionObjectId: commit }],
    verifiedRepositoryRefs: []
  })[0].reasonCode, "COMPANION_CLOSURE_UNVERIFIED");
});

test("criticality is derived fail-closed and canonical pointer summaries are order-independent", () => {
  assert.equal(deriveDependencyPointerCriticality({ path: "contracts/Hook.sol", roleIds: ["source"] }), "SOURCE_CRITICAL");
  assert.equal(deriveDependencyPointerCriticality({ path: "assets/hero.png", runtimeAssetDeclared: true }), "RUNTIME_ASSET");
  assert.equal(deriveDependencyPointerCriticality({ path: "assets/hero.png", runtimeAssetDeclared: true, sourceReachable: true }), "SOURCE_CRITICAL");
  assert.equal(deriveDependencyPointerCriticality({ path: "misc/opaque.data" }), "UNCLASSIFIED");

  const pointers = [
    {
      repositoryRef: "primary",
      path: "vendor/dependency",
      pointerType: "gitlink",
      pointerIdentity: `git-commit:${"9".repeat(40)}`,
      targetIdentity: null,
      resolution: "UNRESOLVED",
      criticalityInput: {}
    },
    {
      repositoryRef: "primary",
      path: "assets/hero.png",
      pointerType: "git-lfs",
      pointerIdentity: `git-blob:${"a".repeat(40)}`,
      targetIdentity: `sha256:${oid}:7`,
      resolution: "UNRESOLVED",
      criticalityInput: { runtimeAssetDeclared: true },
      runtimeAssetDelegated: true
    },
    {
      repositoryRef: "primary",
      path: "contracts/Hook.sol",
      pointerType: "symlink",
      pointerIdentity: `git-blob:${blobA}`,
      targetIdentity: `git-blob:${blobB}`,
      resolution: "INTERNAL_VERIFIED",
      criticalityInput: { roleIds: ["source"] }
    }
  ];
  const summary = summarizeDependencyPointers(pointers);
  const reordered = summarizeDependencyPointers([...pointers].reverse());

  assert.deepEqual(summary.counts, {
    symlink: 1,
    gitlink: 1,
    gitLfs: 1,
    internalVerified: 1,
    targetVerified: 0,
    unresolved: 2,
    sourceCritical: 3,
    runtimeAssetDelegated: 0,
    unclassified: 1
  });
  assert.equal(summary.schemaVersion, "1.0.0");
  assert.equal(summary.pointerCount, 3);
  assert.equal(summary.sourceCriticalDereferenceState, "UNRESOLVED");
  assert.equal(summary.pointerRecordsSha256, reordered.pointerRecordsSha256);
  assert.deepEqual(summary.canonicalRecords, reordered.canonicalRecords);
  assert.equal(summary.pointerRecordsSha256, sha256(Buffer.from(summary.canonicalRecords.map((record) => `${canonicalJson(record)}\n`).join(""))));
});

test("a runtime-asset label and caller delegation flag never exempt an unresolved pointer", () => {
  const runtimeAsset = {
    repositoryRef: "primary",
    path: "assets/hero.png",
    pointerType: "git-lfs",
    pointerIdentity: `git-blob:${"a".repeat(40)}`,
    targetIdentity: `sha256:${oid}:7`,
    resolution: "UNRESOLVED",
    criticalityInput: { runtimeAssetDeclared: true }
  };

  const undelegated = summarizeDependencyPointers([runtimeAsset]);
  assert.equal(undelegated.counts.sourceCritical, 1);
  assert.equal(undelegated.counts.runtimeAssetDelegated, 0);
  assert.equal(undelegated.sourceCriticalDereferenceState, "UNRESOLVED");

  const delegated = summarizeDependencyPointers([{ ...runtimeAsset, runtimeAssetDelegated: true }]);
  assert.equal(delegated.counts.sourceCritical, 1);
  assert.equal(delegated.counts.runtimeAssetDelegated, 0);
  assert.equal(delegated.sourceCriticalDereferenceState, "UNRESOLVED");
});

test("streamed Git LFS verification hashes one stable regular file within aggregate and deadline budgets", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-lfs-stream-"));
  try {
    const filePath = path.join(directory, "payload.bin");
    const bytes = Buffer.from("payload");
    fs.writeFileSync(filePath, bytes);
    const pointer = parseGitLfsPointer(Buffer.from(
      `version https://git-lfs.github.com/spec/v1\noid ${sha256(bytes)}\nsize ${bytes.length}\n`
    ));
    assert.deepEqual(verifyStreamedGitLfsObject({
      filePath,
      pointer,
      aggregateBudget: { maximumBytes: 8, consumedBytes: 1 },
      deadlineAt: Date.now() + 10_000,
      chunkBytes: 2
    }), {
      status: "VERIFIED",
      oidSha256: sha256(bytes),
      byteLength: bytes.length,
      aggregateConsumedBytes: 8
    });

    const symlinkPath = path.join(directory, "link.bin");
    fs.symlinkSync(filePath, symlinkPath);
    assert.throws(
      () => verifyStreamedGitLfsObject({ filePath: symlinkPath, pointer, deadlineAt: Date.now() + 10_000 }),
      (error) => error?.code === "LFS_MATERIALIZED_PATH_SYMLINK"
    );
    assert.throws(
      () => verifyStreamedGitLfsObject({
        filePath,
        pointer,
        aggregateBudget: { maximumBytes: 6, consumedBytes: 0 },
        deadlineAt: Date.now() + 10_000
      }),
      (error) => error?.code === "LFS_MATERIALIZED_AGGREGATE_LIMIT"
    );
    assert.throws(
      () => verifyStreamedGitLfsObject({ filePath, pointer, deadlineAt: Date.now() - 1 }),
      (error) => error?.code === "LFS_MATERIALIZED_DEADLINE"
    );

    const racedPath = path.join(directory, "raced.bin");
    const displacedPath = path.join(directory, "raced-original.bin");
    fs.writeFileSync(racedPath, bytes);
    let lstatCalls = 0;
    const raceFs = {
      ...fs,
      lstatSync(candidate, options) {
        lstatCalls += 1;
        if (candidate === racedPath && lstatCalls === 2) {
          fs.renameSync(racedPath, displacedPath);
          fs.writeFileSync(racedPath, bytes);
        }
        return fs.lstatSync(candidate, options);
      }
    };
    assert.throws(
      () => verifyStreamedGitLfsObject({ filePath: racedPath, pointer, deadlineAt: Date.now() + 10_000, fsApi: raceFs }),
      (error) => error?.code === "LFS_MATERIALIZED_IDENTITY_CHANGED"
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function sha256(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}
