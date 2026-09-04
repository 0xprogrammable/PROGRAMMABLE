import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { parseStrictJson, StrictJsonError } from "../src/canonical-json.mjs";
import { assertV4ReleaseInstructions } from "../scripts/verify-public-machine-contracts.mjs";

const releaseReadme = await readFile(new URL("../README.md", import.meta.url), "utf8");

test("strict public-contract parsing rejects duplicate properties", () => {
  assert.throws(
    () => parseStrictJson('{"openapi":"3.1.0","info":{"version":"1","version":"2"}}'),
    (error) => error instanceof StrictJsonError
      && /Duplicate object property "version"/u.test(error.message),
  );
});

test("V4 release instructions cover blocked and verified activation without a frozen status claim", () => {
  assert.doesNotThrow(() => assertV4ReleaseInstructions(releaseReadme));
  for (const gate of ["publicAuthorization", "publicWrites", "releaseReady"]) {
    for (const state of ["false", "true"]) {
      assert.throws(() => assertV4ReleaseInstructions(
        releaseReadme.replace(`\`${gate}: ${state}\``, "omitted"),
      ));
    }
  }
  for (const [before, after] of [
    ["If either discovery entry", "Regardless of either discovery entry"],
    ["Only when both discovery entries", "When one discovery entry"],
    ["or any required field or release evidence is missing", ""],
    ["stop before authenticated preflight", "continue to authenticated preflight"],
    ["published immutable GitHub Release", "GitHub Release"],
    ["release manifest", "manifest omitted"],
    ["exact source commit", "source omitted"],
    ["tarball checksum", "checksum omitted"],
    ["If any check fails, stop", "Ignore failed checks"],
  ]) {
    assert.ok(releaseReadme.includes(before), `mutation must replace ${before}`);
    assert.throws(() => assertV4ReleaseInstructions(releaseReadme.replaceAll(before, after)));
  }
});

test("V4 release URLs are allowed only inside verified conditional activation", () => {
  const url = "https://github.com/programmablehq/PROGRAMMABLE/releases/download/programmable-launch-v4.0.0/programmable-launch-4.0.0.tgz";
  const gated = releaseReadme.replace("If any check fails, stop", `${url}\nIf any check fails, stop`);
  assert.doesNotThrow(() => assertV4ReleaseInstructions(gated));
  assert.throws(() => assertV4ReleaseInstructions(`${url}\n${releaseReadme}`));
  assert.throws(() => assertV4ReleaseInstructions(gated.replace(
    url, url.replace("programmablehq/PROGRAMMABLE", "other/PROGRAMMABLE"),
  )));
  assert.throws(() => assertV4ReleaseInstructions(gated.replace(
    url, url.replace("programmable-launch-4.0.0.tgz", "unbound.tgz"),
  )));
});
