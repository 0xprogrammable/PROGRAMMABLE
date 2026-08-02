import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  assembleReconcilerCorpusPages,
  assembleReconcilerEntitlementPages,
  createReconcilerCorpusManifest,
  createReconcilerEntitlementManifest,
  RECONCILER_CORPUS_MAXIMUM_TOTAL_COUNT,
  RECONCILER_CORPUS_PARTITION_SIZE,
} from "../../lib/data-pipeline/reconciler-corpus-partitions";
import type { HexBytes32 } from "../../lib/data-pipeline/codecs";
import type { ReconcilerPreParityContract } from "../../lib/data-pipeline/reconciler-preparity";

function hex(value: number, bytes: number): `0x${string}` {
  return `0x${value.toString(16).padStart(bytes * 2, "0")}`;
}

function corpus(count: number) {
  return Array.from({ length: count }, (_, index) => Object.freeze({
    tokenAddress: hex(index + 1, 20),
    poolId: hex(index + 1, 32) as HexBytes32,
    launchTransactionHash: hex(index + 10_001, 32) as HexBytes32,
    launchBlockNumber: (25_000_000 + Math.floor(index / 8)).toString(),
    launchTransactionIndex: index % 8,
    launchLogIndex: index,
  }));
}

function contract(count: number): ReconcilerPreParityContract {
  return Object.freeze({
    chainId: "1",
    releaseId: "classic-v3",
    modelId: "classic",
    sourceGroup: "core",
    projectorVersion: "projector-v1",
    epochId: "10000000-0000-4000-8000-000000000001",
    pointerGeneration: "1",
    checkpointId: "10000000-0000-4000-8000-000000000002",
    checkpointGeneration: "1",
    reorgGeneration: "0",
    checkpointBlockNumber: "25650000",
    checkpointBlockHash: hex(999, 32) as HexBytes32,
    routeKeys: Object.freeze([
      "explore-list",
      "explore-token",
      "explore-chart",
      "creator-profile",
      "classic-v3-profile",
      "launch-lookup",
    ] as const),
    routeContract: { version: "route-v1" },
    projectionContract: {
      resultCommitment: hex(998, 32),
      projectionRowCount: count.toString(),
    },
    currentEntities: Array.from({ length: count }, (_, index) => ({
      entityKind: "launch",
      entityKey: hex(index + 1, 20),
    })),
  });
}

describe("reconciler corpus partitions", () => {
  it.each([
    [186, 2],
    [256, 2],
    [257, 3],
    [513, 5],
  ] as const)(
    "partitions and reassembles the complete %i-launch manifest",
    (count, expectedPages) => {
      const identities = corpus(count);
      const manifest = createReconcilerCorpusManifest({
        contract: contract(count),
        identities,
      });

      expect(RECONCILER_CORPUS_PARTITION_SIZE).toBe(128);
      expect(manifest.totalCount).toBe(count);
      expect(manifest.pageCount).toBe(expectedPages);
      expect(manifest.pages.at(-1)?.continuation).toBeNull();
      expect(assembleReconcilerCorpusPages(manifest, manifest.pages))
        .toEqual(identities);
    },
  );

  it("binds every page and continuation to the complete manifest", () => {
    const identities = corpus(257);
    const first = createReconcilerCorpusManifest({
      contract: contract(257),
      identities,
    });
    const reordered = [first.pages[1]!, first.pages[0]!, first.pages[2]!];
    const missing = first.pages.slice(0, -1);

    expect(() => assembleReconcilerCorpusPages(first, reordered)).toThrow();
    expect(() => assembleReconcilerCorpusPages(first, missing)).toThrow();

    const changed = [...identities];
    changed[256] = Object.freeze({
      ...changed[256]!,
      launchTransactionHash: hex(99_999, 32) as HexBytes32,
    });
    const second = createReconcilerCorpusManifest({
      contract: contract(257),
      identities: changed,
    });
    expect(second.manifestCommitment).not.toBe(first.manifestCommitment);
    expect(() => assembleReconcilerCorpusPages(first, second.pages)).toThrow();
  });

  it("rejects a live corpus that omits an indexed launch", () => {
    expect(() => createReconcilerCorpusManifest({
      contract: contract(257),
      identities: corpus(256),
    })).toThrow();
  });

  it("partitions a large reward-entitlement set under its exact corpus page", () => {
    const parent = createReconcilerCorpusManifest({
      contract: contract(128),
      identities: corpus(128),
    });
    const identities = Array.from({ length: 257 }, (_, index) => ({
      tokenAddress: parent.pages[0]!.identities[index % 128]!.tokenAddress,
      vaultAddress: hex(index + 20_001, 20),
      account: hex(index + 30_001, 20),
    }));
    const manifest = createReconcilerEntitlementManifest({
      contract: contract(128),
      parentPage: parent.pages[0]!,
      identities,
    });

    expect(manifest.pageCount).toBe(3);
    expect(assembleReconcilerEntitlementPages(manifest, manifest.pages))
      .toEqual(identities);
    expect(() => createReconcilerEntitlementManifest({
      contract: contract(128),
      parentPage: parent.pages[0]!,
      identities: [{
        tokenAddress: hex(999, 20),
        vaultAddress: hex(998, 20),
        account: hex(997, 20),
      }],
    })).toThrow();
  });

  it("binds projector and route contract changes into the manifest", () => {
    const identities = corpus(1);
    const base = contract(1);
    const commitment = createReconcilerCorpusManifest({
      contract: base,
      identities,
    }).manifestCommitment;
    const variants: ReconcilerPreParityContract[] = [
      Object.freeze({ ...base, projectorVersion: "projector-v2" }),
      Object.freeze({ ...base, routeKeys: base.routeKeys.slice(0, -1) }),
      Object.freeze({ ...base, routeContract: { version: "route-v2" } }),
    ];
    for (const variant of variants) {
      expect(createReconcilerCorpusManifest({
        contract: variant,
        identities,
      }).manifestCommitment).not.toBe(commitment);
    }
  });

  it("requires the exact indexed launch entity-key set", () => {
    const identities = corpus(2);
    const wrongKey = Object.freeze({
      ...contract(2),
      currentEntities: [
        { entityKind: "launch", entityKey: identities[0]!.tokenAddress },
        { entityKind: "launch", entityKey: hex(999, 20) },
      ],
    });
    const duplicateKey = Object.freeze({
      ...contract(2),
      currentEntities: [
        { entityKind: "launch", entityKey: identities[0]!.tokenAddress },
        { entityKind: "launch", entityKey: identities[0]!.tokenAddress },
      ],
    });
    expect(() => createReconcilerCorpusManifest({
      contract: wrongKey,
      identities,
    })).toThrow();
    expect(() => createReconcilerCorpusManifest({
      contract: duplicateKey,
      identities,
    })).toThrow();
  });

  it("shares the explicit 10,000-item operational ceiling", () => {
    expect(RECONCILER_CORPUS_MAXIMUM_TOTAL_COUNT).toBe(10_000);
    expect(() => createReconcilerCorpusManifest({
      contract: contract(10_001),
      identities: corpus(10_001),
    })).toThrow();
  });
});
