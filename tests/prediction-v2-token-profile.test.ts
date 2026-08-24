import { describe, expect, it } from "vitest";

import {
  normalizePredictionTokenProfileV2,
  PREDICTION_TOKEN_PROFILE_CHAINS_V2,
} from "../lib/prediction-v2/token-profile-v2";

const EVM_ADDRESS = `0x${"Ab".repeat(20)}`;
const CANONICAL_EVM_ADDRESS = EVM_ADDRESS.toLowerCase();
const SOLANA_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const OBSERVED_AT_MS = Date.parse("2026-08-23T18:00:00.000Z");

describe("prediction token profile v2", () => {
  it("normalizes a complete untrusted EVM profile without conflating market cap and FDV", () => {
    const profile = normalizePredictionTokenProfileV2({
      chain: 56,
      address: `  ${EVM_ADDRESS}  `,
      name: "  Great   Meme  ",
      symbol: "MEME",
      logoUrl: "data:image/png;base64,not-used",
      imageUrl: "https://cdn.example.com/token.png#provider-fragment",
      website: "https://meme.example.com/path",
      websites: [
        { label: "<b>not preserved</b>", url: "https://twitter.com/great_meme?s=20" },
        { url: "https://meme.example.com/path" },
      ],
      socials: [
        { type: "twitter", url: "https://www.x.com/great_meme#profile" },
        { type: "telegram", url: "https://telegram.me/great_meme?ref=provider" },
      ],
      priceUsd: "0.00042",
      marketCapUsd: "420000",
      fdvUsd: "500000",
      liquidityUsd: 120000,
      pairCreatedAtMs: Date.parse("2026-08-21T18:00:00.000Z"),
      explorerUrl: "https://evil.example/token/not-used",
      description: "<script>provider HTML is not part of the DTO</script>",
    }, OBSERVED_AT_MS);

    expect(profile).toEqual({
      schemaVersion: 2,
      chain: { id: "bnb", reference: "56", label: "BNB Chain" },
      address: CANONICAL_EVM_ADDRESS,
      explorerUrl: `https://bscscan.com/token/${CANONICAL_EVM_ADDRESS}`,
      name: "Great Meme",
      symbol: "MEME",
      logoUrl: "https://cdn.example.com/token.png",
      links: [
        { kind: "website", url: "https://meme.example.com/path" },
        { kind: "x", url: "https://x.com/great_meme" },
        { kind: "telegram", url: "https://t.me/great_meme" },
      ],
      priceUsd: 0.00042,
      marketCapUsd: 420000,
      fdvUsd: 500000,
      liquidityUsd: 120000,
      age: {
        pairCreatedAt: "2026-08-21T18:00:00.000Z",
        seconds: 172800,
      },
    });
    expect(profile).not.toHaveProperty("description");
    expect(profile).not.toHaveProperty("explorerUrl", "https://evil.example/token/not-used");
  });

  it("builds explorer URLs from the validated identity for every supported chain", () => {
    const expected = {
      ethereum: "https://etherscan.io",
      base: "https://basescan.org",
      bnb: "https://bscscan.com",
      robinhood: "https://robinhoodchain.blockscout.com",
    } as const;

    for (const [chain, origin] of Object.entries(expected)) {
      expect(normalizePredictionTokenProfileV2({
        chain,
        address: EVM_ADDRESS,
      }, OBSERVED_AT_MS)?.explorerUrl).toBe(
        `${origin}/token/${CANONICAL_EVM_ADDRESS}`,
      );
    }

    expect(normalizePredictionTokenProfileV2({
      chain: "solana",
      address: SOLANA_MINT,
    }, OBSERVED_AT_MS)).toMatchObject({
      chain: { id: "solana", reference: "mainnet-beta", label: "Solana" },
      address: SOLANA_MINT,
      explorerUrl: `https://solscan.io/token/${SOLANA_MINT}`,
    });
    expect(PREDICTION_TOKEN_PROFILE_CHAINS_V2).toHaveLength(5);
  });

  it("rejects invalid or mismatched token identities", () => {
    const invalid = [
      { chain: "polygon", address: EVM_ADDRESS },
      { chain: "base", address: "0x1234" },
      { chain: "base", address: `0x${"0".repeat(40)}` },
      { chain: "solana", address: EVM_ADDRESS },
      { chain: "solana", address: "11111111111111111111111111111111" },
      { chain: "ethereum", address: SOLANA_MINT },
    ];
    for (const candidate of invalid) {
      expect(normalizePredictionTokenProfileV2(candidate, OBSERVED_AT_MS)).toBeNull();
    }
  });

  it("keeps missing or invalid optional provider fields out of the DTO", () => {
    const profile = normalizePredictionTokenProfileV2({
      chain: "base",
      address: EVM_ADDRESS,
      name: "<img src=x onerror=alert(1)>",
      symbol: "BAD SYMBOL",
      logoUrl: "data:image/svg+xml,<svg onload=alert(1)>",
      websites: [{ label: "safe-looking", url: "javascript:alert(1)" }],
      socials: [{ type: "twitter", url: "https://not-x.example/project" }],
      priceUsd: 0,
      marketCapUsd: -1,
      fdvUsd: "Infinity",
      liquidityUsd: "not-a-number",
      pairCreatedAtMs: 9_007_199_254_740_991,
    }, OBSERVED_AT_MS);

    expect(profile).toEqual({
      schemaVersion: 2,
      chain: { id: "base", reference: "8453", label: "Base" },
      address: CANONICAL_EVM_ADDRESS,
      explorerUrl: `https://basescan.org/token/${CANONICAL_EVM_ADDRESS}`,
    });
  });

  it.each([
    "http://project.example",
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "https://user:pass@project.example",
    "https://127.0.0.1/logo.png",
    "https://10.0.0.1/logo.png",
    "https://[::1]/logo.png",
    "https://localhost/logo.png",
    "https://metadata.google.internal/logo.png",
    "https://project.local/logo.png",
    "https://project.example:8443/logo.png",
  ])("rejects an unsafe HTTPS-adjacent URL: %s", (url) => {
    const profile = normalizePredictionTokenProfileV2({
      chain: "ethereum",
      address: EVM_ADDRESS,
      logoUrl: url,
      website: url,
    }, OBSERVED_AT_MS);
    expect(profile).not.toHaveProperty("logoUrl");
    expect(profile).not.toHaveProperty("links");
  });

  it("identifies social platforms by exact hostname and deduplicates aliases", () => {
    const profile = normalizePredictionTokenProfileV2({
      chain: "base",
      address: EVM_ADDRESS,
      websites: [
        "https://x.com.evil.example.com/project",
        "https://project.example.com",
        "https://project.example.com/",
        "https://twitter.com/project?s=20",
      ],
      x: "https://www.x.com/project#duplicate",
      telegram: "https://www.telegram.me/project?duplicate=1",
      socials: [
        { type: "telegram", url: "https://t.me/project" },
        { type: "x", url: "https://evilx.com/project" },
      ],
    }, OBSERVED_AT_MS);

    expect(profile?.links).toEqual([
      { kind: "website", url: "https://x.com.evil.example.com/project" },
      { kind: "x", url: "https://x.com/project" },
      { kind: "telegram", url: "https://t.me/project" },
    ]);
  });

  it("never substitutes FDV for an unavailable market cap", () => {
    const profile = normalizePredictionTokenProfileV2({
      chain: "robinhood",
      address: EVM_ADDRESS,
      fdvUsd: "1000000",
    }, OBSERVED_AT_MS);
    expect(profile).toHaveProperty("fdvUsd", 1000000);
    expect(profile).not.toHaveProperty("marketCapUsd");
  });

  it("is deterministic, bounded and deeply immutable for returned collections", () => {
    const candidate = {
      chain: "bsc",
      address: EVM_ADDRESS,
      name: "A".repeat(81),
      symbol: "OK",
      websites: Array.from({ length: 40 }, (_, index) =>
        `https://site-${index}.example.com`),
      pairCreatedAt: "2026-08-23T17:59:59.001Z",
    };
    const first = normalizePredictionTokenProfileV2(candidate, OBSERVED_AT_MS);
    const second = normalizePredictionTokenProfileV2(candidate, OBSERVED_AT_MS);
    expect(first).toEqual(second);
    expect(first).not.toHaveProperty("name");
    expect(first?.links).toHaveLength(1);
    expect(first?.age?.seconds).toBe(0);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first?.chain)).toBe(true);
    expect(Object.isFrozen(first?.links)).toBe(true);
  });

  it("requires an explicit deterministic observation timestamp", () => {
    expect(() => normalizePredictionTokenProfileV2({
      chain: "base",
      address: EVM_ADDRESS,
    }, Number.NaN)).toThrow(TypeError);
  });
});
