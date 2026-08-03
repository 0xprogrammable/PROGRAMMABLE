import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({
  unstable_cache: (reader: () => unknown) => reader,
}));
vi.mock("../lib/onchain", () => ({
  getOnchainDeployment: vi.fn(),
  readLiveExploreModel: vi.fn(),
}));

import type { LauncherToken } from "../lib/tokens";
import { enrichTokensWithAlchemyPrices } from "../lib/alchemy/explore.server";

const HOOK_ADDRESS =
  "0x3333333333333333333333333333333333333333" as const;
const POOL_ID = `0x${"44".repeat(32)}` as const;

function token(tokenAddress: `0x${string}`): LauncherToken {
  return {
    id: `1:${tokenAddress}`,
    name: "Canonical",
    symbol: "CAN",
    tokenAddress,
    hookAddress: HOOK_ADDRESS,
    poolId: POOL_ID,
    launchedAt: "2026-07-29T00:00:00.000Z",
    totalSupplyRaw: "1000000000000000000000000",
    tokenDecimals: 18,
    totalSwapFeeBps: 100,
    liquidityPath: "meme",
  };
}

describe("Alchemy Explore price enrichment", () => {
  beforeEach(() => {
    vi.stubEnv("PROGRAMMABLE_ALCHEMY_API_KEY", "alchemy-test-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("authenticates the Alchemy Prices request and derives USD market cap", async () => {
    const canonical = token(
      "0x1111111111111111111111111111111111111111",
    );
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              network: "eth-mainnet",
              address: canonical.tokenAddress,
              prices: [
                {
                  currency: "USD",
                  value: "1.25",
                  lastUpdatedAt: new Date().toISOString(),
                },
              ],
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const enriched = await enrichTokensWithAlchemyPrices([canonical]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://api.g.alchemy.com/prices/v1/tokens/by-address",
    );
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("Authorization")).toBe(
      "Bearer alchemy-test-key",
    );
    expect(JSON.parse(String(init.body))).toEqual({
      addresses: [
        { network: "eth-mainnet", address: canonical.tokenAddress },
      ],
    });
    expect(enriched[0]).toMatchObject({
      tokenPriceUsdWad: "1250000000000000000",
      fdvUsdWad: "1250000000000000000000000",
    });
  });

  it("price-enriches 100 visible tokens in five 20-address batches", async () => {
    const tokens = Array.from({ length: 100 }, (_, index) =>
      token(
        `0x${(index + 1).toString(16).padStart(40, "0")}` as `0x${string}`,
      ),
    );
    const fetchMock = vi.fn().mockImplementation(
      async (_url: string, init: RequestInit) => {
        const request = JSON.parse(String(init.body)) as {
          addresses: { network: string; address: string }[];
        };
        return new Response(
          JSON.stringify({
            data: request.addresses.map(({ network, address }) => ({
              network,
              address,
              prices: [
                {
                  currency: "USD",
                  value: "2",
                  lastUpdatedAt: new Date().toISOString(),
                },
              ],
            })),
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const enriched = await enrichTokensWithAlchemyPrices(tokens);

    expect(fetchMock).toHaveBeenCalledTimes(5);
    const batches = fetchMock.mock.calls.map(([, init]) =>
      (JSON.parse(String(init.body)) as { addresses: unknown[] }).addresses,
    );
    expect(batches.map((batch) => batch.length)).toEqual([20, 20, 20, 20, 20]);
    expect(batches.flat()).toHaveLength(100);
    expect(enriched).toHaveLength(100);
    expect(enriched.every((candidate) =>
      candidate.tokenPriceUsdWad === "2000000000000000000" &&
      candidate.fdvUsdWad ===
        "2000000000000000000000000"
    )).toBe(true);
  });

  it("ignores an Alchemy price older than five minutes", async () => {
    const canonical = token(
      "0x3333333333333333333333333333333333333333",
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [
              {
                network: "eth-mainnet",
                address: canonical.tokenAddress,
                prices: [
                  {
                    currency: "USD",
                    value: "99",
                    lastUpdatedAt: new Date(Date.now() - 6 * 60_000).toISOString(),
                  },
                ],
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    await expect(
      enrichTokensWithAlchemyPrices([canonical]),
    ).resolves.toEqual([canonical]);
  });

  it("returns the canonical tokens unchanged when Alchemy Prices fails", async () => {
    const canonical = token(
      "0x2222222222222222222222222222222222222222",
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("upstream unavailable", { status: 503 })),
    );
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(
      enrichTokensWithAlchemyPrices([canonical]),
    ).resolves.toEqual([canonical]);
    expect(warning).toHaveBeenCalledWith(
      "Alchemy price enrichment failed",
      expect.any(Error),
    );
  });
});
