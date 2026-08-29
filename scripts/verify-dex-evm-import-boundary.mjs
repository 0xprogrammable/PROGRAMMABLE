#!/usr/bin/env node

import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const packageRoot = path.join(repositoryRoot, "packages", "dex-evm");
const productionRoot = path.join(packageRoot, "src");
const forgeStdRoot = path.join(repositoryRoot, "contracts", "lib", "forge-std", "src");
const expectedRemapping = "forge-std/=../../contracts/lib/forge-std/src/";

const forbiddenImportPatterns = [
  [/(?:^|\/)@?uniswap(?:\/|$)/i, "Uniswap"],
  [/(?:^|[/_.-])poolmanager(?:[/_.-]|$)/i, "PoolManager"],
  [/(?:^|[/_.-])v4-core(?:[/_.-]|$)/i, "Uniswap v4 Core"],
  [/(?:^|[/_.-])v4-periphery(?:[/_.-]|$)/i, "Uniswap v4 periphery"],
  [/(?:^|[/_.-])periphery(?:[/_.-]|$)/i, "periphery"],
  [/(?:^|[/_.-])permit2(?:[/_.-]|$)/i, "Permit2"],
  [/(?:^|[/_.-])openzeppelin-uniswap-hooks(?:[/_.-]|$)/i, "OpenZeppelin Uniswap hooks"],
  [/(?:^|[/_.-])liquidity-launcher(?:[/_.-]|$)/i, "legacy liquidity launcher"],
  [/(?:^|[/_.-])continuous-clearing-auction(?:[/_.-]|$)/i, "legacy clearing auction"],
  [/(?:^|[/_.-])blocknumberish(?:[/_.-]|$)/i, "legacy block-number adapter"],
  [/(?:^|[/_.-])uerc20-factory(?:[/_.-]|$)/i, "legacy token factory"],
  [/(?:^|[/_.-])programmable-src(?:[/_.-]|$)/i, "legacy PROGRAMMABLE source alias"]
];

function isWithin(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function toPosix(candidate) {
  return candidate.split(path.sep).join("/");
}

function stripComments(source) {
  let result = "";
  let state = "code";

  for (let index = 0; index < source.length; index += 1) {
    const current = source[index];
    const next = source[index + 1];

    if (state === "line-comment") {
      if (current === "\n") {
        result += current;
        state = "code";
      } else {
        result += " ";
      }
      continue;
    }

    if (state === "block-comment") {
      if (current === "*" && next === "/") {
        result += "  ";
        index += 1;
        state = "code";
      } else {
        result += current === "\n" ? "\n" : " ";
      }
      continue;
    }

    if (state === "single-quoted" || state === "double-quoted") {
      result += current;
      if (current === "\\" && next !== undefined) {
        result += next;
        index += 1;
      } else if ((state === "single-quoted" && current === "'") || (state === "double-quoted" && current === '"')) {
        state = "code";
      }
      continue;
    }

    if (current === "/" && next === "/") {
      result += "  ";
      index += 1;
      state = "line-comment";
    } else if (current === "/" && next === "*") {
      result += "  ";
      index += 1;
      state = "block-comment";
    } else {
      result += current;
      if (current === "'") state = "single-quoted";
      if (current === '"') state = "double-quoted";
    }
  }

  if (state === "block-comment") throw new Error("Unterminated block comment");
  return result;
}

function parseImports(source, relativeFile) {
  const stripped = stripComments(source);
  const importKeywordCount = [...stripped.matchAll(/\bimport\b/g)].length;
  const imports = [];
  const importPattern = /\bimport\s+(?:(?:[^;"']*?\s+from\s+)?["']([^"']+)["'])\s*;/gs;

  for (const match of stripped.matchAll(importPattern)) imports.push(match[1]);
  if (imports.length !== importKeywordCount) {
    throw new Error(`${relativeFile}: could not parse every Solidity import declaration`);
  }
  return imports;
}

async function walkSolidityFiles(root) {
  const files = [];
  const rootInfo = await lstat(root).catch(() => null);
  if (rootInfo === null) return files;
  if (!rootInfo.isDirectory()) throw new Error(`Expected a Solidity source directory: ${root}`);

  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Symbolic links are forbidden in the Solidity closure: ${absolute}`);
      if (entry.isDirectory()) await visit(absolute);
      if (entry.isFile() && entry.name.endsWith(".sol")) files.push(absolute);
    }
  }

  await visit(root);
  return files.sort();
}

async function requireOrdinaryFile(absolute, importingFile) {
  const info = await lstat(absolute).catch(() => null);
  if (!info?.isFile()) throw new Error(`${importingFile}: import target is not an ordinary file: ${absolute}`);
  const canonical = await realpath(absolute);
  return canonical;
}

async function verifyImport(importingFile, specifier) {
  const importingRelative = toPosix(path.relative(packageRoot, importingFile));
  for (const [pattern, label] of forbiddenImportPatterns) {
    if (pattern.test(specifier)) throw new Error(`${importingRelative}: forbidden ${label} import: ${specifier}`);
  }

  if (specifier.startsWith("forge-std/")) {
    if (importingRelative.startsWith("src/")) {
      throw new Error(`${importingRelative}: production source must not import forge-std: ${specifier}`);
    }
    const suffix = specifier.slice("forge-std/".length);
    if (!suffix || path.isAbsolute(suffix)) throw new Error(`${importingRelative}: malformed forge-std import: ${specifier}`);
    const resolved = path.resolve(forgeStdRoot, suffix);
    if (!isWithin(resolved, forgeStdRoot)) throw new Error(`${importingRelative}: forge-std import escapes its pin: ${specifier}`);
    const canonical = await requireOrdinaryFile(resolved, importingRelative);
    const canonicalForgeStdRoot = await realpath(forgeStdRoot);
    if (!isWithin(canonical, canonicalForgeStdRoot)) {
      throw new Error(`${importingRelative}: forge-std import resolves outside its exact pin: ${specifier}`);
    }
    return null;
  }

  if (!specifier.startsWith(".")) {
    throw new Error(`${importingRelative}: undeclared non-relative import: ${specifier}`);
  }
  if (!specifier.endsWith(".sol")) throw new Error(`${importingRelative}: Solidity imports must name an exact .sol file: ${specifier}`);

  const resolved = path.resolve(path.dirname(importingFile), specifier);
  if (!isWithin(resolved, packageRoot)) throw new Error(`${importingRelative}: import escapes packages/dex-evm: ${specifier}`);
  const canonical = await requireOrdinaryFile(resolved, importingRelative);
  const canonicalPackageRoot = await realpath(packageRoot);
  if (!isWithin(canonical, canonicalPackageRoot)) {
    throw new Error(`${importingRelative}: import resolves through a path escape: ${specifier}`);
  }
  if (importingRelative.startsWith("src/") && !isWithin(canonical, productionRoot)) {
    throw new Error(`${importingRelative}: production import escapes packages/dex-evm/src: ${specifier}`);
  }
  return canonical;
}

async function main() {
  const remappingsPath = path.join(packageRoot, "remappings.txt");
  const remappings = (await readFile(remappingsPath, "utf8"))
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  if (remappings.length !== 1 || remappings[0] !== expectedRemapping) {
    throw new Error(`remappings.txt must contain only ${expectedRemapping}`);
  }

  const foundryConfig = await readFile(path.join(packageRoot, "foundry.toml"), "utf8");
  if (!/^auto_detect_remappings\s*=\s*false\s*$/mu.test(foundryConfig)) {
    throw new Error("foundry.toml must disable automatic remapping detection");
  }
  if (!/^libs\s*=\s*\[\s*"\.\.\/\.\.\/contracts\/lib\/forge-std"\s*\]\s*$/mu.test(foundryConfig)) {
    throw new Error("foundry.toml must expose only the exact pinned forge-std test library path");
  }
  for (const [pattern, label] of forbiddenImportPatterns) {
    if (pattern.test(foundryConfig)) throw new Error(`foundry.toml exposes forbidden ${label} material`);
  }

  const solidityRoots = ["src", "test", "script"]
    .map((entry) => path.join(packageRoot, entry));
  const rootFiles = (await Promise.all(solidityRoots.map((root) => walkSolidityFiles(root)))).flat().sort();
  if (rootFiles.length === 0) throw new Error("packages/dex-evm contains no Solidity files");

  let importCount = 0;
  const queue = [...rootFiles];
  const visited = new Set();
  while (queue.length > 0) {
    const file = queue.shift();
    if (file === undefined || visited.has(file)) continue;
    visited.add(file);
    const relativeFile = toPosix(path.relative(packageRoot, file));
    const imports = parseImports(await readFile(file, "utf8"), relativeFile);
    importCount += imports.length;
    for (const specifier of imports) {
      const resolved = await verifyImport(file, specifier);
      if (resolved !== null && !visited.has(resolved)) queue.push(resolved);
    }
  }

  process.stdout.write(`DEX EVM import boundary verified: ${visited.size} Solidity files in the recursive closure, ${importCount} imports, one exact forge-std test remapping.\n`);
}

main().catch((error) => {
  process.stderr.write(`DEX EVM import boundary failed: ${error.message}\n`);
  process.exitCode = 1;
});
