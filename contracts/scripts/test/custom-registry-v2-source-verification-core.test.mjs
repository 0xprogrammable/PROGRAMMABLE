import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
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
  expectedPinnedSolcDigest,
  fetchJsonEvidence,
  verifyRegistrySourceProviders,
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
  assert.equal(compilation.compiler.sha256, expectedPinnedSolcDigest());
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

test("accepts only exact semantic Etherscan and Sourcify provider evidence", async () => {
  const compilation = await compileReviewedRegistry({ root, source });
  const policyCommitment = `0x${"ab".repeat(32)}`;
  const immutableValues = [
    "0".repeat(63) + "1",
    "0".repeat(63) + "c",
    policyCommitment.slice(2),
  ];
  let runtime = compilation.runtimeTemplate.slice(2);
  Object.values(
    compilation.compiled.evm.deployedBytecode.immutableReferences,
  ).forEach((references, index) => {
    for (const { start, length } of references) {
      runtime =
        runtime.slice(0, start * 2) +
        immutableValues[index] +
        runtime.slice((start + length) * 2);
    }
  });
  const address = "0x1111111111111111111111111111111111111111";
  const deployer = "0x2222222222222222222222222222222222222222";
  const transactionHash = `0x${"33".repeat(32)}`;
  const constructorArguments = "0x1234";
  const finalized = {
    contractAddress: address,
    transactionHash,
    deploymentBlockNumber: "123",
    deploymentBlockTimestamp: "456",
    deploymentTransactionIndex: "7",
    constructorArguments,
    runtimeCode: `0x${runtime}`,
    runtimeCodeKeccak256: keccak256(`0x${runtime}`),
    minimumFinalityBlocks: "12",
    registryPolicyCommitment: policyCommitment,
  };
  const plan = {
    expectedTransaction: {
      from: deployer,
      input: `${compilation.creationBytecode}${constructorArguments.slice(2)}`,
    },
  };
  const etherscanInput = structuredClone(compilation.input);
  etherscanInput.settings.compilationTarget = {
    "src/ProgrammableCustomRegistryV2.sol": "ProgrammableCustomRegistryV2",
  };
  const exactSource = {
    status: "1",
    message: "OK",
    result: [
      {
        ContractName: "ProgrammableCustomRegistryV2",
        ContractFileName: "src/ProgrammableCustomRegistryV2.sol",
        CompilerType: "solc",
        CompilerVersion: "v0.8.26+commit.8a97fa7a",
        OptimizationUsed: "1",
        Runs: "1000",
        EVMVersion: "cancun",
        Proxy: "0",
        Implementation: "",
        SimilarMatch: "",
        Library: "",
        ConstructorArguments: constructorArguments.slice(2),
        SourceCode: JSON.stringify(etherscanInput),
        ABI: JSON.stringify(compilation.compiled.abi),
      },
    ],
  };
  const exactCreation = {
    status: "1",
    message: "OK",
    result: [
      {
        contractAddress: address,
        contractCreator: deployer,
        txHash: transactionHash,
        blockNumber: "123",
        timestamp: "456",
        contractFactory: "",
        creationBytecode: plan.expectedTransaction.input,
      },
    ],
  };
  const exactSourcify = {
    match: "exact_match",
    creationMatch: "exact_match",
    runtimeMatch: "exact_match",
    chainId: "1",
    address,
    compilation: {
      language: "Solidity",
      compiler: "solc",
      compilerVersion: "0.8.26+commit.8a97fa7a",
      name: "ProgrammableCustomRegistryV2",
      fullyQualifiedName:
        "src/ProgrammableCustomRegistryV2.sol:ProgrammableCustomRegistryV2",
    },
    proxyResolution: {
      isProxy: false,
      proxyType: null,
      implementations: [],
    },
    stdJsonInput: compilation.input,
    sources: compilation.input.sources,
    deployment: {
      transactionHash,
      blockNumber: "123",
      transactionIndex: "7",
      deployer,
    },
    creationBytecode: {
      onchainBytecode: plan.expectedTransaction.input,
      recompiledBytecode: compilation.creationBytecode,
      transformations: [{ reason: "constructorArguments" }],
      transformationValues: { constructorArguments },
    },
    runtimeBytecode: {
      onchainBytecode: finalized.runtimeCode,
      recompiledBytecode: compilation.runtimeTemplate,
      transformations: [{ reason: "immutable" }],
      immutableReferences:
        compilation.compiled.evm.deployedBytecode.immutableReferences,
    },
  };
  const originalFetch = globalThis.fetch;
  const installProviderMock = ({ sourceMutation, sourcifyMutation } = {}) => {
    globalThis.fetch = async (urlValue) => {
      const url = new URL(urlValue);
      let value;
      if (url.hostname === "api.etherscan.io") {
        value =
          url.searchParams.get("action") === "getsourcecode"
            ? structuredClone(exactSource)
            : structuredClone(exactCreation);
        if (url.searchParams.get("action") === "getsourcecode") {
          sourceMutation?.(value);
        }
      } else {
        value = structuredClone(exactSourcify);
        sourcifyMutation?.(value);
      }
      return new Response(JSON.stringify(value), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
  };
  try {
    installProviderMock();
    const evidence = await verifyRegistrySourceProviders({
      compilation,
      finalized,
      plan,
      etherscanApiKey: "sentinel-key",
    });
    assert.equal(evidence.etherscan.status, "exact-match");
    assert.equal(evidence.sourcify.status, "exact-match");
    const responses = [
      evidence.etherscan.sourceResponse,
      evidence.etherscan.creationResponse,
      evidence.sourcify.response,
    ];
    for (const response of responses) {
      const raw = Buffer.from(response.rawResponseBase64, "base64");
      assert.equal(raw.length, response.rawResponseBytes);
      assert.equal(
        `0x${createHash("sha256").update(raw).digest("hex")}`,
        response.rawResponseSha256,
      );
    }
    assert.equal(
      evidence.etherscan.sourceResponse.request.redactedQueryKeys.includes(
        "apikey",
      ),
      true,
    );
    assert.equal(
      evidence.etherscan.creationResponse.request.redactedQueryKeys.includes(
        "apikey",
      ),
      true,
    );

    installProviderMock({
      sourceMutation: (value) => {
        value.result[0].SimilarMatch = address;
      },
    });
    await assert.rejects(
      () =>
        verifyRegistrySourceProviders({
          compilation,
          finalized,
          plan,
          etherscanApiKey: "sentinel-key",
        }),
      /Etherscan exact source metadata/u,
    );
    installProviderMock({
      sourcifyMutation: (value) => {
        value.match = "match";
      },
    });
    await assert.rejects(
      () =>
        verifyRegistrySourceProviders({
          compilation,
          finalized,
          plan,
          etherscanApiKey: "sentinel-key",
        }),
      /Sourcify v2 exact identity/u,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
