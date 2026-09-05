#!/usr/bin/env node
// Additive successor generation. Frozen v4.0 and Ethereum documents are read-only inputs.
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ROBINHOOD_PROFILE_V41 } from "../src/profile-v41.mjs";
import { ROBINHOOD_FEE_REVIEW_SCHEMA_V1 } from "../src/fee-review-v1.mjs";
import { ROBINHOOD_FUNDING_PLAN_SCHEMA_V1 } from "../src/funding-plan-v1.mjs";

const packageRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const repositoryRoot = path.resolve(packageRoot, "../..");
const oldRoot = path.join(repositoryRoot, "public/schemas/custom-launch/v4");
const newRoot = path.join(repositoryRoot, "public/schemas/custom-launch/v4.1");
const check = process.argv.includes("--check");
if (process.argv.slice(2).some((arg) => arg !== "--check")) throw new TypeError("only --check is accepted");
const uint = { type: "string", pattern: "^(?:0|[1-9][0-9]*)$", maxLength: 78 };
const closed = (properties) => ({ type: "object", additionalProperties: false,
  required: Object.keys(properties), properties });
const fundingPlan = closed({
  schemaVersion: { const: ROBINHOOD_FUNDING_PLAN_SCHEMA_V1 },
  capitalSource: { enum: ["buyer-funded", "creator-funded", "hybrid", "custom"] },
  pricingModel: { enum: ["concentrated-liquidity", "custom-curve", "auction", "custom"] },
  nativeAllocations: closed({ initialLiquidityWei: uint, initialBuyWei: uint,
    reserveWei: uint, otherLaunchValueWei: uint }),
  maxLaunchValueWei: uint, maxGasCostWei: uint,
  launchMode: { enum: ["fund-and-launch", "build-only"] },
});
fundingPlan.description = "Declared native capital allocation and reviewed budgets; not proof of balances, reserves, solvency, liquidity or gas availability. Allocation sum must equal funding.valueWei without uint256 overflow and must not exceed maxLaunchValueWei. Build-only permits local pack/preflight only; fresh create must reject before persistence or signing.";
fundingPlan.allOf = [{ if: { properties: { launchMode: { const: "fund-and-launch" } }, required: ["launchMode"] },
  then: { properties: { maxGasCostWei: { ...uint, pattern: "^[1-9][0-9]*$" } } } }];

function successor(value) {
  if (typeof value === "string") return value
    .replaceAll("/schemas/custom-launch/v4/", "/schemas/custom-launch/v4.1/")
    .replaceAll("/openapi/custom-launch-v4.json", "/openapi/custom-launch-v4.1.json")
    .replaceAll("custom-launch-create-request.json", "create-request.json");
  if (Array.isArray(value)) return value.map(successor);
  if (value === null || typeof value !== "object") return value;
  // The foundation deployment is historical evidence, not the active launch profile.
  if (value.properties?.schemaVersion?.const === "programmable.custom-launch-chain-deployment.v1") return structuredClone(value);
  const result = Object.fromEntries(Object.entries(value).map(([key, child]) => [key, successor(child)]));
  if (result.properties?.schemaVersion?.const === "programmable.custom-launch-profile-ref.v4") {
    for (const [key, literal] of Object.entries(ROBINHOOD_PROFILE_V41)) result.properties[key] = { const: literal };
  }
  if (result.properties?.funding && result.properties?.profile
    && ["programmable.custom-launch-create-request.v4", "programmable.custom-launch.v4",
      "programmable.launch-pack-config.v4"].includes(result.properties.schemaVersion?.const)) {
    result.properties.fundingPlan = structuredClone(fundingPlan);
    result.required = [...result.required, "fundingPlan"];
  }
  const version = result.properties?.schemaVersion?.const;
  if (version === "programmable.custom-launch.v4") result.properties.feeReview = structuredClone(ROBINHOOD_FEE_REVIEW_SCHEMA_V1);
  if (version === "programmable.custom-launch-admission-receipt.v4") {
    result.properties.feeReviewDigest = { anyOf: [{ type: "string", pattern: "^sha256:[0-9a-f]{64}$" }, { type: "null" }] };
    result.required = [...result.required, "feeReviewDigest"];
    result.allOf = [...(result.allOf ?? []), { if: { properties: { disposition: { enum: ["supported", "supported_with_warnings"] } }, required: ["disposition"] }, then: { properties: { feeReviewDigest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" } } } }];
  }
  if (result["x-programmable-contract"]?.cliReleaseVersion) result["x-programmable-contract"].cliReleaseVersion = "4.1.0";
  return result;
}

async function emit(file, value) {
  const bytes = `${JSON.stringify(value, null, 2)}\n`;
  if (check) {
    if (await readFile(file, "utf8") !== bytes) throw new Error(`V4.1 machine contract drift: ${file}`);
  } else {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, bytes);
  }
}

for (const name of (await readdir(oldRoot)).filter((name) => name.endsWith(".json")).sort()) {
  const value = successor(JSON.parse(await readFile(path.join(oldRoot, name), "utf8")));
  const successorName = name === "custom-launch-create-request.json" ? "create-request.json" : name;
  if (name === "pack-config.json") {
    value.description = "Profile 4.1.0/revision 2 Robinhood pack configuration with explicit native fundingPlan. Use the exact current advertised profile; do not infer funding or fee guarantees from a declaration.";
    await emit(path.join(packageRoot, "schemas/programmable-launch-pack-config-v4.1.json"), value);
  }
  await emit(path.join(newRoot, successorName), value);
}
await emit(path.join(newRoot, "funding-plan.json"), {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://programmable.market/schemas/custom-launch/v4.1/funding-plan.json",
  title: "Programmable Robinhood native funding plan", ...fundingPlan,
});
const openapi = successor(JSON.parse(await readFile(path.join(repositoryRoot, "public/openapi/custom-launch-v4.json"), "utf8")));
openapi.info.version = "4.1.0";
openapi.info.title = "Programmable Custom Launch API V4 profile 4.1";
openapi.info.description += " Profile 4.1.0/revision 2 requires the hash-bound fundingPlan. Build-only requests are pack/preflight only. Budgets do not prove available native funds; exact wallet gas/balance checks occur later. Historical profile 4.0 requests and resources retain their frozen 4.0 contracts.";
openapi.components.schemas.RobinhoodFundingPlanV1 = structuredClone(fundingPlan);
openapi.components.schemas.RobinhoodNativeFeeKernelProofV1 = structuredClone(ROBINHOOD_FEE_REVIEW_SCHEMA_V1);
await emit(path.join(repositoryRoot, "public/openapi/custom-launch-v4.1.json"), openapi);
console.log(check ? "V4.1 machine contracts match additive generation" : "Generated additive V4.1 machine contracts");
