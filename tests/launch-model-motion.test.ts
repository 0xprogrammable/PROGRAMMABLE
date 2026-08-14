import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("launch model artwork", () => {
  const removedPartnerMarkers = [
    String.fromCharCode(97, 101, 111, 110, 102, 114, 97, 109, 101, 119, 111, 114, 107),
    ["based", "bidx"].join(""),
    `launch-model-${String.fromCharCode(97, 101, 111, 110)}`,
    `launch-model-${String.fromCharCode(98, 97, 115, 101, 100, 98, 105, 100)}`,
  ];

  it("uses the owned botanical art and exact Programmable loop asset", () => {
    const source = read("components/launch-entry.tsx");
    const css = read("components/launch-experience.module.css");

    expect(source).toContain(
      'src="/brand/create/classic-botanical-v4.webp"',
    );
    expect(source).toContain(
      'src="/brand/loop/programmable-loop-mark-warm-ivory-v1-1536.png"',
    );
    expect(source).toContain('calc((100vw - 96px) / 2), 560px');
    expect(source).not.toContain('calc((100vw - 96px) / 4), 260px');
    for (const marker of removedPartnerMarkers) {
      expect(source).not.toContain(marker);
    }
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
    expect(source).toContain('onClick={() => onChoose("custom")}');
    expect(source).toContain(
      'aria-labelledby="launch-model-custom-title"',
    );
    expect(source).toContain(
      'aria-describedby="launch-model-custom-description"',
    );
    expect(source).toContain('data-launch-model-option="custom"');
    for (const marker of removedPartnerMarkers) {
      expect(source).not.toContain(marker);
    }
    expect(source).toMatch(
      /\$\{launchExperience\.modelArt\}[\s\S]{0,250}aria-hidden="true"[\s\S]{0,300}src="\/brand\/create\/classic-botanical-v4\.webp"[\s\S]{0,120}alt=""/,
    );
    expect(source).toMatch(
      /\$\{launchExperience\.modelArt\}[\s\S]{0,250}aria-hidden="true"[\s\S]{0,300}src="\/brand\/create\/custom-galaxy-v3\.webp"[\s\S]{0,120}alt=""/,
    );
  });

  it("keeps decorative movement subtle and compositor-safe", () => {
    const css = read("components/launch-experience.module.css");
    const classicDrift = css.match(
      /@keyframes classic-botanical-drift[\s\S]*?(?=\n}\n\n@media)/,
    )?.[0];

    expect(css).toContain("@media (prefers-reduced-motion: no-preference)");
    expect(css).toContain(
      "animation: classic-botanical-drift 12s steps(1, end) infinite",
    );
    expect(css).toContain("translate3d(0.06%, -0.03%, 0) scale(1.0012)");
    expect(classicDrift).not.toContain("filter:");
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.classicArt \.artImage[\s\S]*?animation:\s*none;/,
    );
  });
});
