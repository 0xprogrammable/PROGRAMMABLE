export type PageRepresentation = "html" | "markdown" | "not-acceptable";

type MediaPreference = Readonly<{
  quality: number;
  specificity: number;
}>;

function preferenceFor(
  accept: string,
  offeredType: "text/html" | "text/markdown",
): MediaPreference {
  const [offeredFamily] = offeredType.split("/", 1);
  let best: MediaPreference = { quality: 0, specificity: -1 };
  for (const rawEntry of accept.split(",")) {
    const [rawRange, ...rawParameters] = rawEntry.split(";");
    const range = rawRange.trim().toLowerCase();
    let quality = 1;
    for (const rawParameter of rawParameters) {
      const [rawName, rawValue] = rawParameter.split("=", 2);
      if (rawName?.trim().toLowerCase() !== "q") continue;
      const parsed = Number(rawValue?.trim());
      quality = Number.isFinite(parsed) && parsed >= 0 && parsed <= 1
        ? parsed
        : 0;
    }

    const specificity = range === offeredType
      ? 2
      : range === `${offeredFamily}/*`
        ? 1
        : range === "*/*"
          ? 0
          : -1;
    if (specificity < 0) continue;
    if (
      specificity > best.specificity ||
      (specificity === best.specificity && quality > best.quality)
    ) {
      best = { quality, specificity };
    }
  }
  return best;
}

export function negotiatePageRepresentation(
  acceptHeader: string | null,
): PageRepresentation {
  const accept = acceptHeader?.trim().toLowerCase();
  if (!accept) return "html";

  // Next.js client transitions use this internal representation. It must keep
  // flowing through the normal application renderer rather than content
  // negotiation intended for direct document requests.
  if (accept.includes("text/x-component")) return "html";

  const html = preferenceFor(accept, "text/html");
  const markdown = preferenceFor(accept, "text/markdown");
  if (markdown.quality > 0 && markdown.quality > html.quality) {
    return "markdown";
  }
  if (html.quality > 0) return "html";
  if (markdown.quality > 0) return "markdown";
  return "not-acceptable";
}
