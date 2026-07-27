import { describe, expect, it } from "vitest";
import { decodeFunctionData } from "viem";

import { creatorFeeHookReadAbi } from "../lib/onchain/abis";
import {
  buildPreparedCreatorClaim,
  parseCreatorClaimRequest,
  resolveCreatorClaimIntent,
} from "../lib/onchain/claim";
import {
  buildPrivyTransactionRequest,
  parsePreparedTransactionForAccount,
} from "../lib/prepared-transaction";
import { validatePreparedCreatorClaim } from "../lib/profile/creator-claim";
import type {
  ExploreReadModel,
  OnchainDeployment,
} from "../lib/onchain/types";

const account = "0x1111111111111111111111111111111111111111";
const hook = "0x2222222222222222222222222222222222222222";
const token = "0x3333333333333333333333333333333333333333";
const poolId = `0x${"44".repeat(32)}` as `0x${string}`;

const deployment: OnchainDeployment = {
  environment: "production",
  releaseVersion: "classic-v2",
  chainId: 1,
  status: "ready",
  launcher: "0x5555555555555555555555555555555555555555",
  feeHook: hook,
  launcherRuntimeCodeHash: `0x${"66".repeat(32)}`,
  feeHookRuntimeCodeHash: `0x${"77".repeat(32)}`,
  deploymentBlock: 1n,
  stateView: "0x8888888888888888888888888888888888888888",
  stateViewRuntimeCodeHash: `0x${"99".repeat(32)}`,
  rpcUrl: "https://example.invalid",
  rpcUrlSecondary: null,
  confirmations: 12n,
  logBlockRange: 10_000n,
};

function readyModel(claimable = "100000000000000000"): ExploreReadModel {
  return {
    status: "ready",
    tokens: [
      {
        id: "1:token",
        name: "Token",
        symbol: "TOK",
        tokenAddress: token,
        hookAddress: hook,
        poolId,
        creatorAddress: account,
        launchedAt: "2026-07-27T00:00:00.000Z",
        creatorFeesAccruedWei: claimable,
        creatorFeesAccruedEth: "0.1",
        totalSwapFeeBps: 100,
        liquidityPath: "meme",
      },
    ],
    creatorClaims: [],
    snapshot: {
      chainId: 1,
      blockNumber: "100",
      blockHash: `0x${"aa".repeat(32)}`,
      confirmations: 12,
    },
    launcherFeesAccruedWei: "0",
    launcherFeesAccruedEth: "0",
  };
}

describe("creator claim preparation", () => {
  it("accepts only account, canonical poolId and chainId", () => {
    expect(
      parseCreatorClaimRequest({ account, poolId, chainId: 1 }),
    ).toEqual({ account, poolId, chainId: 1 });
    expect(() =>
      parseCreatorClaimRequest({
        account,
        poolId,
        chainId: 1,
        recipient: account,
      }),
    ).toThrow("only account, poolId and chainId");
  });

  it("builds only claimCreatorFees calldata to the canonical hook", () => {
    const intent = resolveCreatorClaimIntent(
      { account, poolId, chainId: 1 },
      deployment,
      readyModel(),
    );
    const decoded = decodeFunctionData({
      abi: creatorFeeHookReadAbi,
      data: intent.transaction.data,
    });

    expect(intent.transaction).toMatchObject({
      kind: "claim-creator-fees",
      chainId: 1,
      from: account,
      to: hook,
      value: "0",
    });
    expect(decoded.functionName).toBe("claimCreatorFees");
    expect(decoded.args).toEqual([poolId]);
  });

  it("keeps the nested endpoint schema and sender binding through the wallet boundary", () => {
    const intent = resolveCreatorClaimIntent(
      { account, poolId, chainId: 1 },
      deployment,
      readyModel(),
    );
    const routePayload = buildPreparedCreatorClaim(intent, {
      estimatedGas: 100_000n,
      gasPriceWei: 2_000_000_000n,
      accountBalanceWei: 10n ** 18n,
    });
    const validated = validatePreparedCreatorClaim(routePayload, {
      account,
      poolId,
      tokenAddress: token,
      hookAddress: hook,
      chainId: 1,
    });
    const preparedForWallet = parsePreparedTransactionForAccount(
      validated.transaction,
      account,
    );

    expect(validated.claim).toMatchObject({
      account,
      poolId,
      tokenAddress: token,
      hookAddress: hook,
    });
    expect(preparedForWallet).toMatchObject({
      kind: "claim-creator-fees",
      chainId: 1,
      from: account,
      to: hook,
      value: "0",
      gasLimit: "120000",
    });
    expect(buildPrivyTransactionRequest(preparedForWallet)).toEqual({
      to: hook,
      data: validated.transaction.data,
      value: 0n,
      gasLimit: 120_000n,
      chainId: 1,
    });
    expect(() =>
      parsePreparedTransactionForAccount(
        {
          ...validated.transaction,
          from: undefined,
        },
        account,
      ),
    ).toThrow("sender");
  });

  it("fails closed for foreign creators and empty claims", () => {
    expect(() =>
      resolveCreatorClaimIntent(
        {
          account: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          poolId,
          chainId: 1,
        },
        deployment,
        readyModel(),
      ),
    ).toThrow("not the recorded creator");
    expect(() =>
      resolveCreatorClaimIntent(
        { account, poolId, chainId: 1 },
        deployment,
        readyModel("0"),
      ),
    ).toThrow("no creator fees");
  });
});
