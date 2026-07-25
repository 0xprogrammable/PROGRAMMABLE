export const PLATFORM_FEE_BPS = 10;
export const LAUNCH_DRAFT_STORAGE_KEY = "launcher.launch-draft.v1";

export type AssetMode = "new" | "existing" | "issuer";
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
      "The pool uses one fee rate that does not change with market conditions.",
    tier: "standard",
  },
  {
    id: "fee-split",
    name: "Fee split",
    description:
      "A defined share of swap fees is routed between the liquidity position and named recipients.",
    tier: "standard",
  },
  {
    id: "timed-opening",
    name: "Timed opening",
    description:
      "Trading opens for everyone at the same stated time, without address-specific sell rules.",
    tier: "standard",
  },
  {
    id: "nft-membership",
    name: "NFT membership",
    description:
      "NFT ownership can change fees or unlock a separate benefit, but it never removes a holder's ability to sell.",
    tier: "standard",
  },
  {
    id: "dynamic-fee",
    name: "Dynamic fees",
    description:
      "The swap fee follows a bounded rule based on observable market conditions.",
    tier: "review",
  },
  {
    id: "buyback",
    name: "Automated buyback",
    description:
      "A defined share of collected fees can buy the launched token under explicit limits.",
    tier: "review",
  },
  {
    id: "holder-rewards",
    name: "Holder rewards",
    description:
      "A defined share of swap fees can fund claims without adding a transfer tax to the token.",
    tier: "review",
  },
  {
    id: "oracle-guard",
    name: "Oracle guard",
    description:
      "Swaps can be checked against an external price reference and bounded deviation rules.",
    tier: "review",
  },
  {
    id: "anti-sandwich",
    name: "Anti-sandwich execution",
    description:
      "The market can use delayed or reordered settlement to reduce common sandwich patterns.",
    tier: "review",
  },
  {
    id: "limit-orders",
    name: "Limit orders",
    description:
      "Liquidity can represent orders that execute when the market reaches a stated price.",
    tier: "review",
  },
  {
    id: "productive-liquidity",
    name: "Productive liquidity",
    description:
      "Idle pool assets can enter a separate yield strategy with explicit withdrawal and loss assumptions.",
    tier: "review",
  },
  {
    id: "custom-curve",
    name: "Custom pricing curve",
    description:
      "The market can replace concentrated-liquidity pricing with a reviewed accounting model.",
    tier: "review",
  },
  {
    id: "custom-hook",
    name: "Custom hook",
    description:
      "A project can submit one complete hook implementation for compatibility and security review.",
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
  directEthAmount: string;
  directTokenAmount: string;
  selectedBehaviors: BehaviorId[];
  lpFeePercent: string;
  customHookAddress: string;
  customHookSource: string;
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
    auctionSalePercent: "20",
    auctionLiquidityPercent: "80",
    directEthAmount: "",
    directTokenAmount: "",
    selectedBehaviors: ["fixed-fee"],
    lpFeePercent: "0.30",
    customHookAddress: "",
    customHookSource: "",
    updatedAt: new Date(0).toISOString(),
  };
}

export function findBehavior(id: BehaviorId) {
  return behaviorDefinitions.find((behavior) => behavior.id === id);
}

export function getBehaviorTierLabel(tier: BehaviorTier) {
  if (tier === "standard") return "Standard plan";
  if (tier === "review") return "Dedicated review";
  return "Custom review";
}

export function getDraftAssetLabel(draft: LaunchDraft) {
  if (draft.assetMode === "existing") {
    return draft.existingTokenSymbol.trim() || "the existing token";
  }

  if (draft.assetMode === "issuer") {
    return "an issuer-backed asset";
  }

  return draft.tokenSymbol.trim() || draft.tokenName.trim() || "the new token";
}

export function buildLaunchSummary(draft: LaunchDraft) {
  const asset = getDraftAssetLabel(draft);
  const liquidity =
    draft.liquidityMode === "auction"
      ? "Bids establish the opening price, then a defined share of the proceeds and reserved tokens seeds a Uniswap v4 pool."
      : "The creator supplies the token and ETH liquidity used to initialize a Uniswap v4 pool.";

  const selected = draft.selectedBehaviors
    .map(findBehavior)
    .filter((behavior): behavior is BehaviorDefinition => Boolean(behavior));

  const behaviorText =
    selected.length === 0
      ? "The pool uses the base launch configuration."
      : selected.length === 1
        ? `${selected[0].name} defines the market behavior.`
        : `${selected
            .slice(0, -1)
            .map((behavior) => behavior.name)
            .join(", ")} and ${selected.at(-1)?.name} define the market behavior.`;

  return `${asset} is prepared for Ethereum. ${liquidity} ${behaviorText}`;
}

export function buildPlainTextPlan(draft: LaunchDraft) {
  const selected = draft.selectedBehaviors
    .map(findBehavior)
    .filter((behavior): behavior is BehaviorDefinition => Boolean(behavior));

  return [
    "Launcher draft",
    "",
    `Asset: ${getDraftAssetLabel(draft)}`,
    `Asset path: ${
      draft.assetMode === "new"
        ? "New fixed-supply ERC-20"
        : draft.assetMode === "existing"
          ? `Existing Ethereum token (${draft.tokenAddress || "address not set"})`
          : "Issuer-backed asset integration"
    }`,
    `Liquidity path: ${
      draft.liquidityMode === "auction"
        ? `Auction-funded v4 liquidity (${draft.auctionSalePercent || "unset"}% of supply offered; ${draft.auctionLiquidityPercent || "unset"}% of proceeds planned for pool funding)`
        : `Direct v4 pool (${draft.directEthAmount || "unset"} ETH and ${draft.directTokenAmount || "unset"} tokens planned)`
    }`,
    `Market behavior: ${
      selected.length > 0
        ? selected.map((behavior) => behavior.name).join(", ")
        : "Base configuration"
    }`,
    `Planned pool fee: ${
      draft.selectedBehaviors.includes("fixed-fee")
        ? `${draft.lpFeePercent || "unset"}%`
        : "Defined by the selected market rule"
    }`,
    `Planned Launcher fee: ${(PLATFORM_FEE_BPS / 100).toFixed(2)}% of eligible swaps`,
    "",
    buildLaunchSummary(draft),
    "",
    "This is a local launch plan. It does not deploy a contract or create a market.",
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
