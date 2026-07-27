import {
  getAvatarDimensionsError,
  getAvatarFileError,
  isSafeAvatarDataUrl,
} from "./local-profile";

const avatarOutputSize = 512;

function loadImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The image could not be opened"));
    image.src = source;
  });
}

export async function prepareAvatarImage(file: File) {
  const fileError = getAvatarFileError(file);
  if (fileError) throw new Error(fileError);

  const objectUrl = URL.createObjectURL(file);

  try {
    const image = await loadImage(objectUrl);
    const dimensionsError = getAvatarDimensionsError(
      image.naturalWidth,
      image.naturalHeight,
    );
    if (dimensionsError) throw new Error(dimensionsError);

    const cropSize = Math.min(image.naturalWidth, image.naturalHeight);
    const sourceX = (image.naturalWidth - cropSize) / 2;
    const sourceY = (image.naturalHeight - cropSize) / 2;
    const canvas = document.createElement("canvas");
    canvas.width = avatarOutputSize;
    canvas.height = avatarOutputSize;

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
      avatarOutputSize,
      avatarOutputSize,
    );

    const dataUrl = canvas.toDataURL("image/webp", 0.86);
    if (!isSafeAvatarDataUrl(dataUrl)) {
      throw new Error("The prepared image is too large to store");
    }

    return dataUrl;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
