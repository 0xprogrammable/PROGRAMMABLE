import { readFileSync } from "node:fs";

import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "../app/api/explore/token/route";

const ADDRESS = "0x1111111111111111111111111111111111111111";
const RESET_BODY = {
  error: "Token data is temporarily unavailable",
  status: "index_rebuilding",
} as const;

function request(query: string) {
  return new NextRequest(`http://localhost/api/explore/token?${query}`);
}

describe("Explore token detail index reset API", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each(["1", "4663"])(
    "returns the reset contract for chain %s without outbound work",
    async (chain) => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(
        new Error("Outbound fetch must not run"),
      );

      const response = await GET(request(`chain=${chain}&address=${ADDRESS}`));

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual(RESET_BODY);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("retry-after")).toBe("3600");
      expect(response.headers.get("x-programmable-indexing-status")).toBe("reset");
      expect(response.headers.get("x-programmable-read-source")).toBeNull();
      expect(response.headers.get("x-programmable-market-provider")).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["address=bad", "Enter a valid Ethereum token address"],
    [`address=${ADDRESS}&unexpected=true`, "Unsupported query parameters"],
    [`address=${ADDRESS}&address=${ADDRESS}`, "Unsupported query parameters"],
    [`address=${ADDRESS}&chain=10`, "Unsupported chain"],
    [`address=${ADDRESS}&chain=1&chain=4663`, "Unsupported query parameters"],
  ])("preserves request validation for %s", async (query, error) => {
    const response = await GET(request(query));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error });
    expect(response.headers.get("x-programmable-indexing-status")).toBeNull();
  });

  it("contains no identity, provider, RPC, storage, or fetch dependency", () => {
    const source = readFileSync(
      new URL("../app/api/explore/token/route.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(/gmgn|dexscreener|bitquery|envio|alchemy|registry/iu);
    expect(source).not.toMatch(/createPublicClient|readFinalized|\bfetch\s*\(/u);
  });
});
