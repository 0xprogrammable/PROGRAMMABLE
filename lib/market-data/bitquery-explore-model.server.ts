import "server-only";

import type { ExploreReadModel } from "../onchain/types";
import {
  readBitqueryExploreEntriesV1,
  type BitqueryLaunchCatalogReaderOptions,
} from "./bitquery-launches.server";

/**
 * Adapts the strict Bitquery launch catalog to the existing action-preparation
 * model. No cache, database, Blob, RPC or secondary provider is consulted.
 */
export async function readBitqueryExploreModelV1(
  options: BitqueryLaunchCatalogReaderOptions = {},
): Promise<ExploreReadModel> {
  const catalog = await readBitqueryExploreEntriesV1(options);
  if (
    catalog.entries.length > 0 &&
    (catalog.asOfBlock === null || catalog.asOfBlockHash === null)
  ) {
    throw new Error("Bitquery launch catalog has no canonical block identity");
  }
  return {
    status: "ready",
    tokens: catalog.entries.flatMap((entry) =>
      entry.exploreKind === "token" ? [entry] : []
    ),
    snapshot: {
      chainId: 1,
      blockNumber: catalog.asOfBlock ?? "0",
      blockHash: catalog.asOfBlockHash ??
        "0x0000000000000000000000000000000000000000000000000000000000000000",
      confirmations: 0,
    },
    creatorClaims: [],
    launcherFeesAccruedWei: "0",
    launcherFeesAccruedEth: "0",
  };
}
