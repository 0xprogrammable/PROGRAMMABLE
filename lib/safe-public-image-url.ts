const LOCAL_IMAGE_ORIGIN = "https://programmable.market";

export function safePublicImageUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;

  if (value.startsWith("/") && !value.startsWith("//")) {
    try {
      const url = new URL(value, LOCAL_IMAGE_ORIGIN);
      return url.origin === LOCAL_IMAGE_ORIGIN ? value : undefined;
    } catch {
      return undefined;
    }
  }

  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
        !url.username &&
        !url.password &&
        Boolean(url.hostname)
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}
