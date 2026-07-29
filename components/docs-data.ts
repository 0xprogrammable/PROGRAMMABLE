export type DocsSearchItem = {
  description: string;
  href: string;
  title: string;
};

export const docsNavigation = [
  {
    label: "Start here",
    items: [
      { href: "/docs#overview", label: "Overview" },
      { href: "/docs#launching", label: "Launching a token" },
      { href: "/docs#trading", label: "Trading and pricing" },
      { href: "/docs#rewards", label: "Creator rewards" },
      { href: "/docs#risks", label: "Risk" },
    ],
  },
  {
    label: "Launch models",
    items: [
      { href: "/docs/models/classic", label: "Classic" },
      { href: "/docs/models/deep", label: "Deep" },
      { href: "/docs/models/stock-paired", label: "Stock-Paired" },
    ],
  },
  {
    label: "Reference",
    items: [
      { href: "/docs#network", label: "Network" },
      { href: "/docs#contracts", label: "Contracts" },
      { href: "/docs#metadata", label: "Token metadata" },
      { href: "/docs#releases", label: "Source and releases" },
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
    title: "Launching a token",
    description: "From model selection to the wallet transaction.",
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
    description: "Fixed fee launches with creator rewards in ETH.",
    href: "/docs/models/classic",
  },
  {
    title: "Deep",
    description: "A coming model that returns trading fees to locked liquidity.",
    href: "/docs/models/deep",
  },
  {
    title: "Stock-Paired",
    description: "A limited model whose pool uses a reviewed stock token.",
    href: "/docs/models/stock-paired",
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
    title: "Source and releases",
    description: "How source, runtime and lifecycle evidence reach the app.",
    href: "/docs#releases",
  },
  {
    title: "Risk",
    description: "Transaction, token, liquidity and integration boundaries.",
    href: "/docs#risks",
  },
];
