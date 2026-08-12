import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { materializeExample } from "../example-materializer-core.mjs";
import { analyzeSubmission } from "../submission-core.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(testDirectory, "..", "..");
const schema = readJson(path.join(skillRoot, "references", "submission.schema.json"));

test("an explicit custom-curve profile is authoritative without English magic words", () => {
  const submission = customCurveProposal();
  submission.model.summary = "Der Vertrag berechnet den Preis direkt und vernichtet jede beim Verkauf zurueckgegebene Einheit.";
  submission.model.userOutcome = "Menschen beschreiben nur das gewuenschte Preis- und Burn-Verhalten; der Builder leitet die technische Architektur daraus ab.";
  submission.model.whyV4 = "Die Abrechnung geschieht direkt beim Tausch und zahlt nur aus einer fest gebundenen Reserve aus.";

  const report = analyzeSubmission(submission, { schema });

  assert.equal(
    hasFinding(report, "CUSTOM_CURVE_PROFILE_MISMATCH", "$.capabilities.customCurve.used"),
    false,
    JSON.stringify(report.findings)
  );
  assert.equal(
    report.findings.some(({ path: findingPath, remediation }) => (
      findingPath === "$.capabilities.customCurve.used" && /set used to false/i.test(remediation ?? "")
    )),
    false,
    "Structured capability truth must never be disabled merely because prose lacks a keyword."
  );
  assert.equal(report.risk.featureTriggers.includes("custom-curve"), true);
  assert.ok(report.requiredGates.some(({ id }) => id === "custom-curve-differential-and-invariant-tests"));
});

test("a reviewed full-consumption custom leg does not require classical starting liquidity", () => {
  const submission = customCurveProposal();
  submission.model.category = "contract-priced-reserve-launch";
  submission.pool.minimumInitialLiquidity = null;
  submission.launchPlan.targetStrategy = "reviewed-zero-amm-custom-accounting";
  submission.launchPlan.initialLiquidityRule = "Create no concentrated-liquidity position; bind and prove the PoolId-scoped reserve that backs every complete contract-priced leg.";
  submission.launchPlan.liquiditySourcePaths = [];
  submission.launchLifecycle.liquidityFormation = notApplicableLifecyclePhase(
    "The reviewed hook reserve supplies the complete contract-priced leg, so this model intentionally creates no concentrated-liquidity position."
  );
  submission.hook.customAccounting = completeCustomAccounting();
  submission.hook.returnDeltaAccounting = reviewedZeroAmmAccounting();

  const report = analyzeSubmission(submission, { schema });

  assert.equal(
    report.findings.some(({ code, path: findingPath }) => (
      findingPath === "$.pool.minimumInitialLiquidity" &&
      ["UNRESOLVED_DECISION", "MINIMUM_INITIAL_LIQUIDITY_UNRESOLVED", "SCHEMA_PATTERN"].includes(code)
    )),
    false,
    JSON.stringify(report.findings)
  );
  assert.equal(
    hasFinding(report, "MANDATORY_LIFECYCLE_PHASE_MISSING", "$.launchLifecycle.liquidityFormation.applicable"),
    false,
    JSON.stringify(report.findings)
  );
  assert.notEqual(report.decision, "UNSUPPORTED", JSON.stringify(report.findings));
  assert.ok(report.requiredGates.some(({ id }) => id === "novel-project-architecture-review"));
  assert.ok(report.requiredGates.some(({ id }) => id === "independent-mathematical-review"));
});

test("a transparent project hook fee above ten percent stays eligible for custom review", () => {
  const submission = customCurveProposal();
  Object.assign(submission.programmableFee.rates, {
    selectedBuyHundredthsOfBip: 200_000,
    selectedSellHundredthsOfBip: 200_000,
    effectiveBuyHundredthsOfBip: 200_000,
    effectiveSellHundredthsOfBip: 200_000,
    projectBuyHundredthsOfBip: 199_000,
    projectSellHundredthsOfBip: 199_000
  });

  const report = analyzeSubmission(submission, { schema });
  const ratePaths = new Set([
    "$.programmableFee.rates.selectedBuyHundredthsOfBip",
    "$.programmableFee.rates.selectedSellHundredthsOfBip",
    "$.programmableFee.rates.effectiveBuyHundredthsOfBip",
    "$.programmableFee.rates.effectiveSellHundredthsOfBip",
    "$.programmableFee.rates.projectBuyHundredthsOfBip",
    "$.programmableFee.rates.projectSellHundredthsOfBip"
  ]);

  assert.equal(
    report.findings.some(({ code }) => code === "PROGRAMMABLE_FEE_SELECTED_RATE_ABOVE_KERNEL_MAXIMUM"),
    false,
    JSON.stringify(report.findings)
  );
  assert.equal(
    report.findings.some(({ severity, path: findingPath }) => (
      ["blocker", "hard"].includes(severity) && ratePaths.has(findingPath)
    )),
    false,
    JSON.stringify(report.findings)
  );
  assert.notEqual(report.decision, "UNSUPPORTED", JSON.stringify(report.findings));
  assert.ok(
    report.requiredGates.some(({ id, stage }) => id === "custom-programmable-fee-review" && stage === "candidate"),
    "A fee outside the reference accelerator must route to custom review rather than become a product ban."
  );
});

test("an uncatalogued category and capability remain eligible with architecture review", () => {
  const submission = materializedProposal("dynamic-lp-fee");
  submission.model.category = "gravity-shifting-wallet-arena";
  submission.capabilityExtensions = [{
    capabilityId: "gravity-shift-reward",
    summary: "A signed arena outcome changes a bounded reward rule without granting the game server direct custody of pool or user funds.",
    interactionRefs: ["signed-arena-outcome", "bounded-reward-claim"],
    trustBoundary: "The external arena server may attest an outcome, but the onchain verifier independently enforces signer, replay, amount and expiry bounds.",
    failureMode: "An unavailable, stale, duplicated or invalid outcome produces no reward and cannot block ordinary swaps, claims or liquidity exits.",
    schemaPath: "game/gravity-shift-result.schema.json",
    sourcePaths: ["game/gravity-shift.ts", "src/GravityShiftVerifier.sol"],
    testPaths: ["test/GravityShiftVerifier.t.sol"],
    evidencePaths: ["evidence/gravity-shift-boundary.md"]
  }];
  submission.projectCapabilities.push({
    id: "gravity-shift-reward",
    kind: "signed-gravity-shift-reward",
    summary: "Represent a previously uncatalogued game mechanic with explicit trust, failure and source boundaries.",
    surfaceIds: [submission.projectSurfaces[0].id],
    securityTriggers: {
      authority: true,
      valueFlow: false,
      sourceOfTruth: true,
      signaturesReplay: true,
      externalCalls: false,
      custody: false,
      piiGeolocation: false,
      secretBoundary: false,
      sourceTestSchema: true,
      failureRecovery: true
    },
    requiredProfiles: [
      "authority",
      "failure-recovery",
      "signatures-replay",
      "source-of-truth",
      "source-test-schema"
    ]
  });
  submission.projectSurfaces[0].capabilityIds.push("gravity-shift-reward");

  const report = analyzeSubmission(submission, { schema });

  assert.notEqual(report.decision, "UNSUPPORTED", JSON.stringify(report.findings));
  assert.equal(
    report.findings.some(({ severity, path: findingPath }) => (
      ["blocker", "hard"].includes(severity) &&
      ["$.model.category", "$.capabilityExtensions[0]"].some((prefix) => findingPath.startsWith(prefix))
    )),
    false,
    JSON.stringify(report.findings)
  );
  assert.ok(report.findings.some(({ code }) => code === "NOVEL_PROJECT_CATEGORY_REQUIRES_ARCHITECTURE_REVIEW"));
  assert.ok(report.findings.some(({ code }) => code === "CAPABILITY_EXTENSION_REQUIRES_ARCHITECTURE_REVIEW"));
  assert.ok(report.requiredGates.some(({ id }) => id === "novel-project-architecture-review"));
  assert.ok(report.requiredGates.some(({ id }) => id === "novel-capability-architecture-review"));
});

test("multiple launched assets route to custom review instead of a one-token product ban", () => {
  const submission = materializedProposal("dynamic-lp-fee");
  submission.model.category = "multi-token-game-economy";
  const secondLaunchedAsset = structuredClone(submission.assets.find(({ role }) => role === "launched"));
  secondLaunchedAsset.id = "arena-reward-token";
  secondLaunchedAsset.initialSupply = "500000000000000000000000000";
  submission.assets.push(secondLaunchedAsset);

  const report = analyzeSubmission(submission, { schema });

  assert.equal(
    hasFinding(report, "LAUNCHED_ASSET_COUNT_INVALID", "$.assets"),
    false,
    JSON.stringify(report.findings)
  );
  assert.notEqual(report.decision, "UNSUPPORTED", JSON.stringify(report.findings));
  assert.ok(report.findings.some(({ code }) => code === "NOVEL_PROJECT_CATEGORY_REQUIRES_ARCHITECTURE_REVIEW"));
  assert.ok(report.requiredGates.some(({ id }) => id === "novel-project-architecture-review"));
});

function customCurveProposal() {
  const submission = materializedProposal("unsafe-hidden-curve", "hard-stop");
  submission.security.hiddenControls = false;
  return submission;
}

function materializedProposal(exampleId, stepId = null) {
  return materializeExample({ skillRoot, exampleId, stepId });
}

function reviewedZeroAmmAccounting() {
  return {
    used: true,
    quadrants: {
      zeroForOneExactInput: fullConsumptionQuadrant("currency0", "currency1", "negative-exact-input"),
      zeroForOneExactOutput: fullConsumptionQuadrant("currency1", "currency0", "positive-exact-output"),
      oneForZeroExactInput: fullConsumptionQuadrant("currency1", "currency0", "negative-exact-input"),
      oneForZeroExactOutput: fullConsumptionQuadrant("currency0", "currency1", "positive-exact-output")
    },
    executionEvent: "Emit PoolId, direction, exactness, executed custom amount, reserve delta, fee and final caller delta for each full-consumption leg."
  };
}

function fullConsumptionQuadrant(specifiedCurrency, unspecifiedCurrency, amountSign) {
  return {
    supported: true,
    specifiedCurrency,
    unspecifiedCurrency,
    amountSign,
    specifiedComponent: signedDeltaComponent("specified"),
    unspecifiedComponent: signedDeltaComponent("unspecified"),
    residualAmmEquation: "amountSpecified-plus-specifiedDelta",
    finalCallerDeltaEquation: "pool-manager-swap-delta-minus-hook-delta",
    specifiedDeltaCanConsumeEntireAmount: true,
    rounding: "Round against the hook while preserving exact PoolId-scoped reserve solvency and the final caller bound.",
    zeroAmmLeg: "allowed-reviewed",
    partialFillRule: "Charge and settle only the amount actually executed by the reviewed contract-pricing leg.",
    slippageInvariant: "The router checks the final caller delta after every hook delta and the mandatory Programmable fee.",
    failureRule: "Revert atomically if pricing, backing, settlement, fee or final caller-delta checks fail."
  };
}

function signedDeltaComponent(currency) {
  return {
    mode: "signed-bounded",
    formula: "Return only the bounded amount backed by the exact PoolId-scoped reserve and execution quote.",
    minimum: "No less than the sign-correct amount that can be settled atomically from proven backing.",
    maximum: "No greater than the sign-correct executed amount and the current backed reserve.",
    minimumSign: "negative",
    maximumSign: "positive",
    positiveSettlementActions: [settlementAction(1, "take", "negative", currency)],
    negativeSettlementActions: [
      settlementAction(1, "sync", "none", currency),
      settlementAction(2, "transfer-to-pool-manager", "none", currency),
      settlementAction(3, "settle", "positive", currency)
    ]
  };
}

function settlementAction(order, operation, deltaEffect, currency) {
  return {
    order,
    actor: "hook",
    operation,
    currency,
    assetKind: "erc20",
    deltaOwner: "hook",
    deltaEffect,
    counterparty: ["sync", "internal-ledger-update"].includes(operation) ? "not-applicable" : "PoolManager",
    authorizationRule: null,
    msgValueRule: null,
    amountRule: "Use exactly the amount required to settle or cancel this returned hook delta before callback completion.",
    completionDeadline: "before-hook-return"
  };
}

function completeCustomAccounting() {
  return {
    used: true,
    backingSource: "Every custom-priced output is backed before execution by an exact PoolId-scoped contract reserve.",
    conservationEquation: "For each currency, reserve balance plus settled PoolManager credit stays at least equal to every attributed user and beneficiary liability.",
    settlement: "Every returned delta is matched by the exact take, sync, transfer and settle sequence before the PoolManager unlock ends.",
    partialFillBehavior: "Only the actually executed contract-priced amount changes reserves, liabilities, fees and final caller deltas.",
    liabilityNamespace: "Every reserve and liability is keyed by chain, model version, PoolId, currency and beneficiary.",
    liabilityKeyDimensions: ["chainId", "modelVersion", "poolId", "currency", "beneficiary"],
    crossPoolNetting: false,
    duplicateCurrencyPolicy: "A shared currency balance never permits one PoolId to spend or claim another PoolId's attributed reserve.",
    failureIsolation: "Insufficient backing or failed settlement reverts the complete action without consuming another pool's reserve.",
    withdrawalOrdering: "A permitted withdrawal reduces only its exact attributed liability before transfer and restores it on atomic failure."
  };
}

function notApplicableLifecyclePhase(reason) {
  return {
    applicable: false,
    actor: null,
    valueFlow: null,
    custody: null,
    failure: null,
    event: null,
    notApplicableReason: reason
  };
}

function hasFinding(report, code, findingPath) {
  return report.findings.some((finding) => finding.code === code && finding.path === findingPath);
}

function readJson(target) {
  return JSON.parse(fs.readFileSync(target, "utf8"));
}
