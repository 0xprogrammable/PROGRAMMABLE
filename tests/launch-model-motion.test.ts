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
    const source = read("components/launch-entry.tsx");
    const css = read("components/launch-experience.module.css");

    expect(css).not.toMatch(/:hover[^{}]*\.artImage\s*\{/s);
    expect(css).not.toMatch(/:hover[^{}]*\.modelArt img\s*\{/s);
    expect(source).not.toContain("onMouseEnter=");
    expect(source).not.toContain("onMouseLeave=");
    expect(source).toContain(
      "classicV3LaunchAvailable ? preloadAvailableForm : undefined",
    );
  });

  it("uses native card semantics and keeps decorative art out of the accessibility tree", () => {
    const source = read("components/launch-entry.tsx");

    expect(source).toContain('data-launch-model-option="classic"');
    expect(source).toContain('type="button"');
    expect(source).toContain(
      'aria-labelledby="launch-model-classic-title"',
    );
    expect(source).toContain(
      'aria-describedby="launch-model-classic-description"',
    );
    expect(source).toContain('href="/docs/models/custom"');
    expect(source).toContain(
      'aria-labelledby="launch-model-custom-title"',
    );
    expect(source).toContain(
      'aria-describedby="launch-model-custom-description"',
    );
    expect(source).toMatch(
      /\$\{launchExperience\.modelArt\}[\s\S]{0,250}aria-hidden="true"[\s\S]{0,300}src="\/brand\/create\/classic-botanical-v4\.webp"[\s\S]{0,120}alt=""/,
    );
    expect(source).toMatch(
      /\$\{launchExperience\.modelArt\}[\s\S]{0,250}aria-hidden="true"[\s\S]{0,300}src="\/brand\/create\/custom-galaxy-v3\.webp"[\s\S]{0,120}alt=""/,
    );
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
    expect(sparkleMarkup?.match(/<span \/>/g)).toHaveLength(10);
    expect(css).toContain(
      "animation: classic-botanical-drift 12s steps(1, end) infinite",
    );
    expect(css).toContain("translate3d(0.06%, -0.03%, 0) scale(1.0012)");
    expect(classicDrift).not.toContain("filter:");
    expect(css).toContain(
      "animation: custom-star-sparkle 6.4s cubic-bezier(0.2, 0, 0, 1) infinite",
    );
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.classicArt \.artImage,[\s\S]*?\.customSparkles > span\s*\{\s*animation:\s*none;/,
    );
  });
});
