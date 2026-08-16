import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import zlib from "node:zlib";
import { computeRawGitObjectId, verifyRawGitCommitTreeIntegrity } from "../raw-git-integrity-core.mjs";

test("raw integrity verifier recomputes the commit, root tree, and every recursive tree object", (t) => {
  const fixture = createRepository(t);
  const report = verifyRawGitCommitTreeIntegrity({
    repositoryRoot: fixture.root,
    revisionObjectId: fixture.commit,
    treeObjectId: fixture.tree
  });

  assert.equal(report.commitObjectVerified, true);
  assert.equal(report.treeObjectsVerified, 2);
  assert.deepEqual(report.entries.map(({ path: repositoryPath, mode, type }) => ({ path: repositoryPath, mode, type })), [
    { path: "README.md", mode: "100644", type: "blob" },
    { path: "src/a.txt", mode: "100644", type: "blob" },
    { path: "src/link.txt", mode: "120000", type: "blob" }
  ]);
});

for (const corruption of [
  { name: "commit", objectType: "commit", select: (fixture) => fixture.commit },
  { name: "root tree", objectType: "tree", select: (fixture) => fixture.tree },
  { name: "recursive tree", objectType: "tree", select: (fixture) => fixture.srcTree }
]) {
  test(`raw integrity verifier rejects a corrupt loose ${corruption.name} substitution`, (t) => {
    const fixture = createRepository(t);
    const objectId = corruption.select(fixture);
    const loose = readLooseObject(fixture.objects, objectId);
    const substituted = Buffer.from(loose.bytes);
    substituted[substituted.length - 1] = substituted[substituted.length - 1] === 0x7a ? 0x79 : 0x7a;
    overwriteObject(fixture.objects, objectId, corruption.objectType, substituted);

    assert.throws(
      () => verifyRawGitCommitTreeIntegrity({
        repositoryRoot: fixture.root,
        revisionObjectId: fixture.commit,
        treeObjectId: fixture.tree
      }),
      (error) => (
        error?.code === "RAW_GIT_OBJECT_HASH_MISMATCH"
        && error?.objectType === corruption.objectType
        && error?.objectId === objectId
      )
    );
  });
}

test("raw integrity verifier rejects a corrupt alternate tree substitution", (t) => {
  const fixture = createRepository(t);
  const alternate = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-git-alternate-"));
  t.after(() => fs.rmSync(alternate, { recursive: true, force: true }));
  const original = readLooseObject(fixture.objects, fixture.srcTree);
  const substituted = Buffer.from(original.bytes);
  substituted[substituted.length - 1] = substituted[substituted.length - 1] === 0x78 ? 0x79 : 0x78;
  overwriteObject(alternate, fixture.srcTree, "tree", substituted);
  fs.unlinkSync(objectPath(fixture.objects, fixture.srcTree));
  fs.mkdirSync(path.join(fixture.objects, "info"), { recursive: true });
  fs.writeFileSync(path.join(fixture.objects, "info", "alternates"), `${alternate}\n`);

  assert.throws(
    () => verifyRawGitCommitTreeIntegrity({
      repositoryRoot: fixture.root,
      revisionObjectId: fixture.commit,
      treeObjectId: fixture.tree
    }),
    (error) => (
      error?.code === "RAW_GIT_OBJECT_HASH_MISMATCH"
      && error?.objectType === "tree"
      && error?.objectId === fixture.srcTree
    )
  );
});

test("raw integrity verifier distinguishes an unavailable object from corrupt object bytes", (t) => {
  const fixture = createRepository(t);
  fs.unlinkSync(objectPath(fixture.objects, fixture.commit));
  assert.throws(
    () => verifyRawGitCommitTreeIntegrity({
      repositoryRoot: fixture.root,
      revisionObjectId: fixture.commit,
      treeObjectId: fixture.tree
    }),
    (error) => (
      error?.code === "RAW_GIT_OBJECT_MISSING"
      && error?.objectType === "commit"
      && error?.objectId === fixture.commit
    )
  );
});

test("raw integrity verifier enforces one aggregate byte budget and global deadline", (t) => {
  const fixture = createRepository(t);
  assert.throws(
    () => verifyRawGitCommitTreeIntegrity({
      repositoryRoot: fixture.root,
      revisionObjectId: fixture.commit,
      treeObjectId: fixture.tree,
      limits: { maxTotalObjectBytes: 1 }
    }),
    (error) => error?.code === "RAW_GIT_RESOURCE_LIMIT"
  );
  assert.throws(
    () => verifyRawGitCommitTreeIntegrity({
      repositoryRoot: fixture.root,
      revisionObjectId: fixture.commit,
      treeObjectId: fixture.tree,
      deadlineAt: Date.now() - 1
    }),
    (error) => error?.code === "RAW_GIT_DEADLINE"
  );
});

test("raw integrity verifier rejects a commit with more than one tree header", (t) => {
  const fixture = createRepository(t);
  const malformed = Buffer.from([
    `tree ${fixture.tree}`,
    `tree ${fixture.srcTree}`,
    "author Raw Integrity Test <raw-integrity@example.invalid> 0 +0000",
    "committer Raw Integrity Test <raw-integrity@example.invalid> 0 +0000",
    "",
    "duplicate tree header",
    ""
  ].join("\n"), "utf8");
  const malformedCommit = computeRawGitObjectId("commit", malformed);
  overwriteObject(fixture.objects, malformedCommit, "commit", malformed);

  assert.throws(
    () => verifyRawGitCommitTreeIntegrity({
      repositoryRoot: fixture.root,
      revisionObjectId: malformedCommit,
      treeObjectId: fixture.tree
    }),
    (error) => error?.code === "RAW_GIT_COMMIT_PROTOCOL"
  );
});

function createRepository(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-raw-integrity-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  runGit(root, ["init", "--quiet", "--initial-branch=main"]);
  runGit(root, ["config", "user.name", "Raw Integrity Test"]);
  runGit(root, ["config", "user.email", "raw-integrity@example.invalid"]);
  fs.writeFileSync(path.join(root, "README.md"), "root\n");
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src", "a.txt"), "source\n");
  fs.symlinkSync("a.txt", path.join(root, "src", "link.txt"));
  runGit(root, ["add", "--", "."]);
  runGit(root, ["commit", "--quiet", "-m", "raw integrity fixture"]);
  const commit = runGit(root, ["rev-parse", "HEAD"]).trim();
  const tree = runGit(root, ["rev-parse", "HEAD^{tree}"]).trim();
  const srcTree = runGit(root, ["rev-parse", "HEAD:src"]).trim();
  return { root, commit, tree, srcTree, objects: path.join(root, ".git", "objects") };
}

function readLooseObject(objectsDirectory, objectId) {
  const raw = zlib.inflateSync(fs.readFileSync(objectPath(objectsDirectory, objectId)));
  const nul = raw.indexOf(0);
  assert.ok(nul > 0);
  const header = raw.subarray(0, nul).toString("ascii");
  const match = /^(commit|tree|blob) ([0-9]+)$/u.exec(header);
  assert.ok(match, header);
  const bytes = raw.subarray(nul + 1);
  assert.equal(bytes.length, Number(match[2]));
  return { type: match[1], bytes };
}

function overwriteObject(objectsDirectory, objectId, type, bytes) {
  const destination = objectPath(objectsDirectory, objectId);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (fs.existsSync(destination)) fs.chmodSync(destination, 0o600);
  fs.writeFileSync(
    destination,
    zlib.deflateSync(Buffer.concat([Buffer.from(`${type} ${bytes.length}\0`, "ascii"), bytes]))
  );
}

function objectPath(objectsDirectory, objectId) {
  return path.join(objectsDirectory, objectId.slice(0, 2), objectId.slice(2));
}

function runGit(repositoryRoot, argumentsList) {
  return childProcess.execFileSync("git", ["-C", repositoryRoot, ...argumentsList], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}
