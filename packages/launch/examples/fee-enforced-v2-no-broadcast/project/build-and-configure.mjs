#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import solc from "solc";

const root = process.cwd();
const launchWallet = required("PROGRAMMABLE_LAUNCH_WALLET");
if (!/^0x[0-9a-fA-F]{40}$/.test(launchWallet)
  || /^0x0{40}$/i.test(launchWallet)) {
  throw new TypeError("PROGRAMMABLE_LAUNCH_WALLET must be a nonzero Ethereum address");
}
const nonce = required("PROGRAMMABLE_LAUNCH_NONCE");
if (!/^0x(?!0{64}$)[0-9a-f]{64}$/.test(nonce)) {
  throw new TypeError("PROGRAMMABLE_LAUNCH_NONCE must be a nonzero lowercase bytes32");
}
const revision = required("PROGRAMMABLE_SOURCE_REVISION");
if (!/^[0-9a-f]{40}$/.test(revision)) {
  throw new TypeError("PROGRAMMABLE_SOURCE_REVISION must be an exact lowercase Git commit");
}
const checkedAt = process.env.PROGRAMMABLE_CHECKED_AT ?? new Date().toISOString();
if (new Date(checkedAt).toISOString() !== checkedAt) {
  throw new TypeError("PROGRAMMABLE_CHECKED_AT must be canonical UTC with milliseconds");
}
if (solc.version() !== "0.8.26+commit.8a97fa7a.Emscripten.clang") {
  throw new TypeError(`expected exact solc 0.8.26, received ${solc.version()}`);
}

const sourcePath = "src/NoOpAfterSwapModule.sol";
const source = await readFile(path.join(root, sourcePath), "utf8");
const standardJson = {
  language: "Solidity",
  sources: { [sourcePath]: { content: source } },
  settings: {
    optimizer: { enabled: true, runs: 1000 },
    evmVersion: "cancun",
    viaIR: false,
    metadata: { bytecodeHash: "ipfs", appendCBOR: true, useLiteralContent: true },
    libraries: {},
    remappings: [],
    outputSelection: {
      "*": {
        "*": ["abi", "evm.bytecode", "evm.deployedBytecode", "metadata"],
        "": ["ast"],
      },
    },
  },
};
const standardJsonBytes = Buffer.from(`${JSON.stringify(standardJson)}\n`, "utf8");
const output = JSON.parse(solc.compile(JSON.stringify(standardJson)));
const errors = (output.errors ?? []).filter(({ severity }) => severity === "error");
if (errors.length !== 0) {
  throw new TypeError(`solc failed:\n${errors.map(({ formattedMessage }) => formattedMessage).join("\n")}`);
}
const compiled = output.contracts[sourcePath].NoOpAfterSwapModule;
const artifact = {
  abi: compiled.abi,
  bytecode: compiled.evm.bytecode,
  deployedBytecode: compiled.evm.deployedBytecode,
  metadata: compiled.metadata,
};
const artifactBytes = Buffer.from(`${JSON.stringify(artifact)}\n`, "utf8");
await mkdir(path.join(root, "standard-json"), { recursive: true });
await mkdir(path.join(root, "artifacts"), { recursive: true });
await mkdir(path.join(root, "evidence"), { recursive: true });
await writeFile(path.join(root, "standard-json/custom-module.json"), standardJsonBytes);
await writeFile(path.join(root, "artifacts/custom-module.json"), artifactBytes);

const manifestBytes = await readFile(path.join(root, "profile-v2/manifest.json"));
const evidence = {
  schemaVersion: "programmable.fee-enforced-v2-no-broadcast-evidence.v1",
  scope: {
    pack: false,
    validate: false,
    submit: false,
    status: false,
    stopAt: "pre-submit",
    walletBroadcast: false,
  },
  compilerVersion: solc.version(),
  checkedAt,
  sourceRevision: revision,
  profileAssetManifestSha256: sha256(manifestBytes),
  customModuleStandardJsonSha256: sha256(standardJsonBytes),
  customModuleArtifactSha256: sha256(artifactBytes),
};
await writeFile(
  path.join(root, "evidence/rehearsal.json"),
  `${JSON.stringify(evidence, null, 2)}\n`,
  { mode: 0o600 },
);

const initialSqrtPriceX96 = "79228162514264337593543950336";
const config = {
  schemaVersion: "programmable.launch-pack-config.v2",
  launchWallet,
  chainId: "1",
  nonce,
  source: {
    root: ".",
    paths: ["src", "profile-v2/sources"],
    sourceLineageNonce: "1",
    publicOrigin: {
      url: "https://github.com/0xprogrammable/PROGRAMMABLE",
      revision,
    },
  },
  compilationUnits: [
    { compilationUnitId: "custom-module-solc", standardJson: "standard-json/custom-module.json" },
    { compilationUnitId: "profile-token", standardJson: "profile-v2/standard-json/token.json" },
    { compilationUnitId: "profile-vault", standardJson: "profile-v2/standard-json/vault.json" },
    { compilationUnitId: "profile-hook", standardJson: "profile-v2/standard-json/hook.json" },
    {
      compilationUnitId: "profile-initializer",
      standardJson: "profile-v2/standard-json/initializer.json",
    },
  ],
  targets: [
    {
      targetId: "token",
      compilationUnitId: "profile-token",
      artifact: "profile-v2/artifacts/token.json",
      applicantSalt: `0x${"00".repeat(32)}`,
      constructorArguments: [
        "Clean Room Token",
        "CLEAN",
        "1000000000000000000000000",
        launchWallet,
      ],
      initializer: null,
      deploymentValueWei: "0",
      initializerValueWei: "0",
      componentKind: "token",
      declaredHookPermissions: null,
      runtimeImmutables: [],
    },
    {
      targetId: "custom-module",
      compilationUnitId: "custom-module-solc",
      artifact: "artifacts/custom-module.json",
      applicantSalt: `0x${"02".repeat(32)}`,
      constructorArguments: [],
      initializer: null,
      deploymentValueWei: "0",
      initializerValueWei: "0",
      componentKind: "other",
      declaredHookPermissions: null,
      runtimeImmutables: [],
    },
    {
      targetId: "fee-vault",
      compilationUnitId: "profile-vault",
      artifact: "profile-v2/artifacts/vault.json",
      applicantSalt: `0x${"01".repeat(32)}`,
      constructorArguments: [],
      initializer: { function: "bindAdapter", arguments: [{ target: "fee-hook" }] },
      deploymentValueWei: "0",
      initializerValueWei: "0",
      componentKind: "other",
      declaredHookPermissions: null,
      runtimeImmutables: [
        {
          immutableId: "2534",
          abiType: "address",
          literal: "0x000000000004444c5dc75cB358380D2e3dE08A90",
        },
        {
          immutableId: "2536",
          abiType: "address",
          literal: "0xB012e4A8F2c5FC4E8E4faCA9D5Ad6FfF13FBA887",
        },
      ],
    },
    {
      targetId: "fee-hook",
      compilationUnitId: "profile-hook",
      artifact: "profile-v2/artifacts/isolated-hook.json",
      applicantSalt: {
        mode: "deterministic-hook-permission-grind-v1",
        start: "0",
        maxAttempts: "262144",
      },
      constructorArguments: [{ target: "fee-vault" }, { target: "custom-module" }],
      initializer: {
        function: "bindPool",
        arguments: [[
          "0x0000000000000000000000000000000000000000",
          { target: "token" },
          "3000",
          "60",
          { target: "fee-hook" },
        ], { target: "pool-initializer" }, initialSqrtPriceX96],
      },
      deploymentValueWei: "0",
      initializerValueWei: "0",
      componentKind: "hook",
      declaredHookPermissions: ["beforeInitialize", "afterSwap", "afterSwapReturnDelta"],
      runtimeImmutables: [],
    },
    {
      targetId: "pool-initializer",
      compilationUnitId: "profile-initializer",
      artifact: "profile-v2/artifacts/initializer.json",
      applicantSalt: `0x${"03".repeat(32)}`,
      constructorArguments: [
        { target: "fee-vault" },
        { target: "fee-hook" },
        { target: "token" },
        "3000",
        "60",
        initialSqrtPriceX96,
      ],
      initializer: { function: "initializePool", arguments: [] },
      deploymentValueWei: "0",
      initializerValueWei: "0",
      componentKind: "other",
      declaredHookPermissions: null,
      runtimeImmutables: [],
    },
  ],
  pool: { tokenTargetId: "token", hookTargetId: "fee-hook", fee: 3000, tickSpacing: 60 },
  launchProfile: {
    schemaVersion: "programmable.fee-enforced-launch-profile-selection.v1",
    profileId: "programmable.fee-enforced-isolated-after-swap.zero-delta.v1",
    profileRevision: 3,
    targetRoles: {
      tokenTargetId: "token",
      customModuleTargetId: "custom-module",
      feeVaultTargetId: "fee-vault",
      feeHookTargetId: "fee-hook",
      poolInitializerTargetId: "pool-initializer",
    },
  },
  agentAttestation: {
    agentId: "programmable-public-fee-enforced-v2-no-broadcast",
    checkedAt,
    checks: [{ checkId: "exact-build-pre-submit-rehearsal", evidence: "evidence/rehearsal.json" }],
  },
};
await writeFile(
  path.join(root, "programmable-launch.config.json"),
  `${JSON.stringify(config, null, 2)}\n`,
  { mode: 0o600 },
);
process.stdout.write(`${JSON.stringify({
  schemaVersion: "programmable.fee-enforced-v2-config-result.v1",
  configPath: path.join(root, "programmable-launch.config.json"),
  evidencePath: path.join(root, "evidence/rehearsal.json"),
  profileAssetManifestSha256: evidence.profileAssetManifestSha256,
  customModuleStandardJsonSha256: evidence.customModuleStandardJsonSha256,
  submit: false,
  status: false,
  walletBroadcast: false,
  stopAt: "pre-submit",
}, null, 2)}\n`);

function required(name) {
  const value = process.env[name];
  if (typeof value !== "string" || value.length === 0) throw new TypeError(`${name} is required`);
  return value;
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}
