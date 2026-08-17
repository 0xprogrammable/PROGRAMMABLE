import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";

vi.mock("server-only", () => ({}));

import {
  applyTokenImageFallback,
  canOptimizeTokenImage,
  getProgrammableTokenImageAssetName,
  getTokenCardImageSource,
  getTokenImageFileError,
  isProgrammableTokenImageUrl,
  MAX_TOKEN_IMAGE_UPLOAD_BYTES,
  PROGRAMMABLE_TOKEN_IMAGE_HOST,
} from "../lib/token-image";
import {
  inspectWebpStructure,
  verifyTokenImageWebpV1,
} from "../lib/server/token-image-webp-v1";

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

  it("fully decodes only a structurally valid 1000 by 1000 WebP", async () => {
    const webp = await sharp({
      create: {
        width: 1_000,
        height: 1_000,
        channels: 4,
        background: { r: 21, g: 32, b: 43, alpha: 1 },
      },
    }).webp().toBuffer();
    await expect(verifyTokenImageWebpV1(webp)).resolves.toMatchObject({
      width: 1_000,
      height: 1_000,
    });
    expect(inspectWebpStructure(webp)).toEqual({ width: 1_000, height: 1_000 });
  });

  it("rejects JPEG and PNG bytes relabelled as WebP", async () => {
    const jpeg = await sharp({
      create: {
        width: 1_000,
        height: 1_000,
        channels: 3,
        background: { r: 21, g: 32, b: 43 },
      },
    }).jpeg().toBuffer();
    const png = await sharp({
      create: {
        width: 1_000,
        height: 1_000,
        channels: 3,
        background: { r: 21, g: 32, b: 43 },
      },
    }).png().toBuffer();
    await expect(verifyTokenImageWebpV1(jpeg)).rejects.toThrow("WebP");
    await expect(verifyTokenImageWebpV1(png)).rejects.toThrow("WebP");
  });

  it("rejects wrong dimensions, broken RIFF lengths and corrupt image bytes", async () => {
    const wrongDimensions = await sharp({
      create: {
        width: 999,
        height: 1_000,
        channels: 3,
        background: { r: 21, g: 32, b: 43 },
      },
    }).webp().toBuffer();
    const valid = await sharp({
      create: {
        width: 1_000,
        height: 1_000,
        channels: 3,
        background: { r: 21, g: 32, b: 43 },
      },
    }).webp().toBuffer();
    const brokenLength = Uint8Array.from(valid);
    brokenLength[4] = (brokenLength[4]! + 1) & 0xff;
    const corrupt = valid.subarray(0, valid.byteLength - 3);
    await expect(verifyTokenImageWebpV1(wrongDimensions)).rejects.toThrow("1000");
    await expect(verifyTokenImageWebpV1(brokenLength)).rejects.toThrow("WebP");
    await expect(verifyTokenImageWebpV1(corrupt)).rejects.toThrow("WebP");
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
    expect(isProgrammableTokenImageUrl(`${image}?version=2`)).toBe(false);
    expect(isProgrammableTokenImageUrl(`${image}#replacement`)).toBe(false);
    expect(
      getTokenCardImageSource("https://example.com/token.webp"),
    ).toBe("https://example.com/token.webp");
    expect(
      getProgrammableTokenImageAssetName(
        `https://${PROGRAMMABLE_TOKEN_IMAGE_HOST}/token-images/nested/example.webp`,
      ),
    ).toBe("");
  });

  it("replaces a failed external image with one inert local fallback", () => {
    const removed: string[] = [];
    const image = {
      alt: "Broken token artwork",
      dataset: {} as DOMStringMap,
      src: "https://example.com/broken.webp",
      removeAttribute(name: string) {
        removed.push(name);
      },
    } as unknown as HTMLImageElement;

    expect(applyTokenImageFallback(
      image,
      "/brand/programmable-token-fallback-01-dawn.webp",
    )).toBe(true);
    expect(image).toMatchObject({
      alt: "",
      src: "/brand/programmable-token-fallback-01-dawn.webp",
      dataset: { tokenImageFallback: "true" },
    });
    expect(removed).toEqual(["srcset"]);
    expect(applyTokenImageFallback(
      image,
      "/brand/programmable-token-fallback-02-moon.webp",
    )).toBe(false);
    expect(image.src).toBe(
      "/brand/programmable-token-fallback-01-dawn.webp",
    );
  });
});
