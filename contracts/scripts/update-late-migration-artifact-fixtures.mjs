#!/usr/bin/env node
// Local artifact regeneration only. Never performs RPC, signing, or broadcasting.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { keccak256 } from "viem";
import {
  EXPECTED,
  sourceArtifactBytes,
} from "./late-migration-deployment-preflight-core.mjs";
const root = new URL("../../", import.meta.url);
const readJson = async (name) =>
  JSON.parse(await readFile(new URL(name, root), "utf8"));
// Solidity AST IDs depend on the set of compiled sources. Pin the sole immutable's
// semantic role and exact byte offsets instead of that incidental numeric ID.
export function normalizedIntakeImmutableReferences(references) {
  const entries = Object.values(references ?? {});
  assert.equal(entries.length, 1, "exactly one oldToken immutable is required");
  assert.ok(Array.isArray(entries[0]) && entries[0].length > 0);
  return { oldToken: [...entries[0]].sort((a, b) => a.start - b.start) };
}
export async function updateLateMigrationArtifactFixtures(command = "check") {
  if (!["check", "write"].includes(command))
    throw new Error(
      "usage: update-late-migration-artifact-fixtures.mjs [check|write]",
    );
  const preflight = await readJson(
    "config/late-migration-deployment-preflight.v1.json",
  );
  const artifact = await readJson(preflight.ownerHandoff.sourceArtifactPath);
  assert.equal(artifact.metadata.compiler.version, "0.8.26+commit.8a97fa7a");
  assert.deepEqual(artifact.metadata.settings.optimizer, {
    enabled: true,
    runs: 1000,
  });
  assert.equal(artifact.metadata.settings.viaIR, true);
  assert.equal(artifact.metadata.settings.evmVersion, "cancun");
  assert.deepEqual(artifact.metadata.settings.metadata, {
    bytecodeHash: "none",
    appendCBOR: false,
  });
  const sourceFile = await readFile(
    new URL(
      "contracts/src/late-migration/ProgrammableLateMigrationIntakeV3.sol",
      root,
    ),
  );
  const sourceSoliditySha256 = createHash("sha256")
    .update(sourceFile)
    .digest("hex");
  let runtime = artifact.deployedBytecode.object;
  for (const ref of Object.values(
    artifact.deployedBytecode.immutableReferences,
  ).flat()) {
    runtime = `${runtime.slice(0, 2 + ref.start * 2)}${EXPECTED.oldToken.slice(2).toLowerCase().padStart(64, "0")}${runtime.slice(2 + (ref.start + ref.length) * 2)}`;
  }
  const sourceCreationCodeKeccak256 = keccak256(artifact.bytecode.object);
  const sourceRuntimeCodehash = keccak256(runtime);
  const candidate = {
    ...preflight,
    ownerHandoff: {
      ...preflight.ownerHandoff,
      sourceCreationCodeKeccak256,
      sourceRuntimeCodehash,
    },
  };
  sourceArtifactBytes(artifact, candidate);
  const fixture = {
    schema: "programmable-late-migration-intake-artifact-fixture/v1",
    sourceSoliditySha256,
    compiler: artifact.metadata.compiler,
    settings: {
      optimizer: artifact.metadata.settings.optimizer,
      metadata: artifact.metadata.settings.metadata,
      evmVersion: "cancun",
      viaIR: true,
    },
    sourceCreationCodeKeccak256,
    sourceRuntimeCodehash,
    source: artifact.bytecode.object,
    deployedBytecode: {
      object: artifact.deployedBytecode.object,
      immutableReferences: normalizedIntakeImmutableReferences(artifact.deployedBytecode.immutableReferences),
    },
  };
  const fixturePath =
    "contracts/scripts/test/fixtures/late-migration-creation-code.v1.json";
  if (command === "write") {
    await writeFile(
      new URL(fixturePath, root),
      `${JSON.stringify(fixture, null, 2)}\n`,
    );
    await writeFile(
      new URL("config/late-migration-deployment-preflight.v1.json", root),
      `${JSON.stringify(candidate, null, 2)}\n`,
    );
  } else {
    assert.deepEqual(
      await readJson(fixturePath),
      fixture,
      "fixture must match freshly built V3 source",
    );
    assert.deepEqual(
      preflight,
      candidate,
      "preflight artifact pins must match V3 build",
    );
  }
  return {
    state:
      command === "write"
        ? "local-fixtures-updated"
        : "local-fixtures-reproduced",
    sourceSoliditySha256,
    sourceCreationCodeKeccak256,
    sourceRuntimeCodehash,
  };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 3)
    throw new Error("exactly one optional command is accepted");
  updateLateMigrationArtifactFixtures(process.argv[2])
    .then((result) =>
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`),
    )
    .catch((error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
}
