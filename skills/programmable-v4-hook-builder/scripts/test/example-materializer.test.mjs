import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  materializeExample,
  materializeImplementationLegoExample
} from "../example-materializer-core.mjs";
import {
  materializeTradableReferenceKernel,
  prepareIsolatedSolidityCompilerCacheV1
} from "../v4-deployment-evidence-core.mjs";
import { validateAgainstSchema } from "../submission-core.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(testDirectory, "..", "..");
const cliPath = path.join(skillRoot, "scripts", "materialize-example.mjs");
const schema = readJson(path.join(skillRoot, "references", "submission.schema.json"));

const expectedExamples = [
  "dynamic-lp-fee",
  "managed-usdc-quote",
  "transparent-pool-scoped-fee",
  "unsafe-hidden-curve"
];

test("materializes the real V2 trade kernel byte-identically without approval claims", () => {
  const first = path.join(os.tmpdir(), `programmable-v2-kernel-a-${process.pid}-${Date.now()}`);
  const second = path.join(os.tmpdir(), `programmable-v2-kernel-b-${process.pid}-${Date.now()}`);
  try {
    const left = materializeTradableReferenceKernel({ skillRoot, outputRoot: first });
    const right = materializeTradableReferenceKernel({ skillRoot, outputRoot: second });

    assert.equal(left.status, "NOT_APPROVED");
    assert.equal(left.assurance, "REFERENCE_KERNEL_SOURCE_AND_TESTS_ONLY");
    assert.equal(left.inventorySha256, "sha256:3324a4bc09c058f97ff03e17dd02ac9fe34e8e2aeb63684ff575ba808496f475");
    assert.equal(left.inventorySha256, right.inventorySha256);
    assert.deepEqual(left.files, right.files);
    const repositoryRoot = path.resolve(skillRoot, "..", "..");
    const relativeKernelRoot = "skills/programmable-v4-hook-builder/assets/reference-kernels/programmable-volume-fee-v2";
    const shipped = spawnSync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", relativeKernelRoot],
      { cwd: repositoryRoot, encoding: "buffer", shell: false }
    );
    assert.equal(shipped.status, 0, shipped.stderr.toString("utf8"));
    const shippedPrefix = `${relativeKernelRoot}/`;
    const shippedPaths = shipped.stdout.toString("utf8").split("\0").filter(Boolean)
      .map((filePath) => {
        assert.equal(filePath.startsWith(shippedPrefix), true);
        return filePath.slice(shippedPrefix.length);
      })
      .sort((leftPath, rightPath) => leftPath.localeCompare(rightPath));
    assert.deepEqual(left.files.map(({ path: filePath }) => filePath), shippedPaths);
    assert.deepEqual(left.routeProfile.modes, [
      "zero-for-one-exact-input",
      "zero-for-one-exact-output",
      "one-for-zero-exact-input",
      "one-for-zero-exact-output"
    ]);
    assert.equal(left.routeProfile.quoteEntrypoint.includes("V4Quoter"), true);
    assert.equal(left.routeProfile.executionEntrypoint, "UniversalRouter.execute");
    assert.equal(left.routeProfile.erc20Funding, "Permit2 allowance transfer");
    assert.equal(left.routeProfile.nativeExactOutputRefund, "Universal Router SWEEP to msg.sender");
    assert.match(left.routeProfile.hookData, /bounded-swap-witness.*ABI uint256.*exactly 32 bytes.*no identity, authentication or replay semantics/u);
    assert.equal(left.routeProfile.executionDeltaBinding, "gross witness and fee reconciled to executed quote delta");
    assert.equal(left.routeProfile.partialFillPolicy, "rejected-before-effects");
    assert.equal(left.routeImplementationPath, "src/ProgrammableVolumeFeeHookV2.sol");

    for (const file of left.files) {
      assert.deepEqual(fs.readFileSync(path.join(first, file.path)), fs.readFileSync(path.join(second, file.path)));
    }
    const packageJson = readJson(path.join(first, "package.json"));
    assert.equal(packageJson.private, true);
    assert.match(packageJson.scripts.test, /sdk-routing-parity/u);
    assert.match(packageJson.scripts.test, /forge test/u);
    assert.equal(packageJson.dependencies["@uniswap/v4-core"], "1.0.2");
    assert.equal(packageJson.dependencies["@uniswap/v4-periphery"], "1.0.3");
    assert.equal(packageJson.dependencies["@uniswap/universal-router"], "2.1.0");
    assert.equal(packageJson.dependencies["@uniswap/v4-sdk"], "2.3.1");

    const routeImplementation = fs.readFileSync(path.join(first, left.routeImplementationPath), "utf8");
    assert.match(routeImplementation, /contract ProgrammableVolumeFeeHookV2 is BaseHook/u);
    assert.match(routeImplementation, /function _beforeSwap/u);
    assert.match(routeImplementation, /function _afterSwap/u);
    const routerFixture = fs.readFileSync(path.join(first, "test/helpers/UniversalRouterV4Fixture.sol"), "utf8");
    assert.match(routerFixture, /V4Quoter/u);
    assert.match(routerFixture, /IAllowanceTransfer/u);
    assert.match(routerFixture, /Commands\.SWEEP/u);
    assert.match(routerFixture, /Actions\.SWAP_EXACT_IN_SINGLE/u);
    assert.match(routerFixture, /Actions\.SWAP_EXACT_OUT_SINGLE/u);
    const nativeRoute = fs.readFileSync(path.join(first, "test/ProgrammableVolumeFeeHookV2UniversalRouterNative.t.sol"), "utf8");
    assert.match(nativeRoute, /amountInMaximum - quotedAmountIn/u);
    assert.match(nativeRoute, /expectedRefund/u);
    assert.match(nativeRoute, /assertEq\(address\(universalRouter\)\.balance, 0\)/u);
    assert.match(
      nativeRoute,
      /function _evidenceQuoteAndEmit[\s\S]*?if \(mode == 1\) assertEq\(_fixedWitnessProjectOutput\(\), specified, "typed exact-output witness mismatch"\);\s*bytes32 stateBefore = _evidenceQuoteStateDigest\(\);\s*uint256 quoted = _evidenceQuote\(mode, specified\);/u
    );
    assert.doesNotMatch(JSON.stringify(left), /\bAPPROVED\b(?!.*NOT_APPROVED)/u);
  } finally {
    fs.rmSync(first, { recursive: true, force: true });
    fs.rmSync(second, { recursive: true, force: true });
  }
});

test("reference-kernel materialization rejects existing destinations and inventory drift", (t) => {
  const existing = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-v2-existing-"));
  assert.throws(
    () => materializeTradableReferenceKernel({ skillRoot, outputRoot: existing }),
    /must not already exist/u
  );

  const copiedSkill = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-v2-drift-"));
  t.after(() => {
    fs.rmSync(existing, { recursive: true, force: true });
    fs.rmSync(copiedSkill, { recursive: true, force: true });
  });
  const copiedKernel = path.join(copiedSkill, "assets", "reference-kernels", "programmable-volume-fee-v2");
  fs.mkdirSync(path.dirname(copiedKernel), { recursive: true });
  materializeTradableReferenceKernel({ skillRoot, outputRoot: copiedKernel });
  for (const directory of ["node_modules", "cache", "out"]) {
    fs.mkdirSync(path.join(copiedKernel, directory), { recursive: true });
    fs.writeFileSync(path.join(copiedKernel, directory, "ignored-dust"), directory);
  }
  const dustOutput = path.join(copiedSkill, "dust-output");
  const dust = materializeTradableReferenceKernel({ skillRoot: copiedSkill, outputRoot: dustOutput });
  assert.equal(dust.inventorySha256, "sha256:3324a4bc09c058f97ff03e17dd02ac9fe34e8e2aeb63684ff575ba808496f475");
  for (const directory of ["node_modules", "cache", "out"]) assert.equal(fs.existsSync(path.join(dustOutput, directory)), false);
  fs.appendFileSync(path.join(copiedKernel, "README.md"), "drift\n");
  assert.throws(
    () => materializeTradableReferenceKernel({ skillRoot: copiedSkill, outputRoot: path.join(copiedSkill, "drift-output") }),
    /inventory drift/u
  );
});

test("isolated Solidity cache discovers macOS svm and explicit SVM_HOME compilers", (t) => {
  const sourceHome = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-macos-solc-source-"));
  const explicitSvmHome = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-explicit-solc-source-"));
  const macOnlyTarget = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-macos-solc-target-"));
  const explicitTarget = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-explicit-solc-target-"));
  t.after(() => {
    for (const directory of [sourceHome, explicitSvmHome, macOnlyTarget, explicitTarget]) fs.rmSync(directory, { recursive: true, force: true });
  });
  const macSvmHome = path.join(sourceHome, "Library", "Application Support", "svm");
  for (const version of ["0.8.17", "0.8.26"]) writeExecutableCompiler(macSvmHome, version, `mac-${version}`);
  prepareIsolatedSolidityCompilerCacheV1(macOnlyTarget, { homeDirectory: sourceHome, svmHome: null });
  for (const version of ["0.8.17", "0.8.26"]) {
    assert.equal(
      fs.realpathSync(path.join(macOnlyTarget, ".svm", version, `solc-${version}`)),
      fs.realpathSync(path.join(macSvmHome, version, `solc-${version}`))
    );
  }

  for (const version of ["0.8.17", "0.8.26"]) writeExecutableCompiler(explicitSvmHome, version, `explicit-${version}`);
  prepareIsolatedSolidityCompilerCacheV1(explicitTarget, { homeDirectory: null, svmHome: explicitSvmHome });
  for (const version of ["0.8.17", "0.8.26"]) {
    assert.equal(
      fs.realpathSync(path.join(explicitTarget, ".svm", version, `solc-${version}`)),
      fs.realpathSync(path.join(explicitSvmHome, version, `solc-${version}`))
    );
  }
});

test("lists packaged scenario patches in stable order", () => {
  const result = runCli("--list");

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.stdout.trim().split("\n"), expectedExamples);
});

test("prints concise help without reading or writing an example", () => {
  const result = runCli("--help");

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage: materialize-example\.mjs/);
  assert.match(result.stdout, /--example <id>/);
  assert.equal(result.stderr, "");
});

test("materializes every step as a complete schema-valid submission", () => {
  const fixturesDirectory = path.join(skillRoot, "assets", "examples");

  for (const exampleId of expectedExamples) {
    const fixture = readJson(path.join(fixturesDirectory, `${exampleId}.json`));

    for (const step of fixture.steps) {
      const result = runCli("--example", exampleId, "--step", step.id);
      assert.equal(result.status, 0, `${exampleId}/${step.id}: ${result.stderr}`);

      const submission = JSON.parse(result.stdout);
      assert.deepEqual(
        validateAgainstSchema(submission, schema),
        [],
        `${exampleId}/${step.id} must satisfy the submission schema`
      );
      assert.equal("steps" in submission, false);
      assert.equal("expected" in submission, false);
      assert.equal(submission.schemaVersion, 1);
      assert.equal(submission.model.id.length > 0, true);
      assert.match(submission.pool.minimumInitialLiquidity, /^[1-9][0-9]*$/u);
      assert.ok(BigInt(submission.pool.minimumInitialLiquidity) <= (1n << 128n) - 1n);
      assert.match(submission.launchPlan.targetStrategy, /^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
      assert.equal(submission.launchPlan.executorVersion, "launch-authorization-executor-v1");
      assert.equal(submission.launchPlan.poolMustBeUninitialized, true);
      assert.equal(submission.launchPlan.postAcceptanceBundleRequired, true);
      for (const field of ["callDataSourcePaths", "hookConfigurationSourcePaths", "liquiditySourcePaths", "testPaths"]) {
        assert.equal(Array.isArray(submission.launchPlan[field]), true, `${exampleId}/${step.id} ${field}`);
      }
    }
  }
});

test("writes byte-identical output for the same example and step", () => {
  const firstDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-example-a-"));
  const secondDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-example-b-"));
  const firstOutput = path.join(firstDirectory, "submission.json");
  const secondOutput = path.join(secondDirectory, "submission.json");

  try {
    const first = runCli(
      "--example",
      "dynamic-lp-fee",
      "--step",
      "fully-specified",
      "--output",
      firstOutput
    );
    const second = runCli(
      "--example",
      "dynamic-lp-fee",
      "--step",
      "fully-specified",
      "--output",
      secondOutput
    );

    assert.equal(first.status, 0, first.stderr);
    assert.equal(second.status, 0, second.stderr);
    assert.equal(fs.readFileSync(firstOutput, "utf8"), fs.readFileSync(secondOutput, "utf8"));
  } finally {
    fs.rmSync(firstDirectory, { recursive: true, force: true });
    fs.rmSync(secondDirectory, { recursive: true, force: true });
  }
});

test("rejects path traversal and unknown steps without creating output", () => {
  const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-example-reject-"));
  const outputPath = path.join(outputDirectory, "submission.json");

  try {
    const traversal = runCli(
      "--example",
      "../templates/submission.example",
      "--output",
      outputPath
    );
    assert.notEqual(traversal.status, 0);
    assert.match(traversal.stderr, /example id/i);
    assert.equal(fs.existsSync(outputPath), false);

    const unknownStep = runCli(
      "--example",
      "dynamic-lp-fee",
      "--step",
      "missing",
      "--output",
      outputPath
    );
    assert.notEqual(unknownStep.status, 0);
    assert.match(unknownStep.stderr, /step/i);
    assert.equal(fs.existsSync(outputPath), false);
  } finally {
    fs.rmSync(outputDirectory, { recursive: true, force: true });
  }
});

test("reports the schema code and path for an invalid scenario patch", () => {
  const isolatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-example-schema-"));
  const examplesDirectory = path.join(isolatedRoot, "assets", "examples");
  const templatesDirectory = path.join(isolatedRoot, "assets", "templates");
  const referencesDirectory = path.join(isolatedRoot, "references");

  try {
    fs.mkdirSync(examplesDirectory, { recursive: true });
    fs.mkdirSync(templatesDirectory, { recursive: true });
    fs.mkdirSync(referencesDirectory, { recursive: true });
    fs.copyFileSync(
      path.join(skillRoot, "assets", "templates", "submission.example.json"),
      path.join(templatesDirectory, "submission.example.json")
    );
    fs.copyFileSync(
      path.join(skillRoot, "references", "submission.schema.json"),
      path.join(referencesDirectory, "submission.schema.json")
    );
    fs.writeFileSync(
      path.join(examplesDirectory, "invalid-summary.json"),
      `${JSON.stringify({
        fixtureVersion: 1,
        id: "invalid-summary",
        name: "invalid summary",
        description: "This scenario intentionally exceeds one schema limit.",
        steps: [{
          id: "too-long",
          patch: { model: { summary: "x".repeat(501) } },
          expected: {}
        }]
      }, null, 2)}\n`
    );

    assert.throws(
      () => materializeExample({
        skillRoot: isolatedRoot,
        exampleId: "invalid-summary",
        stepId: "too-long"
      }),
      (error) => {
        assert.match(error.message, /SCHEMA_MAX_LENGTH/);
        assert.match(error.message, /\$\.model\.summary/);
        return true;
      }
    );
  } finally {
    fs.rmSync(isolatedRoot, { recursive: true, force: true });
  }
});

test("the positive custom-accounting example exposes the complete accounting boundary", () => {
  const result = runCli(
    "--example",
    "transparent-pool-scoped-fee",
    "--step",
    "fully-specified"
  );
  assert.equal(result.status, 0, result.stderr);

  const submission = JSON.parse(result.stdout);
  const quadrants = submission.hook.feeMechanism.swapQuadrants;
  assert.deepEqual(Object.keys(quadrants).sort(), [
    "oneForZeroExactInput",
    "oneForZeroExactOutput",
    "zeroForOneExactInput",
    "zeroForOneExactOutput"
  ]);
  assert.equal(Object.values(quadrants).every((quadrant) => quadrant !== null), true);
  assert.equal(submission.hook.customAccounting.used, true);
  assert.deepEqual(submission.hook.customAccounting.liabilityKeyDimensions, [
    "poolId",
    "currency",
    "beneficiary"
  ]);
  assert.equal(submission.hook.customAccounting.crossPoolNetting, false);
  assert.equal(submission.integration.dataReconstruction.reserveReconstruction.used, true);
  assert.deepEqual(
    submission.integration.dataReconstruction.reserveReconstruction.attributionKeys,
    ["poolId", "currency", "beneficiary"]
  );
  assert.equal(submission.capabilities.externalCalls.used, true);
  assert.deepEqual(submission.risk.featureTriggers, [
    "custom-accounting",
    "external-calls",
    "price-impact",
    "return-delta"
  ]);
  assert.match(
    quadrants.zeroForOneExactOutput.formula,
    /1000000 minus 1000/
  );
  assert.equal(submission.hook.erc6909Claims.used, false);
  assert.equal(submission.security.hiddenControls, false);
});

test("implementation Lego examples materialize in memory without writes or allowlisting", () => {
  const before = new Set(fs.readdirSync(skillRoot));
  const example = materializeImplementationLegoExample({
    skillRoot,
    starterId: "custom-hook",
    packIds: ["v4-swap-client"],
    customCapabilities: [{ id: "unknown-game-mode", label: "Unknown game mode" }]
  });
  assert.equal(example.kind, "programmable-implementation-lego-example");
  assert.deepEqual(example.plan.implementationLegos.entries.map(({ id }) => id), [
    "v4-swap-frontend-adapter"
  ]);
  assert.deepEqual(example.plan.machineCapabilities.ownerDefinedCapabilityIds, ["unknown-game-mode"]);
  assert.equal(
    example.files.some(({ path: filePath }) => filePath === "implementation/v4-swap-frontend-adapter/src/swapAdapter.ts"),
    true
  );
  assert.deepEqual(new Set(fs.readdirSync(skillRoot)), before);
});

function runCli(...args) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: skillRoot,
    encoding: "utf8"
  });
}

function writeExecutableCompiler(root, version, marker) {
  const directory = path.join(root, version);
  fs.mkdirSync(directory, { recursive: true });
  const compiler = path.join(directory, `solc-${version}`);
  fs.writeFileSync(compiler, `#!/bin/sh\n# ${marker}\nexit 0\n`, { mode: 0o755 });
  fs.chmodSync(compiler, 0o755);
}

function readJson(target) {
  return JSON.parse(fs.readFileSync(target, "utf8"));
}
