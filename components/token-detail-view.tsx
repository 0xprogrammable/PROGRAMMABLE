"use client";

import Image from "next/image";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  Copy,
  ExternalLink,
  Globe2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  formatUnits,
  getAddress,
  isAddress,
  type Address,
  type Hex,
} from "viem";

import {
  TokenTrade,
  type PreparedTokenTrade,
} from "@/components/token-trade";
import { useWallet } from "@/components/wallet-provider";
import { validatePreparedTradeResponse } from "@/lib/trade/client";
import {
  type LauncherToken,
  type TokenLink,
  type TokenLinkKind,
} from "@/lib/tokens";

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

type TokenMetric = {
  label: string;
  value: string;
};

type TradeFlow =
  | { phase: "form" }
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

  return {
    ...(value as unknown as LauncherToken),
    links,
    description:
      typeof value.description === "string" ? value.description : undefined,
    imageUrl: safeImageUrl(value.imageUrl),
  };
}

function parseDetailPayload(value: unknown): DetailPayload {
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

function formatTokenAmount(value: string | undefined, symbol: string) {
  if (!value || !/^\d+(?:\.\d+)?$/.test(value)) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return `${new Intl.NumberFormat("en-US", {
    notation: parsed >= 1_000_000 ? "compact" : "standard",
    maximumFractionDigits: 4,
  }).format(parsed)} ${symbol}`;
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

function formatLaunchDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(date);
}

function formatPreparedMinimum(
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
    return <Globe2 aria-hidden="true" size={22} strokeWidth={1.9} />;
  }
  if (kind === "telegram") return <TelegramBrandIcon />;
  return <XBrandIcon />;
}

function MetricGrid({ metrics }: { metrics: TokenMetric[] }) {
  if (metrics.length === 0) return null;

  return (
    <dl className="token-detail-metrics">
      {metrics.map((metric) => (
        <div className="token-detail-metric" key={metric.label}>
          <dt>{metric.label}</dt>
          <dd>{metric.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function TokenDetailContent({
  token,
  chainId,
}: {
  token: LauncherToken;
  chainId: number;
}) {
  const { wallet, openWallet, sendTransaction } = useWallet();
  const [copied, setCopied] = useState(false);
  const [tradeFlow, setTradeFlow] = useState<TradeFlow>({
    phase: "form",
  });
  const copyResetTimer = useRef<number | null>(null);
  const imageUrl =
    token.imageUrl?.trim() || getFallbackTokenImage(token.tokenAddress);
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

  const metrics = useMemo(() => {
    const values: Array<TokenMetric | null> = [
      token.tokenPriceEth
        ? {
            label: "Price",
            value: formatEth(token.tokenPriceEth, "price") ?? "",
          }
        : null,
      token.marketCapEth
        ? {
            label: "Market cap",
            value: formatEth(token.marketCapEth, "amount") ?? "",
          }
        : null,
      token.grossVolumeEth
        ? {
            label: "Trading volume",
            value: formatEth(token.grossVolumeEth, "amount") ?? "",
          }
        : null,
      token.creatorFeesGeneratedEth
        ? {
            label: "Creator fees generated",
            value:
              formatEth(token.creatorFeesGeneratedEth, "amount") ?? "",
          }
        : null,
      token.creatorFeesAccruedEth
        ? {
            label: "Claimable creator fees",
            value:
              formatEth(token.creatorFeesAccruedEth, "amount") ?? "",
          }
        : null,
      token.launcherFeesGeneratedEth
        ? {
            label: "Programmable fees generated",
            value:
              formatEth(token.launcherFeesGeneratedEth, "amount") ?? "",
          }
        : null,
      formatSwapFee(token.totalSwapFeeBps)
        ? {
            label: "Swap fee",
            value: formatSwapFee(token.totalSwapFeeBps) ?? "",
          }
        : null,
      typeof token.swapCount === "number" && token.swapCount >= 0
        ? {
            label: "Swaps",
            value: new Intl.NumberFormat("en-US").format(token.swapCount),
          }
        : null,
      formatTokenAmount(token.totalSupply, token.symbol)
        ? {
            label: "Total supply",
            value:
              formatTokenAmount(token.totalSupply, token.symbol) ?? "",
          }
        : null,
    ];

    return values.filter(
      (metric): metric is TokenMetric =>
        metric !== null && metric.value.length > 0,
    );
  }, [token]);

  const launchDate = formatLaunchDate(token.launchedAt);
  const explorerBase =
    chainId === 1
      ? "https://etherscan.io"
      : chainId === 11_155_111
        ? "https://sepolia.etherscan.io"
        : null;
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
        await submitPreparedTrade(next);
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
    <div className="token-detail-page page-width">
      <Link className="launch-model-back" href="/">
        <ArrowLeft aria-hidden="true" size={16} />
        Explore
      </Link>

      <main className="token-detail-layout">
        <section className="token-detail-overview">
          <div className="token-detail-identity">
            <div className="token-detail-image">
              <Image
                src={imageUrl}
                alt={
                  token.imageUrl?.trim()
                    ? `${token.name} token image`
                    : ""
                }
                fill
                priority
                sizes="(max-width: 800px) 100vw, 420px"
                unoptimized={!imageUrl.startsWith("/")}
              />
            </div>

            <div className="token-detail-heading">
              <div>
                <h1>{token.name}</h1>
                <span>${token.symbol}</span>
              </div>
              <button
                className="token-address"
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
            </div>
          </div>

          {token.description?.trim() ? (
            <p className="token-detail-description">
              {token.description.trim()}
            </p>
          ) : null}

          {token.links && token.links.length > 0 ? (
            <div
              className="token-social-links"
              aria-label={`${token.name} links`}
            >
              {token.links.map((link) => {
                const label = getLinkLabel(link.kind);
                return (
                  <a
                    className="token-social-link"
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

          <MetricGrid metrics={metrics} />

          <div className="token-detail-records">
            {token.positionTokenId && token.positionRecipient ? (
              <section className="token-detail-record">
                <h2>Liquidity position</h2>
                <dl>
                  <div>
                    <dt>Status</dt>
                    <dd>Permanently locked</dd>
                  </div>
                  <div>
                    <dt>Position ID</dt>
                    <dd>{token.positionTokenId}</dd>
                  </div>
                  <div>
                    <dt>Position recipient</dt>
                    <dd>
                      <code>{token.positionRecipient}</code>
                    </dd>
                  </div>
                  {typeof token.tickLower === "number" &&
                  typeof token.tickUpper === "number" ? (
                    <div>
                      <dt>Tick range</dt>
                      <dd>
                        {token.tickLower} to {token.tickUpper}
                      </dd>
                    </div>
                  ) : null}
                </dl>
              </section>
            ) : null}

            <section className="token-detail-record">
              <h2>Launch record</h2>
              <dl>
                {launchDate ? (
                  <div>
                    <dt>Launched</dt>
                    <dd>{launchDate} UTC</dd>
                  </div>
                ) : null}
                {token.creatorAddress ? (
                  <div>
                    <dt>Creator</dt>
                    <dd>
                      <code>{token.creatorAddress}</code>
                    </dd>
                  </div>
                ) : null}
                <div>
                  <dt>Hook</dt>
                  <dd>
                    <code>{token.hookAddress}</code>
                  </dd>
                </div>
                <div>
                  <dt>Pool</dt>
                  <dd>
                    <code>{token.poolId}</code>
                  </dd>
                </div>
              </dl>

              {explorerBase && token.launchTransactionHash ? (
                <a
                  className="text-link"
                  href={`${explorerBase}/tx/${token.launchTransactionHash}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  View launch transaction
                  <ExternalLink aria-hidden="true" size={15} />
                </a>
              ) : null}
            </section>
          </div>
        </section>

        <aside className="token-detail-trade">
          {chainId !== 1 && chainId !== 11_155_111 ? (
            <div className="token-detail-prepared" role="status">
              <p>Trading is not supported on this network</p>
            </div>
          ) : tradeFlow.phase === "form" ? (
            <>
              {!wallet ? (
                <button
                  className="secondary-button"
                  type="button"
                  onClick={openWallet}
                >
                  Connect wallet
                </button>
              ) : null}

              <TokenTrade
                chainId={chainId}
                owner={wallet ? (wallet.account as Address) : null}
                token={getAddress(token.tokenAddress)}
                hook={getAddress(token.hookAddress)}
                poolId={token.poolId}
                symbol={token.symbol}
                tokenDecimals={tokenDecimals}
                onPrepared={submitPreparedTrade}
              />
            </>
          ) : (
            <div className="token-detail-prepared" role="status">
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
                  className="text-link"
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
                <p className="form-error" role="alert">
                  {tradeFlow.checkError}
                </p>
              ) : null}

              {tradeFlow.submitted.transaction.kind === "swap" ? (
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setTradeFlow({ phase: "form" })}
                >
                  New trade
                </button>
              ) : (
                <button
                  className="primary-button"
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
      </main>
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
    <div className="token-detail-page page-width">
      <Link className="launch-model-back" href="/">
        <ArrowLeft aria-hidden="true" size={16} />
        Explore
      </Link>
      <div
        className="token-empty"
        role={activeState.phase === "error" ? "alert" : "status"}
      >
        <p>{message}</p>
        {activeState.phase === "error" ? (
          <button
            className="text-button"
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
    <div className="token-detail-page page-width">
      <Link className="launch-model-back" href="/">
        <ArrowLeft aria-hidden="true" size={16} />
        Explore
      </Link>
      <div className="token-empty" role="status">
        <p>{message}</p>
      </div>
    </div>
  );
}
