import { canonicalizeJson } from "./canonical-json.mjs";
import { sha256Digest } from "./io.mjs";
import { validateEvidenceShapeV41 } from "./fee-review-v1.mjs";

export const ROBINHOOD_INITIAL_BUY_QUOTE_URL_V1 = "https://api.programmable.market/v4/chains/4663/initial-buy-quote";
const uint = { type: "string", pattern: "^[1-9][0-9]{0,77}$" };
const timestamp = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$" };
const properties = {
  schemaVersion: { const: "programmable.robinhood-initial-buy-usd-quote.v1" },
  executionChainId: { const: "4663" }, referenceChainId: { const: "1" }, nativeCurrency: { const: "ETH" },
  quoteCurrency: { const: "USD" }, assessmentBase: { const: "gross-native-initial-buy-at-admission" },
  feedAddress: { const: "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419" }, feedDecimals: { const: 8 },
  blockNumber: uint, blockHash: { type: "string", pattern: "^0x(?!0{64}$)[0-9a-f]{64}$" },
  blockTimestamp: uint, roundId: uint, answeredInRound: uint, answer: uint, startedAt: uint, updatedAt: uint,
  minimumUsdWad: { const: "1000000000000000000" }, minimumInitialBuyWei: uint,
  observedAt: timestamp, expiresAt: timestamp, providers: { const: [
    { providerId: "drpc", trustDomain: "drpc.org" }, { providerId: "quicknode", trustDomain: "quicknode.com" },
  ] }, evidenceDigest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
};
export const ROBINHOOD_INITIAL_BUY_QUOTE_SCHEMA_V1 = {
  type: "object", additionalProperties: false, required: Object.keys(properties), properties,
};

/** Validate the server's reference and its recorded freshness. This does not issue price authority. */
export function assertRobinhoodInitialBuyUsdQuoteV1(quote, { atTime } = {}) {
  validateEvidenceShapeV41(quote, ROBINHOOD_INITIAL_BUY_QUOTE_SCHEMA_V1, "initialBuyQuote");
  const { evidenceDigest, ...unsigned } = quote;
  const digest = framedEvidenceDigestV41(quote.schemaVersion, unsigned);
  const answer = BigInt(quote.answer);
  const blockTime = BigInt(quote.blockTimestamp);
  const observed = canonicalTime(quote.observedAt);
  const expires = canonicalTime(quote.expiresAt);
  const observedSeconds = BigInt(Math.floor(observed / 1000));
  if (digest !== evidenceDigest || Object.keys(properties).filter(key => properties[key] === uint)
    .some(key => BigInt(quote[key]) >= 1n << 256n)
    || answer >= 1n << 255n || BigInt(quote.roundId) >= 1n << 80n
    || BigInt(quote.answeredInRound) >= 1n << 80n || BigInt(quote.answeredInRound) < BigInt(quote.roundId)
    || BigInt(quote.startedAt) > BigInt(quote.updatedAt)
    || BigInt(quote.updatedAt) > blockTime || observedSeconds - BigInt(quote.updatedAt) > 7200n
    || blockTime > observedSeconds || observedSeconds - blockTime > 120n
    || expires <= observed || expires > observed + 60000
    || BigInt(expires) > (blockTime + 120n) * 1000n
    || BigInt(expires) > (BigInt(quote.updatedAt) + 7200n) * 1000n
    || BigInt(quote.minimumInitialBuyWei) !== (10n ** 26n + answer - 1n) / answer) {
    throw new TypeError("INITIAL_BUY_QUOTE_INVALID: server USD reference evidence or rounding is inconsistent");
  }
  if (atTime !== undefined) {
    const at = canonicalTime(atTime);
    if (at < observed || at >= expires || BigInt(Math.floor(at / 1000)) - blockTime > 120n
      || BigInt(Math.floor(at / 1000)) - BigInt(quote.updatedAt) > 7200n) {
      throw new TypeError("INITIAL_BUY_QUOTE_EXPIRED: obtain a fresh server reference; do not increase the user's approved spend automatically");
    }
  }
  return quote;
}

export async function getRobinhoodInitialBuyQuoteV1({ fetchImpl = fetch, now = () => new Date() } = {}) {
  const response = await fetchImpl(ROBINHOOD_INITIAL_BUY_QUOTE_URL_V1, {
    method: "GET", headers: { accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new TypeError(`INITIAL_BUY_QUOTE_UNAVAILABLE: server reference returned HTTP ${response.status}; retry without changing approved budgets`);
  const quote = await response.json();
  assertRobinhoodInitialBuyUsdQuoteV1(quote, { atTime: now().toISOString() });
  return quote;
}

export function assertInitialBuyWithinServerReferenceV1(fundingPlan, quote) {
  assertRobinhoodInitialBuyUsdQuoteV1(quote);
  if (fundingPlan.launchMode === "fund-and-launch"
    && BigInt(fundingPlan.nativeAllocations.initialBuyWei) < BigInt(quote.minimumInitialBuyWei)) {
    const error = new TypeError(`INITIAL_BUY_BELOW_SERVER_REFERENCE: the selected buy is below the server's current USD 1 reference (${quote.minimumInitialBuyWei} wei). Obtain the user's approval for an adequate initial buy and launch budget, then rebuild. No amount was increased.`);
    error.code = "INITIAL_BUY_BELOW_SERVER_REFERENCE";
    throw error;
  }
}

export function framedEvidenceDigestV41(domain, unsigned) {
  return sha256Digest(Buffer.concat([Buffer.from(domain), Buffer.from([0]), Buffer.from(canonicalizeJson(unsigned))]));
}

function canonicalTime(value) {
  const time = Date.parse(value);
  if (typeof value !== "string" || !Number.isSafeInteger(time) || new Date(time).toISOString() !== value) {
    throw new TypeError("initial buy quote requires a canonical UTC timestamp");
  }
  return time;
}
