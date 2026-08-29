import {
  CONSTITUTION_ID,
  PROTOCOL_ASSESSMENT_DENOMINATOR,
  PROTOCOL_SPEC_ID,
  UINT128_MAX,
} from "./constants.js";
import { ProgrammableSdkError, invariant } from "./errors.js";
import {
  assertAuthorizationScopeDescriptorV1,
  authorizationScopeIdV1,
} from "./portable-identifiers.js";
import { canonicalizePortableValue, parsePortableJson } from "./portable-json.js";
import { checkedAddUint128, isCanonicalDecimal, parseUint128Decimal } from "./uint.js";

export interface ProtocolAssessmentDelta {
  readonly basisBefore: bigint;
  readonly fillBasis: bigint;
  readonly basisAfter: bigint;
  readonly assessmentBefore: bigint;
  readonly assessmentDelta: bigint;
  readonly assessmentAfter: bigint;
  readonly remainderBefore: bigint;
  readonly remainderAfter: bigint;
}

export function protocolAssessmentAt(cumulativeBasis: bigint): bigint {
  if (
    typeof cumulativeBasis !== "bigint" ||
    cumulativeBasis < 0n ||
    cumulativeBasis > UINT128_MAX
  ) {
    throw new ProgrammableSdkError(
      "ASSESSMENT_UINT128_RANGE",
      "ProtocolAssessmentV1 cumulative basis is outside uint128",
    );
  }
  return cumulativeBasis / PROTOCOL_ASSESSMENT_DENOMINATOR;
}

export function protocolAssessmentDelta(
  basisBefore: bigint,
  fillBasis: bigint,
): ProtocolAssessmentDelta {
  const basisAfter = checkedAddUint128(basisBefore, fillBasis, "assessment.basisAfter");
  const assessmentBefore = protocolAssessmentAt(basisBefore);
  const assessmentAfter = protocolAssessmentAt(basisAfter);
  return Object.freeze({
    basisBefore,
    fillBasis,
    basisAfter,
    assessmentBefore,
    assessmentDelta: assessmentAfter - assessmentBefore,
    assessmentAfter,
    remainderBefore: basisBefore % PROTOCOL_ASSESSMENT_DENOMINATOR,
    remainderAfter: basisAfter % PROTOCOL_ASSESSMENT_DENOMINATOR,
  });
}

export class AssessmentVectorError extends ProgrammableSdkError {
  constructor(code: string, message: string) {
    super(code, message);
    this.name = "AssessmentVectorError";
  }
}

type UnknownRecord = Record<string, unknown>;
const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/;
const CASE_ID = /^[a-z0-9][a-z0-9._-]+$/;
const EXPECTED_ERROR = /^[a-z0-9][a-z0-9_]+$/;
const PROFILE_ID = /^[a-z][a-z0-9]*(?:[._:-][a-z0-9][a-z0-9_-]*)+$/;
const AUTHORIZATION_PROFILES = new Set([
  "direct-one-shot-v1",
  "signed-one-shot-v1",
  "stored-scope-v1",
]);

export interface AssessmentFillResult {
  readonly basis_before: string;
  readonly fill_basis: string;
  readonly basis_after: string;
  readonly assessment_before: string;
  readonly assessment_delta: string;
  readonly assessment_after: string;
  readonly remainder_before: string;
  readonly remainder_after: string;
  readonly emit_assessment_record: boolean;
  readonly gross_assessment_debit: string;
  readonly funded_credit: string;
  readonly liability_delta: string;
}

export interface AssessmentCaseResult {
  readonly status: "accept" | "reject";
  readonly errorCode?: string;
  readonly groups?: readonly (readonly AssessmentFillResult[])[];
}

function fail(code: string, message: string): never {
  throw new AssessmentVectorError(code, message);
}

function record(value: unknown, label: string): UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail("invalid_vector_shape", `${label} must be an object`);
  }
  return value as UnknownRecord;
}

function array(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    fail("invalid_vector_shape", `${label} must be an array`);
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) {
      fail("invalid_vector_shape", `${label} cannot contain sparse positions`);
    }
  }
  return value;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    fail("invalid_vector_shape", `${label} must be a non-empty string`);
  }
  return value;
}

function limitedText(value: unknown, label: string, maximum: number): string {
  const result = text(value, label);
  if ([...result].length > maximum) {
    fail("invalid_vector_shape", `${label} exceeds ${maximum} Unicode scalars`);
  }
  return result;
}

function digest(value: unknown, label: string): string {
  if (typeof value !== "string" || !SHA256_DIGEST.test(value)) {
    fail("invalid_vector_shape", `${label} must be a lowercase SHA-256 identifier`);
  }
  return value;
}

function patternedText(value: unknown, label: string, pattern: RegExp): string {
  const result = text(value, label);
  if (!pattern.test(result)) fail("invalid_vector_shape", `${label} has an invalid format`);
  return result;
}

function decimalText(value: unknown, label: string): string {
  if (!isCanonicalDecimal(value)) {
    fail("invalid_vector_shape", `${label} must be a canonical non-negative decimal string`);
  }
  return value;
}

function u128(value: unknown, label: string): bigint {
  try {
    return parseUint128Decimal(value, label);
  } catch (error) {
    if (error instanceof ProgrammableSdkError) {
      if (error.code === "INTEGER_OUT_OF_RANGE") {
        fail("arithmetic_overflow", error.message);
      }
      fail("invalid_decimal", error.message);
    }
    throw error;
  }
}

function add(left: bigint, right: bigint, label: string): bigint {
  try {
    return checkedAddUint128(left, right, label);
  } catch (error) {
    if (error instanceof ProgrammableSdkError) {
      fail("arithmetic_overflow", error.message);
    }
    throw error;
  }
}

function assessmentDeltaChecked(
  basisBefore: bigint,
  fillBasis: bigint,
  label: string,
): ProtocolAssessmentDelta {
  try {
    return protocolAssessmentDelta(basisBefore, fillBasis);
  } catch (error) {
    if (error instanceof ProgrammableSdkError) {
      fail("arithmetic_overflow", `${label}: ${error.message}`);
    }
    throw error;
  }
}

function sameScopeKey(groupKey: UnknownRecord): string {
  return canonicalizePortableValue({
    core_deployment_id: groupKey["core_deployment_id"],
    constitution_id: groupKey["constitution_id"],
    authorization_scope_id: groupKey["authorization_scope_id"],
  });
}

function expectedResult(actual: ProtocolAssessmentDelta, applicableCount: number, funded: bigint): AssessmentFillResult {
  return Object.freeze({
    basis_before: actual.basisBefore.toString(),
    fill_basis: actual.fillBasis.toString(),
    basis_after: actual.basisAfter.toString(),
    assessment_before: actual.assessmentBefore.toString(),
    assessment_delta: actual.assessmentDelta.toString(),
    assessment_after: actual.assessmentAfter.toString(),
    remainder_before: actual.remainderBefore.toString(),
    remainder_after: actual.remainderAfter.toString(),
    emit_assessment_record: applicableCount > 0,
    gross_assessment_debit: actual.assessmentDelta.toString(),
    funded_credit: funded.toString(),
    liability_delta: funded.toString(),
  });
}

function exactKeys(value: UnknownRecord, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (actual.length !== required.length || actual.some((key, index) => key !== required[index])) {
    fail("invalid_vector_shape", `${label} does not have the exact ProtocolAssessmentV1 fields`);
  }
}

function shape(
  value: UnknownRecord,
  required: readonly string[],
  optional: readonly string[],
  label: string,
): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail("invalid_vector_shape", `${label} contains unknown field ${key}`);
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) fail("invalid_vector_shape", `${label} is missing ${key}`);
  }
}

function nonEmptyArray(value: unknown, label: string): readonly unknown[] {
  const result = array(value, label);
  if (result.length === 0) fail("invalid_vector_shape", `${label} must not be empty`);
  return result;
}

function validateRequiredProfiles(value: unknown, label: string): readonly string[] {
  const profiles = nonEmptyArray(value, label);
  const seen = new Set<string>();
  for (const [index, rawProfile] of profiles.entries()) {
    const profile = patternedText(rawProfile, `${label}[${index}]`, PROFILE_ID);
    if (seen.has(profile)) fail("invalid_vector_shape", `${label} repeats ${profile}`);
    seen.add(profile);
  }
  if (!seen.has("portable-core-v1")) {
    fail("invalid_vector_shape", `${label} must contain portable-core-v1`);
  }
  return profiles as readonly string[];
}

function validateExpectedFill(value: unknown, label: string): void {
  const expected = record(value, label);
  exactKeys(
    expected,
    [
      "basis_before",
      "fill_basis",
      "basis_after",
      "assessment_before",
      "assessment_delta",
      "assessment_after",
      "remainder_before",
      "remainder_after",
      "emit_assessment_record",
      "gross_assessment_debit",
      "funded_credit",
      "liability_delta",
    ],
    label,
  );
  for (const field of [
    "basis_before",
    "fill_basis",
    "basis_after",
    "assessment_before",
    "assessment_delta",
    "assessment_after",
    "remainder_before",
    "remainder_after",
    "gross_assessment_debit",
    "funded_credit",
    "liability_delta",
  ]) {
    decimalText(expected[field], `${label}.${field}`);
  }
  if (typeof expected["emit_assessment_record"] !== "boolean") {
    fail("invalid_vector_shape", `${label}.emit_assessment_record must be boolean`);
  }
}

function validateDocumentProfile(document: UnknownRecord): {
  readonly protocolSpecId: string;
  readonly constitutionId: string;
} {
  exactKeys(
    document,
    ["$schema", "protocol_spec_id", "assessment_profile", "authenticated_principal_evidence", "cases"],
    "assessment vector document",
  );
  if (document["$schema"] !== "urn:programmable:schema:protocol-assessment-vectors:v1") {
    fail("assessment_document_schema_mismatch", "assessment vector document schema is not ProtocolAssessmentV1");
  }
  const protocolSpecId = text(document["protocol_spec_id"], "protocol_spec_id");
  if (protocolSpecId !== PROTOCOL_SPEC_ID) {
    fail("assessment_protocol_lock_mismatch", "assessment vector document differs from the pinned Protocol Spec");
  }
  const profile = record(document["assessment_profile"], "assessment_profile");
  const expectedProfile: Readonly<Record<string, string>> = {
    constitution_id: CONSTITUTION_ID,
    assessment_id: "ProtocolAssessmentV1",
    basis_id: "PrincipalFundedGrossDebitV1",
    exclusion_set_id: "PrincipalFundedGrossDebitV1ClosedExclusions",
    rate_numerator: "5",
    rate_denominator: "10000",
    reduced_denominator: PROTOCOL_ASSESSMENT_DENOMINATOR.toString(),
    rounding: "floor_after_cumulative_group_aggregation",
    minimum: "0",
    flat_component: "0",
    fee_asset_rule: "same_as_basis_asset",
    funding_rule: "additive",
    assessment_amount_rule: "gross_source_debit",
    arithmetic_bits: "128",
    collector_policy: "immutable_per_core_deployment",
  };
  exactKeys(profile, Object.keys(expectedProfile), "assessment_profile");
  for (const [field, expected] of Object.entries(expectedProfile)) {
    if (profile[field] !== expected) {
      fail("assessment_profile_mismatch", `assessment_profile.${field} differs from ProtocolAssessmentV1`);
    }
  }
  return { protocolSpecId, constitutionId: CONSTITUTION_ID };
}

function indexEvidence(
  document: UnknownRecord,
  protocolSpecId: string,
  constitutionId: string,
): ReadonlyMap<string, UnknownRecord> {
  const result = new Map<string, UnknownRecord>();
  for (const [index, rawEvidence] of nonEmptyArray(
    document["authenticated_principal_evidence"],
    "authenticated_principal_evidence",
  ).entries()) {
    const label = `authenticated_principal_evidence[${index}]`;
    const evidence = record(rawEvidence, label);
    exactKeys(
      evidence,
      [
        "authorization_evidence_ref",
        "authorization_scope_id",
        "principal_id",
        "authorization_profile_id",
        "authentication_result",
        "primary_provenance",
        "execution_coverage",
        "scope_descriptor",
      ],
      label,
    );
    const reference = digest(evidence["authorization_evidence_ref"], `${label}.authorization_evidence_ref`);
    digest(evidence["authorization_scope_id"], `${label}.authorization_scope_id`);
    limitedText(evidence["principal_id"], `${label}.principal_id`, 256);
    if (!AUTHORIZATION_PROFILES.has(evidence["authorization_profile_id"] as string)) {
      fail("invalid_vector_shape", `${label}.authorization_profile_id is unsupported`);
    }
    if (result.has(reference)) fail("duplicate_authorization_evidence_ref", `${label} repeats ${reference}`);
    if (
      evidence["authentication_result"] !== "AUTHENTICATED" ||
      evidence["primary_provenance"] !== "CORE_VERIFIED" ||
      evidence["execution_coverage"] !== "CORE_ENFORCED"
    ) {
      fail("sponsor_evidence_not_core_authenticated", `${label} is not authenticated Core-enforced evidence`);
    }
    const descriptor = record(evidence["scope_descriptor"], `${label}.scope_descriptor`);
    try {
      assertAuthorizationScopeDescriptorV1(descriptor);
    } catch (error) {
      fail(
        "invalid_sponsor_scope_descriptor",
        `${label}.scope_descriptor is invalid: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (authorizationScopeIdV1(descriptor) !== evidence["authorization_scope_id"]) {
      fail("sponsor_scope_id_mismatch", `${label} Scope ID does not match its descriptor`);
    }
    if (descriptor["protocol_spec_id"] !== protocolSpecId) {
      fail("sponsor_protocol_spec_mismatch", `${label} binds another Protocol Spec`);
    }
    if (descriptor["constitution_id"] !== constitutionId) {
      fail("sponsor_constitution_mismatch", `${label} binds another Constitution`);
    }
    if (descriptor["principal_id"] !== evidence["principal_id"]) {
      fail("sponsor_descriptor_principal_mismatch", `${label} descriptor Principal differs from evidence`);
    }
    if (descriptor["authorization_profile_id"] !== evidence["authorization_profile_id"]) {
      fail("sponsor_descriptor_profile_mismatch", `${label} descriptor profile differs from evidence`);
    }
    result.set(reference, evidence);
  }
  return result;
}

function evaluateAcceptedCase(
  rawCase: unknown,
  evidenceByReference: ReadonlyMap<string, UnknownRecord>,
): readonly (readonly AssessmentFillResult[])[] {
  const testCase = record(rawCase, "case");
  shape(
    testCase,
    ["case_id", "purpose", "required_profiles", "expected_status", "groups"],
    ["expected_error"],
    "case",
  );
  const caseId = patternedText(testCase["case_id"], "case.case_id", CASE_ID);
  text(testCase["purpose"], `${caseId}.purpose`);
  const expectedStatus = testCase["expected_status"];
  if (expectedStatus !== "accept" && expectedStatus !== "reject") {
    fail("invalid_vector_shape", `${caseId}.expected_status must be accept or reject`);
  }
  const hasExpectedError = Object.hasOwn(testCase, "expected_error");
  if ((expectedStatus === "reject") !== hasExpectedError) {
    fail("invalid_vector_shape", `${caseId} expected_error presence must match reject status`);
  }
  if (hasExpectedError) patternedText(testCase["expected_error"], `${caseId}.expected_error`, EXPECTED_ERROR);
  const requiredProfiles = validateRequiredProfiles(
    testCase["required_profiles"],
    `${caseId}.required_profiles`,
  );
  const seenGroupKeys = new Set<string>();
  const scopeStates = new Map<
    string,
    { assessmentPrincipal: string; debitIds: Set<string>; refundIds: Set<string> }
  >();
  const sponsorStates = new Map<string, { maximum: bigint; used: bigint }>();
  const output: (readonly AssessmentFillResult[])[] = [];

  for (const [groupIndex, rawGroup] of nonEmptyArray(testCase["groups"], `${caseId}.groups`).entries()) {
    const group = record(rawGroup, `${caseId}.groups[${groupIndex}]`);
    shape(
      group,
      ["group_key", "protocol_collector_id", "basis_before", "fills"],
      ["stored_assessment"],
      `${caseId}.groups[${groupIndex}]`,
    );
    const groupKey = record(group["group_key"], `${caseId}.groups[${groupIndex}].group_key`);
    exactKeys(
      groupKey,
      [
        "core_deployment_id",
        "constitution_id",
        "authorization_scope_id",
        "assessment_principal_id",
        "asset_profile_id",
        "native_asset_id",
      ],
      `${caseId}.groups[${groupIndex}].group_key`,
    );
    for (const field of [
      "core_deployment_id",
      "authorization_scope_id",
      "assessment_principal_id",
      "asset_profile_id",
      "native_asset_id",
    ]) {
      text(groupKey[field], `${caseId}.groups[${groupIndex}].group_key.${field}`);
    }
    digest(groupKey["constitution_id"], `${caseId}.groups[${groupIndex}].group_key.constitution_id`);
    if (groupKey["constitution_id"] !== CONSTITUTION_ID) {
      fail("group_constitution_mismatch", `${caseId} assessment group binds another Constitution`);
    }
    text(group["protocol_collector_id"], `${caseId}.groups[${groupIndex}].protocol_collector_id`);
    const canonicalGroupKey = canonicalizePortableValue(groupKey);
    if (seenGroupKeys.has(canonicalGroupKey)) {
      fail("duplicate_group_key", `${caseId} repeats a canonical assessment group`);
    }
    seenGroupKeys.add(canonicalGroupKey);

    const scopeKey = sameScopeKey(groupKey);
    const assessmentPrincipal = text(
      groupKey["assessment_principal_id"],
      `${caseId}.groups[${groupIndex}].group_key.assessment_principal_id`,
    );
    let scope = scopeStates.get(scopeKey);
    if (scope === undefined) {
      scope = { assessmentPrincipal, debitIds: new Set(), refundIds: new Set() };
      scopeStates.set(scopeKey, scope);
    } else if (scope.assessmentPrincipal !== assessmentPrincipal) {
      fail("scope_principal_mismatch", `${caseId} binds one Scope to multiple Principals`);
    }

    let cumulativeBasis = u128(group["basis_before"], `${caseId}.groups[${groupIndex}].basis_before`);
    if (Object.hasOwn(group, "stored_assessment")) {
      const stored = u128(group["stored_assessment"], `${caseId}.groups[${groupIndex}].stored_assessment`);
      if (stored !== protocolAssessmentAt(cumulativeBasis)) {
        fail("stored_assessment_mismatch", `${caseId} stored assessment is not cumulative floor`);
      }
    }

    const knownOrigins = new Set<string>();
    let previousSequence: bigint | undefined;
    const groupOutput: AssessmentFillResult[] = [];
    for (const [fillIndex, rawFill] of nonEmptyArray(
      group["fills"],
      `${caseId}.groups[${groupIndex}].fills`,
    ).entries()) {
      const fill = record(rawFill, `${caseId}.groups[${groupIndex}].fills[${fillIndex}]`);
      shape(
        fill,
        ["fill_sequence", "debits", "refunds", "protocol_withholding"],
        [
          "fee_funding_principal_id",
          "fee_funding_scope_id",
          "fee_funding_authorization_evidence_ref",
          "assessment_ceiling",
          "force_postcondition_failure",
          "expected",
        ],
        `${caseId}.groups[${groupIndex}].fills[${fillIndex}]`,
      );
      if (Object.hasOwn(fill, "expected")) {
        validateExpectedFill(fill["expected"], `${caseId}.groups[${groupIndex}].fills[${fillIndex}].expected`);
      }
      const sponsorFields = [
        "fee_funding_principal_id",
        "fee_funding_scope_id",
        "fee_funding_authorization_evidence_ref",
      ] as const;
      const sponsorFieldCount = sponsorFields.filter((field) => Object.hasOwn(fill, field)).length;
      if (sponsorFieldCount !== 0 && sponsorFieldCount !== sponsorFields.length) {
        fail("invalid_vector_shape", `${caseId} has an incomplete sponsor funding tuple`);
      }
      const hasSponsorFunding = sponsorFieldCount === sponsorFields.length;
      if (
        Object.hasOwn(fill, "force_postcondition_failure") &&
        typeof fill["force_postcondition_failure"] !== "boolean"
      ) {
        fail("invalid_vector_shape", `${caseId}.force_postcondition_failure must be boolean`);
      }
      const sequence = u128(fill["fill_sequence"], `${caseId}.fill_sequence`);
      if (previousSequence !== undefined && sequence <= previousSequence) {
        fail("non_increasing_fill_sequence", `${caseId} fill sequence is not strictly increasing`);
      }
      previousSequence = sequence;

      const currentOrigins = new Map<string, { amount: bigint; classification: string }>();
      let applicableDebit = 0n;
      let applicableCount = 0;
      for (const [debitIndex, rawDebit] of array(fill["debits"], `${caseId}.debits`).entries()) {
        const debit = record(rawDebit, `${caseId}.debits[${debitIndex}]`);
        shape(
          debit,
          ["debit_id", "amount", "classification"],
          ["label", "included_disclosures"],
          `${caseId}.debits[${debitIndex}]`,
        );
        if (Object.hasOwn(debit, "label")) text(debit["label"], `${caseId}.debits[${debitIndex}].label`);
        if (Object.hasOwn(debit, "included_disclosures")) {
          const disclosures = array(
            debit["included_disclosures"],
            `${caseId}.debits[${debitIndex}].included_disclosures`,
          );
          const seenDisclosures = new Set<string>();
          for (const [disclosureIndex, rawDisclosure] of disclosures.entries()) {
            const disclosure = text(
              rawDisclosure,
              `${caseId}.debits[${debitIndex}].included_disclosures[${disclosureIndex}]`,
            );
            if (seenDisclosures.has(disclosure)) {
              fail("invalid_vector_shape", `${caseId} debit repeats disclosure ${disclosure}`);
            }
            seenDisclosures.add(disclosure);
          }
        }
        const debitId = text(debit["debit_id"], `${caseId}.debits[${debitIndex}].debit_id`);
        if (scope.debitIds.has(debitId)) {
          fail("duplicate_debit_id", `${caseId} repeats debit ${debitId}`);
        }
        scope.debitIds.add(debitId);
        knownOrigins.add(debitId);
        const amount = u128(debit["amount"], `${caseId}.debits[${debitIndex}].amount`);
        const classification = text(debit["classification"], `${caseId}.debits[${debitIndex}].classification`);
        if (classification !== "applicable" && classification !== "closed_exemption") {
          fail("invalid_debit_classification", `${caseId} uses an unknown debit classification`);
        }
        currentOrigins.set(debitId, { amount, classification });
        if (classification === "applicable") {
          applicableDebit = add(applicableDebit, amount, `${caseId}.applicableDebit`);
          applicableCount += 1;
        }
      }

      const refundedPerOrigin = new Map<string, bigint>();
      let applicableRefund = 0n;
      for (const [refundIndex, rawRefund] of array(fill["refunds"], `${caseId}.refunds`).entries()) {
        const refund = record(rawRefund, `${caseId}.refunds[${refundIndex}]`);
        exactKeys(
          refund,
          ["refund_id", "origin_debit_id", "amount", "proof"],
          `${caseId}.refunds[${refundIndex}]`,
        );
        const refundId = text(refund["refund_id"], `${caseId}.refunds[${refundIndex}].refund_id`);
        if (scope.refundIds.has(refundId)) {
          fail("duplicate_refund_id", `${caseId} repeats refund ${refundId}`);
        }
        scope.refundIds.add(refundId);
        const proof = text(refund["proof"], `${caseId}.refunds[${refundIndex}].proof`);
        if (proof !== "segregated_unused_origin" && proof !== "exact_pre_use_reversal") {
          fail("invalid_refund_proof", `${caseId} uses an inadmissible refund proof`);
        }
        const originId = text(refund["origin_debit_id"], `${caseId}.refunds[${refundIndex}].origin_debit_id`);
        const origin = currentOrigins.get(originId);
        if (origin === undefined) {
          fail(
            knownOrigins.has(originId) ? "refund_origin_not_current_fill" : "unknown_refund_origin",
            `${caseId} refund does not identify a current-fill origin`,
          );
        }
        const amount = u128(refund["amount"], `${caseId}.refunds[${refundIndex}].amount`);
        const refunded = add(refundedPerOrigin.get(originId) ?? 0n, amount, `${caseId}.refundedOrigin`);
        if (refunded > origin.amount) {
          fail("refund_exceeds_origin", `${caseId} refunds more than its origin debit`);
        }
        refundedPerOrigin.set(originId, refunded);
        if (origin.classification === "applicable") {
          applicableRefund = add(applicableRefund, amount, `${caseId}.applicableRefund`);
        }
      }

      if (applicableRefund > applicableDebit) {
        fail("negative_fill_basis", `${caseId} refunds exceed applicable gross debit`);
      }
      const delta = assessmentDeltaChecked(
        cumulativeBasis,
        applicableDebit - applicableRefund,
        `${caseId}.cumulativeBasis`,
      );
      const withholding = u128(fill["protocol_withholding"], `${caseId}.protocol_withholding`);

      if (hasSponsorFunding) {
        if (!requiredProfiles.includes("sponsored-assessment-v1")) {
          fail("sponsor_profile_not_applicable", `${caseId} uses sponsorship without its profile`);
        }
        const feePrincipal = text(fill["fee_funding_principal_id"], `${caseId}.fee_funding_principal_id`);
        if (feePrincipal === assessmentPrincipal) {
          fail("sponsor_principal_not_separate", `${caseId} sponsor is not a separate Principal`);
        }
        const evidenceReference = digest(
          fill["fee_funding_authorization_evidence_ref"],
          `${caseId}.fee_funding_authorization_evidence_ref`,
        );
        const evidence = evidenceByReference.get(evidenceReference);
        if (evidence === undefined) {
          fail("sponsor_authorization_evidence_missing", `${caseId} sponsor evidence is unknown`);
        }
        const feeScope = digest(fill["fee_funding_scope_id"], `${caseId}.fee_funding_scope_id`);
        if (evidence["authorization_scope_id"] !== feeScope) {
          fail("sponsor_scope_evidence_mismatch", `${caseId} sponsor Scope differs from its evidence`);
        }
        if (evidence["principal_id"] !== feePrincipal) {
          fail("sponsor_principal_evidence_mismatch", `${caseId} sponsor Principal differs from its evidence`);
        }
        const descriptor = record(evidence["scope_descriptor"], `${caseId}.sponsor.scope_descriptor`);
        if (
          descriptor["core_deployment_id"] !== groupKey["core_deployment_id"] ||
          descriptor["constitution_id"] !== groupKey["constitution_id"]
        ) {
          fail("sponsor_scope_context_mismatch", `${caseId} sponsor binds another Core context`);
        }
        const scopeAuthorizations = array(
          descriptor["sponsored_assessment_authorizations"] ?? [],
          `${caseId}.sponsor.authorizations`,
        )
          .map((entry, index) => record(entry, `${caseId}.sponsor.authorizations[${index}]`))
          .filter(
            (entry) => entry["assessment_authorization_scope_id"] === groupKey["authorization_scope_id"],
          );
        if (scopeAuthorizations.length === 0) {
          fail("sponsor_scope_mismatch", `${caseId} sponsor authorizes another assessment Scope`);
        }
        const matching = scopeAuthorizations.filter(
          (entry) =>
            entry["assessment_principal_id"] === assessmentPrincipal &&
            entry["asset_profile_id"] === groupKey["asset_profile_id"] &&
            entry["native_asset_id"] === groupKey["native_asset_id"] &&
            entry["protocol_collector_id"] === group["protocol_collector_id"],
        );
        if (matching.length !== 1) {
          fail("sponsor_authorization_mismatch", `${caseId} sponsor tuple does not match the assessment group`);
        }
        const authorization = matching[0];
        invariant(authorization !== undefined, "UNREACHABLE", "matching authorization disappeared");
        const maximum = u128(
          authorization["maximum_gross_assessment_debit"],
          `${caseId}.sponsor.maximum_gross_assessment_debit`,
        );
        const sponsorKey = canonicalizePortableValue({
          fee_funding_principal_id: evidence["principal_id"],
          fee_funding_scope_id: evidence["authorization_scope_id"],
          assessment_authorization_scope_id: authorization["assessment_authorization_scope_id"],
          assessment_principal_id: authorization["assessment_principal_id"],
          asset_profile_id: authorization["asset_profile_id"],
          native_asset_id: authorization["native_asset_id"],
          protocol_collector_id: authorization["protocol_collector_id"],
        });
        const prior = sponsorStates.get(sponsorKey);
        if (prior !== undefined && prior.maximum !== maximum) {
          fail("sponsor_authorization_inconsistent", `${caseId} sponsor tuple changes its ceiling`);
        }
        const used = add(prior?.used ?? 0n, delta.assessmentDelta, `${caseId}.sponsor.used`);
        if (used > maximum) {
          fail("sponsor_assessment_ceiling_exceeded", `${caseId} exceeds sponsor assessment ceiling`);
        }
        sponsorStates.set(sponsorKey, { maximum, used });
      }

      if (Object.hasOwn(fill, "assessment_ceiling")) {
        const ceiling = u128(fill["assessment_ceiling"], `${caseId}.assessment_ceiling`);
        if (delta.assessmentDelta > ceiling) {
          fail("assessment_ceiling_exceeded", `${caseId} exceeds the signed assessment ceiling`);
        }
      }
      if (withholding > delta.assessmentDelta) {
        fail("withholding_exceeds_assessment", `${caseId} withholds more than gross assessment`);
      }
      const funded = delta.assessmentDelta - withholding;
      if (delta.assessmentDelta > 0n && funded === 0n) {
        fail("zero_funded_credit", `${caseId} creates no spendable assessment credit`);
      }
      if (fill["force_postcondition_failure"] === true) {
        fail("postcondition_failure", `${caseId} forces a postcondition failure`);
      }

      groupOutput.push(expectedResult(delta, applicableCount, funded));
      cumulativeBasis = delta.basisAfter;
    }
    output.push(Object.freeze(groupOutput));
  }
  return Object.freeze(output);
}

function evaluateProtocolAssessmentCase(
  rawCase: unknown,
  authenticatedPrincipalEvidence: ReadonlyMap<string, UnknownRecord> = new Map(),
): AssessmentCaseResult {
  try {
    return Object.freeze({
      status: "accept",
      groups: evaluateAcceptedCase(rawCase, authenticatedPrincipalEvidence),
    });
  } catch (error) {
    if (error instanceof AssessmentVectorError) {
      return Object.freeze({ status: "reject", errorCode: error.code });
    }
    throw error;
  }
}

export function evaluateProtocolAssessmentVectorDocument(documentValue: unknown): readonly AssessmentCaseResult[] {
  const document = record(
    parsePortableJson(canonicalizePortableValue(documentValue)),
    "assessment vector document",
  );
  const profile = validateDocumentProfile(document);
  const evidence = indexEvidence(document, profile.protocolSpecId, profile.constitutionId);
  const cases = nonEmptyArray(document["cases"], "assessment vector document.cases");
  const seenCaseIds = new Set<string>();
  for (const [index, rawCase] of cases.entries()) {
    const testCase = record(rawCase, `assessment vector document.cases[${index}]`);
    const caseId = patternedText(
      testCase["case_id"],
      `assessment vector document.cases[${index}].case_id`,
      CASE_ID,
    );
    if (seenCaseIds.has(caseId)) fail("duplicate_case_id", `assessment vector document repeats ${caseId}`);
    seenCaseIds.add(caseId);
  }
  return Object.freeze(cases.map((testCase) => evaluateProtocolAssessmentCase(testCase, evidence)));
}
