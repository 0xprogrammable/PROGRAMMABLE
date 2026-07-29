import { describe, expect, it } from "vitest";

import {
  canOptimizeTokenImage,
  getTokenImageFileError,
  hasValidTokenImageSignature,
} from "../lib/token-image";

describe("token image policy", () => {
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
  });
});
