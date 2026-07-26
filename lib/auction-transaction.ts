import {
  buildLaunchTransactions,
  buildLpAllocationSchedule,
  buildPositionDefinitions,
  computeInitializerSalt,
  computeLbpPoolId,
  deriveAuctionPricing,
  deriveConvexAuctionSteps,
  encodeAuctionParams,
  encodeAuctionSteps,
  encodeConfigData,
  encodeLpAllocationSchedule,
  encodePositionDefinitions,
  encodeTokenData,
  FUNDS_RECIPIENT_SENTINEL,
  getLauncherAddresses,
  Q96,
  requiredCurrencyRaised,
  selectTokenFactory,
  ZERO_ADDRESS,
  type AuctionParameters,
  type AuctionStepInput,
  type LauncherAddresses,
  type MigratorParameters,
  type PredictTokenParams,
  type TransactionRequest,
} from "@uniswap/liquidity-launcher-sdk";
import {
  encodeAbiParameters,
  isAddress,
  isHex,
  keccak256,
  parseAbiParameters,
  type Address,
  type Hex,
} from "viem";

import type { LaunchDraft } from "./launch";
import {
  LaunchInputError,
  parseDecimalAmount,
} from "./launch-transaction";

export const STANDARD_AUCTION_SALE_PERCENT = "50";
export const STANDARD_AUCTION_PROCEEDS_TO_LP_PERCENT = "100";
export const STANDARD_AUCTION_START_DELAY_BLOCKS = 100n;
export const STANDARD_AUCTION_DURATION_BLOCKS = 1_200n;
export const STANDARD_AUCTION_MIN_PREP_BLOCKS = 20n;
export const STANDARD_AUCTION_LP_FEE = 3_000;
export const UNISWAP_V4_DYNAMIC_FEE_FLAG = 8_388_608;
export const STANDARD_AUCTION_POOL_TICK_SPACING = 60;
export const STANDARD_AUCTION_TOKEN_DECIMALS = 18;
export const STANDARD_AUCTION_STEP_COUNT = 12;
export const STANDARD_AUCTION_FINAL_BLOCK_PERCENT = 0.3;
export const STANDARD_AUCTION_CONVEXITY_ALPHA = 1.2;
export const MIN_CCA_FLOOR_PRICE_X96 = (1n << 32n) + 1n;
export const MAX_CCA_AUCTION_SUPPLY = 1n << 100n;

const UINT64_MAX = (1n << 64n) - 1n;
const UINT128_MAX = (1n << 128n) - 1n;
const INT128_MAX = (1n << 127n) - 1n;
const MAX_V4_PRICE = (1n << 160n) - 1n;
const LOWER_TOTAL_SUPPLY_THRESHOLD = 1n << 62n;
const POSITION_SALT_DOMAIN = keccak256(
  new TextEncoder().encode("launcher.position-fee-forwarder.v1"),
);

export type StandardAuctionSchedule = {
  startBlock: bigint;
  endBlock: bigint;
  claimBlock: bigint;
  migrationBlock: bigint;
};

export type StandardAuctionScheduleResolution = {
  schedule: StandardAuctionSchedule;
  draftPatch?: Pick<
    LaunchDraft,
    | "auctionStartBlock"
    | "auctionEndBlock"
    | "auctionClaimBlock"
    | "auctionMigrationBlock"
  >;
};

export type StandardAuctionAddresses = {
  liquidityLauncher: Address;
  lbpStrategy: Address;
  uerc20Factory: Address;
};

export type StandardAuctionPlan = {
  totalSupply: bigint;
  auctionSupply: bigint;
  reservedTokenAmountForLP: bigint;
  requestedFloorValuationWei: bigint;
  floorPriceX96: bigint;
  auctionTickSpacing: bigint;
  requiredCurrencyRaised: bigint;
  poolFee: number;
  schedule: StandardAuctionSchedule;
  steps: AuctionStepInput[];
  auctionParameters: AuctionParameters;
  auctionParametersData: Hex;
  migratorParameters: MigratorParameters;
  configData: Hex;
  initializerSalt: Hex;
  poolId: Hex;
  transaction: TransactionRequest;
};

export type StandardAuctionEconomics = Pick<
  StandardAuctionPlan,
  | "totalSupply"
  | "auctionSupply"
  | "reservedTokenAmountForLP"
  | "requestedFloorValuationWei"
  | "floorPriceX96"
  | "auctionTickSpacing"
  | "requiredCurrencyRaised"
  | "schedule"
  | "steps"
>;

function parseCanonicalPercentage(
  value: string,
  expectedHundredths: bigint,
  label: string,
) {
  const parsed = parseDecimalAmount(value, 2, label);
  if (parsed !== expectedHundredths) {
    throw new LaunchInputError(
      `The standard auction fixes ${label} at ${Number(expectedHundredths) / 100}%`,
    );
  }
}

function parseBlock(value: string, label: string) {
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw new LaunchInputError(`The ${label} is not valid`);
  }
  const block = BigInt(value);
  if (block > UINT64_MAX) {
    throw new LaunchInputError(`The ${label} exceeds the contract limit`);
  }
  return block;
}

function createSchedule(startBlock: bigint): StandardAuctionSchedule {
  const endBlock = startBlock + STANDARD_AUCTION_DURATION_BLOCKS;
  const schedule = {
    startBlock,
    endBlock,
    claimBlock: endBlock,
    migrationBlock: endBlock + 1n,
  };
  if (schedule.migrationBlock > UINT64_MAX) {
    throw new LaunchInputError("The auction schedule exceeds the contract limit");
  }
  return schedule;
}

function schedulePatch(
  schedule: StandardAuctionSchedule,
): StandardAuctionScheduleResolution["draftPatch"] {
  return {
    auctionStartBlock: schedule.startBlock.toString(),
    auctionEndBlock: schedule.endBlock.toString(),
    auctionClaimBlock: schedule.claimBlock.toString(),
    auctionMigrationBlock: schedule.migrationBlock.toString(),
  };
}

export function resolveStandardAuctionSchedule(
  draft: LaunchDraft,
  currentBlock: bigint,
): StandardAuctionScheduleResolution {
  if (currentBlock < 0n || currentBlock > UINT64_MAX) {
    throw new LaunchInputError("The current Ethereum block is not valid");
  }

  const values = [
    draft.auctionStartBlock,
    draft.auctionEndBlock,
    draft.auctionClaimBlock,
    draft.auctionMigrationBlock,
  ];
  const populated = values.filter((value) => value.length > 0).length;

  if (populated === 0) {
    const schedule = createSchedule(
      currentBlock + STANDARD_AUCTION_START_DELAY_BLOCKS,
    );
    return { schedule, draftPatch: schedulePatch(schedule) };
  }
  if (populated !== values.length) {
    throw new LaunchInputError("The auction schedule is incomplete");
  }

  const schedule = {
    startBlock: parseBlock(draft.auctionStartBlock, "auction start block"),
    endBlock: parseBlock(draft.auctionEndBlock, "auction end block"),
    claimBlock: parseBlock(draft.auctionClaimBlock, "auction claim block"),
    migrationBlock: parseBlock(
      draft.auctionMigrationBlock,
      "auction migration block",
    ),
  };

  if (
    schedule.endBlock - schedule.startBlock !==
      STANDARD_AUCTION_DURATION_BLOCKS ||
    schedule.claimBlock !== schedule.endBlock ||
    schedule.migrationBlock !== schedule.endBlock + 1n
  ) {
    throw new LaunchInputError(
      "The standard auction schedule does not match the fixed four-hour launch",
    );
  }

  if (
    schedule.startBlock <
    currentBlock + STANDARD_AUCTION_MIN_PREP_BLOCKS
  ) {
    const refreshed = createSchedule(
      currentBlock + STANDARD_AUCTION_START_DELAY_BLOCKS,
    );
    return { schedule: refreshed, draftPatch: schedulePatch(refreshed) };
  }

  return { schedule };
}

export function getOfficialEthereumAuctionAddresses():
  | StandardAuctionAddresses
  | undefined {
  const addresses = getLauncherAddresses(1);
  if (!addresses) return undefined;
  const tokenFactory = selectTokenFactory(addresses);
  if (!tokenFactory || tokenFactory.kind !== "uerc20") return undefined;
  return {
    liquidityLauncher: addresses.liquidityLauncher,
    lbpStrategy: addresses.lbpStrategy,
    uerc20Factory: tokenFactory.factory,
  };
}

export function buildStandardAuctionTokenPredictionParams(
  draft: LaunchDraft,
  account: Address,
  addresses: StandardAuctionAddresses,
): PredictTokenParams {
  return {
    factory: addresses.uerc20Factory,
    kind: "uerc20",
    launcherAddress: addresses.liquidityLauncher,
    wallet: account,
    name: draft.tokenName.trim(),
    symbol: draft.tokenSymbol.trim(),
    decimals: STANDARD_AUCTION_TOKEN_DECIMALS,
    homeChainId: 1n,
  };
}

export function derivePositionForwarderSalt(
  account: Address,
  token: Address,
  launchSalt: Hex,
) {
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters("address account, address token, bytes32 launchSalt, bytes32 domain"),
      [account, token, launchSalt, POSITION_SALT_DOMAIN],
    ),
  );
}

function maxBidPrice(totalSupply: bigint) {
  if (totalSupply <= LOWER_TOTAL_SUPPLY_THRESHOLD) {
    return MAX_V4_PRICE;
  }
  const maxForLiquidity = ((1n << 154n) / totalSupply) ** 2n;
  const maxForCurrency = (1n << 222n) / totalSupply;
  return maxForLiquidity < maxForCurrency
    ? maxForLiquidity
    : maxForCurrency;
}

export function validateStandardAuctionDraft(draft: LaunchDraft) {
  if (draft.liquidityMode !== "auction") {
    throw new LaunchInputError("Choose the auction launch type");
  }
  if (draft.assetMode !== "new") {
    throw new LaunchInputError(
      "The standard auction creates a new fixed supply token",
    );
  }
  if (
    draft.selectedBehaviors.length !== 1 ||
    !["fixed-fee", "dynamic-fee"].includes(
      draft.selectedBehaviors[0],
    )
  ) {
    throw new LaunchInputError(
      "This behavior needs contract review before an auction can be prepared",
    );
  }
  parseCanonicalPercentage(
    draft.auctionSalePercent,
    5_000n,
    "the auction allocation",
  );
  parseCanonicalPercentage(
    draft.auctionLiquidityPercent,
    10_000n,
    "the proceeds allocated to liquidity",
  );
  if (draft.selectedBehaviors[0] === "fixed-fee") {
    parseCanonicalPercentage(draft.lpFeePercent, 30n, "the pool fee");
  }

  if (!draft.tokenName.trim()) {
    throw new LaunchInputError("Enter a token name");
  }
  if (!draft.tokenSymbol.trim()) {
    throw new LaunchInputError("Enter a token symbol");
  }
  if (draft.tokenName.trim().length > 80) {
    throw new LaunchInputError("The token name is too long");
  }
  if (draft.tokenSymbol.trim().length > 16) {
    throw new LaunchInputError("The token symbol is too long");
  }
  if (draft.tokenDescription.trim().length > 1_000) {
    throw new LaunchInputError("The token description is too long");
  }
}

export function getStandardAuctionPoolFee(draft: LaunchDraft) {
  validateStandardAuctionDraft(draft);
  return draft.selectedBehaviors[0] === "dynamic-fee"
    ? UNISWAP_V4_DYNAMIC_FEE_FLAG
    : STANDARD_AUCTION_LP_FEE;
}

function callSdk<T>(callback: () => T): T {
  try {
    return callback();
  } catch (caught) {
    throw new LaunchInputError(
      caught instanceof Error
        ? caught.message
        : "The official auction configuration is not valid",
    );
  }
}

export function buildStandardAuctionEconomics(
  draft: LaunchDraft,
): StandardAuctionEconomics {
  validateStandardAuctionDraft(draft);

  const schedule = {
    startBlock: parseBlock(draft.auctionStartBlock, "auction start block"),
    endBlock: parseBlock(draft.auctionEndBlock, "auction end block"),
    claimBlock: parseBlock(draft.auctionClaimBlock, "auction claim block"),
    migrationBlock: parseBlock(
      draft.auctionMigrationBlock,
      "auction migration block",
    ),
  };
  if (
    schedule.endBlock - schedule.startBlock !==
      STANDARD_AUCTION_DURATION_BLOCKS ||
    schedule.claimBlock !== schedule.endBlock ||
    schedule.migrationBlock !== schedule.endBlock + 1n
  ) {
    throw new LaunchInputError("The auction schedule is not canonical");
  }

  const totalSupply = parseDecimalAmount(
    draft.tokenSupply,
    STANDARD_AUCTION_TOKEN_DECIMALS,
    "a token supply",
  );
  if (totalSupply > UINT128_MAX) {
    throw new LaunchInputError(
      "The token supply exceeds the LiquidityLauncher limit",
    );
  }
  if (totalSupply % 2n !== 0n) {
    throw new LaunchInputError(
      "The token supply cannot be divided into the fixed 50/50 allocation",
    );
  }

  const auctionSupply = totalSupply / 2n;
  const reservedTokenAmountForLP = totalSupply / 2n;
  if (auctionSupply > MAX_CCA_AUCTION_SUPPLY) {
    throw new LaunchInputError(
      "The auction supply exceeds the Continuous Clearing Auction limit",
    );
  }
  if (
    reservedTokenAmountForLP === 0n ||
    reservedTokenAmountForLP > INT128_MAX
  ) {
    throw new LaunchInputError(
      "The liquidity reserve exceeds the Uniswap v4 migration limit",
    );
  }

  const requestedFloorValuationWei = parseDecimalAmount(
    draft.auctionFloorValuationEth,
    18,
    "a minimum valuation",
  );
  const rawFloorPriceX96 =
    (requestedFloorValuationWei * Q96) / totalSupply;
  const pricing = callSdk(() =>
    deriveAuctionPricing(rawFloorPriceX96),
  );
  if (pricing.floorPriceX96 < MIN_CCA_FLOOR_PRICE_X96) {
    throw new LaunchInputError(
      "The minimum valuation is below the auction price range",
    );
  }

  const maximumBidPrice = maxBidPrice(auctionSupply);
  if (
    pricing.tickSpacing < 2n ||
    pricing.floorPriceX96 >
      maximumBidPrice - pricing.tickSpacing
  ) {
    throw new LaunchInputError(
      "The minimum valuation is above the auction price range",
    );
  }

  const graduationAmount = callSdk(() =>
    requiredCurrencyRaised(pricing.floorPriceX96, auctionSupply),
  );
  if (graduationAmount === 0n || graduationAmount > UINT128_MAX) {
    throw new LaunchInputError(
      "The minimum raise falls outside the auction contract limit",
    );
  }

  const steps = callSdk(() =>
    deriveConvexAuctionSteps(schedule.startBlock, schedule.endBlock, {
      numSteps: STANDARD_AUCTION_STEP_COUNT,
      finalBlockPct: STANDARD_AUCTION_FINAL_BLOCK_PERCENT,
      alpha: STANDARD_AUCTION_CONVEXITY_ALPHA,
    }),
  );

  return {
    totalSupply,
    auctionSupply,
    reservedTokenAmountForLP,
    requestedFloorValuationWei,
    floorPriceX96: pricing.floorPriceX96,
    auctionTickSpacing: pricing.tickSpacing,
    requiredCurrencyRaised: graduationAmount,
    schedule,
    steps,
  };
}

export function buildStandardAuctionPlan({
  draft,
  account,
  predictedToken,
  hook,
  positionRecipient,
  addresses,
}: {
  draft: LaunchDraft;
  account: Address;
  predictedToken: Address;
  hook: Address;
  positionRecipient: Address;
  addresses: StandardAuctionAddresses;
}): StandardAuctionPlan {
  if (
    !isAddress(account) ||
    !isAddress(predictedToken) ||
    !isAddress(hook) ||
    !isAddress(positionRecipient)
  ) {
    throw new LaunchInputError("The auction contains an invalid address");
  }
  if (
    !isHex(draft.launchSalt, { strict: true }) ||
    draft.launchSalt.length !== 66
  ) {
    throw new LaunchInputError("The launch identifier is not valid");
  }

  const economics = buildStandardAuctionEconomics(draft);
  const poolFee = getStandardAuctionPoolFee(draft);
  const {
    totalSupply,
    auctionSupply,
    reservedTokenAmountForLP,
    requestedFloorValuationWei,
    floorPriceX96,
    auctionTickSpacing,
    requiredCurrencyRaised: graduationAmount,
    schedule,
    steps,
  } = economics;
  const auctionParameters: AuctionParameters = {
    currency: ZERO_ADDRESS,
    tokensRecipient: account,
    fundsRecipient: FUNDS_RECIPIENT_SENTINEL,
    startBlock: schedule.startBlock,
    endBlock: schedule.endBlock,
    claimBlock: schedule.claimBlock,
    tickSpacing: auctionTickSpacing,
    validationHook: ZERO_ADDRESS,
    floorPrice: floorPriceX96,
    requiredCurrencyRaised: graduationAmount,
    auctionStepsData: callSdk(() => encodeAuctionSteps(steps)),
  };
  const auctionParametersData = callSdk(() =>
    encodeAuctionParams(auctionParameters),
  );

  const positionDefinitions = callSdk(() =>
    buildPositionDefinitions(
      "FULL_RANGE",
      [],
      STANDARD_AUCTION_POOL_TICK_SPACING,
      ZERO_ADDRESS,
      predictedToken,
    ),
  );
  const allocationSchedule = callSdk(() =>
    buildLpAllocationSchedule({ kind: "single", percent: 100 }),
  );
  const migratorParameters: MigratorParameters = {
    token: predictedToken,
    currency: ZERO_ADDRESS,
    migrationBlock: schedule.migrationBlock,
    reservedTokenAmountForLP,
    recipient: account,
    positionRecipient,
    poolParameters: {
      fee: poolFee,
      tickSpacing: STANDARD_AUCTION_POOL_TICK_SPACING,
      hook,
    },
    positionDefinitions: callSdk(() =>
      encodePositionDefinitions(positionDefinitions),
    ),
    lpAllocationSchedule: callSdk(() =>
      encodeLpAllocationSchedule(allocationSchedule),
    ),
  };
  const configData = callSdk(() =>
    encodeConfigData(migratorParameters, auctionParametersData),
  );
  const initializerSalt = callSdk(() =>
    computeInitializerSalt(
      account,
      draft.launchSalt as Hex,
      migratorParameters,
    ),
  );
  const transactions = callSdk(() =>
    buildLaunchTransactions({
      liquidityLauncher: addresses.liquidityLauncher,
      token: predictedToken,
      salt: draft.launchSalt as Hex,
      acquire: {
        kind: "create",
        args: {
          factory: addresses.uerc20Factory,
          name: draft.tokenName.trim(),
          symbol: draft.tokenSymbol.trim(),
          decimals: STANDARD_AUCTION_TOKEN_DECIMALS,
          initialSupply: totalSupply,
          recipient: addresses.liquidityLauncher,
          tokenData: encodeTokenData({
            description: draft.tokenDescription.trim(),
            website: "",
            image: "",
            extraData: "0x",
          }),
        },
      },
      distributions: [
        {
          strategy: addresses.lbpStrategy,
          amount: totalSupply,
          configData,
        },
      ],
    }),
  );
  if (transactions.length !== 1) {
    throw new LaunchInputError(
      "The new-token auction must resolve to one atomic launch transaction",
    );
  }

  return {
    totalSupply,
    auctionSupply,
    reservedTokenAmountForLP,
    requestedFloorValuationWei,
    floorPriceX96,
    auctionTickSpacing,
    requiredCurrencyRaised: graduationAmount,
    poolFee,
    schedule,
    steps,
    auctionParameters,
    auctionParametersData,
    migratorParameters,
    configData,
    initializerSalt,
    poolId: computeLbpPoolId(
      ZERO_ADDRESS,
      predictedToken,
      poolFee,
      STANDARD_AUCTION_POOL_TICK_SPACING,
      hook,
    ),
    transaction: transactions[0],
  };
}

export function isSameOfficialAuctionStack(
  sdk: StandardAuctionAddresses,
  snapshot: {
    liquidityLauncher: Address;
    lbpStrategy: Address;
    uerc20Factory: Address;
  },
) {
  return (
    sdk.liquidityLauncher.toLowerCase() ===
      snapshot.liquidityLauncher.toLowerCase() &&
    sdk.lbpStrategy.toLowerCase() === snapshot.lbpStrategy.toLowerCase() &&
    sdk.uerc20Factory.toLowerCase() ===
      snapshot.uerc20Factory.toLowerCase()
  );
}

export function toStandardAuctionAddresses(
  addresses: LauncherAddresses,
): StandardAuctionAddresses {
  const tokenFactory = selectTokenFactory(addresses);
  if (!tokenFactory || tokenFactory.kind !== "uerc20") {
    throw new LaunchInputError(
      "The official Ethereum UERC20 factory is unavailable",
    );
  }
  return {
    liquidityLauncher: addresses.liquidityLauncher,
    lbpStrategy: addresses.lbpStrategy,
    uerc20Factory: tokenFactory.factory,
  };
}
