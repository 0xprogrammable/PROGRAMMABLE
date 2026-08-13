#!/usr/bin/env node

import { readdir, readFile, stat } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";
import process from "node:process";

const rootArgumentIndex = process.argv.indexOf("--root");
const includeBuild = process.argv.includes("--include-build");
const repositoryRoot = resolve(
  rootArgumentIndex === -1 ? process.cwd() : process.argv[rootArgumentIndex + 1],
);

const SOURCE_ROOTS = Object.freeze([
  ".github/workflows",
  "app",
  "components",
  "config",
  "docs",
  "indexer",
  "lib",
  "ops",
  "scripts",
  "supabase",
]);
const PACKAGE_FILES = Object.freeze([
  "package.json",
  "package-lock.json",
  "next.config.ts",
  "vercel.json",
  ".env.example",
]);
const BUILD_ROOTS = Object.freeze([".next/server", ".next/static"]);
const TEXT_EXTENSIONS = new Set([
  ".css",
  ".graphql",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".map",
  ".mts",
  ".sql",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml",
]);
const SELF_PATH = "scripts/verify-candidate-neutral-production.mjs";
const TEST_PATH = "scripts/test/verify-candidate-neutral-production.test.mjs";

const projectNames = Object.freeze([
  ["hook", "emon"].join(""),
  ["sh", "ards"].join(""),
  ["random", "holder", "rewards"].join("[-_ ]?"),
]);
const forbiddenContent = Object.freeze([
  ...projectNames.map((name) => new RegExp(name, "iu")),
  new RegExp(["submit-launch", "pull", "13"].join("[/# ]+"), "iu"),
  /manual[-_ ]?router/iu,
  /manual[-_ ]?applicant[-_ ]?launch/iu,
  /router[-_ ]?v2[-_ ]?shared[-_ ]?lifecycle/iu,
]);
const forbiddenPath = Object.freeze([
  ...projectNames.map((name) => new RegExp(name, "iu")),
  /manual[-_]?router/iu,
  /manual[-_]?applicant[-_]?launch/iu,
  /router[-_]?v2[-_]?shared[-_]?lifecycle/iu,
]);

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return false;
    throw error;
  }
}

async function collectFiles(path) {
  if (!(await exists(path))) return [];
  const entryStat = await stat(path);
  if (entryStat.isFile()) return [path];
  const entries = await readdir(path, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    if (entry.name === "node_modules" || entry.name === ".next") return [];
    return collectFiles(resolve(path, entry.name));
  }));
  return nested.flat();
}

const discovered = (
  await Promise.all([
    ...SOURCE_ROOTS.map((path) => collectFiles(resolve(repositoryRoot, path))),
    ...(includeBuild
      ? BUILD_ROOTS.map((path) => collectFiles(resolve(repositoryRoot, path)))
      : []),
    ...PACKAGE_FILES.map((path) => collectFiles(resolve(repositoryRoot, path))),
  ])
).flat();
const failures = [];

for (const absolutePath of discovered) {
  const repositoryPath = relative(repositoryRoot, absolutePath).replaceAll("\\", "/");
  if (repositoryPath === SELF_PATH || repositoryPath === TEST_PATH) continue;
  if (!TEXT_EXTENSIONS.has(extname(repositoryPath)) && !PACKAGE_FILES.includes(repositoryPath)) {
    continue;
  }
  if (forbiddenPath.some((pattern) => pattern.test(repositoryPath))) {
    failures.push(`${repositoryPath}: forbidden candidate or legacy route path`);
    continue;
  }
  const source = await readFile(absolutePath, "utf8");
  const matchedPattern = forbiddenContent.find((pattern) => pattern.test(source));
  if (matchedPattern) {
    failures.push(`${repositoryPath}: forbidden candidate or legacy route content`);
  }
}

if (failures.length > 0) {
  process.stderr.write(`${failures.sort().join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("CANDIDATE_NEUTRAL_PRODUCTION_SOURCE_VALID\n");
}
