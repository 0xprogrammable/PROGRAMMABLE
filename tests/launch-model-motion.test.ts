import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("launch model artwork", () => {
  it("uses the owned botanical art and exact Programmable loop asset", () => {
    const source = read("components/launch-entry.tsx");

    expect(source).toContain(
      'src="/brand/create/classic-botanical-v4.webp"',
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

  it("keeps decorative movement subtle and compositor-safe", () => {
    const source = read("components/launch-entry.tsx");
    const css = read("components/launch-experience.module.css");
    const sparkleMarkup = source.match(
      /<span className=\{launchExperience\.customSparkles\}>[\s\S]*?<\/span>/,
    )?.[0];
    const classicDrift = css.match(
      /@keyframes classic-botanical-drift[\s\S]*?(?=\n}\n\n@media)/,
    )?.[0];

    expect(css).toContain("@media (prefers-reduced-motion: no-preference)");
    expect(sparkleMarkup?.match(/<span \/>/g)).toHaveLength(6);
    expect(css).toContain(
      "animation: classic-botanical-drift 12s steps(1, end) infinite",
    );
    expect(css).toContain("translate3d(0.06%, -0.03%, 0) scale(1.0012)");
    expect(classicDrift).not.toContain("filter:");
    expect(css).toContain(
      "animation: custom-star-sparkle 6.4s cubic-bezier(0.2, 0, 0, 1) infinite",
    );
    expect(css).toContain("animation: none");
  });
});
