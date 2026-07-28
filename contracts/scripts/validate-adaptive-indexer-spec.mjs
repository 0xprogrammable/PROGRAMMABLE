#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { keccak256, stringToHex } from "viem";

const contractsRoot = path.resolve(import.meta.dirname, "..");
const spec = JSON.parse(
  await fs.readFile(path.join(contractsRoot, "spec", "adaptive-indexer-v1.json"), "utf8"),
);
const fixture = JSON.parse(
  await fs.readFile(
    path.join(contractsRoot, "spec", "fixtures", "adaptive-mainnet-fork-v1.json"),
    "utf8",
  ),
);

function fail(message) {
  throw new Error(message);
}

if (spec.schemaVersion !== 1 || spec.model !== "adaptive-v1") {
  fail("Adaptive indexer specification identity is invalid");
}
const eventByName = new Map();
for (const event of spec.events) {
  if (eventByName.has(event.name)) fail(`Duplicate event name: ${event.name}`);
  const calculatedTopic = keccak256(stringToHex(event.signature));
  if (calculatedTopic !== event.topic0) {
    fail(`${event.name} topic mismatch: ${calculatedTopic} != ${event.topic0}`);
  }
  const indexedCount = event.fields.filter((field) => field.indexed).length;
  if (indexedCount > 3) fail(`${event.name} declares more than three indexed fields`);
  eventByName.set(event.name, event);
}

for (const event of fixture.events) {
  const definition = eventByName.get(event.name);
  if (!definition) fail(`Fixture references unknown event: ${event.name}`);
  if (definition.topic0 !== event.topic0) fail(`Fixture topic mismatch for ${event.name}`);
  for (const field of definition.fields) {
    if (!(field.name in event.args)) fail(`Fixture ${event.name} is missing ${field.name}`);
  }
}

const points = fixture.curvePoints;
const registered = fixture.events.find((event) => event.name === "AdaptiveCurveRegistered");
const disclosure = fixture.events.find((event) => event.name === "AdaptiveCurveDisclosure");
const swapFees = fixture.events.find((event) => event.name === "NativeSwapFeesAccrued");
if (!registered || !disclosure || !swapFees) fail("Fixture is missing required economic events");
if (points.length !== registered.args.curvePointCount) fail("Curve point count mismatch");
if (points.length < 2 || points.length > 8) fail("Curve point count outside protocol bounds");
if (points[0].fdvIndex !== -887272 || points.at(-1).fdvIndex !== 887272) {
  fail("Curve fixture does not cover the complete tick range");
}
for (let index = 0; index < points.length; index += 1) {
  const point = points[index];
  if (point.pointIndex !== index) fail("Curve fixture indexes are not contiguous");
  if (index > 0 && point.fdvIndex <= points[index - 1].fdvIndex) {
    fail("Curve fixture FDV indexes are not strictly increasing");
  }
  if (point.totalSwapFeeBps < 100 || point.totalSwapFeeBps > 1000) {
    fail("Curve fixture fee is outside 1% to 10%");
  }
}
if (
  disclosure.args.launcherFeeBps !== 10 ||
  disclosure.args.transferTaxBps !== 0 ||
  disclosure.args.lpFeePips !== 0 ||
  disclosure.args.symmetricBuyAndSell !== true ||
  disclosure.args.usesPreSwapTick !== true
) {
  fail("Fixture disclosure differs from Adaptive V1 economics");
}

const gross = BigInt(swapFees.args.grossNativeAmount);
const creatorFee = BigInt(swapFees.args.creatorFee);
const launcherFee = BigInt(swapFees.args.launcherFee);
const expectedTotal = (gross * BigInt(swapFees.args.totalSwapFeeBps)) / 10_000n;
const expectedLauncher = (gross * 10n) / 10_000n;
if (creatorFee + launcherFee !== expectedTotal || launcherFee !== expectedLauncher) {
  fail("Fixture fee accounting does not conserve the disclosed split");
}

const launchEvents = fixture.events.filter((event) =>
  [
    "AdaptiveTokenLaunched",
    "AdaptiveLiquidityConfigured",
    "AdaptiveCurveConfigured",
    "AdaptiveCreatorInitialBuy",
  ].includes(event.name),
);
for (const event of launchEvents) {
  if (event.args.launchHash !== fixture.launch.launchHash) fail(`${event.name} launch hash mismatch`);
  if ("token" in event.args && event.args.token !== fixture.launch.token) {
    fail(`${event.name} token mismatch`);
  }
  if ("poolId" in event.args && event.args.poolId !== fixture.launch.poolId) {
    fail(`${event.name} pool mismatch`);
  }
}

console.log(`Adaptive indexer spec validated: ${spec.events.length} events and one fork fixture.`);
