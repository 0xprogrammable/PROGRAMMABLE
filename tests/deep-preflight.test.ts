import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { POST } from "../app/api/launch/preflight/route";

function request(launchModel: string) {
  return new NextRequest("http://localhost/api/launch/preflight", {
    method: "POST",
    body: JSON.stringify({
      account: "not-an-address",
      draft: { launchModel },
    }),
  });
}

describe("closed Deep launch preflight", () => {
  it.each([
    "deep",
    " Deep ",
    "deep-v3",
    "liquidity-growth",
    "liquidity-growth-v3",
  ])("returns one stable closure response for %s", async (launchModel) => {
    const response = await POST(request(launchModel));

    expect(response.status).toBe(410);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      code: "deep_launches_closed",
      error: "New Deep launches are not available",
    });
  });
});
