export type ShowcaseProject = {
  slug: string;
  name: string;
  symbol: string;
  category: string;
  model: string;
  image: string;
  summary: string;
  story: string;
  hookBehaviors: readonly string[];
  palette: "rose" | "blue" | "green" | "ink";
};

export const showcaseProjects = [
  {
    slug: "verdant",
    name: "Verdant",
    symbol: "VERD",
    category: "Adaptive liquidity",
    model: "Adaptive Curve",
    image: "/brand/programmable-adaptive-launch-art-v2.webp",
    summary:
      "A token concept whose swap rules respond to liquidity depth instead of treating every market condition the same.",
    story:
      "Verdant is an interface preview for a launch built around adaptive pool behavior. The project profile keeps the creative idea, the hook logic, and the market surface together so the token can be understood as a system rather than a ticker.",
    hookBehaviors: [
      "Liquidity-sensitive rules",
      "Explicit fee policy",
      "Wallet-executed launch",
    ],
    palette: "green",
  },
  {
    slug: "common-ground",
    name: "Common Ground",
    symbol: "COMMON",
    category: "Liquidity growth",
    model: "Deep Liquidity",
    image: "/brand/programmable-deep-liquidity-teaser-v1-1774x887.webp",
    summary:
      "A project concept that routes a defined share of swap activity back into protocol-owned liquidity.",
    story:
      "Common Ground explores a token whose market is designed to deepen over time. Its profile explains the accounting path, the liquidity destination, and the operational state before presenting any trading action.",
    hookBehaviors: [
      "Fee-to-liquidity routing",
      "Onchain accounting",
      "Full-range liquidity",
    ],
    palette: "blue",
  },
  {
    slug: "index-garden",
    name: "Index Garden",
    symbol: "GARDEN",
    category: "Tokenized assets",
    model: "Stock-Paired",
    image: "/brand/programmable-stock-paired-launch-art-v1.webp",
    summary:
      "A fixed-supply community token concept paired with a reviewed tokenized index as its quote asset.",
    story:
      "Index Garden shows how a project page can make a non-standard quote asset legible. The profile gives the paired asset, reward denomination, pool rules, and external references a stable home alongside the market.",
    hookBehaviors: [
      "Reviewed quote asset",
      "Quote-denominated rewards",
      "Fixed swap policy",
    ],
    palette: "rose",
  },
  {
    slug: "studio-pass",
    name: "Studio Pass",
    symbol: "STUDIO",
    category: "Creator economy",
    model: "Classic",
    image: "/brand/programmable-classic-launch-art.webp",
    summary:
      "A fixed-supply creator token concept with explicit swap fees and rewards paid in ETH.",
    story:
      "Studio Pass is the simplest profile in the preview set: one clear image, a concise project statement, fixed launch terms, and direct creator links. It demonstrates how even a straightforward token can feel complete without becoming promotional clutter.",
    hookBehaviors: [
      "Directional swap fees",
      "ETH creator rewards",
      "Fixed token supply",
    ],
    palette: "ink",
  },
] as const satisfies readonly ShowcaseProject[];

export function getShowcaseProject(slug: string) {
  return showcaseProjects.find((project) => project.slug === slug);
}
