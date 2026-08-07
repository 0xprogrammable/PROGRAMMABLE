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
  ["ProgrammableCustomRegistryV2", "ProgrammableCustomRegistryV2.sol"],
  ["ProgrammableCustomPartnerFactoryRegistryV2", "ProgrammableCustomPartnerFactoryRegistryV2.sol"],
  ["ProgrammableCustomFeePolicyVerifierV2", "ProgrammableCustomFeePolicyVerifierV2.sol"],
  ["ProgrammableCustomAtomicRegistrarV2", "ProgrammableCustomAtomicRegistrarV2.sol"],
];
const expectedGenerationTwoArtifactFileHashes = new Map([
  ["CUSTOM_REGISTRY_EVENT_SET_V2.json", "sha256:0c6c32e0db5eb55b8e0bd148a6206e0c0ab8605cda75338f3a556e75cd3eff1a"],
  ["abi/ProgrammableCustomRegistryV2.json", "sha256:7c5fe7d25cc874a319c3621435c31cd8f531a7abfcd7d5073fc163d10d60524f"],
  ["abi/ProgrammableCustomPartnerFactoryRegistryV2.json", "sha256:054b5d2740314335d202e37d405273cbb9d0922398cbc2909e7cb7cee845061e"],
  ["abi/ProgrammableCustomFeePolicyVerifierV2.json", "sha256:0bc9bdda4a1e78e2c498568ddfa164b35c3cb5c297f563dd4771935e75304f62"],
  ["abi/ProgrammableCustomAtomicRegistrarV2.json", "sha256:a053f14e59c3c54a0dad47e6e772ba411c7659a46eab3313a6c124260ebcff1f"],
]);
const expectedGenerationTwoEventSetHash =
  "sha256:bcff2958529fecaa7ef8c4c654389829bfb7dd61a3246f0d681cf7db0a42a58c";
const expectedGenerationTwoArtifactSetHash =
  "sha256:75573593dc957d4511388ee20009ed3002f12f8a148f9cadbe58e0ff73cf97ba";
const expectedGenerationTwoReleaseCandidateFileHash =
  "sha256:ce673b6dca09f6e79ebb6bf9a35936282b43b9859b53e1614b278adf69c7c0cc";
const expectedGenerationTwoBuilds = new Map([
  [
    "ProgrammableCustomRegistryV2",
    {
      sourceSha256: "sha256:6f013c147a5f1d4aba70aa335a905346bb4011fd266b75ea311e75362002051f",
      sourceKeccak256: "0xc373d34897f6f701ed772ce212412bd70cc988219472903497e870d46b6a8efc",
      artifactBindingHash: "sha256:9091a7eaa9add1d85c65050811e9f2b9dd6aa11b1ebdb288913cdd66cec28f97",
      creationCodeSha256: "sha256:9f3a363f1a120ba76427da8fa0338ddfdc4ef414118248ab82d37788fa2af605",
      runtimeCodeSha256: "sha256:0415f561d74c1ffcad93cac58729a20a08365a866de0a1db2e42aaef3e4c6d59",
      runtimeCodeKeccak256: "0x5b614de34459bb52a89f3ea876d3ea6c7a5e1fbeec688a8d11df9bc29684cb6e",
    },
  ],
  [
    "ProgrammableCustomPartnerFactoryRegistryV2",
    {
      sourceSha256: "sha256:e81544a2c30ffb35179f2e701fe54def0b5ac9bac5d4f7086d5b173905f03432",
      sourceKeccak256: "0x6ea53c4c2a6b57213b857fa0782354ca12fd8cdb156e8d8fdba14de1cb4a8cc2",
      artifactBindingHash: "sha256:79fda2123cb0bd797df7242cb2d9ecd3f5ab66a6248e1f4b8f7435031a2b3e1d",
      creationCodeSha256: "sha256:08f2932717866515d80ea1434588a0b2955b5cdcae37316e664fc37a74f09324",
      runtimeCodeSha256: "sha256:7688773e4d394c0d6c3544a0842adc9b87a5cff2a0a2d437999f6ada59b1b907",
      runtimeCodeKeccak256: "0x990af413455471779a9a1b76bf75943dabf95fdcc2821889c132f6c363aecde6",
    },
  ],
  [
    "ProgrammableCustomFeePolicyVerifierV2",
    {
      sourceSha256: "sha256:f18da940392fe45c61982617e6739145112562b251206ba908c69bd773f6cef6",
      sourceKeccak256: "0xc4c639b1f93d4b6edd07a47a470c21d0280cb29ba6b87cfa957126564420775b",
      artifactBindingHash: "sha256:2b08cd7c1e2a18d067a393ba43270a14073601ec7193ea79c4d86e26aef794f3",
      creationCodeSha256: "sha256:223f6d4007bed7727517cfec9828e23bbdb91476061e3500f1af42697e626a17",
      runtimeCodeSha256: "sha256:70f042ad314ff9b71444130fa1742e41d8dff2ecce7ed9e38ac13d4edce4bdbe",
      runtimeCodeKeccak256: "0x21a9704c30cbac965d99b1932503ebc786bd9f54026a7d6b8539dd051f454e5f",
    },
  ],
  [
    "ProgrammableCustomAtomicRegistrarV2",
    {
      sourceSha256: "sha256:556bd3ec006015b4a995fc930a9abc7388e37ec4bfefed216d9e1b190f2a489b",
      sourceKeccak256: "0x524546ab24adca6d8a54b4907aa731616691018ce46923664011c3e3f52617c4",
      artifactBindingHash: "sha256:f4b72b641df01420696430a473e3093476027331581ed6eb3c45d6f60ecb828d",
      creationCodeSha256: "sha256:e2b3c58dd6516d155bbfdae49866b34344c15c6bd3968614fc020ec4f10f9e39",
      runtimeCodeSha256: "sha256:ad7efb522b51299d0529ece070b414066d792bd0264be3801c917b8b0ca7fa20",
      runtimeCodeKeccak256: "0x4969b46b1c540827ebcced06192d7204fc2b5a47eced3c587134b82d3cec3e04",
    },
  ],
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

  if (name === "ProgrammableCustomFeePolicyVerifierV2") continue;
  const emitter =
    name === "ProgrammableCustomRegistryV2"
      ? "registry"
      : name === "ProgrammableCustomPartnerFactoryRegistryV2"
        ? "partnerFactoryRegistry"
        : "atomicRegistrar";
  for (const item of artifact.abi) {
    if (item.type !== "event" || (!item.name.startsWith("Custom") && !item.name.startsWith("Atomic"))) {
      continue;
    }
    const signature = eventSignature(item);
    generationTwoBuiltEvents.push({ emitter, signature, topic0: topic0(signature) });
  }
}

const actualArtifactSetHash = domainSeparatedHash(
  "programmable.custom-registry-artifact-set.v2",
  { contracts: generationTwoBuildRecords },
);
if (actualArtifactSetHash !== expectedGenerationTwoArtifactSetHash) {
  fail(`Generation 2 artifact-set hash drift: ${actualArtifactSetHash}`);
}

const generationTwoEventSet = readJson(join(securityRoot, "CUSTOM_REGISTRY_EVENT_SET_V2.json"));
if (generationTwoEventSet.domain !== "programmable.custom-registry-event-set.v2") {
  fail("Generation 2 event-set domain drift");
}
const generationTwoManifestKeys = new Set();
for (const event of generationTwoEventSet.events) {
  const key = `${event.emitter}|${event.signature}`;
  if (generationTwoManifestKeys.has(key)) fail(`duplicate Generation 2 event manifest row: ${key}`);
  generationTwoManifestKeys.add(key);
  if (topic0(event.signature) !== event.topic0) fail(`Generation 2 topic drift: ${event.signature}`);
}
for (const event of generationTwoBuiltEvents) {
  const key = `${event.emitter}|${event.signature}`;
  const row = generationTwoEventSet.events.find(
    (candidate) => `${candidate.emitter}|${candidate.signature}` === key,
  );
  if (row === undefined) fail(`Generation 2 built event missing from manifest: ${key}`);
  if (row.topic0 !== event.topic0) fail(`Generation 2 built topic mismatch: ${key}`);
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
  registry: "ProgrammableCustomRegistryV2",
  partnerFactoryRegistry: "ProgrammableCustomPartnerFactoryRegistryV2",
  feePolicyVerifier: "ProgrammableCustomFeePolicyVerifierV2",
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
) fail("Generation 2 release-candidate manifest drift");
for (const [key, expectedName] of Object.entries(expectedReleaseContractNames)) {
  const entry = generationTwoReleaseCandidate.contracts?.[key];
  if (
    entry?.name !== expectedName
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
    + `${generationTwoSemanticHash}, ${expectedChainProfileHash}, and ${expectedRegistryPolicyHash}\n`,
);
