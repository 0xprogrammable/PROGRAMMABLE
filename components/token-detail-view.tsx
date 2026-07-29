"use client";

import Image from "next/image";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  Copy,
  ExternalLink,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  formatUnits,
  getAddress,
  isAddress,
  type Address,
  type Hex,
} from "viem";

import {
  calculateEthVolumeUsdValue,
  PreparedTradeReview,
  TokenTrade,
  type PreparedTokenTrade,
} from "@/components/token-trade";
import { TokenPriceChart } from "@/components/token-price-chart";
import { useWallet } from "@/components/wallet-provider";
import {
  canOptimizeTokenImage,
  getTokenCardImageSource,
} from "@/lib/token-image";
import { validatePreparedTradeResponse } from "@/lib/trade/client";
import {
  type LauncherToken,
  type TokenLink,
  type TokenLinkKind,
} from "@/lib/tokens";
import styles from "./token-experience.module.css";

type DetailPayload = {
  status: "ready" | "not-deployed";
  token: LauncherToken | null;
  snapshot: { chainId: number } | null;
};

type DetailState =
  | { phase: "loading"; requestKey: string }
  | { phase: "not-found"; requestKey: string }
  | { phase: "not-deployed"; requestKey: string }
  | { phase: "error"; message: string; requestKey: string }
  | {
      phase: "ready";
      token: LauncherToken;
      chainId: number;
      requestKey: string;
    };

export type TokenMetric = {
  label: string;
  value: string;
};

type TradeFlow =
  | { phase: "form" }
  | {
      phase: "review";
      prepared: PreparedTokenTrade;
      submitting: boolean;
      error?: string;
    }
  | {
      phase: "submitted";
      submitted: PreparedTokenTrade;
      hash: Hex;
      next: PreparedTokenTrade | null;
      checking: boolean;
      checkError?: string;
    };

const fallbackTokenImages = [
  "/brand/programmable-token-fallback-01-dawn.webp",
  "/brand/programmable-token-fallback-02-moon.webp",
  "/brand/programmable-token-fallback-03-sun.webp",
  "/brand/programmable-token-fallback-04-mint.webp",
  "/brand/programmable-token-fallback-05-lavender.webp",
  "/brand/programmable-token-fallback-06-dusk.webp",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTokenAddress(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);
}

function isBytes32(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[a-fA-F0-9]{64}$/.test(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
) {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function parseUnsignedDecimal(
  value: unknown,
  maximum = (1n << 256n) - 1n,
) {
  if (
    typeof value !== "string" ||
    !/^(0|[1-9]\d*)$/.test(value) ||
    value.length > 78
  ) {
    return null;
  }
  try {
    return BigInt(value) <= maximum ? value : null;
  } catch {
    return null;
  }
}

function parseUniswapV4Pool(
  value: unknown,
): LauncherToken["uniswapV4Pool"] | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "source",
      "indexedBlockNumber",
      "indexedBlockHash",
      "volumeUsdWad",
      "tvlUsdWad",
      "transactionCount",
      "liquidity",
      "sqrtPriceX96",
      "tick",
      "feeTierPips",
    ]) ||
    value.source !== "official-uniswap-v4-subgraph" ||
    !isBytes32(value.indexedBlockHash)
  ) {
    return null;
  }

  const indexedBlockNumber = parseUnsignedDecimal(
    value.indexedBlockNumber,
  );
  const volumeUsdWad = parseUnsignedDecimal(value.volumeUsdWad);
  const tvlUsdWad = parseUnsignedDecimal(value.tvlUsdWad);
  const transactionCount = parseUnsignedDecimal(
    value.transactionCount,
  );
  const liquidity = parseUnsignedDecimal(
    value.liquidity,
    (1n << 128n) - 1n,
  );
  const sqrtPriceX96 = parseUnsignedDecimal(
    value.sqrtPriceX96,
    (1n << 160n) - 1n,
  );
  const feeTierPips = parseUnsignedDecimal(
    value.feeTierPips,
    (1n << 24n) - 1n,
  );
  const tick =
    value.tick === undefined
      ? undefined
      : Number.isSafeInteger(value.tick) &&
          Number(value.tick) >= -887_272 &&
          Number(value.tick) <= 887_272
        ? Number(value.tick)
        : null;
  if (
    indexedBlockNumber === null ||
    volumeUsdWad === null ||
    tvlUsdWad === null ||
    transactionCount === null ||
    liquidity === null ||
    sqrtPriceX96 === null ||
    feeTierPips === null ||
    tick === null
  ) {
    return null;
  }

  return {
    source: value.source,
    indexedBlockNumber,
    indexedBlockHash: value.indexedBlockHash,
    volumeUsdWad,
    tvlUsdWad,
    transactionCount,
    liquidity,
    sqrtPriceX96,
    ...(tick === undefined ? {} : { tick }),
    feeTierPips,
  };
}

function safeImageUrl(value: unknown) {
  if (typeof value !== "string") return undefined;

  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      url.hostname
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}

function parseTokenLink(value: unknown): TokenLink | null {
  if (!isRecord(value)) return null;
  if (
    value.kind !== "website" &&
    value.kind !== "x" &&
    value.kind !== "telegram"
  ) {
    return null;
  }
  if (typeof value.url !== "string") return null;

  try {
    const url = new URL(value.url);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      !url.hostname
    ) {
      return null;
    }
  } catch {
    return null;
  }

  return { kind: value.kind, url: value.url };
}

function parseLauncherToken(value: unknown): LauncherToken | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    typeof value.symbol !== "string" ||
    !isTokenAddress(value.tokenAddress) ||
    !isTokenAddress(value.hookAddress) ||
    !isBytes32(value.poolId) ||
    typeof value.launchedAt !== "string" ||
    typeof value.totalSwapFeeBps !== "number" ||
    !Number.isSafeInteger(value.totalSwapFeeBps) ||
    value.totalSwapFeeBps < 0 ||
    value.liquidityPath !== "meme"
  ) {
    return null;
  }

  const links = Array.isArray(value.links)
    ? value.links
        .map(parseTokenLink)
        .filter((link): link is TokenLink => link !== null)
    : [];
  const uniswapV4Pool =
    value.uniswapV4Pool === undefined
      ? undefined
      : parseUniswapV4Pool(value.uniswapV4Pool);
  if (value.uniswapV4Pool !== undefined && uniswapV4Pool === null) {
    return null;
  }

  return {
    ...(value as unknown as LauncherToken),
    links,
    description:
      typeof value.description === "string" ? value.description : undefined,
    imageUrl: safeImageUrl(value.imageUrl),
    uniswapV4Pool: uniswapV4Pool ?? undefined,
  };
}

export function parseDetailPayload(value: unknown): DetailPayload {
  if (!isRecord(value)) {
    throw new Error("The token registry returned an invalid response");
  }
  if (value.status !== "ready" && value.status !== "not-deployed") {
    throw new Error("The token registry returned an unknown status");
  }

  const token = value.token === null ? null : parseLauncherToken(value.token);
  if (value.token !== null && token === null) {
    throw new Error("The token registry returned an invalid token record");
  }

  let snapshot: DetailPayload["snapshot"] = null;
  if (value.snapshot !== null) {
    if (
      !isRecord(value.snapshot) ||
      !Number.isSafeInteger(value.snapshot.chainId) ||
      Number(value.snapshot.chainId) <= 0
    ) {
      throw new Error("The token registry returned an invalid snapshot");
    }
    snapshot = { chainId: Number(value.snapshot.chainId) };
  }

  return { status: value.status, token, snapshot };
}

function readApiError(value: unknown) {
  return isRecord(value) && typeof value.error === "string"
    ? value.error
    : "Token data is temporarily unavailable";
}

function getFallbackTokenImage(address: string) {
  const suffix = Number.parseInt(address.slice(-8), 16);
  const index = Number.isFinite(suffix)
    ? suffix % fallbackTokenImages.length
    : 0;
  return fallbackTokenImages[index];
}

function formatEth(value: string | undefined, mode: "amount" | "price") {
  if (!value || !/^\d+(?:\.\d+)?$/.test(value)) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  if (parsed === 0) return "0 ETH";

  const minimumScientific =
    mode === "price" ? 0.00000001 : 0.0001;
  const formatted =
    parsed < minimumScientific
      ? parsed.toExponential(3)
      : new Intl.NumberFormat("en-US", {
          notation: parsed >= 1_000 ? "compact" : "standard",
          maximumFractionDigits: mode === "price" ? 8 : 5,
          maximumSignificantDigits: mode === "price" ? 6 : 7,
        }).format(parsed);
  return `${formatted} ETH`;
}

function formatUsd(valueWad: string | undefined, mode: "amount" | "price") {
  if (!valueWad || !/^\d+$/.test(valueWad)) return null;
  const value = Number(formatUnits(BigInt(valueWad), 18));
  if (!Number.isFinite(value) || value < 0) return null;
  if (value === 0) return "$0";
  if (mode === "price" && value < 0.01) {
    return `$${new Intl.NumberFormat("en-US", {
      maximumSignificantDigits: 6,
    }).format(value)}`;
  }

  if (value >= 1_000) {
    return formatCompactUsd(value, 2);
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "standard",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatCompactUsd(value: number, maximumFractionDigits: number) {
  const units = [
    { threshold: 1_000_000_000_000, suffix: "T" },
    { threshold: 1_000_000_000, suffix: "B" },
    { threshold: 1_000_000, suffix: "M" },
    { threshold: 1_000, suffix: "K" },
  ] as const;
  const unit = units.find(({ threshold }) => value >= threshold);
  if (!unit) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 2,
    }).format(value);
  }
  const compact = new Intl.NumberFormat("en-US", {
    maximumFractionDigits,
  }).format(value / unit.threshold);
  return `$${compact}${unit.suffix}`;
}

function formatUsdAmount(value: number | null) {
  if (value === null || !Number.isFinite(value) || value < 0) return null;
  if (value >= 1_000) return formatCompactUsd(value, 1);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "standard",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatQuoteAmount(
  value: string | undefined,
  symbol: string | undefined,
) {
  if (
    !value ||
    !symbol ||
    !/^\d+(?:\.\d+)?$/.test(value)
  ) {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return `${new Intl.NumberFormat("en-US", {
    notation: parsed >= 1_000 ? "compact" : "standard",
    maximumFractionDigits: parsed >= 100 ? 1 : 5,
    maximumSignificantDigits: 7,
  }).format(parsed)} ${symbol}`;
}

function formatUsdWadAmount(valueWad: string | undefined) {
  const parsed = parseUnsignedDecimal(valueWad);
  if (parsed === null) return null;
  const value = Number(formatUnits(BigInt(parsed), 18));
  return formatUsdAmount(value);
}

export function formatStockPairedGrossVolume(token: LauncherToken) {
  if (token.launchModel !== "stock-paired") return null;

  const quoteUnitVolume = formatQuoteAmount(
    token.grossVolumeQuote,
    token.quoteAssetSymbol,
  );
  if (
    !token.grossVolumeQuoteRaw ||
    !/^\d+$/.test(token.grossVolumeQuoteRaw) ||
    !token.tokenPriceQuoteWad ||
    !/^[1-9]\d*$/.test(token.tokenPriceQuoteWad) ||
    !token.tokenPriceUsdWad ||
    !/^[1-9]\d*$/.test(token.tokenPriceUsdWad)
  ) {
    return quoteUnitVolume;
  }

  const grossVolumeQuoteRaw = BigInt(token.grossVolumeQuoteRaw);
  const volumeUsdWad =
    (grossVolumeQuoteRaw * BigInt(token.tokenPriceUsdWad)) /
    BigInt(token.tokenPriceQuoteWad);
  if (grossVolumeQuoteRaw > 0n && volumeUsdWad === 0n) {
    return quoteUnitVolume;
  }

  return formatUsdWadAmount(volumeUsdWad.toString()) ?? quoteUnitVolume;
}

function formatSwapFee(value: number | undefined) {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    return null;
  }
  return `${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(value / 100)}%`;
}

export function buildTokenDetailMetrics(
  token: LauncherToken,
  marketCapOverride?: string | null,
): TokenMetric[] {
  const fallbackVolumeUsd = calculateEthVolumeUsdValue({
    grossVolumeEth: token.grossVolumeEth,
    tokenPriceEth: token.tokenPriceEth,
    tokenPriceUsdWad: token.tokenPriceUsdWad,
  });
  const officialVolumeUsd = formatUsdWadAmount(
    token.uniswapV4Pool?.volumeUsdWad,
  );
  const officialLiquidityUsd = formatUsdWadAmount(
    token.uniswapV4Pool?.tvlUsdWad,
  );
  const stockPairedVolume =
    token.launchModel === "stock-paired"
      ? formatStockPairedGrossVolume(token)
      : null;
  const hasMarketCap =
    typeof marketCapOverride === "string" ||
    token.fdvUsdWad !== undefined ||
    Boolean(token.marketCapEth) ||
    Boolean(token.marketCapQuote);
  const values: Array<TokenMetric | null> = [
    hasMarketCap
      ? {
          label: "Market cap",
          value:
            marketCapOverride ??
            formatUsd(token.fdvUsdWad, "amount") ??
            formatEth(token.marketCapEth, "amount") ??
            formatQuoteAmount(
              token.marketCapQuote,
              token.quoteAssetSymbol,
            ) ??
            "",
        }
      : null,
    officialVolumeUsd !== null ||
    token.grossVolumeEth ||
    token.grossVolumeQuote
      ? {
          label: "Volume",
          value:
            token.launchModel === "stock-paired"
              ? stockPairedVolume ?? ""
              : officialVolumeUsd ??
                formatUsdAmount(fallbackVolumeUsd) ??
                formatEth(token.grossVolumeEth, "amount") ??
                formatQuoteAmount(
                  token.grossVolumeQuote,
                  token.quoteAssetSymbol,
                ) ??
                "",
        }
      : null,
    officialLiquidityUsd !== null
      ? {
          label: "Liquidity",
          value: officialLiquidityUsd,
        }
      : null,
    token.buyHookFeeBps !== undefined &&
    token.sellHookFeeBps !== undefined &&
    token.buyHookFeeBps !== token.sellHookFeeBps
      ? {
          label: "Buy fee",
          value: formatSwapFee(token.buyHookFeeBps) ?? "",
        }
      : formatSwapFee(token.totalSwapFeeBps)
        ? {
            label:
              token.deepReleaseVersion === "deep-full-range-v3"
                ? "Deep fee"
                : "Swap fee",
            value: formatSwapFee(token.totalSwapFeeBps) ?? "",
          }
        : null,
    token.buyHookFeeBps !== undefined &&
    token.sellHookFeeBps !== undefined &&
    token.buyHookFeeBps !== token.sellHookFeeBps
      ? {
          label: "Sell fee",
          value: formatSwapFee(token.sellHookFeeBps) ?? "",
        }
      : null,
  ];

  return values.filter(
    (metric): metric is TokenMetric =>
      metric !== null && metric.value.length > 0,
  );
}

export function formatPreparedMinimum(
  prepared: PreparedTokenTrade,
  symbol: string,
  tokenDecimals: number,
) {
  try {
    const decimals = prepared.side === "buy" ? tokenDecimals : 18;
    const unit = prepared.side === "buy" ? symbol : "ETH";
    const value = formatUnits(
      BigInt(prepared.quote.amountOutMinimum),
      decimals,
    );
    const number = Number(value);
    if (!Number.isFinite(number)) return null;
    return `${new Intl.NumberFormat("en-US", {
      maximumSignificantDigits: 7,
    }).format(number)} ${unit}`;
  } catch {
    return null;
  }
}

function getLinkLabel(kind: TokenLinkKind) {
  if (kind === "website") return "Website";
  if (kind === "telegram") return "Telegram";
  return "X";
}

function XBrandIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path
        fill="currentColor"
        d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.451-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77Z"
      />
    </svg>
  );
}

function TelegramBrandIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path
        fill="currentColor"
        d="M22.8 3.2 19.5 20.1c-.25 1.2-.91 1.5-1.85.94l-5.03-3.71-2.43 2.34c-.27.27-.5.5-1.02.5l.36-5.13 9.34-8.44c.41-.36-.09-.56-.63-.2L6.7 13.67l-4.98-1.56c-1.08-.34-1.1-1.08.23-1.6L21.36 3c.9-.33 1.69.2 1.44 1.2Z"
      />
    </svg>
  );
}

function TokenLinkIcon({ kind }: { kind: TokenLinkKind }) {
  if (kind === "website") {
    return (
      <svg
        aria-hidden="true"
        className={styles.websiteIcon}
        viewBox="0 0 24 24"
      >
        <circle cx="12" cy="12" r="8.25" />
        <path d="M3.95 12h16.1M12 3.75c2.18 2.22 3.27 4.97 3.27 8.25S14.18 18.03 12 20.25C9.82 18.03 8.73 15.28 8.73 12S9.82 5.97 12 3.75Z" />
      </svg>
    );
  }
  if (kind === "telegram") return <TelegramBrandIcon />;
  return <XBrandIcon />;
}

function MetricGrid({ metrics }: { metrics: TokenMetric[] }) {
  if (metrics.length === 0) return null;

  return (
    <dl className={styles.metrics}>
      {metrics.map((metric) => (
        <div className={styles.metric} key={metric.label}>
          <dt>{metric.label}</dt>
          <dd>{metric.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function DeepLiquiditySummary({ token }: { token: LauncherToken }) {
  const target = BigInt(token.growthTargetNativeWei ?? "0");
  const added = BigInt(token.totalNativeAddedToLiquidityWei ?? "0");
  const boundedAdded = added < target ? added : target;
  const targetReached = token.growthTargetReached === true;
  const progressBps =
    targetReached
      ? 10_000
      : target === 0n
        ? 0
        : Number((boundedAdded * 10_000n) / target);
  const deferredRewards = BigInt(token.deferredRewardFeesWei ?? "0");

  return (
    <section className={styles.deepSummary} aria-label="Deep liquidity">
      <div className={styles.deepSummaryHeading}>
        <div>
          <span>Deep liquidity</span>
          <strong>
            {formatEth(formatUnits(added, 18), "amount")} added
          </strong>
        </div>
        <span>
          {targetReached
            ? "Target reached"
            : `${(progressBps / 100).toFixed(2)}%`}
        </span>
      </div>
      <div
        className={styles.deepProgress}
        role="progressbar"
        aria-label="Liquidity growth progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progressBps / 100}
      >
        <span style={{ width: `${progressBps / 100}%` }} />
      </div>
      <p>
        Creator fees deepen the original permanently locked pool before
        creator rewards begin. The 150M reserve stays locked, and unused
        reserve is not active liquidity. Automation is permissionless and not
        guaranteed.
        {deferredRewards > 0n
          ? ` ${formatEth(formatUnits(deferredRewards, 18), "amount")} in creator rewards is deferred until the liquidity target is reached.`
          : ""}
      </p>
    </section>
  );
}

function TokenDetailContent({
  token,
  chainId,
}: {
  token: LauncherToken;
  chainId: number;
}) {
  const {
    wallet,
    openWallet,
    readTradeBalances,
    sendTransaction,
  } = useWallet();
  const [copied, setCopied] = useState(false);
  const [hoveredMarketCap, setHoveredMarketCap] = useState<string | null>(
    null,
  );
  const [tradeFlow, setTradeFlow] = useState<TradeFlow>({
    phase: "form",
  });
  const copyResetTimer = useRef<number | null>(null);
  const imageUrl =
    token.imageUrl?.trim() || getFallbackTokenImage(token.tokenAddress);
  const imageSource = getTokenCardImageSource(imageUrl);
  const tokenDecimals =
    typeof token.tokenDecimals === "number" &&
    Number.isInteger(token.tokenDecimals) &&
    token.tokenDecimals >= 0 &&
    token.tokenDecimals <= 255
      ? token.tokenDecimals
      : 18;

  useEffect(
    () => () => {
      if (copyResetTimer.current !== null) {
        window.clearTimeout(copyResetTimer.current);
      }
    },
    [],
  );

  const metrics = useMemo(
    () => buildTokenDetailMetrics(token, hoveredMarketCap),
    [hoveredMarketCap, token],
  );

  const explorerBase =
    chainId === 1
      ? "https://etherscan.io"
      : chainId === 11_155_111
        ? "https://sepolia.etherscan.io"
        : null;
  const readTokenBalances = useCallback(
    (inputAsset: Address) => readTradeBalances(inputAsset),
    [readTradeBalances],
  );
  const preparedForDisplay =
    tradeFlow.phase === "submitted"
      ? (tradeFlow.next ?? tradeFlow.submitted)
      : null;
  const preparedMinimum = preparedForDisplay
    ? formatPreparedMinimum(
        preparedForDisplay,
        token.symbol,
        tokenDecimals,
      )
    : null;

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(token.tokenAddress);
      setCopied(true);
      if (copyResetTimer.current !== null) {
        window.clearTimeout(copyResetTimer.current);
      }
      copyResetTimer.current = window.setTimeout(
        () => setCopied(false),
        1600,
      );
    } catch {
      setCopied(false);
    }
  }

  async function prepareNextTrade(source: PreparedTokenTrade) {
    if (!wallet) {
      throw new Error("Connect an Ethereum wallet before continuing");
    }
    if (
      (chainId !== 1 && chainId !== 11_155_111) ||
      source.chainId !== chainId
    ) {
      throw new Error("The trade network does not match this token");
    }

    const request = {
      chainId,
      owner: wallet.account,
      token: token.tokenAddress,
      side: source.side,
      amountIn: source.quote.amountIn,
      slippageBps: source.quote.slippageBps,
      deadline: String(Math.floor(Date.now() / 1_000) + 1_200),
    };
    const response = await fetch("/api/trade/prepare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(readApiError(body));
    }
    return validatePreparedTradeResponse(body, {
      chainId,
      owner: getAddress(wallet.account),
      token: getAddress(token.tokenAddress),
      hook: getAddress(token.hookAddress),
      poolId: token.poolId,
      launchModel: token.launchModel,
      quoteAsset: token.quoteAssetAddress
        ? getAddress(token.quoteAssetAddress)
        : undefined,
      side: request.side,
      amountIn: request.amountIn,
      slippageBps: request.slippageBps,
      deadline: request.deadline,
    });
  }

  async function refreshAfterApproval(
    submitted: PreparedTokenTrade,
    hash: Hex,
  ) {
    setTradeFlow({
      phase: "submitted",
      submitted,
      hash,
      next: null,
      checking: true,
    });

    try {
      const next = await prepareNextTrade(submitted);
      setTradeFlow({
        phase: "submitted",
        submitted,
        hash,
        next,
        checking: false,
      });
    } catch (error) {
      setTradeFlow({
        phase: "submitted",
        submitted,
        hash,
        next: null,
        checking: false,
        checkError:
          error instanceof Error
            ? error.message
            : "The next trade step is not available yet",
      });
    }
  }

  async function submitPreparedTrade(prepared: PreparedTokenTrade) {
    if (!wallet) {
      throw new Error("Connect an Ethereum wallet before continuing");
    }
    if (
      prepared.token.toLowerCase() !== token.tokenAddress.toLowerCase()
    ) {
      throw new Error("The prepared trade does not match this token");
    }
    if (
      (chainId !== 1 && chainId !== 11_155_111) ||
      prepared.chainId !== chainId
    ) {
      throw new Error("The trade network does not match this token");
    }

    const validated = validatePreparedTradeResponse(prepared, {
      chainId,
      owner: getAddress(wallet.account),
      token: getAddress(token.tokenAddress),
      hook: getAddress(token.hookAddress),
      poolId: token.poolId,
      launchModel: token.launchModel,
      quoteAsset: token.quoteAssetAddress
        ? getAddress(token.quoteAssetAddress)
        : undefined,
      side: prepared.side,
      amountIn: prepared.quote.amountIn,
      slippageBps: prepared.quote.slippageBps,
      deadline: prepared.quote.deadline,
    });
    const transaction = validated.transaction;

    const hash = await sendTransaction(transaction);
    if (transaction.kind === "swap") {
      setTradeFlow({
        phase: "submitted",
        submitted: prepared,
        hash,
        next: null,
        checking: false,
      });
      return;
    }

    await refreshAfterApproval(prepared, hash);
  }

  async function continueTradeFlow() {
    if (tradeFlow.phase !== "submitted" || tradeFlow.checking) return;

    try {
      const next = tradeFlow.next;
      const submittedKind = tradeFlow.submitted.transaction.kind;
      if (next && next.transaction.kind !== submittedKind) {
        setTradeFlow({
          phase: "review",
          prepared: next,
          submitting: false,
        });
        return;
      }

      await refreshAfterApproval(
        tradeFlow.submitted,
        tradeFlow.hash,
      );
    } catch (error) {
      setTradeFlow({
        ...tradeFlow,
        checking: false,
        checkError:
          error instanceof Error
            ? error.message
            : "The next trade step could not be submitted",
      });
    }
  }

  return (
    <div className={`${styles.page} page-width`}>
      <Link className={styles.back} href="/">
        <ArrowLeft aria-hidden="true" size={16} />
        Explore
      </Link>

      <div className={styles.layout}>
        <section className={styles.overview}>
          <div className={styles.identity}>
            <div className={styles.image}>
              <Image
                src={imageSource}
                alt={
                  token.imageUrl?.trim()
                    ? `${token.name} token image`
                    : ""
                }
                fill
                priority
                sizes="(max-width: 800px) 100vw, 420px"
                unoptimized={!canOptimizeTokenImage(imageSource)}
              />
            </div>

            <div className={styles.identityCopy}>
              <span className={styles.symbol}>${token.symbol}</span>
              <h1 className={styles.name}>{token.name}</h1>
              <div className={styles.addressActions}>
                <button
                  className={styles.address}
                  type="button"
                  aria-label={
                    copied
                      ? `${token.name} contract address copied`
                      : `Copy ${token.name} contract address`
                  }
                  title={copied ? "Copied" : "Copy contract address"}
                  onClick={copyAddress}
                >
                  <code>{token.tokenAddress}</code>
                  {copied ? (
                    <Check aria-hidden="true" size={14} />
                  ) : (
                    <Copy aria-hidden="true" size={14} />
                  )}
                </button>
                {explorerBase ? (
                  <a
                    className={styles.explorerLink}
                    href={`${explorerBase}/token/${token.tokenAddress}`}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`View ${token.name} on Etherscan`}
                    title="View on Etherscan"
                  >
                    <ExternalLink aria-hidden="true" size={15} />
                  </a>
                ) : null}
              </div>
            </div>
          </div>

          {token.description?.trim() ? (
            <p className={styles.description}>
              {token.description.trim()}
            </p>
          ) : null}

          {token.links && token.links.length > 0 ? (
            <div
              className={styles.links}
              aria-label={`${token.name} links`}
            >
              {token.links.map((link) => {
                const label = getLinkLabel(link.kind);
                return (
                  <a
                    className={`${styles.socialLink} ${
                      link.kind === "website" ? styles.websiteLink : ""
                    }`}
                    href={link.url}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`${token.name} on ${label}`}
                    title={label}
                    key={`${link.kind}:${link.url}`}
                  >
                    <TokenLinkIcon kind={link.kind} />
                  </a>
                );
              })}
            </div>
          ) : null}

          <TokenPriceChart
            tokenAddress={token.tokenAddress}
            tokenName={token.name}
            totalSupply={token.totalSupply}
            launchModel={token.launchModel}
            onMarketCapChange={setHoveredMarketCap}
          />

          <MetricGrid metrics={metrics} />

          {token.launchModel === "deep" &&
          token.growthTargetNativeWei &&
          token.totalNativeAddedToLiquidityWei &&
          token.tokenReserveRaw ? (
            <DeepLiquiditySummary token={token} />
          ) : null}
        </section>

        <aside className={styles.tradeShell} aria-label={`${token.name} trade`}>
          {chainId !== 1 && chainId !== 11_155_111 ? (
            <div className={styles.submitted} role="status">
              <p>Trading is not supported on this network</p>
            </div>
          ) : tradeFlow.phase === "form" ? (
            <TokenTrade
              chainId={chainId}
              owner={wallet ? (wallet.account as Address) : null}
              token={getAddress(token.tokenAddress)}
              hook={getAddress(token.hookAddress)}
              poolId={token.poolId}
              symbol={token.symbol}
              tokenDecimals={tokenDecimals}
              tokenPriceEth={token.tokenPriceEth}
              tokenPriceUsdWad={token.tokenPriceUsdWad}
              launchModel={token.launchModel}
              quoteAsset={
                token.quoteAssetAddress
                  ? getAddress(token.quoteAssetAddress)
                  : undefined
              }
              quoteAssetSymbol={token.quoteAssetSymbol}
              tokenPriceQuote={token.tokenPriceQuote}
              buySwapFeeBps={
                token.buyHookFeeBps ?? token.totalSwapFeeBps
              }
              sellSwapFeeBps={
                token.sellHookFeeBps ?? token.totalSwapFeeBps
              }
              readBalances={readTokenBalances}
              onConnect={openWallet}
              onPrepared={submitPreparedTrade}
            />
          ) : tradeFlow.phase === "review" ? (
            <PreparedTradeReview
              prepared={tradeFlow.prepared}
              symbol={token.symbol}
              tokenDecimals={tokenDecimals}
              tokenPriceEth={token.tokenPriceEth}
              launchModel={token.launchModel}
              totalSwapFeeBps={
                tradeFlow.prepared.side === "buy"
                  ? token.buyHookFeeBps ?? token.totalSwapFeeBps
                  : token.sellHookFeeBps ?? token.totalSwapFeeBps
              }
              pending={tradeFlow.submitting}
              error={tradeFlow.error}
              onBack={() => setTradeFlow({ phase: "form" })}
              onConfirm={async () => {
                const prepared = tradeFlow.prepared;
                setTradeFlow({
                  phase: "review",
                  prepared,
                  submitting: true,
                });
                try {
                  await submitPreparedTrade(prepared);
                } catch (error) {
                  setTradeFlow({
                    phase: "review",
                    prepared,
                    submitting: false,
                    error:
                      error instanceof Error
                        ? error.message
                        : "The transaction could not be submitted",
                  });
                }
              }}
            />
          ) : (
            <div className={styles.submitted} role="status">
              <strong>
                {tradeFlow.submitted.transaction.kind === "swap"
                  ? "Swap submitted"
                  : "Approval submitted"}
              </strong>
              <p>
                Transaction{" "}
                <code>
                  {tradeFlow.hash.slice(0, 10)}…
                  {tradeFlow.hash.slice(-8)}
                </code>
              </p>
              {explorerBase ? (
                <a
                  className={styles.transactionLink}
                  href={`${explorerBase}/tx/${tradeFlow.hash}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  View transaction
                  <ExternalLink aria-hidden="true" size={15} />
                </a>
              ) : null}

              {preparedForDisplay?.transaction.kind === "swap" &&
              preparedMinimum ? (
                <p>Minimum received {preparedMinimum}</p>
              ) : null}

              {tradeFlow.checkError ? (
                <p className={styles.error} role="alert">
                  {tradeFlow.checkError}
                </p>
              ) : null}

              {tradeFlow.submitted.transaction.kind === "swap" ? (
                <button
                  className={styles.secondaryAction}
                  type="button"
                  onClick={() => setTradeFlow({ phase: "form" })}
                >
                  New trade
                </button>
              ) : (
                <button
                  className={styles.primaryAction}
                  type="button"
                  disabled={tradeFlow.checking}
                  onClick={() => void continueTradeFlow()}
                >
                  {tradeFlow.checking
                    ? "Checking approval"
                    : tradeFlow.next &&
                        tradeFlow.next.transaction.kind !==
                          tradeFlow.submitted.transaction.kind
                      ? tradeFlow.next.transaction.kind === "swap"
                        ? "Review swap"
                        : "Review next approval"
                      : "Check approval"}
                </button>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

export function TokenDetailView({ address }: { address: string }) {
  const normalizedAddress = isAddress(address) ? getAddress(address) : null;
  const [retryKey, setRetryKey] = useState(0);
  const requestKey = `${normalizedAddress ?? "invalid"}\u0000${retryKey}`;
  const [state, setState] = useState<DetailState>({
    phase: "loading",
    requestKey,
  });

  useEffect(() => {
    if (!normalizedAddress) return;

    const tokenAddress = normalizedAddress;
    const controller = new AbortController();

    async function loadToken() {
      try {
        const search = new URLSearchParams({ address: tokenAddress });
        const response = await fetch(
          `/api/explore/token?${search.toString()}`,
          {
            signal: controller.signal,
            headers: { Accept: "application/json" },
          },
        );
        const body: unknown = await response.json().catch(() => null);

        if (response.status === 404) {
          setState({ phase: "not-found", requestKey });
          return;
        }
        if (!response.ok) {
          throw new Error(readApiError(body));
        }

        const payload = parseDetailPayload(body);
        if (payload.status === "not-deployed") {
          setState({ phase: "not-deployed", requestKey });
          return;
        }
        if (!payload.token) {
          setState({ phase: "not-found", requestKey });
          return;
        }
        if (
          payload.token.tokenAddress.toLowerCase() !==
          tokenAddress.toLowerCase()
        ) {
          throw new Error("The token registry returned the wrong token");
        }
        if (!payload.snapshot) {
          throw new Error("The token registry returned no verified snapshot");
        }

        setState({
          phase: "ready",
          token: payload.token,
          chainId: payload.snapshot.chainId,
          requestKey,
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        setState({
          phase: "error",
          requestKey,
          message:
            error instanceof Error
              ? error.message
              : "Token data is temporarily unavailable",
        });
      }
    }

    void loadToken();
    return () => controller.abort();
  }, [normalizedAddress, requestKey]);

  if (!normalizedAddress) {
    return (
      <TokenDetailMessage message="This is not a valid Ethereum token address" />
    );
  }

  const activeState: DetailState =
    state.requestKey === requestKey
      ? state
      : { phase: "loading", requestKey };

  if (activeState.phase === "ready") {
    return (
      <TokenDetailContent
        token={activeState.token}
        chainId={activeState.chainId}
      />
    );
  }

  const message =
    activeState.phase === "loading"
      ? "Loading token"
          : activeState.phase === "not-found"
          ? "This token was not launched through Programmable"
          : activeState.phase === "not-deployed"
            ? "No verified launch data is available"
            : activeState.message;

  return (
    <div className={`${styles.page} page-width`}>
      <Link className={styles.back} href="/">
        <ArrowLeft aria-hidden="true" size={16} />
        Explore
      </Link>
      <div
        className={styles.emptyState}
        role={activeState.phase === "error" ? "alert" : "status"}
      >
        <p>{message}</p>
        {activeState.phase === "error" ? (
          <button
            className={styles.retry}
            type="button"
            onClick={() => setRetryKey((value) => value + 1)}
          >
            Try again
          </button>
        ) : null}
      </div>
    </div>
  );
}

function TokenDetailMessage({ message }: { message: string }) {
  return (
    <div className={`${styles.page} page-width`}>
      <Link className={styles.back} href="/">
        <ArrowLeft aria-hidden="true" size={16} />
        Explore
      </Link>
      <div className={styles.emptyState} role="status">
        <p>{message}</p>
      </div>
    </div>
  );
}
