import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const footerSource = readFileSync(
  new URL("../components/site-footer.tsx", import.meta.url),
  "utf8",
);

describe("Site footer", () => {
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
});
