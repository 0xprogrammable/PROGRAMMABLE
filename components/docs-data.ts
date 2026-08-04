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
    status: "available",
  },
] as const;

export const docsNavigation = [
  {
    label: "Developers",
    items: [
      { href: "/docs/developers#quickstart", label: "Quickstart" },
      { href: "/docs/developers#integrations", label: "Integration guides" },
      { href: "/docs/developers#response", label: "Response model" },
      { href: "/docs/developers#sync", label: "Backfill and updates" },
      { href: "/docs/developers#rendering", label: "Rendering rules" },
      { href: "/docs/developers#agents", label: "AI agents" },
      { href: "/docs/developers#reference", label: "API reference" },
    ],
  },
] as const;

export const docsSearchItems: DocsSearchItem[] = [
  {
    title: "Developer quickstart",
    description:
      "Run the public launch feed for terminals, scanners, wallets, and apps in cURL, TypeScript, or Python.",
    href: "/docs/developers#quickstart",
  },
  {
    title: "Integration guides",
    description:
      "Implementation paths for terminals, scanners, indexers, wallets, bots, apps, and games.",
    href: "/docs/developers#integrations",
  },
  {
    title: "Response model",
    description:
      "Classic and Custom records: token identity, provenance, markets, verification, and fees.",
    href: "/docs/developers#response",
  },
  {
    title: "Backfill and updates",
    description: "Traverse pages and persist a durable polling checkpoint.",
    href: "/docs/developers#sync",
  },
  {
    title: "Rendering rules",
    description:
      "Show every launch without inventing unsupported market features.",
    href: "/docs/developers#rendering",
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
];
