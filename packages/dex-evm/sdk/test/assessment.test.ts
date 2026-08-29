import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import {
  PortableJsonError,
  UINT128_MAX,
  evaluateProtocolAssessmentVectorDocument,
  parseUint128Decimal,
  protocolAssessmentAt,
  protocolAssessmentDelta,
} from "../src/index.js";
import { PROTOCOL_SNAPSHOT, readJson } from "./helpers.js";

interface AssessmentCase {
  readonly case_id: string;
  readonly expected_status: "accept" | "reject";
  readonly expected_error?: string;
  readonly groups: readonly {
    readonly fills: readonly {
      readonly expected?: unknown;
      readonly debits?: readonly { classification: string }[];
    }[];
  }[];
}

interface AssessmentDocument {
  assessment_profile: Record<string, unknown>;
  authenticated_principal_evidence: {
    authorization_evidence_ref: string;
    authorization_scope_id: string;
    principal_id: string;
    authorization_profile_id: string;
    authentication_result: string;
    primary_provenance: string;
    execution_coverage: string;
    scope_descriptor: Record<string, unknown>;
  }[];
  readonly cases: readonly AssessmentCase[];
}

function assessmentDocument(): AssessmentDocument {
  return readJson(
    resolve(PROTOCOL_SNAPSHOT, "vectors/protocol-assessment-v1.json"),
  ) as AssessmentDocument;
}

function changingGetProxy<T extends object>(target: T) {
  const descriptorReads = new Map<PropertyKey, number>();
  const getReads = new Map<PropertyKey, number>();
  const proxy = new Proxy(target, {
    get(current, key, receiver) {
      const reads = (getReads.get(key) ?? 0) + 1;
      getReads.set(key, reads);
      return reads === 1 ? Reflect.get(current, key, receiver) : undefined;
    },
    getOwnPropertyDescriptor(current, key) {
      descriptorReads.set(key, (descriptorReads.get(key) ?? 0) + 1);
      return Reflect.getOwnPropertyDescriptor(current, key);
    },
  });
  return { proxy, descriptorReads, getReads };
}

function assertOwnDescriptorsReadOnce(
  target: object,
  trace: ReturnType<typeof changingGetProxy>,
): void {
  const keys = Reflect.ownKeys(target);
  assert.equal(trace.descriptorReads.size, keys.length);
  for (const key of keys) assert.equal(trace.descriptorReads.get(key), 1, String(key));
  assert.equal(trace.getReads.size, 0);
}

const invalidPortableValue = (error: unknown): boolean =>
  error instanceof PortableJsonError && error.code === "invalid_json_value";

test("independent ProtocolAssessmentV1 evaluator passes all pinned cases", () => {
  const document = assessmentDocument();
  const results = evaluateProtocolAssessmentVectorDocument(document);
  assert.equal(results.length, 45);
  assert.equal(results.length, document.cases.length);

  for (const [caseIndex, vector] of document.cases.entries()) {
    const result = results[caseIndex];
    assert.notEqual(result, undefined, vector.case_id);
    assert.equal(result?.status, vector.expected_status, vector.case_id);
    if (vector.expected_status === "reject") {
      assert.equal(result?.errorCode, vector.expected_error, vector.case_id);
      continue;
    }
    assert.deepEqual(
      result?.groups,
      vector.groups.map((group) => group.fills.map((fill) => fill.expected)),
      vector.case_id,
    );
  }
});

test("assessment evaluator snapshots root and nested Proxy descriptors exactly once", () => {
  const expected = evaluateProtocolAssessmentVectorDocument(assessmentDocument());
  const document = assessmentDocument();
  const profile = document.assessment_profile;
  const profileTrace = changingGetProxy(profile);
  document.assessment_profile = profileTrace.proxy;
  const documentTrace = changingGetProxy(document);

  assert.deepEqual(evaluateProtocolAssessmentVectorDocument(documentTrace.proxy), expected);
  assertOwnDescriptorsReadOnce(document, documentTrace);
  assertOwnDescriptorsReadOnce(profile, profileTrace);
});

test("assessment evaluator rejects root and nested accessors without invoking them", () => {
  const rootAccessor = assessmentDocument() as unknown as Record<string, unknown>;
  let rootReads = 0;
  Object.defineProperty(rootAccessor, "cases", {
    configurable: true,
    enumerable: true,
    get() {
      rootReads += 1;
      return [];
    },
  });
  assert.throws(
    () => evaluateProtocolAssessmentVectorDocument(rootAccessor),
    invalidPortableValue,
  );
  assert.equal(rootReads, 0);

  const nestedAccessor = assessmentDocument();
  let nestedReads = 0;
  Object.defineProperty(nestedAccessor.assessment_profile, "reduced_denominator", {
    configurable: true,
    enumerable: true,
    get() {
      nestedReads += 1;
      return "2000";
    },
  });
  assert.throws(
    () => evaluateProtocolAssessmentVectorDocument(nestedAccessor),
    invalidPortableValue,
  );
  assert.equal(nestedReads, 0);
});

test("assessment evidence is exact, authenticated and non-aliased", () => {
  for (const [field, value] of [
    ["authentication_result", "NOT_AUTHENTICATED"],
    ["primary_provenance", "ENGINE_ATTESTED"],
    ["execution_coverage", "NOT_ENFORCED"],
  ] as const) {
    const document = structuredClone(assessmentDocument());
    const evidence = document.authenticated_principal_evidence[0];
    assert.notEqual(evidence, undefined);
    if (evidence !== undefined) evidence[field] = value;
    assert.throws(
      () => evaluateProtocolAssessmentVectorDocument(document),
      /not authenticated Core-enforced evidence/,
      field,
    );
  }

  const principalMismatch = structuredClone(assessmentDocument());
  const principalEvidence = principalMismatch.authenticated_principal_evidence[0];
  assert.notEqual(principalEvidence, undefined);
  if (principalEvidence !== undefined) principalEvidence.scope_descriptor["principal_id"] = "attacker";
  assert.throws(
    () => evaluateProtocolAssessmentVectorDocument(principalMismatch),
    /Scope ID does not match|descriptor Principal differs/,
  );

  const duplicate = structuredClone(assessmentDocument());
  const duplicateEvidence = duplicate.authenticated_principal_evidence[0];
  assert.notEqual(duplicateEvidence, undefined);
  if (duplicateEvidence !== undefined) duplicate.authenticated_principal_evidence.push(structuredClone(duplicateEvidence));
  assert.throws(
    () => evaluateProtocolAssessmentVectorDocument(duplicate),
    /repeats sha256:/,
  );
});

test("assessment profile and debit classification fail closed", () => {
  const profileMutation = structuredClone(assessmentDocument());
  profileMutation.assessment_profile["reduced_denominator"] = "2001";
  assert.throws(
    () => evaluateProtocolAssessmentVectorDocument(profileMutation),
    /reduced_denominator differs/,
  );

  const classificationMutation = structuredClone(assessmentDocument());
  const firstDebit = classificationMutation.cases[0]?.groups[0]?.fills[0]?.debits?.[0];
  assert.notEqual(firstDebit, undefined);
  if (firstDebit !== undefined) firstDebit.classification = "applicabl";
  const results = evaluateProtocolAssessmentVectorDocument(classificationMutation);
  assert.deepEqual(results[0], { status: "reject", errorCode: "invalid_debit_classification" });

  const groupExtension = structuredClone(assessmentDocument());
  const duplicateGroupCase = (
    groupExtension.cases as unknown as {
      case_id: string;
      groups: { group_key: Record<string, unknown> }[];
    }[]
  ).find((entry) => entry.case_id === "assessment.reject.duplicate_group_key");
  assert.notEqual(duplicateGroupCase, undefined);
  const secondGroup = duplicateGroupCase?.groups[1];
  assert.notEqual(secondGroup, undefined);
  if (secondGroup !== undefined) secondGroup.group_key["ignored_extension"] = "x";
  const groupExtensionResults = evaluateProtocolAssessmentVectorDocument(groupExtension);
  const caseIndex = groupExtension.cases.findIndex(
    (entry) => entry.case_id === "assessment.reject.duplicate_group_key",
  );
  assert.deepEqual(groupExtensionResults[caseIndex], {
    status: "reject",
    errorCode: "invalid_vector_shape",
  });
});

test("assessment document, case, group, and expected-result grammar is exact", () => {
  const acceptedMetadata = structuredClone(assessmentDocument());
  const acceptedCase = acceptedMetadata.cases[0] as unknown as Record<string, unknown>;
  acceptedCase["expected_error"] = "must-not-exist";
  assert.deepEqual(evaluateProtocolAssessmentVectorDocument(acceptedMetadata)[0], {
    status: "reject",
    errorCode: "invalid_vector_shape",
  });

  const rejectedMetadata = structuredClone(assessmentDocument());
  const rejectedIndex = rejectedMetadata.cases.findIndex((entry) => entry.expected_status === "reject");
  assert.notEqual(rejectedIndex, -1);
  const rejectedCase = rejectedMetadata.cases[rejectedIndex] as unknown as Record<string, unknown>;
  delete rejectedCase["expected_error"];
  assert.deepEqual(evaluateProtocolAssessmentVectorDocument(rejectedMetadata)[rejectedIndex], {
    status: "reject",
    errorCode: "invalid_vector_shape",
  });

  const wrongConstitution = structuredClone(assessmentDocument());
  const firstGroup = wrongConstitution.cases[0]?.groups[0] as unknown as {
    group_key: Record<string, unknown>;
  };
  firstGroup.group_key["constitution_id"] = `sha256:${"ff".repeat(32)}`;
  assert.deepEqual(evaluateProtocolAssessmentVectorDocument(wrongConstitution)[0], {
    status: "reject",
    errorCode: "group_constitution_mismatch",
  });

  const expectedExtension = structuredClone(assessmentDocument());
  const firstExpected = expectedExtension.cases[0]?.groups[0]?.fills[0]?.expected as Record<string, unknown>;
  firstExpected["unbound_field"] = "0";
  assert.deepEqual(evaluateProtocolAssessmentVectorDocument(expectedExtension)[0], {
    status: "reject",
    errorCode: "invalid_vector_shape",
  });

  const expectedMayBeOmitted = structuredClone(assessmentDocument());
  delete (expectedMayBeOmitted.cases[0]?.groups[0]?.fills[0] as { expected?: unknown }).expected;
  assert.equal(evaluateProtocolAssessmentVectorDocument(expectedMayBeOmitted)[0]?.status, "accept");

  const expectedDecimalIsSchemaMetadata = structuredClone(assessmentDocument());
  const wideExpected = expectedDecimalIsSchemaMetadata.cases[0]?.groups[0]?.fills[0]?.expected as Record<
    string,
    unknown
  >;
  wideExpected["basis_before"] = (UINT128_MAX + 1n).toString();
  assert.equal(evaluateProtocolAssessmentVectorDocument(expectedDecimalIsSchemaMetadata)[0]?.status, "accept");

  const portableProfileNeedNotBeFirst = structuredClone(assessmentDocument());
  const profileCase = portableProfileNeedNotBeFirst.cases[0] as unknown as {
    required_profiles: string[];
  };
  profileCase.required_profiles = [
    "future-assessment-v1",
    ...profileCase.required_profiles.filter((profile) => profile !== "portable-core-v1"),
    "portable-core-v1",
  ];
  assert.equal(evaluateProtocolAssessmentVectorDocument(portableProfileNeedNotBeFirst)[0]?.status, "accept");

  const duplicateCase = structuredClone(assessmentDocument());
  (duplicateCase as unknown as { cases: AssessmentCase[] }).cases = [
    duplicateCase.cases[0]!,
    structuredClone(duplicateCase.cases[0]!),
  ];
  assert.throws(() => evaluateProtocolAssessmentVectorDocument(duplicateCase), /repeats assessment\./);

  const frozen = evaluateProtocolAssessmentVectorDocument(assessmentDocument());
  assert.equal(Object.isFrozen(frozen), true);
  assert.equal(Object.isFrozen(frozen[0]), true);
  assert.equal(Object.isFrozen(frozen[0]?.groups), true);
  assert.equal(Object.isFrozen(frozen[0]?.groups?.[0]), true);
});

test("assessment document patterns and required evidence fail closed", () => {
  const emptyEvidence = structuredClone(assessmentDocument());
  emptyEvidence.authenticated_principal_evidence = [];
  assert.throws(() => evaluateProtocolAssessmentVectorDocument(emptyEvidence), /must not be empty/);

  for (const [field, value] of [
    ["authorization_evidence_ref", "not-a-digest"],
    ["authorization_scope_id", "not-a-digest"],
    ["principal_id", "p".repeat(257)],
    ["authorization_profile_id", "future-profile-v1"],
  ] as const) {
    const document = structuredClone(assessmentDocument());
    const evidence = document.authenticated_principal_evidence[0] as unknown as Record<string, unknown>;
    evidence[field] = value;
    assert.throws(() => evaluateProtocolAssessmentVectorDocument(document), /invalid|unsupported|SHA-256|exceeds/);
  }

  const badCaseId = structuredClone(assessmentDocument());
  (badCaseId.cases[0] as unknown as { case_id: string }).case_id = "A";
  assert.throws(() => evaluateProtocolAssessmentVectorDocument(badCaseId), /case_id has an invalid format/);

  const badExpectedError = structuredClone(assessmentDocument());
  const rejectedIndex = badExpectedError.cases.findIndex((entry) => entry.expected_status === "reject");
  (badExpectedError.cases[rejectedIndex] as unknown as { expected_error: string }).expected_error = "Bad-Hyphen";
  assert.deepEqual(evaluateProtocolAssessmentVectorDocument(badExpectedError)[rejectedIndex], {
    status: "reject",
    errorCode: "invalid_vector_shape",
  });
});

test("cumulative floor is invariant across deterministic fragmentation", () => {
  let state = 0x1234_5678n;
  for (let iteration = 0; iteration < 256; iteration += 1) {
    state = (state * 1_103_515_245n + 12_345n) & 0x7fff_ffffn;
    const total = state % 2_000_000n;
    let remaining = total;
    let basis = 0n;
    let assessed = 0n;
    while (remaining > 0n) {
      state = (state * 1_103_515_245n + 12_345n) & 0x7fff_ffffn;
      const fragment = 1n + (state % (remaining < 50_000n ? remaining : 50_000n));
      const delta = protocolAssessmentDelta(basis, fragment);
      assessed += delta.assessmentDelta;
      basis = delta.basisAfter;
      remaining -= fragment;
    }
    assert.equal(assessed, protocolAssessmentAt(total));
  }
});

test("uint128 maximum is accepted and maximum plus one is rejected", () => {
  assert.throws(() => protocolAssessmentAt(1 as unknown as bigint), /outside uint128/);
  assert.equal(protocolAssessmentAt(UINT128_MAX), UINT128_MAX / 2_000n);
  assert.throws(() => protocolAssessmentAt(UINT128_MAX + 1n), /outside uint128/);
  assert.throws(() => protocolAssessmentDelta(UINT128_MAX, 1n), /uint128/);
  assert.equal(parseUint128Decimal(UINT128_MAX.toString(), "maximum"), UINT128_MAX);
  assert.throws(() => parseUint128Decimal((UINT128_MAX + 1n).toString(), "maximumPlusOne"), /between 0/);
  assert.throws(() => parseUint128Decimal("9".repeat(100_000), "oversized"), /between 0/);
});
