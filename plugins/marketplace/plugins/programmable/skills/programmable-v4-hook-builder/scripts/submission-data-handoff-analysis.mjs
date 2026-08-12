import { analyzeProjectSurfaces } from "./project-surfaces-core.mjs";
import { objectAt, resolvedText } from "./submission-analysis-helpers.mjs";
import {
  requireDetailedText,
  requireNonEmptyArray
} from "./settlement-policy-core.mjs";
import { hasConfiguredValue } from "./token-mechanics-policy-core.mjs";

export function analyzeSubmissionDataAndHandoff(context) {
  const {
    submission,
    add,
    gate,
    stage,
    customAccounting,
    claims,
    includedSwapClient,
    integration,
    validateDeclaredPath
  } = context;
  const dataReconstruction = objectAt(integration, "dataReconstruction");
  const reserveReconstruction = objectAt(dataReconstruction, "reserveReconstruction");
  const reserveReconstructionExpected =
    customAccounting.used === true ||
    claims.used === true ||
    submission.capabilities?.externalLiquidity?.used === true;
  const platformIndexerDeclared = (integration.platformHandoff?.indexerSourcePaths?.length ?? 0) > 0;
  const dataReconstructionApplicable = dataReconstruction.mode !== "not-applicable";
  if (!dataReconstruction.mode) {
    add("blocker", "DATA_RECONSTRUCTION_MODE_UNRESOLVED", "$.integration.dataReconstruction.mode", "The submission does not say whether it includes a reconstructing data surface.", "Choose events-only, events-with-confirmed-reads or not-applicable after inspecting the actual project surfaces and accounting requirements.");
  } else if (!dataReconstructionApplicable) {
    for (const field of [
      "eventCoverage",
      "cursor",
      "startBlockPolicy",
      "finalityDepth",
      "reorgPolicy",
      "backfillPolicy",
      "checkpointPolicy",
      "freshnessTargetSeconds",
      "staleAfterSeconds",
      "freshnessMeasurement",
      "reconciliation"
    ]) {
      if (dataReconstruction[field] !== null) add("blocker", "DATA_RECONSTRUCTION_NOT_APPLICABLE_CONFLICT", `$.integration.dataReconstruction.${field}`, "Data reconstruction is not applicable, but an active indexer field remains configured.", "Set every inactive data-reconstruction field to null, keep source and test paths empty and disable reserve reconstruction.");
    }
    for (const field of ["sourcePaths", "testPaths"]) {
      if ((dataReconstruction[field]?.length ?? 0) !== 0) add("blocker", "DATA_RECONSTRUCTION_NOT_APPLICABLE_CONFLICT", `$.integration.dataReconstruction.${field}`, "Data reconstruction is not applicable, but indexer source or test paths remain declared.", "Use an empty array or select an active data-reconstruction mode and complete its evidence.");
    }
    if (reserveReconstruction.used !== false || hasConfiguredValue(reserveReconstruction, new Set(["used"]))) {
      add("blocker", "DATA_RECONSTRUCTION_NOT_APPLICABLE_CONFLICT", "$.integration.dataReconstruction.reserveReconstruction", "Data reconstruction is not applicable, but reserve-reconstruction fields remain active.", "Set used to false and clear every reserve-reconstruction field, or select an active data mode and complete the solvency evidence.");
    }
    if (reserveReconstructionExpected || platformIndexerDeclared) {
      add("blocker", "DATA_RECONSTRUCTION_REQUIRED_BY_PROJECT", "$.integration.dataReconstruction.mode", "The project declares custom accounting, claims, external liquidity or an indexer surface, so data reconstruction cannot be not-applicable.", "Choose events-only or events-with-confirmed-reads and bind the exact indexer, recovery and reconciliation evidence required by the declared surface.");
    }
  } else {
    requireDetailedText(dataReconstruction.eventCoverage, "$.integration.dataReconstruction.eventCoverage", "DATA_EVENT_COVERAGE_MISSING", add);
    if (dataReconstruction.cursor !== "block-number-transaction-index-log-index") add("blocker", "DATA_CURSOR_INVALID", "$.integration.dataReconstruction.cursor", "The indexer cursor does not preserve deterministic EVM log order.", "Order by block number, transaction index and log index, and keep the block hash in each checkpoint.");
    requireDetailedText(dataReconstruction.startBlockPolicy, "$.integration.dataReconstruction.startBlockPolicy", "DATA_START_BLOCK_POLICY_MISSING", add);
    if (!Number.isInteger(dataReconstruction.finalityDepth) || dataReconstruction.finalityDepth < 1) add("blocker", "DATA_FINALITY_POLICY_MISSING", "$.integration.dataReconstruction.finalityDepth", "The indexer has no positive finality depth.", "Set a chain-specific confirmation depth and test shallow and deeper reorganizations.");
    if (!resolvedText(dataReconstruction.reorgPolicy) || dataReconstruction.reorgPolicy.trim().length < 12) add("blocker", "DATA_REORG_POLICY_MISSING", "$.integration.dataReconstruction.reorgPolicy", "The indexer does not say how orphaned logs and derived rows are rolled back.", "Store checkpoint block hashes, find the last canonical ancestor, remove orphaned state and replay deterministically.");
    if (!resolvedText(dataReconstruction.backfillPolicy) || dataReconstruction.backfillPolicy.trim().length < 12) add("blocker", "DATA_BACKFILL_POLICY_MISSING", "$.integration.dataReconstruction.backfillPolicy", "The indexer does not define complete historical replay from deployment.", "Bind exact start blocks, bounded ranges, retry behavior and a no-skip cursor.");
    requireDetailedText(dataReconstruction.checkpointPolicy, "$.integration.dataReconstruction.checkpointPolicy", "DATA_CHECKPOINT_POLICY_MISSING", add);
    if (
      !Number.isInteger(dataReconstruction.freshnessTargetSeconds) ||
      !Number.isInteger(dataReconstruction.staleAfterSeconds) ||
      dataReconstruction.freshnessTargetSeconds < 1 ||
      dataReconstruction.staleAfterSeconds < dataReconstruction.freshnessTargetSeconds ||
      !resolvedText(dataReconstruction.freshnessMeasurement) ||
      dataReconstruction.freshnessMeasurement.trim().length < 12
    ) {
      add("blocker", "DATA_FRESHNESS_POLICY_MISSING", "$.integration.dataReconstruction", "The data contract has no coherent freshness target, stale threshold and measurement rule.", "Set positive target and stale thresholds, keep staleAfterSeconds at or above the target and expose lag from finalized chain state.");
    }
    requireDetailedText(dataReconstruction.reconciliation, "$.integration.dataReconstruction.reconciliation", "DATA_RECONCILIATION_POLICY_MISSING", add);

    if (reserveReconstruction.used !== reserveReconstructionExpected) {
      add("blocker", "RESERVE_RECONSTRUCTION_REQUIRED", "$.integration.dataReconstruction.reserveReconstruction.used", "The indexer reserve profile does not match the hook-held balances, PoolManager claims or custom liabilities in this design.", `Set used to ${reserveReconstructionExpected} and ${reserveReconstructionExpected ? "reconstruct gross balances, attributed liabilities and solvency" : "clear inactive reserve fields"}.`);
    }
    if (reserveReconstruction.used === true) {
      requireNonEmptyArray(reserveReconstruction.balanceSources, "$.integration.dataReconstruction.reserveReconstruction.balanceSources", "RESERVE_BALANCE_SOURCES_MISSING", "List the exact hook balances and PoolManager claim or credit sources observed at one confirmed block.", add);
      requireNonEmptyArray(reserveReconstruction.liabilitySources, "$.integration.dataReconstruction.reserveReconstruction.liabilitySources", "RESERVE_LIABILITY_SOURCES_MISSING", "List the exact events and contract reads that reconstruct beneficiary liabilities.", add);
      for (const dimension of ["poolId", "currency", "beneficiary"]) if (!(reserveReconstruction.attributionKeys ?? []).includes(dimension)) add("blocker", "RESERVE_ATTRIBUTION_KEY_INCOMPLETE", "$.integration.dataReconstruction.reserveReconstruction.attributionKeys", `Reserve attribution omits ${dimension}.`, "Keep hook-held assets and liabilities isolated by PoolId, currency and beneficiary.");
      requireDetailedText(reserveReconstruction.solvencyEquation, "$.integration.dataReconstruction.reserveReconstruction.solvencyEquation", "RESERVE_SOLVENCY_EQUATION_MISSING", add);
      if (reserveReconstruction.poolLiquidityTreatment !== "excluded-from-hook-reserves") add("blocker", "POOL_LIQUIDITY_COUNTED_AS_HOOK_RESERVE", "$.integration.dataReconstruction.reserveReconstruction.poolLiquidityTreatment", "Canonical pool liquidity is not a hook-owned reserve and cannot back hook liabilities.", "Exclude PoolManager pool liquidity; count only balances or claims legally and operationally attributable to the hook liability.");
      requireDetailedText(reserveReconstruction.donationAndDustPolicy, "$.integration.dataReconstruction.reserveReconstruction.donationAndDustPolicy", "RESERVE_DONATION_POLICY_MISSING", add);
      requireDetailedText(reserveReconstruction.reconciliation, "$.integration.dataReconstruction.reserveReconstruction.reconciliation", "RESERVE_RECONCILIATION_MISSING", add);
      gate("reserve-reconstruction-and-solvency-tests", "prototype", "The hook holds balances, claims or custom-accounting liabilities.");
    } else if (reserveReconstruction.used === false && hasConfiguredValue(reserveReconstruction, new Set(["used"]))) {
      add("blocker", "RESERVE_RECONSTRUCTION_DISABLED_CONFLICT", "$.integration.dataReconstruction.reserveReconstruction", "Reserve reconstruction is disabled but reserve sources or accounting rules remain configured.", "Clear every inactive field or enable and complete reserve reconstruction.");
    }

    for (const [field, role] of [
      ["sourcePaths", "data reconstruction source"],
      ["testPaths", "data reconstruction test"]
    ]) {
      const entries = dataReconstruction[field];
      if (stage === "prototype" && (!Array.isArray(entries) || entries.length === 0)) add("blocker", "DATA_RECONSTRUCTION_PATHS_MISSING", `$.integration.dataReconstruction.${field}`, "The prototype does not bind its indexer implementation and recovery tests.", "List repository-relative indexer source and executable reorg, backfill, freshness and reconciliation tests.");
      for (const [index, entry] of (entries ?? []).entries()) validateDeclaredPath(entry, `$.integration.dataReconstruction.${field}[${index}]`, role);
    }
    gate("event-reorg-backfill-freshness-tests", "prototype", "Public model state must be reproducible from events and confirmed reads.");
  }

  const platformHandoff = objectAt(integration, "platformHandoff");
  if (typeof platformHandoff.intended !== "boolean") add("blocker", "PLATFORM_HANDOFF_INTENT_UNRESOLVED", "$.integration.platformHandoff.intended", "The submission does not say whether it is intended for Programmable integration.", "Set intended explicitly; product paths remain a maintainer-owned plan until an exact prototype is accepted.");
  if (!platformHandoff.reviewStatus) add("blocker", "PLATFORM_REVIEW_STATUS_UNRESOLVED", "$.integration.platformHandoff.reviewStatus", "Maintainer review status is unresolved.", "Use not-requested or pending-maintainer-review; public submissions cannot record their own approval.");
  if (platformHandoff.maintainerReviewRequired !== true) add("blocker", "PLATFORM_MAINTAINER_REVIEW_REQUIRED", "$.integration.platformHandoff.maintainerReviewRequired", "The handoff does not preserve an independent Programmable maintainer decision.", "Set maintainerReviewRequired to true; preflight cannot accept or publish its own output.");
  if (platformHandoff.selfApproval === true) add("hard", "PLATFORM_SELF_APPROVAL_FORBIDDEN", "$.integration.platformHandoff.selfApproval", "A builder submission cannot approve its own registry or product integration.", "Set selfApproval to false and leave the final integration decision to Programmable maintainers.");
  else if (platformHandoff.selfApproval !== false) add("blocker", "PLATFORM_SELF_APPROVAL_UNRESOLVED", "$.integration.platformHandoff.selfApproval", "The handoff must explicitly deny self-approval.", "Set selfApproval to false.");
  if (platformHandoff.availabilityClaimed === true) add("hard", "PLATFORM_AVAILABILITY_CLAIM_FORBIDDEN", "$.integration.platformHandoff.availabilityClaimed", "A proposal or prototype cannot claim that a model is publicly available.", "Set availabilityClaimed to false; availability needs separate deployment, lifecycle, monitoring and production release evidence.");
  else if (platformHandoff.availabilityClaimed !== false) add("blocker", "PLATFORM_AVAILABILITY_CLAIM_UNRESOLVED", "$.integration.platformHandoff.availabilityClaimed", "The handoff must explicitly avoid a public availability claim.", "Set availabilityClaimed to false.");
  requireDetailedText(platformHandoff.handoffNotes, "$.integration.platformHandoff.handoffNotes", "PLATFORM_HANDOFF_NOTES_MISSING", add);
  if (stage === "prototype" && platformHandoff.intended !== true) add("blocker", "PROTOTYPE_PLATFORM_HANDOFF_MISSING", "$.integration.platformHandoff.intended", "A prototype submission does not bind the Programmable integration handoff.", "Set intended to true and describe the intended product surfaces in handoffNotes; repository paths remain optional contributor proposals until maintainer acceptance.");

  const platformPathRules = [
    ["websiteRegistryPath", platformHandoff.websiteRegistryPath ? [platformHandoff.websiteRegistryPath] : [], "website registry"],
    ["uiSourcePaths", platformHandoff.uiSourcePaths ?? [], "user-interface source"],
    ["apiSourcePaths", platformHandoff.apiSourcePaths ?? [], "API source"],
    ["indexerSourcePaths", platformHandoff.indexerSourcePaths ?? [], "indexer source"],
    ["testPaths", platformHandoff.testPaths ?? [], "platform integration test"]
  ];
  for (const [field, entries, role] of platformPathRules) {
    for (const [index, entry] of entries.entries()) validateDeclaredPath(entry, `$.integration.platformHandoff.${field}${field === "websiteRegistryPath" ? "" : `[${index}]`}`, role);
  }
  if (platformHandoff.intended === true) {
    gate("programmable-registry-integration-review", "candidate", "Only Programmable maintainers can add a model to the website registry.");
    if (includedSwapClient || (platformHandoff.uiSourcePaths?.length ?? 0) > 0) gate("programmable-ui-integration-review", "candidate", "Only Programmable maintainers can accept the proposed user-interface integration.");
    if ((platformHandoff.apiSourcePaths?.length ?? 0) > 0) gate("programmable-api-integration-review", "candidate", "Only Programmable maintainers can accept the proposed API integration.");
    if (dataReconstructionApplicable || (platformHandoff.indexerSourcePaths?.length ?? 0) > 0) gate("programmable-indexer-integration-review", "candidate", "Only Programmable maintainers can accept the proposed indexer integration.");
    if (
      includedSwapClient ||
      dataReconstructionApplicable ||
      (platformHandoff.testPaths?.length ?? 0) > 0
    ) gate("programmable-integration-test-review", "candidate", "Programmable maintainers must review the bound cross-surface tests before integration.");
  }

  analyzeProjectSurfaces(submission, {
    stage,
    add,
    gate,
    validateDeclaredPath
  });

  Object.assign(context, { dataReconstruction, dataReconstructionApplicable });
}
