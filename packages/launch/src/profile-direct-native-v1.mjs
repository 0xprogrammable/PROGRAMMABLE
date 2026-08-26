import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  keccak256,
  parseAbiParameters,
  stringToHex,
  toFunctionSelector,
} from "viem";

import { canonicalizeJson } from "./canonical-json.mjs";
import { canonicalIdentifier } from "./build.mjs";
import {
  DIRECT_NATIVE_LAUNCH_INTENT_HASH_DOMAIN,
  DIRECT_NATIVE_LIQUIDITY_MODEL_ASSESSMENT_SCHEMA,
  DIRECT_NATIVE_LIQUIDITY_MODEL_INTENT_SCHEMA,
  DIRECT_NATIVE_PROFILE_BINDING_SCHEMA,
  DIRECT_NATIVE_PROFILE_HASH_DOMAIN,
  DIRECT_NATIVE_PROFILE_ID,
  DIRECT_NATIVE_PROFILE_REVISION,
  DIRECT_NATIVE_PROFILE_SCHEMA,
  DIRECT_NATIVE_PROFILE_SELECTION_SCHEMA,
  DIRECT_NATIVE_PROFILE_VERSION,
  FUNDING_AUTHORIZATION_DESCRIPTOR_SCHEMA,
  FUNDING_AUTHORIZATION_INPUT_SCHEMA,
  FUNDING_AUTHORIZATION_METHOD,
  FUNDING_WALLET_TRANSACTION_VALUE_METHOD,
  FUNDING_SIGNATURE_PATCH_SCHEMA,
  FUNDING_INTENT_HASH_DOMAIN,
  FUNDING_NONCE_DOMAIN,
  GRAPH_FACTORY,
  GRAPH_FACTORY_RUNTIME_CODE_HASH,
  HOOK_INVENTORY_CUSTOM_ACCOUNTING_VECTORS,
  HOOK_PERMISSION_BITS,
  MAINNET_CHAIN_ID,
  MAINNET_USDC,
  MAINNET_USDC_RUNTIME_CODE_HASH,
  MAINNET_USDC_DOMAIN_NAME,
  MAINNET_USDC_DOMAIN_SEPARATOR,
  MAINNET_USDC_DOMAIN_VERSION,
  LAUNCH_SEEDED_CONCENTRATED_LIQUIDITY_VECTORS,
  PLATFORM_FEE_DENOMINATOR,
  PLATFORM_FEE_BINDING_SCHEMA,
  PLATFORM_FEE_CLAIM_AUTHORITY,
  PLATFORM_FEE_POLICY_SCHEMA,
  PLATFORM_FEE_PROOF_POLICY_SCHEMA,
  PLATFORM_FEE_RATE_PPM,
  POOL_MANAGER,
  POOL_MANAGER_RUNTIME_CODE_HASH,
  PERMIT_AUTHORITY,
  PERMIT_AUTHORITY_RUNTIME_CODE_HASH,
  RECEIVE_WITH_AUTHORIZATION_TYPEHASH,
  ROUTER,
  ROUTER_RUNTIME_CODE_HASH,
} from "./constants.mjs";
import { assertExactKeys, sha256Digest } from "./io.mjs";

const HEX32 = /^0x[0-9a-f]{64}$/;
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/;
const PLATFORM_ACCOUNTING_MODES = Object.freeze([
  "additive-platform-share",
  "inclusive-selected-total",
]);
const FUNDING_MODES = Object.freeze([
  "none",
  FUNDING_WALLET_TRANSACTION_VALUE_METHOD,
  FUNDING_AUTHORIZATION_METHOD,
]);
const CLAIM_MODES = Object.freeze([
  "immutable-payout-recipient",
  "claim-authority-selected-recipient",
]);
const PLATFORM_FEE_ASSESSMENT_PAIRS = Object.freeze([
  Object.freeze({
    assessmentBase: "executed-gross-declared-quote",
    feeCurrency: "declared-quote-currency",
  }),
  Object.freeze({
    assessmentBase: "settled-input-before-platform-fee",
    feeCurrency: "input-currency",
  }),
]);
const PLATFORM_FEE_POLICY_COMMON = Object.freeze({
  schemaVersion: PLATFORM_FEE_POLICY_SCHEMA,
  applicability: "successful-pool-swaps",
  rateDenominator: PLATFORM_FEE_DENOMINATOR,
  programmableFeeHundredthsOfBip: PLATFORM_FEE_RATE_PPM,
  roundingMode: "floor",
  claimAuthority: PLATFORM_FEE_CLAIM_AUTHORITY,
});
const PLATFORM_FEE_PROOF_POLICY = Object.freeze({
  schemaVersion: PLATFORM_FEE_PROOF_POLICY_SCHEMA,
  mode: "platform-issued-exact-graph-receipt-v1",
  receiptSchemaVersion: "programmable.platform-fee-conformance-receipt.v1",
  runnerId: "programmable.platform-fee-conformance",
  runnerVersion: "1.0.0",
  vectorSetVersion: "1.0.0",
  receiptAuthority: "platform-only",
  subject: "final-graph-commitment-and-runtime-set",
  activationStatus: "live",
});
const DEFAULT_EXTERNAL_LIQUIDITY_MODEL = Object.freeze({
  schemaVersion: DIRECT_NATIVE_LIQUIDITY_MODEL_INTENT_SCHEMA,
  model: "external-concentrated-liquidity",
  declaredLaunchState: "liquidity_required",
});

export function validateDirectNativeProfileSelection(value) {
  const commonKeys = [
    "schemaVersion",
    "profileId",
    "profileRevision",
    "targetRoles",
    "fundingMode",
    "accountingMode",
    "assessmentBase",
    "feeCurrency",
    "claimMode",
    "applicantSelectedBuyHundredthsOfBip",
    "applicantSelectedSellHundredthsOfBip",
  ];
  const claimMode = canonicalClaimMode(value?.claimMode);
  const liquidityKeys = Object.hasOwn(value ?? {}, "liquidityModel")
    ? ["liquidityModel"]
    : [];
  assertExactKeys(value, claimMode === "immutable-payout-recipient"
    ? [...commonKeys, ...liquidityKeys, "payoutRecipient"]
    : [...commonKeys, ...liquidityKeys], "direct-native launchProfile");
  if (value.schemaVersion !== DIRECT_NATIVE_PROFILE_SELECTION_SCHEMA
    || value.profileId !== DIRECT_NATIVE_PROFILE_ID
    || value.profileRevision !== DIRECT_NATIVE_PROFILE_REVISION) {
    throw new TypeError("direct-native launchProfile identity is not supported");
  }
  assertExactKeys(value.targetRoles, [
    "tokenTargetId",
    "hookTargetId",
    "initializerTargetId",
    "platformFeeBindingTargetId",
  ], "direct-native launchProfile.targetRoles");
  const targetRoles = Object.fromEntries(Object.entries(value.targetRoles).map(([key, targetId]) => [
    key,
    canonicalIdentifier(targetId, `direct-native launchProfile.targetRoles.${key}`),
  ]));
  if (new Set([
    targetRoles.tokenTargetId,
    targetRoles.hookTargetId,
    targetRoles.initializerTargetId,
  ]).size !== 3) {
    throw new TypeError("direct-native token, hook, and initializer target roles must be distinct");
  }
  const assessment = canonicalPlatformFeeAssessment(
    value.assessmentBase,
    value.feeCurrency,
  );
  return {
    schemaVersion: DIRECT_NATIVE_PROFILE_SELECTION_SCHEMA,
    profileId: DIRECT_NATIVE_PROFILE_ID,
    profileRevision: DIRECT_NATIVE_PROFILE_REVISION,
    targetRoles,
    fundingMode: canonicalFundingMode(value.fundingMode),
    accountingMode: canonicalAccountingMode(value.accountingMode),
    ...assessment,
    claimMode,
    liquidityModel: canonicalLiquidityModel(
      value.liquidityModel ?? DEFAULT_EXTERNAL_LIQUIDITY_MODEL,
    ),
    ...(claimMode === "immutable-payout-recipient"
      ? { payoutRecipient: canonicalImmutablePayoutRecipient(value.payoutRecipient) }
      : {}),
    applicantSelectedBuyHundredthsOfBip: canonicalApplicantSelectedFee(
      value.applicantSelectedBuyHundredthsOfBip,
      value.accountingMode,
      "direct-native launchProfile.applicantSelectedBuyHundredthsOfBip",
    ),
    applicantSelectedSellHundredthsOfBip: canonicalApplicantSelectedFee(
      value.applicantSelectedSellHundredthsOfBip,
      value.accountingMode,
      "direct-native launchProfile.applicantSelectedSellHundredthsOfBip",
    ),
  };
}

export function resolveDirectNativeProfile(selection) {
  const normalized = validateDirectNativeProfileSelection(selection);
  return {
    schemaVersion: DIRECT_NATIVE_PROFILE_SCHEMA,
    profileId: DIRECT_NATIVE_PROFILE_ID,
    profileRevision: DIRECT_NATIVE_PROFILE_REVISION,
    profileVersion: DIRECT_NATIVE_PROFILE_VERSION,
    productionLaunchAuthorized: true,
    chainId: MAINNET_CHAIN_ID,
    router: ROUTER,
    routerRuntimeCodeHash: ROUTER_RUNTIME_CODE_HASH,
    permitAuthority: PERMIT_AUTHORITY,
    permitAuthorityRuntimeCodeHash: PERMIT_AUTHORITY_RUNTIME_CODE_HASH,
    graphFactory: GRAPH_FACTORY,
    graphFactoryRuntimeCodeHash: GRAPH_FACTORY_RUNTIME_CODE_HASH,
    poolManager: POOL_MANAGER,
    poolManagerRuntimeCodeHash: POOL_MANAGER_RUNTIME_CODE_HASH,
    fundingToken: MAINNET_USDC,
    fundingTokenRuntimeCodeHash: MAINNET_USDC_RUNTIME_CODE_HASH,
    graphPolicy: {
      minimumTargets: 3,
      maximumTargets: 16,
      directTargetsOnly: true,
    },
    currencyPolicy: {
      native: true,
      erc20: true,
    },
    hookPermissionPolicy: {
      minimumMask: 0,
      maximumMask: 16_383,
      requireHookMinerAddressMaskMatch: true,
    },
    fundingPolicy: fundingPolicy(normalized.fundingMode),
    platformFeePolicy: platformFeePolicy(
      normalized.accountingMode,
      normalized.assessmentBase,
      normalized.feeCurrency,
    ),
    platformFeeProofPolicy: PLATFORM_FEE_PROOF_POLICY,
  };
}

export function validateEmbeddedDirectNativeProfile(value) {
  const expected = resolveDirectNativeProfile({
    schemaVersion: DIRECT_NATIVE_PROFILE_SELECTION_SCHEMA,
    profileId: DIRECT_NATIVE_PROFILE_ID,
    profileRevision: DIRECT_NATIVE_PROFILE_REVISION,
    targetRoles: {
      tokenTargetId: "token",
      hookTargetId: "hook",
      initializerTargetId: "initializer",
      platformFeeBindingTargetId: "hook",
    },
    fundingMode: value?.fundingPolicy?.mode,
    accountingMode: value?.platformFeePolicy?.accountingMode,
    assessmentBase: value?.platformFeePolicy?.assessmentBase,
    feeCurrency: value?.platformFeePolicy?.feeCurrency,
    claimMode: "claim-authority-selected-recipient",
    applicantSelectedBuyHundredthsOfBip: "0",
    applicantSelectedSellHundredthsOfBip: "0",
  });
  if (canonicalizeJson(value) !== canonicalizeJson(expected)) {
    throw new TypeError("direct-native request does not contain the closed embedded launchProfile");
  }
  return expected;
}

export function hashDirectNativeProfile(profile) {
  return framedSha256(DIRECT_NATIVE_PROFILE_HASH_DOMAIN, profile);
}

export function buildDirectNativeProfileBinding(selection, context) {
  const normalized = validateDirectNativeProfileSelection(selection);
  const byId = new Map(context.graphBundle.targets.map((target) => [target.targetId, target]));
  const predictions = new Map(context.predictions.map((prediction) => [
    prediction.targetId,
    prediction.predictedAddress,
  ]));
  const { targetRoles } = normalized;
  requireTarget(byId, targetRoles.tokenTargetId, "token");
  const hook = requireTarget(byId, targetRoles.hookTargetId, "hook");
  requireTarget(byId, targetRoles.initializerTargetId, "initializer");
  requireTarget(byId, targetRoles.platformFeeBindingTargetId, "platform fee binding");
  const tokenAddress = requirePrediction(predictions, targetRoles.tokenTargetId);
  const hookAddress = requirePrediction(predictions, targetRoles.hookTargetId);
  const predictedInitializer = requirePrediction(predictions, targetRoles.initializerTargetId);
  const hookPermissionMask = permissionMask(hook.declaredHookPermissions);
  const [currency0, currency1] = sortedCurrencies(context.quoteCurrency, tokenAddress);
  const poolKey = {
    currency0,
    currency1,
    fee: context.graphBundle.pool.fee,
    tickSpacing: context.graphBundle.pool.tickSpacing,
    hooks: hookAddress,
  };
  return {
    schemaVersion: DIRECT_NATIVE_PROFILE_BINDING_SCHEMA,
    profileId: DIRECT_NATIVE_PROFILE_ID,
    profileRevision: DIRECT_NATIVE_PROFILE_REVISION,
    targetRoles,
    fundingMode: normalized.fundingMode,
    routeNamespace: context.routeNamespace,
    routeNonce: context.routeNonce,
    hookPermissionMask,
    predictedInitializer,
    poolKey,
    expectedPoolId: poolId(poolKey),
    liquidityModel: normalized.liquidityModel,
    ...(normalized.fundingMode === FUNDING_AUTHORIZATION_METHOD
      ? {
          fundingSignaturePatch: validateFundingSignaturePatch(
            context.fundingSignaturePatch,
            targetRoles.initializerTargetId,
            context.graphBundle,
          ),
        }
      : {}),
    platformFeeBinding: {
      ...platformFeePolicy(
        normalized.accountingMode,
        normalized.assessmentBase,
        normalized.feeCurrency,
      ),
      schemaVersion: PLATFORM_FEE_BINDING_SCHEMA,
      targetId: targetRoles.platformFeeBindingTargetId,
      claimBinding: platformFeeClaimBinding(normalized),
      economics: {
        buy: platformFeeEconomics(
          normalized.applicantSelectedBuyHundredthsOfBip,
          normalized.accountingMode,
        ),
        sell: platformFeeEconomics(
          normalized.applicantSelectedSellHundredthsOfBip,
          normalized.accountingMode,
        ),
      },
    },
  };
}

export function validateDirectNativeProfileBinding(value, context) {
  const expected = buildDirectNativeProfileBinding({
    schemaVersion: DIRECT_NATIVE_PROFILE_SELECTION_SCHEMA,
    profileId: DIRECT_NATIVE_PROFILE_ID,
    profileRevision: DIRECT_NATIVE_PROFILE_REVISION,
    targetRoles: value?.targetRoles,
    fundingMode: value?.fundingMode,
    accountingMode: value?.platformFeeBinding?.accountingMode,
    assessmentBase: value?.platformFeeBinding?.assessmentBase,
    feeCurrency: value?.platformFeeBinding?.feeCurrency,
    claimMode: value?.platformFeeBinding?.claimBinding?.mode,
    liquidityModel: value?.liquidityModel,
    ...(value?.platformFeeBinding?.claimBinding?.mode === "immutable-payout-recipient"
      ? { payoutRecipient: value?.platformFeeBinding?.claimBinding?.payoutRecipient }
      : {}),
    applicantSelectedBuyHundredthsOfBip:
      value?.platformFeeBinding?.economics?.buy?.applicantSelectedHundredthsOfBip,
    applicantSelectedSellHundredthsOfBip:
      value?.platformFeeBinding?.economics?.sell?.applicantSelectedHundredthsOfBip,
  }, context);
  if (canonicalizeJson(value) !== canonicalizeJson(expected)) {
    throw new TypeError("direct-native launchProfileSelection does not match the graph and route");
  }
  return expected;
}

export function validateDirectNativeProfileGraph(profile, binding, graphBundle) {
  validateEmbeddedDirectNativeProfile(profile);
  if (profile.fundingPolicy.mode !== binding.fundingMode
    || profile.platformFeePolicy.accountingMode
      !== binding.platformFeeBinding.accountingMode
    || profile.platformFeePolicy.assessmentBase
      !== binding.platformFeeBinding.assessmentBase
    || profile.platformFeePolicy.feeCurrency
      !== binding.platformFeeBinding.feeCurrency) {
    throw new TypeError("direct-native embedded policy does not match its launch binding");
  }
  if (!Array.isArray(graphBundle.targets)
    || graphBundle.targets.length < 3
    || graphBundle.targets.length > 16) {
    throw new TypeError("direct-native graph must contain between 3 and 16 direct targets");
  }
  if (!Number.isSafeInteger(graphBundle.pool?.fee)
    || graphBundle.pool.fee < 0
    || (graphBundle.pool.fee > 999_999 && graphBundle.pool.fee !== 0x800000)) {
    throw new TypeError(
      "direct-native pool fee must be between 0 and 999999 or the dynamic-fee sentinel 0x800000",
    );
  }
  const byId = new Map(graphBundle.targets.map((target) => [target.targetId, target]));
  const roles = binding.targetRoles;
  const token = requireTarget(byId, roles.tokenTargetId, "token");
  const hook = requireTarget(byId, roles.hookTargetId, "hook");
  const initializer = requireTarget(byId, roles.initializerTargetId, "initializer");
  if (token.componentKind !== "token" || hook.componentKind !== "hook"
    || initializer.componentKind !== "other") {
    throw new TypeError("direct-native target roles do not match token, hook, and initializer kinds");
  }
  if (graphBundle.pool.tokenTargetId !== roles.tokenTargetId
    || graphBundle.pool.hookTargetId !== roles.hookTargetId) {
    throw new TypeError("direct-native target roles do not match the graph pool");
  }
  const declaredMask = permissionMask(hook.declaredHookPermissions);
  if (!Number.isSafeInteger(binding.hookPermissionMask)
    || binding.hookPermissionMask < 0
    || binding.hookPermissionMask > 16_383
    || binding.hookPermissionMask !== declaredMask) {
    throw new TypeError("direct-native hook permission mask must match the applicant hook declaration");
  }
  if (declaredMask === 0 && graphBundle.pool.fee !== 0x800000) {
    throw new TypeError(
      "direct-native zero-permission hooks require the dynamic-fee sentinel 0x800000",
    );
  }
  requireTarget(byId, roles.platformFeeBindingTargetId, "platform fee binding");
  if (binding.platformFeeBinding.targetId !== roles.platformFeeBindingTargetId) {
    throw new TypeError("direct-native platform fee policy must bind its selected direct target");
  }
  validateFundingGraph(binding.fundingMode, graphBundle);
  validateLiquidityModelGraph(binding.liquidityModel, roles, byId);
  return binding;
}

export function validateDirectNativeProfileBuilds(
  binding,
  graphBundle,
  verificationBundle,
) {
  const components = new Map(
    verificationBundle.components.map((component) => [component.targetId, component]),
  );
  const targets = new Map(graphBundle.targets.map((target) => [target.targetId, target]));
  const subjectTargetIds = new Set([
    binding.targetRoles.hookTargetId,
    binding.targetRoles.platformFeeBindingTargetId,
  ]);
  for (const targetId of subjectTargetIds) {
    const target = targets.get(targetId);
    const component = components.get(targetId);
    if (!target || !component?.runtimeMaterialization
      || component.runtimeMaterialization.deployedRuntimeCodeHash
        !== target.expectedRuntimeCodeHash) {
      throw new TypeError(
        `PROFILE_BUILD_MISMATCH: ${targetId} is not bound to its exact materialized runtime`,
      );
    }
  }
  return { subjectTargetIds: [...subjectTargetIds] };
}

export function validateFundingAuthorizationInput(value, { nowSeconds } = {}) {
  assertExactKeys(value, [
    "schemaVersion",
    "method",
    "value",
    "validAfter",
    "validBefore",
  ], "fundingAuthorization input");
  if (value.schemaVersion !== FUNDING_AUTHORIZATION_INPUT_SCHEMA
    || value.method !== FUNDING_AUTHORIZATION_METHOD) {
    throw new TypeError("fundingAuthorization input method is not supported");
  }
  const normalized = {
    schemaVersion: FUNDING_AUTHORIZATION_INPUT_SCHEMA,
    method: FUNDING_AUTHORIZATION_METHOD,
    value: canonicalUint(value.value, "fundingAuthorization.value", false),
    validAfter: canonicalUint64(value.validAfter, "fundingAuthorization.validAfter"),
    validBefore: canonicalUint64(value.validBefore, "fundingAuthorization.validBefore", false),
  };
  validateAuthorizationWindow(normalized, nowSeconds);
  return normalized;
}

export function validateDirectNativePermitWindow(value, { nowSeconds } = {}) {
  assertExactKeys(value, ["validAfter", "deadline"], "permitWindow");
  const normalized = {
    validAfter: canonicalUint64(value.validAfter, "permitWindow.validAfter"),
    deadline: canonicalUint64(value.deadline, "permitWindow.deadline", false),
  };
  validateAuthorizationWindow({
    validAfter: normalized.validAfter,
    validBefore: normalized.deadline,
  }, nowSeconds);
  return normalized;
}

export function buildFundingSignaturePatch(input, graphBundle, initializerArtifact) {
  const patch = deriveFundingSignaturePatch(input, graphBundle);
  validateFundingSignaturePatchAbi(patch, graphBundle, initializerArtifact);
  return patch;
}

function deriveFundingSignaturePatch(input, graphBundle) {
  assertExactKeys(input, [
    "targetId",
    "rOffsetBytes",
    "sOffsetBytes",
    "vOffsetBytes",
  ], "fundingSignaturePatch input");
  const targetId = canonicalIdentifier(input.targetId, "fundingSignaturePatch.targetId");
  const target = graphBundle.targets.find((candidate) => candidate.targetId === targetId);
  if (!target) throw new TypeError("fundingSignaturePatch target is absent from graph");
  const calldata = Buffer.from(target.initializerCalldata.slice(2), "hex");
  const offsets = {
    rOffsetBytes: canonicalPatchOffset(input.rOffsetBytes, calldata, "r"),
    sOffsetBytes: canonicalPatchOffset(input.sOffsetBytes, calldata, "s"),
    vOffsetBytes: canonicalPatchOffset(input.vOffsetBytes, calldata, "v"),
  };
  if (new Set(Object.values(offsets)).size !== 3) {
    throw new TypeError("fundingSignaturePatch offsets must be distinct");
  }
  return {
    schemaVersion: FUNDING_SIGNATURE_PATCH_SCHEMA,
    targetId,
    unsignedInitializerCalldataSha256: sha256Digest(calldata),
    initializerCalldataLengthBytes: calldata.byteLength,
    signatureEncoding: "eip3009-r-s-v-abi-words",
    ...offsets,
  };
}

export function buildFundingAuthorization(input, context) {
  const normalized = validateFundingAuthorizationInput(input, context);
  const from = getAddress(context.launchWallet);
  const to = getAddress(context.predictedInitializer);
  const fundingIntentHash = keccak256(encodeAbiParameters(
    parseAbiParameters(
      "bytes32,uint256,address,address,address,bytes32,bytes32,bytes32,address,address,uint256,uint256,uint256",
    ),
    [
      keccak256(stringToHex(FUNDING_INTENT_HASH_DOMAIN)),
      BigInt(MAINNET_CHAIN_ID),
      MAINNET_USDC,
      ROUTER,
      GRAPH_FACTORY,
      context.routeNamespace,
      context.routeNonce,
      sha256ToHex32(context.launchIntentHash, "launchIntentHash"),
      from,
      to,
      BigInt(normalized.value),
      BigInt(normalized.validAfter),
      BigInt(normalized.validBefore),
    ],
  ));
  const nonce = keccak256(encodeAbiParameters(
    parseAbiParameters("bytes32,bytes32"),
    [keccak256(stringToHex(FUNDING_NONCE_DOMAIN)), fundingIntentHash],
  ));
  const fundingAuthorization = {
    schemaVersion: FUNDING_AUTHORIZATION_DESCRIPTOR_SCHEMA,
    method: FUNDING_AUTHORIZATION_METHOD,
    token: MAINNET_USDC,
    from,
    to,
    value: normalized.value,
    validAfter: normalized.validAfter,
    validBefore: normalized.validBefore,
    nonce,
  };
  return { fundingIntentHash, fundingAuthorization };
}

export function validateFundingAuthorization(value, fundingIntentHash, context) {
  assertExactKeys(value, [
    "schemaVersion",
    "method",
    "token",
    "from",
    "to",
    "value",
    "validAfter",
    "validBefore",
    "nonce",
  ], "fundingAuthorization");
  const rebuilt = buildFundingAuthorization({
    schemaVersion: FUNDING_AUTHORIZATION_INPUT_SCHEMA,
    method: FUNDING_AUTHORIZATION_METHOD,
    value: value.value,
    validAfter: value.validAfter,
    validBefore: value.validBefore,
  }, context);
  if (fundingIntentHash !== rebuilt.fundingIntentHash
    || canonicalizeJson(value) !== canonicalizeJson(rebuilt.fundingAuthorization)) {
    throw new TypeError("fundingAuthorization does not match the pre-signature funding intent");
  }
  return rebuilt;
}

export function buildDirectNativeLaunchIntentHash(value) {
  return framedSha256(DIRECT_NATIVE_LAUNCH_INTENT_HASH_DOMAIN, value);
}

function framedSha256(domain, value) {
  return sha256Digest(Buffer.concat([
    Buffer.from(domain, "utf8"),
    Buffer.from([0]),
    Buffer.from(canonicalizeJson(value), "utf8"),
  ]));
}

function requireTarget(byId, targetId, label) {
  const target = byId.get(targetId);
  if (!target) throw new TypeError(`direct-native ${label} target is absent from graph`);
  return target;
}

function requirePrediction(predictions, targetId) {
  const predicted = predictions.get(targetId);
  if (typeof predicted !== "string") {
    throw new TypeError(`direct-native graph has no prediction for ${targetId}`);
  }
  return getAddress(predicted);
}

function permissionMask(permissions) {
  if (!Array.isArray(permissions)) return -1;
  return permissions.reduce((mask, permission) => {
    const bit = HOOK_PERMISSION_BITS[permission];
    return bit === undefined ? -1 : mask | (1 << bit);
  }, 0);
}

function sortedCurrencies(left, right) {
  const addresses = [getAddress(left), getAddress(right)].sort(
    (a, b) => BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0,
  );
  if (addresses[0].toLowerCase() === addresses[1].toLowerCase()) {
    throw new TypeError("direct-native pool currencies must be distinct");
  }
  return addresses;
}

function poolId(poolKey) {
  return keccak256(encodeAbiParameters(
    parseAbiParameters("address,address,uint24,int24,address"),
    [
      poolKey.currency0,
      poolKey.currency1,
      poolKey.fee,
      poolKey.tickSpacing,
      poolKey.hooks,
    ],
  ));
}

function validateFundingSignaturePatch(value, initializerTargetId, graphBundle) {
  assertExactKeys(value, [
    "schemaVersion",
    "targetId",
    "unsignedInitializerCalldataSha256",
    "initializerCalldataLengthBytes",
    "signatureEncoding",
    "rOffsetBytes",
    "sOffsetBytes",
    "vOffsetBytes",
  ], "fundingSignaturePatch");
  if (value.schemaVersion !== FUNDING_SIGNATURE_PATCH_SCHEMA
    || value.targetId !== initializerTargetId
    || value.signatureEncoding !== "eip3009-r-s-v-abi-words") {
    throw new TypeError("fundingSignaturePatch identity does not match the initializer role");
  }
  const expected = deriveFundingSignaturePatch({
    targetId: value.targetId,
    rOffsetBytes: value.rOffsetBytes,
    sOffsetBytes: value.sOffsetBytes,
    vOffsetBytes: value.vOffsetBytes,
  }, graphBundle);
  if (canonicalizeJson(value) !== canonicalizeJson(expected)) {
    throw new TypeError("fundingSignaturePatch does not match unsigned initializer calldata");
  }
  return expected;
}

function validateFundingSignaturePatchAbi(patch, graphBundle, initializerArtifact) {
  if (initializerArtifact === null
    || typeof initializerArtifact !== "object"
    || initializerArtifact.targetId !== patch.targetId
    || !Array.isArray(initializerArtifact.abi)
    || initializerArtifact.initializer === null
    || typeof initializerArtifact.initializer !== "object"
    || Array.isArray(initializerArtifact.initializer)
    || typeof initializerArtifact.initializer.function !== "string") {
    throw new TypeError(
      "fundingSignaturePatch requires the exact initializer target artifact and function",
    );
  }
  const selector = graphBundle.targets.find(
    ({ targetId }) => targetId === patch.targetId,
  )?.initializerCalldata?.slice(0, 10);
  const candidates = initializerArtifact.abi.filter((entry) => {
    if (entry?.type !== "function") return false;
    try {
      return toFunctionSelector(entry) === selector;
    } catch {
      return false;
    }
  });
  if (candidates.length !== 1) {
    throw new TypeError(
      "fundingSignaturePatch initializer selector must resolve to exactly one artifact ABI entry",
    );
  }
  const selected = candidates[0];
  if (selected.name !== initializerArtifact.initializer.function) {
    throw new TypeError(
      "fundingSignaturePatch initializer selector does not match the configured artifact function",
    );
  }
  const target = graphBundle.targets.find(({ targetId }) => targetId === patch.targetId);
  if (!target) throw new TypeError("fundingSignaturePatch initializer target is absent from graph");
  const calldata = target.initializerCalldata;
  let decoded;
  try {
    decoded = decodeFunctionData({ abi: [selected], data: calldata });
  } catch {
    throw new TypeError(
      "fundingSignaturePatch initializer calldata does not match the exact artifact ABI selector",
    );
  }
  if (decoded.functionName !== selected.name) {
    throw new TypeError("fundingSignaturePatch initializer selector does not match its configured function");
  }
  const decodedArguments = decoded.args ?? [];
  let canonicalCalldata;
  try {
    canonicalCalldata = encodeFunctionData({
      abi: [selected],
      functionName: selected.name,
      args: decodedArguments,
    }).toLowerCase();
  } catch {
    throw new TypeError("fundingSignaturePatch initializer calldata cannot be canonically re-encoded");
  }
  if (canonicalCalldata !== calldata) {
    throw new TypeError(
      "fundingSignaturePatch initializer calldata is not the exact canonical full ABI encoding",
    );
  }
  assertPatchWordAbiType({
    calldata,
    abiEntry: selected,
    decodedArguments,
    offset: patch.rOffsetBytes,
    expectedType: "bytes32",
    replacementWord: Buffer.from("11".repeat(32), "hex"),
    label: "r",
  });
  assertPatchWordAbiType({
    calldata,
    abiEntry: selected,
    decodedArguments,
    offset: patch.sOffsetBytes,
    expectedType: "bytes32",
    replacementWord: Buffer.from("22".repeat(32), "hex"),
    label: "s",
  });
  assertPatchWordAbiType({
    calldata,
    abiEntry: selected,
    decodedArguments,
    offset: patch.vOffsetBytes,
    expectedType: "uint8",
    replacementWord: Buffer.concat([Buffer.alloc(31), Buffer.from([27])]),
    label: "v",
  });
  assertCombinedFundingSignaturePatchAbi({
    calldata,
    abiEntry: selected,
    replacements: [
      [patch.rOffsetBytes, Buffer.from("11".repeat(32), "hex")],
      [patch.sOffsetBytes, Buffer.from("22".repeat(32), "hex")],
      [patch.vOffsetBytes, Buffer.concat([Buffer.alloc(31), Buffer.from([27])])],
    ],
  });
}

function assertPatchWordAbiType({
  calldata,
  abiEntry,
  decodedArguments,
  offset,
  expectedType,
  replacementWord,
  label,
}) {
  const inputs = abiEntry.inputs ?? [];
  const inputIndex = topLevelInputIndexAtOffset(inputs, offset, expectedType);
  if (inputIndex === -1) {
    throw new TypeError(
      `fundingSignaturePatch ${label} offset must identify a top-level ${expectedType} ABI word`,
    );
  }
  const bytes = Buffer.from(calldata.slice(2), "hex");
  replacementWord.copy(bytes, offset);
  const patchedCalldata = `0x${bytes.toString("hex")}`;
  let patched;
  try {
    patched = decodeFunctionData({ abi: [abiEntry], data: patchedCalldata });
  } catch {
    throw new TypeError(
      `fundingSignaturePatch ${label} offset is not a decodable ${expectedType} ABI word`,
    );
  }
  let canonicalPatched;
  try {
    canonicalPatched = encodeFunctionData({
      abi: [abiEntry],
      functionName: abiEntry.name,
      args: patched.args ?? [],
    }).toLowerCase();
  } catch {
    throw new TypeError(
      `fundingSignaturePatch ${label} offset is not a canonical ${expectedType} ABI word`,
    );
  }
  if (canonicalPatched !== patchedCalldata) {
    throw new TypeError(
      `fundingSignaturePatch ${label} offset is not a canonical ${expectedType} ABI word`,
    );
  }
  const patchedArguments = patched.args ?? [];
  if (!Array.isArray(decodedArguments)
    || !Array.isArray(patchedArguments)
    || decodedArguments.length !== inputs.length
    || patchedArguments.length !== inputs.length) {
    throw new TypeError("fundingSignaturePatch decoded initializer arguments are invalid");
  }
  const changedIndices = inputs.flatMap((_, index) =>
    abiValuesDeepEqual(decodedArguments[index], patchedArguments[index]) ? [] : [index]);
  if (changedIndices.length !== 1 || changedIndices[0] !== inputIndex) {
    throw new TypeError(
      `fundingSignaturePatch ${label} offset must identify one top-level ${expectedType} ABI word`,
    );
  }
}

function topLevelInputIndexAtOffset(inputs, offset, expectedType) {
  let cursor = 4;
  for (let index = 0; index < inputs.length; index += 1) {
    const input = inputs[index];
    if (offset === cursor && input.type === expectedType) return index;
    const words = staticAbiWords(input);
    cursor += 32 * (words ?? 1);
  }
  return -1;
}

function staticAbiWords(parameter) {
  const array = /^(.*)\[([0-9]*)\]$/.exec(parameter.type);
  if (array !== null) {
    if (array[2] === "") return null;
    const elementWords = staticAbiWords({ ...parameter, type: array[1] });
    return elementWords === null ? null : elementWords * Number(array[2]);
  }
  if (parameter.type === "tuple") {
    let total = 0;
    for (const component of parameter.components ?? []) {
      const words = staticAbiWords(component);
      if (words === null) return null;
      total += words;
    }
    return total;
  }
  if (parameter.type === "bytes" || parameter.type === "string") return null;
  return 1;
}

function assertCombinedFundingSignaturePatchAbi({ calldata, abiEntry, replacements }) {
  const bytes = Buffer.from(calldata.slice(2), "hex");
  for (const [offset, replacement] of replacements) replacement.copy(bytes, offset);
  const patchedCalldata = `0x${bytes.toString("hex")}`;
  let decoded;
  let reencoded;
  try {
    decoded = decodeFunctionData({ abi: [abiEntry], data: patchedCalldata });
    reencoded = encodeFunctionData({
      abi: [abiEntry],
      functionName: abiEntry.name,
      args: decoded.args ?? [],
    }).toLowerCase();
  } catch {
    throw new TypeError(
      "fundingSignaturePatch combined r/s/v patch is not exact canonical initializer ABI calldata",
    );
  }
  if (reencoded !== patchedCalldata) {
    throw new TypeError(
      "fundingSignaturePatch combined r/s/v patch is not exact canonical initializer ABI calldata",
    );
  }
}

function abiValuesDeepEqual(left, right) {
  if (typeof left === "string" && typeof right === "string") {
    return left.toLowerCase() === right.toLowerCase();
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => abiValuesDeepEqual(value, right[index]));
  }
  if ((left !== null && typeof left === "object")
    || (right !== null && typeof right === "object")) {
    if (left === null || right === null
      || typeof left !== "object" || typeof right !== "object") return false;
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return leftKeys.length === rightKeys.length
      && leftKeys.every((key, index) => key === rightKeys[index]
        && abiValuesDeepEqual(left[key], right[key]));
  }
  return left === right;
}

function canonicalPatchOffset(value, calldata, label) {
  if (!Number.isSafeInteger(value) || value < 4 || (value - 4) % 32 !== 0
    || value + 32 > calldata.byteLength) {
    throw new TypeError(`fundingSignaturePatch ${label} offset is not an in-bounds ABI word`);
  }
  if (calldata.subarray(value, value + 32).some((byte) => byte !== 0)) {
    throw new TypeError(`fundingSignaturePatch ${label} word must be all zero before signing`);
  }
  return value;
}

function validateAuthorizationWindow(value, nowSeconds) {
  const validAfter = BigInt(value.validAfter);
  const validBefore = BigInt(value.validBefore);
  if (validBefore <= validAfter) {
    throw new TypeError("authorization window requires deadline after validAfter");
  }
  if (validBefore - validAfter > 3_600n) {
    throw new TypeError("authorization window must not exceed 3600 seconds");
  }
  if (nowSeconds !== undefined) {
    if (!Number.isSafeInteger(nowSeconds) || nowSeconds < 0) {
      throw new TypeError("authorization window clock is invalid");
    }
    const now = BigInt(nowSeconds);
    if (!(validAfter <= now && now <= validBefore)) {
      throw new TypeError("authorization window requires validAfter <= now <= deadline");
    }
  }
}

function canonicalUint(value, label, allowZero = true) {
  if (typeof value !== "string" || !DECIMAL.test(value) || BigInt(value) >= 1n << 256n
    || (!allowZero && value === "0")) {
    throw new TypeError(`${label} must be a canonical ${allowZero ? "" : "nonzero "}uint256 string`);
  }
  return value;
}

function canonicalUint64(value, label, allowZero = true) {
  const normalized = canonicalUint(value, label, allowZero);
  if (BigInt(normalized) >= 1n << 64n) {
    throw new TypeError(`${label} must fit uint64`);
  }
  return normalized;
}

function canonicalApplicantSelectedFee(value, accountingMode, label) {
  const normalized = canonicalUint(value, label);
  if (BigInt(normalized) > 999_999n) {
    throw new TypeError(`${label} must be between 0 and 999999`);
  }
  if (accountingMode === "additive-platform-share" && BigInt(normalized) > 998_999n) {
    throw new TypeError(`${label} must not exceed 998999 in additive-platform-share mode`);
  }
  return normalized;
}

function canonicalAccountingMode(value) {
  if (!PLATFORM_ACCOUNTING_MODES.includes(value)) {
    throw new TypeError(
      "direct-native launchProfile.accountingMode must be additive-platform-share or inclusive-selected-total",
    );
  }
  return value;
}

function canonicalFundingMode(value) {
  if (!FUNDING_MODES.includes(value)) {
    throw new TypeError(
      `direct-native launchProfile.fundingMode must be none, ${FUNDING_WALLET_TRANSACTION_VALUE_METHOD}, or ${FUNDING_AUTHORIZATION_METHOD}`,
    );
  }
  return value;
}

function canonicalClaimMode(value) {
  if (!CLAIM_MODES.includes(value)) {
    throw new TypeError(
      "direct-native launchProfile.claimMode must be immutable-payout-recipient or claim-authority-selected-recipient",
    );
  }
  return value;
}

function canonicalImmutablePayoutRecipient(value) {
  const payoutRecipient = getAddress(value);
  if (payoutRecipient !== PLATFORM_FEE_CLAIM_AUTHORITY) {
    throw new TypeError(
      "direct-native immutable payout recipient must be the platform claim authority",
    );
  }
  return payoutRecipient;
}

function canonicalPlatformFeeAssessment(assessmentBase, feeCurrency) {
  const pair = PLATFORM_FEE_ASSESSMENT_PAIRS.find((candidate) =>
    candidate.assessmentBase === assessmentBase && candidate.feeCurrency === feeCurrency);
  if (pair === undefined) {
    throw new TypeError(
      "direct-native platform fee assessmentBase and feeCurrency are not a supported closed pair",
    );
  }
  return pair;
}

function canonicalLiquidityModel(value) {
  if (value?.model === "external-concentrated-liquidity") {
    assertExactKeys(value, [
      "schemaVersion",
      "model",
      "declaredLaunchState",
    ], "direct-native launchProfile.liquidityModel");
    if (value.schemaVersion !== DIRECT_NATIVE_LIQUIDITY_MODEL_INTENT_SCHEMA
      || value.declaredLaunchState !== "liquidity_required") {
      throw new TypeError(
        "external concentrated liquidity must declare liquidity_required",
      );
    }
    return {
      schemaVersion: DIRECT_NATIVE_LIQUIDITY_MODEL_INTENT_SCHEMA,
      model: "external-concentrated-liquidity",
      declaredLaunchState: "liquidity_required",
    };
  }
  if (value?.model === "launch-seeded-concentrated-liquidity") {
    assertExactKeys(value, [
      "schemaVersion",
      "model",
      "declaredLaunchState",
      "liquidityTargetId",
      "assessment",
    ], "direct-native launchProfile.liquidityModel");
    if (value.schemaVersion !== DIRECT_NATIVE_LIQUIDITY_MODEL_INTENT_SCHEMA
      || value.declaredLaunchState !== "assessment_required") {
      throw new TypeError(
        "launch-seeded concentrated liquidity must declare assessment_required",
      );
    }
    return {
      schemaVersion: DIRECT_NATIVE_LIQUIDITY_MODEL_INTENT_SCHEMA,
      model: "launch-seeded-concentrated-liquidity",
      declaredLaunchState: "assessment_required",
      liquidityTargetId: canonicalIdentifier(
        value.liquidityTargetId,
        "direct-native launchProfile.liquidityModel.liquidityTargetId",
      ),
      assessment: canonicalLiquidityAssessment(
        value.assessment,
        LAUNCH_SEEDED_CONCENTRATED_LIQUIDITY_VECTORS,
      ),
    };
  }
  if (value?.model === "hook-inventory-custom-accounting") {
    assertExactKeys(value, [
      "schemaVersion",
      "model",
      "declaredLaunchState",
      "inventoryTargetId",
      "assessment",
    ], "direct-native launchProfile.liquidityModel");
    if (value.schemaVersion !== DIRECT_NATIVE_LIQUIDITY_MODEL_INTENT_SCHEMA
      || value.declaredLaunchState !== "assessment_required") {
      throw new TypeError(
        "hook-inventory custom accounting must declare assessment_required",
      );
    }
    return {
      schemaVersion: DIRECT_NATIVE_LIQUIDITY_MODEL_INTENT_SCHEMA,
      model: "hook-inventory-custom-accounting",
      declaredLaunchState: "assessment_required",
      inventoryTargetId: canonicalIdentifier(
        value.inventoryTargetId,
        "direct-native launchProfile.liquidityModel.inventoryTargetId",
      ),
      assessment: canonicalLiquidityAssessment(
        value.assessment,
        HOOK_INVENTORY_CUSTOM_ACCOUNTING_VECTORS,
      ),
    };
  }
  throw new TypeError(
    "direct-native liquidityModel must be external-concentrated-liquidity, launch-seeded-concentrated-liquidity, or hook-inventory-custom-accounting",
  );
}

function canonicalLiquidityAssessment(value, expectedVectors) {
  assertExactKeys(value, [
    "schemaVersion",
    "status",
    "requestClaimsExecution",
    "requiredVectorIds",
  ], "direct-native launchProfile.liquidityModel.assessment");
  if (value.schemaVersion !== DIRECT_NATIVE_LIQUIDITY_MODEL_ASSESSMENT_SCHEMA
    || value.status !== "required"
    || value.requestClaimsExecution !== false
    || !Array.isArray(value.requiredVectorIds)
    || canonicalizeJson(value.requiredVectorIds) !== canonicalizeJson(expectedVectors)) {
    throw new TypeError(
      "direct-native liquidity assessment must declare the exact required vectors without claiming execution",
    );
  }
  return {
    schemaVersion: DIRECT_NATIVE_LIQUIDITY_MODEL_ASSESSMENT_SCHEMA,
    status: "required",
    requestClaimsExecution: false,
    requiredVectorIds: [...expectedVectors],
  };
}

function platformFeePolicy(accountingMode, assessmentBase, feeCurrency) {
  return {
    ...PLATFORM_FEE_POLICY_COMMON,
    accountingMode: canonicalAccountingMode(accountingMode),
    ...canonicalPlatformFeeAssessment(assessmentBase, feeCurrency),
  };
}

function fundingPolicy(mode) {
  if (mode === "none") {
    return {
      mode: "none",
      launchFundingRequired: false,
      signatureRequired: false,
    };
  }
  if (mode === FUNDING_WALLET_TRANSACTION_VALUE_METHOD) {
    return {
      mode: FUNDING_WALLET_TRANSACTION_VALUE_METHOD,
      launchFundingRequired: true,
      signatureRequired: false,
      valueSource: "exact-router-transaction-msg-value",
    };
  }
  return {
    mode: FUNDING_AUTHORIZATION_METHOD,
    launchFundingRequired: true,
    signatureRequired: true,
    primaryType: "ReceiveWithAuthorization",
    typeHash: RECEIVE_WITH_AUTHORIZATION_TYPEHASH,
    domainName: MAINNET_USDC_DOMAIN_NAME,
    domainVersion: MAINNET_USDC_DOMAIN_VERSION,
    maximumValiditySeconds: "3600",
  };
}

function platformFeeClaimBinding(selection) {
  if (selection.claimMode === "immutable-payout-recipient") {
    return {
      mode: "immutable-payout-recipient",
      claimAuthority: PLATFORM_FEE_CLAIM_AUTHORITY,
      payoutRecipient: selection.payoutRecipient,
    };
  }
  return {
    mode: "claim-authority-selected-recipient",
    claimAuthority: PLATFORM_FEE_CLAIM_AUTHORITY,
    destinationConstraint: "nonzero-address",
  };
}

function platformFeeEconomics(applicantSelectedHundredthsOfBip, accountingMode) {
  const selected = BigInt(applicantSelectedHundredthsOfBip);
  const platform = BigInt(PLATFORM_FEE_RATE_PPM);
  if (accountingMode === "additive-platform-share") {
    return {
      applicantSelectedHundredthsOfBip,
      projectHundredthsOfBip: selected.toString(),
      effectiveTotalHundredthsOfBip: (selected + platform).toString(),
    };
  }
  const total = selected > platform ? selected : platform;
  return {
    applicantSelectedHundredthsOfBip,
    projectHundredthsOfBip: (total - platform).toString(),
    effectiveTotalHundredthsOfBip: total.toString(),
  };
}

function validateFundingGraph(fundingMode, graphBundle) {
  const hasNativeValue = graphBundle.targets.some((target) =>
    target.deploymentValueWei !== "0" || target.initializerValueWei !== "0");
  if (fundingMode === FUNDING_WALLET_TRANSACTION_VALUE_METHOD) {
    if (!hasNativeValue) {
      throw new TypeError(
        "direct-native fundingMode wallet-transaction-value requires a nonzero exact Router transaction value",
      );
    }
    return;
  }
  if (hasNativeValue) {
    throw new TypeError(
      fundingMode === "none"
        ? "direct-native fundingMode none requires zero deployment and initializer value for every target"
        : "direct-native EIP-3009 funding requires zero native deployment and initializer value for every target",
    );
  }
}

function validateLiquidityModelGraph(liquidityModel, roles, byId) {
  if (liquidityModel.model === "external-concentrated-liquidity") return;
  if (liquidityModel.model === "launch-seeded-concentrated-liquidity") {
    requireTarget(byId, liquidityModel.liquidityTargetId, "liquidity seed");
    return;
  }
  const inventory = requireTarget(byId, liquidityModel.inventoryTargetId, "hook inventory");
  if (liquidityModel.inventoryTargetId !== roles.hookTargetId
    || inventory.componentKind !== "hook"
    || !Array.isArray(inventory.declaredHookPermissions)
    || (!inventory.declaredHookPermissions.includes("beforeSwapReturnDelta")
      && !inventory.declaredHookPermissions.includes("afterSwapReturnDelta"))) {
    throw new TypeError(
      "hook-inventory custom accounting must bind the graph hook and declare a swap return-delta permission",
    );
  }
}

function sha256ToHex32(value, label) {
  if (typeof value !== "string" || !SHA256.test(value)) {
    throw new TypeError(`${label} must be a sha256 digest`);
  }
  return `0x${value.slice("sha256:".length)}`;
}

export const DIRECT_NATIVE_PROFILE_PUBLIC_CONSTANTS = Object.freeze({
  minimumPermissionMask: 0,
  maximumPermissionMask: 16_383,
  platformAccountingModes: PLATFORM_ACCOUNTING_MODES,
  platformFeeAssessmentPairs: PLATFORM_FEE_ASSESSMENT_PAIRS,
  platformFeeProofPolicy: PLATFORM_FEE_PROOF_POLICY,
});

for (const digest of [MAINNET_USDC_DOMAIN_SEPARATOR, RECEIVE_WITH_AUTHORIZATION_TYPEHASH]) {
  if (!HEX32.test(digest)) throw new TypeError("direct-native funding digest is invalid");
}
