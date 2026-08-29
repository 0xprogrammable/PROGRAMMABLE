import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  ROBINHOOD_STANDARD_JSON_ARTIFACTS,
  assertPinnedCompilerProfile,
  assertSourceClosureMatchesCheckout,
  canonicalJsonBytes,
  sha256Hex,
  validateCanonicalStandardJsonBytes,
  verifyCompiledCommitments,
  verifyRobinhoodStandardJsonInputs,
} from "../robinhood-custom-launch-standard-json-core.mjs";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
let verifiedPromise;

function verified() {
  verifiedPromise ??= verifyRobinhoodStandardJsonInputs();
  return verifiedPromise;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function artifactBytes(artifact) {
  return readFile(path.join(repositoryRoot, artifact.path));
}

test("compiles both canonical inputs and preserves every deployment commitment", async () => {
  const result = await verified();
  assert.equal(
    result.artifacts.graphFactory.sha256,
    "0x8ab811a215d70b1d5aef0c71a47153173953ee78d7632725413833888369ec4d",
  );
  assert.equal(result.artifacts.graphFactory.sources, 1);
  assert.equal(
    result.artifacts.router.sha256,
    "0x6abca24d06b013599f4ff63e049976419c3f17455fa9bc343b15ec0d6e6a078a",
  );
  assert.equal(result.artifacts.router.sources, 52);
  assert.deepEqual(result.ownerTransaction, {
    dataHash:
      "0x3ba04469085b17e12843a94c154a335c9c384837f8f6531f179cb4915fd237d9",
    dataBytes: 33_412,
  });
});

test("rejects a source-byte mutation even when reserialized canonically", async () => {
  const artifact = ROBINHOOD_STANDARD_JSON_ARTIFACTS.router;
  const input = JSON.parse(await artifactBytes(artifact));
  input.sources[artifact.sourceUnit].content += " ";
  const mutatedBytes = canonicalJsonBytes(input);
  const parsed = validateCanonicalStandardJsonBytes(
    mutatedBytes,
    {
      ...artifact,
      sourceSha256: sha256Hex(
        Buffer.from(input.sources[artifact.sourceUnit].content),
      ),
    },
    sha256Hex(mutatedBytes),
  );
  await assert.rejects(
    assertSourceClosureMatchesCheckout(parsed, artifact),
    /tracked source byte drift/iu,
  );
});

test("rejects a compiler-setting mutation independently of its file hash", async () => {
  const artifact = ROBINHOOD_STANDARD_JSON_ARTIFACTS.graphFactory;
  const input = JSON.parse(await artifactBytes(artifact));
  input.settings.optimizer.runs = 999;
  const mutatedBytes = canonicalJsonBytes(input);
  assert.throws(
    () =>
      validateCanonicalStandardJsonBytes(
        mutatedBytes,
        artifact,
        sha256Hex(mutatedBytes),
      ),
    /compiler settings drift/iu,
  );
});

test("rejects a compiler-binary pin mutation", async () => {
  const result = await verified();
  const compiler = clone(result.profile.compiler);
  compiler.binarySha256 =
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  assert.throws(
    () => assertPinnedCompilerProfile(compiler),
    /compiler pin drift/iu,
  );
});

test("rejects a Router constructor-input mutation after exact compilation", async () => {
  const result = await verified();
  const deployment = clone(result.deployment);
  deployment.contracts.programmableLaunchStampRouter.constructor[2] =
    "0x1111111111111111111111111111111111111111";
  assert.throws(
    () =>
      verifyCompiledCommitments({
        profile: result.profile,
        deployment,
        compilations: result.compilations,
      }),
    /constructor input drift/iu,
  );
});
