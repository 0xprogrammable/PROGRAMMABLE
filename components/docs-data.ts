export type DocsSearchItem = {
  description: string;
  href: string;
  title: string;
};

export const docsNavigation = [
  {
    label: "Developers",
    items: [
      { href: "/docs#overview", label: "Overview" },
      { href: "/docs#formats", label: "Launch formats" },
      { href: "/docs#quickstart", label: "Quickstart" },
      { href: "/docs#rules", label: "Integration rules" },
      { href: "/docs#resources", label: "Resources" },
    ],
  },
] as const;

export const docsSearchItems: DocsSearchItem[] = [
  {
    title: "Developer API overview",
    description:
      "One public interface for terminals, scanners, wallets and apps.",
    href: "/docs#overview",
  },
  {
    title: "Launch formats",
    description:
      "Classic, Custom pool, no-pool and contract-market records.",
    href: "/docs#formats",
  },
  {
    title: "Quickstart",
    description: "Discover the interface and fetch the launch feed.",
    href: "/docs#quickstart",
  },
  {
    title: "Trading terminals and scanners",
    description:
      "List new Programmable launches and preserve their original provenance.",
    href: "/docs#overview",
  },
  {
    title: "Apps and agents",
    description:
      "Build games, dashboards and tools around declared capabilities.",
    href: "/docs#overview",
  },
  {
    title: "Integration rules",
    description:
      "Categories, market support, no-pool launches and deployment discovery.",
    href: "/docs#rules",
  },
  {
    title: "OpenAPI and schemas",
    description: "Machine-readable contracts and complete integration examples.",
    href: "/docs#resources",
  },
];
