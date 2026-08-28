import { isDeepStrictEqual } from "node:util";

import {
  decodeFunctionData,
  decodeFunctionResult,
  encodeFunctionData,
  getAddress,
  isAddress,
  isHex,
  keccak256,
  parseAbi,
  toHex,
} from "viem";

import {
  CLASSIC_V4_DIGEST_DOMAINS,
  CLASSIC_V4_LIFECYCLE_ACTIONS,
  digestJson,
  expectedLifecycleLaunchCalldata,
  expectedLifecycleSwapCalldata,
  normalizeHex,
  validateClassicV4LaunchAuthorization,
} from "./classic-v4-release-core.mjs";

export const CLASSIC_V4_EXECUTION_JOURNAL_SCHEMA =
  "programmable.classic-v4.lifecycle-execution-journal.v1";
export const CLASSIC_V4_PREPARED_ACTION_SCHEMA =
  "programmable.classic-v4.lifecycle-prepared-action.v1";
export const CLASSIC_V4_TRANSACTION_OUTPUT_SCHEMA =
  "programmable.classic-v4.lifecycle-transactions.v1";
export const CLASSIC_V4_PERMIT2_EXPIRATION_SECONDS = 900n;
export const CLASSIC_V4_AUTHORIZATION_SAFETY_SECONDS = 75n;
export const CLASSIC_V4_UINT160_MAX = (1n << 160n) - 1n;
export const CLASSIC_V4_UINT48_MAX = (1n << 48n) - 1n;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const UINT256_MAX = (1n << 256n) - 1n;
const MAXIMUM_JOURNAL_CLOCK_LEAD_MS = 15_000;
const EXECUTION_JOURNAL_GENESIS_KIND =
  "programmable.classic-v4.lifecycle-execution-journal-genesis.v1";
const PREPARED_REQUIRED_FIELDS = Object.freeze([
  "schemaVersion",
  "planDigest",
  "action",
  "requiredAction",
  "auxiliary",
  "label",
  "requiredAccount",
  "request",
  "maximumGasDebit",
  "preparedAtBlock",
  "preparedAtBlockHash",
  "preparedDigest",
]);
const PREPARED_OPTIONAL_FIELDS = Object.freeze([
  "quote",
  "swap",
  "allowance",
  "authorization",
]);
const AUXILIARY_ACTIONS = Object.freeze([
  "tokenApproval:sellExactInput",
  "permit2Approval:sellExactInput",
  "tokenApproval:sellExactOutput",
  "permit2Approval:sellExactOutput",
]);
const AUXILIARY_LABELS = Object.freeze({
  tokenApproval: "Approve the canary token for Permit2",
  permit2Approval: "Approve the Universal Router in Permit2",
});

export const classicV4ExecutionTokenAbi = parseAbi([
  "function allowance(address owner,address spender) view returns (uint256)",
  "function approve(address spender,uint256 amount) returns (bool)",
]);
export const classicV4ExecutionPermit2Abi = parseAbi([
  "function allowance(address owner,address token,address spender) view returns (uint160 amount,uint48 expiration,uint48 nonce)",
  "function approve(address token,address spender,uint160 amount,uint48 expiration)",
]);
export const classicV4ExecutionQuoterAbi = parseAbi([
  "function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountOut,uint256 gasEstimate)",
  "function quoteExactOutputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountIn,uint256 gasEstimate)",
]);
export const classicV4ExecutionRewardVaultAbi = parseAbi([
  "function claim() returns (uint256 amount)",
  "function claimable(address beneficiary) view returns (uint256 amount)",
]);
export const classicV4ExecutionHookAbi = parseAbi([
  "function launcherFeesAccrued() view returns (uint256 amount)",
  "function claimLauncherFees() returns (uint256 amount)",
]);
const classicV4ExecutionUniversalRouterAbi = parseAbi([
  "function execute(bytes commands,bytes[] inputs,uint256 deadline) payable",
]);

const SWAP_ACTIONS = Object.freeze({
  buyExactInput: Object.freeze({ side: "buy", exactness: "exact-input" }),
  buyExactOutput: Object.freeze({ side: "buy", exactness: "exact-output" }),
  sellExactInput: Object.freeze({ side: "sell", exactness: "exact-input" }),
  sellExactOutput: Object.freeze({ side: "sell", exactness: "exact-output" }),
});

const ACTION_LABELS = Object.freeze({
  launch: "Launch the Router stamped canary",
  buyExactInput: "Buy with an exact ETH input",
  buyExactOutput: "Buy an exact token output",
  sellExactInput: "Sell an exact token input",
  sellExactOutput: "Sell for an exact ETH output",
  creatorClaim: "Claim the creator reward",
  launcherClaim: "Claim the launcher reward",
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function exactRecord(value, keys, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} is invalid`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  assert(
    actual.length === expected.length &&
      actual.every((key, index) => key === expected[index]),
    `${label} fields differ`,
  );
  return value;
}

function canonicalAddress(value, label) {
  assert(typeof value === "string" && isAddress(value), `${label} is invalid`);
  const result = getAddress(value);
  assert(result !== ZERO_ADDRESS, `${label} is zero`);
  return result;
}

function decimal(value, label, { positive = false } = {}) {
  assert(
    typeof value === "string" && /^(?:0|[1-9][0-9]*)$/u.test(value),
    `${label} is invalid`,
  );
  const parsed = BigInt(value);
  assert(!positive || parsed > 0n, `${label} is zero`);
  return parsed;
}

function hash(value, label) {
  assert(
    typeof value === "string" &&
      isHex(value, { strict: true }) &&
      value.length === 66 &&
      BigInt(value) !== 0n,
    `${label} is invalid`,
  );
  return value.toLowerCase();
}

function transactionHash(value) {
  return hash(value, "Transaction hash");
}

function clone(value) {
  return structuredClone(value);
}

function isoTimestamp(value, label) {
  assert(typeof value === "string", `${label} is invalid`);
  const date = new Date(value);
  assert(
    !Number.isNaN(date.valueOf()) && date.toISOString() === value,
    `${label} is invalid`,
  );
  return value;
}

function timestampMilliseconds(value, label) {
  isoTimestamp(value, label);
  return new Date(value).valueOf();
}

function mutationTimestamp(journal, now, label) {
  assert(now instanceof Date && !Number.isNaN(now.valueOf()), `${label} is invalid`);
  const timestamp = now.toISOString();
  assert(
    new Date(timestamp).valueOf() > new Date(journal.updatedAt).valueOf(),
    `${label} does not follow the journal update time`,
  );
  return timestamp;
}

function historyEventDigest(event) {
  const { eventDigest, ...value } = event;
  void eventDigest;
  return digestJson(value, CLASSIC_V4_DIGEST_DOMAINS.generic);
}

function journalGenesisDigest(journal) {
  return digestJson({
    kind: EXECUTION_JOURNAL_GENESIS_KIND,
    schemaVersion: journal.schemaVersion,
    planDigest: journal.planDigest,
    launchAuthorizationDigest: journal.launchAuthorizationDigest,
    releaseBindingDigest: journal.releaseBindingDigest,
    operatorWallet: journal.operatorWallet,
    treasury: journal.treasury,
    createdAt: journal.createdAt,
  }, CLASSIC_V4_DIGEST_DOMAINS.generic);
}

function currentArmEventDigest(journal) {
  const event = journal.history.findLast((candidate) =>
    candidate.kind === "armed" &&
    candidate.preparedDigest === journal.armed?.preparedDigest
  );
  assert(event, "Execution journal arm event is missing");
  return event.eventDigest;
}

function appendJournalHistory(journal, event, now, label) {
  const at = mutationTimestamp(journal, now, label);
  const value = {
    sequence: journal.history.length,
    ...event,
    at,
    previousDigest: journal.history.at(-1)?.eventDigest ?? journal.genesisDigest,
  };
  journal.history.push({
    ...value,
    eventDigest: historyEventDigest(value),
  });
  journal.updatedAt = at;
  return at;
}

function quantity(value, label, { positive = false } = {}) {
  assert(
    typeof value === "string" && /^0x(?:0|[1-9a-f][0-9a-f]*)$/u.test(value),
    `${label} is invalid`,
  );
  const parsed = BigInt(value);
  assert(parsed <= UINT256_MAX, `${label} exceeds uint256`);
  assert(!positive || parsed > 0n, `${label} is zero`);
  return parsed;
}

function validatePreparedAction(canaryPlan, candidate) {
  assert(candidate && typeof candidate === "object" && !Array.isArray(candidate), "Prepared action is invalid");
  const actualKeys = Object.keys(candidate);
  assert(
    PREPARED_REQUIRED_FIELDS.every((key) => actualKeys.includes(key)) &&
      actualKeys.every((key) =>
        PREPARED_REQUIRED_FIELDS.includes(key) ||
        PREPARED_OPTIONAL_FIELDS.includes(key)
      ),
    "Prepared action fields differ",
  );
  assert(candidate.schemaVersion === CLASSIC_V4_PREPARED_ACTION_SCHEMA, "Prepared action schema differs");
  assert(
    hash(candidate.planDigest, "Prepared plan digest") ===
      hash(canaryPlan.planDigest, "Canary plan digest"),
    "Prepared action plan differs",
  );
  assert(CLASSIC_V4_LIFECYCLE_ACTIONS.includes(candidate.requiredAction), "Prepared required action is invalid");
  assert(typeof candidate.auxiliary === "boolean", "Prepared auxiliary flag is invalid");
  const expectedAccount = candidate.requiredAction === "launcherClaim"
    ? canonicalAddress(canaryPlan.treasury, "Plan treasury")
    : canonicalAddress(canaryPlan.operatorWallet, "Plan operator");
  assert(
    canonicalAddress(candidate.requiredAccount, "Prepared account") === expectedAccount,
    "Prepared action account differs",
  );
  if (candidate.auxiliary) {
    assert(
      ["sellExactInput", "sellExactOutput"].includes(candidate.requiredAction) &&
        AUXILIARY_ACTIONS.includes(candidate.action) &&
        candidate.action.endsWith(`:${candidate.requiredAction}`),
      "Prepared auxiliary action differs",
    );
  } else {
    assert(candidate.action === candidate.requiredAction, "Prepared lifecycle action differs");
  }
  const expectedLabel = candidate.auxiliary
    ? AUXILIARY_LABELS[candidate.action.split(":", 1)[0]]
    : ACTION_LABELS[candidate.action];
  assert(
    candidate.label === expectedLabel,
    "Prepared action label differs",
  );
  const request = exactRecord(candidate.request, [
    "from",
    "to",
    "value",
    "data",
    "nonce",
    "gas",
    "maxFeePerGas",
    "maxPriorityFeePerGas",
  ], "Prepared request");
  assert(
    canonicalAddress(request.from, "Prepared request sender") === expectedAccount,
    "Prepared request sender differs",
  );
  canonicalAddress(request.to, "Prepared request target");
  assert(
    typeof request.data === "string" &&
      isHex(request.data, { strict: true }) &&
      request.data.length >= 10,
    "Prepared calldata is invalid",
  );
  const value = quantity(request.value, "Prepared value");
  quantity(request.nonce, "Prepared nonce");
  const gas = quantity(request.gas, "Prepared gas", { positive: true });
  const maxFee = quantity(request.maxFeePerGas, "Prepared max fee", { positive: true });
  const priorityFee = quantity(request.maxPriorityFeePerGas, "Prepared priority fee", { positive: true });
  assert(priorityFee <= maxFee, "Prepared fee envelope is invalid");
  const maximumDebit = decimal(candidate.maximumGasDebit, "Prepared maximum debit", {
    positive: true,
  });
  assert(maximumDebit === gas * maxFee + value, "Prepared maximum debit differs");
  assert(
    Number.isSafeInteger(candidate.preparedAtBlock) && candidate.preparedAtBlock > 0,
    "Prepared block is invalid",
  );
  assert(
    candidate.preparedAtBlockHash === hash(
      candidate.preparedAtBlockHash,
      "Prepared block hash",
    ),
    "Prepared block hash is not canonical",
  );
  assert(
    candidate.preparedDigest === hash(candidate.preparedDigest, "Prepared digest"),
    "Prepared digest is not canonical",
  );
  for (const key of PREPARED_OPTIONAL_FIELDS) {
    if (Object.hasOwn(candidate, key)) {
      assert(candidate[key] && typeof candidate[key] === "object" && !Array.isArray(candidate[key]), `Prepared ${key} is invalid`);
    }
  }
  const { preparedDigest, ...digestValue } = candidate;
  assert(
    normalizeHex(preparedDigest) === normalizeHex(
      digestJson(digestValue, CLASSIC_V4_DIGEST_DOMAINS.generic),
    ),
    "Prepared digest differs",
  );
  validatePreparedActionBinding(canaryPlan, candidate, {
    request,
    value,
    gas,
  });
  validatePreparedActionRole(canaryPlan, candidate);
  return candidate;
}

function preparedOptionalFields(candidate) {
  return PREPARED_OPTIONAL_FIELDS.filter((key) => Object.hasOwn(candidate, key));
}

function requirePreparedOptionalFields(candidate, expected) {
  assert(
    isDeepStrictEqual(
      preparedOptionalFields(candidate).toSorted(),
      [...expected].toSorted(),
    ),
    "Prepared action binding fields differ",
  );
}

function decodePreparedCall(abi, request, expectedFunction) {
  let decoded;
  try {
    decoded = decodeFunctionData({ abi, data: request.data });
  } catch {
    throw new Error(`Prepared ${expectedFunction} calldata differs`);
  }
  assert(
    decoded.functionName === expectedFunction,
    `Prepared ${expectedFunction} calldata differs`,
  );
  return decoded.args;
}

function validatePreparedActionBinding(canaryPlan, candidate, envelope) {
  const { request, value, gas } = envelope;
  if (candidate.action === "launch") {
    requirePreparedOptionalFields(candidate, ["authorization"]);
    const authorization = exactRecord(candidate.authorization, [
      "digest",
      "validAfter",
      "deadline",
      "gasLimit",
    ], "Prepared authorization");
    assert(
      hash(authorization.digest, "Prepared authorization digest") ===
        hash(canaryPlan.launchAuthorizationDigest, "Canary authorization digest"),
      "Prepared authorization digest differs",
    );
    const validAfter = decimal(
      authorization.validAfter,
      "Prepared authorization valid-after",
    );
    const deadline = decimal(
      authorization.deadline,
      "Prepared authorization deadline",
      { positive: true },
    );
    const authorizationGas = decimal(
      authorization.gasLimit,
      "Prepared authorization gas",
      { positive: true },
    );
    assert(
      validAfter <= deadline && deadline - validAfter <= 330n,
      "Prepared authorization window differs",
    );
    assert(gas === authorizationGas, "Prepared launch gas differs");
    const installed = canaryPlan.launchAuthorization;
    assert(installed?.transaction, "Canary launch authorization is missing");
    assert(
      authorization.validAfter === installed.validAfter &&
        authorization.deadline === installed.deadline &&
        authorization.gasLimit === installed.transaction.gasLimit &&
        canonicalAddress(request.from, "Prepared launch sender") ===
          canonicalAddress(installed.transaction.from, "Authorized launch sender") &&
        canonicalAddress(request.to, "Prepared launch target") ===
          canonicalAddress(installed.transaction.to, "Authorized launch target") &&
        value === BigInt(installed.transaction.valueWei) &&
        normalizeHex(request.data) === normalizeHex(installed.transaction.calldata),
      "Prepared launch request differs from its authorization",
    );
    return;
  }

  if (SWAP_ACTIONS[candidate.action]) {
    requirePreparedOptionalFields(candidate, ["quote", "swap"]);
    validatePreparedSwapBinding(canaryPlan, candidate, request, value);
    return;
  }

  if (candidate.auxiliary) {
    requirePreparedOptionalFields(candidate, ["allowance"]);
    validatePreparedAllowanceBinding(canaryPlan, candidate, request, value);
    return;
  }

  requirePreparedOptionalFields(candidate, []);
  assert(value === 0n, "Prepared claim value differs");
  if (candidate.action === "creatorClaim") {
    decodePreparedCall(classicV4ExecutionRewardVaultAbi, request, "claim");
    return;
  }
  assert(candidate.action === "launcherClaim", "Prepared claim action differs");
  assert(
    canonicalAddress(request.to, "Prepared launcher claim target") ===
      canonicalAddress(canaryPlan.feeHook, "Canary fee hook"),
    "Prepared launcher claim target differs",
  );
  decodePreparedCall(
    classicV4ExecutionHookAbi,
    request,
    "claimLauncherFees",
  );
}

function validatePreparedSwapBinding(canaryPlan, candidate, request, value) {
  const expected = classicV4SwapIdentity(candidate.action);
  const quote = exactRecord(candidate.quote, [
    "policy",
    "function",
    "blockNumber",
    "blockHash",
    "blockTimestamp",
    "exactAmount",
    "quotedAmount",
    "gasEstimate",
    "slippageBps",
    "bound",
  ], "Prepared quote");
  const swap = exactRecord(candidate.swap, [
    "side",
    "exactness",
    "inputBound",
    "outputBound",
    "routerDeadline",
  ], "Prepared swap");
  const exactInput = expected.exactness === "exact-input";
  const fixture = canaryPlan.swapFixture[candidate.action];
  const expectedExactAmount = decimal(
    exactInput ? fixture.amountIn : fixture.amountOut,
    "Canary exact amount",
    { positive: true },
  );
  const exactAmount = decimal(quote.exactAmount, "Prepared quote exact amount", {
    positive: true,
  });
  const quotedAmount = decimal(
    quote.quotedAmount,
    "Prepared quote amount",
    { positive: true },
  );
  const gasEstimate = decimal(
    quote.gasEstimate,
    "Prepared quote gas estimate",
    { positive: true },
  );
  void gasEstimate;
  const bound = decimal(quote.bound, "Prepared quote bound", { positive: true });
  const blockTimestamp = decimal(
    quote.blockTimestamp,
    "Prepared quote block timestamp",
    { positive: true },
  );
  assert(
    quote.policy === canaryPlan.swapFixture.quotePolicy &&
      quote.function === `V4Quoter.${
        exactInput ? "quoteExactInputSingle" : "quoteExactOutputSingle"
      }` &&
      Number.isSafeInteger(quote.blockNumber) &&
      quote.blockNumber > 0 &&
      quote.blockNumber === candidate.preparedAtBlock &&
      quote.blockHash === hash(quote.blockHash, "Prepared quote block hash") &&
      quote.blockHash === candidate.preparedAtBlockHash &&
      Number.isSafeInteger(quote.slippageBps) &&
      quote.slippageBps === canaryPlan.swapFixture.slippageBps &&
      exactAmount === expectedExactAmount &&
      bound === classicV4QuoteBound(expected.exactness, quotedAmount),
    "Prepared quote binding differs",
  );
  const inputBound = decimal(swap.inputBound, "Prepared swap input", {
    positive: true,
  });
  const outputBound = decimal(swap.outputBound, "Prepared swap output", {
    positive: true,
  });
  const routerDeadline = decimal(
    swap.routerDeadline,
    "Prepared swap deadline",
    { positive: true },
  );
  assert(
    swap.side === expected.side &&
      swap.exactness === expected.exactness &&
      inputBound === (exactInput ? exactAmount : bound) &&
      outputBound === (exactInput ? bound : exactAmount) &&
      routerDeadline ===
        blockTimestamp + BigInt(canaryPlan.swapFixture.deadlineSeconds),
    "Prepared swap binding differs",
  );
  assert(
    canonicalAddress(request.to, "Prepared swap target") ===
      canonicalAddress(canaryPlan.dependencies.universalRouter, "Universal Router") &&
      value === (expected.side === "buy" ? inputBound : 0n),
    "Prepared swap request differs",
  );
  const routerArgs = decodePreparedCall(
    classicV4ExecutionUniversalRouterAbi,
    request,
    "execute",
  );
  const expectedCommands = candidate.action === "buyExactOutput"
    ? "0x1004"
    : "0x10";
  assert(
    routerArgs[0] === expectedCommands &&
      Array.isArray(routerArgs[1]) &&
      routerArgs[1].length === (expectedCommands === "0x1004" ? 2 : 1) &&
      BigInt(routerArgs[2]) === routerDeadline,
    "Prepared Universal Router envelope differs",
  );
}

function validatePreparedAllowanceBinding(canaryPlan, candidate, request, value) {
  assert(value === 0n, "Prepared approval value differs");
  const tokenApproval = candidate.action.startsWith("tokenApproval:");
  const expectedKind = tokenApproval ? "erc20" : "permit2";
  const expectedFields = tokenApproval
    ? ["kind", "requiredAmount"]
    : ["kind", "requiredAmount", "expiration"];
  const allowance = exactRecord(
    candidate.allowance,
    expectedFields,
    "Prepared allowance",
  );
  const requiredAmount = decimal(
    allowance.requiredAmount,
    "Prepared allowance amount",
    { positive: true },
  );
  assert(allowance.kind === expectedKind, "Prepared allowance kind differs");
  if (tokenApproval) {
    const approvalArgs = decodePreparedCall(
      classicV4ExecutionTokenAbi,
      request,
      "approve",
    );
    assert(
      canonicalAddress(approvalArgs[0], "Prepared Permit2 spender") ===
        canonicalAddress(canaryPlan.dependencies.permit2, "Permit2") &&
        BigInt(approvalArgs[1]) === requiredAmount,
      "Prepared token approval differs",
    );
    return;
  }
  assert(
    requiredAmount <= CLASSIC_V4_UINT160_MAX,
    "Prepared Permit2 amount exceeds uint160",
  );
  const expiration = decimal(
    allowance.expiration,
    "Prepared Permit2 expiration",
    { positive: true },
  );
  assert(
    expiration <= CLASSIC_V4_UINT48_MAX &&
      canonicalAddress(request.to, "Prepared Permit2 target") ===
        canonicalAddress(canaryPlan.dependencies.permit2, "Permit2"),
    "Prepared Permit2 envelope differs",
  );
  const approvalArgs = decodePreparedCall(
    classicV4ExecutionPermit2Abi,
    request,
    "approve",
  );
  assert(
    canonicalAddress(approvalArgs[0], "Prepared Permit2 token") !== ZERO_ADDRESS &&
      canonicalAddress(approvalArgs[1], "Prepared Router spender") ===
        canonicalAddress(canaryPlan.dependencies.universalRouter, "Universal Router") &&
      BigInt(approvalArgs[2]) === requiredAmount &&
      BigInt(approvalArgs[3]) === expiration,
    "Prepared Permit2 approval differs",
  );
}

function validatePreparedActionRole(canaryPlan, candidate) {
  assert(
    Array.isArray(canaryPlan.actions) &&
      isDeepStrictEqual(
        canaryPlan.actions.map((entry) => entry?.key),
        CLASSIC_V4_LIFECYCLE_ACTIONS,
      ),
    "Canary lifecycle action roles differ",
  );
  const role = canaryPlan.actions.find(
    (entry) => entry.key === candidate.requiredAction,
  );
  assert(
    role?.requiresWalletSignature === true &&
      canonicalAddress(role.requiredSigner, "Canary action signer") ===
        canonicalAddress(candidate.requiredAccount, "Prepared account"),
    "Prepared action role differs from the canary plan",
  );
}

export function validateClassicV4PreparedAction(
  canaryPlan,
  candidate,
  identity,
) {
  const prepared = validatePreparedAction(canaryPlan, candidate);
  validatePreparedActionRole(canaryPlan, prepared);
  const token = canonicalAddress(identity?.token, "Canary token");
  const rewardVault = canonicalAddress(
    identity?.rewardVault,
    "Canary reward vault",
  );

  if (SWAP_ACTIONS[prepared.action]) {
    const expected = expectedLifecycleSwapCalldata(
      canaryPlan,
      token,
      prepared.swap.side,
      prepared.swap.exactness,
      prepared.swap,
    );
    assert(
      normalizeHex(prepared.request.data) === normalizeHex(expected),
      "Prepared swap calldata differs from the canary identity",
    );
  } else if (prepared.action.startsWith("tokenApproval:")) {
    assert(
      canonicalAddress(prepared.request.to, "Prepared token approval target") ===
        token,
      "Prepared token approval target differs from the canary token",
    );
  } else if (prepared.action.startsWith("permit2Approval:")) {
    const approvalArgs = decodePreparedCall(
      classicV4ExecutionPermit2Abi,
      prepared.request,
      "approve",
    );
    assert(
      canonicalAddress(approvalArgs[0], "Prepared Permit2 token") === token,
      "Prepared Permit2 token differs from the canary token",
    );
  } else if (prepared.action === "creatorClaim") {
    assert(
      canonicalAddress(prepared.request.to, "Prepared creator claim target") ===
        rewardVault,
      "Prepared creator claim target differs from the canary reward vault",
    );
  }
  return prepared;
}

function validateJournalRecord(
  canaryPlan,
  key,
  candidate,
  auxiliary,
  { createdAtMs, updatedAtMs, nowMs },
) {
  const submittedKeys = ["status", "hash", "prepared", "submittedAt"];
  const confirmedKeys = [
    ...submittedKeys,
    "blockNumber",
    "blockHash",
    "confirmedAt",
  ];
  assert(candidate && typeof candidate === "object" && !Array.isArray(candidate), "Journal transaction is invalid");
  exactRecord(
    candidate,
    candidate.status === "confirmed" ? confirmedKeys : submittedKeys,
    "Journal transaction",
  );
  assert(["submitted", "confirmed"].includes(candidate.status), "Journal transaction status is invalid");
  assert(
    candidate.hash === transactionHash(candidate.hash),
    "Journal transaction hash is not canonical",
  );
  const submittedAtMs = timestampMilliseconds(
    candidate.submittedAt,
    "Journal submission time",
  );
  assert(
    submittedAtMs >= createdAtMs &&
      submittedAtMs <= updatedAtMs &&
      submittedAtMs <= nowMs + MAXIMUM_JOURNAL_CLOCK_LEAD_MS,
    "Journal submission time is outside the journal lifetime",
  );
  validatePreparedAction(canaryPlan, candidate.prepared);
  assert(candidate.prepared.action === key, "Journal transaction action differs");
  assert(candidate.prepared.auxiliary === auxiliary, "Journal transaction kind differs");
  let confirmedAtMs = null;
  if (candidate.status === "confirmed") {
    assert(Number.isSafeInteger(candidate.blockNumber) && candidate.blockNumber > 0, "Journal receipt block is invalid");
    assert(
      candidate.blockHash === hash(candidate.blockHash, "Journal receipt block hash"),
      "Journal receipt block hash is not canonical",
    );
    confirmedAtMs = timestampMilliseconds(
      candidate.confirmedAt,
      "Journal confirmation time",
    );
    assert(
      confirmedAtMs >= submittedAtMs &&
        confirmedAtMs <= updatedAtMs &&
        confirmedAtMs <= nowMs + MAXIMUM_JOURNAL_CLOCK_LEAD_MS,
      "Journal confirmation time is outside the transaction lifetime",
    );
  }
  return Object.freeze({ candidate, submittedAtMs, confirmedAtMs });
}

function validateJournalHistory(canaryPlan, journal, context) {
  const { createdAtMs, updatedAtMs, nowMs } = context;
  assert(Array.isArray(journal.history), "Execution journal history is invalid");
  let previousDigest = journal.genesisDigest;
  let previousAtMs = createdAtMs;
  let armed = null;
  let blocked = null;
  const records = new Map();

  for (const [sequence, event] of journal.history.entries()) {
    assert(event && typeof event === "object" && !Array.isArray(event), "Execution journal history event is invalid");
    const common = [
      "sequence",
      "kind",
      "at",
      "previousDigest",
      "eventDigest",
    ];
    const actionFields = [
      "action",
      "requiredAction",
      "auxiliary",
      "preparedDigest",
    ];
    const expectedFields = event.kind === "armed"
      ? [...common, ...actionFields, "prepared"]
      : event.kind === "discarded"
        ? [...common, ...actionFields, "armEventDigest"]
      : event.kind === "submitted"
        ? [
            ...common,
            ...actionFields,
            "armEventDigest",
            "transactionHash",
          ]
        : event.kind === "confirmed"
          ? [
              ...common,
              ...actionFields,
              "armEventDigest",
              "transactionHash",
              "blockNumber",
              "blockHash",
            ]
          : event.kind === "blocked"
            ? [...common, "reason"]
            : [];
    assert(expectedFields.length > 0, "Execution journal history kind is invalid");
    exactRecord(event, expectedFields, "Execution journal history event");
    assert(event.sequence === sequence, "Execution journal history sequence differs");
    assert(
      event.previousDigest === hash(event.previousDigest, "History previous digest") &&
        event.previousDigest === previousDigest,
      "Execution journal history chain differs",
    );
    assert(
      event.eventDigest === hash(event.eventDigest, "History event digest") &&
        event.eventDigest === historyEventDigest(event),
      "Execution journal history digest differs",
    );
    const atMs = timestampMilliseconds(event.at, "Execution journal history time");
    assert(
      atMs > previousAtMs &&
        atMs <= updatedAtMs &&
        atMs <= nowMs + MAXIMUM_JOURNAL_CLOCK_LEAD_MS,
      "Execution journal history time differs",
    );
    previousAtMs = atMs;
    previousDigest = event.eventDigest;

    if (event.kind === "blocked") {
      assert(
        blocked === null &&
          typeof event.reason === "string" &&
          event.reason.length > 0 &&
          event.reason.length <= 500,
        "Execution journal block history differs",
      );
      blocked = event.reason;
      continue;
    }
    assert(blocked === null, "Execution journal history continues after blocking");
    assert(
      CLASSIC_V4_LIFECYCLE_ACTIONS.includes(event.requiredAction) &&
        typeof event.auxiliary === "boolean" &&
        event.preparedDigest === hash(event.preparedDigest, "History prepared digest"),
      "Execution journal history action is invalid",
    );
    if (event.auxiliary) {
      assert(
        AUXILIARY_ACTIONS.includes(event.action) &&
          event.action.endsWith(`:${event.requiredAction}`),
        "Execution journal auxiliary history differs",
      );
    } else {
      assert(
        event.action === event.requiredAction,
        "Execution journal required history differs",
      );
    }
    const identity = {
      action: event.action,
      requiredAction: event.requiredAction,
      auxiliary: event.auxiliary,
      preparedDigest: event.preparedDigest,
    };
    if (event.kind === "armed") {
      assert(armed === null, "Execution journal history arms two actions");
      const prepared = validatePreparedAction(canaryPlan, event.prepared);
      assert(
        prepared.action === event.action &&
          prepared.requiredAction === event.requiredAction &&
          prepared.auxiliary === event.auxiliary &&
          prepared.preparedDigest === event.preparedDigest,
        "Execution journal armed history differs from its prepared request",
      );
      armed = {
        ...identity,
        prepared,
        armEventDigest: event.eventDigest,
        submittedHash: null,
      };
      continue;
    }
    assert(
      armed &&
        armed.action === event.action &&
        armed.preparedDigest === event.preparedDigest &&
        event.armEventDigest === armed.armEventDigest,
      "Execution journal history action differs from its arm event",
    );
    if (event.kind === "discarded") {
      assert(
        armed.submittedHash === null,
        "Execution journal history discards a submitted transaction",
      );
      armed = null;
      continue;
    }
    const submittedHash = transactionHash(event.transactionHash);
    assert(
      submittedHash === event.transactionHash,
      "Execution journal history transaction hash is not canonical",
    );
    if (event.kind === "submitted") {
      assert(
        armed.submittedHash === null && !records.has(event.action),
        "Execution journal history resubmits an action",
      );
      armed.submittedHash = submittedHash;
      records.set(event.action, {
        ...identity,
        prepared: armed.prepared,
        status: "submitted",
        hash: submittedHash,
        submittedAt: event.at,
      });
      continue;
    }
    const record = records.get(event.action);
    assert(
      armed.submittedHash === submittedHash &&
        record?.status === "submitted" &&
        record.hash === submittedHash &&
        Number.isSafeInteger(event.blockNumber) &&
        event.blockNumber > 0 &&
        event.blockHash === hash(event.blockHash, "History block hash"),
      "Execution journal confirmation history differs",
    );
    Object.assign(record, {
      status: "confirmed",
      blockNumber: event.blockNumber,
      blockHash: event.blockHash,
      confirmedAt: event.at,
    });
    armed = null;
  }
  assert(
    updatedAtMs === previousAtMs,
    "Execution journal update time differs from its history",
  );
  return Object.freeze({ armed, blocked, records });
}

export function classicV4LifecycleActionLabel(action) {
  assert(ACTION_LABELS[action], "Classic V4 lifecycle action is invalid");
  return ACTION_LABELS[action];
}

export function classicV4SwapIdentity(action) {
  const identity = SWAP_ACTIONS[action];
  assert(identity, "Classic V4 swap action is invalid");
  return identity;
}

export function resolveClassicV4LifecycleIdentity(canaryPlan) {
  const proof = validateClassicV4LaunchAuthorization(
    canaryPlan,
    canaryPlan?.launchAuthorization,
  );
  const result = proof.route.expectedResult;
  return Object.freeze({
    token: canonicalAddress(result.token, "Canary token"),
    rewardVault: canonicalAddress(result.rewardVault, "Canary reward vault"),
    positionRecipient: canonicalAddress(
      result.positionRecipient,
      "Canary position recipient",
    ),
    positionTokenId: result.positionTokenId.toString(),
    poolId: hash(result.poolId, "Canary pool id"),
    launchId: hash(proof.stampRequest.launchId, "Canary launch id"),
    stampHash: hash(
      canaryPlan.launchAuthorization.simulation.stampHash,
      "Canary stamp hash",
    ),
  });
}

export function classicV4PoolKey(canaryPlan, identity) {
  return Object.freeze({
    currency0: ZERO_ADDRESS,
    currency1: canonicalAddress(identity.token, "Canary token"),
    fee: 0,
    tickSpacing: 200,
    hooks: canonicalAddress(canaryPlan.feeHook, "Classic V4 fee hook"),
  });
}

export function buildClassicV4QuoteCall(canaryPlan, identity, action) {
  const swap = classicV4SwapIdentity(action);
  const fixture = canaryPlan.swapFixture[action];
  assert(fixture && typeof fixture === "object", "Classic V4 swap fixture is missing");
  const exactInput = swap.exactness === "exact-input";
  const exactAmount = decimal(
    exactInput ? fixture.amountIn : fixture.amountOut,
    `${action} exact amount`,
    { positive: true },
  );
  assert(exactAmount < 1n << 128n, `${action} exact amount exceeds uint128`);
  const functionName = exactInput
    ? "quoteExactInputSingle"
    : "quoteExactOutputSingle";
  const params = {
    poolKey: classicV4PoolKey(canaryPlan, identity),
    zeroForOne: swap.side === "buy",
    exactAmount,
    hookData: "0x",
  };
  return Object.freeze({
    action,
    side: swap.side,
    exactness: swap.exactness,
    exactAmount: exactAmount.toString(),
    functionName,
    to: canonicalAddress(canaryPlan.dependencies.v4Quoter, "V4Quoter"),
    data: encodeFunctionData({
      abi: classicV4ExecutionQuoterAbi,
      functionName,
      args: [params],
    }),
  });
}

export function decodeClassicV4Quote(functionName, value) {
  const [quotedAmount, gasEstimate] = decodeFunctionResult({
    abi: classicV4ExecutionQuoterAbi,
    functionName,
    data: value,
  });
  assert(quotedAmount > 0n, "V4Quoter returned a zero amount");
  assert(gasEstimate > 0n, "V4Quoter returned a zero gas estimate");
  return Object.freeze({ quotedAmount, gasEstimate });
}

export function classicV4QuoteBound(exactness, quotedAmount) {
  const quote = BigInt(quotedAmount);
  assert(quote > 0n, "Classic V4 quote is zero");
  const bound = exactness === "exact-input"
    ? (quote * 9_900n) / 10_000n
    : exactness === "exact-output"
      ? (quote * 10_100n + 9_999n) / 10_000n
      : 0n;
  assert(bound > 0n, "Classic V4 quote bound is zero");
  return bound;
}

export function buildClassicV4SwapPrepared({
  canaryPlan,
  identity,
  action,
  quotedAmount,
  quoteGasEstimate,
  quoteBlockNumber,
  quoteBlockHash,
  quoteBlockTimestamp,
}) {
  const swap = classicV4SwapIdentity(action);
  const fixture = canaryPlan.swapFixture[action];
  const exactInput = swap.exactness === "exact-input";
  const exactAmount = decimal(
    exactInput ? fixture.amountIn : fixture.amountOut,
    `${action} exact amount`,
    { positive: true },
  );
  const bound = classicV4QuoteBound(swap.exactness, quotedAmount);
  if (!exactInput) {
    assert(
      bound <= decimal(fixture.hardMaximumAmountIn, `${action} hard maximum`, {
        positive: true,
      }),
      `${action} exceeds its hard maximum input`,
    );
  }
  const inputBound = exactInput ? exactAmount : bound;
  const outputBound = exactInput ? bound : exactAmount;
  const routerDeadline = BigInt(quoteBlockTimestamp) +
    BigInt(canaryPlan.swapFixture.deadlineSeconds);
  const swapBinding = Object.freeze({
    inputBound: inputBound.toString(),
    outputBound: outputBound.toString(),
    routerDeadline: routerDeadline.toString(),
  });
  const data = expectedLifecycleSwapCalldata(
    canaryPlan,
    identity.token,
    swap.side,
    swap.exactness,
    swapBinding,
  );
  return Object.freeze({
    action,
    requiredAction: action,
    label: classicV4LifecycleActionLabel(action),
    requiredAccount: canaryPlan.operatorWallet,
    request: Object.freeze({
      from: canaryPlan.operatorWallet,
      to: canaryPlan.dependencies.universalRouter,
      value: toHex(swap.side === "buy" ? inputBound : 0n),
      data,
    }),
    quote: Object.freeze({
      policy: canaryPlan.swapFixture.quotePolicy,
      function: `V4Quoter.${exactInput ? "quoteExactInputSingle" : "quoteExactOutputSingle"}`,
      blockNumber: Number(quoteBlockNumber),
      blockHash: hash(quoteBlockHash, "Quote block hash"),
      blockTimestamp: BigInt(quoteBlockTimestamp).toString(),
      exactAmount: exactAmount.toString(),
      quotedAmount: BigInt(quotedAmount).toString(),
      gasEstimate: BigInt(quoteGasEstimate).toString(),
      slippageBps: canaryPlan.swapFixture.slippageBps,
      bound: bound.toString(),
    }),
    swap: Object.freeze({
      side: swap.side,
      exactness: swap.exactness,
      ...swapBinding,
    }),
  });
}

export function buildClassicV4LaunchPrepared(canaryPlan) {
  const transaction = canaryPlan.launchAuthorization.transaction;
  assert(
    normalizeHex(transaction.calldata) ===
      normalizeHex(expectedLifecycleLaunchCalldata(canaryPlan)),
    "Classic V4 launch calldata differs from the canary plan",
  );
  return Object.freeze({
    action: "launch",
    requiredAction: "launch",
    label: classicV4LifecycleActionLabel("launch"),
    requiredAccount: canaryPlan.operatorWallet,
    request: Object.freeze({
      from: transaction.from,
      to: transaction.to,
      value: toHex(BigInt(transaction.valueWei)),
      data: transaction.calldata,
    }),
    authorization: Object.freeze({
      digest: canaryPlan.launchAuthorizationDigest,
      validAfter: canaryPlan.launchAuthorization.validAfter,
      deadline: canaryPlan.launchAuthorization.deadline,
      gasLimit: transaction.gasLimit,
    }),
  });
}

export function buildClassicV4TokenApprovalPrepared({
  canaryPlan,
  identity,
  requiredAction,
  amount,
}) {
  assert(SWAP_ACTIONS[requiredAction]?.side === "sell", "Token approval is not for a sell");
  const required = BigInt(amount);
  assert(required > 0n, "Token approval amount is zero");
  return Object.freeze({
    action: `tokenApproval:${requiredAction}`,
    requiredAction,
    auxiliary: true,
    label: "Approve the canary token for Permit2",
    requiredAccount: canaryPlan.operatorWallet,
    request: Object.freeze({
      from: canaryPlan.operatorWallet,
      to: identity.token,
      value: "0x0",
      data: encodeFunctionData({
        abi: classicV4ExecutionTokenAbi,
        functionName: "approve",
        args: [canaryPlan.dependencies.permit2, required],
      }),
    }),
    allowance: Object.freeze({ kind: "erc20", requiredAmount: required.toString() }),
  });
}

export function buildClassicV4Permit2ApprovalPrepared({
  canaryPlan,
  identity,
  requiredAction,
  amount,
  blockTimestamp,
}) {
  assert(SWAP_ACTIONS[requiredAction]?.side === "sell", "Permit2 approval is not for a sell");
  const required = BigInt(amount);
  const expiration = BigInt(blockTimestamp) + CLASSIC_V4_PERMIT2_EXPIRATION_SECONDS;
  assert(
    required > 0n && required <= CLASSIC_V4_UINT160_MAX,
    "Permit2 approval amount is invalid",
  );
  assert(expiration <= CLASSIC_V4_UINT48_MAX, "Permit2 expiration is invalid");
  return Object.freeze({
    action: `permit2Approval:${requiredAction}`,
    requiredAction,
    auxiliary: true,
    label: "Approve the Universal Router in Permit2",
    requiredAccount: canaryPlan.operatorWallet,
    request: Object.freeze({
      from: canaryPlan.operatorWallet,
      to: canaryPlan.dependencies.permit2,
      value: "0x0",
      data: encodeFunctionData({
        abi: classicV4ExecutionPermit2Abi,
        functionName: "approve",
        args: [identity.token, canaryPlan.dependencies.universalRouter, required, Number(expiration)],
      }),
    }),
    allowance: Object.freeze({
      kind: "permit2",
      requiredAmount: required.toString(),
      expiration: expiration.toString(),
    }),
  });
}

export function buildClassicV4CreatorClaimPrepared(canaryPlan, identity) {
  return Object.freeze({
    action: "creatorClaim",
    requiredAction: "creatorClaim",
    label: classicV4LifecycleActionLabel("creatorClaim"),
    requiredAccount: canaryPlan.operatorWallet,
    request: Object.freeze({
      from: canaryPlan.operatorWallet,
      to: identity.rewardVault,
      value: "0x0",
      data: encodeFunctionData({
        abi: classicV4ExecutionRewardVaultAbi,
        functionName: "claim",
      }),
    }),
  });
}

export function buildClassicV4LauncherClaimPrepared(canaryPlan) {
  return Object.freeze({
    action: "launcherClaim",
    requiredAction: "launcherClaim",
    label: classicV4LifecycleActionLabel("launcherClaim"),
    requiredAccount: canaryPlan.treasury,
    request: Object.freeze({
      from: canaryPlan.treasury,
      to: canaryPlan.feeHook,
      value: "0x0",
      data: encodeFunctionData({
        abi: classicV4ExecutionHookAbi,
        functionName: "claimLauncherFees",
      }),
    }),
  });
}

export function createClassicV4ExecutionJournal(canaryPlan, now = new Date()) {
  hash(canaryPlan.planDigest, "Canary plan digest");
  hash(canaryPlan.launchAuthorizationDigest, "Launch authorization digest");
  hash(canaryPlan.releaseBindingDigest, "Release binding digest");
  assert(
    now instanceof Date && !Number.isNaN(now.valueOf()),
    "Execution journal creation time is invalid",
  );
  const timestamp = now.toISOString();
  const journal = {
    schemaVersion: CLASSIC_V4_EXECUTION_JOURNAL_SCHEMA,
    planDigest: canaryPlan.planDigest.toLowerCase(),
    launchAuthorizationDigest: canaryPlan.launchAuthorizationDigest.toLowerCase(),
    releaseBindingDigest: canaryPlan.releaseBindingDigest.toLowerCase(),
    operatorWallet: canonicalAddress(canaryPlan.operatorWallet, "Operator wallet"),
    treasury: canonicalAddress(canaryPlan.treasury, "Treasury"),
    genesisDigest: null,
    requiredTransactions: {},
    auxiliaryTransactions: {},
    armed: null,
    blocked: null,
    history: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  journal.genesisDigest = journalGenesisDigest(journal);
  return validateClassicV4ExecutionJournal(canaryPlan, journal, now);
}

export function validateClassicV4ExecutionJournal(
  canaryPlan,
  value,
  now = new Date(),
) {
  assert(
    now instanceof Date && !Number.isNaN(now.valueOf()),
    "Execution journal validation time is invalid",
  );
  const journal = exactRecord(value, [
    "schemaVersion",
    "planDigest",
    "launchAuthorizationDigest",
    "releaseBindingDigest",
    "operatorWallet",
    "treasury",
    "genesisDigest",
    "requiredTransactions",
    "auxiliaryTransactions",
    "armed",
    "blocked",
    "history",
    "createdAt",
    "updatedAt",
  ], "Execution journal");
  assert(journal.schemaVersion === CLASSIC_V4_EXECUTION_JOURNAL_SCHEMA, "Execution journal schema differs");
  assert(
    journal.planDigest === hash(journal.planDigest, "Execution journal plan digest") &&
      journal.planDigest === hash(canaryPlan.planDigest, "Canary plan digest"),
    "Execution journal plan differs",
  );
  assert(
    journal.launchAuthorizationDigest === hash(
      journal.launchAuthorizationDigest,
      "Execution journal authorization digest",
    ) &&
      journal.launchAuthorizationDigest === hash(
        canaryPlan.launchAuthorizationDigest,
        "Canary authorization digest",
      ),
    "Execution journal authorization differs",
  );
  assert(
    journal.releaseBindingDigest === hash(
      journal.releaseBindingDigest,
      "Execution journal release digest",
    ) &&
      journal.releaseBindingDigest === hash(
        canaryPlan.releaseBindingDigest,
        "Canary release digest",
      ),
    "Execution journal release differs",
  );
  assert(
    canonicalAddress(journal.operatorWallet, "Journal operator") ===
      canonicalAddress(canaryPlan.operatorWallet, "Plan operator") &&
      canonicalAddress(journal.treasury, "Journal treasury") ===
        canonicalAddress(canaryPlan.treasury, "Plan treasury"),
    "Execution journal wallets differ",
  );
  assert(
    journal.requiredTransactions && typeof journal.requiredTransactions === "object" &&
      !Array.isArray(journal.requiredTransactions) &&
      journal.auxiliaryTransactions && typeof journal.auxiliaryTransactions === "object" &&
      !Array.isArray(journal.auxiliaryTransactions),
    "Execution journal transactions are invalid",
  );
  const createdAtMs = timestampMilliseconds(
    journal.createdAt,
    "Execution journal creation time",
  );
  const updatedAtMs = timestampMilliseconds(
    journal.updatedAt,
    "Execution journal update time",
  );
  const nowMs = now.valueOf();
  assert(
    updatedAtMs >= createdAtMs &&
      createdAtMs <= nowMs + MAXIMUM_JOURNAL_CLOCK_LEAD_MS &&
      updatedAtMs <= nowMs + MAXIMUM_JOURNAL_CLOCK_LEAD_MS,
    "Execution journal time is outside the accepted wall clock",
  );
  const validAfter = decimal(
    canaryPlan.launchAuthorization?.validAfter,
    "Canary authorization valid-after",
  );
  const deadline = decimal(
    canaryPlan.launchAuthorization?.deadline,
    "Canary authorization deadline",
    { positive: true },
  );
  const createdAtSeconds = BigInt(Math.floor(createdAtMs / 1_000));
  assert(
    validAfter <= deadline &&
      createdAtSeconds >= validAfter &&
      createdAtSeconds <= deadline,
    "Execution journal creation time differs from the authorization window",
  );
  assert(
    journal.genesisDigest === hash(
      journal.genesisDigest,
      "Execution journal genesis digest",
    ) && journal.genesisDigest === journalGenesisDigest(journal),
    "Execution journal genesis differs",
  );
  assert(
    journal.blocked === null ||
      (typeof journal.blocked === "string" && journal.blocked.length > 0 && journal.blocked.length <= 500),
    "Execution journal block reason is invalid",
  );
  const requiredKeys = Object.keys(journal.requiredTransactions);
  const auxiliaryKeys = Object.keys(journal.auxiliaryTransactions);
  assert(
    requiredKeys.every((action) =>
      CLASSIC_V4_LIFECYCLE_ACTIONS.includes(action)
    ),
    "Execution journal required transaction key is invalid",
  );
  assert(
    auxiliaryKeys.every((action) => AUXILIARY_ACTIONS.includes(action)),
    "Execution journal auxiliary transaction key is invalid",
  );

  const context = { createdAtMs, updatedAtMs, nowMs };
  const replay = validateJournalHistory(canaryPlan, journal, context);
  const seenHashes = new Set();
  const seenDigests = new Set();
  const recordFacts = new Map();
  const submittedRecords = [];
  let sawGap = false;
  let sawSubmitted = false;
  let previousRequiredBlock = 0;
  let previousRequiredConfirmedAtMs = createdAtMs;
  for (const action of CLASSIC_V4_LIFECYCLE_ACTIONS) {
    if (!Object.hasOwn(journal.requiredTransactions, action)) {
      sawGap = true;
      continue;
    }
    const record = journal.requiredTransactions[action];
    assert(!sawGap, "Execution journal required actions are not a prefix");
    const facts = validateJournalRecord(
      canaryPlan,
      action,
      record,
      false,
      context,
    );
    recordFacts.set(action, facts);
    assert(
      facts.submittedAtMs >= previousRequiredConfirmedAtMs,
      "Execution journal required action chronology differs",
    );
    assert(!sawSubmitted, "Execution journal advances past a submitted action");
    if (record.status === "submitted") {
      sawSubmitted = true;
      submittedRecords.push(facts);
    } else {
      assert(
        record.blockNumber > previousRequiredBlock,
        "Execution journal required blocks are not strictly increasing",
      );
      previousRequiredBlock = record.blockNumber;
      previousRequiredConfirmedAtMs = facts.confirmedAtMs;
    }
    assert(!seenHashes.has(record.hash), "Execution journal transaction hash is duplicated");
    assert(!seenDigests.has(record.prepared.preparedDigest), "Execution journal prepared digest is duplicated");
    seenHashes.add(record.hash);
    seenDigests.add(record.prepared.preparedDigest);
  }
  for (const [action, record] of Object.entries(journal.auxiliaryTransactions)) {
    const facts = validateJournalRecord(
      canaryPlan,
      action,
      record,
      true,
      context,
    );
    recordFacts.set(action, facts);
    assert(!seenHashes.has(record.hash), "Execution journal transaction hash is duplicated");
    assert(!seenDigests.has(record.prepared.preparedDigest), "Execution journal prepared digest is duplicated");
    seenHashes.add(record.hash);
    seenDigests.add(record.prepared.preparedDigest);
    if (record.status === "submitted") submittedRecords.push(facts);

    const requiredIndex = CLASSIC_V4_LIFECYCLE_ACTIONS.indexOf(
      record.prepared.requiredAction,
    );
    const precedingRequired = CLASSIC_V4_LIFECYCLE_ACTIONS.slice(
      0,
      requiredIndex,
    ).map((requiredAction) => journal.requiredTransactions[requiredAction]);
    assert(
      precedingRequired.every((candidate) => candidate?.status === "confirmed"),
      "Execution journal auxiliary prerequisites are not confirmed",
    );
    const previousRequired = precedingRequired.at(-1) ?? null;
    const previousFacts = previousRequired
      ? recordFacts.get(previousRequired.prepared.action)
      : null;
    assert(
      !previousFacts || facts.submittedAtMs >= previousFacts.confirmedAtMs,
      "Execution journal auxiliary chronology differs",
    );
    if (record.status === "confirmed" && previousRequired) {
      assert(
        record.blockNumber > previousRequired.blockNumber,
        "Execution journal auxiliary block precedes its prerequisites",
      );
    }

    const required = journal.requiredTransactions[record.prepared.requiredAction];
    const next = CLASSIC_V4_LIFECYCLE_ACTIONS.find(
      (requiredAction) =>
        !Object.hasOwn(journal.requiredTransactions, requiredAction),
    );
    assert(
      required || next === record.prepared.requiredAction,
      "Execution journal auxiliary action is out of sequence",
    );
    if (required) {
      const requiredFacts = recordFacts.get(record.prepared.requiredAction);
      assert(
        record.status === "confirmed" &&
          facts.confirmedAtMs <= requiredFacts.submittedAtMs,
        "Execution journal auxiliary action does not precede its required action",
      );
      if (required.status === "confirmed") {
        assert(
          record.blockNumber < required.blockNumber,
          "Execution journal auxiliary block does not precede its required block",
        );
      }
    }
  }
  for (const requiredAction of ["sellExactInput", "sellExactOutput"]) {
    const tokenApproval = journal.auxiliaryTransactions[
      `tokenApproval:${requiredAction}`
    ];
    const permit2Approval = journal.auxiliaryTransactions[
      `permit2Approval:${requiredAction}`
    ];
    if (!tokenApproval || !permit2Approval) continue;
    const tokenFacts = recordFacts.get(tokenApproval.prepared.action);
    const permit2Facts = recordFacts.get(permit2Approval.prepared.action);
    assert(
      tokenApproval.status === "confirmed" &&
        permit2Facts.submittedAtMs >= tokenFacts.confirmedAtMs,
      "Execution journal approval chronology differs",
    );
    if (permit2Approval.status === "confirmed") {
      assert(
        permit2Approval.blockNumber > tokenApproval.blockNumber,
        "Execution journal approval blocks are not strictly increasing",
      );
    }
  }
  assert(
    submittedRecords.length <= 1,
    "Execution journal has more than one submitted transaction",
  );

  if (journal.armed !== null) {
    assert(journal.armed && typeof journal.armed === "object" && !Array.isArray(journal.armed), "Execution journal armed action is invalid");
    assert(
      Object.hasOwn(journal.armed, "submittedHash"),
      "Execution journal armed action fields differ",
    );
    const { submittedHash, ...prepared } = journal.armed;
    assert(
      submittedHash === null ||
        submittedHash === transactionHash(submittedHash),
      "Execution journal armed hash is invalid",
    );
    validatePreparedAction(canaryPlan, prepared);
    const expectedRequired = submittedRecords[0]?.candidate.prepared.requiredAction ??
      CLASSIC_V4_LIFECYCLE_ACTIONS.find(
        (action) => !Object.hasOwn(journal.requiredTransactions, action),
      );
    assert(
      prepared.requiredAction === expectedRequired,
      "Execution journal armed action is out of sequence",
    );
    if (submittedHash !== null) {
      assert(
        submittedRecords.length === 1,
        "Execution journal armed transaction has no unique submitted record",
      );
      const record = prepared.auxiliary
        ? journal.auxiliaryTransactions[prepared.action]
        : journal.requiredTransactions[prepared.action];
      assert(
        record?.status === "submitted" &&
          record.hash === submittedHash &&
          isDeepStrictEqual(record.prepared, prepared),
        "Execution journal armed transaction differs",
      );
    } else {
      assert(
        submittedRecords.length === 0,
        "Execution journal unsubmitted armed action conflicts with a submitted record",
      );
      const existing = prepared.auxiliary
        ? journal.auxiliaryTransactions[prepared.action]
        : journal.requiredTransactions[prepared.action];
      assert(
        existing === undefined && !seenDigests.has(prepared.preparedDigest),
        "Execution journal armed action already has a transaction",
      );
    }
  } else {
    assert(
      submittedRecords.length === 0,
      "Execution journal submitted transaction is missing its armed request",
    );
  }
  const persistedRecords = [
    ...Object.entries(journal.requiredTransactions),
    ...Object.entries(journal.auxiliaryTransactions),
  ];
  assert(
    replay.records.size === persistedRecords.length,
    "Execution journal records differ from its history",
  );
  for (const [action, record] of persistedRecords) {
    const historical = replay.records.get(action);
    assert(
      historical &&
        historical.action === record.prepared.action &&
        historical.requiredAction === record.prepared.requiredAction &&
        historical.auxiliary === record.prepared.auxiliary &&
        historical.preparedDigest === record.prepared.preparedDigest &&
        isDeepStrictEqual(historical.prepared, record.prepared) &&
        historical.status === record.status &&
        historical.hash === record.hash &&
        historical.submittedAt === record.submittedAt &&
        (record.status !== "confirmed" || (
          historical.blockNumber === record.blockNumber &&
          historical.blockHash === record.blockHash &&
          historical.confirmedAt === record.confirmedAt
        )),
      "Execution journal record differs from its history",
    );
  }
  assert(
    replay.blocked === journal.blocked,
    "Execution journal block state differs from its history",
  );
  if (journal.armed === null) {
    assert(replay.armed === null, "Execution journal armed history differs");
  } else {
    assert(
      replay.armed &&
        replay.armed.action === journal.armed.action &&
        replay.armed.requiredAction === journal.armed.requiredAction &&
        replay.armed.auxiliary === journal.armed.auxiliary &&
        replay.armed.preparedDigest === journal.armed.preparedDigest &&
        replay.armed.submittedHash === journal.armed.submittedHash,
      "Execution journal armed state differs from its history",
    );
  }
  return journal;
}

export function nextClassicV4LifecycleAction(journal) {
  if (journal.blocked) return Object.freeze({ status: "blocked", reason: journal.blocked });
  if (journal.armed) {
    return Object.freeze(journal.armed.submittedHash
      ? {
          status: "pending",
          action: journal.armed.requiredAction,
          hash: journal.armed.submittedHash,
        }
      : { status: "review", action: journal.armed.requiredAction });
  }
  for (const action of CLASSIC_V4_LIFECYCLE_ACTIONS) {
    const record = journal.requiredTransactions[action];
    if (!record) return Object.freeze({ status: "ready", action });
    if (record.status === "submitted") {
      return Object.freeze({ status: "pending", action, hash: record.hash });
    }
    if (record.status !== "confirmed") {
      return Object.freeze({ status: "blocked", action, reason: `${action} is not confirmed` });
    }
  }
  return Object.freeze({ status: "complete" });
}

export function sealClassicV4PreparedAction(canaryPlan, prepared, envelope) {
  const request = Object.freeze({
    ...prepared.request,
    nonce: toHex(BigInt(envelope.nonce)),
    gas: toHex(BigInt(envelope.gasLimit)),
    maxFeePerGas: toHex(BigInt(envelope.maxFeePerGas)),
    maxPriorityFeePerGas: toHex(BigInt(envelope.maxPriorityFeePerGas)),
  });
  const value = {
    schemaVersion: CLASSIC_V4_PREPARED_ACTION_SCHEMA,
    planDigest: canaryPlan.planDigest,
    action: prepared.action,
    requiredAction: prepared.requiredAction,
    auxiliary: prepared.auxiliary === true,
    label: prepared.label,
    requiredAccount: canonicalAddress(prepared.requiredAccount, "Required account"),
    request,
    maximumGasDebit: (
      BigInt(envelope.gasLimit) * BigInt(envelope.maxFeePerGas) + BigInt(request.value)
    ).toString(),
    preparedAtBlock: Number(envelope.preparedAtBlock),
    preparedAtBlockHash: hash(envelope.preparedAtBlockHash, "Preparation block hash"),
    ...(prepared.quote ? { quote: prepared.quote } : {}),
    ...(prepared.swap ? { swap: prepared.swap } : {}),
    ...(prepared.allowance ? { allowance: prepared.allowance } : {}),
    ...(prepared.authorization ? { authorization: prepared.authorization } : {}),
  };
  const sealed = {
    ...value,
    preparedDigest: digestJson(value, CLASSIC_V4_DIGEST_DOMAINS.generic),
  };
  validatePreparedAction(canaryPlan, sealed);
  return Object.freeze(sealed);
}

export function armClassicV4ExecutionJournal(canaryPlan, value, prepared, now = new Date()) {
  const journal = clone(validateClassicV4ExecutionJournal(canaryPlan, value, now));
  const checkedPrepared = clone(validatePreparedAction(canaryPlan, prepared));
  if (journal.armed) {
    assert(
      isDeepStrictEqual(
        Object.fromEntries(
          Object.entries(journal.armed).filter(([key]) => key !== "submittedHash"),
        ),
        checkedPrepared,
      ),
      "Another Classic V4 action is already armed",
    );
    return journal;
  }
  const next = nextClassicV4LifecycleAction(journal);
  assert(next.status === "ready", "No Classic V4 lifecycle action is ready");
  assert(checkedPrepared.requiredAction === next.action, "Prepared action is out of sequence");
  journal.armed = { ...checkedPrepared, submittedHash: null };
  appendJournalHistory(
    journal,
    {
      kind: "armed",
      action: checkedPrepared.action,
      requiredAction: checkedPrepared.requiredAction,
      auxiliary: checkedPrepared.auxiliary,
      preparedDigest: checkedPrepared.preparedDigest,
      prepared: checkedPrepared,
    },
    now,
    "Execution journal arm time",
  );
  return validateClassicV4ExecutionJournal(canaryPlan, journal, now);
}

export function discardClassicV4ArmedAction(
  canaryPlan,
  value,
  preparedDigest,
  now = new Date(),
) {
  const journal = clone(validateClassicV4ExecutionJournal(canaryPlan, value, now));
  assert(journal.armed, "No Classic V4 action is armed");
  assert(!journal.armed.submittedHash, "A submitted transaction cannot be discarded");
  assert(
    journal.armed.preparedDigest === preparedDigest,
    "Discarded Classic V4 action differs from the armed request",
  );
  appendJournalHistory(
    journal,
    {
      kind: "discarded",
      action: journal.armed.action,
      requiredAction: journal.armed.requiredAction,
      auxiliary: journal.armed.auxiliary,
      preparedDigest: journal.armed.preparedDigest,
      armEventDigest: currentArmEventDigest(journal),
    },
    now,
    "Execution journal discard time",
  );
  journal.armed = null;
  return validateClassicV4ExecutionJournal(canaryPlan, journal, now);
}

export function recordClassicV4SubmittedTransaction(
  canaryPlan,
  value,
  { action, preparedDigest, transactionHash: submittedHash },
  now = new Date(),
) {
  const journal = clone(validateClassicV4ExecutionJournal(canaryPlan, value, now));
  assert(journal.armed, "No Classic V4 action is armed");
  assert(
    journal.armed.action === action && journal.armed.preparedDigest === preparedDigest,
    "Submitted Classic V4 action differs from the armed request",
  );
  const normalizedHash = transactionHash(submittedHash);
  if (journal.armed.submittedHash) {
    assert(
      normalizeHex(journal.armed.submittedHash) === normalizeHex(normalizedHash),
      "The armed Classic V4 transaction hash is immutable",
    );
    return journal;
  }
  const target = journal.armed.auxiliary
    ? journal.auxiliaryTransactions
    : journal.requiredTransactions;
  assert(!target[action], "This Classic V4 action already has a transaction");
  const prepared = clone(journal.armed);
  delete prepared.submittedHash;
  const timestamp = appendJournalHistory(
    journal,
    {
      kind: "submitted",
      action: journal.armed.action,
      requiredAction: journal.armed.requiredAction,
      auxiliary: journal.armed.auxiliary,
      preparedDigest: journal.armed.preparedDigest,
      armEventDigest: currentArmEventDigest(journal),
      transactionHash: normalizedHash,
    },
    now,
    "Execution journal submission time",
  );
  target[action] = {
    status: "submitted",
    hash: normalizedHash,
    prepared,
    submittedAt: timestamp,
  };
  journal.armed.submittedHash = normalizedHash;
  return validateClassicV4ExecutionJournal(canaryPlan, journal, now);
}

export function confirmClassicV4JournalTransaction(
  canaryPlan,
  value,
  { action, blockNumber, blockHash },
  now = new Date(),
) {
  const journal = clone(validateClassicV4ExecutionJournal(canaryPlan, value, now));
  const required = journal.requiredTransactions[action];
  const auxiliary = journal.auxiliaryTransactions[action];
  const record = required ?? auxiliary;
  assert(record?.status === "submitted", "Classic V4 transaction is not submitted");
  assert(
    Number.isSafeInteger(Number(blockNumber)) && Number(blockNumber) > 0,
    "Transaction block number is invalid",
  );
  const canonicalBlockHash = hash(blockHash, "Transaction block hash");
  const timestamp = appendJournalHistory(
    journal,
    {
      kind: "confirmed",
      action,
      requiredAction: record.prepared.requiredAction,
      auxiliary: record.prepared.auxiliary,
      preparedDigest: record.prepared.preparedDigest,
      armEventDigest: currentArmEventDigest(journal),
      transactionHash: record.hash,
      blockNumber: Number(blockNumber),
      blockHash: canonicalBlockHash,
    },
    now,
    "Execution journal confirmation time",
  );
  record.status = "confirmed";
  record.blockNumber = Number(blockNumber);
  record.blockHash = canonicalBlockHash;
  record.confirmedAt = timestamp;
  if (journal.armed?.action === action) journal.armed = null;
  return validateClassicV4ExecutionJournal(canaryPlan, journal, now);
}

export function blockClassicV4ExecutionJournal(canaryPlan, value, reason, now = new Date()) {
  const journal = clone(validateClassicV4ExecutionJournal(canaryPlan, value, now));
  assert(typeof reason === "string" && reason.length > 0 && reason.length <= 500, "Block reason is invalid");
  if (journal.blocked !== null) {
    assert(
      journal.blocked === reason,
      "Execution journal is already blocked for a different reason",
    );
    return journal;
  }
  journal.blocked = reason;
  appendJournalHistory(
    journal,
    { kind: "blocked", reason },
    now,
    "Execution journal block time",
  );
  return validateClassicV4ExecutionJournal(canaryPlan, journal, now);
}

export function buildClassicV4TransactionOutput(canaryPlan, journal) {
  validateClassicV4ExecutionJournal(canaryPlan, journal);
  const output = {};
  let previousBlock = 0;
  for (const action of CLASSIC_V4_LIFECYCLE_ACTIONS) {
    const record = journal.requiredTransactions[action];
    assert(record?.status === "confirmed", `${action} is not confirmed`);
    assert(record.blockNumber > previousBlock, `${action} is not in a distinct increasing block`);
    previousBlock = record.blockNumber;
    output[action] = transactionHash(record.hash);
  }
  return Object.freeze(output);
}

export function classicV4PreparedCalldataHash(prepared) {
  assert(typeof prepared?.request?.data === "string", "Prepared calldata is missing");
  return keccak256(prepared.request.data);
}
