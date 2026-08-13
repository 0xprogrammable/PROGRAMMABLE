#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { lstat, mkdir } from "node:fs/promises";
import path from "node:path";
import { readDependencyLock } from "./hookemon-v2-dependencies-core.mjs";

const root = process.cwd();
const target = path.resolve(process.argv[2] ?? path.join(root, "lib"));
try {
  await lstat(target);
  throw new Error(`refusing to overwrite existing dependency target: ${target}`);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const { lock } = await readDependencyLock(root);
await mkdir(target, { recursive: false });
for (const dependency of lock.dependencies) {
  const directory = path.join(target, dependency.directory);
  execFileSync("git", ["init", "--quiet", directory], { stdio: "inherit" });
  execFileSync("git", ["-C", directory, "remote", "add", "origin", dependency.repository], { stdio: "inherit" });
  execFileSync("git", ["-C", directory, "fetch", "--quiet", "--depth=1", "origin", dependency.commit], { stdio: "inherit" });
  execFileSync("git", ["-C", directory, "checkout", "--quiet", "--detach", "FETCH_HEAD"], { stdio: "inherit" });
}
execFileSync(process.execPath, [path.join(root, "scripts/verify-hookemon-v2-dependencies.mjs"), target], {
  cwd: root,
  stdio: "inherit"
});
