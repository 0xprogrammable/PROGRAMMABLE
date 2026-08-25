import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { canonicalizeJson } from "../src/canonical-json.mjs";
import { sha256Digest } from "../src/io.mjs";
import { VERIFICATION_BUNDLE_SCHEMA } from "../src/verification.mjs";

test("exact-source verification hash matches the backend golden vector", async () => {
  const fixture = JSON.parse(await readFile(
    new URL("./fixtures/exact-source-verification-bundle-v1.json", import.meta.url),
    "utf8",
  ));
  const canonical = canonicalizeJson(fixture.verificationBundle);
  assert.equal(canonical, fixture.expected.canonicalBundleJson);
  const standardJsonBytes = Buffer.from(
    fixture.verificationBundle.compilationUnits[0].standardJsonInputBase64,
    "base64",
  );
  assert.equal(standardJsonBytes.toString("utf8"), fixture.standardJsonInputUtf8);
  assert.equal(sha256Digest(standardJsonBytes), fixture.expected.standardJsonInputSha256);
  assert.equal(
    sha256Digest(Buffer.concat([
      Buffer.from(VERIFICATION_BUNDLE_SCHEMA, "utf8"),
      Buffer.from([0]),
      Buffer.from(canonical, "utf8"),
    ])),
    fixture.expected.verificationBundleHash,
  );
});
