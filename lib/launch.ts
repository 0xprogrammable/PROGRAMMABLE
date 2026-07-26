export const PLATFORM_FEE_BPS = 10;
export const LAUNCH_DRAFT_STORAGE_KEY = "launcher.launch-draft.v1";

export type AssetMode = "new" | "existing";
export type LiquidityMode = "auction" | "direct";
export type BehaviorTier = "standard" | "review" | "custom";

export type BehaviorId =
  | "fixed-fee"
  | "fee-split"
  | "timed-opening"
  | "nft-membership"
  | "dynamic-fee"
  | "buyback"
  | "holder-rewards"
  | "oracle-guard"
  | "anti-sandwich"
  | "limit-orders"
  | "productive-liquidity"
  | "custom-curve"
  | "custom-hook";

export type BehaviorDefinition = {
  id: BehaviorId;
  name: string;
  description: string;
  tier: BehaviorTier;
};

export const behaviorDefinitions: BehaviorDefinition[] = [
  {
    id: "fixed-fee",
    name: "Fixed swap fee",
    description:
      "The pool uses one fee rate that does not change with activity",
    tier: "standard",
  },
  {
    id: "fee-split",
    name: "Fee split",
    description:
      "Route a defined share of swap fees between liquidity and named recipients",
    tier: "review",
  },
  {
    id: "timed-opening",
    name: "Timed opening",
    description:
      "Open trading for everyone at the same stated time without sell rules tied to individual addresses",
    tier: "review",
  },
  {
    id: "nft-membership",
    name: "NFT membership",
    description:
      "Use NFT ownership for fee benefits without removing a holder's ability to sell",
    tier: "review",
  },
  {
    id: "dynamic-fee",
    name: "Dynamic fees",
    description:
      "Let the swap fee follow a bounded rule based on pool activity",
    tier: "review",
  },
  {
    id: "buyback",
    name: "Automated buyback",
    description:
      "Use a defined share of collected fees to buy the launched token within explicit limits",
    tier: "review",
  },
  {
    id: "holder-rewards",
    name: "Holder rewards",
    description:
      "Fund holder claims from swap fees without adding a transfer tax",
    tier: "review",
  },
  {
    id: "oracle-guard",
    name: "Oracle guard",
    description:
      "Check swaps against an external price reference and bounded deviation rules",
    tier: "review",
  },
  {
    id: "anti-sandwich",
    name: "Sandwich protection",
    description:
      "Use delayed or reordered settlement to reduce common sandwich patterns",
    tier: "review",
  },
  {
    id: "limit-orders",
    name: "Limit orders",
    description:
      "Represent orders as liquidity that executes at a stated price",
    tier: "review",
  },
  {
    id: "productive-liquidity",
    name: "Productive liquidity",
    description:
      "Put idle pool assets into a separate strategy with explicit withdrawal and loss rules",
    tier: "review",
  },
  {
    id: "custom-curve",
    name: "Custom pricing curve",
    description:
      "Replace concentrated liquidity pricing with a reviewed accounting model",
    tier: "review",
  },
  {
    id: "custom-hook",
    name: "Custom hook",
    description:
      "Submit one complete hook implementation for compatibility and security review",
    tier: "custom",
  },
];

export type LaunchDraft = {
  version: 1;
  assetMode: AssetMode;
  tokenName: string;
  tokenSymbol: string;
  tokenSupply: string;
  tokenDescription: string;
  tokenAddress: string;
  existingTokenName: string;
  existingTokenSymbol: string;
  existingTokenSupply: string;
  liquidityMode: LiquidityMode;
  auctionSalePercent: string;
  auctionLiquidityPercent: string;
  auctionFloorValuationEth: string;
  auctionStartBlock: string;
  auctionEndBlock: string;
  auctionClaimBlock: string;
  auctionMigrationBlock: string;
  directEthAmount: string;
  directTokenAmount: string;
  directTokensPerEth: string;
  selectedBehaviors: BehaviorId[];
  lpFeePercent: string;
  customHookAddress: string;
  customHookSource: string;
  launchSalt: string;
  updatedAt: string;
};

export function createEmptyDraft(): LaunchDraft {
  return {
    version: 1,
    assetMode: "new",
    tokenName: "",
    tokenSymbol: "",
    tokenSupply: "1000000000",
    tokenDescription: "",
    tokenAddress: "",
    existingTokenName: "",
    existingTokenSymbol: "",
    existingTokenSupply: "",
    liquidityMode: "auction",
    auctionSalePercent: "50",
    auctionLiquidityPercent: "100",
    auctionFloorValuationEth: "10",
    auctionStartBlock: "",
    auctionEndBlock: "",
    auctionClaimBlock: "",
    auctionMigrationBlock: "",
    directEthAmount: "",
    directTokenAmount: "",
    directTokensPerEth: "",
    selectedBehaviors: ["fixed-fee"],
    lpFeePercent: "0.30",
    customHookAddress: "",
    customHookSource: "",
    launchSalt: "",
    updatedAt: new Date(0).toISOString(),
  };
}

export function findBehavior(id: BehaviorId) {
  return behaviorDefinitions.find((behavior) => behavior.id === id);
}

export function getBehaviorTierLabel(tier: BehaviorTier) {
  if (tier === "standard") return "Standard";
  if (tier === "review") return "Review required";
  return "Custom";
}

export function getDraftAssetLabel(draft: LaunchDraft) {
  if (draft.assetMode === "existing") {
    return draft.existingTokenSymbol.trim() || "the existing token";
  }

  return draft.tokenSymbol.trim() || draft.tokenName.trim() || "the new token";
}

export function buildLaunchSummary(draft: LaunchDraft) {
  const asset = getDraftAssetLabel(draft);
  const liquidity =
    draft.liquidityMode === "auction"
      ? "Bids establish the opening price and fund the first Uniswap v4 pool"
      : "Creator supplied token and ETH liquidity opens the first Uniswap v4 pool";

  const selected = draft.selectedBehaviors
    .map(findBehavior)
    .filter((behavior): behavior is BehaviorDefinition => Boolean(behavior));

  const behaviorText =
    selected.length === 0
      ? "Standard token rules"
      : selected.length === 1
        ? selected[0].name
        : `${selected
            .slice(0, -1)
            .map((behavior) => behavior.name)
            .join(", ")} and ${selected.at(-1)?.name}`;

  return `${asset} launches on Ethereum; ${liquidity}; pool behavior: ${behaviorText}`;
}

export function buildPlainTextPlan(draft: LaunchDraft) {
  const selected = draft.selectedBehaviors
    .map(findBehavior)
    .filter((behavior): behavior is BehaviorDefinition => Boolean(behavior));

  return [
    "Launcher setup",
    "",
    `Asset: ${getDraftAssetLabel(draft)}`,
    `Asset path: ${
      draft.assetMode === "new"
        ? "New fixed supply ERC-20"
        : `Existing fixed supply Uniswap UERC20 (${draft.tokenAddress || "address not set"})`
    }`,
    `Liquidity path: ${
      draft.liquidityMode === "auction"
        ? `Four-hour auction funded v4 liquidity (${draft.auctionSalePercent || "unset"}% auctioned; 50% reserved for LP; all auction proceeds allocated to pool funding; ${draft.auctionFloorValuationEth || "unset"} ETH minimum valuation)`
        : `Direct v4 pool (${draft.directEthAmount || "unset"} ETH and ${draft.directTokenAmount || "unset"} tokens at ${draft.directTokensPerEth || "unset"} tokens per ETH)`
    }`,
    `Token behavior: ${
      selected.length > 0
        ? selected.map((behavior) => behavior.name).join(", ")
        : "Base configuration"
    }`,
    `Pool fee: ${
      draft.selectedBehaviors.includes("fixed-fee")
        ? `${draft.lpFeePercent || "unset"}%`
        : "Defined by the selected behavior"
    }`,
    `Launcher fee: ${(PLATFORM_FEE_BPS / 100).toFixed(2)}% of eligible swaps`,
    "Initial LP: permanently locked; LP fees go to the launch creator",
    ...(draft.liquidityMode === "auction"
      ? [
          "Auction recovery: any tokens left after the auction and pool setup return to the launch creator",
        ]
      : []),
    "",
    buildLaunchSummary(draft),
    "",
    "Status: Ready for contract review",
  ].join("\n");
}

export function hasReviewBehavior(draft: LaunchDraft) {
  return draft.selectedBehaviors.some((id) => {
    const tier = findBehavior(id)?.tier;
    return tier === "review" || tier === "custom";
  });
}

export function normalizeBehaviorSelection(
  selected: BehaviorId[],
  next: BehaviorId,
) {
  if (next === "custom-hook") {
    return selected.includes(next) ? [] : [next];
  }

  const withoutCustom = selected.filter((id) => id !== "custom-hook");

  if (withoutCustom.includes(next)) {
    return withoutCustom.filter((id) => id !== next);
  }

  if (next === "fixed-fee") {
    return [...withoutCustom.filter((id) => id !== "dynamic-fee"), next];
  }

  if (next === "dynamic-fee") {
    return [...withoutCustom.filter((id) => id !== "fixed-fee"), next];
  }

  return [...withoutCustom, next];
}
