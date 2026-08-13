import "server-only";

import sharp from "sharp";

import {
  MAX_TOKEN_IMAGE_UPLOAD_BYTES,
  TOKEN_IMAGE_OUTPUT_SIZE,
} from "@/lib/token-image";

const WEBP_HEADER_BYTES = 12;
const WEBP_EXTENDED_HEADER_BYTES = 10;
const WEBP_LOSSY_HEADER_BYTES = 10;
const WEBP_LOSSLESS_HEADER_BYTES = 5;

export type VerifiedTokenImageWebpV1 = Readonly<{
  bytes: Uint8Array;
  width: typeof TOKEN_IMAGE_OUTPUT_SIZE;
  height: typeof TOKEN_IMAGE_OUTPUT_SIZE;
}>;

export class TokenImageWebpVerificationErrorV1 extends TypeError {
  constructor(message = "token image WebP is invalid") {
    super(message);
    this.name = "TokenImageWebpVerificationErrorV1";
  }
}

export async function verifyTokenImageWebpV1(
  source: Blob | Uint8Array,
): Promise<VerifiedTokenImageWebpV1> {
  const bytes = source instanceof Uint8Array
    ? Uint8Array.from(source)
    : new Uint8Array(await source.arrayBuffer());
  if (bytes.byteLength < WEBP_HEADER_BYTES || bytes.byteLength > MAX_TOKEN_IMAGE_UPLOAD_BYTES) {
    throw new TokenImageWebpVerificationErrorV1();
  }

  const structure = inspectWebpStructure(bytes);
  if (
    structure.width !== TOKEN_IMAGE_OUTPUT_SIZE
    || structure.height !== TOKEN_IMAGE_OUTPUT_SIZE
  ) throw new TokenImageWebpVerificationErrorV1("token image must be exactly 1000 by 1000 pixels");

  try {
    const decoded = await sharp(bytes, {
      animated: false,
      failOn: "error",
      limitInputPixels: TOKEN_IMAGE_OUTPUT_SIZE * TOKEN_IMAGE_OUTPUT_SIZE,
      sequentialRead: true,
    }).raw().toBuffer({ resolveWithObject: true });
    if (
      decoded.info.width !== TOKEN_IMAGE_OUTPUT_SIZE
      || decoded.info.height !== TOKEN_IMAGE_OUTPUT_SIZE
      || decoded.info.width !== structure.width
      || decoded.info.height !== structure.height
      || (decoded.info.pages ?? 1) > 1
      || decoded.data.byteLength
        !== decoded.info.width * decoded.info.height * decoded.info.channels
    ) throw new TokenImageWebpVerificationErrorV1();
  } catch (cause) {
    if (cause instanceof TokenImageWebpVerificationErrorV1) throw cause;
    throw new TokenImageWebpVerificationErrorV1();
  }

  return Object.freeze({
    bytes,
    width: TOKEN_IMAGE_OUTPUT_SIZE,
    height: TOKEN_IMAGE_OUTPUT_SIZE,
  });
}

export function inspectWebpStructure(bytes: Uint8Array): Readonly<{
  width: number;
  height: number;
}> {
  if (
    bytes.byteLength < WEBP_HEADER_BYTES
    || ascii(bytes, 0, 4) !== "RIFF"
    || ascii(bytes, 8, 12) !== "WEBP"
    || uint32(bytes, 4) !== bytes.byteLength - 8
  ) throw new TokenImageWebpVerificationErrorV1();

  let cursor = WEBP_HEADER_BYTES;
  let extended: Readonly<{ width: number; height: number }> | null = null;
  let image: Readonly<{ width: number; height: number }> | null = null;
  let extendedFlags = 0;
  const chunks = new Set<string>();

  while (cursor < bytes.byteLength) {
    if (cursor + 8 > bytes.byteLength) throw new TokenImageWebpVerificationErrorV1();
    const kind = ascii(bytes, cursor, cursor + 4);
    const length = uint32(bytes, cursor + 4);
    const start = cursor + 8;
    const end = start + length;
    const paddedEnd = end + (length & 1);
    if (!/^[A-Z0-9 ]{4}$/u.test(kind) || end < start || paddedEnd > bytes.byteLength) {
      throw new TokenImageWebpVerificationErrorV1();
    }
    if ((length & 1) === 1 && bytes[end] !== 0) {
      throw new TokenImageWebpVerificationErrorV1();
    }
    if (chunks.has(kind) && kind !== "ANMF") {
      throw new TokenImageWebpVerificationErrorV1();
    }
    chunks.add(kind);

    if (kind === "VP8X") {
      if (cursor !== WEBP_HEADER_BYTES || extended !== null || length !== WEBP_EXTENDED_HEADER_BYTES) {
        throw new TokenImageWebpVerificationErrorV1();
      }
      extendedFlags = bytes[start]!;
      if (
        (extendedFlags & 0xc3) !== 0
        || bytes[start + 1] !== 0
        || bytes[start + 2] !== 0
        || bytes[start + 3] !== 0
      ) throw new TokenImageWebpVerificationErrorV1();
      extended = Object.freeze({
        width: 1 + uint24(bytes, start + 4),
        height: 1 + uint24(bytes, start + 7),
      });
    } else if (kind === "VP8 ") {
      if (image !== null || length < WEBP_LOSSY_HEADER_BYTES) {
        throw new TokenImageWebpVerificationErrorV1();
      }
      const frameTag = bytes[start]! | (bytes[start + 1]! << 8) | (bytes[start + 2]! << 16);
      if (
        (frameTag & 1) !== 0
        || bytes[start + 3] !== 0x9d
        || bytes[start + 4] !== 0x01
        || bytes[start + 5] !== 0x2a
      ) throw new TokenImageWebpVerificationErrorV1();
      image = Object.freeze({
        width: uint16(bytes, start + 6) & 0x3fff,
        height: uint16(bytes, start + 8) & 0x3fff,
      });
    } else if (kind === "VP8L") {
      if (image !== null || length < WEBP_LOSSLESS_HEADER_BYTES || bytes[start] !== 0x2f) {
        throw new TokenImageWebpVerificationErrorV1();
      }
      const bits = uint32(bytes, start + 1);
      if ((bits >>> 29) !== 0) throw new TokenImageWebpVerificationErrorV1();
      image = Object.freeze({
        width: 1 + (bits & 0x3fff),
        height: 1 + ((bits >>> 14) & 0x3fff),
      });
    } else if (!new Set(["ALPH", "ICCP", "EXIF", "XMP "]).has(kind)) {
      // The browser preparation path emits a still image. Animation and unknown
      // chunks are rejected so a relabelled or polyglot payload cannot pass.
      throw new TokenImageWebpVerificationErrorV1();
    }
    cursor = paddedEnd;
  }

  if (cursor !== bytes.byteLength || image === null || image.width < 1 || image.height < 1) {
    throw new TokenImageWebpVerificationErrorV1();
  }
  if (
    extended !== null
    && (extended.width !== image.width || extended.height !== image.height)
  ) throw new TokenImageWebpVerificationErrorV1();
  if (extended === null && chunks.size !== 1) {
    throw new TokenImageWebpVerificationErrorV1();
  }
  if (
    ((extendedFlags & 0x20) !== 0) !== chunks.has("ICCP")
    || ((extendedFlags & 0x08) !== 0) !== chunks.has("EXIF")
    || ((extendedFlags & 0x04) !== 0) !== chunks.has("XMP ")
    || (chunks.has("ALPH") && (extendedFlags & 0x10) === 0)
  ) throw new TokenImageWebpVerificationErrorV1();
  return extended ?? image;
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end));
}

function uint16(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function uint24(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16);
}

function uint32(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]!
    + bytes[offset + 1]! * 0x100
    + bytes[offset + 2]! * 0x1_0000
    + bytes[offset + 3]! * 0x100_0000
  );
}
