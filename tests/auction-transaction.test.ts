import {
  LIQUIDITY_LAUNCHER_ABI,
  MPS_TOTAL,
  Q96,
  ZERO_ADDRESS,
} from "@uniswap/liquidity-launcher-sdk";
import { decodeFunctionData, type Hex } from "viem";
import { describe, expect, it } from "vitest";

import {
  buildStandardAuctionPlan,
  derivePositionForwarderSalt,
  getOfficialEthereumAuctionAddresses,
  MAX_CCA_AUCTION_SUPPLY,
  resolveStandardAuctionSchedule,
  STANDARD_AUCTION_DURATION_BLOCKS,
  STANDARD_AUCTION_LP_FEE,
  STANDARD_AUCTION_POOL_TICK_SPACING,
  STANDARD_AUCTION_START_DELAY_BLOCKS,
} from "../lib/auction-transaction";
import { createEmptyDraft } from "../lib/launch";

const account =
  "0x1111111111111111111111111111111111111111" as const;
const predictedToken =
  "0x2222222222222222222222222222222222222222" as const;
const hook =
  "0x3333333333333333333333333333333333336044" as const;
const positionRecipient =
  "0x4444444444444444444444444444444444444444" as const;
const launchSalt =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;

function auctionDraft() {
  return {
    ...createEmptyDraft(),
    tokenName: "Auction Token",
    tokenSymbol: "AUCTION",
    tokenDescription: "A fixed supply auction launch",
    tokenSupply: "1000000000",
    auctionFloorValuationEth: "10",
    auctionStartBlock: "1100",
    auctionEndBlock: "2300",
    auctionClaimBlock: "2300",
    auctionMigrationBlock: "2301",
    launchSalt,
  };
}

describe("standard auction schedule", () => {
  it("creates a reusable four-hour mainnet schedule", () => {
    const draft = createEmptyDraft();
    const result = resolveStandardAuctionSchedule(draft, 1_000n);

    expect(result.schedule.startBlock).toBe(
      1_000n + STANDARD_AUCTION_START_DELAY_BLOCKS,
    );
    expect(
      result.schedule.endBlock - result.schedule.startBlock,
    ).toBe(STANDARD_AUCTION_DURATION_BLOCKS);
    expect(result.schedule.claimBlock).toBe(result.schedule.endBlock);
    expect(result.schedule.migrationBlock).toBe(
      result.schedule.endBlock + 1n,
    );
    expect(result.draftPatch).toEqual({
      auctionStartBlock: "1100",
      auctionEndBlock: "2300",
      auctionClaimBlock: "2300",
      auctionMigrationBlock: "2301",
    });
  });

  it("keeps a valid future schedule stable and refreshes a stale one", () => {
    const draft = auctionDraft();
    expect(resolveStandardAuctionSchedule(draft, 1_010n).draftPatch).toBe(
      undefined,
    );

    const refreshed = resolveStandardAuctionSchedule(draft, 1_090n);
    expect(refreshed.draftPatch?.auctionStartBlock).toBe("1190");
    expect(refreshed.schedule.endBlock).toBe(2_390n);
  });
});

describe("standard auction calldata", () => {
  it("uses the current official Ethereum launcher stack", () => {
    expect(getOfficialEthereumAuctionAddresses()).toEqual({
      liquidityLauncher: "0x00004c4ccc709Ef590F7C81102C0689F0263D4e9",
      lbpStrategy: "0x49380c4EfaB1b491006aF7FabAB8B3459F0E6000",
      uerc20Factory: "0x000000e200088D55C39a11F609E5F667729ad49b",
    });
  });

  it("builds one atomic official launch with the fixed 50/50 policy", () => {
    const addresses = getOfficialEthereumAuctionAddresses();
    expect(addresses).toBeDefined();
    const plan = buildStandardAuctionPlan({
      draft: auctionDraft(),
      account,
      predictedToken,
      hook,
      positionRecipient,
      addresses: addresses!,
    });

    expect(plan.totalSupply).toBe(1_000_000_000n * 10n ** 18n);
    expect(plan.auctionSupply).toBe(plan.totalSupply / 2n);
    expect(plan.reservedTokenAmountForLP).toBe(plan.totalSupply / 2n);
    expect(plan.auctionSupply).toBeLessThan(MAX_CCA_AUCTION_SUPPLY);
    expect(plan.requiredCurrencyRaised).toBeLessThanOrEqual(
      5n * 10n ** 18n,
    );
    expect(plan.requiredCurrencyRaised).toBeGreaterThan(
      4_900_000_000_000_000_000n,
    );
    expect(plan.floorPriceX96).toBe(792_281_625_142_643_375_900n);
    expect(plan.auctionTickSpacing).toBe(
      7_922_816_251_426_433_759n,
    );
    expect(plan.requiredCurrencyRaised).toBe(
      4_999_999_999_999_999_999n,
    );
    expect(plan.auctionParameters.auctionStepsData).toBe(
      "0x000f17000000009700135000000000760014e8000000006d001657000000006600174000000000620017fc000000005f0018c5000000005c001951000000005a0019e50000000058001a310000000057001acf0000000055001b2000000000542dc6b90000000001",
    );
    expect(plan.floorPriceX96).toBeLessThanOrEqual(
      (10n * 10n ** 18n * Q96) / plan.totalSupply,
    );
    expect(plan.auctionParameters.tokensRecipient).toBe(account);
    expect(plan.auctionParameters.currency).toBe(ZERO_ADDRESS);
    expect(plan.migratorParameters.recipient).toBe(account);
    expect(plan.migratorParameters.positionRecipient).toBe(
      positionRecipient,
    );
    expect(plan.migratorParameters.poolParameters).toEqual({
      fee: STANDARD_AUCTION_LP_FEE,
      tickSpacing: STANDARD_AUCTION_POOL_TICK_SPACING,
      hook,
    });

    const emittedMps = plan.steps.reduce(
      (sum, step) =>
        sum +
        step.mps * Number(step.endBlock - step.startBlock),
      0,
    );
    expect(emittedMps).toBe(MPS_TOTAL);
    expect(plan.steps.at(-1)?.endBlock).toBe(plan.schedule.endBlock);

    const decoded = decodeFunctionData({
      abi: LIQUIDITY_LAUNCHER_ABI,
      data: plan.transaction.data,
    });
    expect(decoded.functionName).toBe("multicall");
    expect(decoded.args?.[0]).toHaveLength(2);

    const createCall = decodeFunctionData({
      abi: LIQUIDITY_LAUNCHER_ABI,
      data: decoded.args![0][0] as Hex,
    });
    expect(createCall.functionName).toBe("createToken");
    expect(createCall.args?.[0]).toBe(addresses!.uerc20Factory);
    expect(createCall.args?.[1]).toBe("Auction Token");
    expect(createCall.args?.[2]).toBe("AUCTION");
    expect(createCall.args?.[4]).toBe(plan.totalSupply);
    expect(createCall.args?.[5]).toBe(addresses!.liquidityLauncher);

    const distributeCall = decodeFunctionData({
      abi: LIQUIDITY_LAUNCHER_ABI,
      data: decoded.args![0][1] as Hex,
    });
    expect(distributeCall.functionName).toBe("distributeToken");
    expect(distributeCall.args?.[0]).toBe(predictedToken);
    expect(distributeCall.args?.[1]).toMatchObject({
      strategy: addresses!.lbpStrategy,
      amount: plan.totalSupply,
      configData: plan.configData,
    });
    expect(distributeCall.args?.[2]).toBe(launchSalt);
  });

  it("derives a deterministic, launch-specific LP lock salt", () => {
    const salt = derivePositionForwarderSalt(
      account,
      predictedToken,
      launchSalt,
    );
    expect(salt).toMatch(/^0x[0-9a-f]{64}$/);
    expect(
      derivePositionForwarderSalt(account, predictedToken, launchSalt),
    ).toBe(salt);
    expect(
      derivePositionForwarderSalt(
        account,
        "0x5555555555555555555555555555555555555555",
        launchSalt,
      ),
    ).not.toBe(salt);
  });

  it("rejects a policy change disguised as a standard auction", () => {
    const addresses = getOfficialEthereumAuctionAddresses()!;
    expect(() =>
      buildStandardAuctionPlan({
        draft: { ...auctionDraft(), auctionSalePercent: "51" },
        account,
        predictedToken,
        hook,
        positionRecipient,
        addresses,
      }),
    ).toThrow("fixes the auction allocation at 50%");
  });
});
