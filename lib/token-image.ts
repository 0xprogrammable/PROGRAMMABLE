export const TOKEN_IMAGE_OUTPUT_SIZE = 1_000;
export const MAX_TOKEN_IMAGE_SOURCE_BYTES = 8_000_000;
export const MAX_TOKEN_IMAGE_UPLOAD_BYTES = 1_000_000;
export const PROGRAMMABLE_TOKEN_IMAGE_HOST =
  "k2uoipt9wchjtz3h.public.blob.vercel-storage.com";
export const PROGRAMMABLE_TOKEN_IMAGE_STORE_ID = "store_k2uoiPT9WCHJtz3H";

export type TokenImageUploadResponse = Readonly<Record<string, unknown>>;

const acceptedTokenImageTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export function canOptimizeTokenImage(source: string) {
  return source.startsWith("/") && !source.startsWith("//");
}

export function isProgrammableTokenImageUrl(source: string) {
  try {
    const url = new URL(source);
    return (
      url.protocol === "https:" &&
      url.hostname === PROGRAMMABLE_TOKEN_IMAGE_HOST &&
      url.port === "" &&
      url.username === "" &&
      url.password === "" &&
      url.search === "" &&
      url.hash === "" &&
      url.pathname.startsWith("/token-images/") &&
      url.pathname.endsWith(".webp")
    );
  } catch {
    return false;
  }
}

export function getProgrammableTokenImageAssetName(source: string) {
  if (!isProgrammableTokenImageUrl(source)) return "";
  try {
    const pathname = new URL(source).pathname;
    const assetName = pathname.slice("/token-images/".length);
    return /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}\.webp$/.test(assetName)
      ? assetName
      : "";
  } catch {
    return "";
  }
}

export function getTokenCardImageSource(source: string) {
  const assetName = getProgrammableTokenImageAssetName(source);
  return assetName
    ? `/api/token-image-proxy/${encodeURIComponent(assetName)}`
    : source;
}

export function applyTokenImageFallback(
  image: HTMLImageElement,
  fallbackSource: string,
) {
  if (image.dataset.tokenImageFallback === "true") return false;
  image.dataset.tokenImageFallback = "true";
  image.alt = "";
  image.removeAttribute("srcset");
  image.src = fallbackSource;
  return true;
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

export async function readTokenImageUploadResponse(
  response: Response,
): Promise<TokenImageUploadResponse | null> {
  const contentType = response.headers.get("content-type")
    ?.split(";", 1)[0]?.trim().toLowerCase();
  if (response.redirected || contentType !== "application/json") return null;

  try {
    const body: unknown = await response.json();
    return typeof body === "object" && body !== null && !Array.isArray(body)
      ? body as TokenImageUploadResponse
      : null;
  } catch {
    return null;
  }
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
      0.84,
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
