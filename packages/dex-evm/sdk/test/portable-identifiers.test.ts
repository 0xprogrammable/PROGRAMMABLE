import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import {
  ProgrammableSdkError,
  PortableJsonError,
  authorizationScopeIdV1,
  canonicalJsonTestDigest,
  canonicalizePortableJson,
  canonicalizePortableValue,
  marketTemplateIdV1,
  parsePortableJson,
} from "../src/index.js";
import { PROTOCOL_SNAPSHOT, readJson } from "./helpers.js";

interface CanonicalCase {
  readonly case_id: string;
  readonly operation: "canonical_json_digest" | "authorization_scope_id";
  readonly input_utf8_hex?: string;
  readonly scope_descriptor?: unknown;
  readonly expected_canonical_utf8_hex?: string;
  readonly expected_digest?: string;
  readonly reject_code?: string;
}

interface Relation {
  readonly operator: "equal_digest" | "distinct_digest";
  readonly case_ids: readonly [string, string];
}

interface CanonicalDocument {
  readonly cases: readonly CanonicalCase[];
  readonly relations: readonly Relation[];
}

interface MarketIdentifierDocument {
  readonly cases: readonly {
    readonly case_id: string;
    readonly document_path: string;
    readonly expected_id: string;
  }[];
}

function acceptedAuthorizationScope(): {
  readonly scope: Record<string, unknown>;
  readonly expectedId: string;
} {
  const document = readJson(
    resolve(PROTOCOL_SNAPSHOT, "vectors/canonical-identifiers-v1.json"),
  ) as CanonicalDocument;
  const vector = document.cases.find(
    (candidate) =>
      candidate.operation === "authorization_scope_id" &&
      candidate.reject_code === undefined &&
      candidate.scope_descriptor !== undefined &&
      candidate.expected_digest !== undefined,
  );
  if (vector?.expected_digest === undefined) throw new Error("accepted Scope vector is missing");
  const scope = structuredClone(vector.scope_descriptor);
  if (typeof scope !== "object" || scope === null || Array.isArray(scope)) {
    throw new Error("accepted Scope vector is not an object");
  }
  return { scope: scope as Record<string, unknown>, expectedId: vector.expected_digest };
}

function firstMarketTemplate(): {
  readonly template: Record<string, unknown>;
  readonly expectedId: string;
} {
  const document = readJson(
    resolve(PROTOCOL_SNAPSHOT, "vectors/identifiers-v1.json"),
  ) as MarketIdentifierDocument;
  const vector = document.cases[0];
  if (vector === undefined) throw new Error("Market Template vector is missing");
  const template = structuredClone(
    parsePortableJson(readFileSync(resolve(PROTOCOL_SNAPSHOT, vector.document_path))),
  );
  if (typeof template !== "object" || template === null || Array.isArray(template)) {
    throw new Error("Market Template vector is not an object");
  }
  return { template: template as Record<string, unknown>, expectedId: vector.expected_id };
}

function changingGetProxy<T extends object>(target: T) {
  const descriptorReads = new Map<PropertyKey, number>();
  const getReads = new Map<PropertyKey, number>();
  const proxy = new Proxy(target, {
    get(current, key, receiver) {
      const reads = (getReads.get(key) ?? 0) + 1;
      getReads.set(key, reads);
      return reads === 1 ? Reflect.get(current, key, receiver) : undefined;
    },
    getOwnPropertyDescriptor(current, key) {
      descriptorReads.set(key, (descriptorReads.get(key) ?? 0) + 1);
      return Reflect.getOwnPropertyDescriptor(current, key);
    },
  });
  return { proxy, descriptorReads, getReads };
}

function assertOwnDescriptorsReadOnce(
  target: object,
  trace: ReturnType<typeof changingGetProxy>,
): void {
  const keys = Reflect.ownKeys(target);
  assert.equal(trace.descriptorReads.size, keys.length);
  for (const key of keys) assert.equal(trace.descriptorReads.get(key), 1, String(key));
  assert.equal(trace.getReads.size, 0);
}

const invalidPortableValue = (error: unknown): boolean =>
  error instanceof PortableJsonError && error.code === "invalid_json_value";

test("pinned portable canonical identifier vectors pass exactly", () => {
  const document = readJson(
    resolve(PROTOCOL_SNAPSHOT, "vectors/canonical-identifiers-v1.json"),
  ) as CanonicalDocument;
  const accepted = new Map<string, string>();

  for (const vector of document.cases) {
    const evaluate = (): string => {
      if (vector.operation === "canonical_json_digest") {
        assert.notEqual(vector.input_utf8_hex, undefined, vector.case_id);
        const source = Buffer.from(vector.input_utf8_hex ?? "", "hex");
        if (vector.expected_canonical_utf8_hex !== undefined) {
          assert.equal(
            Buffer.from(canonicalizePortableJson(source)).toString("hex"),
            vector.expected_canonical_utf8_hex,
            vector.case_id,
          );
        }
        return canonicalJsonTestDigest(source);
      }
      return authorizationScopeIdV1(vector.scope_descriptor);
    };

    if (vector.reject_code !== undefined) {
      assert.throws(
        evaluate,
        (error: unknown) =>
          (error instanceof PortableJsonError || error instanceof ProgrammableSdkError) &&
          error.code === vector.reject_code,
        vector.case_id,
      );
    } else {
      const digest = evaluate();
      assert.equal(digest, vector.expected_digest, vector.case_id);
      accepted.set(vector.case_id, digest);
    }
  }

  for (const relation of document.relations) {
    const [leftId, rightId] = relation.case_ids;
    const left = accepted.get(leftId);
    const right = accepted.get(rightId);
    assert.notEqual(left, undefined, leftId);
    assert.notEqual(right, undefined, rightId);
    if (relation.operator === "equal_digest") assert.equal(left, right);
    else assert.notEqual(left, right);
  }
});

test("pinned portable Market Template identifier vectors pass exactly", () => {
  const document = readJson(
    resolve(PROTOCOL_SNAPSHOT, "vectors/identifiers-v1.json"),
  ) as MarketIdentifierDocument;
  for (const vector of document.cases) {
    const source = readFileSync(resolve(PROTOCOL_SNAPSHOT, vector.document_path));
    const value = parsePortableJson(source);
    assert.equal(marketTemplateIdV1(value), vector.expected_id, vector.case_id);
  }
});

test("MarketTemplateIdV1 rejects arbitrary or identifier-bearing documents", () => {
  assert.throws(() => marketTemplateIdV1({ arbitrary: true }), /unsupported schema|missing|unknown field/);
  const identifiers = readJson(
    resolve(PROTOCOL_SNAPSHOT, "vectors/identifiers-v1.json"),
  ) as MarketIdentifierDocument;
  const first = identifiers.cases[0];
  assert.notEqual(first, undefined);
  if (first === undefined) return;
  const template = parsePortableJson(
    readFileSync(resolve(PROTOCOL_SNAPSHOT, first.document_path)),
  ) as Record<string, unknown>;
  const withComputedIdentifier = {
    ...template,
    market_template_id: first.expected_id,
  };
  assert.throws(() => marketTemplateIdV1(withComputedIdentifier), /unknown field market_template_id/);

  const nestedBadKey = structuredClone(template);
  nestedBadKey["extensions"] = { valid: { nested: [{ "bad key": true }] } };
  assert.throws(
    () => marketTemplateIdV1(nestedBadKey),
    (error: unknown) =>
      error instanceof ProgrammableSdkError && error.code === "MARKET_TEMPLATE_EXTENSION_KEY_INVALID",
  );

  const nestedNumber = structuredClone(template);
  nestedNumber["extensions"] = { valid: { nested: [{ okay: 1 }] } };
  assert.throws(
    () => marketTemplateIdV1(nestedNumber),
    (error: unknown) => error instanceof PortableJsonError && error.code === "json_number_forbidden",
  );
});

test("portable parser rejects duplicate escaped keys before materialization", () => {
  assert.throws(
    () => parsePortableJson('{"a":"first","\\u0061":"second"}'),
    (error: unknown) => error instanceof PortableJsonError && error.code === "duplicate_object_key",
  );
});

test("portable parser rejects invalid UTF-8 before hashing", () => {
  assert.throws(
    () => canonicalJsonTestDigest(Uint8Array.of(0xc3, 0x28)),
    (error: unknown) => error instanceof PortableJsonError && error.code === "invalid_json",
  );
});

test("portable materialized inputs reject accessors without invoking them", () => {
  let reads = 0;
  const value = Object.create(null) as Record<string, unknown>;
  Object.defineProperty(value, "x", {
    enumerable: true,
    get: () => {
      reads += 1;
      return reads === 1 ? "validated" : 1;
    },
  });
  assert.throws(
    () => canonicalizePortableValue(value),
    (error: unknown) => error instanceof PortableJsonError && error.code === "invalid_json_value",
  );
  assert.equal(reads, 0);
});

test("portable identity helpers snapshot nested Proxy data descriptors exactly once", () => {
  const authorization = acceptedAuthorizationScope();
  const deadline = authorization.scope["deadline"];
  if (typeof deadline !== "object" || deadline === null || Array.isArray(deadline)) {
    throw new Error("accepted Scope deadline is not an object");
  }
  const deadlineTrace = changingGetProxy(deadline);
  authorization.scope["deadline"] = deadlineTrace.proxy;
  assert.equal(authorizationScopeIdV1(authorization.scope), authorization.expectedId);
  assertOwnDescriptorsReadOnce(deadline, deadlineTrace);

  const market = firstMarketTemplate();
  const extensions = market.template["extensions"];
  if (typeof extensions !== "object" || extensions === null || Array.isArray(extensions)) {
    throw new Error("Market Template extensions are not an object");
  }
  const extensionTrace = changingGetProxy(extensions);
  market.template["extensions"] = extensionTrace.proxy;
  assert.equal(marketTemplateIdV1(market.template), market.expectedId);
  assertOwnDescriptorsReadOnce(extensions, extensionTrace);
});

test("portable identity helpers reject nested accessors without invoking them", () => {
  const authorization = acceptedAuthorizationScope();
  const deadline = authorization.scope["deadline"];
  if (typeof deadline !== "object" || deadline === null || Array.isArray(deadline)) {
    throw new Error("accepted Scope deadline is not an object");
  }
  let deadlineReads = 0;
  Object.defineProperty(deadline, "not_after", {
    enumerable: true,
    get: () => {
      deadlineReads += 1;
      return "2000000000";
    },
  });
  assert.throws(() => authorizationScopeIdV1(authorization.scope), invalidPortableValue);
  assert.equal(deadlineReads, 0);

  const market = firstMarketTemplate();
  const extensions = market.template["extensions"];
  if (typeof extensions !== "object" || extensions === null || Array.isArray(extensions)) {
    throw new Error("Market Template extensions are not an object");
  }
  const extensionKey = Object.keys(extensions)[0];
  if (extensionKey === undefined) throw new Error("Market Template extensions are empty");
  let extensionReads = 0;
  Object.defineProperty(extensions, extensionKey, {
    enumerable: true,
    get: () => {
      extensionReads += 1;
      return "MUTATING_EXTENSION";
    },
  });
  assert.throws(() => marketTemplateIdV1(market.template), invalidPortableValue);
  assert.equal(extensionReads, 0);
});

test("portable JSON binding-local depth, node, and UTF-8 ceilings accept max and reject max plus one", () => {
  const maximumDepth = 128;
  const maximumNodes = 100_000;
  const maximumUtf8Bytes = 1_048_576;
  const nested = (depth: number): unknown => {
    let value: unknown = null;
    for (let index = 0; index < depth; index += 1) value = [value];
    return value;
  };

  assert.doesNotThrow(() => canonicalizePortableValue(nested(maximumDepth)));
  assert.throws(
    () => canonicalizePortableValue(nested(maximumDepth + 1)),
    (error: unknown) => error instanceof PortableJsonError && error.code === "portable_resource_limit",
  );
  assert.doesNotThrow(() => parsePortableJson(JSON.stringify(nested(maximumDepth))));
  assert.throws(
    () => parsePortableJson(JSON.stringify(nested(maximumDepth + 1))),
    (error: unknown) => error instanceof PortableJsonError && error.code === "portable_resource_limit",
  );

  assert.doesNotThrow(() => canonicalizePortableValue(Array.from({ length: maximumNodes - 1 }, () => null)));
  assert.throws(
    () => canonicalizePortableValue(Array.from({ length: maximumNodes }, () => null)),
    (error: unknown) => error instanceof PortableJsonError && error.code === "portable_resource_limit",
  );

  assert.doesNotThrow(() => canonicalizePortableValue("a".repeat(maximumUtf8Bytes)));
  assert.throws(
    () => canonicalizePortableValue("a".repeat(maximumUtf8Bytes + 1)),
    (error: unknown) => error instanceof PortableJsonError && error.code === "portable_resource_limit",
  );
  assert.doesNotThrow(() => parsePortableJson(`"${"a".repeat(maximumUtf8Bytes - 2)}"`));
  assert.throws(
    () => parsePortableJson(`"${"a".repeat(maximumUtf8Bytes - 1)}"`),
    (error: unknown) => error instanceof PortableJsonError && error.code === "portable_resource_limit",
  );
});
