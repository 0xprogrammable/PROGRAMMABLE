import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  CONTRACT_REGISTRY_VALIDATOR_CLOSURE_PROFILE_V1,
  CONTRACT_REGISTRY_SOURCE_V1_PATH,
  CONTRACT_REGISTRY_V1_PATH,
  CONTRACT_REGISTRY_V1_SCHEMA_ID,
  CONTRACT_REGISTRY_V1_VERSION,
  contractRegistryBytesV1,
  generateContractRegistryV1,
  verifyContractRegistryDigestV1
} from "../contract-registry-core.mjs";
import { canonicalJsonSha256V2 } from "../canonical-json-core.mjs";
import { parseBoundedStrictJsonBytes } from "../strict-json-core.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(scriptDirectory, "../..");
const registryPath = path.resolve(skillRoot, CONTRACT_REGISTRY_V1_PATH);
const sourcePath = path.resolve(skillRoot, CONTRACT_REGISTRY_SOURCE_V1_PATH);

test("committed contract registry exactly matches its source, schemas, and validators", () => {
  const generated = generateContractRegistryV1({ skillRoot });
  const committedBytes = fs.readFileSync(registryPath);
  const committed = parseBoundedStrictJsonBytes(committedBytes, { maxSourceBytes: 2 * 1024 * 1024 });

  assert.deepEqual(committedBytes, contractRegistryBytesV1(generated));
  assert.deepEqual(committed, generated);
  assert.equal(committed.$schema, CONTRACT_REGISTRY_V1_SCHEMA_ID);
  assert.equal(committed.schemaVersion, CONTRACT_REGISTRY_V1_VERSION);
  assert.equal(verifyContractRegistryDigestV1(committed), true);
  assert.equal(committed.inventory.contractCount, committed.contracts.length);
  assert.equal(committed.inventory.schemaCount, committed.contracts.length);
  assert.equal(committed.inventory.validatorBindingCount, committed.contracts.length);
  assert.equal(committed.inventory.validatorClosureCount, committed.validatorClosures.length);
  assert.equal(committed.inventory.validatorClosureCount, committed.inventory.validatorModuleCount);
  assert.equal(
    committed.inventory.activeContractCount + committed.inventory.frozenContractCount,
    committed.contracts.length
  );

  const contractIds = committed.contracts.map(({ contractId }) => contractId);
  const schemaIds = committed.contracts.map(({ schema }) => schema.id);
  const schemaPaths = committed.contracts.map(({ schema }) => schema.path);
  assert.equal(new Set(contractIds).size, contractIds.length);
  assert.equal(new Set(schemaIds).size, schemaIds.length);
  assert.equal(new Set(schemaPaths).size, schemaPaths.length);

  const discoveredSchemaPaths = fs.readdirSync(path.resolve(skillRoot, "references"))
    .filter((name) => name.endsWith(".schema.json"))
    .map((name) => `references/${name}`)
    .sort(compareUtf8);
  assert.deepEqual(schemaPaths, discoveredSchemaPaths);
});

test("every registry binding matches exact file bytes and a callable module export", async () => {
  const registry = parseBoundedStrictJsonBytes(fs.readFileSync(registryPath), { maxSourceBytes: 2 * 1024 * 1024 });
  const importedModules = new Map();
  const closuresByRoot = new Map(registry.validatorClosures.map((closure) => [closure.rootModulePath, closure]));

  assert.equal(closuresByRoot.size, registry.validatorClosures.length);
  assert.deepEqual(
    registry.validatorClosures.map(({ rootModulePath }) => rootModulePath),
    [...closuresByRoot.keys()].sort(compareUtf8)
  );
  const distinctClosureModules = new Set();
  let closureModuleBindings = 0;
  for (const closure of registry.validatorClosures) {
    const { closureSha256, ...preimage } = closure;
    assert.equal(closure.profile, CONTRACT_REGISTRY_VALIDATOR_CLOSURE_PROFILE_V1, closure.rootModulePath);
    assert.equal(closureSha256, canonicalJsonSha256V2(preimage), closure.rootModulePath);
    assert.equal(closure.moduleCount, closure.modules.length, closure.rootModulePath);
    assert.equal(
      closure.totalByteLength,
      closure.modules.reduce((sum, module) => sum + module.byteLength, 0),
      closure.rootModulePath
    );
    assert.deepEqual(
      closure.modules.map(({ path: modulePath }) => modulePath),
      closure.modules.map(({ path: modulePath }) => modulePath).sort(compareUtf8),
      closure.rootModulePath
    );
    const closurePaths = new Set(closure.modules.map(({ path: modulePath }) => modulePath));
    assert.ok(closurePaths.has(closure.rootModulePath), closure.rootModulePath);
    for (const module of closure.modules) {
      distinctClosureModules.add(module.path);
      const moduleBytes = fs.readFileSync(path.resolve(skillRoot, module.path));
      assert.equal(moduleBytes.length, module.byteLength, `${closure.rootModulePath}:${module.path}`);
      assert.equal(sha256Bytes(moduleBytes), module.sha256, `${closure.rootModulePath}:${module.path}`);
      assert.ok(module.localImports.every((modulePath) => closurePaths.has(modulePath)), module.path);
    }
    closureModuleBindings += closure.moduleCount;
  }
  assert.equal(closureModuleBindings, registry.inventory.validatorClosureModuleBindingCount);
  assert.equal(distinctClosureModules.size, registry.inventory.validatorClosureDistinctModuleCount);
  assert.equal(registry.inventory.validatorClosuresSha256, canonicalJsonSha256V2(registry.validatorClosures));

  for (const contract of registry.contracts) {
    const schemaBytes = fs.readFileSync(path.resolve(skillRoot, contract.schema.path));
    const schema = parseBoundedStrictJsonBytes(schemaBytes, { maxSourceBytes: 4 * 1024 * 1024 });
    assert.equal(schema.$id, contract.schema.id, contract.contractId);
    assert.equal(schemaBytes.length, contract.schema.byteLength, contract.contractId);
    assert.equal(sha256Bytes(schemaBytes), contract.schema.sha256, contract.contractId);

    const modulePath = path.resolve(skillRoot, contract.validator.modulePath);
    const moduleBytes = fs.readFileSync(modulePath);
    assert.equal(moduleBytes.length, contract.validator.moduleByteLength, contract.contractId);
    assert.equal(sha256Bytes(moduleBytes), contract.validator.moduleSha256, contract.contractId);
    assert.equal(
      contract.validator.closureSha256,
      closuresByRoot.get(contract.validator.modulePath)?.closureSha256,
      contract.contractId
    );
    let module = importedModules.get(modulePath);
    if (module === undefined) {
      module = await import(pathToFileURL(modulePath).href);
      importedModules.set(modulePath, module);
    }
    assert.equal(typeof module[contract.validator.exportName], "function", contract.contractId);
  }

  assert.equal(importedModules.size, registry.inventory.validatorModuleCount);
});

test("validator closures bind imported owners and fail closed on unresolved imports and cycles", () => {
  const temporaryParent = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-contract-closure-"));
  const temporarySkillRoot = path.join(temporaryParent, "skill");
  const rootModulePath = "scripts/open-world-v2-core.mjs";
  const ownerModulePath = "scripts/open-world-v2-validation-core.mjs";
  try {
    fs.mkdirSync(temporarySkillRoot, { recursive: true });
    fs.cpSync(path.resolve(skillRoot, "references"), path.resolve(temporarySkillRoot, "references"), { recursive: true });
    fs.cpSync(path.resolve(skillRoot, "scripts"), path.resolve(temporarySkillRoot, "scripts"), { recursive: true });

    const baseline = generateContractRegistryV1({ skillRoot: temporarySkillRoot });
    const baselineClosure = baseline.validatorClosures.find(({ rootModulePath: candidate }) => candidate === rootModulePath);
    assert.ok(baselineClosure?.modules.some(({ path: modulePath }) => modulePath === ownerModulePath));
    const baselineRootModule = baselineClosure.modules.find(({ path: modulePath }) => modulePath === rootModulePath);
    const ownerPath = path.resolve(temporarySkillRoot, ownerModulePath);
    const ownerBytes = fs.readFileSync(ownerPath);

    fs.appendFileSync(ownerPath, "\nexport const contractRegistrySemanticMutation = true;\n", "utf8");
    const mutated = generateContractRegistryV1({ skillRoot: temporarySkillRoot });
    const mutatedClosure = mutated.validatorClosures.find(({ rootModulePath: candidate }) => candidate === rootModulePath);
    const mutatedRootModule = mutatedClosure.modules.find(({ path: modulePath }) => modulePath === rootModulePath);
    const baselineBinding = baseline.contracts.find(({ validator }) => validator.modulePath === rootModulePath);
    const mutatedBinding = mutated.contracts.find(({ validator }) => validator.modulePath === rootModulePath);
    assert.equal(mutatedRootModule.sha256, baselineRootModule.sha256, "facade bytes must remain unchanged in the fixture");
    assert.notEqual(mutatedClosure.closureSha256, baselineClosure.closureSha256);
    assert.notEqual(mutatedBinding.validator.closureSha256, baselineBinding.validator.closureSha256);
    assert.notEqual(mutated.registrySha256, baseline.registrySha256);

    fs.writeFileSync(ownerPath, ownerBytes);
    fs.appendFileSync(ownerPath, '\nimport "./contract-registry-missing-owner.mjs";\n', "utf8");
    assert.throws(
      () => generateContractRegistryV1({ skillRoot: temporarySkillRoot }),
      /validator import unresolved: scripts\/contract-registry-missing-owner\.mjs/u
    );

    fs.writeFileSync(ownerPath, ownerBytes);
    fs.appendFileSync(ownerPath, '\nimport "./open-world-v2-core.mjs";\n', "utf8");
    assert.throws(
      () => generateContractRegistryV1({ skillRoot: temporarySkillRoot }),
      /validator import cycle: scripts\/open-world-v2-core\.mjs .* scripts\/open-world-v2-validation-core\.mjs .* scripts\/open-world-v2-core\.mjs/u
    );
  } finally {
    fs.rmSync(temporaryParent, { recursive: true, force: true });
  }
});

test("new public machine contracts bind their canonical semantic validators", () => {
  const registry = parseBoundedStrictJsonBytes(fs.readFileSync(registryPath), { maxSourceBytes: 2 * 1024 * 1024 });
  const observed = new Map(registry.contracts.map(({ contractId, validator }) => [contractId, {
    modulePath: validator.modulePath,
    exportName: validator.exportName,
    mode: validator.mode
  }]));
  const expected = new Map([
    ["architecture-candidates-v1", { modulePath: "scripts/project-contracts-core.mjs", exportName: "validateArchitectureCandidates", mode: "package-semantic" }],
    ["capability-contract-v1", { modulePath: "scripts/composition-checker-core.mjs", exportName: "validateCapabilityContractV1", mode: "direct" }],
    ["command-receipt-v1", { modulePath: "scripts/repository-completion-core.mjs", exportName: "validateRepositoryPlan", mode: "package-semantic" }],
    ["fee-policy-v2", { modulePath: "scripts/fee-policy-v2-contract.mjs", exportName: "validateFeePolicyV2", mode: "direct" }],
    ["product-graph-v1", { modulePath: "scripts/project-contracts-core.mjs", exportName: "validateProductGraph", mode: "package-semantic" }],
    ["programmable-trade-execution-v1", { modulePath: "scripts/trade-capability-manifest-core.mjs", exportName: "validateProgrammableTradeExecutionEnvelopeV1", mode: "direct" }],
    ["project-spec-v1", { modulePath: "scripts/project-contracts-core.mjs", exportName: "validateProjectSpec", mode: "direct" }],
    ["project-state-v1", { modulePath: "scripts/project-state-core.mjs", exportName: "validateProjectState", mode: "package-semantic" }],
    ["project-toolchain-lock-v1", { modulePath: "scripts/repository-completion-core.mjs", exportName: "validateRepositoryPlan", mode: "package-semantic" }],
    ["repository-plan-v1", { modulePath: "scripts/repository-completion-core.mjs", exportName: "validateRepositoryPlan", mode: "package-semantic" }],
    ["semantic-rule-registry-v1", { modulePath: "scripts/semantic-rule-registry-core.mjs", exportName: "validateSemanticRuleRegistry", mode: "direct" }],
    ["trade-capability-manifest-v1", { modulePath: "scripts/trade-capability-manifest-core.mjs", exportName: "validateTradeCapabilityManifestV1", mode: "direct" }],
    ["v4-deployment-evidence-v1", { modulePath: "scripts/v4-deployment-evidence-core.mjs", exportName: "validateV4DeploymentEvidence", mode: "package-semantic" }],
    ["v4-deployment-preimage-v1", { modulePath: "scripts/v4-deployment-evidence-core.mjs", exportName: "validateV4DeploymentEvidence", mode: "package-semantic" }]
  ]);

  for (const [contractId, binding] of expected) assert.deepEqual(observed.get(contractId), binding, contractId);
});

test("legacy digest compatibility is explicit and closed to frozen V1 contracts", () => {
  const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  const legacy = registry.contracts.filter(({ payloadDigestProfile }) => (
    payloadDigestProfile === "canonical-json-legacy-v1-lf"
  ));
  assert.deepEqual(
    legacy.map(({ contractId }) => contractId),
    ["fee-conformance-receipt-v1", "fee-conformance-vector-set-v1"]
  );
  assert.ok(legacy.every(({ lifecycle }) => lifecycle === "frozen"));
  assert.ok(registry.contracts.filter(({ lifecycle }) => lifecycle === "active")
    .every(({ payloadDigestProfile }) => payloadDigestProfile !== "canonical-json-legacy-v1-lf"));
});

test("generator fails closed when a schema has no registry and validator binding", () => {
  const temporaryParent = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-contract-registry-"));
  const temporarySkillRoot = path.join(temporaryParent, "skill");
  try {
    fs.mkdirSync(path.join(temporarySkillRoot, "references"), { recursive: true });
    fs.mkdirSync(path.join(temporarySkillRoot, "scripts"), { recursive: true });
    const sourceBytes = fs.readFileSync(sourcePath);
    const source = JSON.parse(sourceBytes.toString("utf8"));
    fs.copyFileSync(sourcePath, path.join(temporarySkillRoot, CONTRACT_REGISTRY_SOURCE_V1_PATH));
    for (const binding of source.contracts) {
      fs.copyFileSync(
        path.resolve(skillRoot, binding.schemaPath),
        path.resolve(temporarySkillRoot, binding.schemaPath)
      );
      const targetModule = path.resolve(temporarySkillRoot, binding.validator.modulePath);
      if (!fs.existsSync(targetModule)) {
        fs.copyFileSync(path.resolve(skillRoot, binding.validator.modulePath), targetModule);
      }
    }
    fs.writeFileSync(
      path.join(temporarySkillRoot, "references/unregistered.schema.json"),
      '{"$id":"urn:programmable:unregistered","type":"object"}\n',
      "utf8"
    );
    assert.throws(
      () => generateContractRegistryV1({ skillRoot: temporarySkillRoot }),
      /unregistered schemas: references\/unregistered\.schema\.json/u
    );
  } finally {
    fs.rmSync(temporaryParent, { recursive: true, force: true });
  }
});

test("contract registry CLI check is deterministic and read-only", () => {
  const commandPath = path.resolve(scriptDirectory, "../generate-contract-registry.mjs");
  const result = spawnSync(process.execPath, [commandPath, "--check"], {
    cwd: skillRoot,
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^contract registry is current \([0-9]+ bytes\)\n$/u);
});

function sha256Bytes(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}
