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

process.stdout.write(
  `verified ${contracts.length} published ABIs, ${builtEvents.length} event signatures, and ${eventSet.eventSetHash}\n`,
);
