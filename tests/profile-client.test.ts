import { describe, expect, it, vi } from "vitest";
import { encodeFunctionData, getAddress, parseAbi } from "viem";

import {
  prepareCreatorClaim,
  validatePreparedCreatorClaim,
} from "../lib/profile/creator-claim";
import {
  creatorProfileApiError,
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
const stockTokenAddress =
  "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const stockPositionRecipient =
  "0xcccccccccccccccccccccccccccccccccccccccc";
const stockHookAddress =
  "0xdddddddddddddddddddddddddddddddddddddddd";
const stockPoolId = `0x${"ee".repeat(32)}` as `0x${string}`;
const stockLaunchTransactionHash =
  `0x${"ff".repeat(32)}` as `0x${string}`;
const stampedTokenAddress =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const stampedHookAddress =
  "0xabababababababababababababababababababab";
const stampedPoolId = `0x${"12".repeat(32)}` as `0x${string}`;
const stampedLaunchTransactionHash =
  `0x${"13".repeat(32)}` as `0x${string}`;
const claimCreatorFeesAbi = parseAbi([
  "function claimCreatorFees(bytes32 poolId) returns (uint256 amount)",
]);

function launchStampProvenance(input: Readonly<{
  kind: "custom-graph" | "classic";
  tokenAddress: `0x${string}`;
  hookAddress: `0x${string}`;
  poolId: `0x${string}`;
  transactionHash: `0x${string}`;
}>) {
  const launchId = `0x${"15".repeat(32)}` as const;
  const stampHash = `0x${"16".repeat(32)}` as const;
  const poolManagerAddress =
    "0x000000000004444c5dc75cB358380D2e3dE08A90" as const;
  return {
    schemaVersion: "programmable.launch-stamp-provenance.v1",
    chainId: 1,
    routerAddress: "0x8622DD5bAb44185f2A458ac90384Ac99248f8d56",
    routerRuntimeCodeHash:
      "0x40e27ecf201761d5eb66bc4f2d5c6124831ef078d7baf458ca5f41b1a8108546",
    routerStartBlock: "25717612",
    finalityConfirmations: 64,
    kind: input.kind,
    launchId,
    stampHash,
    launchWallet: account,
    transactionHash: input.transactionHash,
    blockNumber: "25717620",
    blockHash: `0x${"18".repeat(32)}`,
    transactionIndex: 2,
    routeLogIndex: 8,
    launchLogIndex: 9,
    finalizedAtBlockNumber: "25717684",
    finalizedAtBlockHash: `0x${"19".repeat(32)}`,
    poolManagerAddress,
    poolId: input.poolId,
    poolKey: {
      currency0: "0x0000000000000000000000000000000000000000",
      currency1: input.tokenAddress,
      fee: 3_000,
      tickSpacing: 60,
      hooks: input.hookAddress,
    },
    poolKeyHash: `0x${"20".repeat(32)}`,
    componentSetHash: `0x${"21".repeat(32)}`,
    routePayloadHash: `0x${"22".repeat(32)}`,
    routeLauncherAddress:
      "0x1717171717171717171717171717171717171717",
    routeLauncherRuntimeCodeHash: `0x${"23".repeat(32)}`,
    expectedResultHash: `0x${"24".repeat(32)}`,
    permitDigest: `0x${"25".repeat(32)}`,
    components: [
      {
        address: input.tokenAddress,
        kind: "token",
        scope: "exclusive",
        runtimeCodeHash: `0x${"26".repeat(32)}`,
        logIndex: 6,
        exclusiveProof: { launchId, stampHash },
      },
      {
        address: input.hookAddress,
        kind: "hook",
        scope:
          input.kind === "custom-graph"
            ? "exclusive"
            : "shared-infrastructure",
        runtimeCodeHash: `0x${"27".repeat(32)}`,
        logIndex: 7,
        exclusiveProof:
          input.kind === "custom-graph" ? { launchId, stampHash } : null,
      },
    ],
    tokenProof: { tokenAddress: input.tokenAddress, launchId, stampHash },
    poolProof: {
      poolManagerAddress,
      poolId: input.poolId,
      launchId,
      stampHash,
    },
  } as const;
}

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

  it("maps an exactly bound initial buy lock into the creator profile", () => {
    const response = profileResponse();
    response.tokens[0] = {
      ...response.tokens[0],
      launchModel: "classic",
      tokenDecimals: 18,
      initialBuyEthAmountWei: "50000000000000000",
      initialBuyTokenAmountRaw: "34883942100954326694409764",
      initialBuyCustody: {
        custodyAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        mode: "fixed-lock",
        durationDays: 30,
        cliffDays: 0,
        configurationHash: `0x${"ab".repeat(32)}`,
        cliffTimestamp: "2026-08-25T12:00:00.000Z",
        releaseTimestamp: "2026-08-25T12:00:00.000Z",
      },
    } as (typeof response.tokens)[number];

    const profile = mapCreatorProfileResponse(response, account);

    expect(profile.tokens[0]?.initialBuy).toEqual({
      ethAmountWei: "50000000000000000",
      tokenAmountRaw: "34883942100954326694409764",
      tokenDecimals: 18,
      custodyAddress: getAddress(
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      ),
      custodyMode: "fixed-lock",
      durationDays: 30,
      cliffDays: 0,
      cliffAt: "2026-08-25T12:00:00.000Z",
      releaseAt: "2026-08-25T12:00:00.000Z",
    });

    const initialBuyCustody = (
      response.tokens[0] as Record<string, unknown>
    ).initialBuyCustody as Record<string, unknown>;
    response.tokens[0] = {
      ...response.tokens[0],
      initialBuyCustody: {
        ...initialBuyCustody,
        releaseTimestamp: "2026-08-26T12:00:00.000Z",
      },
    } as (typeof response.tokens)[number];
    expect(() => mapCreatorProfileResponse(response, account)).toThrow(
      "custody dates do not match",
    );
  });

  it("accepts token decimals without Classic V3 initial buy data", () => {
    const response = profileResponse();
    response.tokens[0] = {
      ...response.tokens[0],
      launchModel: "classic",
      tokenDecimals: 18,
    } as (typeof response.tokens)[number];

    const profile = mapCreatorProfileResponse(response, account);

    expect(profile.tokens[0]?.initialBuy).toBeUndefined();
  });

  it("rejects a partial initial buy payload", () => {
    const response = profileResponse();
    response.tokens[0] = {
      ...response.tokens[0],
      launchModel: "classic",
      tokenDecimals: 18,
      initialBuyEthAmountWei: "50000000000000000",
    } as (typeof response.tokens)[number];

    expect(() => mapCreatorProfileResponse(response, account)).toThrow(
      "incomplete initial buy data",
    );
  });

  it("keeps verified launches that use a model-specific reward route", () => {
    const response = profileResponse();
    const stockToken = {
      id: "1:stock-token",
      name: "Stock Paired",
      symbol: "STOCK",
      tokenAddress: stockTokenAddress,
      hookAddress: stockHookAddress,
      poolId: stockPoolId,
      creatorAddress: account,
      positionRecipient: stockPositionRecipient,
      positionTokenId: "43",
      launchTransactionHash: stockLaunchTransactionHash,
      launchLogIndex: 4,
      launchedAt: "2026-07-27T12:00:00.000Z",
      imageUrl: "https://programmable.family/stock-token.png",
      marketCapEthWei: "0",
      fdvUsdWad: "4200000000000000000000",
      totalSwapFeeBps: 100,
      liquidityPath: "meme",
      launchModel: "stock-paired",
    } as const;

    const profile = mapCreatorProfileResponse(
      {
        ...response,
        tokens: [...response.tokens, stockToken],
      },
      account,
    );

    expect(profile.tokens.map((token) => token.symbol)).toEqual([
      "PRG",
      "STOCK",
    ]);
    expect(profile.claims).toHaveLength(1);
    expect(profile.positions).toHaveLength(2);
  });

  it("keeps stamped launches visible without inferring fees or permanent positions", () => {
    const response = profileResponse();
    const customGraphToken = {
      id: "1:stamped-custom-graph",
      name: "Stamped graph",
      symbol: "GRAPH",
      tokenAddress: stampedTokenAddress,
      hookAddress: stampedHookAddress,
      poolId: stampedPoolId,
      creatorAddress: account,
      launchTransactionHash: stampedLaunchTransactionHash,
      launchLogIndex: 9,
      launchBlockNumber: "25717620",
      launchedAt: "2026-07-28T12:00:00.000Z",
      totalSwapFeeBps: null,
      launchModel: "custom-graph",
      liquidityPath: "programmable-v4",
      launchStampProvenance: launchStampProvenance({
        kind: "custom-graph",
        tokenAddress: stampedTokenAddress,
        hookAddress: stampedHookAddress,
        poolId: stampedPoolId,
        transactionHash: stampedLaunchTransactionHash,
      }),
    } as const;
    const routerClassicToken = {
      ...customGraphToken,
      id: "1:stamped-classic",
      name: "Stamped Classic",
      symbol: "STAMP",
      tokenAddress:
        "0xacacacacacacacacacacacacacacacacacacacac",
      poolId: `0x${"14".repeat(32)}`,
      positionRecipient,
      positionTokenId: "77",
      totalSwapFeeBps: 100,
      launchModel: "classic",
      launchStampProvenance: launchStampProvenance({
        kind: "classic",
        tokenAddress:
          "0xacacacacacacacacacacacacacacacacacacacac",
        hookAddress: stampedHookAddress,
        poolId: `0x${"14".repeat(32)}`,
        transactionHash: stampedLaunchTransactionHash,
      }),
    } as const;

    const profile = mapCreatorProfileResponse(
      {
        ...response,
        tokens: [
          ...response.tokens,
          customGraphToken,
          routerClassicToken,
        ],
      },
      account,
    );

    expect(profile.tokens.map((token) => token.symbol)).toEqual([
      "PRG",
      "GRAPH",
      "STAMP",
    ]);
    expect(profile.tokens[1]).toMatchObject({
      address: getAddress(stampedTokenAddress),
      launchModel: "custom-graph",
      launchProvenance: "canonical-router",
    });
    expect(profile.positions).toHaveLength(1);
    expect(profile.positions[0]?.tokenAddress).toBe(tokenAddress);
    expect(profile.claims).toHaveLength(1);
    expect(profile.claimableWei).toBe("200000000000000000");
    expect(profile.claimedWei).toBe("300000000000000000");
  });

  it("returns a connected launchWallet Router token with no reward or position state", () => {
    const response = profileResponse();
    const customGraphToken = {
      id: "1:stamped-custom-graph-only",
      name: "Custom Graph",
      symbol: "GRAPH",
      tokenAddress: stampedTokenAddress,
      hookAddress: stampedHookAddress,
      poolId: stampedPoolId,
      creatorAddress: account,
      launchTransactionHash: stampedLaunchTransactionHash,
      launchLogIndex: 9,
      launchBlockNumber: "25717620",
      launchedAt: "2026-07-28T12:00:00.000Z",
      totalSwapFeeBps: null,
      launchModel: "custom-graph",
      liquidityPath: "programmable-v4",
      launchStampProvenance: launchStampProvenance({
        kind: "custom-graph",
        tokenAddress: stampedTokenAddress,
        hookAddress: stampedHookAddress,
        poolId: stampedPoolId,
        transactionHash: stampedLaunchTransactionHash,
      }),
    } as const;
    const profile = mapCreatorProfileResponse(
      {
        ...response,
        tokens: [customGraphToken],
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
      },
      account,
    );

    expect(profile.account).toBe(getAddress(account));
    expect(profile.tokens).toEqual([
      expect.objectContaining({
        address: getAddress(stampedTokenAddress),
        name: "Custom Graph",
        symbol: "GRAPH",
        launchModel: "custom-graph",
        launchProvenance: "canonical-router",
      }),
    ]);
    expect(profile.positions).toEqual([]);
    expect(profile.claims).toEqual([]);
    expect(profile.claimableWei).toBe("0");
    expect(profile.claimedWei).toBe("0");
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

    const partialStamp = profileResponse();
    partialStamp.tokens[0] = {
      ...partialStamp.tokens[0],
      launchStampProvenance: {
        schemaVersion: "programmable.launch-stamp-provenance.v1",
        kind: "custom-graph",
      },
    } as (typeof partialStamp.tokens)[number];
    expect(() => mapCreatorProfileResponse(partialStamp, account)).toThrow(
      "Invalid launch stamp provenance",
    );
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

  it("keeps a typed creator accounting conflict non-temporary", async () => {
    const fetcher = vi.fn(async () => ({
      ok: false,
      status: 409,
      json: async () => creatorProfileApiError("integrity"),
    }));

    await expect(
      fetchCreatorProfile(account, undefined, fetcher),
    ).rejects.toMatchObject({
      name: "ProfileResponseError",
      kind: "integrity",
      message: "Current creator reward data could not be verified",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("classifies a transport failure as temporary without exposing it", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("RPC https://provider.example/secret failed");
    });

    const failure = await fetchCreatorProfile(
      account,
      undefined,
      fetcher,
    ).catch((caught: unknown) => caught);

    expect(failure).toMatchObject({
      name: "ProfileResponseError",
      kind: "temporary",
      message: "Onchain creator data is temporarily unavailable",
    });
    expect(String(failure)).not.toContain("provider.example");
    expect(fetcher).toHaveBeenCalledTimes(1);
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
