import { toFunctionSelector } from "viem";

const call = (
  signature: string,
  argumentShape: "none" | "allocation-index" | "account",
) => Object.freeze({
  signature,
  selector: toFunctionSelector(signature),
  argumentShape,
  blockTag: "eip-1898-canonical-block-hash" as const,
});

/**
 * Frozen, reviewable JSON-RPC surface for reward-vault snapshots. Runtime
 * clients consume these exact function shapes and the provider schema
 * commitment includes this object, so adding another onchain read necessarily
 * changes the reviewed commitment.
 */
export const PROJECTOR_REWARD_RPC_CALL_CONTRACT_V1 = Object.freeze({
  version: 1,
  transportMethod: "eth_call",
  retryCount: 0,
  models: Object.freeze({
    "classic-v3": Object.freeze({
      maximumAllocations: 5,
      maximumBalanceAccounts: 48,
      fixed: Object.freeze([
        call("poolId()", "none"),
        call("configurationEpoch()", "none"),
        call("activeConfigurationHash()", "none"),
        call("totalCreatorFeesReceived()", "none"),
        call("totalCreatorFeesClaimed()", "none"),
        call("beneficiaryCount()", "none"),
      ]),
      perAllocation: Object.freeze([
        call("beneficiaryAt(uint256)", "allocation-index"),
        call("shareBpsAt(uint256)", "allocation-index"),
      ]),
      perBalanceAccount: Object.freeze([
        call("claimable(address)", "account"),
        call("claimedBy(address)", "account"),
      ]),
    }),
    "stock-paired": Object.freeze({
      maximumAllocations: 8,
      maximumBalanceAccounts: 8,
      fixed: Object.freeze([
        call("poolId()", "none"),
        call("configurationHash()", "none"),
        call("totalCreatorFeesReceived()", "none"),
        call("totalCreatorFeesClaimed()", "none"),
        call("beneficiaryCount()", "none"),
      ]),
      perAllocation: Object.freeze([
        call("beneficiaryAt(uint256)", "allocation-index"),
        call("shareBpsOf(address)", "account"),
        call("payoutAddressOf(address)", "account"),
      ]),
      perBalanceAccount: Object.freeze([
        call("claimable(address)", "account"),
        call("claimedBy(address)", "account"),
      ]),
    }),
  }),
});

export type ProjectorRewardRpcModel =
  keyof typeof PROJECTOR_REWARD_RPC_CALL_CONTRACT_V1.models;

export function expectedRewardRpcCallCount(
  model: ProjectorRewardRpcModel,
  allocationCount: number,
  balanceAccountCount: number,
): number {
  const contract = PROJECTOR_REWARD_RPC_CALL_CONTRACT_V1.models[model];
  return contract.fixed.length +
    contract.perAllocation.length * allocationCount +
    contract.perBalanceAccount.length * balanceAccountCount;
}
