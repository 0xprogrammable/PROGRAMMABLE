#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";

import {
  buildUniswapHookRelease,
  inspectLiveHook,
  loadSoliditySourceClosure,
  validateHookReleaseManifest,
  writeUniswapHookRelease,
} from "./uniswap-hook-release-core.mjs";

const HELP = `Prepare local Uniswap v4 Hooklist and routing-review artifacts.

Usage:
  node scripts/prepare-uniswap-hook-release.mjs \\
    --manifest <verified-mainnet-release.json> \\
    --metadata <reviewed-hook-metadata.json> \\
    --rpc-url <ethereum-rpc-url> \\
    --output <new-local-directory>

Required metadata fields:
  name
  description
  auditUrl
  sourcePath
  properties.dynamicFee
  properties.requiresCustomSwapData
  properties.vanillaSwap
  properties.swapAccess

ETHEREUM_RPC_URL may be used instead of --rpc-url.

This command performs read-only Mainnet checks and writes local files. It does not submit
an issue, open a pull request, call the routing form, or change any external account.
`;

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }
    if (!argument.startsWith("--")) {
      throw new Error(`Unexpected argument: ${argument}`);
    }
    const name = argument.slice(2);
    if (!["manifest", "metadata", "rpc-url", "output"].includes(name)) {
      throw new Error(`Unknown option: ${argument}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${argument} requires a value`);
    }
    if (name in options) throw new Error(`${argument} was provided twice`);
    options[name] = value;
    index += 1;
  }
  return options;
}

async function readJson(file, label) {
  let value;
  try {
    value = await readFile(file, "utf8");
  } catch (error) {
    throw new Error(`${label} could not be read: ${error.message}`);
  }
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(HELP);
    return;
  }

  for (const name of ["manifest", "metadata", "output"]) {
    if (!options[name]) throw new Error(`--${name} is required`);
  }
  const rpcUrl = options["rpc-url"] ?? process.env.ETHEREUM_RPC_URL;
  if (!rpcUrl) {
    throw new Error("--rpc-url or ETHEREUM_RPC_URL is required");
  }

  const root = process.cwd();
  const manifestPath = path.resolve(root, options.manifest);
  const manifest = await readJson(manifestPath, "Release manifest");

  // Fail before metadata or RPC access when the deployment itself is not
  // release eligible. Deep V1 therefore remains historical canary evidence.
  const release = validateHookReleaseManifest(manifest, manifestPath);

  const metadataPath = path.resolve(root, options.metadata);
  const metadata = await readJson(metadataPath, "Hook metadata");
  const sourcePath = path.resolve(root, metadata.sourcePath ?? "");
  let sourceClosure;
  try {
    sourceClosure = await loadSoliditySourceClosure({
      entryPath: sourcePath,
      contractsRoot: path.join(root, "contracts"),
    });
  } catch (error) {
    throw new Error(
      `Verified hook source closure could not be read: ${error.message}`,
    );
  }
  metadata.sourcePath = path.relative(root, sourcePath).replaceAll("\\", "/");

  const runtimeEvidence = await inspectLiveHook({
    rpcUrl,
    expectedChainId: 1,
    hookAddress: release.hookAddress,
    expectedRuntimeCodeHash: release.runtimeCodeHash,
  });
  const artifacts = buildUniswapHookRelease({
    manifest,
    manifestPath: path.relative(root, manifestPath).replaceAll("\\", "/"),
    sourceText: sourceClosure.entryText,
    sourceBundleText: sourceClosure.bundleText,
    metadata,
    runtimeEvidence,
  });
  const output = path.resolve(root, options.output);
  const written = await writeUniswapHookRelease(output, artifacts);

  process.stdout.write(
    [
      `Prepared ${artifacts.evidence.releaseId}.`,
      `Hooklist status: ${artifacts.hooklist.submissionStatus}.`,
      `Routing status: ${artifacts.routingAllowlist.submissionStatus}.`,
      ...written.map((file) => path.relative(root, file)),
      "",
    ].join("\n"),
  );
}

const invokedDirectly =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  main().catch((error) => {
    process.stderr.write(`Hook release preparation failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
