import { describe, expect, it } from "vitest";

import { GET } from "../app/api/explore/launch/route";

describe("closed historical Deep launch confirmation route", () => {
  it("fails closed without reading the historical launch registry", async () => {
    const response = await GET();

    expect(response.status).toBe(410);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      code: "deep_launches_closed",
      error: "New Deep launches are not available",
    });
  });
});
