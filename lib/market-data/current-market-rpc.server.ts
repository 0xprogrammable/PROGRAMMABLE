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

function quickNodeRpcUrl() {
  const preferred = process.env.PROGRAMMABLE_QUICKNODE_MAINNET_RPC_URL;
  return preferred === undefined || preferred === ""
    ? process.env.ETHEREUM_RPC_URL_B
    : preferred;
}

/**
 * Derives a current-market-only quorum from the production deployment
 * manifest. Its QuickNode endpoint is independently configured and
 * commitment-verified here; current evidence therefore does not depend on an
 * Alchemy endpoint being configured. A fixed, independently operated MEV
 * Blocker endpoint supplies the second exact-block observation.
 */
export function currentMarketOnchainDeployment(
  baseDeployment: ReadyOnchainDeployment,
): ReadyOnchainDeployment {
  const expectedQuickNodeCommitment =
    process.env.PROGRAMMABLE_QUICKNODE_MAINNET_RPC_ENDPOINT_COMMITMENT;
  if (
    baseDeployment.chainId !== 1 ||
    !expectedQuickNodeCommitment ||
    !RPC_ENDPOINT_COMMITMENT.test(expectedQuickNodeCommitment)
  ) {
    throw new CurrentMarketRpcBindingError();
  }

  try {
    const providers = createActionRpcQuorum({
      chainId: 1,
      primary: quickNodeRpcUrl(),
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
      ...baseDeployment,
      rpcUrl: primary.endpoint,
      rpcUrlSecondary: secondary.endpoint,
      // Provider-neutral Website role IDs describe the replaced base pair.
      // Do not mislabel this dedicated QuickNode + MEV Blocker quorum.
      rpcProviderIds: undefined,
    };
  } catch {
    throw new CurrentMarketRpcBindingError();
  }
}
