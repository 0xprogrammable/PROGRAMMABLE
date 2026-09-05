import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getAddress } from "viem";
import { DeveloperRobinhoodInitialBuyPreview } from "../components/developer-launch-history";
import { robinhoodWalletReadyResourceFixtureV41 } from "./fixtures/robinhood-fee-review-v1";
import { describe, expect, it } from "vitest";
import { canonicalBrowserSha256V2 } from "../lib/custom-launch/browser-authority-v2";
import { parseRobinhoodInitialBuyUsdQuoteV1, parseRobinhoodInitialBuyReviewV1 } from "../lib/custom-launch/robinhood-initial-buy-review-v1";

const now = new Date("2026-09-05T10:00:00.000Z");
const seconds = String(now.getTime() / 1000);
function quote() {
  return rehash({ schemaVersion: "programmable.robinhood-initial-buy-usd-quote.v1", executionChainId: "4663", referenceChainId: "1",
    nativeCurrency: "ETH", quoteCurrency: "USD", assessmentBase: "gross-native-initial-buy-at-admission",
    feedAddress: "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419", feedDecimals: 8, blockNumber: "100",
    blockHash: `0x${"ab".repeat(32)}`, blockTimestamp: seconds, roundId: "1", answeredInRound: "1", answer: "400000000000",
    startedAt: seconds, updatedAt: seconds, minimumUsdWad: "1000000000000000000", minimumInitialBuyWei: "250000000000000",
    observedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 60000).toISOString(),
    providers: [{ providerId: "drpc", trustDomain: "drpc.org" }, { providerId: "quicknode", trustDomain: "quicknode.com" }] });
}
function rehash<T extends Record<string, unknown>>(value: T) {
  const unsigned = { ...value };
  delete unsigned.evidenceDigest;
  return { ...value, evidenceDigest: canonicalBrowserSha256V2("programmable.robinhood-initial-buy-usd-quote.v1", unsigned) };
}

describe("Robinhood serialized initial-buy USD reference", () => {
  it("validates the fixed reference and exact integer minimum at the assessment time", () => {
    expect(parseRobinhoodInitialBuyUsdQuoteV1(quote(), now)?.minimumInitialBuyWei).toBe("250000000000000");
  });
  it("rounds up the minimum with integer arithmetic", () => {
    const raw = quote();
    raw.answer = "333333333333";
    raw.minimumInitialBuyWei = ((10n ** 26n + BigInt(raw.answer) - 1n) / BigInt(raw.answer)).toString();
    expect(parseRobinhoodInitialBuyUsdQuoteV1(rehash(raw), now)?.minimumInitialBuyWei).toBe(raw.minimumInitialBuyWei);
  });
  it.each(["missing-started", "extra", "future-started", "zero-started", "reversed-started", "wrong-feed", "wrong-chain",
    "wrong-decimals", "wrong-provider", "wrong-minimum", "digest", "answered-round", "negative-answer", "zero-answer", "block-stale", "round-stale"])("rejects %s even with a recomputed JSON digest", change => {
    const raw: Record<string, unknown> = quote();
    if (change === "missing-started") delete raw.startedAt;
    if (change === "extra") raw.guaranteedDollars = true;
    if (change === "future-started" || change === "reversed-started") raw.startedAt = String(BigInt(seconds) + 1n);
    if (change === "zero-started") raw.startedAt = "0";
    if (change === "wrong-feed") raw.feedAddress = `0x${"a".repeat(40)}`;
    if (change === "wrong-chain") raw.executionChainId = "1";
    if (change === "wrong-decimals") raw.feedDecimals = 18;
    if (change === "wrong-provider") raw.providers = [{ providerId: "client", trustDomain: "example.org" }];
    if (change === "wrong-minimum") raw.minimumInitialBuyWei = "1";
    if (change === "answered-round") raw.answeredInRound = "0";
    if (change === "negative-answer") raw.answer = "-1";
    if (change === "zero-answer") raw.answer = "0";
    if (change === "block-stale") { raw.blockTimestamp = String(BigInt(seconds) - 121n); raw.startedAt = raw.updatedAt = raw.blockTimestamp; }
    if (change === "round-stale") raw.startedAt = raw.updatedAt = String(BigInt(seconds) - 7201n);
    const candidate = rehash(raw);
    if (change === "digest") candidate.evidenceDigest = `sha256:${"1".repeat(64)}`;
    expect(parseRobinhoodInitialBuyUsdQuoteV1(candidate, now)).toBeNull();
  });
  it("rejects a reference at expiry but can validate the historical authorization timestamp", () => {
    const raw = quote();
    expect(parseRobinhoodInitialBuyUsdQuoteV1(raw, new Date(raw.expiresAt))).toBeNull();
    expect(parseRobinhoodInitialBuyUsdQuoteV1(raw, now)).not.toBeNull();
    expect(parseRobinhoodInitialBuyUsdQuoteV1(raw, new Date(now.getTime() - 1))).toBeNull();
  });
  it("requires exact earlier expiry when the source round reaches its maximum age", () => {
    const raw = quote();
    raw.startedAt = raw.updatedAt = String(BigInt(seconds) - 7190n);
    expect(parseRobinhoodInitialBuyUsdQuoteV1(rehash(raw), now)).toBeNull();
    raw.expiresAt = new Date(now.getTime() + 10000).toISOString();
    expect(parseRobinhoodInitialBuyUsdQuoteV1(rehash(raw), now)).not.toBeNull();
    expect(parseRobinhoodInitialBuyUsdQuoteV1(rehash(raw), new Date(raw.expiresAt))).toBeNull();
  });
});


describe("bound Robinhood initial-buy review", () => {
  it("binds the positive buy, recipient, token output and historical price to the prepared launch", () => {
    const resource = robinhoodWalletReadyResourceFixtureV41();
    const review = parseRobinhoodInitialBuyReviewV1(resource);
    expect(review).toMatchObject({ initialBuyWei: resource.fundingPlan.nativeAllocations.initialBuyWei,
      buyer: resource.controller.address, minimumTokensOut: "1", minimumInitialBuyWei: resource.initialBuyReview.quote.minimumInitialBuyWei });
    expect(review?.evidenceDigest).toBe(resource.admissionReceipt.initialBuyReviewDigest);
    const html = renderToStaticMarkup(createElement(DeveloperRobinhoodInitialBuyPreview, { resource }));
    expect(html).toContain("$1 minimum at authorization");
    expect(html).toContain("The launch runs on Robinhood");
    expect(html).toContain("Gas is additional");
    expect(html).toContain("transaction reverts");
  });
  it.each(["absent", "null", "extra", "buyer", "zero-buy", "below-minimum", "min-output", "artifact",
    "kernel", "initializer", "execution-mode", "receipt", "profile", "expired-at-authorization"])("rejects %s", change => {
    const resource = robinhoodWalletReadyResourceFixtureV41();
    const proof = resource.initialBuyReview;
    if (change === "absent") delete resource.initialBuyReview;
    if (change === "null") resource.initialBuyReview = null;
    if (change === "extra") proof.ownerCanBypass = true;
    if (change === "buyer") proof.execution.buyer = getAddress("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    if (change === "zero-buy") proof.execution.initialBuyWei = "0";
    if (change === "below-minimum") proof.execution.initialBuyWei = "1";
    if (change === "min-output") proof.execution.minimumTokensOut = "0";
    if (change === "artifact") proof.execution.preparedArtifactHash = `sha256:${"ab".repeat(32)}`;
    if (change === "kernel") proof.execution.kernelEvidenceDigest = `sha256:${"ab".repeat(32)}`;
    if (change === "initializer") proof.execution.initializerAddress = getAddress("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    if (change === "execution-mode") proof.execution.initialBuyExecution = "agent-will-buy-later";
    if (change === "profile") resource.profile.profileVersion = "4.0.0";
    if (change === "expired-at-authorization") resource.admissionReceipt.issuedAt = proof.quote.expiresAt;
    // Recompute every unsigned JSON digest to exercise semantic bindings, not only checksum failures.
    for (const value of [proof.execution, proof, resource.admissionReceipt]) {
      const digestKey = value.schemaVersion === "programmable.custom-launch-admission-receipt.v4" ? "receiptDigest" : "evidenceDigest";
      const unsigned = { ...value }; delete unsigned[digestKey];
      if (value === resource.admissionReceipt) unsigned.initialBuyReviewDigest = proof.evidenceDigest;
      Object.assign(value, unsigned, { [digestKey]: canonicalBrowserSha256V2(value.schemaVersion, unsigned) });
    }
    if (change === "receipt") resource.admissionReceipt.initialBuyReviewDigest = `sha256:${"ab".repeat(32)}`;
    expect(parseRobinhoodInitialBuyReviewV1(resource)).toBeNull();
  });
});
