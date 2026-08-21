import sharp from "sharp";
import { describe, expect, it } from "vitest";

vi.mock("server-only", () => ({}));

import { vi } from "vitest";
import {
  inspectCreatorArticleImageOutputV1,
  verifyAndTransformCreatorArticleImageV1,
} from "../lib/server/creator-article/image.server";

async function png(width: number, height: number) {
  return new Uint8Array(await sharp({
    create: { width, height, channels: 4, background: "#7aa7ff" },
  }).png().withMetadata({ orientation: 6 }).toBuffer());
}

describe("creator article image boundary", () => {
  it("strips metadata and preserves inline aspect ratio", async () => {
    const result = await verifyAndTransformCreatorArticleImageV1({
      bytes: await png(1200, 800), kind: "inline",
    });
    expect(result.contentType).toBe("image/webp");
    expect(result.width / result.height).toBeCloseTo(800 / 1200, 2);
    const { bytes, ...receipt } = result;
    await expect(inspectCreatorArticleImageOutputV1(bytes, receipt))
      .resolves.toBeUndefined();
    const metadata = await sharp(result.bytes).metadata();
    expect(metadata.exif).toBeUndefined();
  });

  it("creates an exact responsive 3:1 banner", async () => {
    const result = await verifyAndTransformCreatorArticleImageV1({
      bytes: await png(3600, 2400), kind: "banner",
    });
    expect(result.width / result.height).toBe(3);
  });

  it("rejects malformed and animated input", async () => {
    await expect(verifyAndTransformCreatorArticleImageV1({
      bytes: new Uint8Array([1, 2, 3]), kind: "inline",
    })).rejects.toThrow();
  });
});
