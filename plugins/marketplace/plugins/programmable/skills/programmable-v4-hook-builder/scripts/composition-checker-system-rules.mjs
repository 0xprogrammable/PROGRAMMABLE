import {
  append,
  canonicalVariants,
  COMPOSITION_RULES,
  crossFinding,
  finding,
  groupBy,
  push
} from "./composition-checker-shared.mjs";

export function evaluateSystemComposition(contexts, findings) {
  evaluateIdentityAndOpenness(contexts, findings);
  evaluateCapabilities(contexts, findings);
  evaluateAuthorities(contexts, findings);
  evaluateLifecycle(contexts, findings);
  evaluateRouterAssumptions(contexts, findings);
  evaluateDependencies(contexts, findings);
}

function evaluateIdentityAndOpenness(contexts, findings) {
  addDuplicateIdentityFindings(contexts, "contractId", COMPOSITION_RULES.CONTRACT_ID_DUPLICATE, findings);
  addDuplicateIdentityFindings(contexts, "componentId", COMPOSITION_RULES.COMPONENT_ID_DUPLICATE, findings);
  for (const context of contexts) {
    const { contract, componentId, path: contractPath } = context;
    if (contract.license.compatibility === "incompatible") push(findings, COMPOSITION_RULES.LICENSE_CONFLICT, "conflict", "license", [context], ["license.compatibility"], "The component declares a license incompatible with the project assumption.");
    else if (contract.license.compatibility === "architecture-review-required") push(findings, COMPOSITION_RULES.LICENSE_REVIEW, "review", "license", [context], ["license.compatibility"], "License compatibility requires an independent project-specific review.");
    if (contract.component.kind === "custom") push(findings, COMPOSITION_RULES.CUSTOM_COMPONENT_REVIEW, "review", "component", [context], ["component.kind"], "A custom component remains eligible, but its semantics require independent architecture review.");
    if (Object.keys(contract.extensions).length > 0) {
      findings.push(finding({
        ruleId: COMPOSITION_RULES.EXTENSION_REVIEW,
        severity: "review",
        category: "extension",
        componentRefs: [componentId],
        paths: [`${contractPath}.extensions`],
        message: "Open extension data is preserved but not interpreted by this checker; route it to an independent reviewer.",
        facts: { extensionKeys: Object.keys(contract.extensions).sort() }
      }));
    }
  }
}

function evaluateCapabilities(contexts, findings) {
  const providers = new Map();
  for (const context of contexts) context.contract.provides.forEach((provided, index) => {
    append(providers, provided.capabilityId, { context, provided, path: `${context.path}.provides[${index}]` });
    if (provided.recognition !== "known") reviewUnknownCapability(findings, context, `${context.path}.provides[${index}]`, provided.capabilityId, provided.recognition);
  });
  for (const context of contexts) context.contract.requires.forEach((required, index) => evaluateRequirement({
    context,
    required,
    requirementPath: `${context.path}.requires[${index}]`,
    candidates: providers.get(required.capabilityId) ?? [],
    findings
  }));
}

function evaluateRequirement({ context, required, requirementPath, candidates, findings }) {
  if (required.recognition !== "known") reviewUnknownCapability(findings, context, requirementPath, required.capabilityId, required.recognition);
  if (required.optional) return;
  if (required.providerComponentRef !== null) {
    if (!candidates.some((candidate) => candidate.context.componentId === required.providerComponentRef)) findings.push(finding({
      ruleId: COMPOSITION_RULES.CAPABILITY_PROVIDER_MISMATCH,
      severity: "conflict",
      category: "capability",
      componentRefs: [context.componentId, required.providerComponentRef],
      paths: [requirementPath],
      message: "The bound provider component does not provide the required capability.",
      facts: { capabilityId: required.capabilityId, providerComponentRef: required.providerComponentRef }
    }));
  } else if (candidates.length === 0) {
    findings.push(finding({
      ruleId: COMPOSITION_RULES.CAPABILITY_MISSING,
      severity: "conflict",
      category: "capability",
      componentRefs: [context.componentId],
      paths: [requirementPath],
      message: "A non-optional required capability has no provider in the composition.",
      facts: { capabilityId: required.capabilityId }
    }));
  } else if (candidates.length > 1) {
    findings.push(finding({
      ruleId: COMPOSITION_RULES.CAPABILITY_PROVIDER_AMBIGUOUS,
      severity: "review",
      category: "capability",
      componentRefs: [context.componentId, ...candidates.map((candidate) => candidate.context.componentId)],
      paths: [requirementPath, ...candidates.map((candidate) => candidate.path)],
      message: "Multiple capability providers are eligible; bind the selected provider or route the choice to architecture review.",
      facts: { capabilityId: required.capabilityId }
    }));
  }
}

function evaluateAuthorities(contexts, findings) {
  const byId = new Map();
  const byScopeCapability = new Map();
  for (const context of contexts) context.contract.authorities.forEach((authority, index) => {
    const record = { context, authority, path: `${context.path}.authorities[${index}]` };
    append(byId, authority.authorityId, record);
    append(byScopeCapability, `${authority.scopeRef}\u0000${authority.capabilityRef}`, record);
    const bindingContradiction = (authority.authorityState === "bound" && authority.authorityRef === null) || (authority.authorityState === "none" && authority.authorityRef !== null);
    if (bindingContradiction) push(findings, COMPOSITION_RULES.AUTHORITY_BINDING_CONFLICT, "conflict", "authority", [record], ["authorityState", "authorityRef"], "Authority state contradicts its bound authority reference.");
    if (["unresolved", "custom"].includes(authority.authorityState)) push(findings, COMPOSITION_RULES.AUTHORITY_REVIEW, "review", "authority", [record], ["authorityState"], "The authority mechanism is unresolved or custom and requires independent review.");
  });
  for (const [authorityId, records] of byId) if (canonicalVariants(records.map(({ authority }) => authority)).size > 1) crossFinding(findings, COMPOSITION_RULES.AUTHORITY_ID_CONFLICT, "conflict", "authority", records, "The same authority id has contradictory definitions.", { authorityId });
  for (const records of byScopeCapability.values()) evaluateAuthorityGroup(records, findings);
}

function evaluateAuthorityGroup(records, findings) {
  const modes = new Set(records.map(({ authority }) => authority.mode));
  if (modes.has("exclusive") && modes.size > 1) crossFinding(findings, COMPOSITION_RULES.AUTHORITY_MODE_CONFLICT, "conflict", "authority", records, "Exclusive and non-exclusive authority models overlap for one scope and capability.");
  const exclusiveRefs = new Set(records.filter(({ authority }) => authority.mode === "exclusive").map(({ authority }) => authority.authorityRef ?? "<none>"));
  if (exclusiveRefs.size > 1) crossFinding(findings, COMPOSITION_RULES.AUTHORITY_EXCLUSIVE_CONFLICT, "conflict", "authority", records, "One exclusive authority capability names multiple authorities.");
  if (new Set(records.map(({ authority }) => authority.mutability)).size > 1) crossFinding(findings, COMPOSITION_RULES.AUTHORITY_MUTABILITY_CONFLICT, "conflict", "authority", records, "One authority capability has contradictory mutability models.");
  const shared = records.filter(({ authority }) => authority.mode === "shared");
  if (shared.length === 0) return;
  const coordination = new Set(shared.map(({ authority }) => authority.coordinationRef).filter(Boolean));
  if (coordination.size > 1) crossFinding(findings, COMPOSITION_RULES.AUTHORITY_MODE_CONFLICT, "conflict", "authority", shared, "Shared authorities bind different coordination mechanisms.");
  else if (shared.some(({ authority }) => authority.coordinationRef === null)) crossFinding(findings, COMPOSITION_RULES.AUTHORITY_REVIEW, "review", "authority", shared, "Shared authority lacks a complete coordination binding.");
}

function evaluateLifecycle(contexts, findings) {
  const assertionGroups = new Map();
  const handoffs = new Map();
  for (const context of contexts) context.contract.lifecycle.forEach((assertion, index) => {
    const record = { context, assertion, path: `${context.path}.lifecycle[${index}]` };
    append(assertionGroups, `${assertion.boundaryRef}\u0000${assertion.position}\u0000${assertion.conditionRef}`, record);
    if (assertion.handoffRef !== null) append(handoffs, assertion.handoffRef, record);
  });
  for (const records of assertionGroups.values()) if (lifecycleGroupContradicts(records)) crossFinding(findings, COMPOSITION_RULES.LIFECYCLE_CONTRADICTION, "conflict", "lifecycle", records, "Lifecycle assertions contradict at the same boundary and condition.");
  for (const [handoffRef, records] of handoffs) {
    const producers = records.filter(({ assertion }) => assertion.position === "postcondition");
    const consumers = records.filter(({ assertion }) => assertion.position === "precondition");
    if (producers.length === 0 || consumers.length === 0) crossFinding(findings, COMPOSITION_RULES.LIFECYCLE_HANDOFF_UNRESOLVED, "review", "lifecycle", records, "A lifecycle handoff has no complete producer-to-consumer pair.", { handoffRef });
    if (producers.length > 1 || consumers.length > 1) crossFinding(findings, COMPOSITION_RULES.LIFECYCLE_HANDOFF_AMBIGUOUS, "review", "lifecycle", records, "A lifecycle handoff has multiple producers or consumers and needs an explicit coordinator.", { handoffRef });
  }
}

function evaluateRouterAssumptions(contexts, findings) {
  const byFlow = new Map();
  for (const context of contexts) {
    context.contract.routerAssumptions.forEach((router, index) => {
      const record = { context, router, path: `${context.path}.routerAssumptions[${index}]` };
      append(byFlow, router.flowRef, record);
      evaluateRouterRecord(record, findings);
    });
    const hookPermissions = context.contract.hook?.permissions ?? [];
    const needsFlow = hookPermissions.some((permission) => ["beforeSwap", "afterSwap", "beforeSwapReturnDelta", "afterSwapReturnDelta"].includes(permission));
    const hasHookFlow = context.contract.routerAssumptions.some(({ context: routerContext }) => routerContext === "v4-hook-callback");
    if (needsFlow && !hasHookFlow) push(findings, COMPOSITION_RULES.ROUTER_FLOW_UNDECLARED, "review", "router", [context], ["routerAssumptions"], "A swap callback hook has no declared router/hookData execution flow.");
  }
  for (const [flowRef, records] of byFlow) if (canonicalVariants(records.map(({ router }) => router)).size > 1) crossFinding(findings, COMPOSITION_RULES.ROUTER_FLOW_CONFLICT, "conflict", "router", records, "One flow id has contradictory router, sender, PoolManager, or hookData assumptions.", { flowRef });
}

function evaluateRouterRecord(record, findings) {
  const { context, router } = record;
  if (router.context === "v4-hook-callback") {
    if (router.msgSenderRole !== "pool-manager") push(findings, COMPOSITION_RULES.ROUTER_MSG_SENDER_CONFLICT, "conflict", "router", [record], ["msgSenderRole"], "In a v4 hook callback, msg.sender must be the exact PoolManager.");
    if (router.senderParameterRole === "end-user") push(findings, COMPOSITION_RULES.ROUTER_SENDER_IDENTITY_CONFLICT, "conflict", "router", [record], ["senderParameterRole"], "The v4 callback sender parameter is a router or unlock caller, not an authenticated end user.");
    if (router.poolManagerRef === null) push(findings, COMPOSITION_RULES.ROUTER_BINDING_UNRESOLVED, "review", "router", [record], ["poolManagerRef"], "The callback flow has no exact PoolManager binding.");
    if (context.contract.hook?.poolManagerRef && router.poolManagerRef && context.contract.hook.poolManagerRef !== router.poolManagerRef) push(findings, COMPOSITION_RULES.ROUTER_MANAGER_CONFLICT, "conflict", "router", [record], ["poolManagerRef"], "Router-flow and hook declarations bind different PoolManagers.");
  }
  if (router.senderParameterRole === "router" && router.routerRef === null) push(findings, COMPOSITION_RULES.ROUTER_BINDING_UNRESOLVED, "review", "router", [record], ["routerRef"], "A router-identified callback has no exact router binding.");
  evaluateHookData(record, findings);
  if (router.context === "custom") push(findings, COMPOSITION_RULES.ROUTER_HOOK_DATA_REVIEW, "review", "router", [record], ["context"], "A custom routing context requires independent review.");
}

function evaluateHookData(record, findings) {
  const { hookData } = record.router;
  if (hookData.mode === "none" && hookData.identityBinding !== "none") push(findings, COMPOSITION_RULES.ROUTER_HOOK_DATA_CONFLICT, "conflict", "router", [record], ["hookData"], "Identity-bearing hookData cannot use mode none.");
  if (hookData.mode === "versioned-typed") {
    if (hookData.schemaRef === null || hookData.version === null) push(findings, COMPOSITION_RULES.ROUTER_HOOK_DATA_CONFLICT, "conflict", "router", [record], ["hookData.schemaRef", "hookData.version"], "Versioned typed hookData needs an exact schema and version.");
    if (hookData.identityBinding !== "none" && [hookData.authenticatorRef, hookData.domainRef, hookData.replayProtectionRef].some((value) => value === null)) push(findings, COMPOSITION_RULES.ROUTER_HOOK_DATA_CONFLICT, "conflict", "router", [record], ["hookData"], "Identity-bearing hookData needs authenticator, domain, and replay-protection bindings.");
  }
  if (["opaque", "custom"].includes(hookData.mode) || hookData.identityBinding === "custom") push(findings, COMPOSITION_RULES.ROUTER_HOOK_DATA_REVIEW, "review", "router", [record], ["hookData"], "Opaque or custom hookData remains eligible but requires independent parsing, authentication, and replay review.");
}

function evaluateDependencies(contexts, findings) {
  const byId = new Map();
  const byResolution = new Map();
  for (const context of contexts) context.contract.externalDependencies.forEach((dependency, index) => {
    const record = { context, dependency, path: `${context.path}.externalDependencies[${index}]` };
    append(byId, dependency.dependencyId, record);
    append(byResolution, `${dependency.resolutionScopeRef}\u0000${dependency.ecosystem}\u0000${dependency.packageRef}`, record);
    if (dependency.pin === null || dependency.integrity === null || dependency.sourceRef === null) push(findings, COMPOSITION_RULES.DEPENDENCY_PIN_UNRESOLVED, "review", "dependency", [record], ["pin", "integrity", "sourceRef"], "Dependency source, exact pin, or integrity is unresolved.");
    if (dependency.licenseCompatibility === "incompatible") push(findings, COMPOSITION_RULES.DEPENDENCY_LICENSE_CONFLICT, "conflict", "dependency", [record], ["licenseCompatibility"], "A dependency declares an incompatible license.");
    if (dependency.licenseCompatibility === "architecture-review-required" || dependency.licenseSpdx === null || ["custom", "system"].includes(dependency.ecosystem)) push(findings, COMPOSITION_RULES.DEPENDENCY_REVIEW, "review", "dependency", [record], ["licenseCompatibility", "ecosystem"], "Dependency licensing or host-specific semantics require independent review.");
  });
  for (const [dependencyId, records] of byId) if (canonicalVariants(records.map(({ dependency }) => dependency)).size > 1) crossFinding(findings, COMPOSITION_RULES.DEPENDENCY_ID_CONFLICT, "conflict", "dependency", records, "The same dependency id has contradictory resolution facts.", { dependencyId });
  for (const records of byResolution.values()) if (canonicalVariants(records.map(({ dependency }) => ({ sourceRef: dependency.sourceRef, pin: dependency.pin, integrity: dependency.integrity }))).size > 1) crossFinding(findings, COMPOSITION_RULES.DEPENDENCY_RESOLUTION_CONFLICT, "conflict", "dependency", records, "One resolution scope selects incompatible source, pin, or integrity identities for the same package.");
}

function addDuplicateIdentityFindings(contexts, field, ruleId, findings) {
  const groups = groupBy(contexts, (context) => field === "contractId" ? context.contract.contractId : context.componentId);
  for (const [value, records] of groups) if (records.length > 1) crossFinding(findings, ruleId, "conflict", "identity", records, `Duplicate ${field} ${value} makes component ownership ambiguous.`, { [field]: value });
}

function reviewUnknownCapability(findings, context, capabilityPath, capabilityId, recognition) {
  findings.push(finding({
    ruleId: COMPOSITION_RULES.CAPABILITY_UNKNOWN,
    severity: "review",
    category: "capability",
    componentRefs: [context.componentId],
    paths: [capabilityPath],
    message: "An owner-defined or unresolved capability remains eligible and is routed to independent architecture and property review.",
    facts: { capabilityId, recognition }
  }));
}

function lifecycleGroupContradicts(records) {
  const byOperator = groupBy(records, ({ assertion }) => assertion.operator);
  const present = byOperator.get("present") ?? [];
  const absent = byOperator.get("absent") ?? [];
  const equals = new Set((byOperator.get("equals") ?? []).map(({ assertion }) => JSON.stringify(assertion.value)));
  const notEquals = new Set((byOperator.get("not-equals") ?? []).map(({ assertion }) => JSON.stringify(assertion.value)));
  if (absent.length > 0 && (present.length > 0 || equals.size > 0 || notEquals.size > 0)) return true;
  if (equals.size > 1) return true;
  return [...equals].some((value) => notEquals.has(value));
}
