import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { encodeFunctionData } from "viem";

import { statusLaunch, submitLaunch } from "../src/api-client.mjs";
import { sha256Digest } from "../src/io.mjs";
import {
  buildDirectNativeProfileBinding,
  buildDirectNativeLaunchIntentHash,
  buildFundingAuthorization,
  buildFundingSignaturePatch,
  hashDirectNativeProfile,
  resolveDirectNativeProfile,
  validateDirectNativeProfileGraph,
  validateDirectNativeProfileSelection,
} from "../src/profile-direct-native-v1.mjs";
import {
  validateLaunchFile,
  validateLaunchRequest,
} from "../src/validate.mjs";

const SHA = `sha256:${"11".repeat(32)}`;
const RUNTIME_HASH = `0x${"22".repeat(32)}`;
const ROUTE_NAMESPACE = `0x${"33".repeat(32)}`;
const ROUTE_NONCE = `0x${"44".repeat(32)}`;
const LAUNCH_INTENT_HASH = `sha256:${"55".repeat(32)}`;
const TOKEN_ADDRESS = "0x0000000000000000000000000000000000001000";
const HOOK_ADDRESS = "0x00000000000000000000000000000000000020cc";
const INITIALIZER_ADDRESS = "0x0000000000000000000000000000000000003000";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_BYTES32 = `0x${"00".repeat(32)}`;
const INITIALIZER_ABI = [{
  type: "function",
  name: "initialize",
  stateMutability: "nonpayable",
  inputs: [
    { name: "r", type: "bytes32" },
    { name: "s", type: "bytes32" },
    { name: "v", type: "uint8" },
    { name: "configurationHash", type: "bytes32" },
  ],
  outputs: [],
}];

const SELECTION = {
  schemaVersion: "programmable.direct-native-hook-graph-profile-selection.v1",
  profileId: "programmable.direct-native-hook-graph.v1",
  profileRevision: 1,
  targetRoles: {
    tokenTargetId: "token",
    hookTargetId: "hook",
    initializerTargetId: "initializer",
    platformFeeBindingTargetId: "hook",
  },
  selectedBuyHundredthsOfBip: "0",
  selectedSellHundredthsOfBip: "30000",
};

const FEE_ENFORCEMENT = {
  mode: "canonical-volume-fee-v2",
  requiredHookPermissionMask: 0x20cc,
  hookSourcePath: "src/ProgrammableVolumeFeeHookV2.sol",
  hookSourceSha256: "sha256:41294f0701d3911b740a0cea160b936cb0eea4bdf2a664e7c6674a1c1e1b519d",
  factorySourcePath: "src/ProgrammableVolumeFeeHookFactoryV2.sol",
  factorySourceSha256: "sha256:aa2673f4635543b5c24b140030461fe3161138d2d02d24c1c8c1830c13d60145",
  dependencyLockSha256: "sha256:e73b8f213af284c54550e7bdf5416e9bf1f17774b4f6e23d3bb8f6a150ede759",
  compilerVersion: "0.8.26+commit.8a97fa7a",
  compilerSettingsSha256: SHA,
  hookCreationBytecodeSha256: SHA,
  hookRuntimeTemplateSha256: SHA,
  hookRuntimeCodeHash: RUNTIME_HASH,
};

function unsignedInitializerCalldata() {
  return encodeFunctionData({
    abi: INITIALIZER_ABI,
    functionName: "initialize",
    args: [ZERO_BYTES32, ZERO_BYTES32, 0, ZERO_BYTES32],
  });
}

function graphBundle() {
  return {
    schemaVersion: "programmable.custom-graph-bundle.v1",
    sourceBundleSha256: SHA,
    targets: [
      target("token", "token", null),
      target("hook", "hook", [
        "beforeInitialize",
        "beforeSwap",
        "afterSwap",
        "beforeSwapReturnDelta",
        "afterSwapReturnDelta",
      ]),
      { ...target("initializer", "other", null), initializerCalldata: unsignedInitializerCalldata() },
    ],
    pool: { tokenTargetId: "token", hookTargetId: "hook", fee: 3000, tickSpacing: 60 },
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

function signaturePatch(bundle = graphBundle()) {
  return buildFundingSignaturePatch({
    targetId: "initializer",
    rOffsetBytes: 4,
    sOffsetBytes: 36,
    vOffsetBytes: 68,
  }, bundle, initializerArtifact());
}

function initializerArtifact(abi = INITIALIZER_ABI) {
  return {
    targetId: "initializer",
    abi,
    initializer: {
      function: "initialize",
      arguments: [ZERO_BYTES32, ZERO_BYTES32, 0, ZERO_BYTES32],
    },
  };
}

function bundleWithInitializer(calldata) {
  const bundle = graphBundle();
  bundle.targets = bundle.targets.map((target) => target.targetId === "initializer"
    ? { ...target, initializerCalldata: calldata }
    : target);
  return bundle;
}

test("V3 selection accepts canonical 0..999999 rates and rejects values above the kernel bound", () => {
  assert.deepEqual(validateDirectNativeProfileSelection(SELECTION), SELECTION);
  assert.equal(validateDirectNativeProfileSelection({
    ...SELECTION,
    selectedBuyHundredthsOfBip: "999999",
  }).selectedBuyHundredthsOfBip, "999999");
  assert.throws(
    () => validateDirectNativeProfileSelection({
      ...SELECTION,
      selectedBuyHundredthsOfBip: "1000000",
    }),
    /between 0 and 999999/u,
  );
});

test("V3 profile exposes inclusive fee accounting and never describes the fixed share as additive", () => {
  const profile = resolveDirectNativeProfile(SELECTION, FEE_ENFORCEMENT);
  assert.deepEqual(profile.platformFee, {
    accountingMode: "inclusive-selected-total",
    rateDenominator: "1000000",
    programmableFeeHundredthsOfBip: "1000",
    minimumEffectiveSelectedHundredthsOfBip: "1000",
    recipient: "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c",
    readbackSelectors: {
      programmableHundredthsOfBip: "0x8a9585e4",
      programmableFeeOwner: "0x21466b6a",
      programmableFeePolicyHash: "0x677d6592",
      runtimeConfigurationHash: "0xca7751ad",
    },
  });
  assert.equal(profile.productionLaunchAuthorized, false);
  assert.deepEqual(profile.graphPolicy, {
    minimumTargets: 3,
    maximumTargets: 16,
    directTargetsOnly: true,
  });
  assert.equal(profile.permitAuthority, "0x755509eA6e3F5Ec1aA2E797bb68f1B87DD8b886b");
  assert.equal(
    profile.permitAuthorityRuntimeCodeHash,
    "0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c",
  );
  assert.match(hashDirectNativeProfile(profile), /^sha256:[0-9a-f]{64}$/u);
  assert.equal(JSON.stringify(profile).includes("additive"), false);
});

test("funding signature patch derives only from aligned, distinct, zero initializer words", () => {
  const patch = signaturePatch();
  assert.deepEqual(patch, {
    schemaVersion: "programmable.eip3009-signature-patch.v1",
    targetId: "initializer",
    unsignedInitializerCalldataSha256: patch.unsignedInitializerCalldataSha256,
    initializerCalldataLengthBytes: 132,
    signatureEncoding: "eip3009-r-s-v-abi-words",
    rOffsetBytes: 4,
    sOffsetBytes: 36,
    vOffsetBytes: 68,
  });
  assert.match(patch.unsignedInitializerCalldataSha256, /^sha256:[0-9a-f]{64}$/u);
  assert.throws(
    () => buildFundingSignaturePatch({
      targetId: "initializer",
      rOffsetBytes: 5,
      sOffsetBytes: 36,
      vOffsetBytes: 68,
    }, graphBundle(), initializerArtifact()),
    /ABI word/u,
  );
  assert.throws(
    () => buildFundingSignaturePatch({
      targetId: "initializer",
      rOffsetBytes: 4,
      sOffsetBytes: 4,
      vOffsetBytes: 68,
    }, graphBundle(), initializerArtifact()),
    /must be distinct/u,
  );
});

test("funding signature patch proves exact top-level ABI types and canonical full calldata", () => {
  const valid = unsignedInitializerCalldata();
  const attempt = (calldata, abi, offsets = {
    rOffsetBytes: 4,
    sOffsetBytes: 36,
    vOffsetBytes: 68,
  }) => buildFundingSignaturePatch({
    targetId: "initializer",
    ...offsets,
  }, bundleWithInitializer(calldata), initializerArtifact(abi));

  assert.throws(
    () => attempt(`0xdeadbeef${valid.slice(10)}`, INITIALIZER_ABI),
    /selector|artifact ABI/u,
  );

  const addressAbi = [{
    ...INITIALIZER_ABI[0],
    inputs: [
      { name: "r", type: "address" },
      { name: "s", type: "bytes32" },
      { name: "v", type: "uint8" },
    ],
  }];
  const addressCalldata = encodeFunctionData({
    abi: addressAbi,
    functionName: "initialize",
    args: [ZERO_ADDRESS, ZERO_BYTES32, 0],
  });
  assert.throws(
    () => attempt(addressCalldata, addressAbi),
    /top-level bytes32/u,
  );

  const uintVAbi = [{
    ...INITIALIZER_ABI[0],
    inputs: [
      { name: "r", type: "bytes32" },
      { name: "s", type: "bytes32" },
      { name: "v", type: "uint256" },
    ],
  }];
  const uintVCalldata = encodeFunctionData({
    abi: uintVAbi,
    functionName: "initialize",
    args: [ZERO_BYTES32, ZERO_BYTES32, 0n],
  });
  assert.throws(
    () => attempt(uintVCalldata, uintVAbi),
    /top-level uint8/u,
  );

  const dynamicAbi = [{
    ...INITIALIZER_ABI[0],
    inputs: [
      { name: "payload", type: "bytes" },
      { name: "s", type: "bytes32" },
      { name: "v", type: "uint8" },
    ],
  }];
  const dynamicCalldata = encodeFunctionData({
    abi: dynamicAbi,
    functionName: "initialize",
    args: [`0x${"00".repeat(32)}`, ZERO_BYTES32, 0],
  });
  assert.throws(
    () => attempt(dynamicCalldata, dynamicAbi, {
      rOffsetBytes: 132,
      sOffsetBytes: 36,
      vOffsetBytes: 68,
    }),
    /top-level bytes32/u,
  );

  const tupleAbi = [{
    ...INITIALIZER_ABI[0],
    inputs: [
      {
        name: "signature",
        type: "tuple",
        components: [
          { name: "r", type: "bytes32" },
          { name: "padding", type: "bytes32" },
        ],
      },
      { name: "s", type: "bytes32" },
      { name: "v", type: "uint8" },
    ],
  }];
  const tupleCalldata = encodeFunctionData({
    abi: tupleAbi,
    functionName: "initialize",
    args: [{ r: ZERO_BYTES32, padding: ZERO_BYTES32 }, ZERO_BYTES32, 0],
  });
  assert.throws(
    () => attempt(tupleCalldata, tupleAbi),
    /top-level bytes32/u,
  );

  const staticPrefixAbi = [{
    ...INITIALIZER_ABI[0],
    inputs: [
      { name: "prefix", type: "uint256[2]" },
      { name: "r", type: "bytes32" },
      { name: "s", type: "bytes32" },
      { name: "v", type: "uint8" },
    ],
  }];
  const staticPrefixCalldata = encodeFunctionData({
    abi: staticPrefixAbi,
    functionName: "initialize",
    args: [[0n, 0n], ZERO_BYTES32, ZERO_BYTES32, 0],
  });
  const staticPrefixPatch = attempt(staticPrefixCalldata, staticPrefixAbi, {
    rOffsetBytes: 68,
    sOffsetBytes: 100,
    vOffsetBytes: 132,
  });
  assert.deepEqual(
    [
      staticPrefixPatch.rOffsetBytes,
      staticPrefixPatch.sOffsetBytes,
      staticPrefixPatch.vOffsetBytes,
    ],
    [68, 100, 132],
  );

  assert.throws(
    () => attempt(valid, [...INITIALIZER_ABI, { ...INITIALIZER_ABI[0] }]),
    /exactly one artifact ABI entry/u,
  );
  assert.throws(
    () => attempt(`${valid}${"00".repeat(32)}`, INITIALIZER_ABI),
    /artifact ABI|canonical full ABI encoding/u,
  );
});

test("V3 binding fixes route, pool id, signature patch, and inclusive selected fees", () => {
  const bundle = graphBundle();
  const binding = buildDirectNativeProfileBinding(SELECTION, {
    graphBundle: bundle,
    predictions: [
      { targetId: "token", predictedAddress: TOKEN_ADDRESS },
      { targetId: "hook", predictedAddress: HOOK_ADDRESS },
      { targetId: "initializer", predictedAddress: INITIALIZER_ADDRESS },
    ],
    routeNamespace: ROUTE_NAMESPACE,
    routeNonce: ROUTE_NONCE,
    quoteCurrency: ZERO_ADDRESS,
    fundingSignaturePatch: signaturePatch(bundle),
  });
  assert.equal(binding.hookPermissionMask, 0x20cc);
  assert.equal(binding.platformFeeBinding.selectedBuyHundredthsOfBip, "0");
  assert.equal(binding.platformFeeBinding.selectedSellHundredthsOfBip, "30000");
  assert.match(binding.expectedPoolId, /^0x[0-9a-f]{64}$/u);
  validateDirectNativeProfileGraph(
    resolveDirectNativeProfile(SELECTION, FEE_ENFORCEMENT),
    binding,
    bundle,
  );
  const dynamicFeeBundle = graphBundle();
  dynamicFeeBundle.pool.fee = 0x800000;
  assert.throws(
    () => validateDirectNativeProfileGraph(
      resolveDirectNativeProfile(SELECTION, FEE_ENFORCEMENT),
      binding,
      dynamicFeeBundle,
    ),
    /pool fee must be between 0 and 999999/u,
  );
});

test("EIP-3009 intent is pre-signature, launch-intent-bound, and uses a separately derived nonce", () => {
  const context = {
    launchWallet: "0x0000000000000000000000000000000000004000",
    predictedInitializer: INITIALIZER_ADDRESS,
    routeNamespace: ROUTE_NAMESPACE,
    routeNonce: ROUTE_NONCE,
    launchIntentHash: LAUNCH_INTENT_HASH,
    nowSeconds: 1_000,
  };
  const first = buildFundingAuthorization({
    schemaVersion: "programmable.funding-authorization-input.v1",
    method: "eip-3009-receive-with-authorization",
    value: "30000000",
    validAfter: "900",
    validBefore: "1200",
  }, context);
  assert.match(first.fundingIntentHash, /^0x[0-9a-f]{64}$/u);
  assert.match(first.fundingAuthorization.nonce, /^0x[0-9a-f]{64}$/u);
  assert.notEqual(first.fundingAuthorization.nonce, first.fundingIntentHash);
  assert.equal(Object.hasOwn(first.fundingAuthorization, "signature"), false);
  const changed = buildFundingAuthorization({
    schemaVersion: "programmable.funding-authorization-input.v1",
    method: "eip-3009-receive-with-authorization",
    value: "30000000",
    validAfter: "900",
    validBefore: "1200",
  }, { ...context, launchIntentHash: `sha256:${"66".repeat(32)}` });
  assert.notEqual(changed.fundingIntentHash, first.fundingIntentHash);
  assert.notEqual(changed.fundingAuthorization.nonce, first.fundingAuthorization.nonce);
});

test("V3 launch and funding intents match the cross-repository golden vectors", () => {
  const repeated = (character) => character.repeat(64);
  const fundingSignaturePatch = {
    schemaVersion: "programmable.eip3009-signature-patch.v1",
    targetId: "initializer",
    unsignedInitializerCalldataSha256: `sha256:${repeated("3")}`,
    initializerCalldataLengthBytes: 100,
    signatureEncoding: "eip3009-r-s-v-abi-words",
    rOffsetBytes: 4,
    sOffsetBytes: 36,
    vOffsetBytes: 68,
  };
  const launchIntentHash = buildDirectNativeLaunchIntentHash({
    schemaVersion: "programmable.custom-launch-create-request.v3",
    launchWallet: "0x0000000000000000000000000000000000004000",
    chainId: "1",
    nonce: `0x${repeated("2")}`,
    sourceDescriptor: { a: "x" },
    sourceBundleManifest: { b: "y" },
    graphBundleHash: `sha256:${repeated("4")}`,
    verificationBundleHash: `sha256:${repeated("5")}`,
    launchProfileHash: `sha256:${repeated("6")}`,
    launchProfileSelection: {
      routeNamespace: `0x${repeated("1")}`,
      routeNonce: `0x${repeated("2")}`,
      fundingSignaturePatch,
    },
  });
  assert.equal(
    launchIntentHash,
    "sha256:fa398b12434bb4bf785612fc68530d9ba2af6db99eca93afea9ea93fe7bb82f4",
  );

  const context = {
    launchWallet: "0x0000000000000000000000000000000000004000",
    predictedInitializer: "0x0000000000000000000000000000000000005000",
    routeNamespace: `0x${repeated("1")}`,
    routeNonce: `0x${repeated("2")}`,
    launchIntentHash,
    nowSeconds: 1_000,
  };
  const input = {
    schemaVersion: "programmable.funding-authorization-input.v1",
    method: "eip-3009-receive-with-authorization",
    value: "30000000",
    validAfter: "900",
    validBefore: "1200",
  };
  const funding = buildFundingAuthorization(input, context);
  assert.equal(
    funding.fundingIntentHash,
    "0x0db785d5e4a05390c7c2361be45a8db78ad29c11162057ba443c78cb661a1ea4",
  );
  assert.equal(
    funding.fundingAuthorization.nonce,
    "0x7b2fd24feab532b315eb5ce709950578f57d509bb12fe2ddde70417f1808c9bc",
  );

  const excludedFinalState = buildFundingAuthorization(input, {
    ...context,
    signature: `0x${"77".repeat(65)}`,
    initializerCalldataHash: `0x${repeated("8")}`,
    graphCommitment: `0x${repeated("9")}`,
    permitDigest: `0x${repeated("a")}`,
  });
  assert.deepEqual(excludedFinalState, funding);
});

test("V3 request-only validation fails closed without exact config and artifact ABI", async () => {
  const request = {
    schemaVersion: "programmable.custom-launch-create-request.v3",
  };
  assert.throws(
    () => validateLaunchRequest(request),
    /V3_ARTIFACT_CONFIG_REQUIRED/u,
  );

  const root = await mkdtemp(path.join(os.tmpdir(), "programmable-v3-validate-"));
  const launchPath = path.join(root, "launch.json");
  await writeFile(launchPath, `${JSON.stringify(request)}\n`, "utf8");
  await assert.rejects(
    validateLaunchFile({ launchPath }),
    /V3_ARTIFACT_CONFIG_REQUIRED/u,
  );
});

test("V3 submit and status select the V3 route and stop at the funding wallet action", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "programmable-direct-native-v3-"));
  const launchPath = path.join(root, "launch.json");
  const requestBytes = Buffer.from(
    '{"schemaVersion":"programmable.custom-launch-create-request.v3"}\n',
    "utf8",
  );
  await writeFile(launchPath, requestBytes);
  const urls = [];
  const requestId = "60000000-0000-4000-8000-000000000006";
  const submit = await submitLaunch({
    launchPath,
    configPath: path.join(root, "programmable-launch.config.json"),
    idempotencyKey: "direct-native-v3-route-0001",
    apiOrigin: "http://127.0.0.1:43198",
    stateDirectory: path.join(root, "state"),
    maxAttempts: 1,
    validateLaunchFileImpl: async () => ({
      schemaVersion: "programmable.custom-launch-create-request.v3",
      requestSha256: sha256Digest(requestBytes),
    }),
    fetchImpl: async (url) => {
      urls.push(url);
      return new Response(JSON.stringify({
        schemaVersion: "programmable.custom-launch.v3",
        requestId,
        launchId: requestId,
        status: "awaiting_funding_authorization",
      }), { status: 202, headers: { "content-type": "application/json" } });
    },
    loadApiKeyImpl: async () => "pm_live_publictest_secretvalue",
  });
  assert.equal(urls[0], "http://127.0.0.1:43198/v3/custom-launches");
  const journal = JSON.parse(await readFile(submit.journalPath, "utf8"));
  assert.equal(journal.requestPath, "/v3/custom-launches");
  assert.ok(!JSON.stringify(journal).includes("pm_live_publictest_secretvalue"));

  const status = await statusLaunch({
    requestId,
    apiVersion: 3,
    watch: true,
    until: "authorized",
    apiOrigin: "http://127.0.0.1:43198",
    maxAttempts: 1,
    fetchImpl: async (url) => {
      urls.push(url);
      return new Response(JSON.stringify({
        schemaVersion: "programmable.custom-launch.v3",
        requestId,
        launchId: requestId,
        status: "awaiting_funding_authorization",
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
    loadApiKeyImpl: async () => "pm_live_publictest_secretvalue",
  });
  assert.equal(
    urls[1],
    `http://127.0.0.1:43198/v3/custom-launches/${requestId}`,
  );
  assert.equal(status.stopped, true);
  assert.equal(status.walletHandoffReady, true);
  assert.equal(status.walletHandoffStage, "funding-signature-required");
});
