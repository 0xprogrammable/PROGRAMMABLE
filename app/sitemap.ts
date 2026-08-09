import type { MetadataRoute } from "next";

const SITE_ORIGIN = "https://programmable.market";

const PUBLIC_ROUTES = [
  "",
  "/explore",
  "/launch",
  "/docs",
  "/docs/developers",
  "/docs/launch-stamps",
  "/docs/models/classic",
  "/docs/models/custom",
  "/docs/models/stock-paired",
  "/profile",
] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_ROUTES.map((route) => ({
    url: `${SITE_ORIGIN}${route}`,
  }));
}
