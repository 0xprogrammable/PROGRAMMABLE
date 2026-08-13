import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { keccak256 } from "viem";

import {
  AUTHORITY_SOURCE_PATHS,
  assertMaterializedRegistryRuntime,
  assertExactSourceClosure,
  buildRegistrySourceClosure,
  buildRegistryStandardJsonInput,
  compileReviewedRegistry,
  fetchJsonEvidence,
} from "../custom-registry-v2-source-verification-core.mjs";

const root = path.resolve(import.meta.dirname, "../../..");
const source = {
  commit: execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim(),
  tree: execFileSync("git", ["rev-parse", "HEAD^{tree}"], {
    cwd: root,
    encoding: "utf8",
  }).trim(),
};

test("builds the exact reachable Registry source closure from pinned git objects", () => {
  const sources = buildRegistrySourceClosure({ root, ...source });
  assert.deepEqual(
    Object.keys(sources).sort(),
    [...AUTHORITY_SOURCE_PATHS].sort(),
  );
  const input = buildRegistryStandardJsonInput(sources);
  assert.equal(Object.keys(input.sources).length, 13);
  assert.deepEqual(input.settings.remappings, [
    "@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/",
  ]);
  assert.throws(
    () =>
      buildRegistryStandardJsonInput({
        ...sources,
        "src/Injected.sol": { content: "contract Injected {}" },
      }),
    /path set is not exact/u,
  );
  const withoutInterface = { ...sources };
  delete withoutInterface["src/interfaces/IProgrammableCustomRegistryV2.sol"];
  assert.throws(
    () => buildRegistryStandardJsonInput(withoutInterface),
    /path set is not exact/u,
  );
});

test("self-compiles exact git blobs with the digest-pinned official compiler", async () => {
  const compilation = await compileReviewedRegistry({ root, source });
  assert.equal(
    compilation.compiler.sha256,
    "0x0ff016aef2396b12d1fc65429d8ea6cf53c2ee4b041bb8925644615ee1c30ab9",
  );
  assert.equal(
    compilation.manifest.artifact.creationBytecodeKeccak256,
    "0xa2a56d969d2d7e1ee38a7f404ffeadaf2525c1f43020ea4852afec10dd9c30af",
  );
  assert.equal(
    compilation.manifest.artifact.runtimeTemplateKeccak256,
    "0x7eca70a8ca41bd2f08e9b634c54b302b1f5db05e9032558da77e09f60eafea62",
  );
});

test("materializes all compiler immutable references into the exact live runtime", async () => {
  const compilation = await compileReviewedRegistry({ root, source });
  const expectedValues = [
    "0".repeat(63) + "1",
    "0".repeat(63) + "c",
    "4df0a8770d2e63c1576316a246c41af92e831e68374e6810ce5b3b768423dfce",
  ];
  let live = compilation.runtimeTemplate.slice(2);
  Object.values(
    compilation.compiled.evm.deployedBytecode.immutableReferences,
  ).forEach((references, index) => {
    for (const { start, length } of references) {
      live =
        live.slice(0, start * 2) +
        expectedValues[index] +
        live.slice((start + length) * 2);
    }
  });
  const finalized = {
    runtimeCode: `0x${live}`,
    runtimeCodeKeccak256: keccak256(`0x${live}`),
    minimumFinalityBlocks: "12",
    registryPolicyCommitment: `0x${expectedValues[2]}`,
  };
  assert.doesNotThrow(() =>
    assertMaterializedRegistryRuntime({ compilation, finalized }),
  );
  assert.throws(
    () =>
      assertMaterializedRegistryRuntime({
        compilation,
        finalized: { ...finalized, minimumFinalityBlocks: "13" },
      }),
    /do not reproduce live bytes/u,
  );
});

test("rejects empty, renamed, missing, extra, and content-mutated provider closure", () => {
  const local = buildRegistryStandardJsonInput(
    buildRegistrySourceClosure({ root, ...source }),
  );
  assert.doesNotThrow(() => assertExactSourceClosure(local, local, "provider"));
  for (const mutate of [
    (remote) => {
      remote.sources[AUTHORITY_SOURCE_PATHS[0]].content = "";
    },
    (remote) => {
      delete remote.sources[AUTHORITY_SOURCE_PATHS[0]];
    },
    (remote) => {
      remote.sources["src/Renamed.sol"] =
        remote.sources[AUTHORITY_SOURCE_PATHS[0]];
      delete remote.sources[AUTHORITY_SOURCE_PATHS[0]];
    },
    (remote) => {
      remote.sources["src/Extra.sol"] = { content: "contract Extra {}" };
    },
    (remote) => {
      remote.sources[AUTHORITY_SOURCE_PATHS[0]].content += "\n// mutation\n";
    },
  ]) {
    const remote = structuredClone(local);
    mutate(remote);
    assert.throws(
      () => assertExactSourceClosure(remote, local, "provider"),
      /source/u,
    );
  }
});

test("provider HTTP failures never disclose secret query values", async () => {
  const originalFetch = globalThis.fetch;
  const sentinel = "never-print-this-api-key";
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: "no" }), {
      status: 429,
      headers: { "content-type": "application/json" },
    });
  try {
    const url = new URL("https://api.etherscan.io/v2/api");
    url.searchParams.set("action", "getsourcecode");
    url.searchParams.set("apikey", sentinel);
    await assert.rejects(
      () =>
        fetchJsonEvidence({
          label: "etherscan-source",
          url,
          publicQuery: { action: "getsourcecode" },
        }),
      (error) => {
        assert.doesNotMatch(error.message, new RegExp(sentinel, "u"));
        assert.doesNotMatch(error.message, /apikey/u);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
