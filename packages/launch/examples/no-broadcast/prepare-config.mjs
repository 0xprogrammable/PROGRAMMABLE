#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";

import { getAddress } from "viem";

import { atomicWrite, sha256Digest } from "../../src/io.mjs";

const projectDirectory = path.resolve(process.argv[2] ?? "");
if (process.argv.length !== 3) {
  throw new TypeError("Usage: node prepare-config.mjs <copied-example-project-directory>");
}

const launchWallet = getAddress(requiredEnvironment("PROGRAMMABLE_LAUNCH_WALLET"));
const nonce = requiredEnvironment("PROGRAMMABLE_LAUNCH_NONCE");
if (!/^0x(?!0{64}$)[0-9a-f]{64}$/.test(nonce)) {
  throw new TypeError("PROGRAMMABLE_LAUNCH_NONCE must be a nonzero lowercase bytes32");
}
const revision = requiredEnvironment("PROGRAMMABLE_SOURCE_REVISION");
if (!/^[0-9a-f]{40}$/.test(revision)) {
  throw new TypeError("PROGRAMMABLE_SOURCE_REVISION must be the exact lowercase 40-character release commit");
}
const checkedAt = process.env.PROGRAMMABLE_CHECKED_AT ?? new Date().toISOString();
if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(checkedAt)
  || new Date(checkedAt).toISOString() !== checkedAt) {
  throw new TypeError("PROGRAMMABLE_CHECKED_AT must be a canonical UTC timestamp with milliseconds");
}

const standardJsonPath = path.join(projectDirectory, "standard-json-input.json");
const standardJsonBytes = await readFile(standardJsonPath);
const standardJson = JSON.parse(standardJsonBytes.toString("utf8"));
for (const [sourcePath, source] of Object.entries(standardJson.sources ?? {})) {
  const sourceBytes = await readFile(path.join(projectDirectory, ...sourcePath.split("/")));
  if (!sourceBytes.equals(Buffer.from(source.content, "utf8"))) {
    throw new TypeError(`${sourcePath} differs from its exact Standard JSON content`);
  }
}

const artifactPaths = [
  "out/NoBroadcastToken.json",
  "out/NoBroadcastHook.json",
];
const artifacts = [];
for (const artifactPath of artifactPaths) {
  const bytes = await readFile(path.join(projectDirectory, ...artifactPath.split("/")));
  const artifact = JSON.parse(bytes.toString("utf8"));
  const metadata = JSON.parse(artifact.metadata);
  artifacts.push({
    path: artifactPath,
    sha256: sha256Digest(bytes),
    compilerVersion: metadata.compiler?.version,
    compilationTarget: metadata.settings?.compilationTarget,
  });
}
const compilerVersions = new Set(artifacts.map(({ compilerVersion }) => compilerVersion));
if (compilerVersions.size !== 1
  || !/^0\.[0-9]+\.[0-9]+\+commit\.[0-9a-f]{8}$/.test([...compilerVersions][0] ?? "")) {
  throw new TypeError("example artifacts do not share one exact solc build");
}

const evidence = {
  schemaVersion: "programmable.no-broadcast-rehearsal-evidence.v1",
  scope: {
    pack: true,
    validate: true,
    submit: true,
    stopAt: "authorized",
    walletBroadcast: false,
  },
  launchWallet,
  nonce,
  sourceRevision: revision,
  checkedAt,
  standardJsonInputSha256: sha256Digest(standardJsonBytes),
  artifacts,
};
const evidencePath = path.join(projectDirectory, "evidence", "rehearsal.json");
await atomicWrite(
  evidencePath,
  Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`, "utf8"),
  0o600,
);

const config = {
  schemaVersion: "programmable.launch-pack-config.v1",
  launchWallet,
  chainId: "1",
  nonce,
  source: {
    root: ".",
    paths: ["src"],
    sourceLineageNonce: "1",
    publicOrigin: {
      url: "https://github.com/0xprogrammable/PROGRAMMABLE",
      revision,
    },
  },
  compilationUnits: [{
    compilationUnitId: "no-broadcast-solc-0.8.26",
    standardJson: "standard-json-input.json",
  }],
  targets: [
    {
      targetId: "token",
      compilationUnitId: "no-broadcast-solc-0.8.26",
      artifact: "out/NoBroadcastToken.json",
      applicantSalt: `0x${"00".repeat(32)}`,
      constructorArguments: [launchWallet],
      initializer: null,
      deploymentValueWei: "0",
      initializerValueWei: "0",
      componentKind: "token",
      declaredHookPermissions: null,
    },
    {
      targetId: "hook",
      compilationUnitId: "no-broadcast-solc-0.8.26",
      artifact: "out/NoBroadcastHook.json",
      applicantSalt: {
        mode: "deterministic-hook-permission-grind-v1",
        start: "0",
        maxAttempts: "262144",
      },
      constructorArguments: [
        { target: "token" },
        "0x000000000004444c5dc75cB358380D2e3dE08A90",
      ],
      initializer: null,
      deploymentValueWei: "0",
      initializerValueWei: "0",
      componentKind: "hook",
      declaredHookPermissions: ["afterInitialize"],
    },
  ],
  pool: {
    tokenTargetId: "token",
    hookTargetId: "hook",
    fee: 3000,
    tickSpacing: 60,
  },
  agentAttestation: {
    agentId: "programmable-public-no-broadcast-example-v1",
    checkedAt,
    checks: [{
      checkId: "exact-build-no-broadcast-rehearsal",
      evidence: "evidence/rehearsal.json",
    }],
  },
};
const configPath = path.join(projectDirectory, "programmable-launch.config.json");
await atomicWrite(
  configPath,
  Buffer.from(`${JSON.stringify(config, null, 2)}\n`, "utf8"),
  0o600,
);

process.stdout.write(`${JSON.stringify({
  schemaVersion: "programmable.no-broadcast-config-result.v1",
  projectDirectory,
  configPath,
  evidencePath,
  standardJsonInputSha256: evidence.standardJsonInputSha256,
  compilerVersion: [...compilerVersions][0],
  broadcastAuthorized: false,
}, null, 2)}\n`);

function requiredEnvironment(name) {
  const value = process.env[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${name} is required`);
  }
  return value;
}
