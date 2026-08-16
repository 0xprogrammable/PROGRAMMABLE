import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const footerSource = readFileSync(
  new URL("../components/site-footer.tsx", import.meta.url),
  "utf8",
);

describe("Site footer", () => {
  it("keeps the landing footer frameless and links Explore to the landing chapter", () => {
    expect(footerSource).toContain('href: "/#explore"');
    expect(footerSource).toContain("data-site-footer");
    expect(footerSource).not.toContain("liquid-glass-surface");
  });

  it("links the public analytics shortcut from Resources", () => {
    expect(footerSource).toContain('href: "/analytics"');
    expect(footerSource).toContain('label: "Analytics"');
  });

  it("links the official Discord from Resources", () => {
    expect(footerSource).toContain(
      'href: "https://discord.com/invite/programmable"',
    );
    expect(footerSource).toContain('label: "Discord"');
  });

  it("places the Dune dashboard between Dexscreener and Discord", () => {
    const dexscreener = footerSource.indexOf("https://dexscreener.com/");
    const dune = footerSource.indexOf(
      "https://dune.com/0xprogrammable6098/programmable-analytics",
    );
    const discord = footerSource.indexOf(
      "https://discord.com/invite/programmable",
    );

    expect(dexscreener).toBeGreaterThan(-1);
    expect(dune).toBeGreaterThan(dexscreener);
    expect(discord).toBeGreaterThan(dune);
    expect(footerSource).toContain('label: "Dune"');
  });
});
