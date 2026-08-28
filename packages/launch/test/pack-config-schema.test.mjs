import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import Ajv2020 from "ajv/dist/2020.js";

const schema = JSON.parse(await readFile(
  new URL("../schemas/programmable-launch-pack-config-v3.json", import.meta.url),
  "utf8",
));
const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  strictRequired: false,
  validateFormats: false,
});
for (const keyword of [
  "x-programmable-status",
  "x-programmable-live-contract",
  "x-programmable-profile-3-4-contract",
  "x-programmable-order",
  "x-programmable-aggregateCalldataAndHookDataMaximumBytes",
  "x-programmable-maximumBytes",
]) {
  ajv.addKeyword(keyword);
}
ajv.addKeyword({
  keyword: "x-programmable-minUtf8Bytes",
  type: "string",
  schemaType: "number",
  validate: (minimum, value) => Buffer.byteLength(value, "utf8") >= minimum,
});
ajv.addKeyword({
  keyword: "x-programmable-minUnicodeLettersOrNumbers",
  type: "string",
  schemaType: "number",
  validate: (minimum, value) => [...value.matchAll(/[\p{L}\p{N}]/gu)].length >= minimum,
});
const validate = ajv.compile(schema);

test("published V3 pack-config schema accepts v2 nested authorization paths", () => {
  const config = baseConfig();
  assert.equal(validate(config), true, JSON.stringify(validate.errors));
});

test("preparatory profile 3.4 schema requires four targets and pins the fee module", () => {
  assert.equal(schema["x-programmable-status"], "preparatory-not-live");
  assert.deepEqual(schema["x-programmable-live-contract"], {
    cliReleaseVersion: "3.3.7",
    profileVersion: "3.3.0",
  });
  assert.equal(schema.properties.targets.minItems, 4);
  assert.equal(schema.properties.targets.maxItems, 16);
  assert.deepEqual(
    schema["x-programmable-profile-3-4-contract"].canonicalSettlementFeeModule,
    {
      moduleId: "programmable:settlement-fee-vault:v1",
      releaseBindingSha256:
        "sha256:39ccdfdf8cd61620bf5c62bf07fb8428adbd66d2608b1cf3ad583343116d7ed9",
      sourceSha256:
        "sha256:0a01ee8c22d103343d14b1d3890902e3edeecef25ea84a0f03f23a3fe8f1042b",
      creationBytecodeSha256:
        "sha256:7b0d51612be90023839f36cf28ae56963d8146d28ff441dd2a20195d56238b81",
      creationBytecodeKeccak256:
        "0xdbc32e835739b50f33a101a8927008fc46af4c11604f7a5da006e5c56288b21e",
      runtimeBytecodeSha256:
        "sha256:980c0eec1017a7dbbd9010935107440125070a0b1fa4688bca92754e2bf1e649",
      runtimeBytecodeKeccak256:
        "0x92620fe3f83839334c9a264bea5bfcc819868ca5607cbd2260e5a9664dbd7554",
      compiler:
        "solc 0.8.26, EVM paris, optimizer 1000, viaIR false, metadata bytecodeHash none, appendCBOR false",
      constructor: "graphFactory",
      initializer: "bindRoute(address) with one exact route-target locator",
      reciprocalRoute:
        "exactly one constructor or initializer locator from that route target back to the vault; settlementFeeVault() behavior remains server-evidence authority",
    },
  );
  const config = baseConfig();
  assert.equal(validate(config), true, JSON.stringify(validate.errors));
  config.targets.pop();
  assert.equal(validate(config), false);
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

test("published V3 pack-config schema requires complete indexable project metadata", () => {
  const cases = [
    ["null image", (config) => { config.projectMetadata.presentation.image = null; }],
    ["short description", (config) => {
      config.projectMetadata.presentation.description = "Placeholder";
    }],
    ["missing website", (config) => {
      config.projectMetadata.presentation.links = [
        { kind: "x", uri: "https://x.com/schema_token" },
      ];
    }],
    ["missing X profile", (config) => {
      config.projectMetadata.presentation.links = [
        { kind: "website", uri: "https://example.com/" },
      ];
    }],
    ["noncanonical X profile", (config) => {
      config.projectMetadata.presentation.links[1].uri = "https://twitter.com/schema_token";
    }],
  ];
  for (const [label, mutate] of cases) {
    const config = baseConfig();
    mutate(config);
    assert.equal(validate(config), false, label);
  }
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
  config.launchProfile.applicantSelectedBuyHundredthsOfBip = "100000";
  assert.equal(validate(config), true, JSON.stringify(validate.errors));
  config.launchProfile.applicantSelectedBuyHundredthsOfBip = "100001";
  assert.equal(validate(config), false);

  config.launchProfile.accountingMode = "additive-platform-share";
  config.launchProfile.applicantSelectedBuyHundredthsOfBip = "100000";
  assert.equal(validate(config), true, JSON.stringify(validate.errors));
  config.launchProfile.applicantSelectedBuyHundredthsOfBip = "100001";
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
      {
        ...target,
        targetId: "settlement-fee-vault",
        initializer: {
          function: "bindRoute",
          arguments: [{ target: "hook" }],
        },
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
        description: "Schema metadata fixture for a public launch",
        image: {
          sourcePath: "assets/token.png",
          uri: "https://example.com/token.png",
        },
        links: [
          { kind: "website", uri: "https://example.com/" },
          { kind: "x", uri: "https://x.com/schema_token" },
        ],
      },
    },
    behaviorScenarioInputs: {
      schemaVersion: "programmable.custom-launch-behavior-scenario-inputs.v1",
      steps: [{
        stepId: "reference-swap",
        phase: "swap",
        actor: "secondary-user",
        target: { kind: "runner-harness", harness: "v4-actions-v1" },
        valueWei: "0",
        calldata: "0x",
        hookData: "0x",
      }],
    },
    launchProfile: {
      schemaVersion: "programmable.direct-native-hook-graph-profile-selection.v3",
      profileId: "programmable.direct-native-hook-graph.v1",
      profileRevision: 3,
      targetRoles: {
        tokenTargetId: "token",
        hookTargetId: "hook",
        initializerTargetId: "initializer",
        platformFeeBindingTargetId: "settlement-fee-vault",
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
