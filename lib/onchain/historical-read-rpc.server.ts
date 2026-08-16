import "server-only";

import { createActionRpcQuorum } from
  "../server/action-rpc-quorum.server";
import type { ReadyOnchainDeployment } from "./types";
import { productionRecoveryMainnetRpcPair } from
  "./website-rpc-providers.server";

export class HistoricalReadRpcBindingError extends Error {
  override name = "HistoricalReadRpcBindingError";

  constructor() {
    super("Historical read RPC quorum is unavailable");
  }
}

/**
 * Historical registry reconstruction requires two archive-capable readers.
 * It uses the exact commitment-bound Alchemy + QuickNode recovery pair so a
 * depleted role-bound Website primary cannot block a durable index rebuild.
 * Both endpoints retain independent vendors and exact endpoint commitments;
 * no public, anonymous or generic-alias fallback may substitute either one.
 */
export function historicalReadOnchainDeployment(
  baseDeployment: ReadyOnchainDeployment,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): ReadyOnchainDeployment {
  if (baseDeployment.chainId !== 1) {
    throw new HistoricalReadRpcBindingError();
  }

  try {
    const binding = productionRecoveryMainnetRpcPair(environment);
    const providers = createActionRpcQuorum({
      chainId: 1,
      primary: binding.primary.url,
      secondary: binding.secondary.url,
      maximumProviders: 2,
    });
    const [primary, secondary] = providers;
    if (
      providers.length !== 2 ||
      primary?.vendorGroup !== "alchemy" ||
      secondary?.vendorGroup !== "quicknode" ||
      primary.endpointCommitment !== binding.primary.endpointCommitment ||
      secondary.endpointCommitment !== binding.secondary.endpointCommitment
    ) {
      throw new HistoricalReadRpcBindingError();
    }

    return {
      ...baseDeployment,
      rpcUrl: primary.endpoint,
      rpcUrlSecondary: secondary.endpoint,
      rpcProviderIds: {
        primary: "alchemy",
        secondary: "quicknode",
      },
    };
  } catch {
    throw new HistoricalReadRpcBindingError();
  }
}
