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
      { href: "/docs/developers#quickstart", label: "Quickstart" },
      { href: "/docs/developers#identity", label: "Launch identity" },
      { href: "/docs/developers#providers", label: "Custom Registry" },
      { href: "/docs/developers#markets", label: "Assets and markets" },
      { href: "/docs/developers#verification", label: "Verified and fees" },
      { href: "/docs/developers#data", label: "Finality and indexing" },
      { href: "/docs/developers#reference", label: "API and versions" },
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
    title: "Terminal contract",
    description:
      "Copy a minimal consumer for the public launch feed in cURL, TypeScript, or Python.",
    href: "/docs/developers#quickstart",
  },
  {
    title: "Classic and Custom labels",
    description:
      "Map the two stable API categories to Programmable Classic and Programmable Custom.",
    href: "/docs/developers#quickstart",
  },
  {
    title: "Custom Registry",
    description:
      "Understand authenticated Custom provenance for unfamiliar templates, contracts, assets, and markets.",
    href: "/docs/developers#providers",
  },
  {
    title: "Launch detection",
    description:
      "Use the public feed or exact Ethereum source addresses, event topics, and start blocks.",
    href: "/docs/developers#identity",
  },
  {
    title: "Required fields",
    description:
      "Store identity, category, provenance, finality, markets, fees, and extensions correctly.",
    href: "/docs/developers#markets",
  },
  {
    title: "Verification rules",
    description:
      "Keep provenance, review scope, deployment binding, fees, and market support as separate facts.",
    href: "/docs/developers#verification",
  },
  {
    title: "Backfill and updates",
    description: "Traverse pages and persist a durable polling checkpoint.",
    href: "/docs/developers#data",
  },
  {
    title: "Terminal rendering rules",
    description:
      "Show every recognized launch without inventing unsupported market features.",
    href: "/docs/developers#markets",
  },
  {
    title: "AI agents",
    description:
      "Use llms.txt, Markdown, OpenAPI, schemas, and a copy-ready prompt.",
    href: "/docs/developers#agents",
  },
  {
    title: "API reference",
    description:
      "Endpoints, token detail paths, query parameters, HTTP states, OpenAPI, JSON Schemas, and examples.",
    href: "/docs/developers#reference",
  },
  {
    title: "OpenAPI and JSON Schemas",
    description:
      "Generate clients and validate public responses against the normative contracts.",
    href: "/docs/developers#reference",
  },
  {
    title: "Programmable Verified",
    description:
      "Read the bounded review definition, exact deployment binding, revocation state, and fee evidence.",
    href: "/docs/developers#verification",
  },
  {
    title: "Integration checklist",
    description:
      "Verify discovery, cursor traversal, finality, unknown markets, fees, schemas, and retry behavior.",
    href: "/docs/developers#checklist",
  },
];
