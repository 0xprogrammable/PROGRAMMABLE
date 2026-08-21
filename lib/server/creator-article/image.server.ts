import "server-only";

import { createHash } from "node:crypto";

import sharp from "sharp";

export const MAX_CREATOR_ARTICLE_IMAGE_INPUT_BYTES = 12 * 1024 * 1024;
export const MAX_CREATOR_ARTICLE_IMAGE_OUTPUT_BYTES = 5 * 1024 * 1024;
const MAX_INPUT_PIXELS = 40_000_000;

export type CreatorArticleMediaKindV1 = "banner" | "inline";

export type VerifiedCreatorArticleImageV1 = Readonly<{
  bytes: Uint8Array;
  contentSha256: `sha256:${string}`;
  contentType: "image/webp";
  width: number;
  height: number;
  kind: CreatorArticleMediaKindV1;
}>;

export async function verifyAndTransformCreatorArticleImageV1(input: Readonly<{
  bytes: Uint8Array;
  kind: CreatorArticleMediaKindV1;
}>): Promise<VerifiedCreatorArticleImageV1> {
  if (
    input.bytes.byteLength === 0
    || input.bytes.byteLength > MAX_CREATOR_ARTICLE_IMAGE_INPUT_BYTES
  ) throw new TypeError("Creator article image size is invalid");
  const pipeline = sharp(input.bytes, {
    animated: true,
    limitInputPixels: MAX_INPUT_PIXELS,
    failOn: "warning",
  });
  const metadata = await pipeline.metadata();
  if (
    !metadata.width || !metadata.height
    || (metadata.pages ?? 1) !== 1
    || !["jpeg", "png", "webp", "avif"].includes(metadata.format ?? "")
  ) throw new TypeError("Creator article image format is invalid");
  const orientedWidth = metadata.autoOrient?.width ?? metadata.width;
  const orientedHeight = metadata.autoOrient?.height ?? metadata.height;
  const bannerWidth = Math.max(
    3,
    Math.min(3000, orientedWidth, Math.floor(orientedHeight * 3)),
  );
  const bannerHeight = Math.floor(bannerWidth / 3);
  const transformed = input.kind === "banner"
    ? pipeline.rotate().resize(bannerWidth, bannerHeight, {
        fit: "cover",
        position: "attention",
        withoutEnlargement: true,
      })
    : pipeline.rotate().resize(2400, 2400, {
        fit: "inside",
        withoutEnlargement: true,
      });
  const { data, info } = await transformed
    .webp({ quality: 84, effort: 4, smartSubsample: true })
    .toBuffer({ resolveWithObject: true });
  if (
    data.byteLength === 0
    || data.byteLength > MAX_CREATOR_ARTICLE_IMAGE_OUTPUT_BYTES
    || info.format !== "webp"
    || info.width <= 0 || info.height <= 0
    || (input.kind === "banner" && info.width / info.height !== 3)
  ) throw new TypeError("Creator article image output is invalid");
  return Object.freeze({
    bytes: Uint8Array.from(data),
    contentSha256: digest(data),
    contentType: "image/webp",
    width: info.width,
    height: info.height,
    kind: input.kind,
  });
}

export async function inspectCreatorArticleImageOutputV1(
  bytes: Uint8Array,
  expected: Omit<VerifiedCreatorArticleImageV1, "bytes">,
) {
  if (
    bytes.byteLength === 0
    || bytes.byteLength > MAX_CREATOR_ARTICLE_IMAGE_OUTPUT_BYTES
    || digest(bytes) !== expected.contentSha256
  ) throw new TypeError("Creator article image readback is invalid");
  const metadata = await sharp(bytes, {
    animated: true,
    limitInputPixels: MAX_INPUT_PIXELS,
    failOn: "warning",
  }).metadata();
  if (
    metadata.format !== "webp"
    || metadata.width !== expected.width
    || metadata.height !== expected.height
    || (metadata.pages ?? 1) !== 1
  ) throw new TypeError("Creator article image readback is invalid");
}

function digest(value: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
