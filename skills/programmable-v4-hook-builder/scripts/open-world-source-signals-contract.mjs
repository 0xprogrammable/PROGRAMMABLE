export const OPEN_WORLD_SOURCE_SIGNAL_VERSION = "open-world-source-signals-v1";

export const OPEN_WORLD_SOURCE_SIGNAL_IDS = Object.freeze([
  "callback.pool-manager-only-guard",
  "callback.pool-manager-guard-unverified",
  "authorization.tx-origin",
  "external-call.delegatecall",
  "external-call.low-level",
  "upgrade.proxy-indicator",
  "privilege.rescue-or-sweep",
  "randomness.block-timestamp",
  "randomness.blockhash",
  "randomness.prevrandao",
  "signature.verification",
  "replay.nonce-or-consumption",
  "loop.unbounded-risk-indicator"
]);

export const DEFAULT_MAX_SOURCE_BYTES = 5_000_000;
export const DEFAULT_MAX_TOTAL_BYTES = 25_000_000;
export const DEFAULT_MAX_AST_NODES = 500_000;

export const CALLBACK_NAMES = new Set([
  "beforeInitialize",
  "afterInitialize",
  "beforeAddLiquidity",
  "afterAddLiquidity",
  "beforeRemoveLiquidity",
  "afterRemoveLiquidity",
  "beforeSwap",
  "afterSwap",
  "beforeDonate",
  "afterDonate",
  "unlockCallback"
]);

export const SIGNAL_METADATA = Object.freeze({
  "callback.pool-manager-only-guard": Object.freeze({
    polarity: "control-indicator",
    description: "At least one observed v4 callback entry point carries an explicit PoolManager-only guard."
  }),
  "callback.pool-manager-guard-unverified": Object.freeze({
    polarity: "risk-indicator",
    description: "At least one observed v4 callback entry point has no directly verified PoolManager sender check in the supplied source evidence."
  }),
  "authorization.tx-origin": Object.freeze({
    polarity: "risk-indicator",
    description: "Source references tx.origin in an authorization-capable context."
  }),
  "external-call.delegatecall": Object.freeze({
    polarity: "risk-indicator",
    description: "Source performs or exposes a delegatecall path."
  }),
  "external-call.low-level": Object.freeze({
    polarity: "review-indicator",
    description: "Source performs a low-level call, staticcall or callcode path."
  }),
  "upgrade.proxy-indicator": Object.freeze({
    polarity: "review-indicator",
    description: "Source contains an upgradeability or proxy mechanism indicator."
  }),
  "privilege.rescue-or-sweep": Object.freeze({
    polarity: "review-indicator",
    description: "Source contains a rescue, recover, salvage or sweep path."
  }),
  "randomness.block-timestamp": Object.freeze({
    polarity: "review-indicator",
    description: "Source references block.timestamp in code that may feed time or entropy logic."
  }),
  "randomness.blockhash": Object.freeze({
    polarity: "review-indicator",
    description: "Source references blockhash as a possible entropy source."
  }),
  "randomness.prevrandao": Object.freeze({
    polarity: "review-indicator",
    description: "Source references block.prevrandao as a possible entropy source."
  }),
  "signature.verification": Object.freeze({
    polarity: "review-indicator",
    description: "Source contains a signature-recovery, EIP-712 or contract-signature verification marker."
  }),
  "replay.nonce-or-consumption": Object.freeze({
    polarity: "control-indicator",
    description: "Source contains a nonce, digest-consumption or used-message marker relevant to replay review."
  }),
  "loop.unbounded-risk-indicator": Object.freeze({
    polarity: "risk-indicator",
    description: "Source contains a loop whose runtime bound needs explicit gas and liveness review."
  })
});

export function compareEvidence(left, right) {
  return left.path.localeCompare(right.path) || (left.line ?? Number.MAX_SAFE_INTEGER) - (right.line ?? Number.MAX_SAFE_INTEGER) || left.matcher.localeCompare(right.matcher);
}

export function mappedSignalIds() {
  return new Set(OPEN_WORLD_SOURCE_SIGNAL_IDS);
}

export function normalizeSubject(subject) {
  if (!isObject(subject)) return null;
  const normalized = {};
  if (typeof subject.id === "string") normalized.id = subject.id;
  if (typeof subject.revision === "string" || subject.revision === null) normalized.revision = subject.revision;
  return Object.keys(normalized).length > 0 ? normalized : null;
}

export function positiveLimit(value, fallback) {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

export function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string"))].sort();
}

export function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
