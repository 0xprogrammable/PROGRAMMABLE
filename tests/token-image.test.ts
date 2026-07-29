import { describe, expect, it } from "vitest";

import {
  canOptimizeTokenImage,
  getProgrammableTokenImageAssetName,
  getTokenCardImageSource,
  getTokenImageFileError,
  hasValidTokenImageSignature,
  isProgrammableTokenImageUrl,
  MAX_TOKEN_IMAGE_UPLOAD_BYTES,
  PROGRAMMABLE_TOKEN_IMAGE_HOST,
} from "../lib/token-image";

describe("token image policy", () => {
  it("keeps prepared uploads within the card-performance budget", () => {
    expect(MAX_TOKEN_IMAGE_UPLOAD_BYTES).toBe(1_000_000);
  });

  it("accepts supported files within the source limit", () => {
    expect(
      getTokenImageFileError({
        size: 250_000,
        type: "image/png",
      }),
    ).toBe("");
  });

  it("rejects unsupported and oversized source files", () => {
    expect(
      getTokenImageFileError({
        size: 250_000,
        type: "image/svg+xml",
      }),
    ).toContain("JPG");
    expect(
      getTokenImageFileError({
        size: 8_000_001,
        type: "image/webp",
      }),
    ).toContain("smaller than 8 MB");
  });

  it("checks the uploaded image signature", async () => {
    const webp = new Blob([
      new Uint8Array([
        0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
      ]),
    ]);
    const fake = new Blob([new TextEncoder().encode("not an image")]);

    await expect(hasValidTokenImageSignature(webp)).resolves.toBe(true);
    await expect(hasValidTokenImageSignature(fake)).resolves.toBe(false);
  });

  it("optimizes only local token images", () => {
    expect(canOptimizeTokenImage("/brand/token.webp")).toBe(true);
    expect(
      canOptimizeTokenImage(
        "https://k2uoipt9wchjtz3h.public.blob.vercel-storage.com/token-images/example.webp",
      ),
    ).toBe(false);
    expect(
      canOptimizeTokenImage("https://programmable.family/token.webp"),
    ).toBe(false);
    expect(canOptimizeTokenImage("//example.com/token.webp")).toBe(false);
  });

  it("routes only the Programmable image store through local optimization", () => {
    const image =
      `https://${PROGRAMMABLE_TOKEN_IMAGE_HOST}/token-images/example.webp`;
    expect(isProgrammableTokenImageUrl(image)).toBe(true);
    expect(getProgrammableTokenImageAssetName(image)).toBe("example.webp");
    expect(getTokenCardImageSource(image)).toBe(
      "/api/token-image-proxy/example.webp",
    );
    expect(
      isProgrammableTokenImageUrl(
        "https://example.com/token-images/example.webp",
      ),
    ).toBe(false);
    expect(
      isProgrammableTokenImageUrl(
        `https://${PROGRAMMABLE_TOKEN_IMAGE_HOST}.example.com/token-images/example.webp`,
      ),
    ).toBe(false);
    expect(
      getTokenCardImageSource("https://example.com/token.webp"),
    ).toBe("https://example.com/token.webp");
    expect(
      getProgrammableTokenImageAssetName(
        `https://${PROGRAMMABLE_TOKEN_IMAGE_HOST}/token-images/nested/example.webp`,
      ),
    ).toBe("");
  });
});
