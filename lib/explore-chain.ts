import {
  tryParseViewChainId,
  type ViewChainId,
} from "@/lib/view-chain";

export const DEFAULT_EXPLORE_CHAIN_ID = 1 as const;

export function resolveExploreChainId(value: unknown): ViewChainId {
  const viewChainId = tryParseViewChainId(value);
  return viewChainId === DEFAULT_EXPLORE_CHAIN_ID
    ? viewChainId
    : DEFAULT_EXPLORE_CHAIN_ID;
}
