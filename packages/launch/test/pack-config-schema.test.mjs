import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import Ajv2020 from "ajv/dist/2020.js";

const schema = JSON.parse(await readFile(
  new URL("../schemas/programmable-launch-pack-config-v3.json", import.meta.url),
  "utf8",
));
const validate = new Ajv2020({
  allErrors: true,
  strict: true,
  strictRequired: false,
  validateFormats: false,
})
  .compile(schema);

test("published V3 pack-config schema accepts v2 nested authorization paths", () => {
  const config = baseConfig();
  assert.equal(validate(config), true, JSON.stringify(validate.errors));
});

test("published V3 pack-config schema accepts no-funding native and wallet-value modes", () => {
  for (const mode of ["none", "wallet-transaction-value"]) {
    const config = baseConfig();
    config.launchProfile.fundingMode = mode;
    config.pool.quoteCurrency = "0x0000000000000000000000000000000000000000";
    delete config.fundingAuthorization;
    delete config.fundingSignaturePatch;
    if (mode === "wallet-transaction-value") {
      config.targets[2].initializerValueWei = "1";
    }
    assert.equal(validate(config), true, `${mode}: ${JSON.stringify(validate.errors)}`);
  }
});

test("published V3 pack-config schema rejects legacy applicant offsets", () => {
  const config = baseConfig();
  config.fundingSignaturePatch = {
    targetId: "initializer",
    rOffsetBytes: 4,
    sOffsetBytes: 36,
    vOffsetBytes: 68,
  };
  assert.equal(validate(config), false);
});

test("published V3 pack-config schema bounds every ABI path index to 0..255", () => {
  const config = baseConfig();
  config.fundingSignaturePatch.nonceArgumentPath = [256];
  assert.equal(validate(config), false);
});

test("published V3 pack-config schema matches the positive Uniswap v4 tick-spacing bound", () => {
  const config = baseConfig();
  config.pool.tickSpacing = 0;
  assert.equal(validate(config), false);
});

test("published V3 pack-config schema uses the parser's literal runtime-immutable field", () => {
  const config = baseConfig();
  config.targets[0].runtimeImmutables = [{
    immutableId: "0",
    abiType: "address",
    literal: "0x1111111111111111111111111111111111111111",
  }];
  assert.equal(validate(config), true, JSON.stringify(validate.errors));

  config.targets[0].runtimeImmutables[0] = {
    immutableId: "0",
    abiType: "address",
    value: "0x1111111111111111111111111111111111111111",
  };
  assert.equal(validate(config), false);
});

test("published V3 pack-config schema binds exact ordered liquidity assessment vectors", () => {
  const cases = [
    {
      model: "launch-seeded-concentrated-liquidity",
      targetField: "liquidityTargetId",
      targetId: "initializer",
      vectors: [
        "liquidity.seeded.pool-active-liquidity",
        "liquidity.seeded.position-custody-and-withdrawal",
        "liquidity.seeded.buy-and-sell",
      ],
    },
    {
      model: "hook-inventory-custom-accounting",
      targetField: "inventoryTargetId",
      targetId: "hook",
      vectors: [
        "liquidity.hook-inventory.buy-settlement",
        "liquidity.hook-inventory.sell-settlement",
        "liquidity.hook-inventory.delta-solvency",
        "liquidity.hook-inventory.backing-and-withdrawal",
      ],
    },
  ];
  for (const candidate of cases) {
    const config = baseConfig();
    config.launchProfile.liquidityModel = {
      schemaVersion: "programmable.direct-native-liquidity-model-intent.v1",
      model: candidate.model,
      declaredLaunchState: "assessment_required",
      [candidate.targetField]: candidate.targetId,
      assessment: {
        schemaVersion: "programmable.direct-native-liquidity-model-assessment.v1",
        status: "required",
        requestClaimsExecution: false,
        requiredVectorIds: candidate.vectors,
      },
    };
    assert.equal(validate(config), true, JSON.stringify(validate.errors));
    config.launchProfile.liquidityModel.assessment.requiredVectorIds = [
      ...candidate.vectors,
    ].reverse();
    assert.equal(validate(config), false);
  }
});

test("published V3 pack-config schema matches fee and salt-grind parser bounds", () => {
  const config = baseConfig();
  config.launchProfile.applicantSelectedBuyHundredthsOfBip = "999999";
  assert.equal(validate(config), true, JSON.stringify(validate.errors));
  config.launchProfile.applicantSelectedBuyHundredthsOfBip = "1000000";
  assert.equal(validate(config), false);

  config.launchProfile.accountingMode = "additive-platform-share";
  config.launchProfile.applicantSelectedBuyHundredthsOfBip = "998999";
  assert.equal(validate(config), true, JSON.stringify(validate.errors));
  config.launchProfile.applicantSelectedBuyHundredthsOfBip = "999000";
  assert.equal(validate(config), false);

  config.launchProfile.accountingMode = "inclusive-selected-total";
  config.launchProfile.applicantSelectedBuyHundredthsOfBip = "1000";
  config.targets[1].applicantSalt = {
    mode: "deterministic-hook-permission-grind-v1",
    start: "0",
    maxAttempts: "1000000",
  };
  assert.equal(validate(config), true, JSON.stringify(validate.errors));
  config.targets[1].applicantSalt.maxAttempts = "1000001";
  assert.equal(validate(config), false);
});

function baseConfig() {
  const target = {
    compilationUnitId: "unit",
    artifact: "artifacts/target.json",
    applicantSalt: `0x${"01".repeat(32)}`,
    constructorArguments: [],
    initializer: null,
    deploymentValueWei: "0",
    initializerValueWei: "0",
    componentKind: "other",
    declaredHookPermissions: null,
    runtimeImmutables: [],
  };
  return {
    schemaVersion: "programmable.launch-pack-config.v3",
    launchWallet: "0x1111111111111111111111111111111111111111",
    chainId: "1",
    nonce: `0x${"22".repeat(32)}`,
    source: {
      root: "project",
      paths: ["src"],
      sourceLineageNonce: "1",
      publicOrigin: {
        url: "https://example.com/source",
        revision: "11".repeat(20),
      },
    },
    compilationUnits: [{ compilationUnitId: "unit", standardJson: "standard-json.json" }],
    targets: [
      { ...target, targetId: "token", componentKind: "token" },
      {
        ...target,
        targetId: "hook",
        componentKind: "hook",
        declaredHookPermissions: ["beforeSwap"],
      },
      {
        ...target,
        targetId: "initializer",
        initializer: { function: "initialize", arguments: [] },
      },
    ],
    pool: {
      tokenTargetId: "token",
      hookTargetId: "hook",
      fee: 3000,
      tickSpacing: 60,
      quoteCurrency: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    },
    projectMetadata: {
      schemaVersion: "programmable.project-metadata-input.v1",
      token: { name: "Schema Token", symbol: "SCHEMA" },
      presentation: {
        description: "Schema fixture",
        image: null,
        links: [{ kind: "website", uri: "https://example.com/" }],
      },
    },
    launchProfile: {
      schemaVersion: "programmable.direct-native-hook-graph-profile-selection.v3",
      profileId: "programmable.direct-native-hook-graph.v1",
      profileRevision: 3,
      targetRoles: {
        tokenTargetId: "token",
        hookTargetId: "hook",
        initializerTargetId: "initializer",
        platformFeeBindingTargetId: "hook",
      },
      liquidityModel: {
        schemaVersion: "programmable.direct-native-liquidity-model-intent.v1",
        model: "external-concentrated-liquidity",
        declaredLaunchState: "liquidity_required",
      },
      fundingMode: "eip-3009-receive-with-authorization",
      accountingMode: "inclusive-selected-total",
      assessmentBase: "executed-gross-declared-quote",
      feeCurrency: "declared-quote-currency",
      claimMode: "claim-authority-selected-recipient",
      applicantSelectedBuyHundredthsOfBip: "1000",
      applicantSelectedSellHundredthsOfBip: "1000",
    },
    permitWindow: { validAfter: "1", deadline: "2" },
    fundingAuthorization: {
      schemaVersion: "programmable.funding-authorization-input.v1",
      method: "eip-3009-receive-with-authorization",
      value: "1",
      validAfter: "1",
      validBefore: "2",
    },
    fundingSignaturePatch: {
      targetId: "initializer",
      nonceArgumentPath: [0, 4],
      rArgumentPath: [0, 5, 0],
      sArgumentPath: [0, 5, 1],
      vArgumentPath: [0, 5, 2],
    },
    agentAttestation: {
      agentId: "schema-test",
      checkedAt: "2026-08-26T12:00:00.000Z",
      checks: [{ checkId: "build", evidence: "evidence/build.json" }],
    },
  };
}
