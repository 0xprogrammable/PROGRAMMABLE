"use client";

import {
  useState,
  type FormEvent,
} from "react";
import {
  formatUnits,
  getAddress,
  parseUnits,
  type Address,
  type Hex,
} from "viem";

import {
  validatePreparedTradeResponse,
  type PreparedTokenTrade,
} from "../lib/trade/client";

export type { PreparedTokenTrade } from "../lib/trade/client";

type TradeSide = "buy" | "sell";
export const DEFAULT_TRADE_SLIPPAGE_BPS = 100;

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
  totalSwapFeeBps,
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
  totalSwapFeeBps: number;
  onPrepared(prepared: PreparedTokenTrade): void | Promise<void>;
}) {
  const [side, setSide] = useState<TradeSide>("buy");
  const [amount, setAmount] = useState("");
  const [slippageBps, setSlippageBps] = useState(
    DEFAULT_TRADE_SLIPPAGE_BPS,
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [review, setReview] = useState<PreparedTokenTrade | null>(null);

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
        totalSwapFeeBps={totalSwapFeeBps}
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
      className="launch-form-panel"
      onSubmit={prepare}
      aria-label={`Trade ${symbol}`}
    >
      <div className="form-section">
        <div className="form-section-heading">
          <h2>Trade {symbol}</h2>
        </div>

        <div className="choice-list asset-choice-list">
          {(["buy", "sell"] as const).map((option) => (
            <button
              className={`choice-row ${
                side === option ? "selected" : ""
              }`}
              key={option}
              type="button"
              aria-pressed={side === option}
              onClick={() => {
                setSide(option);
                setError("");
                setMessage("");
              }}
            >
              <span className="choice-indicator" aria-hidden="true" />
              <span className="choice-copy">
                <strong>
                  {option === "buy" ? "Buy" : "Sell"}
                </strong>
                <small>
                  {option === "buy"
                    ? `ETH to ${symbol}`
                    : `${symbol} to ETH`}
                </small>
              </span>
            </button>
          ))}
        </div>

        <div className="field-group">
          <div className="two-column-fields">
            <label className="field">
              <span>
                Amount in {side === "buy" ? "ETH" : symbol}
              </span>
              <input
                inputMode="decimal"
                autoComplete="off"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder="0.0"
              />
            </label>

            <label className="field">
              <span>Maximum slippage %</span>
              <input
                inputMode="decimal"
                type="number"
                min="0.01"
                max="10"
                step="0.01"
                value={slippageBps / 100}
                onChange={(event) =>
                  setSlippageBps(
                    Math.round(Number(event.target.value) * 100),
                  )
                }
              />
            </label>
          </div>
        </div>
      </div>

      {error ? (
        <p className="form-error form-error-block" role="alert">
          {error}
        </p>
      ) : null}

      <div className="form-navigation">
        <span role="status">{message}</span>
        <button
          className="primary-button"
          type="submit"
          disabled={pending || !owner}
        >
          {pending ? "Preparing" : `Review ${side}`}
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
  totalSwapFeeBps: number;
  pending: boolean;
  error?: string;
  onBack(): void;
  onConfirm(): void | Promise<void>;
}) {
  const outputDecimals = prepared.side === "buy" ? tokenDecimals : 18;
  const outputUnit = prepared.side === "buy" ? symbol : "ETH";
  const expectedOutput = `${new Intl.NumberFormat("en-US", {
    maximumSignificantDigits: 7,
  }).format(Number(formatUnits(BigInt(prepared.quote.amountOut), outputDecimals)))} ${outputUnit}`;
  const minimumOutput = `${new Intl.NumberFormat("en-US", {
    maximumSignificantDigits: 7,
  }).format(Number(formatUnits(BigInt(prepared.quote.amountOutMinimum), outputDecimals)))} ${outputUnit}`;
  const priceImpact = calculatePriceImpactPercent({
    side: prepared.side,
    amountIn: prepared.quote.amountIn,
    amountOut: prepared.quote.amountOut,
    tokenDecimals,
    tokenPriceEth,
  });
  const approval =
    prepared.transaction.kind === "token-to-permit2"
      ? "Approve the exact token amount for Permit2"
      : prepared.transaction.kind === "permit2-to-router"
        ? "Approve the exact token amount for the Uniswap router"
        : null;

  return (
    <div
      className="launch-form-panel trade-review"
      aria-label={`Review ${prepared.side}`}
    >
      <div className="form-section">
        <div className="form-section-heading">
          <h2>{approval ? "Review approval" : `Review ${prepared.side}`}</h2>
        </div>
        {approval ? <p>{approval}</p> : null}
        <dl className="trade-review-details">
          <div>
            <dt>Expected output</dt>
            <dd>{expectedOutput}</dd>
          </div>
          <div>
            <dt>Minimum received</dt>
            <dd>{minimumOutput}</dd>
          </div>
          <div>
            <dt>Swap fee</dt>
            <dd>{(totalSwapFeeBps / 100).toFixed(2)}%</dd>
          </div>
          <div>
            <dt>Estimated price impact</dt>
            <dd>
              {priceImpact === null
                ? "Unavailable"
                : `${priceImpact.toFixed(2)}%`}
            </dd>
          </div>
          <div>
            <dt>Deadline</dt>
            <dd>
              {new Date(
                Number(prepared.quote.deadline) * 1_000,
              ).toLocaleTimeString("en-US", {
                hour: "numeric",
                minute: "2-digit",
                timeZoneName: "short",
              })}
            </dd>
          </div>
        </dl>
      </div>
      {error ? (
        <p className="form-error form-error-block" role="alert">
          {error}
        </p>
      ) : null}
      <div className="form-navigation trade-review-actions">
        <button
          className="secondary-button"
          type="button"
          disabled={pending}
          onClick={onBack}
        >
          Back
        </button>
        <button
          className="primary-button"
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
