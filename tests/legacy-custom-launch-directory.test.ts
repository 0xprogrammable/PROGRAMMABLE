import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const component = readFileSync(
  join(root, "components/generic-launch-directory-v2.tsx"),
  "utf8",
);
const styles = readFileSync(
  join(root, "components/generic-launch-directory-v2.module.css"),
  "utf8",
);
const directoryPage = readFileSync(
  join(root, "app/custom-launches/page.tsx"),
  "utf8",
);

describe("legacy Custom Registry directory", () => {
  it("labels the retired flow and routes new launches to the API path", () => {
    expect(component).toContain("Legacy Custom records");
    expect(component).toContain("retired Registry approval flow");
    expect(component).toContain('href="/developers/api-keys"');
    expect(component).toContain('href="/docs/developers/custom-launch"');
    expect(component).not.toContain("Launched from an approved revision.");
  });

  it("uses the current flat product surface and stays out of search results", () => {
    expect(styles).toContain("var(--webde-surface");
    expect(styles).toContain("var(--webde-line");
    expect(styles).not.toContain("liquid-glass");
    expect(directoryPage).toContain("robots: { follow: false, index: false }");
  });
});
