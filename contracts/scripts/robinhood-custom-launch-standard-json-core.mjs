import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  concatHex,
  encodeAbiParameters,
  keccak256,
  parseAbiParameters,
  stringToHex,
} from "viem";

import { prepareOwnerTransaction } from "./prepare-robinhood-custom-launch-owner-transaction.mjs";

const contractsRoot = fileURLToPath(new URL("../", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

const EXPECTED_REMAPPINGS = Object.freeze([
  "@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/",
  "@openzeppelin/uniswap-hooks/=lib/openzeppelin-uniswap-hooks/",
  "@solady/=lib/solady/",
  "@uniswap/blocknumberish/=lib/blocknumberish/",
  "@uniswap/liquidity-launcher/=lib/liquidity-launcher/",
  "@uniswap/uerc20-factory/=lib/uerc20-factory/",
  "@uniswap/v4-core/=lib/v4-core/",
  "@uniswap/v4-periphery/=lib/v4-periphery/",
  "blocknumberish/=lib/blocknumberish/",
  "continuous-clearing-auction/=lib/continuous-clearing-auction/src/",
  "forge-std/=lib/forge-std/src/",
  "liquidity-launcher/=lib/liquidity-launcher/",
  "permit2/=lib/permit2/",
  "solady/=lib/solady/src/",
  "solmate/=lib/solmate/",
  "v4-periphery/=lib/v4-periphery/",
  "@ensdomains/=lib/v4-core/node_modules/@ensdomains/",
  "@openzeppelin/=lib/liquidity-launcher/lib/openzeppelin-contracts/",
  "@optimism/=lib/liquidity-launcher/lib/optimism/packages/contracts-bedrock/",
  "btt/=lib/continuous-clearing-auction/test/btt/",
  "ds-test/=lib/v4-core/lib/forge-std/lib/ds-test/src/",
  "hardhat/=lib/v4-core/node_modules/hardhat/",
  "merkle-distributor/=lib/liquidity-launcher/lib/merkle-distributor/",
  "openzeppelin-contracts/=lib/openzeppelin-contracts/",
  "openzeppelin-uniswap-hooks/=lib/openzeppelin-uniswap-hooks/src/",
  "test/=lib/continuous-clearing-auction/test/",
  "uerc20-factory/=lib/uerc20-factory/src/",
  "v4-core/=lib/v4-core/src/",
]);

const EXPECTED_OUTPUT_SELECTION = Object.freeze([
  "abi",
  "evm.bytecode.object",
  "evm.bytecode.sourceMap",
  "evm.bytecode.linkReferences",
  "evm.deployedBytecode.object",
  "evm.deployedBytecode.sourceMap",
  "evm.deployedBytecode.linkReferences",
  "evm.deployedBytecode.immutableReferences",
  "evm.methodIdentifiers",
  "metadata",
]);

export const EXPECTED_COMPILER_INPUT_SETTINGS = Object.freeze({
  remappings: EXPECTED_REMAPPINGS,
  optimizer: { enabled: true, runs: 1000 },
  metadata: {
    useLiteralContent: false,
    bytecodeHash: "none",
    appendCBOR: false,
  },
  outputSelection: { "*": { "*": EXPECTED_OUTPUT_SELECTION } },
  evmVersion: "cancun",
  viaIR: false,
  libraries: {},
});

export const EXPECTED_COMPILER_PROFILE = Object.freeze({
  solc: "0.8.26",
  evmVersion: "cancun",
  optimizer: true,
  optimizerRuns: 1000,
  bytecodeHash: "none",
  cborMetadata: false,
  binaryLabel: "solc-0.8.26+commit.8a97fa7a.Darwin.appleclang",
  binarySha256:
    "0x24b06eb31fd9db8edf3a57bdf7468d7360d6fc2fb202a6bb577bda089193ef31",
});

export const ROBINHOOD_STANDARD_JSON_ARTIFACTS = Object.freeze({
  graphFactory: Object.freeze({
    key: "graphFactory",
    path: "contracts/spec/robinhood-custom-launch/standard-json/ProgrammableCreate2GraphDeployerV1.standard-input.json",
    sha256:
      "0x8ab811a215d70b1d5aef0c71a47153173953ee78d7632725413833888369ec4d",
    sourceUnit: "src/ProgrammableCreate2GraphDeployerV1.sol",
    contractName: "ProgrammableCreate2GraphDeployerV1",
    fqcn: "src/ProgrammableCreate2GraphDeployerV1.sol:ProgrammableCreate2GraphDeployerV1",
    outArtifactPath:
      "contracts/out/ProgrammableCreate2GraphDeployerV1.sol/ProgrammableCreate2GraphDeployerV1.json",
    address: "0x0B6b3F40f84Df25D3bd69238f937096177DD09Bd",
    sourceCount: 1,
    sourceSha256:
      "0x06a3acaf9beeb68647af231f5524c5a34dc013d99611a1b2d0a6c80895f595e9",
    abiSha256:
      "0x2d253b16e76c43bc6736a6dadb28881c7f8d52a1c4b8cf8aa22a20b0c6aaa5f4",
    baseCreationCodeHash:
      "0x84f7cb8e9e445d3322249dbc2b9efc65bb9c7a8ba26902aafef9b0552f4bc208",
    baseRuntimeCodeHash:
      "0xd23692fae59331592048e71a96d4963e170ee56e449683dc9f7fa3f9470018b8",
  }),
  router: Object.freeze({
    key: "router",
    path: "contracts/spec/robinhood-custom-launch/standard-json/ProgrammableLaunchStampRouterV1.standard-input.json",
    sha256:
      "0x6abca24d06b013599f4ff63e049976419c3f17455fa9bc343b15ec0d6e6a078a",
    sourceUnit:
      "src/robinhood-custom-launch/ProgrammableLaunchStampRouterV1.sol",
    contractName: "ProgrammableLaunchStampRouterV1",
    fqcn: "src/robinhood-custom-launch/ProgrammableLaunchStampRouterV1.sol:ProgrammableLaunchStampRouterV1",
    outArtifactPath:
      "contracts/out/ProgrammableLaunchStampRouterV1.sol/ProgrammableLaunchStampRouterV1.json",
    address: "0x34965F2A2ee9254522232C32F02056E92BE0C98a",
    sourceCount: 52,
    sourceSha256:
      "0xef87aa9338c364634bffda64423bd3fb096c1630a45cc58ecf854d24959ff163",
    abiSha256:
      "0xab25262ce1cb907eba1cb820492754c0cd5d7278eb5fd6a024ba24c767323ac0",
    baseCreationCodeHash:
      "0xac3a064602cd7aa5e3665507b69ae125d457942228ad88f15626c46ccac80ef9",
    baseRuntimeCodeHash:
      "0x79ae905ee338fe82158dab92d84c52bc4cf197b031beb9c1b5e402c7f449dfe1",
    constructorAppendedCreationCodeHash:
      "0xf4176bf15de19a93b76cd138d6525a30d68efdad356e831f6d8449659959eb39",
    deployedRuntimeCodeHash:
      "0x1dbbdaaad901ea3c6134dca0d4872a4789b3c071bf8ccfb44edd65d26d817388",
  }),
});

const EXPECTED_SOURCE_COMMITMENT =
  "0xe87f5edc2dc839bd87a26a80cb53f14b021e603a1753d27aae3a02862058d730";
const EXPECTED_OWNER_DATA_HASH =
  "0x3ba04469085b17e12843a94c154a335c9c384837f8f6531f179cb4915fd237d9";
const EXPECTED_OWNER_DATA_BYTES = 33_412;
const EXPECTED_ROUTER_CONSTRUCTOR = Object.freeze([
  "0xeD617CE7f82e2AB589aDeFFD319D1D872Bc8De06",
  "0x0B6b3F40f84Df25D3bd69238f937096177DD09Bd",
  "0x8366a39CC670B4001A1121B8F6A443A643e40951",
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sortedKeys(value) {
  return Object.keys(value ?? {}).sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
}

function assertExactKeys(value, expected, label) {
  const actual = sortedKeys(value);
  const wanted = [...expected].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  assert(
    JSON.stringify(actual) === JSON.stringify(wanted),
    `${label} keys differ`,
  );
}

export function canonicalizeJson(value) {
  if (Array.isArray(value)) return value.map(canonicalizeJson);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    sortedKeys(value).map((key) => [key, canonicalizeJson(value[key])]),
  );
}

export function canonicalJsonBytes(value) {
  return Buffer.from(`${JSON.stringify(canonicalizeJson(value))}\n`, "utf8");
}

export function sha256Hex(value) {
  return `0x${createHash("sha256").update(value).digest("hex")}`;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalizeJson(value));
}

function canonicalAbi(value) {
  return value.map(canonicalizeJson).sort((left, right) => {
    const leftJson = JSON.stringify(left);
    const rightJson = JSON.stringify(right);
    return leftJson < rightJson ? -1 : leftJson > rightJson ? 1 : 0;
  });
}

function resolveImport(sourceUnit, imported, remappings) {
  if (imported.startsWith(".")) {
    return path.posix.normalize(
      path.posix.join(path.posix.dirname(sourceUnit), imported),
    );
  }
  const matches = remappings
    .map((remapping) => {
      const separator = remapping.indexOf("=");
      return [remapping.slice(0, separator), remapping.slice(separator + 1)];
    })
    .filter(([prefix]) => imported.startsWith(prefix))
    .sort(([left], [right]) => right.length - left.length);
  if (matches.length > 0) {
    const [prefix, replacement] = matches[0];
    return path.posix.normalize(
      `${replacement}${imported.slice(prefix.length)}`,
    );
  }
  return path.posix.normalize(imported);
}

function sourceImports(content) {
  return [
    ...content.matchAll(
      /\bimport\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']\s*;/gu,
    ),
  ].map((match) => match[1]);
}

export function assertCompleteSourceClosure(input, artifact) {
  const sourceUnits = sortedKeys(input.sources);
  assert(
    sourceUnits.length === artifact.sourceCount,
    `${artifact.key} source closure count drift`,
  );
  for (const sourceUnit of sourceUnits) {
    const descriptor = input.sources[sourceUnit];
    assertExactKeys(
      descriptor,
      ["content"],
      `${artifact.key} source ${sourceUnit}`,
    );
    assert(
      typeof descriptor.content === "string" && descriptor.content.length > 0,
      `${artifact.key} source ${sourceUnit} is empty`,
    );
  }

  const reachable = new Set();
  const visit = (sourceUnit) => {
    if (reachable.has(sourceUnit)) return;
    const source = input.sources[sourceUnit];
    assert(source, `${artifact.key} source closure is missing ${sourceUnit}`);
    reachable.add(sourceUnit);
    for (const imported of sourceImports(source.content)) {
      const resolved = resolveImport(
        sourceUnit,
        imported,
        input.settings.remappings,
      );
      assert(
        input.sources[resolved],
        `${artifact.key} import is outside its source closure: ${resolved}`,
      );
      visit(resolved);
    }
  };
  visit(artifact.sourceUnit);
  assert(
    reachable.size === sourceUnits.length,
    `${artifact.key} source closure contains unreachable source units`,
  );
}

export function validateCanonicalStandardJsonBytes(
  bytes,
  artifact,
  expectedSha256 = artifact.sha256,
) {
  assert(
    Buffer.isBuffer(bytes) && bytes.length > 0,
    `${artifact.key} Standard JSON bytes are unavailable`,
  );
  assert(
    sha256Hex(bytes) === expectedSha256,
    `${artifact.key} Standard JSON SHA-256 drift`,
  );
  const input = JSON.parse(bytes.toString("utf8"));
  assert(
    canonicalJsonBytes(input).equals(bytes),
    `${artifact.key} Standard JSON is not canonical byte-for-byte`,
  );
  assertExactKeys(
    input,
    ["language", "settings", "sources"],
    `${artifact.key} Standard JSON`,
  );
  assert(input.language === "Solidity", `${artifact.key} language drift`);
  assert(
    canonicalJson(input.settings) ===
      canonicalJson(EXPECTED_COMPILER_INPUT_SETTINGS),
    `${artifact.key} compiler settings drift`,
  );
  assertCompleteSourceClosure(input, artifact);
  assert(
    sha256Hex(Buffer.from(input.sources[artifact.sourceUnit].content)) ===
      artifact.sourceSha256,
    `${artifact.key} target source SHA-256 drift`,
  );
  return input;
}

export async function assertSourceClosureMatchesCheckout(input, artifact) {
  for (const [sourceUnit, descriptor] of Object.entries(input.sources)) {
    const sourcePath = path.resolve(contractsRoot, sourceUnit);
    const relativePath = path.relative(contractsRoot, sourcePath);
    assert(
      relativePath !== "" &&
        !relativePath.startsWith("..") &&
        !path.isAbsolute(relativePath),
      `${artifact.key} source path escapes the contracts root`,
    );
    const checkoutBytes = await readFile(sourcePath);
    assert(
      checkoutBytes.equals(Buffer.from(descriptor.content, "utf8")),
      `${artifact.key} tracked source byte drift at ${sourceUnit}`,
    );
  }
}

export function assertPinnedCompilerProfile(compiler) {
  assert(
    canonicalJson(compiler) === canonicalJson(EXPECTED_COMPILER_PROFILE),
    "Robinhood compiler pin drift",
  );
}

async function resolvePinnedCompiler(profile, solcPath) {
  assertPinnedCompilerProfile(profile.compiler);
  const selectedPath =
    solcPath ??
    process.env.ROBINHOOD_SOLC_0_8_26_PATH ??
    path.join(os.homedir(), ".local/bin/solc");
  const compilerBytes = await readFile(selectedPath);
  assert(
    sha256Hex(compilerBytes) === profile.compiler.binarySha256,
    "Pinned solc binary SHA-256 drift",
  );
  const version = spawnSync(selectedPath, ["--version"], { encoding: "utf8" });
  assert(version.status === 0, version.stderr || "Pinned solc version failed");
  assert(
    version.stdout.includes("0.8.26+commit.8a97fa7a.Darwin.appleclang"),
    "Pinned solc version drift",
  );
  return { path: selectedPath, version: version.stdout.trim() };
}

async function compileStandardJson(bytes, compiler, artifact) {
  const compileDirectory = await mkdtemp(
    path.join(os.tmpdir(), `robinhood-${artifact.key}-solc-`),
  );
  try {
    const compilation = spawnSync(compiler.path, ["--standard-json"], {
      cwd: compileDirectory,
      input: bytes,
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
    });
    assert(
      compilation.status === 0,
      compilation.stderr || `${artifact.key} pinned compilation failed`,
    );
    const output = JSON.parse(compilation.stdout);
    const errors = (output.errors ?? []).filter(
      ({ severity }) => severity === "error",
    );
    assert(
      errors.length === 0,
      `${artifact.key} pinned compilation errors: ${JSON.stringify(errors)}`,
    );
    const compiled =
      output.contracts?.[artifact.sourceUnit]?.[artifact.contractName];
    assert(compiled, `${artifact.key} compiled target is missing`);
    return compiled;
  } finally {
    await rm(compileDirectory, { recursive: true, force: true });
  }
}

function bytecodeHex(value, label) {
  const normalized = value?.startsWith("0x") ? value : `0x${value ?? ""}`;
  assert(/^0x[0-9a-f]+$/iu.test(normalized), `${label} is not linked hex`);
  return normalized;
}

function equalAddress(left, right) {
  return left?.toLowerCase() === right?.toLowerCase();
}

function assertArtifactManifestBindings(profile, deployment, artifact) {
  const profileSource = profile.sources?.[artifact.key];
  const deploymentKey =
    artifact.key === "router" ? "programmableLaunchStampRouter" : artifact.key;
  const deploymentContract = deployment.contracts?.[deploymentKey];
  assert(
    profileSource?.standardJsonInputPath === artifact.path &&
      profileSource?.standardJsonInputSha256 === artifact.sha256,
    `${artifact.key} chain-profile Standard JSON binding drift`,
  );
  assert(
    deploymentContract?.standardJsonInputPath === artifact.path &&
      deploymentContract?.standardJsonInputSha256 === artifact.sha256,
    `${artifact.key} predeployment Standard JSON binding drift`,
  );
  assert(
    profileSource.sha256 === artifact.sourceSha256 &&
      profileSource.abiSha256 === artifact.abiSha256,
    `${artifact.key} source or ABI commitment drift`,
  );
}

function compiledCode(compiled, artifact) {
  const creationCode = bytecodeHex(
    compiled.evm?.bytecode?.object,
    `${artifact.key} creation bytecode`,
  );
  const runtimeCode = bytecodeHex(
    compiled.evm?.deployedBytecode?.object,
    `${artifact.key} runtime bytecode`,
  );
  assert(
    canonicalJson(compiled.evm.bytecode.linkReferences ?? {}) === "{}" &&
      canonicalJson(compiled.evm.deployedBytecode.linkReferences ?? {}) ===
        "{}",
    `${artifact.key} unexpectedly requires library linking`,
  );
  return { creationCode, runtimeCode };
}

function routerConstructorArguments(deployment) {
  const constructor =
    deployment.contracts.programmableLaunchStampRouter.constructor;
  assert(
    Array.isArray(constructor) &&
      constructor.length === EXPECTED_ROUTER_CONSTRUCTOR.length &&
      constructor.every((value, index) =>
        equalAddress(value, EXPECTED_ROUTER_CONSTRUCTOR[index]),
      ),
    "Router constructor input drift",
  );
  return encodeAbiParameters(
    parseAbiParameters("address,address,address"),
    constructor,
  );
}

export function verifyCompiledCommitments({
  profile,
  deployment,
  compilations,
}) {
  const graph = ROBINHOOD_STANDARD_JSON_ARTIFACTS.graphFactory;
  const router = ROBINHOOD_STANDARD_JSON_ARTIFACTS.router;
  const graphCode = compiledCode(compilations.graphFactory, graph);
  const routerCode = compiledCode(compilations.router, router);
  const graphProfile = profile.contracts.programmable.graphFactory;
  const graphDeployment = deployment.contracts.graphFactory;
  const routerProfile =
    profile.contracts.programmable.programmableLaunchStampRouter;
  const routerDeployment = deployment.contracts.programmableLaunchStampRouter;

  const graphCreationCodeHash = keccak256(graphCode.creationCode);
  const graphRuntimeCodeHash = keccak256(graphCode.runtimeCode);
  assert(
    graphCreationCodeHash === graph.baseCreationCodeHash &&
      graphCreationCodeHash === graphProfile.creationCodeHash &&
      graphCreationCodeHash === graphDeployment.creationCodeHash,
    "GraphFactory creation code commitment drift",
  );
  assert(
    graphRuntimeCodeHash === graph.baseRuntimeCodeHash &&
      graphRuntimeCodeHash === graphProfile.runtimeCodeHash &&
      graphRuntimeCodeHash === graphDeployment.expectedRuntimeCodeHash,
    "GraphFactory runtime code commitment drift",
  );

  const routerBaseCreationCodeHash = keccak256(routerCode.creationCode);
  const routerBaseRuntimeCodeHash = keccak256(routerCode.runtimeCode);
  assert(
    routerBaseCreationCodeHash === router.baseCreationCodeHash &&
      routerBaseCreationCodeHash === routerProfile.baseCreationCodeHash &&
      routerBaseCreationCodeHash === routerDeployment.baseCreationCodeHash,
    "Router base creation code commitment drift",
  );
  assert(
    routerBaseRuntimeCodeHash === router.baseRuntimeCodeHash &&
      routerBaseRuntimeCodeHash === routerProfile.baseRuntimeCodeHash &&
      routerBaseRuntimeCodeHash === routerDeployment.baseRuntimeCodeHash,
    "Router base runtime code commitment drift",
  );

  const constructorArguments = routerConstructorArguments(deployment);
  const routerCreationCode = concatHex([
    routerCode.creationCode,
    constructorArguments,
  ]);
  const routerCreationCodeHash = keccak256(routerCreationCode);
  assert(
    routerCreationCodeHash === router.constructorAppendedCreationCodeHash &&
      routerCreationCodeHash === routerProfile.creationCodeHash &&
      routerCreationCodeHash ===
        routerProfile.constructorAppendedCreationCodeHash &&
      routerCreationCodeHash === routerDeployment.creationCodeHash &&
      routerCreationCodeHash ===
        routerDeployment.constructorAppendedCreationCodeHash,
    "Router constructor-appended creation code commitment drift",
  );
  assert(
    routerProfile.runtimeCodeHash === router.deployedRuntimeCodeHash &&
      routerDeployment.expectedRuntimeCodeHash ===
        router.deployedRuntimeCodeHash,
    "Router deployed runtime commitment drift",
  );

  return {
    graph: {
      creationCode: graphCode.creationCode,
      creationCodeHash: graphCreationCodeHash,
      runtimeCodeHash: graphRuntimeCodeHash,
    },
    router: {
      baseCreationCode: routerCode.creationCode,
      baseCreationCodeHash: routerBaseCreationCodeHash,
      baseRuntimeCodeHash: routerBaseRuntimeCodeHash,
      constructorArguments,
      creationCode: routerCreationCode,
      constructorAppendedCreationCodeHash: routerCreationCodeHash,
    },
  };
}

export function computeFoundationSourceCommitment(profile, deployment) {
  const poolManager = profile.contracts.uniswap.poolManager.address;
  const multicall3 =
    profile.contracts.deploymentInfrastructure.multicall3.address;
  const graph = deployment.contracts.graphFactory;
  const router = deployment.contracts.programmableLaunchStampRouter;
  const dependencyCommitment = keccak256(
    encodeAbiParameters(parseAbiParameters("address,address"), [
      poolManager,
      multicall3,
    ]),
  );
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters(
        "bytes32,uint256,bytes32,address,address,address,bytes32,bytes20,bytes32,bytes20,bytes32,uint256,bytes32,bytes32",
      ),
      [
        keccak256(
          stringToHex("programmable.robinhood.custom-launch.foundation.v1"),
        ),
        BigInt(profile.chainId),
        keccak256(stringToHex(profile.caip2)),
        deployment.contracts.permitAuthority.address,
        graph.address,
        router.address,
        dependencyCommitment,
        `0x${profile.sources.router.commit}`,
        profile.sources.router.sha256,
        `0x${profile.sources.graphFactory.commit}`,
        profile.sources.graphFactory.sha256,
        BigInt(profile.permitAuthorityConfiguration.safeSaltNonce),
        graph.create2Salt,
        router.create2Salt,
      ],
    ),
  );
}

async function readManifest(relativePath) {
  return JSON.parse(await readFile(path.join(repositoryRoot, relativePath)));
}

export async function generateCanonicalStandardJsonInputs({
  write = false,
} = {}) {
  const generated = {};
  for (const artifact of Object.values(ROBINHOOD_STANDARD_JSON_ARTIFACTS)) {
    const result = spawnSync(
      "forge",
      [
        "verify-contract",
        artifact.address,
        artifact.fqcn,
        "--chain",
        "4663",
        "--compiler-version",
        "0.8.26",
        "--num-of-optimizations",
        "1000",
        "--evm-version",
        "cancun",
        "--show-standard-json-input",
      ],
      {
        cwd: contractsRoot,
        encoding: "utf8",
        maxBuffer: 512 * 1024 * 1024,
      },
    );
    assert(
      result.status === 0,
      result.stderr || `${artifact.key} Forge input failed`,
    );
    const bytes = canonicalJsonBytes(JSON.parse(result.stdout));
    validateCanonicalStandardJsonBytes(bytes, artifact);
    await assertSourceClosureMatchesCheckout(JSON.parse(bytes), artifact);
    if (write) {
      const destination = path.join(repositoryRoot, artifact.path);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, bytes);
    }
    generated[artifact.key] = {
      path: artifact.path,
      sha256: sha256Hex(bytes),
      bytes: bytes.length,
      sources: Object.keys(JSON.parse(bytes).sources).length,
    };
  }
  return generated;
}

export async function verifyRobinhoodStandardJsonInputs({ solcPath } = {}) {
  const [profile, deployment] = await Promise.all([
    readManifest("contracts/spec/robinhood-custom-launch/chain-4663.v1.json"),
    readManifest(
      "contracts/deployments/robinhood-custom-launch-v1.predeployment.json",
    ),
  ]);
  assertPinnedCompilerProfile(profile.compiler);
  assert(
    profile.chainId === "4663" &&
      profile.caip2 === "eip155:4663" &&
      deployment.chainId === "4663" &&
      deployment.caip2 === "eip155:4663",
    "Robinhood manifest chain binding drift",
  );
  assert(
    deployment.chainDeploymentDescriptorDigest === null &&
      deployment.state === "prepared-not-broadcast" &&
      deployment.live === false,
    "Robinhood predeployment state drift",
  );

  const inputs = {};
  const bytes = {};
  for (const artifact of Object.values(ROBINHOOD_STANDARD_JSON_ARTIFACTS)) {
    assertArtifactManifestBindings(profile, deployment, artifact);
    const artifactBytes = await readFile(
      path.join(repositoryRoot, artifact.path),
    );
    const input = validateCanonicalStandardJsonBytes(artifactBytes, artifact);
    await assertSourceClosureMatchesCheckout(input, artifact);
    inputs[artifact.key] = input;
    bytes[artifact.key] = artifactBytes;
  }

  const sourceCommitment = computeFoundationSourceCommitment(
    profile,
    deployment,
  );
  assert(
    sourceCommitment === EXPECTED_SOURCE_COMMITMENT &&
      sourceCommitment === profile.sourceCommitment &&
      sourceCommitment === deployment.foundationSourceCommitment,
    "Foundation source commitment drift",
  );

  const compiler = await resolvePinnedCompiler(profile, solcPath);
  const compilations = Object.fromEntries(
    await Promise.all(
      Object.values(ROBINHOOD_STANDARD_JSON_ARTIFACTS).map(async (artifact) => [
        artifact.key,
        await compileStandardJson(bytes[artifact.key], compiler, artifact),
      ]),
    ),
  );
  const commitments = verifyCompiledCommitments({
    profile,
    deployment,
    compilations,
  });

  for (const artifact of Object.values(ROBINHOOD_STANDARD_JSON_ARTIFACTS)) {
    const forgeArtifact = JSON.parse(
      await readFile(path.join(repositoryRoot, artifact.outArtifactPath)),
    );
    assert(
      sha256Hex(canonicalJsonBytes(forgeArtifact.abi)) === artifact.abiSha256,
      `${artifact.key} committed Forge ABI drift`,
    );
    assert(
      canonicalJson(canonicalAbi(forgeArtifact.abi)) ===
        canonicalJson(canonicalAbi(compilations[artifact.key].abi)),
      `${artifact.key} compiled ABI differs from committed Forge ABI`,
    );
  }

  const prepared = await prepareOwnerTransaction(
    "0x032b1c7b96793717F0BD2f11eb86cd10CdefC4a3",
  );
  assert(
    prepared.dataHash === EXPECTED_OWNER_DATA_HASH &&
      prepared.dataHash === profile.preparedOwnerTransaction.dataHash &&
      prepared.dataHash === deployment.atomicOwnerTransaction.dataHash &&
      prepared.dataBytes === EXPECTED_OWNER_DATA_BYTES &&
      prepared.dataBytes === profile.preparedOwnerTransaction.dataBytes &&
      prepared.dataBytes === deployment.atomicOwnerTransaction.dataBytes,
    "Atomic owner transaction commitment drift",
  );
  assert(
    prepared.decodedComponentCalls[1].data.toLowerCase() ===
      concatHex([
        deployment.contracts.graphFactory.create2Salt,
        commitments.graph.creationCode,
      ]).toLowerCase(),
    "GraphFactory component calldata differs from pinned compilation",
  );
  assert(
    prepared.decodedComponentCalls[2].data.toLowerCase() ===
      concatHex([
        deployment.contracts.programmableLaunchStampRouter.create2Salt,
        commitments.router.creationCode,
      ]).toLowerCase(),
    "Router component calldata differs from pinned compilation",
  );

  return {
    profile,
    deployment,
    inputs,
    compilations,
    compiler,
    commitments,
    sourceCommitment,
    ownerTransaction: {
      dataHash: prepared.dataHash,
      dataBytes: prepared.dataBytes,
    },
    artifacts: Object.fromEntries(
      Object.values(ROBINHOOD_STANDARD_JSON_ARTIFACTS).map((artifact) => [
        artifact.key,
        {
          path: artifact.path,
          sha256: artifact.sha256,
          bytes: bytes[artifact.key].length,
          sources: Object.keys(inputs[artifact.key].sources).length,
        },
      ]),
    ),
  };
}
