import assert from "node:assert/strict";
import test from "node:test";

import { parseStrictJson, StrictJsonError } from "../src/canonical-json.mjs";

test("strict public-contract parsing rejects duplicate properties", () => {
  assert.throws(
    () => parseStrictJson('{"openapi":"3.1.0","info":{"version":"1","version":"2"}}'),
    (error) => error instanceof StrictJsonError
      && /Duplicate object property "version"/u.test(error.message),
  );
});
