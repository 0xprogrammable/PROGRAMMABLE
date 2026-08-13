import "server-only";

import { createActionRpcQuorum } from
  "../server/action-rpc-quorum.server";
import type { ReadyOnchainDeployment } from "./types";
import { productionMainnetRpcPair } from
  "./website-rpc-providers.server";

const INDEPENDENT_ARCHIVE_WITNESS = "https://rpc.mevblocker.io/";

export class HistoricalReadRpcBindingError extends Error {
  override name = "HistoricalReadRpcBindingError";

  constructor() {
    super("Historical read RPC quorum is unavailable");
  }
}

/**
 * Historical registry reconstruction requires two archive-capable readers.
 * The private QuickNode endpoint remains commitment-bound; MEV Blocker is a
 * fixed, independent witness. Current-market reads keep their separate private
 * dRPC + QuickNode quorum.
 */
export function historicalReadOnchainDeployment(
  baseDeployment: ReadyOnchainDeployment,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): ReadyOnchainDeployment {
  if (baseDeployment.chainId !== 1) {
    throw new HistoricalReadRpcBindingError();
  }

  try {
    const binding = productionMainnetRpcPair(environment);
    const providers = createActionRpcQuorum({
      chainId: 1,
      primary: binding.secondary.url,
      secondary: INDEPENDENT_ARCHIVE_WITNESS,
      maximumProviders: 2,
    });
    const [primary, secondary] = providers;
    if (
      providers.length !== 2 ||
      primary?.vendorGroup !== "quicknode" ||
      secondary?.vendorGroup !== "mevblocker" ||
      primary.endpointCommitment !== binding.secondary.endpointCommitment
    ) {
      throw new HistoricalReadRpcBindingError();
    }

    return {
      ...baseDeployment,
      rpcUrl: primary.endpoint,
      rpcUrlSecondary: secondary.endpoint,
      rpcProviderIds: undefined,
    };
  } catch {
    throw new HistoricalReadRpcBindingError();
  }
}
