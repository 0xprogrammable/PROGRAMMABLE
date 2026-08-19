const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const BYTES32 = /^0x[0-9a-fA-F]{64}$/u;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;
const GIT_OBJECT = /^[0-9a-f]{40}$/u;
const UINT = /^(0|[1-9][0-9]{0,77})$/u;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const DURATION = /^P(?:[0-9]+D)?(?:T(?=[0-9])(?:[0-9]+H)?(?:[0-9]+M)?(?:[0-9]+S)?)?$/u;

export const SWAP_MODE_IDS_V1 = Object.freeze([
  "zero-for-one-exact-input",
  "zero-for-one-exact-output",
  "one-for-zero-exact-input",
  "one-for-zero-exact-output"
]);

export const APPLICANT_GATE_IDS_V1 = Object.freeze([
  "A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "A9", "A10", "A11"
]);

export const PLATFORM_GATE_IDS_V1 = Object.freeze([
  "P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8", "P9"
]);

export const TEST_EVIDENCE_OUTCOMES_V1 = Object.freeze([
  "passed",
  "failed",
  "tooling-blocked",
  "no-data",
  "inconclusive",
  "not-applicable-with-reason"
]);

export const PERMIT2_LAUNCH_WITNESS_TYPE_STRING_V1 = "LaunchWitness witness)LaunchWitness(string applicationId,string revisionObjectId,string action,string launchConfigurationSha256,string poolKeySha256,address hook,address router,address beneficiary,address recipient,address refundRecipient,address transactionTarget,bytes4 transactionSelector,string transactionDataSha256,uint256 nativeValue,string payerIntentSha256)TokenPermissions(address token,uint256 amount)";

export function validateSwapModeClassificationV1(input) {
  const errors = [];
  const add = reporter(errors);
  exactObject(input, ["schemaVersion", "subject", "modes"], "$", add);
  equal(input?.schemaVersion, "1.0.0", "$.schemaVersion", add);
  validateSubject(input?.subject, "$.subject", add, [
    "applicationId", "revisionObjectId", "treeObjectId", "chainId", "marketRef", "poolKeySha256"
  ]);
  pattern(input?.subject?.applicationId, SLUG, "$.subject.applicationId", add);
  pattern(input?.subject?.marketRef, SLUG, "$.subject.marketRef", add);
  pattern(input?.subject?.poolKeySha256, SHA256, "$.subject.poolKeySha256", add);
  if (!Array.isArray(input?.modes) || input.modes.length !== 4) {
    add("$.modes", "must contain exactly the four direction/exactness quadrants");
    return errors;
  }
  const seen = new Set();
  for (const [index, mode] of input.modes.entries()) {
    const path = `$.modes[${index}]`;
    exactObject(mode, ["id", "direction", "exactness", "disposition", "supportedProof", "rejectionProof"], path, add);
    oneOf(mode?.id, SWAP_MODE_IDS_V1, `${path}.id`, add);
    const expectedId = `${mode?.direction}-${mode?.exactness}`;
    if (mode?.id !== expectedId) add(`${path}.id`, "must equal the declared direction and exactness");
    if (seen.has(mode?.id)) add(`${path}.id`, "must not repeat a quadrant");
    seen.add(mode?.id);
    oneOf(mode?.disposition, ["supported", "rejected"], `${path}.disposition`, add);
    if (mode?.disposition === "supported") {
      if (mode.rejectionProof !== null) add(`${path}.rejectionProof`, "must be null for a supported mode");
      validateSupportedProof(mode.supportedProof, `${path}.supportedProof`, add);
    } else if (mode?.disposition === "rejected") {
      if (mode.supportedProof !== null) add(`${path}.supportedProof`, "must be null for a rejected mode");
      validateRejectionProof(mode.rejectionProof, `${path}.rejectionProof`, add);
    }
  }
  for (const id of SWAP_MODE_IDS_V1) if (!seen.has(id)) add("$.modes", `is missing ${id}`);
  return errors;
}

export function validateDelegatedPayerSponsorIntentV1(input) {
  const errors = [];
  const add = reporter(errors);
  exactObject(input, [
    "schemaVersion", "intentId", "fundingRole", "payer", "authorizedCaller", "beneficiary",
    "refundRecipient", "chainId", "verifyingContract", "spender", "action", "token", "amountMode",
    "amount", "launchConfigurationSha256", "poolKeySha256", "hook", "router", "nonce", "validAfter",
    "deadline", "residualAllowanceDisposition", "sponsorPolicySha256", "authorization"
  ], "$", add);
  equal(input?.schemaVersion, "1.0.0", "$.schemaVersion", add);
  pattern(input?.intentId, BYTES32, "$.intentId", add);
  oneOf(input?.fundingRole, ["delegated-payer", "sponsor"], "$.fundingRole", add);
  for (const field of ["payer", "authorizedCaller", "beneficiary", "refundRecipient", "verifyingContract", "spender", "token", "hook", "router"]) {
    pattern(input?.[field], ADDRESS, `$.${field}`, add);
  }
  for (const field of ["chainId", "amount", "nonce", "validAfter", "deadline"]) pattern(input?.[field], UINT, `$.${field}`, add);
  positiveUint(input?.amount, "$.amount", add);
  positiveUint(input?.deadline, "$.deadline", add);
  if (validUint(input?.validAfter) && validUint(input?.deadline) && BigInt(input.deadline) <= BigInt(input.validAfter)) {
    add("$.deadline", "must be later than validAfter");
  }
  pattern(input?.launchConfigurationSha256, SHA256, "$.launchConfigurationSha256", add);
  pattern(input?.poolKeySha256, SHA256, "$.poolKeySha256", add);
  oneOf(input?.action, ["launch", "configure-launch", "initialize-pool", "provide-liquidity", "fund-launch"], "$.action", add);
  oneOf(input?.amountMode, ["exact", "maximum"], "$.amountMode", add);
  oneOf(input?.residualAllowanceDisposition, ["unchanged", "revoke", "decrement-only"], "$.residualAllowanceDisposition", add);
  if (input?.fundingRole === "sponsor") pattern(input?.sponsorPolicySha256, SHA256, "$.sponsorPolicySha256", add);
  if (input?.fundingRole === "delegated-payer" && input?.sponsorPolicySha256 !== null) {
    add("$.sponsorPolicySha256", "must be null for a delegated payer");
  }
  validateSignatureAuthorization(input?.authorization, "$.authorization", add);
  if (addressKey(input?.authorization?.signer) !== addressKey(input?.payer)) {
    add("$.authorization.signer", "must be the exact payer or sponsor funding the launch");
  }
  if (addressKey(input?.spender) !== addressKey(input?.verifyingContract)) {
    add("$.spender", "must equal the verifying contract bound by this intent");
  }
  return errors;
}

export function validatePermit2LaunchWitnessV1(input) {
  const errors = [];
  const add = reporter(errors);
  exactObject(input, ["schemaVersion", "permit2Domain", "permit", "launchWitness", "replayProtection", "signature"], "$", add);
  equal(input?.schemaVersion, "1.0.0", "$.schemaVersion", add);
  const domain = input?.permit2Domain;
  exactObject(domain, ["name", "chainId", "verifyingContract", "domainSeparator"], "$.permit2Domain", add);
  equal(domain?.name, "Permit2", "$.permit2Domain.name", add);
  pattern(domain?.chainId, UINT, "$.permit2Domain.chainId", add);
  pattern(domain?.verifyingContract, ADDRESS, "$.permit2Domain.verifyingContract", add);
  pattern(domain?.domainSeparator, BYTES32, "$.permit2Domain.domainSeparator", add);
  const permit = input?.permit;
  exactObject(permit, ["mode", "owner", "permittedToken", "permittedAmount", "requestedAmount", "spender", "nonce", "signatureDeadline"], "$.permit", add);
  equal(permit?.mode, "permit-witness-transfer-from", "$.permit.mode", add);
  for (const field of ["owner", "permittedToken", "spender"]) pattern(permit?.[field], ADDRESS, `$.permit.${field}`, add);
  for (const field of ["permittedAmount", "requestedAmount", "nonce", "signatureDeadline"]) pattern(permit?.[field], UINT, `$.permit.${field}`, add);
  positiveUint(permit?.permittedAmount, "$.permit.permittedAmount", add);
  positiveUint(permit?.requestedAmount, "$.permit.requestedAmount", add);
  if (validUint(permit?.permittedAmount) && validUint(permit?.requestedAmount) && BigInt(permit.requestedAmount) > BigInt(permit.permittedAmount)) {
    add("$.permit.requestedAmount", "cannot exceed permittedAmount");
  }
  const witness = input?.launchWitness;
  exactObject(witness, [
    "witnessTypeString", "witnessTypeHash", "witnessHash", "applicationId", "revisionObjectId", "action",
    "launchConfigurationSha256", "poolKeySha256", "hook", "router", "beneficiary", "recipient",
    "refundRecipient", "transactionTarget", "transactionSelector", "transactionDataSha256", "nativeValue",
    "payerIntentSha256"
  ], "$.launchWitness", add);
  equal(witness?.witnessTypeString, PERMIT2_LAUNCH_WITNESS_TYPE_STRING_V1, "$.launchWitness.witnessTypeString", add);
  for (const field of ["witnessTypeHash", "witnessHash"]) pattern(witness?.[field], BYTES32, `$.launchWitness.${field}`, add);
  pattern(witness?.applicationId, SLUG, "$.launchWitness.applicationId", add);
  pattern(witness?.revisionObjectId, GIT_OBJECT, "$.launchWitness.revisionObjectId", add);
  oneOf(witness?.action, ["launch", "configure-launch", "initialize-pool", "provide-liquidity", "fund-launch"], "$.launchWitness.action", add);
  for (const field of ["launchConfigurationSha256", "poolKeySha256", "transactionDataSha256", "payerIntentSha256"]) {
    pattern(witness?.[field], SHA256, `$.launchWitness.${field}`, add);
  }
  for (const field of ["hook", "router", "beneficiary", "recipient", "refundRecipient", "transactionTarget"]) {
    pattern(witness?.[field], ADDRESS, `$.launchWitness.${field}`, add);
  }
  if (!/^0x[0-9a-fA-F]{8}$/u.test(witness?.transactionSelector ?? "")) add("$.launchWitness.transactionSelector", "must be one exact four-byte selector");
  pattern(witness?.nativeValue, UINT, "$.launchWitness.nativeValue", add);
  if (addressKey(permit?.spender) !== addressKey(witness?.transactionTarget)) {
    add("$.launchWitness.transactionTarget", "must equal the Permit2 spender that consumes this witness");
  }
  const replay = input?.replayProtection;
  const replayKeys = [
    "chainBound", "permit2Bound", "ownerBound", "spenderBound", "nonceBound", "deadlineBound", "witnessBound",
    "singleUseNonce", "crossChainReplayRejected", "crossContractReplayRejected", "crossLaunchReplayRejected", "digest"
  ];
  exactObject(replay, replayKeys, "$.replayProtection", add);
  for (const key of replayKeys.slice(0, -1)) if (replay?.[key] !== true) add(`$.replayProtection.${key}`, "must be true");
  pattern(replay?.digest, BYTES32, "$.replayProtection.digest", add);
  validatePermitSignature(input?.signature, "$.signature", add);
  if (addressKey(input?.signature?.signer) !== addressKey(permit?.owner)) add("$.signature.signer", "must equal the Permit2 owner");
  return errors;
}

export function validateTestEvidenceOutcomeV1(input) {
  const errors = [];
  const add = reporter(errors);
  exactObject(input, ["schemaVersion", "subjectSha256", "methodId", "methodKind", "authorship", "invocation", "outcome", "artifacts"], "$", add);
  equal(input?.schemaVersion, "1.0.0", "$.schemaVersion", add);
  pattern(input?.subjectSha256, SHA256, "$.subjectSha256", add);
  pattern(input?.methodId, SLUG, "$.methodId", add);
  oneOf(input?.methodKind, ["build", "unit", "fuzz", "invariant", "fork", "static-analysis", "manual-reproduction", "provider-check", "other"], "$.methodKind", add);
  const authorship = input?.authorship;
  exactObject(authorship, ["codeAuthor", "testAuthor", "assertionAuthor", "runner", "interpreter", "independence"], "$.authorship", add);
  for (const field of ["codeAuthor", "testAuthor", "assertionAuthor", "runner", "interpreter"]) nonEmpty(authorship?.[field], `$.authorship.${field}`, add);
  oneOf(authorship?.independence, ["same-run", "independent-reproduction", "external-professional"], "$.authorship.independence", add);
  const invocation = input?.invocation;
  exactObject(invocation, ["tool", "toolVersion", "command", "rulesetSha256", "startedAt", "completedAt"], "$.invocation", add);
  nonEmpty(invocation?.tool, "$.invocation.tool", add);
  nonEmpty(invocation?.toolVersion, "$.invocation.toolVersion", add);
  if (!Array.isArray(invocation?.command) || invocation.command.length === 0 || invocation.command.some((part) => typeof part !== "string" || part.length === 0)) {
    add("$.invocation.command", "must preserve a non-empty argv array");
  }
  if (invocation?.rulesetSha256 !== null) pattern(invocation?.rulesetSha256, SHA256, "$.invocation.rulesetSha256", add);
  timestamp(invocation?.startedAt, "$.invocation.startedAt", add);
  timestamp(invocation?.completedAt, "$.invocation.completedAt", add);
  if (validTimestamp(invocation?.startedAt) && validTimestamp(invocation?.completedAt) && Date.parse(invocation.completedAt) < Date.parse(invocation.startedAt)) {
    add("$.invocation.completedAt", "must not precede startedAt");
  }
  const outcome = input?.outcome;
  exactObject(outcome, ["status", "exitCode", "counts", "reasonCode", "reason", "propertyRefs"], "$.outcome", add);
  oneOf(outcome?.status, TEST_EVIDENCE_OUTCOMES_V1, "$.outcome.status", add);
  if (!Array.isArray(outcome?.propertyRefs) || outcome.propertyRefs.length === 0) add("$.outcome.propertyRefs", "must identify at least one tested property");
  else for (const [index, ref] of outcome.propertyRefs.entries()) pattern(ref, SLUG, `$.outcome.propertyRefs[${index}]`, add);
  validateCounts(outcome?.counts, "$.outcome.counts", add);
  validateOutcomeSemantics(outcome, add);
  if (!Array.isArray(input?.artifacts)) add("$.artifacts", "must be an array");
  else for (const [index, artifact] of input.artifacts.entries()) validateArtifact(artifact, `$.artifacts[${index}]`, add);
  return errors;
}

export function validateScientificDataEvidenceProfileV1(input) {
  const errors = [];
  const add = reporter(errors);
  exactObject(input, ["schemaVersion", "profileId", "subjectSha256", "dataRole", "source", "measurement", "quality", "freshness", "valueInfluence", "failurePolicy", "evidenceRefs"], "$", add);
  equal(input?.schemaVersion, "1.0.0", "$.schemaVersion", add);
  pattern(input?.profileId, SLUG, "$.profileId", add);
  pattern(input?.subjectSha256, SHA256, "$.subjectSha256", add);
  oneOf(input?.dataRole, ["display-only", "value-influencing"], "$.dataRole", add);
  validateScientificSource(input?.source, "$.source", add);
  validateTextObject(input?.measurement, ["quantity", "unit", "method", "methodRevision", "calibration", "sampling", "uncertaintyModel", "correctionPolicy"], "$.measurement", add);
  const quality = input?.quality;
  exactObject(quality, ["validationRulesSha256", "outlierPolicy", "missingDataPolicy", "disputeAuthority", "reproductionRefs"], "$.quality", add);
  pattern(quality?.validationRulesSha256, SHA256, "$.quality.validationRulesSha256", add);
  for (const field of ["outlierPolicy", "missingDataPolicy", "disputeAuthority"]) nonEmpty(quality?.[field], `$.quality.${field}`, add);
  nonEmptyRefs(quality?.reproductionRefs, "$.quality.reproductionRefs", add);
  const freshness = input?.freshness;
  exactObject(freshness, ["observedAtRequired", "maximumAge", "updateCadence", "staleBehavior", "clockSource"], "$.freshness", add);
  if (freshness?.observedAtRequired !== true) add("$.freshness.observedAtRequired", "must be true");
  for (const field of ["maximumAge", "updateCadence"]) pattern(freshness?.[field], DURATION, `$.freshness.${field}`, add);
  nonEmpty(freshness?.clockSource, "$.freshness.clockSource", add);
  oneOf(freshness?.staleBehavior, ["reject", "freeze-value-effect", "display-stale-with-warning"], "$.freshness.staleBehavior", add);
  if (input?.dataRole === "display-only") {
    if (input.valueInfluence !== null) add("$.valueInfluence", "must be null for display-only data");
  } else if (input?.dataRole === "value-influencing") {
    validateScientificValueInfluence(input?.valueInfluence, "$.valueInfluence", add);
    if (freshness?.staleBehavior === "display-stale-with-warning") add("$.freshness.staleBehavior", "cannot authorize a value effect from stale data");
  }
  validateTextObject(input?.failurePolicy, ["unavailable", "invalidSignature", "schemaMismatch", "conflictingSources", "recovery"], "$.failurePolicy", add);
  nonEmptyRefs(input?.evidenceRefs, "$.evidenceRefs", add);
  return errors;
}

export function validateRwaEvidenceProfileV1(input) {
  const errors = [];
  const add = reporter(errors);
  exactObject(input, ["schemaVersion", "profileId", "subjectSha256", "assetIdentity", "nav", "reserve", "calendar", "corporateActions", "redemption", "insolvency", "evidenceRefs"], "$", add);
  equal(input?.schemaVersion, "1.0.0", "$.schemaVersion", add);
  pattern(input?.profileId, SLUG, "$.profileId", add);
  pattern(input?.subjectSha256, SHA256, "$.subjectSha256", add);
  const asset = input?.assetIdentity;
  exactObject(asset, ["instrument", "issuer", "custodian", "legalOwner", "beneficialEntitlement", "jurisdiction", "identifier", "termsSha256"], "$.assetIdentity", add);
  for (const field of ["instrument", "legalOwner", "beneficialEntitlement", "jurisdiction", "identifier"]) nonEmpty(asset?.[field], `$.assetIdentity.${field}`, add);
  validateRwaAuthority(asset?.issuer, "$.assetIdentity.issuer", add);
  validateRwaAuthority(asset?.custodian, "$.assetIdentity.custodian", add);
  pattern(asset?.termsSha256, SHA256, "$.assetIdentity.termsSha256", add);
  validateRwaNav(input?.nav, "$.nav", add);
  validateRwaReserve(input?.reserve, "$.reserve", add);
  validateRwaCalendar(input?.calendar, "$.calendar", add);
  validateRwaCorporateActions(input?.corporateActions, "$.corporateActions", add);
  validateRwaRedemption(input?.redemption, "$.redemption", add);
  validateRwaInsolvency(input?.insolvency, "$.insolvency", add);
  nonEmptyRefs(input?.evidenceRefs, "$.evidenceRefs", add);
  return errors;
}

export function validateLaunchAdmissionDecisionV1(input) {
  const errors = [];
  const add = reporter(errors);
  exactObject(input, [
    "schemaVersion", "recordId", "recordClass", "reviewIntent", "subject", "policy", "applicantGates",
    "platformGates", "findings", "reviewTooling", "verdict", "authority", "revalidatedAt"
  ], "$", add);
  equal(input?.schemaVersion, "1.0.0", "$.schemaVersion", add);
  pattern(input?.recordId, BYTES32, "$.recordId", add);
  oneOf(input?.recordClass, ["agent-prepared-policy-assessment", "maintainer-signed-final-verification"], "$.recordClass", add);
  oneOf(input?.reviewIntent, ["architecture-review", "launch-admission"], "$.reviewIntent", add);
  validateDecisionSubject(input?.subject, "$.subject", add);
  validateDecisionPolicy(input?.policy, "$.policy", add);
  validateGateSet(input?.applicantGates, APPLICANT_GATE_IDS_V1, "$.applicantGates", add, "applicant");
  validateGateSet(input?.platformGates, PLATFORM_GATE_IDS_V1, "$.platformGates", add, "platform");
  const findingIds = new Set();
  if (!Array.isArray(input?.findings)) add("$.findings", "must be an array");
  else for (const [index, finding] of input.findings.entries()) validateDecisionFinding(finding, `$.findings[${index}]`, add, findingIds);
  validateFindingReferences(input, findingIds, add);
  const tooling = input?.reviewTooling;
  exactObject(tooling, ["status", "reason", "evidenceRefs"], "$.reviewTooling", add);
  oneOf(tooling?.status, ["available", "blocked"], "$.reviewTooling.status", add);
  nonEmpty(tooling?.reason, "$.reviewTooling.reason", add);
  if (!Array.isArray(tooling?.evidenceRefs)) add("$.reviewTooling.evidenceRefs", "must be an array");
  oneOf(input?.verdict, ["CHANGES REQUIRED", "PLATFORM PENDING", "READY FOR FINAL VERIFICATION", "NO DETERMINATION"], "$.verdict", add);
  validateDecisionVerdict(input, add);
  validateDecisionAuthority(input, add);
  timestamp(input?.revalidatedAt, "$.revalidatedAt", add);
  return errors;
}

function validateSupportedProof(proof, path, add) {
  exactObject(proof, ["positiveNetOutput", "finalUserLimits", "deltaConservation", "feeConformance", "partialFillBehavior", "evidenceRefs"], path, add);
  for (const key of ["positiveNetOutput", "finalUserLimits", "deltaConservation", "feeConformance"]) if (proof?.[key] !== true) add(`${path}.${key}`, "must be true");
  oneOf(proof?.partialFillBehavior, ["full-fill-only", "bounded-partial-fill"], `${path}.partialFillBehavior`, add);
  nonEmptyRefs(proof?.evidenceRefs, `${path}.evidenceRefs`, add);
}

function validateRejectionProof(proof, path, add) {
  exactObject(proof, ["rejectionStage", "beforeValueMovement", "beforeStateMutation", "beforeLiabilityCreation", "beforeQuoteOrOffer", "coveredSurfaces", "evidenceRefs"], path, add);
  oneOf(proof?.rejectionStage, ["input-validation", "routing-validation", "quote-validation"], `${path}.rejectionStage`, add);
  for (const key of ["beforeValueMovement", "beforeStateMutation", "beforeLiabilityCreation", "beforeQuoteOrOffer"]) if (proof?.[key] !== true) add(`${path}.${key}`, "must be true");
  exactSet(proof?.coveredSurfaces, ["direct", "router", "quoter", "ui", "api"], `${path}.coveredSurfaces`, add);
  nonEmptyRefs(proof?.evidenceRefs, `${path}.evidenceRefs`, add);
}

function validateSignatureAuthorization(value, path, add) {
  exactObject(value, ["scheme", "signer", "domainSeparator", "structHash", "digest", "signature"], path, add);
  oneOf(value?.scheme, ["eip712-eoa", "erc1271"], `${path}.scheme`, add);
  pattern(value?.signer, ADDRESS, `${path}.signer`, add);
  for (const field of ["domainSeparator", "structHash", "digest"]) pattern(value?.[field], BYTES32, `${path}.${field}`, add);
  if (!/^0x(?:[0-9a-fA-F]{2})+$/u.test(value?.signature ?? "")) add(`${path}.signature`, "must contain non-empty hexadecimal signature bytes");
}

function validatePermitSignature(value, path, add) {
  exactObject(value, ["scheme", "signer", "bytes"], path, add);
  oneOf(value?.scheme, ["eip712-eoa", "erc1271"], `${path}.scheme`, add);
  pattern(value?.signer, ADDRESS, `${path}.signer`, add);
  if (!/^0x(?:[0-9a-fA-F]{2})+$/u.test(value?.bytes ?? "")) add(`${path}.bytes`, "must contain non-empty hexadecimal signature bytes");
}

function validateOutcomeSemantics(outcome, add) {
  const reasonPresent = typeof outcome?.reason === "string" && outcome.reason.trim().length > 0;
  const codePresent = typeof outcome?.reasonCode === "string" && SLUG.test(outcome.reasonCode);
  if (outcome?.status === "passed") {
    if (outcome.exitCode !== 0) add("$.outcome.exitCode", "must equal zero for passed");
    if (!isCounts(outcome.counts) || outcome.counts.failed !== 0 || outcome.counts.passed < 1) add("$.outcome.counts", "passed requires at least one pass and zero failures");
    if (outcome.reason !== null || outcome.reasonCode !== null) add("$.outcome", "passed cannot carry a failure or absence reason");
  } else if (outcome?.status === "failed") {
    if (!isCounts(outcome.counts)) add("$.outcome.counts", "failed must preserve exact counts");
    if (!(Number.isInteger(outcome.exitCode) && outcome.exitCode !== 0) && !(isCounts(outcome.counts) && outcome.counts.failed > 0)) add("$.outcome", "failed requires a non-zero exit or at least one failed property");
    if (!reasonPresent || !codePresent) add("$.outcome", "failed requires a reasonCode and reason");
  } else if (outcome?.status === "tooling-blocked") {
    if (!reasonPresent || !codePresent) add("$.outcome", "tooling-blocked requires the exact blocking reason");
    if (outcome.counts !== null) add("$.outcome.counts", "must be null when the intended method could not run");
  } else if (outcome?.status === "no-data") {
    if (outcome.exitCode !== 0) add("$.outcome.exitCode", "must equal zero when the method completed with no usable data");
    if (!reasonPresent || !codePresent) add("$.outcome", "no-data requires the exact absence reason");
  } else if (outcome?.status === "inconclusive") {
    if (!reasonPresent || !codePresent) add("$.outcome", "inconclusive requires the exact uncertainty reason");
  } else if (outcome?.status === "not-applicable-with-reason") {
    if (outcome.exitCode !== null || outcome.counts !== null) add("$.outcome", "not applicable cannot pretend a tool ran");
    if (!reasonPresent || !codePresent) add("$.outcome", "not applicable requires a structural reason and proof reference");
  }
}

function validateCounts(value, path, add) {
  if (value === null) return;
  exactObject(value, ["passed", "failed", "skipped"], path, add);
  for (const field of ["passed", "failed", "skipped"]) if (!Number.isSafeInteger(value?.[field]) || value[field] < 0) add(`${path}.${field}`, "must be a non-negative safe integer");
}

function validateArtifact(value, path, add) {
  exactObject(value, ["path", "mediaType", "byteLength", "sha256"], path, add);
  nonEmpty(value?.path, `${path}.path`, add);
  if (typeof value?.path === "string" && (value.path.startsWith("/") || value.path.includes("\\") || value.path.split("/").some((part) => part === "." || part === ".."))) add(`${path}.path`, "must be a safe repository-relative path");
  nonEmpty(value?.mediaType, `${path}.mediaType`, add);
  if (!Number.isSafeInteger(value?.byteLength) || value.byteLength < 0) add(`${path}.byteLength`, "must be a non-negative safe integer");
  pattern(value?.sha256, SHA256, `${path}.sha256`, add);
}

function validateScientificSource(value, path, add) {
  exactObject(value, ["producer", "operator", "schemaId", "schemaSha256", "transport", "authentication", "signature", "provenanceChainSha256"], path, add);
  for (const field of ["producer", "operator", "schemaId"]) nonEmpty(value?.[field], `${path}.${field}`, add);
  pattern(value?.schemaSha256, SHA256, `${path}.schemaSha256`, add);
  pattern(value?.provenanceChainSha256, SHA256, `${path}.provenanceChainSha256`, add);
  oneOf(value?.transport, ["onchain", "signed-api", "content-addressed-file", "authenticated-api", "manual-publication"], `${path}.transport`, add);
  oneOf(value?.authentication, ["contract-identity", "eip712", "erc1271", "x509", "content-digest", "operator-attestation"], `${path}.authentication`, add);
  exactObject(value?.signature, ["required", "scheme", "signerIdentity"], `${path}.signature`, add);
  if (typeof value?.signature?.required !== "boolean") add(`${path}.signature.required`, "must be boolean");
  if (value?.signature?.required) {
    nonEmpty(value.signature.scheme, `${path}.signature.scheme`, add);
    nonEmpty(value.signature.signerIdentity, `${path}.signature.signerIdentity`, add);
  } else if (value?.signature?.scheme !== null || value?.signature?.signerIdentity !== null) {
    add(`${path}.signature`, "must keep scheme and signerIdentity null when no signature is required");
  }
}

function validateScientificValueInfluence(value, path, add) {
  exactObject(value, ["effect", "formulaSha256", "inputBounds", "outputBounds", "staleInputEffect", "fallback", "manipulationTests", "authorityRefs"], path, add);
  oneOf(value?.effect, ["price", "fee", "payout", "collateral", "eligibility", "supply", "liquidity", "other"], `${path}.effect`, add);
  pattern(value?.formulaSha256, SHA256, `${path}.formulaSha256`, add);
  for (const field of ["inputBounds", "outputBounds", "fallback"]) nonEmpty(value?.[field], `${path}.${field}`, add);
  oneOf(value?.staleInputEffect, ["reject", "freeze-last-valid", "bounded-fallback"], `${path}.staleInputEffect`, add);
  nonEmptyRefs(value?.manipulationTests, `${path}.manipulationTests`, add);
  nonEmptyRefs(value?.authorityRefs, `${path}.authorityRefs`, add);
}

function validateRwaAuthority(value, path, add) {
  exactObject(value, ["operator", "authorityRef", "scope", "continuity", "conflicts"], path, add);
  for (const field of ["operator", "authorityRef", "scope", "continuity", "conflicts"]) nonEmpty(value?.[field], `${path}.${field}`, add);
}

function validateRwaNav(value, path, add) {
  exactObject(value, ["source", "schemaSha256", "currency", "valuationMethod", "asOfRequired", "publicationCadence", "maximumAge", "staleBehavior", "correctionPolicy", "independentCheckRefs"], path, add);
  validateRwaAuthority(value?.source, `${path}.source`, add);
  pattern(value?.schemaSha256, SHA256, `${path}.schemaSha256`, add);
  if (!/^[A-Z]{3,12}$/u.test(value?.currency ?? "")) add(`${path}.currency`, "must be a bounded uppercase currency identifier");
  for (const field of ["valuationMethod", "correctionPolicy"]) nonEmpty(value?.[field], `${path}.${field}`, add);
  for (const field of ["publicationCadence", "maximumAge"]) pattern(value?.[field], DURATION, `${path}.${field}`, add);
  if (value?.asOfRequired !== true) add(`${path}.asOfRequired`, "must be true");
  oneOf(value?.staleBehavior, ["reject-new-risk", "freeze-valuation", "managed-suspension"], `${path}.staleBehavior`, add);
  nonEmptyRefs(value?.independentCheckRefs, `${path}.independentCheckRefs`, add);
}

function validateRwaReserve(value, path, add) {
  exactObject(value, ["backingModel", "assetScope", "liabilityScope", "segregation", "reconciliation", "attestation", "shortfallPolicy", "withdrawalAuthority", "evidenceRefs"], path, add);
  oneOf(value?.backingModel, ["fully-reserved", "overcollateralized", "fractional", "contingent", "unbacked-disclosed"], `${path}.backingModel`, add);
  for (const field of ["assetScope", "liabilityScope", "segregation", "reconciliation", "attestation", "shortfallPolicy"]) nonEmpty(value?.[field], `${path}.${field}`, add);
  validateRwaAuthority(value?.withdrawalAuthority, `${path}.withdrawalAuthority`, add);
  nonEmptyRefs(value?.evidenceRefs, `${path}.evidenceRefs`, add);
}

function validateRwaCalendar(value, path, add) {
  validateTextObject(value, ["timezone", "calendarSource", "tradingWindows", "holidays", "valuationCutoff", "subscriptionCutoff", "redemptionCutoff", "settlementConvention", "changeNotice"], path, add);
  if (typeof value?.timezone === "string" && !/^[A-Za-z_]+(?:\/[A-Za-z0-9_+.-]+)+$/u.test(value.timezone)) add(`${path}.timezone`, "must be an IANA timezone identifier");
}

function validateRwaCorporateActions(value, path, add) {
  exactObject(value, ["supportedActions", "source", "entitlementRule", "recordDateRule", "paymentDateRule", "fractionalTreatment", "withholdingTreatment", "mutationPolicy", "reconciliationRefs"], path, add);
  if (!Array.isArray(value?.supportedActions) || value.supportedActions.length === 0) add(`${path}.supportedActions`, "must declare at least one handled action");
  validateRwaAuthority(value?.source, `${path}.source`, add);
  for (const field of ["entitlementRule", "recordDateRule", "paymentDateRule", "fractionalTreatment", "withholdingTreatment", "mutationPolicy"]) nonEmpty(value?.[field], `${path}.${field}`, add);
  nonEmptyRefs(value?.reconciliationRefs, `${path}.reconciliationRefs`, add);
}

function validateRwaRedemption(value, path, add) {
  exactObject(value, ["mode", "authority", "eligibility", "beneficiaryBinding", "pricing", "fees", "minimumAmount", "maximumAmount", "window", "queue", "denialStates", "outage", "recourse", "maximumCompletionTime", "evidenceRefs"], path, add);
  oneOf(value?.mode, ["autonomous", "managed", "maturity-only", "none-disclosed"], `${path}.mode`, add);
  validateRwaAuthority(value?.authority, `${path}.authority`, add);
  for (const field of ["eligibility", "beneficiaryBinding", "pricing", "fees", "window", "queue", "denialStates", "outage", "recourse"]) nonEmpty(value?.[field], `${path}.${field}`, add);
  pattern(value?.minimumAmount, UINT, `${path}.minimumAmount`, add);
  if (value?.maximumAmount !== null) pattern(value?.maximumAmount, UINT, `${path}.maximumAmount`, add);
  if (validUint(value?.minimumAmount) && validUint(value?.maximumAmount) && BigInt(value.maximumAmount) < BigInt(value.minimumAmount)) add(`${path}.maximumAmount`, "cannot be lower than minimumAmount");
  if (["managed", "autonomous"].includes(value?.mode)) pattern(value?.maximumCompletionTime, DURATION, `${path}.maximumCompletionTime`, add);
  else if (value?.maximumCompletionTime !== null) pattern(value?.maximumCompletionTime, DURATION, `${path}.maximumCompletionTime`, add);
  nonEmptyRefs(value?.evidenceRefs, `${path}.evidenceRefs`, add);
}

function validateRwaInsolvency(value, path, add) {
  exactObject(value, ["events", "lossAllocation", "priority", "poolIsolation", "freezeEffect", "issuerDefault", "custodianDefault", "reserveShortfall", "recoveryAuthority", "holderRecourse", "publicDisclosure", "evidenceRefs"], path, add);
  if (!Array.isArray(value?.events) || value.events.length === 0) add(`${path}.events`, "must declare at least one insolvency or continuity event");
  for (const field of ["lossAllocation", "priority", "poolIsolation", "freezeEffect", "issuerDefault", "custodianDefault", "reserveShortfall", "holderRecourse", "publicDisclosure"]) nonEmpty(value?.[field], `${path}.${field}`, add);
  validateRwaAuthority(value?.recoveryAuthority, `${path}.recoveryAuthority`, add);
  nonEmptyRefs(value?.evidenceRefs, `${path}.evidenceRefs`, add);
}

function validateDecisionSubject(value, path, add) {
  exactObject(value, ["applicationId", "centralPullRequest", "centralHeadObjectId", "primary", "companions", "sourceBundleSha256", "submissionSha256", "reviewTargetSha256", "launchPlanPath", "launchPlanSha256", "chainId", "launchConfigurationSha256"], path, add);
  pattern(value?.applicationId, SLUG, `${path}.applicationId`, add);
  if (value?.centralPullRequest === null) {
    if (value?.centralHeadObjectId !== null) add(`${path}.centralHeadObjectId`, "must be null when no central pull request exists");
  } else {
    if (!Number.isSafeInteger(value?.centralPullRequest) || value.centralPullRequest < 1) add(`${path}.centralPullRequest`, "must be a positive pull-request number or null");
    pattern(value?.centralHeadObjectId, GIT_OBJECT, `${path}.centralHeadObjectId`, add);
  }
  validateRepository(value?.primary, `${path}.primary`, add);
  if (!Array.isArray(value?.companions) || value.companions.length > 8) add(`${path}.companions`, "must be an array of at most eight exact repositories");
  else for (const [index, repository] of value.companions.entries()) validateRepository(repository, `${path}.companions[${index}]`, add);
  for (const field of ["sourceBundleSha256", "submissionSha256", "reviewTargetSha256", "launchPlanSha256", "launchConfigurationSha256"]) pattern(value?.[field], SHA256, `${path}.${field}`, add);
  nonEmpty(value?.launchPlanPath, `${path}.launchPlanPath`, add);
  pattern(value?.chainId, UINT, `${path}.chainId`, add);
}

function validateRepository(value, path, add) {
  exactObject(value, ["repositoryId", "uri", "revisionObjectId", "treeObjectId"], path, add);
  positiveUint(value?.repositoryId, `${path}.repositoryId`, add);
  if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/u.test(value?.uri ?? "")) add(`${path}.uri`, "must be one exact GitHub repository URI");
  pattern(value?.revisionObjectId, GIT_OBJECT, `${path}.revisionObjectId`, add);
  pattern(value?.treeObjectId, GIT_OBJECT, `${path}.treeObjectId`, add);
}

function validateDecisionPolicy(value, path, add) {
  exactObject(value, ["skillRevisionObjectId", "criteriaSha256", "feePolicySha256", "packageContractSha256", "validatorRevisionObjectId", "toolPolicySha256"], path, add);
  pattern(value?.skillRevisionObjectId, GIT_OBJECT, `${path}.skillRevisionObjectId`, add);
  pattern(value?.validatorRevisionObjectId, GIT_OBJECT, `${path}.validatorRevisionObjectId`, add);
  for (const field of ["criteriaSha256", "feePolicySha256", "packageContractSha256", "toolPolicySha256"]) pattern(value?.[field], SHA256, `${path}.${field}`, add);
}

function validateGateSet(gates, requiredIds, path, add, kind) {
  if (!Array.isArray(gates) || gates.length !== requiredIds.length) {
    add(path, `must contain exactly ${requiredIds.join(", ")}`);
    return;
  }
  const seen = new Set();
  for (const [index, gate] of gates.entries()) {
    const gatePath = `${path}[${index}]`;
    exactObject(gate, ["id", "assessment"], gatePath, add);
    if (!requiredIds.includes(gate?.id)) add(`${gatePath}.id`, `must be one of ${requiredIds.join(", ")}`);
    if (seen.has(gate?.id)) add(`${gatePath}.id`, "must not repeat a gate");
    seen.add(gate?.id);
    validateGateAssessment(gate?.assessment, `${gatePath}.assessment`, add, kind, gate?.id);
  }
  for (const id of requiredIds) if (!seen.has(id)) add(path, `is missing ${id}`);
}

function validateGateAssessment(value, path, add, kind, gateId) {
  exactObject(value, ["result", "decisionMethod", "reason", "evidenceRefs", "findingRefs", "resolutionOwner"], path, add);
  oneOf(value?.result, ["passed", "failed", "pending", "analysis-pending", "not-applicable-with-reason"], `${path}.result`, add);
  oneOf(value?.decisionMethod, ["deterministic-reproduction", "manual-review", "human-product-legal"], `${path}.decisionMethod`, add);
  nonEmpty(value?.reason, `${path}.reason`, add);
  if (!Array.isArray(value?.evidenceRefs)) add(`${path}.evidenceRefs`, "must be an array");
  if (!Array.isArray(value?.findingRefs)) add(`${path}.findingRefs`, "must be an array");
  oneOf(value?.resolutionOwner, ["applicant", "programmable-platform", "external-provider", "programmable-product-legal", "review-tooling", "none"], `${path}.resolutionOwner`, add);
  if (["passed", "not-applicable-with-reason"].includes(value?.result) && (!Array.isArray(value?.evidenceRefs) || value.evidenceRefs.length === 0)) add(`${path}.evidenceRefs`, "must bind attributable proof for a pass or not-applicable result");
  if (["failed", "pending", "analysis-pending"].includes(value?.result) && (!Array.isArray(value?.findingRefs) || value.findingRefs.length === 0)) add(`${path}.findingRefs`, "must bind at least one exact finding");
  if (kind === "applicant" && value?.result === "pending") add(`${path}.result`, "applicant gates use failed or analysis-pending, never platform pending");
  if (kind === "applicant" && value?.result === "failed" && value?.resolutionOwner !== "applicant") add(`${path}.resolutionOwner`, "a failed applicant gate is applicant-owned");
  if (kind === "platform" && ["failed", "analysis-pending"].includes(value?.result)) add(`${path}.result`, "platform gates use pending rather than applicant-failure states");
  if (kind === "platform" && value?.result === "pending" && ["applicant", "none"].includes(value?.resolutionOwner)) add(`${path}.resolutionOwner`, "a pending platform gate must retain its platform, provider, product/legal, or tooling owner");
  if (gateId === "P9" && value?.decisionMethod !== "human-product-legal") add(`${path}.decisionMethod`, "P9 is a human product/legal decision");
  if (gateId !== "P9" && value?.decisionMethod === "human-product-legal") add(`${path}.decisionMethod`, "human product/legal decision is reserved for P9");
}

function validateDecisionFinding(value, path, add, findingIds) {
  exactObject(value, ["id", "gateIds", "classification", "artifact", "location", "evidenceRefs", "impact", "smallestRepair", "exactRerun", "resolutionOwner", "preventionCause"], path, add);
  pattern(value?.id, SLUG, `${path}.id`, add);
  if (findingIds.has(value?.id)) add(`${path}.id`, "must not repeat a finding id");
  findingIds.add(value?.id);
  if (!Array.isArray(value?.gateIds) || value.gateIds.length === 0) add(`${path}.gateIds`, "must bind at least one A1-A11 or P1-P9 gate");
  else for (const [index, id] of value.gateIds.entries()) if (![...APPLICANT_GATE_IDS_V1, ...PLATFORM_GATE_IDS_V1].includes(id)) add(`${path}.gateIds[${index}]`, "must be a typed A1-A11 or P1-P9 id");
  oneOf(value?.classification, ["hard-conflict", "evidence-gap", "platform-gap", "provider-gap", "product-legal-pending", "tooling-blocked"], `${path}.classification`, add);
  for (const field of ["artifact", "location", "impact", "smallestRepair", "exactRerun"]) nonEmpty(value?.[field], `${path}.${field}`, add);
  if (!Array.isArray(value?.evidenceRefs)) add(`${path}.evidenceRefs`, "must be an array");
  oneOf(value?.resolutionOwner, ["applicant", "programmable-platform", "external-provider", "programmable-product-legal", "review-tooling"], `${path}.resolutionOwner`, add);
  oneOf(value?.preventionCause, ["skill-gap", "criteria-gap", "verifier-gap", "package-release-drift", "applicant-deviation", "newly-discovered-mechanism"], `${path}.preventionCause`, add);
}

function validateFindingReferences(input, findingIds, add) {
  for (const [collectionName, gates] of [["applicantGates", input?.applicantGates], ["platformGates", input?.platformGates]]) {
    if (!Array.isArray(gates)) continue;
    for (const [index, gate] of gates.entries()) {
      for (const [refIndex, ref] of (gate?.assessment?.findingRefs ?? []).entries()) if (!findingIds.has(ref)) add(`$.${collectionName}[${index}].assessment.findingRefs[${refIndex}]`, "must reference a declared finding");
    }
  }
}

function validateDecisionVerdict(input, add) {
  const applicantResults = (input?.applicantGates ?? []).map((gate) => gate?.assessment?.result);
  const platformResults = (input?.platformGates ?? []).map((gate) => gate?.assessment?.result);
  const allApplicantPass = applicantResults.length === 11 && applicantResults.every((result) => ["passed", "not-applicable-with-reason"].includes(result));
  const allPlatformPass = platformResults.length === 9 && platformResults.every((result) => ["passed", "not-applicable-with-reason"].includes(result));
  if (input?.reviewTooling?.status === "blocked") {
    if (input?.verdict !== "NO DETERMINATION") add("$.verdict", "must be NO DETERMINATION while review tooling prevents attributable review");
    return;
  }
  if (input?.reviewIntent !== "launch-admission") {
    if (["PLATFORM PENDING", "READY FOR FINAL VERIFICATION"].includes(input?.verdict)) add("$.verdict", "architecture review cannot produce a positive launch-admission verdict");
    return;
  }
  if (!allApplicantPass) {
    if (input?.verdict !== "CHANGES REQUIRED") add("$.verdict", "must be CHANGES REQUIRED while any applicant gate is incomplete");
  } else if (!allPlatformPass) {
    if (input?.verdict !== "PLATFORM PENDING") add("$.verdict", "must be PLATFORM PENDING after applicant gates pass but a platform gate remains");
  } else if (input?.verdict !== "READY FOR FINAL VERIFICATION") {
    add("$.verdict", "must be READY FOR FINAL VERIFICATION after every A and P gate passes");
  }
}

function validateDecisionAuthority(input, add) {
  const authority = input?.authority;
  exactObject(authority, ["basis", "authorityEffect", "githubProjectionAuthoritative", "signedAuthority"], "$.authority", add);
  oneOf(authority?.basis, ["agent-prepared", "signed-immutable-final-verification"], "$.authority.basis", add);
  oneOf(authority?.authorityEffect, ["none", "launch-admission-input"], "$.authority.authorityEffect", add);
  if (authority?.githubProjectionAuthoritative !== false) add("$.authority.githubProjectionAuthoritative", "must be false; labels, checks, comments, and aggregate GitHub review state are projections only");
  if (input?.recordClass === "agent-prepared-policy-assessment") {
    if (authority?.basis !== "agent-prepared" || authority?.authorityEffect !== "none" || authority?.signedAuthority !== null) add("$.authority", "an agent-prepared assessment cannot create launch authority");
  } else if (input?.recordClass === "maintainer-signed-final-verification") {
    if (input?.verdict !== "READY FOR FINAL VERIFICATION") add("$.verdict", "a positive maintainer final-verification record must bind the ready verdict");
    if (authority?.basis !== "signed-immutable-final-verification" || authority?.authorityEffect !== "launch-admission-input") add("$.authority", "maintainer final verification requires the signed immutable authority basis");
    validateSignedAuthority(authority?.signedAuthority, "$.authority.signedAuthority", add);
  }
}

function validateSignedAuthority(value, path, add) {
  exactObject(value, ["signerRole", "signerIdentity", "signatureScheme", "signature", "signedDigest", "issuedAt", "expiresAt", "supersedesRecordId"], path, add);
  equal(value?.signerRole, "programmable-final-verifier", `${path}.signerRole`, add);
  nonEmpty(value?.signerIdentity, `${path}.signerIdentity`, add);
  oneOf(value?.signatureScheme, ["eip712-eoa", "erc1271", "sigstore-bundle"], `${path}.signatureScheme`, add);
  nonEmpty(value?.signature, `${path}.signature`, add);
  pattern(value?.signedDigest, BYTES32, `${path}.signedDigest`, add);
  timestamp(value?.issuedAt, `${path}.issuedAt`, add);
  timestamp(value?.expiresAt, `${path}.expiresAt`, add);
  if (validTimestamp(value?.issuedAt) && validTimestamp(value?.expiresAt) && Date.parse(value.expiresAt) <= Date.parse(value.issuedAt)) add(`${path}.expiresAt`, "must be later than issuedAt");
  if (value?.supersedesRecordId !== null) pattern(value?.supersedesRecordId, BYTES32, `${path}.supersedesRecordId`, add);
}

function validateSubject(subject, path, add, keys) {
  exactObject(subject, keys, path, add);
  pattern(subject?.revisionObjectId, GIT_OBJECT, `${path}.revisionObjectId`, add);
  pattern(subject?.treeObjectId, GIT_OBJECT, `${path}.treeObjectId`, add);
  pattern(subject?.chainId, UINT, `${path}.chainId`, add);
}

function validateTextObject(value, keys, path, add) {
  exactObject(value, keys, path, add);
  for (const key of keys) nonEmpty(value?.[key], `${path}.${key}`, add);
}

function exactObject(value, keys, path, add) {
  if (!isObject(value)) {
    add(path, "must be an object");
    return false;
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) add(path, `must contain exactly: ${expected.join(", ")}`);
  return true;
}

function exactSet(value, expected, path, add) {
  if (!Array.isArray(value)) {
    add(path, "must be an array");
    return;
  }
  const actual = [...new Set(value)].sort();
  const wanted = [...expected].sort();
  if (actual.length !== value.length || actual.length !== wanted.length || actual.some((entry, index) => entry !== wanted[index])) add(path, `must contain exactly: ${wanted.join(", ")}`);
}

function nonEmptyRefs(value, path, add) {
  if (!Array.isArray(value) || value.length === 0 || value.some((entry) => typeof entry !== "string" || entry.trim().length === 0)) add(path, "must contain at least one non-empty evidence reference");
}

function pattern(value, expression, path, add) {
  if (typeof value !== "string" || !expression.test(value)) add(path, "has invalid format");
}

function oneOf(value, allowed, path, add) {
  if (!allowed.includes(value)) add(path, `must be one of: ${allowed.join(", ")}`);
}

function equal(actual, expected, path, add) {
  if (actual !== expected) add(path, `must equal ${expected}`);
}

function nonEmpty(value, path, add) {
  if (typeof value !== "string" || value.trim().length === 0) add(path, "must be non-empty text");
}

function timestamp(value, path, add) {
  if (!validTimestamp(value)) add(path, "must be an RFC 3339 timestamp");
}

function positiveUint(value, path, add) {
  pattern(value, UINT, path, add);
  if (validUint(value) && BigInt(value) === 0n) add(path, "must be greater than zero");
}

function validUint(value) {
  return typeof value === "string" && UINT.test(value);
}

function validTimestamp(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u.test(value) && Number.isFinite(Date.parse(value));
}

function addressKey(value) {
  return typeof value === "string" ? value.toLowerCase() : null;
}

function isCounts(value) {
  return isObject(value) && ["passed", "failed", "skipped"].every((key) => Number.isSafeInteger(value[key]) && value[key] >= 0);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function reporter(errors) {
  return (path, message) => errors.push(`${path}: ${message}`);
}
