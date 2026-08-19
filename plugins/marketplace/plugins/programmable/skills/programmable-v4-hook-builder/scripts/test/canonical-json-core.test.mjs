import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  CANONICAL_JSON_V2_PROFILE,
  CanonicalJsonError,
  canonicalJsonBytesV2,
  canonicalJsonSha256V2,
  canonicalJsonV2
} from "../canonical-json-core.mjs";
import {
  LEGACY_CANONICAL_JSON_V1_PROFILE,
  canonicalJsonLegacySha256V1,
  canonicalJsonLegacyV1
} from "../canonical-json-legacy-adapters.mjs";
import { parseBoundedStrictJsonBytes } from "../strict-json-core.mjs";
import {
  feeConformanceReceiptSha256V1
} from "../fee-conformance-receipt-v1-core.mjs";
import {
  feeConformanceVectorSetSha256V1
} from "../fee-conformance-vector-set-v1-core.mjs";
import { createFeeConformanceFixtureV1 } from "./fee-conformance-v1-fixture.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const vectorPath = path.resolve(scriptDirectory, "../../assets/test-vectors/canonical-json-v2.json");
const vectors = parseBoundedStrictJsonBytes(fs.readFileSync(vectorPath), { maxSourceBytes: 256 * 1024 });

test("canonical JSON v2 vectors cover the required boundary categories", () => {
  assert.equal(vectors.$schema, "urn:programmable:canonical-json-test-vectors:2.0.0");
  assert.equal(vectors.schemaVersion, "2.0.0");
  assert.equal(vectors.profileId, CANONICAL_JSON_V2_PROFILE.id);
  assert.equal(vectors.legacyV1Freeze.profileId, LEGACY_CANONICAL_JSON_V1_PROFILE.id);

  const allCases = [...vectors.jsonCases, ...vectors.runtimeCases];
  assert.equal(new Set(allCases.map(({ id }) => id)).size, allCases.length, "vector ids must be unique");
  const categories = new Set(allCases.map(({ category }) => category));
  for (const category of ["unicode", "numeric", "cycle", "non-finite", "plain-object"]) {
    assert.ok(categories.has(category), `missing ${category} boundary vectors`);
  }
});

test("canonical JSON v2 matches the portable JSON vector corpus", () => {
  for (const vector of vectors.jsonCases) {
    assert.equal(canonicalJsonV2(vector.input), vector.canonical, vector.id);
    assert.equal(canonicalJsonSha256V2(vector.input), vector.sha256, vector.id);
    assert.deepEqual(canonicalJsonBytesV2(vector.input), Buffer.from(vector.canonical, "utf8"), vector.id);
    assert.deepEqual(
      canonicalJsonBytesV2(vector.input, { trailingNewline: true }),
      Buffer.from(`${vector.canonical}\n`, "utf8"),
      vector.id
    );
  }
});

test("canonical JSON v2 accepts only explicit runtime success fixtures", () => {
  for (const vector of vectors.runtimeCases.filter(({ canonical }) => canonical !== undefined)) {
    const { value } = runtimeFixture(vector.fixture);
    assert.equal(canonicalJsonV2(value), vector.canonical, vector.id);
    assert.equal(canonicalJsonSha256V2(value), vector.sha256, vector.id);
  }
});

test("canonical JSON v2 rejects unsafe runtime shapes without invoking accessors", () => {
  for (const vector of vectors.runtimeCases.filter(({ errorCode }) => errorCode !== undefined)) {
    const { value, assertAfter = () => {} } = runtimeFixture(vector.fixture);
    assert.throws(
      () => canonicalJsonV2(value),
      (error) => error instanceof CanonicalJsonError && error.code === vector.errorCode,
      vector.id
    );
    assertAfter();
  }
});

test("legacy V1 ordering stays isolated from the V2 contract", () => {
  const value = { "\u{10000}": "supplementary", "\ue000": "private-use" };
  const frozen = vectors.legacyV1Freeze.unicodeOrder;
  assert.equal(canonicalJsonLegacyV1(value), frozen.canonical);
  assert.equal(canonicalJsonLegacySha256V1(value), frozen.sha256);
  assert.notEqual(canonicalJsonV2(value), frozen.canonical);
});

test("fee-conformance V1 fixture digests remain byte-for-byte frozen", () => {
  const fixture = createFeeConformanceFixtureV1();
  const frozen = vectors.legacyV1Freeze.feeConformanceFixture;
  assert.equal(feeConformanceReceiptSha256V1(fixture.receipt), frozen.receiptSha256);
  assert.equal(feeConformanceVectorSetSha256V1(fixture.vectorSet), frozen.vectorSetSha256);
});

function runtimeFixture(name) {
  if (name === "null-prototype-object") {
    return { value: Object.assign(Object.create(null), { z: 1, a: "ok" }) };
  }
  if (name === "shared-acyclic-reference") {
    const shared = { value: "same" };
    return { value: { left: shared, right: shared } };
  }
  if (name === "nan") return { value: Number.NaN };
  if (name === "negative-zero") return { value: -0 };
  if (name === "positive-infinity") return { value: Number.POSITIVE_INFINITY };
  if (name === "negative-infinity") return { value: Number.NEGATIVE_INFINITY };
  if (name === "self-cycle") {
    const value = {};
    value.self = value;
    return { value };
  }
  if (name === "mutual-cycle") {
    const left = {};
    const right = { left };
    left.right = right;
    return { value: left };
  }
  if (name === "date-object") return { value: new Date(0) };
  if (name === "map-object") return { value: new Map([["a", 1]]) };
  if (name === "class-instance") {
    class Example {
      constructor() {
        this.value = 1;
      }
    }
    return { value: new Example() };
  }
  if (name === "getter-object") {
    let invocations = 0;
    const value = {};
    Object.defineProperty(value, "secret", {
      enumerable: true,
      get() {
        invocations += 1;
        throw new Error("getter must not execute");
      }
    });
    return {
      value,
      assertAfter: () => assert.equal(invocations, 0, "canonicalization must inspect descriptors, not invoke getters")
    };
  }
  if (name === "non-enumerable-property") {
    const value = {};
    Object.defineProperty(value, "hidden", { enumerable: false, value: 1 });
    return { value };
  }
  if (name === "symbol-key") return { value: { [Symbol("hidden")]: 1 } };
  if (name === "sparse-array") {
    const value = new Array(2);
    value[1] = "present";
    return { value };
  }
  if (name === "named-array-property") {
    const value = ["present"];
    value.named = true;
    return { value };
  }
  if (name === "undefined-value") return { value: { missing: undefined } };
  if (name === "bigint-value") return { value: 1n };
  if (name === "lone-high-surrogate") return { value: "\ud800" };
  if (name === "lone-low-surrogate-key") return { value: { "\udc00": 1 } };
  throw new Error(`unknown runtime fixture ${name}`);
}
