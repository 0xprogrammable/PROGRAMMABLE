import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  COLLECTION_PROFILES_V2,
  FEE_POLICY_V2_HASH,
  FEE_POLICY_V2_ID,
  FEE_POLICY_V2_VERSION,
  FEE_RATE_DENOMINATOR_V2,
  PROGRAMMABLE_FEE_V2_OWNER,
  PROGRAMMABLE_RATE_V2,
  UINT256_MAX_V2,
  aggregateExecutedGrossV2,
  applyFundedFeeSplitV2,
  assessFeeFundingV2,
  createFeePolicyV2,
  effectiveTotalRateV2,
  emptyFeeStateV2,
  effectiveExternallyFundedTotalRateV2,
  executeFundedVolumeV2,
  executeExternallyFundedVolumeV2,
  feeScopeKeyV2,
  findExactOutputWitnessV2,
  isCanonicalPositiveUint256DecimalV2,
  previewFeeSplitV2,
  previewExternallyFundedFeeSplitV2,
  validateFeePolicyV2,
  verifyExactOutputWitnessV2
} from "../fee-policy-v2-core.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(testDirectory, "../..");

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

test("v2 fixes only the platform share and removes the artificial 10 percent ceiling", () => {
  assert.equal(FEE_POLICY_V2_ID, "programmable-volume-fee-v2");
  assert.equal(FEE_POLICY_V2_VERSION, "2.0.0");
  assert.equal(FEE_POLICY_V2_HASH, "0x03cd386824b1c0aa152200e0a470aa0c885f802e257f0f46066de508d241811e");
  assert.equal(PROGRAMMABLE_FEE_V2_OWNER, "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c");
  assert.equal(effectiveTotalRateV2(0n), PROGRAMMABLE_RATE_V2);
  assert.equal(effectiveTotalRateV2(500_000n), 500_000n);

  const high = previewFeeSplitV2({
    grossQuoteAmount: 1_000_000n,
    selectedTotalRate: 999_999n
  });
  assert.equal(high.platformFee, 1_000n);
  assert.equal(high.projectFee, 998_999n);
  assert.equal(high.totalFee, 999_999n);
  assert.equal(high.netQuoteAmount, 1n);
  assert.throws(
    () => previewFeeSplitV2({ grossQuoteAmount: 1_000_000n, selectedTotalRate: 1_000_000n }),
    /below 100%/
  );
});

test("split and unsplit volume have identical lifetime fee entitlement", () => {
  const selectedTotalRate = 347_891n;
  const parts = [1_001n, 7_777n, 999_999n, 42_424n, 5n, 88_888n];
  let state = emptyFeeStateV2();
  for (const grossQuoteAmount of parts) {
    const split = previewFeeSplitV2({
      grossQuoteAmount,
      selectedTotalRate,
      platformRemainder: state.platformRemainder,
      projectRemainder: state.projectRemainder
    });
    assert.equal(split.atomicGrossFundingSufficient, true);
    state = applyFundedFeeSplitV2(state, split);
  }

  const totalGross = parts.reduce((total, value) => total + value, 0n);
  const unsplit = previewFeeSplitV2({ grossQuoteAmount: totalGross, selectedTotalRate });
  assert.equal(state.platformAccrued, unsplit.platformFee);
  assert.equal(state.projectAccrued, unsplit.projectFee);
  assert.equal(state.platformRemainder, unsplit.nextPlatformRemainder);
  assert.equal(state.projectRemainder, unsplit.nextProjectRemainder);
  assert.equal(state.cumulativeGrossQuote, totalGross);
});

test("deterministic property sequences preserve cumulative floors and conservation", () => {
  let seed = 0x6d2b79f5;
  const next = () => {
    seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
    return seed;
  };

  for (let run = 0; run < 64; run += 1) {
    const selected = BigInt(1_000 + (next() % 900_000));
    let state = emptyFeeStateV2();
    let weightedPlatform = 0n;
    let weightedProject = 0n;
    for (let step = 0; step < 32; step += 1) {
      const gross = BigInt(1_000 + (next() % 1_000_000));
      const split = previewFeeSplitV2({
        grossQuoteAmount: gross,
        selectedTotalRate: selected,
        platformRemainder: state.platformRemainder,
        projectRemainder: state.projectRemainder
      });
      assert.equal(split.totalFee, split.platformFee + split.projectFee);
      assert.equal(split.atomicGrossFundingSufficient, true);
      state = applyFundedFeeSplitV2(state, split);
      weightedPlatform += gross * PROGRAMMABLE_RATE_V2;
      weightedProject += gross * (selected - PROGRAMMABLE_RATE_V2);
    }
    assert.equal(state.platformAccrued, weightedPlatform / FEE_RATE_DENOMINATOR_V2);
    assert.equal(state.projectAccrued, weightedProject / FEE_RATE_DENOMINATOR_V2);
    assert.equal(state.platformRemainder, weightedPlatform % FEE_RATE_DENOMINATOR_V2);
    assert.equal(state.projectRemainder, weightedProject % FEE_RATE_DENOMINATOR_V2);
  }
});

test("exact-output witness works above 10 percent and rejects stale or forged gross values", () => {
  const witness = findExactOutputWitnessV2({
    netQuoteAmount: 999n,
    selectedTotalRate: 900_000n
  });
  assert.equal(witness.grossQuoteAmount, 9_971n);
  assert.equal(witness.split.grossQuoteAmount - witness.split.totalFee, 999n);

  const verified = verifyExactOutputWitnessV2({
    netQuoteAmount: 999n,
    grossQuoteAmount: witness.grossQuoteAmount,
    selectedTotalRate: 900_000n
  });
  assert.equal(verified.ok, true);
  assert.equal(verifyExactOutputWitnessV2({
    netQuoteAmount: 999n,
    grossQuoteAmount: 9_990n,
    selectedTotalRate: 900_000n
  }).ok, false);

  const carried = findExactOutputWitnessV2({
    netQuoteAmount: 17n,
    selectedTotalRate: 999_999n,
    platformRemainder: 999_000n,
    projectRemainder: 998_000n
  });
  assert.equal(verifyExactOutputWitnessV2({
    netQuoteAmount: 17n,
    grossQuoteAmount: carried.grossQuoteAmount,
    selectedTotalRate: 999_999n,
    platformRemainder: 999_000n,
    projectRemainder: 998_000n
  }).ok, true);
});

test("microtrade math never becomes an application ban and never creates an unfunded liability", () => {
  let state = emptyFeeStateV2();
  for (let index = 0; index < 999; index += 1) {
    const execution = executeFundedVolumeV2(state, {
      grossQuoteAmount: 1n,
      selectedTotalRate: 100_000n,
      funding: {
        collectionProfile: "custom-reviewed",
        grossFeeBudget: 1n,
        minimumUserQuoteResidual: 1n,
        sponsorFunding: 2n
      }
    });
    assert.equal(execution.applied, true);
    state = execution.state;
  }
  const boundary = previewFeeSplitV2({
    grossQuoteAmount: 1n,
    selectedTotalRate: 100_000n,
    platformRemainder: state.platformRemainder,
    projectRemainder: state.projectRemainder
  });
  assert.equal(boundary.platformFee, 1n);
  assert.equal(boundary.projectFee, 1n);
  assert.equal(boundary.totalFee, 2n);
  assert.equal(boundary.alternativeSettlementRequired, true);
  assert.throws(
    () => applyFundedFeeSplitV2(state, boundary, { settlementReady: true }),
    /funding receipts are internal/
  );

  const atomic = assessFeeFundingV2(boundary, {
    collectionProfile: "standard-amm",
    grossFeeBudget: 1n,
    minimumUserQuoteResidual: 1n
  });
  assert.equal(atomic.settlementReady, false);
  assert.equal(atomic.fundingShortfall, 2n);
  assert.equal(atomic.platformClaimableIncrease, 0n);
  assert.equal(atomic.createsUnfundedClaimableLiability, false);

  const feeOnly = previewFeeSplitV2({
    grossQuoteAmount: 1n,
    selectedTotalRate: 500_000n,
    platformRemainder: 0n,
    projectRemainder: 501_000n
  });
  assert.equal(feeOnly.totalFee, 1n);
  assert.equal(feeOnly.atomicGrossFundingSufficient, false);
  assert.equal(feeOnly.netQuoteAmount, null);
  const standardFeeOnly = assessFeeFundingV2(feeOnly, { collectionProfile: "standard-amm" });
  assert.equal(standardFeeOnly.profileMinimumUserQuoteResidual, 1n);
  assert.equal(standardFeeOnly.settlementReady, false);

  const sponsored = assessFeeFundingV2(boundary, {
    collectionProfile: "custom-reviewed",
    grossFeeBudget: 1n,
    minimumUserQuoteResidual: 1n,
    sponsorFunding: 2n
  });
  assert.equal(sponsored.settlementReady, true);
  assert.equal(sponsored.fromSponsor, 2n);
  assert.equal(sponsored.feeCustodyIncrease, 2n);

  const collateralized = executeFundedVolumeV2(state, {
    grossQuoteAmount: 1n,
    selectedTotalRate: 100_000n,
    funding: {
      collectionProfile: "custom-reviewed",
      grossFeeBudget: 1n,
      minimumUserQuoteResidual: 1n,
      collateralFunding: 2n
    }
  });
  assert.equal(collateralized.applied, true);
  assert.equal(collateralized.funding.collateralizedFeeFunding, 2n);
  assert.equal(
    collateralized.state.platformAccrued + collateralized.state.projectAccrued,
    state.platformAccrued + state.projectAccrued + 2n
  );
});

test(">=100 percent rates are explicit custom-reviewed external funding, never user-funded debt", () => {
  assert.throws(
    () => previewFeeSplitV2({ grossQuoteAmount: 1_000n, selectedTotalRate: 1_000_000n }),
    /below 100%/
  );
  assert.equal(effectiveExternallyFundedTotalRateV2(1_500_000n), 1_500_000n);

  const split = previewExternallyFundedFeeSplitV2({
    grossQuoteAmount: 1_000n,
    selectedTotalRate: 1_500_000n
  });
  assert.equal(split.fundingMode, "external-segregated");
  assert.equal(split.platformFee, 1n);
  assert.equal(split.projectFee, 1_499n);
  assert.equal(split.totalFee, 1_500n);
  assert.equal(split.atomicGrossFundingSufficient, false);
  assert.equal(split.netQuoteAmount, null);

  const before = emptyFeeStateV2();
  const short = executeExternallyFundedVolumeV2(before, {
    grossQuoteAmount: 1_000n,
    selectedTotalRate: 1_500_000n,
    funding: { collectionProfile: "custom-reviewed", sponsorFunding: 1_499n }
  });
  assert.equal(short.applied, false);
  assert.equal(short.funding.fundingShortfall, 1n);
  assert.equal(short.funding.platformClaimableIncrease, 0n);
  assert.equal(short.funding.projectClaimableIncrease, 0n);
  assert.deepEqual(short.state, before);

  const funded = executeExternallyFundedVolumeV2(before, {
    grossQuoteAmount: 1_000n,
    selectedTotalRate: 1_500_000n,
    funding: { collectionProfile: "custom-reviewed", collateralFunding: 1_500n }
  });
  assert.equal(funded.applied, true);
  assert.equal(funded.funding.fromGross, 0n);
  assert.equal(funded.funding.fromCollateral, 1_500n);
  assert.equal(funded.funding.feeCustodyIncrease, 1_500n);
  assert.equal(funded.state.cumulativeGrossQuote, 1_000n);
  assert.equal(funded.state.platformAccrued, 1n);
  assert.equal(funded.state.projectAccrued, 1_499n);

  assert.throws(
    () => executeExternallyFundedVolumeV2(before, {
      grossQuoteAmount: 1_000n,
      selectedTotalRate: 1_500_000n,
      funding: { collectionProfile: "standard-amm", sponsorFunding: 1_500n }
    }),
    /custom-reviewed/
  );
  assert.throws(
    () => executeExternallyFundedVolumeV2(before, {
      grossQuoteAmount: 1_000n,
      selectedTotalRate: 1_500_000n,
      funding: { collectionProfile: "custom-reviewed", grossFeeBudget: 1n, sponsorFunding: 1_500n }
    }),
    /cannot consume executed gross quote/
  );

  const maximumRate = previewExternallyFundedFeeSplitV2({
    grossQuoteAmount: FEE_RATE_DENOMINATOR_V2,
    selectedTotalRate: UINT256_MAX_V2
  });
  assert.equal(maximumRate.totalFee, UINT256_MAX_V2);
  assert.throws(
    () => previewExternallyFundedFeeSplitV2({
      grossQuoteAmount: FEE_RATE_DENOMINATOR_V2 + 1n,
      selectedTotalRate: UINT256_MAX_V2
    }),
    /exceeds uint256/
  );
  assert.throws(
    () => previewExternallyFundedFeeSplitV2({
      grossQuoteAmount: 1n,
      selectedTotalRate: UINT256_MAX_V2 + 1n
    }),
    /outside uint256/
  );
});

test("async batch aggregates micro fills while deposits cancellations and refunds are never volume", () => {
  const scope = {
    chainId: "1",
    poolId: `0x${"11".repeat(32)}`,
    quoteCurrency: `0x${"22".repeat(20)}`
  };
  const records = [];
  for (let index = 0; index < 1_000; index += 1) {
    records.push({ ...scope, id: `fill-${index}`, eventType: "executed-fill", grossQuoteAmount: 1n });
  }
  records.push(
    { ...scope, id: "deposit", eventType: "order-deposit", grossQuoteAmount: 0n },
    { ...scope, id: "cancel", eventType: "canceled", grossQuoteAmount: 0n },
    { ...scope, id: "refund", eventType: "refunded", grossQuoteAmount: 0n }
  );
  const aggregate = aggregateExecutedGrossV2(records, scope);
  assert.equal(aggregate.scopeKey, feeScopeKeyV2(scope));
  assert.equal(aggregate.executedGrossQuote, 1_000n);
  assert.equal(aggregate.executedRecordCount, 1_000);
  assert.equal(aggregate.ignoredNonVolumeRecordCount, 3);

  const batch = previewFeeSplitV2({
    grossQuoteAmount: aggregate.executedGrossQuote,
    selectedTotalRate: 100_000n
  });
  assert.equal(batch.platformFee, 1n);
  assert.equal(batch.projectFee, 99n);
  assert.equal(batch.totalFee, 100n);
  assert.equal(assessFeeFundingV2(batch, {
    collectionProfile: "async-fill-batch",
    minimumUserQuoteResidual: 1n
  }).settlementReady, true);

  assert.throws(
    () => aggregateExecutedGrossV2([
      { ...scope, id: "bad", eventType: "canceled", grossQuoteAmount: 1n }
    ], scope),
    /cannot declare executed gross/
  );
  assert.throws(
    () => aggregateExecutedGrossV2([
      { ...scope, id: "same", eventType: "executed-fill", grossQuoteAmount: 1n },
      { ...scope, id: "same", eventType: "executed-fill", grossQuoteAmount: 1n }
    ], scope),
    /duplicate execution/
  );
  assert.throws(
    () => aggregateExecutedGrossV2([
      { ...scope, id: "fill-0", eventType: "executed-fill", grossQuoteAmount: 1n }
    ], scope, aggregate.acceptedExecutionIds),
    /duplicate execution/
  );
  assert.throws(
    () => aggregateExecutedGrossV2([
      { ...scope, chainId: "8453", id: "wrong-scope", eventType: "executed-fill", grossQuoteAmount: 1n }
    ], scope),
    /different fee scope/
  );
});

test("exact-output solver returns the smallest witness across deterministic carried-remainder properties", () => {
  let seed = 0xa5a5_1f1f;
  const next = () => {
    seed = (Math.imul(seed, 1_103_515_245) + 12_345) >>> 0;
    return seed;
  };

  for (let run = 0; run < 128; run += 1) {
    const selectedTotalRate = BigInt(1_000 + (next() % 899_001));
    const platformRemainder = BigInt(next() % 1_000_000);
    const projectRemainder = BigInt(next() % 1_000_000);
    const netQuoteAmount = BigInt(1 + (next() % 32));
    let bruteWitness = null;
    for (let grossQuoteAmount = 1n; grossQuoteAmount <= 1_000n; grossQuoteAmount += 1n) {
      if (verifyExactOutputWitnessV2({
        netQuoteAmount,
        grossQuoteAmount,
        selectedTotalRate,
        platformRemainder,
        projectRemainder
      }).ok) {
        bruteWitness = grossQuoteAmount;
        break;
      }
    }
    assert.notEqual(bruteWitness, null);

    const solved = findExactOutputWitnessV2({
      netQuoteAmount,
      selectedTotalRate,
      platformRemainder,
      projectRemainder,
      maximumGrossQuoteAmount: 1_000n
    });
    assert.equal(solved.grossQuoteAmount, bruteWitness);
    assert.equal(solved.split.grossQuoteAmount - solved.split.totalFee, netQuoteAmount);
  }
});

test("policy document binds profiles scope owner and solvency semantics", () => {
  const policy = createFeePolicyV2({
    feeScopes: [{
      id: "main-market",
      chainId: "1",
      poolId: `0x${"11".repeat(32)}`,
      quoteCurrency: `0x${"00".repeat(20)}`,
      collectionProfile: "sync-custom-zero-amm"
    }]
  });
  assert.deepEqual(policy.collectionProfiles, COLLECTION_PROFILES_V2);
  assert.deepEqual(validateFeePolicyV2(policy), []);
  assert.equal(
    policy.economics.externallyFundedRateRule,
    "uint256-rate-custom-reviewed-segregated-funding-only"
  );
  assert.equal(isCanonicalPositiveUint256DecimalV2("1"), true);
  assert.equal(isCanonicalPositiveUint256DecimalV2(UINT256_MAX_V2.toString()), true);

  const maximumChainId = structuredClone(policy);
  maximumChainId.feeScopes[0].chainId = UINT256_MAX_V2.toString();
  assert.deepEqual(validateFeePolicyV2(maximumChainId), []);

  const wrongOwner = structuredClone(policy);
  wrongOwner.platform.owner = `0x${"22".repeat(20)}`;
  assert.match(validateFeePolicyV2(wrongOwner).join("\n"), /platform\.owner/);

  const wrongProfile = structuredClone(policy);
  wrongProfile.feeScopes[0].collectionProfile = "magic-router";
  assert.match(validateFeePolicyV2(wrongProfile).join("\n"), /collectionProfile/);

  const duplicateScope = structuredClone(policy);
  duplicateScope.feeScopes.push({
    ...structuredClone(duplicateScope.feeScopes[0]),
    id: "same-market-different-label",
    poolId: duplicateScope.feeScopes[0].poolId.toUpperCase().replace("0X", "0x"),
    quoteCurrency: duplicateScope.feeScopes[0].quoteCurrency.toUpperCase().replace("0X", "0x")
  });
  assert.match(validateFeePolicyV2(duplicateScope).join("\n"), /globally unique/);

  const manyScopes = createFeePolicyV2({
    feeScopes: Array.from({ length: 300 }, (_, index) => ({
      id: `market-${index}`,
      chainId: "1",
      poolId: `0x${BigInt(index + 1).toString(16).padStart(64, "0")}`,
      quoteCurrency: `0x${"00".repeat(20)}`,
      collectionProfile: "custom-reviewed"
    }))
  });
  assert.deepEqual(validateFeePolicyV2(manyScopes), []);

  const schema = JSON.parse(fs.readFileSync(path.join(skillRoot, "references", "fee-policy-v2.schema.json"), "utf8"));
  assert.equal(schema.$id, "urn:programmable:fee-policy-v2:1.0.0");
  assert.equal(schema.$defs.feeScope.properties.collectionProfile.enum.length, 4);
  assert.equal(schema.$defs.feeScope.properties.chainId.$ref, "#/$defs/canonicalPositiveUint256Decimal");
  assert.equal(schema.$defs.canonicalPositiveUint256Decimal.pattern, "^[1-9][0-9]{0,77}$");
  assert.equal(schema.properties.feeScopes.maxItems, undefined);
  assert.equal(
    schema.properties.economics.properties.externallyFundedRateRule.const,
    "uint256-rate-custom-reviewed-segregated-funding-only"
  );

  const expectedTemplateSchemaBytes = Buffer.from(`${canonicalJson(schema)}\n`, "utf8");
  const templateRoot = path.join(skillRoot, "assets", "templates", "open-world-v2", "new-idea");
  const templateSchemaBytes = fs.readFileSync(path.join(templateRoot, "fee-policy-v2.schema.json"));
  assert.deepEqual(templateSchemaBytes, expectedTemplateSchemaBytes);
  const templateSubmission = JSON.parse(fs.readFileSync(path.join(templateRoot, "submission.v2.json"), "utf8"));
  assert.equal(
    templateSubmission.supportingPackage.feePolicySchema.byteLength,
    expectedTemplateSchemaBytes.length
  );
  assert.equal(
    templateSubmission.supportingPackage.feePolicySchema.sha256,
    `sha256:${crypto.createHash("sha256").update(expectedTemplateSchemaBytes).digest("hex")}`
  );

  const kernelEvidence = JSON.parse(fs.readFileSync(path.join(
    skillRoot,
    "assets",
    "reference-kernels",
    "programmable-volume-fee-v2",
    "evidence",
    "fee-conformance-evidence.example.json"
  ), "utf8"));
  assert.equal(kernelEvidence.chainId, "1");
  assert.equal(isCanonicalPositiveUint256DecimalV2(kernelEvidence.chainId), true);
  assert.match(kernelEvidence.runtimeConfigurationHash, /^0x[0-9a-f]{64}$/);
  assert.match(kernelEvidence.factoryConfigurationHash, /^0x[0-9a-f]{64}$/);
});

test("policy validator mirrors every closed schema field and rejects unknown properties", () => {
  const makePolicy = () => createFeePolicyV2({
    feeScopes: [{
      id: "main-market",
      chainId: "1",
      poolId: `0x${"11".repeat(32)}`,
      quoteCurrency: `0x${"00".repeat(20)}`,
      collectionProfile: "standard-amm"
    }]
  });
  const expectInvalid = (label, mutate) => {
    const policy = structuredClone(makePolicy());
    mutate(policy);
    assert.notDeepEqual(validateFeePolicyV2(policy), [], label);
  };

  const valueMutations = [
    ["$schema", (policy) => { policy.$schema = "urn:wrong"; }],
    ["schemaVersion", (policy) => { policy.schemaVersion = "9.9.9"; }],
    ["policyId", (policy) => { policy.policyId = "wrong"; }],
    ["policyVersion", (policy) => { policy.policyVersion = "9.9.9"; }],
    ["policyHashPreimage", (policy) => { policy.policyHashPreimage = "wrong"; }],
    ["policyHash", (policy) => { policy.policyHash = `0x${"00".repeat(32)}`; }],
    ["platform.owner", (policy) => { policy.platform.owner = `0x${"22".repeat(20)}`; }],
    ["platform.immutable", (policy) => { policy.platform.immutable = false; }],
    ["platform.rateUnit", (policy) => { policy.platform.rateUnit = "bps"; }],
    ["platform.rate", (policy) => { policy.platform.rate = 999; }],
    ["platform.claimAuthority", (policy) => { policy.platform.claimAuthority = "anyone"; }],
    ["platform.claimAvailability", (policy) => { policy.platform.claimAvailability = "never"; }],
    ["basis.metric", (policy) => { policy.basis.metric = "net-volume"; }],
    ["basis.excludedEvents", (policy) => { policy.basis.excludedEvents.reverse(); }],
    ["basis.partialFillRule", (policy) => { policy.basis.partialFillRule = "count-order-once"; }],
    ["economics.formula", (policy) => { policy.economics.formula = "platform=0"; }],
    ["economics.maximumUserFundedTotalRateExclusive", (policy) => {
      policy.economics.maximumUserFundedTotalRateExclusive = 999_999;
    }],
    ["economics.externallyFundedRateRule", (policy) => {
      policy.economics.externallyFundedRateRule = "user-funded";
    }],
    ["economics.exactOutputRule", (policy) => { policy.economics.exactOutputRule = "unverified"; }],
    ["accounting.rounding", (policy) => { policy.accounting.rounding = "per-swap-floor"; }],
    ["accounting.remainderScope", (policy) => { policy.accounting.remainderScope = "global"; }],
    ["accounting.fragmentationResistantPlatformFee", (policy) => {
      policy.accounting.fragmentationResistantPlatformFee = false;
    }],
    ["accounting.claimResetsRemainders", (policy) => { policy.accounting.claimResetsRemainders = true; }],
    ["accounting.claimableOnlyWhenFullyFunded", (policy) => {
      policy.accounting.claimableOnlyWhenFullyFunded = false;
    }],
    ["accounting.crossScopeNetting", (policy) => { policy.accounting.crossScopeNetting = true; }],
    ["collectionProfiles", (policy) => { policy.collectionProfiles.reverse(); }],
    ["collectionProfiles type", (policy) => { policy.collectionProfiles = "standard-amm"; }],
    ["feeScopes empty", (policy) => { policy.feeScopes = []; }],
    ["feeScopes type", (policy) => { policy.feeScopes = {}; }],
    ["feeScope.id type", (policy) => { policy.feeScopes[0].id = 123; }],
    ["feeScope.id maxLength", (policy) => { policy.feeScopes[0].id = "a".repeat(101); }],
    ["feeScope.chainId zero", (policy) => { policy.feeScopes[0].chainId = "0"; }],
    ["feeScope.chainId number", (policy) => { policy.feeScopes[0].chainId = 1; }],
    ["feeScope.chainId leading zero", (policy) => { policy.feeScopes[0].chainId = "01"; }],
    ["feeScope.chainId sign", (policy) => { policy.feeScopes[0].chainId = "+1"; }],
    ["feeScope.chainId uint256 overflow", (policy) => {
      policy.feeScopes[0].chainId = (UINT256_MAX_V2 + 1n).toString();
    }],
    ["feeScope.poolId", (policy) => { policy.feeScopes[0].poolId = "0x11"; }],
    ["feeScope.poolId type", (policy) => { policy.feeScopes[0].poolId = {}; }],
    ["feeScope.quoteCurrency", (policy) => { policy.feeScopes[0].quoteCurrency = "0x00"; }],
    ["feeScope.quoteCurrency type", (policy) => { policy.feeScopes[0].quoteCurrency = {}; }],
    ["feeScope.collectionProfile", (policy) => { policy.feeScopes[0].collectionProfile = "unknown"; }],
    ["feeScope.collectionProfile type", (policy) => { policy.feeScopes[0].collectionProfile = 1; }],
    ["platform type", (policy) => { policy.platform = []; }],
    ["basis type", (policy) => { policy.basis = null; }],
    ["basis.excludedEvents type", (policy) => { policy.basis.excludedEvents = {}; }],
    ["economics type", (policy) => { policy.economics = "wrong"; }],
    ["accounting type", (policy) => { policy.accounting = 1; }],
    ["feeScope type", (policy) => { policy.feeScopes[0] = []; }]
  ];
  for (const [label, mutate] of valueMutations) expectInvalid(label, mutate);

  const keyGroups = [
    [[], [
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
    ]],
    [["platform"], ["owner", "immutable", "rateUnit", "rate", "claimAuthority", "claimAvailability"]],
    [["basis"], ["metric", "excludedEvents", "partialFillRule"]],
    [["economics"], [
      "formula",
      "maximumUserFundedTotalRateExclusive",
      "externallyFundedRateRule",
      "exactOutputRule"
    ]],
    [["accounting"], [
      "rounding",
      "remainderScope",
      "fragmentationResistantPlatformFee",
      "claimResetsRemainders",
      "claimableOnlyWhenFullyFunded",
      "crossScopeNetting"
    ]],
    [["feeScopes", 0], ["id", "chainId", "poolId", "quoteCurrency", "collectionProfile"]]
  ];
  for (const [segments, keys] of keyGroups) {
    for (const key of keys) {
      expectInvalid(`missing ${[...segments, key].join(".")}`, (policy) => {
        let target = policy;
        for (const segment of segments) target = target[segment];
        delete target[key];
      });
    }
  }

  for (const [label, mutate] of [
    ["unknown root", (policy) => { policy.unknown = true; }],
    ["unknown platform", (policy) => { policy.platform.unknown = true; }],
    ["unknown basis", (policy) => { policy.basis.unknown = true; }],
    ["unknown economics", (policy) => { policy.economics.unknown = true; }],
    ["unknown accounting", (policy) => { policy.accounting.unknown = true; }],
    ["unknown feeScope", (policy) => { policy.feeScopes[0].unknown = true; }]
  ]) {
    expectInvalid(label, mutate);
  }
});
