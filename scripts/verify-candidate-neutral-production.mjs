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
  "contracts",
  "docs",
  "indexer",
  "lib",
  "ops",
  "public",
  "scripts",
  "supabase",
  "tests",
]);
const PACKAGE_FILES = Object.freeze([
  "package.json",
  "package-lock.json",
  "next.config.ts",
  "vercel.json",
  ".env.example",
  ".gitleaks.toml",
  "eslint.config.mjs",
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
  ".mdx",
  ".mjs",
  ".map",
  ".mts",
  ".py",
  ".rs",
  ".sh",
  ".sol",
  ".sql",
  ".svg",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
]);
const SELF_PATH = "scripts/verify-candidate-neutral-production.mjs";
const TEST_PATH = "scripts/test/verify-candidate-neutral-production.test.mjs";

const projectNames = Object.freeze([
  ["hook", "emon"].join(""),
  ["sh", "ards"].join(""),
  ["random", "holder", "rewards"].join("[-_ ]?"),
  ["jesse", "stahl"].join("[-_ ]?"),
]);
const applicantIdentityPatterns = Object.freeze([
  new RegExp(`(?:\\b${["a", "eon"].join("")}\\b|${["aeon", "framework"].join("")})`, "iu"),
  new RegExp(`(?:\\b${["based", "bid"].join("")}\\b|\\b${["based", "bid", "x"].join("")}\\b)`, "iu"),
]);
const applicantCardMarkers = Object.freeze([
  ["13253", "24453"].join(""),
  ["custom-registry-v1", "primary-contract"].join("-"),
  ["included-in", "partner-total"].join("-"),
  ["0x6a57bf3e092626be760d417986e6103c2", "0fdbc3e"].join(""),
  ["0x17e18c88bda9bfb73924cdc989c07b070", "7e72671"].join(""),
  ["0xf8aef69201621ad20fa256da595426b7e", "6192dba"].join(""),
  ["0xcc916e5200d2626edfd918dc219bc4296", "629e997"].join(""),
  ["0x7a814ecb2d2b8be2debb29481f25f06e", "976559eec41fa7c8d92e030ec69fc9ff"].join(""),
]);
const forbiddenContent = Object.freeze([
  ...projectNames.map((name) => new RegExp(name, "iu")),
  ...applicantIdentityPatterns,
  ...applicantCardMarkers.map((name) => new RegExp(name, "iu")),
  new RegExp(["submit-launch", "pull", "13"].join("[/# ]+"), "iu"),
  /manual[-_ ]?router/iu,
  /manual[-_ ]?applicant/iu,
  /router[-_ ]?v2[-_ ]?shared[-_ ]?lifecycle/iu,
]);
const forbiddenPath = Object.freeze([
  ...projectNames.map((name) => new RegExp(name, "iu")),
  ...applicantIdentityPatterns,
  ...applicantCardMarkers.map((name) => new RegExp(name, "iu")),
  /manual[-_]?router/iu,
  /manual[-_]?applicant/iu,
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
  if (forbiddenPath.some((pattern) => pattern.test(repositoryPath))) {
    failures.push(`${repositoryPath}: forbidden candidate or legacy route path`);
    continue;
  }
  if (!TEXT_EXTENSIONS.has(extname(repositoryPath)) && !PACKAGE_FILES.includes(repositoryPath)) {
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
