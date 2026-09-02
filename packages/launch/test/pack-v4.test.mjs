import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import solc from "solc";

import { validateLaunchRemote } from "../src/api-client.mjs";
import { buildLaunch, packLaunch } from "../src/pack.mjs";
import {
  ROBINHOOD_V4_CANONICAL_FEE_PROFILE_UNAVAILABLE,
} from "../src/robinhood-v4-fee-gate.mjs";
import { validateLaunchFile } from "../src/validate.mjs";
import { assertV4FundingValueMatchesGraph } from "../src/v4-contract.mjs";
import { v4ChainDeployment, v4Profile } from "./fixtures/v4.mjs";

test("V4 pack and validation reject a fee-less graph while the canonical fee profile is unavailable", async () => {
  const fixture = await materializeV4CompiledFixture();
  try {
    const outputPath = path.join(fixture.root, "launch.json");
    const receiptPath = path.join(fixture.root, "launch.receipt.json");
    await assert.rejects(packLaunch({
      configPath: fixture.configPath, outputPath, receiptPath,
    }), (error) => assertCanonicalFeeProfileUnavailable(error, "pack"));
    await assert.rejects(access(outputPath), { code: "ENOENT" });
    await assert.rejects(access(receiptPath), { code: "ENOENT" });

    const legacyRequestPath = path.join(fixture.root, "legacy-fee-less-launch.json");
    await writeFile(legacyRequestPath, JSON.stringify({
      schemaVersion: "programmable.custom-launch-create-request.v4",
      chainId: "4663",
      caip2: "eip155:4663",
      chainDeployment: null,
      chainDeploymentDescriptorDigest: null,
      profile: null,
      launchWallet: null,
      nonce: null,
      permitWindow: null,
      sourceDescriptor: null,
      sourceBundleManifest: null,
      externalContracts: null,
      graphBundle: null,
      projectMetadata: null,
      projectMetadataHash: null,
      projectMetadataImageArtifact: null,
      verificationBundle: null,
      funding: null,
      liquidityModel: null,
      launchIntentHash: null,
      agentAttestation: null,
    }), "utf8");
    await assert.rejects(validateLaunchFile({
      launchPath: legacyRequestPath,
      configPath: fixture.configPath,
    }), (error) => assertCanonicalFeeProfileUnavailable(error, "validate"));

    let fetchCalls = 0;
    let apiKeyReads = 0;
    await assert.rejects(validateLaunchRemote({
      launchPath: legacyRequestPath,
      configPath: fixture.configPath,
      fetchImpl: async () => {
        fetchCalls += 1;
        throw new Error("network must remain unreachable");
      },
      loadApiKeyImpl: async () => {
        apiKeyReads += 1;
        throw new Error("API key must remain unread");
      },
    }), (error) => assertCanonicalFeeProfileUnavailable(error, "validate"));
    assert.equal(fetchCalls, 0);
    assert.equal(apiKeyReads, 0);

  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("V4 pack rejects 2-target and cross-chain configs before compiling", async () => {
  const fixture = await materializeV4CompiledFixture();
  try {
    const original = JSON.parse(await readFile(fixture.configPath, "utf8"));
    const twoTargets = structuredClone(original);
    twoTargets.targets.length = 2;
    await writeFile(fixture.configPath, `${JSON.stringify(twoTargets, null, 2)}\n`, "utf8");
    await assert.rejects(
      buildLaunch({ configPath: fixture.configPath }),
      /targets must contain between 3 and 16/u,
    );

    const wrongChain = structuredClone(original);
    wrongChain.chainId = "1";
    await writeFile(fixture.configPath, `${JSON.stringify(wrongChain, null, 2)}\n`, "utf8");
    await assert.rejects(
      buildLaunch({ configPath: fixture.configPath }),
      /must bind Robinhood Chain mainnet/u,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("V4 funding value exactly covers every graph deployment and initializer value", () => {
  const graphBundle = {
    targets: [
      { deploymentValueWei: "2", initializerValueWei: "0" },
      { deploymentValueWei: "0", initializerValueWei: "0" },
      { deploymentValueWei: "3", initializerValueWei: "0" },
    ],
  };
  const funding = {
    schemaVersion: "programmable.custom-launch-funding-intent.v2",
    mode: "wallet-transaction-value",
    valueWei: "5",
  };
  assert.deepEqual(assertV4FundingValueMatchesGraph(funding, graphBundle), funding);
  assert.throws(
    () => assertV4FundingValueMatchesGraph({ ...funding, valueWei: "4" }, graphBundle),
    /exactly equal the sum/u,
  );
});

function assertCanonicalFeeProfileUnavailable(error, stage) {
  assert.equal(error?.code, ROBINHOOD_V4_CANONICAL_FEE_PROFILE_UNAVAILABLE);
  assert.equal(error?.diagnostic?.stage, stage);
  assert.equal(error?.diagnostic?.observed?.packageState, "fail-closed");
  assert.equal(error?.diagnostic?.retryable, false);
  assert.equal(error?.diagnostic?.requiresNewRequest, true);
  assert.equal(error?.diagnostic?.resumeAt, "pack");
  assert.equal(error?.diagnostic?.expected?.ownerDecision?.ratePpm, "2000");
  assert.equal(error?.diagnostic?.expected?.ownerDecision?.platformId, "programmable");
  assert.equal(error?.diagnostic?.expected?.ownerDecision?.category, "custom");
  assert.equal(error?.diagnostic?.expected?.ownerDecision?.label, "Programmable Custom");
  assert.equal(
    error?.diagnostic?.expected?.ownerDecision?.recipient,
    "0xD88539d3c4C460136a733A3Fd60cf6BF269079da",
  );
  assert.match(
    error?.message ?? "",
    new RegExp(ROBINHOOD_V4_CANONICAL_FEE_PROFILE_UNAVAILABLE, "u"),
  );
  return true;
}

async function materializeV4CompiledFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "programmable-launch-v4-pack-"));
  await mkdir(path.join(root, "src"), { recursive: true });
  await mkdir(path.join(root, "out"), { recursive: true });
  await mkdir(path.join(root, "assets"), { recursive: true });
  await mkdir(path.join(root, "evidence"), { recursive: true });
  const sources = {
    "src/RobinhoodToken.sol": {
      content: [
        "// SPDX-License-Identifier: UNLICENSED",
        "pragma solidity 0.8.26;",
        "contract RobinhoodToken {",
        "  string public constant name = 'Robinhood V4 Test';",
        "  string public constant symbol = 'RHV4';",
        "}",
        "",
      ].join("\n"),
    },
    "src/RobinhoodHook.sol": {
      content: "// SPDX-License-Identifier: UNLICENSED\npragma solidity 0.8.26; contract RobinhoodHook { function marker() external pure returns (uint256) { return 4663; } }\n",
    },
    "src/RobinhoodInitializer.sol": {
      content: "// SPDX-License-Identifier: UNLICENSED\npragma solidity 0.8.26; contract RobinhoodInitializer { function marker() external pure returns (bytes4) { return this.marker.selector; } }\n",
    },
  };
  for (const [sourcePath, source] of Object.entries(sources)) {
    await writeFile(path.join(root, sourcePath), source.content, "utf8");
  }
  const standardJson = {
    language: "Solidity",
    sources,
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "cancun",
      metadata: { bytecodeHash: "none", appendCBOR: false, useLiteralContent: true },
      libraries: {},
      remappings: [],
      outputSelection: {
        "*": {
          "*": [
            "abi",
            "metadata",
            "evm.bytecode.object",
            "evm.bytecode.linkReferences",
            "evm.deployedBytecode.object",
            "evm.deployedBytecode.linkReferences",
            "evm.deployedBytecode.immutableReferences",
          ],
        },
      },
    },
  };
  await writeFile(
    path.join(root, "standard-json.json"),
    `${JSON.stringify(standardJson)}\n`,
    "utf8",
  );
  const output = JSON.parse(solc.compile(JSON.stringify(standardJson)));
  const errors = (output.errors ?? []).filter(({ severity }) => severity === "error");
  assert.deepEqual(errors, []);
  for (const [sourcePath, contractName, artifactName] of [
    ["src/RobinhoodToken.sol", "RobinhoodToken", "token"],
    ["src/RobinhoodHook.sol", "RobinhoodHook", "hook"],
    ["src/RobinhoodInitializer.sol", "RobinhoodInitializer", "initializer"],
  ]) {
    const compiled = output.contracts[sourcePath][contractName];
    await writeFile(path.join(root, "out", `${artifactName}.json`), `${JSON.stringify({
      abi: compiled.abi,
      bytecode: compiled.evm.bytecode,
      deployedBytecode: compiled.evm.deployedBytecode,
      metadata: compiled.metadata,
    })}\n`, "utf8");
  }
  await writeFile(
    path.join(root, "assets", "token.png"),
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    ),
  );
  await writeFile(path.join(root, "evidence", "build.json"), `${JSON.stringify({
    schemaVersion: "programmable.v4-pack-test-evidence.v1",
    compilerVersion: solc.version(),
    errorCount: 0,
    signs: false,
    broadcasts: false,
  })}\n`, "utf8");

  const commonTarget = {
    compilationUnitId: "robinhood-fixture",
    constructorArguments: [],
    initializer: null,
    deploymentValueWei: "0",
    initializerValueWei: "0",
    declaredHookPermissions: null,
    runtimeImmutables: [],
  };
  const config = {
    schemaVersion: "programmable.launch-pack-config.v4",
    chainId: "4663",
    caip2: "eip155:4663",
    chainDeployment: v4ChainDeployment,
    profile: v4Profile,
    externalContracts: [],
    launchWallet: "0x1111111111111111111111111111111111111111",
    nonce: `0x${"44".repeat(32)}`,
    permitWindow: { validAfter: "1", deadline: "2" },
    source: {
      root: ".",
      paths: ["src"],
      sourceLineageNonce: "1",
      publicOrigin: {
        url: "https://github.com/programmablehq/PROGRAMMABLE",
        revision: "11".repeat(20),
      },
    },
    compilationUnits: [{
      compilationUnitId: "robinhood-fixture",
      standardJson: "standard-json.json",
    }],
    targets: [
      {
        ...commonTarget,
        targetId: "token",
        artifact: "out/token.json",
        applicantSalt: `0x${"01".repeat(32)}`,
        componentKind: "token",
      },
      {
        ...commonTarget,
        targetId: "hook",
        artifact: "out/hook.json",
        applicantSalt: {
          mode: "deterministic-hook-permission-grind-v1",
          start: "0",
          maxAttempts: "262144",
        },
        componentKind: "hook",
        declaredHookPermissions: ["beforeSwap"],
      },
      {
        ...commonTarget,
        targetId: "initializer",
        artifact: "out/initializer.json",
        applicantSalt: `0x${"03".repeat(32)}`,
        componentKind: "other",
      },
    ],
    pool: {
      tokenTargetId: "token",
      hookTargetId: "hook",
      fee: 3_000,
      tickSpacing: 60,
      quoteCurrency: "0x0000000000000000000000000000000000000000",
    },
    projectMetadata: {
      schemaVersion: "programmable.project-metadata-input.v1",
      token: { name: "Robinhood V4 Test", symbol: "RHV4" },
      presentation: {
        description: "Deterministic three-target Robinhood V4 no-broadcast test launch",
        image: {
          sourcePath: "assets/token.png",
          uri: "https://example.com/token.png",
        },
        links: [
          { kind: "website", uri: "https://example.com/" },
          { kind: "x", uri: "https://x.com/robinhood_v4_test" },
        ],
      },
    },
    funding: {
      schemaVersion: "programmable.custom-launch-funding-intent.v2",
      mode: "none",
      valueWei: "0",
    },
    liquidityModel: {
      schemaVersion: "programmable.custom-launch-liquidity-model.v1",
      model: "none-empty-pool",
      declaredLaunchState: "pool-not-initialized",
      targetIds: [],
    },
    agentAttestation: {
      agentId: "v4-pack-test",
      checkedAt: "2026-08-29T12:00:00.000Z",
      checks: [{ checkId: "exact-build", evidence: "evidence/build.json" }],
    },
  };
  const configPath = path.join(root, "programmable-launch.config.json");
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return { root, configPath };
}
