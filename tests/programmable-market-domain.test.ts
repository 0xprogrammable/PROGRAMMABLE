import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";
import robots from "../app/robots";
import sitemap from "../app/sitemap";

describe("programmable.market website origin", () => {
  it("publishes the new canonical origin in website metadata", async () => {
    const layoutSource = await readFile(
      new URL("../app/layout.tsx", import.meta.url),
      "utf8",
    );

    expect(layoutSource).toContain(
      'const siteUrl = new URL("https://programmable.market")',
    );
    expect(layoutSource).not.toContain(
      'const siteUrl = new URL("https://programmable.family")',
    );
  });

  it("publishes robots and sitemap on the canonical origin", () => {
    expect(robots()).toMatchObject({
      host: "https://programmable.market",
      sitemap: "https://programmable.market/sitemap.xml",
    });
    expect(sitemap()).not.toHaveLength(0);
    expect(
      sitemap().every(({ url }) => url.startsWith("https://programmable.market")),
    ).toBe(true);
  });

  it("redirects only the new www host to the apex", async () => {
    const redirects = await nextConfig.redirects?.();

    expect(redirects).toEqual([
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.programmable.market" }],
        destination: "https://programmable.market/:path*",
        permanent: true,
      },
    ]);
  });
});
