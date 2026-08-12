import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import {
  buildShardsSuccessorManifests,
  canonicalJson,
} from "../shards-successor-manifest-core.mjs";

const contractsRoot = resolve(import.meta.dirname, "../..");
const reviewedInput = JSON.parse(
  await readFile(resolve(contractsRoot, "spec/shards-successor-manifest-input-v2.json"), "utf8"),
);

function fixtureEvidence(input) {
  const byComponent = new Map(input.components.map((component) => [component.id, {
    descriptor: component,
    targetSourceText: "",
    artifact: { abi: [] },
    manifest: {
      id: component.id,
      contract: component.contract,
      source: { path: `contracts/${component.compilationTarget}`, sha256: "fixture", keccak256: "fixture" },
      artifact: { rawForgeArtifactIsBinding: false },
      deployment: { address: null, transactionHash: null, blockNumber: null, activation: false },
    },
  }]));
  for (const assertion of input.semanticAssertions) {
    const component = byComponent.get(assertion.component);
    if (assertion.kind === "sourceIncludesAll") {
      component.targetSourceText += `${assertion.values.join("\n")}\n`;
    } else if (assertion.kind === "abiHasFunctions") {
      for (const name of assertion.values) component.artifact.abi.push({ type: "function", name, inputs: [] });
    } else if (assertion.kind === "abiTupleHasFields") {
      component.artifact.abi.push({
        type: "function",
        name: assertion.symbol,
        inputs: [{
          type: "tuple",
          components: assertion.values.map((name) => ({ name, type: "bytes32" })),
        }],
      });
    } else if (assertion.kind === "abiEventHasFields") {
      component.artifact.abi.push({
        type: "event",
        name: assertion.symbol,
        inputs: assertion.values.map((field) => ({ ...field, type: "bytes32" })),
      });
    } else if (assertion.kind === "abiExact") {
      component.artifact.abi.push({
        type: assertion.abiType,
        name: assertion.symbol,
        __reviewedFixtureShape: assertion.expected,
      });
    }
  }
  return byComponent;
}

const fixtureSourceValidator = async () => {};

async function build(input = reviewedInput, injectedEvidence = fixtureEvidence(reviewedInput)) {
  const fixtureLoader = async (_root, descriptor) => structuredClone(injectedEvidence.get(descriptor.id));
  return buildShardsSuccessorManifests({
    contractsRoot,
    inputOverride: input,
    componentLoader: fixtureLoader,
    reviewedSourceValidator: fixtureSourceValidator,
  });
}

test("generates the inactive successor semantics reproducibly without Forge artifacts", async () => {
  const first = await build();
  const second = await build();
  assert.equal(canonicalJson(first.manifests), canonicalJson(second.manifests));
  assert.equal(first.manifests.fee.schemaVersion, "programmable.exact-shards-fee-policy-verifier.v2");
  assert.equal(first.manifests.registry.schemaVersion, "programmable.exact-shards-registry-successor.v2");
  assert.equal(first.manifests.route.schemaVersion, "programmable.exact-shards-atomic-launch-route.v2");
  assert.equal(first.manifests.route.graph.deploymentAddresses, null);
  assert.equal(first.manifests.route.activationAllowed, false);
  assert.equal(first.manifests.registry.registryBinding.correctionAllowed, false);
  assert.equal(first.manifests.registry.registryBinding.launchRouteSoleWriter, true);
  assert.deepEqual(
    first.manifests.fee.exactPolicy.orderedClaims.map((claim) => claim.grossVolumeFeeBps),
    [10, 10, 80],
  );
});

test("fails closed when a reviewed semantic assertion no longer matches injected evidence", async () => {
  const tampered = structuredClone(reviewedInput);
  const assertion = tampered.semanticAssertions.find((entry) => entry.id === "route-factory-caller-gate");
  assertion.values.push("function impossibleSemanticDriftMarker() external;");
  await assert.rejects(build(tampered), /route-factory-caller-gate missing source evidence/u);
});

test("fails closed when the reviewed fee split is internally inconsistent", async () => {
  const tampered = structuredClone(reviewedInput);
  tampered.feePolicy.orderedClaims[2].grossVolumeFeeBps = 79;
  await assert.rejects(build(tampered), /gross-volume claim split mismatch/u);
});

test("fails closed on exact ABI type, order, indexed-position and mutability drift", async () => {
  const mutations = [
    {
      id: "registry-register-launch-exact-abi",
      from: "websiteLaunchIdSha256:bytes32",
      to: "websiteLaunchIdSha256:bytes31",
    },
    {
      id: "registry-public-identity-event-exact-abi",
      from: "websiteLaunchIdSha256:bytes32:indexed,websiteProjectIdSha256:bytes32:indexed",
      to: "websiteProjectIdSha256:bytes32:indexed,websiteLaunchIdSha256:bytes32:indexed",
    },
    {
      id: "registry-approval-event-exact-abi",
      from: "approvalBindingHash:bytes32:indexed",
      to: "approvalBindingHash:bytes32:data",
    },
    {
      id: "registry-public-identity-readback-exact-abi",
      from: ") view",
      to: ") pure",
    },
  ];
  for (const mutation of mutations) {
    const injected = fixtureEvidence(reviewedInput);
    const assertion = reviewedInput.semanticAssertions.find((entry) => entry.id === mutation.id);
    const component = injected.get(assertion.component);
    const symbol = component.artifact.abi.find(
      (entry) => entry.type === assertion.abiType && entry.name === assertion.symbol
        && typeof entry.__reviewedFixtureShape === "string",
    );
    symbol.__reviewedFixtureShape = symbol.__reviewedFixtureShape.replace(mutation.from, mutation.to);
    await assert.rejects(build(reviewedInput, injected), new RegExp(`${mutation.id} exact ABI drift`, "u"));
  }
});
