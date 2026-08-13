import "server-only";

import { createActionRpcQuorum } from
  "../server/action-rpc-quorum.server";
import type { ReadyOnchainDeployment } from "./types";
const ARCHIVE_WITNESSES = Object.freeze([
  "https://rpc.mevblocker.io/",
  "https://mainnet.gateway.tenderly.co/",
] as const);

export class HistoricalReadRpcBindingError extends Error {
  override name = "HistoricalReadRpcBindingError";

  constructor() {
    super("Historical read RPC quorum is unavailable");
  }
}

/**
 * Historical registry reconstruction requires two archive-capable readers.
 * MEV Blocker and Tenderly are fixed independent archive witnesses. Current-
 * market reads keep their separate commitment-bound private dRPC + QuickNode
 * quorum.
 */
export function historicalReadOnchainDeployment(
  baseDeployment: ReadyOnchainDeployment,
): ReadyOnchainDeployment {
  if (baseDeployment.chainId !== 1) {
    throw new HistoricalReadRpcBindingError();
  }

  try {
    const providers = createActionRpcQuorum({
      chainId: 1,
      primary: ARCHIVE_WITNESSES[0],
      secondary: ARCHIVE_WITNESSES[1],
      maximumProviders: 2,
    });
    const [primary, secondary] = providers;
    if (
      providers.length !== 2 ||
      primary?.vendorGroup !== "mevblocker" ||
      secondary?.vendorGroup !== "tenderly"
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
