#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = join(root, "artifacts/router-vnext-universal-v1");
const mode = process.argv[2];
if (mode !== "--write" && mode !== "--check") {
  throw new Error("usage: generate-router-vnext-universal-artifact.mjs --write|--check");
}

const productionSources = [
  "src/router_vnext/IProgrammableUniversalLaunchKernelV1.sol",
  "src/router_vnext/IProgrammableUniversalLaunchPreflightV1.sol",
  "src/router_vnext/IProgrammableNestedFactoryProfileV1.sol",
  "src/router_vnext/ProgrammableUniversalLaunchKernelV1.sol",
  "src/router_vnext/ProgrammableUniversalLaunchPreflightV1.sol",
  "src/router_vnext/ProgrammableNestedFactoryProfileV1.sol",
];
const evidenceFiles = [
  ...productionSources,
  "test/router_vnext/ProgrammableUniversalLaunchKernelV1.t.sol",
  "config/router-vnext/foundry.toml",
  "scripts/generate-router-vnext-universal-artifact.mjs",
  "scripts/verify-router-vnext-universal-v1.sh",
];
const contracts = [
  {
    name: "ProgrammableUniversalLaunchKernelV1",
    source: "src/router_vnext/ProgrammableUniversalLaunchKernelV1.sol",
  },
  {
    name: "ProgrammableUniversalLaunchPreflightV1",
    source: "src/router_vnext/ProgrammableUniversalLaunchPreflightV1.sol",
  },
  {
    name: "ProgrammableNestedFactoryProfileV1",
    source: "src/router_vnext/ProgrammableNestedFactoryProfileV1.sol",
  },
];

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const stableJson = (value) => `${JSON.stringify(value, null, 2)}\n`;
const read = (path) => readFileSync(join(root, path));
const castKeccak = (value) => execFileSync("cast", ["keccak", value], { encoding: "utf8" }).trim();

const resolveSolc = () => {
  const pathLookup = spawnSync("which", ["solc"], { encoding: "utf8" });
  const candidates = [
    pathLookup.status === 0 ? pathLookup.stdout.trim() : "",
    join(homedir(), ".svm", "0.8.26", "solc-0.8.26"),
  ];
  for (const path of candidates) {
    if (!path) continue;
    const probe = spawnSync(path, ["--version"], { encoding: "utf8" });
    if (probe.status === 0 && probe.stdout.includes("Version: 0.8.26+commit.8a97fa7a")) {
      return { path, version: probe.stdout.trim() };
    }
  }
  throw new Error("solc 0.8.26 was not found on PATH or in the Foundry SVM cache");
};

const sourceContents = Object.fromEntries(
  productionSources.map((path) => [path, { content: read(path).toString("utf8") }]),
);
const standardInput = {
  language: "Solidity",
  sources: sourceContents,
  settings: {
    optimizer: { enabled: true, runs: 100 },
    evmVersion: "cancun",
    viaIR: false,
    metadata: { bytecodeHash: "none", appendCBOR: false },
    libraries: {},
    remappings: [],
    outputSelection: {
      "*": {
        "*": [
          "abi",
          "evm.bytecode.object",
          "evm.deployedBytecode.object",
          "evm.deployedBytecode.immutableReferences",
          "evm.methodIdentifiers",
        ],
      },
    },
  },
};
const standardInputBytes = Buffer.from(stableJson(standardInput));

const { path: solcPath, version: solcVersion } = resolveSolc();
const compilation = spawnSync(solcPath, ["--standard-json"], {
  input: standardInputBytes,
  encoding: "utf8",
  maxBuffer: 128 * 1024 * 1024,
});
if (compilation.status !== 0) throw new Error(compilation.stderr || "solc failed");
const jsonStart = compilation.stdout.indexOf("{");
if (jsonStart < 0) throw new Error("solc returned no JSON");
const compilerOutput = JSON.parse(compilation.stdout.slice(jsonStart));
const compilerErrors = (compilerOutput.errors ?? []).filter((entry) => entry.severity === "error");
if (compilerErrors.length !== 0) throw new Error(stableJson(compilerErrors));

const abiOutputs = {};
const codeIdentities = {};
const selectorMaps = {};
for (const contract of contracts) {
  const compiled = compilerOutput.contracts?.[contract.source]?.[contract.name];
  if (!compiled) throw new Error(`missing compiler output: ${contract.name}`);
  const abiBytes = Buffer.from(stableJson(compiled.abi));
  const abiPath = `artifacts/router-vnext-universal-v1/${contract.name}.abi.json`;
  abiOutputs[abiPath] = abiBytes;
  const creationObject = compiled.evm.bytecode.object;
  const runtimeObject = compiled.evm.deployedBytecode.object;
  if (!/^[0-9a-f]*$/i.test(creationObject) || !/^[0-9a-f]*$/i.test(runtimeObject)) {
    throw new Error(`non-hex bytecode: ${contract.name}`);
  }
  const creationBytes = Buffer.from(creationObject, "hex");
  const runtimeBytes = Buffer.from(runtimeObject, "hex");
  const runtimeMarginBytes = 24_576 - runtimeBytes.length;
  if (runtimeMarginBytes < 512) {
    throw new Error(`${contract.name} EIP-170 margin ${runtimeMarginBytes} is below 512 bytes`);
  }
  if (creationBytes.length > 49_152) throw new Error(`${contract.name} exceeds EIP-3860`);
  codeIdentities[contract.name] = {
    source: contract.source,
    abiPath,
    abiSha256: sha256(abiBytes),
    creationBytes: creationBytes.length,
    creationSha256: sha256(creationBytes),
    creationKeccak256: castKeccak(`0x${creationObject}`),
    runtimeTemplateBytes: runtimeBytes.length,
    runtimeTemplateMarginBytes: runtimeMarginBytes,
    runtimeTemplateSha256: sha256(runtimeBytes),
    runtimeTemplateKeccak256: castKeccak(`0x${runtimeObject}`),
    immutableReferences: compiled.evm.deployedBytecode.immutableReferences ?? {},
    liveRuntimeCodeHash: null,
    deploymentAddress: null,
  };
  selectorMaps[contract.name] = Object.fromEntries(
    Object.entries(compiled.evm.methodIdentifiers)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([signature, selector]) => [signature, `0x${selector}`]),
  );
}

const forbiddenArgument = /(target|selector|calldata|callData|initcode|initCode|arbitrary)/;
for (const [abiPath, abiBytes] of Object.entries(abiOutputs)) {
  const abi = JSON.parse(abiBytes);
  for (const entry of abi) {
    if (entry.type === "fallback" || entry.type === "receive") throw new Error(`open fallback surface: ${abiPath}`);
    if (entry.type !== "function") continue;
    if (entry.stateMutability === "payable" && entry.name !== "launchNestedFactoryV1") {
      throw new Error(`unexpected payable function: ${entry.name}`);
    }
    const visit = (component) => {
      if (forbiddenArgument.test(component.name ?? "")) throw new Error(`forbidden ABI argument: ${component.name}`);
      if (component.type === "function") throw new Error(`function-typed ABI argument: ${component.name}`);
      if (component.type === "bytes" && !/signature/i.test(component.name ?? "")) {
        throw new Error(`non-signature dynamic bytes argument: ${component.name}`);
      }
      for (const child of component.components ?? []) visit(child);
    };
    for (const input of entry.inputs ?? []) visit(input);
  }
}

const typehashes = {};
const typehashPattern = /bytes32\s+(?:public|private)\s+constant\s+([A-Z0-9_]*TYPEHASH)\s*=\s*keccak256\(\s*"([^"]+)"\s*\);/gs;
for (const path of productionSources) {
  const source = sourceContents[path].content;
  const rows = {};
  for (const match of source.matchAll(typehashPattern)) {
    if (rows[match[1]]) throw new Error(`duplicate typehash constant in ${path}: ${match[1]}`);
    rows[match[1]] = { preimage: match[2], value: castKeccak(match[2]) };
  }
  if (Object.keys(rows).length !== 0) typehashes[path] = rows;
}
const typehashCount = Object.values(typehashes).reduce((sum, rows) => sum + Object.keys(rows).length, 0);
if (typehashCount < 20) throw new Error(`unexpectedly small typehash set: ${typehashCount}`);

const profiles = [
  ["COMPLETED_GRAPH_ADOPTION", "DENY_FROZEN_EA0_CONSUMER_ONLY_NO_SILENT_MIGRATION"],
  ["DIRECT_GRAPH", "DENY_PENDING_TYPED_PROFILE_ARTIFACT"],
  ["EXISTING_ASSET_NEW_V4_POOL", "DENY_PENDING_TYPED_PROFILE_ARTIFACT"],
  ["NESTED_FACTORY", "DENY_SOURCE_ARTIFACT_ONLY_DEPLOYMENT_AND_AUTHORITY_UNBOUND"],
  ["OPTIONAL_COMPONENT_GRAPH", "DENY_PENDING_TYPED_PROFILE_ARTIFACT"],
  ["TEMPLATE_PROVIDER_LAUNCH", "DENY_PENDING_TYPED_PROFILE_ARTIFACT"],
].map(([architecture, status]) => ({
  architecture,
  status,
  deploymentBinding: null,
  profileCapabilityBinding: null,
  activationAllowed: false,
}));

const artifact = {
  schemaVersion: "router-vnext-universal-artifact-v1",
  packageVersion: "1.0.0-source-only",
  lifecycle: {
    launchGrant: "EVERGREEN_ACTIVE_REVOKED_CONSUMED_NO_APPLICANT_TTL",
    currentness: "REVIEWER_AUTHENTICATED_MAX_3600_SECONDS_INTERNAL_TRANSPORT_ONLY",
    walletIntent: "APPLICANT_AUTHENTICATED_MAX_900_SECONDS",
    signedExecutionMode: true,
    globalInTransactionExecutionLock: true,
    permanentWinnerNonceAndKey: true,
    sourceLaunchIdStampLaunchIdAntiReplayNoncePairwiseDistinct: true,
    atomicTypedPreflight: true,
  },
  surface: {
    arbitraryTarget: false,
    arbitrarySelector: false,
    arbitraryCalldata: false,
    arbitraryInitcode: false,
    delegatecall: false,
    genericExecutor: false,
    onlyPayableApplicantEntry: "launchNestedFactoryV1",
    externalCalls: "FIXED_CODEHASH_PINNED_BOUNDED_PROVIDER_VERIFIER_PREFLIGHT_AND_ERC1271_ONLY",
  },
  compiler: {
    version: solcVersion,
    binarySha256: sha256(readFileSync(solcPath)),
    settings: standardInput.settings,
    standardInputPath: "artifacts/router-vnext-universal-v1/standard-input.json",
    standardInputSha256: sha256(standardInputBytes),
  },
  sources: Object.fromEntries(evidenceFiles.map((path) => [path, { sha256: sha256(read(path)) }])),
  codeIdentities,
  selectors: selectorMaps,
  typehashes,
  typehashCount,
  profiles,
  frozenPredecessors: {
    completedGraphContract: {
      commit: "ea0e4424b886a0c1ae928fc73d62bd8e907b44cd",
      tree: "8c5e0822d7ff256cad3d9e0350c980473d36aecc",
      artifactSha256: "f9d110d2850c4934ba0c22493eaa9d0f090bee6f0e6a1339ee3002344da1065a",
      migration: "FORBIDDEN_WITHOUT_NEW_REVIEWED_PROFILE_AND_AUTHORITY_BINDING",
    },
    authorityV3: {
      commit: "a017d750fc3ad0805614487a7387c7e195b65bd0",
      tree: "e54f9835068973befd79203aad98aee82552996c",
      bundleSha256: "7ccb8b73a2c35a803b31c8c4cca25e84b4c138ee5f61510eb182064a041a1886",
      compatibility: "PREDECESSOR_EVIDENCE_ONLY_NEW_AUTHORITY_VERSION_REQUIRED",
    },
  },
  sourceReferents: {
    applicantRequestA: "APPLICANT_ID_AND_REVIEWER_ATTESTATION_LINEAGE",
    executableMeasuredB: "RAW_BYTES20_SOURCE_COMMIT_AND_TREE_IN_GRANT_COBOUND_WITH_PLAN_HASH",
    carrierEvidenceC: "BUILDER_EVIDENCE_ONLY_NEVER_SUBSTITUTES_A_OR_B",
  },
  deployment: {
    state: "UNDEPLOYED",
    activation: "DENY",
    chainId: null,
    addresses: null,
    specializedRuntimeCodeHashes: null,
    creationTransactions: null,
    sourceVerificationReceipts: null,
    finalityReceipts: null,
    profileRegistrationReceipts: null,
    authorityV4Binding: null,
    requiredEnvironmentNames: [],
  },
  consumerBindings: {
    website: "HANDOFF_ONLY_NO_WEBSITE_WRITE",
    shards: "DENY_REAL_NESTED_FACTORY_PROVIDER_MODULE_AND_DEPLOYMENT_UNBOUND",
    hookemon: "DENY_REMAINS_ON_FROZEN_COMPLETED_GRAPH_ADOPT_CONSUMER_NO_MIGRATION",
    indexer: "OUT_OF_SCOPE_NO_INDEXER_WRITE",
  },
  releaseCommands: {
    artifactWrite: "node scripts/generate-router-vnext-universal-artifact.mjs --write",
    artifactCheck: "node scripts/generate-router-vnext-universal-artifact.mjs --check",
    frozenGate: "./scripts/verify-router-vnext-universal-v1.sh",
  },
  gitIdentity: "EXTERNAL_IMMUTABLE_COMMIT_AND_TREE_RECEIPT_REQUIRED",
  externalActionOccurred: false,
};

const outputs = {
  "artifacts/router-vnext-universal-v1/standard-input.json": standardInputBytes,
  ...abiOutputs,
  "artifacts/router-vnext-universal-v1/router-vnext-universal-v1.json": Buffer.from(stableJson(artifact)),
};

if (mode === "--write") mkdirSync(outputDir, { recursive: true });
for (const [path, expected] of Object.entries(outputs)) {
  const absolute = join(root, path);
  if (mode === "--write") {
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, expected);
  } else {
    let actual;
    try {
      actual = readFileSync(absolute);
    } catch {
      throw new Error(`missing generated artifact: ${relative(root, absolute)}`);
    }
    if (!actual.equals(expected)) throw new Error(`generated artifact drift: ${relative(root, absolute)}`);
  }
}

process.stdout.write(
  `${mode === "--write" ? "wrote" : "checked"} router-vnext universal artifact: `
    + `${sha256(outputs["artifacts/router-vnext-universal-v1/router-vnext-universal-v1.json"])}\n`,
);
