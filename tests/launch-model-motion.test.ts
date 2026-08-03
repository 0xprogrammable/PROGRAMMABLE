import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("launch model artwork", () => {
  it("uses the owned botanical art and exact Programmable loop asset", () => {
    const source = read("components/launch-entry.tsx");

    expect(source).toContain(
      'src="/brand/create/classic-botanical-v3.webp"',
    );
    expect(source).toContain(
      'src="/brand/loop/programmable-loop-mark-transparent-v1.png"',
    );
  });

  it("keeps model images stable on hover", () => {
    const css = read("components/launch-experience.module.css");

    expect(css).not.toMatch(/:hover[^{}]*\.artImage\s*\{/s);
    expect(css).not.toMatch(/:hover[^{}]*\.modelArt img\s*\{/s);
  });

  it("limits decorative movement to opted-in, compositor-safe motion", () => {
    const css = read("components/launch-experience.module.css");

    expect(css).toContain("@media (prefers-reduced-motion: no-preference)");
    expect(css).toContain(
      "animation: classic-botanical-breeze 9.6s steps(1, end) infinite",
    );
    expect(css).toContain(
      "animation: custom-star-sparkle 5.8s cubic-bezier(0.2, 0, 0, 1) infinite",
    );
    expect(css).toContain("will-change: opacity, transform");
    expect(css).toContain("animation: none");
  });
});
