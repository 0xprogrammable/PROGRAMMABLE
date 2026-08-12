import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { encodeAbiParameters, keccak256, toBytes } from "viem";

const EIP170_MAX_RUNTIME = 24_576;
const EIP3860_MAX_INITCODE = 49_152;
const MIN_REGISTRY_RUNTIME_MARGIN = 1_024;
const MIN_COORDINATOR_INITCODE_MARGIN = 1_024;
const ADDRESS = "0x0000000000000000000000000000000000000001";
const HASH = `0x${"11".repeat(32)}`;

const registryConfig = {
  type: "tuple",
  components: [
    { type: "uint48" },
    { type: "address" },
    { type: "address" },
    { type: "address" },
    { type: "address" },
    { type: "address" },
    { type: "address" },
    { type: "uint64" },
    { type: "uint64" },
    { type: "bytes32" },
    { type: "bytes32" },
  ],
};

const targets = [
  { source: "ProgrammableLaunchPermitVerifierV1.sol", contract: "ProgrammableLaunchPermitVerifierV1" },
  {
    source: "ProgrammableLaunchPermitAuthorityV1.sol",
    contract: "ProgrammableLaunchPermitAuthorityV1",
    params: ["uint48", "address", "address", "address", "address", "address", "address", "uint64", "address", "bytes32"],
    values: [172_800, ADDRESS, ADDRESS, ADDRESS, ADDRESS, ADDRESS, ADDRESS, 900, ADDRESS, HASH],
  },
  { source: "ProgrammableExactShardsFeePolicyVerifierV2.sol", contract: "ProgrammableExactShardsFeePolicyVerifierV2" },
  {
    source: "ProgrammableExactShardsRegistryV1.sol",
    contract: "ProgrammableExactShardsRegistryV1",
    params: [registryConfig, { type: "address" }, { type: "address" }],
    values: [[172_800, ADDRESS, ADDRESS, ADDRESS, ADDRESS, ADDRESS, ADDRESS, 3, 3, HASH, HASH], ADDRESS, ADDRESS],
    minimumRuntimeMargin: MIN_REGISTRY_RUNTIME_MARGIN,
  },
  {
    source: "ShardLaunchFactoryV1.sol",
    contract: "ShardLaunchFactoryV1",
    params: ["address", "bytes32"],
    values: [ADDRESS, HASH],
  },
  {
    source: "ProgrammableExactShardsRouteGatedFactoryV2.sol",
    contract: "ProgrammableExactShardsRouteGatedFactoryV2",
    params: ["address", "bytes32", "address"],
    values: [ADDRESS, HASH, ADDRESS],
  },
  {
    source: "ProgrammableExactShardsAtomicLaunchRouteV1.sol",
    contract: "ProgrammableExactShardsAtomicLaunchRouteV1",
    params: ["address", "address", "address", "bytes32"],
    values: [ADDRESS, ADDRESS, ADDRESS, HASH],
  },
  {
    source: "ProgrammableExactShardsPairDeploymentCoordinatorV1.sol",
    contract: "ProgrammableExactShardsPairDeploymentCoordinatorV1",
    params: ["address", "address", "address", "bytes32"],
    values: [ADDRESS, ADDRESS, ADDRESS, HASH],
    minimumInitcodeMargin: MIN_COORDINATOR_INITCODE_MARGIN,
  },
  {
    source: "ShardTokenV1.sol",
    contract: "ShardTokenV1",
    params: ["string", "string"],
    values: ["N".repeat(25), "S".repeat(11)],
  },
  {
    source: "ShardHookV1.sol",
    contract: "ShardHookV1",
    params: ["address", "address", "int24", "int24", "int24", "uint160", "address", "address", "address"],
    values: [ADDRESS, ADDRESS, -887_200, 60, 887_200, 79_228_162_514_264_337_593_543_950_336n, ADDRESS, ADDRESS, ADDRESS],
  },
  {
    source: "ShardNFTV1.sol",
    contract: "ShardNFTV1",
    params: ["address", "address", "string", "string"],
    values: [ADDRESS, ADDRESS, `${"N".repeat(25)} Pieces`, `${"S".repeat(11)}N`],
  },
  { source: "GeometricRendererV1.sol", contract: "GeometricRendererV1" },
];

function bytes(hex) {
  if (typeof hex !== "string" || !hex.startsWith("0x")) throw new Error("artifact bytecode is not hex");
  return (hex.length - 2) / 2;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function abiParameters(params = []) {
  return params.map((parameter) => (typeof parameter === "string" ? { type: parameter } : parameter));
}

async function validateBuildClosure(metadata) {
  const settings = metadata.settings;
  if (metadata.compiler.version !== "0.8.26+commit.8a97fa7a") throw new Error("unexpected solc version");
  if (!settings.optimizer.enabled || settings.optimizer.runs !== 1_000) throw new Error("unexpected optimizer settings");
  if (settings.evmVersion !== "cancun") throw new Error("unexpected EVM target");
  if (settings.viaIR === true) throw new Error("viaIR is forbidden for the Shards release build");
  if (settings.metadata.bytecodeHash !== "none" || settings.metadata.appendCBOR !== false) {
    throw new Error("unexpected bytecode metadata settings");
  }
  for (const [path, expected] of Object.entries(metadata.sources)) {
    const source = await readFile(resolve(path));
    if (keccak256(toBytes(source)) !== expected.keccak256) throw new Error(`source drift: ${path}`);
  }
}

const report = [];
for (const target of targets) {
  const artifactPath = resolve("out", target.source, `${target.contract}.json`);
  const raw = await readFile(artifactPath);
  const artifact = JSON.parse(raw);
  await validateBuildClosure(artifact.metadata);

  const runtimeSize = bytes(artifact.deployedBytecode.object);
  const constructorArgs = target.params?.length
    ? encodeAbiParameters(abiParameters(target.params), target.values)
    : "0x";
  const fullInitcodeSize = bytes(artifact.bytecode.object) + bytes(constructorArgs);
  const runtimeMargin = EIP170_MAX_RUNTIME - runtimeSize;
  const initcodeMargin = EIP3860_MAX_INITCODE - fullInitcodeSize;
  if (runtimeMargin < (target.minimumRuntimeMargin ?? 0)) {
    throw new Error(`${target.contract} runtime margin ${runtimeMargin} is below policy`);
  }
  if (initcodeMargin < (target.minimumInitcodeMargin ?? 0)) {
    throw new Error(`${target.contract} full initcode margin ${initcodeMargin} is below policy`);
  }
  report.push({
    contract: target.contract,
    runtimeSize,
    runtimeMargin,
    fullInitcodeSize,
    initcodeMargin,
    creationCodeSha256: sha256(Buffer.from(artifact.bytecode.object.slice(2), "hex")),
    runtimeCodeSha256: sha256(Buffer.from(artifact.deployedBytecode.object.slice(2), "hex")),
    abiSha256: sha256(JSON.stringify(artifact.abi)),
  });
}

process.stdout.write(`${JSON.stringify({
  schemaVersion: "programmable.shards-v2-size-gate.v1",
  compiler: "0.8.26+commit.8a97fa7a",
  optimizer: { enabled: true, runs: 1_000 },
  evmVersion: "cancun",
  viaIR: false,
  runtimeLimit: EIP170_MAX_RUNTIME,
  initcodeLimit: EIP3860_MAX_INITCODE,
  targets: report,
}, null, 2)}\n`);
