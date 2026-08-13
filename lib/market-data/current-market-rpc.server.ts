import "server-only";

import type { ReadyOnchainDeployment } from "../onchain/types";
import { productionMainnetRpcPair } from
  "../onchain/website-rpc-providers.server";
import { createActionRpcQuorum } from
  "../server/action-rpc-quorum.server";

export class CurrentMarketRpcBindingError extends Error {
  override name = "CurrentMarketRpcBindingError";

  constructor() {
    super("Current market RPC quorum is unavailable");
  }
}

/**
 * Derives the current-market exact-block quorum from the same commitment-bound
 * private dRPC + QuickNode pair used by Website reads and background workers.
 * Runtime health still proves chain id, head freshness and equal confirmed
 * block hashes before any current valuation can be published.
 */
export function currentMarketOnchainDeployment(
  baseDeployment: ReadyOnchainDeployment,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): ReadyOnchainDeployment {
  if (baseDeployment.chainId !== 1) {
    throw new CurrentMarketRpcBindingError();
  }

  try {
    const binding = productionMainnetRpcPair(environment);
    const providers = createActionRpcQuorum({
      chainId: 1,
      primary: binding.primary.url,
      secondary: binding.secondary.url,
      maximumProviders: 2,
    });
    const [primary, secondary] = providers;
    if (
      providers.length !== 2 ||
      primary?.vendorGroup !== "drpc" ||
      secondary?.vendorGroup !== "quicknode" ||
      primary.endpointCommitment !== binding.primary.endpointCommitment ||
      secondary.endpointCommitment !== binding.secondary.endpointCommitment
    ) {
      throw new CurrentMarketRpcBindingError();
    }

    return {
      ...baseDeployment,
      rpcUrl: primary.endpoint,
      rpcUrlSecondary: secondary.endpoint,
      rpcProviderIds: {
        primary: "drpc",
        secondary: "quicknode",
      },
    };
  } catch {
    throw new CurrentMarketRpcBindingError();
  }
}
