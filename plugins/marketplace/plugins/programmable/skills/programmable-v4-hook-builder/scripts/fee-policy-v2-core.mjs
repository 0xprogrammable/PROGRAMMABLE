import {
  COLLECTION_PROFILES_V2,
  createFeePolicyV2,
  EXECUTED_VOLUME_EVENTS_V2,
  FEE_POLICY_V2_HASH,
  FEE_POLICY_V2_HASH_PREIMAGE,
  FEE_POLICY_V2_ID,
  FEE_POLICY_V2_SCHEMA_VERSION,
  FEE_POLICY_V2_VERSION,
  FEE_RATE_DENOMINATOR_V2,
  isCanonicalPositiveUint256DecimalV2,
  isCollectionProfileV2,
  isExecutedVolumeEventV2,
  isNonVolumeEventV2,
  MAX_USER_FUNDED_TOTAL_RATE_V2,
  NON_VOLUME_EVENTS_V2,
  PROGRAMMABLE_FEE_V2_OWNER,
  PROGRAMMABLE_RATE_V2,
  UINT256_MAX_V2,
  validateFeePolicyV2
} from "./fee-policy-v2-contract.mjs";

export {
  COLLECTION_PROFILES_V2,
  createFeePolicyV2,
  EXECUTED_VOLUME_EVENTS_V2,
  FEE_POLICY_V2_HASH,
  FEE_POLICY_V2_HASH_PREIMAGE,
  FEE_POLICY_V2_ID,
  FEE_POLICY_V2_SCHEMA_VERSION,
  FEE_POLICY_V2_VERSION,
  FEE_RATE_DENOMINATOR_V2,
  isCanonicalPositiveUint256DecimalV2,
  MAX_USER_FUNDED_TOTAL_RATE_V2,
  NON_VOLUME_EVENTS_V2,
  PROGRAMMABLE_FEE_V2_OWNER,
  PROGRAMMABLE_RATE_V2,
  UINT256_MAX_V2,
  validateFeePolicyV2
};

export function emptyFeeStateV2() {
  return Object.freeze({
    platformRemainder: 0n,
    projectRemainder: 0n,
    cumulativeGrossQuote: 0n,
    platformAccrued: 0n,
    projectAccrued: 0n
  });
}

export function effectiveTotalRateV2(selectedTotalRate) {
  const selected = toUserFundedRate(selectedTotalRate, "selectedTotalRate");
  return selected < PROGRAMMABLE_RATE_V2 ? PROGRAMMABLE_RATE_V2 : selected;
}

export function effectiveExternallyFundedTotalRateV2(selectedTotalRate) {
  const selected = toPolicyRate(selectedTotalRate, "selectedTotalRate");
  return selected < PROGRAMMABLE_RATE_V2 ? PROGRAMMABLE_RATE_V2 : selected;
}

/**
 * Pure policy math. This function intentionally does not reject a small gross amount.
 * Instead it reports whether the selected atomic settlement can fund the resulting
 * whole-unit liabilities. The caller can then select batch, sponsor or reviewed
 * collateral settlement without turning the project idea into an eligibility failure.
 */
export function previewFeeSplitV2({
  grossQuoteAmount,
  selectedTotalRate,
  platformRemainder = 0n,
  projectRemainder = 0n
}) {
  return previewFeeSplitForMode({
    grossQuoteAmount,
    selectedTotalRate,
    platformRemainder,
    projectRemainder,
    externallyFunded: false
  });
}

/**
 * Explicit high-rate policy math for a separately reviewed settlement which funds
 * the entire fee from segregated sponsor and/or collateral value. It is not an
 * exact-output gross-up and cannot be passed through the ordinary user-funded path.
 */
export function previewExternallyFundedFeeSplitV2({
  grossQuoteAmount,
  selectedTotalRate,
  platformRemainder = 0n,
  projectRemainder = 0n
}) {
  const selected = toPolicyRate(selectedTotalRate, "selectedTotalRate");
  if (selected < FEE_RATE_DENOMINATOR_V2) {
    throw new RangeError("externally funded preview is reserved for selectedTotalRate at or above 100%");
  }
  return previewFeeSplitForMode({
    grossQuoteAmount,
    selectedTotalRate: selected,
    platformRemainder,
    projectRemainder,
    externallyFunded: true
  });
}

function previewFeeSplitForMode({
  grossQuoteAmount,
  selectedTotalRate,
  platformRemainder,
  projectRemainder,
  externallyFunded
}) {
  const gross = toUint(grossQuoteAmount, "grossQuoteAmount");
  const selected = externallyFunded
    ? toPolicyRate(selectedTotalRate, "selectedTotalRate")
    : toUserFundedRate(selectedTotalRate, "selectedTotalRate");
  const effective = selected < PROGRAMMABLE_RATE_V2 ? PROGRAMMABLE_RATE_V2 : selected;
  const platformCarry = toRemainder(platformRemainder, "platformRemainder");
  const projectCarry = toRemainder(projectRemainder, "projectRemainder");
  const platform = accumulateRate(gross, PROGRAMMABLE_RATE_V2, platformCarry);
  const project = accumulateRate(gross, effective - PROGRAMMABLE_RATE_V2, projectCarry);
  const totalFee = checkedAdd(platform.fee, project.fee, "totalFee");
  // A positive user-funded atomic execution must leave a positive quote leg.
  // `totalFee === gross` is funded custody math, but not an honest AMM execution.
  const atomicGrossFundingSufficient = gross === 0n ? totalFee === 0n : totalFee < gross;

  return Object.freeze({
    grossQuoteAmount: gross,
    selectedTotalRate: selected,
    effectiveTotalRate: effective,
    platformRate: PROGRAMMABLE_RATE_V2,
    projectRate: effective - PROGRAMMABLE_RATE_V2,
    fundingMode: externallyFunded ? "external-segregated" : "user-funded",
    totalFee,
    platformFee: platform.fee,
    projectFee: project.fee,
    nextPlatformRemainder: platform.nextRemainder,
    nextProjectRemainder: project.nextRemainder,
    atomicGrossFundingSufficient,
    netQuoteAmount: atomicGrossFundingSufficient ? gross - totalFee : null,
    alternativeSettlementRequired: !atomicGrossFundingSufficient
  });
}

export function applyFundedFeeSplitV2(stateValue, splitValue, fundingReceipt = null) {
  const state = normalizeState(stateValue);
  const split = canonicalSplitForState(state, splitValue);
  if (fundingReceipt !== null && fundingReceipt !== undefined) {
    throw new TypeError("funding receipts are internal; use executeFundedVolumeV2 for sponsored or collateralized settlement");
  }
  if (!split.atomicGrossFundingSufficient) {
    throw new RangeError("an unfunded split cannot create claimable liabilities");
  }
  return applyCanonicalSplit(state, split);
}

function applyCanonicalSplit(state, split) {
  return Object.freeze({
    platformRemainder: split.nextPlatformRemainder,
    projectRemainder: split.nextProjectRemainder,
    cumulativeGrossQuote: checkedAdd(state.cumulativeGrossQuote, split.grossQuoteAmount, "cumulativeGrossQuote"),
    platformAccrued: checkedAdd(state.platformAccrued, split.platformFee, "platformAccrued"),
    projectAccrued: checkedAdd(state.projectAccrued, split.projectFee, "projectAccrued")
  });
}

export function executeFundedVolumeV2(stateValue, execution) {
  const state = normalizeState(stateValue);
  const split = previewFeeSplitV2({
    grossQuoteAmount: execution?.grossQuoteAmount,
    selectedTotalRate: execution?.selectedTotalRate,
    platformRemainder: state.platformRemainder,
    projectRemainder: state.projectRemainder
  });
  const funding = assessFeeFundingV2(split, execution?.funding);
  if (!funding.settlementReady) {
    return Object.freeze({ state, split, funding, applied: false });
  }
  return Object.freeze({
    // The funding assessment and state transition are one module-internal path.
    // Callers cannot manufacture a `{ settlementReady: true }` receipt and pass
    // it to the public atomic helper.
    state: applyCanonicalSplit(state, split),
    split,
    funding,
    applied: true
  });
}

/**
 * Applies >=100% policy rates only for the `custom-reviewed` profile and only
 * after sponsor/collateral funding covers the full calculated fee. Executed gross
 * quote is never consumed as fee budget on this path.
 */
export function executeExternallyFundedVolumeV2(stateValue, execution) {
  const state = normalizeState(stateValue);
  const split = previewExternallyFundedFeeSplitV2({
    grossQuoteAmount: execution?.grossQuoteAmount,
    selectedTotalRate: execution?.selectedTotalRate,
    platformRemainder: state.platformRemainder,
    projectRemainder: state.projectRemainder
  });
  const suppliedFunding = execution?.funding ?? {};
  const collectionProfile = suppliedFunding.collectionProfile ?? "custom-reviewed";
  if (collectionProfile !== "custom-reviewed") {
    throw new RangeError("externally funded rates at or above 100% require the custom-reviewed profile");
  }
  const grossFeeBudget = toUint(suppliedFunding.grossFeeBudget ?? 0n, "funding.grossFeeBudget");
  if (grossFeeBudget !== 0n) {
    throw new RangeError("externally funded rates cannot consume executed gross quote as fee budget");
  }
  const funding = assessFeeFundingV2(split, {
    ...suppliedFunding,
    collectionProfile,
    grossFeeBudget: 0n
  });
  if (!funding.settlementReady) {
    return Object.freeze({ state, split, funding, applied: false });
  }
  return Object.freeze({
    state: applyCanonicalSplit(state, split),
    split,
    funding,
    applied: true
  });
}

/**
 * Funding is all-or-nothing: an incompletely funded calculation creates no
 * claimable platform or project liability. Sponsor or collateral value is moved
 * into fee custody before either recipient can claim it.
 */
export function assessFeeFundingV2(splitValue, fundingValue = {}) {
  const split = normalizeSplit(splitValue);
  const funding = fundingValue ?? {};
  const collectionProfile = funding.collectionProfile ?? "custom-reviewed";
  if (!isCollectionProfileV2(collectionProfile)) {
    throw new RangeError(`unknown collection profile: ${collectionProfile}`);
  }
  const grossFeeBudget = toUint(
    funding.grossFeeBudget ?? split.grossQuoteAmount,
    "funding.grossFeeBudget"
  );
  if (grossFeeBudget > split.grossQuoteAmount) {
    throw new RangeError("funding.grossFeeBudget cannot exceed executed gross quote volume");
  }
  const requestedMinimumUserQuoteResidual = toUint(
    funding.minimumUserQuoteResidual ?? 0n,
    "funding.minimumUserQuoteResidual"
  );
  const profileMinimumUserQuoteResidual = collectionProfile === "standard-amm"
    && split.grossQuoteAmount > 0n
    ? 1n
    : 0n;
  const minimumUserQuoteResidual = maxBigInt(
    requestedMinimumUserQuoteResidual,
    profileMinimumUserQuoteResidual
  );
  const sponsorFunding = toUint(funding.sponsorFunding ?? 0n, "funding.sponsorFunding");
  const collateralFunding = toUint(funding.collateralFunding ?? 0n, "funding.collateralFunding");

  const grossAvailable = grossFeeBudget > minimumUserQuoteResidual
    ? grossFeeBudget - minimumUserQuoteResidual
    : 0n;
  let remaining = split.totalFee;
  const fromGross = minBigInt(remaining, grossAvailable);
  remaining -= fromGross;
  const fromSponsor = minBigInt(remaining, sponsorFunding);
  remaining -= fromSponsor;
  const fromCollateral = minBigInt(remaining, collateralFunding);
  remaining -= fromCollateral;
  const settlementReady = remaining === 0n;

  return Object.freeze({
    collectionProfile,
    settlementReady,
    status: settlementReady ? "FULLY_FUNDED" : "ALTERNATIVE_SETTLEMENT_REQUIRED",
    totalFee: split.totalFee,
    fromGross,
    fromSponsor,
    fromCollateral,
    fundingShortfall: remaining,
    requestedMinimumUserQuoteResidual,
    profileMinimumUserQuoteResidual,
    minimumUserQuoteResidual,
    feeCustodyIncrease: settlementReady ? split.totalFee : 0n,
    platformClaimableIncrease: settlementReady ? split.platformFee : 0n,
    projectClaimableIncrease: settlementReady ? split.projectFee : 0n,
    collateralizedFeeFunding: settlementReady ? fromCollateral : 0n,
    createsUnfundedClaimableLiability: false,
    recommendedProfiles: settlementReady
      ? Object.freeze([])
      : Object.freeze(["async-fill-batch", "custom-reviewed"])
  });
}

export function verifyExactOutputWitnessV2({
  netQuoteAmount,
  grossQuoteAmount,
  selectedTotalRate,
  platformRemainder = 0n,
  projectRemainder = 0n
}) {
  const net = toUint(netQuoteAmount, "netQuoteAmount");
  const split = previewFeeSplitV2({
    grossQuoteAmount,
    selectedTotalRate,
    platformRemainder,
    projectRemainder
  });
  const ok = split.atomicGrossFundingSufficient && split.grossQuoteAmount - split.totalFee === net;
  return Object.freeze({
    ok,
    reason: ok ? null : "gross witness does not produce the requested net amount under current fee remainders",
    netQuoteAmount: net,
    split
  });
}

/**
 * Finds the smallest verified gross witness offchain. With an effective rate below
 * 100%, f(g)=g-platformFee(g)-projectFee(g) is unbounded and can rise by at most
 * one unit at a time, so every non-negative integer net amount is representable.
 *
 * Independent component floors make f locally non-monotone, so a conventional
 * binary search is unsound. The two intervals below are derived from combining
 * the floors; together they contain every exact witness and contain at most
 * 2,000,002 candidates for the fixed denominator used by this policy.
 */
export function findExactOutputWitnessV2({
  netQuoteAmount,
  selectedTotalRate,
  platformRemainder = 0n,
  projectRemainder = 0n,
  maximumGrossQuoteAmount = UINT256_MAX_V2
}) {
  const net = toUint(netQuoteAmount, "netQuoteAmount");
  const selected = toUserFundedRate(selectedTotalRate, "selectedTotalRate");
  const effective = effectiveTotalRateV2(selected);
  const pRemainder = toRemainder(platformRemainder, "platformRemainder");
  const jRemainder = toRemainder(projectRemainder, "projectRemainder");
  const maximumGross = toUint(maximumGrossQuoteAmount, "maximumGrossQuoteAmount");
  if (net === 0n) {
    return Object.freeze({
      netQuoteAmount: 0n,
      grossQuoteAmount: 0n,
      split: previewFeeSplitV2({
        grossQuoteAmount: 0n,
        selectedTotalRate: selected,
        platformRemainder: pRemainder,
        projectRemainder: jRemainder
      }),
      candidatesChecked: 1
    });
  }

  const residualRate = FEE_RATE_DENOMINATOR_V2 - effective;
  const combinedRemainder = pRemainder + jRemainder;
  const intervals = [net - 1n, net]
    .map((combinedFloorNet) => witnessInterval(combinedFloorNet, combinedRemainder, residualRate))
    .filter(({ lower, upper }) => lower <= upper && lower <= maximumGross)
    .map(({ lower, upper }) => ({ lower, upper: minBigInt(upper, maximumGross) }))
    .sort((left, right) => left.lower < right.lower ? -1 : left.lower > right.lower ? 1 : 0);

  let checked = 0;
  let best = null;
  for (const { lower, upper } of intervals) {
    if (best !== null && lower >= best.split.grossQuoteAmount) continue;
    const effectiveUpper = best === null ? upper : minBigInt(upper, best.split.grossQuoteAmount - 1n);
    for (let gross = lower; gross <= effectiveUpper; gross += 1n) {
      checked += 1;
      const verification = verifyExactOutputWitnessV2({
        netQuoteAmount: net,
        grossQuoteAmount: gross,
        selectedTotalRate: selected,
        platformRemainder: pRemainder,
        projectRemainder: jRemainder
      });
      if (verification.ok) {
        best = verification;
        break;
      }
    }
  }
  if (best === null) {
    throw new RangeError("no exact-output gross witness exists inside maximumGrossQuoteAmount");
  }
  return Object.freeze({
    netQuoteAmount: net,
    grossQuoteAmount: best.split.grossQuoteAmount,
    split: best.split,
    candidatesChecked: checked
  });
}

export function feeScopeKeyV2(scopeValue) {
  if (!scopeValue || typeof scopeValue !== "object" || Array.isArray(scopeValue)) {
    throw new TypeError("fee scope must be an object");
  }
  if (!isCanonicalPositiveUint256DecimalV2(scopeValue.chainId)) {
    throw new RangeError("fee scope chainId must be a canonical positive uint256 decimal string");
  }
  if (typeof scopeValue.poolId !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(scopeValue.poolId)) {
    throw new RangeError("fee scope poolId must be bytes32");
  }
  if (
    typeof scopeValue.quoteCurrency !== "string"
    || !/^0x[0-9a-fA-F]{40}$/.test(scopeValue.quoteCurrency)
  ) {
    throw new RangeError("fee scope quoteCurrency must be an EVM address string");
  }
  return `${scopeValue.chainId}:${scopeValue.poolId.toLowerCase()}:${scopeValue.quoteCurrency.toLowerCase()}`;
}

/**
 * Aggregates one declared fee scope only. Callers must persist the returned
 * `acceptedExecutionIds` and provide them on the next batch to prevent replay
 * across invocations; duplicates inside the current batch are always rejected.
 */
export function aggregateExecutedGrossV2(recordsValue, scopeValue, previouslyProcessedExecutionIds = []) {
  if (!Array.isArray(recordsValue)) throw new TypeError("execution records must be an array");
  if (!Array.isArray(previouslyProcessedExecutionIds)) {
    throw new TypeError("previouslyProcessedExecutionIds must be an array");
  }
  const scopeKey = feeScopeKeyV2(scopeValue);
  const seen = new Set();
  for (const [index, id] of previouslyProcessedExecutionIds.entries()) {
    if (typeof id !== "string" || id.length === 0) {
      throw new TypeError(`previouslyProcessedExecutionIds[${index}] must be a nonempty string`);
    }
    if (seen.has(id)) throw new RangeError(`duplicate previously processed execution id: ${id}`);
    seen.add(id);
  }
  const acceptedExecutionIds = [];
  let executedGrossQuote = 0n;
  let executedRecordCount = 0;
  for (const [index, record] of recordsValue.entries()) {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      throw new TypeError(`execution record ${index} must be an object`);
    }
    if (typeof record.id !== "string" || record.id.length === 0) {
      throw new TypeError(`execution record ${index}.id is required`);
    }
    const recordScopeKey = feeScopeKeyV2(record);
    if (recordScopeKey !== scopeKey) {
      throw new RangeError(`execution record ${index} belongs to a different fee scope`);
    }
    const amount = toUint(record.grossQuoteAmount ?? 0n, `execution record ${index}.grossQuoteAmount`);
    if (isExecutedVolumeEventV2(record.eventType)) {
      if (seen.has(record.id)) throw new RangeError(`duplicate execution record id: ${record.id}`);
      seen.add(record.id);
      acceptedExecutionIds.push(record.id);
      executedGrossQuote = checkedAdd(executedGrossQuote, amount, "executedGrossQuote");
      executedRecordCount += 1;
    } else if (isNonVolumeEventV2(record.eventType)) {
      if (amount !== 0n) {
        throw new RangeError(`${record.eventType} cannot declare executed gross quote volume`);
      }
    } else {
      throw new RangeError(`unknown execution event type: ${record.eventType}`);
    }
  }
  return Object.freeze({
    scopeKey,
    executedGrossQuote,
    executedRecordCount,
    ignoredNonVolumeRecordCount: recordsValue.length - executedRecordCount,
    acceptedExecutionIds: Object.freeze(acceptedExecutionIds)
  });
}

function witnessInterval(combinedFloorNet, combinedRemainder, residualRate) {
  const numerator = combinedFloorNet * FEE_RATE_DENOMINATOR_V2 + combinedRemainder;
  const lower = maxBigInt(
    0n,
    floorDiv(numerator - FEE_RATE_DENOMINATOR_V2, residualRate) + 1n
  );
  const upper = floorDiv(numerator, residualRate);
  return { lower, upper };
}

function accumulateRate(gross, rate, carriedRemainder) {
  const product = gross * rate;
  const fractional = product % FEE_RATE_DENOMINATOR_V2;
  const combined = fractional + carriedRemainder;
  const fee = product / FEE_RATE_DENOMINATOR_V2 + combined / FEE_RATE_DENOMINATOR_V2;
  if (fee > UINT256_MAX_V2) throw new RangeError("fee component exceeds uint256");
  return {
    fee,
    nextRemainder: combined % FEE_RATE_DENOMINATOR_V2
  };
}

function normalizeState(value) {
  const state = value ?? emptyFeeStateV2();
  return {
    platformRemainder: toRemainder(state.platformRemainder ?? 0n, "state.platformRemainder"),
    projectRemainder: toRemainder(state.projectRemainder ?? 0n, "state.projectRemainder"),
    cumulativeGrossQuote: toUint(state.cumulativeGrossQuote ?? 0n, "state.cumulativeGrossQuote"),
    platformAccrued: toUint(state.platformAccrued ?? 0n, "state.platformAccrued"),
    projectAccrued: toUint(state.projectAccrued ?? 0n, "state.projectAccrued")
  };
}

function normalizeSplit(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("split must be an object");
  const normalized = {
    ...value,
    grossQuoteAmount: toUint(value.grossQuoteAmount, "split.grossQuoteAmount"),
    selectedTotalRate: toPolicyRate(value.selectedTotalRate, "split.selectedTotalRate"),
    totalFee: toUint(value.totalFee, "split.totalFee"),
    platformFee: toUint(value.platformFee, "split.platformFee"),
    projectFee: toUint(value.projectFee, "split.projectFee"),
    nextPlatformRemainder: toRemainder(value.nextPlatformRemainder, "split.nextPlatformRemainder"),
    nextProjectRemainder: toRemainder(value.nextProjectRemainder, "split.nextProjectRemainder")
  };
  if (normalized.totalFee !== normalized.platformFee + normalized.projectFee) {
    throw new RangeError("split.totalFee must equal platformFee plus projectFee");
  }
  return normalized;
}

function canonicalSplitForState(state, splitValue) {
  const supplied = normalizeSplit(splitValue);
  const canonical = previewFeeSplitV2({
    grossQuoteAmount: supplied.grossQuoteAmount,
    selectedTotalRate: supplied.selectedTotalRate,
    platformRemainder: state.platformRemainder,
    projectRemainder: state.projectRemainder
  });
  for (const field of [
    "effectiveTotalRate",
    "platformRate",
    "projectRate",
    "fundingMode",
    "totalFee",
    "platformFee",
    "projectFee",
    "nextPlatformRemainder",
    "nextProjectRemainder",
    "atomicGrossFundingSufficient",
    "netQuoteAmount",
    "alternativeSettlementRequired"
  ]) {
    if (supplied[field] !== canonical[field]) {
      throw new RangeError(`split.${field} does not match canonical policy math and current remainders`);
    }
  }
  return canonical;
}

function toUserFundedRate(value, label) {
  const rate = toUint(value, label);
  if (rate > MAX_USER_FUNDED_TOTAL_RATE_V2) {
    throw new RangeError(`${label} must be below 100% for a user-funded swap`);
  }
  return rate;
}

function toPolicyRate(value, label) {
  return toUint(value, label);
}

function toRemainder(value, label) {
  const remainder = toUint(value, label);
  if (remainder >= FEE_RATE_DENOMINATOR_V2) throw new RangeError(`${label} must be below the rate denominator`);
  return remainder;
}

function toUint(value, label) {
  let parsed;
  if (typeof value === "bigint") parsed = value;
  else if (typeof value === "number" && Number.isSafeInteger(value)) parsed = BigInt(value);
  else if (typeof value === "string" && /^(?:0|[1-9][0-9]*)$/.test(value)) parsed = BigInt(value);
  else throw new TypeError(`${label} must be an unsigned integer`);
  if (parsed < 0n || parsed > UINT256_MAX_V2) throw new RangeError(`${label} is outside uint256`);
  return parsed;
}

function checkedAdd(left, right, label) {
  const sum = left + right;
  if (sum > UINT256_MAX_V2) throw new RangeError(`${label} exceeds uint256`);
  return sum;
}

function floorDiv(numerator, denominator) {
  if (denominator <= 0n) throw new RangeError("floorDiv denominator must be positive");
  let quotient = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder !== 0n && numerator < 0n) quotient -= 1n;
  return quotient;
}

function minBigInt(left, right) {
  return left < right ? left : right;
}

function maxBigInt(left, right) {
  return left > right ? left : right;
}
