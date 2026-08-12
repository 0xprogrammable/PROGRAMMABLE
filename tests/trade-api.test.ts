import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

import { POST } from "../app/api/trade/prepare/route";

const baseBody = {
  chainId: 8453,
  owner: "0x5555555555555555555555555555555555555555",
  token: "0x1111111111111111111111111111111111111111",
  side: "buy",
  amountIn: "1000",
  slippageBps: 100,
  deadline: "2000000000",
};

function request(body: unknown) {
  return new NextRequest("http://localhost/api/trade/prepare", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/trade/prepare", () => {
  it("rejects unsupported chains before any RPC work", async () => {
    const response = await POST(request(baseBody));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "Classic trading is not supported on chain 8453",
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("keeps Robinhood trading closed until its route is deployed and verified", async () => {
    const response = await POST(request({ ...baseBody, chainId: 4_663 }));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "Classic trading is not supported on chain 4663",
    });
  });

  it("rejects custom fee fields instead of silently adding a fee", async () => {
    const response = await POST(
      request({ ...baseBody, integratorFeeBps: 10 }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error:
        "The trade request contains unsupported field integratorFeeBps",
    });
  });
});
