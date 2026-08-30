import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { keccak256 } from "viem";

import {
  ROBINHOOD_BLOCKSCOUT_DEGRADED_STATUS,
  ROBINHOOD_BLOCKSCOUT_TARGETS,
  normalizeRobinhoodBlockscoutObservation,
} from "../observe-robinhood-custom-launch-blockscout.mjs";
import { verifyRobinhoodStandardJsonInputs } from "../robinhood-custom-launch-standard-json-core.mjs";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const target = ROBINHOOD_BLOCKSCOUT_TARGETS[0];
const standardJsonInputPath = path.join(
  repositoryRoot,
  target.standardJsonInputPath,
);
const standardJsonInputBytes = await readFile(standardJsonInputPath);
const standardJsonInput = JSON.parse(standardJsonInputBytes);
const verified = await verifyRobinhoodStandardJsonInputs({
  requireForgeArtifacts: false,
});
const deployedBytecode = `0x${verified.compilations.graphFactory.evm.deployedBytecode.object}`;

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function rawPartialObservation() {
  const primaryPath = target.fullyQualifiedName.split(":", 1)[0];
  return {
    name: target.name,
    file_path: primaryPath,
    language: "solidity",
    creation_status: "success",
    source_code: standardJsonInput.sources[primaryPath].content,
    additional_sources: Object.entries(standardJsonInput.sources)
      .filter(([sourcePath]) => sourcePath !== primaryPath)
      .map(([file_path, { content: source_code }]) => ({
        file_path,
        source_code,
      })),
    compiler_version: "v0.8.26+commit.8a97fa7a",
    optimization_enabled: true,
    optimizations_runs: null,
    evm_version: "cancun",
    compiler_settings: structuredClone(standardJsonInput.settings),
    constructor_args: null,
    creation_bytecode: verified.commitments.graph.creationCode,
    deployed_bytecode: deployedBytecode,
    is_verified: true,
    is_fully_verified: false,
    is_partially_verified: true,
    is_changed_bytecode: false,
    verified_twin_address_hash: null,
  };
}

function normalize(rawResponse = rawPartialObservation()) {
  return normalizeRobinhoodBlockscoutObservation({
    target,
    rawResponse,
    responseSha256: `sha256:${"a".repeat(64)}`,
    responseBytes: 4096,
    observedAt: "2026-08-30T12:00:00.000Z",
    standardJsonInput,
    standardJsonInputSha256: sha256(standardJsonInputBytes),
    expectedCreationCode: verified.commitments.graph.creationCode,
    expectedConstructorArguments: "0x",
  });
}

function mutated(mutate) {
  const response = rawPartialObservation();
  mutate(response);
  return response;
}

test("accepts exact no-CBOR PARTIAL only as non-release-authoritative evidence", () => {
  const observation = normalize();

  assert.equal(
    observation.status,
    ROBINHOOD_BLOCKSCOUT_DEGRADED_STATUS,
  );
  assert.equal(
    observation.status,
    "PARTIAL_NO_CBOR_NOT_RELEASE_AUTHORITY",
  );
  assert.equal(observation.releaseAuthority, false);
  assert.equal(observation.exactSourceGateSatisfied, false);
  assert.equal(observation.localByteBindingsVerified, true);
  assert.equal(observation.providerOptimizationsRuns, null);
  assert.deepEqual(observation.providerClassification, {
    isVerified: true,
    isFullyVerified: false,
    isPartiallyVerified: true,
    isChangedBytecode: false,
    verifiedTwinAddressHash: null,
  });
  assert.match(observation.rationale, /appendCBOR=false/u);
  assert.equal(
    observation.runtimeCodeKeccak256,
    target.expectedRuntimeCodeHash,
  );
  assert.match(observation.observationDigest, /^sha256:[0-9a-f]{64}$/u);

  const explicitRuns = rawPartialObservation();
  explicitRuns.optimizations_runs = 1000;
  assert.equal(normalize(explicitRuns).providerOptimizationsRuns, 1000);
});

test("binds the Router source closure, constructor-appended creation, and runtime target", async () => {
  const routerTarget = ROBINHOOD_BLOCKSCOUT_TARGETS[1];
  const routerInputBytes = await readFile(
    path.join(repositoryRoot, routerTarget.standardJsonInputPath),
  );
  const routerInput = JSON.parse(routerInputBytes);
  const primaryPath = routerTarget.fullyQualifiedName.split(":", 1)[0];
  const localRuntime =
    `0x${verified.compilations.router.evm.deployedBytecode.object}`;
  const testTarget = {
    ...routerTarget,
    expectedRuntimeCodeHash: keccak256(localRuntime),
  };
  const rawResponse = {
    name: routerTarget.name,
    file_path: primaryPath,
    language: "solidity",
    creation_status: "success",
    source_code: routerInput.sources[primaryPath].content,
    additional_sources: Object.entries(routerInput.sources)
      .filter(([sourcePath]) => sourcePath !== primaryPath)
      .map(([file_path, { content: source_code }]) => ({
        file_path,
        source_code,
      })),
    compiler_version: "v0.8.26+commit.8a97fa7a",
    optimization_enabled: true,
    optimizations_runs: 1000,
    evm_version: "cancun",
    compiler_settings: structuredClone(routerInput.settings),
    constructor_args:
      verified.commitments.router.constructorArguments.slice(2),
    creation_bytecode: verified.commitments.router.creationCode,
    deployed_bytecode: localRuntime,
    is_verified: true,
    is_fully_verified: false,
    is_partially_verified: true,
    is_changed_bytecode: false,
    verified_twin_address_hash: null,
  };
  const observation = normalizeRobinhoodBlockscoutObservation({
    target: testTarget,
    rawResponse,
    responseSha256: `sha256:${"b".repeat(64)}`,
    responseBytes: 8192,
    observedAt: "2026-08-30T12:00:00.000Z",
    standardJsonInput: routerInput,
    standardJsonInputSha256: sha256(routerInputBytes),
    expectedCreationCode: verified.commitments.router.creationCode,
    expectedConstructorArguments:
      verified.commitments.router.constructorArguments,
  });

  assert.equal(
    observation.constructorArguments,
    verified.commitments.router.constructorArguments,
  );
  assert.equal(
    observation.creationCodeKeccak256,
    verified.commitments.router.constructorAppendedCreationCodeHash,
  );
  assert.equal(observation.runtimeCodeKeccak256, testTarget.expectedRuntimeCodeHash);
  assert.equal(observation.providerOptimizationsRuns, 1000);

  const deployment = JSON.parse(
    await readFile(
      path.join(
        repositoryRoot,
        "contracts/deployments/robinhood-custom-launch-v1.predeployment.json",
      ),
    ),
  );
  assert.equal(
    routerTarget.expectedRuntimeCodeHash,
    deployment.contracts.programmableLaunchStampRouter.expectedRuntimeCodeHash,
  );
});

test("rejects FULL, non-PARTIAL, changed-bytecode, unverified, and twin classifications", () => {
  const invalidClassifications = [
    ["unverified", (response) => { response.is_verified = false; }],
    ["FULL", (response) => { response.is_fully_verified = true; }],
    ["non-PARTIAL", (response) => { response.is_partially_verified = false; }],
    ["changed bytecode", (response) => { response.is_changed_bytecode = true; }],
    [
      "verified twin",
      (response) => {
        response.verified_twin_address_hash =
          "0x1111111111111111111111111111111111111111";
      },
    ],
  ];

  for (const [label, mutate] of invalidClassifications) {
    assert.throws(
      () => normalize(mutated(mutate)),
      /not the expected no-CBOR PARTIAL classification/u,
      label,
    );
  }
});

test("rejects any source, contract identity, compiler, or settings drift", () => {
  const invalidInputs = [
    [
      "source content",
      (response) => { response.source_code += "\n// unreviewed"; },
      /source closure differs/u,
    ],
    [
      "source path",
      (response) => { response.file_path = "src/Unreviewed.sol"; },
      /source closure differs/u,
    ],
    [
      "contract name",
      (response) => { response.name = "Unreviewed"; },
      /compiler identity\/settings differ/u,
    ],
    [
      "language",
      (response) => { response.language = "yul"; },
      /compiler identity\/settings differ/u,
    ],
    [
      "creation status",
      (response) => { response.creation_status = "failed"; },
      /compiler identity\/settings differ/u,
    ],
    [
      "compiler version",
      (response) => { response.compiler_version = "v0.8.25+commit.b61c2a91"; },
      /compiler identity\/settings differ/u,
    ],
    [
      "optimizer flag",
      (response) => { response.optimization_enabled = false; },
      /compiler identity\/settings differ/u,
    ],
    [
      "optimizer runs",
      (response) => { response.optimizations_runs = 999; },
      /compiler identity\/settings differ/u,
    ],
    [
      "missing provider optimizer runs",
      (response) => { delete response.optimizations_runs; },
      /compiler identity\/settings differ/u,
    ],
    [
      "EVM version",
      (response) => { response.evm_version = "shanghai"; },
      /compiler identity\/settings differ/u,
    ],
    [
      "appendCBOR",
      (response) => { response.compiler_settings.metadata.appendCBOR = true; },
      /compiler identity\/settings differ/u,
    ],
    [
      "compiler settings",
      (response) => { response.compiler_settings.optimizer.runs = 999; },
      /compiler identity\/settings differ/u,
    ],
  ];

  for (const [label, mutate, expectedError] of invalidInputs) {
    assert.throws(
      () => normalize(mutated(mutate)),
      expectedError,
      label,
    );
  }
});

test("rejects constructor, creation, or deployed-bytecode drift", () => {
  const invalidByteBindings = [
    ["constructor arguments", (response) => { response.constructor_args = "0x00"; }],
    [
      "creation bytecode",
      (response) => {
        response.creation_bytecode = `${response.creation_bytecode.slice(0, -2)}00`;
      },
    ],
    [
      "deployed bytecode",
      (response) => {
        response.deployed_bytecode = `${response.deployed_bytecode.slice(0, -2)}00`;
      },
    ],
  ];

  for (const [label, mutate] of invalidByteBindings) {
    assert.throws(
      () => normalize(mutated(mutate)),
      /constructor arguments differs|creation or deployed bytes differ/u,
      label,
    );
  }
});
