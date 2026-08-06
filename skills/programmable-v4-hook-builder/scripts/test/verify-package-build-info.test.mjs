import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { applyRepositoryClosureToReport } from "../closure-report-core.mjs";
import { analyzeRepositoryClosure } from "../review-target-core.mjs";
import { analyzeSubmission } from "../submission-core.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(testDirectory, "..", "..");
const verifier = path.join(skillRoot, "scripts", "verify-package.mjs");
const schema = readJson(path.join(skillRoot, "references", "submission.schema.json"));
const template = readJson(path.join(skillRoot, "assets", "templates", "submission.example.json"));
const compilerLock = readJson(path.join(skillRoot, "assets", "templates", "dependency-lock.example.json"));
const trustedRemappings = [
  "@uniswap/v4-core/=lib/v4-core/",
  "forge-std/=lib/forge-std/src/"
];
const hookSource = "// SPDX-License-Identifier: MIT\npragma solidity 0.8.26;\ncontract IntakeHook {}\n";
const testSource = "// SPDX-License-Identifier: MIT\npragma solidity 0.8.26;\ncontract IntakeHookTest {}\n";

test("validates build-info source content against the fresh review target", () => {
  const fixture = createFixture();
  try {
    mutateBuildInfo(fixture, (buildInfo) => {
      buildInfo.input.sources[fixture.hookPath].content += "// compiler input was changed\n";
    });

    const result = runVerifier(fixture);
    const report = parseReport(result);

    assert.equal(result.status, 1, result.stderr);
    assert.ok(
      report.errors.includes(
        `build info: build info source byte count differs from review target: ${fixture.hookPath}`
      ),
      JSON.stringify(report.errors)
    );
    assert.ok(
      report.errors.includes(
        `build info: build info source hash differs from review target: ${fixture.hookPath}`
      ),
      JSON.stringify(report.errors)
    );
  } finally {
    fixture.cleanup();
  }
});

test("binds build-info to the locked compiler and trusted ordered remappings", () => {
  const fixture = createFixture();
  try {
    mutateBuildInfo(fixture, (buildInfo) => {
      buildInfo.input.settings.optimizer.runs = 200;
      buildInfo.input.settings.remappings.reverse();
    });

    const result = runVerifier(fixture);
    const report = parseReport(result);

    assert.equal(result.status, 1, result.stderr);
    assert.ok(
      report.errors.includes(
        "build info: build info optimizer.runs must equal declared compiler optimizerRuns 1000"
      ),
      JSON.stringify(report.errors)
    );
    assert.ok(
      report.errors.includes(
        "build info: build info remappings differ from repository path metadata"
      ),
      JSON.stringify(report.errors)
    );
  } finally {
    fixture.cleanup();
  }
});

test("rejects a forged long compiler version that only shares the declared release prefix", () => {
  const fixture = createFixture();
  try {
    mutateBuildInfo(fixture, (buildInfo) => {
      buildInfo.solcLongVersion = "0.8.26+evil";
    });

    const result = runVerifier(fixture);
    const report = parseReport(result);

    assert.equal(result.status, 1, result.stderr);
    assert.ok(
      report.errors.includes(
        "build info: build info solcLongVersion must equal canonical compiler identity 0.8.26+commit.8a97fa7a"
      ),
      JSON.stringify(report.errors)
    );
  } finally {
    fixture.cleanup();
  }
});

test("rejects compiler evidence with missing AST, contract or bytecode outputs", async (t) => {
  const cases = [
    {
      name: "AST",
      mutate: (buildInfo, fixture) => {
        delete buildInfo.output.sources[fixture.hookPath].ast;
      },
      error: (fixture) =>
        `build info: build info output source is missing a Solidity SourceUnit AST: ${fixture.hookPath}`
    },
    {
      name: "contracts",
      mutate: (buildInfo) => {
        buildInfo.output.contracts = {};
      },
      error: (fixture) =>
        `build info: build info output is missing contract IntakeHook from ${fixture.hookPath}`
    },
    {
      name: "bytecode",
      mutate: (buildInfo, fixture) => {
        buildInfo.output.contracts[fixture.hookPath].IntakeHook.evm.bytecode.object = "";
      },
      error: (fixture) =>
        `build info: build info output contract has no creation bytecode: ${fixture.hookPath}:IntakeHook`
    }
  ];

  for (const fixtureCase of cases) {
    await t.test(fixtureCase.name, () => {
      const fixture = createFixture();
      try {
        mutateBuildInfo(fixture, (buildInfo) => {
          fixtureCase.mutate(buildInfo, fixture);
        });

        const result = runVerifier(fixture);
        const report = parseReport(result);

        assert.equal(result.status, 1, result.stderr);
        assert.ok(
          report.errors.includes(fixtureCase.error(fixture)),
          JSON.stringify(report.errors)
        );
      } finally {
        fixture.cleanup();
      }
    });
  }
});

test("prototype intake requires exactly one declared compiler build-info path", async (t) => {
  for (const [label, paths] of [
    ["none", []],
    ["two", [
      "submissions/build-info-fixture/evidence/build-info.json",
      "submissions/build-info-fixture/evidence/second-build-info.json"
    ]]
  ]) {
    await t.test(label, () => {
      const fixture = createFixture({ compilerBuildInfoPaths: paths });
      try {
        const result = runVerifier(fixture);
        const report = parseReport(result);

        assert.equal(result.status, 1, result.stderr);
        assert.ok(
          report.errors.includes(
            "build info: prototype must declare exactly one implementation.compilerBuildInfoPaths entry"
          ),
          JSON.stringify(report.errors)
        );
      } finally {
        fixture.cleanup();
      }
    });
  }
});

test("no-hook prototype verifier does not require Solidity or Foundry resources", () => {
  const fixture = createFixture({ compilerBuildInfoPaths: [] });
  try {
    fs.unlinkSync(path.join(fixture.repositoryRoot, "foundry.toml"));
    fs.unlinkSync(path.join(fixture.repositoryRoot, "remappings.txt"));
    const sourcePath = "submissions/build-info-fixture/app/launch.py";
    const testPath = "submissions/build-info-fixture/test/test_launch.py";
    fs.mkdirSync(path.dirname(path.join(fixture.repositoryRoot, sourcePath)), { recursive: true });
    fs.writeFileSync(path.join(fixture.repositoryRoot, sourcePath), "def launch():\n    return True\n");
    fs.writeFileSync(path.join(fixture.repositoryRoot, testPath), "def test_launch():\n    assert True\n");
    rewriteSubmission(fixture, (submission) => {
      submission.target.officialLaunchProfileId = "official-cca-lbp-new-token-ethereum";
      submission.target.solidityVersion = null;
      submission.target.evmVersion = null;
      submission.target.dependencyBaseline = null;
      submission.hook.used = false;
      submission.implementation.sourcePaths = [sourcePath];
      submission.implementation.testPaths = [testPath];
      submission.implementation.compilerBuildInfoPaths = [];
      submission.implementation.dependencyLockPath = null;
    });

    const result = runVerifier(fixture);
    const report = parseReport(result);

    assert.equal(result.status, 1, result.stderr);
    assert.equal(report.errors.some((message) => message.startsWith("build info:")), false, JSON.stringify(report.errors));
    assert.equal(report.errors.some((message) => /foundry\.toml|remappings\.txt/.test(message)), false, JSON.stringify(report.errors));
  } finally {
    fixture.cleanup();
  }
});

test("the exact declared build-info path gets a 64 MB pre-parse limit", () => {
  const fixture = createFixture();
  try {
    truncateFile(fixture.buildInfoFile, 64_000_001);

    const result = runVerifier(fixture);
    const report = parseReport(result);

    assert.equal(result.status, 1, result.stderr);
    assert.ok(
      report.errors.includes(
        `build info: implementation file exceeds the 64000000 byte review limit: ${fixture.buildInfoPath}`
      ),
      JSON.stringify(report.errors)
    );
    assert.doesNotMatch(result.stderr, /JSON|Unexpected token|heap|stack/i);
  } finally {
    fixture.cleanup();
  }
});

test("files other than the exact build-info path retain the 2 MB limit", () => {
  const fixture = createFixture();
  try {
    const oversized = path.join(fixture.packageRoot, "oversized-evidence.bin");
    truncateFile(oversized, 2_000_001);

    const result = runVerifier(fixture);
    const report = parseReport(result);

    assert.equal(result.status, 1, result.stderr);
    assert.ok(
      report.errors.includes(
        "package resource preflight: file exceeds the 2000000 byte review limit: oversized-evidence.bin"
      ),
      JSON.stringify(report.errors)
    );
  } finally {
    fixture.cleanup();
  }
});

test("normal package files retain a separate 20 MB aggregate limit", () => {
  const fixture = createFixture();
  try {
    const bulk = path.join(fixture.packageRoot, "bulk");
    fs.mkdirSync(bulk);
    for (let index = 0; index < 11; index += 1) {
      truncateFile(path.join(bulk, `${index}.bin`), 1_900_000);
    }

    const result = runVerifier(fixture);
    const report = parseReport(result);

    assert.equal(result.status, 1, result.stderr);
    assert.ok(
      report.errors.includes(
        "package resource preflight: normal files exceed the 20000000 byte review limit"
      ),
      JSON.stringify(report.errors)
    );
  } finally {
    fixture.cleanup();
  }
});

test("package traversal rejects more than 84 MB before parsing evidence", () => {
  const fixture = createFixture();
  try {
    truncateFile(fixture.buildInfoFile, 64_000_000);
    const bulk = path.join(fixture.packageRoot, "bulk");
    fs.mkdirSync(bulk);
    for (let index = 0; index < 11; index += 1) {
      truncateFile(path.join(bulk, `${index}.bin`), 1_900_000);
    }

    const result = runVerifier(fixture);

    assert.equal(result.status, 2, result.stderr);
    assert.match(
      result.stderr,
      /package resource preflight failed: package exceeds the 84000000 byte review limit/
    );
    assert.equal(result.stdout, "");
  } finally {
    fixture.cleanup();
  }
});

test("rejects declared build-info symlinks without following them", async (t) => {
  for (const [label, targetExists] of [
    ["outside repository", true],
    ["dangling", false]
  ]) {
    await t.test(label, () => {
      const fixture = createFixture();
      const outside = fs.mkdtempSync(
        path.join(os.tmpdir(), "programmable-build-info-outside-")
      );
      try {
        const outsideFile = path.join(outside, "build-info.json");
        if (targetExists) fs.copyFileSync(fixture.buildInfoFile, outsideFile);
        const linkedPath = "artifacts/build-info.json";
        const linkedFile = path.join(fixture.repositoryRoot, linkedPath);
        fs.mkdirSync(path.dirname(linkedFile));
        fs.symlinkSync(outsideFile, linkedFile);
        rewriteSubmission(fixture, (submission) => {
          submission.implementation.compilerBuildInfoPaths = [linkedPath];
        });

        const result = runVerifier(fixture);
        const report = parseReport(result);

        assert.equal(result.status, 1, result.stderr);
        assert.ok(
          report.errors.includes(
            `build info: implementation path contains a symbolic link: ${linkedPath}`
          ),
          JSON.stringify(report.errors)
        );
        assert.doesNotMatch(result.stderr, /at .*verify-package|node:fs|ENOENT/);
      } finally {
        fixture.cleanup();
        fs.rmSync(outside, { recursive: true, force: true });
      }
    });
  }
});

test("missing and escaping declared build-info paths return deterministic JSON errors", async (t) => {
  for (const [label, declaredPath, expected] of [
    [
      "missing",
      "artifacts/missing-build-info.json",
      "build info: implementation path does not exist: artifacts/missing-build-info.json"
    ],
    [
      "escaping",
      "../outside/build-info.json",
      "build info: invalid repository-relative path: ../outside/build-info.json"
    ]
  ]) {
    await t.test(label, () => {
      const fixture = createFixture();
      try {
        rewriteSubmission(fixture, (submission) => {
          submission.implementation.compilerBuildInfoPaths = [declaredPath];
        });

        const result = runVerifier(fixture);
        const report = parseReport(result);

        assert.equal(result.status, 1, result.stderr);
        assert.ok(report.errors.includes(expected), JSON.stringify(report.errors));
        assert.doesNotMatch(result.stderr, /at .*verify-package|node:fs|ENOENT/);
      } finally {
        fixture.cleanup();
      }
    });
  }
});

test("a missing ordinary declared repository path is reported in JSON without a stack trace", () => {
  const fixture = createFixture();
  try {
    rewriteSubmission(fixture, (submission) => {
      submission.implementation.specificationPath = "evidence/missing-specification.json";
    });

    const result = runVerifier(fixture);
    const report = parseReport(result);

    assert.equal(result.status, 1, result.stderr);
    assert.ok(
      report.errors.includes(
        "implementation path does not exist: evidence/missing-specification.json"
      ),
      JSON.stringify(report.errors)
    );
    assert.doesNotMatch(result.stderr, /at .*verify-package|node:fs|ENOENT/);
  } finally {
    fixture.cleanup();
  }
});

function createFixture({
  compilerBuildInfoPaths = [
    "submissions/build-info-fixture/evidence/build-info.json"
  ]
} = {}) {
  const repositoryRoot = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "programmable-build-info-intake-"))
  );
  const init = childProcess.spawnSync("git", ["-C", repositoryRoot, "init", "--quiet"], {
    encoding: "utf8",
    shell: false
  });
  assert.equal(init.status, 0, init.stderr);

  fs.writeFileSync(
    path.join(repositoryRoot, "foundry.toml"),
    [
      "[profile.default]",
      'src = "src"',
      'test = "test"',
      'script = "script"',
      'out = "out"',
      'libs = ["lib"]',
      'solc_version = "0.8.26"',
      'evm_version = "cancun"',
      "optimizer = true",
      "optimizer_runs = 1_000",
      'bytecode_hash = "none"',
      "cbor_metadata = false",
      "ffi = false",
      ""
    ].join("\n")
  );
  fs.writeFileSync(
    path.join(repositoryRoot, "remappings.txt"),
    `${trustedRemappings.join("\n")}\n`
  );

  const packagePath = "submissions/build-info-fixture";
  const packageRoot = path.join(repositoryRoot, packagePath);
  const sourceDirectory = path.join(packageRoot, "src");
  const testDirectoryPath = path.join(packageRoot, "test");
  const evidenceDirectory = path.join(packageRoot, "evidence");
  fs.mkdirSync(sourceDirectory, { recursive: true });
  fs.mkdirSync(testDirectoryPath);
  fs.mkdirSync(evidenceDirectory);

  for (const [name, contents] of [
    ["PROPOSAL.md", "# Build-info intake fixture\n"],
    ["THREAT_MODEL.md", "# Threat model\n"],
    ["TEST_PLAN.md", "# Test plan\n"],
    ["EVIDENCE.md", "# Evidence\n"]
  ]) {
    fs.writeFileSync(path.join(packageRoot, name), contents);
  }

  const hookPath = `${packagePath}/src/IntakeHook.sol`;
  const hookTestPath = `${packagePath}/test/IntakeHook.t.sol`;
  fs.writeFileSync(path.join(sourceDirectory, "IntakeHook.sol"), hookSource);
  fs.writeFileSync(path.join(testDirectoryPath, "IntakeHook.t.sol"), testSource);
  writeJson(path.join(evidenceDirectory, "dependency-lock.json"), compilerLock);

  const submission = structuredClone(template);
  submission.stage = "prototype";
  submission.builder = {
    github: "build-info-fixture",
    contact: "@build-info-fixture",
    beneficiary: null,
    licenseDeclaration:
      "The fixture author owns this test package and submits it under the repository license."
  };
  submission.implementation = {
    sourcePaths: [hookPath],
    testPaths: [hookTestPath],
    compilerBuildInfoPaths,
    specificationPath: null,
    testEvidencePath: null,
    dependencyLockPath: `${packagePath}/evidence/dependency-lock.json`,
    gateStatusPath: null,
    reviewTargetPath: null
  };
  writeSubmissionAndReport(repositoryRoot, packageRoot, submission);

  const buildInfoPath =
    compilerBuildInfoPaths[0] ?? `${packagePath}/evidence/build-info.json`;
  const buildInfoFile = path.join(repositoryRoot, buildInfoPath);
  if (compilerBuildInfoPaths.length > 0) {
    fs.mkdirSync(path.dirname(buildInfoFile), { recursive: true });
    writeJson(buildInfoFile, foundryBuildInfo({ hookPath, hookTestPath }));
  }
  if (compilerBuildInfoPaths.length > 1) {
    const second = path.join(repositoryRoot, compilerBuildInfoPaths[1]);
    fs.mkdirSync(path.dirname(second), { recursive: true });
    writeJson(second, foundryBuildInfo({ hookPath, hookTestPath }));
  }

  return {
    repositoryRoot,
    packageRoot,
    hookPath,
    buildInfoPath,
    buildInfoFile,
    cleanup() {
      fs.rmSync(repositoryRoot, { recursive: true, force: true });
    }
  };
}

function foundryBuildInfo({ hookPath, hookTestPath }) {
  return {
    id: "0123456789abcdef",
    source_id_to_path: {
      "0": hookPath,
      "1": hookTestPath
    },
    language: "Solidity",
    _format: "ethers-rs-sol-build-info-1",
    input: {
      language: "Solidity",
      sources: {
        [hookPath]: { content: hookSource },
        [hookTestPath]: { content: testSource }
      },
      settings: {
        remappings: [...trustedRemappings],
        optimizer: { enabled: true, runs: 1000 },
        evmVersion: "cancun",
        viaIR: false,
        metadata: {
          useLiteralContent: true,
          bytecodeHash: "none",
          appendCBOR: false
        },
        outputSelection: {
          "*": {
            "": ["ast"],
            "*": ["abi", "evm.bytecode.object"]
          }
        },
        libraries: {}
      }
    },
    output: {
      errors: [],
      sources: {
        [hookPath]: {
          id: 0,
          ast: sourceUnit(hookPath, contractDefinition("IntakeHook"))
        },
        [hookTestPath]: {
          id: 1,
          ast: sourceUnit(hookTestPath, contractDefinition("IntakeHookTest"))
        }
      },
      contracts: {
        [hookPath]: {
          IntakeHook: compiledContract("60006000")
        },
        [hookTestPath]: {
          IntakeHookTest: compiledContract("60016000")
        }
      }
    },
    solcLongVersion: "0.8.26+commit.8a97fa7a",
    solcVersion: "0.8.26"
  };
}

function sourceUnit(sourcePath, ...nodes) {
  return {
    absolutePath: sourcePath,
    id: 100,
    nodeType: "SourceUnit",
    nodes,
    src: "0:0:0"
  };
}

function contractDefinition(name) {
  return {
    abstract: false,
    contractKind: "contract",
    id: 101,
    name,
    nodeType: "ContractDefinition",
    nodes: [],
    src: "0:0:0"
  };
}

function compiledContract(bytecode) {
  return {
    abi: [],
    evm: {
      bytecode: {
        object: bytecode
      }
    }
  };
}

function rewriteSubmission(fixture, mutate) {
  const target = path.join(fixture.packageRoot, "submission.json");
  const submission = readJson(target);
  mutate(submission);
  writeSubmissionAndReport(fixture.repositoryRoot, fixture.packageRoot, submission);
}

function writeSubmissionAndReport(repositoryRoot, packageRoot, submission) {
  writeJson(path.join(packageRoot, "submission.json"), submission);
  const report = analyzeSubmission(submission, { schema });
  const closure = analyzeRepositoryClosure({ repositoryRoot, packageRoot, submission });
  writeJson(
    path.join(packageRoot, "compatibility-report.json"),
    applyRepositoryClosureToReport(report, closure, { stage: submission.stage })
  );
}

function mutateBuildInfo(fixture, mutate) {
  const buildInfo = readJson(fixture.buildInfoFile);
  mutate(buildInfo);
  writeJson(fixture.buildInfoFile, buildInfo);
}

function runVerifier(fixture) {
  return childProcess.spawnSync(
    process.execPath,
    [
      verifier,
      "--repository-root",
      fixture.repositoryRoot,
      fixture.packageRoot
    ],
    {
      cwd: fixture.repositoryRoot,
      encoding: "utf8",
      shell: false,
      maxBuffer: 10_000_000
    }
  );
}

function parseReport(result) {
  assert.notEqual(result.stdout, "", result.stderr);
  return JSON.parse(result.stdout);
}

function truncateFile(target, size) {
  const descriptor = fs.openSync(target, "w");
  try {
    fs.ftruncateSync(descriptor, size);
  } finally {
    fs.closeSync(descriptor);
  }
}

function readJson(target) {
  return JSON.parse(fs.readFileSync(target, "utf8"));
}

function writeJson(target, value) {
  fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
}
