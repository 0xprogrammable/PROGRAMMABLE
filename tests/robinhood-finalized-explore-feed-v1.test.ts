import { describe, expect, it, vi } from "vitest";
import {
  encodeAbiParameters,
  padHex,
  parseAbiParameters,
  toHex,
  type Hex,
} from "viem";

vi.mock("server-only", () => ({}));

import {
  readRobinhoodFinalizedExploreSnapshotV1,
  type RobinhoodFinalizedExploreEthereumClientV1,
  type RobinhoodFinalizedExploreReaderClientV1,
} from "../lib/server/custom-launch/robinhood-finalized-explore-feed-v1";
import { customGraphExploreEntry } from "./launch-stamp-surface-fixture";

// @ts-expect-error -- the canonical package fixtures intentionally ship as ESM JS.
import { validV4OnchainEvidenceV3, validV4ProjectMetadata, validV4Resource, validV4SourceVerificationStatus } from "../packages/launch/test/fixtures/v4.mjs";
// @ts-expect-error -- the canonical package runtime intentionally ships as ESM JS.
import { hashProjectMetadata } from "../packages/launch/src/project-metadata.mjs";

const NOW = Date.parse("2026-09-03T07:00:00.000Z");

function publicCacheHeaders() {
  return {
    "cache-control": "public, max-age=15, stale-while-revalidate=300",
    "content-type": "application/json; charset=utf-8",
  };
}

function page(quality: Readonly<{
  status: string;
  sourceRowCount: number;
  publishedRowCount: number;
  quarantinedRowCount: number;
}>) {
  return new Response(JSON.stringify({
    schemaVersion: "programmable.custom-launch-list.v4",
    apiVersion: "v4",
    chainId: "4663",
    caip2: "eip155:4663",
    generatedAt: new Date(NOW).toISOString(),
    quality,
    launches: [],
    nextCursor: null,
  }), {
    status: 200,
    headers: publicCacheHeaders(),
  });
}

function finalizedLaunchFixture() {
  const initialProjectMetadata = validV4ProjectMetadata();
  const projectMetadata = {
    ...initialProjectMetadata,
    presentation: {
      ...initialProjectMetadata.presentation,
      links: [
        { kind: "documentation", uri: "https://example.com/docs" },
        ...initialProjectMetadata.presentation.links,
      ],
    },
  };
  const initial = validV4Resource();
  const resource = {
    ...initial,
    projectMetadata,
    commitments: {
      ...initial.commitments,
      metadata: hashProjectMetadata(projectMetadata, { requireComplete: true }),
    },
  };
  const initialOnchain = validV4OnchainEvidenceV3(resource);
  const onchain = {
    ...initialOnchain,
    l2Inclusion: {
      ...initialOnchain.l2Inclusion,
      blockNumber: "50470000",
      launchEventLogIndex: 6,
    },
  };
  const publicOnchain = structuredClone(onchain);
  Reflect.deleteProperty(publicOnchain, "walletTransactionPreimageHash");
  const exactEvidence = (providerDigit: string, bindingDigit: string) => ({
    providerObservation: {
      provider: "sourcify-v2",
      classification: "PARTIAL_NO_CBOR_EXACT_BYTES",
      match: "match",
      creationMatch: "match",
      runtimeMatch: "match",
      releaseAuthority: false,
      evidenceDigest: `sha256:${providerDigit.repeat(64)}`,
    },
    exactSourceAuthority:
      "protected-hosted-build-finalized-transaction-bytecode",
    exactSourceBinding: {
      schemaVersion:
        "programmable.robinhood-custom-launch.exact-byte-source-build-transaction-binding.v1",
      authority: "protected-hosted-build-finalized-transaction-bytecode",
      coveredEvidence: [
        "protected-source-tree",
        "source-closure",
        "hosted-build-artifact",
        "standard-json-input",
        "compiler-binary",
        "compiler-settings",
        "finalized-creation-transaction",
        "creation-bytecode",
        "runtime-bytecode",
      ],
      bindingDigest: `sha256:${bindingDigit.repeat(64)}`,
    },
  });
  const sourceVerification = validV4SourceVerificationStatus({
    components: [
      {
        targetId: "hook",
        address: "0x2222222222222222222222222222222222222222",
        status: "exact_match",
        ...exactEvidence("8", "a"),
        updatedAt: "2026-09-03T06:59:58.000Z",
      },
      {
        targetId: "token",
        address: "0x1111111111111111111111111111111111111111",
        status: "exact_match",
        ...exactEvidence("9", "b"),
        updatedAt: "2026-09-03T06:59:59.000Z",
      },
    ],
  });
  return {
    schemaVersion: "programmable.finalized-custom-launch-metadata.v4",
    apiVersion: "v4",
    launchId: resource.launchId,
    chainId: resource.chainId,
    caip2: resource.caip2,
    chainDeploymentId: resource.chainDeploymentId,
    chainDeploymentDescriptorDigest: resource.chainDeploymentDescriptorDigest,
    chainDeployment: resource.chainDeployment,
    profile: resource.profile,
    platformId: "programmable",
    category: "custom",
    projectMetadata,
    funding: resource.funding,
    liquidityModel: resource.liquidityModel,
    commitments: resource.commitments,
    onchain: publicOnchain,
    sourceVerification,
    createdAt: resource.createdAt,
    finalizedAt: "2026-09-03T06:59:59.000Z",
  };
}

function ethereumPostingLog(launch: ReturnType<typeof finalizedLaunchFixture>) {
  const posting = launch.onchain.l1Posting;
  return {
    address: posting.sequencerInbox,
    blockHash: posting.blockHash,
    blockNumber: BigInt(posting.blockNumber),
    data: encodeAbiParameters(
      parseAbiParameters(
        "bytes32 delayedAcc,uint256 afterDelayedMessagesRead,(uint64 delayBlocks,uint64 futureBlocks,uint64 delaySeconds,uint64 futureSeconds) timeBounds,uint8 dataLocation",
      ),
      [
        `0x${"c".repeat(64)}`,
        1n,
        {
          delayBlocks: 1n,
          futureBlocks: 2n,
          delaySeconds: 3n,
          futureSeconds: 4n,
        },
        0,
      ],
    ),
    logIndex: posting.logIndex,
    removed: false,
    topics: [
      "0x7394f4a19a13c7b92b5bb71033245305946ef78452f7b4986ac1390b5df4ebd7",
      padHex(toHex(BigInt(posting.batchNumber)), { size: 32 }),
      `0x${"a".repeat(64)}`,
      `0x${"b".repeat(64)}`,
    ],
    transactionHash: posting.transactionHash,
    transactionIndex: 0,
  };
}

function ethereumClient(launch: ReturnType<typeof finalizedLaunchFixture>) {
  const posting = launch.onchain.l1Posting;
  const checkpoint = launch.onchain.l1FinalizedCheckpoint;
  const log = ethereumPostingLog(launch);
  return {
    getChainId: vi.fn(async () => 1),
    getTransactionReceipt: vi.fn(async () => ({
      status: "success",
      transactionHash: posting.transactionHash,
      blockNumber: BigInt(posting.blockNumber),
      blockHash: posting.blockHash,
      logs: [log],
    })),
    getBlock: vi.fn(async (input: Readonly<{
      blockNumber?: bigint;
      blockTag?: string;
    }>) => {
      if (input.blockTag === "finalized") {
        return {
          number: BigInt(checkpoint.blockNumber) + 1n,
          hash: `0x${"d".repeat(64)}` as Hex,
        };
      }
      if (input.blockNumber === BigInt(posting.blockNumber)) {
        return { number: input.blockNumber, hash: posting.blockHash };
      }
      return {
        number: BigInt(checkpoint.blockNumber),
        hash: checkpoint.blockHash,
      };
    }),
  } as unknown as RobinhoodFinalizedExploreEthereumClientV1;
}

describe("Robinhood finalized Explore feed", () => {
  it.each([
    {
      name: "quarantined backend rows",
      quality: {
        status: "ready",
        sourceRowCount: 3,
        publishedRowCount: 0,
        quarantinedRowCount: 3,
      },
    },
    {
      name: "empty backend dataset",
      quality: {
        status: "ready",
        sourceRowCount: 0,
        publishedRowCount: 0,
        quarantinedRowCount: 0,
      },
    },
    {
      name: "non-ready backend status",
      quality: {
        status: "partial",
        sourceRowCount: 1,
        publishedRowCount: 1,
        quarantinedRowCount: 0,
      },
    },
  ])("fails closed before RPC verification for $name", async ({ quality }) => {
    const getChainId = vi.fn();
    const client = { getChainId } as unknown as
      RobinhoodFinalizedExploreReaderClientV1;

    await expect(readRobinhoodFinalizedExploreSnapshotV1({
      fetchFeed: (async () => page(quality)) as typeof fetch,
      client,
      now: () => NOW,
      timeoutMs: 50,
    })).rejects.toThrow(/not publishable/u);
    expect(getChainId).not.toHaveBeenCalled();
  });

  it("accepts a complete V4 item and projects full metadata after both L1 providers agree", async () => {
    const launch = finalizedLaunchFixture();
    const feed = new Response(JSON.stringify({
      schemaVersion: "programmable.custom-launch-list.v4",
      apiVersion: "v4",
      chainId: "4663",
      caip2: "eip155:4663",
      generatedAt: new Date(NOW).toISOString(),
      quality: {
        status: "ready",
        sourceRowCount: 1,
        publishedRowCount: 1,
        quarantinedRowCount: 0,
      },
      launches: [launch],
      nextCursor: null,
    }), { status: 200, headers: publicCacheHeaders() });
    const client = {
      getChainId: vi.fn(async () => 4663),
      getBlockNumber: vi.fn(async () => 50_470_100n),
      getBlock: vi.fn(async () => ({
        number: 50_470_100n,
        hash: `0x${"e".repeat(64)}` as Hex,
        timestamp: 1_788_006_700n,
      })),
    } as unknown as RobinhoodFinalizedExploreReaderClientV1;
    const primary = ethereumClient(launch);
    const secondary = ethereumClient(launch);
    const projected = {
      ...customGraphExploreEntry,
      id: `4663:${customGraphExploreEntry.tokenAddress.toLowerCase()}`,
      name: "Robinhood V4 Test",
      symbol: "RHV4",
      description:
        "Deterministic Robinhood Chain V4 launch metadata fixture",
      imageUrl: "https://example.com/token.png",
      projectMetadataLinks: [
        { kind: "documentation" as const, url: "https://example.com/docs" },
        { kind: "website" as const, url: "https://example.com/" },
        { kind: "x" as const, url: "https://x.com/programmable" },
      ],
      projectMetadataStatus: "current" as const,
    };
    const verifyLaunch = vi.fn(async (parsed) => {
      expect(parsed.projectMetadata).toMatchObject({
        imageUrl: "https://example.com/token.png",
        projectMetadataLinks: projected.projectMetadataLinks,
        links: [
          { kind: "website", url: "https://example.com/" },
          { kind: "x", url: "https://x.com/programmable" },
        ],
      });
      expect(parsed.evidenceDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
      return projected;
    });

    const snapshot = await readRobinhoodFinalizedExploreSnapshotV1({
      fetchFeed: (async () => feed) as typeof fetch,
      client,
      ethereumClients: [primary, secondary],
      verifyLaunch,
      now: () => NOW,
      timeoutMs: 50,
    });

    expect(snapshot.entries).toEqual([projected]);
    expect(snapshot.quality).toEqual({
      status: "ready",
      sourceRowCount: 1,
      publishedRowCount: 1,
      quarantinedRowCount: 0,
    });
    expect(verifyLaunch).toHaveBeenCalledOnce();
    for (const ethereum of [primary, secondary]) {
      expect(ethereum.getTransactionReceipt).toHaveBeenCalledOnce();
      expect(ethereum.getBlock).toHaveBeenCalledTimes(3);
    }
  });

  it("rejects a complete item whose public onchain evidence omits evidenceDigest", async () => {
    const launch = finalizedLaunchFixture();
    const onchain = structuredClone(launch.onchain);
    Reflect.deleteProperty(onchain, "evidenceDigest");
    const feed = new Response(JSON.stringify({
      schemaVersion: "programmable.custom-launch-list.v4",
      apiVersion: "v4",
      chainId: "4663",
      caip2: "eip155:4663",
      generatedAt: new Date(NOW).toISOString(),
      quality: {
        status: "ready",
        sourceRowCount: 1,
        publishedRowCount: 1,
        quarantinedRowCount: 0,
      },
      launches: [{ ...launch, onchain }],
      nextCursor: null,
    }), { status: 200, headers: publicCacheHeaders() });
    const getChainId = vi.fn();

    await expect(readRobinhoodFinalizedExploreSnapshotV1({
      fetchFeed: (async () => feed) as typeof fetch,
      client: { getChainId } as unknown as
        RobinhoodFinalizedExploreReaderClientV1,
      now: () => NOW,
      timeoutMs: 50,
    })).rejects.toThrow(/unknown or missing fields/u);
    expect(getChainId).not.toHaveBeenCalled();
  });

});
