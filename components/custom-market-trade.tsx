"use client";

import { useId, useMemo, useState, type FormEvent } from "react";
import { formatUnits, getAddress, parseUnits, type Address, type Hex } from "viem";

import type {
  DiscoverableMarketTradeSideV1,
} from "@/lib/custom-launch/contract-v2";
import {
  CUSTOM_TRADE_REQUEST_SCHEMA_V1,
  validateCustomMarketTradePreparationV1,
  type CustomMarketTradePreparationV1,
  type CustomMarketTradeRequestV1,
} from "@/lib/custom-launch/trade-v1";
import type { CustomProjectExploreEntry } from "@/lib/tokens";
import type {
  WalletNativeBalance,
  WalletTradeBalances,
} from "./wallet-provider";
import styles from "./token-experience.module.css";

type CustomMarket = CustomProjectExploreEntry["markets"][number];

function assetLabel(asset: CustomMarket["baseAsset"]) {
  return asset.symbol?.trim() || asset.name?.trim() || asset.assetId;
}

function assetDecimals(asset: CustomMarket["baseAsset"]) {
  if (asset.identity.value === "0x0000000000000000000000000000000000000000") {
    return 18;
  }
  return asset.decimals;
}

function displayAmount(value: string, decimals: number, symbol: string) {
  const amount = Number(formatUnits(BigInt(value), decimals));
  const formatted = Number.isFinite(amount)
    ? new Intl.NumberFormat("en-US", { maximumSignificantDigits: 7 }).format(amount)
    : value;
  return `${formatted} ${symbol}`;
}

function currentUnixSeconds() {
  return Math.floor(Date.now() / 1_000);
}

export function CustomMarketTrade({
  project,
  chainId,
  owner,
  readNativeBalance,
  readBalances,
  onConnect,
  onSubmit,
}: {
  project: CustomProjectExploreEntry;
  chainId: number;
  owner: Address | null;
  readNativeBalance(): Promise<WalletNativeBalance>;
  readBalances(asset: Address): Promise<WalletTradeBalances>;
  onConnect(): void;
  onSubmit(transaction: CustomMarketTradePreparationV1["transaction"]): Promise<Hex>;
}) {
  const tradableMarkets = useMemo(() => project.markets.filter(
    (market) => market.tradeCapability !== undefined,
  ), [project.markets]);
  const [marketId, setMarketId] = useState(tradableMarkets[0]?.marketId ?? "");
  const market = tradableMarkets.find((candidate) => candidate.marketId === marketId)
    ?? null;
  const capability = market?.tradeCapability;
  const [selectedSide, setSelectedSide] = useState<DiscoverableMarketTradeSideV1>(
    capability?.supportedSides[0] ?? "base-to-quote",
  );
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState(
    String(Math.min(100, capability?.slippagePolicy.maximumSlippageBps ?? 100) / 100),
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [review, setReview] = useState<Readonly<{
    request: CustomMarketTradeRequestV1;
    preparation: CustomMarketTradePreparationV1;
  }> | null>(null);
  const amountId = useId();
  const slippageId = useId();
  const errorId = useId();

  if (market === null || capability === undefined) return null;
  const activeMarket = market;
  const activeCapability = capability;
  const side = activeCapability.supportedSides.includes(selectedSide)
    ? selectedSide
    : activeCapability.supportedSides[0];
  if (side === undefined) return null;
  const binding = activeCapability.sideBindings.find((candidate) => candidate.side === side);
  if (binding === undefined) return null;
  const inputAsset = binding.inputAssetId === activeMarket.baseAsset.assetId
    ? activeMarket.baseAsset : activeMarket.quoteAsset;
  const outputAsset = binding.outputAssetId === activeMarket.baseAsset.assetId
    ? activeMarket.baseAsset : activeMarket.quoteAsset;
  const inputDecimals = assetDecimals(inputAsset);
  const outputDecimals = assetDecimals(outputAsset);
  const inputSymbol = assetLabel(inputAsset);
  const outputSymbol = assetLabel(outputAsset);

  async function applyMax() {
    if (!owner || inputDecimals === undefined) return;
    setPending(true);
    setError("");
    try {
      if (binding?.inputCurrencyKind === "native") {
        const balance = await readNativeBalance();
        const reserve = balance.gasPriceWei * 750_000n * 150n / 100n;
        const maximum = balance.nativeBalanceWei > reserve
          ? balance.nativeBalanceWei - reserve : 0n;
        if (maximum <= 0n) throw new Error("Not enough native balance after reserving gas");
        setAmount(formatUnits(maximum, inputDecimals));
      } else {
        const balance = await readBalances(getAddress(inputAsset.identity.value));
        if (balance.tokenBalanceRaw <= 0n) {
          throw new Error(`No ${inputSymbol} balance is available`);
        }
        setAmount(formatUnits(balance.tokenBalanceRaw, inputDecimals));
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Balance unavailable");
    } finally {
      setPending(false);
    }
  }

  async function prepare(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!owner) {
      onConnect();
      return;
    }
    if (chainId !== 1 && chainId !== 11_155_111) {
      setError("Trading is not supported on this network");
      return;
    }
    if (inputDecimals === undefined || outputDecimals === undefined) {
      setError("Canonical token decimals are unavailable for this market");
      return;
    }
    let amountIn: bigint;
    let slippageBps: number;
    try {
      amountIn = parseUnits(amount.trim(), inputDecimals);
      const normalized = slippage.trim();
      if (!/^\d+(?:\.\d{1,2})?$/u.test(normalized)) throw new Error("Enter valid slippage");
      const [whole, fraction = ""] = normalized.split(".");
      slippageBps = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
      if (amountIn <= 0n) throw new Error("Enter an amount greater than zero");
      if (!Number.isSafeInteger(slippageBps) || slippageBps < 1
        || slippageBps > activeCapability.slippagePolicy.maximumSlippageBps) {
        throw new Error(
          `Slippage must be between 0.01% and ${activeCapability.slippagePolicy.maximumSlippageBps / 100}%`,
        );
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Enter a valid amount");
      return;
    }
    const now = currentUnixSeconds();
    const request: CustomMarketTradeRequestV1 = {
      schemaVersion: CUSTOM_TRADE_REQUEST_SCHEMA_V1,
      projectId: project.customProjectId,
      marketId: activeMarket.marketId,
      tradeCapabilityBindingHash: activeCapability.tradeCapabilityBindingHash,
      chainId,
      owner,
      recipient: owner,
      side,
      amountIn: amountIn.toString(),
      slippageBps,
      deadline: String(now + Math.min(
        1_200,
        activeCapability.deadlinePolicy.maximumHorizonSeconds,
      )),
    };
    setPending(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/custom-launch/v2/trade/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      const value: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const responseError = typeof value === "object" && value !== null
          && "error" in value && typeof value.error === "string"
          ? value.error : "The Custom trade could not be prepared";
        throw new Error(responseError);
      }
      const preparation = validateCustomMarketTradePreparationV1({
        value,
        request,
        capability: activeCapability,
        nowSeconds: now,
      });
      setReview({ request, preparation });
    } catch (caught) {
      setError(caught instanceof Error
        ? caught.message : "The Custom trade could not be prepared");
    } finally {
      setPending(false);
    }
  }

  async function confirm() {
    if (review === null) return;
    if (owner === null || getAddress(owner) !== getAddress(review.request.owner)) {
      setReview(null);
      setError("The connected wallet changed. Prepare the trade again for the current wallet");
      return;
    }
    setPending(true);
    setError("");
    try {
      const hash = await onSubmit(review.preparation.transaction);
      const wasSwap = review.preparation.transaction.kind === "swap";
      setReview(null);
      setMessage(`${wasSwap ? "Swap" : "Approval"} submitted · ${hash.slice(0, 10)}…${hash.slice(-6)}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The transaction was not submitted");
    } finally {
      setPending(false);
    }
  }

  if (review !== null && outputDecimals !== undefined) {
    return (
      <div className={styles.tradeForm} aria-busy={pending}>
        <div className={styles.customTradeReviewHeader}>
          <span>Capability-bound review</span>
          <h2>{review.preparation.status === "ready" ? "Review swap" : "Review approval"}</h2>
        </div>
        <dl className={styles.tradeFacts}>
          <div><dt>Market</dt><dd>{market.marketId}</dd></div>
          <div><dt>Direction</dt><dd>{inputSymbol} → {outputSymbol}</dd></div>
          <div><dt>Minimum received</dt><dd>{displayAmount(
            review.preparation.quote.amountOutMinimum,
            outputDecimals,
            outputSymbol,
          )}</dd></div>
          <div><dt>Recipient</dt><dd>{review.preparation.recipient.slice(0, 6)}…{review.preparation.recipient.slice(-4)}</dd></div>
        </dl>
        <p className={styles.customTradeBinding}>Route {capability.tradeCapabilityBindingHash.slice(0, 18)}…</p>
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        <div className={styles.customTradeReviewActions}>
          <button className={styles.secondaryAction} type="button" disabled={pending} onClick={() => setReview(null)}>Back</button>
          <button className={styles.primaryAction} type="button" disabled={pending} onClick={() => void confirm()}>
            {pending ? "Opening wallet" : review.preparation.status === "ready" ? "Submit swap" : "Submit approval"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <form className={styles.tradeForm} onSubmit={(event) => void prepare(event)} aria-busy={pending}>
      <label className={styles.customMarketSelect}>
        <span>Verified market</span>
        <select value={marketId} onChange={(event) => {
          const nextMarketId = event.target.value;
          const nextCapability = tradableMarkets.find(
            (candidate) => candidate.marketId === nextMarketId,
          )?.tradeCapability;
          setMarketId(nextMarketId);
          setSelectedSide(nextCapability?.supportedSides[0] ?? "base-to-quote");
          setAmount("");
          setError("");
        }}>
          {tradableMarkets.map((candidate) => (
            <option key={candidate.marketId} value={candidate.marketId}>
              {candidate.marketId} · {candidate.kind}
            </option>
          ))}
        </select>
      </label>
      <div
        className={`${styles.sideControl} ${styles.customSideControl}`}
        role="group"
        aria-label="Trade direction"
      >
        {capability.supportedSides.map((candidate) => {
          const candidateBinding = capability.sideBindings.find((item) => item.side === candidate)!;
          const from = candidateBinding.inputAssetId === market.baseAsset.assetId
            ? assetLabel(market.baseAsset) : assetLabel(market.quoteAsset);
          const to = candidateBinding.outputAssetId === market.baseAsset.assetId
            ? assetLabel(market.baseAsset) : assetLabel(market.quoteAsset);
          return (
            <button
              className={`${styles.sideButton} ${side === candidate ? styles.sideButtonSelected : ""}`}
              type="button"
              aria-pressed={side === candidate}
              key={candidate}
              onClick={() => {
                setSelectedSide(candidate);
                setAmount("");
                setError("");
              }}
            >
              {from} → {to}
            </button>
          );
        })}
      </div>
      <div className={styles.amountCard}>
        <div className={styles.amountHeader}>
          <label htmlFor={amountId}>You send</label>
          <button className={styles.maxButton} type="button" disabled={!owner || pending || inputDecimals === undefined} onClick={() => void applyMax()}>Max</button>
        </div>
        <div className={styles.amountInputRow}>
          <input id={amountId} className={styles.amountInput} inputMode="decimal" autoComplete="off" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0" aria-describedby={error ? errorId : undefined} />
          <span className={styles.asset}>{inputSymbol}</span>
        </div>
      </div>
      <dl className={styles.tradeFacts}>
        <div><dt>Route</dt><dd>Exact input · single pool</dd></div>
        <div>
          <dt><label htmlFor={slippageId}>Slippage</label></dt>
          <dd className={styles.slippageControl}>
            <input id={slippageId} inputMode="decimal" value={slippage} onChange={(event) => setSlippage(event.target.value)} />
            <span aria-hidden="true">%</span>
          </dd>
        </div>
      </dl>
      {error ? <p className={styles.error} id={errorId} role="alert">{error}</p> : null}
      <p className={styles.statusMessage} role="status">{message}</p>
      <div className={styles.tradeFooter}>
        <span>Recipient is fixed to the connected wallet</span>
        <button className={styles.primaryAction} type={owner ? "submit" : "button"} disabled={pending} onClick={owner ? undefined : onConnect}>
          {pending ? "Checking current route" : owner ? "Review trade" : "Connect wallet"}
        </button>
      </div>
    </form>
  );
}
