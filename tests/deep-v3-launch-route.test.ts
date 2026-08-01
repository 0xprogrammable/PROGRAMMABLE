import { describe, expect, it } from "vitest";

import { GET } from "../app/api/explore/launch/deep-v3/route";

describe("closed Deep V3 launch confirmation route", () => {
  it("returns the stable closure response for every query", async () => {
    const response = await GET();

    expect(response.status).toBe(410);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      code: "deep_launches_closed",
      error: "New Deep launches are not available",
    });
  });
});
