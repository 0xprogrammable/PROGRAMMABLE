import { canonicalJsonV2 } from "./canonical-json-core.mjs";
import {
  append,
  canonicalVariants,
  COMPOSITION_RULES,
  crossFinding,
  dedupeRecords,
  groupBy,
  push,
  uniqueComponents
} from "./composition-checker-shared.mjs";
import { canonicalV4PermissionMask } from "./v4-hook-semantic-contract-core.mjs";

const returnParents = Object.freeze({
  beforeSwapReturnDelta: "beforeSwap",
  afterSwapReturnDelta: "afterSwap",
  afterAddLiquidityReturnDelta: "afterAddLiquidity",
  afterRemoveLiquidityReturnDelta: "afterRemoveLiquidity"
});
const economicStorageClasses = new Set(["liability", "asset-balance", "claim", "fee-accrual", "position", "replay-state"]);

export function evaluateProtocolComposition(contexts, findings) {
  evaluatePermissions(contexts, findings);
  evaluateStorage(contexts, findings);
  evaluateDeltasAndSettlement(contexts, findings);
  evaluateFees(contexts, findings);
  evaluateDeployments(contexts, findings);
}

function evaluatePermissions(contexts, findings) {
  const byImplementation = new Map();
  const byPool = new Map();
  for (const context of contexts) {
    const hook = context.contract.hook;
    if (context.contract.component.kind === "hook" && hook === null) {
      push(findings, COMPOSITION_RULES.HOOK_DECLARATION_MISSING, "review", "permission", [context], ["hook"], "A hook component has no explicit v4 hook binding, so its permission and PoolManager composition cannot be checked.");
      continue;
    }
    if (hook === null) continue;
    const hookPath = `${context.path}.hook`;
    append(byImplementation, hook.implementationRef, { context, hook, path: hookPath });
    if (hook.poolManagerRef === null) push(findings, COMPOSITION_RULES.HOOK_MANAGER_UNBOUND, "review", "permission", [context], ["hook.poolManagerRef"], "The hook's exact PoolManager is unresolved.");
    if (hook.poolKeyRefs.length === 0) push(findings, COMPOSITION_RULES.HOOK_POOL_UNBOUND, "review", "permission", [context], ["hook.poolKeyRefs"], "The hook is not bound to a PoolKey; composition remains a proposal, not a deployable binding.");
    for (const poolKeyRef of hook.poolKeyRefs) append(byPool, poolKeyRef, { context, hook, path: hookPath });
    const permissions = new Set(hook.permissions);
    for (const [returnPermission, parent] of Object.entries(returnParents)) {
      if (permissions.has(returnPermission) && !permissions.has(parent)) {
        crossFinding(findings, COMPOSITION_RULES.HOOK_PERMISSION_PARENT_MISSING, "conflict", "permission", [{ context, path: `${hookPath}.permissions` }], `${returnPermission} requires its parent ${parent} callback permission.`, { returnPermission, parent });
      }
    }
  }
  for (const [implementationRef, records] of byImplementation) {
    const permissionSets = new Set(records.map(({ hook }) => [...hook.permissions].sort().join("\u0000")));
    const managerRefs = new Set(records.map(({ hook }) => hook.poolManagerRef ?? "<unresolved>"));
    if (permissionSets.size > 1 || managerRefs.size > 1) crossFinding(findings, COMPOSITION_RULES.HOOK_PERMISSION_SET_CONFLICT, "conflict", "permission", records, "One hook implementation has contradictory permission or PoolManager declarations.", { implementationRef });
  }
  for (const [poolKeyRef, records] of byPool) {
    const implementations = new Set(records.map(({ hook }) => hook.implementationRef));
    if (implementations.size > 1) crossFinding(findings, COMPOSITION_RULES.POOL_HOOK_CONFLICT, "conflict", "permission", records, "One PoolKey is bound to more than one hook implementation; Uniswap v4 permits one hook address per PoolKey.", { poolKeyRef, implementations: [...implementations].sort() });
  }
}

function evaluateStorage(contexts, findings) {
  const byId = new Map();
  const bySlot = new Map();
  for (const context of contexts) {
    const multiPool = (context.contract.hook?.poolKeyRefs.length ?? 0) > 1;
    context.contract.storage.forEach((storage, index) => {
      const record = { context, storage, path: `${context.path}.storage[${index}]` };
      append(byId, storage.storageId, record);
      append(bySlot, `${storage.containerRef}\u0000${storage.location}\u0000${storage.namespace}`, record);
      if (storage.scope === "pool" && storage.poolIsolation !== "pool-id-namespaced") {
        const reviewable = ["unresolved", "custom"].includes(storage.poolIsolation);
        push(findings, reviewable ? COMPOSITION_RULES.STORAGE_POOL_ISOLATION_UNRESOLVED : COMPOSITION_RULES.STORAGE_POOL_SCOPE_CONFLICT, reviewable ? "review" : "conflict", "storage", [record], ["poolIsolation"], reviewable ? "Pool-scoped state has unresolved/custom isolation semantics and requires independent review." : "Pool-scoped state is not PoolId-namespaced.");
      }
      if (multiPool && economicStorageClasses.has(storage.valueClass) && storage.poolIsolation !== "pool-id-namespaced") {
        const reviewable = ["unresolved", "custom"].includes(storage.poolIsolation);
        push(findings, reviewable ? COMPOSITION_RULES.STORAGE_POOL_ISOLATION_UNRESOLVED : COMPOSITION_RULES.STORAGE_MULTI_POOL_CONFLICT, reviewable ? "review" : "conflict", "storage", [record], ["poolIsolation"], reviewable ? "Economic state in a multi-pool hook has unresolved isolation semantics." : "A multi-pool hook declares economic state that is not PoolId-namespaced.");
      }
    });
  }
  for (const [storageId, records] of byId) if (canonicalVariants(records.map(({ storage }) => storage)).size > 1) crossFinding(findings, COMPOSITION_RULES.STORAGE_ID_CONFLICT, "conflict", "storage", records, "The same storage id has contradictory definitions.", { storageId });
  for (const records of bySlot.values()) {
    if (records.length < 2 || uniqueComponents(records).length < 2) continue;
    if (records.some(({ storage }) => storage.sharing === "exclusive")) {
      crossFinding(findings, COMPOSITION_RULES.STORAGE_SLOT_COLLISION, "conflict", "storage", records, "Multiple components claim the same container, location, and namespace while at least one claim is exclusive.");
      continue;
    }
    const hashes = new Set(records.map(({ storage }) => storage.layoutHash).filter(Boolean));
    if (hashes.size > 1) crossFinding(findings, COMPOSITION_RULES.STORAGE_LAYOUT_CONFLICT, "conflict", "storage", records, "Shared storage declarations bind different layout hashes.");
    else if (records.some(({ storage }) => storage.layoutHash === null)) crossFinding(findings, COMPOSITION_RULES.STORAGE_LAYOUT_UNRESOLVED, "review", "storage", records, "Shared storage lacks a complete common layout hash and needs independent review.");
  }
}

function evaluateDeltasAndSettlement(contexts, findings) {
  const settlementByScope = collectSettlements(contexts);
  const deltaById = new Map();
  const deltaBySlot = new Map();
  const deltaByPermission = new Map();
  const conservationGroups = new Map();
  for (const context of contexts) {
    context.contract.deltas.forEach((delta, index) => {
      const record = { context, delta, path: `${context.path}.deltas[${index}]` };
      append(deltaById, delta.deltaId, record);
      append(deltaBySlot, `${delta.effectRef}\u0000${delta.slotRef}\u0000${delta.currencyRef}`, record);
      if (delta.permissionRef !== null) append(deltaByPermission, `${context.contract.hook?.implementationRef ?? context.componentId}\u0000${delta.permissionRef}`, record);
      if (delta.conservationGroupRef !== null) append(conservationGroups, delta.conservationGroupRef, record);
      evaluateDeltaRecord(record, settlementByScope, findings);
    });
  }
  for (const [deltaId, records] of deltaById) if (canonicalVariants(records.map(({ delta }) => delta)).size > 1) crossFinding(findings, COMPOSITION_RULES.DELTA_ID_CONFLICT, "conflict", "delta", records, "The same delta id has contradictory definitions.", { deltaId });
  for (const records of deltaBySlot.values()) if (records.length > 1 && records.some(({ delta }) => delta.aggregation === "exclusive") && uniqueComponents(records).length > 1) crossFinding(findings, COMPOSITION_RULES.DELTA_EXCLUSIVE_CONFLICT, "conflict", "delta", records, "Multiple components claim the same delta effect slot while at least one claim is exclusive.");
  for (const [groupRef, records] of conservationGroups) if (records.length === 1 && records[0].delta.permissionRef !== null) crossFinding(findings, COMPOSITION_RULES.DELTA_CONSERVATION_UNRESOLVED, "review", "delta", records, "A return-delta conservation group has only one declared leg; zero-sum closure needs independent evidence.", { conservationGroupRef: groupRef });
  evaluateReturnDeltaBindings(contexts, deltaByPermission, findings);
  evaluateSettlementRecords(settlementByScope, findings);
}

function collectSettlements(contexts) {
  const byScope = new Map();
  for (const context of contexts) context.contract.settlementAssumptions.forEach((settlement, index) => append(byScope, settlement.scopeRef, { context, settlement, path: `${context.path}.settlementAssumptions[${index}]` }));
  return byScope;
}

function evaluateDeltaRecord(record, settlementByScope, findings) {
  const { context, delta } = record;
  if (delta.backing.kind === "none") push(findings, COMPOSITION_RULES.DELTA_BACKING_MISSING, "conflict", "delta", [record], ["backing.kind"], "A declared delta has no backing source.");
  if (["unresolved", "custom", "external-proof"].includes(delta.backing.kind)) push(findings, COMPOSITION_RULES.DELTA_BACKING_REVIEW, "review", "delta", [record], ["backing"], "The delta backing mechanism cannot be proven by the built-in checker and requires independent review.");
  if (["controlled-assets", "redeemable-claims", "external-proof", "custom"].includes(delta.backing.kind) && delta.backing.resourceRef === null) push(findings, COMPOSITION_RULES.DELTA_RESOURCE_MISSING, "conflict", "delta", [record], ["backing.resourceRef"], "The selected backing model has no bound resource.");
  if (delta.settlementScopeRef === null) push(findings, COMPOSITION_RULES.DELTA_SETTLEMENT_MISSING, "review", "delta", [record], ["settlementScopeRef"], "The delta has no explicit settlement scope binding.");
  else if (!settlementByScope.has(delta.settlementScopeRef)) push(findings, COMPOSITION_RULES.DELTA_SETTLEMENT_MISSING, "conflict", "delta", [record], ["settlementScopeRef"], "The delta references a settlement scope that is absent from the composition.");
  if (delta.permissionRef !== null && delta.conservationGroupRef === null) push(findings, COMPOSITION_RULES.DELTA_CONSERVATION_UNRESOLVED, "review", "delta", [record], ["conservationGroupRef"], "Return-delta accounting lacks an explicit conservation group.");
  if (delta.permissionRef !== null && delta.boundRef === null) push(findings, COMPOSITION_RULES.DELTA_BOUND_UNRESOLVED, "review", "delta", [record], ["boundRef"], "Return-delta accounting lacks a bound or limit reference.");
  if (delta.permissionRef !== null && !(context.contract.hook?.permissions ?? []).includes(delta.permissionRef)) push(findings, COMPOSITION_RULES.RETURN_DELTA_PERMISSION_MISSING, "conflict", "delta", [record], ["permissionRef"], "A delta contract names a return permission that the hook does not enable.");
}

function evaluateReturnDeltaBindings(contexts, deltaByPermission, findings) {
  for (const context of contexts) {
    const hook = context.contract.hook;
    if (hook === null) continue;
    for (const permission of Object.keys(returnParents)) if (hook.permissions.includes(permission) && (deltaByPermission.get(`${hook.implementationRef}\u0000${permission}`) ?? []).length === 0) push(findings, COMPOSITION_RULES.RETURN_DELTA_CONTRACT_MISSING, "conflict", "delta", [context], ["hook.permissions"], `Enabled ${permission} has no bound delta contract.`);
    if (hook.permissions.some((permission) => Object.hasOwn(returnParents, permission))) {
      const testKinds = new Set(context.contract.tests.map(({ kind }) => kind));
      const missing = ["fuzz", "invariant"].filter((kind) => !testKinds.has(kind));
      if (missing.length > 0) push(findings, COMPOSITION_RULES.RETURN_DELTA_TESTS_MISSING, "review", "delta", [context], ["tests"], "Return-delta composition lacks required fuzz/invariant test bindings.", { missing });
    }
  }
}

function evaluateSettlementRecords(settlementByScope, findings) {
  for (const [scopeRef, records] of settlementByScope) {
    if (canonicalVariants(records.map(({ settlement }) => settlement)).size > 1 && new Set(records.map(({ settlement }) => `${settlement.mode}\u0000${settlement.currencyKind}`)).size > 1) crossFinding(findings, COMPOSITION_RULES.SETTLEMENT_ID_CONFLICT, "conflict", "settlement", records, "One settlement scope has contradictory mode or currency declarations.", { scopeRef });
    const exclusive = records.filter(({ settlement }) => settlement.exclusive);
    if (exclusive.length > 1 && new Set(exclusive.map(({ settlement }) => settlement.actorRef ?? "<unresolved>")).size > 1) crossFinding(findings, COMPOSITION_RULES.SETTLEMENT_EXCLUSIVE_CONFLICT, "conflict", "settlement", exclusive, "One exclusive settlement scope names multiple actors.", { scopeRef });
    for (const record of records) {
      const { settlement } = record;
      if (!settlementModeCompatible(settlement.mode, settlement.currencyKind)) push(findings, COMPOSITION_RULES.SETTLEMENT_MODE_CONFLICT, "conflict", "settlement", [record], ["mode", "currencyKind"], "Settlement mode is incompatible with its declared currency kind.");
      if (["external", "custom"].includes(settlement.mode) || settlement.currencyKind === "custom") push(findings, COMPOSITION_RULES.SETTLEMENT_CUSTOM_REVIEW, "review", "settlement", [record], ["mode"], "Custom or external settlement remains eligible but requires independent accounting review.");
      if (!["none", "return-delta"].includes(settlement.mode) && (settlement.actorRef === null || settlement.payerRef === null)) push(findings, COMPOSITION_RULES.SETTLEMENT_PARTY_UNRESOLVED, "review", "settlement", [record], ["actorRef", "payerRef"], "The settlement actor or payer is unresolved.");
    }
  }
}

function evaluateFees(contexts, findings) {
  const byId = new Map();
  const byEconomicScope = new Map();
  for (const context of contexts) context.contract.fees.forEach((fee, index) => {
    const record = { context, fee, path: `${context.path}.fees[${index}]` };
    append(byId, fee.feeId, record);
    append(byEconomicScope, `${fee.scopeRef}\u0000${fee.basisRef}`, record);
  });
  for (const [feeId, records] of byId) if (canonicalVariants(records.map(({ fee }) => fee)).size > 1) crossFinding(findings, COMPOSITION_RULES.FEE_ID_CONFLICT, "conflict", "fee", records, "The same fee id has contradictory economic definitions.", { feeId });
  for (const records of byEconomicScope.values()) evaluateFeeStack(records, findings);
}

function evaluateFeeStack(records, findings) {
  const distinct = dedupeRecords(records, ({ fee }) => canonicalJsonV2(fee));
  if (distinct.length < 2) return;
  for (const duplicates of groupBy(distinct, ({ fee }) => `${fee.recipientRef}\u0000${fee.enforcementRef}`).values()) if (duplicates.length > 1) crossFinding(findings, COMPOSITION_RULES.FEE_DUPLICATE_CHARGE, "conflict", "fee", duplicates, "Distinct fee ids charge the same recipient through the same enforcement point on one scope and basis.");
  const modes = new Set(distinct.map(({ fee }) => fee.stacking));
  if (modes.has("forbidden") || modes.size > 1) {
    crossFinding(findings, COMPOSITION_RULES.FEE_STACKING_CONFLICT, "conflict", "fee", distinct, "Multiple fees share one scope and basis but their stacking policies forbid or contradict composition.");
    return;
  }
  const mode = distinct[0].fee.stacking;
  const referenceKey = mode === "explicit-additive" ? "stackGroupRef" : "totalFeeRef";
  const references = new Set(distinct.map(({ fee }) => fee[referenceKey]).filter(Boolean));
  if (references.size !== 1 || distinct.some(({ fee }) => fee[referenceKey] === null)) crossFinding(findings, COMPOSITION_RULES.FEE_STACKING_UNRESOLVED, "review", "fee", distinct, "Fee stacking is declared but lacks one common non-null group/total binding.", { mode, referenceKey });
}

function evaluateDeployments(contexts, findings) {
  const deployments = [];
  const byId = new Map();
  const byAddress = new Map();
  const hooksByArtifact = new Map();
  for (const context of contexts) {
    if (context.contract.hook !== null) append(hooksByArtifact, context.contract.hook.implementationRef, context);
    context.contract.deployments.forEach((deployment, index) => {
      const record = { context, deployment, path: `${context.path}.deployments[${index}]` };
      deployments.push(record);
      append(byId, deployment.deploymentId, record);
      if (deployment.address !== null) append(byAddress, `${deployment.chainId}\u0000${deployment.address.toLowerCase()}`, record);
      if (deployment.state === "unresolved") push(findings, COMPOSITION_RULES.DEPLOYMENT_UNRESOLVED, "review", "deployment", [record], ["state"], "Deployment identity is unresolved and cannot establish a deployable preimage.");
      const missing = requiredDeploymentFields(deployment).filter((field) => deployment[field] === null);
      if (missing.length > 0) push(findings, COMPOSITION_RULES.DEPLOYMENT_PREIMAGE_INCOMPLETE, "conflict", "deployment", [record], missing, "Deployment state claims more resolution than its preimage/runtime fields prove.", { missing });
    });
  }
  for (const [deploymentId, records] of byId) if (canonicalVariants(records.map(({ deployment }) => deployment)).size > 1) crossFinding(findings, COMPOSITION_RULES.DEPLOYMENT_ID_CONFLICT, "conflict", "deployment", records, "The same deployment id has contradictory preimage or runtime facts.", { deploymentId });
  for (const records of byAddress.values()) if (canonicalVariants(records.map(({ deployment }) => ({ artifactRef: deployment.artifactRef, runtimeCodeHash: deployment.runtimeCodeHash, permissionMask: deployment.permissionMask, poolManagerRef: deployment.poolManagerRef }))).size > 1) crossFinding(findings, COMPOSITION_RULES.DEPLOYMENT_ADDRESS_CONFLICT, "conflict", "deployment", records, "One chain address is bound to contradictory artifact, runtime, permission, or PoolManager facts.");
  evaluateHookDeployments(hooksByArtifact, deployments, findings);
}

function evaluateHookDeployments(hooksByArtifact, deployments, findings) {
  for (const [artifactRef, hookContexts] of hooksByArtifact) {
    const matching = deployments.filter(({ deployment }) => deployment.artifactRef === artifactRef);
    if (matching.length === 0) {
      for (const context of hookContexts) push(findings, COMPOSITION_RULES.HOOK_DEPLOYMENT_MISSING, "review", "deployment", [context], ["deployments"], "A hook artifact has no deployment-preimage contract.", { artifactRef });
      continue;
    }
    for (const record of matching) for (const context of hookContexts) evaluateHookDeployment(record, context, findings);
  }
}

function evaluateHookDeployment(record, context, findings) {
  const expectedMask = canonicalV4PermissionMask(Object.fromEntries(context.contract.hook.permissions.map((permission) => [permission, true]))).toLowerCase();
  const actualMask = record.deployment.permissionMask?.toLowerCase() ?? null;
  if (actualMask !== null && actualMask !== expectedMask) push(findings, COMPOSITION_RULES.DEPLOYMENT_PERMISSION_CONFLICT, "conflict", "deployment", [record, context], ["permissionMask"], "Deployment permission mask disagrees with the hook capability contract.", { actualMask, expectedMask });
  if (record.deployment.address !== null && actualMask !== null) {
    const addressMask = `0x${(BigInt(record.deployment.address) & 0x3fffn).toString(16).padStart(4, "0")}`;
    if (addressMask !== actualMask) push(findings, COMPOSITION_RULES.DEPLOYMENT_ADDRESS_BITS_CONFLICT, "conflict", "deployment", [record, context], ["address", "permissionMask"], "Hook address low bits do not encode the declared permission mask.", { addressMask, permissionMask: actualMask });
  }
  if (context.contract.hook.poolManagerRef && record.deployment.poolManagerRef && context.contract.hook.poolManagerRef !== record.deployment.poolManagerRef) push(findings, COMPOSITION_RULES.DEPLOYMENT_MANAGER_CONFLICT, "conflict", "deployment", [record, context], ["poolManagerRef"], "Hook and deployment contracts bind different PoolManagers.");
}

function settlementModeCompatible(mode, currencyKind) {
  if (mode === "erc20-sync-transfer-settle") return ["erc20", "either"].includes(currencyKind);
  if (mode === "native-settle") return ["native", "either"].includes(currencyKind);
  if (mode === "mint-burn") return currencyKind === "claim";
  return true;
}

function requiredDeploymentFields(deployment) {
  if (deployment.state === "unresolved") return [];
  const preimage = ["creationCodeHash", "constructorArgsHash", "initcodeHash", "permissionMask", "hookMinerSaltHash", "poolManagerRef"];
  if (deployment.state === "preimage-bound") return preimage;
  if (deployment.state === "predicted") return [...preimage, "address"];
  return [...preimage, "address", "runtimeCodeHash"];
}
