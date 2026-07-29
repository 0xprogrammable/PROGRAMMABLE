import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import Ajv from "ajv";
import {
  getContractAddress,
  keccak256,
} from "viem";

import {
  DEEP_V3_ARTIFACTS,
  DEEP_V3_FIXED_POLICY,
  DEEP_V3_KEEPER_POLICY,
  DEEP_V3_MANIFEST_PATH,
  DEEP_V3_OPS_V2_PROJECTION_INPUT_PATHS,
  DEEP_V3_OPS_V2_RUNTIME_DEPENDENCIES,
  DEEP_V3_OPS_V2_SOURCE_PATHS,
  DEEP_V3_RUNTIME_FIELDS,
  DEEP_V3_SCHEMA_PATH,
  DEEP_V3_TRANSACTION_FIELDS,
  assessDeepV3LiveManifest,
  assertDeepV3ArtifactRuntimeBinding,
  assertDeepV3EtherscanBuildInput,
  assertDeepV3EtherscanStandardJsonMatches,
  buildDeepV3OpsV2Projection,
  buildDeepV3DeploymentPlan,
  computeDeepV3OpsV2SourceCommitment,
  computeDeepV3SourceCommitment,
  deepV3ArtifactRuntime,
  deepV3ConstructorBindings,
  encodeDeepV3ConstructorArguments,
  expectedDeepV3HookDeploymentInput,
  expectedDeepV3TransactionInput,
} from "../deep-full-range-release-v3-core.mjs";

const root = path.resolve(import.meta.dirname, "../../..");
const deployer = "0xDeef000000000000000000000000000000000003";
const hookSalt =
  "0x0000000000000000000000000000000000000000000000000000000000000993";
const manifest = JSON.parse(
  readFileSync(path.join(root, DEEP_V3_MANIFEST_PATH), "utf8"),
);
const cachedStandardJson = new Map();

function copyOpsCommitmentInputs(temporaryRoot) {
  for (const relativePath of new Set([
    ...DEEP_V3_OPS_V2_SOURCE_PATHS,
    ...DEEP_V3_OPS_V2_PROJECTION_INPUT_PATHS,
  ])) {
    const destination = path.join(temporaryRoot, relativePath);
    mkdirSync(path.dirname(destination), { recursive: true });
    cpSync(path.join(root, relativePath), destination);
  }
}

function mutateJson(temporaryRoot, relativePath, mutate) {
  const file = path.join(temporaryRoot, relativePath);
  const value = JSON.parse(readFileSync(file, "utf8"));
  mutate(value);
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function withTemporaryOpsRoot(run) {
  const temporaryRoot = mkdtempSync(
    path.join(os.tmpdir(), "programmable-deep-v3-ops-"),
  );
  try {
    copyOpsCommitmentInputs(temporaryRoot);
    return run(temporaryRoot);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function standardJson(field) {
  if (!cachedStandardJson.has(field)) {
    const result = spawnSync(
      "forge",
      [
        "verify-contract",
        "--show-standard-json-input",
        "0x1111111111111111111111111111111111111111",
        DEEP_V3_ARTIFACTS[field].fqcn,
      ],
      {
        cwd: path.join(root, "contracts"),
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      },
    );
    assert.equal(result.status, 0, result.stderr);
    cachedStandardJson.set(field, JSON.parse(result.stdout));
  }
  return structuredClone(cachedStandardJson.get(field));
}

test("source commitment exactly matches the reviewed Solidity deployment commitment", () => {
  assert.equal(
    computeDeepV3SourceCommitment(root),
    "0xc375eef30da88e2402c52f1c54641f44ed447e536055d46563d01cc85868337c",
  );
  assert.equal(manifest.sourceCommitment, computeDeepV3SourceCommitment(root));
});

test("ops v2 commitment hashes the exact reviewed source allowlist and detects file drift", () => {
  assert.deepEqual(
    DEEP_V3_OPS_V2_SOURCE_PATHS,
    [...DEEP_V3_OPS_V2_SOURCE_PATHS].sort(),
  );
  assert.equal(
    new Set(DEEP_V3_OPS_V2_SOURCE_PATHS).size,
    DEEP_V3_OPS_V2_SOURCE_PATHS.length,
  );
  assert.deepEqual(DEEP_V3_OPS_V2_PROJECTION_INPUT_PATHS, [
    "package-lock.json",
    "package.json",
    "vercel.json",
  ]);
  assert.deepEqual(DEEP_V3_OPS_V2_RUNTIME_DEPENDENCIES, [
    "@privy-io/node",
    "@vercel/blob",
    "next",
    "server-only",
    "viem",
  ]);
  for (const projected of DEEP_V3_OPS_V2_PROJECTION_INPUT_PATHS) {
    assert.ok(
      !DEEP_V3_OPS_V2_SOURCE_PATHS.includes(projected),
      projected,
    );
  }
  for (const required of [
    "app/api/ops/deep-v3-keeper-v2/route.ts",
    "app/api/ops/deep-v3-keeper-v2/handler.ts",
    "app/api/ops/deep-v3-keeper-v2/storage.ts",
    "ops/deep-keeper-v3/config-v2.mjs",
    "ops/deep-keeper-v3/control-v2.mjs",
    "ops/deep-keeper-v3/core-v2.mjs",
    "ops/deep-keeper-v3/privy-wallet-v2.mjs",
    "ops/deep-keeper-v3/release-gate-v2.mjs",
  ]) {
    assert.ok(DEEP_V3_OPS_V2_SOURCE_PATHS.includes(required), required);
  }

  const projection = buildDeepV3OpsV2Projection(root);
  assert.deepEqual(
    projection.dependencies.seeds.map(({ name }) => name),
    DEEP_V3_OPS_V2_RUNTIME_DEPENDENCIES,
  );
  assert.equal(projection.dependencies.lockfileVersion, 3);
  assert.equal(projection.dependencies.closure.length, 158);
  assert.equal(
    projection.dependencies.closure.reduce(
      (total, dependency) => total + dependency.edges.length,
      0,
    ),
    373,
  );
  assert.equal(
    projection.dependencies.closure
      .flatMap(({ edges }) => edges)
      .filter(({ kind }) => kind === "optional-peer").length,
    47,
  );
  assert.deepEqual(
    projection.dependencies.closure.map(({ path }) => path),
    projection.dependencies.closure
      .map(({ path }) => path)
      .sort(),
  );
  assert.equal(
    new Set(
      projection.dependencies.closure.map(({ path }) => path),
    ).size,
    projection.dependencies.closure.length,
  );
  for (const dependency of projection.dependencies.closure) {
    assert.match(dependency.version, /^\S+$/);
    assert.match(dependency.resolved, /^https:\/\//);
    assert.match(dependency.integrity, /^sha512-/);
  }
  assert.deepEqual(projection.schedule, {
    path: "/api/ops/deep-v3-keeper-v2",
    schedule: "*/5 * * * *",
  });

  const original = computeDeepV3OpsV2SourceCommitment(root);
  assert.match(original, /^0x[0-9a-f]{64}$/);
  withTemporaryOpsRoot((temporaryRoot) => {
    assert.equal(
      computeDeepV3OpsV2SourceCommitment(temporaryRoot),
      original,
    );
    const driftPath = path.join(
      temporaryRoot,
      "ops/deep-keeper-v3/core-v2.mjs",
    );
    writeFileSync(
      driftPath,
      `${readFileSync(driftPath, "utf8")}\n// source drift\n`,
    );
    assert.notEqual(
      computeDeepV3OpsV2SourceCommitment(temporaryRoot),
      original,
    );
  });
});

test("ops v2 projection ignores unrelated scripts, dependencies and crons", () => {
  const original = computeDeepV3OpsV2SourceCommitment(root);
  withTemporaryOpsRoot((temporaryRoot) => {
    mutateJson(temporaryRoot, "package.json", (packageJson) => {
      packageJson.scripts["contracts:stock-paired:review"] =
        "node scripts/review-stock-paired.mjs";
      packageJson.dependencies["stock-paired-helper"] = "1.0.0";
    });
    mutateJson(
      temporaryRoot,
      "package-lock.json",
      (packageLock) => {
        packageLock.packages[""].dependencies[
          "stock-paired-helper"
        ] = "1.0.0";
        packageLock.packages[
          "node_modules/stock-paired-helper"
        ] = {
          version: "1.0.0",
          resolved:
            "https://registry.npmjs.org/stock-paired-helper/-/stock-paired-helper-1.0.0.tgz",
          integrity:
            "sha512-unrelated-stock-paired-test-package",
        };
      },
    );
    mutateJson(temporaryRoot, "vercel.json", (vercel) => {
      vercel.crons.push({
        path: "/api/ops/stock-paired",
        schedule: "7 * * * *",
      });
    });
    assert.equal(
      computeDeepV3OpsV2SourceCommitment(temporaryRoot),
      original,
    );
  });
});

test("ops v2 projection fails on root declaration and runtime import drift", () => {
  withTemporaryOpsRoot((temporaryRoot) => {
    mutateJson(
      temporaryRoot,
      "package-lock.json",
      (packageLock) => {
        packageLock.lockfileVersion = 2;
      },
    );
    assert.throws(
      () => computeDeepV3OpsV2SourceCommitment(temporaryRoot),
      /requires package-lock\.json lockfileVersion 3/,
    );
  });
  withTemporaryOpsRoot((temporaryRoot) => {
    mutateJson(temporaryRoot, "package-lock.json", (packageLock) => {
      packageLock.packages[""].dependencies.viem = "2.55.4";
    });
    assert.throws(
      () => computeDeepV3OpsV2SourceCommitment(temporaryRoot),
      /viem root range mismatch/,
    );
  });
  withTemporaryOpsRoot((temporaryRoot) => {
    mutateJson(temporaryRoot, "package.json", (packageJson) => {
      packageJson.devDependencies.viem =
        packageJson.dependencies.viem;
    });
    assert.throws(
      () => computeDeepV3OpsV2SourceCommitment(temporaryRoot),
      /viem must appear once in package\.json dependencies/,
    );
  });
  withTemporaryOpsRoot((temporaryRoot) => {
    mutateJson(
      temporaryRoot,
      "package-lock.json",
      (packageLock) => {
        packageLock.packages[""].devDependencies ??= {};
        packageLock.packages[""].devDependencies.viem =
          packageLock.packages[""].dependencies.viem;
      },
    );
    assert.throws(
      () => computeDeepV3OpsV2SourceCommitment(temporaryRoot),
      /viem must appear once in the lockfile root dependencies/,
    );
  });
  withTemporaryOpsRoot((temporaryRoot) => {
    mutateJson(temporaryRoot, "package.json", (packageJson) => {
      delete packageJson.dependencies["server-only"];
    });
    assert.throws(
      () => computeDeepV3OpsV2SourceCommitment(temporaryRoot),
      /server-only must appear once in package\.json dependencies/,
    );
  });
  withTemporaryOpsRoot((temporaryRoot) => {
    const source = path.join(
      temporaryRoot,
      "ops/deep-keeper-v3/core-v2.mjs",
    );
    writeFileSync(
      source,
      `${readFileSync(source, "utf8")}\nimport "left-pad";\n`,
    );
    assert.throws(
      () => computeDeepV3OpsV2SourceCommitment(temporaryRoot),
      /external dependency drift/,
    );
  });
});

test("ops v2 projection binds every reachable transitive package", () => {
  const original = computeDeepV3OpsV2SourceCommitment(root);
  const projection = buildDeepV3OpsV2Projection(root);
  const seedPaths = new Set(
    projection.dependencies.seeds.map(({ path }) => path),
  );
  const transitive = projection.dependencies.closure.find(
    ({ path: packagePath }) => !seedPaths.has(packagePath),
  );
  assert.ok(transitive);

  withTemporaryOpsRoot((temporaryRoot) => {
    mutateJson(
      temporaryRoot,
      "package-lock.json",
      (packageLock) => {
        packageLock.packages[transitive.path].integrity +=
          "-transitive-drift";
      },
    );
    assert.notEqual(
      computeDeepV3OpsV2SourceCommitment(temporaryRoot),
      original,
    );
  });
  withTemporaryOpsRoot((temporaryRoot) => {
    mutateJson(
      temporaryRoot,
      "package-lock.json",
      (packageLock) => {
        delete packageLock.packages[transitive.path].integrity;
      },
    );
    assert.throws(
      () => computeDeepV3OpsV2SourceCommitment(temporaryRoot),
      /integrity must be a non-empty string/,
    );
  });
  withTemporaryOpsRoot((temporaryRoot) => {
    mutateJson(
      temporaryRoot,
      "package-lock.json",
      (packageLock) => {
        delete packageLock.packages[transitive.path];
      },
    );
    assert.throws(
      () => computeDeepV3OpsV2SourceCommitment(temporaryRoot),
      /missing from the resolved closure|must be an object/,
    );
  });
  withTemporaryOpsRoot((temporaryRoot) => {
    mutateJson(
      temporaryRoot,
      "package-lock.json",
      (packageLock) => {
        packageLock.packages["node_modules/viem"].dependencies.viem =
          "*";
      },
    );
    assert.throws(
      () => computeDeepV3OpsV2SourceCommitment(temporaryRoot),
      /dependency closure contains a cycle/,
    );
  });
});

test("ops v2 projection binds build and five-minute writer semantics", () => {
  withTemporaryOpsRoot((temporaryRoot) => {
    mutateJson(temporaryRoot, "package.json", (packageJson) => {
      packageJson.scripts.prebuild = "true";
    });
    assert.throws(
      () => computeDeepV3OpsV2SourceCommitment(temporaryRoot),
      /script drift: prebuild/,
    );
  });
  withTemporaryOpsRoot((temporaryRoot) => {
    mutateJson(temporaryRoot, "vercel.json", (vercel) => {
      const cron = vercel.crons.find(
        ({ path: cronPath }) =>
          cronPath === "/api/ops/deep-v3-keeper-v2",
      );
      cron.schedule = "*/10 * * * *";
    });
    assert.throws(
      () => computeDeepV3OpsV2SourceCommitment(temporaryRoot),
      /cron policy drift/,
    );
  });
  withTemporaryOpsRoot((temporaryRoot) => {
    mutateJson(temporaryRoot, "vercel.json", (vercel) => {
      vercel.crons.push({
        path: "/api/ops/deep-v3-keeper",
        schedule: "* * * * *",
      });
    });
    assert.throws(
      () => computeDeepV3OpsV2SourceCommitment(temporaryRoot),
      /legacy writer remains scheduled/,
    );
  });
});

test("the deployment plan is exactly six transactions and nine runtime identities", () => {
  const plan = buildDeepV3DeploymentPlan(deployer, 0, hookSalt, root);
  assert.equal(plan.transactionCount, 6);
  assert.equal(DEEP_V3_TRANSACTION_FIELDS.length, 6);
  assert.equal(DEEP_V3_RUNTIME_FIELDS.length, 9);
  assert.equal(
    plan.zapPlanner,
    getContractAddress({ from: deployer, nonce: 0n, opcode: "CREATE" }),
  );
  assert.equal(
    plan.growthVaultFactory,
    getContractAddress({ from: deployer, nonce: 1n, opcode: "CREATE" }),
  );
  assert.equal(
    plan.hookFactory,
    getContractAddress({ from: deployer, nonce: 2n, opcode: "CREATE" }),
  );
  assert.equal(
    plan.launcher,
    getContractAddress({ from: deployer, nonce: 4n, opcode: "CREATE" }),
  );
  assert.equal(
    plan.keeperExecutor,
    getContractAddress({ from: deployer, nonce: 5n, opcode: "CREATE" }),
  );
  assert.equal(BigInt(plan.feeHook) & ((1n << 14n) - 1n), 0x3aecn);
  assert.equal(new Set(DEEP_V3_RUNTIME_FIELDS.map((field) => plan[field])).size, 9);
});

test("constructor and transaction inputs bind every generated child", () => {
  const plan = buildDeepV3DeploymentPlan(deployer, 0, hookSalt, root);
  const candidate = { hookSalt, addresses: plan };
  const bindings = deepV3ConstructorBindings(candidate);
  assert.deepEqual(bindings.growthVaultFactory.values, [plan.zapPlanner]);
  assert.deepEqual(bindings.growthVaultImplementation.values, [
    plan.growthVaultFactory,
  ]);
  assert.deepEqual(bindings.automation.values, [
    plan.growthVaultFactory,
    plan.launcher,
  ]);
  assert.deepEqual(bindings.keeperExecutor.values, [plan.automation]);
  for (const field of DEEP_V3_RUNTIME_FIELDS) {
    assert.match(
      encodeDeepV3ConstructorArguments(field, candidate),
      /^0x(?:[0-9a-f]{2})*$/i,
    );
  }
  const inputs = DEEP_V3_TRANSACTION_FIELDS.map((field) =>
    expectedDeepV3TransactionInput(field, candidate, root),
  );
  assert.equal(new Set(inputs).size, 6);
  assert.equal(
    expectedDeepV3TransactionInput("feeHook", candidate, root),
    expectedDeepV3HookDeploymentInput(candidate),
  );
});

test("all nine artifacts remain under EVM runtime and initcode limits", () => {
  const artifacts = deepV3ArtifactRuntime(root);
  assert.deepEqual(Object.keys(artifacts), [...DEEP_V3_RUNTIME_FIELDS]);
  for (const field of DEEP_V3_RUNTIME_FIELDS) {
    assert.ok(artifacts[field].runtimeBytes <= 24_576, field);
    assert.ok(artifacts[field].creationBytes <= 49_152, field);
    assert.equal(
      artifacts[field].fqcn,
      DEEP_V3_ARTIFACTS[field].fqcn,
    );
  }
  for (const field of ["zapPlanner", "hookFactory", "positionPlanner"]) {
    const data = JSON.parse(
      readFileSync(path.join(root, DEEP_V3_ARTIFACTS[field].file), "utf8"),
    );
    assert.equal(
      assertDeepV3ArtifactRuntimeBinding(
        field,
        data.deployedBytecode.object,
        { addresses: {} },
        root,
      ),
      keccak256(data.deployedBytecode.object),
    );
  }
});

test("Etherscan unwrapped standard JSON matches all nine exact release build inputs", () => {
  for (const field of DEEP_V3_RUNTIME_FIELDS) {
    const expected = standardJson(field);
    const observed = assertDeepV3EtherscanBuildInput(
      field,
      JSON.stringify(expected),
      expected,
      root,
    );
    assert.equal(observed.language, "Solidity");
    assert.equal(
      Object.keys(observed.sources).length,
      Object.keys(expected.sources).length,
    );
  }
});

test("Etherscan double-brace standard JSON is parsed without weakening the comparison", () => {
  const expected = standardJson("launcher");
  const wrapped = `{${JSON.stringify(expected)}}`;
  assert.deepEqual(
    assertDeepV3EtherscanStandardJsonMatches(wrapped, expected),
    expected,
  );
});

test("Etherscan output-selection normalization preserves compile-critical checks", () => {
  const expected = standardJson("launcher");
  const observed = structuredClone(expected);
  delete observed.settings.libraries;
  observed.settings.outputSelection = {
    "*": {
      "*": [
        "evm.bytecode",
        "evm.deployedBytecode",
        "devdoc",
        "userdoc",
        "metadata",
        "abi",
      ],
    },
  };
  assert.deepEqual(
    assertDeepV3EtherscanStandardJsonMatches(
      JSON.stringify(observed),
      expected,
    ),
    observed,
  );
});

test("Etherscan source comments and compiler setting drift fail closed", () => {
  const expected = standardJson("launcher");
  const sourceDrift = structuredClone(expected);
  const sourcePath = Object.keys(sourceDrift.sources)[0];
  sourceDrift.sources[sourcePath].content += "\n// mismatched comment\n";
  assert.throws(
    () =>
      assertDeepV3EtherscanStandardJsonMatches(
        JSON.stringify(sourceDrift),
        expected,
      ),
    /source contents differ/,
  );

  const settingDrift = structuredClone(expected);
  settingDrift.settings.optimizer.runs = 999;
  assert.throws(
    () =>
      assertDeepV3EtherscanStandardJsonMatches(
        JSON.stringify(settingDrift),
        expected,
      ),
    /compiler settings differ/,
  );
});

test("release manifest is schema-valid, policy-exact and fail-closed", () => {
  const schema = JSON.parse(
    readFileSync(path.join(root, DEEP_V3_SCHEMA_PATH), "utf8"),
  );
  const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);
  assert.equal(validate(manifest), true, JSON.stringify(validate.errors));
  assert.deepEqual(manifest.fixedPolicy, DEEP_V3_FIXED_POLICY);
  assert.equal(manifest.keeperPolicy.scanPageSize, 32);
  assert.equal(manifest.keeperPolicy.maxScanPages, 2);
  assert.equal(manifest.keeperPolicy.maxCandidatesPerBatch, 4);
  assert.equal(manifest.keeperPolicy.maxNewSubmissionsPerTick, 1);
  assert.equal(manifest.keeperPolicy.measuredCompoundGas, "2884090");
  assert.deepEqual(
    {
      enabled: manifest.keeperPolicy.enabled,
      transactionSubmission: manifest.keeperPolicy.transactionSubmission,
      executionPath: manifest.keeperPolicy.executionPath,
      controlPath: manifest.keeperPolicy.controlPath,
      legacyControlPath: manifest.keeperPolicy.legacyControlPath,
      controlSchemaVersion: manifest.keeperPolicy.controlSchemaVersion,
      signerLaneCount: manifest.keeperPolicy.signerLaneCount,
      confirmations: manifest.keeperPolicy.confirmations,
      independentReadRpcCount:
        manifest.keeperPolicy.independentReadRpcCount,
      intervalMilliseconds: manifest.keeperPolicy.intervalMilliseconds,
      scanPageSize: manifest.keeperPolicy.scanPageSize,
      maxScanPages: manifest.keeperPolicy.maxScanPages,
      maxCandidatesPerBatch:
        manifest.keeperPolicy.maxCandidatesPerBatch,
      maxNewSubmissionsPerTick:
        manifest.keeperPolicy.maxNewSubmissionsPerTick,
      maxActivePendingBatches:
        manifest.keeperPolicy.maxActivePendingBatches,
      maxOperatorIncidents:
        manifest.keeperPolicy.maxOperatorIncidents,
      maxHistoryEntries: manifest.keeperPolicy.maxHistoryEntries,
      maximumTransactionGas:
        manifest.keeperPolicy.maximumTransactionGas,
      maximumTotalGasPerTick:
        manifest.keeperPolicy.maximumTotalGasPerTick,
      maximumCompoundNativeWei:
        manifest.keeperPolicy.maximumCompoundNativeWei,
      measuredCompoundGas: manifest.keeperPolicy.measuredCompoundGas,
      reviewedPerVaultGasCeiling:
        manifest.keeperPolicy.reviewedPerVaultGasCeiling,
      gasMixtures: manifest.keeperPolicy.gasMixtures,
      reviewedBindingPath: manifest.keeperPolicy.reviewedBindingPath,
    },
    DEEP_V3_KEEPER_POLICY,
  );
  assert.equal(
    manifest.officialDependencies.uerc20Factory.deploymentSourceCommit,
    "de5bacd",
  );
  assert.equal(
    manifest.officialDependencies.uerc20Factory.reviewedSourcePin,
    "6f18f1c",
  );
  assert.match(
    readFileSync(
      path.join(root, "contracts/src/DeepKeeperExecutorV2.sol"),
      "utf8",
    ),
    /MAX_BATCH_SIZE\s*=\s*4/,
  );
  const keeperConfig = readFileSync(
    path.join(root, "ops/deep-keeper-v3/config-v2.mjs"),
    "utf8",
  );
  assert.match(
    keeperConfig,
    /DEEP_V3_KEEPER_V2_SCAN_PAGE_SIZE\s*=\s*32/,
  );
  assert.match(
    keeperConfig,
    /DEEP_V3_KEEPER_V2_MAX_CANDIDATES\s*=\s*4/,
  );
  const assessment = assessDeepV3LiveManifest(manifest, root);
  assert.equal(assessment.ready, false);
  assert.ok(assessment.reasons.includes("final release status"));
  assert.equal(
    assessment.reasons.includes("six deployment receipts"),
    !String(manifest.status).startsWith("deployed-"),
  );
  assert.equal(
    assessment.reasons.includes(
      "Etherscan exact and Sourcify match verification",
    ),
    manifest.sourceVerification.status !== "verified",
  );
  assert.ok(assessment.reasons.includes("current-release canary evidence"));
  assert.ok(assessment.reasons.includes("keeper reviewed and active"));

  const dishonest = structuredClone(manifest);
  dishonest.releaseEligible = true;
  assert.equal(validate(dishonest), false);

  const prematurelyEnabled = structuredClone(manifest);
  prematurelyEnabled.keeperPolicy.enabled = true;
  prematurelyEnabled.keeperPolicy.transactionSubmission = true;
  prematurelyEnabled.activation.productionTransactionSubmission = true;
  assert.equal(validate(prematurelyEnabled), false);
});

test("offline verifier succeeds without making a live claim", () => {
  const result = spawnSync(
    process.execPath,
    [
      "contracts/scripts/verify-deep-full-range-release-v3-manifest.mjs",
      "--offline",
    ],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /structurally valid and source-bound/);
  assert.doesNotMatch(result.stdout, /release-ready on two independent/);
});

test("live, capture and simulation commands fail closed without operator inputs", () => {
  const cleanEnv = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !key.startsWith("DEEP_V3_") &&
        !key.startsWith("ETHEREUM_RPC_URL") &&
        key !== "ETHERSCAN_API_KEY",
    ),
  );
  for (const [script, args, expected] of [
    [
      "contracts/scripts/verify-deep-full-range-release-v3-manifest.mjs",
      ["--require-live"],
      /requires two distinct explicit Ethereum RPC URLs/,
    ],
    [
      "contracts/scripts/capture-deep-full-range-v3-release.mjs",
      [],
      /requires two distinct Ethereum Mainnet RPCs/,
    ],
    [
      "contracts/scripts/simulate-deep-full-range-v3-mainnet.mjs",
      [],
      /ETHEREUM_RPC_URL is required/,
    ],
  ]) {
    const result = spawnSync(process.execPath, [script, ...args], {
      cwd: root,
      encoding: "utf8",
      env: cleanEnv,
    });
    assert.notEqual(result.status, 0, script);
    assert.match(result.stderr, expected, script);
  }
});
