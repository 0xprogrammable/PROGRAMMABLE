import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { validateReferences } from "../capture-stock-paired-v3-final-pricing.mjs";

const ROOT = resolve(import.meta.dirname, "../../..");
const CONFIG = JSON.parse(
  readFileSync(resolve(ROOT, "config/stock-paired-assets.v3.json"), "utf8"),
);
const OBSERVED = JSON.parse(
  readFileSync(
    resolve(
      ROOT,
      "contracts/deployments/evidence/stock-paired-v3-independent-references.json",
    ),
    "utf8",
  ),
);
const NOW = 1_785_380_000;

function freshFixture() {
  const fixture = structuredClone(OBSERVED);
  fixture.status = "reviewed";
  fixture.retrievedAt = NOW - 5;
  fixture.marketSession.observedAt = NOW - 5;
  fixture.assets.forEach((asset) => {
    asset.asOf = NOW - 10;
    asset.retrievedAt = NOW - 5;
    asset.referenceId = `${asset.referenceId}:fresh-fixture`;
  });
  return fixture;
}

test("accepts exactly six ordered, fresh independent references", () => {
  const result = validateReferences(freshFixture(), CONFIG, NOW);
  assert.equal(result.assets.length, 6);
  assert.deepEqual(
    result.assets.map(({ instrument }) => instrument),
    [
      "NASDAQ:NVDA",
      "NYSEARCA:SPY",
      "NASDAQ:GOOGL",
      "NYSEARCA:SLV",
      "NASDAQ:TSLA",
      "NASDAQ:AAPL",
    ],
  );
});

test("accepts the recorded last trade only inside the explicit closed-market window", () => {
  const result = validateReferences(OBSERVED, CONFIG, NOW);
  assert.equal(result.marketSession.state, "closed");
  assert.equal(result.assets[0].asOf, 1_785_370_500);
});

test("rejects a closed-market last trade beyond the four-hour bound", () => {
  const fixture = freshFixture();
  fixture.assets[0].asOf =
    NOW - CONFIG.priceCalibration.maximumClosedMarketReferenceAgeSeconds - 1;
  assert.throws(
    () => validateReferences(fixture, CONFIG, NOW),
    /NVDAon reference is stale/,
  );
});

test("rejects a stale market-closed observation even when the price fits", () => {
  const fixture = freshFixture();
  fixture.marketSession.observedAt =
    NOW - CONFIG.priceCalibration.maximumActivationEvidenceAgeSeconds - 1;
  assert.throws(
    () => validateReferences(fixture, CONFIG, NOW),
    /market-session observation is stale/,
  );
});

test("rejects reordered, missing and non-USD references", () => {
  const reordered = freshFixture();
  reordered.assets.reverse();
  assert.throws(
    () => validateReferences(reordered, CONFIG, NOW),
    /out of order/,
  );

  const missing = freshFixture();
  missing.assets.pop();
  assert.throws(
    () => validateReferences(missing, CONFIG, NOW),
    /exactly six assets/,
  );

  const wrongCurrency = freshFixture();
  wrongCurrency.assets[0].currency = "EUR";
  assert.throws(
    () => validateReferences(wrongCurrency, CONFIG, NOW),
    /currency must be USD/,
  );
});
