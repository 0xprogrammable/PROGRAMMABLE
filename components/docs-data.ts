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

const programmablePaths = [
  "/docs/tokens",
  "/docs/economics",
  "/docs/v4-token",
  "/docs/infrastructure",
  "/docs/trust",
  "/docs/status",
  "/docs/launch-stamps",
  ...tokenModelPaths,
] as const;

const creatorPaths = [
  "/docs/creators/launch",
  "/docs/creators/templates",
  "/docs/creators/earnings",
  "/docs/creators/programs",
] as const;

export const docsCategories = [
  {
    description: "Project, launch models, economics and trust",
    href: "/docs",
    label: "Programmable",
    relatedPaths: programmablePaths,
  },
  {
    description: "Launch, publish and earn",
    href: "/docs/creators",
    label: "Creators",
    relatedPaths: creatorPaths,
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
    label: "Programmable",
    items: [
      { href: "/docs", label: "Overview" },
      {
        href: "/docs/tokens",
        label: "Launch models",
        relatedPaths: tokenModelPaths,
      },
      { depth: 1, href: "/docs/models/classic", label: "Classic" },
      { depth: 1, href: "/docs/models/custom", label: "Custom hooks" },
      {
        depth: 1,
        href: "/docs/models/stock-paired",
        label: "Stock-Paired",
      },
      { href: "/docs/economics", label: "Economics" },
      { href: "/docs/v4-token", label: "V4 token" },
      { href: "/docs/infrastructure", label: "How it works" },
      {
        depth: 1,
        href: "/docs/launch-stamps",
        label: "Launch Stamp Router",
      },
      { href: "/docs/trust", label: "Trust" },
      { href: "/docs/status", label: "Service health" },
    ],
  },
  {
    label: "Creators",
    items: [
      {
        href: "/docs/creators",
        label: "Overview",
        relatedPaths: creatorPaths,
      },
      { depth: 1, href: "/docs/creators/launch", label: "Launch a project" },
      {
        depth: 1,
        href: "/docs/creators/templates",
        label: "Publish a template",
      },
      { depth: 1, href: "/docs/creators/earnings", label: "Earnings" },
      { depth: 1, href: "/docs/creators/programs", label: "Programs" },
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
      "Start with Programmable, creator paths or developer references.",
    href: "/docs",
  },
  {
    title: "Creator overview",
    description:
      "Launch a project, understand earnings and publish reusable hook logic.",
    href: "/docs/creators",
    keywords: ["creator", "earn", "launch"],
  },
  {
    title: "Launch a project",
    description:
      "Build, submit, review, launch and verify one exact project revision.",
    href: "/docs/creators/launch",
  },
  {
    title: "Publish a template",
    description:
      "Publish reusable hook logic with clear version binding and attribution.",
    href: "/docs/creators/templates",
    keywords: ["template", "royalty", "fee share"],
  },
  {
    title: "Creator earnings",
    description:
      "Compare Classic rewards, public template shares and partner template shares.",
    href: "/docs/creators/earnings",
    keywords: ["fees", "rewards", "revenue"],
  },
  {
    title: "Creator programs",
    description:
      "Find Hookathons, partnerships and contribution opportunities.",
    href: "/docs/creators/programs",
    keywords: ["hookathon", "grant", "bounty"],
  },
  {
    title: "Economics",
    description:
      "See the fee basis and split for Classic, Custom and template paths.",
    href: "/docs/economics",
  },
  {
    title: "V4 token and protocol revenue",
    description:
      "Understand the V4 token, the 80/20 protocol allocation and its boundaries.",
    href: "/docs/v4-token",
    keywords: ["buyback", "treasury", "80 20"],
  },
  {
    title: "Trust",
    description:
      "Understand what reviews, launch stamps and public records prove.",
    href: "/docs/trust",
    keywords: ["security", "audit", "approval"],
  },
  {
    title: "Service health",
    description:
      "Check API availability, data freshness, provider agreement and finality signals.",
    href: "/docs/status",
    keywords: ["health", "status", "freshness", "indexer"],
  },
  {
    title: "Tokens and launches",
    description:
      "Compare the launch models, their markets and their fee paths.",
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
      "Read the historical quote-asset model and its deployment boundaries.",
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
      "Read Router events, verify candidates and handle finality and reorgs.",
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
      "Use the published manifest, byte-verified ABI and canonical verifier guides.",
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
