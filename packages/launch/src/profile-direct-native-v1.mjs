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

import { canonicalizeJson, parseStrictJson } from "./canonical-json.mjs";
import { canonicalIdentifier } from "./build.mjs";
import {
  DIRECT_NATIVE_LAUNCH_INTENT_HASH_DOMAIN,
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
  FUNDING_SIGNATURE_PATCH_SCHEMA,
  FUNDING_INTENT_HASH_DOMAIN,
  FUNDING_NONCE_DOMAIN,
  GRAPH_FACTORY,
  GRAPH_FACTORY_RUNTIME_CODE_HASH,
  HOOK_PERMISSION_BITS,
  MAINNET_CHAIN_ID,
  MAINNET_USDC,
  MAINNET_USDC_RUNTIME_CODE_HASH,
  MAINNET_USDC_DOMAIN_NAME,
  MAINNET_USDC_DOMAIN_SEPARATOR,
  MAINNET_USDC_DOMAIN_VERSION,
  PLATFORM_FEE_DENOMINATOR,
  PLATFORM_FEE_RATE_PPM,
  PLATFORM_FEE_RECIPIENT,
  POOL_MANAGER,
  POOL_MANAGER_RUNTIME_CODE_HASH,
  PERMIT_AUTHORITY,
  PERMIT_AUTHORITY_RUNTIME_CODE_HASH,
  RECEIVE_WITH_AUTHORIZATION_TYPEHASH,
  ROUTER,
  ROUTER_RUNTIME_CODE_HASH,
} from "./constants.mjs";
import { assertExactKeys, sha256Digest } from "./io.mjs";

const HEX4 = /^0x[0-9a-f]{8}$/;
const HEX32 = /^0x[0-9a-f]{64}$/;
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/;
const REQUIRED_PERMISSION_MASK = 0x20cc;
const REQUIRED_PERMISSIONS = Object.freeze([
  "beforeInitialize",
  "beforeSwap",
  "afterSwap",
  "beforeSwapReturnDelta",
  "afterSwapReturnDelta",
]);
const REQUIRED_HOOK_SOURCE_PATH = "src/ProgrammableVolumeFeeHookV2.sol";
const REQUIRED_FACTORY_SOURCE_PATH = "src/ProgrammableVolumeFeeHookFactoryV2.sol";
const REQUIRED_HOOK_SOURCE_SHA256 =
  "sha256:41294f0701d3911b740a0cea160b936cb0eea4bdf2a664e7c6674a1c1e1b519d";
const REQUIRED_FACTORY_SOURCE_SHA256 =
  "sha256:aa2673f4635543b5c24b140030461fe3161138d2d02d24c1c8c1830c13d60145";
const REQUIRED_DEPENDENCY_LOCK_SHA256 =
  "sha256:e73b8f213af284c54550e7bdf5416e9bf1f17774b4f6e23d3bb8f6a150ede759";
const REQUIRED_COMPILER_VERSION = "0.8.26+commit.8a97fa7a";
const PLATFORM_READBACK_SELECTORS = Object.freeze({
  programmableHundredthsOfBip: "0x8a9585e4",
  programmableFeeOwner: "0x21466b6a",
  programmableFeePolicyHash: "0x677d6592",
  runtimeConfigurationHash: "0xca7751ad",
});

export function validateDirectNativeProfileSelection(value) {
  assertExactKeys(value, [
    "schemaVersion",
    "profileId",
    "profileRevision",
    "targetRoles",
    "selectedBuyHundredthsOfBip",
    "selectedSellHundredthsOfBip",
  ], "direct-native launchProfile");
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
  if (targetRoles.platformFeeBindingTargetId !== targetRoles.hookTargetId) {
    throw new TypeError("direct-native platform fee binding target must be the selected hook target");
  }
  if (new Set([
    targetRoles.tokenTargetId,
    targetRoles.hookTargetId,
    targetRoles.initializerTargetId,
  ]).size !== 3) {
    throw new TypeError("direct-native token, hook, and initializer target roles must be distinct");
  }
  return {
    schemaVersion: DIRECT_NATIVE_PROFILE_SELECTION_SCHEMA,
    profileId: DIRECT_NATIVE_PROFILE_ID,
    profileRevision: DIRECT_NATIVE_PROFILE_REVISION,
    targetRoles,
    selectedBuyHundredthsOfBip: canonicalSelectedFee(
      value.selectedBuyHundredthsOfBip,
      "direct-native launchProfile.selectedBuyHundredthsOfBip",
    ),
    selectedSellHundredthsOfBip: canonicalSelectedFee(
      value.selectedSellHundredthsOfBip,
      "direct-native launchProfile.selectedSellHundredthsOfBip",
    ),
  };
}

export function resolveDirectNativeProfile(selection, feeEnforcement) {
  validateDirectNativeProfileSelection(selection);
  const normalizedFeeEnforcement = validateFeeEnforcement(feeEnforcement);
  return {
    schemaVersion: DIRECT_NATIVE_PROFILE_SCHEMA,
    profileId: DIRECT_NATIVE_PROFILE_ID,
    profileRevision: DIRECT_NATIVE_PROFILE_REVISION,
    profileVersion: DIRECT_NATIVE_PROFILE_VERSION,
    productionLaunchAuthorized: false,
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
    feeEnforcement: normalizedFeeEnforcement,
    fundingPolicy: {
      method: FUNDING_AUTHORIZATION_METHOD,
      primaryType: "ReceiveWithAuthorization",
      typeHash: RECEIVE_WITH_AUTHORIZATION_TYPEHASH,
      domainName: MAINNET_USDC_DOMAIN_NAME,
      domainVersion: MAINNET_USDC_DOMAIN_VERSION,
      maximumValiditySeconds: "3600",
    },
    platformFee: {
      accountingMode: "inclusive-selected-total",
      rateDenominator: PLATFORM_FEE_DENOMINATOR,
      programmableFeeHundredthsOfBip: PLATFORM_FEE_RATE_PPM,
      minimumEffectiveSelectedHundredthsOfBip: PLATFORM_FEE_RATE_PPM,
      recipient: PLATFORM_FEE_RECIPIENT,
      readbackSelectors: PLATFORM_READBACK_SELECTORS,
    },
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
    selectedBuyHundredthsOfBip: "1000",
    selectedSellHundredthsOfBip: "1000",
  }, value?.feeEnforcement);
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
    routeNamespace: context.routeNamespace,
    routeNonce: context.routeNonce,
    hookPermissionMask,
    predictedInitializer,
    poolKey,
    expectedPoolId: poolId(poolKey),
    fundingSignaturePatch: validateFundingSignaturePatch(
      context.fundingSignaturePatch,
      targetRoles.initializerTargetId,
      context.graphBundle,
    ),
    platformFeeBinding: {
      targetId: targetRoles.platformFeeBindingTargetId,
      accountingMode: "inclusive-selected-total",
      rateDenominator: PLATFORM_FEE_DENOMINATOR,
      programmableFeeHundredthsOfBip: PLATFORM_FEE_RATE_PPM,
      minimumEffectiveSelectedHundredthsOfBip: PLATFORM_FEE_RATE_PPM,
      selectedBuyHundredthsOfBip: normalized.selectedBuyHundredthsOfBip,
      selectedSellHundredthsOfBip: normalized.selectedSellHundredthsOfBip,
      recipient: PLATFORM_FEE_RECIPIENT,
      readbackSelectors: PLATFORM_READBACK_SELECTORS,
    },
  };
}

export function validateDirectNativeProfileBinding(value, context) {
  const expected = buildDirectNativeProfileBinding({
    schemaVersion: DIRECT_NATIVE_PROFILE_SELECTION_SCHEMA,
    profileId: DIRECT_NATIVE_PROFILE_ID,
    profileRevision: DIRECT_NATIVE_PROFILE_REVISION,
    targetRoles: value?.targetRoles,
    selectedBuyHundredthsOfBip: value?.platformFeeBinding?.selectedBuyHundredthsOfBip,
    selectedSellHundredthsOfBip: value?.platformFeeBinding?.selectedSellHundredthsOfBip,
  }, context);
  if (canonicalizeJson(value) !== canonicalizeJson(expected)) {
    throw new TypeError("direct-native launchProfileSelection does not match the graph and route");
  }
  return expected;
}

export function validateDirectNativeProfileGraph(profile, binding, graphBundle) {
  validateEmbeddedDirectNativeProfile(profile);
  if (!Array.isArray(graphBundle.targets)
    || graphBundle.targets.length < 3
    || graphBundle.targets.length > 16) {
    throw new TypeError("direct-native graph must contain between 3 and 16 direct targets");
  }
  if (!Number.isSafeInteger(graphBundle.pool?.fee)
    || graphBundle.pool.fee < 0
    || graphBundle.pool.fee > 999_999) {
    throw new TypeError("direct-native pool fee must be between 0 and 999999");
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
  if (binding.hookPermissionMask !== REQUIRED_PERMISSION_MASK
    || permissionMask(hook.declaredHookPermissions) !== REQUIRED_PERMISSION_MASK
    || canonicalizeJson(hook.declaredHookPermissions) !== canonicalizeJson(REQUIRED_PERMISSIONS)) {
    throw new TypeError("direct-native reference kernel requires exact hook permission mask 0x20cc");
  }
  if (roles.platformFeeBindingTargetId !== roles.hookTargetId
    || binding.platformFeeBinding.targetId !== roles.hookTargetId) {
    throw new TypeError("direct-native platform fee readback must bind the selected hook target");
  }
  return binding;
}

export function buildDirectNativeFeeEnforcement(
  binding,
  graphBundle,
  verificationBundle,
  sourceManifest,
) {
  const component = verificationBundle.components.find(
    ({ targetId }) => targetId === binding.targetRoles.hookTargetId,
  );
  if (!component
    || component.contractName !== "ProgrammableVolumeFeeHookV2"
    || component.sourcePath !== REQUIRED_HOOK_SOURCE_PATH) {
    throw new TypeError("PROFILE_BUILD_MISMATCH: selected hook is not ProgrammableVolumeFeeHookV2");
  }
  const unit = verificationBundle.compilationUnits.find(
    ({ compilationUnitId }) => compilationUnitId === component.compilationUnitId,
  );
  if (!unit || unit.compilerVersion !== REQUIRED_COMPILER_VERSION) {
    throw new TypeError("PROFILE_BUILD_MISMATCH: selected hook compiler build differs");
  }
  const bytes = Buffer.from(unit.standardJsonInputBase64, "base64");
  const input = parseStrictJson(bytes.toString("utf8"), { maximumBytes: bytes.byteLength });
  const settings = input.settings ?? {};
  if (settings.evmVersion !== "cancun"
    || settings.optimizer?.enabled !== true
    || settings.optimizer?.runs !== 200
    || settings.viaIR !== true
    || settings.metadata?.bytecodeHash !== "none"
    || settings.metadata?.appendCBOR !== false) {
    throw new TypeError("PROFILE_BUILD_MISMATCH: selected hook compiler settings differ");
  }
  assertSourceContentHash(
    input.sources?.[REQUIRED_HOOK_SOURCE_PATH]?.content,
    REQUIRED_HOOK_SOURCE_SHA256,
    "reference hook source",
  );
  assertSourceContentHash(
    input.sources?.[REQUIRED_FACTORY_SOURCE_PATH]?.content,
    REQUIRED_FACTORY_SOURCE_SHA256,
    "reference factory source",
  );
  requireManifestDigest(sourceManifest, REQUIRED_HOOK_SOURCE_SHA256, "reference hook source");
  requireManifestDigest(sourceManifest, REQUIRED_FACTORY_SOURCE_SHA256, "reference factory source");
  requireManifestDigestAtPath(
    sourceManifest,
    "package-lock.json",
    REQUIRED_DEPENDENCY_LOCK_SHA256,
    "reference dependency lock",
  );
  const graphTarget = graphBundle.targets.find(
    ({ targetId }) => targetId === binding.targetRoles.hookTargetId,
  );
  const materialization = component.runtimeMaterialization;
  if (!graphTarget || !materialization
    || materialization.deployedRuntimeCodeHash !== graphTarget.expectedRuntimeCodeHash) {
    throw new TypeError("PROFILE_BUILD_MISMATCH: selected hook runtime is not exactly materialized");
  }
  const creationBytes = Buffer.from(graphTarget.creationBytecode.slice(2), "hex");
  const runtimeTemplate = runtimeTemplateBytes(materialization);
  return {
    mode: "canonical-volume-fee-v2",
    requiredHookPermissionMask: REQUIRED_PERMISSION_MASK,
    hookSourcePath: REQUIRED_HOOK_SOURCE_PATH,
    hookSourceSha256: REQUIRED_HOOK_SOURCE_SHA256,
    factorySourcePath: REQUIRED_FACTORY_SOURCE_PATH,
    factorySourceSha256: REQUIRED_FACTORY_SOURCE_SHA256,
    dependencyLockSha256: REQUIRED_DEPENDENCY_LOCK_SHA256,
    compilerVersion: REQUIRED_COMPILER_VERSION,
    compilerSettingsSha256: sha256Digest(
      Buffer.from(canonicalizeJson(settings), "utf8"),
    ),
    hookCreationBytecodeSha256: sha256Digest(creationBytes),
    hookRuntimeTemplateSha256: sha256Digest(runtimeTemplate),
    hookRuntimeCodeHash: materialization.deployedRuntimeCodeHash,
  };
}

export function validateDirectNativeProfileBuilds(
  profile,
  binding,
  graphBundle,
  verificationBundle,
  sourceManifest,
) {
  const expected = buildDirectNativeFeeEnforcement(
    binding,
    graphBundle,
    verificationBundle,
    sourceManifest,
  );
  if (canonicalizeJson(profile.feeEnforcement) !== canonicalizeJson(expected)) {
    throw new TypeError("PROFILE_BUILD_MISMATCH: embedded fee enforcement differs from exact build");
  }
  return expected;
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

function validateAuthorizationWindow(value, nowSeconds = Math.floor(Date.now() / 1_000)) {
  if (!Number.isSafeInteger(nowSeconds) || nowSeconds < 0) {
    throw new TypeError("funding authorization clock is invalid");
  }
  const now = BigInt(nowSeconds);
  const validAfter = BigInt(value.validAfter);
  const validBefore = BigInt(value.validBefore);
  if (!(validAfter < now && now < validBefore)) {
    throw new TypeError("fundingAuthorization requires validAfter < now < validBefore");
  }
  if (validBefore - validAfter > 3_600n) {
    throw new TypeError("fundingAuthorization validity window must not exceed 3600 seconds");
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

function canonicalSelectedFee(value, label) {
  const normalized = canonicalUint(value, label);
  if (BigInt(normalized) > 999_999n) {
    throw new TypeError(`${label} must be between 0 and 999999`);
  }
  return normalized;
}

function assertSourceContentHash(content, expected, label) {
  if (typeof content !== "string"
    || sha256Digest(Buffer.from(content, "utf8")) !== expected) {
    throw new TypeError(`PROFILE_BUILD_MISMATCH: ${label} differs`);
  }
}

function runtimeTemplateBytes(materialization) {
  const runtime = Buffer.from(materialization.deployedRuntimeCodeBase64, "base64");
  const occupied = [];
  for (const reference of materialization.immutableReferences) {
    for (const range of reference.ranges) {
      if (!Number.isSafeInteger(range.start) || range.length !== 32
        || range.start < 0 || range.start + range.length > runtime.byteLength) {
        throw new TypeError("PROFILE_BUILD_MISMATCH: hook immutable range is invalid");
      }
      occupied.push({ start: range.start, end: range.start + range.length });
    }
  }
  occupied.sort((left, right) => left.start - right.start);
  for (let index = 1; index < occupied.length; index += 1) {
    if (occupied[index].start < occupied[index - 1].end) {
      throw new TypeError("PROFILE_BUILD_MISMATCH: hook immutable ranges overlap");
    }
  }
  const template = Buffer.from(runtime);
  for (const range of occupied) template.fill(0, range.start, range.end);
  return template;
}

function validateFeeEnforcement(value) {
  assertExactKeys(value, [
    "mode",
    "requiredHookPermissionMask",
    "hookSourcePath",
    "hookSourceSha256",
    "factorySourcePath",
    "factorySourceSha256",
    "dependencyLockSha256",
    "compilerVersion",
    "compilerSettingsSha256",
    "hookCreationBytecodeSha256",
    "hookRuntimeTemplateSha256",
    "hookRuntimeCodeHash",
  ], "direct-native feeEnforcement");
  if (value.mode !== "canonical-volume-fee-v2"
    || value.requiredHookPermissionMask !== REQUIRED_PERMISSION_MASK
    || value.hookSourcePath !== REQUIRED_HOOK_SOURCE_PATH
    || value.hookSourceSha256 !== REQUIRED_HOOK_SOURCE_SHA256
    || value.factorySourcePath !== REQUIRED_FACTORY_SOURCE_PATH
    || value.factorySourceSha256 !== REQUIRED_FACTORY_SOURCE_SHA256
    || value.dependencyLockSha256 !== REQUIRED_DEPENDENCY_LOCK_SHA256
    || value.compilerVersion !== REQUIRED_COMPILER_VERSION) {
    throw new TypeError("direct-native feeEnforcement is not the canonical VolumeFeeHookV2 build");
  }
  for (const [label, digest] of [
    ["compilerSettingsSha256", value.compilerSettingsSha256],
    ["hookCreationBytecodeSha256", value.hookCreationBytecodeSha256],
    ["hookRuntimeTemplateSha256", value.hookRuntimeTemplateSha256],
  ]) {
    if (typeof digest !== "string" || !SHA256.test(digest)) {
      throw new TypeError(`direct-native feeEnforcement.${label} is invalid`);
    }
  }
  if (typeof value.hookRuntimeCodeHash !== "string"
    || !/^0x(?!0{64}$)[0-9a-f]{64}$/.test(value.hookRuntimeCodeHash)) {
    throw new TypeError("direct-native feeEnforcement.hookRuntimeCodeHash is invalid");
  }
  return value;
}

function sha256ToHex32(value, label) {
  if (typeof value !== "string" || !SHA256.test(value)) {
    throw new TypeError(`${label} must be a sha256 digest`);
  }
  return `0x${value.slice("sha256:".length)}`;
}

function requireManifestDigest(manifest, digest, label) {
  if (!Array.isArray(manifest?.entries)
    || !manifest.entries.some((entry) => entry.kind === "file" && entry.contentSha256 === digest)) {
    throw new TypeError(`PROFILE_BUILD_MISMATCH: ${label} is absent from source manifest`);
  }
}

function requireManifestDigestAtPath(manifest, path, digest, label) {
  if (!Array.isArray(manifest?.entries)
    || !manifest.entries.some((entry) => entry.kind === "file"
      && entry.path === path && entry.contentSha256 === digest)) {
    throw new TypeError(`PROFILE_BUILD_MISMATCH: ${label} is absent from source manifest`);
  }
}

export const DIRECT_NATIVE_PROFILE_PUBLIC_CONSTANTS = Object.freeze({
  requiredPermissionMask: REQUIRED_PERMISSION_MASK,
  requiredPermissions: REQUIRED_PERMISSIONS,
  requiredHookSourceSha256: REQUIRED_HOOK_SOURCE_SHA256,
  requiredFactorySourceSha256: REQUIRED_FACTORY_SOURCE_SHA256,
  requiredDependencyLockSha256: REQUIRED_DEPENDENCY_LOCK_SHA256,
  platformReadbackSelectors: PLATFORM_READBACK_SELECTORS,
});

// Keep the schema's fixed selector and digest literals honest at module load.
for (const selector of Object.values(PLATFORM_READBACK_SELECTORS)) {
  if (!HEX4.test(selector)) throw new TypeError("direct-native readback selector is invalid");
}
for (const digest of [MAINNET_USDC_DOMAIN_SEPARATOR, RECEIVE_WITH_AUTHORIZATION_TYPEHASH]) {
  if (!HEX32.test(digest)) throw new TypeError("direct-native funding digest is invalid");
}
for (const digest of [
  REQUIRED_HOOK_SOURCE_SHA256,
  REQUIRED_FACTORY_SOURCE_SHA256,
  REQUIRED_DEPENDENCY_LOCK_SHA256,
]) {
  if (!SHA256.test(digest)) throw new TypeError("direct-native source digest is invalid");
}
if (new Set(REQUIRED_PERMISSIONS).size !== REQUIRED_PERMISSIONS.length) {
  throw new TypeError("direct-native hook permission set is invalid");
}
