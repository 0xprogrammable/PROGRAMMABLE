#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { lstat } from "node:fs/promises";
import path from "node:path";
import { readDependencyLock } from "./hookemon-v2-dependencies-core.mjs";

const root = process.cwd();
const target = path.resolve(process.argv[2] ?? path.join(root, "lib"));
const targetStat = await lstat(target);
if (targetStat.isSymbolicLink() || !targetStat.isDirectory()) {
  throw new Error(`dependency root must be a real directory, never a symlink: ${target}`);
}
const { lock } = await readDependencyLock(root);
const exact = (args) => execFileSync("git", args, { encoding: "utf8" }).trim();
for (const dependency of lock.dependencies) {
  const directory = path.join(target, dependency.directory);
  if (
    exact(["-C", directory, "rev-parse", "HEAD"]) !== dependency.commit
      || exact(["-C", directory, "rev-parse", "HEAD^{tree}"]) !== dependency.tree
      || exact(["-C", directory, "remote", "get-url", "origin"]) !== dependency.repository
      || exact(["-C", directory, "status", "--porcelain"]) !== ""
  ) throw new Error(`dependency pin mismatch or dirty tree: ${dependency.directory}`);
}
process.stdout.write(`Hookemon V2 dependencies verified: ${lock.dependencies.length} exact clean Git pins\n`);
