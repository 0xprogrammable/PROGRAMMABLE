const MAX_LINK_BYTES = 2_048;

export function normalizeHttpsLinkV1(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || Buffer.byteLength(trimmed, "utf8") > MAX_LINK_BYTES) {
    throw new TypeError("Article link is invalid");
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new TypeError("Article link is invalid");
  }
  if (
    url.protocol !== "https:"
    || url.username !== ""
    || url.password !== ""
    || !url.hostname
  ) throw new TypeError("Article link must use HTTPS");
  url.hash = "";
  return url.toString();
}

export function displayHttpsLinkV1(value: string): string {
  const url = new URL(normalizeHttpsLinkV1(value));
  return url.hostname.replace(/^www\./iu, "");
}

export function isAllowedArticleHrefV1(value: string): boolean {
  try {
    normalizeHttpsLinkV1(value);
    return true;
  } catch {
    return false;
  }
}
