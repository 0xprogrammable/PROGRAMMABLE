export const TOKEN_IMAGE_OUTPUT_SIZE = 1_000;
export const MAX_TOKEN_IMAGE_SOURCE_BYTES = 8_000_000;
export const MAX_TOKEN_IMAGE_UPLOAD_BYTES = 2_000_000;

const acceptedTokenImageTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
export function canOptimizeTokenImage(source: string) {
  return source.startsWith("/");
}

export function getTokenImageFileError(file: Pick<File, "size" | "type">) {
  if (!acceptedTokenImageTypes.has(file.type)) {
    return "Choose a JPG, PNG or WebP image";
  }
  if (file.size === 0) return "Choose a non-empty image";
  if (file.size > MAX_TOKEN_IMAGE_SOURCE_BYTES) {
    return "Choose an image smaller than 8 MB";
  }
  return "";
}

function loadImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The image could not be opened"));
    image.src = source;
  });
}

function canvasToWebp(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("The image could not be prepared"));
          return;
        }
        resolve(blob);
      },
      "image/webp",
      0.9,
    );
  });
}

export async function prepareTokenImage(file: File) {
  const fileError = getTokenImageFileError(file);
  if (fileError) throw new Error(fileError);

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await loadImage(objectUrl);
    if (image.naturalWidth < 256 || image.naturalHeight < 256) {
      throw new Error("Choose an image at least 256 × 256 pixels");
    }

    const cropSize = Math.min(image.naturalWidth, image.naturalHeight);
    const sourceX = (image.naturalWidth - cropSize) / 2;
    const sourceY = (image.naturalHeight - cropSize) / 2;
    const canvas = document.createElement("canvas");
    canvas.width = TOKEN_IMAGE_OUTPUT_SIZE;
    canvas.height = TOKEN_IMAGE_OUTPUT_SIZE;

    const context = canvas.getContext("2d");
    if (!context) throw new Error("The image could not be prepared");

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(
      image,
      sourceX,
      sourceY,
      cropSize,
      cropSize,
      0,
      0,
      TOKEN_IMAGE_OUTPUT_SIZE,
      TOKEN_IMAGE_OUTPUT_SIZE,
    );

    const blob = await canvasToWebp(canvas);
    if (blob.size > MAX_TOKEN_IMAGE_UPLOAD_BYTES) {
      throw new Error("The prepared image is still too large");
    }
    return blob;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function hasValidTokenImageSignature(file: Blob) {
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const isJpeg =
    bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isPng =
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a;
  const isWebp =
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50;
  return isJpeg || isPng || isWebp;
}
