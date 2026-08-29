#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import solc from "solc";

import { createPackConfigFromCapabilities } from "./config-from-capabilities.mjs";

const CAPABILITIES_URL =
  "https://api.programmable.market/v4/chains/4663/capabilities";
const EXPECTED_SOLC = "0.8.26+commit.8a97fa7a.Emscripten.clang";
const SOURCE_TARGETS = Object.freeze([
  ["src/RobinhoodCleanRoomToken.sol", "RobinhoodCleanRoomToken", "token"],
  ["src/RobinhoodCleanRoomHook.sol", "RobinhoodCleanRoomHook", "hook"],
  ["src/RobinhoodCleanRoomInitializer.sol", "RobinhoodCleanRoomInitializer", "initializer"],
]);

if (process.argv.includes("--help")) {
  process.stdout.write(`Robinhood V4 no-broadcast build\n\nRequired public environment:\n  PROGRAMMABLE_LAUNCH_WALLET\n  PROGRAMMABLE_LAUNCH_NONCE\n  PROGRAMMABLE_SOURCE_REVISION\n  PROGRAMMABLE_PROJECT_IMAGE_SOURCE_PATH\n  PROGRAMMABLE_PROJECT_IMAGE_URI\n  PROGRAMMABLE_WEBSITE_URL\n  PROGRAMMABLE_X_URL\n\nOptional public environment:\n  PROGRAMMABLE_SOURCE_ORIGIN\n  PROGRAMMABLE_TOKEN_SUPPLY\n  PROGRAMMABLE_PROJECT_DESCRIPTION\n  PROGRAMMABLE_CHECKED_AT\n`);
  process.exit(0);
}
if (process.argv.length !== 2) throw new TypeError("build accepts only --help");
if (Object.hasOwn(process.env, "PROGRAMMABLE_API_KEY")) {
  throw new TypeError("this unauthenticated builder refuses PROGRAMMABLE_API_KEY");
}

const root = process.cwd();
const launchWallet = required("PROGRAMMABLE_LAUNCH_WALLET");
const nonce = required("PROGRAMMABLE_LAUNCH_NONCE");
const sourceRevision = required("PROGRAMMABLE_SOURCE_REVISION");
const sourceOrigin = process.env.PROGRAMMABLE_SOURCE_ORIGIN
  ?? "https://github.com/programmablehq/PROGRAMMABLE";
const tokenSupply = process.env.PROGRAMMABLE_TOKEN_SUPPLY
  ?? "1000000000000000000000000";
const checkedAt = process.env.PROGRAMMABLE_CHECKED_AT ?? new Date().toISOString();
const imageSourcePath = relativePath(required("PROGRAMMABLE_PROJECT_IMAGE_SOURCE_PATH"));
const imageBytes = await readFile(path.join(root, ...imageSourcePath.split("/")));
assertSupportedImage(imageBytes);
const projectMetadata = {
  schemaVersion: "programmable.project-metadata-input.v1",
  token: { name: "Robinhood Clean Room", symbol: "RHCR" },
  presentation: {
    description: process.env.PROGRAMMABLE_PROJECT_DESCRIPTION
      ?? "Capability-bound Robinhood V4 clean-room launch with no funding or liquidity action",
    image: {
      sourcePath: imageSourcePath,
      uri: requiredUrl("PROGRAMMABLE_PROJECT_IMAGE_URI"),
    },
    links: [
      { kind: "website", uri: requiredUrl("PROGRAMMABLE_WEBSITE_URL") },
      { kind: "x", uri: canonicalXUrl(required("PROGRAMMABLE_X_URL")) },
    ],
  },
};

const compilerVersion = solc.version();
if (compilerVersion !== EXPECTED_SOLC) {
  throw new TypeError(`expected exact solc ${EXPECTED_SOLC}, received ${compilerVersion}`);
}
const sources = Object.fromEntries(await Promise.all(SOURCE_TARGETS.map(async ([sourcePath]) => [
  sourcePath,
  { content: await readFile(path.join(root, ...sourcePath.split("/")), "utf8") },
])));
const standardJson = {
  language: "Solidity",
  sources,
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: "cancun",
    metadata: { bytecodeHash: "none", appendCBOR: false, useLiteralContent: true },
    libraries: {},
    remappings: [],
    outputSelection: {
      "*": {
        "*": [
          "abi",
          "metadata",
          "evm.bytecode.object",
          "evm.bytecode.linkReferences",
          "evm.deployedBytecode.object",
          "evm.deployedBytecode.linkReferences",
          "evm.deployedBytecode.immutableReferences",
        ],
      },
    },
  },
};
const standardJsonBytes = Buffer.from(`${JSON.stringify(standardJson)}\n`, "utf8");
const output = JSON.parse(solc.compile(JSON.stringify(standardJson)));
const errors = (output.errors ?? []).filter(({ severity }) => severity === "error");
if (errors.length !== 0) {
  throw new TypeError(errors.map(({ formattedMessage }) => formattedMessage).join("\n"));
}
await mkdir(path.join(root, "out"), { recursive: true });
await mkdir(path.join(root, "evidence"), { recursive: true });
await writeFile(path.join(root, "standard-json.json"), standardJsonBytes);
const artifactDigests = {};
for (const [sourcePath, contractName, targetId] of SOURCE_TARGETS) {
  const compiled = output.contracts?.[sourcePath]?.[contractName];
  if (!compiled?.abi || !compiled?.metadata || !compiled?.evm?.bytecode?.object
    || !compiled?.evm?.deployedBytecode?.object) {
    throw new TypeError(`compiler output is incomplete for ${sourcePath}:${contractName}`);
  }
  const artifactBytes = Buffer.from(`${JSON.stringify({
    abi: compiled.abi,
    bytecode: compiled.evm.bytecode,
    deployedBytecode: compiled.evm.deployedBytecode,
    metadata: compiled.metadata,
  })}\n`, "utf8");
  await writeFile(path.join(root, "out", `${targetId}.json`), artifactBytes);
  artifactDigests[targetId] = sha256(artifactBytes);
}

const capabilitiesResponse = await fetch(CAPABILITIES_URL, {
  method: "GET",
  headers: { accept: "application/json" },
  redirect: "error",
});
if (!capabilitiesResponse.ok) {
  throw new TypeError(`V4 capabilities unavailable: HTTP ${capabilitiesResponse.status}`);
}
const capabilitiesBytes = Buffer.from(await capabilitiesResponse.arrayBuffer());
let capabilities;
try {
  capabilities = JSON.parse(capabilitiesBytes.toString("utf8"));
} catch {
  throw new TypeError("V4 capabilities response is not JSON");
}
const now = Math.floor(Date.now() / 1_000);
const config = createPackConfigFromCapabilities({
  capabilities,
  launchWallet,
  nonce,
  permitWindow: {
    validAfter: String(Math.max(0, now - 60)),
    deadline: String(now + 3_540),
  },
  sourceRevision,
  sourceOrigin,
  tokenSupply,
  projectMetadata,
  checkedAt,
});
const canonicalCapabilitiesBytes = Buffer.from(`${JSON.stringify(capabilities, null, 2)}\n`, "utf8");
await writeFile(path.join(root, "evidence", "capabilities.json"), canonicalCapabilitiesBytes);
await writeFile(path.join(root, "evidence", "build.json"), `${JSON.stringify({
  schemaVersion: "programmable.robinhood-v4-clean-room-build.v1",
  compilerVersion,
  standardJsonSha256: sha256(standardJsonBytes),
  artifactDigests,
  capabilitiesUrl: CAPABILITIES_URL,
  capabilitiesSha256: sha256(canonicalCapabilitiesBytes),
  fundingMode: "none",
  signing: false,
  broadcast: false,
  checkedAt,
}, null, 2)}\n`, "utf8");
await writeFile(
  path.join(root, "programmable-launch.config.json"),
  `${JSON.stringify(config, null, 2)}\n`,
  "utf8",
);
process.stdout.write("Wrote capability-bound programmable-launch.config.json; no signing or broadcast performed.\n");

function required(name) {
  const value = process.env[name];
  if (typeof value !== "string" || value.length === 0) throw new TypeError(`${name} is required`);
  return value;
}

function requiredUrl(name) {
  const value = required(name);
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new TypeError(`${name} must be credential-free HTTPS without a fragment`);
  }
  return url.href;
}

function canonicalXUrl(value) {
  if (!/^https:\/\/x\.com\/[A-Za-z0-9_]{1,64}$/u.test(value)) {
    throw new TypeError("PROGRAMMABLE_X_URL must be canonical https://x.com/<handle>");
  }
  return value;
}

function relativePath(value) {
  if (path.isAbsolute(value) || value.includes("\\")
    || value.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new TypeError("project image source path must be a canonical relative path");
  }
  return value;
}

function assertSupportedImage(bytes) {
  const hex = bytes.subarray(0, 12).toString("hex");
  const supported = hex.startsWith("89504e470d0a1a0a")
    || hex.startsWith("ffd8ff")
    || hex.startsWith("52494646")
    || bytes.subarray(0, 6).toString("ascii") === "GIF89a";
  if (!supported) throw new TypeError("project image must be PNG, JPEG, WebP, or GIF");
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}
