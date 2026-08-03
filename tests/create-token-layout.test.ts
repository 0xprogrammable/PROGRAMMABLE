import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const launchStyles = readFileSync(
  join(root, "components/launch-experience.module.css"),
  "utf8",
);
const globalStyles = readFileSync(join(root, "app/globals.css"), "utf8");
const launchSource = readFileSync(
  join(root, "components/launch-builder.tsx"),
  "utf8",
);

describe("Create Token layout", () => {
  it("uses one shared control height for fields and launch selectors", () => {
    expect(launchStyles).toContain("--launch-control-height: 52px");
    expect(launchStyles).toMatch(
      /\.formPage :global\(\.field input\)\s*\{[^}]*height:\s*var\(--launch-control-height\);[^}]*min-height:\s*var\(--launch-control-height\);/s,
    );
    expect(launchStyles).toMatch(
      /:global\(\.launch-select-trigger\),[\s\S]*?:global\(\.classic-v3-custody input\)\s*\{\s*min-height:\s*var\(--launch-control-height\);/,
    );
  });

  it("keeps fee, reward and initial-buy choices on the same panel grid", () => {
    expect(launchStyles).toMatch(
      /\.formPage :global\(\.classic-v3-core\)\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/s,
    );
    expect(launchStyles).toMatch(
      /\.formPage :global\(\.classic-v3-initial-buy\)\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/s,
    );
    expect(launchStyles).toMatch(
      /:global\(\.classic-v3-fees\),[\s\S]*?:global\(\.classic-v3-custody\)\s*\{[^}]*border-radius:\s*18px;/,
    );
  });

  it("preserves semantic groups and a narrow one-column flow", () => {
    expect(launchSource).toContain('<fieldset className="classic-v3-fees">');
    expect(launchSource).toContain(
      '<fieldset className="classic-v3-reward-mode">',
    );
    expect(launchSource).toContain('className="classic-v3-custody"');
    expect(globalStyles).toMatch(
      /@media \(max-width: 720px\)[\s\S]*?\.classic-v3-initial-buy\s*\{\s*grid-template-columns:\s*1fr;/,
    );
    expect(launchStyles).toMatch(
      /@media \(max-width: 760px\)[\s\S]*?:global\(\.classic-v3-initial-buy\)\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\);/,
    );
    expect(launchStyles).toMatch(
      /@media \(max-width: 760px\)[\s\S]*?:global\(\.classic-v3-initial-buy \.meme-dev-buy\)\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\);/,
    );
    expect(launchStyles).toMatch(
      /@media \(max-width: 520px\)[\s\S]*?:global\(\.classic-v3-reward-mode > div\)\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/,
    );
    expect(globalStyles).toMatch(
      /@media \(max-width: 520px\)[\s\S]*?\.classic-token-main \.two-column-fields\s*\{\s*grid-template-columns:\s*1fr;/,
    );
  });
});
