import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readDependencyLock } from "../hookemon-v2-dependencies-core.mjs";

const root = process.cwd();

test("dependency lock has twelve sorted exact Git commit and tree pins", async () => {
  const { lock } = await readDependencyLock(root);
  assert.equal(lock.dependencies.length, 12);
  assert.deepEqual(
    lock.dependencies.map((item) => item.directory),
    lock.dependencies.map((item) => item.directory).sort()
  );
});

test("the raw lib symlink is ignored but rejected as verification evidence", async () => {
  const ignoreLines = (await readFile(path.join(root, ".gitignore"), "utf8")).split(/\r?\n/u);
  assert.ok(ignoreLines.includes("/lib"));
  const parent = await mkdtemp(path.join(os.tmpdir(), "hookemon-v2-symlink-dependencies."));
  const real = path.join(parent, "real");
  const linked = path.join(parent, "lib");
  await mkdir(real);
  await symlink(real, linked);
  const result = spawnSync(process.execPath, ["scripts/verify-hookemon-v2-dependencies.mjs", linked], {
    cwd: root,
    encoding: "utf8"
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /real directory, never a symlink/u);
});

test("hydration refuses to overwrite any existing target", async () => {
  const existing = await mkdtemp(path.join(os.tmpdir(), "hookemon-v2-existing-dependencies."));
  const result = spawnSync(process.execPath, ["scripts/hydrate-hookemon-v2-dependencies.mjs", existing], {
    cwd: root,
    encoding: "utf8"
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /refusing to overwrite existing dependency target/u);
});
