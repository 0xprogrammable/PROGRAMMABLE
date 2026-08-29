#!/usr/bin/env node

import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const packageRoot = path.join(repositoryRoot, "packages", "dex-evm");
const suites = ["unit", "fuzz", "invariant", "adversarial", "conformance"];
const expectedFoundryConfig = `[profile.default]
src = "src"
test = "test"
script = "script"
out = "out"
cache_path = "cache"
broadcast = "broadcast"
libs = ["../../contracts/lib/forge-std"]
auto_detect_remappings = false
solc_version = "0.8.26"
evm_version = "cancun"
optimizer = true
optimizer_runs = 1_000
bytecode_hash = "none"
cbor_metadata = false
ffi = false
build_info = true
extra_output = ["storageLayout", "metadata", "evm.methodIdentifiers"]
fs_permissions = [
  { access = "read", path = "./binding/profiles" },
  { access = "read", path = "./binding/vectors" }
]

[profile.default.fuzz]
runs = 1_000
max_test_rejects = 65_536

[profile.default.invariant]
runs = 256
depth = 64
fail_on_revert = false

[profile.ci]
fuzz = { runs = 10_000, max_test_rejects = 65_536 }
invariant = { runs = 1_000, depth = 128, fail_on_revert = false }

[fmt]
line_length = 120
tab_width = 4
bracket_spacing = true
int_types = "long"
quote_style = "double"
number_underscore = "thousands"
wrap_comments = true
`;

function isWithin(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

async function walk(root, predicate) {
  const files = [];
  const info = await lstat(root).catch(() => null);
  if (!info?.isDirectory()) return files;
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Symbolic link is outside the reproducible package model: ${absolute}`);
      if (entry.isDirectory()) await visit(absolute);
      if (entry.isFile() && predicate(absolute)) files.push(absolute);
    }
  }
  await visit(root);
  return files.sort();
}

async function main() {
  const sources = await walk(path.join(packageRoot, "src"), (candidate) => candidate.endsWith(".sol"));
  if (sources.length === 0) throw new Error("The DEX EVM package must contain production Solidity sources");

  const foundryConfig = await readFile(path.join(packageRoot, "foundry.toml"), "utf8");
  if (foundryConfig !== expectedFoundryConfig) {
    throw new Error(
      "foundry.toml must preserve the exact compiler, FFI=false, two read-only roots, and CI fuzz/invariant policy"
    );
  }

  const canonicalPackageRoot = await realpath(packageRoot);
  const readRoots = {};
  for (const relativeRoot of ["binding/profiles", "binding/vectors"]) {
    const absoluteRoot = path.join(packageRoot, relativeRoot);
    const rootInfo = await lstat(absoluteRoot).catch(() => null);
    if (!rootInfo?.isDirectory()) throw new Error(`Foundry read-only root must be an ordinary directory: ${relativeRoot}`);
    const canonicalRoot = await realpath(absoluteRoot);
    if (!isWithin(canonicalRoot, canonicalPackageRoot)) {
      throw new Error(`Foundry read-only root escapes packages/dex-evm: ${relativeRoot}`);
    }
    readRoots[relativeRoot] = (await walk(absoluteRoot, () => true)).length;
  }

  const suiteCounts = {};
  for (const suite of suites) {
    const tests = await walk(path.join(packageRoot, "test", suite), (candidate) => candidate.endsWith(".t.sol"));
    if (tests.length === 0) throw new Error(`The ${suite} lane has no .t.sol tests`);
    suiteCounts[suite] = tests.length;
  }
  const authorityMutation = await lstat(
    path.join(packageRoot, "test", "conformance", "AuthorityFieldMutation.t.sol")
  ).catch(() => null);
  if (!authorityMutation?.isFile()) {
    throw new Error("The exact authority-bearing-field mutation gate test/conformance/AuthorityFieldMutation.t.sol is required");
  }

  const protocolLock = JSON.parse(await readFile(path.join(packageRoot, "binding", "protocol-lock.json"), "utf8"));
  const serializedLock = JSON.stringify(protocolLock);
  for (const required of [
    "334bb26703a4dab18ce0fca8485c6275a879933a",
    "programmable-protocol/0.1.0-draft.1",
    "2715d9770de7b327c054c413a99f7cbba0933f2eabc9639a53948706237cd301",
    "d61a757f8d4c14d3e5ab0f92e77ab39bd54e7a91f4cc5d591819c58768481137"
  ]) {
    if (!serializedLock.includes(required)) throw new Error(`Protocol lock is missing exact identifier ${required}`);
  }
  if (!serializedLock.includes("draft") || !serializedLock.includes("false")) {
    throw new Error("Protocol lock must preserve Draft and non-production-eligible status");
  }

  const blockerFiles = await walk(path.join(packageRoot, "binding", "reports"), (candidate) => /\.(?:json|md)$/u.test(candidate));
  let blockerRecorded = false;
  for (const blockerFile of blockerFiles) {
    if ((await readFile(blockerFile, "utf8")).includes("BLOCKED_BY_SPEC")) blockerRecorded = true;
  }
  if (!blockerRecorded) throw new Error("binding/reports must record BLOCKED_BY_SPEC for the execution ABI");

  const generated = JSON.parse(
    await readFile(path.join(packageRoot, "binding", "reports", "build-artifacts.generated.json"), "utf8")
  );
  const exactFalseClaims = [
    "bindingRelease",
    "conformanceReport",
    "deployment",
    "executionAbiFrozen",
    "productionEligible",
    "sourceVerified"
  ];
  if (generated.artifactClass !== "draft-foundations-build-inventory" || generated.terminalState !== "BLOCKED_BY_SPEC") {
    throw new Error("Generated build inventory must remain a draft foundations-only BLOCKED_BY_SPEC artifact");
  }
  for (const claim of exactFalseClaims) {
    if (generated.claims?.[claim] !== false) throw new Error(`Generated build inventory must set claims.${claim}=false`);
  }
  if (
    generated.toolchainRequirements?.foundry?.version !== "1.7.1"
    || generated.toolchainRequirements?.foundry?.commit !== "4072e48705af9d93e3c0f6e29e93b5e9a40caed8"
    || generated.toolchainRequirements?.foundry?.binarySha256 !== null
    || generated.toolchainRequirements?.solidity?.version !== "0.8.26+commit.8a97fa7a"
    || generated.toolchainRequirements?.solidity?.commit !== "8a97fa7a"
    || generated.toolchainRequirements?.solidity?.attestedByEveryIncludedContractArtifactMetadata !== true
    || generated.toolchainRequirements?.solidity?.binarySha256 !== null
  ) {
    throw new Error("Generated build inventory must record the exact portable toolchain requirement and honest binary-hash boundary");
  }

  const abiBundle = JSON.parse(
    await readFile(path.join(packageRoot, "binding", "abi", "foundations.generated.json"), "utf8")
  );
  if (
    abiBundle.artifactClass !== "draft-foundations-abi-bundle"
    || abiBundle.terminalState !== "BLOCKED_BY_SPEC"
    || abiBundle.protectedExecutionAbiFrozen !== false
    || abiBundle.claims?.protectedExecutionAbiFrozen !== false
    || abiBundle.claims?.bindingRelease !== false
    || !Array.isArray(abiBundle.entries)
    || abiBundle.entries.length === 0
  ) {
    throw new Error("Generated ABI bundle must remain nonempty, foundations-only, non-binding, and BLOCKED_BY_SPEC");
  }
  for (const forbiddenField of ["commit", "sourceCommit", "sourceTree", "transactionHash", "deploymentAddress"]) {
    if (Object.hasOwn(generated, forbiddenField)) {
      throw new Error(`Generated build inventory must not contain self-referential or deployment field ${forbiddenField}`);
    }
  }

  const sdkPackagePath = path.join(packageRoot, "sdk", "package.json");
  const sdkInfo = await lstat(sdkPackagePath).catch(() => null);
  let sdk = "absent-not-claimed";
  if (sdkInfo?.isFile()) {
    const sdkPackage = JSON.parse(await readFile(sdkPackagePath, "utf8"));
    if (sdkPackage.private !== true) throw new Error("The SDK must remain private until publication is separately authorized");
    if (sdkPackage.type !== "module") throw new Error("The SDK must be an ESM package");
    if (typeof sdkPackage.scripts?.build !== "string" || typeof sdkPackage.scripts?.test !== "string") {
      throw new Error("The SDK package must expose build and test scripts");
    }
    const lockInfo = await lstat(path.join(packageRoot, "sdk", "package-lock.json")).catch(() => null);
    if (!lockInfo?.isFile()) throw new Error("The SDK package must carry an exact npm lockfile");
    sdk = "present-private";
  }

  process.stdout.write(
    `DEX EVM package layout verified: ${sources.length} production sources; suites ${JSON.stringify(suiteCounts)}; `
    + `read roots ${JSON.stringify(readRoots)}; exact Foundry policy; SDK ${sdk}.\n`
  );
}

main().catch((error) => {
  process.stderr.write(`DEX EVM package verification failed: ${error.message}\n`);
  process.exitCode = 1;
});
