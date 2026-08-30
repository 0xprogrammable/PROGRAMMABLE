import { inflateSync } from "node:zlib";

import {
  MAX_PROJECT_METADATA_IMAGE_BYTES_V4,
} from "./constants.mjs";

const MAXIMUM_DIMENSION = 8_192;
const MAXIMUM_PIXELS = 4_194_304;
const PNG_SIGNATURE = Buffer.from("89504e470d0a1a0a", "hex");
const PNG_SAFE_ANCILLARY = new Set(["cHRM", "gAMA", "sBIT", "sRGB", "pHYs", "tRNS"]);

export function decodeExactProjectImageV4(bytesInput) {
  const bytes = Buffer.from(bytesInput);
  if (bytes.byteLength < 10 || bytes.byteLength > MAX_PROJECT_METADATA_IMAGE_BYTES_V4) {
    throw new TypeError("V4 project image byte length is invalid");
  }
  if (bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return decodePng(bytes);
  const header = bytes.subarray(0, 6).toString("ascii");
  if (header === "GIF87a" || header === "GIF89a") return decodeGif(bytes);
  throw new TypeError("V4 project image must be an exact PNG or single-frame GIF");
}

function decodePng(bytes) {
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  let sawHeader = false;
  let sawPalette = false;
  let sawData = false;
  let dataEnded = false;
  let sawEnd = false;
  const compressed = [];
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) throw new TypeError("PNG chunk is truncated");
    const length = bytes.readUInt32BE(offset);
    const typeBytes = bytes.subarray(offset + 4, offset + 8);
    const type = typeBytes.toString("ascii");
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const chunkEnd = dataEnd + 4;
    if (!/^[A-Za-z]{4}$/u.test(type) || dataEnd < dataStart || chunkEnd > bytes.length) {
      throw new TypeError("PNG chunk bounds are invalid");
    }
    if (crc32(bytes.subarray(offset + 4, dataEnd)) !== bytes.readUInt32BE(dataEnd)) {
      throw new TypeError("PNG chunk CRC is invalid");
    }
    const data = bytes.subarray(dataStart, dataEnd);
    if (!sawHeader && type !== "IHDR") throw new TypeError("PNG IHDR must be first");
    if (type === "IHDR") {
      if (sawHeader || length !== 13) throw new TypeError("PNG IHDR is invalid");
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      if (!validPngDepth(colorType, bitDepth)
        || data[10] !== 0 || data[11] !== 0 || data[12] !== 0) {
        throw new TypeError("PNG encoding is unsupported or unsafe");
      }
      assertPixelBounds(width, height);
      sawHeader = true;
    } else if (type === "PLTE") {
      if (sawData || sawPalette || length === 0 || length > 768 || length % 3 !== 0) {
        throw new TypeError("PNG palette is invalid");
      }
      sawPalette = true;
    } else if (type === "IDAT") {
      if (dataEnded || length === 0) throw new TypeError("PNG IDAT stream is invalid");
      sawData = true;
      compressed.push(data);
    } else if (type === "IEND") {
      if (!sawData || sawEnd || length !== 0 || chunkEnd !== bytes.length) {
        throw new TypeError("PNG IEND or trailing bytes are invalid");
      }
      sawEnd = true;
    } else {
      if (sawData) dataEnded = true;
      const critical = (typeBytes[0] & 0x20) === 0;
      if (critical || !PNG_SAFE_ANCILLARY.has(type)
        || type === "acTL" || type === "fcTL" || type === "fdAT") {
        throw new TypeError("PNG contains an unadmitted or animated chunk");
      }
    }
    offset = chunkEnd;
    if (sawEnd) break;
  }
  if (!sawHeader || !sawData || !sawEnd || (colorType === 3 && !sawPalette)) {
    throw new TypeError("PNG container is incomplete");
  }
  const channels = colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 3 ? 1
    : colorType === 4 ? 2 : 4;
  const rowBytes = Math.ceil(width * channels * bitDepth / 8);
  const expectedInflated = checkedSize(height, rowBytes + 1, "PNG decompression");
  if (expectedInflated > MAXIMUM_PIXELS * 9) {
    throw new TypeError("PNG decompressed byte budget is exceeded");
  }
  const compressedBytes = Buffer.concat(compressed);
  let inflateResult;
  try {
    inflateResult = inflateSync(compressedBytes, {
      info: true,
      maxOutputLength: expectedInflated + 1,
    });
  } catch {
    throw new TypeError("PNG compressed scanlines are malformed");
  }
  if (inflateResult.engine.bytesWritten !== compressedBytes.byteLength) {
    throw new TypeError("PNG compressed stream contains trailing bytes");
  }
  const inflated = inflateResult.buffer;
  if (inflated.byteLength !== expectedInflated) {
    throw new TypeError("PNG decompressed scanline length is invalid");
  }
  for (let row = 0; row < height; row += 1) {
    if (inflated[row * (rowBytes + 1)] > 4) {
      throw new TypeError("PNG scanline filter is invalid");
    }
  }
  return Object.freeze({ mediaType: "image/png", width, height, frameCount: 1 });
}

function validPngDepth(colorType, depth) {
  if (colorType === 0) return [1, 2, 4, 8, 16].includes(depth);
  if (colorType === 2 || colorType === 4 || colorType === 6) return depth === 8 || depth === 16;
  return colorType === 3 && [1, 2, 4, 8].includes(depth);
}

function decodeGif(bytes) {
  if (bytes.length < 14) throw new TypeError("GIF header is truncated");
  const width = bytes.readUInt16LE(6);
  const height = bytes.readUInt16LE(8);
  assertPixelBounds(width, height);
  const packed = bytes[10];
  let offset = 13;
  if ((packed & 0x80) !== 0) {
    offset = checkedOffset(
      offset,
      3 * (1 << ((packed & 7) + 1)),
      bytes.length,
      "GIF global color table",
    );
  }
  let frames = 0;
  let graphicControlPending = false;
  while (offset < bytes.length) {
    const introducer = bytes[offset++];
    if (introducer === 0x3b) {
      if (offset !== bytes.length || frames !== 1 || graphicControlPending) {
        throw new TypeError("GIF trailer, frame count or extension state is invalid");
      }
      return Object.freeze({ mediaType: "image/gif", width, height, frameCount: 1 });
    }
    if (introducer === 0x21) {
      if (offset >= bytes.length) throw new TypeError("GIF extension is truncated");
      const label = bytes[offset++];
      if (label !== 0xf9 || graphicControlPending || offset + 6 > bytes.length
        || bytes[offset] !== 4 || bytes[offset + 5] !== 0) {
        throw new TypeError("GIF contains an unadmitted or malformed extension");
      }
      if ((bytes[offset + 1] & 0xe0) !== 0) {
        throw new TypeError("GIF control flags are invalid");
      }
      graphicControlPending = true;
      offset += 6;
      continue;
    }
    if (introducer !== 0x2c || offset + 9 > bytes.length) {
      throw new TypeError("GIF block stream is invalid");
    }
    const left = bytes.readUInt16LE(offset);
    const top = bytes.readUInt16LE(offset + 2);
    const frameWidth = bytes.readUInt16LE(offset + 4);
    const frameHeight = bytes.readUInt16LE(offset + 6);
    const framePacked = bytes[offset + 8];
    offset += 9;
    if (frameWidth < 1 || frameHeight < 1
      || left + frameWidth > width || top + frameHeight > height) {
      throw new TypeError("GIF frame dimensions exceed the canvas");
    }
    if ((framePacked & 0x80) !== 0) {
      offset = checkedOffset(
        offset,
        3 * (1 << ((framePacked & 7) + 1)),
        bytes.length,
        "GIF local color table",
      );
    }
    if (offset >= bytes.length) throw new TypeError("GIF LZW code size is absent");
    const minimumCodeSize = bytes[offset++];
    const blocks = readGifSubBlocks(bytes, offset);
    offset = blocks.nextOffset;
    decodeGifLzw(
      blocks.data,
      minimumCodeSize,
      checkedSize(frameWidth, frameHeight, "GIF frame pixels"),
    );
    frames += 1;
    if (frames > 1) throw new TypeError("animated GIF images are not admitted");
    graphicControlPending = false;
  }
  throw new TypeError("GIF is missing its exact trailer");
}

function readGifSubBlocks(bytes, start) {
  const parts = [];
  let total = 0;
  let offset = start;
  while (offset < bytes.length) {
    const length = bytes[offset++];
    if (length === 0) return { data: Buffer.concat(parts, total), nextOffset: offset };
    if (offset + length > bytes.length) throw new TypeError("GIF data is truncated");
    total += length;
    if (total > MAX_PROJECT_METADATA_IMAGE_BYTES_V4) {
      throw new TypeError("GIF compressed data exceeds budget");
    }
    parts.push(bytes.subarray(offset, offset + length));
    offset += length;
  }
  throw new TypeError("GIF data blocks are unterminated");
}

function decodeGifLzw(data, minimumCodeSize, expectedPixels) {
  if (minimumCodeSize < 2 || minimumCodeSize > 8) {
    throw new TypeError("GIF LZW code size is invalid");
  }
  const clear = 1 << minimumCodeSize;
  const end = clear + 1;
  let codeSize = minimumCodeSize + 1;
  let nextCode = end + 1;
  let bitOffset = 0;
  let previous = null;
  let output = 0;
  let sawClear = false;
  const dictionary = [];
  const reset = () => {
    dictionary.length = clear + 2;
    for (let index = 0; index < clear; index += 1) dictionary[index] = [index];
    codeSize = minimumCodeSize + 1;
    nextCode = end + 1;
    previous = null;
  };
  reset();
  const readCode = () => {
    if (bitOffset + codeSize > data.length * 8) return null;
    let value = 0;
    for (let bit = 0; bit < codeSize; bit += 1) {
      value |= ((data[(bitOffset + bit) >> 3] >> ((bitOffset + bit) & 7)) & 1) << bit;
    }
    bitOffset += codeSize;
    return value;
  };
  while (true) {
    const code = readCode();
    if (code === null) throw new TypeError("GIF LZW stream is truncated");
    if (code === clear) {
      reset();
      sawClear = true;
      continue;
    }
    if (code === end) break;
    if (!sawClear) throw new TypeError("GIF LZW stream must begin with clear code");
    let entry = dictionary[code];
    if (entry === undefined && code === nextCode && previous !== null) {
      entry = [...previous, previous[0]];
    }
    if (entry === undefined) throw new TypeError("GIF LZW dictionary is invalid");
    output += entry.length;
    if (output > expectedPixels) throw new TypeError("GIF pixels exceed frame bounds");
    if (previous !== null && nextCode < 4_096) {
      dictionary[nextCode++] = [...previous, entry[0]];
      if (nextCode === (1 << codeSize) && codeSize < 12) codeSize += 1;
    }
    previous = entry;
  }
  const usedBytes = Math.ceil(bitOffset / 8);
  if (usedBytes !== data.byteLength) {
    throw new TypeError("GIF LZW stream contains trailing bytes");
  }
  const usedBitsInLastByte = bitOffset % 8;
  if (usedBitsInLastByte !== 0
    && (data[data.byteLength - 1] >>> usedBitsInLastByte) !== 0) {
    throw new TypeError("GIF LZW stream contains nonzero trailing bits");
  }
  if (output !== expectedPixels) throw new TypeError("GIF pixel count is incomplete");
}

function assertPixelBounds(width, height) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)
    || width < 1 || height < 1
    || width > MAXIMUM_DIMENSION || height > MAXIMUM_DIMENSION
    || checkedSize(width, height, "image pixels") > MAXIMUM_PIXELS) {
    throw new TypeError("project image dimensions or pixel budget are invalid");
  }
}

function checkedSize(left, right, label) {
  const result = left * right;
  if (!Number.isSafeInteger(result) || result < 0) throw new TypeError(`${label} overflows`);
  return result;
}

function checkedOffset(offset, length, total, label) {
  const result = offset + length;
  if (!Number.isSafeInteger(result) || length < 0 || result > total) {
    throw new TypeError(`${label} is truncated`);
  }
  return result;
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 0 ? value >>> 1 : 0xedb88320 ^ (value >>> 1);
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
