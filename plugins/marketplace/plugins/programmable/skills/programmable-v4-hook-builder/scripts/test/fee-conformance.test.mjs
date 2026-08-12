import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  PROGRAMMABLE_FEE_OWNER,
  PROGRAMMABLE_FEE_POLICY_HASH,
  REQUIRED_EVIDENCE_SCENARIOS,
  collectionPathFor,
  computeExactOutputFeeSplit,
  computeGrossFeeSplit,
  createFeeConformanceManifest,
  sha256File,
  validateFeeConformance
} from "../fee-conformance-core.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(testDirectory, "../..");
const referenceRoot = path.join(
  skillRoot,
  "assets/reference-kernels/programmable-volume-fee-v1"
);
const cliPath = path.join(skillRoot, "scripts/fee-conformance.mjs");

test("fee math enforces the non-additive 10 bps floor", () => {
  assert.equal(
    PROGRAMMABLE_FEE_POLICY_HASH,
    "0x72fea66c0711467846f805d8dbe08e5243460ef604cbf3c2626c011c0c0fdac6"
  );
  for (const selected of [0n, 500n, 1_000n]) {
    const split = computeGrossFeeSplit(1_000_000n, selected);
    assert.equal(split.effectiveHundredthsOfBip, 1_000n);
    assert.equal(split.totalFee, 1_000n);
    assert.equal(split.programmableFee, 1_000n);
    assert.equal(split.projectFee, 0n);
  }

  const threePercent = computeGrossFeeSplit(1_000_000n, 30_000n);
  assert.equal(threePercent.effectiveHundredthsOfBip, 30_000n);
  assert.equal(threePercent.totalFee, 30_000n);
  assert.equal(threePercent.programmableFee, 1_000n);
  assert.equal(threePercent.projectFee, 29_000n);

  const roundingBoundary = computeGrossFeeSplit(1_001n, 1_999n);
  assert.equal(roundingBoundary.totalFee, 1n);
  assert.equal(roundingBoundary.programmableFee, 1n);
  assert.equal(roundingBoundary.projectFee, 0n);
});

test("cumulative remainders resist small-swap fragmentation without platform over-rounding", () => {
  let state = { programmableFeeRemainder: 0n, projectFeeRemainder: 0n };
  let programmable = 0n;
  let project = 0n;
  for (let index = 0; index < 1_000; index += 1) {
    const split = computeGrossFeeSplit(1_999n, 30_000n, state);
    programmable += split.programmableFee;
    project += split.projectFee;
    state = {
      programmableFeeRemainder: split.programmableFeeRemainder,
      projectFeeRemainder: split.projectFeeRemainder
    };
  }
  const cumulativeGross = 1_999n * 1_000n;
  assert.equal(programmable, cumulativeGross * 1_000n / 1_000_000n);
  assert.equal(project, cumulativeGross * 29_000n / 1_000_000n);
  assert.equal(programmable, 1_999n);
  assert.ok(state.programmableFeeRemainder < 1_000_000n);
  assert.ok(state.projectFeeRemainder < 1_000_000n);

  const exactOutput = computeExactOutputFeeSplit(9_999n, 30_000n, state);
  assert.equal(exactOutput.grossQuoteAmount - exactOutput.totalFee, 9_999n);
});

test("fee math rejects dust and preserves exact-output net under integer rounding", () => {
  assert.throws(() => computeGrossFeeSplit(999n, 0n), /fee quantum/);
  const threshold = computeGrossFeeSplit(1_000n, 0n);
  assert.equal(threshold.programmableFee, 1n);
  const exactOutputThreshold = computeExactOutputFeeSplit(999n, 0n);
  assert.equal(exactOutputThreshold.grossQuoteAmount, 1_000n);
  assert.equal(exactOutputThreshold.programmableFee, 1n);
  assert.throws(() => computeExactOutputFeeSplit(1n, 0n), /fee quantum|cannot be represented/);

  for (const selected of [0n, 1_000n, 1_137n, 30_000n, 100_000n]) {
    for (const net of [1_000n, 1_001n, 9_999n, 1_000_000n]) {
      const split = computeExactOutputFeeSplit(net, selected);
      assert.equal(split.grossQuoteAmount - split.totalFee, net);
      assert.equal(split.totalFee, split.projectFee + split.programmableFee);
      assert.equal(split.programmableFee, (split.grossQuoteAmount * 1_000n) / 1_000_000n);
      assert.ok(split.programmableFee > 0n);
    }
  }
});

test("quadrant routing covers both quote-currency positions", () => {
  const expectedCurrency0 = ["before", "after", "after", "before"];
  const expectedCurrency1 = ["after", "before", "before", "after"];
  const quadrants = [
    { zeroForOne: true, exactInput: true },
    { zeroForOne: true, exactInput: false },
    { zeroForOne: false, exactInput: true },
    { zeroForOne: false, exactInput: false }
  ];
  for (const [index, quadrant] of quadrants.entries()) {
    assert.match(
      collectionPathFor({ quoteIsCurrency0: true, ...quadrant }),
      new RegExp(`^${expectedCurrency0[index]}-swap-return-delta$`)
    );
    assert.match(
      collectionPathFor({ quoteIsCurrency0: false, ...quadrant }),
      new RegExp(`^${expectedCurrency1[index]}-swap-return-delta$`)
    );
  }
});

test("a fully bound reference-shaped fixture passes only structural conformance", (t) => {
  const fixture = createFixture(t);
  const result = validateFeeConformance({ root: fixture.root, manifestPath: fixture.manifestPath });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.status, "STRUCTURALLY_CONFORMANT_REFERENCE_CANDIDATE");
  assert.equal(result.assurance, "structural-only-not-an-audit");
  assert.equal(result.evidenceTrust, "builder-supplied-untrusted");
  assert.match(result.warnings.join("\n"), /not a security audit/i);
});

test("an empty Observer cannot claim fee compliance with fabricated ABI, bytecode and passing evidence", (t) => {
  const fixture = createFixture(t, { emptyObserver: true });
  const result = validateFeeConformance({ root: fixture.root, manifestPath: fixture.manifestPath });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /exact Programmable fee owner/);
  assert.match(result.errors.join("\n"), /compiler AST is missing required function/);
  assert.match(result.errors.join("\n"), /source must implement _beforeSwap/);
});

test("candidate integrity changes fail closed", (t) => {
  const fixture = createFixture(t);
  fs.appendFileSync(fixture.sourcePath, "\n// post-build tamper\n");
  const result = validateFeeConformance({ root: fixture.root, manifestPath: fixture.manifestPath });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /source SHA-256 does not match manifest/);
});

test("fee policy hash must be exact in both source and ABI", (t) => {
  const fixture = createFixture(t);
  const source = fs.readFileSync(fixture.sourcePath, "utf8").replace(
    'keccak256("programmable-volume-fee-v1")',
    'keccak256("wrong-fee-policy")'
  );
  fs.writeFileSync(fixture.sourcePath, source);

  const artifact = JSON.parse(fs.readFileSync(fixture.artifactPath, "utf8"));
  artifact.abi = artifact.abi.filter((entry) => entry.name !== "PROGRAMMABLE_FEE_POLICY_HASH");
  fs.writeFileSync(fixture.artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);

  const buildInfo = JSON.parse(fs.readFileSync(fixture.buildInfoPath, "utf8"));
  buildInfo.input.sources[fixture.sourceRelative].content = source;
  buildInfo.output.contracts[fixture.sourceRelative][fixture.contractName].abi = artifact.abi;
  fs.writeFileSync(fixture.buildInfoPath, `${JSON.stringify(buildInfo, null, 2)}\n`);

  const evidence = JSON.parse(fs.readFileSync(fixture.evidencePath, "utf8"));
  evidence.integrity.sourceSha256 = sha256File(fixture.sourcePath);
  evidence.integrity.artifactSha256 = sha256File(fixture.artifactPath);
  evidence.integrity.buildInfoSha256 = sha256File(fixture.buildInfoPath);
  fs.writeFileSync(fixture.evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  writeManifest(fixture);

  const result = validateFeeConformance({ root: fixture.root, manifestPath: fixture.manifestPath });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /source must expose PROGRAMMABLE_FEE_POLICY_HASH/);
  assert.match(result.errors.join("\n"), /ABI is missing function PROGRAMMABLE_FEE_POLICY_HASH/);
});

test("the standard reference cannot silently enable dynamic LP fees or unguarded registration", (t) => {
  const fixture = createFixture(t);
  const source = fs.readFileSync(fixture.sourcePath, "utf8")
    .replace("if (!key.fee.isValid() || key.fee > MAX_EXACT_OUTPUT_COMPATIBLE_LP_FEE) revert InvalidLpFee(key.fee);", "if (!key.fee.isDynamicFee() && !key.fee.isValid()) revert InvalidLpFee(key.fee);")
    .replace("external nonReentrant returns (bytes32 poolId, int24 initialTick)", "external returns (bytes32 poolId, int24 initialTick)");
  fs.writeFileSync(fixture.sourcePath, source);
  const buildInfo = JSON.parse(fs.readFileSync(fixture.buildInfoPath, "utf8"));
  buildInfo.input.sources[fixture.sourceRelative].content = source;
  fs.writeFileSync(fixture.buildInfoPath, `${JSON.stringify(buildInfo, null, 2)}\n`);
  writeManifest(fixture);

  const result = validateFeeConformance({ root: fixture.root, manifestPath: fixture.manifestPath });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /above 999998 pips/);
  assert.match(result.errors.join("\n"), /guard.*against reentry/);
});

test("missing adversarial evidence and upgraded audit claims fail", (t) => {
  const fixture = createFixture(t);
  const evidence = JSON.parse(fs.readFileSync(fixture.evidencePath, "utf8"));
  evidence.auditStatus = "audited";
  evidence.scenarios = evidence.scenarios.filter((entry) => entry.id !== "canonical-pool-only");
  fs.writeFileSync(fixture.evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  writeManifest(fixture);

  const result = validateFeeConformance({ root: fixture.root, manifestPath: fixture.manifestPath });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /not-independently-audited/);
  assert.match(result.errors.join("\n"), /missing required evidence scenario canonical-pool-only/);
});

test("evidence cannot name a test absent from compiler build info", (t) => {
  const fixture = createFixture(t);
  const evidence = JSON.parse(fs.readFileSync(fixture.evidencePath, "utf8"));
  evidence.scenarios[0].test = "FeeFixtureTest::testNotCompiled";
  fs.writeFileSync(fixture.evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  writeManifest(fixture);

  const result = validateFeeConformance({ root: fixture.root, manifestPath: fixture.manifestPath });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /absent from compiler build info/);
});

test("candidate paths cannot escape the declared root", (t) => {
  const fixture = createFixture(t);
  const manifest = JSON.parse(fs.readFileSync(fixture.manifestPath, "utf8"));
  manifest.contract.source.path = "../outside.sol";
  fs.writeFileSync(fixture.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const result = validateFeeConformance({ root: fixture.root, manifestPath: fixture.manifestPath });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /must stay inside the candidate root/);
});

test("CLI exposes the audit boundary in help", () => {
  const result = childProcess.spawnSync(process.execPath, [cliPath, "--help"], { encoding: "utf8" });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /not an audit/i);
  assert.match(result.stdout, /isolated maintainer rebuild/i);
});

test("CLI refuses to write a manifest through a symbolic output directory", (t) => {
  const fixture = createFixture(t);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-fee-outside-"));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  const link = path.join(fixture.root, "linked-output");
  try {
    fs.symlinkSync(outside, link, "dir");
  } catch (error) {
    if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) {
      t.skip(`symbolic links unavailable: ${error.code}`);
      return;
    }
    throw error;
  }

  const result = childProcess.spawnSync(process.execPath, [
    cliPath,
    "create",
    "--root", fixture.root,
    "--source", fixture.sourceRelative,
    "--artifact", fixture.artifactRelative,
    "--build-info", fixture.buildInfoRelative,
    "--evidence", fixture.evidenceRelative,
    "--contract", fixture.contractName,
    "--supporting-source", `hook-factory:${fixture.factoryRelative}`,
    "--out", "linked-output/manifest.json"
  ], { encoding: "utf8" });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /may not contain symbolic links/);
  assert.equal(fs.existsSync(path.join(outside, "manifest.json")), false);
});

function createFixture(t, { emptyObserver = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-fee-conformance-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.mkdirSync(path.join(root, "out"), { recursive: true });
  fs.mkdirSync(path.join(root, "evidence"), { recursive: true });

  const contractName = emptyObserver ? "Observer" : "ProgrammableVolumeFeeHookV1";
  const sourceRelative = `src/${contractName}.sol`;
  const sourcePath = path.join(root, sourceRelative);
  const factoryRelative = "src/ProgrammableVolumeFeeHookFactoryV1.sol";
  const factoryPath = path.join(root, factoryRelative);
  const artifactRelative = `out/${contractName}.json`;
  const artifactPath = path.join(root, artifactRelative);
  const buildInfoRelative = "out/build-info.json";
  const buildInfoPath = path.join(root, buildInfoRelative);
  const evidenceRelative = "evidence/fee-conformance-evidence.json";
  const evidencePath = path.join(root, evidenceRelative);
  const manifestPath = path.join(root, "fee-conformance.json");

  const source = emptyObserver
    ? "// SPDX-License-Identifier: MIT\npragma solidity 0.8.26;\ncontract Observer {}\n"
    : fs.readFileSync(path.join(referenceRoot, "src/ProgrammableVolumeFeeHookV1.sol"), "utf8");
  const factory = fs.readFileSync(
    path.join(referenceRoot, "src/ProgrammableVolumeFeeHookFactoryV1.sol"),
    "utf8"
  );
  fs.writeFileSync(sourcePath, source);
  fs.writeFileSync(factoryPath, factory);

  const abi = completeAbi();
  const bytecode = `0x${"60".repeat(700)}`;
  const artifact = { abi, deployedBytecode: { object: bytecode } };
  fs.writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);

  const astFunctions = emptyObserver
    ? []
    : [
        "registerCanonicalPool",
        "claimProgrammableFees",
        "claimProjectFees",
        "getHookPermissions",
        "_beforeSwap",
        "_afterSwap",
        "unlockCallback"
      ];
  const testSourceRelative = "test/FeeFixtureTest.t.sol";
  const testFunctionNames = REQUIRED_EVIDENCE_SCENARIOS.map((_, index) => `testScenario${index}`);
  const testSource = `contract FeeFixtureTest { ${testFunctionNames.map((name) => `function ${name}() external {}`).join(" ")} }`;
  const buildInfo = {
    language: "Solidity",
    solcVersion: "0.8.26",
    solcLongVersion: "0.8.26+commit.8a97fa7a",
    input: {
      language: "Solidity",
      sources: {
        [sourceRelative]: { content: source },
        [testSourceRelative]: { content: testSource }
      }
    },
    output: {
      sources: {
        [sourceRelative]: {
          ast: {
            nodeType: "SourceUnit",
            nodes: [
              {
                nodeType: "ContractDefinition",
                name: contractName,
                nodes: astFunctions.map((name) => ({ nodeType: "FunctionDefinition", name }))
              }
            ]
          }
        },
        [testSourceRelative]: {
          ast: {
            nodeType: "SourceUnit",
            nodes: [
              {
                nodeType: "ContractDefinition",
                name: "FeeFixtureTest",
                nodes: testFunctionNames.map((name) => ({ nodeType: "FunctionDefinition", name }))
              }
            ]
          }
        }
      },
      contracts: {
        [sourceRelative]: {
          [contractName]: { abi, evm: { deployedBytecode: { object: bytecode } } }
        }
      }
    }
  };
  fs.writeFileSync(buildInfoPath, `${JSON.stringify(buildInfo, null, 2)}\n`);

  const evidence = {
    schemaVersion: "programmable-fee-conformance-evidence-v1",
    evidenceLevel: "builder-supplied-local-untrusted",
    auditStatus: "not-independently-audited",
    deploymentStatus: "not-deployed",
    runner: { tool: "forge", version: "fixture", command: "forge test -vvv", exitCode: 0 },
    integrity: {
      sourceSha256: sha256File(sourcePath),
      artifactSha256: sha256File(artifactPath),
      buildInfoSha256: sha256File(buildInfoPath),
      supportingSources: [{ role: "hook-factory", sha256: sha256File(factoryPath) }]
    },
    scenarios: REQUIRED_EVIDENCE_SCENARIOS.map((id, index) => ({
      id,
      status: "passed",
      test: `FeeFixtureTest::testScenario${index}`
    }))
  };
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);

  const fixture = {
    root,
    contractName,
    sourceRelative,
    sourcePath,
    factoryRelative,
    factoryPath,
    artifactRelative,
    artifactPath,
    buildInfoRelative,
    buildInfoPath,
    evidenceRelative,
    evidencePath,
    manifestPath
  };
  writeManifest(fixture);
  return fixture;
}

function writeManifest(fixture) {
  const manifest = createFeeConformanceManifest({
    root: fixture.root,
    source: fixture.sourceRelative,
    artifact: fixture.artifactRelative,
    buildInfo: fixture.buildInfoRelative,
    evidence: fixture.evidenceRelative,
    contractName: fixture.contractName,
    supportingSources: [{ role: "hook-factory", path: fixture.factoryRelative }]
  });
  fs.writeFileSync(fixture.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

function completeAbi() {
  const functions = [
    "PROGRAMMABLE_FEE_OWNER",
    "PROGRAMMABLE_FEE_POLICY_HASH",
    "PROGRAMMABLE_HUNDREDTHS_OF_BIP",
    "MINIMUM_EFFECTIVE_HUNDREDTHS_OF_BIP",
    "MAX_SELECTED_HUNDREDTHS_OF_BIP",
    "MAX_EXACT_OUTPUT_COMPATIBLE_LP_FEE",
    "canonicalPoolId",
    "canonicalPoolRegistered",
    "quoteCurrencyAddress",
    "programmableFeeRemainder",
    "projectFeeRemainder",
    "claimableLiability",
    "registerCanonicalPool",
    "effectiveTotalHundredthsOfBip",
    "quoteGrossFees",
    "quoteExactOutputFees",
    "claimProjectFees",
    "getHookPermissions"
  ].map((name) => ({
    type: "function",
    name,
    stateMutability: "view",
    inputs: [],
    outputs: name === "PROGRAMMABLE_FEE_OWNER"
      ? [{ name: "", type: "address" }]
      : name === "PROGRAMMABLE_FEE_POLICY_HASH"
        ? [{ name: "", type: "bytes32" }]
        : name === "PROGRAMMABLE_HUNDREDTHS_OF_BIP"
          ? [{ name: "", type: "uint32" }]
          : []
  }));
  functions.push({
    type: "function",
    name: "claimProgrammableFees",
    stateMutability: "nonpayable",
    inputs: [{ name: "recipient", type: "address" }],
    outputs: [{ name: "amount", type: "uint256" }]
  });
  const events = [
    "CanonicalPoolRegistered",
    "QuoteFeesAccrued",
    "ProgrammableFeesClaimed",
    "ProjectFeesClaimed"
  ].map((name) => ({ type: "event", name, inputs: [], anonymous: false }));
  const errors = ["PartialFillUnsupported", "QuoteAmountBelowFeeQuantum", "UnauthorizedClaim"]
    .map((name) => ({ type: "error", name, inputs: [] }));
  return [...functions, ...events, ...errors, {
    type: "function",
    name: "feeOwnerEcho",
    stateMutability: "pure",
    inputs: [],
    outputs: [{ type: "address", name: PROGRAMMABLE_FEE_OWNER }]
  }];
}
