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
    name: "ProgrammableCompletedGraphAdoptionGrantRegistryV1",
    source: "src/hookemon/ProgrammableCompletedGraphAdoptionGrantRegistryV1.sol",
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
const coreCompilation = compile(solcPath, coreInput);
const deploymentCompilation = compile(solcPath, deploymentInput);

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
const serviceReleaseBindingTypehash = castKeccak(
  "ProgrammableRouterV4ServiceReleaseBindingV1(bytes20 protectedMergeCommit,bytes32 coreArtifactSha256,bytes32 coreStandardInputSha256,bytes32 deploymentStandardInputSha256,bytes32 compiledContractsSha256)",
);
const serviceReleaseBinding = castKeccak(execFileSync(
  "cast",
  [
    "abi-encode",
    "f(bytes32,bytes20,bytes32,bytes32,bytes32,bytes32)",
    serviceReleaseBindingTypehash,
    "0x7b06469be06a746150545a94ccfb3c4c5e959de3",
    `0x${expectedCoreArtifactSha256}`,
    `0x${sha256(coreInputBytes)}`,
    `0x${sha256(deploymentInputBytes)}`,
    `0x${sha256(compiledContractsBytes)}`,
  ],
  { encoding: "utf8" },
).trim());
if (serviceReleaseBinding !== "0xbd4fafda3f5d2cdf3be4e14439d7d80d850c046726785195601d5237263d602a") {
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
    ["ProgrammableRouterReviewerAuthorityV4", "0xfdc074ef2a08c861522b8d7f65636bffb78c4b059028e5a47151991e27e8e2cb", "0x1d8fb53e3985727893d0e5baf0efafe509c6b19b5bba181b5c03814bdfc2ace7", "0x5f3ca230c9d8b48797e13861244e397d5716172168e6395554e45fbdff7b03a5", "0x1d26ce3ac6eee8d1699d570d99d5d099b2c2b60829538c6ec1afb5933ab23248", "0xb55f4173E67BD20191F0A7c6b87918bbC3cDd9Ac", "0xe317e1f0ef536c99f12afdd6766e4651ddd20b135b696377355f03dc9389bf4e"],
    ["ProgrammableRouterGovernanceAuthorityV4", "0x37492914fbed1e914a629e2b0077e3c8fcf8b064250c3c4414f82fafe54e0157", "0x937f709afabc1fac3a901e564a07015603c621b7d66c4f64c9c60d52845e841f", "0x4824720e90ec281e47dcb2b13931c71065881c5b115adf31589ffca098717fe1", "0x45cdca3d680b580995d414781deb50797eca9830eac50d9f4a2e56c4beb599db", "0x77EF72AF28C5D4252899f2fbdd87986291387913", "0xaf6f91ccd71de2f6523d5c1c7245aaa325242a77ee810c269675aee32969a147"],
  ].map(frozenTarget),
  preflightRoots: [
    ["ProgrammableUniversalLaunchPreflightV1", "0x95bfd2005d31818de66f6005ba5f20ca6a17325ead43c5e8da60e2ba61067500", "0xbdce9b7e6a9d0eafd56184192c12ed98cdd3ef633c376d9c8d4c709795a599b0", "0xd820fe73cc19947347fda1cbf028a50989707a74666ae9983aede68c61846b32", "0xc6eba5b0c088356a777816d79b0e922eb6ff6b3b62b80a5525b959199d35444f", "0x0bed68Fc3418Eb21FD2C1032C77f87c6aBA566B1", "0x99b31a5c8bf5029cac2e9aa043e9f6123ffc59597fd3e633d7e8d78e656ceb29"],
    ["ProgrammableCompletedGraphAdoptionCompatCodecV1", "0x8b4e4e44371ff8c677462e212014c33c56f799862ab3a925806fda9f1b379913", "0xe0ae67e378f0562e7381e06a19d27adfbecf0f08e7339a2d0fec0a4add9d541f", "0x73a7ccccb68df05b7a2e8ce8c8459d280944156f0c10fb854c631877bbe649bd", "0x9004c7d193eed73561ab76a1f3723f2201f4137f578c0721a5c933ec17b58627", "0x157A2B242197Ba62BEcB92892cA7A1F975457747", "0x1570eb95011b32da976fe6525c80e79e13cd5e3d186913b5382b210cfcf2eca4"],
    ["ProgrammableRouterFinalityAuthorityV4", "0xdfd64287fcca21e325979ee4a374e7f0d085628d73255491a86e381d8a2a1054", "0xa6b6825daf08717ba86af196c4ee2350f40c5db8115085e93b851bff84bce63e", "0xf481f0eb2915c6785bc7b86053bc7e0b187e1721bd41cb0889aaf0db2bec6c96", "0x1ea3b195ce07d4c892b1d5fee8ddd89c254290d9f850d388768a4d831ed52725", "0xed6F19A9D41AfcBd7B01a6300A80D86C4A713163", "0x56963d4939cd2c0b7818a473e4ddfdb33da1cc28f31bd51495fe486168e8c159"],
    ["ProgrammableRouterIndexerAuthorityV4", "0x6224f45cca49ae2143ce3b4e74a1e631c3497347b7f6860e1695b0bb3e04cc66", "0x1ab5b5f01b9bca96ff296e9a70c272ddf0da4f7a5ea4d97319cf9f28182cb733", "0xcf4dea9fc318a71125e245f363720e8ec3e6b5fe38ac8655f1db79f8be7928b0", "0x294ff846d4cd5b6927891edac5b14366e93810796727c2b39fb8b41e0cd45428", "0x72F3548AA12545907E8B2c9Ec38b81D40811Da4D", "0xeca0f59457b57ebcafef1b91f43633652625283234758dd9410d2ca2dce0e35a"],
  ].map(frozenTarget),
  completedGraphAdoptionCompatValidators: [
    ["ProgrammableCompletedGraphAdoptionValidatorV1", "0xe691790988dd9eda33f9301c761e2ca6fdbf88ec973c7ed4ce3712336fcaec98", "0x4eb2eafe95a6d18bdd1bc7e2d6aa94f77aa5be796676de2c1e87fb76db03d387", "0xe776609154757cffdd99874fb511d974fbfa8fdeff572b96c6b9f2f3929d466d", "0x09b6e3667d065e76b83036977793514852d932a97abbf92b89f11a0ddf41562f", "0x077eA1A1da40925f06f8aD1D62C0551E9021B3FF", "0xd45565d6a3e8e3c46404a57e566a6ab7fdf1b3ba6f498a19223f7836c8dcacf1"],
    ["ProgrammableCompletedGraphAdoptionPreflightV1", "0x7e512fd47205a0bf8aeb785b569b9dabdb507bfb7acf3e9beb54042e8d861a25", "0x63e7fe8b7c187b69c82f979f9884f882a515c7feef50e090dd53f22a41fb11b0", "0x4ebdf52274ec986f8dd60beb94f123ddc8f862398af7db460950ee21be04f5c1", "0x4082cefee76895b1cdcd6e27bcc088d1973a0f6d3bccccb5cbc97d183ee5f0a2", "0x84ad8fFE50fc3D7270C76b898411b90d6c88A4C5", "0xf94f6e1be90fd04e482e00f2e0d58bd0a8304be0a0ba65ac96898bdaaecdad8c"],
    ["ProgrammableCompletedGraphRuntimeStateVerifierV1", "0xc4fbe4670e1dd6e578541ad45a9f2bdc07d8700e1b772c29b944febe2b973166", "0x551050f55d2975951502b643a1d96f0c33bf49bd861551474e4c52e4f1233e2c", "0xa2f9099c7c7b10cbc4741f5d0fccf5ed2286c408c1aec4a27e1d0dd481799706", "0xa5e51ab7f4d708d977890297cc010b1b7f9b1c394e3b4de3967d112c2ddfdf49", "0x4FE9c5f08ec659bef00385C7aea5C3750edb97AD", "0x59ee58b19e1b2e023cc3684d69ebfbf8b3ac9d1972276762769457459ad5b2b8"],
  ].map(frozenTarget),
  universalKernel: [
    ["ProgrammableUniversalLaunchKernelV1", "0x1fff22a301dda9ce7da76e85394817bec60d35443de67d23f9f412156f97ec5e", "0x16404b5755094215bc626851d76ef81e2b094c883efc954196a453f70163072e", "0xc0ac8fcfbb8459462283820fe82214ecec9b60df726bf99f5132a45b58dc0573", "0xbd72b9e62d23824de29364c0a51259ec1e96ae90a120bdf3bea7988aa44cc971", "0xD9aFf00E564705de782c8035AF6896E99A55FaA2", "0xcd0a62677e01620c2beddca2a632bfbf024a708a6e7a5e68879a02bb8d331749"],
  ].map(frozenTarget),
  shardsAdapters: [
    ["ProgrammableExactShardsNestedFactoryProviderV1", "0x955041799161c801497fdb5b0281bc510ad2cce2712ada6c0e61c2e244283e44", "0x86ce819510f9a5ab7dfbba53889aec1005a6e7472a329155d77f9715cb0a8c02", "0x40060171bd431c1725f0f372ea96dd59206027ef77a316ada656d98747308329", "0xeb0a38ae74e766ec8f39bd2660c1b4ed5fa877119de6700a1a3929a0415a7bea", "0xC2dFDb06F0b24e3b2D270D21718485bc1F10d9d0", "0x806f58b55bfe323f9987b7f44a97af43680387dcba41cedd16672ad85e32ef99"],
    ["ProgrammableExactShardsNestedFactoryVerifierV1", "0xa698649da813876c67a6d2e72a7b499d19525194bb2064ec76df889e48b087ac", "0xe69ae3b707af33379435d768491a8613ca636178cab7a38ffe3b26e63565fb23", "0x85159c11faab00d8ca4949500b1a8ef3b6513f2e3278aeacc6735b679bcdbb1c", "0xc447774b7a017e06ac9322928cad4fb8ca1532b757eb1f4b12c6d6d4c75586fe", "0x747Ed8e8cb97054b3C50adEAd253F6d5ABC439b4", "0x22bde33b6a49f4cdde377013f3335d148c7fb6083e207327f0502c348667e6d9"],
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
    graphPlan("FOUNDATIONS", "0x370e484382883f878a35b1841fc9065c1b3a4b21905ee24ca48791ad804c6322", "0x9ba7d805cd1675cda327f5dca6625f9f71602de87218dd7f14245de954695f9e", "0xc46ef694ac327dedf6b8f6c4a04a5b81cfa1f42ad27d0087c9d1e7ca1bd10111", 13_790_817, graphTargets.foundations),
    graphPlan("PREFLIGHT_ROOTS", "0xa0dd7885c9f94b4eb76cce0f236742ad58b9e5543bafc41d326ab031dfc5f3f8", "0x83f030af31e0844ed7b7e8ff2b326f831ec39fab44df6a19d95af9038b42490b", "0xcaa40e26486adaff05da432c73d1e15850eaf4aa79eab81c3cba3c4013809622", 8_289_888, graphTargets.preflightRoots),
    graphPlan("COMPLETED_GRAPH_ADOPTION_COMPAT_VALIDATORS", "0xf07c2c0ea72cd0ce128db88c364ffdbe8e69763921aa44f794966643b47671e8", "0x76c5b9f3c16517e6c6e277be94b719eaa3fd15190f1251527dd30330f0a931ac", "0xa7e0b7d0f04059c366f4f88a7e5a9c45efb1d02e91472acf4445a056399a3265", 9_959_066, graphTargets.completedGraphAdoptionCompatValidators),
    graphPlan("UNIVERSAL_KERNEL", "0x724e5a978441b2624aaf5a792bfbcef150eac799dbb7f158cacaeade9196f725", "0x4ce89d511ec2f6766826c5b8b48b264cd20c6bb9816cbdd1875b367a73653dcf", "0xb5aefbcb3294c0e064c3ddd6422ac4527d17a26145d046ef6d6d7571e9a487d9", 5_547_126, graphTargets.universalKernel),
    graphPlan("SHARDS_ADAPTERS", "0x05dca18410ba0f097637d974d29c2abc66e7e93d1404e82a92f03995942df5e3", "0xf512197e617bf0f339569a8dd412a9d6bdeb41b12f053f022ad2898ec937acf6", "0x7a7b10df22e725855ab090f20895d84573dca65489f8ccf8b1125f3d0fde4500", 8_251_171, graphTargets.shardsAdapters),
  ],
  directCreate2: {
    completedGraphAdoptionCompatRegistry: { salt: "0x83be1dd0a96c299978929d8e89c43e26d6c7702fdd0e50ede8bf7bc4624c1a86", initCodeHash: "0xee13a08e09e9eb8bdf4efdc1b3bfa83a29740ba47839d255c870552e0aad296e", deploymentCalldataHash: "0x2d5c60eddfe228bd8f1edee2760c23c61b99faf4de28df24c8758db2001a6eb5", address: "0xE1aefc665833938f903247797903c8e8c8d5da2e", runtimeCodeHash: "0x96557f03fe5e12442e97487a1a740a6d93d8ed06c5f01b5728a21037eafff190", measuredGas: 16_626_817 },
    nestedFactoryProfile: { salt: "0x6de115629765e5dbc257929d2ce9066519549d02b74bf32b005654526638ffe1", initCodeHash: "0x858bca7d5a656aafc3098abf8efbed84f488f760d489579e4ee09c9dcf0a64ea", deploymentCalldataHash: "0x3c55200f7b75ca1083103cdd76e295ad8072b793a6c26c1c2fd3017ac44788c5", address: "0x3Af16145F9acA5C0534D7042bB6aA2548386F828", runtimeCodeHash: "0xf46b63ae661427c995648347343bc674ad5795f0ed7c98972db913acbf76cb86", measuredGas: 16_233_382 },
    shardsFactory: { salt: "0x655a4b5a2b704bef84b4ff94adde0a7ac40ad0366c82ddca5290180fe4c3986d", initCodeHash: "0x7d05592489495559b1288f8ad342239b3fb95a6aa005b5b0b1551c9523401585", deploymentCalldataHash: "0xf37ce9748abe4d5243cbd26f48c6ea5789ab1ebe8e19ea96d2198693e957c4ec", address: "0x9442a520e7b31D10177C75A363355C2C29141ac5", runtimeCodeHash: "0x134a9e5674f22e62e939c2238693077b8027c553bb26d6a4e9e3d8554e5f85b5", measuredGas: 8_170_490 },
  },
  storeChildren: [
    { address: "0x2c8B3eCFA689ea2dD481B6C49ACF58281D610887", runtimeBytes: 24_576, runtimeCodeHash: "0xa7dbf60adc43d35d3c7559615f60f194d84424e196a16aaefda92b41d5453a09" },
    { address: "0x2FD959F0EF9B3CcA7daaf8fDB3C63BC55F5c2Ff8", runtimeBytes: 1_828, runtimeCodeHash: "0xa8280e92c30a67d9efb854b111eeba793609cd87bfc2b3f7605def2e6dfcf2a9" },
  ],
  safeCalls: [
    { phase: "BIND_REVIEWER", target: "0xb55f4173E67BD20191F0A7c6b87918bbC3cDd9Ac", calldataHash: "0xf9719c98f2d975eb026b88753b9ea9d5f10813a649649c76461328bb3da16781", measuredGas: 197_994 },
    { phase: "BIND_GOVERNANCE", target: "0x77EF72AF28C5D4252899f2fbdd87986291387913", calldataHash: "0x3be974920eac0fd048dafd8133946423ee33d4797ba2ebedc4f63d002c63a8b0", measuredGas: 146_708 },
    { phase: "BIND_FINALITY", target: "0xed6F19A9D41AfcBd7B01a6300A80D86C4A713163", calldataHash: "0xfa8caa890968f138aa81259a341126612ee59b67c6ea34aacc093fb162f2fec3", measuredGas: 146_641 },
    { phase: "BIND_INDEXER", target: "0x72F3548AA12545907E8B2c9Ec38b81D40811Da4D", calldataHash: "0x0422105a824b1abfb2340fa51c1f9400c6443adcfe9a02075d798139bdcd26c7", measuredGas: 146_641 },
    { phase: "ACTIVATE_UNIVERSAL", target: "0x77EF72AF28C5D4252899f2fbdd87986291387913", calldataHash: "0x7ef4be420b07700ca14f59501d9400156df7bb3b45fc970516e1ca637d830c4e", measuredGas: 5_440_618 },
    { phase: "ACTIVATE_COMPLETED_GRAPH_ADOPTION_COMPAT", target: "0x77EF72AF28C5D4252899f2fbdd87986291387913", calldataHash: "0x01bdfca2cc0d64a0c6b03381f446df0e43a1471fdd1bfd309c985731129ca274", measuredGas: 1_262_866 },
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
    capabilityHash: "0xc34803fcc1326a99c05995468ec17226e2246148ed371c3c1468002d836fca87",
    exactContractBindingHash: "0x24290f9958f654923c482c5658047c14a990130daecbb524fc33568061071a2f",
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
      universalProviderBinding: "0x62866cd0f4660f9fee3df58b89c23313fffa09504f3dccffc1b0ac27c6214b23",
      universalVerifierBinding: "0x5b96ec46bc66ded240b76f84bd81810af36113f28974b5ab180b2c57e3aa2909",
      completedGraphAdoptionCompatProfileKey: "0x7e84ec6d9fd7bbb64e78bfef347234eb667eae84cae181f56d56cc825470aff3",
      completedGraphAdoptionCompatCapabilityHash: "0xc34803fcc1326a99c05995468ec17226e2246148ed371c3c1468002d836fca87",
      completedGraphAdoptionCompatExactContractBinding: "0x24290f9958f654923c482c5658047c14a990130daecbb524fc33568061071a2f",
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
