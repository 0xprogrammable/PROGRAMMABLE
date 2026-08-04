import { describe, expect, it } from "vitest";

import {
  docsLaunchSamples,
  getDocsCopyStatus,
  getNextDocsSampleIndex,
} from "../components/docs-code-preview";

describe("Developer docs code previews", () => {
  it("shows one Classic record and three structurally different Custom records", () => {
    expect(docsLaunchSamples.map((sample) => sample.label)).toEqual([
      "Classic",
      "Custom pool",
      "No pool",
      "Contract market",
    ]);
    expect(docsLaunchSamples[0]?.record.category).toBe("classic");
    expect(
      docsLaunchSamples
        .slice(1)
        .every((sample) => sample.record.category === "custom"),
    ).toBe(true);
    expect(docsLaunchSamples[2]?.record.markets).toEqual([]);
  });

  it("supports the expected keyboard loop for tabs", () => {
    expect(getNextDocsSampleIndex(0, "ArrowRight")).toBe(1);
    expect(getNextDocsSampleIndex(3, "ArrowRight")).toBe(0);
    expect(getNextDocsSampleIndex(0, "ArrowLeft")).toBe(3);
    expect(getNextDocsSampleIndex(2, "Home")).toBe(0);
    expect(getNextDocsSampleIndex(1, "End")).toBe(3);
  });

  it("announces copy success and failure without an idle message", () => {
    expect(getDocsCopyStatus("example", "idle")).toBe("");
    expect(getDocsCopyStatus("example", "copied")).toBe("example copied");
    expect(getDocsCopyStatus("example", "error")).toBe(
      "Could not copy example",
    );
  });
});
