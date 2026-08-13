import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { keccak256, toEventSelector, toFunctionSelector } from "viem";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const write = process.argv.includes("--write");
const artifactPath = path.join(root, "contracts/out/ProgrammableCustomRegistryV2.sol/ProgrammableCustomRegistryV2.json");
const sourcePaths = [
  "contracts/src/interfaces/IProgrammableCustomRegistryV2.sol",
  "contracts/src/ProgrammableCustomRegistryV2.sol",
  "contracts/script/DeployProgrammableCustomRegistryV2.s.sol",
  "contracts/scripts/prepare-custom-registry-v2-deployment.mjs",
  "contracts/scripts/authorize-custom-registry-v2-deployment.mjs",
  "contracts/scripts/custom-registry-v2-deployment-guards.mjs",
  "contracts/scripts/broadcast-custom-registry-v2-deployment.mjs",
];
const outputs = {
  manifest: path.join(root, "contracts/spec/custom-registry-v2-predeployment.json"),
  abi: path.join(root, "docs/security/abi/ProgrammableCustomRegistryV2.json"),
  events: path.join(root, "docs/security/CUSTOM_REGISTRY_EVENT_SET_V2.json"),
};

const sha256 = (value) => `0x${createHash("sha256").update(value).digest("hex")}`;
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const artifact = JSON.parse(await readFile(artifactPath, "utf8"));
const abi = artifact.abi;
const sourceDigests = Object.fromEntries(
  await Promise.all(sourcePaths.map(async (relative) => [relative, sha256(await readFile(path.join(root, relative)))])),
);
const events = abi.filter((entry) => entry.type === "event").map((entry) => ({
  name: entry.name,
  signature: `${entry.name}(${entry.inputs.map((input) => input.type).join(",")})`,
  topic0: toEventSelector(entry),
})).sort((a, b) => a.name.localeCompare(b.name));
const functions = abi.filter((entry) => entry.type === "function").map((entry) => ({
  name: entry.name,
  signature: `${entry.name}(${entry.inputs.map((input) => input.type).join(",")})`,
  selector: toFunctionSelector(entry),
})).sort((a, b) => a.signature.localeCompare(b.signature));
const runtimeImmutableReferences = Object.values(artifact.deployedBytecode.immutableReferences)
  .flat()
  .map(({ start, length }) => ({ start, length }))
  .sort((a, b) => a.start - b.start || a.length - b.length);
const abiDocument = json({
  schemaVersion: "programmable.custom-registry-abi.v2",
  contractName: "ProgrammableCustomRegistryV2",
  abi,
});

const manifest = {
  schemaVersion: "programmable.custom-registry-predeployment.v2",
  status: "SOURCE_ONLY_NOT_DEPLOYED",
  chainId: "1",
  registryGeneration: 2,
  policy: {
    market: { id: "standard10", protocolFeeBps: 10 },
    noMarket: { id: "no-market0", protocolFeeBps: 0 },
  },
  sourceDigests,
  compiler: {
    version: "0.8.26",
    evmVersion: "cancun",
    optimizerEnabled: true,
    optimizerRuns: 1000,
    bytecodeHash: "none",
    cborMetadata: false,
  },
  artifact: {
    abiSha256: sha256(abiDocument),
    creationBytecodeKeccak256: keccak256(artifact.bytecode.object),
    runtimeTemplateKeccak256: keccak256(artifact.deployedBytecode.object),
    runtimeImmutableReferences,
    functions,
    events,
  },
  deployment: {
    address: null,
    transactionHash: null,
    blockNumber: null,
    blockHash: null,
    runtimeCodeHash: null,
    sourceVerification: null,
  },
  activationAllowed: false,
};

const rendered = {
  manifest: json(manifest),
  abi: abiDocument,
  events: json({ schemaVersion: "programmable.custom-registry-events.v2", events }),
};

for (const [name, destination] of Object.entries(outputs)) {
  if (write) {
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, rendered[name], { flag: "w", mode: 0o644 });
  } else {
    const actual = await readFile(destination, "utf8");
    if (actual !== rendered[name]) throw new Error(`${path.relative(root, destination)} is stale`);
  }
}

process.stdout.write(`CUSTOM_REGISTRY_V2_ARTIFACTS_${write ? "WRITTEN" : "VERIFIED"}\n`);
