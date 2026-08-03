import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const projectRoot = process.cwd();
const sourcePath = path.join(
  projectRoot,
  "public",
  "brand",
  "loop",
  "programmable-loop-mark-transparent-v1.png",
);
const publicDir = path.join(projectRoot, "public");
const sizes = [16, 32, 48];

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
  return sharp(sourcePath)
    .ensureAlpha()
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 8 });
}

const master = await createTransparentMaster();
const images = [];

for (const size of sizes) {
  const inset = size <= 32 ? 1 : 2;
  const innerSize = size - inset * 2;
  const data = await master
    .clone()
    .resize(innerSize, innerSize, {
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      fit: "contain",
      kernel: sharp.kernel.lanczos3,
    })
    .extend({
      top: inset,
      bottom: inset,
      left: inset,
      right: inset,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png({ compressionLevel: 9 })
    .toBuffer();

  images.push({ size, data });
  await writeFile(
    path.join(publicDir, `favicon-pastel-v3-${size}x${size}.png`),
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
await writeFile(path.join(publicDir, "favicon-pastel-v3.ico"), ico);
await writeFile(path.join(publicDir, "favicon.ico"), ico);

const sourceBytes = await readFile(sourcePath);
console.log(
  `Generated tightly framed transparent favicons from ${sourceBytes.length} source bytes`,
);
