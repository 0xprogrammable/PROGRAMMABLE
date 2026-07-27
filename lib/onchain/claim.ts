import {
  encodeFunctionData,
  getAddress,
  isAddress,
  isHex,
} from "viem";

import { creatorFeeHookReadAbi } from "./abis";
import type {
  CreatorClaimIntent,
  CreatorClaimRequest,
  ExploreReadModel,
  OnchainDeployment,
  PreparedCreatorClaim,
} from "./types";

export class CreatorClaimInputError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CreatorClaimInputError";
    this.code = code;
  }
}

export class CreatorClaimUnavailableError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CreatorClaimUnavailableError";
    this.code = code;
  }
}

export function parseCreatorClaimRequest(
  input: unknown,
): CreatorClaimRequest {
  if (
    typeof input !== "object" ||
    input === null ||
    Array.isArray(input)
  ) {
    throw new CreatorClaimInputError(
      "invalid-request",
      "Send account, poolId and chainId",
    );
  }

  const record = input as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (
    keys.length !== 3 ||
    keys[0] !== "account" ||
    keys[1] !== "chainId" ||
    keys[2] !== "poolId"
  ) {
    throw new CreatorClaimInputError(
      "invalid-request",
      "Send only account, poolId and chainId",
    );
  }
  if (typeof record.account !== "string" || !isAddress(record.account)) {
    throw new CreatorClaimInputError(
      "invalid-account",
      "Enter a valid Ethereum account address",
    );
  }
  if (
    typeof record.poolId !== "string" ||
    !isHex(record.poolId) ||
    record.poolId.length !== 66
  ) {
    throw new CreatorClaimInputError(
      "invalid-pool",
      "Enter a valid canonical pool ID",
    );
  }
  if (
    typeof record.chainId !== "number" ||
    !Number.isSafeInteger(record.chainId) ||
    record.chainId <= 0
  ) {
    throw new CreatorClaimInputError(
      "invalid-chain",
      "Enter a valid chain ID",
    );
  }

  return {
    account: getAddress(record.account),
    poolId: record.poolId,
    chainId: record.chainId,
  };
}

export function resolveCreatorClaimIntent(
  request: CreatorClaimRequest,
  deployment: OnchainDeployment,
  model: ExploreReadModel,
): CreatorClaimIntent {
  if (deployment.status !== "ready" || model.status !== "ready") {
    throw new CreatorClaimUnavailableError(
      "not-deployed",
      "Creator claims are unavailable until the production contracts are deployed",
    );
  }
  if (
    request.chainId !== deployment.chainId ||
    model.snapshot.chainId !== deployment.chainId
  ) {
    throw new CreatorClaimUnavailableError(
      "wrong-chain",
      `Switch to chain ${deployment.chainId}`,
    );
  }

  const token = model.tokens.find(
    (candidate) =>
      candidate.poolId.toLowerCase() === request.poolId.toLowerCase(),
  );
  if (!token) {
    throw new CreatorClaimUnavailableError(
      "unknown-pool",
      "This pool is not a verified Programmable launch",
    );
  }
  if (
    token.creatorAddress?.toLowerCase() !==
    request.account.toLowerCase()
  ) {
    throw new CreatorClaimUnavailableError(
      "not-creator",
      "This account is not the recorded creator for the pool",
    );
  }
  if (
    token.hookAddress.toLowerCase() !==
    deployment.feeHook.toLowerCase()
  ) {
    throw new CreatorClaimUnavailableError(
      "noncanonical-hook",
      "The pool does not use the canonical creator fee hook",
    );
  }

  const claimable = BigInt(token.creatorFeesAccruedWei ?? "0");
  if (claimable <= 0n) {
    throw new CreatorClaimUnavailableError(
      "nothing-to-claim",
      "There are no creator fees to claim for this pool",
    );
  }

  return {
    account: request.account,
    poolId: request.poolId,
    tokenAddress: token.tokenAddress,
    hookAddress: deployment.feeHook,
    snapshotClaimableWei: claimable.toString(),
    snapshotClaimableEth: token.creatorFeesAccruedEth ?? "0",
    snapshot: model.snapshot,
    transaction: {
      kind: "claim-creator-fees",
      chainId: deployment.chainId,
      from: request.account,
      to: deployment.feeHook,
      data: encodeFunctionData({
        abi: creatorFeeHookReadAbi,
        functionName: "claimCreatorFees",
        args: [request.poolId],
      }),
      value: "0",
    },
  };
}

export function buildPreparedCreatorClaim(
  intent: CreatorClaimIntent,
  simulation: {
    estimatedGas: bigint;
    gasPriceWei: bigint;
    accountBalanceWei: bigint;
  },
): PreparedCreatorClaim {
  if (
    simulation.estimatedGas <= 0n ||
    simulation.gasPriceWei <= 0n ||
    simulation.accountBalanceWei < 0n
  ) {
    throw new CreatorClaimUnavailableError(
      "invalid-simulation",
      "The creator claim gas simulation is invalid",
    );
  }

  const gasLimit = (simulation.estimatedGas * 120n + 99n) / 100n;
  const estimatedMaxCost = gasLimit * simulation.gasPriceWei;
  return {
    status: "ready",
    claim: {
      account: intent.account,
      poolId: intent.poolId,
      tokenAddress: intent.tokenAddress,
      hookAddress: intent.hookAddress,
      snapshotClaimableWei: intent.snapshotClaimableWei,
      snapshotClaimableEth: intent.snapshotClaimableEth,
    },
    snapshot: intent.snapshot,
    transaction: {
      ...intent.transaction,
      gasLimit: gasLimit.toString(),
    },
    gas: {
      estimatedGas: simulation.estimatedGas.toString(),
      gasLimit: gasLimit.toString(),
      gasPriceWei: simulation.gasPriceWei.toString(),
      estimatedMaxCostWei: estimatedMaxCost.toString(),
      accountBalanceWei: simulation.accountBalanceWei.toString(),
      balanceSufficient:
        simulation.accountBalanceWei >= estimatedMaxCost,
    },
    submission: {
      status: "not-submitted",
      transactionHash: null,
      receipt: null,
    },
  };
}
