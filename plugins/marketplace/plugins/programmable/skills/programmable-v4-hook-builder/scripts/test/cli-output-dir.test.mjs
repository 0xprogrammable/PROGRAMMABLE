import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CENTRAL_APPLICATION_FILES } from "../cli-central-package.mjs";
import { materializeCentralPackage } from "../cli-output-dir.mjs";
import { CliFailure } from "../cli-runtime.mjs";

test("materializes exactly six verified files through one atomic directory rename", () => {
  const fixture = createOutputFixture();
  try {
    const target = path.join(fixture.parent, "example-app");
    const result = materializeCentralPackage({
      outputDirectory: target,
      baseDirectory: fixture.base,
      applicationId: "example-app",
      centralPackage: makeCentralPackage()
    });

    assert.equal(result.directory, target);
    assert.equal(result.applicationId, "example-app");
    assert.equal(result.directoryNameMatchesApplicationId, true);
    assert.equal(result.atomicDirectoryRename, true);
    assert.equal(result.overwritten, false);
    assert.deepEqual(result.files.map(({ path: filePath }) => filePath), CENTRAL_APPLICATION_FILES);
    assert.deepEqual(fs.readdirSync(target).sort(), [...CENTRAL_APPLICATION_FILES].sort());
    if (process.platform !== "win32") {
      assert.equal(fs.statSync(target).mode & 0o777, 0o700);
    }
    for (const record of result.files) {
      const bytes = fs.readFileSync(path.join(target, record.path));
      assert.equal(bytes.length, record.byteLength);
      assert.equal(digest(bytes), record.sha256);
      assert.equal(fs.lstatSync(path.join(target, record.path)).isFile(), true);
      if (process.platform !== "win32") {
        assert.equal(fs.statSync(path.join(target, record.path)).mode & 0o777, 0o600);
      }
    }
    assert.deepEqual(temporaryEntries(fixture.parent), []);
  } finally {
    fixture.cleanup();
  }
});

test("never overwrites or merges an existing application directory or target symlink", () => {
  const fixture = createOutputFixture();
  try {
    const target = path.join(fixture.parent, "example-app");
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, "keep.txt"), "keep\n");
    rejectsCode(
      () => materializeCentralPackage({
        outputDirectory: target,
        baseDirectory: fixture.base,
        applicationId: "example-app",
        centralPackage: makeCentralPackage()
      }),
      "OUTPUT_TARGET_EXISTS"
    );
    assert.equal(fs.readFileSync(path.join(target, "keep.txt"), "utf8"), "keep\n");

    const linkedTarget = path.join(fixture.parent, "linked-app");
    fs.symlinkSync(target, linkedTarget);
    rejectsCode(
      () => materializeCentralPackage({
        outputDirectory: linkedTarget,
        baseDirectory: fixture.base,
        applicationId: "linked-app",
        centralPackage: makeCentralPackage()
      }),
      "OUTPUT_TARGET_EXISTS"
    );
    assert.equal(fs.lstatSync(linkedTarget).isSymbolicLink(), true);
    assert.deepEqual(temporaryEntries(fixture.parent), []);
  } finally {
    fixture.cleanup();
  }
});

test("rejects symbolic and non-directory parents", () => {
  const fixture = createOutputFixture();
  try {
    const realParent = path.join(fixture.root, "real-parent");
    const linkedParent = path.join(fixture.root, "linked-parent");
    fs.mkdirSync(realParent);
    fs.symlinkSync(realParent, linkedParent);
    rejectsCode(
      () => materializeCentralPackage({
        outputDirectory: path.join(linkedParent, "example-app"),
        baseDirectory: fixture.base,
        applicationId: "example-app",
        centralPackage: makeCentralPackage()
      }),
      "OUTPUT_PARENT_INVALID"
    );
    assert.deepEqual(fs.readdirSync(realParent), []);

    const fileParent = path.join(fixture.root, "parent-file");
    fs.writeFileSync(fileParent, "not a directory\n");
    rejectsCode(
      () => materializeCentralPackage({
        outputDirectory: path.join(fileParent, "example-app"),
        baseDirectory: fixture.base,
        applicationId: "example-app",
        centralPackage: makeCentralPackage()
      }),
      "OUTPUT_PARENT_INVALID"
    );
  } finally {
    fixture.cleanup();
  }
});

test("rejects traversal, Git-control, control-character, broad, and noncanonical output names", () => {
  const fixture = createOutputFixture();
  try {
    for (const outputDirectory of [
      "../escape",
      path.join(fixture.parent, ".git", "example-app"),
      path.join(fixture.parent, "Bad_Name"),
      path.join(fixture.parent, "different-app"),
      path.join(fixture.parent, "bad\nname"),
      path.parse(fixture.root).root,
      os.homedir(),
      path.join(fixture.base, "example-app")
    ]) {
      rejectsCode(
        () => materializeCentralPackage({
          outputDirectory,
          baseDirectory: fixture.base,
          applicationId: "example-app",
          centralPackage: makeCentralPackage()
        }),
        "OUTPUT_PATH_INVALID"
      );
    }
    assert.deepEqual(fs.readdirSync(fixture.parent), []);
  } finally {
    fixture.cleanup();
  }
});

test("rejects changed hashes and frozen filenames before creating temporary output", () => {
  const fixture = createOutputFixture();
  try {
    const badHash = makeCentralPackage();
    badHash.files[2].sha256 = `sha256:${"0".repeat(64)}`;
    rejectsCode(
      () => materializeCentralPackage({
        outputDirectory: path.join(fixture.parent, "example-app"),
        baseDirectory: fixture.base,
        applicationId: "example-app",
        centralPackage: badHash
      }),
      "OUTPUT_PACKAGE_INVALID"
    );

    const badName = makeCentralPackage();
    badName.files[1].path = "../outside.md";
    rejectsCode(
      () => materializeCentralPackage({
        outputDirectory: path.join(fixture.parent, "example-app"),
        baseDirectory: fixture.base,
        applicationId: "example-app",
        centralPackage: badName
      }),
      "OUTPUT_PACKAGE_INVALID"
    );
    assert.deepEqual(fs.readdirSync(fixture.parent), []);
  } finally {
    fixture.cleanup();
  }
});

test("cleans the temporary sibling after partial write failure", () => {
  const fixture = createOutputFixture();
  let writes = 0;
  try {
    const target = path.join(fixture.parent, "example-app");
    rejectsCode(
      () => materializeCentralPackage({
        outputDirectory: target,
        baseDirectory: fixture.base,
        applicationId: "example-app",
        centralPackage: makeCentralPackage(),
        writeFileImplementation(file, bytes, options) {
          writes += 1;
          assert.equal(options.flag, "wx");
          if (writes === 3) throw new Error("injected partial write failure");
          fs.writeFileSync(file, bytes, options);
        }
      }),
      "OUTPUT_WRITE_FAILED"
    );
    assert.equal(writes, 3);
    assert.equal(fs.existsSync(target), false);
    assert.deepEqual(fs.readdirSync(fixture.parent), []);
  } finally {
    fixture.cleanup();
  }
});

test("re-verifies materialized bytes and cleans corrupted temporary output", () => {
  const fixture = createOutputFixture();
  try {
    const target = path.join(fixture.parent, "example-app");
    rejectsCode(
      () => materializeCentralPackage({
        outputDirectory: target,
        baseDirectory: fixture.base,
        applicationId: "example-app",
        centralPackage: makeCentralPackage(),
        writeFileImplementation(file, bytes, options) {
          const written = path.basename(file) === "TEST_PLAN.md" ? Buffer.from("corrupted\n") : bytes;
          fs.writeFileSync(file, written, options);
        }
      }),
      "OUTPUT_WRITE_FAILED"
    );
    assert.equal(fs.existsSync(target), false);
    assert.deepEqual(fs.readdirSync(fixture.parent), []);
  } finally {
    fixture.cleanup();
  }
});

test("replace-existing swaps only an exact prior six-file package", () => {
  const fixture = createOutputFixture();
  const prior = makeCentralPackage("prior");
  const next = makeCentralPackage("next");
  try {
    const target = path.join(fixture.parent, "example-app");
    writePackage(target, prior);
    const result = materializeCentralPackage({
      outputDirectory: target,
      baseDirectory: fixture.base,
      applicationId: "example-app",
      centralPackage: next,
      replaceExisting: true,
      priorCentralPackage: prior,
      centralBaseCommit: "a".repeat(40)
    });

    assert.equal(result.replacedExisting, true);
    assert.equal(result.overwritten, true);
    assert.equal(result.atomicDirectoryRename, false);
    assert.equal(result.atomicRenameSteps, true);
    assert.equal(result.wholeSwapAtomic, false);
    assert.equal(result.rollbackCapable, true);
    assert.equal(result.centralBaseCommit, "a".repeat(40));
    for (const record of next.files) {
      assert.equal(fs.readFileSync(path.join(target, record.path), "utf8"), record.content);
    }
    assert.deepEqual(fs.readdirSync(fixture.parent), ["example-app"]);
  } finally {
    fixture.cleanup();
  }
});

test("replace-existing rejects stale, extra, symbolic and hard-linked local prior content", () => {
  for (const mutate of [
    (target) => fs.appendFileSync(path.join(target, "PROPOSAL.md"), "stale\n"),
    (target) => fs.writeFileSync(path.join(target, "extra.txt"), "extra\n"),
    (target) => {
      fs.unlinkSync(path.join(target, "PROPOSAL.md"));
      fs.symlinkSync("TEST_PLAN.md", path.join(target, "PROPOSAL.md"));
    },
    (target) => {
      const outside = path.join(path.dirname(target), "outside.txt");
      fs.writeFileSync(outside, "hard-linked bytes\n");
      fs.unlinkSync(path.join(target, "PROPOSAL.md"));
      fs.linkSync(outside, path.join(target, "PROPOSAL.md"));
    }
  ]) {
    const fixture = createOutputFixture();
    const prior = makeCentralPackage("prior");
    try {
      const target = path.join(fixture.parent, "example-app");
      writePackage(target, prior);
      mutate(target);
      rejectsCode(
        () => materializeCentralPackage({
          outputDirectory: target,
          baseDirectory: fixture.base,
          applicationId: "example-app",
          centralPackage: makeCentralPackage("next"),
          replaceExisting: true,
          priorCentralPackage: prior,
          centralBaseCommit: "a".repeat(40)
        }),
        "OUTPUT_WRITE_FAILED"
      );
      assert.deepEqual(temporaryEntries(fixture.parent), []);
    } finally {
      fixture.cleanup();
    }
  }
});

test("replace-existing restores the verified prior package when installing next fails", () => {
  const fixture = createOutputFixture();
  const prior = makeCentralPackage("prior");
  const next = makeCentralPackage("next");
  let renames = 0;
  try {
    const target = path.join(fixture.parent, "example-app");
    writePackage(target, prior);
    rejectsCode(
      () => materializeCentralPackage({
        outputDirectory: target,
        baseDirectory: fixture.base,
        applicationId: "example-app",
        centralPackage: next,
        replaceExisting: true,
        priorCentralPackage: prior,
        centralBaseCommit: "a".repeat(40),
        renameImplementation(from, to) {
          renames += 1;
          if (renames === 2) throw new Error("injected next install failure");
          fs.renameSync(from, to);
        }
      }),
      "OUTPUT_WRITE_FAILED"
    );
    assert.equal(renames, 3);
    for (const record of prior.files) {
      assert.equal(fs.readFileSync(path.join(target, record.path), "utf8"), record.content);
    }
    assert.deepEqual(fs.readdirSync(fixture.parent), ["example-app"]);
  } finally {
    fixture.cleanup();
  }
});

test("replace-existing requires both an existing exact target and immutable prior identity", () => {
  const fixture = createOutputFixture();
  try {
    rejectsCode(
      () => materializeCentralPackage({
        outputDirectory: path.join(fixture.parent, "example-app"),
        baseDirectory: fixture.base,
        applicationId: "example-app",
        centralPackage: makeCentralPackage("next"),
        replaceExisting: true,
        priorCentralPackage: makeCentralPackage("prior"),
        centralBaseCommit: "a".repeat(40)
      }),
      "OUTPUT_REPLACE_TARGET_MISSING"
    );
  } finally {
    fixture.cleanup();
  }
});

function makeCentralPackage(label = "content") {
  const files = CENTRAL_APPLICATION_FILES.map((filePath) => {
    const content = `${filePath} ${label}\n`;
    const bytes = Buffer.from(content, "utf8");
    return {
      path: filePath,
      content,
      byteLength: bytes.length,
      sha256: digest(bytes)
    };
  });
  return {
    generated: true,
    encoding: "utf8",
    fileCount: files.length,
    fileOrder: [...CENTRAL_APPLICATION_FILES],
    files
  };
}

function writePackage(target, centralPackage) {
  fs.mkdirSync(target, { mode: 0o700 });
  for (const record of centralPackage.files) {
    fs.writeFileSync(path.join(target, record.path), record.content, { mode: 0o600 });
  }
}

function createOutputFixture() {
  const lexicalRoot = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-output-dir-"));
  const root = fs.realpathSync(lexicalRoot);
  const base = path.join(root, "source-repository");
  const parent = path.join(root, "central-submissions");
  fs.mkdirSync(base);
  fs.mkdirSync(parent);
  return {
    root,
    base,
    parent,
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    }
  };
}

function temporaryEntries(parent) {
  return fs.readdirSync(parent).filter((name) => (
    name.startsWith(".") && (name.includes(".tmp-") || name.includes(".replace-"))
  ));
}

function rejectsCode(operation, code) {
  assert.throws(operation, (error) => {
    assert.ok(error instanceof CliFailure, error?.stack ?? String(error));
    assert.equal(error.code, code);
    return true;
  });
}

function digest(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}
