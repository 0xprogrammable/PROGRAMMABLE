export const FEE_POLICY_V2_SCHEMA_ID = "urn:programmable:fee-policy-v2:1.0.0";
export const FEE_POLICY_V2_SCHEMA_VERSION = "1.0.0";
export const FEE_POLICY_V2_ID = "programmable-volume-fee-v2";
export const FEE_POLICY_V2_VERSION = "2.0.0";
export const FEE_POLICY_V2_HASH_PREIMAGE = "programmable-volume-fee-v2@2.0.0";
export const FEE_POLICY_V2_HASH = "0x03cd386824b1c0aa152200e0a470aa0c885f802e257f0f46066de508d241811e";
export const PROGRAMMABLE_FEE_V2_OWNER = "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c";
export const FEE_RATE_DENOMINATOR_V2 = 1_000_000n;
export const PROGRAMMABLE_RATE_V2 = 1_000n;
export const MAX_USER_FUNDED_TOTAL_RATE_V2 = FEE_RATE_DENOMINATOR_V2 - 1n;
export const UINT256_MAX_V2 = (1n << 256n) - 1n;

export const COLLECTION_PROFILES_V2 = Object.freeze([
  "standard-amm",
  "sync-custom-zero-amm",
  "async-fill-batch",
  "custom-reviewed"
]);

export const EXECUTED_VOLUME_EVENTS_V2 = Object.freeze([
  "executed-swap",
  "executed-fill"
]);

export const NON_VOLUME_EVENTS_V2 = Object.freeze([
  "order-deposit",
  "unfilled",
  "canceled",
  "refunded"
]);

const EXECUTED_EVENT_SET = new Set(EXECUTED_VOLUME_EVENTS_V2);
const NON_VOLUME_EVENT_SET = new Set(NON_VOLUME_EVENTS_V2);
const COLLECTION_PROFILE_SET = new Set(COLLECTION_PROFILES_V2);
export const CANONICAL_POSITIVE_UINT256_DECIMAL_PATTERN_V2 = /^[1-9][0-9]{0,77}$/u;

export function isCanonicalPositiveUint256DecimalV2(value) {
  return typeof value === "string"
    && CANONICAL_POSITIVE_UINT256_DECIMAL_PATTERN_V2.test(value)
    && BigInt(value) <= UINT256_MAX_V2;
}

export function isCollectionProfileV2(value) {
  return COLLECTION_PROFILE_SET.has(value);
}

export function isExecutedVolumeEventV2(value) {
  return EXECUTED_EVENT_SET.has(value);
}

export function isNonVolumeEventV2(value) {
  return NON_VOLUME_EVENT_SET.has(value);
}

export function createFeePolicyV2({ feeScopes }) {
  if (!Array.isArray(feeScopes)) throw new TypeError("feeScopes must be an array");
  return {
    $schema: FEE_POLICY_V2_SCHEMA_ID,
    schemaVersion: FEE_POLICY_V2_SCHEMA_VERSION,
    policyId: FEE_POLICY_V2_ID,
    policyVersion: FEE_POLICY_V2_VERSION,
    policyHashPreimage: FEE_POLICY_V2_HASH_PREIMAGE,
    policyHash: FEE_POLICY_V2_HASH,
    platform: {
      owner: PROGRAMMABLE_FEE_V2_OWNER,
      immutable: true,
      rateUnit: "hundredths-of-bip",
      rate: Number(PROGRAMMABLE_RATE_V2),
      claimAuthority: "owner-only",
      claimAvailability: "anytime-from-funded-liability"
    },
    basis: {
      metric: "executed-gross-quote-volume",
      excludedEvents: [...NON_VOLUME_EVENTS_V2],
      partialFillRule: "each-executed-fill-counted-once"
    },
    economics: {
      formula: "effective=max(selectedTotalAtExecution,1000);platform=1000;project=effective-1000",
      maximumUserFundedTotalRateExclusive: Number(FEE_RATE_DENOMINATOR_V2),
      externallyFundedRateRule: "uint256-rate-custom-reviewed-segregated-funding-only",
      exactOutputRule: "verified-gross-witness"
    },
    accounting: {
      rounding: "cumulative-independent-platform-project-remainders",
      remainderScope: "chain-pool-quote-currency-lifetime",
      fragmentationResistantPlatformFee: true,
      claimResetsRemainders: false,
      claimableOnlyWhenFullyFunded: true,
      crossScopeNetting: false
    },
    collectionProfiles: [...COLLECTION_PROFILES_V2],
    feeScopes
  };
}

export function validateFeePolicyV2(policy) {
  const errors = [];
  const add = (path, message) => errors.push(`${path}: ${message}`);
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
    return ["$: policy must be an object"];
  }

  requireExactKeys(policy, "$", [
    "$schema",
    "schemaVersion",
    "policyId",
    "policyVersion",
    "policyHashPreimage",
    "policyHash",
    "platform",
    "basis",
    "economics",
    "accounting",
    "collectionProfiles",
    "feeScopes"
  ], add);
  for (const [path, actual, expected] of [
    ["$.$schema", policy.$schema, FEE_POLICY_V2_SCHEMA_ID],
    ["$.schemaVersion", policy.schemaVersion, FEE_POLICY_V2_SCHEMA_VERSION],
    ["$.policyId", policy.policyId, FEE_POLICY_V2_ID],
    ["$.policyVersion", policy.policyVersion, FEE_POLICY_V2_VERSION],
    ["$.policyHashPreimage", policy.policyHashPreimage, FEE_POLICY_V2_HASH_PREIMAGE],
    ["$.policyHash", policy.policyHash, FEE_POLICY_V2_HASH]
  ]) {
    if (actual !== expected) add(path, `must equal ${String(expected)}`);
  }

  if (requireExactKeys(policy.platform, "$.platform", [
    "owner",
    "immutable",
    "rateUnit",
    "rate",
    "claimAuthority",
    "claimAvailability"
  ], add)) {
    for (const [path, actual, expected] of [
      ["$.platform.owner", policy.platform.owner, PROGRAMMABLE_FEE_V2_OWNER],
      ["$.platform.immutable", policy.platform.immutable, true],
      ["$.platform.rateUnit", policy.platform.rateUnit, "hundredths-of-bip"],
      ["$.platform.rate", policy.platform.rate, Number(PROGRAMMABLE_RATE_V2)],
      ["$.platform.claimAuthority", policy.platform.claimAuthority, "owner-only"],
      ["$.platform.claimAvailability", policy.platform.claimAvailability, "anytime-from-funded-liability"]
    ]) {
      if (actual !== expected) add(path, `must equal ${String(expected)}`);
    }
  }

  if (requireExactKeys(policy.basis, "$.basis", ["metric", "excludedEvents", "partialFillRule"], add)) {
    if (policy.basis.metric !== "executed-gross-quote-volume") {
      add("$.basis.metric", "must equal executed-gross-quote-volume");
    }
    if (JSON.stringify(policy.basis.excludedEvents) !== JSON.stringify(NON_VOLUME_EVENTS_V2)) {
      add("$.basis.excludedEvents", `must equal ${NON_VOLUME_EVENTS_V2.join(",")}`);
    }
    if (policy.basis.partialFillRule !== "each-executed-fill-counted-once") {
      add("$.basis.partialFillRule", "must equal each-executed-fill-counted-once");
    }
  }

  if (requireExactKeys(policy.economics, "$.economics", [
    "formula",
    "maximumUserFundedTotalRateExclusive",
    "externallyFundedRateRule",
    "exactOutputRule"
  ], add)) {
    for (const [path, actual, expected] of [
      [
        "$.economics.formula",
        policy.economics.formula,
        "effective=max(selectedTotalAtExecution,1000);platform=1000;project=effective-1000"
      ],
      [
        "$.economics.maximumUserFundedTotalRateExclusive",
        policy.economics.maximumUserFundedTotalRateExclusive,
        Number(FEE_RATE_DENOMINATOR_V2)
      ],
      [
        "$.economics.externallyFundedRateRule",
        policy.economics.externallyFundedRateRule,
        "uint256-rate-custom-reviewed-segregated-funding-only"
      ],
      ["$.economics.exactOutputRule", policy.economics.exactOutputRule, "verified-gross-witness"]
    ]) {
      if (actual !== expected) add(path, `must equal ${String(expected)}`);
    }
  }

  if (requireExactKeys(policy.accounting, "$.accounting", [
    "rounding",
    "remainderScope",
    "fragmentationResistantPlatformFee",
    "claimResetsRemainders",
    "claimableOnlyWhenFullyFunded",
    "crossScopeNetting"
  ], add)) {
    for (const [path, actual, expected] of [
      [
        "$.accounting.rounding",
        policy.accounting.rounding,
        "cumulative-independent-platform-project-remainders"
      ],
      ["$.accounting.remainderScope", policy.accounting.remainderScope, "chain-pool-quote-currency-lifetime"],
      ["$.accounting.fragmentationResistantPlatformFee", policy.accounting.fragmentationResistantPlatformFee, true],
      ["$.accounting.claimResetsRemainders", policy.accounting.claimResetsRemainders, false],
      ["$.accounting.claimableOnlyWhenFullyFunded", policy.accounting.claimableOnlyWhenFullyFunded, true],
      ["$.accounting.crossScopeNetting", policy.accounting.crossScopeNetting, false]
    ]) {
      if (actual !== expected) add(path, `must equal ${String(expected)}`);
    }
  }

  if (JSON.stringify(policy.collectionProfiles) !== JSON.stringify(COLLECTION_PROFILES_V2)) {
    add("$.collectionProfiles", "must enumerate the four canonical collection profiles in policy order");
  }
  if (!Array.isArray(policy.feeScopes) || policy.feeScopes.length === 0) {
    add("$.feeScopes", "must contain at least one fee scope");
  } else {
    const ids = new Set();
    const scopeKeys = new Set();
    for (const [index, scope] of policy.feeScopes.entries()) {
      const base = `$.feeScopes[${index}]`;
      if (!scope || typeof scope !== "object" || Array.isArray(scope)) {
        add(base, "must be an object");
        continue;
      }
      requireExactKeys(scope, base, ["id", "chainId", "poolId", "quoteCurrency", "collectionProfile"], add);
      if (
        typeof scope.id !== "string"
        || scope.id.length > 100
        || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(scope.id)
      ) {
        add(`${base}.id`, "must be a lowercase kebab-case string of at most 100 characters");
      } else if (ids.has(scope.id)) add(`${base}.id`, "must be unique");
      else ids.add(scope.id);
      if (!isCanonicalPositiveUint256DecimalV2(scope.chainId)) {
        add(`${base}.chainId`, "must be a canonical positive uint256 decimal string");
      }
      if (!COLLECTION_PROFILE_SET.has(scope.collectionProfile)) add(`${base}.collectionProfile`, "is not a canonical v2 profile");
      if (typeof scope.quoteCurrency !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(scope.quoteCurrency)) {
        add(`${base}.quoteCurrency`, "must be an EVM address string; zero address represents native currency");
      }
      if (typeof scope.poolId !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(scope.poolId)) {
        add(`${base}.poolId`, "must be bytes32");
      } else if (
        isCanonicalPositiveUint256DecimalV2(scope.chainId)
        && typeof scope.quoteCurrency === "string"
        && /^0x[0-9a-fA-F]{40}$/.test(scope.quoteCurrency)
      ) {
        const scopeKey = `${scope.chainId}:${scope.poolId.toLowerCase()}:${scope.quoteCurrency.toLowerCase()}`;
        if (scopeKeys.has(scopeKey)) {
          add(base, "chainId + poolId + quoteCurrency must be globally unique");
        } else {
          scopeKeys.add(scopeKey);
        }
      }
    }
  }
  return [...new Set(errors)].sort();
}

function requireExactKeys(value, path, expectedKeys, add) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    add(path, "must be an object");
    return false;
  }
  const expected = new Set(expectedKeys);
  for (const key of expectedKeys) {
    if (!Object.hasOwn(value, key)) add(`${path}.${key}`, "is required");
  }
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) add(`${path}.${key}`, "is not allowed");
  }
  return true;
}
