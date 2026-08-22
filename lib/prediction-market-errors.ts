type ErrorWithShortMessage = Readonly<{
  shortMessage?: unknown;
}>;

const urlPattern = /https?:\/\/[^\s)\]}>,"']+/giu;

function readShortMessage(error: unknown) {
  if (typeof error !== "object" || error === null) return "";
  const shortMessage = (error as ErrorWithShortMessage).shortMessage;
  return typeof shortMessage === "string" ? shortMessage : "";
}

export function predictionMarketErrorMessage(
  error: unknown,
  fallback: string,
) {
  const shortMessage = readShortMessage(error);
  const source = shortMessage || (error instanceof Error ? error.message : "");
  const firstLine = source.split(/\r?\n/u, 1)[0]?.trim() ?? "";
  const safeMessage = firstLine
    .replace(urlPattern, "the configured provider")
    .trim();
  return safeMessage || fallback;
}
