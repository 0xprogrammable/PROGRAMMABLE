import { describe, expect, it } from "vitest";

import { GET, POST } from "../app/api/profile/deep/route";

const expected = {
  code: "deep_profile_closed",
  error: "The Deep profile endpoint is not available",
};

describe("closed Deep profile API", () => {
  it("closes profile reads", async () => {
    const response = await GET();

    expect(response.status).toBe(410);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual(expected);
  });

  it("closes reward actions", async () => {
    const response = await POST();

    expect(response.status).toBe(410);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual(expected);
  });
});
