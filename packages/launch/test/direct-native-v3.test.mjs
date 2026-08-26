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
  validateDirectNativePermitWindow,
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
  schemaVersion: "programmable.direct-native-hook-graph-profile-selection.v2",
  profileId: "programmable.direct-native-hook-graph.v1",
  profileRevision: 2,
  targetRoles: {
    tokenTargetId: "token",
    hookTargetId: "hook",
    initializerTargetId: "initializer",
    platformFeeBindingTargetId: "hook",
  },
  fundingMode: "eip-3009-receive-with-authorization",
  accountingMode: "inclusive-selected-total",
  assessmentBase: "executed-gross-declared-quote",
  feeCurrency: "declared-quote-currency",
  claimMode: "claim-authority-selected-recipient",
  applicantSelectedBuyHundredthsOfBip: "0",
  applicantSelectedSellHundredthsOfBip: "30000",
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

test("V3 selection closes funding, accounting, claim, and applicant-selected rate modes", () => {
  assert.deepEqual(validateDirectNativeProfileSelection(SELECTION), SELECTION);
  assert.equal(validateDirectNativeProfileSelection({
    ...SELECTION,
    applicantSelectedBuyHundredthsOfBip: "999999",
  }).applicantSelectedBuyHundredthsOfBip, "999999");
  assert.throws(
    () => validateDirectNativeProfileSelection({
      ...SELECTION,
      applicantSelectedBuyHundredthsOfBip: "1000000",
    }),
    /between 0 and 999999/u,
  );
  assert.throws(
    () => validateDirectNativeProfileSelection({
      ...SELECTION,
      accountingMode: "additive-platform-share",
      applicantSelectedBuyHundredthsOfBip: "999999",
    }),
    /must not exceed 998999/u,
  );
  assert.deepEqual(validateDirectNativeProfileSelection({
    ...SELECTION,
    fundingMode: "none",
    claimMode: "immutable-payout-recipient",
    payoutRecipient: "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c",
  }).payoutRecipient, "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c");
  assert.throws(
    () => validateDirectNativeProfileSelection({
      ...SELECTION,
      claimMode: "immutable-payout-recipient",
      payoutRecipient: TOKEN_ADDRESS,
    }),
    /platform claim authority/u,
  );
  assert.throws(
    () => validateDirectNativeProfileSelection({
      ...SELECTION,
      feeCurrency: "input-currency",
    }),
    /not a supported closed pair/u,
  );
  assert.deepEqual(validateDirectNativePermitWindow({
    validAfter: "900",
    deadline: "1200",
  }), { validAfter: "900", deadline: "1200" });
  assert.throws(
    () => validateDirectNativePermitWindow({ validAfter: "900", deadline: "4501" }),
    /must not exceed 3600 seconds/u,
  );
});

test("V3 profile binds platform-owned proof policy without pinning applicant hook code", () => {
  const profile = resolveDirectNativeProfile(SELECTION);
  assert.deepEqual(profile.platformFeePolicy, {
    schemaVersion: "programmable.platform-fee-policy.v1",
    accountingMode: "inclusive-selected-total",
    applicability: "successful-pool-swaps",
    rateDenominator: "1000000",
    programmableFeeHundredthsOfBip: "1000",
    assessmentBase: "executed-gross-declared-quote",
    feeCurrency: "declared-quote-currency",
    roundingMode: "floor",
    claimAuthority: "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c",
  });
  assert.deepEqual(profile.platformFeeProofPolicy, {
    schemaVersion: "programmable.platform-fee-conformance-policy.v1",
    mode: "platform-issued-exact-graph-receipt-v1",
    receiptSchemaVersion: "programmable.platform-fee-conformance-receipt.v1",
    runnerId: "programmable.platform-fee-conformance",
    runnerVersion: "1.0.0",
    vectorSetVersion: "1.0.0",
    receiptAuthority: "platform-only",
    subject: "final-graph-commitment-and-runtime-set",
    activationStatus: "integration-pending",
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
  assert.equal(JSON.stringify(profile).includes("ProgrammableVolumeFeeHookV2"), false);
  assert.equal(Object.hasOwn(profile, "feeEnforcement"), false);
  const additive = resolveDirectNativeProfile({
    ...SELECTION,
    accountingMode: "additive-platform-share",
  });
  assert.equal(additive.platformFeePolicy.accountingMode, "additive-platform-share");
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

test("V3 binding accepts applicant hook mask and discloses inclusive economics and claim mode", () => {
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
  assert.deepEqual(binding.platformFeeBinding.economics.buy, {
    applicantSelectedHundredthsOfBip: "0",
    projectHundredthsOfBip: "0",
    effectiveTotalHundredthsOfBip: "1000",
  });
  assert.deepEqual(binding.platformFeeBinding.economics.sell, {
    applicantSelectedHundredthsOfBip: "30000",
    projectHundredthsOfBip: "29000",
    effectiveTotalHundredthsOfBip: "30000",
  });
  assert.deepEqual(binding.platformFeeBinding.claimBinding, {
    mode: "claim-authority-selected-recipient",
    claimAuthority: "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c",
    destinationConstraint: "nonzero-address",
  });
  assert.match(binding.expectedPoolId, /^0x[0-9a-f]{64}$/u);
  validateDirectNativeProfileGraph(
    resolveDirectNativeProfile(SELECTION),
    binding,
    bundle,
  );
  const invalidFeeBundle = graphBundle();
  invalidFeeBundle.pool.fee = 1_000_001;
  assert.throws(
    () => validateDirectNativeProfileGraph(
      resolveDirectNativeProfile(SELECTION),
      binding,
      invalidFeeBundle,
    ),
    /pool fee must be between 0 and 999999 or the dynamic-fee sentinel/u,
  );
});

test("V3 accepts the zero hook-permission mask only for the dynamic-fee sentinel", () => {
  const bundle = graphBundle();
  bundle.pool.fee = 0x800000;
  bundle.targets = bundle.targets.map((candidate) => candidate.targetId === "hook"
    ? { ...candidate, declaredHookPermissions: [] }
    : candidate);
  const selection = {
    ...SELECTION,
    fundingMode: "none",
  };
  const binding = buildDirectNativeProfileBinding(selection, {
    graphBundle: bundle,
    predictions: [
      { targetId: "token", predictedAddress: TOKEN_ADDRESS },
      { targetId: "hook", predictedAddress: "0x0000000000000000000000000000000000004000" },
      { targetId: "initializer", predictedAddress: INITIALIZER_ADDRESS },
    ],
    routeNamespace: ROUTE_NAMESPACE,
    routeNonce: ROUTE_NONCE,
    quoteCurrency: ZERO_ADDRESS,
  });
  assert.equal(binding.hookPermissionMask, 0);
  validateDirectNativeProfileGraph(resolveDirectNativeProfile(selection), binding, bundle);

  const staticFeeBundle = structuredClone(bundle);
  staticFeeBundle.pool.fee = 3_000;
  assert.throws(
    () => validateDirectNativeProfileGraph(
      resolveDirectNativeProfile(selection),
      binding,
      staticFeeBundle,
    ),
    /zero-permission hooks require the dynamic-fee sentinel/u,
  );
});

test("V3 accepts a variable valid hook mask and a zero-value no-funding graph", () => {
  const bundle = graphBundle();
  bundle.targets = bundle.targets.map((candidate) => candidate.targetId === "hook"
    ? { ...candidate, declaredHookPermissions: ["beforeSwap"] }
    : candidate);
  const selection = {
    ...SELECTION,
    fundingMode: "none",
    accountingMode: "inclusive-selected-total",
    claimMode: "immutable-payout-recipient",
    payoutRecipient: "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c",
    applicantSelectedBuyHundredthsOfBip: "10000",
    applicantSelectedSellHundredthsOfBip: "10000",
  };
  const binding = buildDirectNativeProfileBinding(selection, {
    graphBundle: bundle,
    predictions: [
      { targetId: "token", predictedAddress: TOKEN_ADDRESS },
      { targetId: "hook", predictedAddress: "0x0000000000000000000000000000000000001080" },
      { targetId: "initializer", predictedAddress: INITIALIZER_ADDRESS },
    ],
    routeNamespace: ROUTE_NAMESPACE,
    routeNonce: ROUTE_NONCE,
    quoteCurrency: ZERO_ADDRESS,
  });
  assert.equal(binding.hookPermissionMask, 0x80);
  assert.equal(Object.hasOwn(binding, "fundingSignaturePatch"), false);
  assert.deepEqual(binding.platformFeeBinding.claimBinding, {
    mode: "immutable-payout-recipient",
    claimAuthority: "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c",
    payoutRecipient: "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c",
  });
  validateDirectNativeProfileGraph(resolveDirectNativeProfile(selection), binding, bundle);
  const funded = structuredClone(bundle);
  funded.targets[0].deploymentValueWei = "1";
  assert.throws(
    () => validateDirectNativeProfileGraph(resolveDirectNativeProfile(selection), binding, funded),
    /fundingMode none requires zero deployment and initializer value/u,
  );
});

test("V3 binds native launch value to the separately reviewed Router transaction", () => {
  const bundle = graphBundle();
  bundle.targets[2].initializerValueWei = "100000000000000000";
  const selection = {
    ...SELECTION,
    fundingMode: "wallet-transaction-value",
  };
  const binding = buildDirectNativeProfileBinding(selection, {
    graphBundle: bundle,
    predictions: [
      { targetId: "token", predictedAddress: TOKEN_ADDRESS },
      { targetId: "hook", predictedAddress: HOOK_ADDRESS },
      { targetId: "initializer", predictedAddress: INITIALIZER_ADDRESS },
    ],
    routeNamespace: ROUTE_NAMESPACE,
    routeNonce: ROUTE_NONCE,
    quoteCurrency: ZERO_ADDRESS,
  });
  assert.deepEqual(resolveDirectNativeProfile(selection).fundingPolicy, {
    mode: "wallet-transaction-value",
    launchFundingRequired: true,
    signatureRequired: false,
    valueSource: "exact-router-transaction-msg-value",
  });
  assert.equal(Object.hasOwn(binding, "fundingSignaturePatch"), false);
  validateDirectNativeProfileGraph(resolveDirectNativeProfile(selection), binding, bundle);
});

test("V3 additive accounting preserves the applicant project rate and adds exactly 1000 ppm", () => {
  const bundle = graphBundle();
  const selection = {
    ...SELECTION,
    accountingMode: "additive-platform-share",
    applicantSelectedBuyHundredthsOfBip: "29000",
    applicantSelectedSellHundredthsOfBip: "29000",
  };
  const binding = buildDirectNativeProfileBinding(selection, {
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
  assert.deepEqual(binding.platformFeeBinding.economics.buy, {
    applicantSelectedHundredthsOfBip: "29000",
    projectHundredthsOfBip: "29000",
    effectiveTotalHundredthsOfBip: "30000",
  });
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
    permitWindow: { validAfter: "900", deadline: "1200" },
    launchProfileSelection: {
      routeNamespace: `0x${repeated("1")}`,
      routeNonce: `0x${repeated("2")}`,
      fundingSignaturePatch,
    },
  });
  assert.equal(
    launchIntentHash,
    "sha256:a270e536f5c50ab56acdd1c54430e4af0e09d28a21ab88b1d779f9a5696738b2",
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
    "0x3351010e63b1b31609097e2464672d91275516c0dc961d062db04888ddd6d88a",
  );
  assert.equal(
    funding.fundingAuthorization.nonce,
    "0x966166a956309504f2643039a56712990a82680b9048e0fcd7a1c16a5897eaca",
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
