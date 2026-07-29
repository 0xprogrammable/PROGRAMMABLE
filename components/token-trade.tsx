"use client";

import {
  useEffect,
  useId,
  useState,
  type FormEvent,
} from "react";
import {
  formatUnits,
  getAddress,
  parseEther,
  parseUnits,
  type Address,
  type Hex,
} from "viem";

import type { WalletTradeBalances } from "./wallet-provider";
import {
  validatePreparedTradeResponse,
  type PreparedTokenTrade,
} from "../lib/trade/client";
import styles from "./token-experience.module.css";

export type { PreparedTokenTrade } from "../lib/trade/client";

type TradeSide = "buy" | "sell";
type WalletTradeBalanceState =
  | {
      owner: Address;
      asset: Address;
      status: "ready";
      balances: WalletTradeBalances;
    }
  | {
      owner: Address;
      asset: Address;
      status: "error";
    };

export const DEFAULT_TRADE_SLIPPAGE_BPS = 100;
export const MIN_BUY_GAS_RESERVE_WEI = parseEther("0.003");
const BUY_GAS_RESERVE_UNITS = 500_000n;
const BUY_GAS_RESERVE_MULTIPLIER = 150n;

export function calculateBuyMaxWei(
  nativeBalanceWei: bigint,
  gasPriceWei: bigint,
) {
  if (nativeBalanceWei < 0n || gasPriceWei < 0n) {
    throw new Error("Wallet balances cannot be negative");
  }

  const estimatedReserve =
    (gasPriceWei * BUY_GAS_RESERVE_UNITS *
      BUY_GAS_RESERVE_MULTIPLIER) /
    100n;
  const reserveWei =
    estimatedReserve > MIN_BUY_GAS_RESERVE_WEI
      ? estimatedReserve
      : MIN_BUY_GAS_RESERVE_WEI;

  return {
    amountWei:
      nativeBalanceWei > reserveWei
        ? nativeBalanceWei - reserveWei
        : 0n,
    reserveWei,
  };
}

export function calculateTradeUsdValue(input: {
  side: TradeSide;
  amount: string;
  tokenPriceEth?: string;
  tokenPriceUsdWad?: string;
}) {
  if (
    !/^\d+(?:\.\d+)?$/.test(input.amount.trim()) ||
    !input.tokenPriceUsdWad ||
    !/^\d+$/.test(input.tokenPriceUsdWad)
  ) {
    return null;
  }

  const amount = Number(input.amount);
  const tokenUsd = Number(
    formatUnits(BigInt(input.tokenPriceUsdWad), 18),
  );
  if (
    !Number.isFinite(amount) ||
    !Number.isFinite(tokenUsd) ||
    amount < 0 ||
    tokenUsd < 0
  ) {
    return null;
  }

  if (input.side === "sell") {
    return amount * tokenUsd;
  }
  if (
    !input.tokenPriceEth ||
    !/^\d+(?:\.\d+)?$/.test(input.tokenPriceEth)
  ) {
    return null;
  }

  const tokenEth = Number(input.tokenPriceEth);
  if (!Number.isFinite(tokenEth) || tokenEth <= 0) return null;
  return amount * (tokenUsd / tokenEth);
}

export function calculateEthVolumeUsdValue(input: {
  grossVolumeEth?: string;
  tokenPriceEth?: string;
  tokenPriceUsdWad?: string;
}) {
  if (
    !input.grossVolumeEth ||
    !/^\d+(?:\.\d+)?$/.test(input.grossVolumeEth) ||
    !input.tokenPriceEth ||
    !/^\d+(?:\.\d+)?$/.test(input.tokenPriceEth) ||
    !input.tokenPriceUsdWad ||
    !/^\d+$/.test(input.tokenPriceUsdWad)
  ) {
    return null;
  }

  const grossVolumeEth = Number(input.grossVolumeEth);
  const tokenPriceEth = Number(input.tokenPriceEth);
  const tokenPriceUsd = Number(
    formatUnits(BigInt(input.tokenPriceUsdWad), 18),
  );
  if (
    !Number.isFinite(grossVolumeEth) ||
    !Number.isFinite(tokenPriceEth) ||
    !Number.isFinite(tokenPriceUsd) ||
    grossVolumeEth < 0 ||
    tokenPriceEth <= 0 ||
    tokenPriceUsd < 0
  ) {
    return null;
  }

  return grossVolumeEth * (tokenPriceUsd / tokenPriceEth);
}

function formatApproximateUsd(value: number | null) {
  if (value === null || !Number.isFinite(value) || value < 0) return "";
  if (value > 0 && value < 0.01) return "< $0.01";
  return `≈ ${new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: value >= 1_000 ? "compact" : "standard",
    maximumFractionDigits: 2,
  }).format(value)}`;
}

function formatAmountForInput(value: bigint, decimals: number) {
  return formatUnits(value, decimals).replace(/(?:\.0+|(\.\d+?)0+)$/, "$1");
}

function formatWalletBalance(value: bigint, decimals: number) {
  const numeric = Number(formatUnits(value, decimals));
  if (!Number.isFinite(numeric)) return "—";
  return new Intl.NumberFormat("en-US", {
    notation: numeric >= 1_000_000 ? "compact" : "standard",
    maximumFractionDigits: numeric >= 1 ? 4 : 6,
    maximumSignificantDigits: 7,
  }).format(numeric);
}

export function formatTradeAmount(
  amountRaw: string,
  decimals: number,
  unit: string,
) {
  return `${new Intl.NumberFormat("en-US", {
    maximumSignificantDigits: 7,
  }).format(Number(formatUnits(BigInt(amountRaw), decimals)))} ${unit}`;
}

export type TokenTradeApiRequest = {
  chainId: number;
  owner: Address;
  token: Address;
  side: TradeSide;
  amountIn: string;
  slippageBps: number;
  deadline: string;
};

export function buildTokenTradeApiRequest(input: {
  chainId: number;
  owner: string;
  token: string;
  side: TradeSide;
  amount: string;
  tokenDecimals: number;
  slippageBps: number;
  nowSeconds: number;
}): TokenTradeApiRequest {
  if (
    !Number.isInteger(input.tokenDecimals) ||
    input.tokenDecimals < 0 ||
    input.tokenDecimals > 255
  ) {
    throw new Error("Token decimals must be between 0 and 255");
  }
  if (
    !Number.isSafeInteger(input.nowSeconds) ||
    input.nowSeconds < 0
  ) {
    throw new Error("The current timestamp is invalid");
  }
  if (
    !Number.isInteger(input.slippageBps) ||
    input.slippageBps < 1 ||
    input.slippageBps > 1_000
  ) {
    throw new Error("Slippage must be between 0.01% and 10%");
  }

  let amountIn: bigint;
  try {
    amountIn = parseUnits(
      input.amount.trim(),
      input.side === "buy" ? 18 : input.tokenDecimals,
    );
  } catch {
    throw new Error("Enter a valid amount");
  }
  if (amountIn <= 0n) {
    throw new Error("The amount must be greater than zero");
  }

  return {
    chainId: input.chainId,
    owner: getAddress(input.owner),
    token: getAddress(input.token),
    side: input.side,
    amountIn: amountIn.toString(),
    slippageBps: input.slippageBps,
    deadline: String(input.nowSeconds + 1_200),
  };
}

export function TokenTrade({
  chainId,
  owner,
  token,
  hook,
  poolId,
  symbol,
  tokenDecimals = 18,
  tokenPriceEth,
  tokenPriceUsdWad,
  launchModel,
  quoteAsset,
  quoteAssetSymbol,
  tokenPriceQuote,
  buySwapFeeBps,
  sellSwapFeeBps,
  readBalances,
  onConnect,
  onPrepared,
}: {
  chainId: number;
  owner: Address | null;
  token: Address;
  hook: Address;
  poolId: Hex;
  symbol: string;
  tokenDecimals?: number;
  tokenPriceEth?: string;
  tokenPriceUsdWad?: string;
  launchModel?: "classic" | "adaptive" | "deep" | "stock-paired";
  quoteAsset?: Address;
  quoteAssetSymbol?: string;
  tokenPriceQuote?: string;
  buySwapFeeBps: number;
  sellSwapFeeBps: number;
  readBalances(inputAsset: Address): Promise<WalletTradeBalances>;
  onConnect(): void;
  onPrepared(prepared: PreparedTokenTrade): void | Promise<void>;
}) {
  const [side, setSide] = useState<TradeSide>("buy");
  const [amount, setAmount] = useState("");
  const slippageBps = DEFAULT_TRADE_SLIPPAGE_BPS;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [review, setReview] = useState<PreparedTokenTrade | null>(null);
  const [maxPending, setMaxPending] = useState(false);
  const [balanceState, setBalanceState] =
    useState<WalletTradeBalanceState | null>(null);
  const amountInputId = useId();
  const activeSwapFeeBps =
    side === "buy" ? buySwapFeeBps : sellSwapFeeBps;
  const stockPaired = launchModel === "stock-paired";
  const activeInputAsset =
    stockPaired && side === "buy" && quoteAsset ? quoteAsset : token;
  const activeInputSymbol =
    stockPaired && side === "buy"
      ? quoteAssetSymbol ?? "Quote"
      : symbol;
  const activeBalanceState =
    owner &&
    balanceState?.owner.toLowerCase() === owner.toLowerCase() &&
    balanceState.asset.toLowerCase() === activeInputAsset.toLowerCase()
      ? balanceState
      : null;
  const balances =
    activeBalanceState?.status === "ready"
      ? activeBalanceState.balances
      : null;
  const approximateUsd = formatApproximateUsd(
    calculateTradeUsdValue({
      side,
      amount,
      tokenPriceEth: stockPaired ? tokenPriceQuote : tokenPriceEth,
      tokenPriceUsdWad,
    }),
  );
  const displayBalance = balances
    ? side === "buy" && !stockPaired
      ? `${formatWalletBalance(balances.nativeBalanceWei, 18)} ETH`
      : `${formatWalletBalance(
          balances.tokenBalanceRaw,
          side === "buy" ? 18 : tokenDecimals,
        )} ${activeInputSymbol}`
    : owner
      ? activeBalanceState?.status === "error"
        ? "Balance unavailable"
        : "Loading balance"
      : "Wallet not connected";

  useEffect(() => {
    if (!owner) return;

    let active = true;
    void readBalances(activeInputAsset)
      .then((nextBalances) => {
        if (active) {
          setBalanceState({
            owner,
            asset: activeInputAsset,
            status: "ready",
            balances: nextBalances,
          });
        }
      })
      .catch(() => {
        if (active) {
          setBalanceState({
            owner,
            asset: activeInputAsset,
            status: "error",
          });
        }
      });

    return () => {
      active = false;
    };
  }, [activeInputAsset, owner, readBalances]);

  async function applyMaximumBalance() {
    setError("");
    setMessage("");
    if (!owner) {
      setError("Connect a wallet to use your balance");
      return;
    }

    setMaxPending(true);
    try {
      const balances = await readBalances(activeInputAsset);
      setBalanceState({
        owner,
        asset: activeInputAsset,
        status: "ready",
        balances,
      });
      if (side === "sell" || stockPaired) {
        if (balances.tokenBalanceRaw <= 0n) {
          throw new Error(`No ${activeInputSymbol} balance is available`);
        }
        setAmount(
          formatAmountForInput(
            balances.tokenBalanceRaw,
            side === "buy" ? 18 : tokenDecimals,
          ),
        );
        return;
      }

      const maximum = calculateBuyMaxWei(
        balances.nativeBalanceWei,
        balances.gasPriceWei,
      );
      if (maximum.amountWei <= 0n) {
        throw new Error("Not enough ETH after reserving network fees");
      }
      setAmount(formatAmountForInput(maximum.amountWei, 18));
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Your wallet balance could not be read",
      );
    } finally {
      setMaxPending(false);
    }
  }

  async function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    if (!owner) {
      setError("Connect a wallet to prepare this trade");
      return;
    }

    setPending(true);
    try {
      if (chainId !== 1 && chainId !== 11_155_111) {
        throw new Error("Trading is not supported on this network");
      }
      const body = buildTokenTradeApiRequest({
        chainId,
        owner,
        token,
        side,
        amount,
        tokenDecimals,
        slippageBps,
        nowSeconds: Math.floor(Date.now() / 1_000),
      });
      const response = await fetch("/api/trade/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const raw: unknown = await response.json();
      const responseError =
        typeof raw === "object" &&
        raw !== null &&
        "error" in raw &&
        typeof raw.error === "string"
          ? raw.error
          : "The trade could not be prepared";
      if (!response.ok) {
        throw new Error(responseError);
      }
      const payload = validatePreparedTradeResponse(raw, {
        chainId,
        owner,
        token,
        hook,
        poolId,
        launchModel,
        quoteAsset,
        side: body.side,
        amountIn: body.amountIn,
        slippageBps: body.slippageBps,
        deadline: body.deadline,
      });

      setReview(payload);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The trade could not be prepared",
      );
    } finally {
      setPending(false);
    }
  }

  async function confirmReview() {
    if (!review) return;
    setPending(true);
    setError("");
    try {
      await onPrepared(review);
      setReview(null);
      setMessage(
        review.status === "approval-required"
          ? "Approval submitted"
          : "Swap submitted",
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The transaction could not be submitted",
      );
    } finally {
      setPending(false);
    }
  }

  if (review) {
    return (
      <PreparedTradeReview
        prepared={review}
        symbol={symbol}
        tokenDecimals={tokenDecimals}
        tokenPriceEth={tokenPriceEth}
        tokenPriceQuote={tokenPriceQuote}
        launchModel={launchModel}
        quoteAssetSymbol={quoteAssetSymbol}
        totalSwapFeeBps={activeSwapFeeBps}
        pending={pending}
        error={error}
        onBack={() => {
          setReview(null);
          setError("");
        }}
        onConfirm={confirmReview}
      />
    );
  }

  return (
    <form
      className={styles.tradeForm}
      onSubmit={prepare}
      aria-label={`Trade ${symbol}`}
    >
      <header className={styles.tradeHeader}>
        <h2>Trade ${symbol}</h2>
      </header>

      <div className={styles.sideControl} role="group" aria-label="Trade side">
        <span
          aria-hidden="true"
          className={`${styles.sideIndicator} ${
            side === "sell" ? styles.sideIndicatorSell : ""
          }`}
        />
        {(["buy", "sell"] as const).map((option) => (
          <button
            className={`${styles.sideButton} ${
              side === option ? styles.sideButtonSelected : ""
            }`}
            key={option}
            type="button"
            aria-pressed={side === option}
            onClick={() => {
              setSide(option);
              setAmount("");
              setError("");
              setMessage("");
            }}
          >
            {option === "buy" ? "Buy" : "Sell"}
          </button>
        ))}
      </div>

      <div className={styles.amountCard}>
        <div className={styles.amountHeader}>
          <label htmlFor={amountInputId}>
            {side === "buy" ? "You pay" : "You sell"}
          </label>
          <span className={styles.balance}>{displayBalance}</span>
        </div>
        <div className={styles.amountInputRow}>
          <input
            className={styles.amountInput}
            id={amountInputId}
            inputMode="decimal"
            autoComplete="off"
            value={amount}
            onChange={(event) => {
              setAmount(event.target.value);
            }}
            placeholder="0"
          />
          <span className={styles.asset}>
            {side === "buy"
              ? stockPaired
                ? quoteAssetSymbol ?? "Quote"
                : "ETH"
              : `$${symbol}`}
          </span>
        </div>
        <div className={styles.amountMeta}>
          <span>{approximateUsd || "\u00A0"}</span>
          <button
            className={styles.maxButton}
            type="button"
            disabled={maxPending || !owner}
            aria-label={`Use maximum ${
              side === "buy"
                ? stockPaired
                  ? quoteAssetSymbol ?? "quote asset"
                  : "ETH"
                : symbol
            } balance`}
            onClick={() => void applyMaximumBalance()}
          >
            {maxPending ? "Loading" : "Max"}
          </button>
        </div>
      </div>

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      <div className={styles.tradeFooter}>
        <div className={styles.statusMessage} role="status">
          {message}
        </div>
        <button
          className={styles.primaryAction}
          type={owner ? "submit" : "button"}
          disabled={pending}
          onClick={owner ? undefined : onConnect}
        >
          {pending
            ? "Preparing trade"
            : owner
              ? `Review ${side}`
              : "Connect wallet"}
        </button>
      </div>
    </form>
  );
}

export function PreparedTradeReview({
  prepared,
  symbol,
  tokenDecimals,
  tokenPriceEth,
  tokenPriceQuote,
  launchModel,
  quoteAssetSymbol,
  totalSwapFeeBps,
  pending,
  error,
  onBack,
  onConfirm,
}: {
  prepared: PreparedTokenTrade;
  symbol: string;
  tokenDecimals: number;
  tokenPriceEth?: string;
  tokenPriceQuote?: string;
  launchModel?: "classic" | "adaptive" | "deep" | "stock-paired";
  quoteAssetSymbol?: string;
  totalSwapFeeBps: number;
  pending: boolean;
  error?: string;
  onBack(): void;
  onConfirm(): void | Promise<void>;
}) {
  const stockPaired = launchModel === "stock-paired";
  const outputDecimals = prepared.side === "buy" ? tokenDecimals : 18;
  const outputUnit =
    prepared.side === "buy"
      ? symbol
      : stockPaired
        ? quoteAssetSymbol ?? "Quote"
        : "ETH";
  const expectedOutput = formatTradeAmount(
    prepared.quote.amountOut,
    outputDecimals,
    outputUnit,
  );
  const minimumOutput = formatTradeAmount(
    prepared.quote.amountOutMinimum,
    outputDecimals,
    outputUnit,
  );
  const approvalAmount = formatTradeAmount(
    prepared.quote.amountIn,
    stockPaired && prepared.side === "buy" ? 18 : tokenDecimals,
    stockPaired && prepared.side === "buy"
      ? quoteAssetSymbol ?? "Quote"
      : symbol,
  );
  const priceImpact = calculatePriceImpactPercent({
    side: prepared.side,
    amountIn: prepared.quote.amountIn,
    amountOut: prepared.quote.amountOut,
    tokenDecimals,
    tokenPriceEth: stockPaired ? tokenPriceQuote : tokenPriceEth,
  });
  const approval =
    prepared.transaction.kind === "token-to-permit2"
      ? "Approve the exact token amount for Permit2"
      : prepared.transaction.kind === "permit2-to-router"
        ? "Approve the exact token amount for the Uniswap router"
        : null;

  return (
    <div
      className={styles.review}
      aria-label={`Review ${prepared.side}`}
    >
      <h2>{approval ? "Approve token" : `Review ${prepared.side}`}</h2>
      {approval ? (
        <p className={styles.reviewLead}>
          One approval is required before this trade. The approval is limited
          to this amount.
        </p>
      ) : null}
      <div className={styles.reviewOutput}>
        <span>{approval ? "Approval amount" : "Expected output"}</span>
        <strong>{approval ? approvalAmount : expectedOutput}</strong>
      </div>
      <dl className={styles.reviewDetails}>
        {!approval ? (
          <div>
            <dt>Minimum received</dt>
            <dd>{minimumOutput}</dd>
          </div>
        ) : null}
        <div>
          <dt>{launchModel === "deep" ? "Deep fee" : "Swap fee"}</dt>
          <dd>{(totalSwapFeeBps / 100).toFixed(2)}%</dd>
        </div>
        {!approval ? (
          <div>
            <dt>Estimated price impact</dt>
            <dd>
              {priceImpact === null
                ? "Unavailable"
                : `${priceImpact.toFixed(2)}%`}
            </dd>
          </div>
        ) : null}
        <div>
          <dt>Quote valid until</dt>
          <dd>
            {new Date(
              Number(prepared.quote.deadline) * 1_000,
            ).toLocaleTimeString("en-US", {
              hour: "numeric",
              minute: "2-digit",
            })}
          </dd>
        </div>
      </dl>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      <div className={styles.reviewActions}>
        <button
          className={styles.secondaryAction}
          type="button"
          disabled={pending}
          onClick={onBack}
        >
          Back
        </button>
        <button
          className={styles.primaryAction}
          type="button"
          disabled={pending}
          onClick={() => void onConfirm()}
        >
          {pending
            ? "Opening wallet"
            : approval
              ? "Sign approval"
              : `Confirm ${prepared.side}`}
        </button>
      </div>
    </div>
  );
}

export function calculatePriceImpactPercent(input: {
  side: TradeSide;
  amountIn: string;
  amountOut: string;
  tokenDecimals: number;
  tokenPriceEth?: string;
}) {
  if (
    !input.tokenPriceEth ||
    !/^\d+(?:\.\d+)?$/.test(input.tokenPriceEth)
  ) {
    return null;
  }
  const spot = Number(input.tokenPriceEth);
  const amountIn = Number(
    formatUnits(
      BigInt(input.amountIn),
      input.side === "buy" ? 18 : input.tokenDecimals,
    ),
  );
  const amountOut = Number(
    formatUnits(
      BigInt(input.amountOut),
      input.side === "buy" ? input.tokenDecimals : 18,
    ),
  );
  if (
    !Number.isFinite(spot) ||
    !Number.isFinite(amountIn) ||
    !Number.isFinite(amountOut) ||
    spot <= 0 ||
    amountIn <= 0 ||
    amountOut <= 0
  ) {
    return null;
  }
  const execution =
    input.side === "buy" ? amountIn / amountOut : amountOut / amountIn;
  const impact =
    input.side === "buy"
      ? (execution / spot - 1) * 100
      : (1 - execution / spot) * 100;
  return Math.max(0, impact);
}
