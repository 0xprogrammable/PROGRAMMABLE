import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const projectRoot = process.cwd();
const sourcePath = path.join(projectRoot, "public", "icon-512.png");
const publicDir = path.join(projectRoot, "public");
const originalPink = { r: 232, g: 121, b: 190 };
const faviconPink = { r: 226, g: 159, b: 198 };
const sizes = [16, 32, 48];

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function createIco(images) {
  const directorySize = 6 + images.length * 16;
  const header = Buffer.alloc(directorySize);

  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  let imageOffset = directorySize;
  images.forEach(({ size, data }, index) => {
    const entryOffset = 6 + index * 16;
    header.writeUInt8(size === 256 ? 0 : size, entryOffset);
    header.writeUInt8(size === 256 ? 0 : size, entryOffset + 1);
    header.writeUInt8(0, entryOffset + 2);
    header.writeUInt8(0, entryOffset + 3);
    header.writeUInt16LE(1, entryOffset + 4);
    header.writeUInt16LE(32, entryOffset + 6);
    header.writeUInt32LE(data.length, entryOffset + 8);
    header.writeUInt32LE(imageOffset, entryOffset + 12);
    imageOffset += data.length;
  });

  return Buffer.concat([header, ...images.map(({ data }) => data)]);
}

async function createTransparentMaster() {
  const { data, info } = await sharp(sourcePath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const output = Buffer.alloc(data.length);
  const greenRange = 255 - originalPink.g;

  for (let offset = 0; offset < data.length; offset += 4) {
    const sourceAlpha = data[offset + 3] / 255;
    const coverage = clamp(
      ((255 - data[offset + 1]) / greenRange) * sourceAlpha,
      0,
      1,
    );

    output[offset] = faviconPink.r;
    output[offset + 1] = faviconPink.g;
    output[offset + 2] = faviconPink.b;
    output[offset + 3] = coverage < 0.01 ? 0 : Math.round(coverage * 255);
  }

  return sharp(output, {
    raw: {
      width: info.width,
      height: info.height,
      channels: 4,
    },
  });
}

const master = await createTransparentMaster();
const images = [];

for (const size of sizes) {
  const data = await master
    .clone()
    .resize(size, size, { fit: "fill", kernel: sharp.kernel.lanczos3 })
    .png({ compressionLevel: 9 })
    .toBuffer();

  images.push({ size, data });
  await writeFile(
    path.join(publicDir, `favicon-pastel-v2-${size}x${size}.png`),
    data,
  );

  if (size === 16 || size === 32) {
    await writeFile(
      path.join(publicDir, `favicon-${size}x${size}.png`),
      data,
    );
  }
}

const ico = createIco(images);
await writeFile(path.join(publicDir, "favicon-pastel-v2.ico"), ico);
await writeFile(path.join(publicDir, "favicon.ico"), ico);

const sourceBytes = await readFile(sourcePath);
console.log(
  `Generated transparent pastel favicons from ${sourceBytes.length} source bytes`,
);
