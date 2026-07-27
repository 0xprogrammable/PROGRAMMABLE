import { describe, expect, it, vi } from "vitest";
import { encodeFunctionData, parseAbi } from "viem";

import {
  prepareCreatorClaim,
  validatePreparedCreatorClaim,
} from "../lib/profile/creator-claim";
import {
  fetchCreatorProfile,
  mapCreatorProfileResponse,
} from "../lib/profile/onchain-profile";

const account = "0x1111111111111111111111111111111111111111";
const tokenAddress = "0x2222222222222222222222222222222222222222";
const positionRecipient =
  "0x3333333333333333333333333333333333333333";
const hookAddress = "0x4444444444444444444444444444444444444444";
const callerAddress = "0x5555555555555555555555555555555555555555";
const poolId = `0x${"66".repeat(32)}` as `0x${string}`;
const otherPoolId = `0x${"77".repeat(32)}` as `0x${string}`;
const launchTransactionHash = `0x${"88".repeat(32)}` as `0x${string}`;
const claimTransactionHash = `0x${"99".repeat(32)}` as `0x${string}`;
const blockHash = `0x${"aa".repeat(32)}` as `0x${string}`;
const claimCreatorFeesAbi = parseAbi([
  "function claimCreatorFees(bytes32 poolId) returns (uint256 amount)",
]);

function profileResponse() {
  return {
    status: "ready",
    account,
    tokens: [
      {
        id: "1:token",
        name: "Programmable",
        symbol: "PRG",
        tokenAddress,
        hookAddress,
        poolId,
        creatorAddress: account,
        positionRecipient,
        positionTokenId: "42",
        launchTransactionHash,
        launchLogIndex: 3,
        launchedAt: "2026-07-26T12:00:00.000Z",
        imageUrl: "https://programmable.family/token.png",
        marketCapEthWei: "1200000000000000000",
        fdvUsdWad: "3600000000000000000000",
        totalSwapFeeBps: 200,
        liquidityPath: "meme",
      },
    ],
    pools: [
      {
        tokenAddress,
        name: "Programmable",
        symbol: "PRG",
        poolId,
        totalSwapFeeBps: 200,
        claimableCreatorFeesWei: "200000000000000000",
        claimableCreatorFeesEth: "0.2",
        generatedCreatorFeesWei: "500000000000000000",
        generatedCreatorFeesEth: "0.5",
      },
    ],
    claims: [
      {
        poolId,
        tokenAddress,
        creatorAddress: account,
        recipientAddress: account,
        callerAddress,
        amountWei: "300000000000000000",
        amountEth: "0.3",
        blockNumber: "100",
        transactionHash: claimTransactionHash,
        transactionIndex: 1,
        logIndex: 2,
        claimedAt: "2026-07-27T12:00:00.000Z",
      },
    ],
    totals: {
      claimableWei: "200000000000000000",
      claimableEth: "0.2",
      generatedWei: "500000000000000000",
      generatedEth: "0.5",
      claimedWei: "300000000000000000",
      claimedEth: "0.3",
    },
    snapshot: {
      chainId: 1,
      blockNumber: "110",
      blockHash,
      confirmations: 12,
    },
  };
}

function preparedClaimResponse() {
  return {
    status: "ready",
    claim: {
      account,
      poolId,
      tokenAddress,
      hookAddress,
      snapshotClaimableWei: "200000000000000000",
      snapshotClaimableEth: "0.2",
    },
    snapshot: {
      chainId: 1,
      blockNumber: "110",
      blockHash,
      confirmations: 12,
    },
    transaction: {
      kind: "claim-creator-fees",
      chainId: 1,
      from: account,
      to: hookAddress,
      data: encodeFunctionData({
        abi: claimCreatorFeesAbi,
        functionName: "claimCreatorFees",
        args: [poolId],
      }),
      value: "0",
      gasLimit: "120000",
    },
    gas: {
      estimatedGas: "100000",
      gasLimit: "120000",
      gasPriceWei: "1000000000",
      estimatedMaxCostWei: "120000000000000",
      accountBalanceWei: "1000000000000000",
      balanceSufficient: true,
    },
    submission: {
      status: "not-submitted",
      transactionHash: null,
      receipt: null,
    },
  };
}

describe("profile API client", () => {
  it("maps verified tokens, locked positions, claimable pools and confirmed activity", () => {
    const profile = mapCreatorProfileResponse(profileResponse(), account);

    expect(profile).toMatchObject({
      status: "ready",
      account,
      chainId: 1,
      claimableWei: "200000000000000000",
      claimableEth: "0.2",
      claimedWei: "300000000000000000",
      claimedEth: "0.3",
    });
    expect(profile.tokens).toEqual([
      {
        address: tokenAddress,
        name: "Programmable",
        symbol: "PRG",
        launchedAt: "Jul 26, 2026",
        href: `/token/${tokenAddress}`,
        imageUrl: "https://programmable.family/token.png",
        marketCapEthWei: "1200000000000000000",
        fdvUsdWad: "3600000000000000000000",
      },
    ]);
    expect(profile.positions).toEqual([
      {
        id: poolId,
        tokenAddress,
        tokenName: "Programmable",
        tokenSymbol: "PRG",
        positionRecipient,
        positionTokenId: "42",
        lockStatus: "permanently-locked",
        href: `/token/${tokenAddress}`,
      },
    ]);
    expect(profile.claims).toEqual([
      {
        id: poolId,
        poolId,
        tokenAddress,
        hookAddress,
        tokenName: "Programmable",
        tokenSymbol: "PRG",
        claimableWei: "200000000000000000",
        claimableEth: "0.2",
        href: `/token/${tokenAddress}`,
      },
    ]);
    expect(profile.activity.map((item) => item.label)).toEqual([
      "Creator fees claimed",
      "Token launched",
    ]);
    expect(profile.activity.every((item) => item.href === `/token/${tokenAddress}`))
      .toBe(true);
  });

  it("keeps the undeployed state explicit and rejects fabricated records", () => {
    const undeployed = {
      status: "not-deployed",
      account,
      tokens: [],
      pools: [],
      claims: [],
      totals: {
        claimableWei: "0",
        claimableEth: "0",
        generatedWei: "0",
        generatedEth: "0",
        claimedWei: "0",
        claimedEth: "0",
      },
      snapshot: null,
    };

    expect(mapCreatorProfileResponse(undeployed, account)).toEqual({
      account,
      status: "not-deployed",
      tokens: [],
      positions: [],
      claims: [],
      activity: [],
      claimableWei: "0",
      claimableEth: "0",
      claimedWei: "0",
      claimedEth: "0",
    });

    expect(() =>
      mapCreatorProfileResponse(
        {
          ...profileResponse(),
          totals: {
            ...profileResponse().totals,
            claimableWei: "900000000000000000",
            claimableEth: "0.9",
          },
        },
        account,
      ),
    ).toThrow("totals do not match");
    expect(() =>
      mapCreatorProfileResponse(
        profileResponse(),
        "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      ),
    ).toThrow("does not match the connected wallet");
  });

  it("loads the account-keyed endpoint without browser caching", async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => profileResponse(),
    }));

    const profile = await fetchCreatorProfile(account, undefined, fetcher);

    expect(profile.status).toBe("ready");
    expect(fetcher).toHaveBeenCalledWith(
      `/api/explore/profile?account=${account}`,
      expect.objectContaining({
        method: "GET",
        cache: "no-store",
      }),
    );
  });
});

describe("creator claim API client", () => {
  it("accepts the exact route payload and preserves its strict wallet transaction", () => {
    const response = preparedClaimResponse();
    const prepared = validatePreparedCreatorClaim(response, {
      account,
      poolId,
      tokenAddress,
      hookAddress,
      chainId: 1,
    });

    expect(prepared.transaction).toEqual(response.transaction);
    expect(prepared.submission).toEqual({
      status: "not-submitted",
      transactionHash: null,
      receipt: null,
    });
  });

  it("rejects calldata for another pool and any claimed submission state", () => {
    const wrongCall = preparedClaimResponse();
    wrongCall.transaction.data = encodeFunctionData({
      abi: claimCreatorFeesAbi,
      functionName: "claimCreatorFees",
      args: [otherPoolId],
    });
    expect(() =>
      validatePreparedCreatorClaim(wrongCall, {
        account,
        poolId,
        tokenAddress,
        hookAddress,
        chainId: 1,
      }),
    ).toThrow("not claimCreatorFees for the selected pool");

    const falseSubmission = {
      ...preparedClaimResponse(),
      submission: {
        status: "submitted",
        transactionHash: claimTransactionHash,
        receipt: null,
      },
    };
    expect(() =>
      validatePreparedCreatorClaim(falseSubmission, {
        account,
        poolId,
        tokenAddress,
        hookAddress,
        chainId: 1,
      }),
    ).toThrow("cannot report a submitted transaction");
  });

  it("sends only account, poolId and chainId to preparation", async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => preparedClaimResponse(),
    }));

    const prepared = await prepareCreatorClaim(
      { account, poolId, tokenAddress, hookAddress, chainId: 1 },
      undefined,
      fetcher,
    );

    expect(prepared.status).toBe("ready");
    expect(fetcher).toHaveBeenCalledWith(
      "/api/explore/profile/claim",
      expect.objectContaining({
        method: "POST",
        cache: "no-store",
        body: JSON.stringify({ account, poolId, chainId: 1 }),
      }),
    );
  });
});
