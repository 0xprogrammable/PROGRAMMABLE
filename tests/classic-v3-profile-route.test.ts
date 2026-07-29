import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import {
  GET,
  POST,
} from "../app/api/profile/classic-v3/route";

const account = "0x1111111111111111111111111111111111111111";
const vault = "0x2222222222222222222222222222222222222222";

describe("Classic profile release gate", () => {
  it("returns the verified release with no rewards for an unused wallet", async () => {
    const response = await GET(
      new NextRequest(
        `http://localhost/api/profile/classic-v3?account=${account}`,
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ready",
      account,
      chainId: 1,
      rewards: [],
    });
  });

  it("rejects claims from a wallet that does not own the vault", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/profile/classic-v3", {
        method: "POST",
        body: JSON.stringify({
          action: "claim",
          account,
          vaultAddress: vault,
          chainId: 1,
        }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Only a current or historic payout wallet can continue",
    });
  });
});
