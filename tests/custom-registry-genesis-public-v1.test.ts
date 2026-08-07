import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  GENESIS_CANARY_VERIFIED_REGISTRY_CUSTOM_LAUNCH_V1,
  withGenesisCanaryRegistryCustomStoreV1,
} from "../lib/server/custom-launch/genesis-canary-public-v1";
import { customLaunchProjectToExploreEntryV1 } from
  "../lib/server/custom-launch/explore-directory-v1";
import {
  parseRegistryCustomLaunchPublicRecordV1,
  type RegistryCustomLaunchPublicReadStoreV1,
} from "../lib/server/custom-launch/registry-public-store-v1";

const emptyStore: RegistryCustomLaunchPublicReadStoreV1 = Object.freeze({
  sourceLane: "registry.custom-launched" as const,
  async findFinalizedCustomLaunchByProjectId() {
    return null;
  },
  async findFinalizedCustomLaunchesPublic() {
    return Object.freeze([]);
  },
  async findFinalizedCustomLaunchesByWallet() {
    return Object.freeze([]);
  },
  async findVerifiedRegistryCustomLaunchByProjectId() {
    return null;
  },
  async findVerifiedRegistryCustomLaunchesPublic() {
    return Object.freeze([]);
  },
});

describe("finalized Custom Registry genesis canary", () => {
  it("publishes the exact authorityless, marketless Mainnet Registry record", async () => {
    const verified = GENESIS_CANARY_VERIFIED_REGISTRY_CUSTOM_LAUNCH_V1;
    const store = withGenesisCanaryRegistryCustomStoreV1(emptyStore);
    const signal = new AbortController().signal;

    expect(verified.record).toMatchObject({
      projectId: "sha256:897608bd2a9e7758334d4fb82153dffdcff016d742b87e0b490e8cf98b63a8ff",
      launchId: "sha256:329016f555ac688de1980078680f783b3e9a59f098b054a4d0cb4044a5b5594e",
      configurationHash: "0xac9064bed5278c749616bac7ae3f1de5f8957f075ff847ff1ad62efe395c4f05",
      registry: {
        chainId: "1",
        registryAddress: "0x17e18c88bda9bfb73924cdc989c07b0707e72671",
        startBlock: "25701139",
      },
      event: {
        transactionHash: "0x71efe312d6d74030744174bfe8d5b3d82e6599915eb3108897076b0f392652db",
        blockNumber: "25701424",
        transactionIndex: 148,
        logIndex: 408,
      },
      provider: {
        providerId: "programmable",
        modelId: "programmable.registry-genesis-canary",
        modelVersion: "1.0.0",
        marketPath: null,
      },
      project: {
        advertisesToken: false,
        discoverableAssets: [],
        discoverableMarkets: [],
        launchIdentity: {
          namespace: "eip155:1",
          value: "0x1d70acbbe83283b1597401569efead0ba5312e28",
        },
        postLaunchAuthorityInventory: {
          addressBindings: [],
          declaredIdentityBindings: [],
          postLaunchAuthorities: [],
        },
        feeObligation: {
          policy: {
            providerId: "programmable",
            feeMode: "no-qualifying-market",
            totalRateBps: 0,
            normalProgrammableTenBpsApplied: false,
          },
        },
      },
    });
    await expect(store.findVerifiedRegistryCustomLaunchesPublic({ signal }))
      .resolves.toEqual([verified]);
    await expect(store.findFinalizedCustomLaunchesByWallet({
      namespace: "eip155:1",
      value: "0x2bb333d48dfaf1596d9036671d2e43168994249e",
      signal,
    })).resolves.toEqual([verified.record.project]);
    expect(customLaunchProjectToExploreEntryV1(verified)).toMatchObject({
      exploreKind: "custom-project",
      name: "programmable.registry-genesis-canary",
      markets: [],
      customProjectId: verified.record.projectId,
      customLaunchId: verified.record.launchId,
    });
  });

  it("rejects substituted configuration and incomplete finality", () => {
    const record = GENESIS_CANARY_VERIFIED_REGISTRY_CUSTOM_LAUNCH_V1.record;
    expect(() => parseRegistryCustomLaunchPublicRecordV1({
      ...record,
      configurationHash: "0x1234",
    })).toThrow("configuration hash is invalid");
    expect(() => parseRegistryCustomLaunchPublicRecordV1({
      ...record,
      finality: {
        ...record.finality,
        observedHeadBlockNumber: record.event.blockNumber,
      },
    })).toThrow("public bindings are inconsistent");
  });
});
