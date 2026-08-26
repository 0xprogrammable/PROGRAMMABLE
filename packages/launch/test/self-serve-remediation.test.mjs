import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { encodeFunctionData } from "viem";

import { main } from "../src/cli.mjs";
import { remediationUrlFor } from "../src/diagnostics.mjs";
import { inspectEip3009FundingCompatibility } from "../src/funding-compatibility.mjs";
import { buildLaunch } from "../src/pack.mjs";
import { buildFundingSignaturePatch } from "../src/profile-direct-native-v1.mjs";

const ZERO_BYTES32 = `0x${"00".repeat(32)}`;
const NESTED_INITIALIZER_ABI = [{
  type: "function",
  name: "initialize",
  stateMutability: "nonpayable",
  inputs: [
    { name: "configurationHash", type: "bytes32" },
    {
      name: "authorization",
      type: "tuple",
      components: [
        { name: "nonce", type: "bytes32" },
        {
          name: "signature",
          type: "tuple",
          components: [
            { name: "v", type: "uint8" },
            { name: "r", type: "bytes32" },
            { name: "s", type: "bytes32" },
          ],
        },
      ],
    },
  ],
  outputs: [],
}];

test("local remediation links resolve as JSON Pointers in the public catalog", async () => {
  const catalog = JSON.parse(await readFile(
    new URL("../../../public/policies/custom-launch-agent-remediation-v1.json", import.meta.url),
    "utf8",
  ));
  for (const code of [
    "PACK_CONFIG_V3_MISSING",
    "PACK_CONFIG_V3_INVALID",
    "FUNDING_SIGNATURE_PATCH_NOT_TOP_LEVEL",
    "FUNDING_AUTHORIZATION_PATCH_PATH_INVALID",
    "FUNDING_NONCE_DERIVATION_CONFLICT_SUSPECTED",
    "FUNDING_NONCE_CONFORMANCE_UNPROVEN",
  ]) {
    const url = new URL(remediationUrlFor(code));
    assert.ok(url.hash.startsWith("#/"));
    const resolved = decodeURIComponent(url.hash.slice(2))
      .split("/")
      .map((token) => token.replaceAll("~1", "/").replaceAll("~0", "~"))
      .reduce((value, token) => value[token], catalog);
    assert.equal(typeof resolved.requiredChange, "string", code);
  }
});

test("pack and submit expose a stable machine-readable missing V3 config diagnostic", async () => {
  for (const command of [["pack"], ["submit", "launch.json"]]) {
    await assert.rejects(
      main(command),
      (error) => {
        assert.equal(error.code, "PACK_CONFIG_V3_MISSING");
        assert.equal(error.diagnostic.schemaVersion, "programmable.launch-cli-diagnostic.v1");
        assert.equal(error.diagnostic.expected.schemaVersion, "programmable.launch-pack-config.v3");
        assert.match(error.diagnostic.remediationUrl, /#\/remediations\/0$/u);
        assert.equal(typeof error.diagnostic.requiredChange, "string");
        assert.equal(error.diagnostic.resumeAt, "pack");
        return true;
      },
    );
  }
});

test("invalid JSON and invalid shape expose PACK_CONFIG_V3_INVALID with public contracts", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "programmable-invalid-v3-config-"));
  try {
    for (const [name, source] of [
      ["invalid-json.json", "{\n"],
      ["invalid-shape.json", '{"schemaVersion":"programmable.launch-pack-config.v3"}\n'],
    ]) {
      const configPath = path.join(root, name);
      await writeFile(configPath, source, "utf8");
      await assert.rejects(
        buildLaunch({ configPath }),
        (error) => {
          assert.equal(error.code, "PACK_CONFIG_V3_INVALID");
          assert.equal(
            error.diagnostic.expected.configContract,
            "https://programmable.market/schemas/custom-launch/v3/pack-config.json",
          );
          assert.match(error.diagnostic.expected.executableExample, /direct-native-v3-no-broadcast/u);
          return true;
        },
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("v2 derives and proves nonce plus nested r/s/v ABI paths without applicant offsets", () => {
  const fixture = nestedPatchFixture();
  const patch = buildFundingSignaturePatch({
    targetId: "initializer",
    nonceArgumentPath: [1, 0],
    rArgumentPath: [1, 1, 1],
    sArgumentPath: [1, 1, 2],
    vArgumentPath: [1, 1, 0],
  }, fixture.graphBundle, fixture.initializerArtifact);
  assert.deepEqual(patch, {
    schemaVersion: "programmable.eip3009-authorization-patch.v2",
    targetId: "initializer",
    unsignedInitializerCalldataSha256: patch.unsignedInitializerCalldataSha256,
    initializerCalldataLengthBytes: 164,
    authorizationEncoding: "eip3009-nonce-r-s-v-abi-leaves",
    nonceArgumentPath: [1, 0],
    rArgumentPath: [1, 1, 1],
    sArgumentPath: [1, 1, 2],
    vArgumentPath: [1, 1, 0],
  });
  assert.equal(Object.hasOwn(patch, "nonceOffsetBytes"), false);
  assert.equal(Object.hasOwn(patch, "rOffsetBytes"), false);
});

test("v2 rejects dynamic or wrong-type paths with one stable actionable code", () => {
  const fixture = nestedPatchFixture();
  const dynamicAbi = [{
    ...NESTED_INITIALIZER_ABI[0],
    inputs: [
      { name: "memo", type: "bytes" },
      NESTED_INITIALIZER_ABI[0].inputs[1],
    ],
  }];
  const calldata = encodeFunctionData({
    abi: dynamicAbi,
    functionName: "initialize",
    args: ["0x", [ZERO_BYTES32, [0, ZERO_BYTES32, ZERO_BYTES32]]],
  });
  fixture.graphBundle.targets[0].initializerCalldata = calldata;
  fixture.initializerArtifact.abi = dynamicAbi;
  fixture.initializerArtifact.initializer.arguments = [
    "0x",
    [ZERO_BYTES32, [0, ZERO_BYTES32, ZERO_BYTES32]],
  ];
  assert.throws(
    () => buildFundingSignaturePatch({
      targetId: "initializer",
      nonceArgumentPath: [0, 0],
      rArgumentPath: [1, 1, 1],
      sArgumentPath: [1, 1, 2],
      vArgumentPath: [1, 1, 0],
    }, fixture.graphBundle, fixture.initializerArtifact),
    (error) => {
      assert.equal(error.code, "FUNDING_AUTHORIZATION_PATCH_PATH_INVALID");
      assert.match(error.diagnostic.remediationUrl, /#\/remediations\/4$/u);
      assert.equal(typeof error.diagnostic.requiredChange, "string");
      assert.equal(error.diagnostic.resumeAt, "pack");
      return true;
    },
  );
});

test("v2 rejects paths outside the public 0..255 ABI index contract", () => {
  const fixture = nestedPatchFixture();
  assert.throws(
    () => buildFundingSignaturePatch({
      targetId: "initializer",
      nonceArgumentPath: [256],
      rArgumentPath: [1, 1, 1],
      sArgumentPath: [1, 1, 2],
      vArgumentPath: [1, 1, 0],
    }, fixture.graphBundle, fixture.initializerArtifact),
    (error) => {
      assert.equal(error.code, "FUNDING_AUTHORIZATION_PATCH_PATH_INVALID");
      assert.match(error.diagnostic.observed.reason, /zero-based ABI indices/u);
      return true;
    },
  );
});

test("v2 authorization leaves cannot overlap initializer address locators", () => {
  for (const locator of [
    { targetId: "token", byteOffset: 36, encoding: "abi-address-word" },
    { targetId: "token", byteOffset: 112, encoding: "packed-address-20" },
  ]) {
    const fixture = nestedPatchFixture();
    fixture.graphBundle.targets[0].initializerAddressLocators = [locator];
    assert.throws(
      () => buildFundingSignaturePatch({
        targetId: "initializer",
        nonceArgumentPath: [1, 0],
        rArgumentPath: [1, 1, 1],
        sArgumentPath: [1, 1, 2],
        vArgumentPath: [1, 1, 0],
      }, fixture.graphBundle, fixture.initializerArtifact),
      (error) => {
        assert.equal(error.code, "FUNDING_AUTHORIZATION_PATCH_PATH_INVALID");
        assert.match(error.diagnostic.observed.reason, new RegExp(locator.encoding, "u"));
        assert.match(error.diagnostic.observed.reason, /overlaps/u);
        return true;
      },
    );
  }
});

test("legacy nested r/s/v offsets emit migrate-to-v2 diagnostic instead of a generic ABI error", () => {
  const fixture = nestedPatchFixture();
  assert.throws(
    () => buildFundingSignaturePatch({
      targetId: "initializer",
      rOffsetBytes: 100,
      sOffsetBytes: 132,
      vOffsetBytes: 68,
    }, fixture.graphBundle, fixture.initializerArtifact),
    (error) => {
      assert.equal(error.code, "FUNDING_SIGNATURE_PATCH_NOT_TOP_LEVEL");
      assert.deepEqual(error.diagnostic.expected.preferredV2ConfigFields, [
        "targetId",
        "nonceArgumentPath",
        "rArgumentPath",
        "sArgumentPath",
        "vArgumentPath",
      ]);
      return true;
    },
  );
});

test("source-only alternate nonce domains are warnings, never unsafe hard failures", () => {
  const sources = {
    "src/Initializer.sol": {
      content: 'import { FundingTypes } from "./FundingTypes.sol"; contract Initializer {}',
    },
    "src/FundingTypes.sol": {
      content: `library FundingTypes {
        bytes32 internal constant FUNDING_INTENT_TYPEHASH = keccak256("ProjectFundingIntentV1(bytes32 x)");
        bytes32 internal constant AUTHORIZATION_NONCE_TYPEHASH = keccak256("ProjectAuthorizationNonceV1(bytes32 x)");
        function fundingIntentHash(bytes32 x) internal pure returns (bytes32) {
          return keccak256(abi.encode(FUNDING_INTENT_TYPEHASH, x));
        }
        function authorizationNonce(bytes32 x) internal pure returns (bytes32) {
          return keccak256(abi.encode(AUTHORIZATION_NONCE_TYPEHASH, x));
        }
      }`,
    },
  };
  const warnings = inspectEip3009FundingCompatibility({
    launchProfileSelection: fundingSelection(),
    targets: [{
      targetId: "initializer",
      compilationUnitId: "unit",
      sourcePath: "src/Initializer.sol",
    }],
    unitsById: new Map([["unit", { standardJsonInput: { sources } }]]),
  });
  assert.equal(warnings[0].code, "FUNDING_NONCE_DERIVATION_CONFLICT_SUSPECTED");
  assert.equal(warnings[0].severity, "warning");
  assert.equal(warnings[0].observed.blocking, false);
});

function nestedPatchFixture() {
  const initializerArguments = [
    ZERO_BYTES32,
    [ZERO_BYTES32, [0, ZERO_BYTES32, ZERO_BYTES32]],
  ];
  const initializerCalldata = encodeFunctionData({
    abi: NESTED_INITIALIZER_ABI,
    functionName: "initialize",
    args: initializerArguments,
  });
  return {
    graphBundle: {
      targets: [{ targetId: "initializer", initializerCalldata }],
    },
    initializerArtifact: {
      targetId: "initializer",
      sourcePath: "src/Initializer.sol",
      abi: NESTED_INITIALIZER_ABI,
      initializer: { function: "initialize", arguments: initializerArguments },
    },
  };
}

function fundingSelection() {
  return {
    fundingMode: "eip-3009-receive-with-authorization",
    targetRoles: { initializerTargetId: "initializer" },
  };
}
