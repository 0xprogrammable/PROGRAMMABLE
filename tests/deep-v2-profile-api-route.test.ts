import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { GET, POST } from "../app/api/profile/deep/route";

const ACCOUNT = "0x1111111111111111111111111111111111111111";
const VAULT = "0x2222222222222222222222222222222222222222";

function request(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/profile/deep", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Deep profile API release dispatch", () => {
  it("keeps the Deep V3 creator profile fail-closed before a verified live release", async () => {
    const response = await GET(
      new NextRequest(
        `http://localhost/api/profile/deep?account=${ACCOUNT}&deepReleaseVersion=deep-full-range-v3`,
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "not-deployed",
      account: "0x1111111111111111111111111111111111111111",
      chainId: 1,
      tokens: [],
    });
  });

  it("rejects unknown Deep profile release versions", async () => {
    const response = await GET(
      new NextRequest(
        `http://localhost/api/profile/deep?account=${ACCOUNT}&deepReleaseVersion=deep-full-range-v4`,
      ),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Unsupported Deep release version",
    });
  });

  it("fails closed before registry or RPC access when V2 has no reviewed eligible manifest", async () => {
    const response = await POST(
      request({
        action: "claim",
        deepReleaseVersion: "deep-full-range-v2",
        account: ACCOUNT,
        vaultAddress: VAULT,
        chainId: 1,
      }),
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Deep V2 is not enabled by a verified release",
    });
  });

  it("never guesses a release version for a reward action", async () => {
    const response = await POST(
      request({
        action: "claim",
        account: ACCOUNT,
        vaultAddress: VAULT,
        chainId: 1,
      }),
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "The reward request is invalid",
    });
  });
});
