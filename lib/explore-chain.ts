import {
  tryParseViewChainId,
  type ViewChainId,
} from "@/lib/view-chain";

export const DEFAULT_EXPLORE_CHAIN_ID = 1 as const;

export function resolveExploreChainId(value: unknown): ViewChainId {
  const viewChainId = tryParseViewChainId(value);
  return viewChainId ?? DEFAULT_EXPLORE_CHAIN_ID;
}

export function isRobinhoodExploreAvailableResponse(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const response = value as Record<string, unknown>;
  const catalog = response.catalog;
  return response.status === "ready" &&
    response.chainId === 4663 &&
    typeof response.total === "number" &&
    Number.isSafeInteger(response.total) &&
    response.total > 0 &&
    typeof catalog === "object" && catalog !== null && !Array.isArray(catalog) &&
    (catalog as Record<string, unknown>).source ===
      "robinhood-finalized-custom-launch-feed-v4" &&
    typeof (catalog as Record<string, unknown>).completeness === "object" &&
    (catalog as Record<string, unknown>).completeness !== null &&
    ((catalog as Record<string, unknown>).completeness as Record<string, unknown>)
      .custom === "current";
}
