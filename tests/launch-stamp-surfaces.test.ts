import { afterEach, describe, expect, it, vi } from "vitest";

import {
  canUseClassicTokenTrade,
  parseDetailPayload,
} from "../components/token-detail-view";
import {
  getTokenCards,
  loadExplorePayload,
  tokenLaunchModelGroup,
} from "../components/explore-view";
import { canonicalTokenExploreEntryV1 } from "../lib/explore-entry-v1";
import {
  isLaunchStampProvenanceV1,
  type LauncherToken,
} from "../lib/tokens";
import {
  classicLaunchStampProvenance,
  customGraphExploreEntry,
  customGraphToken,
  launchStampProvenance,
  stampedClassicExploreEntry,
  stampedClassicToken,
} from "./launch-stamp-surface-fixture";

const legacyClassicToken = {
  id: "1:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  name: "Legacy Classic",
  symbol: "LEGACY",
  tokenAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  hookAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  poolId: `0x${"cc".repeat(32)}`,
  launchedAt: "2026-08-08T12:00:00.000Z",
  totalSwapFeeBps: 100,
  launchModel: "classic",
  launchModelVersion: "classic-v3",
  liquidityPath: "meme",
} as const satisfies LauncherToken;

function detailPayload(
  token: unknown,
  chainId = 1,
) {
  return {
    status: "ready",
    token,
    customProject: null,
    snapshot: { chainId },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("canonical Router stamp surfaces", () => {
  it("classifies a valid Custom Graph from the canonical stamp kind", () => {
    const entry = canonicalTokenExploreEntryV1(customGraphToken);

    expect(entry.launchCategoryProvenance).toMatchObject({
      category: "custom",
      source: "canonical-launch-stamp-router",
      launchId: customGraphToken.launchStampProvenance.launchId,
      stampHash: customGraphToken.launchStampProvenance.stampHash,
    });
  });

  it("classifies a valid stamped Classic without falling back to the legacy source", () => {
    const entry = canonicalTokenExploreEntryV1(stampedClassicToken);

    expect(entry.launchCategoryProvenance).toMatchObject({
      category: "classic",
      source: "canonical-launch-stamp-router",
      launchId: stampedClassicToken.launchStampProvenance.launchId,
      stampHash: stampedClassicToken.launchStampProvenance.stampHash,
    });
  });

  it("preserves the existing unstamped Classic read-model provenance", () => {
    const entry = canonicalTokenExploreEntryV1(legacyClassicToken);

    expect(entry.launchCategoryProvenance).toEqual({
      schemaVersion: "programmable.explore-launch-category-provenance.v1",
      category: "classic",
      source: "canonical-launch-read-model",
      recordId: legacyClassicToken.id,
      modelId: "classic",
      modelVersion: "classic-v3",
    });
  });

  it("rejects launch-model and stamp-kind mismatches in both directions", () => {
    expect(() =>
      canonicalTokenExploreEntryV1({
        ...customGraphToken,
        launchStampProvenance: classicLaunchStampProvenance,
      }),
    ).toThrow(/provenance|stamp kind/iu);

    expect(() =>
      canonicalTokenExploreEntryV1({
        ...stampedClassicToken,
        launchStampProvenance: customGraphToken.launchStampProvenance,
      }),
    ).toThrow(/provenance|stamp kind/iu);
  });

  it("binds the public proof to the Mainnet trust root and Router limits", () => {
    expect(isLaunchStampProvenanceV1(launchStampProvenance)).toBe(true);
    expect(isLaunchStampProvenanceV1({
      ...launchStampProvenance,
      routerRuntimeCodeHash: `0x${"00".repeat(32)}`,
    })).toBe(false);
    expect(isLaunchStampProvenanceV1({
      ...launchStampProvenance,
      poolKey: { ...launchStampProvenance.poolKey, fee: 0x80_00_01 },
    })).toBe(false);
    expect(isLaunchStampProvenanceV1({
      ...launchStampProvenance,
      components: launchStampProvenance.components.slice(0, 1),
    })).toBe(false);
    expect(isLaunchStampProvenanceV1({
      ...launchStampProvenance,
      finalizedAtBlockNumber: "25718016",
    })).toBe(false);
    expect(isLaunchStampProvenanceV1({
      ...launchStampProvenance,
      blockNumber: "25717611",
    })).toBe(false);
    expect(isLaunchStampProvenanceV1({
      ...launchStampProvenance,
      poolKeyHash: `0x${"00".repeat(32)}`,
    })).toBe(false);
    expect(isLaunchStampProvenanceV1({
      ...launchStampProvenance,
      routeLauncherRuntimeCodeHash: `0x${"00".repeat(32)}`,
    })).toBe(false);
    expect(isLaunchStampProvenanceV1({
      ...launchStampProvenance,
      components: launchStampProvenance.components.map((component) => ({
        ...component,
        runtimeCodeHash: `0x${"00".repeat(32)}` as `0x${string}`,
      })),
    })).toBe(false);
    expect(isLaunchStampProvenanceV1({
      ...launchStampProvenance,
      launchLogIndex: launchStampProvenance.launchLogIndex + 1,
    })).toBe(false);
    expect(isLaunchStampProvenanceV1({
      ...launchStampProvenance,
      components: [...launchStampProvenance.components].reverse(),
    })).toBe(false);
    expect(isLaunchStampProvenanceV1({
      ...launchStampProvenance,
      components: [
        { ...launchStampProvenance.components[0], logIndex: 0 },
        launchStampProvenance.components[1],
      ],
    })).toBe(false);
  });

  it("rejects any Router fee claim without a separate capability", () => {
    expect(() => canonicalTokenExploreEntryV1({
      ...stampedClassicToken,
      totalSwapFeeBps: 100,
    })).toThrow(/stamp/iu);
    expect(() => parseDetailPayload(detailPayload({
      ...stampedClassicExploreEntry,
      totalSwapFeeBps: 100,
    }))).toThrow(/invalid token/iu);
  });

  it("accepts complete Custom Graph and stamped Classic detail records", () => {
    const custom = parseDetailPayload(detailPayload(customGraphExploreEntry));
    const classic = parseDetailPayload(detailPayload(stampedClassicExploreEntry));

    expect(custom.token).toMatchObject({
      launchModel: "custom-graph",
      launchStampProvenance: { kind: "custom-graph", chainId: 1 },
    });
    expect(classic.token).toMatchObject({
      launchModel: "classic",
      launchStampProvenance: { kind: "classic", chainId: 1 },
    });
  });

  it("parses and labels both Router categories from the stamp", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        status: "ready",
        tokens: [customGraphExploreEntry, stampedClassicExploreEntry],
        page: 1,
        pageSize: 9,
        total: 2,
        totalPages: 1,
        catalog: {
          source: "envio-classic-v3",
          launchSource:
            "envio-classic-v3+registry.custom-launched+canonical-launch-stamp-router",
          status: "current",
          lastIndexedAt: "2026-08-16T08:00:00.000Z",
          asOfBlock: "25740000",
          asOfBlockHash: `0x${"aa".repeat(32)}`,
          identityCount: 2,
          identityCommitment: `sha256:${"bb".repeat(32)}`,
          completeness: {
            classic: "current",
            stock: "excluded",
            custom: "current",
            registryCustom: "current",
            routerCustom: "current",
          },
          scope: {
            included: [
              "classic-v3",
              "classic-v4",
              "official-main-token",
              "registry.custom-launched",
              "canonical-launch-stamp-router",
            ],
            excluded: [
              "classic-v1",
              "classic-v2",
              "stock-paired-v1",
              "stock-paired-v2",
              "stock-paired-v3",
            ],
            publicCategories: ["classic", "custom"],
          },
          evidence: {
            kind: "envio-indexer-state",
            deployment: "production-92f6373",
            sourceCommit: "92f63731ff0a61601a649cf40ceba3e492f63c62",
            progressBlock: "25740000",
            progressOccurrenceId: `1:0x${"11".repeat(32)}:0x${"22".repeat(32)}:0`,
            commitment: `sha256:${"cc".repeat(32)}`,
          },
          routerStamp: {
            source: "canonical-launch-stamp-router",
            status: "current",
            finalityConfirmations: 64,
            verifiedIdentityCount: 2,
            projectedIdentityCount: 2,
          },
        },
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const payload = await loadExplorePayload(
      `router-stamp-${Date.now()}`,
      new URLSearchParams(),
    );

    expect(payload.tokens.map(tokenLaunchModelGroup)).toEqual([
      "custom-hook",
      "classic",
    ]);
    expect(getTokenCards(payload.tokens).map((card) => card.launchCategory))
      .toEqual(["Custom", "Classic"]);
    expect(payload.tokens[0]).toMatchObject({
      launchStampProvenance: { kind: "custom-graph" },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fills missing Router card copy without inventing market data", () => {
    const authoredDescription = "An authored token description.";
    const cards = getTokenCards([
      customGraphExploreEntry,
      stampedClassicExploreEntry,
      {
        ...customGraphExploreEntry,
        id: `${customGraphExploreEntry.id}:authored`,
        description: authoredDescription,
      },
      canonicalTokenExploreEntryV1(legacyClassicToken),
    ]);

    expect(cards[0]).toMatchObject({
      launchCategory: "Custom",
      description:
        "Canonical Router stamp. v4 pool initialized.",
      valuation: undefined,
      marketStatus: "Unavailable",
    });
    expect(cards[1]).toMatchObject({
      launchCategory: "Classic",
      description:
        "Canonical Router stamp. v4 pool initialized.",
      valuation: undefined,
      marketStatus: "Unavailable",
    });
    expect(cards[0]).not.toHaveProperty("marketCap");
    expect(cards[1]).not.toHaveProperty("marketCap");
    expect(cards[2]?.description).toBe(authoredDescription);
    expect(cards[3]?.description).toBeUndefined();
  });

  it("rejects a stamped detail record on snapshot-chain drift", () => {
    expect(() =>
      parseDetailPayload(detailPayload(customGraphExploreEntry, 10)),
    ).toThrow(/snapshot|invalid token/iu);
  });

  it("rejects category and canonical provenance tampering", () => {
    expect(() =>
      parseDetailPayload(detailPayload({
        ...customGraphExploreEntry,
        launchCategoryProvenance: {
          ...customGraphExploreEntry.launchCategoryProvenance,
          category: "classic",
        },
      })),
    ).toThrow(/invalid token/iu);

    expect(() =>
      parseDetailPayload(detailPayload({
        ...stampedClassicExploreEntry,
        launchStampProvenance: {
          ...stampedClassicExploreEntry.launchStampProvenance,
          routerAddress: "0x9999999999999999999999999999999999999999",
        },
      })),
    ).toThrow(/invalid token/iu);
  });

  it("never enables legacy Classic trade for a stamped token", () => {
    expect(canUseClassicTokenTrade(customGraphToken)).toBe(false);
    expect(canUseClassicTokenTrade(stampedClassicToken)).toBe(false);
    expect(canUseClassicTokenTrade({
      ...stampedClassicToken,
      totalSwapFeeBps: 100,
      liquidityPath: "meme",
    })).toBe(false);
    expect(canUseClassicTokenTrade(legacyClassicToken)).toBe(true);
  });
});
