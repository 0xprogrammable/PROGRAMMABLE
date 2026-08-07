#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const root = resolve(
  process.env.PROGRAMMABLE_CUSTOM_REGISTRY_ARTIFACT_ROOT
    ?? join(dirname(fileURLToPath(import.meta.url)), ".."),
);

const contracts = [
  ["ProgrammableCustomRegistryV1", "ProgrammableCustomRegistryV1.sol"],
  ["ProgrammableCustomPartnerFactoryRegistryV1", "ProgrammableCustomPartnerFactoryRegistryV1.sol"],
  ["ProgrammableCustomFeePolicyVerifierV1", "ProgrammableCustomFeePolicyVerifierV1.sol"],
  ["ProgrammableCustomAtomicRegistrarV1", "ProgrammableCustomAtomicRegistrarV1.sol"],
];

const expectedChainProfileHash =
  "sha256:30991a4ebef393737148f7986c880a4af602691e059ad428aa9ca17c6b4066ff";
const expectedRegistryPolicyHash =
  "sha256:7a814ecb2d2b8be2debb29481f25f06e976559eec41fa7c8d92e030ec69fc9ff";
const expectedArtifactFileHashes = new Map([
  ["CUSTOM_REGISTRY_EVENT_SET_V1.json", "sha256:47323a4162b1429d70b8828f0061d25e386f0808b2e22fd13f0cc2ad661c4898"],
  ["abi/ProgrammableCustomRegistryV1.json", "sha256:270d186ceb684d2c44f144de6d63a3b278081ca476d537b3a7fcd8952ce8d74e"],
  ["abi/ProgrammableCustomPartnerFactoryRegistryV1.json", "sha256:0401b53b147d8c9ee6d16578d6a362ed6c88de897bc4c6b341118222299872a3"],
  ["abi/ProgrammableCustomFeePolicyVerifierV1.json", "sha256:dc3d35c26cb4daeee2d8c61a8fddc91ed981e974312ac29e942ca567eab1debf"],
  ["abi/ProgrammableCustomAtomicRegistrarV1.json", "sha256:c8822824b4b0956be3cd71cf4d9d2fbe04a703409272a906a2e784d6a9f0d88a"],
]);
const expectedMainnetDeployment = new Map([
  ["ProgrammableCustomFeePolicyVerifierV1", {
    address: "0x6a57bf3e092626be760d417986e6103c20fdbc3e",
    runtimeCodeHash: "0x2a4182b580725a156c42061dd58b7ed92b4588682ee1b66b356ceff1ddd90882",
  }],
  ["ProgrammableCustomPartnerFactoryRegistryV1", {
    address: "0xf8aef69201621ad20fa256da595426b7e6192dba",
    runtimeCodeHash: "0xc059ec5b84a2f4b9a63fe2f4361d92c36e1a0f94af1189f17f70c60844016426",
  }],
  ["ProgrammableCustomRegistryV1", {
    address: "0x17e18c88bda9bfb73924cdc989c07b0707e72671",
    runtimeCodeHash: "0xa3276868befc509594adea6c5bd81c3c1bd013686f03fd57914fd39c917185f7",
  }],
  ["ProgrammableCustomAtomicRegistrarV1", {
    address: "0xcc916e5200d2626edfd918dc219bc4296629e997",
    runtimeCodeHash: "0xae00412005beb660afba47767240cf771bf3c65306d68c1a7bfcb8fe2c0450f5",
  }],
]);

const generationTwoContracts = [
  ["ProgrammableCustomFeePolicyVerifierV2", "ProgrammableCustomFeePolicyVerifierV2.sol"],
  ["ProgrammableCustomPartnerFactoryRegistryV2", "ProgrammableCustomPartnerFactoryRegistryV2.sol"],
  ["ProgrammableCustomExecutionPolicyRegistryV2", "ProgrammableCustomExecutionPolicyRegistryV2.sol"],
  ["ProgrammableCustomExecutionPolicyRevisionRegistryV2", "ProgrammableCustomExecutionPolicyRevisionRegistryV2.sol"],
  ["ProgrammableCustomRegistryV2", "ProgrammableCustomRegistryV2.sol"],
  ["ProgrammableCustomAtomicRegistrarV2", "ProgrammableCustomAtomicRegistrarV2.sol"],
];
const expectedGenerationTwoArtifactFileHashes = new Map([
  ["CUSTOM_REGISTRY_EVENT_SET_V2.json", "sha256:20724d1652169d4639ed452f91b43b188ba81da44352236b8ba5c889f527b85c"],
  ["CUSTOM_REGISTRY_TRADE_CAPABILITY_V1_GOLDEN_VECTORS.json", "sha256:c16bc3a33efbb44d4473d89279d5c28a16a321c946ba6b16933ad0ba64b7e924"],
  ["abi/ProgrammableCustomRegistryV2.json", "sha256:22da28a286141a7ce2a40f8d0e6df25f3bc8ea1f5b98d171ef3ec72bc29f0cb7"],
  ["abi/ProgrammableCustomPartnerFactoryRegistryV2.json", "sha256:7b947c6daea5ff7246eaa357f19680719f030cb85d0413e07f41f48c9a994c9e"],
  ["abi/ProgrammableCustomFeePolicyVerifierV2.json", "sha256:702549e5b400e23ec1fac7f58ade143d205299b41289069879d95c38981f6151"],
  ["abi/ProgrammableCustomExecutionPolicyRegistryV2.json", "sha256:c4b60026a71fdce20b21201fac2774e48c581bde81c7a16cdec28a654cd2518f"],
  ["abi/ProgrammableCustomExecutionPolicyRevisionRegistryV2.json", "sha256:3d34770bb729f4afb08d765a9b7faa951da221040d0982d2c768db65f7d3ea22"],
  ["abi/ProgrammableCustomAtomicRegistrarV2.json", "sha256:f6c2a46a1ca4decf327fb2e47f0f55fb39f6f004bdaf3d7c5525b57b9cfb73e4"],
]);
const expectedGenerationTwoEventSetHash =
  "sha256:1fce77eed87ebb4e09838448b282960586bcaab4f441e62e17c9b45b2ae1b46f";
const expectedGenerationTwoArtifactSetHash =
  "sha256:691c1345becc591fd3020702bd627d3545f371d3fef973d16cf3945941d7ffe7";
const expectedTradeCapabilityGoldenSemanticHash =
  "sha256:e34bab905d179337446b1f81a3c45cfc455fd4c63735600fddde04d2dc66a59e";
const expectedGenerationTwoReleaseCandidateFileHash =
  "sha256:4862d89ed0967a2df56b67810bdb5a61960b875109b46d9d95b4a470e050fd76";
const expectedGenerationTwoBuilds = new Map([
  [
    "ProgrammableCustomFeePolicyVerifierV2",
    {
      sourceSha256: "sha256:f18da940392fe45c61982617e6739145112562b251206ba908c69bd773f6cef6",
      sourceKeccak256: "0xc4c639b1f93d4b6edd07a47a470c21d0280cb29ba6b87cfa957126564420775b",
      artifactBindingHash: "sha256:e582711f661c00d9a67bbd3dc386ed0642e787c25ddd125e84b0449502a61608",
      creationCodeSha256: "sha256:223f6d4007bed7727517cfec9828e23bbdb91476061e3500f1af42697e626a17",
      runtimeCodeSha256: "sha256:70f042ad314ff9b71444130fa1742e41d8dff2ecce7ed9e38ac13d4edce4bdbe",
      runtimeCodeKeccak256: "0x21a9704c30cbac965d99b1932503ebc786bd9f54026a7d6b8539dd051f454e5f",
    },
  ],
  [
    "ProgrammableCustomPartnerFactoryRegistryV2",
    {
      sourceSha256: "sha256:92672baef9081e4946c6c9105a2d46236cb6314b62bacb76fc823251f9ee9cc1",
      sourceKeccak256: "0xb391e5d32d65ba38fe9dca32007651c009ad5e22f406d2d40d427c56af957c0a",
      artifactBindingHash: "sha256:b3ded6c29b2e22b65719effb399b137311d81da3c366a80f8fe38d1da4d84f80",
      creationCodeSha256: "sha256:757fb91fc6584950f931f3a70ed351ab7ec3f4b93ee5ecabff9ce6cb5af7715b",
      runtimeCodeSha256: "sha256:3add0de65416316007b11c19f62d9e68a2707097e5164c3bc6e3c8faf39dacab",
      runtimeCodeKeccak256: "0x3adea701dc7c5a107c8d9309a5d7f3f97ed5ddd2a248051d59defe3a608938aa",
    },
  ],
  [
    "ProgrammableCustomExecutionPolicyRegistryV2",
    {
      sourceSha256: "sha256:ada1c5b8715c45daa4f39370d8e2b68e6c3dae5fd069f0f4fb2ceb49a92597f8",
      sourceKeccak256: "0x080009e4b26f6f81dbcdff657646470d6124620cdfbfe0cb97444a285268ce25",
      artifactBindingHash: "sha256:69d5bf8aacd2f8a82eeef90736bffcbf5f6775708ed80b82457d7d693514964e",
      creationCodeSha256: "sha256:6de116cbf569cfa6609dd1d66208cbf277b3c99f72af518b63251473993db1d0",
      runtimeCodeSha256: "sha256:034f57f639e09665c3fb3d3cbbf83624f6b4384de1f798a6fb87b0e396023416",
      runtimeCodeKeccak256: "0xa03007368d4d1a05dccfa6eda78acae2188392cddec62628fc677ae995e8da58",
    },
  ],
  [
    "ProgrammableCustomExecutionPolicyRevisionRegistryV2",
    {
      sourceSha256: "sha256:7162c74f60ace5c375068b8f1094af3b62001a2e7112483e0293ea20d6f71892",
      sourceKeccak256: "0x3f78151c667db6bc5e7181ffc3d6f1ad8e52bd0a30a3e9d6977d3958748781f2",
      artifactBindingHash: "sha256:19666d52a7163ede815f50f5ee44cb75c542a859e4ed99ed0222799793767705",
      creationCodeSha256: "sha256:ebd5b38ad022a096e0b7bf6d540f3ee4794654a17d368166aeafe9d1926a0e3b",
      runtimeCodeSha256: "sha256:082b38392b55d5a9042a18fcc051376c1de135b5fa91677271423ecabe5b1fc2",
      runtimeCodeKeccak256: "0xc6a81e8a8befcfb57a7359c5460966b7ae772b0e1bf299a9bcf598304ff3bad4",
    },
  ],
  [
    "ProgrammableCustomRegistryV2",
    {
      sourceSha256: "sha256:9e7e27289fba4fef56be04696ca3d237248f53b37dbc15a8ce0a5771910b57c9",
      sourceKeccak256: "0x69fca14501b9da7a4735d80a5e0ea61f7daee6a6db741d774fc0a155197c5602",
      artifactBindingHash: "sha256:35790ee6281dcfc853099fa500566ba951393bbc7a63ab39b9936f87766243d1",
      creationCodeSha256: "sha256:df0b739f30e2bbe0606d2b28997cc5f6da5935b1eb31ec51333368be3e151ab6",
      runtimeCodeSha256: "sha256:9eb08b91181b641e054159cc9c8ec6831ae5501d21d90995775b3ac951f902cb",
      runtimeCodeKeccak256: "0x4ce3f21506e3804e0d544efb2d14074c9ff4cfafa3f814f78f2ffcaa1c10333a",
    },
  ],
  [
    "ProgrammableCustomAtomicRegistrarV2",
    {
      sourceSha256: "sha256:23b7fb556a24849a2d2be3fbc1f0aa84ec71a17814ce12c53d621e3826e5560c",
      sourceKeccak256: "0xdf76315936c8a059a0a76671cc0ea51341a8551dc8f0dfd9643f9f5c6fca417d",
      artifactBindingHash: "sha256:b498806923a0c3f37272e93517e25afb88e444c08c81f733d33c2aeb98b30aa5",
      creationCodeSha256: "sha256:b92085fa4fd8965d77aad3f852c280b13e51856b7d66928a68882c326be7008f",
      runtimeCodeSha256: "sha256:b2215c101336aeda180af505508f3582f1e16bbdfb0a36d9259cb62ec6c3c800",
      runtimeCodeKeccak256: "0x9dffd1b205a490d8db9af4ff15799136d1a2b3f1c40aa43ca1af64976aed5bd5",
    },
  ],
]);
const generationTwoEmitterByContract = new Map([
  ["ProgrammableCustomFeePolicyVerifierV2", null],
  ["ProgrammableCustomPartnerFactoryRegistryV2", "partnerFactoryRegistry"],
  ["ProgrammableCustomExecutionPolicyRegistryV2", "executionPolicyRegistry"],
  ["ProgrammableCustomExecutionPolicyRevisionRegistryV2", "executionPolicyRevisionRegistry"],
  ["ProgrammableCustomRegistryV2", "registry"],
  ["ProgrammableCustomAtomicRegistrarV2", "atomicRegistrar"],
]);
const revisionInterfaceOnlyEvents = new Set([
  "CustomLaunchExecutionPolicyBoundV2",
  "CustomLaunchExecutionRouteBoundV2",
  "CustomLaunchMarketDataSourceBoundV2",
  "CustomLaunchMarketDataMetricsBoundV2",
]);

function fail(message) {
  throw new Error(message);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function sha256Bytes(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function sha256Canonical(value) {
  return sha256Bytes(canonical(value));
}

function eventSignature(item) {
  return `${item.name}(${item.inputs.map((input) => input.type).join(",")})`;
}

function topic0(signature) {
  const result = spawnSync("cast", ["sig-event", signature], { encoding: "utf8" });
  if (result.status !== 0) fail(`cast sig-event failed for ${signature}: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

function keccak256Bytes(bytes, label) {
  const result = spawnSync("cast", ["keccak", `0x${bytes.toString("hex")}`], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0) fail(`cast keccak failed for ${label}: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

function exactHexBytes(value, label) {
  if (typeof value !== "string" || !/^0x(?:[0-9a-f]{2})+$/u.test(value)) {
    fail(`invalid ${label}`);
  }
  return Buffer.from(value.slice(2), "hex");
}

function generationTwoArtifactBinding(artifact) {
  return {
    abi: artifact.abi,
    bytecode: {
      object: artifact.bytecode?.object,
      linkReferences: artifact.bytecode?.linkReferences,
    },
    deployedBytecode: {
      object: artifact.deployedBytecode?.object,
      immutableReferences: artifact.deployedBytecode?.immutableReferences,
      linkReferences: artifact.deployedBytecode?.linkReferences,
    },
    methodIdentifiers: artifact.methodIdentifiers,
  };
}

function assertGenerationTwoCompilerBinding(artifact, name, sourcePath) {
  const settings = artifact.metadata?.settings;
  const target = settings?.compilationTarget;
  if (
    artifact.metadata?.compiler?.version !== "0.8.26+commit.8a97fa7a"
    || artifact.metadata?.language !== "Solidity"
    || canonical(target) !== canonical({ [sourcePath]: name })
    || settings?.evmVersion !== "cancun"
    || settings?.optimizer?.enabled !== true
    || settings?.optimizer?.runs !== 1000
    || settings?.metadata?.bytecodeHash !== "none"
    || settings?.metadata?.appendCBOR !== false
  ) fail(`Generation 2 compiler binding drift: ${name}`);
}

function assertArtifactMetadataSources(artifact, name) {
  const sources = artifact.metadata?.sources;
  if (sources === null || typeof sources !== "object" || Array.isArray(sources)) {
    fail(`Generation 2 metadata sources missing: ${name}`);
  }
  for (const [relativePath, metadata] of Object.entries(sources)) {
    const sourceBytes = readFileSync(join(root, "contracts", relativePath));
    const actual = keccak256Bytes(sourceBytes, `${name}:${relativePath}`);
    if (actual !== metadata?.keccak256) {
      fail(`Generation 2 Forge artifact is stale for source: ${name}:${relativePath}`);
    }
  }
}

function domainSeparatedHash(domain, value) {
  return `sha256:${createHash("sha256")
    .update(domain, "utf8")
    .update(Buffer.from([0]))
    .update(canonical(value), "utf8")
    .digest("hex")}`;
}

const securityRoot = join(root, "docs", "security");
const chainProfile = readJson(join(securityRoot, "CUSTOM_REGISTRY_CHAIN_PROFILE_V1.json"));
const registryPolicy = readJson(
  join(
    securityRoot,
    "CUSTOM_REGISTRY_POLICY_FROZEN_PREDEPLOYMENT_SNAPSHOT_V1.json",
  ),
);
const mainnetDeployment = readJson(
  join(root, "contracts", "deployments", "mainnet-custom-registry-v1.json"),
);
if (domainSeparatedHash("programmable.evm-chain-profile.v1", chainProfile)
  !== expectedChainProfileHash) fail("chain-profile hash drift");
if (domainSeparatedHash("programmable.custom-registry-policy.v1", registryPolicy)
  !== expectedRegistryPolicyHash) fail("registry-policy hash drift");
if (
  chainProfile.chainId !== "1"
  || chainProfile.profileId !== "ethereum-mainnet-v1"
  || chainProfile.finality?.mode !== "finalized-tag"
  || registryPolicy.chainId !== chainProfile.chainId
  || registryPolicy.chainProfileId !== chainProfile.profileId
  || registryPolicy.registryGeneration !== "1"
  || registryPolicy.minimumFinalityBlocks !== "64"
  || registryPolicy.defaultAdminDelaySeconds !== "172800"
  || registryPolicy.administration?.programmableFeeRecipient
    !== "0x4957f49620aff3adbbe8195a4f633e49cc93376c"
  || registryPolicy.administration?.defaultAdmin
    !== "0x2bb333d48dfaf1596d9036671d2e43168994249e"
  || registryPolicy.intake?.aeon?.providerId !== "aeon"
  || registryPolicy.intake?.generic?.status !== "prelaunch"
  || registryPolicy.intake?.generic?.publicSubmissionsEnabled !== false
  || registryPolicy.fees?.programmableNativeCustom?.totalFeeBps !== 10
  || registryPolicy.fees?.aeonPartnerCustom?.totalFeeBps !== 20
  || registryPolicy.fees?.aeonPartnerCustom?.partnerFeeBps !== 15
  || registryPolicy.fees?.aeonPartnerCustom?.programmableFeeBps !== 5
  || registryPolicy.fees?.aeonPartnerCustom?.additionalProgrammableNativeFeeBps !== 0
) fail("frozen Registry policy is invalid");

const bytes32Pattern = /^0x[0-9a-f]{64}$/u;
const addressPattern = /^0x[0-9a-f]{40}$/u;
if (
  mainnetDeployment.schemaVersion
    !== "programmable.custom-registry-mainnet-deployment-evidence.v1"
  || mainnetDeployment.chainId !== 1
  || mainnetDeployment.registryStartBlock !== "25701139"
  || mainnetDeployment.chainProfileHash !== expectedChainProfileHash.replace("sha256:", "0x")
  || mainnetDeployment.registryPolicyHash !== expectedRegistryPolicyHash.replace("sha256:", "0x")
  || !Array.isArray(mainnetDeployment.contracts)
  || mainnetDeployment.contracts.length !== expectedMainnetDeployment.size
) fail("mainnet deployment evidence envelope is invalid");

const transactionHashes = new Set();
for (const contract of mainnetDeployment.contracts) {
  const expected = expectedMainnetDeployment.get(contract.name);
  if (
    expected === undefined
    || contract.address !== expected.address
    || !addressPattern.test(contract.address)
    || contract.runtimeCodeHash !== expected.runtimeCodeHash
    || !bytes32Pattern.test(contract.runtimeCodeHash)
    || !bytes32Pattern.test(contract.transactionHash)
    || !bytes32Pattern.test(contract.blockHash)
    || !bytes32Pattern.test(contract.inputHash)
    || !/^[1-9][0-9]*$/u.test(contract.blockNumber)
  ) fail(`mainnet deployment evidence is invalid: ${contract.name ?? "unknown"}`);
  if (transactionHashes.has(contract.transactionHash)) {
    fail(`duplicate mainnet deployment transaction: ${contract.transactionHash}`);
  }
  transactionHashes.add(contract.transactionHash);
}
if (
  mainnetDeployment.contracts.find((contract) => contract.name === "ProgrammableCustomRegistryV1")
    ?.blockNumber !== mainnetDeployment.registryStartBlock
) fail("mainnet Registry start block does not match its deployment receipt");

for (const [relativePath, expectedHash] of expectedArtifactFileHashes) {
  const actualHash = `sha256:${createHash("sha256")
    .update(readFileSync(join(securityRoot, relativePath)))
    .digest("hex")}`;
  if (actualHash !== expectedHash) fail(`published artifact file hash drift: ${relativePath}`);
}

const builtEvents = [];
for (const [name, source] of contracts) {
  const artifact = readJson(join(root, "contracts", "out", source, `${name}.json`));
  const publishedAbi = readJson(join(root, "docs", "security", "abi", `${name}.json`));
  if (canonical(artifact.abi) !== canonical(publishedAbi)) fail(`published ABI drift: ${name}`);
  if (name === "ProgrammableCustomFeePolicyVerifierV1") continue;
  const emitter =
    name === "ProgrammableCustomRegistryV1"
      ? "registry"
      : name === "ProgrammableCustomPartnerFactoryRegistryV1"
        ? "partnerFactoryRegistry"
        : "atomicRegistrar";
  for (const item of artifact.abi) {
    if (item.type !== "event" || (!item.name.startsWith("Custom") && !item.name.startsWith("Atomic"))) continue;
    const signature = eventSignature(item);
    builtEvents.push({ emitter, signature, topic0: topic0(signature) });
  }
}

const eventSetPath = join(root, "docs", "security", "CUSTOM_REGISTRY_EVENT_SET_V1.json");
const eventSet = readJson(eventSetPath);
const actualHash = `sha256:${createHash("sha256")
  .update(eventSet.domain)
  .update(Buffer.from([0]))
  .update(canonical({ events: eventSet.events }))
  .digest("hex")}`;
if (actualHash !== eventSet.eventSetHash) fail(`event-set hash drift: ${actualHash}`);

const manifestKeys = new Set();
for (const event of eventSet.events) {
  const key = `${event.emitter}|${event.signature}`;
  if (manifestKeys.has(key)) fail(`duplicate event manifest row: ${key}`);
  manifestKeys.add(key);
  if (topic0(event.signature) !== event.topic0) fail(`topic drift: ${event.signature}`);
}

for (const event of builtEvents) {
  const key = `${event.emitter}|${event.signature}`;
  if (!manifestKeys.has(key)) fail(`built event missing from manifest: ${key}`);
  const row = eventSet.events.find((candidate) => `${candidate.emitter}|${candidate.signature}` === key);
  if (row.topic0 !== event.topic0) fail(`built topic mismatch: ${key}`);
}
if (manifestKeys.size !== builtEvents.length) fail("event manifest contains an event absent from the built ABIs");

for (const [relativePath, expectedHash] of expectedGenerationTwoArtifactFileHashes) {
  const actualFileHash = sha256Bytes(readFileSync(join(securityRoot, relativePath)));
  if (actualFileHash !== expectedHash) {
    fail(`Generation 2 published artifact file hash drift: ${relativePath}`);
  }
}

const generationTwoBuildRecords = [];
const generationTwoBuiltEvents = [];
for (const [name, source] of generationTwoContracts) {
  const sourcePath = `src/${source}`;
  const sourceBytes = readFileSync(join(root, "contracts", sourcePath));
  const artifact = readJson(join(root, "contracts", "out", source, `${name}.json`));
  const publishedAbi = readJson(join(securityRoot, "abi", `${name}.json`));
  const expectedBuild = expectedGenerationTwoBuilds.get(name);
  if (expectedBuild === undefined) fail(`Generation 2 expected build binding missing: ${name}`);
  if (canonical(artifact.abi) !== canonical(publishedAbi)) {
    fail(`Generation 2 published ABI drift from Forge output: ${name}`);
  }

  assertGenerationTwoCompilerBinding(artifact, name, sourcePath);
  assertArtifactMetadataSources(artifact, name);

  const sourceSha256 = sha256Bytes(sourceBytes);
  const sourceKeccak256 = keccak256Bytes(sourceBytes, `${name} source`);
  const metadataSourceKeccak256 = artifact.metadata.sources[sourcePath]?.keccak256;
  const artifactBindingHash = sha256Canonical(generationTwoArtifactBinding(artifact));
  const creationCodeSha256 = sha256Bytes(
    exactHexBytes(artifact.bytecode?.object, `${name} creation code`),
  );
  const runtimeCodeBytes = exactHexBytes(artifact.deployedBytecode?.object, `${name} runtime code`);
  const runtimeCodeSha256 = sha256Bytes(runtimeCodeBytes);
  const runtimeCodeKeccak256 = keccak256Bytes(runtimeCodeBytes, `${name} runtime code`);
  const actualBuild = {
    sourceSha256,
    sourceKeccak256,
    artifactBindingHash,
    creationCodeSha256,
    runtimeCodeSha256,
    runtimeCodeKeccak256,
  };
  if (canonical(actualBuild) !== canonical(expectedBuild)) {
    fail(`Generation 2 Source/Forge artifact binding drift: ${name}`);
  }
  if (sourceKeccak256 !== metadataSourceKeccak256) {
    fail(`Generation 2 direct source metadata drift: ${name}`);
  }

  generationTwoBuildRecords.push({
    name,
    source: sourcePath,
    ...actualBuild,
  });

  if (!generationTwoEmitterByContract.has(name)) fail(`Generation 2 emitter mapping missing: ${name}`);
  const emitter = generationTwoEmitterByContract.get(name);
  if (emitter === null) continue;
  for (const item of artifact.abi) {
    if (item.type !== "event" || (!item.name.startsWith("Custom") && !item.name.startsWith("Atomic"))) {
      continue;
    }
    if (
      name === "ProgrammableCustomExecutionPolicyRevisionRegistryV2"
      && revisionInterfaceOnlyEvents.has(item.name)
    ) continue;
    const signature = eventSignature(item);
    generationTwoBuiltEvents.push({
      emitter,
      signature,
      topic0: topic0(signature),
      inputs: item.inputs.map(({ name: inputName, type, indexed }) => ({
        name: inputName,
        type,
        indexed,
      })),
    });
  }
}

const tradeCapabilityGoldenVectorsPath = join(
  securityRoot,
  "CUSTOM_REGISTRY_TRADE_CAPABILITY_V1_GOLDEN_VECTORS.json",
);
const tradeCapabilityGoldenVectorsBytes = readFileSync(tradeCapabilityGoldenVectorsPath);
const tradeCapabilityGoldenVectors = JSON.parse(tradeCapabilityGoldenVectorsBytes);
const tradeCapabilityGoldenSemanticValue = {
  abiEncoding: tradeCapabilityGoldenVectors.abiEncoding,
  domains: tradeCapabilityGoldenVectors.domains,
  ordering: tradeCapabilityGoldenVectors.ordering,
  selectors: tradeCapabilityGoldenVectors.selectors,
  selectorPreimages: tradeCapabilityGoldenVectors.selectorPreimages,
  tupleOrder: tradeCapabilityGoldenVectors.tupleOrder,
  preimages: tradeCapabilityGoldenVectors.preimages,
  hashes: tradeCapabilityGoldenVectors.hashes,
  events: tradeCapabilityGoldenVectors.events,
};
const actualTradeCapabilityGoldenSemanticHash = domainSeparatedHash(
  tradeCapabilityGoldenVectors.schemaVersion,
  tradeCapabilityGoldenSemanticValue,
);
if (
  tradeCapabilityGoldenVectors.schemaVersion !== "programmable.trade-capability-golden-vectors.v1"
  || tradeCapabilityGoldenVectors.semanticHash !== actualTradeCapabilityGoldenSemanticHash
  || actualTradeCapabilityGoldenSemanticHash !== expectedTradeCapabilityGoldenSemanticHash
  || tradeCapabilityGoldenVectors.selectors?.deployInitializeRegisterAndBindTradeCapabilityV1 !== "0x02562444"
  || tradeCapabilityGoldenVectors.selectors?.launchPartnerFactoryRegisterAndBindTradeCapabilityV2 !== "0xd3bc499c"
  || tradeCapabilityGoldenVectors.selectors?.bindTradeCapabilityV1 !== "0x515b4f17"
  || tradeCapabilityGoldenVectors.selectors?.authorizeTradeCapabilityRevisionV1 !== "0xbabc8b86"
  || tradeCapabilityGoldenVectors.selectors?.correctAndBindRevisionV1 !== "0x1f2708f5"
  || tradeCapabilityGoldenVectors.hashes?.emptyMarketSetHash
    !== "0xbd6f28a96b79921f21d91177e262ccb903f8cee746201feb41bcd74385ae3eef"
  || tradeCapabilityGoldenVectors.hashes?.capabilityHash
    !== "0x19a4c583304c9a59eb6239f660bd188f88fb9116d87d79e131054a0d8d98340b"
  || tradeCapabilityGoldenVectors.hashes?.directMetricSetHash
    !== "0xf3e9aada876355d21cdbbc03cecd9c9d23f2a8a3ef9644a6d38c21fd05650eaf"
  || tradeCapabilityGoldenVectors.hashes?.proxyMetricSetHash
    !== "0x6e54d472f4b24c9c2c54eb7f582349bca14e21dce5c2ecfe345a75ce1a34dccd"
  || tradeCapabilityGoldenVectors.hashes?.emptyMetricSetHash
    !== "0x7b5384e78f1bd4310c1264ebe06d19b2fc61f8ff2781748daa2e14df0387082a"
  || tradeCapabilityGoldenVectors.preimages?.marketEventAbi?.topic0
    !== "0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f"
  || tradeCapabilityGoldenVectors.preimages?.marketEventAbi?.eventAbiHash
    !== "0x1f78f08e9f5b4cc333d23763649077ecf88c57fc71d45bc351e5041ecabf7ec7"
  || tradeCapabilityGoldenVectors.preimages?.marketEventFilter?.filterHash
    !== "0x0c1fb95e388d80a8e44f4385b55c6a0ca53f81c34fa4339ae3b246dccf6b1887"
  || tradeCapabilityGoldenVectors.preimages?.marketDataDerivation?.derivationPolicyHash
    !== "0xafa2d5423e506aa7bfd536bbfd10eb2fec4b23219557a053af7be2a52019c330"
) fail("Generation 2 trade-capability golden-vector semantic drift");
const tradeCapabilityGoldenFileHash = sha256Bytes(tradeCapabilityGoldenVectorsBytes);

const actualArtifactSetHash = domainSeparatedHash(
  "programmable.custom-registry-artifact-set.v2",
  {
    contracts: generationTwoBuildRecords,
    tradeCapabilityGoldenVectors: {
      fileSha256: tradeCapabilityGoldenFileHash,
      semanticHash: actualTradeCapabilityGoldenSemanticHash,
    },
  },
);
if (actualArtifactSetHash !== expectedGenerationTwoArtifactSetHash) {
  fail(`Generation 2 artifact-set hash drift: ${actualArtifactSetHash}`);
}

const generationTwoEventSet = readJson(join(securityRoot, "CUSTOM_REGISTRY_EVENT_SET_V2.json"));
if (generationTwoEventSet.domain !== "programmable.custom-registry-event-set.v2") {
  fail("Generation 2 event-set domain drift");
}
const generationTwoManifestKeys = new Set();
const generationTwoEmitterTopics = new Set();
for (const event of generationTwoEventSet.events) {
  const key = `${event.emitter}|${event.signature}`;
  if (generationTwoManifestKeys.has(key)) fail(`duplicate Generation 2 event manifest row: ${key}`);
  generationTwoManifestKeys.add(key);
  if (topic0(event.signature) !== event.topic0) fail(`Generation 2 topic drift: ${event.signature}`);
  const emitterTopic = `${event.emitter}|${event.topic0}`;
  if (generationTwoEmitterTopics.has(emitterTopic)) {
    fail(`duplicate Generation 2 emitter/topic row: ${emitterTopic}`);
  }
  generationTwoEmitterTopics.add(emitterTopic);
}
for (const event of generationTwoBuiltEvents) {
  const key = `${event.emitter}|${event.signature}`;
  const row = generationTwoEventSet.events.find(
    (candidate) => `${candidate.emitter}|${candidate.signature}` === key,
  );
  if (row === undefined) fail(`Generation 2 built event missing from manifest: ${key}`);
  if (row.topic0 !== event.topic0) fail(`Generation 2 built topic mismatch: ${key}`);
  if (canonical(row.inputs) !== canonical(event.inputs)) fail(`Generation 2 event layout mismatch: ${key}`);
}
if (generationTwoManifestKeys.size !== generationTwoBuiltEvents.length) {
  fail("Generation 2 event manifest contains an event absent from the built ABIs");
}

const builtEventDeclarations = generationTwoEventSet.events.map((row) => {
  const built = generationTwoBuiltEvents.find(
    (candidate) => candidate.emitter === row.emitter && candidate.signature === row.signature,
  );
  if (built === undefined) fail(`Generation 2 event declaration missing from Forge output: ${row.id}`);
  return { ...row, signature: built.signature, topic0: built.topic0 };
});
const generationTwoSemanticHash = domainSeparatedHash(
  generationTwoEventSet.domain,
  { events: builtEventDeclarations },
);
if (
  generationTwoSemanticHash !== generationTwoEventSet.eventSetHash
  || generationTwoSemanticHash !== expectedGenerationTwoEventSetHash
) fail(`Generation 2 event-set semantic hash drift: ${generationTwoSemanticHash}`);

const generationTwoReleaseCandidatePath = join(
  root,
  "contracts",
  "spec",
  "custom-registry-generation-2-release-candidate.json",
);
if (sha256Bytes(readFileSync(generationTwoReleaseCandidatePath)) !== expectedGenerationTwoReleaseCandidateFileHash) {
  fail("Generation 2 release-candidate manifest file hash drift");
}
const generationTwoReleaseCandidate = readJson(generationTwoReleaseCandidatePath);
const expectedReleaseContractNames = {
  feePolicyVerifier: "ProgrammableCustomFeePolicyVerifierV2",
  partnerFactoryRegistry: "ProgrammableCustomPartnerFactoryRegistryV2",
  executionPolicyRegistry: "ProgrammableCustomExecutionPolicyRegistryV2",
  executionPolicyRevisionRegistry: "ProgrammableCustomExecutionPolicyRevisionRegistryV2",
  registry: "ProgrammableCustomRegistryV2",
  atomicRegistrar: "ProgrammableCustomAtomicRegistrarV2",
};
if (
  generationTwoReleaseCandidate.schemaVersion !== "programmable.custom-registry-release-candidate.v1"
  || generationTwoReleaseCandidate.status !== "release_candidate"
  || generationTwoReleaseCandidate.registryGeneration !== 2
  || generationTwoReleaseCandidate.contractIntegrationAbiVersion !== 1
  || generationTwoReleaseCandidate.minimumSupportedPublicApiVersion !== 2
  || generationTwoReleaseCandidate.registryRecordProducerVersion !== 4
  || generationTwoReleaseCandidate.release?.artifactSetHash !== expectedGenerationTwoArtifactSetHash
  || generationTwoReleaseCandidate.release?.eventSetFileHash
    !== expectedGenerationTwoArtifactFileHashes.get("CUSTOM_REGISTRY_EVENT_SET_V2.json")
  || generationTwoReleaseCandidate.release?.eventSetSemanticHash !== expectedGenerationTwoEventSetHash
  || generationTwoReleaseCandidate.release?.eventDeclarationCount !== generationTwoBuiltEvents.length
  || generationTwoReleaseCandidate.release?.tradeCapabilityGoldenVectorsFileHash
    !== tradeCapabilityGoldenFileHash
  || generationTwoReleaseCandidate.release?.tradeCapabilityGoldenVectorsSemanticHash
    !== actualTradeCapabilityGoldenSemanticHash
  || generationTwoReleaseCandidate.release?.sourceCommit !== null
  || generationTwoReleaseCandidate.release?.registryPolicyHash !== null
  || generationTwoReleaseCandidate.release?.deployer !== null
  || generationTwoReleaseCandidate.release?.startingNonce !== null
  || generationTwoReleaseCandidate.release?.releaseApproval !== null
  || generationTwoReleaseCandidate.release?.canaryTransactionHash !== null
  || generationTwoReleaseCandidate.release?.canaryLaunchId !== null
  || generationTwoReleaseCandidate.release?.publicSubmissionsEnabled !== false
  || generationTwoReleaseCandidate.chain?.chainId !== null
  || generationTwoReleaseCandidate.chain?.caip2 !== null
  || generationTwoReleaseCandidate.chain?.chainProfileHash !== null
  || generationTwoReleaseCandidate.compatibility?.generationOneModified !== false
  || generationTwoReleaseCandidate.compatibility?.closedPublicV2LaunchObjectModified !== false
  || generationTwoReleaseCandidate.compatibility?.tradeCapabilityExposure !== "linked-versioned-resource"
  || canonical(generationTwoReleaseCandidate.execution?.providerFactoryExecutionProxyKinds) !== canonical(["none"])
) fail("Generation 2 release-candidate manifest drift");
let releaseDeploymentOrder = 0;
for (const [key, expectedName] of Object.entries(expectedReleaseContractNames)) {
  releaseDeploymentOrder += 1;
  const entry = generationTwoReleaseCandidate.contracts?.[key];
  const expectedBuild = expectedGenerationTwoBuilds.get(expectedName);
  const source = generationTwoContracts.find(([name]) => name === expectedName)?.[1];
  const artifact = readJson(join(root, "contracts", "out", source, `${expectedName}.json`));
  const runtimeSize = exactHexBytes(artifact.deployedBytecode?.object, `${expectedName} runtime code`).length;
  const initcodeSize = exactHexBytes(artifact.bytecode?.object, `${expectedName} creation code`).length;
  if (
    entry?.name !== expectedName
    || entry.deploymentOrder !== releaseDeploymentOrder
    || entry.source !== `src/${source}`
    || entry.sourceSha256 !== expectedBuild.sourceSha256
    || entry.sourceKeccak256 !== expectedBuild.sourceKeccak256
    || entry.artifactBindingHash !== expectedBuild.artifactBindingHash
    || entry.creationCodeSha256 !== expectedBuild.creationCodeSha256
    || entry.runtimeCodeSha256 !== expectedBuild.runtimeCodeSha256
    || entry.candidateRuntimeCodeKeccak256 !== expectedBuild.runtimeCodeKeccak256
    || entry.runtimeSizeBytes !== runtimeSize
    || entry.initcodeSizeBytes !== initcodeSize
    || entry.abiFileSha256 !== expectedGenerationTwoArtifactFileHashes.get(`abi/${expectedName}.json`)
    || entry.address !== null
    || entry.startBlock !== null
    || entry.deploymentTransactionHash !== null
    || entry.runtimeCodeHash !== null
    || entry.sourceVerified !== false
  ) fail(`Generation 2 release-candidate deployment boundary drift: ${key}`);
}

process.stdout.write(
  `verified ${contracts.length} Generation 1 published ABIs, ${builtEvents.length} Generation 1 event signatures, `
    + `${generationTwoContracts.length} Generation 2 Source/Forge/ABI bindings, `
    + `${generationTwoBuiltEvents.length} Generation 2 event declarations, ${actualArtifactSetHash}, `
    + `${generationTwoSemanticHash}, ${expectedChainProfileHash}, ${expectedRegistryPolicyHash}, `
    + "the trade-capability golden vectors, and the four-contract Ethereum Mainnet Generation 1 deployment evidence\n",
);
