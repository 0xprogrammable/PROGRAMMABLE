#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

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

function eventSignature(item) {
  return `${item.name}(${item.inputs.map((input) => input.type).join(",")})`;
}

function topic0(signature) {
  const result = spawnSync("cast", ["sig-event", signature], { encoding: "utf8" });
  if (result.status !== 0) fail(`cast sig-event failed for ${signature}: ${result.stderr.trim()}`);
  return result.stdout.trim();
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
const registryPolicy = readJson(join(securityRoot, "CUSTOM_REGISTRY_POLICY_V1.json"));
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

for (const [relativePath, expectedHash] of expectedArtifactFileHashes) {
  const actualHash = `sha256:${createHash("sha256")
    .update(readFileSync(join(securityRoot, relativePath)))
    .digest("hex")}`;
  if (actualHash !== expectedHash) fail(`published artifact file hash drift: ${relativePath}`);
}

const builtEvents = [];
for (const [name, source] of contracts) {
  const artifact = readJson(join(root, "out", source, `${name}.json`));
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

process.stdout.write(
  `verified ${contracts.length} published ABIs, ${builtEvents.length} event signatures, ${eventSet.eventSetHash}, ${expectedChainProfileHash}, and ${expectedRegistryPolicyHash}\n`,
);
