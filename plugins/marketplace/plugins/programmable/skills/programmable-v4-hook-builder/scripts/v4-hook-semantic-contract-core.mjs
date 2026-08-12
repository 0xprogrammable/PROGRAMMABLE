import { canonicalJsonSha256V2 } from "./canonical-json-core.mjs";

export const V4_HOOK_SEMANTIC_CONTRACT_VERSION = "1.0.0";

export const V4_SWAP_QUADRANTS = Object.freeze([
  "zero-for-one-exact-input",
  "zero-for-one-exact-output",
  "one-for-zero-exact-input",
  "one-for-zero-exact-output"
]);

const TRADE_ZERO_ADDRESS = `0x${"00".repeat(20)}`;
const TRADE_QUOTE_RESULT_BINDINGS = Object.freeze([
  "manifest-sha256", "pool-key", "hook-data", "direction-and-amount-mode", "sender-and-recipient",
  "chain-and-block", "quoter-or-adapter", "slippage", "fee-conformance", "quoted-amount"
]);
const TRADE_EXECUTION_RESULT_BINDINGS = Object.freeze([
  "manifest-sha256", "pool-key", "hook-data", "direction-and-amount-mode", "sender-and-recipient",
  "chain-and-block", "router-or-adapter-generation", "funding", "deadline", "slippage", "fee-conformance",
  "action-and-calldata", "receipt", "pool-manager-final-deltas", "wallet-final-balances", "refund-and-dust"
]);
const TRADE_FUNDING_CONTRACTS = Object.freeze({
  "native-value": Object.freeze({
    type: "native-value", owner: "transaction-sender", token: "pool-input-currency", amount: "msg-value",
    nonce: "not-applicable", expiration: "not-applicable", signatureDeadline: "not-applicable", recipient: "router", permit2Mode: "not-used", permit2Mechanism: null
  }),
  "permit2-allowance-transfer": Object.freeze({
    type: "permit2-allowance-transfer", owner: "transaction-sender", token: "pool-input-currency", amount: "exact-input-or-maximum-input",
    nonce: "permit2-allowance", expiration: "permit2-allowance", signatureDeadline: "execution-deadline-or-earlier", recipient: "router", permit2Mode: "used", permit2Mechanism: "allowance-transfer"
  }),
  "permit2-signature-transfer": Object.freeze({
    type: "permit2-signature-transfer", owner: "transaction-sender", token: "pool-input-currency", amount: "exact-input-or-maximum-input",
    nonce: "permit2-signature", expiration: "permit2-signature", signatureDeadline: "execution-deadline-or-earlier", recipient: "router", permit2Mode: "used", permit2Mechanism: "signature-transfer"
  }),
  "adapter-defined": Object.freeze({
    type: "adapter-defined", owner: "request-envelope", token: "request-envelope", amount: "request-envelope",
    nonce: "adapter-contract", expiration: "adapter-contract", signatureDeadline: "adapter-contract", recipient: "adapter", permit2Mode: "not-used", permit2Mechanism: null
  })
});

export function inspectTradeRouteModeV1({ routeType, routeTransport, poolKey, mode, funding }) {
  const adapter = routeType === "canonical-programmable-adapter";
  const standardFunding = !adapter || routeTransport === "uniswap-v4-universal-router";
  const inputCurrency = mode.direction === "zero-for-one" ? poolKey.currency0 : poolKey.currency1;
  const expectedType = standardFunding
    ? inputCurrency === TRADE_ZERO_ADDRESS
      ? "native-value"
      : ["permit2-allowance-transfer", "permit2-signature-transfer"].includes(funding.type) ? funding.type : "invalid"
    : "adapter-defined";
  const expected = TRADE_FUNDING_CONTRACTS[expectedType];
  const observed = {
    type: funding.type, owner: funding.owner, token: funding.token, amount: funding.amount, nonce: funding.nonce,
    expiration: funding.expiration, signatureDeadline: funding.signatureDeadline, recipient: funding.recipient,
    permit2Mode: funding.permit2.mode, permit2Mechanism: funding.permit2.mode === "used" ? funding.permit2.mechanism : null
  };
  const expectedQuoteEntrypoint = adapter ? "quote(bytes)" : `V4Quoter.${mode.amountMode === "exact-input" ? "quoteExactInputSingle" : "quoteExactOutputSingle"}`;
  return Object.freeze({
    entrypointsValid: mode.quoteEntrypoint === expectedQuoteEntrypoint && mode.executionEntrypoint === (adapter ? "buildExecution(bytes)->execute-returned-envelope" : "UniversalRouter.execute"),
    fundingValid: expected !== undefined && Object.entries(expected).every(([key, value]) => observed[key] === value) && (adapter || inputCurrency === TRADE_ZERO_ADDRESS || funding.type !== "native-value"),
    fundingErrorCode: !standardFunding ? "ADAPTER_FUNDING_PROFILE_MISMATCH" : inputCurrency === TRADE_ZERO_ADDRESS ? "NATIVE_FUNDING_RECONCILIATION_FAILED" : "PERMIT2_FLOW_UNPROVEN"
  });
}

export function tradeFundingSpenderV1(route) {
  return route.type === "standard-uniswap-v4" || route.transport !== null ? route.router.address : route.adapter.address;
}

export function tradeAdapterInterfaceDependencyMatchesV1(entries, schemaSha256) {
  const matches = entries.filter(({ role }) => role === "adapter-interface");
  return matches.length === 1
    && matches[0].resolvedIdentity === "programmable-trade-execution-v1"
    && matches[0].contentSha256 === schemaSha256;
}

export function tradeExpectedRouteTargetV1(route, kind) {
  if (kind === "quote") return route.type === "standard-uniswap-v4" ? route.quoter.address : route.adapter.address;
  return route.router.address;
}

export function tradeExpectedResultBindingsV1(kind, routeType, scenario) {
  if (kind === "quote") return TRADE_QUOTE_RESULT_BINDINGS;
  return [
    ...TRADE_EXECUTION_RESULT_BINDINGS,
    ...(routeType === "canonical-programmable-adapter" ? ["adapter-build-and-envelope-execution"] : []),
    ...(scenario === "unsupported-mode-pre-effects-revert" ? ["rejection-before-approval-funds-lock-or-state"] : [])
  ];
}

export function tradeExecutionTestDeclarationFindingV1(test) {
  const successful = test.scenario === "successful-swap";
  if (successful !== (test.expectedOutcome === "swap-succeeds")) return "TRADE_TEST_EXPECTED_OUTCOME_MISMATCH";
  return successful === (test.expectedRevertDataSha256 === null) ? null : "TRADE_NEGATIVE_REVERT_BINDING_INVALID";
}

export function tradeResultUintValuesValidV1(result) {
  const context = result.context;
  const values = [
    context.chain.chainId, context.chain.blockNumber, context.chain.blockTimestamp,
    context.request.amountSpecified, context.limits.deadline,
    ...context.fee.amounts.components.flatMap(({ baseAmount, amount }) => [baseAmount, amount]),
    ...context.fee.amounts.totalsByCurrency.map(({ amount }) => amount)
  ];
  if (result.contract === "trade-quote-test-result-v1") {
    values.push(result.observation.amountQuoted);
  } else {
    values.push(
      result.observation.gasUsed, result.observation.amountIn, result.observation.amountOut,
      result.observation.slippageGuardAmount, result.observation.refundAmount, result.observation.dustAmount,
      ...result.observation.walletBalances.flatMap(({ before, after }) => [before, after])
    );
    if (result.observation.callBinding.adapterExecution !== null) {
      values.push(result.observation.callBinding.adapterExecution.returnedValue, result.observation.callBinding.adapterExecution.returnedDeadline);
    }
  }
  return values.every(canonicalTradeUint256);
}

export function tradePoolDeltasSettledV1(deltas, poolKey) {
  const currencies = deltas.map(({ currency }) => currency).sort();
  return currencies.length === 2 && currencies[0] === [poolKey.currency0, poolKey.currency1].sort()[0] && currencies[1] === [poolKey.currency0, poolKey.currency1].sort()[1] && deltas.every(({ delta }) => BigInt(delta) === 0n);
}

export function tradeQuoteStateNeutralV1(result) {
  return result.observation.stateBeforeSha256 === result.observation.stateAfterSha256 && tradePoolDeltasSettledV1(result.observation.finalPoolManagerDeltas, result.context.poolKey);
}

export function tradeWalletReconciledV1(result) {
  const { observation, context } = result;
  const inputCurrency = context.mode.direction === "zero-for-one" ? context.poolKey.currency0 : context.poolKey.currency1;
  const outputCurrency = context.mode.direction === "zero-for-one" ? context.poolKey.currency1 : context.poolKey.currency0;
  const keys = observation.walletBalances.map(({ account, currency }) => `${account}:${currency}`);
  const inputRows = observation.walletBalances.filter(({ account, currency }) => account === context.request.sender && currency === inputCurrency);
  const outputRows = observation.walletBalances.filter(({ account, currency }) => account === context.request.recipient && currency === outputCurrency);
  const amountIn = BigInt(observation.amountIn);
  const amountOut = BigInt(observation.amountOut);
  const inputDebit = inputRows.length === 1 ? BigInt(inputRows[0].before) - BigInt(inputRows[0].after) : -1n;
  const outputCredit = outputRows.length === 1 ? BigInt(outputRows[0].after) - BigInt(outputRows[0].before) : -1n;
  const expectedRefund = inputCurrency === TRADE_ZERO_ADDRESS && context.mode.amountMode === "exact-output" ? BigInt(observation.slippageGuardAmount) - amountIn : 0n;
  return amountIn > 0n && amountOut > 0n && new Set(keys).size === keys.length
    && observation.walletBalances.every(({ currency }) => [context.poolKey.currency0, context.poolKey.currency1].includes(currency))
    && inputDebit === amountIn && outputCredit === amountOut && BigInt(observation.refundAmount) === expectedRefund;
}

export function tradeCallEvidenceFindingsV1(result, manifest, test, mode) {
  const findings = [];
  if (mode === undefined) return ["TRADE_EVIDENCE_MODE_UNDECLARED"];
  const quote = result.contract === "trade-quote-test-result-v1";
  const binding = result.observation.callBinding;
  const calldataSha256 = quote ? result.observation.callDataSha256 : result.observation.calldataSha256;
  const expected = {
    target: quote ? result.context.route.quoteTarget : result.context.route.executionTarget,
    entrypoint: quote ? mode.quoteEntrypoint : mode.executionEntrypoint,
    poolKeySha256: result.context.poolKeySha256,
    direction: mode.direction,
    amountMode: mode.amountMode,
    amountSpecified: result.context.request.amountSpecified,
    hookDataSha256: result.context.hookData.valueSha256,
    slippageBps: result.context.limits.slippageBps,
    deadline: result.context.limits.deadline,
    fundingProfileRef: mode.fundingProfileRef,
    feeBehaviorSha256: result.context.fee.feeBehaviorSha256,
    calldataSha256,
    reencodedCalldataSha256: calldataSha256
  };
  const executionExpected = quote ? {} : {
    slippageGuardAmount: result.observation.slippageGuardAmount,
    actionPlanSha256: result.observation.actionPlanSha256,
    fundingWitnessSha256: result.observation.fundingWitnessSha256,
    adapterExecution: binding.adapterExecution
  };
  if (!sameFlatRecord(binding, { ...expected, ...executionExpected })) findings.push("TRADE_CALLDATA_BINDING_MISMATCH");
  const timestamp = BigInt(result.context.chain.blockTimestamp);
  const deadline = BigInt(result.context.limits.deadline);
  const insideWindow = deadline > timestamp && deadline <= timestamp + BigInt(manifest.deadline.maximumWindowSeconds);
  const deadlineValid = result.scenario === "expired-deadline-revert" ? deadline <= timestamp : insideWindow;
  if (!deadlineValid) findings.push("TRADE_DEADLINE_POLICY_UNPROVEN");
  if (!quote && !tradeStateWitnessMatchesV1(result)) findings.push("TRADE_STATE_WITNESS_INVALID");
  if (!quote && result.outcome === "reverted-before-effects" && !tradeRejectedSubjectsObservedV1(result)) findings.push("TRADE_NEGATIVE_SUBJECT_EVIDENCE_INVALID");
  if (!quote && !tradeAdapterExecutionMatchesV1(result, manifest)) findings.push("CANONICAL_ADAPTER_EXECUTION_UNPROVEN");
  return findings;
}

export function tradeExecutionDeclarationFindingV1(result, test) {
  if (result.contract !== "trade-execution-test-result-v1") return null;
  if (result.scenario !== test.scenario) return "TRADE_DOMAIN_RECEIPT_BINDING_MISMATCH";
  const expectedOutcome = test.expectedOutcome === "swap-succeeds" ? "swap-succeeded" : "reverted-before-effects";
  if (result.outcome !== expectedOutcome) return "TRADE_DOMAIN_RECEIPT_BINDING_MISMATCH";
  return result.observation.revertDataSha256 === test.expectedRevertDataSha256 ? null : "TRADE_NEGATIVE_REVERT_BINDING_INVALID";
}

function tradeStateWitnessMatchesV1(result) {
  const witness = result.observation.stateWitness;
  const pairs = [
    ["approval", result.observation.approvalChanged],
    ["funding", result.observation.fundsChangedBeforeExecution],
    ["lock", result.observation.lockStateChanged],
    ["application", result.observation.applicationStateChanged]
  ];
  const booleanBindingsMatch = pairs.every(([prefix, changed]) => changed === (witness[`${prefix}BeforeSha256`] !== witness[`${prefix}AfterSha256`]));
  const rejected = result.outcome === "reverted-before-effects";
  const walletChanged = witness.walletBeforeSha256 !== witness.walletAfterSha256;
  return booleanBindingsMatch && (rejected
    ? pairs.every(([prefix]) => witness[`${prefix}BeforeSha256`] === witness[`${prefix}AfterSha256`]) && !walletChanged
    : walletChanged);
}

function tradeRejectedSubjectsObservedV1(result) {
  const { context, observation } = result;
  const inputCurrency = context.mode.direction === "zero-for-one" ? context.poolKey.currency0 : context.poolKey.currency1;
  const outputCurrency = context.mode.direction === "zero-for-one" ? context.poolKey.currency1 : context.poolKey.currency0;
  const keys = observation.walletBalances.map(({ account, currency }) => `${account}:${currency}`);
  const required = [`${context.request.sender}:${inputCurrency}`, `${context.request.recipient}:${outputCurrency}`];
  return new Set(keys).size === keys.length && required.every((key) => keys.includes(key)) && observation.walletBalances.every(({ before, after, currency }) => before === after && [context.poolKey.currency0, context.poolKey.currency1].includes(currency));
}

function tradeAdapterExecutionMatchesV1(result, manifest) {
  const adapterExecution = result.observation.callBinding.adapterExecution;
  if (manifest.route.type !== "canonical-programmable-adapter") return adapterExecution === null;
  if (adapterExecution === null) return false;
  const envelope = {
    target: adapterExecution.returnedTarget,
    value: adapterExecution.returnedValue,
    calldataSha256: adapterExecution.returnedCalldataSha256,
    deadline: adapterExecution.returnedDeadline
  };
  const transported = manifest.route.transport?.type === "uniswap-v4-universal-router";
  const inputCurrency = result.context.mode.direction === "zero-for-one" ? result.context.poolKey.currency0 : result.context.poolKey.currency1;
  const expectedValue = transported && inputCurrency === TRADE_ZERO_ADDRESS
    ? (result.context.mode.amountMode === "exact-input" ? result.context.request.amountSpecified : result.observation.slippageGuardAmount)
    : "0";
  return adapterExecution.buildTarget === manifest.route.adapter.address
    && adapterExecution.buildEntrypoint === "buildExecution(bytes)"
    && adapterExecution.returnedTarget === result.context.route.executionTarget
    && adapterExecution.returnedCalldataSha256 === result.observation.calldataSha256
    && adapterExecution.returnedDeadline === result.context.limits.deadline
    && (!transported || adapterExecution.returnedValue === expectedValue)
    && adapterExecution.returnedEnvelopeDigestContract === "sha256-canonical-json-target-value-calldataSha256-deadline"
    && adapterExecution.returnedEnvelopeSha256 === canonicalJsonSha256V2(envelope);
}

function sameFlatRecord(left, right) {
  return Object.keys(right).length === Object.keys(left).length && Object.entries(right).every(([key, value]) => left[key] === value);
}

function canonicalTradeUint256(value) {
  return typeof value === "string" && /^(?:0|[1-9][0-9]*)$/u.test(value) && BigInt(value) < 1n << 256n;
}

const PERMISSION_BITS = Object.freeze({
  beforeInitialize: 1n << 13n,
  afterInitialize: 1n << 12n,
  beforeAddLiquidity: 1n << 11n,
  afterAddLiquidity: 1n << 10n,
  beforeRemoveLiquidity: 1n << 9n,
  afterRemoveLiquidity: 1n << 8n,
  beforeSwap: 1n << 7n,
  afterSwap: 1n << 6n,
  beforeDonate: 1n << 5n,
  afterDonate: 1n << 4n,
  beforeSwapReturnDelta: 1n << 3n,
  afterSwapReturnDelta: 1n << 2n,
  afterAddLiquidityReturnDelta: 1n << 1n,
  afterRemoveLiquidityReturnDelta: 1n
});

const REQUIRED_TOP_LEVEL = Object.freeze([
  "contractVersion",
  "purpose",
  "poolManager",
  "poolIsolation",
  "identities",
  "hookData",
  "swapAccounting",
  "returnDelta",
  "reentrancy",
  "routing",
  "deployment",
  "evidence"
]);

const GROUP_KEYS = Object.freeze({
  poolManager: Object.freeze(["authentication", "binding", "address"]),
  poolIsolation: Object.freeze(["namespace", "crossPoolSubsidy", "crossPoolNetting"]),
  identities: Object.freeze(["msgSenderRole", "senderRole", "senderTreatedAsEndUser", "endUserAuthentication"]),
  hookData: Object.freeze(["mode", "versioned", "domainBound", "replayProtected", "malformedRejected", "witness"]),
  swapAccounting: Object.freeze([
    "supportedQuadrants",
    "rejectedQuadrants",
    "unsupportedRejectedBeforeEffects",
    "specifiedCurrencyDerived",
    "unspecifiedCurrencyDerived",
    "signsDerived",
    "partialFillPolicy",
    "unlockDeltasClose",
    "creditsBacked",
    "erc20Settlement",
    "rounding",
    "tinyAndExtremeValuesTested"
  ]),
  returnDelta: Object.freeze([
    "beforeSwapUsed",
    "afterSwapUsed",
    "afterAddLiquidityUsed",
    "afterRemoveLiquidityUsed",
    "backing",
    "noOpAnalyzed",
    "hardBounds",
    "deltaConservation",
    "justification"
  ]),
  reentrancy: Object.freeze(["guardModel", "nestedUnlocks", "crossFunctionAnalyzed", "externalCallOrderAnalyzed"]),
  routing: Object.freeze([
    "universalRouter",
    "v4Planner",
    "permit2",
    "nativeEth",
    "exactInput",
    "exactOutput",
    "singleHop",
    "multiHop",
    "perHopHookData",
    "quoteExecutionParity"
  ]),
  deployment: Object.freeze([
    "state",
    "creationCodeHash",
    "constructorArgsHash",
    "initcodeHash",
    "permissionMask",
    "hookMinerSaltRef",
    "hookMinerSaltSha256",
    "expectedAddress",
    "runtimeCodeHash",
    "poolManagerAddress"
  ]),
  evidence: Object.freeze(["unit", "negative", "fuzz", "invariant", "fork", "router", "deployment"])
});

const BOUNDED_SWAP_WITNESS_KEYS = Object.freeze([
  "encoding",
  "solidityType",
  "exactByteLength",
  "valueSemantics",
  "executionDeltaBinding",
  "identitySemantics",
  "authenticationSemantics",
  "replaySemantics"
]);

const RETURN_PERMISSION_FIELDS = Object.freeze({
  beforeSwapUsed: "beforeSwapReturnDelta",
  afterSwapUsed: "afterSwapReturnDelta",
  afterAddLiquidityUsed: "afterAddLiquidityReturnDelta",
  afterRemoveLiquidityUsed: "afterRemoveLiquidityReturnDelta"
});

const addressPattern = /^0x[0-9a-fA-F]{40}$/u;
const sha256Pattern = /^sha256:[0-9a-f]{64}$/u;
const maskPattern = /^0x[0-3][0-9a-fA-F]{3}$/u;

export function v4PermissionMask(permissions = {}) {
  return Object.entries(PERMISSION_BITS).reduce(
    (mask, [name, bit]) => permissions?.[name] === true ? mask | bit : mask,
    0n
  );
}

export function canonicalV4PermissionMask(permissions = {}) {
  return `0x${v4PermissionMask(permissions).toString(16).padStart(4, "0")}`;
}

/**
 * Validate the source-facing semantic contract for one Uniswap v4 hook.
 * Proposal gaps remain reviewable; prototype gaps block implementation
 * readiness. Explicitly unsafe claims block at either stage.
 */
export function validateV4HookSemanticContract(hook, { stage = "proposal", path = "$.hook" } = {}) {
  const findings = [];
  const seen = new Set();
  const incompleteSeverity = stage === "prototype" ? "blocker" : "review";
  const add = (severity, code, suffix, message, details = {}) => {
    const findingPath = `${path}${suffix}`;
    const key = `${severity}:${code}:${findingPath}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({ severity, code, path: findingPath, message, details });
  };
  const incomplete = (code, suffix, message, details = {}) => add(incompleteSeverity, code, suffix, message, {
    ...details,
    implementationAuthorization: "NOT_GRANTED"
  });

  const profile = hook?.profile;
  if (!isObject(profile)) {
    incomplete("V4_SEMANTIC_PROFILE_REQUIRED", ".profile", "Every Uniswap v4 hook needs a typed semantic profile; permissions alone do not describe a safe hook.");
    return findings;
  }
  rejectUnknownKeys(profile, REQUIRED_TOP_LEVEL, ".profile", add);
  for (const key of REQUIRED_TOP_LEVEL) {
    if (!Object.hasOwn(profile, key)) incomplete("V4_SEMANTIC_PROFILE_FIELD_MISSING", `.profile.${key}`, `The v4 semantic profile must declare ${key}.`);
  }
  if (profile.contractVersion !== V4_HOOK_SEMANTIC_CONTRACT_VERSION) {
    incomplete("V4_SEMANTIC_PROFILE_VERSION_INVALID", ".profile.contractVersion", `contractVersion must equal ${V4_HOOK_SEMANTIC_CONTRACT_VERSION}.`);
  }
  if (typeof profile.purpose !== "string" || profile.purpose.trim().length === 0) {
    incomplete("V4_SEMANTIC_PURPOSE_MISSING", ".profile.purpose", "The hook purpose must be explicit and non-empty.");
  }
  for (const [group, keys] of Object.entries(GROUP_KEYS)) validateClosedGroup(profile[group], group, keys, incomplete, add);

  const manager = profile.poolManager;
  requireExact(manager?.authentication, "exact-msg-sender", "V4_POOL_MANAGER_AUTH_UNPROVEN", ".profile.poolManager.authentication", "Every callback entry must authenticate msg.sender against the exact PoolManager.", incomplete, add);
  if (!["immutable-exact-address", "chain-profile-exact-address"].includes(manager?.binding)) {
    incomplete("V4_POOL_MANAGER_BINDING_UNRESOLVED", ".profile.poolManager.binding", "The PoolManager binding must be immutable or bound to one exact verified chain profile.");
  }
  if (!addressPattern.test(manager?.address ?? "")) incomplete("V4_POOL_MANAGER_ADDRESS_UNRESOLVED", ".profile.poolManager.address", "The v4 semantic contract must bind one exact PoolManager address.");

  const isolation = profile.poolIsolation;
  if (!["pool-id", "single-pool-instance"].includes(isolation?.namespace)) incomplete("V4_POOL_NAMESPACE_UNRESOLVED", ".profile.poolIsolation.namespace", "Shared state must be PoolId-namespaced or the hook must be provably single-pool.");
  requireSafeFalse(isolation?.crossPoolSubsidy, "V4_CROSS_POOL_SUBSIDY_FORBIDDEN", ".profile.poolIsolation.crossPoolSubsidy", "One pool must never subsidize another pool's liabilities.", incomplete, add);
  requireSafeFalse(isolation?.crossPoolNetting, "V4_CROSS_POOL_NETTING_UNPROVEN", ".profile.poolIsolation.crossPoolNetting", "Cross-pool netting is disabled unless a separate proven model is introduced.", incomplete, add);

  const identities = profile.identities;
  requireExact(identities?.msgSenderRole, "pool-manager", "V4_MSG_SENDER_ROLE_INVALID", ".profile.identities.msgSenderRole", "Inside a v4 callback msg.sender is the PoolManager.", incomplete, add);
  if (!["router-or-unlock-caller", "liquidity-actor", "donor-or-unlock-caller", "not-used"].includes(identities?.senderRole)) {
    incomplete("V4_CALLBACK_SENDER_ROLE_UNRESOLVED", ".profile.identities.senderRole", "The callback sender parameter needs an explicit role; it is not automatically the end user.");
  }
  requireSafeFalse(identities?.senderTreatedAsEndUser, "V4_CALLBACK_SENDER_AS_END_USER_FORBIDDEN", ".profile.identities.senderTreatedAsEndUser", "The callback sender parameter cannot be treated as authenticated end-user identity.", incomplete, add);
  if (!["not-used", "authenticated-versioned-hook-data", "trusted-router-binding"].includes(identities?.endUserAuthentication)) {
    incomplete("V4_END_USER_AUTH_MODEL_UNRESOLVED", ".profile.identities.endUserAuthentication", "Declare how end-user identity is authenticated, or declare that it is not used.");
  }

  validateHookData(profile.hookData, identities, profile.swapAccounting, incomplete, add);
  validateSwapAccounting(profile.swapAccounting, incomplete, add);
  validateReturnDelta(profile.returnDelta, hook?.permissions, profile.evidence, incomplete, add);
  validateReentrancy(profile.reentrancy, incomplete, add);
  validateRouting(profile.routing, stage, profile.evidence, incomplete, add);
  validateDeployment(profile.deployment, hook?.permissions, stage, profile.evidence, incomplete, add);
  validateEvidence(profile.evidence, stage, incomplete);

  return findings.sort((left, right) => left.severity.localeCompare(right.severity) || left.code.localeCompare(right.code) || left.path.localeCompare(right.path));
}

function validateHookData(hookData, identities, accounting, incomplete, add) {
  if (!["not-used", "versioned-authenticated", "bounded-swap-witness"].includes(hookData?.mode)) {
    incomplete("V4_HOOK_DATA_MODE_UNRESOLVED", ".profile.hookData.mode", "hookData must be explicitly unused, versioned and authenticated, or a bounded swap witness.");
    return;
  }
  if (hookData.mode !== "bounded-swap-witness") {
    requireExact(hookData?.witness, null, "V4_HOOK_DATA_WITNESS_CONFLICT", ".profile.hookData.witness", "Only bounded-swap-witness mode may declare a swap witness contract.", incomplete, add);
  }
  if (hookData.mode === "versioned-authenticated") {
    for (const [field, code] of [
      ["versioned", "V4_HOOK_DATA_VERSIONING_REQUIRED"],
      ["domainBound", "V4_HOOK_DATA_DOMAIN_BINDING_REQUIRED"],
      ["replayProtected", "V4_HOOK_DATA_REPLAY_PROTECTION_REQUIRED"],
      ["malformedRejected", "V4_HOOK_DATA_MALFORMED_REJECTION_REQUIRED"]
    ]) requireSafeTrue(hookData[field], code, `.profile.hookData.${field}`, `Authenticated hookData requires ${field}.`, incomplete, add);
    if (![
      "authenticated-versioned-hook-data",
      "trusted-router-binding"
    ].includes(identities?.endUserAuthentication)) add("blocker", "V4_HOOK_DATA_IDENTITY_BINDING_MISSING", ".profile.identities.endUserAuthentication", "Identity-bearing hookData must bind an authentication model.");
  } else if (hookData.mode === "not-used") {
    requireSafeTrue(hookData?.malformedRejected, "V4_HOOK_DATA_MALFORMED_REJECTION_REQUIRED", ".profile.hookData.malformedRejected", "Unused hookData still needs an explicit malformed/non-empty rejection policy.", incomplete, add);
  } else {
    const witness = hookData?.witness;
    validateClosedGroup(witness, "hookData.witness", BOUNDED_SWAP_WITNESS_KEYS, incomplete, add);
    for (const [field, expected, code] of [
      ["encoding", "abi-v2-static", "V4_SWAP_WITNESS_ENCODING_INVALID"],
      ["solidityType", "uint256", "V4_SWAP_WITNESS_TYPE_INVALID"],
      ["exactByteLength", 32, "V4_SWAP_WITNESS_BYTE_LENGTH_INVALID"],
      ["valueSemantics", "exact-output-gross-quote-witness", "V4_SWAP_WITNESS_VALUE_SEMANTICS_INVALID"],
      ["executionDeltaBinding", "gross-witness-and-fee-reconciled-to-executed-quote-delta", "V4_SWAP_WITNESS_DELTA_BINDING_INVALID"],
      ["identitySemantics", "none", "V4_SWAP_WITNESS_IDENTITY_SEMANTICS_FORBIDDEN"],
      ["authenticationSemantics", "none", "V4_SWAP_WITNESS_AUTHENTICATION_SEMANTICS_FORBIDDEN"],
      ["replaySemantics", "none", "V4_SWAP_WITNESS_REPLAY_SEMANTICS_FORBIDDEN"]
    ]) requireExact(witness?.[field], expected, code, `.profile.hookData.witness.${field}`, `Bounded swap witness ${field} must equal ${String(expected)}.`, incomplete, add);
    for (const [field, code] of [
      ["versioned", "V4_SWAP_WITNESS_VERSIONING_SEMANTICS_FORBIDDEN"],
      ["domainBound", "V4_SWAP_WITNESS_DOMAIN_SEMANTICS_FORBIDDEN"],
      ["replayProtected", "V4_SWAP_WITNESS_REPLAY_SEMANTICS_FORBIDDEN"]
    ]) requireSafeFalse(hookData?.[field], code, `.profile.hookData.${field}`, `Bounded swap witness ${field} must be false because this value is not an identity, authorization, domain or replay credential.`, incomplete, add);
    requireSafeTrue(hookData?.malformedRejected, "V4_HOOK_DATA_MALFORMED_REJECTION_REQUIRED", ".profile.hookData.malformedRejected", "Bounded swap witness must reject malformed or non-32-byte hookData.", incomplete, add);
    requireExact(identities?.endUserAuthentication, "not-used", "V4_SWAP_WITNESS_AUTHENTICATION_SEMANTICS_FORBIDDEN", ".profile.identities.endUserAuthentication", "A bounded swap witness carries no end-user identity or authentication semantics.", incomplete, add);
    requireExact(accounting?.partialFillPolicy, "rejected-before-effects", "V4_SWAP_WITNESS_PARTIAL_FILL_POLICY_REQUIRED", ".profile.swapAccounting.partialFillPolicy", "This gross-quote witness contract requires partial fills to revert before effects.", incomplete, add);
  }
}

function validateSwapAccounting(accounting, incomplete, add) {
  const supported = stringSet(accounting?.supportedQuadrants);
  const rejected = stringSet(accounting?.rejectedQuadrants);
  const overlap = [...supported].filter((value) => rejected.has(value));
  const unknown = [...supported, ...rejected].filter((value) => !V4_SWAP_QUADRANTS.includes(value));
  if (unknown.length > 0 || overlap.length > 0 || supported.size + rejected.size !== V4_SWAP_QUADRANTS.length) {
    incomplete("V4_SWAP_QUADRANT_MATRIX_INCOMPLETE", ".profile.swapAccounting", "All four direction/exactness quadrants must be supported or explicitly rejected with no overlap.", { unknown, overlap });
  }
  requireSafeTrue(accounting?.unsupportedRejectedBeforeEffects, "V4_UNSUPPORTED_SWAP_SIDE_EFFECT_GUARD_REQUIRED", ".profile.swapAccounting.unsupportedRejectedBeforeEffects", "Unsupported quadrants must revert before effects.", incomplete, add);
  for (const [field, code] of [
    ["specifiedCurrencyDerived", "V4_SPECIFIED_CURRENCY_DERIVATION_REQUIRED"],
    ["unspecifiedCurrencyDerived", "V4_UNSPECIFIED_CURRENCY_DERIVATION_REQUIRED"],
    ["signsDerived", "V4_DELTA_SIGN_DERIVATION_REQUIRED"],
    ["unlockDeltasClose", "V4_UNLOCK_DELTA_CLOSURE_REQUIRED"],
    ["creditsBacked", "V4_CREDIT_BACKING_REQUIRED"],
    ["tinyAndExtremeValuesTested", "V4_BOUNDARY_VALUE_COVERAGE_REQUIRED"]
  ]) requireSafeTrue(accounting?.[field], code, `.profile.swapAccounting.${field}`, `Swap accounting requires ${field}.`, incomplete, add);
  if (!["supported-and-tested", "rejected-before-effects"].includes(accounting?.partialFillPolicy)) incomplete("V4_PARTIAL_FILL_POLICY_UNRESOLVED", ".profile.swapAccounting.partialFillPolicy", "Partial-fill behavior must be supported and tested or rejected before effects.");
  if (!["sync-transfer-settle", "periphery-delta-router", "native-settle", "not-applicable"].includes(accounting?.erc20Settlement)) incomplete("V4_SETTLEMENT_SEQUENCE_UNRESOLVED", ".profile.swapAccounting.erc20Settlement", "Declare the exact ERC-20/native settlement sequence and actor model.");
  if (!["explicit-bounded", "exact-no-rounding"].includes(accounting?.rounding)) incomplete("V4_ROUNDING_MODEL_UNRESOLVED", ".profile.swapAccounting.rounding", "Rounding direction and dust bounds must be explicit.");
}

function validateReturnDelta(returnDelta, permissions, evidence, incomplete, add) {
  let anyReturnDelta = false;
  for (const [profileField, permissionField] of Object.entries(RETURN_PERMISSION_FIELDS)) {
    const expected = permissions?.[permissionField];
    const observed = returnDelta?.[profileField];
    if (typeof expected === "boolean" && observed !== expected) add("blocker", "V4_RETURN_DELTA_PROFILE_PERMISSION_MISMATCH", `.profile.returnDelta.${profileField}`, `${profileField} must exactly match permissions.${permissionField}.`, { permissionField, expected, observed });
    anyReturnDelta ||= expected === true;
  }
  if (anyReturnDelta) {
    if (!["hook-owned-assets", "erc6909-claims", "vault-assets", "custom-proven"].includes(returnDelta?.backing)) incomplete("V4_RETURN_DELTA_BACKING_UNRESOLVED", ".profile.returnDelta.backing", "Every active return delta needs a concrete backing model.");
    for (const [field, code] of [
      ["noOpAnalyzed", "V4_RETURN_DELTA_NOOP_ANALYSIS_REQUIRED"],
      ["hardBounds", "V4_RETURN_DELTA_HARD_BOUNDS_REQUIRED"],
      ["deltaConservation", "V4_RETURN_DELTA_CONSERVATION_REQUIRED"]
    ]) requireSafeTrue(returnDelta?.[field], code, `.profile.returnDelta.${field}`, `Active return deltas require ${field}.`, incomplete, add);
    if (typeof returnDelta?.justification !== "string" || returnDelta.justification.trim().length === 0) incomplete("V4_RETURN_DELTA_JUSTIFICATION_REQUIRED", ".profile.returnDelta.justification", "Return deltas are opt-in and need a product-specific justification.");
    for (const category of ["fuzz", "invariant", "fork"]) if (!hasEvidence(evidence?.[category])) incomplete("V4_RETURN_DELTA_EVIDENCE_REQUIRED", `.profile.evidence.${category}`, `Active return deltas require ${category} evidence.`, { category });
  } else {
    requireExact(returnDelta?.backing, "not-applicable", "V4_RETURN_DELTA_BACKING_CONFLICT", ".profile.returnDelta.backing", "A hook with no return-delta permission must declare backing not-applicable.", incomplete, add);
  }
}

function validateReentrancy(reentrancy, incomplete, add) {
  if (!["pool-manager-lock-aware", "transient-guard", "state-machine", "checks-effects-interactions"].includes(reentrancy?.guardModel)) incomplete("V4_REENTRANCY_MODEL_UNRESOLVED", ".profile.reentrancy.guardModel", "Declare a concrete reentrancy and callback-order model.");
  if (!["rejected", "proven-safe", "not-applicable"].includes(reentrancy?.nestedUnlocks)) incomplete("V4_NESTED_UNLOCK_MODEL_UNRESOLVED", ".profile.reentrancy.nestedUnlocks", "Nested unlock behavior must be rejected, proven safe, or inapplicable.");
  requireSafeTrue(reentrancy?.crossFunctionAnalyzed, "V4_CROSS_FUNCTION_REENTRANCY_REVIEW_REQUIRED", ".profile.reentrancy.crossFunctionAnalyzed", "Cross-function reentrancy requires analysis.", incomplete, add);
  requireSafeTrue(reentrancy?.externalCallOrderAnalyzed, "V4_EXTERNAL_CALL_ORDER_REVIEW_REQUIRED", ".profile.reentrancy.externalCallOrderAnalyzed", "External call ordering requires analysis.", incomplete, add);
}

function validateRouting(routing, stage, evidence, incomplete, add) {
  for (const field of GROUP_KEYS.routing) requireSafeTrue(routing?.[field], "V4_ROUTING_SURFACE_UNPROVEN", `.profile.routing.${field}`, `Canonical app-layer readiness requires ${field} coverage.`, incomplete, add);
  if (stage === "prototype" && !hasEvidence(evidence?.router)) incomplete("V4_ROUTER_EVIDENCE_REQUIRED", ".profile.evidence.router", "Prototype v4 hooks require executable Universal Router/V4Planner/Permit2 evidence.");
}

function validateDeployment(deployment, permissions, stage, evidence, incomplete, add) {
  if (!isObject(deployment)) return;
  if (deployment.state !== "preimage-bound") incomplete("V4_DEPLOYMENT_PREIMAGE_UNRESOLVED", ".profile.deployment.state", "Hook deployment must bind the final creation code, constructor arguments, salt, address, runtime hash, permissions and PoolManager.");
  for (const field of ["creationCodeHash", "constructorArgsHash", "initcodeHash", "runtimeCodeHash"]) if (!sha256Pattern.test(deployment[field] ?? "")) incomplete("V4_DEPLOYMENT_HASH_UNRESOLVED", `.profile.deployment.${field}`, `${field} must be one exact SHA-256 artifact binding.`, { field });
  if (typeof deployment?.hookMinerSaltRef !== "string" || deployment.hookMinerSaltRef.length === 0) incomplete("V4_HOOK_MINER_SALT_UNRESOLVED", ".profile.deployment.hookMinerSaltRef", "HookMiner salt must be preserved in one exact referenced deployment artifact.");
  if (!sha256Pattern.test(deployment?.hookMinerSaltSha256 ?? "")) incomplete("V4_HOOK_MINER_SALT_UNRESOLVED", ".profile.deployment.hookMinerSaltSha256", "HookMiner salt bytes must have one exact SHA-256 binding.");
  if (!addressPattern.test(deployment?.expectedAddress ?? "")) incomplete("V4_EXPECTED_HOOK_ADDRESS_UNRESOLVED", ".profile.deployment.expectedAddress", "The expected CREATE2 hook address must be exact.");
  if (!addressPattern.test(deployment?.poolManagerAddress ?? "")) incomplete("V4_DEPLOYMENT_POOL_MANAGER_UNRESOLVED", ".profile.deployment.poolManagerAddress", "Deployment evidence must bind the exact PoolManager.");
  const expectedMask = canonicalV4PermissionMask(permissions);
  if (!maskPattern.test(deployment?.permissionMask ?? "") || deployment.permissionMask.toLowerCase() !== expectedMask) add("blocker", "V4_PERMISSION_MASK_MISMATCH", ".profile.deployment.permissionMask", "The declared permission mask does not match all 14 permission booleans.", { expectedMask, observedMask: deployment?.permissionMask ?? null });
  if (addressPattern.test(deployment?.expectedAddress ?? "")) {
    const lowMask = BigInt(deployment.expectedAddress) & ((1n << 14n) - 1n);
    if (lowMask !== v4PermissionMask(permissions)) add("blocker", "V4_HOOK_ADDRESS_PERMISSION_MISMATCH", ".profile.deployment.expectedAddress", "The expected hook address low bits do not match the declared permissions.", { expectedMask, expectedAddress: deployment.expectedAddress });
  }
  if (stage === "prototype" && !hasEvidence(evidence?.deployment)) incomplete("V4_DEPLOYMENT_EVIDENCE_REQUIRED", ".profile.evidence.deployment", "Prototype v4 hooks require executable CREATE2, runtime hash, permission and PoolManager binding evidence.");
}

function validateEvidence(evidence, stage, incomplete) {
  if (!isObject(evidence)) return;
  for (const category of GROUP_KEYS.evidence) {
    if (!Array.isArray(evidence[category]) || evidence[category].some((ref) => typeof ref !== "string" || ref.length === 0)) incomplete("V4_EVIDENCE_REFS_INVALID", `.profile.evidence.${category}`, `${category} evidence must be an array of non-empty references.`, { category });
  }
  if (stage === "prototype") for (const category of ["unit", "negative", "fuzz", "invariant"]) if (!hasEvidence(evidence[category])) incomplete("V4_IMPLEMENTATION_EVIDENCE_REQUIRED", `.profile.evidence.${category}`, `Prototype v4 hooks require ${category} evidence.`, { category });
}

function validateClosedGroup(value, group, keys, incomplete, add) {
  if (!isObject(value)) {
    incomplete("V4_SEMANTIC_GROUP_MISSING", `.profile.${group}`, `The v4 semantic profile requires a closed ${group} group.`);
    return;
  }
  rejectUnknownKeys(value, keys, `.profile.${group}`, add);
  for (const key of keys) if (!Object.hasOwn(value, key)) incomplete("V4_SEMANTIC_GROUP_FIELD_MISSING", `.profile.${group}.${key}`, `${group}.${key} is required.`);
}

function rejectUnknownKeys(value, keys, suffix, add) {
  if (!isObject(value)) return;
  const allowed = new Set(keys);
  for (const key of Object.keys(value)) if (!allowed.has(key)) add("blocker", "V4_SEMANTIC_UNKNOWN_FIELD", `${suffix}.${key}`, "Unknown fields are forbidden in the versioned v4 semantic contract.", { key });
}

function requireSafeTrue(value, code, suffix, message, incomplete, add) {
  if (value === true) return;
  if (value === false) add("blocker", code, suffix, message);
  else incomplete(code, suffix, message);
}

function requireSafeFalse(value, code, suffix, message, incomplete, add) {
  if (value === false) return;
  if (value === true) add("blocker", code, suffix, message);
  else incomplete(code, suffix, message);
}

function requireExact(value, expected, code, suffix, message, incomplete, add) {
  if (value === expected) return;
  if (value === null || value === undefined) incomplete(code, suffix, message);
  else add("blocker", code, suffix, message, { expected, observed: value });
}

function stringSet(value) {
  return new Set(Array.isArray(value) ? value.filter((entry) => typeof entry === "string") : []);
}

function hasEvidence(value) {
  return Array.isArray(value) && value.some((entry) => typeof entry === "string" && entry.length > 0);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
