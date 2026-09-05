import assert from "node:assert/strict";
import test from "node:test";
import { assertRobinhoodInitialBuyUsdQuoteV1, getRobinhoodInitialBuyQuoteV1,
  assertInitialBuyWithinServerReferenceV1, framedEvidenceDigestV41,
  ROBINHOOD_INITIAL_BUY_QUOTE_SCHEMA_V1 } from "../src/initial-buy-quote-v1.mjs";
import { assertRobinhoodInitialBuyReviewV1, ROBINHOOD_NATIVE20_EXECUTION_PROOF_SCHEMA_V1 } from "../src/initial-buy-review-v1.mjs";

const observedAt = "2026-09-05T12:00:00.000Z";
const atTime = "2026-09-05T12:00:01.000Z";
const sha = `sha256:${"11".repeat(32)}`;
const buyer = "0x1111111111111111111111111111111111111111";
const token = "0x2222222222222222222222222222222222222222";
const initializer = "0x3333333333333333333333333333333333333333";
function literals(schema) {
  return Object.fromEntries(Object.entries(schema.properties).filter(([, value]) => Object.hasOwn(value, "const"))
    .map(([key, value]) => [key, value.const]));
}
function seal(unsigned) { return { ...unsigned, evidenceDigest: framedEvidenceDigestV41(unsigned.schemaVersion, unsigned) }; }
function quoteFixture() {
  const seconds = BigInt(Date.parse(observedAt) / 1000);
  return seal({ ...literals(ROBINHOOD_INITIAL_BUY_QUOTE_SCHEMA_V1), blockNumber: "25000000",
    blockHash: `0x${"44".repeat(32)}`, blockTimestamp: (seconds - 10n).toString(),
    roundId: "1", answeredInRound: "1", answer: "250000000000", startedAt: (seconds - 25n).toString(), updatedAt: (seconds - 20n).toString(),
    minimumInitialBuyWei: "400000000000000", observedAt, expiresAt: "2026-09-05T12:01:00.000Z" });
}
function reviewFixture() {
  const quote = quoteFixture();
  const execution = seal({ ...literals(ROBINHOOD_NATIVE20_EXECUTION_PROOF_SCHEMA_V1),
    graphSha256: sha, verificationBundleSha256: sha,
    preparedArtifactHash: sha, kernelEvidenceDigest: sha, tokenTargetId: "token", tokenAddress: token,
    initializerTargetId: "initializer", initializerAddress: initializer, initialBuyWei: "1000000000000000",
    buyer, minimumTokensOut: "1", positionOwner: initializer });
  const review = seal({ schemaVersion: "programmable.robinhood-initial-buy-review.v1", execution, quote,
    assessmentTime: "permit-authorization" });
  const resource = { controller: { address: buyer }, funding: { valueWei: execution.initialBuyWei },
    fundingPlan: { nativeAllocations: { initialBuyWei: execution.initialBuyWei } },
    commitments: { verification: sha }, feeReview: { graphSha256: sha, verificationBundleSha256: sha,
      preparedArtifactHash: sha, evidenceDigest: sha, poolKey: { currency1: token } },
    admissionReceipt: { initialBuyReviewDigest: review.evidenceDigest, issuedAt: atTime }, preparedArtifact: null };
  return { review, resource };
}

test("server USD reference uses exact ceil rounding and explicit live freshness", async () => {
  const quote = quoteFixture();
  assert.equal(assertRobinhoodInitialBuyUsdQuoteV1(quote, { atTime }), quote);
  assert.throws(() => assertRobinhoodInitialBuyUsdQuoteV1(quote, { atTime: quote.expiresAt }), /EXPIRED/);
  const obtained = await getRobinhoodInitialBuyQuoteV1({ now: () => new Date(atTime), fetchImpl: async (url, options) => {
    assert.equal(url, "https://api.programmable.market/v4/chains/4663/initial-buy-quote");
    assert.equal(options.method, "GET"); assert.equal(options.headers.authorization, undefined);
    return new Response(JSON.stringify(quote), { status: 200 });
  } });
  assert.deepEqual(obtained, quote);
  for (const change of [
    q => { q.minimumInitialBuyWei = "399999999999999"; }, q => { q.answer = "0"; },
    q => { q.referenceChainId = "4663"; }, q => { q.answeredInRound = "0"; },
    q => { q.startedAt = (BigInt(q.updatedAt) + 1n).toString(); },
    q => { q.providers = [...q.providers].reverse(); }, q => { q.extra = 1; },
  ]) { const changed = structuredClone(quote); change(changed); assert.throws(() => assertRobinhoodInitialBuyUsdQuoteV1(changed)); }
  const plan = { launchMode: "fund-and-launch", nativeAllocations: { initialBuyWei: "399999999999999" } };
  assert.throws(() => assertInitialBuyWithinServerReferenceV1(plan, quote), { code: "INITIAL_BUY_BELOW_SERVER_REFERENCE" });
  assert.equal(plan.nativeAllocations.initialBuyWei, "399999999999999");
});

test("archival atomic first-buy proof binds fee, funding, buyer and authorization-time quote", () => {
  const { review, resource } = reviewFixture();
  assert.equal(assertRobinhoodInitialBuyReviewV1(review, resource), review);
  for (const mutate of [
    r => { r.controller.address = token; }, r => { r.fundingPlan.nativeAllocations.initialBuyWei = "2"; },
    r => { r.feeReview.preparedArtifactHash = `sha256:${"33".repeat(32)}`; },
    r => { r.admissionReceipt.issuedAt = review.quote.expiresAt; },
    r => { r.admissionReceipt.initialBuyReviewDigest = sha; },
  ]) { const changed = structuredClone(resource); mutate(changed); assert.throws(() => assertRobinhoodInitialBuyReviewV1(review, changed)); }
});
