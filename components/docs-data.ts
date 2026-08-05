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
      { href: "/docs/developers#paths", label: "Choose a path" },
      { href: "/docs/developers#terminals", label: "Terminals" },
      { href: "/docs/developers#providers", label: "Launch providers" },
      { href: "/docs/developers#detection", label: "Detection" },
      { href: "/docs/developers#fields", label: "Required fields" },
      { href: "/docs/developers#verification", label: "Verification" },
      { href: "/docs/developers#data", label: "Data and indexing" },
      { href: "/docs/developers#reference", label: "API reference" },
      { href: "/docs/developers#agents", label: "AI agents" },
    ],
  },
] as const;

export const docsSearchItems: DocsSearchItem[] = [
  {
    title: "Terminal contract",
    description:
      "Copy a minimal consumer for the public launch feed in cURL, TypeScript, or Python.",
    href: "/docs/developers#terminals",
  },
  {
    title: "Classic and Custom labels",
    description:
      "Map the two stable API categories to Programmable Classic and Programmable Custom.",
    href: "/docs/developers#terminals",
  },
  {
    title: "Launch provider integration",
    description:
      "Register Basebit and future provider templates through authenticated atomic provenance.",
    href: "/docs/developers#providers",
  },
  {
    title: "Launch detection",
    description:
      "Use the public feed or exact Ethereum source addresses, event topics, and start blocks.",
    href: "/docs/developers#detection",
  },
  {
    title: "Required fields",
    description:
      "Store identity, category, provenance, finality, markets, fees, and extensions correctly.",
    href: "/docs/developers#fields",
  },
  {
    title: "Verification rules",
    description:
      "Keep provenance, contract properties, audit scope, and market support as separate facts.",
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
    href: "/docs/developers#verification",
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
