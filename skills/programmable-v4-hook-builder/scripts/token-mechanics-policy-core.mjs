import { isObject } from "./submission-value-core.mjs";
import { requireResolvedText } from "./settlement-policy-core.mjs";

const placeholderPattern = /\\b(?:unresolved|unknown|tbd|todo|to be determined|not decided)\\b/i;
const knownAutoLiquidityFundingKinds = new Set([
  "transfer-tax-recipient",
  "launcher-allocation",
  "protocol-revenue",
  "donation",
  "external-deposit"
]);

export function validatePermissionlessTransferPolicy(policyInput, add) {
  const transferPolicy = isObject(policyInput) ? policyInput : {};
  for (const field of ["peerTransfersAllowed", "poolBuysAllowed", "poolSellsAllowed"]) {
    if (transferPolicy[field] !== true) add("hard", "HIDDEN_TRANSFER_OR_SELL_RESTRICTION", `$.noHookArchitecture.transferPolicy.${field}`, "The model can deny an ordinary transfer, pool buy or pool sell.", "Keep peer transfers, pool buys and pool sells permissionless; encode economic fees separately and transparently.");
  }
  for (const field of ["maxTransactionAmount", "maxWalletAmount", "cooldownSeconds"]) {
    if (transferPolicy[field] !== null) add("hard", "HIDDEN_TRANSFER_OR_SELL_RESTRICTION", `$.noHookArchitecture.transferPolicy.${field}`, "The model introduces an amount or time restriction that can prevent an otherwise valid transfer or sale.", "Set transaction, wallet and cooldown restrictions to null; use visible pricing, slippage and fee bounds instead.");
  }
  for (const field of ["allowlist", "denylist"]) {
    if (transferPolicy[field] !== false) add("hard", "HIDDEN_TRANSFER_OR_SELL_RESTRICTION", `$.noHookArchitecture.transferPolicy.${field}`, "The model introduces an address list that can prevent an ordinary transfer or sale.", "Disable token-level allowlists and denylists for this permissionless token-mechanics profile.");
  }
}

export function validateTransferTaxProfile({ submission, transferTax, autoLiquidity, add, gate }) {
  gate("transfer-tax-accounting-and-liveness-tests", "prototype", "The launched token charges an explicit transfer tax.");
  gate("transfer-tax-economic-review", "candidate", "A transfer tax changes the amount users and PoolManager counterparties receive.");
  gate("transfer-tax-provider-compatibility", "external", "Routing, quoting, indexing and listing support remain provider decisions for the exact token runtime.");

  const rates = ["buyHundredthsOfBip", "sellHundredthsOfBip", "peerTransferHundredthsOfBip"];
  if (!Number.isInteger(transferTax.maximumHundredthsOfBip)) add("blocker", "TRANSFER_TAX_MAXIMUM_MISSING", "$.noHookArchitecture.transferTax.maximumHundredthsOfBip", "The immutable maximum transfer-tax bound is unresolved.", "Set the exact maximum in hundredths of a basis point and test the endpoint.");
  for (const field of rates) {
    const rate = transferTax[field];
    if (!Number.isInteger(rate)) add("blocker", "TRANSFER_TAX_RATE_MISSING", `$.noHookArchitecture.transferTax.${field}`, "A buy, sell or peer-transfer tax rate is unresolved.", "Set every current rate explicitly, including zero.");
    if (Number.isInteger(rate) && Number.isInteger(transferTax.maximumHundredthsOfBip) && rate > transferTax.maximumHundredthsOfBip) add("blocker", "TRANSFER_TAX_RATE_ABOVE_MAXIMUM", `$.noHookArchitecture.transferTax.${field}`, "A current transfer-tax rate exceeds its declared immutable maximum.", "Lower the rate or raise and disclose the immutable maximum before review.");
  }
  if (Number.isInteger(transferTax.maximumHundredthsOfBip) && transferTax.maximumHundredthsOfBip >= 1000000) add("hard", "CONFISCATORY_TRANSFER_TAX_BOUND", "$.noHookArchitecture.transferTax.maximumHundredthsOfBip", "The transfer-tax bound can consume the complete transferred amount.", "Set an immutable maximum below 100 percent so every permitted transfer delivers a nonzero amount.");
  if (Number.isInteger(transferTax.maximumHundredthsOfBip) && transferTax.maximumHundredthsOfBip > 100000) add("warning", "HIGH_TRANSFER_TAX_BOUND", "$.noHookArchitecture.transferTax.maximumHundredthsOfBip", "The declared maximum transfer tax exceeds 10 percent.", "Keep the exact bound prominent in every quote and launch disclosure and obtain focused economic review.");

  if (typeof transferTax.mutable !== "boolean") add("blocker", "TRANSFER_TAX_MUTABILITY_UNRESOLVED", "$.noHookArchitecture.transferTax.mutable", "Transfer-tax mutability is unresolved.", "State whether current rates or recipients can change.");
  const authorities = submission.authorities ?? [];
  const authorityRoles = new Set(authorities.map((authority) => authority?.role));
  if (transferTax.mutable === true) {
    if (!resolvedText(transferTax.authorityRole) || !authorityRoles.has(transferTax.authorityRole)) add("blocker", "TRANSFER_TAX_AUTHORITY_MISSING", "$.noHookArchitecture.transferTax.authorityRole", "Mutable transfer-tax fields are not bound to one declared authority role.", "Name an exact role from authorities and describe its bounded capabilities and user-exit impact.");
    const authority = authorities.find((candidate) => candidate?.role === transferTax.authorityRole);
    if (authority && (authority.mutable !== true || !/(?:tax|fee|recipient)/i.test((authority.capabilities ?? []).join(" ")))) add("blocker", "TRANSFER_TAX_AUTHORITY_SCOPE_MISMATCH", "$.noHookArchitecture.transferTax.authorityRole", "The referenced authority does not explicitly expose the bounded mutable tax or recipient capability.", "Set the authority record mutable and name the exact fee, maximum and recipient capabilities it may change.");
    requireDetailedText(transferTax.changeDelay, "$.noHookArchitecture.transferTax.changeDelay", "TRANSFER_TAX_DELAY_MISSING", add);
    gate("transfer-tax-authority-and-timelock-review", "candidate", "Transfer-tax configuration remains mutable within the declared maximum.");
  } else if (transferTax.authorityRole !== null || transferTax.changeDelay !== null) {
    add("blocker", "IMMUTABLE_TRANSFER_TAX_AUTHORITY_CONFLICT", "$.noHookArchitecture.transferTax", "An immutable transfer tax still declares a configuration authority or delay.", "Set authorityRole and changeDelay to null or mark the actual bounded configuration mutable.");
  }

  const recipients = Array.isArray(transferTax.recipients) ? transferTax.recipients : [];
  if (recipients.length === 0) add("blocker", "TRANSFER_TAX_RECIPIENTS_MISSING", "$.noHookArchitecture.transferTax.recipients", "Transfer-tax proceeds have no explicit recipients.", "List every destination and make recipient shares sum to 10000 basis points.");
  const recipientIds = new Set();
  let recipientShare = 0;
  for (const [index, recipient] of recipients.entries()) {
    if (recipientIds.has(recipient?.id)) add("blocker", "TRANSFER_TAX_RECIPIENT_DUPLICATE", `$.noHookArchitecture.transferTax.recipients[${index}].id`, "Transfer-tax recipient ids must be unique.", "Give every destination one stable recipient id.");
    recipientIds.add(recipient?.id);
    recipientShare += Number.isInteger(recipient?.shareBps) ? recipient.shareBps : 0;
    requireResolvedText(recipient?.destination, `$.noHookArchitecture.transferTax.recipients[${index}].destination`, "TRANSFER_TAX_RECIPIENT_UNRESOLVED", add);
  }
  if (recipients.length > 0 && recipientShare !== 10000) add("blocker", "TRANSFER_TAX_RECIPIENT_SHARE_MISMATCH", "$.noHookArchitecture.transferTax.recipients", `Transfer-tax recipient shares sum to ${recipientShare}, not 10000 basis points.`, "Make the exact recipient allocation conserve 100 percent of collected tax.");
  validateValueFlowReferences(transferTax.recipientValueFlowIds, submission.valueFlows, "$.noHookArchitecture.transferTax.recipientValueFlowIds", "TRANSFER_TAX_VALUE_FLOW", add);
  requireDetailedText(transferTax.event, "$.noHookArchitecture.transferTax.event", "TRANSFER_TAX_EVENT_MISSING", add);
  requireDetailedText(transferTax.failureRule, "$.noHookArchitecture.transferTax.failureRule", "TRANSFER_TAX_FAILURE_RULE_MISSING", add);
  if (typeof transferTax.appliesToPoolManagerTransfers !== "boolean") add("blocker", "TRANSFER_TAX_POOLMANAGER_SCOPE_UNRESOLVED", "$.noHookArchitecture.transferTax.appliesToPoolManagerTransfers", "The tax scope for PoolManager settlement transfers is unresolved.", "State whether transfers to or from PoolManager are taxed and test requested-versus-received amounts in both directions.");
  if (!transferTax.poolManagerTransferPolicy) add("blocker", "TRANSFER_TAX_POOLMANAGER_CLASSIFICATION_UNRESOLVED", "$.noHookArchitecture.transferTax.poolManagerTransferPolicy", "The token does not say how shared PoolManager ingress and egress are classified.", "Choose the honest all-ingress/egress policy, a complete exemption, or an exact separately reviewed counterparty classifier.");
  if (transferTax.poolManagerTransferPolicy === "tax-all-ingress-egress" && transferTax.appliesToPoolManagerTransfers !== true) add("blocker", "TRANSFER_TAX_POOLMANAGER_POLICY_MISMATCH", "$.noHookArchitecture.transferTax.poolManagerTransferPolicy", "The declared all-ingress/egress tax policy contradicts the PoolManager transfer scope.", "Set appliesToPoolManagerTransfers true or choose the actual policy.");
  if (transferTax.poolManagerTransferPolicy === "exempt-all-poolmanager-transfers" && transferTax.appliesToPoolManagerTransfers !== false) add("blocker", "TRANSFER_TAX_POOLMANAGER_POLICY_MISMATCH", "$.noHookArchitecture.transferTax.poolManagerTransferPolicy", "The declared PoolManager exemption contradicts the PoolManager transfer scope.", "Set appliesToPoolManagerTransfers false or choose the actual policy.");
  for (const field of ["liquidityOperationTreatment", "alternativePoolTreatment"]) requireDetailedText(transferTax[field], `$.noHookArchitecture.transferTax.${field}`, "TRANSFER_TAX_POOLMANAGER_CLASSIFICATION_INCOMPLETE", add);
  if (transferTax.poolManagerTransferPolicy === "exact-reviewed-counterparty-classifier") gate("transfer-tax-counterparty-classifier-review", "candidate", "The token attempts to distinguish PoolManager actions through an exact router, Permit2 or counterparty classifier that needs independent spoofing and upgrade review.");

  const requiredTests = [
    "buy-sell-peer-tax-rates",
    "zero-tax-path",
    "immutable-maximum-tax-bound",
    "recipient-split-conservation",
    "exemption-boundaries",
    "poolmanager-requested-versus-received",
    "poolmanager-liquidity-and-alternative-pool-classification",
    "quote-execution-received-amount",
    "unrestricted-buy-sell-transfer-liveness"
  ];
  if (transferTax.mutable === true) requiredTests.push("authority-and-delay");
  requireTestScenarios(submission.noHookArchitecture?.testScenarios, requiredTests, add);
}

export function validateAutoLiquidityProfile({ submission, transferTax, autoLiquidity, add, gate }) {
  gate("auto-liquidity-lifecycle-and-reentrancy-tests", "prototype", "The token automatically swaps or adds liquidity from one or more declared funding balances.");
  gate("auto-liquidity-custody-and-exit-review", "candidate", "The model creates and custodies liquidity through token-controlled execution.");
  validateAutoLiquidityFundingSources({ submission, transferTax, autoLiquidity, add, gate });
  if (!["permissionless-explicit-call", "eligible-non-pool-transfer", "custom-reviewed"].includes(autoLiquidity.triggerMode)) add("blocker", "AUTO_LIQUIDITY_TRIGGER_MODE_UNRESOLVED", "$.noHookArchitecture.autoLiquidity.triggerMode", "The automatic liquidity trigger path is unresolved.", "Use a known trigger or custom-reviewed, then test its exact authorization, replay, threshold, failure and gas boundaries.");
  if (autoLiquidity.triggerMode === "custom-reviewed") gate("custom-auto-liquidity-trigger-review", "candidate", "A custom auto-liquidity trigger needs architecture review of its authorization, replay, gas, reentrancy and failure boundaries.");
  if (autoLiquidity.triggerMode === "custom-reviewed" && !["separate-explicit-action", "embedded-user-transfer"].includes(autoLiquidity.triggerExecutionBoundary)) add("blocker", "AUTO_LIQUIDITY_CUSTOM_TRIGGER_BOUNDARY_UNRESOLVED", "$.noHookArchitecture.autoLiquidity.triggerExecutionBoundary", "The custom trigger does not state whether it is a separate action or embedded in a user transfer.", "Choose separate-explicit-action or embedded-user-transfer so failure atomicity can be checked without interpreting prose.");
  if (autoLiquidity.triggerMode !== "custom-reviewed" && autoLiquidity.triggerExecutionBoundary !== null && autoLiquidity.triggerExecutionBoundary !== undefined) add("blocker", "AUTO_LIQUIDITY_TRIGGER_BOUNDARY_CONFLICT", "$.noHookArchitecture.autoLiquidity.triggerExecutionBoundary", "A known trigger mode also declares a custom execution boundary.", "Set triggerExecutionBoundary to null for known modes; their execution boundary is fixed by triggerMode.");
  if (autoLiquidity.poolTransferSuppression !== true) add("hard", "AUTO_LIQUIDITY_POOL_TRANSFER_REENTRANCY", "$.noHookArchitecture.autoLiquidity.poolTransferSuppression", "Automatic liquidity may execute while PoolManager or a router is settling the transfer that triggered it.", "Suppress automatic execution during pool and router transfers; settle the user action first and use the declared safe trigger path.");
  if (autoLiquidity.reentrancyGuard !== true) add("hard", "AUTO_LIQUIDITY_REENTRANCY_GUARD_MISSING", "$.noHookArchitecture.autoLiquidity.reentrancyGuard", "The router and position lifecycle can reenter token transfer logic without an explicit guard.", "Use one bounded execution lock and test callback, token and cross-function reentrancy.");
  const transferEmbeddedTrigger = autoLiquidity.triggerMode === "eligible-non-pool-transfer"
    || (autoLiquidity.triggerMode === "custom-reviewed" && autoLiquidity.triggerExecutionBoundary === "embedded-user-transfer");
  const separateExplicitTrigger = autoLiquidity.triggerMode === "permissionless-explicit-call"
    || (autoLiquidity.triggerMode === "custom-reviewed" && autoLiquidity.triggerExecutionBoundary === "separate-explicit-action");
  const transferContinuingFailurePolicies = new Set(["continue-transfer", "defer-and-continue-trigger"]);
  if (transferEmbeddedTrigger && !transferContinuingFailurePolicies.has(autoLiquidity.underlyingTransferFailurePolicy)) add("hard", "AUTO_LIQUIDITY_CAN_BLOCK_TRANSFER", "$.noHookArchitecture.autoLiquidity.underlyingTransferFailurePolicy", "An automatic-liquidity failure can block the otherwise valid user transfer that triggered it.", "Use continue-transfer or defer-and-continue-trigger so failed automatic work remains retryable without trapping the user transfer.");
  if (autoLiquidity.underlyingTransferFailurePolicy === "atomic-revert-explicit-call" && !separateExplicitTrigger && !transferEmbeddedTrigger) add("blocker", "AUTO_LIQUIDITY_ATOMIC_REVERT_TRIGGER_MISMATCH", "$.noHookArchitecture.autoLiquidity.underlyingTransferFailurePolicy", "Atomic revert is safe only for a separate explicit action, not for an unresolved trigger.", "Declare a separate explicit execution boundary, or use a transfer-continuing failure policy.");
  if (!["continue-transfer", "defer-and-continue-trigger", "atomic-revert-explicit-call"].includes(autoLiquidity.underlyingTransferFailurePolicy)) add("blocker", "AUTO_LIQUIDITY_FAILURE_POLICY_UNRESOLVED", "$.noHookArchitecture.autoLiquidity.underlyingTransferFailurePolicy", "The automatic-liquidity failure boundary is unresolved.", "Choose a transfer-continuing policy, or atomic-revert-explicit-call only for a separate permissionless explicit action; custom triggers remain subject to architecture review.");
  for (const field of ["triggerThreshold", "maximumSwapAmount"]) {
    if (!/^[0-9]+$/.test(autoLiquidity[field] ?? "") || autoLiquidity[field] === "0") add("blocker", "AUTO_LIQUIDITY_BOUND_MISSING", `$.noHookArchitecture.autoLiquidity.${field}`, "An auto-liquidity base-unit bound is unresolved or zero.", "Set one exact positive integer bound in launched-token base units.");
    if (/^[0-9]+$/.test(autoLiquidity[field] ?? "") && BigInt(autoLiquidity[field]) > (2n ** 256n - 1n)) add("blocker", "AUTO_LIQUIDITY_BOUND_UINT256_OVERFLOW", `$.noHookArchitecture.autoLiquidity.${field}`, "An auto-liquidity base-unit bound does not fit uint256.", "Choose a positive integer no greater than 2^256 minus 1.");
  }
  if (/^[0-9]+$/.test(autoLiquidity.triggerThreshold ?? "") && /^[0-9]+$/.test(autoLiquidity.maximumSwapAmount ?? "") && BigInt(autoLiquidity.maximumSwapAmount) > BigInt(autoLiquidity.triggerThreshold)) add("blocker", "AUTO_LIQUIDITY_SWAP_ABOVE_THRESHOLD", "$.noHookArchitecture.autoLiquidity.maximumSwapAmount", "One automatic swap can exceed the balance threshold that triggered it.", "Cap each swap at or below the trigger threshold and test surplus balances separately.");
  if (!Number.isInteger(autoLiquidity.slippageHundredthsOfBip) || autoLiquidity.slippageHundredthsOfBip >= 1000000) add("blocker", "AUTO_LIQUIDITY_SLIPPAGE_BOUND_INVALID", "$.noHookArchitecture.autoLiquidity.slippageHundredthsOfBip", "Auto-liquidity slippage is unresolved or permits total loss of the quoted leg.", "Set an explicit slippage bound below 100 percent and enforce it against final received amounts.");
  if (!Number.isInteger(autoLiquidity.deadlineSeconds)) add("blocker", "AUTO_LIQUIDITY_DEADLINE_MISSING", "$.noHookArchitecture.autoLiquidity.deadlineSeconds", "Auto-liquidity has no finite execution deadline.", "Set and test one finite deadline in seconds.");
  for (const field of ["executionActor", "custody", "lpPositionCustodian", "exitPolicy", "emergencyRecovery", "event", "failureRule"]) requireDetailedText(autoLiquidity[field], `$.noHookArchitecture.autoLiquidity.${field}`, "AUTO_LIQUIDITY_PROFILE_INCOMPLETE", add);
  if (typeof autoLiquidity.lpPositionTransferable !== "boolean") add("blocker", "AUTO_LIQUIDITY_LP_TRANSFERABILITY_UNRESOLVED", "$.noHookArchitecture.autoLiquidity.lpPositionTransferable", "LP position transferability is unresolved.", "State who may transfer the position and how that affects creator and holder exit claims.");
  if (typeof autoLiquidity.mutable !== "boolean") add("blocker", "AUTO_LIQUIDITY_MUTABILITY_UNRESOLVED", "$.noHookArchitecture.autoLiquidity.mutable", "Auto-liquidity configuration mutability is unresolved.", "State whether thresholds, swap bounds, custody or execution actors can change.");
  const authorities = submission.authorities ?? [];
  const authorityRoles = new Set(authorities.map((authority) => authority?.role));
  if (autoLiquidity.mutable === true && (!resolvedText(autoLiquidity.authorityRole) || !authorityRoles.has(autoLiquidity.authorityRole))) add("blocker", "AUTO_LIQUIDITY_AUTHORITY_MISSING", "$.noHookArchitecture.autoLiquidity.authorityRole", "Mutable auto-liquidity configuration is not bound to one declared authority role.", "Reference an exact role from authorities and disclose its custody and user-exit impact.");
  const authority = authorities.find((candidate) => candidate?.role === autoLiquidity.authorityRole);
  if (autoLiquidity.mutable === true && authority && authority.mutable !== true) add("blocker", "AUTO_LIQUIDITY_AUTHORITY_SCOPE_MISMATCH", "$.noHookArchitecture.autoLiquidity.authorityRole", "The referenced authority is not declared mutable even though it controls mutable auto-liquidity configuration.", "Set the referenced authority record mutable and keep its exact bounded capabilities, delay and user-exit impact explicit in the structured authority record.");
  if (autoLiquidity.mutable === true && authority) requireDetailedText(authority.delay, `$.authorities[${authorities.indexOf(authority)}].delay`, "AUTO_LIQUIDITY_AUTHORITY_DELAY_MISSING", add);
  if (autoLiquidity.mutable !== true && autoLiquidity.authorityRole !== null) add("blocker", "IMMUTABLE_AUTO_LIQUIDITY_AUTHORITY_CONFLICT", "$.noHookArchitecture.autoLiquidity.authorityRole", "Immutable auto-liquidity still declares a configuration authority.", "Set authorityRole to null or declare the actual bounded configuration mutable.");
  validateValueFlowReferences(autoLiquidity.valueFlowIds, submission.valueFlows, "$.noHookArchitecture.autoLiquidity.valueFlowIds", "AUTO_LIQUIDITY_VALUE_FLOW", add);
  requireTestScenarios(submission.noHookArchitecture?.testScenarios, [
    "auto-liquidity-threshold-boundaries",
    "auto-liquidity-maximum-swap-bound",
    "auto-liquidity-slippage-and-deadline",
    "auto-liquidity-reentrancy",
    "auto-liquidity-failure-atomicity",
    "lp-custody-and-exit"
  ], add);
  if (submission.capabilities?.externalCalls?.used !== true) add("blocker", "AUTO_LIQUIDITY_EXTERNAL_CALL_PROFILE_MISSING", "$.capabilities.externalCalls.used", "Auto-liquidity executes router or position-manager calls without the structured external-call policy.", "Enable externalCalls and document exact targets, call sites, return checks, reentrancy, state drift and failure atomicity.");
}

function validateAutoLiquidityFundingSources({ submission, transferTax, autoLiquidity, add, gate }) {
  const sources = Array.isArray(autoLiquidity.fundingSources) ? autoLiquidity.fundingSources : [];
  const assetIds = new Set((submission.assets ?? []).map((asset) => asset?.id));
  const authorityRoles = new Set((submission.authorities ?? []).map((authority) => authority?.role));
  const valueFlows = submission.valueFlows ?? [];
  const recipientIds = new Set((transferTax.recipients ?? []).map((recipient) => recipient?.id));
  const sourceIds = new Set();
  if (sources.length === 0) add("blocker", "AUTO_LIQUIDITY_FUNDING_SOURCE_MISSING", "$.noHookArchitecture.autoLiquidity.fundingSources", "Auto-liquidity has no explicit source of funds.", "Declare every funding source with its origin, value flow, custody, accounting, limit, withdrawal and failure rules.");
  for (const [index, source] of sources.entries()) {
    const sourcePath = `$.noHookArchitecture.autoLiquidity.fundingSources[${index}]`;
    if (sourceIds.has(source?.id)) add("blocker", "AUTO_LIQUIDITY_FUNDING_SOURCE_DUPLICATE", `${sourcePath}.id`, "Auto-liquidity funding-source ids must be unique.", "Give each economically distinct funding source one stable id.");
    sourceIds.add(source?.id);
    if (!knownAutoLiquidityFundingKinds.has(source?.kind)) {
      add("warning", "AUTO_LIQUIDITY_FUNDING_KIND_REQUIRES_ARCHITECTURE_REVIEW", `${sourcePath}.kind`, `Funding kind ${source?.kind ?? "without a kind"} remains valid outside the acceleration catalog.`, "Keep the open kind and review its exact provenance, authority, accounting, custody, withdrawal and failure boundaries.");
      gate("novel-auto-liquidity-funding-architecture-review", "candidate", "At least one automatic-liquidity funding source is outside the acceleration catalog.");
    }
    if (!assetIds.has(source?.assetId)) add("blocker", "AUTO_LIQUIDITY_FUNDING_ASSET_UNKNOWN", `${sourcePath}.assetId`, "The funding source references an unknown asset.", "Use one declared asset id and account for any conversion separately.");
    if (source?.authorityRole !== null && !authorityRoles.has(source?.authorityRole)) add("blocker", "AUTO_LIQUIDITY_FUNDING_AUTHORITY_UNKNOWN", `${sourcePath}.authorityRole`, "The funding source references an unknown authority.", "Bind the exact controller in authorities or use null for a genuinely permissionless source.");
    validateValueFlowReferences(source?.valueFlowIds, valueFlows, `${sourcePath}.valueFlowIds`, "AUTO_LIQUIDITY_FUNDING_VALUE_FLOW", add);
    for (const field of ["source", "custody", "accountingRule", "fundingLimit", "withdrawalRule", "failureRule"]) requireDetailedText(source?.[field], `${sourcePath}.${field}`, "AUTO_LIQUIDITY_FUNDING_PROFILE_INCOMPLETE", add);
    if (source?.kind === "transfer-tax-recipient") {
      if (transferTax.used !== true) add("blocker", "AUTO_LIQUIDITY_TAX_SOURCE_WITHOUT_TAX", sourcePath, "A transfer-tax funding source is declared while transfer tax is disabled.", "Enable and complete transferTax or use the actual non-tax funding kind.");
      if (!recipientIds.has(source?.transferTaxRecipientId)) add("blocker", "AUTO_LIQUIDITY_FUNDING_RECIPIENT_MISSING", `${sourcePath}.transferTaxRecipientId`, "The funding source does not reference a declared transfer-tax recipient bucket.", "Use one exact recipient id from transferTax.recipients and bind its value flow.");
    } else if (source?.transferTaxRecipientId !== null) {
      add("blocker", "AUTO_LIQUIDITY_NON_TAX_RECIPIENT_CONFLICT", `${sourcePath}.transferTaxRecipientId`, "A non-tax funding source retains a transfer-tax recipient id.", "Set transferTaxRecipientId to null and document the actual source and accounting rule.");
    }
  }
}

export function validateNoHookProviderProfile({ submission, profile, transferTax, autoLiquidity, hookUsed, add, gate }) {
  const provider = objectAt(profile, "providerCompatibility");
  for (const field of ["routing", "quoting", "indexing", "fallback"]) requireDetailedText(provider[field], `$.noHookArchitecture.providerCompatibility.${field}`, "NO_HOOK_PROVIDER_PROFILE_INCOMPLETE", add);
  requireNonEmptyArray(provider.limitations, "$.noHookArchitecture.providerCompatibility.limitations", "NO_HOOK_PROVIDER_LIMITS_MISSING", "List every known routing, quote, received-amount, indexing and listing limitation.", add);
  if (!provider.status) add("blocker", "NO_HOOK_PROVIDER_STATUS_UNRESOLVED", "$.noHookArchitecture.providerCompatibility.status", "External provider support is unresolved.", "Use unknown, unsupported, requires-provider-review or confirmed-external without claiming Programmable controls the provider.");
  if (provider.status === "confirmed-external" && (provider.evidence?.length ?? 0) === 0) add("blocker", "NO_HOOK_PROVIDER_EVIDENCE_MISSING", "$.noHookArchitecture.providerCompatibility.evidence", "Confirmed external support has no exact evidence reference.", "Add provider-owned documentation or an attributable approval record for the exact token runtime and chain.");
  if (provider.status !== "confirmed-external" && (provider.evidence?.length ?? 0) > 0) add("warning", "NO_HOOK_PROVIDER_EVIDENCE_UNCONFIRMED", "$.noHookArchitecture.providerCompatibility.evidence", "Provider evidence is attached while support remains unconfirmed.", "Keep the limitation visible and do not present documentation or a canary as approval.");
  if (transferTax.used === true && transferTax.appliesToPoolManagerTransfers === true && submission.integration?.routingAndDiscoverability?.standardRouterCompatible === true) add("blocker", "TRANSFER_TAX_STANDARD_ROUTER_CLAIM_UNPROVEN", "$.integration.routingAndDiscoverability.standardRouterCompatible", "A PoolManager transfer tax cannot self-attest generic standard-router quote and received-amount compatibility.", "Set standardRouterCompatible to false, bind the exact tested client path, and keep each external provider behind its own review gate.");
  if (transferTax.used === true || autoLiquidity.used === true) {
    gate(
      hookUsed === false ? "independent-no-hook-provider-approval" : "independent-token-mechanics-provider-approval",
      "external",
      "Programmable checks cannot guarantee aggregator, interface, indexer or listing support for model-specific token mechanics."
    );
  }
}

function validateValueFlowReferences(references, valueFlows, path, codePrefix, add) {
  const declared = new Set((valueFlows ?? []).map((flow) => flow?.id));
  if (!Array.isArray(references) || references.length === 0) add("blocker", `${codePrefix}_MISSING`, path, "The mechanic has no referenced value-flow records.", "Reference every collection, conversion, liquidity, recipient, custody and failure flow by stable id.");
  for (const [index, reference] of (references ?? []).entries()) if (!declared.has(reference)) add("blocker", `${codePrefix}_UNKNOWN`, `${path}[${index}]`, `Value-flow id ${reference} is not declared.`, "Add the exact flow or fix the reference.");
}

function requireTestScenarios(actual, required, add) {
  const declared = new Set(actual ?? []);
  for (const scenario of required) if (!declared.has(scenario)) add("blocker", "NO_HOOK_TEST_SCENARIO_MISSING", "$.noHookArchitecture.testScenarios", `Required token-mechanics test scenario ${scenario} is missing.`, "Add the scenario and bind executable evidence before prototype readiness.");
}

export function hasConfiguredValue(value, ignoredKeys = new Set()) {
  if (value === null || value === false || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (!isObject(value)) return true;
  return Object.entries(value).some(([key, child]) => !ignoredKeys.has(key) && hasConfiguredValue(child));
}


function resolvedText(value) {
  return typeof value === "string" && value.trim().length > 0 && !placeholderPattern.test(value);
}

function requireDetailedText(value, path, code, add) {
  if (!resolvedText(value) || value.trim().length < 12) add("blocker", code, path, "Required design text is missing, vague or contains a placeholder.", "Replace it with a specific, testable statement of at least one complete phrase.");
}

function requireNonEmptyArray(value, path, code, remediation, add) {
  if (!Array.isArray(value) || value.length === 0 || value.some((entry) => !resolvedText(entry))) add("blocker", code, path, "A required capability list is empty or unresolved.", remediation);
}

function objectAt(parent, key) {
  return isObject(parent?.[key]) ? parent[key] : {};
}
