#!/usr/bin/env node

import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const packageRoot = path.join(repositoryRoot, "packages", "dex-evm");
const sourceRoot = path.join(packageRoot, "src");
const artifactRoot = path.join(packageRoot, "out");
const protocolLockPath = path.join(packageRoot, "binding", "protocol-lock.json");
const reportPath = path.join(packageRoot, "binding", "reports", "build-artifacts.generated.json");
const abiBundlePath = path.join(packageRoot, "binding", "abi", "foundations.generated.json");

const runtimeLimitBytes = 24_576;
const initcodeLimitBytes = 49_152;
const requiredFoundryVersion = "1.7.1";
const requiredFoundryCommit = "4072e48705af9d93e3c0f6e29e93b5e9a40caed8";
const requiredCompilerVersion = "0.8.26+commit.8a97fa7a";

function sha256Bytes(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function toPosix(candidate) {
  return candidate.split(path.sep).join("/");
}

async function walkFiles(root, predicate) {
  const files = [];
  const rootInfo = await lstat(root).catch(() => null);
  if (!rootInfo?.isDirectory()) throw new Error(`Required directory is missing: ${root}`);

  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Symbolic links are forbidden in generated inputs: ${absolute}`);
      if (entry.isDirectory()) await visit(absolute);
      if (entry.isFile() && predicate(absolute)) files.push(absolute);
    }
  }

  await visit(root);
  return files.sort();
}

function parseMetadata(artifact, artifactPath) {
  const metadata = typeof artifact.metadata === "string" ? JSON.parse(artifact.metadata) : artifact.metadata;
  if (metadata === null || typeof metadata !== "object") throw new Error(`${artifactPath}: missing compiler metadata`);
  return metadata;
}

function bytecodeBytes(bytecode, artifactPath, field) {
  const object = typeof bytecode === "string" ? bytecode : bytecode?.object;
  if (typeof object !== "string") throw new Error(`${artifactPath}: missing ${field}.object`);
  const hex = object.startsWith("0x") ? object.slice(2) : object;
  if (hex === "") return Buffer.alloc(0);
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/u.test(hex)) {
    throw new Error(`${artifactPath}: ${field} is unlinked or not exact hexadecimal bytecode`);
  }
  return Buffer.from(hex, "hex");
}

function assertCompilerSettings(metadata, artifactPath) {
  const compilerVersion = metadata.compiler?.version;
  const settings = metadata.settings;
  if (compilerVersion !== requiredCompilerVersion) {
    throw new Error(`${artifactPath}: expected exact Solidity ${requiredCompilerVersion} compiler metadata`);
  }
  if (settings?.evmVersion !== "cancun") throw new Error(`${artifactPath}: expected Cancun EVM output`);
  if (settings?.optimizer?.enabled !== true || settings.optimizer.runs !== 1_000) {
    throw new Error(`${artifactPath}: expected optimizer=true and optimizer_runs=1000`);
  }
  if (settings?.metadata?.bytecodeHash !== "none" || settings.metadata.appendCBOR !== false) {
    throw new Error(`${artifactPath}: bytecode must omit metadata hashes and CBOR trailers`);
  }
  return compilerVersion;
}

async function sourceInventory() {
  const sources = await walkFiles(sourceRoot, (candidate) => candidate.endsWith(".sol"));
  if (sources.length === 0) throw new Error("No production Solidity sources exist under packages/dex-evm/src");
  const records = [];
  for (const source of sources) {
    records.push({
      path: toPosix(path.relative(packageRoot, source)),
      sha256: sha256Bytes(await readFile(source))
    });
  }
  return records;
}

async function contractInventory() {
  const artifactFiles = await walkFiles(artifactRoot, (candidate) => candidate.endsWith(".json"));
  const records = [];
  const abis = [];
  const compilerVersions = new Set();
  const identities = new Set();

  for (const artifactFile of artifactFiles) {
    let artifact;
    try {
      artifact = JSON.parse(await readFile(artifactFile, "utf8"));
    } catch {
      continue;
    }
    if (!artifact?.abi || (!artifact.bytecode && !artifact.deployedBytecode)) continue;
    if (typeof artifact.ast?.absolutePath !== "string" || !artifact.ast.absolutePath.startsWith("src/")) continue;

    const artifactRelative = toPosix(path.relative(packageRoot, artifactFile));
    const metadata = parseMetadata(artifact, artifactRelative);
    const targets = Object.entries(metadata.settings?.compilationTarget ?? {});
    if (targets.length !== 1) throw new Error(`${artifactRelative}: expected one compilation target`);
    const [[sourcePath, contractName]] = targets;
    if (!sourcePath.startsWith("src/")) continue;

    const compilerVersion = assertCompilerSettings(metadata, artifactRelative);
    compilerVersions.add(compilerVersion);

    const identity = `${sourcePath}:${contractName}`;
    if (identities.has(identity)) throw new Error(`Duplicate production artifact identity: ${identity}`);
    identities.add(identity);
    abis.push({
      artifactPath: artifactRelative,
      sourcePath,
      contractName,
      abiSha256: sha256Bytes(Buffer.from(canonicalJson(artifact.abi), "utf8")),
      abi: artifact.abi
    });

    const creation = bytecodeBytes(artifact.bytecode, artifactRelative, "bytecode");
    const runtime = bytecodeBytes(artifact.deployedBytecode, artifactRelative, "deployedBytecode");
    if (creation.length === 0 && runtime.length === 0) continue;

    const runtimeWithinLimit = runtime.length <= runtimeLimitBytes;
    const creationWithinLimit = creation.length <= initcodeLimitBytes;
    if (!runtimeWithinLimit) throw new Error(`${identity}: runtime bytecode is ${runtime.length} bytes, above EIP-170`);
    if (!creationWithinLimit) throw new Error(`${identity}: creation bytecode is ${creation.length} bytes, above EIP-3860 before constructor arguments`);

    records.push({
      artifactPath: artifactRelative,
      sourcePath,
      contractName,
      compilerVersion,
      abiSha256: sha256Bytes(Buffer.from(canonicalJson(artifact.abi), "utf8")),
      creationBytecodeBytes: creation.length,
      creationBytecodeSha256: sha256Bytes(creation),
      runtimeBytecodeBytes: runtime.length,
      runtimeBytecodeSha256: sha256Bytes(runtime),
      gates: {
        creationBytecodeWithinEip3860BeforeConstructorArguments: creationWithinLimit,
        runtimeBytecodeWithinEip170: runtimeWithinLimit
      }
    });
  }

  records.sort((left, right) => `${left.sourcePath}:${left.contractName}`.localeCompare(`${right.sourcePath}:${right.contractName}`));
  abis.sort((left, right) => `${left.sourcePath}:${left.contractName}`.localeCompare(`${right.sourcePath}:${right.contractName}`));
  if (records.length === 0) throw new Error("No deployable production artifacts were found; run forge build first");
  if (abis.length === 0) throw new Error("No production ABI artifacts were found; run forge build first");
  if (compilerVersions.size !== 1) throw new Error(`Production artifacts use multiple compiler versions: ${[...compilerVersions].join(", ")}`);
  return { contracts: records, abis, compilerVersion: [...compilerVersions][0] };
}

async function generateOutputs() {
  const protocolLock = await readFile(protocolLockPath).catch(() => null);
  if (protocolLock === null) throw new Error("binding/protocol-lock.json is required before generating a build inventory");
  JSON.parse(protocolLock.toString("utf8"));

  const sources = await sourceInventory();
  const { contracts, abis, compilerVersion } = await contractInventory();
  const sourceSetMaterial = sources.map((source) => `${source.path}\0${source.sha256}\n`).join("");
  const foundryConfig = await readFile(path.join(packageRoot, "foundry.toml"));
  const remappings = await readFile(path.join(packageRoot, "remappings.txt"));
  const abiBundle = {
    schemaVersion: 1,
    artifactClass: "draft-foundations-abi-bundle",
    terminalState: "BLOCKED_BY_SPEC",
    scope: "compiled EVM foundations only",
    protectedExecutionAbiFrozen: false,
    claims: {
      bindingRelease: false,
      conformanceReport: false,
      deployment: false,
      protectedExecutionAbiFrozen: false,
      productionEligible: false
    },
    warning: "These compiler-derived ABIs are developer artifacts for the implemented foundations. They do not freeze the protected-execution ABI or establish a Binding Release.",
    protocolLockSha256: sha256Bytes(protocolLock),
    compilerVersion,
    entries: abis
  };
  const abiBundleBytes = Buffer.from(`${JSON.stringify(abiBundle, null, 2)}\n`, "utf8");

  const report = {
    schemaVersion: 1,
    artifactClass: "draft-foundations-build-inventory",
    terminalState: "BLOCKED_BY_SPEC",
    scope: "compiled EVM foundations only",
    claims: {
      bindingRelease: false,
      conformanceReport: false,
      deployment: false,
      executionAbiFrozen: false,
      productionEligible: false,
      sourceVerified: false
    },
    blocker: {
      code: "BLOCKED_BY_SPEC",
      subject: "protected execution ABI and complete native-to-portable binding",
      effect: "No Binding Release, conformance claim, deployment manifest, or production artifact is generated."
    },
    inputs: {
      foundryConfigSha256: sha256Bytes(foundryConfig),
      foundationsAbiBundleSha256: sha256Bytes(abiBundleBytes),
      protocolLockSha256: sha256Bytes(protocolLock),
      remappingsSha256: sha256Bytes(remappings),
      sourceSetAlgorithm: "sha256(path + NUL + prefixed-source-sha256 + LF), sorted by path",
      sourceSetSha256: sha256Bytes(Buffer.from(sourceSetMaterial, "utf8"))
    },
    toolchainRequirements: {
      evidenceClass: "required-version-and-artifact-metadata",
      foundry: {
        version: requiredFoundryVersion,
        commit: requiredFoundryCommit,
        binarySha256: null,
        binaryHashBoundary: "Platform-specific Foundry binary hashes are not claimed by this cross-platform report."
      },
      solidity: {
        version: compilerVersion,
        commit: compilerVersion.split("+commit.")[1],
        attestedByEveryIncludedContractArtifactMetadata: true,
        binarySha256: null,
        binaryHashBoundary: "The compiler version and commit are artifact-attested; a cross-platform compiler binary hash is not claimed."
      }
    },
    compiler: {
      version: compilerVersion,
      evmVersion: "cancun",
      optimizer: { enabled: true, runs: 1_000 },
      metadata: { appendCbor: false, bytecodeHash: "none" }
    },
    sizeLimits: {
      eip170RuntimeBytes: runtimeLimitBytes,
      eip3860InitcodeBytes: initcodeLimitBytes,
      constructorArgumentsIncluded: false,
      note: "EIP-3860 is rechecked against complete initcode before any deployment owner gate."
    },
    sources,
    contracts
  };
  return { abiBundle, report };
}

async function main() {
  const [mode, ...rest] = process.argv.slice(2);
  if (rest.length !== 0 || !new Set(["--write", "--check"]).has(mode)) {
    throw new Error("Usage: node scripts/generate-dex-evm-build-artifacts.mjs --write|--check");
  }

  const { abiBundle, report } = await generateOutputs();
  const expectedAbiBundle = `${JSON.stringify(abiBundle, null, 2)}\n`;
  const expectedReport = `${JSON.stringify(report, null, 2)}\n`;
  if (mode === "--write") {
    await mkdir(path.dirname(abiBundlePath), { recursive: true });
    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(abiBundlePath, expectedAbiBundle, "utf8");
    await writeFile(reportPath, expectedReport, "utf8");
    process.stdout.write(`Wrote ${toPosix(path.relative(repositoryRoot, abiBundlePath))}\n`);
    process.stdout.write(`Wrote ${toPosix(path.relative(repositoryRoot, reportPath))}\n`);
    return;
  }

  const actualAbiBundle = await readFile(abiBundlePath, "utf8").catch(() => null);
  if (actualAbiBundle === null) {
    throw new Error(`Missing generated ABI bundle: ${toPosix(path.relative(repositoryRoot, abiBundlePath))}`);
  }
  if (actualAbiBundle !== expectedAbiBundle) {
    throw new Error("Generated foundations ABI bundle is stale; run this command with --write and review the exact diff");
  }
  const actualReport = await readFile(reportPath, "utf8").catch(() => null);
  if (actualReport === null) throw new Error(`Missing generated report: ${toPosix(path.relative(repositoryRoot, reportPath))}`);
  if (actualReport !== expectedReport) {
    throw new Error("Generated foundations build inventory is stale; run this command with --write and review the exact diff");
  }
  process.stdout.write(`Verified ${toPosix(path.relative(repositoryRoot, abiBundlePath))}\n`);
  process.stdout.write(`Verified ${toPosix(path.relative(repositoryRoot, reportPath))}\n`);
}

main().catch((error) => {
  process.stderr.write(`DEX EVM build inventory failed: ${error.message}\n`);
  process.exitCode = 1;
});
