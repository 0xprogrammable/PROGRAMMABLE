import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  formatBannerPositionStatus,
  formatBannerPositionValue,
} from "../components/profile-view";

const profileSource = readFileSync(
  new URL("../components/profile-view.tsx", import.meta.url),
  "utf8",
);
const profileCss = readFileSync(
  new URL("../components/profile-experience.module.css", import.meta.url),
  "utf8",
);

describe("profile banner accessibility", () => {
  it("keeps normal mobile scrolling outside the editable crop state", () => {
    expect(profileCss).toMatch(
      /\.profileBanner\s*\{[^}]*touch-action:\s*auto;/s,
    );
    expect(profileCss).not.toMatch(
      /\.profileBanner\s*\{[^}]*touch-action:\s*none;/s,
    );
    expect(profileCss).toMatch(
      /\.profileBannerPositionable\s*\{[^}]*touch-action:\s*none;/s,
    );
    expect(profileSource).toContain("editingProfile && bannerDraft");
  });

  it("offers two labelled native range controls for keyboard positioning", () => {
    expect(profileSource.match(/type="range"/g)).toHaveLength(2);
    expect(profileSource).toContain("Horizontal position");
    expect(profileSource).toContain("Vertical position");
    expect(profileSource.match(/min="0"/g)).toHaveLength(2);
    expect(profileSource.match(/max="100"/g)).toHaveLength(2);
    expect(profileSource.match(/step="1"/g)).toHaveLength(2);
    expect(profileSource.match(/aria-valuetext=/g)).toHaveLength(2);
    expect(profileSource.match(/profile-banner-position-status/g)).toHaveLength(
      3,
    );
    expect(profileCss).toMatch(
      /\.bannerPositionFields input\s*\{[^}]*height:\s*44px;/s,
    );
    expect(profileCss).toMatch(
      /\.bannerPositionFields input:focus-visible[^}]*outline:\s*2px solid var\(--focus\);/s,
    );
  });

  it("retains pointer capture for direct banner dragging", () => {
    expect(profileSource).toContain("onPointerDown={startBannerDrag}");
    expect(profileSource).toContain("onPointerMove={moveBannerDrag}");
    expect(profileSource).toContain("onPointerUp={stopBannerDrag}");
    expect(profileSource).toContain("onPointerCancel={stopBannerDrag}");
    expect(profileSource).toContain(
      "event.currentTarget.setPointerCapture(event.pointerId)",
    );
  });

  it("describes keyboard and pointer positions in human terms", () => {
    expect(formatBannerPositionValue("horizontal", 0)).toBe(
      "aligned to the left edge",
    );
    expect(formatBannerPositionValue("horizontal", 50)).toBe(
      "centered horizontally",
    );
    expect(formatBannerPositionValue("vertical", 100)).toBe(
      "aligned to the bottom edge",
    );
    expect(formatBannerPositionStatus({ x: 27.6, y: 64.2 })).toBe(
      "Banner position: 28% from the left, 64% from the top.",
    );
  });
});
