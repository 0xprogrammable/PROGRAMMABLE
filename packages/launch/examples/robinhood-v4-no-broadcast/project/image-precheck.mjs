export async function assertExactProjectImageV4(bytes, validatorModuleUrl) {
  const url = new URL(validatorModuleUrl);
  if (url.protocol !== "file:" || url.username || url.password || url.hash) {
    throw new TypeError("project image validator must be an exact local file module");
  }
  const validator = await import(url.href);
  if (typeof validator.decodeExactProjectImageV4 !== "function") {
    throw new TypeError("project image validator does not expose the V4 exact decoder");
  }
  const decoded = validator.decodeExactProjectImageV4(Buffer.from(bytes));
  if (!new Set(["image/png", "image/gif"]).has(decoded?.mediaType)
    || !Number.isSafeInteger(decoded?.width) || decoded.width < 1
    || !Number.isSafeInteger(decoded?.height) || decoded.height < 1
    || decoded.frameCount !== 1) {
    throw new TypeError("project image decoder returned a non-canonical V4 result");
  }
  return decoded;
}
