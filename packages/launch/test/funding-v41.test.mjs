import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import solc from "solc";
import Ajv2020 from "ajv/dist/2020.js";
import { normalizeRobinhoodFundingPlanV1, assertRobinhoodFundingPlanDeployableV1 } from "../src/funding-plan-v1.mjs";
import { ROBINHOOD_PROFILE_V41 } from "../src/profile-v41.mjs";
import { normalizeV4ProfileRef, hashV4ChainDeployment } from "../src/v4-contract.mjs";
import { validateLaunchFile } from "../src/validate.mjs";
import { buildRobinhoodNative20ExampleV41 } from "../src/native20-example-v41.mjs";
import { ROBINHOOD_NATIVE_FEE_ARTIFACT_V1 } from "../src/robinhood-native-fee-v1.mjs";
import { validV4Capabilities, v4Profile, v4ChainDeployment } from "./fixtures/v4.mjs";

export const testFundingPlan = Object.freeze({ schemaVersion: "programmable.robinhood-funding-plan.v1",
  capitalSource: "buyer-funded", pricingModel: "concentrated-liquidity", nativeAllocations: {
    initialLiquidityWei: "0", initialBuyWei: "1000000000000000", reserveWei: "0", otherLaunchValueWei: "0" },
  maxLaunchValueWei: "1000000000000000", maxGasCostWei: "1000000000000000", launchMode: "fund-and-launch" });
const funding = { schemaVersion: "programmable.custom-launch-funding-intent.v2", mode: "wallet-transaction-value", valueWei: "1000000000000000" };

test("4.1 funding plans require exact canonical allocations and reviewed native budgets", () => {
  assert.deepEqual(normalizeRobinhoodFundingPlanV1(testFundingPlan, funding), testFundingPlan);
  for (const edit of [
    p => { delete p.capitalSource; }, p => { p.chainId = "1"; }, p => { p.maxGasCostWei = "0"; },
    p => { p.nativeAllocations.initialBuyWei = "1"; }, p => { p.maxLaunchValueWei = "01"; },
    p => { p.maxGasCostWei = (1n << 256n).toString(); }, p => { p.nativeAllocations.token = "0"; },
  ]) { const p = structuredClone(testFundingPlan); edit(p); assert.throws(() => normalizeRobinhoodFundingPlanV1(p, funding)); }
  const funded = { ...funding, mode: "wallet-transaction-value", valueWei: "5" };
  const plan = { ...testFundingPlan, nativeAllocations: { ...testFundingPlan.nativeAllocations,
    initialLiquidityWei: "2", initialBuyWei: "3" }, maxLaunchValueWei: "5" };
  assert.deepEqual(normalizeRobinhoodFundingPlanV1(plan, funded), plan);
  assert.throws(() => normalizeRobinhoodFundingPlanV1({ ...plan, maxLaunchValueWei: "4" }, funded), /exceeds/);
  const local = { ...testFundingPlan, launchMode: "build-only", maxGasCostWei: "0" };
  assert.equal(normalizeRobinhoodFundingPlanV1(local, funding).launchMode, "build-only");
  assert.throws(() => assertRobinhoodFundingPlanDeployableV1(local, funding), { code: "FUNDING_PLAN_BUILD_ONLY" });
});

test("4.1 exact successor profile preserves the immutable 4.0 foundation", async () => {
  assert.equal(ROBINHOOD_PROFILE_V41.profileDigest, "sha256:b0fca91264a49d358ed1a9eec2a679b59a48d716b71475bef583c2545e1ee502");
  assert.deepEqual(normalizeV4ProfileRef(v4Profile), v4Profile);
  assert.deepEqual(normalizeV4ProfileRef(ROBINHOOD_PROFILE_V41), ROBINHOOD_PROFILE_V41);
  assert.throws(() => normalizeV4ProfileRef({ ...ROBINHOOD_PROFILE_V41, profileRevision: 1 }));
  const oldSchema = JSON.parse(await readFile(new URL("../../../public/schemas/custom-launch/v4/pack-config.json", import.meta.url)));
  const newSchema = JSON.parse(await readFile(new URL("../../../public/schemas/custom-launch/v4.1/pack-config.json", import.meta.url)));
  assert.deepEqual(newSchema.$defs.chainDeployment, oldSchema.$defs.chainDeployment);
  assert.equal(newSchema.$defs.profileRef.properties.profileDigest.const, ROBINHOOD_PROFILE_V41.profileDigest);
  assert.ok(newSchema.required.includes("fundingPlan"));
  assert.equal(oldSchema.required.includes("fundingPlan"), false);
});

test("native20 exact two-unit source kit packs, derives the child vault and binds funding to intent", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "programmable-native20-v41-"));
  try {
    await cp(new URL("../examples/robinhood-v4-native20/project/src", import.meta.url), path.join(root, "src"), { recursive: true });
    await mkdir(path.join(root, "assets"));
    await writeFile(path.join(root, "assets/token.png"), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));
    const input = { launchWallet: "0x1111111111111111111111111111111111111111", nonce: `0x${"44".repeat(32)}`,
      publicOrigin: { url: "https://github.com/programmablehq/PROGRAMMABLE", revision: "11".repeat(20) },
      checkedAt: "2026-09-05T12:00:00.000Z", fundingPlan: testFundingPlan, minimumTokensOut: "1",
      projectMetadata: { schemaVersion: "programmable.project-metadata-input.v1",
        token: { name: "Robinhood Native20 Example", symbol: "RHN20" }, presentation: {
          description: "Locked token inventory example with native ETH platform fee and explicit gas budget.",
          image: { sourcePath: "assets/token.png", uri: "https://example.com/token.png" }, links: [
            { kind: "website", uri: "https://example.com/" }, { kind: "x", uri: "https://x.com/native20_example" },
          ] } } };
    const result = await buildRobinhoodNative20ExampleV41({ projectRoot: root, solc,
      capabilities: validV4Capabilities({ profile: ROBINHOOD_PROFILE_V41 }), input,
      permitWindow: { validAfter: "1", deadline: "2" } });
    const request = result.built.request;
    await writeFile(path.join(root, "launch.json"), result.built.requestBytes);
    assert.equal((await validateLaunchFile({ launchPath: path.join(root, "launch.json"), configPath: result.configPath })).launchIntentHash, request.launchIntentHash);
    assert.equal(request.chainDeploymentDescriptorDigest, hashV4ChainDeployment(v4ChainDeployment));
    assert.deepEqual(request.fundingPlan, testFundingPlan);
    assert.equal(request.graphBundle.targets[2].creationBytecode, ROBINHOOD_NATIVE_FEE_ARTIFACT_V1.kernel.creationBytecode);
    assert.deepEqual(request.graphBundle.targets.map(({ targetId }) => targetId), ["initializer", "token", "hook"]);
    assert.equal(Number(BigInt(result.built.predictions[2].predictedAddress) & 0x3fffn), 0x20cc);
    assert.notEqual(result.vaultAddress, "0x0000000000000000000000000000000000000000");
    assert.equal(result.built.receipt.openapi, "https://programmable.market/openapi/custom-launch-v4.1.json");
    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    for (const [name, value] of [["pack-config", result.config], ["create-request", request]]) {
      const schema = JSON.parse(await readFile(new URL(`../../../public/schemas/custom-launch/v4.1/${name}.json`, import.meta.url)));
      const validate = ajv.compile(schema);
      assert.equal(validate(value), true, JSON.stringify(validate.errors));
      const missing = structuredClone(value); delete missing.fundingPlan;
      assert.equal(validate(missing), false);
    }
    const changed = structuredClone(request);
    changed.fundingPlan.maxGasCostWei = "2000000000000000";
    await writeFile(path.join(root, "changed.json"), JSON.stringify(changed));
    await assert.rejects(validateLaunchFile({ launchPath: path.join(root, "changed.json"), configPath: result.configPath }), /launchIntentHash/);
    if (process.env.PROGRAMMABLE_LOCAL_RECIPE_OUTPUT) {
      await cp(root, process.env.PROGRAMMABLE_LOCAL_RECIPE_OUTPUT, { recursive: true });
      await writeFile(path.join(process.env.PROGRAMMABLE_LOCAL_RECIPE_OUTPUT, "launch.json"), result.built.requestBytes);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
