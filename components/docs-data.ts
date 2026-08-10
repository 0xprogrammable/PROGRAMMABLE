export type DocsSearchItem = {
  description: string;
  href: string;
  keywords?: readonly string[];
  title: string;
};

export type DocsNavigationItem = {
  depth?: 0 | 1;
  href: string;
  label: string;
  relatedPaths?: readonly string[];
};

export type DocsNavigationGroup = {
  items: readonly DocsNavigationItem[];
  label: string;
};

const tokenModelPaths = [
  "/docs/models/classic",
  "/docs/models/custom",
  "/docs/models/stock-paired",
] as const;

const developerReferencePaths = [
  "/docs/developers/verify",
  "/docs/developers/indexing",
  "/docs/developers/machine-readable",
] as const;

export const docsCategories = [
  {
    description: "Project overview",
    href: "/docs",
    label: "Documentation",
    relatedPaths: [] as const,
  },
  {
    description: "Launch models and availability",
    href: "/docs/tokens",
    label: "Tokens and launches",
    relatedPaths: tokenModelPaths,
  },
  {
    description: "Launch identity and protocol data",
    href: "/docs/infrastructure",
    label: "Infrastructure",
    relatedPaths: ["/docs/launch-stamps"] as const,
  },
  {
    description: "Verification and indexing",
    href: "/docs/developers",
    label: "Developers",
    relatedPaths: developerReferencePaths,
  },
] as const;

export const docsNavigation: readonly DocsNavigationGroup[] = [
  {
    label: "Documentation",
    items: [{ href: "/docs", label: "Overview" }],
  },
  {
    label: "Tokens and launches",
    items: [
      {
        href: "/docs/tokens",
        label: "Overview",
        relatedPaths: tokenModelPaths,
      },
      { depth: 1, href: "/docs/models/classic", label: "Classic" },
      { depth: 1, href: "/docs/models/custom", label: "Custom hooks" },
      {
        depth: 1,
        href: "/docs/models/stock-paired",
        label: "Stock-Paired · Historical",
      },
    ],
  },
  {
    label: "Infrastructure",
    items: [
      { href: "/docs/infrastructure", label: "Overview" },
      {
        depth: 1,
        href: "/docs/launch-stamps",
        label: "Launch Stamp Router",
      },
    ],
  },
  {
    label: "Developers",
    items: [
      {
        href: "/docs/developers",
        label: "Overview",
        relatedPaths: developerReferencePaths,
      },
      {
        depth: 1,
        href: "/docs/developers/verify",
        label: "Verify a token or pool",
      },
      {
        depth: 1,
        href: "/docs/developers/indexing",
        label: "Index new launches",
      },
      {
        depth: 1,
        href: "/docs/developers/machine-readable",
        label: "Machine-readable docs",
      },
    ],
  },
];

export const docsSearchItems: DocsSearchItem[] = [
  {
    title: "Documentation overview",
    description:
      "Start with the project, launch models, infrastructure or developer references.",
    href: "/docs",
  },
  {
    title: "Tokens and launches",
    description:
      "Compare the launch models and see which ones are currently available.",
    href: "/docs/tokens",
  },
  {
    title: "Classic",
    description:
      "Read how fixed-supply launches, swap fees, creator rewards and Initial Buy work.",
    href: "/docs/models/classic",
  },
  {
    title: "Custom hooks",
    description: "Understand launches that use an individual Uniswap v4 hook.",
    href: "/docs/models/custom",
  },
  {
    title: "Stock-Paired",
    description:
      "Read the historical quote-asset model and its current support status.",
    href: "/docs/models/stock-paired",
  },
  {
    title: "Infrastructure",
    description:
      "See how launch execution, token identity and public protocol data fit together.",
    href: "/docs/infrastructure",
  },
  {
    title: "Developer overview",
    description:
      "Choose the verification or indexing path for a terminal, wallet, scanner or app.",
    href: "/docs/developers",
  },
  {
    title: "Verify a token or pool",
    description:
      "Verify a token, pool or component against its canonical Router record.",
    href: "/docs/developers/verify",
  },
  {
    title: "Index new launches",
    description:
      "Backfill Router events, follow new launches and handle finality and reorgs.",
    href: "/docs/developers/indexing",
  },
  {
    title: "Machine-readable docs",
    description:
      "Use the concise Markdown guide and complete machine-readable reference.",
    href: "/docs/developers/machine-readable",
    keywords: ["agent", "AI agent", "LLM"],
  },
  {
    title: "Router trust root",
    description:
      "Bind to the Ethereum Router, deployment range, runtime hash and frozen ABI.",
    href: "/docs/developers#trust-root",
  },
  {
    title: "Launch Stamp Router",
    description:
      "Read the canonical contract, deployment range, runtime hash and ABI reference.",
    href: "/docs/launch-stamps",
  },
  {
    title: "Classic and Custom launch kinds",
    description:
      "Map Router kind 1 to Programmable Custom and kind 2 to Programmable Classic.",
    href: "/docs/developers#trust-root",
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
      "Keep Router origin separate from safety, tradability, liquidity and app support.",
    href: "/docs/developers#boundary",
  },
  {
    title: "Integration checklist",
    description:
      "Check chain, runtime, ABI, identity reads, launch kind and result states.",
    href: "/docs/developers#checklist",
  },
];
