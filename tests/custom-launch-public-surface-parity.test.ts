import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import deploymentEvidence from
  "../contracts/deployments/mainnet-custom-registry-v1.json";
import eventSet from "../docs/security/CUSTOM_REGISTRY_EVENT_SET_V1.json";
import { getTokenCards } from "../components/explore-view";
import {
  GENESIS_CANARY_VERIFIED_REGISTRY_CUSTOM_LAUNCH_V1,
} from "../lib/server/custom-launch/genesis-canary-public-v1";
import { customLaunchProjectToExploreEntryV1 } from
  "../lib/server/custom-launch/explore-directory-v1";
import { resolveCustomRegistryPublicManifestV1 } from
  "../lib/server/custom-launch/registry-manifest-v1";
import { programmableWellKnownDocumentV1 } from
  "../lib/server/custom-launch/well-known-v1";

const byName = new Map(deploymentEvidence.contracts.map((contract) => [
  contract.name,
  contract,
]));
const registry = byName.get("ProgrammableCustomRegistryV1")!;
const partnerFactoryRegistry = byName.get(
  "ProgrammableCustomPartnerFactoryRegistryV1",
)!;
const feePolicyVerifier = byName.get("ProgrammableCustomFeePolicyVerifierV1")!;
const atomicRegistrar = byName.get("ProgrammableCustomAtomicRegistrarV1")!;

const productionEnvironment = {
  PROGRAMMABLE_CUSTOM_REGISTRY_PUBLIC_ENABLED: "true",
  PROGRAMMABLE_CUSTOM_REGISTRY_GENERATION: "ethereum-mainnet-v1",
  PROGRAMMABLE_CUSTOM_REGISTRY_START_BLOCK:
    deploymentEvidence.registryStartBlock,
  PROGRAMMABLE_CUSTOM_REGISTRY_ADDRESS: registry.address,
  PROGRAMMABLE_CUSTOM_REGISTRY_RUNTIME_CODE_KECCAK256:
    registry.runtimeCodeHash,
  PROGRAMMABLE_CUSTOM_PARTNER_FACTORY_REGISTRY_ADDRESS:
    partnerFactoryRegistry.address,
  PROGRAMMABLE_CUSTOM_PARTNER_FACTORY_REGISTRY_RUNTIME_CODE_KECCAK256:
    partnerFactoryRegistry.runtimeCodeHash,
  PROGRAMMABLE_CUSTOM_FEE_POLICY_VERIFIER_ADDRESS: feePolicyVerifier.address,
  PROGRAMMABLE_CUSTOM_FEE_POLICY_VERIFIER_RUNTIME_CODE_KECCAK256:
    feePolicyVerifier.runtimeCodeHash,
  PROGRAMMABLE_CUSTOM_ATOMIC_REGISTRAR_ADDRESS: atomicRegistrar.address,
  PROGRAMMABLE_CUSTOM_ATOMIC_REGISTRAR_RUNTIME_CODE_KECCAK256:
    atomicRegistrar.runtimeCodeHash,
  PROGRAMMABLE_CUSTOM_REGISTRY_ABI_IDENTIFIER:
    "programmable.custom-registry-abi.v1",
  PROGRAMMABLE_CUSTOM_REGISTRY_ABI_URL:
    "https://developers.programmable.family/abis/ethereum/programmable-custom-registry-v1.json",
  PROGRAMMABLE_CUSTOM_REGISTRY_EVENT_SET_IDENTIFIER:
    "programmable.custom-registry-event-set.v1",
  PROGRAMMABLE_CUSTOM_REGISTRY_EVENT_SET_URL:
    "https://developers.programmable.family/event-sets/ethereum/programmable-custom-registry-v1.json",
  PROGRAMMABLE_CUSTOM_REGISTRY_HASH_SPEC_IDENTIFIER:
    "programmable.custom-registry-hash-spec.v1",
  PROGRAMMABLE_CUSTOM_REGISTRY_HASH_SPEC_URL:
    "https://developers.programmable.family/specifications/programmable-custom-registry-hashes-v1.json",
} as const;

describe("live Custom public-surface parity", () => {
  it("pins Well-known, manifest, indexer and Explore to one live marketless launch", async () => {
    const manifest = resolveCustomRegistryPublicManifestV1(
      productionEnvironment,
    );
    const wellKnown = programmableWellKnownDocumentV1(manifest);
    const explore = customLaunchProjectToExploreEntryV1(
      GENESIS_CANARY_VERIFIED_REGISTRY_CUSTOM_LAUNCH_V1,
    );
    const cards = getTokenCards([explore]);
    const indexerConfig = await readFile(
      path.join(process.cwd(), "indexer/config.yaml"),
      "utf8",
    );
    const indexerReleaseMap = await readFile(
      path.join(process.cwd(), "indexer/src/lib/release-map.ts"),
      "utf8",
    );

    expect(manifest).toMatchObject({
      status: "live",
      startBlock: deploymentEvidence.registryStartBlock,
    });
    expect(manifest.contracts.registry.address?.toLowerCase()).toBe(
      registry.address,
    );
    expect(wellKnown.publicCategories.custom).toMatchObject({
      discoveryStatus: "live",
      registryAddress: manifest.contracts.registry.address?.toLowerCase() ?? null,
      registryStartBlock: manifest.startBlock,
    });
    expect(explore).toMatchObject({
      exploreKind: "custom-project",
      markets: [],
      launchCategoryProvenance: {
        registryAddress: registry.address,
        registryStartBlock: deploymentEvidence.registryStartBlock,
      },
    });
    expect(cards[0]).toMatchObject({
      launchCategory: "Custom",
      marketStatus: "No market",
    });
    expect(cards[0]).not.toHaveProperty("tokenAddress");
    expect(indexerConfig).toContain(registry.address);
    expect(indexerConfig).toContain("CustomLaunchFeeScopeBoundV1");
    expect(indexerReleaseMap).toContain("startBlock: 25_701_139");
    expect(eventSet.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "feeScope",
        signature:
          "CustomLaunchFeeScopeBoundV1(bytes32,bytes32,bytes32,bytes32,bytes32,bytes32,bytes32,bytes32)",
      }),
    ]));
  });
});
