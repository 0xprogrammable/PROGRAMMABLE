import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import eligibility from "../config/shards-canary-descriptor-eligibility.v1.json";
import registryDeployment from
  "../contracts/deployments/mainnet-custom-registry-v1.json";
import {
  MANUAL_ROUTER_NESTED_FACTORY_BINDING_V2,
} from "../lib/custom-launch/manual-router-bindings-v2";
import {
  ROUTER_V2_SHARED_LIFECYCLE_V3_SOURCE_ONLY_STATE,
} from "../lib/server/custom-launch/router-v2-shared-lifecycle-v3";

type FileBinding = Readonly<{ path: string; rawSha256: string }>;

function rawSha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

describe("Shards generic V3 canary descriptor eligibility", () => {
  it("publishes no synthetic descriptor while required authority bytes are absent", () => {
    expect(eligibility).toMatchObject({
      schemaVersion: "programmable.shards-canary-descriptor-eligibility.v1",
      status: "ANALYSIS_PENDING",
      launchAllowed: false,
      activationAllowed: false,
      descriptor: null,
      externalActionOccurred: false,
    });
    expect(eligibility.reasonCodes).toEqual([
      "ROUTER_V3_DEPLOYMENT_BOUND_SUCCESSOR_MISSING",
      "NESTED_FACTORY_PROFILE_CAPABILITY_BINDING_MISSING",
      "SHARDS_ACTIVE_GRANT_MISSING",
      "SHARDS_REGISTRY_V1_ROUTE_ADAPTER_MISSING",
      "SHARDS_LAUNCH_DESCRIPTOR_FEE_POLICY_PROFILE_MISSING",
      "SHARDS_REGISTRY_V1_FEE_POLICY_PROFILE_MISSING",
      "SHARDS_REGISTRY_V1_AUTHORIZATION_AND_FINALITY_BYTES_MISSING",
      "CUSTOM_LAUNCH_AUTHENTICATED_CANARY_FEE_POLICY_SCHEMA_DRIFT",
    ]);
    expect(eligibility.requiredBindings).toHaveLength(8);
    expect(eligibility.requiredBindings.every(({ value }) => value === null))
      .toBe(true);
    expect(JSON.stringify(eligibility).toLowerCase()).not.toContain("hookemon");
  });

  it("binds the reviewed Shards applicant, route artifact, and inclusive 80/10/10 fee", () => {
    expect(eligibility.reviewedApplicant).toEqual({
      githubLogin: "jesse-stahl",
      githubUserId: "155705664",
      launchWallet: "0xceebb3a6543cebeb2ed66963897a0abea52a50cc",
      sourceRepository: "jesse-stahl/shards-v1",
      sourceRepositoryId: "1329073878",
      sourceCommit: "91b38f3de64d96cac7e29f127c004f128fc1da59",
      sourceTree: "92d6def8609e829487adea66c13901734e43c8c7",
      approvalPullRequest: "0xprogrammable/hookbuilder#6",
      approvalHead: "1aa5017154d227e639cfe6256f39bf3916352124",
      approvalTree: "48149d436bf222c440980e1fc31a71899b833af7",
    });
    expect(eligibility.reviewedArtifacts.nestedFactoryRoute).toMatchObject({
      presentInWebsite: false,
      byteLength: 1_287_041,
      sha256:
        "066475058bfd47b85b4216f95b434756d67d7e289ffb36535c121ef5d7c11bab",
      keccak256:
        "0x8c5521d6796e3e63c3e2cf82e1122c952e6465c345d8a10b3773a70aa2419fb3",
    });
    expect(existsSync(join(
      process.cwd(),
      eligibility.reviewedArtifacts.nestedFactoryRoute.path,
    ))).toBe(false);
    const fee = eligibility.reviewedArtifacts.feeDescriptor;
    expect(fee).toMatchObject({
      rawSha256:
        "d1c911686afc62b70f3d65c9807e89146d119c4e6f4604e72d3dab2b4ef8dc22",
      revenuePolicyHash:
        "0xaa78b0bf63fca83fa9b969fbb6b2bb1ecabcbe49908a48f92403e8e51e4adab2",
      totalFeeBps: 100,
      chargeMode: "included-in-total",
    });
    expect(fee.legs.reduce((sum, { rateBps }) => sum + rateBps, 0)).toBe(100);
    expect(fee.legs).toEqual([
      { role: "nft-holders", rateBps: 80 },
      { role: "builder", rateBps: 10 },
      { role: "programmable", rateBps: 10 },
    ]);
  });

  it("matches the current source-only V3 and inert nested-factory bindings", () => {
    expect(ROUTER_V2_SHARED_LIFECYCLE_V3_SOURCE_ONLY_STATE).toMatchObject({
      lifecycleVersion: eligibility.genericRouteContract.lifecycleVersion,
      deploymentState: eligibility.genericRouteContract.deploymentState,
      activationState: eligibility.genericRouteContract.activationState,
      authorityIoState: eligibility.genericRouteContract.authorityIoState,
      websiteBindingState: eligibility.genericRouteContract.websiteBindingState,
      shardsState: eligibility.genericRouteContract.shardsState,
      activationAllowed: false,
    });
    expect(eligibility.genericRouteContract).toMatchObject({
      feePolicyCompatibility:
        "ANALYSIS_PENDING_NO_100_BPS_INCLUSIVE_80_10_10_PROFILE",
      deploymentProbeFeePolicyFieldState: "MISSING_REQUIRED_ROUTE_FIELD",
    });
    const responseContract = readFileSync(join(
      process.cwd(),
      "lib/custom-launch/response-contract-v2.ts",
    ), "utf8");
    const deploymentProbe = readFileSync(join(
      process.cwd(),
      "scripts/custom-launch-deployment-probe-core.mjs",
    ), "utf8");
    const routeProbe = deploymentProbe.slice(
      deploymentProbe.indexOf("function validateLaunchRoute(value)"),
      deploymentProbe.indexOf("function validateForeignApplicationDenial(value)"),
    );
    expect(responseContract).toContain('"walletExecutionKind", "transactionValuePolicy", "feePolicy"');
    expect(routeProbe).not.toContain('"feePolicy"');
    const nested = ROUTER_V2_SHARED_LIFECYCLE_V3_SOURCE_ONLY_STATE.profiles
      .find(({ slotId }) => slotId === eligibility.genericRouteContract.nestedFactorySlotId);
    expect(nested).toMatchObject({
      architecture: "NESTED_FACTORY",
      state: eligibility.genericRouteContract.nestedFactoryState,
      activationAllowed: false,
    });
    expect(MANUAL_ROUTER_NESTED_FACTORY_BINDING_V2).toMatchObject({
      active: false,
      activationAllowed: false,
      router: {
        address: null,
        runtimeCodeHash: null,
        directLaunchSelector: null,
      },
      module: { address: null, runtimeCodeHash: null },
      exactPlan: {
        launchWallet: null,
        revenuePolicyHash:
          eligibility.reviewedArtifacts.feeDescriptor.revenuePolicyHash,
      },
    });
  });

  it("pins the deployed Registry V1 while denying an invented Shards bridge", () => {
    const registry = registryDeployment.contracts.find(
      ({ name }) => name === "ProgrammableCustomRegistryV1",
    );
    const registrar = registryDeployment.contracts.find(
      ({ name }) => name === "ProgrammableCustomAtomicRegistrarV1",
    );
    expect(registry).toMatchObject({
      address: eligibility.registryV1.registry.address,
      blockNumber: eligibility.registryV1.registry.startBlock,
      runtimeCodeHash: eligibility.registryV1.registry.runtimeCodeHash,
    });
    expect(registrar).toMatchObject({
      address: eligibility.registryV1.atomicRegistrar.address,
      blockNumber: eligibility.registryV1.atomicRegistrar.startBlock,
      runtimeCodeHash: eligibility.registryV1.atomicRegistrar.runtimeCodeHash,
    });
    expect(eligibility.registryV1).toMatchObject({
      routeCompatibility: "ANALYSIS_PENDING_NO_SHARDS_ADAPTER",
      feePolicyCompatibility: "ANALYSIS_PENDING_NO_100_BPS_INCLUSIVE_PROFILE",
      minimumFinalityBlocks: 64,
    });
    expect(eligibility.registryV1.supportedFeeProfiles).not.toContain(
      "SHARDS_100_BPS_80_10_10",
    );
  });

  it("fails if any exact Website source input drifts", () => {
    for (const binding of eligibility.websiteBaseline.fileBindings as FileBinding[]) {
      expect(rawSha256(join(process.cwd(), binding.path)), binding.path)
        .toBe(binding.rawSha256);
    }
  });
});
