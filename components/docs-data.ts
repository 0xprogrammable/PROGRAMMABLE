export type DocsSearchItem = {
  description: string;
  href: string;
  title: string;
};

export const docsCategories = [
  {
    description: "Overview",
    href: "/docs",
    label: "Overview",
    relatedPaths: [] as const,
  },
  {
    description: "Models and status",
    href: "/docs/tokens",
    label: "Tokens and launches",
    relatedPaths: [
      "/docs/models/classic",
      "/docs/models/custom",
      "/docs/models/stock-paired",
    ] as const,
  },
  {
    description: "Identity and data",
    href: "/docs/infrastructure",
    label: "Infrastructure",
    relatedPaths: [] as const,
  },
  {
    description: "Integration guide",
    href: "/docs/developers",
    label: "Developer integration",
    relatedPaths: ["/docs/launch-stamps"] as const,
  },
] as const;

export const docsNavigation = [
  {
    label: "Documentation",
    items: [{ href: "/docs", label: "Overview" }],
  },
  {
    label: "Tokens and launches",
    items: [
      { href: "/docs/tokens", label: "Token overview" },
      { href: "/docs/models/classic", label: "Classic" },
      { href: "/docs/models/custom", label: "Custom" },
      { href: "/docs/models/stock-paired", label: "Stock-Paired" },
    ],
  },
  {
    label: "Infrastructure",
    items: [{ href: "/docs/infrastructure", label: "System overview" }],
  },
  {
    label: "Developer integration",
    items: [
      { href: "/docs/developers", label: "Integration guide" },
      { href: "/docs/launch-stamps", label: "Router reference" },
    ],
  },
] as const;

export const docsSearchItems: DocsSearchItem[] = [
  {
    title: "Documentation overview",
    description:
      "Choose between project context, token models, infrastructure and developer integration.",
    href: "/docs",
  },
  {
    title: "Tokens and launches",
    description:
      "Compare Classic, Custom and historical Stock-Paired launches and the availability rules for each.",
    href: "/docs/tokens",
  },
  {
    title: "Classic",
    description:
      "Understand fixed-supply launches, directional fees, creator rewards and Initial Buy custody.",
    href: "/docs/models/classic",
  },
  {
    title: "Custom",
    description:
      "Learn what must be defined before a launch with an individual Uniswap v4 hook is activated.",
    href: "/docs/models/custom",
  },
  {
    title: "Stock-Paired",
    description:
      "Read the historical token model, quote-asset routing and support boundaries.",
    href: "/docs/models/stock-paired",
  },
  {
    title: "Infrastructure",
    description:
      "See how launch execution, token identity, Router provenance and public resources fit together.",
    href: "/docs/infrastructure",
  },
  {
    title: "Developer integration",
    description:
      "Integrate launch verification in a terminal, wallet, scanner or indexer.",
    href: "/docs/developers",
  },
  {
    title: "Launch verification",
    description:
      "Verify Router-stamped Classic and Custom provenance through one canonical contract.",
    href: "/docs/launch-stamps",
  },
  {
    title: "Router trust root",
    description:
      "Bind to the live Ethereum Router, deployment range, runtime hash and frozen ABI.",
    href: "/docs/developers#trust-root",
  },
  {
    title: "Classic and Custom launch kinds",
    description:
      "Map Router kind 1 to Programmable Custom and kind 2 to Programmable Classic.",
    href: "/docs/developers#trust-root",
  },
  {
    title: "Verify a token",
    description:
      "Resolve a token to one launch ID and reproduce its canonical stamp record.",
    href: "/docs/developers#identity",
  },
  {
    title: "Verify a Uniswap v4 pool",
    description:
      "Resolve PoolManager and poolId without relying on token names, tickers or hook reuse.",
    href: "/docs/developers#identity",
  },
  {
    title: "Verify an exclusive component",
    description:
      "Match launchId, stampProof and the recorded component runtime hash.",
    href: "/docs/developers#identity",
  },
  {
    title: "Discover new launches",
    description:
      "Backfill and follow Router events only when continuous launch discovery is needed.",
    href: "/docs/developers#indexing",
  },
  {
    title: "Reorg and finality handling",
    description:
      "Replay an overlap and advance only through one canonical finalized boundary.",
    href: "/docs/developers#indexing",
  },
  {
    title: "Manifest, ABI and GitHub",
    description:
      "Use the live manifest, byte-verified ABI and canonical verifier guides.",
    href: "/docs/developers#resources",
  },
  {
    title: "Provenance boundary",
    description:
      "Keep Router origin separate from safety, tradability, liquidity and terminal support.",
    href: "/docs/developers#boundary",
  },
  {
    title: "Machine-readable docs",
    description:
      "Use the concise Markdown guide or the complete machine-readable Router reference.",
    href: "/docs/developers#agents",
  },
  {
    title: "Integration checklist",
    description:
      "Verify chain, runtime, ABI, identity reads, launch kind and result states.",
    href: "/docs/developers#checklist",
  },
];
