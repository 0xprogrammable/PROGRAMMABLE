import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
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

test("the raw lib symlink is ignored but rejected as verification evidence", () => {
  assert.equal(execFileSync("git", ["check-ignore", "lib"], { cwd: root, encoding: "utf8" }).trim(), "lib");
  const result = spawnSync(process.execPath, ["scripts/verify-hookemon-v2-dependencies.mjs"], {
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
