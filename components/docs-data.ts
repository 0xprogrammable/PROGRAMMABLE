export type DocsSearchItem = {
  description: string;
  href: string;
  title: string;
};

export const docsCategories = [
  {
    label: "Classic",
    status: "coming-soon",
  },
  {
    label: "Custom Hook",
    status: "coming-soon",
  },
  {
    href: "/docs/developers",
    label: "Developers",
    relatedPaths: ["/docs/launch-stamps"],
    status: "available",
  },
] as const;

export const docsNavigation = [
  {
    label: "Developers",
    items: [
      { href: "/docs/developers#paths", label: "Start here" },
      { href: "/docs/launch-stamps", label: "Launch stamps" },
      { href: "/docs/developers#trust-root", label: "Trust root" },
      { href: "/docs/developers#identity", label: "Launch identity" },
      {
        href: "/docs/developers#indexing",
        label: "Optional event discovery",
      },
      { href: "/docs/developers#resources", label: "Resources" },
      { href: "/docs/developers#boundary", label: "Trust boundary" },
      { href: "/docs/developers#checklist", label: "Checklist" },
      { href: "/docs/developers#agents", label: "AI agents" },
    ],
  },
] as const;

export const docsSearchItems: DocsSearchItem[] = [
  {
    title: "Launch stamps",
    description:
      "Verify future Classic and Custom provenance through one canonical Router lookup.",
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
    title: "Optional event discovery",
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
    title: "AI agent context",
    description:
      "Use the concise Markdown contract or the complete machine-readable Router reference.",
    href: "/docs/developers#agents",
  },
  {
    title: "Integration checklist",
    description:
      "Verify chain, runtime, ABI, identity reads, launch kind and result states.",
    href: "/docs/developers#checklist",
  },
];
