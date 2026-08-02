export type DocsSearchItem = {
  description: string;
  href: string;
  title: string;
};

export const docsNavigation = [
  {
    label: "Platform",
    items: [
      { href: "/docs#overview", label: "Overview" },
      { href: "/docs#launching", label: "Launch flow" },
      { href: "/docs#trading", label: "Trading and pricing" },
      { href: "/docs#rewards", label: "Creator rewards" },
    ],
  },
  {
    label: "Launch models",
    items: [
      { href: "/docs/models/classic", label: "Classic" },
      { href: "/docs/models/custom", label: "Custom" },
    ],
  },
  {
    label: "Verify",
    items: [
      { href: "/docs#network", label: "Network" },
      { href: "/docs#contracts", label: "Contracts" },
      { href: "/docs#metadata", label: "Token metadata" },
      { href: "/docs#releases", label: "Release evidence" },
      { href: "/docs#risks", label: "Risks" },
    ],
  },
] as const;

export const docsSearchItems: DocsSearchItem[] = [
  {
    title: "Overview",
    description: "What Programmable launches and what a launch model controls.",
    href: "/docs#overview",
  },
  {
    title: "Launch flow",
    description: "From model selection to a confirmed wallet transaction.",
    href: "/docs#launching",
  },
  {
    title: "Trading and pricing",
    description: "Canonical pools, quotes, market cap and routing.",
    href: "/docs#trading",
  },
  {
    title: "Creator rewards",
    description: "How model-specific rewards accrue and are claimed.",
    href: "/docs#rewards",
  },
  {
    title: "Classic",
    description:
      "Directional swap fees, ETH creator rewards and Initial Buy custody.",
    href: "/docs/models/classic",
  },
  {
    title: "Custom",
    description:
      "Product boundary and release requirements for custom launches.",
    href: "/docs/models/custom",
  },
  {
    title: "Network",
    description: "Ethereum Mainnet and the canonical Uniswap v4 dependencies.",
    href: "/docs#network",
  },
  {
    title: "Contracts",
    description: "Public deployment records and contract addresses.",
    href: "/docs#contracts",
  },
  {
    title: "Token metadata",
    description: "Names, tickers, images, descriptions and project links.",
    href: "/docs#metadata",
  },
  {
    title: "Release evidence",
    description: "How source, runtime and lifecycle evidence reach the app.",
    href: "/docs#releases",
  },
  {
    title: "Risks",
    description: "Transaction, token, liquidity and integration boundaries.",
    href: "/docs#risks",
  },
];
