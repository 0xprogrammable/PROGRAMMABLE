import { describe, expect, it } from "vitest";
import { getAddress, parseEther } from "viem";

import {
  DEFAULT_TRADE_SLIPPAGE_BPS,
  MIN_BUY_GAS_RESERVE_WEI,
  buildTokenTradeApiRequest,
  calculateBuyMaxWei,
  calculateEthVolumeUsdValue,
  calculatePriceImpactPercent,
  calculateTradeUsdValue,
  formatTradeAmount,
} from "../components/token-trade";

const OWNER = getAddress("0x5555555555555555555555555555555555555555");
const TOKEN = getAddress("0x1111111111111111111111111111111111111111");

describe("TokenTrade request construction", () => {
  it("defaults to one percent slippage", () => {
    expect(DEFAULT_TRADE_SLIPPAGE_BPS).toBe(100);
  });

  it("uses 18 decimals for native ETH buys and an explicit deadline", () => {
    expect(
      buildTokenTradeApiRequest({
        chainId: 1,
        owner: OWNER,
        token: TOKEN,
        side: "buy",
        amount: "0.001",
        tokenDecimals: 6,
        slippageBps: 250,
        nowSeconds: 1_000,
      }),
    ).toEqual({
      chainId: 1,
      owner: OWNER,
      token: TOKEN,
      side: "buy",
      amountIn: "1000000000000000",
      slippageBps: 250,
      deadline: "2200",
    });
  });

  it("uses the launched token decimals for sells", () => {
    expect(
      buildTokenTradeApiRequest({
        chainId: 11155111,
        owner: OWNER,
        token: TOKEN,
        side: "sell",
        amount: "12.345678",
        tokenDecimals: 6,
        slippageBps: 500,
        nowSeconds: 10_000,
      }).amountIn,
    ).toBe("12345678");
  });

  it("rejects zero amounts and unsupported token decimals", () => {
    expect(() =>
      buildTokenTradeApiRequest({
        chainId: 1,
        owner: OWNER,
        token: TOKEN,
        side: "buy",
        amount: "0",
        tokenDecimals: 18,
        slippageBps: 100,
        nowSeconds: 1_000,
      }),
    ).toThrow("greater than zero");
    expect(() =>
      buildTokenTradeApiRequest({
        chainId: 1,
        owner: OWNER,
        token: TOKEN,
        side: "sell",
        amount: "1",
        tokenDecimals: 256,
        slippageBps: 100,
        nowSeconds: 1_000,
      }),
    ).toThrow("decimals");
  });

  it("rejects slippage outside the server limit", () => {
    expect(() =>
      buildTokenTradeApiRequest({
        chainId: 1,
        owner: OWNER,
        token: TOKEN,
        side: "buy",
        amount: "1",
        tokenDecimals: 18,
        slippageBps: 1_001,
        nowSeconds: 1_000,
      }),
    ).toThrow("Slippage");
  });

  it("keeps a dynamic network-fee reserve when using the full ETH balance", () => {
    expect(
      calculateBuyMaxWei(parseEther("1"), 1_000_000_000n),
    ).toEqual({
      amountWei: parseEther("0.997"),
      reserveWei: MIN_BUY_GAS_RESERVE_WEI,
    });

    expect(
      calculateBuyMaxWei(parseEther("1"), 100_000_000_000n),
    ).toEqual({
      amountWei: parseEther("0.925"),
      reserveWei: parseEther("0.075"),
    });
    expect(
      calculateBuyMaxWei(parseEther("0.002"), 1_000_000_000n)
        .amountWei,
    ).toBe(0n);
  });

  it("calculates the approximate USD value for buys and sells", () => {
    const tokenPriceUsdWad = parseEther("2").toString();

    expect(
      calculateTradeUsdValue({
        side: "sell",
        amount: "12.5",
        tokenPriceUsdWad,
      }),
    ).toBe(25);
    expect(
      calculateTradeUsdValue({
        side: "buy",
        amount: "0.5",
        tokenPriceEth: "0.001",
        tokenPriceUsdWad,
      }),
    ).toBe(1_000);
  });

  it("derives USD trading volume from the token ETH and USD price", () => {
    expect(
      calculateEthVolumeUsdValue({
        grossVolumeEth: "300",
        tokenPriceEth: "0.002",
        tokenPriceUsdWad: parseEther("6").toString(),
      }),
    ).toBe(900_000);
    expect(
      calculateEthVolumeUsdValue({
        grossVolumeEth: "300",
        tokenPriceEth: undefined,
        tokenPriceUsdWad: parseEther("6").toString(),
      }),
    ).toBeNull();
  });

  it("derives a reviewable price impact from the onchain spot price", () => {
    expect(
      calculatePriceImpactPercent({
        side: "buy",
        amountIn: "1000000000000000000",
        amountOut: "900000000000000000000",
        tokenDecimals: 18,
        tokenPriceEth: "0.001",
      }),
    ).toBeCloseTo(11.1111, 3);
    expect(
      calculatePriceImpactPercent({
        side: "sell",
        amountIn: "1000000000000000000000",
        amountOut: "900000000000000000",
        tokenDecimals: 18,
        tokenPriceEth: "0.001",
      }),
    ).toBeCloseTo(10, 3);
  });

  it("formats token approval amounts in the token unit", () => {
    expect(formatTradeAmount("12345678", 6, "TOKEN")).toBe(
      "12.34568 TOKEN",
    );
  });
});
