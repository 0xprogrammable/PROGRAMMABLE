#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  atomicWrite,
  readStrictJsonFile,
  resolveInside,
  sha256Digest,
} from "../../packages/launch/src/io.mjs";
import { requireV4ReleaseReady } from "../../scripts/programmable-launch-v4-release-binding.mjs";
import {
  ROBINHOOD_LIVE_DEPLOYMENT_PATH,
  ROBINHOOD_PREDEPLOYMENT_PATH,
  materializeRobinhoodPromotionBundle,
  verifyRobinhoodPromotionBundle,
} from "./robinhood-custom-launch-postdeploy-core.mjs";

const DEFAULT_BUNDLE_PATH =
  "docs/operations/releases/custom-launch-v4/robinhood-mainnet-promotion-bundle.json";

function usage() {
  return [
    "Usage:",
    "  finalize-robinhood-custom-launch-deployment.mjs assemble --input <path> [--output <path>] [--repository-root <path>]",
    "  finalize-robinhood-custom-launch-deployment.mjs verify --bundle <path> [--repository-root <path>]",
    "  finalize-robinhood-custom-launch-deployment.mjs apply --bundle <path> [--repository-root <path>]",
    "",
    "assemble is offline and writes only the explicitly requested closed bundle.",
    "apply writes the derived live descriptor first and the release binding last; it never modifies the prepared artifact.",
  ].join("\n");
}

function parseCli(argv) {
  const [command, ...rest] = argv;
  if (!new Set(["assemble", "verify", "apply"]).has(command) || rest.length % 2 !== 0) {
    throw new TypeError(usage());
  }
  const values = new Map();
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index];
    const value = rest[index + 1];
    if (!new Set(["--input", "--output", "--bundle", "--repository-root"]).has(flag)
      || values.has(flag) || typeof value !== "string" || value.length === 0) {
      throw new TypeError(usage());
    }
    values.set(flag, value);
  }
  const repositoryRoot = path.resolve(values.get("--repository-root") ?? ".");
  if (command === "assemble" && (!values.has("--input") || values.has("--bundle"))) {
    throw new TypeError(usage());
  }
  if (command !== "assemble"
    && (!values.has("--bundle") || values.has("--input") || values.has("--output"))) {
    throw new TypeError(usage());
  }
  return {
    command,
    repositoryRoot,
    inputPath: values.get("--input") ?? null,
    outputPath: values.get("--output") ?? null,
    bundlePath: values.get("--bundle") ?? null,
  };
}

function serialized(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readJsonPath(value) {
  const { value: parsed } = await readStrictJsonFile(path.resolve(value), 64 * 1024 * 1024);
  return parsed;
}

async function assemble({ repositoryRoot, inputPath, outputPath }) {
  const input = await readJsonPath(inputPath);
  const bundle = materializeRobinhoodPromotionBundle({ repositoryRoot, input });
  verifyRobinhoodPromotionBundle({ repositoryRoot, bundle });
  const bytes = serialized(bundle);
  if (outputPath !== null) {
    const absoluteOutput = path.resolve(outputPath);
    await atomicWrite(absoluteOutput, bytes, 0o644);
  }
  return {
    command: "assemble",
    outputPath: outputPath === null ? null : path.resolve(outputPath),
    outputSha256: sha256Digest(bytes),
    chainDeploymentDescriptorDigest: bundle.finalizedBindings.chainDeploymentDescriptorDigest,
    promotionBundleDigest: bundle.promotionBundleDigest,
    startBlock: bundle.finalizedBindings.startBlock,
    disposition: bundle.state,
    wroteLiveArtifacts: false,
  };
}

async function verify({ repositoryRoot, bundlePath }) {
  const bundle = await readJsonPath(bundlePath);
  return {
    command: "verify",
    bundlePath: path.resolve(bundlePath),
    ...verifyRobinhoodPromotionBundle({ repositoryRoot, bundle }),
    wroteLiveArtifacts: false,
  };
}

async function apply({ repositoryRoot, bundlePath }) {
  const bundle = await readJsonPath(bundlePath);
  const verified = verifyRobinhoodPromotionBundle({ repositoryRoot, bundle });
  const preparedPath = resolveInside(repositoryRoot, ROBINHOOD_PREDEPLOYMENT_PATH);
  const preparedBefore = sha256Digest(await readFile(preparedPath));
  const live = bundle.artifacts.liveDeployment;
  const binding = bundle.artifacts.cliReleaseBinding;
  if (live.path !== ROBINHOOD_LIVE_DEPLOYMENT_PATH
    || live.path === ROBINHOOD_PREDEPLOYMENT_PATH
    || binding.path === ROBINHOOD_PREDEPLOYMENT_PATH) {
    throw new TypeError("promotion artifact targets are invalid");
  }
  await atomicWrite(resolveInside(repositoryRoot, live.path), serialized(live.value), 0o644);
  await atomicWrite(resolveInside(repositoryRoot, binding.path), serialized(binding.value), 0o644);
  const ready = requireV4ReleaseReady({ repositoryRoot });
  const preparedAfter = sha256Digest(await readFile(preparedPath));
  if (preparedAfter !== preparedBefore) {
    throw new Error("prepared no-broadcast artifact changed during promotion");
  }
  return {
    command: "apply",
    bundlePath: path.resolve(bundlePath),
    ...verified,
    bindingSha256: ready.bindingSha256,
    preparedArtifactPreserved: true,
    wroteLiveArtifacts: true,
  };
}

export async function runRobinhoodPostdeploymentCli(argv) {
  const options = parseCli(argv);
  if (options.command === "assemble") return assemble(options);
  if (options.command === "verify") return verify(options);
  return apply(options);
}

const invoked = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invoked === fileURLToPath(import.meta.url)) {
  try {
    const result = await runRobinhoodPostdeploymentCli(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

export { DEFAULT_BUNDLE_PATH };
