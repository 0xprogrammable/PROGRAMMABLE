import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import {
  buildShardsSuccessorManifests,
  canonicalJson,
} from "../shards-successor-manifest-core.mjs";

const contractsRoot = resolve(import.meta.dirname, "../..");

test("binds the exact Forge build closure and reproduces all three successor manifests", async () => {
  const first = await buildShardsSuccessorManifests({ contractsRoot });
  const second = await buildShardsSuccessorManifests({ contractsRoot });
  assert.equal(canonicalJson(first.manifests), canonicalJson(second.manifests));
  assert.ok(
    first.manifests.route.components.every(
      (component) =>
        component.artifact.rawForgeArtifactIsBinding === false
        && component.artifact.creationTemplateKeccak256.startsWith("0x")
        && component.artifact.runtimeTemplateKeccak256.startsWith("0x")
        && component.artifact.canonicalAbiSha256.startsWith("0x")
        && component.artifact.runtimeCodeLimitMarginBytes >= 0
        && component.artifact.initcodeLimitMarginBytes >= 0,
    ),
  );
  const registry = first.manifests.route.components.find((component) => component.id === "registry");
  const coordinator = first.manifests.route.components.find(
    (component) => component.id === "pairDeploymentCoordinator",
  );
  assert.ok(registry.artifact.runtimeCodeLimitMarginBytes >= 1024);
  assert.ok(coordinator.artifact.initcodeLimitMarginBytes >= 1024);
});
