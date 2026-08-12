import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalJsonBytesV2, canonicalJsonSha256V2 } from "./canonical-json-core.mjs";
import {
  encodeProgrammableTradeExecutionEnvelopeV1,
  encodeProgrammableTradeQuoteV1,
  encodeProgrammableTradeRequestV1,
  hashV4PoolKey,
  UINT256_MAX
} from "./evm-encoding-core.mjs";
import { tradeFeeEvidenceMatchesV1, tradeFeeManifestSemanticsMatchV1 } from "./fee-conformance-core.mjs";
import { validateAgainstSchema } from "./restricted-json-schema-core.mjs";
import { parseBoundedStrictJsonBytes } from "./strict-json-core.mjs";
import { inspectForgeTradeTestDeclarationV1 } from "./v4-deployment-evidence-core.mjs";
import {
  inspectTradeRouteModeV1,
  tradeAdapterInterfaceDependencyMatchesV1,
  tradeCallEvidenceFindingsV1,
  tradeExecutionDeclarationFindingV1,
  tradeExecutionTestDeclarationFindingV1,
  tradeExpectedResultBindingsV1,
  tradeExpectedRouteTargetV1,
  tradeFundingSpenderV1,
  tradePoolDeltasSettledV1,
  tradeQuoteStateNeutralV1,
  tradeResultUintValuesValidV1,
  tradeWalletReconciledV1
} from "./v4-hook-semantic-contract-core.mjs";

export const TRADE_CAPABILITY_MANIFEST_V1_SCHEMA_ID = "urn:programmable:trade-capability-manifest:1.0.0";
export const PROGRAMMABLE_TRADE_EXECUTION_V1_SCHEMA_ID = "urn:programmable:trade-execution:1.0.0";
export const TRADE_QUOTE_TEST_RESULT_V1_SCHEMA_ID = "urn:programmable:trade-quote-test-result:1.0.0";
export const TRADE_EXECUTION_TEST_RESULT_V1_SCHEMA_ID = "urn:programmable:trade-execution-test-result:1.0.0";
export const ZERO_ADDRESS = `0x${"00".repeat(20)}`;
export const TRADE_TEST_SEMANTIC_ADEQUACY_V1 = "PARTIAL_EVIDENCE";

export {
  forgeTradeTestMatchPathV1,
  forgeTradeTestMatchTestV1,
  inspectForgeTradeTestDeclarationV1,
  TRADE_TEST_RUNNER_CONTRACT_V1
} from "./v4-deployment-evidence-core.mjs";

export const PROGRAMMABLE_TRADE_EXECUTION_ABI_DESCRIPTOR_V1 = Object.freeze({
  interfaceId: "programmable-trade-execution-v1",
  interfaceVersion: "1.0.0",
  encoding: "abi-v2",
  mappingProfile: "canonical-json-to-abi-v1",
  tupleWrapping: "field-sequence-no-outer-offset",
  valueMappings: Object.freeze({
    sha256: "remove-sha256-prefix-and-require-32-bytes",
    bytes32: "remove-0x-prefix-and-require-32-bytes",
    slug: "keccak256-utf8",
    direction: "zero-for-one=true;one-for-zero=false",
    amountMode: "exact-input=true;exact-output=false",
    uint256: "canonical-decimal-to-uint256",
    uint16: "json-integer-to-uint16",
    address: "lowercase-20-byte-address"
  }),
  requestTupleFields: Object.freeze(["manifestSha256", "modeId", "chainId", "poolKeySha256", "hookDataSha256", "sender", "recipient", "direction", "amountMode", "amountSpecified", "slippageBps", "deadline", "fundingProfileId", "feeBehaviorSha256"]),
  quoteTupleFields: Object.freeze(["requestSha256", "manifestSha256", "blockNumber", "blockHash", "amountSpecified", "amountQuoted", "callDataSha256", "feeBehaviorSha256"]),
  executionTupleFields: Object.freeze(["requestSha256", "quoteSha256", "target", "value", "calldata", "deadline", "actionPlanSha256", "fundingWitnessSha256"]),
  entrypoints: Object.freeze([
    Object.freeze({
      signature: "quote(bytes)",
      selector: "0xedfa3568",
      requestAbiType: "(bytes32,bytes32,uint256,bytes32,bytes32,address,address,bool,bool,uint256,uint16,uint256,bytes32,bytes32)",
      responseAbiType: "(bytes32,bytes32,uint256,bytes32,uint256,uint256,bytes32,bytes32)"
    }),
    Object.freeze({
      signature: "buildExecution(bytes)",
      selector: "0x21be7c85",
      requestAbiType: "(bytes32,bytes32,uint256,bytes32,bytes32,address,address,bool,bool,uint256,uint16,uint256,bytes32,bytes32)",
      responseAbiType: "(bytes32,bytes32,address,uint256,bytes,uint256,bytes32,bytes32)"
    })
  ])
});
export const PROGRAMMABLE_TRADE_EXECUTION_ABI_SHA256_V1 = canonicalJsonSha256V2(
  PROGRAMMABLE_TRADE_EXECUTION_ABI_DESCRIPTOR_V1
);

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const referencesDirectory = path.resolve(moduleDirectory, "../references");
const manifestSchema = readSchema("trade-capability-manifest-v1.schema.json");
const interfaceSchema = readSchema("programmable-trade-execution-v1.schema.json");
const interfaceSchemaBytes = fs.readFileSync(path.join(referencesDirectory, "programmable-trade-execution-v1.schema.json"));
export const PROGRAMMABLE_TRADE_EXECUTION_SCHEMA_SHA256_V1 = sha256Bytes(interfaceSchemaBytes);

const QUADRANTS = Object.freeze([
  "zero-for-one:exact-input",
  "zero-for-one:exact-output",
  "one-for-zero:exact-input",
  "one-for-zero:exact-output"
]);
const PROGRAMMABLE_TRADE_ABI_ENCODERS = Object.freeze({
  "programmable-trade-request-v1": encodeProgrammableTradeRequestV1,
  "programmable-trade-quote-v1": encodeProgrammableTradeQuoteV1,
  "programmable-trade-execution-envelope-v1": encodeProgrammableTradeExecutionEnvelopeV1
});

export function tradeCapabilityManifestBytesV1(manifest) {
  return canonicalJsonBytesV2(manifest);
}

export function tradeCapabilityManifestSha256V1(manifest) {
  return canonicalJsonSha256V2(manifest);
}

export function tradeTestResultSha256V1(result) {
  const preimage = { ...result };
  delete preimage.contentSha256;
  return canonicalJsonSha256V2(preimage);
}

export function validateTradeCapabilityManifestV1(manifest, expected = {}) {
  const findings = schemaFindings(manifest, manifestSchema, "TRADE_CAPABILITY_MANIFEST_SCHEMA_INVALID");
  if (findings.length > 0) return sortFindings(findings);
  const add = findingAdder(findings);

  for (const [field, observed] of [
    ["applicationId", manifest.applicationId],
    ["marketRef", manifest.marketRef],
    ["routeType", manifest.route.type]
  ]) {
    if (expected[field] !== undefined && observed !== expected[field]) {
      add("TRADE_MANIFEST_EXPECTED_BINDING_MISMATCH", `$.${field === "routeType" ? "route.type" : field}`, `Trade manifest ${field} does not match its declared owner.`, { expected: expected[field], observed });
    }
  }
  if (expected.manifestSha256 !== undefined && tradeCapabilityManifestSha256V1(manifest) !== expected.manifestSha256) {
    add("TRADE_MANIFEST_DIGEST_MISMATCH", "$", "Trade manifest canonical bytes do not match the expected digest.");
  }

  validateCanonicalUint(manifest.chain.chainId, "$.chain.chainId", false, add);
  validateCanonicalUint(manifest.chain.referenceBlock.number, "$.chain.referenceBlock.number", true, add);
  validateCanonicalUint(manifest.chain.referenceBlock.timestamp, "$.chain.referenceBlock.timestamp", false, add);
  validatePoolKey(manifest.poolKey, add);
  const dependencies = validateDependencies(manifest.dependencies.entries, add);
  const modes = validateModesAndFunding(manifest, dependencies, add);
  validateRoute(manifest, dependencies, add);
  validateLimitsAndFees(manifest, add);
  validateTestDeclarations(manifest, modes, add);
  return sortFindings(findings);
}

export function inspectTradeCapabilityManifestV1(manifest, expected = {}) {
  const findings = validateTradeCapabilityManifestV1(manifest, expected);
  const modes = Array.isArray(manifest?.capabilities?.modeMatrix) ? manifest.capabilities.modeMatrix : [];
  const supportedModeIds = modes.filter(({ support }) => support === "supported").map(({ id }) => id).sort();
  const unsupportedModeIds = modes.filter(({ support }) => support === "unsupported").map(({ id }) => id).sort();
  const quoteTests = Array.isArray(manifest?.testEvidence?.quoteTests) ? manifest.testEvidence.quoteTests : [];
  const executionTests = Array.isArray(manifest?.testEvidence?.executionTests) ? manifest.testEvidence.executionTests : [];
  const quoteModes = new Set(quoteTests.map(({ modeRef }) => modeRef));
  const successfulExecutionModes = new Set(executionTests.filter(({ scenario }) => scenario === "successful-swap").map(({ modeRef }) => modeRef));
  const rejectionModes = new Set(executionTests.filter(({ scenario }) => scenario === "unsupported-mode-pre-effects-revert").map(({ modeRef }) => modeRef));
  return Object.freeze({
    valid: findings.length === 0,
    findings: Object.freeze(findings),
    manifestSha256: isObject(manifest) ? tradeCapabilityManifestSha256V1(manifest) : null,
    applicability: isObject(manifest) ? "tradable" : null,
    status: manifest?.status ?? null,
    routeType: manifest?.route?.type ?? null,
    supportedModeIds: Object.freeze(supportedModeIds),
    unsupportedModeIds: Object.freeze(unsupportedModeIds),
    quoteTestIds: Object.freeze(quoteTests.map(({ id }) => id).sort()),
    executionTestIds: Object.freeze(executionTests.map(({ id }) => id).sort()),
    uncoveredQuoteModeIds: Object.freeze(supportedModeIds.filter((id) => !quoteModes.has(id))),
    uncoveredExecutionModeIds: Object.freeze(supportedModeIds.filter((id) => !successfulExecutionModes.has(id))),
    uncoveredUnsupportedModeIds: Object.freeze(unsupportedModeIds.filter((id) => !rejectionModes.has(id)))
  });
}

export function validateProgrammableTradeExecutionEnvelopeV1(envelope) {
  const findings = schemaFindings(envelope, interfaceSchema, "PROGRAMMABLE_TRADE_EXECUTION_SCHEMA_INVALID");
  if (findings.length > 0) return sortFindings(findings);
  const add = findingAdder(findings);
  const payload = envelope.payload;
  for (const [field, allowZero] of [
    ["chainId", false], ["blockNumber", true], ["amountSpecified", false], ["amountQuoted", false],
    ["value", true], ["deadline", false]
  ]) {
    if (payload[field] !== undefined) validateCanonicalUint(payload[field], `$.payload.${field}`, allowZero, add);
  }
  return sortFindings(findings);
}

export function encodeProgrammableTradeExecutionAbiV1(envelope) {
  const findings = validateProgrammableTradeExecutionEnvelopeV1(envelope);
  if (findings.length > 0) throw new TypeError(`programmable trade envelope is invalid: ${findings[0].code} ${findings[0].path}`);
  return PROGRAMMABLE_TRADE_ABI_ENCODERS[envelope.contract.id](envelope.payload);
}

export function validateTradeTestResultV1(result, { manifest = null, test = null } = {}) {
  const definition = result?.contract === "trade-quote-test-result-v1"
    ? "quoteTestResult"
    : result?.contract === "trade-execution-test-result-v1" ? "executionTestResult" : null;
  if (definition === null) return [finding("TRADE_DOMAIN_RECEIPT_INVALID", "$.contract", "Unknown trade result contract.")];
  const resultSchema = { $schema: manifestSchema.$schema, $defs: manifestSchema.$defs, $ref: `#/$defs/${definition}` };
  const findings = schemaFindings(result, resultSchema, "TRADE_DOMAIN_RECEIPT_INVALID");
  if (findings.length > 0) return sortFindings(findings);
  const add = findingAdder(findings);
  if (tradeTestResultSha256V1(result) !== result.contentSha256) {
    add("TRADE_DOMAIN_RECEIPT_DIGEST_MISMATCH", "$.contentSha256", "Trade result digest does not match canonical JSON with contentSha256 omitted.");
  }
  validateCanonicalUint(result.context.chain.chainId, "$.context.chain.chainId", false, add);
  validateCanonicalUint(result.context.chain.blockNumber, "$.context.chain.blockNumber", true, add);
  validateCanonicalUint(result.context.chain.blockTimestamp, "$.context.chain.blockTimestamp", false, add);
  validateCanonicalUint(result.context.request.amountSpecified, "$.context.request.amountSpecified", false, add);
  validateCanonicalUint(result.context.limits.deadline, "$.context.limits.deadline", false, add);
  if (!tradeResultUintValuesValidV1(result)) add("TRADE_UINT256_OUT_OF_RANGE", "$", "Trade result contains a canonical decimal field outside uint256 range.");
  validatePoolKey(result.context.poolKey, add, "$.context.poolKey", "$.context.poolKey.poolId");
  if (result.context.poolKeySha256 !== canonicalJsonSha256V2(result.context.poolKey)) {
    add("TRADE_POOL_KEY_PARITY_MISMATCH", "$.context.poolKeySha256", "Trade result PoolKey digest does not match its canonical PoolKey.");
  }
  if (result.contract === "trade-quote-test-result-v1") validateQuoteObservation(result, add);
  if (result.contract === "trade-execution-test-result-v1") validateExecutionObservation(result, add);
  if (manifest !== null && test !== null) validateResultBindings(result, manifest, test, add);
  return sortFindings(findings);
}

export function validateTradeResultPairV1(quoteResult, executionResult, options = {}) {
  const findings = [
    ...validateTradeTestResultV1(quoteResult, { manifest: options.manifest, test: options.quoteTest }),
    ...validateTradeTestResultV1(executionResult, { manifest: options.manifest, test: options.executionTest })
  ];
  const add = findingAdder(findings);
  if (findings.length === 0) {
    for (const field of ["manifestSha256", "mode", "chain", "poolKey", "poolKeySha256", "route", "hookData", "limits", "fee", "request"]) {
      if (!sameCanonical(quoteResult.context[field], executionResult.context[field])) {
        add("TRADE_QUOTE_EXECUTION_PARITY_MISMATCH", `$.context.${field}`, `Quote and execution results disagree on ${field}.`);
      }
    }
    const observation = executionResult.observation;
    const quoted = BigInt(quoteResult.observation.amountQuoted);
    const amountIn = BigInt(observation.amountIn);
    const amountOut = BigInt(observation.amountOut);
    const guard = BigInt(observation.slippageGuardAmount);
    const amountSpecified = BigInt(executionResult.context.request.amountSpecified);
    if (executionResult.outcome === "swap-succeeded") {
      const exactInput = executionResult.context.mode.amountMode === "exact-input";
      const slippageBps = BigInt(executionResult.context.limits.slippageBps);
      const expectedGuard = exactInput
        ? quoted * (10_000n - slippageBps) / 10_000n
        : (quoted * (10_000n + slippageBps) + 9_999n) / 10_000n;
      if ((exactInput && amountSpecified !== amountIn) || (!exactInput && amountSpecified !== amountOut)) {
        add("TRADE_QUOTE_EXECUTION_PARITY_MISMATCH", "$.context.request.amountSpecified", "Exact-input requests bind executed input; exact-output requests bind executed output.");
      }
      if (guard === 0n || guard !== expectedGuard || (exactInput && (quoted !== amountOut || amountOut < guard)) || (!exactInput && (quoted !== amountIn || amountIn > guard))) {
        add(exactInput ? "EXACT_INPUT_SLIPPAGE_UNPROVEN" : "EXACT_OUTPUT_SLIPPAGE_UNPROVEN", "$.observation.slippageGuardAmount", "Execution amounts must equal the fresh quote and satisfy a nonzero calldata slippage guard.");
      }
      if (observation.executedFeesSha256 !== executionResult.context.fee.quotedFeesSha256) {
        add("TRADE_FEE_RECONCILIATION_FAILED", "$.observation.executedFeesSha256", "Executed fee observations must match the quoted fee set.");
      }
    }
  }
  return sortFindings(findings);
}

function validatePoolKey(poolKey, add, base = "$.poolKey", poolIdPath = `${base}.poolId`) {
  let derived;
  try {
    derived = hashV4PoolKey(poolKey);
  } catch (error) {
    add("TRADE_POOL_KEY_INVALID", base, error.message);
    return;
  }
  if (poolKey.poolId !== derived) add("TRADE_POOL_KEY_INVALID", poolIdPath, "PoolId must equal keccak256(abi.encode(PoolKey)).", { expected: derived, observed: poolKey.poolId });
}

function validateDependencies(entries, add) {
  const byId = new Map();
  const roles = new Map();
  for (const [index, entry] of entries.entries()) {
    if (byId.has(entry.id)) add("TRADE_DEPENDENCY_ID_DUPLICATE", `$.dependencies.entries[${index}].id`, "Dependency ids must be unique.", { id: entry.id });
    byId.set(entry.id, entry);
    const roleEntries = roles.get(entry.role) ?? [];
    roleEntries.push(entry);
    roles.set(entry.role, roleEntries);
  }
  return { byId, roles };
}

function validateRoute(manifest, dependencies, add) {
  const route = manifest.route;
  const requireRole = (role, minimum = 1) => {
    if ((dependencies.roles.get(role) ?? []).length < minimum) add("TRADE_ROUTE_DEPENDENCY_MISSING", "$.dependencies.entries", `Route requires a content-addressed ${role} dependency.`);
  };
  const bindEndpoint = (endpoint, role, base) => {
    const dependency = dependencies.byId.get(endpoint.sourceDependencyRef);
    if (!dependency || dependency.role !== role) add("TRADE_ENDPOINT_DEPENDENCY_MISMATCH", `${base}.sourceDependencyRef`, `Endpoint must bind a ${role} dependency.`);
  };
  if (route.type === "standard-uniswap-v4") {
    for (const role of ["v4-core", "v4-periphery", "universal-router", "v4-quoter", "permit2", "trade-integration"]) requireRole(role);
    bindEndpoint(route.router, "universal-router", "$.route.router");
    bindEndpoint(route.quoter, "v4-quoter", "$.route.quoter");
  } else {
    requireRole("adapter-interface");
    requireRole("trade-integration");
    bindEndpoint(route.adapter, "trade-integration", "$.route.adapter");
    if (route.canonicalInterface.schemaSha256 !== PROGRAMMABLE_TRADE_EXECUTION_SCHEMA_SHA256_V1 || !tradeAdapterInterfaceDependencyMatchesV1(manifest.dependencies.entries, PROGRAMMABLE_TRADE_EXECUTION_SCHEMA_SHA256_V1)) add("CANONICAL_ADAPTER_BINDING_MISSING", "$.route.canonicalInterface.schemaSha256", "Adapter must bind the exact bundled interface schema and its unique content-addressed dependency.");
    if (route.canonicalInterface.abiSha256 !== PROGRAMMABLE_TRADE_EXECUTION_ABI_SHA256_V1) add("CANONICAL_ADAPTER_BINDING_MISSING", "$.route.canonicalInterface.abiSha256", "Adapter must bind the exact canonical ABI descriptor.");
    if (route.transport === null) {
      for (const [name, endpoint] of [["router", route.router], ["quoter", route.quoter]]) {
        if (!sameCanonical(endpoint, route.adapter)) add("ADAPTER_TRANSPORT_PROFILE_MISMATCH", `$.route.${name}`, "A direct adapter route must expose the exact same content-addressed adapter endpoint as quote and execution target.");
      }
    } else {
      for (const [name, role] of [["router", "universal-router"], ["quoter", "v4-quoter"]]) {
        requireRole(role);
        bindEndpoint(route[name], role, `$.route.${name}`);
        if (!sameCanonical(route[name], route.transport[name])) add("ADAPTER_TRANSPORT_PROFILE_MISMATCH", `$.route.transport.${name}`, "Nested adapter transport must equal the declared endpoint.");
      }
    }
  }
  const zeroHook = manifest.poolKey.hooks === ZERO_ADDRESS;
  if (zeroHook !== (route.hookData.mode === "none")) add("TRADE_HOOK_DATA_PROFILE_MISMATCH", "$.route.hookData", "Zero-hook pools require explicit no-hookData; hooked pools require a bound hookData contract.");
  if (route.hookData.mode === "bound") {
    const byteLength = (route.hookData.example.length - 2) / 2;
    if (byteLength > route.hookData.maximumBytes) add("TRADE_HOOK_DATA_PROFILE_MISMATCH", "$.route.hookData.example", "Example hookData exceeds its declared maximumBytes.");
    if (route.hookData.required && byteLength === 0) add("TRADE_HOOK_DATA_PROFILE_MISMATCH", "$.route.hookData.example", "Required hookData needs a nonempty bound example.");
  }
}

function validateModesAndFunding(manifest, dependencies, add) {
  const route = manifest.route;
  const fundingById = new Map();
  for (const [index, profile] of route.fundingProfiles.entries()) {
    if (fundingById.has(profile.id)) add("TRADE_FUNDING_PROFILE_DUPLICATE", `$.route.fundingProfiles[${index}].id`, "Funding profile ids must be unique.");
    fundingById.set(profile.id, profile);
    if (profile.permit2.mode === "used") {
      const dependency = dependencies.byId.get(profile.permit2.sourceDependencyRef);
      if (!dependency || dependency.role !== "permit2") add("PERMIT2_FLOW_UNPROVEN", `$.route.fundingProfiles[${index}].permit2.sourceDependencyRef`, "Permit2 funding must bind the exact Permit2 dependency.");
      const expectedSpender = tradeFundingSpenderV1(route);
      if (profile.permit2.spender !== expectedSpender) add("PERMIT2_FLOW_UNPROVEN", `$.route.fundingProfiles[${index}].permit2.spender`, "Permit2 spender must equal the route's exact execution target.");
    }
  }
  const byQuadrant = new Map();
  const byId = new Map();
  let supported = 0;
  for (const [index, mode] of manifest.capabilities.modeMatrix.entries()) {
    const quadrant = `${mode.direction}:${mode.amountMode}`;
    if (byQuadrant.has(quadrant)) add("TRADE_MODE_MATRIX_INVALID", `$.capabilities.modeMatrix[${index}]`, "Direction/exactness quadrants must occur exactly once.", { quadrant });
    byQuadrant.set(quadrant, mode);
    if (byId.has(mode.id)) add("TRADE_MODE_MATRIX_INVALID", `$.capabilities.modeMatrix[${index}].id`, "Mode ids must be unique.", { id: mode.id });
    byId.set(mode.id, mode);
    const funding = fundingById.get(mode.fundingProfileRef);
    if (!funding) add("TRADE_FUNDING_PROFILE_MISSING", `$.capabilities.modeMatrix[${index}].fundingProfileRef`, "Mode must bind one declared funding profile.");
    if (mode.support === "supported") {
      supported += 1;
      validateModeFunding(manifest, mode, funding, index, add);
    }
  }
  if (byQuadrant.size !== QUADRANTS.length || QUADRANTS.some((key) => !byQuadrant.has(key))) add("TRADE_MODE_MATRIX_INVALID", "$.capabilities.modeMatrix", "Mode matrix must enumerate all four direction/exactness quadrants once.");
  if (supported === 0) add("TRADE_MODE_MATRIX_INVALID", "$.capabilities.modeMatrix", "A tradable route must support at least one mode.");
  return { byId, supported: [...byId.values()].filter(({ support }) => support === "supported"), unsupported: [...byId.values()].filter(({ support }) => support === "unsupported") };
}

function validateModeFunding(manifest, mode, funding, index, add) {
  if (!funding) return;
  const inspection = inspectTradeRouteModeV1({ routeType: manifest.route.type, routeTransport: manifest.route.transport?.type ?? null, poolKey: manifest.poolKey, mode, funding });
  if (!inspection.entrypointsValid) add(manifest.route.type === "canonical-programmable-adapter" ? "CANONICAL_ADAPTER_BINDING_MISSING" : "TRADE_EXECUTION_PATH_MISMATCH", `$.capabilities.modeMatrix[${index}]`, "Supported mode entrypoints must equal the route's canonical quote and execution interface.");
  if (!inspection.fundingValid) add(inspection.fundingErrorCode, `$.capabilities.modeMatrix[${index}].fundingProfileRef`, "Funding must match the exact native-value, Permit2, or canonical adapter-defined field contract.");
}

function validateLimitsAndFees(manifest, add) {
  const slippage = manifest.slippage;
  if (!(slippage.minimumBps <= slippage.defaultBps && slippage.defaultBps <= slippage.maximumBps && slippage.maximumBps < 10_000)) add("TRADE_SLIPPAGE_POLICY_INVALID", "$.slippage", "Slippage bounds must satisfy minimum <= default <= maximum < 10000 bps.");
  const fee = manifest.feeBehavior.programmableFeeV2;
  const componentIds = manifest.feeBehavior.components.map(({ id }) => id);
  if (new Set(componentIds).size !== componentIds.length) add("TRADE_FEE_COMPONENT_DUPLICATE", "$.feeBehavior.components", "Fee component ids must be unique.");
  if (!tradeFeeManifestSemanticsMatchV1(manifest)) add("TRADE_FEE_SCOPE_MISMATCH", "$.feeBehavior.components", "Fee components must bind exact calculation, currency-role and charge-base semantics, including a Fee V2 hook component when applicable.");
  if (fee.applicability === "unresolved") add("TRADE_FEE_BEHAVIOR_UNRESOLVED", "$.feeBehavior.programmableFeeV2", "A tradable route cannot complete while fee applicability is unresolved.");
  if (fee.applicability === "applicable") {
    if (fee.chainId !== manifest.chain.chainId || fee.poolId !== manifest.poolKey.poolId) add("TRADE_FEE_SCOPE_MISMATCH", "$.feeBehavior.programmableFeeV2", "Fee V2 scope must bind the manifest chain and PoolId.");
    if (![manifest.poolKey.currency0, manifest.poolKey.currency1].includes(fee.quoteCurrency)) add("TRADE_FEE_SCOPE_MISMATCH", "$.feeBehavior.programmableFeeV2.quoteCurrency", "Fee quote currency must be one PoolKey currency.");
  }
}

function validateTestDeclarations(manifest, modes, add) {
  const quotes = manifest.testEvidence.quoteTests;
  const executions = manifest.testEvidence.executionTests;
  const ids = new Set();
  const commandIds = new Set();
  const resultPaths = new Set();
  for (const [kind, tests] of [["quote", quotes], ["execution", executions]]) {
    for (const [index, record] of tests.entries()) {
      const base = `$.testEvidence.${kind}Tests[${index}]`;
      if (ids.has(record.id)) add("TRADE_TEST_ID_DUPLICATE", `${base}.id`, "Trade test ids must be globally unique.");
      ids.add(record.id);
      if (commandIds.has(record.commandId)) add("TRADE_COMMAND_REUSED", `${base}.commandId`, "A command id may author only one trade result.");
      commandIds.add(record.commandId);
      if (resultPaths.has(record.resultArtifactPath)) add("TRADE_RESULT_PATH_REUSED", `${base}.resultArtifactPath`, "Trade result artifact paths must be unique.");
      resultPaths.add(record.resultArtifactPath);
      if (!modes.byId.has(record.modeRef)) add("TRADE_EVIDENCE_MODE_UNDECLARED", `${base}.modeRef`, "Trade test references an undeclared mode.");
      const declaredMode = modes.byId.get(record.modeRef);
      if (kind === "execution" && ["expired-deadline-revert", "slippage-bound-revert", "funding-requirement-revert", "successful-swap"].includes(record.scenario) && declaredMode?.support !== "supported") {
        add("TRADE_TEST_SCENARIO_MODE_MISMATCH", `${base}.scenario`, "Successful and safety-boundary tests must exercise a supported trade mode.");
      }
      if (kind === "execution" && record.scenario === "unsupported-mode-pre-effects-revert" && declaredMode?.support !== "unsupported") {
        add("TRADE_TEST_SCENARIO_MODE_MISMATCH", `${base}.scenario`, "Unsupported-mode rejection tests must exercise an explicitly unsupported mode.");
      }
      const declarationFinding = kind === "execution" ? tradeExecutionTestDeclarationFindingV1(record) : null;
      if (declarationFinding !== null) add(declarationFinding, `${base}.expectedOutcome`, "Execution scenario, expected outcome and expected revert data must describe one exact success or rejection contract.");
      if (record.chainId !== manifest.chain.chainId) add("TRADE_CHAIN_CONTEXT_MISMATCH", `${base}.chainId`, "Trade test chainId must match the manifest.");
      validateLocalCommand(record.command, base, add);
      const runner = inspectForgeTradeTestDeclarationV1(record);
      if (!runner.valid) add(runner.code, `${base}.command.argv`, runner.message);
      const expectedTarget = tradeExpectedRouteTargetV1(manifest.route, kind);
      if (record.targetAddress !== expectedTarget) add(kind === "quote" ? "TRADE_QUOTE_PATH_INVALID" : "TRADE_EXECUTION_PATH_MISMATCH", `${base}.targetAddress`, "Trade test target must equal the declared route endpoint.");
      const bindings = tradeExpectedResultBindingsV1(kind, manifest.route.type, record.scenario);
      if (!sameSet(record.resultBindings, bindings)) add("TRADE_TEST_BINDINGS_INCOMPLETE", `${base}.resultBindings`, "Trade result bindings must enumerate the exact required contract.");
      if (manifest.route.type === "canonical-programmable-adapter" && !sameCanonical(record.testSourceArtifact, manifest.route.canonicalInterface.conformanceArtifact)) add("CANONICAL_ADAPTER_BINDING_MISSING", `${base}.testSourceArtifact`, "Every adapter quote and execution test must execute the exact canonical conformance artifact.");
    }
  }
  for (const mode of modes.supported) {
    const quoteMatches = quotes.filter(({ modeRef }) => modeRef === mode.id);
    const successMatches = executions.filter(({ modeRef, scenario }) => modeRef === mode.id && scenario === "successful-swap");
    if (quoteMatches.length !== 1 || successMatches.length !== 1) add("TRADE_MODE_EVIDENCE_CARDINALITY_INVALID", "$.testEvidence", "Each supported mode requires exactly one quote and one successful execution result contract.", { modeId: mode.id, quoteCount: quoteMatches.length, executionCount: successMatches.length });
  }
  for (const mode of modes.unsupported) {
    const quoteMatches = quotes.filter(({ modeRef }) => modeRef === mode.id);
    const rejectionMatches = executions.filter(({ modeRef, scenario, expectedOutcome }) => modeRef === mode.id && scenario === "unsupported-mode-pre-effects-revert" && expectedOutcome === "reverts-before-effects");
    if (quoteMatches.length !== 0 || rejectionMatches.length !== 1) add("TRADE_MODE_EVIDENCE_CARDINALITY_INVALID", "$.testEvidence", "Each unsupported mode needs zero quote-success declarations and one pre-effects rejection test.", { modeId: mode.id, quoteCount: quoteMatches.length, rejectionCount: rejectionMatches.length });
  }
  for (const scenario of ["expired-deadline-revert", "slippage-bound-revert", "funding-requirement-revert"]) {
    if (!executions.some((record) => record.scenario === scenario && record.expectedOutcome === "reverts-before-effects")) add("TRADE_NEGATIVE_TEST_REQUIRED", "$.testEvidence.executionTests", `Tradable routes require a real ${scenario} test.`);
  }
  const requiredRevertDigests = executions.filter(({ scenario }) => ["expired-deadline-revert", "slippage-bound-revert", "funding-requirement-revert"].includes(scenario)).map(({ expectedRevertDataSha256 }) => expectedRevertDataSha256);
  if (new Set(requiredRevertDigests).size !== 3) add("TRADE_NEGATIVE_REVERT_BINDING_INVALID", "$.testEvidence.executionTests", "Deadline, slippage and funding guards must bind three distinct expected revert-data digests.");
}

function validateLocalCommand(command, base, add) {
  const text = command.argv.join(" ");
  if (command.argv.includes("--broadcast") || /(?:https?|wss?):\/\/(?!localhost(?::|\/)|127\.0\.0\.1(?::|\/)|\[::1\](?::|\/))/iu.test(text)) {
    add("TRADE_EXTERNAL_ACTION_FORBIDDEN", `${base}.command.argv`, "Trade evidence commands must stay local or on an already configured local fork and may not broadcast or name an external endpoint.");
  }
}

function validateQuoteObservation(result, add) {
  if (!tradeQuoteStateNeutralV1(result)) {
    add("TRADE_QUOTE_STATE_NEUTRALITY_UNPROVEN", "$.observation", "A quote must be an eth_call with identical pre/post state and exact zero deltas for both PoolKey currencies.");
  }
}

function validateExecutionObservation(result, add) {
  const observation = result.observation;
  if (observation.executionKind === "foundry-call" && observation.transactionHash !== null) add("TRADE_DOMAIN_RECEIPT_INVALID", "$.observation.transactionHash", "Foundry-call evidence has no transaction hash and must use null.");
  if (observation.executionKind === "local-rpc-transaction" && observation.transactionHash === null) add("TRADE_DOMAIN_RECEIPT_INVALID", "$.observation.transactionHash", "Local RPC transaction evidence requires its transaction hash.");
  const rejected = result.outcome === "reverted-before-effects";
  if ((result.scenario === "successful-swap") === rejected) add("TRADE_DOMAIN_RECEIPT_INVALID", "$.outcome", "Successful scenarios must succeed and every negative scenario must revert before effects.");
  if (!tradePoolDeltasSettledV1(observation.finalPoolManagerDeltas, result.context.poolKey)) add("TRADE_POOL_MANAGER_DELTAS_UNSETTLED", "$.observation.finalPoolManagerDeltas", "Every trade result must finish with exact zero deltas for both PoolKey currencies.");
  if (rejected !== (observation.revertDataSha256 !== null)) add("TRADE_NEGATIVE_REVERT_BINDING_INVALID", "$.observation.revertDataSha256", "Rejected execution must expose nonzero revert data and successful execution must expose null.");
  if (rejected) {
    if (observation.receiptStatus !== "reverted-as-specified" || observation.approvalChanged || observation.fundsChangedBeforeExecution || observation.lockStateChanged || observation.applicationStateChanged) add("UNSUPPORTED_TRADE_MODE_EFFECTFUL", "$.observation", "A declared pre-effects rejection must leave approvals, funds, locks and application state unchanged.");
    if (observation.walletBalances.some(({ before, after }) => before !== after)) add("UNSUPPORTED_TRADE_MODE_EFFECTFUL", "$.observation.walletBalances", "Pre-effects rejection must preserve every observed wallet balance.");
    if (BigInt(observation.refundAmount) !== 0n || BigInt(observation.dustAmount) !== 0n) add("UNSUPPORTED_TRADE_MODE_EFFECTFUL", "$.observation", "Pre-effects rejection must not create refunds or router dust.");
  } else {
    if (observation.receiptStatus !== "success") add("TRADE_DOMAIN_RECEIPT_INVALID", "$.observation.receiptStatus", "Successful execution evidence requires a successful local receipt or call trace.");
    if (!tradeWalletReconciledV1(result)) add("TRADE_WALLET_RECONCILIATION_FAILED", "$.observation.walletBalances", "Successful evidence must reconcile the exact sender/input debit, recipient/output credit, native refund and unique PoolKey-currency balance rows.");
    if (BigInt(observation.dustAmount) !== 0n) add("TRADE_EXECUTION_DUST_UNRECONCILED", "$.observation.dustAmount", "Successful execution evidence must reconcile router or adapter dust to zero.");
  }
}

function validateResultBindings(result, manifest, test, add) {
  const context = result.context;
  const mode = manifest.capabilities.modeMatrix.find(({ id }) => id === test.modeRef);
  const expectedManifestSha = tradeCapabilityManifestSha256V1(manifest);
  for (const [observed, expected, pathValue, code] of [
    [result.identity.applicationId, manifest.applicationId, "$.identity.applicationId", "TRADE_DOMAIN_RECEIPT_BINDING_MISMATCH"],
    [result.identity.marketRef, manifest.marketRef, "$.identity.marketRef", "TRADE_DOMAIN_RECEIPT_BINDING_MISMATCH"],
    [result.identity.testId, test.id, "$.identity.testId", "TRADE_DOMAIN_RECEIPT_BINDING_MISMATCH"],
    [result.identity.commandId, test.commandId, "$.identity.commandId", "TRADE_DOMAIN_RECEIPT_BINDING_MISMATCH"],
    [context.manifestSha256, expectedManifestSha, "$.context.manifestSha256", "TRADE_DOMAIN_RECEIPT_BINDING_MISMATCH"],
    [context.sourceTestSha256, test.testSourceArtifact.sha256, "$.context.sourceTestSha256", "TRADE_DOMAIN_RECEIPT_BINDING_MISMATCH"],
    [context.chain.chainId, manifest.chain.chainId, "$.context.chain.chainId", "TRADE_CHAIN_CONTEXT_MISMATCH"],
    [context.chain.blockNumber, manifest.chain.referenceBlock.number, "$.context.chain.blockNumber", "TRADE_CHAIN_CONTEXT_MISMATCH"],
    [context.chain.blockHash, manifest.chain.referenceBlock.hash, "$.context.chain.blockHash", "TRADE_CHAIN_CONTEXT_MISMATCH"],
    [context.chain.blockTimestamp, manifest.chain.referenceBlock.timestamp, "$.context.chain.blockTimestamp", "TRADE_CHAIN_CONTEXT_MISMATCH"],
    [context.poolKeySha256, canonicalJsonSha256V2(manifest.poolKey), "$.context.poolKeySha256", "TRADE_POOL_KEY_PARITY_MISMATCH"]
  ]) if (observed !== expected) add(code, pathValue, "Trade result does not match its manifest/test binding.", { expected, observed });
  if (!sameCanonical(context.poolKey, manifest.poolKey)) add("TRADE_POOL_KEY_PARITY_MISMATCH", "$.context.poolKey", "Trade result PoolKey differs from its manifest.");
  if (!mode || !sameCanonical(context.mode, { id: mode.id, direction: mode.direction, amountMode: mode.amountMode, fundingProfileRef: mode.fundingProfileRef })) add("TRADE_EVIDENCE_MODE_UNDECLARED", "$.context.mode", "Trade result mode differs from its declaration.");
  const declarationFinding = tradeExecutionDeclarationFindingV1(result, test);
  if (declarationFinding !== null) add(declarationFinding, "$.scenario", "Execution result scenario, outcome and revert data must equal their exact declaration.");
  const route = manifest.route;
  const expectedRoute = {
    type: route.type,
    quoteTarget: route.type === "standard-uniswap-v4" ? route.quoter.address : route.adapter.address,
    executionTarget: route.router.address,
    quoteTargetRuntimeCodeKeccak256: route.type === "standard-uniswap-v4" ? route.quoter.runtimeCodeKeccak256 : route.adapter.runtimeCodeKeccak256,
    executionTargetRuntimeCodeKeccak256: route.router.runtimeCodeKeccak256,
    generationIdentitySha256: route.generationIdentitySha256,
    adapterInterfaceSchemaSha256: route.type === "canonical-programmable-adapter" ? PROGRAMMABLE_TRADE_EXECUTION_SCHEMA_SHA256_V1 : null
  };
  if (!sameCanonical(context.route, expectedRoute)) add("TRADE_ROUTE_TYPE_MISMATCH", "$.context.route", "Trade result route binding differs from its manifest.");
  const expectedHookData = {
    mode: route.hookData.mode,
    contractSha256: route.hookData.mode === "bound" ? route.hookData.contractSha256 : null,
    encoding: route.hookData.encoding,
    valueSha256: sha256HexBytes(route.hookData.example)
  };
  if (!sameCanonical(context.hookData, expectedHookData)) add("TRADE_HOOK_DATA_PARITY_MISMATCH", "$.context.hookData", "Trade result hookData bytes and contract differ from its manifest.");
  if (context.request.fundingProfileRef !== mode?.fundingProfileRef) add("ADAPTER_FUNDING_PROFILE_MISMATCH", "$.context.request.fundingProfileRef", "Trade request funding differs from its declared mode.");
  if (context.limits.slippageBps < manifest.slippage.minimumBps || context.limits.slippageBps > manifest.slippage.maximumBps) add("TRADE_SLIPPAGE_POLICY_INVALID", "$.context.limits.slippageBps", "Observed slippage must stay inside the manifest policy bounds.");
  const fee = manifest.feeBehavior.programmableFeeV2;
  const expectedFeeReceipt = fee.applicability === "applicable" ? fee.receiptSha256 : null;
  if (
    context.fee.feeBehaviorSha256 !== canonicalJsonSha256V2(manifest.feeBehavior)
    || context.fee.programmableFeeApplicability !== fee.applicability
    || context.fee.feeConformanceReceiptSha256 !== expectedFeeReceipt
  ) add("TRADE_FEE_RECONCILIATION_FAILED", "$.context.fee", "Trade result fee behavior differs from its manifest.");
  if (!tradeFeeEvidenceMatchesV1(result, manifest)) add("TRADE_FEE_RECONCILIATION_FAILED", "$.context.fee.amounts", "Fee evidence must bind the exact declared component set, quote currency, observed gross amount, component calculation, conservation equation and canonical digest.");
  for (const code of tradeCallEvidenceFindingsV1(result, manifest, test, mode)) add(code, "$.observation", "Trade call, deadline, state or rejected-subject evidence does not match its typed manifest context.");
}

function schemaFindings(value, schema, code) {
  return validateAgainstSchema(value, schema).map((entry) => finding(code, entry.path, `${entry.code}: ${entry.message}`, { schemaCode: entry.code }));
}

function validateCanonicalUint(value, pathValue, allowZero, add) {
  try {
    const parsed = BigInt(value);
    if ((!allowZero && parsed === 0n) || parsed > UINT256_MAX) add("TRADE_UINT256_OUT_OF_RANGE", pathValue, "Value is outside the canonical uint256 range.");
  } catch {
    add("TRADE_UINT256_OUT_OF_RANGE", pathValue, "Value is not a canonical uint256 decimal string.");
  }
}

function readSchema(name) {
  return parseBoundedStrictJsonBytes(fs.readFileSync(path.join(referencesDirectory, name)), { maxSourceBytes: 4 * 1024 * 1024, maxNodes: 250_000, maxDepth: 256, maxNumberCharacters: 1_024 });
}

function finding(code, pathValue, message, details = {}) {
  return { severity: "blocker", code, path: pathValue, message, details };
}

function findingAdder(findings) {
  return (code, pathValue, message, details = {}) => findings.push(finding(code, pathValue, message, details));
}

function sortFindings(findings) {
  return findings.sort((left, right) => `${left.code}:${left.path}`.localeCompare(`${right.code}:${right.path}`));
}

function sameCanonical(left, right) {
  return canonicalJsonSha256V2(left) === canonicalJsonSha256V2(right);
}

function sameSet(left, right) {
  return Array.isArray(left) && left.length === right.length && [...left].sort().every((value, index) => value === [...right].sort()[index]);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sha256Bytes(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function sha256HexBytes(value) {
  return sha256Bytes(Buffer.from(value.slice(2), "hex"));
}
