import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const runtimeCodes = {
    "0x01":
      "0x9cc9723456c471d90ac838c02fa4fc47ed4b7e82c85358e71deec978c48d2dc8",
    "0x02":
      "0x3eba781023d3146ed9b502ac5b402d39cea4c34a14f64c878cb9ea62149590f1",
    "0x03":
      "0x874ec76f396807bfcbbdd88cc2fd534f10201242ad0479a05fe5d2ee937616ee",
  } as const;
  const contractCodes = {
    "0xc3bd04aac2fb2ba58efd7eb673e544e0b80de770": "0x01",
    "0x35fe236ea82f7cf525c9719d7df8f49f94d720cc": "0x02",
    "0xf28967f9dfac3ca21384b59d6d75c8106b3eab2a": "0x03",
  } as const;
  const client = {
    getCode: vi.fn(
      async ({ address }: { address: string }) =>
        contractCodes[
          address.toLowerCase() as keyof typeof contractCodes
        ] ?? "0x",
    ),
    getBlockNumber: vi.fn(async () => 25_639_608n),
    getLogs: vi.fn(async () => []),
  };
  return { client, runtimeCodes };
});

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    createPublicClient: vi.fn(() => mocks.client),
    keccak256: vi.fn((value: keyof typeof mocks.runtimeCodes) => {
      const mocked = mocks.runtimeCodes[value];
      return mocked ?? actual.keccak256(value);
    }),
  };
});

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
