import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const routeStylePaths = [
  "components/launch-experience.module.css",
  "components/custom-launch-experience.module.css",
  "components/extended-launch-layout.module.css",
  "components/profile-experience.module.css",
  "components/docs-experience.module.css",
  "components/developer-docs.module.css",
] as const;

describe("Night Garden route alignment", () => {
  it("keeps one shared atmosphere instead of route-specific wallpapers", () => {
    const shell = read("components/app-shell.tsx");

    expect(shell.match(/<AtmosphereBackdrop \/>/g)).toHaveLength(1);
    for (const path of routeStylePaths) {
      expect(read(path)).not.toMatch(/background-image:\s*url\(/);
    }
  });

  it("uses flat Warm Ivory material on large work and reading surfaces", () => {
    const launch = read("components/launch-experience.module.css");
    const profile = read("components/profile-experience.module.css");
    const docs = read("components/developer-docs.module.css");

    expect(launch).toMatch(
      /\.modelCard\.modelCard\s*\{[^}]*backdrop-filter:\s*none;[^}]*background:\s*var\(--liquid-glass-surface-background\);/s,
    );
    expect(profile).toMatch(
      /\.profileWorkspace\s*\{[^}]*backdrop-filter:\s*none;/s,
    );
    expect(docs).toMatch(
      /\.workbench\s*\{[^}]*backdrop-filter:\s*none;[^}]*background:\s*var\(--dev-code\);/s,
    );
    expect(docs).toContain("--dev-accent: var(--brand-ivory)");
  });

  it("keeps Docs search readable and status colors semantic", () => {
    const docsSearch = read("components/docs-search.tsx");
    const docsStyles = read("components/docs-experience.module.css");
    const customSource = read("components/custom-launch-experience.tsx");
    const customStyles = read("components/custom-launch-experience.module.css");

    expect(docsSearch).not.toContain("liquid-glass-distortion");
    expect(docsStyles).toMatch(
      /\.searchResults\s*\{[^}]*background:\s*color-mix\([^}]*width:\s*min\(420px,/s,
    );
    expect(customSource).toContain('data-error={error ? "true" : "false"}');
    expect(customStyles).toMatch(
      /\.liveMessage\[data-error="true"\]\s*\{\s*color:\s*var\(--danger\);/s,
    );
  });
});
