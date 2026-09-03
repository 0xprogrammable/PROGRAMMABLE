import "server-only";

import {
  ActionRpcQuorumError,
  createActionRpcQuorum,
  createCommittedActionRpcProvider,
  tradeActionRpcProvider,
  type ActionRpcProvider,
} from "./action-rpc-quorum.server";

type Environment = Readonly<Record<string, string | undefined>>;

/**
 * Resolves the migration-only action quorum. Migration remains bound to the
 * production dRPC primary, but uses the separately committed Alchemy endpoint
 * as its independent witness so an unavailable shared QuickNode endpoint does
 * not block the time-bounded migration window. Other production action paths
 * continue to use their fixed dRPC + QuickNode pair.
 */
export function mainTokenMigrationRpcProviders(
  env: Environment = process.env,
): readonly ActionRpcProvider[] {
  try {
    const primary = tradeActionRpcProvider(1, env);
    const secondary = createCommittedActionRpcProvider({
      chainId: 1,
      endpoint: env.PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL,
      endpointCommitment:
        env.PROGRAMMABLE_ALCHEMY_MAINNET_RPC_ENDPOINT_COMMITMENT,
    });
    if (
      primary.vendorGroup !== "drpc" ||
      secondary.vendorGroup !== "alchemy"
    ) {
      throw new ActionRpcQuorumError("quorum-unavailable");
    }
    const providers = createActionRpcQuorum({
      chainId: 1,
      primary: primary.endpoint,
      secondary: secondary.endpoint,
      maximumProviders: 2,
    });
    if (
      providers[0]?.endpointCommitment !== primary.endpointCommitment ||
      providers[1]?.endpointCommitment !== secondary.endpointCommitment
    ) {
      throw new ActionRpcQuorumError("quorum-unavailable");
    }
    return providers;
  } catch {
    throw new ActionRpcQuorumError("quorum-unavailable");
  }
}
