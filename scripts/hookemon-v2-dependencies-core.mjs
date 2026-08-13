import { readFile } from "node:fs/promises";
import path from "node:path";

const GIT_OBJECT_ID = /^[0-9a-f]{40}$/u;
const DIRECTORY = /^[a-z0-9][a-z0-9-]*$/u;
const GITHUB_HTTPS = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.git$/u;

export async function readDependencyLock(root) {
  const lockPath = path.join(root, "dependencies/foundry-dependencies-v1.json");
  const lock = JSON.parse(await readFile(lockPath, "utf8"));
  if (lock.schemaVersion !== 1 || lock.activationAllowed !== false || lock.dependencies?.length !== 12) {
    throw new Error("invalid dependency lock envelope");
  }
  const directories = new Set();
  for (const dependency of lock.dependencies) {
    if (
      !DIRECTORY.test(dependency.directory) || directories.has(dependency.directory)
        || !GITHUB_HTTPS.test(dependency.repository) || !GIT_OBJECT_ID.test(dependency.commit)
        || !GIT_OBJECT_ID.test(dependency.tree)
    ) throw new Error(`invalid dependency lock entry: ${dependency.directory ?? "<missing>"}`);
    directories.add(dependency.directory);
  }
  const sorted = [...directories].sort();
  if (JSON.stringify(lock.dependencies.map((item) => item.directory)) !== JSON.stringify(sorted)) {
    throw new Error("dependency lock must be sorted by directory");
  }
  return { lock, lockPath };
}
