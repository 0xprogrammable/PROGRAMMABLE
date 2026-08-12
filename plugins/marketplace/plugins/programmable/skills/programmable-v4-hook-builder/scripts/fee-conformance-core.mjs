import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { canonicalJsonSha256V2 } from "./canonical-json-core.mjs";
import { standardV4FeeAmountPolicyMatchesV1, standardV4FeeConservationMatchesV1 } from "./open-world-v2-primitives.mjs";
import { parseBoundedStrictJsonBytes } from "./strict-json-core.mjs";
import { validateFeeConformanceDocuments, validateFeeConformanceManifestShape } from "./fee-conformance-validation-core.mjs";

export const FEE_CONFORMANCE_SCHEMA_VERSION = "programmable-fee-conformance-v1", FEE_POLICY_ID = "programmable-volume-fee-v1", FEE_POLICY_VERSION = "1.1.0";
export const PROGRAMMABLE_FEE_OWNER = "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c", PROGRAMMABLE_FEE_POLICY_HASH = "0x72fea66c0711467846f805d8dbe08e5243460ef604cbf3c2626c011c0c0fdac6";
export const RATE_DENOMINATOR = 1_000_000n, PROGRAMMABLE_HUNDREDTHS_OF_BIP = 1_000n, MAX_SELECTED_HUNDREDTHS_OF_BIP = 100_000n, MIN_GROSS_QUOTE_AMOUNT = 1_000n;

export function tradeFeeManifestSemanticsMatchV1(manifest) {
  const fee = manifest.feeBehavior.programmableFeeV2;
  const components = manifest.feeBehavior.components;
  const shapeValid = components.every((component) => (
    (component.calculation === "fixed-pips") === (component.ratePips !== null)
    && (component.currencyRole === "route-defined") === (component.routeDefinedCurrency !== null)
    && (component.kind !== "v4-lp" || component.currencyRole === "input-currency" && component.chargeBase === "input-amount")
  ));
  const feeV2Component = components.some(({ kind, currencyRole, chargeBase }) => kind === "hook" && currencyRole === "programmable-quote-currency" && chargeBase === "executed-gross-quote");
  return shapeValid && (fee.applicability !== "applicable" || feeV2Component);
}

export function tradeFeeEvidenceMatchesV1(result, manifest) {
  const amounts = result.context.fee.amounts;
  const componentPolicies = new Map(manifest.feeBehavior.components.map((component) => [component.id, component]));
  const componentRows = new Map(amounts.components.map((component) => [component.componentRef, component]));
  const inputCurrency = result.context.mode.direction === "zero-for-one" ? result.context.poolKey.currency0 : result.context.poolKey.currency1;
  const outputCurrency = result.context.mode.direction === "zero-for-one" ? result.context.poolKey.currency1 : result.context.poolKey.currency0;
  const observed = result.contract === "trade-quote-test-result-v1"
    ? {
        input: result.context.mode.amountMode === "exact-input" ? result.context.request.amountSpecified : result.observation.amountQuoted,
        output: result.context.mode.amountMode === "exact-input" ? result.observation.amountQuoted : result.context.request.amountSpecified
      }
    : result.outcome === "swap-succeeded" ? { input: result.observation.amountIn, output: result.observation.amountOut } : null;
  const feeScope = manifest.feeBehavior.programmableFeeV2;
  const currencies = {
    "input-currency": inputCurrency,
    "output-currency": outputCurrency,
    "programmable-quote-currency": feeScope.applicability === "applicable" ? feeScope.quoteCurrency : null
  };
  const invalidComponent = manifest.feeBehavior.components.some((policy) => {
    const row = componentRows.get(policy.id);
    const expectedCurrency = policy.currencyRole === "route-defined" ? policy.routeDefinedCurrency : currencies[policy.currencyRole];
    const observedBase = observed === null ? null : policy.chargeBase === "input-amount" ? observed.input : policy.chargeBase === "output-amount" ? observed.output : policy.chargeBase === "executed-gross-quote" && expectedCurrency === inputCurrency ? observed.input : row?.baseAmount;
    const base = BigInt(row?.baseAmount ?? 0);
    const value = BigInt(row?.amount ?? 0);
    const amountPolicyInvalid = !standardV4FeeAmountPolicyMatchesV1({ baseAmount: base, feeAmount: value, policy, feeScope });
    const conservationInvalid = feeScope.applicability === "applicable" && policy.kind === "hook" && policy.currencyRole === "programmable-quote-currency"
      && !standardV4FeeConservationMatchesV1({ baseAmount: base, feeAmount: value, expectedCurrency, inputCurrency, outputCurrency, observed });
    return !row || row.currency !== expectedCurrency || row.chargeBase !== policy.chargeBase || observedBase !== null && row.baseAmount !== observedBase || amountPolicyInvalid || conservationInvalid;
  });
  const computedTotals = new Map();
  for (const { currency, amount } of amounts.components) computedTotals.set(currency, (computedTotals.get(currency) ?? 0n) + BigInt(amount));
  const reportedTotals = new Map(amounts.totalsByCurrency.map(({ currency, amount }) => [currency, BigInt(amount)]));
  return amounts.components.length === componentPolicies.size
    && componentRows.size === componentPolicies.size
    && [...componentPolicies.keys()].every((id) => componentRows.has(id))
    && reportedTotals.size === amounts.totalsByCurrency.length
    && computedTotals.size === reportedTotals.size
    && [...computedTotals].every(([currency, amount]) => reportedTotals.get(currency) === amount)
    && result.context.fee.quotedFeesSha256 === canonicalJsonSha256V2(amounts)
    && !invalidComponent;
}

export const REQUIRED_EVIDENCE_SCENARIOS = Object.freeze(["fee-policy-getters-exact", "rate-selected-zero", "rate-selected-below-floor", "rate-selected-at-floor", "rate-selected-three-percent", "programmable-rounding-exact-10-bps", "cumulative-rounding-fragmentation-resistant", "claim-preserves-rounding-remainders", "zero-for-one-exact-input", "zero-for-one-exact-output", "one-for-zero-exact-input", "one-for-zero-exact-output", "specified-quote-partial-fill-atomic-revert", "unspecified-quote-uses-executed-delta", "dust-below-fee-quantum-atomic-revert", "canonical-pool-only", "atomic-registration-and-initialization", "pool-manager-callback-authentication", "hook-address-permission-bits", "lp-fee-exact-output-compatible", "delta-and-liability-conservation", "programmable-owner-only-claim", "owner-selected-per-claim-destination", "project-claim-separation", "cross-pool-and-currency-isolation", "same-pool-self-call-forbidden", "claim-token-settlement-and-take", "zero-executed-quote-no-liability"]);

const EXPECTED_MANIFEST = Object.freeze({
  policyId: FEE_POLICY_ID,
  policyVersion: FEE_POLICY_VERSION,
  platformOwner: PROGRAMMABLE_FEE_OWNER,
  rateUnit: "hundredths-of-bip",
  formula: "effective=max(selected,1000);platform=1000;project=effective-1000",
  poolScope: "single-canonical-pool-key",
  quoteBasis: "executed-gross-quote-side-volume",
  collectionPath: "quadrant-dependent-swap-return-delta",
  partialFillPolicy: "specified-quote-atomic-revert",
  dustPolicy: "nonzero-gross-below-1000-smallest-units-atomic-revert",
  roundingPolicy: "cumulative-independent-platform-project-remainders",
  remainderScope: "canonical-pool-lifetime",
  claimResetsRemainders: false,
  minimumGrossQuoteUnits: 1_000,
  fragmentationResistant: true,
  selfCallPolicy: "same-pool-swap-forbidden",
  settlementPath: "erc6909-claim-burn-then-underlying-take",
  claimDestinationPolicy: "owner-or-owner-selected-per-claim",
  hookAddressPolicy: "create2-exact-permission-mask",
  maxExactOutputCompatibleLpFeePips: 999_998
});

const MAX_FILE_BYTES = Object.freeze({
  source: 1_000_000,
  supportingSource: 1_000_000,
  artifact: 16_000_000,
  buildInfo: 96_000_000,
  evidence: 4_000_000,
  manifest: 1_000_000
});
const VALIDATION_POLICY = Object.freeze({
  schemaVersion: FEE_CONFORMANCE_SCHEMA_VERSION,
  policyId: FEE_POLICY_ID,
  policyHash: PROGRAMMABLE_FEE_POLICY_HASH,
  programmableFeeOwner: PROGRAMMABLE_FEE_OWNER,
  expectedManifest: EXPECTED_MANIFEST,
  requiredEvidenceScenarios: REQUIRED_EVIDENCE_SCENARIOS
});

export function effectiveHundredthsOfBip(selectedValue) {
  const selected = toRate(selectedValue, "selectedHundredthsOfBip");
  if (selected > MAX_SELECTED_HUNDREDTHS_OF_BIP) {
    throw new RangeError(`selectedHundredthsOfBip must be at most ${MAX_SELECTED_HUNDREDTHS_OF_BIP}`);
  }
  return selected < PROGRAMMABLE_HUNDREDTHS_OF_BIP ? PROGRAMMABLE_HUNDREDTHS_OF_BIP : selected;
}

export function computeGrossFeeSplit(grossValue, selectedValue, remainderState = {}) {
  const gross = toUnsignedBigInt(grossValue, "grossQuoteAmount");
  const selected = toRate(selectedValue, "selectedHundredthsOfBip");
  const effective = effectiveHundredthsOfBip(selected);
  if (gross !== 0n && gross < MIN_GROSS_QUOTE_AMOUNT) {
    throw new RangeError(
      `grossQuoteAmount is below the ${MIN_GROSS_QUOTE_AMOUNT}-unit Programmable fee quantum`
    );
  }

  const projectRate = effective - PROGRAMMABLE_HUNDREDTHS_OF_BIP;
  const programmableRemainder = toRemainder(
    remainderState.programmableFeeRemainder ?? 0n,
    "programmableFeeRemainder"
  );
  const projectRemainder = toRemainder(
    remainderState.projectFeeRemainder ?? 0n,
    "projectFeeRemainder"
  );
  const programmable = accumulateRate(gross, PROGRAMMABLE_HUNDREDTHS_OF_BIP, programmableRemainder);
  const project = accumulateRate(gross, projectRate, projectRemainder);
  const programmableFee = programmable.fee;
  const projectFee = project.fee;
  const totalFee = projectFee + programmableFee;

  return Object.freeze({
    grossQuoteAmount: gross,
    selectedHundredthsOfBip: selected,
    effectiveHundredthsOfBip: effective,
    programmableHundredthsOfBip: PROGRAMMABLE_HUNDREDTHS_OF_BIP,
    projectHundredthsOfBip: projectRate,
    totalFee,
    programmableFee,
    projectFee,
    programmableFeeRemainder: programmable.nextRemainder,
    projectFeeRemainder: project.nextRemainder,
    netQuoteAmount: gross - totalFee
  });
}

export function computeExactOutputFeeSplit(netValue, selectedValue, remainderState = {}) {
  const net = toUnsignedBigInt(netValue, "netQuoteAmount");
  const selected = toRate(selectedValue, "selectedHundredthsOfBip");
  const effective = effectiveHundredthsOfBip(selected);
  const denominator = RATE_DENOMINATOR - effective;
  if (net === 0n) return computeGrossFeeSplit(0n, selected, remainderState);
  const estimate = ceilDiv(net * RATE_DENOMINATOR, denominator);
  let gross = estimate > 8n ? estimate - 8n : MIN_GROSS_QUOTE_AMOUNT;
  if (gross < MIN_GROSS_QUOTE_AMOUNT) gross = MIN_GROSS_QUOTE_AMOUNT;
  for (let index = 0; index < 17; index += 1) {
    const split = computeGrossFeeSplit(gross, selected, remainderState);
    if (split.netQuoteAmount === net) return split;
    gross += 1n;
  }
  throw new RangeError("exact-output amount cannot be represented under the declared cumulative rounding rule");
}

function accumulateRate(gross, rate, carriedRemainder) {
  const fractional = (gross * rate) % RATE_DENOMINATOR;
  const combined = fractional + carriedRemainder;
  return {
    fee: (gross * rate) / RATE_DENOMINATOR + combined / RATE_DENOMINATOR,
    nextRemainder: combined % RATE_DENOMINATOR
  };
}

function toRemainder(value, label) {
  const remainder = toUnsignedBigInt(value, label);
  if (remainder >= RATE_DENOMINATOR) throw new RangeError(`${label} must be below ${RATE_DENOMINATOR}`);
  return remainder;
}

export function collectionPathFor({ quoteIsCurrency0, zeroForOne, exactInput }) {
  for (const [name, value] of Object.entries({ quoteIsCurrency0, zeroForOne, exactInput })) {
    if (typeof value !== "boolean") throw new TypeError(`${name} must be boolean`);
  }
  const specifiedIsCurrency0 = zeroForOne === exactInput;
  return specifiedIsCurrency0 === quoteIsCurrency0
    ? "before-swap-return-delta"
    : "after-swap-return-delta";
}

export function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

export function createFeeConformanceManifest({
  root,
  source,
  artifact,
  buildInfo,
  evidence,
  contractName,
  supportingSources = []
}) {
  const rootPath = canonicalRoot(root);
  const sourceRecord = createFileRecord(rootPath, source, "source");
  const artifactRecord = createFileRecord(rootPath, artifact, "artifact");
  const buildInfoRecord = createFileRecord(rootPath, buildInfo, "buildInfo");
  const evidenceRecord = createFileRecord(rootPath, evidence, "evidence");
  if (!/^[A-Z][A-Za-z0-9_]{0,127}$/.test(contractName ?? "")) {
    throw new Error("contractName must be a Solidity identifier beginning with an uppercase letter");
  }

  const normalizedSupporting = supportingSources.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("each supporting source must be an object");
    }
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(entry.role ?? "")) {
      throw new Error("supporting source role must be lowercase kebab-case");
    }
    return { role: entry.role, ...createFileRecord(rootPath, entry.path, "supportingSource") };
  });

  return {
    schemaVersion: FEE_CONFORMANCE_SCHEMA_VERSION,
    candidateStatus: "reference-candidate-not-audited-or-deployed",
    policy: { ...EXPECTED_MANIFEST },
    contract: {
      name: contractName,
      source: sourceRecord,
      artifact: artifactRecord,
      buildInfo: buildInfoRecord,
      supportingSources: normalizedSupporting
    },
    evidence: evidenceRecord
  };
}

export function validateFeeConformance({ manifestPath, root = path.dirname(path.resolve(manifestPath)) }) {
  const errors = [];
  const warnings = [
    "Structural conformance is not a security audit, semantic proof, deployment receipt, or runtime evidence.",
    "Builder-supplied build info and test evidence remain untrusted until a maintainer rebuilds and reruns them in an isolated sandbox."
  ];
  let manifest;
  let rootPath;
  let resolvedManifest;

  try {
    rootPath = canonicalRoot(root);
    resolvedManifest = resolveCandidateFile(rootPath, manifestPath, "manifest", MAX_FILE_BYTES.manifest);
    manifest = readJson(resolvedManifest.absolutePath, "manifest", MAX_FILE_BYTES.manifest);
  } catch (error) {
    errors.push(error.message);
    return conformanceResult(errors, warnings);
  }

  validateFeeConformanceManifestShape(manifest, errors, VALIDATION_POLICY);
  if (errors.length > 0) return conformanceResult(errors, warnings);

  let sourceRecord;
  let artifactRecord;
  let buildInfoRecord;
  let evidenceRecord;
  const supportingRecords = [];
  try {
    sourceRecord = resolveAndHashRecord(rootPath, manifest.contract.source, "source");
    artifactRecord = resolveAndHashRecord(rootPath, manifest.contract.artifact, "artifact");
    buildInfoRecord = resolveAndHashRecord(rootPath, manifest.contract.buildInfo, "buildInfo");
    evidenceRecord = resolveAndHashRecord(rootPath, manifest.evidence, "evidence");
    for (const entry of manifest.contract.supportingSources) {
      supportingRecords.push({
        role: entry.role,
        ...resolveAndHashRecord(rootPath, entry, "supportingSource")
      });
    }
  } catch (error) {
    errors.push(error.message);
    return conformanceResult(errors, warnings);
  }

  const source = fs.readFileSync(sourceRecord.absolutePath, "utf8");
  let artifact;
  let buildInfo;
  let evidence;
  try {
    artifact = readJson(artifactRecord.absolutePath, "artifact", MAX_FILE_BYTES.artifact);
    buildInfo = readJson(buildInfoRecord.absolutePath, "build info", MAX_FILE_BYTES.buildInfo);
    evidence = readJson(evidenceRecord.absolutePath, "evidence", MAX_FILE_BYTES.evidence);
  } catch (error) {
    errors.push(error.message);
    return conformanceResult(errors, warnings);
  }

  validateFeeConformanceDocuments({
    artifact,
    buildInfo,
    source,
    sourcePath: manifest.contract.source.path,
    contractName: manifest.contract.name,
    evidence,
    manifest,
    sourceRecord,
    artifactRecord,
    buildInfoRecord,
    supportingRecords,
    errors,
    policy: VALIDATION_POLICY
  });

  return conformanceResult(errors, warnings, {
    manifestSha256: sha256File(resolvedManifest.absolutePath),
    sourceSha256: sourceRecord.sha256,
    artifactSha256: artifactRecord.sha256,
    buildInfoSha256: buildInfoRecord.sha256,
    evidenceSha256: evidenceRecord.sha256
  });
}

function conformanceResult(errors, warnings, integrity = null) {
  const uniqueErrors = [...new Set(errors)].sort();
  return {
    ok: uniqueErrors.length === 0,
    status: uniqueErrors.length === 0
      ? "STRUCTURALLY_CONFORMANT_REFERENCE_CANDIDATE"
      : "FEE_CONFORMANCE_FAILED",
    policyId: FEE_POLICY_ID,
    policyVersion: FEE_POLICY_VERSION,
    assurance: "structural-only-not-an-audit",
    evidenceTrust: "builder-supplied-untrusted",
    integrity,
    errors: uniqueErrors,
    warnings
  };
}

function createFileRecord(rootPath, requestedPath, kind) {
  const record = resolveCandidateFile(rootPath, requestedPath, kind, MAX_FILE_BYTES[kind]);
  return { path: record.relativePath, sha256: sha256File(record.absolutePath) };
}

function resolveAndHashRecord(rootPath, record, kind) {
  const resolved = resolveCandidateFile(rootPath, record.path, kind, MAX_FILE_BYTES[kind]);
  const digest = sha256File(resolved.absolutePath);
  if (digest !== record.sha256) throw new Error(`${kind} SHA-256 does not match manifest: ${record.path}`);
  return { ...resolved, sha256: digest };
}

function resolveCandidateFile(rootPath, requestedPath, kind, maximumBytes) {
  if (typeof requestedPath !== "string" || requestedPath.length === 0 || requestedPath.includes("\0")) {
    throw new Error(`${kind} path must be a non-empty string`);
  }
  const absolutePath = path.isAbsolute(requestedPath)
    ? fs.realpathSync(path.resolve(requestedPath))
    : path.resolve(rootPath, requestedPath);
  const relativePath = path.relative(rootPath, absolutePath).replaceAll("\\", "/");
  if (relativePath === "" || relativePath === "." || relativePath.startsWith("../") || path.isAbsolute(relativePath)) {
    throw new Error(`${kind} path must stay inside the candidate root`);
  }
  assertNoSymlinkComponents(rootPath, absolutePath, kind);
  const stat = fs.statSync(absolutePath);
  if (!stat.isFile()) throw new Error(`${kind} path is not a file: ${relativePath}`);
  if (stat.size > maximumBytes) throw new Error(`${kind} exceeds ${maximumBytes} bytes: ${relativePath}`);
  return { absolutePath, relativePath };
}

function canonicalRoot(root) {
  if (typeof root !== "string" || root.length === 0) throw new Error("candidate root is required");
  const resolved = fs.realpathSync(path.resolve(root));
  if (!fs.statSync(resolved).isDirectory()) throw new Error("candidate root must be a directory");
  return resolved;
}

function assertNoSymlinkComponents(rootPath, absolutePath, kind) {
  const relative = path.relative(rootPath, absolutePath);
  let cursor = rootPath;
  for (const segment of relative.split(path.sep)) {
    cursor = path.join(cursor, segment);
    const stat = fs.lstatSync(cursor);
    if (stat.isSymbolicLink()) throw new Error(`${kind} path may not contain symbolic links`);
  }
}

function readJson(filePath, label, maximumBytes) {
  let value;
  try {
    value = parseBoundedStrictJsonBytes(fs.readFileSync(filePath), {
      maxSourceBytes: maximumBytes,
      maxNodes: Math.max(250_000, Math.min(8_000_000, maximumBytes))
    });
  } catch (error) {
    throw new Error(`${label} is not bounded duplicate-free UTF-8 JSON: ${error.message}`);
  }
  return value;
}

function toRate(value, label) {
  const rate = toUnsignedBigInt(value, label);
  if (rate > MAX_SELECTED_HUNDREDTHS_OF_BIP) {
    throw new RangeError(`${label} must be at most ${MAX_SELECTED_HUNDREDTHS_OF_BIP}`);
  }
  return rate;
}

function toUnsignedBigInt(value, label) {
  let parsed;
  try {
    if (typeof value === "bigint") parsed = value;
    else if (typeof value === "number" && Number.isSafeInteger(value)) parsed = BigInt(value);
    else if (typeof value === "string" && /^(?:0|[1-9][0-9]*)$/.test(value)) parsed = BigInt(value);
    else throw new Error();
  } catch {
    throw new TypeError(`${label} must be an unsigned integer`);
  }
  if (parsed < 0n) throw new RangeError(`${label} must be non-negative`);
  return parsed;
}

function ceilDiv(numerator, denominator) {
  if (denominator <= 0n) throw new RangeError("denominator must be positive");
  return numerator === 0n ? 0n : (numerator + denominator - 1n) / denominator;
}
