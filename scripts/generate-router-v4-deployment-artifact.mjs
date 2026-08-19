#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, normalize, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = join(root, "artifacts/router-v4-deployment-v1");
const mode = process.argv[2];
if (mode !== "--write" && mode !== "--check") {
  throw new Error("usage: generate-router-v4-deployment-artifact.mjs --write|--check");
}

const solcRelease = "0.8.26+commit.8a97fa7a";
const solcBinarySha256s = {
  "linux-amd64": "d5f23436f443edb85d8e76906d12f0a86ce0490e7663a9e608efeb7a93f149ef",
  "macosx-amd64": "0ff016aef2396b12d1fc65429d8ea6cf53c2ee4b041bb8925644615ee1c30ab9",
};
const coreArtifactPath = "artifacts/router-vnext-universal-v1/router-vnext-universal-v1.json";
const expectedCoreArtifactSha256 = "d1b805b0b8165e28105fd331e358fba70c7c0be9db0dcee4023924b84dfcd250";

const remappings = [
  ["@openzeppelin/contracts/", "lib/openzeppelin-contracts/contracts/"],
  ["@openzeppelin/uniswap-hooks/", "lib/openzeppelin-uniswap-hooks/"],
  ["@solady/", "lib/solady/"],
  ["@uniswap/v4-core/", "lib/v4-core/"],
  ["@uniswap/v4-periphery/", "lib/v4-periphery/"],
  ["programmable-src/", "src/"],
  ["shards-v1/", "lib/shards-v1/"],
  ["solady/", "lib/solady/src/"],
];

const coreContracts = [
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

const deploymentContracts = [
  {
    name: "ProgrammableCreate2GraphDeployerV1",
    source: "deployment/router-v4/src/ProgrammableCreate2GraphDeployerV1.sol",
  },
  {
    name: "ProgrammableRouterReviewerAuthorityV4",
    source: "deployment/router-v4/src/ProgrammableRouterAuthorityV4.sol",
  },
  {
    name: "ProgrammableRouterGovernanceAuthorityV4",
    source: "deployment/router-v4/src/ProgrammableRouterAuthorityV4.sol",
  },
  {
    name: "ProgrammableRouterFinalityAuthorityV4",
    source: "deployment/router-v4/src/ProgrammableRouterAuthorityV4.sol",
  },
  {
    name: "ProgrammableRouterIndexerAuthorityV4",
    source: "deployment/router-v4/src/ProgrammableRouterAuthorityV4.sol",
  },
  {
    name: "ProgrammableShardsHookCodeStoreV1",
    source: "deployment/router-v4/src/ProgrammableShardsHookCodeStoreV1.sol",
  },
  {
    name: "ProgrammableExactShardsNestedFactoryProviderV1",
    source: "deployment/router-v4/src/ProgrammableExactShardsNestedFactoryV1.sol",
  },
  {
    name: "ProgrammableExactShardsNestedFactoryVerifierV1",
    source: "deployment/router-v4/src/ProgrammableExactShardsNestedFactoryV1.sol",
  },
  {
    name: "ProgrammableExactShardsProfileV1",
    source: "src/ProgrammableExactShardsProfileV1.sol",
  },
  {
    name: "ProgrammableCompletedGraphAdoptionCompatCodecV1",
    source: "src/hookemon/ProgrammableCompletedGraphAdoptionCompatCodecV1.sol",
  },
  {
    name: "ProgrammableCompletedGraphAdoptionValidatorV1",
    source: "src/hookemon/ProgrammableCompletedGraphAdoptionValidatorV1.sol",
  },
  {
    name: "ProgrammableCompletedGraphAdoptionPreflightV1",
    source: "src/hookemon/ProgrammableCompletedGraphAdoptionPreflightV1.sol",
  },
  {
    name: "ProgrammableCompletedGraphRuntimeStateVerifierV1",
    source: "deployment/router-v4/src/ProgrammableCompletedGraphRuntimeStateVerifierV1.sol",
  },
  {
    name: "ShardLaunchFactoryV1",
    source: "lib/shards-v1/src/ShardLaunchFactoryV1.sol",
  },
];

// This constructor performs a closed-runtime scan across all seven dependencies.  At runs=1000 the exact
// Nick-CREATE2 transaction exceeds the child-call gas available under EIP-7825 after EIP-150 forwarding.
// The established runs=100 profile preserves the reviewed source and deterministic CREATE2 route while fitting
// the Mainnet transaction cap.  Keep this contract isolated so every compiler identity remains explicit.
const registryContracts = [
  {
    name: "ProgrammableCompletedGraphAdoptionGrantRegistryV1",
    source: "src/hookemon/ProgrammableCompletedGraphAdoptionGrantRegistryV1.sol",
  },
];

const evidenceFiles = [
  "deployment/router-v4/src/ProgrammableCreate2GraphDeployerV1.sol",
  "deployment/router-v4/src/ProgrammableRouterAuthorityV4.sol",
  "deployment/router-v4/src/ProgrammableShardsHookCodeStoreV1.sol",
  "deployment/router-v4/src/ProgrammableExactShardsNestedFactoryV1.sol",
  "deployment/router-v4/src/ProgrammableCompletedGraphRuntimeStateVerifierV1.sol",
  "deployment/router-v4/test/ProgrammableCreate2GraphDeployerV1.t.sol",
  "deployment/router-v4/test/ProgrammableRouterDeploymentV1.t.sol",
  "deployment/router-v4/test/ProgrammableExactShardsNestedFactoryFork.t.sol",
  "deployment/router-v4/test/ProgrammableRouterDeploymentMainnetFork.t.sol",
  "deployment/router-v4/foundry.toml",
  "scripts/generate-router-v4-deployment-artifact.mjs",
  "scripts/verify-router-v4-deployment-v1.sh",
  coreArtifactPath,
];

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const stableJson = (value) => `${JSON.stringify(value, null, 2)}\n`;
const read = (path) => readFileSync(join(root, path));
const castKeccak = (value) => execFileSync("cast", ["keccak", value], { encoding: "utf8" }).trim();
const slash = (path) => path.split(sep).join("/");

function resolveSolc() {
  const pathLookup = spawnSync("which", ["solc"], { encoding: "utf8" });
  const candidates = [
    join(homedir(), ".svm", "0.8.26", "solc-0.8.26"),
    join(homedir(), ".solc-select", "artifacts", "solc-0.8.26", "solc-0.8.26"),
    pathLookup.status === 0 ? pathLookup.stdout.trim() : "",
  ];
  for (const path of candidates) {
    if (!path) continue;
    const probe = spawnSync(path, ["--version"], { encoding: "utf8" });
    let binarySha256;
    try {
      binarySha256 = sha256(readFileSync(path));
    } catch {
      continue;
    }
    if (
      probe.status === 0 && probe.stdout.includes(`Version: ${solcRelease}`)
        && Object.values(solcBinarySha256s).includes(binarySha256)
    ) return path;
  }
  throw new Error("an official solc 0.8.26 binary was not found in a supported cache or on PATH");
}

function resolveImport(importer, specifier) {
  if (specifier.startsWith(".")) return slash(normalize(join(dirname(importer), specifier)));
  for (const [prefix, replacement] of remappings) {
    if (specifier.startsWith(prefix)) {
      return slash(normalize(join(replacement, specifier.slice(prefix.length))));
    }
  }
  return slash(normalize(specifier));
}

function collectSourceClosure(entries) {
  const sources = new Map();
  const pending = [...new Set(entries)].sort();
  while (pending.length !== 0) {
    const path = pending.shift();
    if (sources.has(path)) continue;
    const absolute = resolve(root, path);
    if (absolute !== root && !absolute.startsWith(`${root}${sep}`)) throw new Error(`source escapes repository: ${path}`);
    const content = readFileSync(absolute, "utf8");
    sources.set(path, { content });
    const importPattern = /import\s+(?:(?:[^"']*?)\s+from\s+)?["']([^"']+)["']\s*;/g;
    for (const match of content.matchAll(importPattern)) {
      const imported = resolveImport(path, match[1]);
      if (!sources.has(imported)) pending.push(imported);
    }
    pending.sort();
  }
  return Object.fromEntries([...sources.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function standardInput(entries, optimizerRuns) {
  return {
    language: "Solidity",
    sources: collectSourceClosure(entries),
    settings: {
      optimizer: { enabled: true, runs: optimizerRuns },
      evmVersion: "cancun",
      viaIR: false,
      metadata: { bytecodeHash: "none", appendCBOR: false },
      libraries: {},
      remappings: remappings.map(([prefix, replacement]) => `${prefix}=${replacement}`),
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
}

function compile(solcPath, input) {
  const bytes = Buffer.from(stableJson(input));
  const result = spawnSync(solcPath, ["--standard-json"], {
    input: bytes,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(result.stderr || "solc failed");
  const start = result.stdout.indexOf("{");
  if (start < 0) throw new Error("solc returned no JSON");
  const output = JSON.parse(result.stdout.slice(start));
  const errors = (output.errors ?? []).filter((entry) => entry.severity === "error");
  if (errors.length !== 0) throw new Error(stableJson(errors));
  return { bytes, output };
}

function contractOutput(compilation, contract) {
  const compiled = compilation.output.contracts?.[contract.source]?.[contract.name];
  if (!compiled) throw new Error(`missing compiler output: ${contract.source}:${contract.name}`);
  const creationObject = compiled.evm.bytecode.object;
  const runtimeObject = compiled.evm.deployedBytecode.object;
  if (!/^[0-9a-f]*$/iu.test(creationObject) || !/^[0-9a-f]*$/iu.test(runtimeObject)) {
    throw new Error(`non-hex bytecode: ${contract.name}`);
  }
  const creation = Buffer.from(creationObject, "hex");
  const runtime = Buffer.from(runtimeObject, "hex");
  if (creation.length > 49_152) throw new Error(`${contract.name} exceeds EIP-3860`);
  if (runtime.length > 24_576) throw new Error(`${contract.name} exceeds EIP-170`);
  return {
    source: contract.source,
    abi: compiled.abi,
    selectors: Object.fromEntries(
      Object.entries(compiled.evm.methodIdentifiers)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([signature, selector]) => [signature, `0x${selector}`]),
    ),
    creationBytes: creation.length,
    creationSha256: sha256(creation),
    creationKeccak256: castKeccak(`0x${creationObject}`),
    creationBytecode: `0x${creationObject}`,
    runtimeTemplateBytes: runtime.length,
    runtimeTemplateMarginBytes: 24_576 - runtime.length,
    runtimeTemplateSha256: sha256(runtime),
    runtimeTemplateKeccak256: castKeccak(`0x${runtimeObject}`),
    runtimeTemplate: `0x${runtimeObject}`,
    immutableReferences: compiled.evm.deployedBytecode.immutableReferences ?? {},
  };
}

const coreArtifactBytes = read(coreArtifactPath);
if (sha256(coreArtifactBytes) !== expectedCoreArtifactSha256) {
  throw new Error("frozen Router vNext core artifact digest drift");
}
const coreArtifact = JSON.parse(coreArtifactBytes);
const solcPath = resolveSolc();
const coreInput = standardInput(coreContracts.map(({ source }) => source), 100);
const deploymentInput = standardInput(deploymentContracts.map(({ source }) => source), 1_000);
const registryInput = standardInput(registryContracts.map(({ source }) => source), 100);
const coreCompilation = compile(solcPath, coreInput);
const deploymentCompilation = compile(solcPath, deploymentInput);
const registryCompilation = compile(solcPath, registryInput);

const compiledContracts = {};
for (const contract of coreContracts) {
  compiledContracts[contract.name] = { profile: "router-vnext-core-runs-100", ...contractOutput(coreCompilation, contract) };
  const frozen = coreArtifact.codeIdentities?.[contract.name];
  if (
    !frozen || frozen.creationKeccak256 !== compiledContracts[contract.name].creationKeccak256
      || frozen.runtimeTemplateKeccak256 !== compiledContracts[contract.name].runtimeTemplateKeccak256
  ) throw new Error(`frozen Router vNext code identity drift: ${contract.name}`);
}
for (const contract of deploymentContracts) {
  compiledContracts[contract.name] = {
    profile: "router-v4-deployment-runs-1000",
    ...contractOutput(deploymentCompilation, contract),
  };
}
for (const contract of registryContracts) {
  compiledContracts[contract.name] = {
    profile: "router-v4-registry-runs-100",
    ...contractOutput(registryCompilation, contract),
  };
}

if (
  compiledContracts.ShardLaunchFactoryV1.creationKeccak256
      !== "0xc6b8a2cd51ccf198c4e6e41f668c4e4f558f81de0e677ef27373c614bf4c02f8"
    || compiledContracts.ShardLaunchFactoryV1.runtimeTemplateKeccak256
      !== "0x5875d3528e57eb0a97807aa896a2e2385ebbaed0e21253255d6c79e91aabea50"
) {
  throw new Error(
    `frozen Shards factory code identity drift: creation=${compiledContracts.ShardLaunchFactoryV1.creationKeccak256} `
      + `runtime=${compiledContracts.ShardLaunchFactoryV1.runtimeTemplateKeccak256}`,
  );
}

const graphSourceSha256 = sha256(read("deployment/router-v4/src/ProgrammableCreate2GraphDeployerV1.sol"));
if (graphSourceSha256 !== "06a3acaf9beeb68647af231f5524c5a34dc013d99611a1b2d0a6c80895f595e9") {
  throw new Error("reviewed GraphDeployer source identity drift");
}

for (const name of [
  "ProgrammableRouterReviewerAuthorityV4",
  "ProgrammableRouterGovernanceAuthorityV4",
  "ProgrammableRouterFinalityAuthorityV4",
  "ProgrammableRouterIndexerAuthorityV4",
]) {
  const abi = compiledContracts[name].abi;
  if (abi.some((entry) => entry.type === "fallback" || entry.type === "receive")) {
    throw new Error(`open Authority fallback surface: ${name}`);
  }
  if (abi.some((entry) => entry.type === "function" && entry.stateMutability === "payable")) {
    throw new Error(`payable Authority surface: ${name}`);
  }
  if (abi.some((entry) => entry.type === "function" && /(target|selector|calldata|callData)/u.test(entry.name ?? ""))) {
    throw new Error(`generic Authority surface: ${name}`);
  }
}

const compiledContractsBytes = Buffer.from(stableJson({
  schemaVersion: "router-v4-compiled-contracts-v1",
  contracts: compiledContracts,
}));
const deploymentBytecodesBytes = Buffer.from(stableJson({
  schemaVersion: "router-v4-deployment-bytecodes-v1",
  contracts: Object.fromEntries(
    Object.entries(compiledContracts).map(([name, contract]) => [name, {
      profile: contract.profile,
      creationBytecode: contract.creationBytecode,
      creationKeccak256: contract.creationKeccak256,
      runtimeTemplateKeccak256: contract.runtimeTemplateKeccak256,
    }]),
  ),
}));
const deploymentBytecodeFiles = Object.fromEntries(
  Object.entries(compiledContracts).map(([name, contract]) => [
    `artifacts/router-v4-deployment-v1/bytecodes/${name}.json`,
    Buffer.from(stableJson({
      schemaVersion: "router-v4-contract-bytecode-v1",
      contractName: name,
      profile: contract.profile,
      creationBytecode: contract.creationBytecode,
      creationKeccak256: contract.creationKeccak256,
      runtimeTemplateKeccak256: contract.runtimeTemplateKeccak256,
    })),
  ]),
);
const coreInputBytes = coreCompilation.bytes;
const deploymentInputBytes = deploymentCompilation.bytes;
const registryInputBytes = registryCompilation.bytes;
const serviceReleaseBindingTypehash = castKeccak(
  "ProgrammableRouterV4ServiceReleaseBindingV2(bytes20 protectedMergeCommit,bytes32 coreArtifactSha256,bytes32 coreStandardInputSha256,bytes32 deploymentStandardInputSha256,bytes32 registryStandardInputSha256,bytes32 compiledContractsSha256)",
);
const serviceReleaseBinding = castKeccak(execFileSync(
  "cast",
  [
    "abi-encode",
    "f(bytes32,bytes20,bytes32,bytes32,bytes32,bytes32,bytes32)",
    serviceReleaseBindingTypehash,
    "0x7b06469be06a746150545a94ccfb3c4c5e959de3",
    `0x${expectedCoreArtifactSha256}`,
    `0x${sha256(coreInputBytes)}`,
    `0x${sha256(deploymentInputBytes)}`,
    `0x${sha256(registryInputBytes)}`,
    `0x${sha256(compiledContractsBytes)}`,
  ],
  { encoding: "utf8" },
).trim());
if (serviceReleaseBinding !== "0x32379de927d9a3ca4052037f3de19388566f0b79b26ea01b90d76f09c76f74b0") {
  throw new Error(`service release binding drift: ${serviceReleaseBinding}`);
}

const frozenTarget = ([contract, targetIdHash, applicantSalt, effectiveSalt, initCodeHash, address, runtimeCodeHash]) => ({
  contract,
  targetIdHash,
  applicantSalt,
  effectiveSalt,
  initCodeHash,
  address,
  runtimeCodeHash,
});
const graphTargets = {
  foundations: [
    ["ProgrammableShardsHookCodeStoreV1", "0x6e6a9598bb2bed26c81fb4fa14131b6b80e489f890f47a49684747e577bc5e05", "0xad41518f4f635becbb45f83ef5c6f316b119644ea8e56047e322e1da528f598b", "0x49c36905fdea3d3ecd14b0a4869b1b2a0a632c0303d0081d681103745b9b6723", "0xb711304edf75668cf38421eee2bfbc1cc8ca750f437bb7c0263ec268a652b195", "0x08454733f76112d3a1cE135629cCc19615e868b4", "0x888d919906e86d7e82e8f2c50ad07039d758feeee624237dc38ec012cafd293e"],
    ["ProgrammableExactShardsProfileV1", "0x3dbc5ce281e077a6f7b1595e52db57aa026742cfeb89d2424959458b913c50c8", "0xd8266512840a99cf1982658f6888e2d12b5e78f6ac80a680850bf653bdc7b78f", "0x3d9193673ca719d47126e4444cdb39bb3e306e53880746ba0f2f10a862feb4d2", "0xb4638678498ff8b2da30c1e694245e19802b54efd4f27cb6114595c3ac29b2b8", "0xfeE9dC855228Aa3BB61D3f9E598A516643f9c6D6", "0xd0c75719f16ac181d3d1b51725d7a0aff1c61132140f948f321736c6ef14ee49"],
    ["ProgrammableRouterReviewerAuthorityV4", "0xfdc074ef2a08c861522b8d7f65636bffb78c4b059028e5a47151991e27e8e2cb", "0x1d8fb53e3985727893d0e5baf0efafe509c6b19b5bba181b5c03814bdfc2ace7", "0x5f3ca230c9d8b48797e13861244e397d5716172168e6395554e45fbdff7b03a5", "0x32aeb823d963153d1dbe710c88f2f21b3e1940b28657556d0ea74e58d5b1552e", "0x2eA78549C73Cb4208a5eb129d43ebda1203fd768", "0xe317e1f0ef536c99f12afdd6766e4651ddd20b135b696377355f03dc9389bf4e"],
    ["ProgrammableRouterGovernanceAuthorityV4", "0x37492914fbed1e914a629e2b0077e3c8fcf8b064250c3c4414f82fafe54e0157", "0x937f709afabc1fac3a901e564a07015603c621b7d66c4f64c9c60d52845e841f", "0x4824720e90ec281e47dcb2b13931c71065881c5b115adf31589ffca098717fe1", "0xd4018ad1eb136f528983d05f01f4abe1566304739e6f8cea34bcbbf138762377", "0x979F9E496AbAB43C1B83286087E30dc3BbaAe9dF", "0xaf6f91ccd71de2f6523d5c1c7245aaa325242a77ee810c269675aee32969a147"],
  ].map(frozenTarget),
  preflightRoots: [
    ["ProgrammableUniversalLaunchPreflightV1", "0x95bfd2005d31818de66f6005ba5f20ca6a17325ead43c5e8da60e2ba61067500", "0xbdce9b7e6a9d0eafd56184192c12ed98cdd3ef633c376d9c8d4c709795a599b0", "0xd820fe73cc19947347fda1cbf028a50989707a74666ae9983aede68c61846b32", "0xc6eba5b0c088356a777816d79b0e922eb6ff6b3b62b80a5525b959199d35444f", "0x0bed68Fc3418Eb21FD2C1032C77f87c6aBA566B1", "0x99b31a5c8bf5029cac2e9aa043e9f6123ffc59597fd3e633d7e8d78e656ceb29"],
    ["ProgrammableCompletedGraphAdoptionCompatCodecV1", "0x8b4e4e44371ff8c677462e212014c33c56f799862ab3a925806fda9f1b379913", "0xe0ae67e378f0562e7381e06a19d27adfbecf0f08e7339a2d0fec0a4add9d541f", "0x73a7ccccb68df05b7a2e8ce8c8459d280944156f0c10fb854c631877bbe649bd", "0x9004c7d193eed73561ab76a1f3723f2201f4137f578c0721a5c933ec17b58627", "0x157A2B242197Ba62BEcB92892cA7A1F975457747", "0x1570eb95011b32da976fe6525c80e79e13cd5e3d186913b5382b210cfcf2eca4"],
    ["ProgrammableRouterFinalityAuthorityV4", "0xdfd64287fcca21e325979ee4a374e7f0d085628d73255491a86e381d8a2a1054", "0xa6b6825daf08717ba86af196c4ee2350f40c5db8115085e93b851bff84bce63e", "0xf481f0eb2915c6785bc7b86053bc7e0b187e1721bd41cb0889aaf0db2bec6c96", "0xc4d8fe37cb4bb224da29c11e84169bc5f447eb9dc6dad2cef3bf7c6440223a11", "0xd8A3b8634cfBddaaB7766Eb54002D82423dF3be1", "0x56963d4939cd2c0b7818a473e4ddfdb33da1cc28f31bd51495fe486168e8c159"],
    ["ProgrammableRouterIndexerAuthorityV4", "0x6224f45cca49ae2143ce3b4e74a1e631c3497347b7f6860e1695b0bb3e04cc66", "0x1ab5b5f01b9bca96ff296e9a70c272ddf0da4f7a5ea4d97319cf9f28182cb733", "0xcf4dea9fc318a71125e245f363720e8ec3e6b5fe38ac8655f1db79f8be7928b0", "0xab1613e44d39959c2ab9e3a0aa4982763748ef706902dc791b284d63403ff94d", "0xa091B2Ae533F6DaAEd13EB05d867d816E57c1a73", "0xeca0f59457b57ebcafef1b91f43633652625283234758dd9410d2ca2dce0e35a"],
  ].map(frozenTarget),
  completedGraphAdoptionCompatValidators: [
    ["ProgrammableCompletedGraphAdoptionValidatorV1", "0xe691790988dd9eda33f9301c761e2ca6fdbf88ec973c7ed4ce3712336fcaec98", "0x4eb2eafe95a6d18bdd1bc7e2d6aa94f77aa5be796676de2c1e87fb76db03d387", "0xe776609154757cffdd99874fb511d974fbfa8fdeff572b96c6b9f2f3929d466d", "0x09b6e3667d065e76b83036977793514852d932a97abbf92b89f11a0ddf41562f", "0x077eA1A1da40925f06f8aD1D62C0551E9021B3FF", "0xd45565d6a3e8e3c46404a57e566a6ab7fdf1b3ba6f498a19223f7836c8dcacf1"],
    ["ProgrammableCompletedGraphAdoptionPreflightV1", "0x7e512fd47205a0bf8aeb785b569b9dabdb507bfb7acf3e9beb54042e8d861a25", "0x63e7fe8b7c187b69c82f979f9884f882a515c7feef50e090dd53f22a41fb11b0", "0x4ebdf52274ec986f8dd60beb94f123ddc8f862398af7db460950ee21be04f5c1", "0x4082cefee76895b1cdcd6e27bcc088d1973a0f6d3bccccb5cbc97d183ee5f0a2", "0x84ad8fFE50fc3D7270C76b898411b90d6c88A4C5", "0xf94f6e1be90fd04e482e00f2e0d58bd0a8304be0a0ba65ac96898bdaaecdad8c"],
    ["ProgrammableCompletedGraphRuntimeStateVerifierV1", "0xc4fbe4670e1dd6e578541ad45a9f2bdc07d8700e1b772c29b944febe2b973166", "0x551050f55d2975951502b643a1d96f0c33bf49bd861551474e4c52e4f1233e2c", "0xa2f9099c7c7b10cbc4741f5d0fccf5ed2286c408c1aec4a27e1d0dd481799706", "0xa5e51ab7f4d708d977890297cc010b1b7f9b1c394e3b4de3967d112c2ddfdf49", "0x4FE9c5f08ec659bef00385C7aea5C3750edb97AD", "0x59ee58b19e1b2e023cc3684d69ebfbf8b3ac9d1972276762769457459ad5b2b8"],
  ].map(frozenTarget),
  universalKernel: [
    ["ProgrammableUniversalLaunchKernelV1", "0x1fff22a301dda9ce7da76e85394817bec60d35443de67d23f9f412156f97ec5e", "0x16404b5755094215bc626851d76ef81e2b094c883efc954196a453f70163072e", "0xc0ac8fcfbb8459462283820fe82214ecec9b60df726bf99f5132a45b58dc0573", "0x9c8a48172cca790a218d4e1e2cf266c1c9608afbf55ac0998ee67198aade9b18", "0x25E9DDEB5de79751dB2156D426893d52C8F14DCF", "0x316dcd57dcefd06149e3cb2a78a25d2421312c7431df2bdf3c62ca501341f1cf"],
  ].map(frozenTarget),
  shardsAdapters: [
    ["ProgrammableExactShardsNestedFactoryProviderV1", "0x955041799161c801497fdb5b0281bc510ad2cce2712ada6c0e61c2e244283e44", "0x86ce819510f9a5ab7dfbba53889aec1005a6e7472a329155d77f9715cb0a8c02", "0x40060171bd431c1725f0f372ea96dd59206027ef77a316ada656d98747308329", "0xf5f35d7c72da2a7960fca0bb1cb37c46495d013f56e87ecbbd3ca8e4b0982f36", "0x03385476770CAe102ef673adF9A4631E84258e58", "0xb082161b95cd66ce67157900c7c750f1538dd626f3ebc5409930da57032310e2"],
    ["ProgrammableExactShardsNestedFactoryVerifierV1", "0xa698649da813876c67a6d2e72a7b499d19525194bb2064ec76df889e48b087ac", "0xe69ae3b707af33379435d768491a8613ca636178cab7a38ffe3b26e63565fb23", "0x85159c11faab00d8ca4949500b1a8ef3b6513f2e3278aeacc6735b679bcdbb1c", "0x5ebaaa6681388bdd590840b5fdb3dcafacba3ebec06c017afa6d59dd985ce471", "0xA4867B0d72bCE8C1db040E91454D562239daF923", "0xf2bd06d1ef883820e7c6d6c93dd3e81053448c24e9547cb7fd14a9265b46e5f5"],
  ].map(frozenTarget),
};

const graphPlan = (phase, routeNonce, commitment, deploymentCalldataHash, measuredGas, targets) => ({
  phase,
  routeNonce,
  commitment,
  deploymentCalldataHash,
  measuredGas,
  targets,
});
const deterministicPlan = {
  version: 1,
  chainId: 1,
  deployer: "0x2Bb333d48DFAF1596D9036671d2E43168994249E",
  controller: "0x755509eA6e3F5Ec1aA2E797bb68f1B87DD8b886b",
  routeNamespace: "0x2534f97635ed0b3276a3bd1edb3f09c0bb2acbdaa69ee4bd8d79bc7b7514f4ef",
  graphDeployer: {
    factory: "0x4e59b44847b379578588920cA78FbF26c0B4956C",
    salt: "0x54038ef1b6fa66c94b82e452bc31ebd1aae7691f7ac4cee0a059ff8688bc80bd",
    initCodeHash: "0x84f7cb8e9e445d3322249dbc2b9efc65bb9c7a8ba26902aafef9b0552f4bc208",
    deploymentCalldataHash: "0xb9488d1dd4831b8ba10d1b7dde74785bd403190a7a7554d291a31bee1fa8726b",
    address: "0xaE682102d893a113EA3891B12953DEc9f66e3082",
    runtimeCodeHash: "0xd23692fae59331592048e71a96d4963e170ee56e449683dc9f7fa3f9470018b8",
    measuredGas: 1_668_509,
  },
  graphs: [
    graphPlan("FOUNDATIONS", "0x370e484382883f878a35b1841fc9065c1b3a4b21905ee24ca48791ad804c6322", "0x7da7867e40e7db8e896a45eb9c577344fc932fa4d9e8a4aae663926060e666b9", "0x8a9966e944c36ebe4bf3103ee04d429934917b8864eff2a62c383fba02b3e714", 13_770_917, graphTargets.foundations),
    graphPlan("PREFLIGHT_ROOTS", "0xa0dd7885c9f94b4eb76cce0f236742ad58b9e5543bafc41d326ab031dfc5f3f8", "0x4cf9f6829ef2839f73f7a1757ceb9192da37ade127028400aab9d1cd60a8b2ea", "0x92831062e0a74a0418dbc901996881cd10b5c599807b0d1580c109dc42b4fd98", 8_274_476, graphTargets.preflightRoots),
    graphPlan("COMPLETED_GRAPH_ADOPTION_COMPAT_VALIDATORS", "0xf07c2c0ea72cd0ce128db88c364ffdbe8e69763921aa44f794966643b47671e8", "0x76c5b9f3c16517e6c6e277be94b719eaa3fd15190f1251527dd30330f0a931ac", "0xa7e0b7d0f04059c366f4f88a7e5a9c45efb1d02e91472acf4445a056399a3265", 9_943_666, graphTargets.completedGraphAdoptionCompatValidators),
    graphPlan("UNIVERSAL_KERNEL", "0x724e5a978441b2624aaf5a792bfbcef150eac799dbb7f158cacaeade9196f725", "0x91bf62106b8881a4aaa3d8da1cfe43a51024eccb23a11f5c7dab8e7d82326916", "0xb78101caf6a087ed38aa0b9ac8b86c47fb50d4964bd2e4ea47410a5a5216d723", 5_541_726, graphTargets.universalKernel),
    graphPlan("SHARDS_ADAPTERS", "0x05dca18410ba0f097637d974d29c2abc66e7e93d1404e82a92f03995942df5e3", "0x444892eed40ad1c37300b9da0c453ccd2a2edfc81ed8c7b024c4f9abb437862d", "0xd07618729ff04e793019fc0b95e0b74d853bcff666839ed6c5ff6650bd5a6a8c", 8_245_759, graphTargets.shardsAdapters),
  ],
  directCreate2: {
    completedGraphAdoptionCompatRegistry: { salt: "0x83be1dd0a96c299978929d8e89c43e26d6c7702fdd0e50ede8bf7bc4624c1a86", initCodeHash: "0x68ac41610e2981d0412fc26371aaba58f0a6db2abf655cf1247ee86914caca73", deploymentCalldataHash: "0x6885496ed9ded4592f401c37988b6b6e359c435f5a8a11634cd80fc6c1b25862", address: "0x636989978c214d7786d21604d7C225cEbf2240C8", runtimeCodeHash: "0x8151161ceb2462daad45e747ac8f828be419ea2abd9f763b3353f9a9628abb48", measuredGas: 16_423_892 },
    nestedFactoryProfile: { salt: "0x6de115629765e5dbc257929d2ce9066519549d02b74bf32b005654526638ffe1", initCodeHash: "0x129f917c7a8b80e46e83608a9b5ef5d0d147ac47881ccef0a158706b487f789a", deploymentCalldataHash: "0x546fac7a6aca173bfad70275d5dbd394ba4fe720f0348f3083251ad21b66017d", address: "0x6d2D661Ab0e462E8047597Adc5bece4BCA157C4C", runtimeCodeHash: "0xc0aa4b63df8ba2c21766c89bfe9c88e6379f6fa23659d7895bba18a6aa80340c", measuredGas: 16_243_370 },
    shardsFactory: { salt: "0x655a4b5a2b704bef84b4ff94adde0a7ac40ad0366c82ddca5290180fe4c3986d", initCodeHash: "0x7d05592489495559b1288f8ad342239b3fb95a6aa005b5b0b1551c9523401585", deploymentCalldataHash: "0xf37ce9748abe4d5243cbd26f48c6ea5789ab1ebe8e19ea96d2198693e957c4ec", address: "0x9442a520e7b31D10177C75A363355C2C29141ac5", runtimeCodeHash: "0x134a9e5674f22e62e939c2238693077b8027c553bb26d6a4e9e3d8554e5f85b5", measuredGas: 8_170_490 },
  },
  storeChildren: [
    { address: "0x2c8B3eCFA689ea2dD481B6C49ACF58281D610887", runtimeBytes: 24_576, runtimeCodeHash: "0xa7dbf60adc43d35d3c7559615f60f194d84424e196a16aaefda92b41d5453a09" },
    { address: "0x2FD959F0EF9B3CcA7daaf8fDB3C63BC55F5c2Ff8", runtimeBytes: 1_828, runtimeCodeHash: "0xa8280e92c30a67d9efb854b111eeba793609cd87bfc2b3f7605def2e6dfcf2a9" },
  ],
  safeCalls: [
    { phase: "BIND_REVIEWER", target: "0x2eA78549C73Cb4208a5eb129d43ebda1203fd768", calldataHash: "0xa66c3a33a5c249cc9037d5135e7a3ca0e3e9eedc9460cf62a82190ff9cb8fa79", measuredGas: 220_028 },
    { phase: "BIND_GOVERNANCE", target: "0x979F9E496AbAB43C1B83286087E30dc3BbaAe9dF", calldataHash: "0x4026b2ef4210d4b5e789e4ac714eb9d0925573ee93800b5da8bc8bf26695d1fb", measuredGas: 169_508 },
    { phase: "BIND_FINALITY", target: "0xd8A3b8634cfBddaaB7766Eb54002D82423dF3be1", calldataHash: "0x1c1d3d6c270e3e097c418ad79044620e9a7c205e9c75c0b1ba3745c79da88f36", measuredGas: 169_441 },
    { phase: "BIND_INDEXER", target: "0xa091B2Ae533F6DaAEd13EB05d867d816E57c1a73", calldataHash: "0x69d8fd4257effda7c134d5e8b6f2a3bc695f0c54f9ca46226b3eb576f9f6cbae", measuredGas: 169_441 },
    { phase: "ACTIVATE_UNIVERSAL", target: "0x979F9E496AbAB43C1B83286087E30dc3BbaAe9dF", calldataHash: "0x92a03ae7d5a05d390865f35ef02d16000d51803ac6729bb7a54d28a5fed74435", measuredGas: 5_512_018 },
    { phase: "ACTIVATE_COMPLETED_GRAPH_ADOPTION_COMPAT", target: "0x979F9E496AbAB43C1B83286087E30dc3BbaAe9dF", calldataHash: "0x25725430b8c464cf36f1a14ff468fffe0ac69b39462dee341a3e776ff04c2fd1", measuredGas: 1_354_510 },
  ],
  orderedOuterTransactions: ["DEPLOY_GRAPH_DEPLOYER", "FOUNDATIONS", "PREFLIGHT_ROOTS", "COMPLETED_GRAPH_ADOPTION_COMPAT_VALIDATORS", "UNIVERSAL_KERNEL", "DEPLOY_COMPLETED_GRAPH_ADOPTION_COMPAT_REGISTRY", "BIND_REVIEWER", "BIND_GOVERNANCE", "BIND_FINALITY", "BIND_INDEXER", "SHARDS_ADAPTERS", "DEPLOY_NESTED_FACTORY_PROFILE", "DEPLOY_SHARDS_FACTORY", "ACTIVATE_UNIVERSAL", "ACTIVATE_COMPLETED_GRAPH_ADOPTION_COMPAT"],
};

const predictedAddresses = Object.fromEntries([
  ["ProgrammableCreate2GraphDeployerV1", deterministicPlan.graphDeployer.address],
  ...Object.values(graphTargets).flat().map((target) => [target.contract, target.address]),
  ["ProgrammableCompletedGraphAdoptionGrantRegistryV1", deterministicPlan.directCreate2.completedGraphAdoptionCompatRegistry.address],
  ["ProgrammableNestedFactoryProfileV1", deterministicPlan.directCreate2.nestedFactoryProfile.address],
  ["ShardLaunchFactoryV1", deterministicPlan.directCreate2.shardsFactory.address],
  ["GeometricRendererV1", "0x090DBD2FaB1a467f90ed82a443eFa9AAb658DE14"],
]);
const specializedInitCodeHashes = Object.fromEntries([
  ["ProgrammableCreate2GraphDeployerV1", deterministicPlan.graphDeployer.initCodeHash],
  ...Object.values(graphTargets).flat().map((target) => [target.contract, target.initCodeHash]),
  ["ProgrammableCompletedGraphAdoptionGrantRegistryV1", deterministicPlan.directCreate2.completedGraphAdoptionCompatRegistry.initCodeHash],
  ["ProgrammableNestedFactoryProfileV1", deterministicPlan.directCreate2.nestedFactoryProfile.initCodeHash],
  ["ShardLaunchFactoryV1", deterministicPlan.directCreate2.shardsFactory.initCodeHash],
]);
const specializedRuntimeCodeHashes = Object.fromEntries([
  ["ProgrammableCreate2GraphDeployerV1", deterministicPlan.graphDeployer.runtimeCodeHash],
  ...Object.values(graphTargets).flat().map((target) => [target.contract, target.runtimeCodeHash]),
  ["ProgrammableCompletedGraphAdoptionGrantRegistryV1", deterministicPlan.directCreate2.completedGraphAdoptionCompatRegistry.runtimeCodeHash],
  ["ProgrammableNestedFactoryProfileV1", deterministicPlan.directCreate2.nestedFactoryProfile.runtimeCodeHash],
  ["ShardLaunchFactoryV1", deterministicPlan.directCreate2.shardsFactory.runtimeCodeHash],
  ["GeometricRendererV1", "0x9b54a61918b2ddf9b7daf41d9bf2d705cbef3a0fd618275762b99e19c53459bf"],
]);
const artifact = {
  schemaVersion: "router-v4-deployment-artifact-v1",
  packageVersion: "1.0.0-candidate",
  status: "SOURCE_TEST_AND_SIMULATION_CANDIDATE",
  activation: "DENY",
  sourceBinding: {
    reviewedSourceCommit: "5cb4f0c9769b420d5240d88c7b9a861fd3755ed1",
    reviewedSourceTree: "28709a9112f421aabb1ca884bab2f40b1c6b4213",
    protectedMergeCommit: "7b06469be06a746150545a94ccfb3c4c5e959de3",
    coreArtifactPath,
    coreArtifactSha256: expectedCoreArtifactSha256,
    deploymentCommit: null,
    deploymentTree: null,
  },
  compilerProfiles: {
    compiler: solcRelease,
    officialBinarySha256s: solcBinarySha256s,
    core: {
      optimizerRuns: 100,
      standardInputPath: "artifacts/router-v4-deployment-v1/standard-input-core.json",
      standardInputSha256: sha256(coreInputBytes),
    },
    deployment: {
      optimizerRuns: 1_000,
      standardInputPath: "artifacts/router-v4-deployment-v1/standard-input-deployment.json",
      standardInputSha256: sha256(deploymentInputBytes),
    },
    registry: {
      optimizerRuns: 100,
      standardInputPath: "artifacts/router-v4-deployment-v1/standard-input-registry.json",
      standardInputSha256: sha256(registryInputBytes),
    },
    shared: { evmVersion: "cancun", viaIR: false, metadataBytecodeHash: "none", appendCBOR: false },
  },
  compiledContractsPath: "artifacts/router-v4-deployment-v1/compiled-contracts.json",
  compiledContractsSha256: sha256(compiledContractsBytes),
  deploymentBytecodesPath: "artifacts/router-v4-deployment-v1/deployment-bytecodes.json",
  deploymentBytecodesSha256: sha256(deploymentBytecodesBytes),
  deploymentBytecodeFileSha256s: Object.fromEntries(
    Object.entries(deploymentBytecodeFiles).map(([path, bytes]) => [path, sha256(bytes)]),
  ),
  sources: Object.fromEntries(evidenceFiles.map((path) => [path, { sha256: sha256(read(path)) }])),
  dependencies: {
    openzeppelinContracts: "21c8312b022f495ebe3621d5daeed20552b43ff9",
    forgeStd: "3b20d60d14b343ee4f908cb8079495c07f5e8981",
    shardsV1: "91b38f3de64d96cac7e29f127c004f128fc1da59",
    v4Core: "59d3ecf53afa9264a16bba0e38f4c5d2231f80bc",
    v4Periphery: "ad04c9f24a170accf5ea1b2836bbafd514537ca6",
  },
  reviewedDeploymentPrimitives: {
    graphDeployerSourceSha256: graphSourceSha256,
    erc2470SingletonFactory: "0xce0042B868300000d44A59004Da54A005ffdcf9f",
    erc2470RuntimeCodeHash: "0xc4d5542b53a8b779595a20a8ddd60e58a6c49d3c3decc2df83ced1c69c8ca807",
    nickCreate2Proxy: "0x4e59b44847b379578588920cA78FbF26c0B4956C",
    nickCreate2ProxyRuntimeCodeHash: "0x2fa86add0aed31f33a762c9d88e807c475bd51d0f52bd0955754b2608f7e4989",
  },
  authority: {
    version: 4,
    roleEndpointsPairwiseDistinct: true,
    purposeAndConsumerBound: true,
    controllerRuntimePinned: true,
    genericCallSurface: false,
    valueSurface: false,
    clearKillSurface: "ORDERED_ACTIVATION_ONLY",
    serviceReleaseBindingTypehash,
    serviceReleaseBinding,
    serviceReleaseBindingInputs: {
      protectedMergeCommit: "7b06469be06a746150545a94ccfb3c4c5e959de3",
      coreArtifactSha256: expectedCoreArtifactSha256,
      coreStandardInputSha256: sha256(coreInputBytes),
      deploymentStandardInputSha256: sha256(deploymentInputBytes),
      registryStandardInputSha256: sha256(registryInputBytes),
      compiledContractsSha256: sha256(compiledContractsBytes),
    },
    controllerCandidate: "0x755509eA6e3F5Ec1aA2E797bb68f1B87DD8b886b",
    controllerCandidateRuntimeCodeHash: "0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c",
    ownerAuthorizationScope: "EXACT_IMMUTABLE_TRANSACTION_PACKAGE_ONLY",
    ownerAuthorizationState: "AUTHORIZED_IF_EXACT_PACKAGE_AND_ALL_GATES_MATCH",
    broadcastStillRequiresResolvedPackage: true,
  },
  shards: {
    executionMode: "EXACT_FACTORY_LAUNCH_EXECUTED_ONLY",
    factory: "0x9442a520e7b31D10177C75A363355C2C29141ac5",
    renderer: "0x090DBD2FaB1a467f90ed82a443eFa9AAb658DE14",
    token: "0x50d17EAaeB52c66E64b918385AbF6523fDAE57CF",
    hook: "0xbA318baA8649962fD77CC7082d098f2C09Fd60cC",
    nft: "0x9fDA98dE1B7061ae02A9Aec7A6f8ed75a8Feb8F3",
    poolId: "0x075885e47ec15084de91826faafab9c2cd4fda4d24fd9e5ce3af6a4be4ad926d",
    nativeValueWei: "0",
    providerGasMeasured: 8_980_323,
    providerGasLimitCandidate: 12_000_000,
    transactionGasLimitMaximum: 16_777_216,
    semanticMapping: "EXPLICIT_OWNERLESS_HOOK_CONTROL_AND_SPLIT_REVENUE_SENTINELS",
  },
  completedGraphAdoptionCompat: {
    route: "COMPLETED_GRAPH_ADOPTION",
    profileClass: "SOURCE_NEUTRAL_COMPAT_INFRASTRUCTURE",
    executionSemantics: "ADOPTION_ONLY_NO_EXECUTION",
    profileKey: "0x7e84ec6d9fd7bbb64e78bfef347234eb667eae84cae181f56d56cc825470aff3",
    capabilityHash: "0x4045fce9793987a7d29fd5ace0e96196ac5a9fed983f026cb6d46c521d49aae0",
    exactContractBindingHash: "0xdc854c275079604c011bc539cef606d4ad5ea6f71476453f19f2b258ea63828f",
    requiredIdentityMask: "APPLICATION",
    forbiddenIdentityMask: "POOL",
    revenueBinding: "ZERO_REQUIRED_BY_COMPAT_V1",
    hookemonSpecificGraphEvidence: false,
    applicantApprovalRepresented: false,
    applicantGrantActivated: false,
    applicantTransactionOccurred: false,
  },
  deployment: {
    state: "UNDEPLOYED",
    activation: "DENY",
    chainId: 1,
    deterministicPlan,
    predictedAddresses,
    specializedInitCodeHashes,
    specializedRuntimeCodeHashes,
    profileBindings: {
      universalProfileKey: "0xb90e215e0e29c0dacf021e5e778847af4100433ee7d22014b73f8ca4add09d0c",
      universalProviderBinding: "0x3047b31563fe37b8f0bad52f455460e38749d9216154624b6742aa6f8e4e7e8b",
      universalVerifierBinding: "0x6dc07cbf7758838f74bd744f1b30d0cd9a1d59fb0ae54ba18adf469e6599ff64",
      completedGraphAdoptionCompatProfileKey: "0x7e84ec6d9fd7bbb64e78bfef347234eb667eae84cae181f56d56cc825470aff3",
      completedGraphAdoptionCompatCapabilityHash: "0x4045fce9793987a7d29fd5ace0e96196ac5a9fed983f026cb6d46c521d49aae0",
      completedGraphAdoptionCompatExactContractBinding: "0xdc854c275079604c011bc539cef606d4ad5ea6f71476453f19f2b258ea63828f",
    },
    activationControls: {
      universal: {
        securityControlHeadHash: "0xd27713a490942c18b13f6a061b8e065d6fa0e74e4dea5d6a3de452f44ae0e82b",
        securityEpoch: 2,
        securityEpochHash: "0x60be5fedbbd476e9e9cf76cf16379a0ea67fdc11a3e2e8626c93407abb35bc1f",
        policyEpoch: 2,
        policyEpochHash: "0xdf7a3af0d6324f74ac44944c8766cf1614a8fd828be1c9c69cb6f32414861850",
        reviewGeneration: 2,
        reviewGenerationHash: "0xebcdc9806c8926377892bcbc36eee0e0ce385e011daf0b3773b81bc5508a7884",
      },
      completedGraphAdoptionCompat: {
        securityControlHeadHash: "0x87f1a5358823b06dde9cc9bad3b854ad05edc6f9e7d6377e9046de93cba8b6db",
        securityEpoch: 2,
        securityEpochHash: "0x3d749942346d25a67c9b7d6755c5328f03f00fa970e91f2aaaa7053e84c28dd6",
        policyEpoch: 2,
        policyEpochHash: "0xcac087f0f87e5935330c5cb19b923f2d4fab71bab47dbd60588a454e6a0f1b8e",
        reviewGeneration: 2,
        reviewGenerationHash: "0xde8fced9e71b12baed9376e7d6e1323f3699679711db3c000f51e13d659a52fa",
      },
    },
    simulations: {
      exactShardsPinnedFork: "PASS",
      fullSplitDeployment: "PASS_AT_BLOCK_25731328",
      separateSerialOuterTransactions: "PASS_AT_BLOCK_25731328_OSAKA_EIP7825",
      separateSerialOuterTransactionForkBlockHash:
        "0x4357f0c2e03213fd4814067957a6601b284baf9937cf03111fe5bcd9bb1d7b09",
      separateSerialOuterTransactionRuntime: "ANVIL_1.7.1_OSAKA_ENABLE_TX_GAS_LIMIT",
      separateSerialOuterTransactionCount: 15,
      separateSerialOuterTransactionGasUsed: [
        1_668_509,
        13_770_917,
        8_274_476,
        9_943_666,
        5_541_726,
        16_423_892,
        220_028,
        169_508,
        169_441,
        169_441,
        8_245_759,
        16_243_370,
        8_170_490,
        5_512_018,
        1_354_510,
      ],
      separateSerialOuterTransactionGasTotal: 95_877_751,
      minimumTransactionGasMargin: 353_324,
      fullUniversalExecution: "PASS_WITH_SIGNATURE_AND_CURRENTNESS_STUBS",
      fullCompletedGraphAdoptionCompatRoute: "PASS_WITH_SYNTHETIC_GRAPH_AND_SIGNATURE_CURRENTNESS_STUBS",
      replayStaleKillAndCollisionNegatives: "PASS",
      transactionGasCeiling: 16_777_216,
    },
    creationTransactions: null,
    sourceVerificationReceipts: null,
    finalityReceipts: null,
    profileRegistrationReceipt: null,
    authorityBindingReceipts: null,
  },
  consumerStatus: {
    website: "NO_WRITE_HANDOFF_ONLY_AFTER_LIVE_RECEIPTS",
    shards: "DENY_PENDING_DEPLOYMENT_AUTHORITY_PROFILE_AND_LIVE_RECEIPTS",
    hookemon: "DENY_PENDING_DEPLOYMENT_ADOPTION_PROFILE_AND_LIVE_RECEIPTS",
  },
  externalActionOccurred: false,
};

const outputs = {
  "artifacts/router-v4-deployment-v1/standard-input-core.json": coreInputBytes,
  "artifacts/router-v4-deployment-v1/standard-input-deployment.json": deploymentInputBytes,
  "artifacts/router-v4-deployment-v1/standard-input-registry.json": registryInputBytes,
  "artifacts/router-v4-deployment-v1/compiled-contracts.json": compiledContractsBytes,
  "artifacts/router-v4-deployment-v1/deployment-bytecodes.json": deploymentBytecodesBytes,
  ...deploymentBytecodeFiles,
  "artifacts/router-v4-deployment-v1/router-v4-deployment-v1.json": Buffer.from(stableJson(artifact)),
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
  `${mode === "--write" ? "wrote" : "checked"} Router V4 deployment artifact: `
    + `${sha256(outputs["artifacts/router-v4-deployment-v1/router-v4-deployment-v1.json"])}\n`,
);
