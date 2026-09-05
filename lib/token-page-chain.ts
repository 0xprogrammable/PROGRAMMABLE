import { tryParseViewChainId, type ViewChainId } from "@/lib/view-chain";

export function tokenDetailPageChainId(value: string | string[] | undefined): ViewChainId | null {
  if (value === undefined) return 1;
  return typeof value === "string" ? tryParseViewChainId(value) : null;
}
