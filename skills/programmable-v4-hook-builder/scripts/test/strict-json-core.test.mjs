import assert from "node:assert/strict";
import test from "node:test";

import {
  StrictJsonError,
  parseBoundedStrictJson,
  parseBoundedStrictJsonBytes
} from "../strict-json-core.mjs";

test("strict JSON preserves ordinary JSON values", () => {
  const value = parseBoundedStrictJson('{"array":[1,true,null,"ok"],"object":{"x":-2.5e3}}');
  assert.deepEqual(value, {
    array: [1, true, null, "ok"],
    object: { x: -2.5e3 }
  });
});

test("strict JSON rejects same, conflicting, nested, and escaped-equivalent duplicate keys", () => {
  for (const source of [
    '{"id":1,"id":1}',
    '{"id":1,"id":2}',
    '{"outer":{"id":1,"id":2}}',
    '{"a":1,"\\u0061":2}'
  ]) {
    assert.throws(
      () => parseBoundedStrictJson(source),
      (error) => error instanceof StrictJsonError && error.code === "STRICT_JSON_DUPLICATE_KEY"
    );
  }
});

test("strict JSON rejects invalid UTF-8 and bounded resource overflows", () => {
  assert.throws(
    () => parseBoundedStrictJsonBytes(Buffer.from([0xff])),
    (error) => error?.code === "STRICT_JSON_UTF8_INVALID"
  );
  assert.throws(
    () => parseBoundedStrictJsonBytes(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("{}", "utf8")])),
    (error) => error?.code === "STRICT_JSON_SYNTAX_INVALID"
  );
  assert.throws(
    () => parseBoundedStrictJson('{"a":1}', { maxSourceBytes: 6 }),
    (error) => error?.code === "STRICT_JSON_SOURCE_LIMIT"
  );
  assert.throws(
    () => parseBoundedStrictJson('[[0]]', { maxDepth: 1 }),
    (error) => error?.code === "STRICT_JSON_DEPTH_LIMIT"
  );
  assert.throws(
    () => parseBoundedStrictJson('[0,1]', { maxNodes: 2 }),
    (error) => error?.code === "STRICT_JSON_NODE_LIMIT"
  );
  assert.throws(
    () => parseBoundedStrictJson('123', { maxNumberCharacters: 2 }),
    (error) => error?.code === "STRICT_JSON_NUMBER_LIMIT"
  );
});

test("strict JSON accepts dangerous-looking keys as inert JSON data without mutating prototypes", () => {
  const value = parseBoundedStrictJson('{"__proto__":{"polluted":true},"constructor":"data","prototype":null}');
  assert.equal(Object.hasOwn(value, "__proto__"), true);
  assert.equal({}.polluted, undefined);
  assert.equal(value.constructor, "data");
});
