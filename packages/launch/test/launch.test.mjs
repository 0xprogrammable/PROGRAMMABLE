import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import solc from "solc";

import { statusLaunch, submitLaunch } from "../src/api-client.mjs";
import { HOOK_PERMISSION_BITS, HOOK_PERMISSIONS } from "../src/constants.mjs";
import { buildLaunch, packLaunch } from "../src/pack.mjs";
import { validateLaunchFile } from "../src/validate.mjs";

test("pack derives byte-identical exact-source requests from real solc output", async () => {
  const fixture = await materializeCompiledFixture();
  const first = await packLaunch({
    configPath: fixture.configPath,
    outputPath: path.join(fixture.root, "first-launch.json"),
  });
  const second = await packLaunch({
    configPath: fixture.configPath,
    outputPath: path.join(fixture.root, "second-launch.json"),
  });
  const firstBytes = await readFile(first.outputPath);
  const secondBytes = await readFile(second.outputPath);
  assert.deepEqual(firstBytes, secondBytes);
  assert.equal(first.requestSha256, second.requestSha256);
  assert.match(first.graphBundleHash, /^sha256:[0-9a-f]{64}$/);
  assert.match(first.verificationBundleHash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(first.predictions.length, 2);

  const validated = await validateLaunchFile({
    launchPath: first.outputPath,
    configPath: fixture.configPath,
  });
  assert.equal(validated.exactSourceIncluded, true);
  assert.equal(validated.reproducedFromConfig, true);
  assert.equal(validated.requestSha256, first.requestSha256);
});

test("submit persists exact bytes and retries ambiguity with the same key", async () => {
  const fixture = await materializeCompiledFixture();
  const packed = await packLaunch({ configPath: fixture.configPath });
  const stateDirectory = path.join(fixture.root, "state");
  const calls = [];
  const sleeps = [];
  const fetchImpl = async (_url, options) => {
    calls.push({
      body: Buffer.from(options.body),
      idempotencyKey: options.headers["idempotency-key"],
      authorization: options.headers.authorization,
    });
    if (calls.length === 1) throw new Error("socket closed after upload");
    return new Response(JSON.stringify({
      schemaVersion: "programmable.custom-launch.v1",
      launchId: "8d89c4e5-ec5f-4df7-8f52-10f134d25cab",
      requestId: "8d89c4e5-ec5f-4df7-8f52-10f134d25cab",
      status: "received",
    }), { status: 202, headers: { "content-type": "application/json" } });
  };
  const result = await submitLaunch({
    launchPath: packed.outputPath,
    configPath: fixture.configPath,
    idempotencyKey: "clean-room-retry-0001",
    apiOrigin: "http://127.0.0.1:43191",
    stateDirectory,
    maxAttempts: 2,
    fetchImpl,
    sleepImpl: async (milliseconds) => sleeps.push(milliseconds),
    loadApiKeyImpl: async () => "pm_live_publictest_secretvalue",
  });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].body, calls[1].body);
  assert.equal(calls[0].idempotencyKey, calls[1].idempotencyKey);
  assert.equal(sleeps.length, 1);
  assert.equal(result.httpStatus, 202);
  const journal = await readFile(result.journalPath, "utf8");
  assert.ok(journal.includes(packed.requestSha256));
  assert.ok(!journal.includes("pm_live_publictest_secretvalue"));
  assert.ok(!journal.toLowerCase().includes("authorization"));
});

test("submit refuses an idempotency key rebound to different request bytes", async () => {
  const fixture = await materializeCompiledFixture();
  const packed = await packLaunch({ configPath: fixture.configPath });
  const stateDirectory = path.join(fixture.root, "state-conflict");
  const fetchImpl = async () => new Response(JSON.stringify({
    requestId: "36dd2926-e4f0-445e-9503-46be9989c50f",
    launchId: "36dd2926-e4f0-445e-9503-46be9989c50f",
    status: "received",
  }), { status: 202, headers: { "content-type": "application/json" } });
  const common = {
    configPath: fixture.configPath,
    idempotencyKey: "binding-conflict-0001",
    apiOrigin: "http://localhost:43192",
    stateDirectory,
    maxAttempts: 1,
    fetchImpl,
    loadApiKeyImpl: async () => "pm_live_publictest_secretvalue",
  };
  await submitLaunch({ ...common, launchPath: packed.outputPath });
  const changedConfig = JSON.parse(await readFile(fixture.configPath, "utf8"));
  changedConfig.nonce = `0x${"45".repeat(32)}`;
  changedConfig.targets[1].applicantSalt = {
    mode: "deterministic-hook-permission-grind-v1",
    start: "0",
    maxAttempts: "262144",
  };
  await writeFile(fixture.configPath, `${JSON.stringify(changedConfig, null, 2)}\n`, "utf8");
  const alternate = path.join(fixture.root, "alternate-launch.json");
  await packLaunch({ configPath: fixture.configPath, outputPath: alternate });
  await assert.rejects(
    () => submitLaunch({ ...common, launchPath: alternate }),
    /IDEMPOTENCY_BINDING_CONFLICT/,
  );
});

test("submit refuses network access without an artifact-bound config", async () => {
  const fixture = await materializeCompiledFixture();
  const packed = await packLaunch({ configPath: fixture.configPath });
  let networkCalls = 0;
  await assert.rejects(
    () => submitLaunch({
      launchPath: packed.outputPath,
      fetchImpl: async () => {
        networkCalls += 1;
        throw new Error("unreachable");
      },
      loadApiKeyImpl: async () => "pm_live_publictest_secretvalue",
    }),
    /submit requires --config/,
  );
  assert.equal(networkCalls, 0);
});

test("status honors Retry-After and stops at the wallet handoff", async () => {
  const httpDate = new Date(Date.now() + 60_000).toUTCString();
  const responses = [
    new Response(JSON.stringify({ error: { code: "RATE_LIMIT", requestId: "support-1" } }), {
      status: 429,
      headers: { "retry-after": "2", "content-type": "application/json" },
    }),
    new Response(JSON.stringify({ error: { code: "TEMPORARY", requestId: "support-2" } }), {
      status: 503,
      headers: { "retry-after": httpDate, "content-type": "application/json" },
    }),
    new Response(JSON.stringify({
      requestId: "836b6989-bac4-4f39-98ab-828c7231fbf1",
      launchId: "836b6989-bac4-4f39-98ab-828c7231fbf1",
      status: "authorized",
      output: {
        walletTransaction: {
          chainId: "1",
          from: "0x1111111111111111111111111111111111111111",
          to: "0x8622DD5bAb44185f2A458ac90384Ac99248f8d56",
          valueWei: "0",
          data: "0xe5f6b8cd",
        },
      },
    }), { status: 200, headers: { "content-type": "application/json" } }),
  ];
  const sleeps = [];
  const result = await statusLaunch({
    requestId: "836b6989-bac4-4f39-98ab-828c7231fbf1",
    watch: true,
    until: "authorized",
    apiOrigin: "http://127.0.0.1:43193",
    maxAttempts: 3,
    fetchImpl: async () => responses.shift(),
    sleepImpl: async (milliseconds) => sleeps.push(milliseconds),
    loadApiKeyImpl: async () => "pm_live_publictest_secretvalue",
  });
  assert.equal(result.walletHandoffReady, true);
  assert.equal(result.stopped, true);
  assert.equal(sleeps[0], 2_000);
  assert.ok(sleeps[1] >= 58_000 && sleeps[1] <= 60_000);
});

test("the bundled no-broadcast example derives a real graph and deterministic hook salt", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "programmable-no-broadcast-"));
  const projectDirectory = path.join(root, "project");
  const exampleRoot = new URL("../examples/no-broadcast/", import.meta.url);
  await cp(new URL("project/", exampleRoot), projectDirectory, { recursive: true });
  const repositoryRoot = path.resolve(process.cwd(), "../..");
  const revision = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  }).trim();
  execFileSync(process.execPath, [new URL("prepare-config.mjs", exampleRoot).pathname, projectDirectory], {
    env: {
      ...process.env,
      PROGRAMMABLE_LAUNCH_WALLET: "0x1111111111111111111111111111111111111111",
      PROGRAMMABLE_LAUNCH_NONCE: `0x${"91".repeat(32)}`,
      PROGRAMMABLE_SOURCE_REVISION: revision,
      PROGRAMMABLE_CHECKED_AT: "2026-08-25T12:00:00.000Z",
    },
    encoding: "utf8",
  });
  const configPath = path.join(projectDirectory, "programmable-launch.config.json");
  const first = await packLaunch({
    configPath,
    outputPath: path.join(projectDirectory, "first.json"),
  });
  const second = await packLaunch({
    configPath,
    outputPath: path.join(projectDirectory, "second.json"),
  });
  assert.deepEqual(await readFile(first.outputPath), await readFile(second.outputPath));
  const request = JSON.parse(await readFile(first.outputPath, "utf8"));
  const hook = request.graphBundle.targets.find(({ targetId }) => targetId === "hook");
  assert.match(hook.applicantSalt, /^0x[0-9a-f]{64}$/);
  const prediction = first.predictions.find(({ targetId }) => targetId === "hook");
  assert.equal(
    Number(BigInt(prediction.predictedAddress) & 0x3fffn),
    1 << HOOK_PERMISSION_BITS.afterInitialize,
  );
  assert.equal(request.verificationBundle.components.length, 2);
});

async function materializeCompiledFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "programmable-launch-cli-"));
  await mkdir(path.join(root, "src"), { recursive: true });
  await mkdir(path.join(root, "out"), { recursive: true });
  const sources = {
    "src/Token.sol": {
      content: "// SPDX-License-Identifier: UNLICENSED\npragma solidity 0.8.26; contract Token { function marker() external pure returns (uint256) { return 1; } }\n",
    },
    "src/Hook.sol": {
      content: "// SPDX-License-Identifier: UNLICENSED\npragma solidity 0.8.26; contract Hook { constructor(address token, string memory label, uint256 amount) { require(token != address(0)); require(bytes(label).length > 0); require(amount > 0); } function marker() external pure returns (uint256) { return 2; } }\n",
    },
  };
  for (const [sourcePath, { content }] of Object.entries(sources)) {
    await writeFile(path.join(root, sourcePath), content, "utf8");
  }
  const standardJson = {
    language: "Solidity",
    sources,
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "cancun",
      metadata: { bytecodeHash: "ipfs", appendCBOR: true, useLiteralContent: true },
      libraries: {},
      remappings: [],
      outputSelection: {
        "*": { "*": ["abi", "evm.bytecode", "evm.deployedBytecode", "metadata"] },
      },
    },
  };
  const standardJsonPath = path.join(root, "standard-json-input.json");
  await writeFile(standardJsonPath, `${JSON.stringify(standardJson)}\n`, "utf8");
  const output = JSON.parse(solc.compile(JSON.stringify(standardJson)));
  const errors = (output.errors ?? []).filter(({ severity }) => severity === "error");
  assert.deepEqual(errors, []);
  for (const [sourcePath, contractName] of [
    ["src/Token.sol", "Token"],
    ["src/Hook.sol", "Hook"],
  ]) {
    const contract = output.contracts[sourcePath][contractName];
    const artifact = {
      abi: contract.abi,
      bytecode: contract.evm.bytecode,
      deployedBytecode: contract.evm.deployedBytecode,
      metadata: contract.metadata,
    };
    await writeFile(
      path.join(root, "out", `${contractName}.json`),
      `${JSON.stringify(artifact)}\n`,
      "utf8",
    );
  }
  await writeFile(path.join(root, "compiler-evidence.json"), `${JSON.stringify({
    compilerVersion: solc.version(),
    errorCount: errors.length,
  })}\n`, "utf8");
  const repositoryRoot = path.resolve(process.cwd(), "../..");
  const revision = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  }).trim();
  const configPath = path.join(root, "programmable-launch.config.json");
  const config = {
    schemaVersion: "programmable.launch-pack-config.v1",
    launchWallet: "0x1111111111111111111111111111111111111111",
    chainId: "1",
    nonce: `0x${"44".repeat(32)}`,
    source: {
      root: ".",
      paths: ["src"],
      sourceLineageNonce: "1",
      publicOrigin: {
        url: "https://github.com/0xprogrammable/PROGRAMMABLE",
        revision,
      },
    },
    compilationUnits: [{
      compilationUnitId: "fixture-solc",
      standardJson: "standard-json-input.json",
    }],
    targets: [
      {
        targetId: "token",
        compilationUnitId: "fixture-solc",
        artifact: "out/Token.json",
        applicantSalt: `0x${"00".repeat(32)}`,
        constructorArguments: [],
        initializer: null,
        deploymentValueWei: "0",
        initializerValueWei: "0",
        componentKind: "token",
        declaredHookPermissions: null,
      },
      {
        targetId: "hook",
        compilationUnitId: "fixture-solc",
        artifact: "out/Hook.json",
        applicantSalt: `0x${"01".repeat(32)}`,
        constructorArguments: [{ target: "token" }, "123", "123"],
        initializer: null,
        deploymentValueWei: "0",
        initializerValueWei: "0",
        componentKind: "hook",
        declaredHookPermissions: [],
      },
    ],
    pool: { tokenTargetId: "token", hookTargetId: "hook", fee: 3_000, tickSpacing: 60 },
    agentAttestation: {
      agentId: "public-cli-test",
      checkedAt: "2026-08-25T12:00:00.000Z",
      checks: [{ checkId: "exact-solc-compilation", evidence: "compiler-evidence.json" }],
    },
  };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  try {
    await buildLaunch({ configPath });
  } catch (error) {
    const match = /HOOK_PERMISSION_ADDRESS_MISMATCH:.*mask ([0-9]+), declared/.exec(error.message);
    if (!match) throw error;
    const mask = Number(match[1]);
    config.targets[1].declaredHookPermissions = HOOK_PERMISSIONS.filter(
      (permission) => (mask & (1 << HOOK_PERMISSION_BITS[permission])) !== 0,
    );
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  }
  await buildLaunch({ configPath });
  return { root, configPath };
}
