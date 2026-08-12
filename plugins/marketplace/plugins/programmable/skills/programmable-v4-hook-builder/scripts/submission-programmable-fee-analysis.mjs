import {
  PROGRAMMABLE_FEE_HUNDREDTHS_OF_BIP,
  PROGRAMMABLE_FEE_MAX_SELECTED_HUNDREDTHS_OF_BIP,
  PROGRAMMABLE_FEE_OWNER,
  PROGRAMMABLE_FEE_POLICY_ID,
  PROGRAMMABLE_FEE_POLICY_VERSION
} from "./submission-constants-core.mjs";
import { objectAt, resolvedText, sameStringList } from "./submission-analysis-helpers.mjs";
import { sameValue } from "./submission-value-core.mjs";

export function analyzeSubmissionProgrammableFee(context) {
  const {
    submission,
    add,
    gate,
    stage,
    hook,
    hookUsed,
    fee,
    pool,
    canonicalQuoteAssets,
    validateDeclaredPath
  } = context;
  const programmableFee = objectAt(submission, "programmableFee");
  const programmableRates = objectAt(programmableFee, "rates");
  const programmableBasis = objectAt(programmableFee, "basis");
  const programmableOwnership = objectAt(programmableFee, "ownership");
  const programmableCollection = objectAt(programmableFee, "collection");
  const programmableAccounting = objectAt(programmableFee, "accounting");
  const programmableEvidence = objectAt(programmableFee, "evidence");
  const expectedProgrammableFormula = "per-side:effective=max(selected,1000);platform=1000;project=effective-1000";
  const expectedLiabilityDimensions = ["poolId", "currency", "owner"];

  for (const [actual, expected, path, code] of [
    [programmableFee.policyId, PROGRAMMABLE_FEE_POLICY_ID, "$.programmableFee.policyId", "PROGRAMMABLE_FEE_POLICY_ID_INVALID"],
    [programmableFee.policyVersion, PROGRAMMABLE_FEE_POLICY_VERSION, "$.programmableFee.policyVersion", "PROGRAMMABLE_FEE_POLICY_VERSION_INVALID"],
    [programmableFee.poolScope, "canonical-launch-pool-key", "$.programmableFee.poolScope", "PROGRAMMABLE_FEE_POOL_SCOPE_INVALID"],
    [programmableRates.unit, "hundredths-of-bip", "$.programmableFee.rates.unit", "PROGRAMMABLE_FEE_UNIT_INVALID"],
    [programmableRates.minimumEffectiveHundredthsOfBip, PROGRAMMABLE_FEE_HUNDREDTHS_OF_BIP, "$.programmableFee.rates.minimumEffectiveHundredthsOfBip", "PROGRAMMABLE_FEE_MINIMUM_INVALID"],
    [programmableRates.platformHundredthsOfBip, PROGRAMMABLE_FEE_HUNDREDTHS_OF_BIP, "$.programmableFee.rates.platformHundredthsOfBip", "PROGRAMMABLE_FEE_PLATFORM_RATE_INVALID"],
    [programmableRates.formula, expectedProgrammableFormula, "$.programmableFee.rates.formula", "PROGRAMMABLE_FEE_FORMULA_DECLARATION_INVALID"],
    [programmableRates.lpFeeExcluded, true, "$.programmableFee.rates.lpFeeExcluded", "PROGRAMMABLE_FEE_LP_FEE_EXCLUSION_INVALID"],
    [programmableBasis.volume, "gross-quote-side-swap-volume", "$.programmableFee.basis.volume", "PROGRAMMABLE_FEE_VOLUME_BASIS_INVALID"],
    [programmableBasis.quoteAsset, "canonical-pool-quote-asset", "$.programmableFee.basis.quoteAsset", "PROGRAMMABLE_FEE_QUOTE_ASSET_INVALID"],
    [programmableOwnership.owner, PROGRAMMABLE_FEE_OWNER, "$.programmableFee.ownership.owner", "PROGRAMMABLE_FEE_OWNER_INVALID"],
    [programmableOwnership.immutable, true, "$.programmableFee.ownership.immutable", "PROGRAMMABLE_FEE_OWNER_MUTABLE"],
    [programmableOwnership.claimAuthority, "owner-only", "$.programmableFee.ownership.claimAuthority", "PROGRAMMABLE_FEE_CLAIM_AUTHORITY_INVALID"],
    [programmableOwnership.claimAvailability, "anytime", "$.programmableFee.ownership.claimAvailability", "PROGRAMMABLE_FEE_CLAIM_AVAILABILITY_INVALID"],
    [programmableOwnership.claimDestinationPolicy, "owner-or-owner-selected-per-claim", "$.programmableFee.ownership.claimDestinationPolicy", "PROGRAMMABLE_FEE_CLAIM_DESTINATION_INVALID"],
    [programmableOwnership.storedMutableRecipient, false, "$.programmableFee.ownership.storedMutableRecipient", "PROGRAMMABLE_FEE_STORED_RECIPIENT_FORBIDDEN"],
    [programmableOwnership.builderCanMutate, false, "$.programmableFee.ownership.builderCanMutate", "PROGRAMMABLE_FEE_BUILDER_MUTATION_FORBIDDEN"],
    [programmableOwnership.projectCanMutate, false, "$.programmableFee.ownership.projectCanMutate", "PROGRAMMABLE_FEE_PROJECT_MUTATION_FORBIDDEN"],
    [programmableOwnership.administratorCanMutate, false, "$.programmableFee.ownership.administratorCanMutate", "PROGRAMMABLE_FEE_ADMIN_MUTATION_FORBIDDEN"],
    [programmableCollection.integration, "canonical-pool-hook", "$.programmableFee.collection.integration", "PROGRAMMABLE_FEE_INTEGRATION_INVALID"],
    [programmableCollection.enforcement, "non-bypassable", "$.programmableFee.collection.enforcement", "PROGRAMMABLE_FEE_BYPASSABLE"],
    [programmableCollection.hookFeeMechanismBinding, "hook.feeMechanism", "$.programmableFee.collection.hookFeeMechanismBinding", "PROGRAMMABLE_FEE_HOOK_BINDING_INVALID"],
    [programmableAccounting.accrualMode, "claimable-liability", "$.programmableFee.accounting.accrualMode", "PROGRAMMABLE_FEE_ACCRUAL_MODE_INVALID"],
    [programmableAccounting.crossPoolNetting, false, "$.programmableFee.accounting.crossPoolNetting", "PROGRAMMABLE_FEE_CROSS_POOL_NETTING_FORBIDDEN"],
    [programmableAccounting.roundingPolicy, "cumulative-independent-platform-project-remainders", "$.programmableFee.accounting.roundingPolicy", "PROGRAMMABLE_FEE_ROUNDING_POLICY_INVALID"],
    [programmableAccounting.remainderScope, "canonical-pool-lifetime", "$.programmableFee.accounting.remainderScope", "PROGRAMMABLE_FEE_REMAINDER_SCOPE_INVALID"],
    [programmableAccounting.claimResetsRemainders, false, "$.programmableFee.accounting.claimResetsRemainders", "PROGRAMMABLE_FEE_CLAIM_REMAINDER_RESET_FORBIDDEN"],
    [programmableAccounting.minimumGrossQuoteUnits, 1000, "$.programmableFee.accounting.minimumGrossQuoteUnits", "PROGRAMMABLE_FEE_MINIMUM_GROSS_QUOTE_INVALID"],
    [programmableAccounting.fragmentationResistant, true, "$.programmableFee.accounting.fragmentationResistant", "PROGRAMMABLE_FEE_FRAGMENTATION_RESISTANCE_REQUIRED"]
  ]) {
    if (!sameValue(actual, expected)) add("blocker", code, path, `Expected the mandatory Programmable fee invariant ${JSON.stringify(expected)}.`, "Restore the exact v1 platform-fee policy value; builders and administrators cannot override it.");
  }

  if (!sameValue(programmableAccounting.liabilityKeyDimensions, expectedLiabilityDimensions)) {
    add("blocker", "PROGRAMMABLE_FEE_ACCOUNTING_SCOPE_INVALID", "$.programmableFee.accounting.liabilityKeyDimensions", "The platform-fee liability must be keyed exactly by PoolId, quote currency and immutable owner.", "Use [poolId, currency, owner] in that order and keep cross-pool netting disabled.");
  }

  for (const side of ["Buy", "Sell"]) {
    const selectedField = `selected${side}HundredthsOfBip`;
    const effectiveField = `effective${side}HundredthsOfBip`;
    const projectField = `project${side}HundredthsOfBip`;
    const selectedProgrammableRate = programmableRates[selectedField];
    if (Number.isInteger(selectedProgrammableRate)) {
      if (selectedProgrammableRate > PROGRAMMABLE_FEE_MAX_SELECTED_HUNDREDTHS_OF_BIP) {
        gate("custom-programmable-fee-review", "candidate", "A transparent fee above the v1 reference-kernel acceleration range needs a separately reviewed implementation and conformance receipt; the project idea remains eligible.");
        if (stage === "prototype" && !resolvedText(submission.implementation?.feeConformanceManifestPath)) {
          add("blocker", "PROGRAMMABLE_FEE_CUSTOM_RATE_EVIDENCE_MISSING", "$.implementation.feeConformanceManifestPath", "The prototype uses a fee above the v1 reference-kernel range without a compatible custom conformance receipt.", "Bind an exact custom fee-conformance receipt that supports the declared rate; a v1 reference-kernel receipt cannot prove this implementation.");
        }
      }
      const expectedEffectiveRate = Math.max(selectedProgrammableRate, PROGRAMMABLE_FEE_HUNDREDTHS_OF_BIP);
      const expectedProjectRate = expectedEffectiveRate - PROGRAMMABLE_FEE_HUNDREDTHS_OF_BIP;
      if (programmableRates[effectiveField] !== expectedEffectiveRate) add("blocker", "PROGRAMMABLE_FEE_EFFECTIVE_RATE_INVALID", `$.programmableFee.rates.${effectiveField}`, `The effective ${side.toLowerCase()} hook charge must be ${expectedEffectiveRate} hundredths of a bip for the selected rate.`, "Use effective=max(selected,1000) independently for buys and sells; never add 1000 on top.");
      if (programmableRates[projectField] !== expectedProjectRate) add("blocker", "PROGRAMMABLE_FEE_PROJECT_RATE_INVALID", `$.programmableFee.rates.${projectField}`, `The project ${side.toLowerCase()} share must be ${expectedProjectRate} hundredths of a bip for the selected rate.`, "Use project=effective-1000 independently for buys and sells so Programmable receives exactly 0.1% of gross quote-side volume.");
    } else if (programmableCollection.status === "implemented") {
      add("blocker", "PROGRAMMABLE_FEE_SELECTED_RATE_UNRESOLVED", `$.programmableFee.rates.${selectedField}`, `An implemented platform fee has no selected ${side.toLowerCase()} swap-fee input.`, "Set the project-selected hook fee in hundredths of a bip, including zero when no project fee is requested.");
    }
  }

  if (programmableCollection.status !== "implemented") {
    add("blocker", "PROGRAMMABLE_FEE_INTEGRATION_PENDING", "$.programmableFee.collection.status", "The mandatory platform fee is still a proposal architecture discussion and is not prototype-ready.", "Integrate the non-bypassable canonical-pool hook path, bind its evidence, and then set status to implemented.");
    gate("programmable-fee-implementation", "prototype", "A design may proceed to isolated implementation, but the prototype cannot pass until the mandatory volume fee is implemented and source-bound.");
  }

  if (hookUsed === false) {
    add("blocker", "PROGRAMMABLE_FEE_HOOK_REQUIRED", "$.hook.used", "A no-hook or router-only path cannot enforce the mandatory fee on every canonical-pool swap.", "Keep the idea as an architecture proposal or integrate a non-bypassable canonical-pool hook before requesting prototype readiness.");
    gate("programmable-fee-no-hook-architecture-review", "candidate", "A no-hook project needs a reviewed architecture that preserves the mandatory canonical-pool fee before it can become a Programmable prototype.");
  }

  if (stage === "prototype") {
    if (programmableCollection.status !== "implemented") add("blocker", "PROGRAMMABLE_FEE_PROTOTYPE_NOT_IMPLEMENTED", "$.programmableFee.collection.status", "A prototype cannot leave the mandatory platform fee pending.", "Complete the hook implementation and all exact bindings before declaring prototype stage.");
    if (fee.used !== true || !["hook-owned-fee", "both"].includes(fee.classification)) add("blocker", "PROGRAMMABLE_FEE_HOOK_MECHANISM_MISSING", "$.hook.feeMechanism", "The prototype does not implement the mandatory fee through its declared hook fee mechanism.", "Enable a hook-owned fee path; LP fees and router-only charges are not substitutes.");
    const maximumEffectiveProgrammableRate = Math.max(
      programmableRates.effectiveBuyHundredthsOfBip ?? Number.POSITIVE_INFINITY,
      programmableRates.effectiveSellHundredthsOfBip ?? Number.POSITIVE_INFINITY
    );
    if (!Number.isInteger(fee.maximumHundredthsOfBip) || !Number.isFinite(maximumEffectiveProgrammableRate) || fee.maximumHundredthsOfBip < maximumEffectiveProgrammableRate) add("blocker", "PROGRAMMABLE_FEE_HOOK_CAP_TOO_LOW", "$.hook.feeMechanism.maximumHundredthsOfBip", "The hook fee cap cannot execute the larger declared buy or sell platform-plus-project charge.", "Set the immutable hook cap at or above both exact effective rates.");
    if (fee.collectionPath !== "quadrant-dependent-swap-return-delta") add("blocker", "PROGRAMMABLE_FEE_COLLECTION_PATH_INVALID", "$.hook.feeMechanism.collectionPath", "A single router-side, LP-fee, before-only or after-only path cannot collect gross quote-side volume in all four swap quadrants.", "Use the quadrant-dependent swap return-delta path: beforeSwap when quote is specified and afterSwap when quote is unspecified.");
    if (fee.allocationMode !== "programmable-rate-formula") add("blocker", "PROGRAMMABLE_FEE_ALLOCATION_MODE_INVALID", "$.hook.feeMechanism.allocationMode", "A fixed recipient percentage cannot represent the mandatory platform rate plus independently selected buy and sell project rates exactly.", "Use programmable-rate-formula and accrue the platform and project rates with independent cumulative remainders.");

    const platformRecipient = (fee.recipients ?? []).find((recipient) => recipient?.role === "programmable-platform");
    if (
      !platformRecipient ||
      platformRecipient.addressSource !== "fixed-address" ||
      platformRecipient.address?.toLowerCase() !== PROGRAMMABLE_FEE_OWNER.toLowerCase() ||
      platformRecipient.binding !== "exact-address" ||
      platformRecipient.mutable !== false ||
      platformRecipient.mutationController !== "none"
    ) add("blocker", "PROGRAMMABLE_FEE_RECIPIENT_UNBOUND", "$.hook.feeMechanism.recipients", "The executable hook mechanism does not bind the Programmable liability to the exact immutable owner.", "Add one immutable programmable-platform fixed-address recipient for the mandated owner with no mutation controller.");

    const maximumProjectRate = Math.max(
      programmableRates.projectBuyHundredthsOfBip ?? 0,
      programmableRates.projectSellHundredthsOfBip ?? 0
    );
    const projectRecipient = (fee.recipients ?? []).find((recipient) => recipient?.role === "project-owner");
    if (maximumProjectRate > 0 && (
      !projectRecipient
      || !["launch-wallet", "fixed-address", "beneficiary-supplied", "derived-contract"].includes(projectRecipient.addressSource)
      || projectRecipient.mutable !== false
    )) add("blocker", "PROGRAMMABLE_FEE_PROJECT_RECIPIENT_UNBOUND", "$.hook.feeMechanism.recipients", "A nonzero project rate has no immutable project-owner liability binding.", "Add a project-owner recipient bound at launch to the authenticated launch wallet, exact address, validated beneficiary or immutable derived contract; keep its sharePpm null because the rate formula owns the allocation.");

    if (hook.customAccounting?.crossPoolNetting !== false || !["poolId", "currency", "beneficiary"].every((dimension) => hook.customAccounting?.liabilityKeyDimensions?.includes(dimension))) add("blocker", "PROGRAMMABLE_FEE_HOOK_ACCOUNTING_UNBOUND", "$.hook.customAccounting", "The executable hook accounting is not isolated by PoolId, quote currency and beneficiary.", "Disable cross-pool netting and include poolId, currency and beneficiary in the hook liability key.");

    const declaredSwapModes = Array.isArray(submission.integration?.swapModes) ? [...submission.integration.swapModes].sort() : [];
    const feeSwapModes = Array.isArray(programmableCollection.supportedSwapModes) ? [...programmableCollection.supportedSwapModes].sort() : [];
    if (!sameStringList(feeSwapModes, declaredSwapModes) || declaredSwapModes.length === 0) add("blocker", "PROGRAMMABLE_FEE_SWAP_MODE_COVERAGE_INCOMPLETE", "$.programmableFee.collection.supportedSwapModes", "The mandatory fee does not cover exactly every swap mode exposed by the project.", "List every integration.swapModes entry and test the fee in each supported direction and exactness mode.");

    const quoteAsset = canonicalQuoteAssets[0];
    const quoteCurrency = quoteAsset?.id === pool.currency0 ? "currency0" : quoteAsset?.id === pool.currency1 ? "currency1" : null;
    if (!quoteCurrency) add("blocker", "PROGRAMMABLE_FEE_QUOTE_ASSET_UNBOUND", "$.programmableFee.basis.quoteAsset", "The declared quote-side fee basis does not resolve to one currency in the canonical PoolKey.", "Declare one quote asset and bind its id to pool.currency0 or pool.currency1.");
    const feeQuadrantRules = {
      "zeroForOne-exactInput": ["zeroForOneExactInput", "currency0", "currency1"],
      "zeroForOne-exactOutput": ["zeroForOneExactOutput", "currency0", "currency1"],
      "oneForZero-exactInput": ["oneForZeroExactInput", "currency1", "currency0"],
      "oneForZero-exactOutput": ["oneForZeroExactOutput", "currency1", "currency0"]
    };
    for (const mode of declaredSwapModes) {
      const [quadrantName, inputCurrency, outputCurrency] = feeQuadrantRules[mode] ?? [];
      const quadrant = fee.swapQuadrants?.[quadrantName];
      const expectedBasis = quoteCurrency === inputCurrency ? "gross-input" : quoteCurrency === outputCurrency ? "gross-output" : null;
      if (!quadrant || quadrant.currency !== quoteCurrency || quadrant.basis !== expectedBasis) add("blocker", "PROGRAMMABLE_FEE_QUOTE_QUADRANT_INVALID", `$.hook.feeMechanism.swapQuadrants.${quadrantName ?? mode}`, `Swap mode ${mode} is not charged against its gross quote-side amount.`, `Use currency=${quoteCurrency} and basis=${expectedBasis} for ${mode}.`);
      const specifiedCurrency = mode.endsWith("exactInput") ? inputCurrency : outputCurrency;
      const expectedCollectionPath = quoteCurrency === specifiedCurrency ? "before-swap-return-delta" : "after-swap-return-delta";
      if (programmableCollection.swapModePaths?.[quadrantName] !== expectedCollectionPath) add("blocker", "PROGRAMMABLE_FEE_SWAP_MODE_PATH_INVALID", `$.programmableFee.collection.swapModePaths.${quadrantName ?? mode}`, `Swap mode ${mode} uses the wrong return-delta phase for its quote currency.`, `Use ${expectedCollectionPath}: specified quote is collected beforeSwap and unspecified quote is collected afterSwap.`);
    }

    if (hook.nestedActions?.directPoolManagerCalls === true && programmableCollection.selfCallPolicy !== "same-pool-swap-fee-enforced-internally") add("blocker", "PROGRAMMABLE_FEE_SELF_CALL_BYPASS", "$.programmableFee.collection.selfCallPolicy", "Direct hook-to-PoolManager calls skip callbacks to the same hook and can bypass a callback-only same-pool fee.", "Either forbid same-pool nested swaps or enforce the exact fee inside the direct same-pool swap path and bind its source and tests.");

    const feeFlow = (submission.valueFlows ?? []).find((flow) => flow?.id === programmableAccounting.valueFlowId);
    if (!feeFlow || programmableAccounting.valueFlowId !== fee.collectionValueFlowId) add("blocker", "PROGRAMMABLE_FEE_VALUE_FLOW_UNBOUND", "$.programmableFee.accounting.valueFlowId", "The platform-fee accounting does not bind the exact executable hook collection value flow.", "Reference one declared value flow and use the same id in hook.feeMechanism.collectionValueFlowId.");
    if (!resolvedText(programmableAccounting.collectionEvent) || programmableAccounting.collectionEvent !== fee.collectionEvent || !(submission.integration?.events ?? []).includes(programmableAccounting.collectionEvent)) add("blocker", "PROGRAMMABLE_FEE_COLLECTION_EVENT_UNBOUND", "$.programmableFee.accounting.collectionEvent", "The platform-fee accrual event is not exactly bound to the hook mechanism and integration event surface.", "Use the same exact collection event in programmableFee.accounting, hook.feeMechanism and integration.events.");
    if (!resolvedText(programmableAccounting.claimEvent) || !(submission.integration?.events ?? []).includes(programmableAccounting.claimEvent)) add("blocker", "PROGRAMMABLE_FEE_CLAIM_EVENT_UNBOUND", "$.programmableFee.accounting.claimEvent", "Owner-only claims have no exact public event binding.", "Declare the exact claim event and include it in integration.events.");

    const implementationSources = new Set(submission.implementation?.sourcePaths ?? []);
    const implementationTests = new Set(submission.implementation?.testPaths ?? []);
    if ((programmableEvidence.sourcePaths?.length ?? 0) === 0) add("blocker", "PROGRAMMABLE_FEE_SOURCE_MISSING", "$.programmableFee.evidence.sourcePaths", "The prototype has no exact platform-fee source binding.", "Bind every source file that calculates, accrues and claims the mandatory fee.");
    if ((programmableEvidence.testPaths?.length ?? 0) === 0) add("blocker", "PROGRAMMABLE_FEE_TESTS_MISSING", "$.programmableFee.evidence.testPaths", "The prototype has no exact platform-fee test binding.", "Bind formula, four-quadrant, split-vs-unsplit cumulative rounding, sub-minimum-volume rejection, bypass, accounting and owner-only claim tests.");
    for (const [index, entry] of (programmableEvidence.sourcePaths ?? []).entries()) {
      validateDeclaredPath(entry, `$.programmableFee.evidence.sourcePaths[${index}]`, "Programmable fee source");
      if (!implementationSources.has(entry)) add("blocker", "PROGRAMMABLE_FEE_SOURCE_NOT_BOUND", `$.programmableFee.evidence.sourcePaths[${index}]`, "Platform-fee source is outside implementation.sourcePaths.", "Add the exact source path to the implementation manifest.");
    }
    for (const [index, entry] of (programmableEvidence.testPaths ?? []).entries()) {
      validateDeclaredPath(entry, `$.programmableFee.evidence.testPaths[${index}]`, "Programmable fee test");
      if (!implementationTests.has(entry)) add("blocker", "PROGRAMMABLE_FEE_TEST_NOT_BOUND", `$.programmableFee.evidence.testPaths[${index}]`, "Platform-fee tests are outside implementation.testPaths.", "Add the exact test path to the implementation manifest.");
    }
    gate("programmable-fee-formula-and-claim-tests", "prototype", "The prototype must prove the minimum, non-additive split, quote-side basis and owner-only claim path at executable boundaries.");
  }

  context.programmableCollection = programmableCollection;
}
