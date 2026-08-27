import { describe, expect, it } from "vitest";

import { safePublicImageUrl } from "../lib/safe-public-image-url";

describe("safe public image URL", () => {
  it("accepts rooted local assets and credential-free HTTPS images", () => {
    expect(safePublicImageUrl("/brand/projects/project.png")).toBe(
      "/brand/projects/project.png",
    );
    expect(safePublicImageUrl("https://images.example/project.png")).toBe(
      "https://images.example/project.png",
    );
  });

  it("rejects external relative, credentialed and active-scheme inputs", () => {
    expect(safePublicImageUrl("//images.example/project.png")).toBeUndefined();
    expect(safePublicImageUrl("/\\images.example/project.png")).toBeUndefined();
    expect(safePublicImageUrl("https://user:pass@example.com/a.png"))
      .toBeUndefined();
    expect(safePublicImageUrl("javascript:alert(1)")).toBeUndefined();
  });
});
