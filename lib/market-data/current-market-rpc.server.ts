import "server-only";

import type { ReadyOnchainDeployment } from "../onchain/types";
import { createActionRpcQuorum } from
  "../server/action-rpc-quorum.server";

const CURRENT_MARKET_RPC_SECONDARY = "https://rpc.mevblocker.io/";
const RPC_ENDPOINT_COMMITMENT = /^0x[0-9a-f]{64}$/u;

export class CurrentMarketRpcBindingError extends Error {
  override name = "CurrentMarketRpcBindingError";

  constructor() {
    super("Current market RPC quorum is unavailable");
  }
}

/**
 * Derives a current-market-only quorum from the Website deployment. The
 * Website deployment has already commitment-verified its Alchemy/QuickNode
 * pair; only its QuickNode secondary is eligible here. A fixed, independently
 * operated MEV Blocker endpoint supplies the second exact-block observation.
 */
export function currentMarketOnchainDeployment(
  websiteDeployment: ReadyOnchainDeployment,
): ReadyOnchainDeployment {
  const expectedQuickNodeCommitment =
    process.env.PROGRAMMABLE_QUICKNODE_MAINNET_RPC_ENDPOINT_COMMITMENT;
  if (
    websiteDeployment.chainId !== 1 ||
    !expectedQuickNodeCommitment ||
    !RPC_ENDPOINT_COMMITMENT.test(expectedQuickNodeCommitment)
  ) {
    throw new CurrentMarketRpcBindingError();
  }

  try {
    const providers = createActionRpcQuorum({
      chainId: 1,
      primary: websiteDeployment.rpcUrlSecondary,
      secondary: CURRENT_MARKET_RPC_SECONDARY,
      maximumProviders: 2,
    });
    const [primary, secondary] = providers;
    if (
      providers.length !== 2 ||
      primary?.vendorGroup !== "quicknode" ||
      secondary?.vendorGroup !== "mevblocker" ||
      primary.endpointCommitment !== expectedQuickNodeCommitment
    ) {
      throw new CurrentMarketRpcBindingError();
    }

    return {
      ...websiteDeployment,
      rpcUrl: primary.endpoint,
      rpcUrlSecondary: secondary.endpoint,
    };
  } catch {
    throw new CurrentMarketRpcBindingError();
  }
}
