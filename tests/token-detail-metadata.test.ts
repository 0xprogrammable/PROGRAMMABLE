import { describe, expect, it } from "vitest";

import {
  genericTokenDetailMetadata,
  tokenDetailMetadataFromProjection,
} from "../lib/token-detail-metadata";

const SHARD = "0xFAce73B63787960282f2d4682d3752Beb25271Ad";

function readyProjection(
  overrides: Record<string, unknown> = {},
) {
  return {
    status: 200,
    body: {
      status: "ready",
      token: {
        tokenAddress: SHARD,
        name: "Shard",
        symbol: "SHARD",
        description: "The NFT bonding curve built directly on UNI v4",
        imageUrl: "/brand/projects/shard-token-v1.png",
        ...overrides,
      },
      customProject: null,
    },
  };
}

describe("token detail metadata", () => {
  it("projects exact token metadata from the server-bound detail response", () => {
    const metadata = tokenDetailMetadataFromProjection(
      SHARD,
      readyProjection(),
    );

    expect(metadata.title).toBe("Shard ($SHARD) | Programmable");
    expect(metadata.description).toBe(
      "The NFT bonding curve built directly on UNI v4",
    );
    expect(metadata.alternates?.canonical).toBe(
      `https://programmable.market/token/${SHARD}`,
    );
    expect(metadata.openGraph).toMatchObject({
      url: `https://programmable.market/token/${SHARD}`,
      title: "Shard ($SHARD) | Programmable",
      description: "The NFT bonding curve built directly on UNI v4",
      images: [{
        url: "https://programmable.market/brand/projects/shard-token-v1.png",
        alt: "Shard artwork",
      }],
    });
    expect(metadata.twitter).toMatchObject({
      card: "summary_large_image",
      title: "Shard ($SHARD) | Programmable",
      images: [{
        url: "https://programmable.market/brand/projects/shard-token-v1.png",
        alt: "Shard artwork",
      }],
    });
  });

  it("uses the same exact-address projection for custom projects", () => {
    const response = readyProjection();
    const token = (response.body as Record<string, unknown>).token;
    const metadata = tokenDetailMetadataFromProjection(SHARD, {
      status: 200,
      body: {
        status: "ready",
        token: null,
        customProject: token,
      },
    });

    expect(metadata.title).toBe("Shard ($SHARD) | Programmable");
    expect(metadata.alternates?.canonical).toBe(
      `https://programmable.market/token/${SHARD}`,
    );
  });

  it("does not trust lookalike or caller-supplied metadata", () => {
    const response = readyProjection({
      tokenAddress: "0x1111111111111111111111111111111111111111",
    });
    (response.body as Record<string, unknown>).name = "Caller supplied name";
    (response.body as Record<string, unknown>).imageUrl =
      "https://attacker.invalid/image.png";

    expect(tokenDetailMetadataFromProjection(SHARD, response)).toEqual(
      genericTokenDetailMetadata(SHARD),
    );
  });

  it("fails soft for unavailable, malformed and conflicting projections", () => {
    const fallback = genericTokenDetailMetadata(SHARD);
    expect(tokenDetailMetadataFromProjection(SHARD, {
      status: 503,
      body: { error: "temporarily unavailable" },
    })).toEqual(fallback);
    expect(tokenDetailMetadataFromProjection("not-an-address", readyProjection()))
      .toEqual(genericTokenDetailMetadata("not-an-address", true));
    expect(tokenDetailMetadataFromProjection(SHARD, {
      status: 200,
      body: {
        status: "ready",
        token: (readyProjection().body as Record<string, unknown>).token,
        customProject: (readyProjection().body as Record<string, unknown>).token,
      },
    })).toEqual(fallback);
  });

  it("rejects unsafe identity text and falls back per-field for missing media", () => {
    expect(tokenDetailMetadataFromProjection(
      SHARD,
      readyProjection({ name: "Shard\u202e" }),
    )).toEqual(genericTokenDetailMetadata(SHARD));

    const metadata = tokenDetailMetadataFromProjection(
      SHARD,
      readyProjection({ description: undefined, imageUrl: "javascript:bad" }),
    );
    expect(metadata.description).toBe("Explore Shard ($SHARD) on Programmable.");
    expect(metadata.openGraph).toMatchObject({
      images: [{
        url: "https://programmable.market/og/programmable-landing-preview-v2-1200x630.jpg",
      }],
    });
  });

  it("keeps a valid token canonical during temporary projection failure", () => {
    const metadata = tokenDetailMetadataFromProjection(SHARD, {
      status: 503,
      body: { error: "temporarily unavailable" },
    });

    expect(metadata.alternates?.canonical).toBe(
      `https://programmable.market/token/${SHARD}`,
    );
    expect(metadata.openGraph).toMatchObject({
      url: `https://programmable.market/token/${SHARD}`,
    });
    expect(metadata.robots).toBeUndefined();
  });

  it("marks invalid and not-found token routes as noindex", () => {
    expect(tokenDetailMetadataFromProjection("not-an-address", readyProjection()))
      .toMatchObject({ robots: { index: false, follow: false } });
    expect(tokenDetailMetadataFromProjection(SHARD, {
      status: 404,
      body: { error: "not found" },
    })).toMatchObject({
      alternates: { canonical: `https://programmable.market/token/${SHARD}` },
      robots: { index: false, follow: false },
    });
  });

  it("does not publish private or local crawler image targets", () => {
    for (const imageUrl of [
      "https://localhost/token.png",
      "https://127.0.0.1/token.png",
      "https://[::1]/token.png",
      "https://metadata.local/token.png",
      "https://169.254.169.254/latest/meta-data",
      "/\\attacker.example/token.png",
    ]) {
      expect(tokenDetailMetadataFromProjection(
        SHARD,
        readyProjection({ imageUrl }),
      ).openGraph).toMatchObject({
        images: [{
          url: "https://programmable.market/og/programmable-landing-preview-v2-1200x630.jpg",
        }],
      });
    }
  });
});
