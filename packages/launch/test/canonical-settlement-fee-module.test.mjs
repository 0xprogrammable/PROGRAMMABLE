import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  encodeAbiParameters,
  parseAbiParameters,
} from "viem";

import {
  CANONICAL_SETTLEMENT_FEE_VAULT_V1,
  validateCanonicalSettlementFeeVaultV1Build,
} from "../src/canonical-settlement-fee-vault-v1.mjs";
import { GRAPH_FACTORY } from "../src/constants.mjs";
import canonicalSettlementFeeVaultArtifact from
  "./fixtures/programmable-settlement-fee-vault-v1.json" with { type: "json" };
import {
  buildDirectNativeProfileBinding,
  resolveDirectNativeProfile,
  validateDirectNativeProfileGraph,
} from "../src/profile-direct-native-v1.mjs";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const TOKEN_ADDRESS = "0x0000000000000000000000000000000000001000";
const HOOK_ADDRESS = "0x0000000000000000000000000000000000001080";
const INITIALIZER_ADDRESS = "0x0000000000000000000000000000000000003000";
const ROUTE_NAMESPACE = `0x${"33".repeat(32)}`;
const ROUTE_NONCE = `0x${"44".repeat(32)}`;
const RUNTIME_HASH = `0x${"22".repeat(32)}`;

const CURRENT_SELECTION = {
  schemaVersion: "programmable.direct-native-hook-graph-profile-selection.v3",
  profileId: "programmable.direct-native-hook-graph.v1",
  profileRevision: 3,
  targetRoles: {
    tokenTargetId: "token",
    hookTargetId: "route",
    initializerTargetId: "initializer",
    platformFeeBindingTargetId: "settlement-fee-vault",
  },
  fundingMode: "none",
  accountingMode: "inclusive-selected-total",
  assessmentBase: "executed-gross-declared-quote",
  feeCurrency: "declared-quote-currency",
  claimMode: "claim-authority-selected-recipient",
  applicantSelectedBuyHundredthsOfBip: "0",
  applicantSelectedSellHundredthsOfBip: "0",
};

test("profile 3.4 pins the complete settlement fee release identity", () => {
  assert.deepEqual(CANONICAL_SETTLEMENT_FEE_VAULT_V1, {
    schemaVersion: "programmable.canonical-settlement-fee-module.v1",
    moduleId: "programmable:settlement-fee-vault:v1",
    releaseBindingSha256:
      "sha256:39ccdfdf8cd61620bf5c62bf07fb8428adbd66d2608b1cf3ad583343116d7ed9",
    contractName: "ProgrammableSettlementFeeVaultV1",
    source: {
      path: "src/ProgrammableSettlementFeeVaultV1.sol",
      sha256:
        "sha256:0a01ee8c22d103343d14b1d3890902e3edeecef25ea84a0f03f23a3fe8f1042b",
    },
    compiler: {
      version: "0.8.26+commit.8a97fa7a",
      standardJsonInput: {
        byteLength: 119_921,
        sha256:
          "sha256:840f0827714818dd9cf28ce15b684eb907d58b3701d3b3a9f28d0f3be137c7d9",
      },
      evmVersion: "paris",
      optimizer: { enabled: true, runs: 1_000 },
      viaIR: false,
      metadata: { useLiteralContent: false, bytecodeHash: "none", appendCBOR: false },
    },
    creationBytecode: {
      byteLength: 7_935,
      sha256:
        "sha256:7b0d51612be90023839f36cf28ae56963d8146d28ff441dd2a20195d56238b81",
      keccak256:
        "0xdbc32e835739b50f33a101a8927008fc46af4c11604f7a5da006e5c56288b21e",
    },
    runtimeBytecode: {
      byteLength: 7_751,
      sha256:
        "sha256:980c0eec1017a7dbbd9010935107440125070a0b1fa4688bca92754e2bf1e649",
      keccak256:
        "0x92620fe3f83839334c9a264bea5bfcc819868ca5607cbd2260e5a9664dbd7554",
    },
    constructor: { bindingAuthority: "graphFactory", graphFactory: GRAPH_FACTORY },
    initializer: {
      signature: "bindRoute(address)",
      selector: "0x8ce2a828",
      routeArgument: "exact-reciprocal-route-target-locator",
    },
    reciprocalRoute: {
      getterSignature: "settlementFeeVault()",
      getterSelector: "0x0fb5c7c9",
      behaviorAuthority: "server-static-and-runtime-evidence",
    },
  });
  const source = readFileSync(
    new URL("./fixtures/ProgrammableSettlementFeeVaultV1.sol", import.meta.url),
  );
  assert.equal(
    `sha256:${createHash("sha256").update(source).digest("hex")}`,
    CANONICAL_SETTLEMENT_FEE_VAULT_V1.source.sha256,
  );
});

test("profile 3.4 accepts only the frozen source closure, compiler input, and bytecodes", () => {
  const graph = candidateGraph();
  const feeVault = graph.targets.find(
    ({ targetId }) => targetId === "settlement-fee-vault",
  );
  feeVault.creationBytecode = canonicalSettlementFeeVaultArtifact.creationBytecode;
  const standardJsonInput = readFileSync(
    new URL(
      "./fixtures/programmable-settlement-fee-vault-v1.standard-json.json",
      import.meta.url,
    ),
    "utf8",
  ).trimEnd();
  const verificationBundle = {
    compilationUnits: [{
      compilationUnitId: "canonical-settlement-fee-vault-v1",
      compilerVersion: "0.8.26+commit.8a97fa7a",
      standardJsonInputBase64: Buffer.from(standardJsonInput).toString("base64"),
      standardJsonInputSha256:
        CANONICAL_SETTLEMENT_FEE_VAULT_V1.compiler.standardJsonInput.sha256,
    }],
    components: [{
      targetId: "settlement-fee-vault",
      compilationUnitId: "canonical-settlement-fee-vault-v1",
      sourcePath: "src/ProgrammableSettlementFeeVaultV1.sol",
      contractName: "ProgrammableSettlementFeeVaultV1",
      runtimeMaterialization: {
        immutableReferences: [],
        runtimeImmutables: [],
        deployedRuntimeCodeBase64: Buffer.from(
          canonicalSettlementFeeVaultArtifact.runtimeBytecode.slice(2),
          "hex",
        ).toString("base64"),
        deployedRuntimeCodeHash:
          canonicalSettlementFeeVaultArtifact.runtimeBytecodeKeccak256,
      },
    }],
  };
  assert.deepEqual(
    validateCanonicalSettlementFeeVaultV1Build(
      graph,
      verificationBundle,
      "settlement-fee-vault",
    ),
    {
      moduleId: "programmable:settlement-fee-vault:v1",
      releaseBindingSha256:
        "sha256:39ccdfdf8cd61620bf5c62bf07fb8428adbd66d2608b1cf3ad583343116d7ed9",
      feeVaultTargetId: "settlement-fee-vault",
      routeTargetId: "route",
      reciprocalLocatorPhase: "constructor",
    },
  );
  const wrongInput = structuredClone(verificationBundle);
  wrongInput.compilationUnits[0].standardJsonInputBase64 = Buffer.from(
    `${standardJsonInput}\n`,
  ).toString("base64");
  assert.throws(
    () => validateCanonicalSettlementFeeVaultV1Build(
      graph,
      wrongInput,
      "settlement-fee-vault",
    ),
    /frozen release compiler input/u,
  );
});

test("profile 3.4 rejects an arbitrary platform fee target and requires four distinct roles", () => {
  const graph = candidateGraph();
  const arbitrarySelection = {
    ...CURRENT_SELECTION,
    targetRoles: {
      ...CURRENT_SELECTION.targetRoles,
      platformFeeBindingTargetId: "route",
    },
  };
  const binding = bindingFor(arbitrarySelection, graph);
  assert.throws(
    () => validateDirectNativeProfileGraph(
      resolveDirectNativeProfile(arbitrarySelection),
      binding,
      graph,
    ),
    /distinct canonical platform fee module target/u,
  );
});

test("profile 3.4 requires one exact reciprocal route locator in each direction", () => {
  const graph = candidateGraph();
  const binding = bindingFor(CURRENT_SELECTION, graph);
  const noBacklink = structuredClone(graph);
  noBacklink.targets.find(({ targetId }) => targetId === "route")
    .constructorAddressLocators = [];
  assert.throws(
    () => validateDirectNativeProfileGraph(
      resolveDirectNativeProfile(CURRENT_SELECTION),
      binding,
      noBacklink,
    ),
    /exactly one reciprocal route target locator/u,
  );
  assert.throws(
    () => validateDirectNativeProfileGraph(
      resolveDirectNativeProfile(CURRENT_SELECTION),
      binding,
      graph,
    ),
    /creation bytecode does not match the frozen release bytes/u,
  );
});

test("profile 3.3 exact retries retain the three-target arbitrary binding semantics", () => {
  const graph = candidateGraph();
  graph.targets = graph.targets
    .filter(({ targetId }) => targetId !== "settlement-fee-vault")
    .map((target) => target.targetId === "route"
      ? { ...target, constructorArguments: "0x", constructorAddressLocators: [] }
      : target);
  const legacySelection = {
    ...CURRENT_SELECTION,
    targetRoles: {
      ...CURRENT_SELECTION.targetRoles,
      platformFeeBindingTargetId: "route",
    },
  };
  const profile = resolveDirectNativeProfile(legacySelection, { profileVersion: "3.3.0" });
  const binding = bindingFor(legacySelection, graph);
  assert.equal(profile.graphPolicy.minimumTargets, 3);
  assert.doesNotThrow(() => validateDirectNativeProfileGraph(profile, binding, graph));
  assert.equal(resolveDirectNativeProfile(CURRENT_SELECTION).graphPolicy.minimumTargets, 4);
});

function bindingFor(selection, graphBundle) {
  return buildDirectNativeProfileBinding(selection, {
    graphBundle,
    predictions: [
      { targetId: "token", predictedAddress: TOKEN_ADDRESS },
      { targetId: "route", predictedAddress: HOOK_ADDRESS },
      { targetId: "initializer", predictedAddress: INITIALIZER_ADDRESS },
    ],
    routeNamespace: ROUTE_NAMESPACE,
    routeNonce: ROUTE_NONCE,
    quoteCurrency: ZERO_ADDRESS,
  });
}

function candidateGraph() {
  return {
    schemaVersion: "programmable.custom-graph-bundle.v1",
    sourceBundleSha256: `sha256:${"11".repeat(32)}`,
    targets: [
      target("token", "token", null),
      {
        ...target("route", "hook", ["beforeSwap"]),
        constructorArguments: `0x${"00".repeat(32)}`,
        constructorAddressLocators: [{
          targetId: "settlement-fee-vault",
          byteOffset: 0,
          encoding: "abi-address-word",
        }],
      },
      target("initializer", "other", null),
      {
        ...target("settlement-fee-vault", "other", null),
        constructorArguments: encodeAbiParameters(
          parseAbiParameters("address"),
          [GRAPH_FACTORY],
        ),
        initializerCalldata: `0x8ce2a828${"00".repeat(32)}`,
        initializerAddressLocators: [{
          targetId: "route",
          byteOffset: 4,
          encoding: "abi-address-word",
        }],
        expectedRuntimeCodeHash:
          CANONICAL_SETTLEMENT_FEE_VAULT_V1.runtimeBytecode.keccak256,
      },
    ],
    pool: { tokenTargetId: "token", hookTargetId: "route", fee: 3_000, tickSpacing: 60 },
  };
}

function target(targetId, componentKind, declaredHookPermissions) {
  return {
    targetId,
    applicantSalt: `0x${"00".repeat(32)}`,
    creationBytecode: "0x6000",
    constructorArguments: "0x",
    initializerCalldata: "0x",
    constructorAddressLocators: [],
    initializerAddressLocators: [],
    deploymentValueWei: "0",
    initializerValueWei: "0",
    expectedRuntimeCodeHash: RUNTIME_HASH,
    componentKind,
    declaredHookPermissions,
  };
}
