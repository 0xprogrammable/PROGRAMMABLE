#!/usr/bin/env node

import { readFile, realpath } from "node:fs/promises";
import { dirname, extname, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

const FORBIDDEN_SPECIFIERS = new Set([
  "child_process", "fs", "fs/promises", "net", "node:child_process",
  "node:fs", "node:fs/promises", "node:net", "node:tar", "pg", "postgres",
  "tar", "tar-fs", "tar-stream",
]);
const FORBIDDEN_PATH = /(?:^|[/\\])(?:compiler|runner)(?:[/\\]|\.|$)/iu;

export async function verifyManualApplicantPortableImportClosure(input) {
  const root = await realpath(input.root);
  const entry = await realpath(resolve(root, input.entry));
  if (!entry.startsWith(`${root}/`)) {
    throw new Error("portable verifier entry escapes the repository root");
  }
  const closure = await sourceClosure(root, entry);
  const bundled = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    metafile: true,
    platform: "node",
    format: "esm",
    target: "node24",
    logLevel: "silent",
    external: ["server-only"],
  });
  const bundleInputs = Object.keys(bundled.metafile.inputs).sort();
  for (const path of bundleInputs) assertPathAllowed(path);
  for (const output of Object.values(bundled.metafile.outputs)) {
    for (const imported of output.imports) {
      assertSpecifierAllowed(imported.path);
    }
  }
  return Object.freeze({
    entry: relative(root, entry),
    sourceClosure: Object.freeze([...closure].map((path) => relative(root, path)).sort()),
    bundleInputs: Object.freeze(bundleInputs),
  });
}

async function sourceClosure(root, entry) {
  const seen = new Set();
  const pending = [entry];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || seen.has(current)) continue;
    seen.add(current);
    assertPathAllowed(relative(root, current));
    const source = await readFile(current, "utf8");
    const imports = importSpecifiers(source);
    for (const specifier of imports) {
      assertSpecifierAllowed(specifier);
      const resolved = await resolveWorkspaceImport(root, current, specifier);
      if (resolved) pending.push(resolved);
    }
    if (/\bimport\s*\(\s*(?!["'])/u.test(source)) {
      throw new Error(
        `portable verifier has a non-literal dynamic import: ${relative(root, current)}`,
      );
    }
  }
  return seen;
}

function importSpecifiers(source) {
  const values = [];
  const pattern = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)["']([^"']+)["']/gu;
  for (const match of source.matchAll(pattern)) {
    if (match[1]) values.push(match[1]);
  }
  return values;
}

async function resolveWorkspaceImport(root, current, specifier) {
  let candidate;
  if (specifier.startsWith("@/")) candidate = resolve(root, specifier.slice(2));
  else if (specifier.startsWith(".")) candidate = resolve(dirname(current), specifier);
  else return null;
  const extensions = extname(candidate)
    ? [""]
    : [".ts", ".tsx", ".js", ".mjs", "/index.ts", "/index.tsx"];
  for (const extension of extensions) {
    try {
      const path = await realpath(`${candidate}${extension}`);
      if (!path.startsWith(`${root}/`)) {
        throw new Error("portable verifier import escapes the repository root");
      }
      return path;
    } catch (error) {
      if (
        error instanceof Error
        && !error.message.includes("ENOENT")
        && !("code" in error && error.code === "ENOENT")
      ) throw error;
    }
  }
  throw new Error(`portable verifier workspace import is unresolved: ${specifier}`);
}

function assertSpecifierAllowed(specifier) {
  const normalized = specifier.replace(/^node:/u, "node:");
  if (
    FORBIDDEN_SPECIFIERS.has(normalized)
    || [...FORBIDDEN_SPECIFIERS].some((forbidden) =>
      normalized.startsWith(`${forbidden}/`))
  ) throw new Error(`portable verifier imports forbidden dependency: ${specifier}`);
}

function assertPathAllowed(path) {
  const normalized = path.replaceAll("\\", "/");
  if (
    FORBIDDEN_PATH.test(normalized)
    || /node_modules[/](?:pg|postgres|tar|tar-fs|tar-stream)(?:[/]|$)/u
      .test(normalized)
  ) throw new Error(`portable verifier bundles forbidden path: ${path}`);
}

async function main(argv) {
  const entryIndex = argv.indexOf("--entry");
  if (entryIndex < 0 || !argv[entryIndex + 1]) {
    throw new Error("--entry is required");
  }
  const result = await verifyManualApplicantPortableImportClosure({
    root: process.cwd(),
    entry: argv[entryIndex + 1],
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "portable import verification failed"}\n`,
    );
    process.exitCode = 1;
  });
}
