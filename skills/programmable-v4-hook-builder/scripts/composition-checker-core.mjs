import { canonicalJsonSha256V2 } from "./canonical-json-core.mjs";
import {
  CAPABILITY_CONTRACT_V1_SCHEMA_ID,
  capabilityContractV1Errors,
  compositionEnvelopeErrors
} from "./composition-checker-contract-core.mjs";
import { evaluateProtocolComposition } from "./composition-checker-protocol-rules.mjs";
import {
  COMPOSITION_CHECKER_VERSION,
  COMPOSITION_REPORT_V1_KIND,
  COMPOSITION_RULES,
  COMPOSITION_STATUSES,
  finding
} from "./composition-checker-shared.mjs";
import { evaluateSystemComposition } from "./composition-checker-system-rules.mjs";

export {
  CAPABILITY_CONTRACT_V1_SCHEMA_ID,
  COMPOSITION_CHECKER_VERSION,
  COMPOSITION_RULES,
  COMPOSITION_STATUSES
};

const severityRank = Object.freeze({ invalid: 0, conflict: 1, review: 2 });

export function validateCapabilityContractV1(contract, { path: contractPath = "$" } = {}) {
  return capabilityContractV1Errors(contract, { path: contractPath }).map((error) => finding({
    ruleId: COMPOSITION_RULES.CONTRACT_SCHEMA_INVALID,
    severity: "invalid",
    category: "contract",
    componentRefs: contract?.component?.id ? [contract.component.id] : [],
    paths: [error.path],
    message: `Capability contract violates ${error.keyword}: ${error.message}`,
    facts: { keyword: error.keyword }
  }));
}

export function checkCapabilityComposition(input) {
  const findings = compositionEnvelopeErrors(input).map((error) => finding({
    ruleId: COMPOSITION_RULES.INPUT_INVALID,
    severity: "invalid",
    category: "input",
    paths: [error.path],
    message: error.message,
    facts: { keyword: error.keyword }
  }));
  const contracts = Array.isArray(input?.components) ? input.components : [];
  const contexts = collectValidContexts(contracts, findings);
  if (contexts.length > 0) {
    evaluateSystemComposition(contexts, findings);
    evaluateProtocolComposition(contexts, findings);
  }
  return buildReport({
    input,
    stage: ["proposal", "prototype", "release"].includes(input?.stage) ? input.stage : "proposal",
    contractCount: contracts.length,
    checkedContractCount: contexts.length,
    findings
  });
}

function collectValidContexts(contracts, findings) {
  const contexts = [];
  contracts.forEach((contract, index) => {
    const contractPath = `$.components[${index}]`;
    const contractFindings = validateCapabilityContractV1(contract, { path: contractPath });
    findings.push(...contractFindings);
    if (contractFindings.length === 0) contexts.push({
      contract,
      index,
      path: contractPath,
      componentId: contract.component.id
    });
  });
  return contexts;
}

function buildReport({ input, stage, contractCount, checkedContractCount, findings }) {
  const unique = new Map();
  for (const item of findings) unique.set(item.findingId, item);
  const ordered = [...unique.values()].sort(compareFindings);
  const counts = { invalid: 0, conflict: 0, review: 0 };
  for (const item of ordered) counts[item.severity] += 1;
  const status = counts.invalid > 0
    ? COMPOSITION_STATUSES.INVALID
    : counts.conflict > 0
      ? COMPOSITION_STATUSES.CONFLICT
      : counts.review > 0
        ? COMPOSITION_STATUSES.REVIEW
        : COMPOSITION_STATUSES.CANDIDATE;
  return {
    schemaVersion: COMPOSITION_CHECKER_VERSION,
    kind: COMPOSITION_REPORT_V1_KIND,
    checkerVersion: COMPOSITION_CHECKER_VERSION,
    status,
    stage,
    compositionDigest: safeDigest(input),
    contractCount,
    checkedContractCount,
    summary: {
      invalidCount: counts.invalid,
      conflictCount: counts.conflict,
      independentReviewCount: counts.review
    },
    findings: ordered,
    implementationAuthorization: "NOT_GRANTED",
    securityApproval: "NOT_GRANTED",
    deploymentAuthorization: "NOT_GRANTED",
    independentReviewerRequired: true,
    interpretation: status === COMPOSITION_STATUSES.CANDIDATE
      ? "No encoded conflict was found. This is not evidence of safety, completeness, test success, audit, approval, deployment, or live operation."
      : "Resolve conflicts and obtain the named independent reviews. This report grants no implementation, security, deployment, or operational authority."
  };
}

function safeDigest(value) {
  try {
    return canonicalJsonSha256V2(value);
  } catch {
    return null;
  }
}

function compareFindings(left, right) {
  return severityRank[left.severity] - severityRank[right.severity]
    || left.ruleId.localeCompare(right.ruleId)
    || left.findingId.localeCompare(right.findingId);
}
