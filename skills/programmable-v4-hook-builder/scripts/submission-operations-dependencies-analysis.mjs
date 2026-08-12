import { objectAt, resolvedText } from "./submission-analysis-helpers.mjs";
import { requireResolvedText } from "./settlement-policy-core.mjs";

export function analyzeSubmissionOperationsAndDependencies(context) {
  const { submission, add, gate, target } = context;
  const valueFlows = Array.isArray(submission.valueFlows) ? submission.valueFlows : [];
  if (valueFlows.length === 0) add("blocker", "VALUE_FLOW_MISSING", "$.valueFlows", "No value flow is documented.", "Trace every asset through initialize, liquidity, swap, fee, claim and failure paths.");
  const valueFlowIds = new Set();
  for (const [index, flow] of valueFlows.entries()) {
    for (const field of ["id", "action", "asset", "from", "to", "amountRule", "settlement", "failure"]) {
      requireResolvedText(flow?.[field], `$.valueFlows[${index}].${field}`, "VALUE_FLOW_UNRESOLVED", add);
    }
    if (valueFlowIds.has(flow?.id)) add("blocker", "VALUE_FLOW_ID_DUPLICATE", `$.valueFlows[${index}].id`, "Value-flow identifiers must be unique.", "Use one stable id for each distinct lifecycle value path.");
    valueFlowIds.add(flow?.id);
  }

  const authorities = Array.isArray(submission.authorities) ? submission.authorities : [];
  for (const [index, authority] of authorities.entries()) {
    requireResolvedText(authority?.controller, `$.authorities[${index}].controller`, "AUTHORITY_CONTROLLER_UNRESOLVED", add);
    if (typeof authority?.mutable !== "boolean") add("blocker", "AUTHORITY_MUTABILITY_UNRESOLVED", `$.authorities[${index}].mutable`, "Authority mutability is unresolved.", "Declare whether the controller or its capabilities can change.");
    requireResolvedText(authority?.userExitImpact, `$.authorities[${index}].userExitImpact`, "AUTHORITY_EXIT_IMPACT_UNRESOLVED", add);
    const capabilities = (authority?.capabilities ?? []).join(" ").toLowerCase();
    if (/(upgrade|confiscat|blacklist|freeze|pause|redirect|rescue|mint)/.test(capabilities)) gate("privileged-authority-review", "candidate", "A privileged capability can affect users, balances or behavior.");
  }

  const dependencyIds = new Set();
  const dependenciesById = new Map();
  const onchainAddressKeys = new Set();
  for (const location of ["onchain", "offchain"]) {
    const dependencies = submission.dependencies?.[location] ?? [];
    for (const [index, dependency] of dependencies.entries()) {
      const basePath = `$.dependencies.${location}[${index}]`;
      for (const field of ["id", "name", "kind", "license", "trust", "failure", "fallback"]) requireResolvedText(dependency?.[field], `${basePath}.${field}`, "DEPENDENCY_INCOMPLETE", add);
      if (dependencyIds.has(dependency?.id)) add("blocker", "DEPENDENCY_ID_DUPLICATE", `${basePath}.id`, "Dependency identifiers must be unique across onchain and offchain records.", "Give each exact source or deployment one stable id.");
      dependencyIds.add(dependency?.id);
      if (resolvedText(dependency?.id)) dependenciesById.set(dependency.id, dependency);
      if (location === "onchain" && dependency?.chainAddress) {
        const addressKey = `${target.chainId}:${dependency.chainAddress.toLowerCase()}`;
        if (onchainAddressKeys.has(addressKey)) add("blocker", "DEPENDENCY_ADDRESS_DUPLICATE", `${basePath}.chainAddress`, "Two dependency records claim the same chain address.", "Use one canonical record per chain and address and reference it by id.");
        onchainAddressKeys.add(addressKey);
      }
      if (!resolvedText(dependency?.repository) && !resolvedText(dependency?.chainAddress)) add("blocker", "DEPENDENCY_SOURCE_UNRESOLVED", basePath, "A dependency has neither an exact source repository nor chain address.", "Record the authoritative source and exact deployed identity where applicable.");
      if (dependency?.repository && !resolvedText(dependency?.revision) && !resolvedText(dependency?.packageVersion)) add("blocker", "DEPENDENCY_UNPINNED", basePath, "A source dependency is not pinned to a commit or exact package version.", "Pin an exact revision and preserve lockfile provenance.");
      if (location === "onchain" && submission.stage === "prototype") {
        if (!dependency?.sourceProvenance) add("blocker", "ONCHAIN_SOURCE_PROVENANCE_MISSING", `${basePath}.sourceProvenance`, "An onchain dependency has no exact source-provenance mode.", "Use pinned-source or verified-explorer-source with exact source and runtime evidence; bytecode-only exceptions are maintainer-controlled.");
        if (["pinned-source", "verified-explorer-source"].includes(dependency?.sourceProvenance) && (!resolvedText(dependency?.repository) || (!resolvedText(dependency?.revision) && !resolvedText(dependency?.packageVersion)) || !resolvedText(dependency?.runtimeHash))) add("blocker", "ONCHAIN_SOURCE_IDENTITY_INCOMPLETE", basePath, "Address identity is not source identity; the onchain dependency lacks a pinned source and runtime tuple.", "Record the exact repository and revision or package, plus deployed runtime hash and structured observation evidence.");
        if (dependency?.sourceProvenance === "maintainer-bytecode-exception") add("blocker", "BYTECODE_EXCEPTION_REQUIRES_MAINTAINER", `${basePath}.sourceProvenance`, "A public prototype cannot self-approve an immutable bytecode-only exception.", "Ask maintainers to register the exception or use reproducible pinned source.");
      }
      if (location === "onchain" && submission.stage === "prototype" && /^https:\/\/github\.com\/uniswap\/(?:v4-core|v4-periphery|permit2|universal-router)(?:\.git)?\/?$/i.test(dependency?.repository ?? "") && !resolvedText(dependency?.deploymentRecordId)) {
        add("blocker", "OFFICIAL_DEPLOYMENT_RECORD_MISSING", `${basePath}.deploymentRecordId`, "An official Uniswap onchain dependency is not bound to the committed deployment registry.", "Resolve one exact active record and preserve its trust tier, record id, address, chain and independent runtime evidence; a runtime-unverified reference is not a Programmable-tested deployment.");
      }
      if (location === "onchain" && submission.stage === "prototype" && !resolvedText(dependency?.deploymentEvidencePath)) add("blocker", "DEPLOYMENT_EVIDENCE_PATH_MISSING", `${basePath}.deploymentEvidencePath`, "An onchain prototype dependency has no structured runtime and source observation record.", "Add a repository-relative deployment evidence record; maintainers must independently reproduce it before release.");
      gate("dependency-failure-tests", "prototype", "The model has external dependencies.");
    }
  }

  const operations = objectAt(submission, "operations");
  for (const kind of ["keeper", "oracle"]) {
    const operation = objectAt(operations, kind);
    if (typeof operation.required !== "boolean") add("blocker", "OPERATION_USAGE_UNRESOLVED", `$.operations.${kind}.required`, `${kind} usage is unresolved.`, `State whether a ${kind} is required.`);
    if (operation.required === true) {
      for (const field of ["actor", "action", "cadence", "authentication", "funding", "failure", "fallback"]) requireResolvedText(operation[field], `$.operations.${kind}.${field}`, "OPERATION_INCOMPLETE", add);
      gate(`${kind}-liveness-tests`, "prototype", `The model requires a ${kind}.`);
      gate(`${kind}-monitoring`, "candidate", `The model requires a ${kind}.`);
    }
  }
  requireResolvedText(operations.monitoring, "$.operations.monitoring", "MONITORING_PLAN_UNRESOLVED", add);
  requireResolvedText(operations.incidentResponse, "$.operations.incidentResponse", "INCIDENT_PLAN_UNRESOLVED", add);

  Object.assign(context, { authorities, dependenciesById, operations });
}
