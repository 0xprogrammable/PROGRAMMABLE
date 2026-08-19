import { validateFeeConformanceCompletionV1 } from "./fee-conformance-receipt-v1-core.mjs";
import { isCanonicalPositiveUint256DecimalV2 } from "./fee-policy-v2-core.mjs";
import { canonicalJson, isObject } from "./open-world-v2-primitives.mjs";
import {
  OPEN_WORLD_V2_FEE_NOT_APPLICABLE,
  PROGRAMMABLE_FEE_V2,
  digestPattern,
  duplicates,
  hasExactFeeNotApplicableProfile,
  idsFor,
  slugPattern
} from "./open-world-v2-contracts.mjs";

export function validateOpenWorldV2Fee(context) {
  const {
    submission,
    parsedFeeConformanceRecords,
    exactZeroScopeFeeNotApplicable,
    add,
    requireObject,
    requireArray,
    validateSchemaBinding
  } = context;
  const { assetIds, isCanonicalV4Market } = context.graphState;
  const fee = submission.programmableFee;
  if (!requireObject(fee, "$.programmableFee", "PROGRAMMABLE_FEE_MISSING")) {
    // All remaining fee checks are guarded below.
  } else {
    if (fee.policyId !== PROGRAMMABLE_FEE_V2.policyId || fee.policyVersion !== PROGRAMMABLE_FEE_V2.policyVersion || fee.policyHashPreimage !== PROGRAMMABLE_FEE_V2.policyHashPreimage || fee.policyHash !== PROGRAMMABLE_FEE_V2.policyHash) add("blocker", "PROGRAMMABLE_FEE_V2_BINDING_INVALID", "$.programmableFee", "Open-world v2 must bind the exact fee-v2 ID, version, preimage, and policy hash; v1 is historical lineage only.");
    if (fee.platformHundredthsOfBip !== PROGRAMMABLE_FEE_V2.platformHundredthsOfBip || fee.owner !== PROGRAMMABLE_FEE_V2.owner) add("blocker", "PROGRAMMABLE_FEE_PLATFORM_INVARIANT_INVALID", "$.programmableFee", "Platform fee must remain 0.1% and claimable by the exact fee owner.");
    validateSchemaBinding(fee.policySchema, null, "$.programmableFee.policySchema", "fee-policy");
    if (fee.policySchema?.kind !== "builtin" || fee.policySchema?.schemaId !== PROGRAMMABLE_FEE_V2.policySchemaId) add("blocker", "PROGRAMMABLE_FEE_POLICY_SCHEMA_INVALID", "$.programmableFee.policySchema", "Fee v2 must bind its exact builtin policy schema ID.");
    validateSchemaBinding(fee.collectionProfileSchema, fee.collectionProfile, "$.programmableFee.collectionProfileSchema", "fee-collection");
    const scopes = requireArray(fee.feeScopes, "$.programmableFee.feeScopes", "FEE_SCOPES_INVALID");
    const scopeIds = idsFor(scopes);
    const referencedScopeIds = requireArray(fee.executionScopeRefs, "$.programmableFee.executionScopeRefs", "FEE_SCOPE_REFS_INVALID");
    const referencedScopeIdSet = new Set(referencedScopeIds);
    for (const duplicate of duplicates(scopes.map((scope) => scope?.id))) add("blocker", "FEE_SCOPE_ID_DUPLICATE", "$.programmableFee.feeScopes", "Fee-scope IDs must be unique.", { id: duplicate });
    const scopeTuples = new Map();
    scopes.forEach((scope, index) => {
      const scopePath = `$.programmableFee.feeScopes[${index}]`;
      if (!isCanonicalPositiveUint256DecimalV2(scope.chainId)) add("blocker", "FEE_SCOPE_CHAIN_ID_INVALID", `${scopePath}.chainId`, "Fee scope chainId must be one positive uint256 decimal string without signs, leading zeroes, or JS-number coercion.");
      const scopedMarket = submission.markets?.find((market) => market?.id === scope.marketRef);
      if (!scopedMarket) add("blocker", "FEE_SCOPE_MARKET_REF_MISSING", `${scopePath}.marketRef`, "Fee scope references an unknown market.");
      else {
        if (!isCanonicalV4Market(scopedMarket)) add("blocker", "FEE_SCOPE_NONCANONICAL_MARKET", `${scopePath}.marketRef`, "Programmable fee scopes bind only canonical Uniswap v4 execution contexts; external or secondary markets remain outside this scope.");
        if (scopedMarket.executionClass !== "programmable-canonical") add("blocker", "FEE_SCOPE_MARKET_NOT_PROGRAMMABLE_CANONICAL", `${scopePath}.marketRef`, "A fee-v2 scope may bind only a market explicitly classified as programmable-canonical.", { executionClass: scopedMarket.executionClass });
        if (!scopedMarket.canonicalScopes?.includes(scope.id)) add("blocker", "FEE_SCOPE_MARKET_BACKREF_MISSING", `${scopePath}.marketRef`, "Fee scope must be referenced by its canonical market in canonicalScopes.");
        if (!scopedMarket.assetRefs?.includes(scope.quoteAssetRef)) add("blocker", "FEE_SCOPE_QUOTE_ASSET_NOT_IN_MARKET", `${scopePath}.quoteAssetRef`, "Fee scope quote asset must be one of the canonical market currencies.");
        if (isCanonicalV4Market(scopedMarket) && scopedMarket.profile?.chainId !== scope.chainId) add("blocker", "FEE_SCOPE_MARKET_CHAIN_ID_MISMATCH", `${scopePath}.chainId`, "Fee scope chainId must exactly equal its canonical market chainId string.");
      }
      if (!assetIds.has(scope.quoteAssetRef)) add("blocker", "FEE_SCOPE_QUOTE_ASSET_REF_MISSING", `${scopePath}.quoteAssetRef`, "Fee scope references an unknown quote asset.");
      if (submission.stage === "prototype" && (!/^0x[0-9a-fA-F]{64}$/u.test(scope.poolId ?? "") || !/^0x[0-9a-fA-F]{40}$/u.test(scope.quoteCurrency ?? ""))) add("blocker", "FEE_SCOPE_RUNTIME_BINDING_MISSING", scopePath, "Prototype fee scope needs exact poolId and quote-currency address.");
      const tuple = canonicalJson([scope.chainId, scope.poolId, scope.quoteCurrency]);
      if (scopeTuples.has(tuple)) add("blocker", "FEE_SCOPE_TUPLE_DUPLICATE", scopePath, "Duplicate chainId, poolId, and quoteCurrency fee scope is ambiguous and forbidden.", { firstScopeId: scopeTuples.get(tuple) });
      else scopeTuples.set(tuple, scope.id);
    });
    for (const scopeRef of referencedScopeIds) if (!scopeIds.has(scopeRef)) add("blocker", "FEE_SCOPE_REF_MISSING", "$.programmableFee.executionScopeRefs", "Fee-scope reference does not resolve.", { ref: scopeRef });
    if (new Set(referencedScopeIds).size !== scopeIds.size || [...scopeIds].some((id) => !referencedScopeIds.includes(id))) add("blocker", "FEE_SCOPE_COVERAGE_INCOMPLETE", "$.programmableFee.executionScopeRefs", "Every declared fee scope must be bound exactly once by the submission.");
    submission.markets?.forEach((market, marketIndex) => {
      for (const scopeRef of market.canonicalScopes ?? []) {
        const scope = scopes.find((candidate) => candidate?.id === scopeRef);
        if (!scope) add("blocker", "MARKET_CANONICAL_SCOPE_MISSING", `$.markets[${marketIndex}].canonicalScopes`, "Canonical market scope reference does not resolve to a fee-v2 scope.", { ref: scopeRef });
        else if (scope.marketRef !== market.id) add("blocker", "MARKET_CANONICAL_SCOPE_WRONG_MARKET", `$.markets[${marketIndex}].canonicalScopes`, "Canonical scope is bound to a different market.", { ref: scopeRef });
      }
      const activeMarketScopes = scopes.filter((scope) => scope?.marketRef === market.id && referencedScopeIdSet.has(scope?.id));
      if (market.executionClass === "programmable-canonical" && (activeMarketScopes.length !== 1 || market.canonicalScopes?.length !== 1 || activeMarketScopes[0]?.id !== market.canonicalScopes[0])) add("blocker", "PROGRAMMABLE_CANONICAL_ACTIVE_SCOPE_BINDING_INVALID", `$.markets[${marketIndex}]`, "Each programmable-canonical market must map one-to-one to its single active fee-v2 scope.", { canonicalScopeRefs: market.canonicalScopes ?? [], activeScopeIds: activeMarketScopes.map((scope) => scope.id) });
      if ((market.executionClass === "external" || market.executionClass === "non-launchable") && activeMarketScopes.length !== 0) add("blocker", "NONPROGRAMMABLE_ACTIVE_SCOPE_FORBIDDEN", `$.markets[${marketIndex}]`, "External and non-launchable markets cannot carry an active Programmable fee-v2 scope.", { executionClass: market.executionClass, activeScopeIds: activeMarketScopes.map((scope) => scope.id) });
    });
    const claimAuthority = submission.authorities?.find((authority) => authority?.id === fee.claimAuthorityRef);
    if (!claimAuthority || claimAuthority.holder !== PROGRAMMABLE_FEE_V2.owner || claimAuthority.revocation !== "immutable") add("blocker", "FEE_CLAIM_AUTHORITY_INVALID", "$.programmableFee.claimAuthorityRef", "Fee claim authority must resolve to an immutable authority held by the exact platform fee wallet.");
    const conformance = fee.conformance;
    if (!isObject(conformance) || !["required", "complete", "not-applicable"].includes(conformance.status)) {
      add("blocker", "FEE_CONFORMANCE_INVALID", "$.programmableFee.conformance", "Fee-v2 conformance must declare required, complete, or exact zero-scope not-applicable status.");
    } else {
      const evidenceRefs = requireArray(conformance.evidenceRefs, "$.programmableFee.conformance.evidenceRefs", "FEE_CONFORMANCE_EVIDENCE_REFS_INVALID");
      const evidenceDigests = requireArray(conformance.evidenceDigests, "$.programmableFee.conformance.evidenceDigests", "FEE_CONFORMANCE_EVIDENCE_DIGESTS_INVALID");
      const scopeArtifacts = requireArray(conformance.scopeArtifacts, "$.programmableFee.conformance.scopeArtifacts", "FEE_CONFORMANCE_SCOPE_ARTIFACTS_INVALID");
      if (conformance.status === "not-applicable") {
        if (!hasExactFeeNotApplicableProfile(fee)) add("blocker", "FEE_NOT_APPLICABLE_PROFILE_INVALID", "$.programmableFee.collectionProfile", "Not-applicable conformance requires the exact builtin zero-scope fee-collection profile and no profile extensions.");
        if (scopes.length !== 0 || referencedScopeIds.length !== 0) add("blocker", "FEE_NOT_APPLICABLE_SCOPE_STATE_INVALID", "$.programmableFee", "Not-applicable conformance requires empty feeScopes and executionScopeRefs; real scopes must use Fee V2 instance conformance.", { feeScopeCount: scopes.length, executionScopeRefCount: referencedScopeIds.length });
        if (evidenceRefs.length !== 0 || evidenceDigests.length !== 0 || scopeArtifacts.length !== 0) add("blocker", "FEE_NOT_APPLICABLE_EVIDENCE_FORBIDDEN", "$.programmableFee.conformance", "Not-applicable conformance carries no fabricated fee evidence, digests, or typed scope artifacts.", { evidenceRefCount: evidenceRefs.length, evidenceDigestCount: evidenceDigests.length, scopeArtifactCount: scopeArtifacts.length });
        const canonicalMarketIds = (submission.markets ?? []).filter((market) => market?.executionClass === "programmable-canonical").map((market) => market.id);
        const unknownMarketIds = (submission.markets ?? []).filter((market) => market?.executionClass === "unknown").map((market) => market.id);
        if (canonicalMarketIds.length > 0) add("blocker", "FEE_NOT_APPLICABLE_CANONICAL_SCOPE_PRESENT", "$.programmableFee.conformance.status", "Not-applicable cannot hide a programmable-canonical execution market; bind its real Fee V2 scope, policy instance, and complete typed 10-bps evidence.", { marketIds: canonicalMarketIds });
        if (unknownMarketIds.length > 0) add("blocker", "FEE_NOT_APPLICABLE_UNKNOWN_SCOPE_PRESENT", "$.programmableFee.conformance.status", "An unknown execution class cannot be declared fee-not-applicable at prototype stage; resolve the market classification first.", { marketIds: unknownMarketIds });
      } else if (fee.collectionProfileSchema?.schemaId === OPEN_WORLD_V2_FEE_NOT_APPLICABLE.collectionProfileSchemaId) {
        add("blocker", "FEE_NOT_APPLICABLE_STATUS_REQUIRED", "$.programmableFee.conformance.status", "The builtin not-applicable collection profile may be used only with explicit not-applicable conformance.");
      }
      const evidenceRefSet = new Set();
      for (const [index, evidenceRef] of evidenceRefs.entries()) {
        if (typeof evidenceRef !== "string" || !slugPattern.test(evidenceRef)) add("blocker", "FEE_CONFORMANCE_EVIDENCE_REF_INVALID", `$.programmableFee.conformance.evidenceRefs[${index}]`, "Fee-conformance evidence references must be canonical slugs.");
        if (evidenceRefSet.has(evidenceRef)) add("blocker", "FEE_CONFORMANCE_EVIDENCE_REF_DUPLICATE", `$.programmableFee.conformance.evidenceRefs[${index}]`, "Fee-conformance evidence references must be unique.");
        evidenceRefSet.add(evidenceRef);
      }
      const evidenceDigestIndex = new Map();
      for (const [index, binding] of evidenceDigests.entries()) {
        const bindingPath = `$.programmableFee.conformance.evidenceDigests[${index}]`;
        if (!isObject(binding) || typeof binding.evidenceRef !== "string" || !slugPattern.test(binding.evidenceRef) || !digestPattern.test(binding.sha256 ?? "") || /^sha256:0{64}$/u.test(binding.sha256)) {
          add("blocker", "FEE_CONFORMANCE_EVIDENCE_DIGEST_INVALID", bindingPath, "Every fee-conformance evidence digest must bind one canonical evidence slug to a non-placeholder SHA-256 digest.");
          continue;
        }
        if (evidenceDigestIndex.has(binding.evidenceRef)) add("blocker", "FEE_CONFORMANCE_EVIDENCE_DIGEST_DUPLICATE", bindingPath, "Each fee-conformance evidence reference must have exactly one digest.", { evidenceRef: binding.evidenceRef });
        else evidenceDigestIndex.set(binding.evidenceRef, binding.sha256);
      }
      for (const evidenceRef of evidenceRefSet) if (!evidenceDigestIndex.has(evidenceRef)) add("blocker", "FEE_CONFORMANCE_EVIDENCE_DIGEST_MISSING", "$.programmableFee.conformance.evidenceDigests", "Every referenced fee-conformance evidence artifact needs an exact digest.", { evidenceRef });
      for (const evidenceRef of evidenceDigestIndex.keys()) if (!evidenceRefSet.has(evidenceRef)) add("blocker", "FEE_CONFORMANCE_EVIDENCE_DIGEST_ORPHAN", "$.programmableFee.conformance.evidenceDigests", "Fee-conformance digest bindings may not introduce unreferenced evidence.", { evidenceRef });

      if (conformance.status === "complete") {
        if (scopeArtifacts.length === 0) add("blocker", "FEE_CONFORMANCE_COMPLETION_MISSING", "$.programmableFee.conformance.scopeArtifacts", "A complete fee-conformance claim requires one exact typed receipt/vector pair per fee scope.");
        const artifactScopeRefs = scopeArtifacts.map((artifact) => artifact?.feeScopeRef);
        for (const duplicate of duplicates(artifactScopeRefs)) add("blocker", "FEE_CONFORMANCE_SCOPE_ARTIFACT_DUPLICATE", "$.programmableFee.conformance.scopeArtifacts", "Each fee scope may bind only one typed fee-conformance receipt/vector pair.", { feeScopeRef: duplicate });
        for (const scopeRef of artifactScopeRefs) if (!scopeIds.has(scopeRef)) add("blocker", "FEE_CONFORMANCE_SCOPE_ARTIFACT_UNKNOWN", "$.programmableFee.conformance.scopeArtifacts", "Typed fee-conformance artifacts reference an unknown fee scope.", { feeScopeRef: scopeRef });
        for (const scopeId of scopeIds) if (!artifactScopeRefs.includes(scopeId)) add("blocker", "FEE_CONFORMANCE_SCOPE_ARTIFACT_MISSING", "$.programmableFee.conformance.scopeArtifacts", "Every fee scope requires an exact typed fee-conformance receipt/vector pair before completion.", { feeScopeRef: scopeId });

        for (const [index, parsedEntry] of parsedFeeConformanceRecords.entries()) {
          const artifactPath = `$.programmableFee.conformance.scopeArtifacts[${index}]`;
          const receipt = parsedEntry.receipt?.value;
          const vectorSet = parsedEntry.vectorSet?.value;
          if (!receipt || !vectorSet) {
            add("blocker", "FEE_CONFORMANCE_COMPLETION_INVALID", artifactPath, "Complete fee conformance requires exact parseable receipt and vector-set bytes.");
            continue;
          }
          const receiptEvidenceRef = receipt.receiptId;
          const vectorEvidenceRef = receipt.vectorSet?.evidenceRef;
          if (evidenceDigestIndex.get(receiptEvidenceRef) !== parsedEntry.receipt.binding.sha256) add("blocker", "FEE_CONFORMANCE_RECEIPT_DIGEST_BINDING_MISMATCH", `${artifactPath}.receipt.sha256`, "Receipt evidence digest must equal the exact bound receipt bytes.", { receiptEvidenceRef });
          if (evidenceDigestIndex.get(vectorEvidenceRef) !== parsedEntry.vectorSet.binding.sha256) add("blocker", "FEE_CONFORMANCE_VECTOR_DIGEST_BINDING_MISMATCH", `${artifactPath}.vectorSet.sha256`, "Vector-set evidence digest must equal the exact bound vector-set bytes.", { vectorEvidenceRef });
          const expectedScope = scopes.find((scope) => scope?.id === parsedEntry.feeScopeRef);
          const completionErrors = validateFeeConformanceCompletionV1({
            conformance,
            receipt,
            receiptEvidenceRef,
            vectorSet,
            vectorSetBytes: parsedEntry.vectorSet.bytes,
            evidenceDigests: Object.fromEntries(evidenceDigestIndex),
            expected: {
              applicationId: submission.applicationId,
              feeScope: expectedScope,
              collectionProfile: expectedScope?.collectionProfile,
              vectorSetSha256: parsedEntry.vectorSet.binding.sha256
            }
          });
          if (completionErrors.length > 0) add("blocker", "FEE_CONFORMANCE_COMPLETION_INVALID", artifactPath, "Typed fee-conformance completion does not match the submission, exact evidence bytes, and authoritative fee-v2 contract.", {
            validationErrors: completionErrors.slice(0, 64),
            omittedErrorCount: Math.max(0, completionErrors.length - 64)
          });
        }
      }
    }
    if (submission.stage === "prototype" && !exactZeroScopeFeeNotApplicable && (conformance?.status !== "complete" || conformance.evidenceRefs?.length === 0)) add("blocker", "FEE_CONFORMANCE_EVIDENCE_MISSING", "$.programmableFee.conformance", "A prototype with an applicable, canonical, or unresolved execution scope needs complete typed fee-v2 receipt, vector-set, and evidence-digest bindings; only exact zero-scope not-applicable conformance is exempt.");
  }

}
