"use client";

import {
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  CircleDollarSign,
  Code2,
  Copy,
  Droplets,
  LoaderCircle,
  Minus,
  Search,
} from "lucide-react";
import type {
  LaunchPreflightCheck,
  LaunchPreflightResponse,
} from "@/lib/launch-transaction";
import {
  behaviorDefinitions,
  buildLaunchSummary,
  buildPlainTextPlan,
  createEmptyDraft,
  findBehavior,
  getBehaviorTierLabel,
  hasReviewBehavior,
  normalizeBehaviorSelection,
  PLATFORM_FEE_BPS,
  type AssetMode,
  type BehaviorId,
  type BehaviorTier,
  type LaunchDraft,
  type LiquidityMode,
} from "@/lib/launch";
import {
  saveLocalDraft,
  useLocalDraft,
} from "@/components/local-draft";
import { useWallet } from "@/components/wallet-provider";

type TokenResult = {
  address: `0x${string}`;
  name: string | null;
  symbol: string | null;
  decimals: number | null;
  totalSupply: string | null;
  metadataComplete: boolean;
  factoryVerified: boolean;
  recordedCreator: `0x${string}` | null;
  factoryAddress: `0x${string}`;
};

const steps = [
  { number: 1, label: "Launch type" },
  { number: 2, label: "Token" },
  { number: 3, label: "Pool" },
  { number: 4, label: "Review" },
];

const assetOptions: {
  id: AssetMode;
  name: string;
  description: string;
}[] = [
  {
    id: "new",
    name: "Create a token",
    description:
      "Create a fixed supply ERC-20 without transfer taxes, rebases or sell restrictions",
  },
  {
    id: "existing",
    name: "Use an existing Uniswap token",
    description:
      "Open a pool for a fixed supply token created through Uniswap UERC20Factory",
  },
];

const liquidityOptions: {
  id: LiquidityMode;
  name: string;
  description: string;
  detail: string;
  icon: typeof CircleDollarSign;
}[] = [
  {
    id: "auction",
    name: "Auction launch",
    description:
      "Let demand establish the opening price and fund the first pool",
    detail:
      "Auction proceeds and reserved tokens seed the pool without a creator ETH deposit",
    icon: CircleDollarSign,
  },
  {
    id: "direct",
    name: "Direct v4 pool",
    description:
      "Open trading with liquidity supplied by the creator",
    detail:
      "Set the token and ETH amounts used to initialize the pool",
    icon: Droplets,
  },
];

function isPositiveNumber(value: string) {
  const normalized = value.trim();
  if (!/^(0|[1-9]\d*)(?:\.\d+)?$/.test(normalized)) {
    return false;
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0;
}

function percentageIsValid(value: string) {
  if (!isPositiveNumber(value)) return false;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 100;
}

function updateDraft(
  setDraft: Dispatch<SetStateAction<LaunchDraft>>,
  patch: Partial<LaunchDraft>,
) {
  setDraft((current) => ({ ...current, ...patch }));
}

function shortenAddress(address: string) {
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

function createLaunchSalt() {
  const bytes = new Uint8Array(32);
  window.crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")}`;
}

function getLaunchCheckKey(
  draft: LaunchDraft,
  account?: string,
  chainId?: string,
) {
  return JSON.stringify([draft, account ?? "", chainId ?? ""]);
}

export function LaunchBuilder() {
  const localDraft = useLocalDraft();

  if (localDraft === undefined) {
    return (
      <div className="launch-page page-width">
        <header className="page-heading">
          <p className="eyebrow">Launch</p>
          <h1>Create a token</h1>
          <p>Choose the launch, token and Uniswap v4 pool behavior</p>
        </header>
        <div className="launch-loading" aria-label="Loading launch" />
      </div>
    );
  }

  return (
    <LaunchBuilderForm initialDraft={localDraft ?? createEmptyDraft()} />
  );
}

function LaunchBuilderForm({
  initialDraft,
}: {
  initialDraft: LaunchDraft;
}) {
  const { wallet, openWallet, sendTransaction } = useWallet();
  const [draft, setDraft] = useState<LaunchDraft>(() => ({
    ...initialDraft,
    ...(initialDraft.liquidityMode === "auction"
      ? {
          auctionSalePercent: "50",
          auctionLiquidityPercent: "100",
        }
      : {}),
    lpFeePercent: initialDraft.selectedBehaviors.includes("fixed-fee")
      ? "0.30"
      : initialDraft.lpFeePercent,
  }));
  const [step, setStep] = useState(1);
  const [formError, setFormError] = useState("");
  const [tokenResult, setTokenResult] = useState<TokenResult | null>(null);
  const [tokenLoading, setTokenLoading] = useState(false);
  const [tokenError, setTokenError] = useState("");
  const [notice, setNotice] = useState("");
  const [preflightState, setPreflightState] = useState<{
    key: string;
    result: LaunchPreflightResponse;
  } | null>(null);
  const [preflightLoadingKey, setPreflightLoadingKey] = useState("");
  const [preflightErrorState, setPreflightErrorState] = useState<{
    key: string;
    message: string;
  } | null>(null);
  const [transactionSendingKey, setTransactionSendingKey] = useState("");
  const [transactionState, setTransactionState] = useState<{
    key: string;
    hash: string;
  } | null>(null);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 2400);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const summary = useMemo(() => buildLaunchSummary(draft), [draft]);
  const launchCheckKey = useMemo(
    () =>
      getLaunchCheckKey(draft, wallet?.account, wallet?.chainId),
    [draft, wallet?.account, wallet?.chainId],
  );
  const preflight =
    preflightState?.key === launchCheckKey
      ? preflightState.result
      : null;
  const preflightLoading = preflightLoadingKey === launchCheckKey;
  const preflightError =
    preflightErrorState?.key === launchCheckKey
      ? preflightErrorState.message
      : "";
  const transactionSending =
    transactionSendingKey === launchCheckKey;
  const transactionHash =
    transactionState?.key === launchCheckKey
      ? transactionState.hash
      : "";
  const selectedDefinitions = useMemo(
    () =>
      draft.selectedBehaviors
        .map(findBehavior)
        .filter((behavior) => Boolean(behavior)),
    [draft.selectedBehaviors],
  );

  function validateAsset() {
    if (draft.assetMode === "new") {
      if (!draft.tokenName.trim()) return "Enter a token name";
      if (!draft.tokenSymbol.trim()) return "Enter a token symbol";
      if (!isPositiveNumber(draft.tokenSupply)) {
        return "Enter a token supply greater than zero";
      }
      return "";
    }

    if (!tokenResult || tokenResult.address !== draft.tokenAddress) {
      return "Read the token contract before continuing";
    }
    if (!tokenResult.metadataComplete) {
      return "This contract does not expose complete standard ERC-20 metadata";
    }
    if (!tokenResult.factoryVerified || !tokenResult.recordedCreator) {
      return "This launch path only accepts tokens created through the configured Uniswap UERC20Factory";
    }
    if (!wallet) {
      return "Connect the token creator wallet before continuing";
    }
    if (
      wallet.account.toLowerCase() !==
      tokenResult.recordedCreator.toLowerCase()
    ) {
      return "Connect the creator address recorded by the token contract";
    }
    return "";
  }

  function validateMarket() {
    if (
      draft.assetMode === "existing" &&
      draft.liquidityMode !== "direct"
    ) {
      return "Existing Uniswap tokens use direct liquidity";
    }

    if (draft.liquidityMode === "auction") {
      if (!isPositiveNumber(draft.auctionFloorValuationEth)) {
        return "Enter a minimum valuation greater than zero";
      }
    } else if (
      !isPositiveNumber(draft.directEthAmount) ||
      !isPositiveNumber(draft.directTokenAmount) ||
      !isPositiveNumber(draft.directTokensPerEth)
    ) {
      return "Enter the ETH amount, token amount and opening rate";
    }

    if (
      draft.selectedBehaviors.includes("fixed-fee") &&
      !percentageIsValid(draft.lpFeePercent)
    ) {
      return "Enter a pool fee between 0 and 100 percent";
    }
    if (
      draft.selectedBehaviors.includes("dynamic-fee") &&
      draft.liquidityMode !== "auction"
    ) {
      return "Bounded dynamic fees are available with an auction launch";
    }

    if (
      draft.selectedBehaviors.includes("custom-hook") &&
      !draft.customHookSource.trim()
    ) {
      return "Add a source repository or verified source link for the custom hook";
    }

    return "";
  }

  function continueTo(nextStep: number) {
    const error =
      step === 2 ? validateAsset() : step === 3 ? validateMarket() : "";
    if (error) {
      setFormError(error);
      return;
    }
    setFormError("");
    setStep(nextStep);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function readToken() {
    setTokenLoading(true);
    setTokenError("");
    setTokenResult(null);

    try {
      const response = await fetch(
        `/api/token?address=${encodeURIComponent(draft.tokenAddress)}`,
        { cache: "no-store" },
      );
      const body = (await response.json()) as TokenResult | { error: string };

      if (!response.ok || "error" in body) {
        throw new Error(
          "error" in body ? body.error : "The token could not be read",
        );
      }

      setTokenResult(body);
      updateDraft(setDraft, {
        tokenAddress: body.address,
        existingTokenName: body.name ?? "",
        existingTokenSymbol: body.symbol ?? "",
        existingTokenSupply: body.totalSupply ?? "",
      });
    } catch (caught) {
      setTokenError(
        caught instanceof Error
          ? caught.message
          : "The token could not be read",
      );
    } finally {
      setTokenLoading(false);
    }
  }

  function toggleBehavior(id: BehaviorId) {
    updateDraft(setDraft, {
      selectedBehaviors: normalizeBehaviorSelection(
        draft.selectedBehaviors,
        id,
      ),
      ...(id === "fixed-fee" ? { lpFeePercent: "0.30" } : {}),
    });
  }

  function saveDraft() {
    const saved = { ...draft, updatedAt: new Date().toISOString() };
    saveLocalDraft(saved);
    setDraft(saved);
    setNotice("Token saved in this browser");
  }

  async function copyPlan() {
    await navigator.clipboard.writeText(buildPlainTextPlan(draft));
    setNotice("Token summary copied");
  }

  async function requestLaunchCheck(checkedDraft: LaunchDraft) {
    if (!wallet) {
      throw new Error("Connect an Ethereum wallet before continuing");
    }

    const response = await fetch("/api/launch/preflight", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        account: wallet.account,
        walletChainId: wallet.chainId,
        draft: checkedDraft,
      }),
    });
    const body = (await response.json()) as
      | LaunchPreflightResponse
      | { error: string };
    if (!response.ok || "error" in body) {
      throw new Error(
        "error" in body
          ? body.error
          : "The launch could not be checked",
      );
    }
    return body;
  }

  async function checkLaunch() {
    if (!wallet) {
      openWallet();
      return;
    }

    let checkedDraft = draft;
    if (
      !/^0x[a-fA-F0-9]{64}$/.test(draft.launchSalt)
    ) {
      checkedDraft = {
        ...draft,
        launchSalt: createLaunchSalt(),
        updatedAt: new Date().toISOString(),
      };
      setDraft(checkedDraft);
      saveLocalDraft(checkedDraft);
    }

    let checkKey = getLaunchCheckKey(
      checkedDraft,
      wallet.account,
      wallet.chainId,
    );
    setPreflightLoadingKey(checkKey);
    setPreflightErrorState(null);
    setTransactionState(null);

    try {
      let result = await requestLaunchCheck(checkedDraft);
      if (result.draftPatch) {
        checkedDraft = {
          ...checkedDraft,
          ...result.draftPatch,
          updatedAt: new Date().toISOString(),
        };
        setDraft(checkedDraft);
        saveLocalDraft(checkedDraft);
        checkKey = getLaunchCheckKey(
          checkedDraft,
          wallet.account,
          wallet.chainId,
        );
        setPreflightLoadingKey(checkKey);
        result = await requestLaunchCheck(checkedDraft);
      }
      setPreflightState({ key: checkKey, result });
    } catch (caught) {
      setPreflightState(null);
      setPreflightErrorState({
        key: checkKey,
        message:
          caught instanceof Error
            ? caught.message
            : "The launch could not be checked",
      });
    } finally {
      setPreflightLoadingKey("");
    }
  }

  async function submitPreparedTransaction() {
    if (!wallet || !preflight?.transaction || !preflight.planHash) {
      return;
    }

    setTransactionSendingKey(launchCheckKey);
    setPreflightErrorState(null);
    try {
      const refreshed = await requestLaunchCheck(draft);
      if (refreshed.draftPatch) {
        const patchedDraft = {
          ...draft,
          ...refreshed.draftPatch,
          updatedAt: new Date().toISOString(),
        };
        const patchedKey = getLaunchCheckKey(
          patchedDraft,
          wallet.account,
          wallet.chainId,
        );
        setDraft(patchedDraft);
        saveLocalDraft(patchedDraft);
        setPreflightState({
          key: patchedKey,
          result: refreshed,
        });
        setNotice("Auction timing updated");
        return;
      }
      setPreflightState({
        key: launchCheckKey,
        result: refreshed,
      });
      if (
        !refreshed.transaction ||
        refreshed.planHash !== preflight.planHash
      ) {
        setNotice("Launch check updated");
        return;
      }

      const hash = await sendTransaction(refreshed.transaction);
      setTransactionState({ key: launchCheckKey, hash });
      setNotice(
        refreshed.transaction.kind === "approval"
          ? "Approval submitted"
          : refreshed.transaction.kind === "lock-setup"
            ? "LP lock submitted"
            : refreshed.transaction.kind === "hook-setup"
              ? "Fee hook submitted"
          : "Launch submitted",
      );
    } catch (caught) {
      setPreflightErrorState({
        key: launchCheckKey,
        message:
          caught instanceof Error
            ? caught.message
            : "The final launch check or wallet request did not complete",
      });
    } finally {
      setTransactionSendingKey("");
    }
  }

  return (
    <div className="launch-page page-width">
      <header className="launch-page-heading">
        <div>
          <p className="eyebrow">Launch</p>
          <h1>Create a token</h1>
        </div>
        <p>Choose the launch, token and Uniswap v4 pool behavior</p>
      </header>

      <section className="launch-workspace">
        <ol className="step-navigation" aria-label="Launch steps">
          {steps.map((item) => (
            <li
              key={item.number}
              className={
                step === item.number
                  ? "current"
                  : step > item.number
                    ? "complete"
                    : undefined
              }
            >
              <button
                type="button"
                onClick={() => {
                  if (item.number <= step) {
                    setFormError("");
                    setStep(item.number);
                  }
                }}
                disabled={item.number > step}
                aria-current={step === item.number ? "step" : undefined}
              >
                <span>
                  {step > item.number ? <Check size={14} /> : item.number}
                </span>
                {item.label}
              </button>
            </li>
          ))}
        </ol>

        <div className="launch-layout">
          <div className="launch-form-panel">
          {step === 1 ? (
            <LaunchTypeStep draft={draft} setDraft={setDraft} />
          ) : null}

          {step === 2 ? (
            <AssetStep
              draft={draft}
              setDraft={setDraft}
              tokenResult={tokenResult}
              tokenLoading={tokenLoading}
              tokenError={tokenError}
              onReadToken={readToken}
            />
          ) : null}

          {step === 3 ? (
            <PoolStep
              draft={draft}
              setDraft={setDraft}
              onToggleBehavior={toggleBehavior}
            />
          ) : null}

          {step === 4 ? (
            <ReviewStep
              draft={draft}
              summary={summary}
              selectedDefinitions={selectedDefinitions}
              walletConnected={Boolean(wallet)}
              preflight={preflight}
              preflightLoading={preflightLoading}
              preflightError={preflightError}
              transactionSending={transactionSending}
              transactionHash={transactionHash}
              onCheck={checkLaunch}
              onSubmit={submitPreparedTransaction}
              onSave={saveDraft}
              onCopy={copyPlan}
              onBack={() => {
                setFormError("");
                setStep(3);
              }}
            />
          ) : null}

          {formError ? (
            <p className="form-error form-error-block" role="alert">
              {formError}
            </p>
          ) : null}

          {step < 4 ? (
            <div className="form-navigation">
              {step > 1 ? (
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => {
                    setFormError("");
                    setStep(step - 1);
                  }}
                >
                  <ArrowLeft aria-hidden="true" size={16} />
                  Back
                </button>
              ) : (
                <span />
              )}
              <button
                className="primary-button"
                type="button"
                onClick={() => continueTo(step + 1)}
              >
                Continue
                <ArrowRight aria-hidden="true" size={16} />
              </button>
            </div>
          ) : null}
          </div>
        </div>
      </section>

      <div className="toast-region" aria-live="polite" aria-atomic="true">
        {notice ? (
          <p className="toast">
            <Check aria-hidden="true" size={16} />
            {notice}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function LaunchTypeStep({
  draft,
  setDraft,
}: {
  draft: LaunchDraft;
  setDraft: Dispatch<SetStateAction<LaunchDraft>>;
}) {
  return (
    <div className="form-section launch-type-section">
      <div className="form-section-heading">
        <div>
          <p className="step-kicker">Step 1</p>
          <h2>Choose how trading starts</h2>
          <p>The launch type sets the opening price and first liquidity</p>
        </div>
      </div>

      <div className="launch-type-grid">
        {liquidityOptions.map((option) => {
          const Icon = option.icon;
          const selected = draft.liquidityMode === option.id;
          const unavailable =
            draft.assetMode === "existing" && option.id === "auction";

          return (
            <button
              key={option.id}
              className={`launch-type-option ${selected ? "selected" : ""}`}
              type="button"
              aria-pressed={selected}
              disabled={unavailable}
              onClick={() =>
                updateDraft(setDraft, {
                  liquidityMode: option.id,
                  ...(option.id === "auction"
                    ? {
                        auctionSalePercent: "50",
                        auctionLiquidityPercent: "100",
                        auctionStartBlock: "",
                        auctionEndBlock: "",
                        auctionClaimBlock: "",
                        auctionMigrationBlock: "",
                      }
                    : draft.selectedBehaviors.includes("dynamic-fee")
                      ? {
                          selectedBehaviors: ["fixed-fee"] as BehaviorId[],
                          lpFeePercent: "0.30",
                        }
                      : {}),
                })
              }
            >
              <span className="launch-type-icon" aria-hidden="true">
                <Icon size={20} strokeWidth={1.7} />
              </span>
              <span className="launch-type-copy">
                <strong>{option.name}</strong>
                <small>{option.description}</small>
                <em>{option.detail}</em>
              </span>
              <span className="choice-indicator" aria-hidden="true">
                {selected ? <Check size={14} /> : null}
              </span>
            </button>
          );
        })}
      </div>

      <div className="launch-type-note">
        <span>Every path opens a Uniswap v4 pool</span>
        <span>Initial liquidity stays locked</span>
        <span>LP fees go to the creator</span>
      </div>
    </div>
  );
}

function AssetStep({
  draft,
  setDraft,
  tokenResult,
  tokenLoading,
  tokenError,
  onReadToken,
}: {
  draft: LaunchDraft;
  setDraft: Dispatch<SetStateAction<LaunchDraft>>;
  tokenResult: TokenResult | null;
  tokenLoading: boolean;
  tokenError: string;
  onReadToken: () => void;
}) {
  return (
    <div className="form-section">
      <div className="form-section-heading">
        <div>
          <p className="step-kicker">Step 2</p>
          <h2>Token</h2>
          <p>
            Create a fixed supply token or use one from Uniswap UERC20Factory
          </p>
        </div>
      </div>

      <div className="choice-list asset-choice-list">
        {assetOptions.map((option) => {
          const selected = draft.assetMode === option.id;
          return (
            <button
              key={option.id}
              className={`choice-row ${selected ? "selected" : ""}`}
              type="button"
              aria-pressed={selected}
              onClick={() => {
                updateDraft(setDraft, {
                  assetMode: option.id,
                  ...(option.id === "existing"
                    ? { liquidityMode: "direct" as const }
                    : {}),
                });
              }}
            >
              <span className="choice-indicator" aria-hidden="true">
                {selected ? <Check size={14} /> : null}
              </span>
              <span className="choice-copy">
                <strong>{option.name}</strong>
                <small>{option.description}</small>
              </span>
            </button>
          );
        })}
      </div>

      {draft.assetMode === "new" ? (
        <div className="field-group">
          <div className="two-column-fields">
            <label className="field">
              <span>Token name</span>
              <input
                value={draft.tokenName}
                maxLength={48}
                placeholder="Example Token"
                onChange={(event) =>
                  updateDraft(setDraft, { tokenName: event.target.value })
                }
              />
            </label>
            <label className="field">
              <span>Symbol</span>
              <input
                value={draft.tokenSymbol}
                maxLength={12}
                placeholder="EXAMPLE"
                spellCheck={false}
                onChange={(event) =>
                  updateDraft(setDraft, {
                    tokenSymbol: event.target.value
                      .toUpperCase()
                      .replace(/\s/g, ""),
                  })
                }
              />
            </label>
          </div>
          <label className="field">
            <span>Fixed supply</span>
            <input
              value={draft.tokenSupply}
              inputMode="decimal"
              placeholder="1000000000"
              onChange={(event) =>
                updateDraft(setDraft, { tokenSupply: event.target.value })
              }
            />
            <small>
              Fixed supply with no minting after deployment
            </small>
          </label>
          <label className="field">
            <span>Description</span>
            <textarea
              value={draft.tokenDescription}
              maxLength={280}
              rows={4}
              placeholder="Describe what the token represents"
              onChange={(event) =>
                updateDraft(setDraft, {
                  tokenDescription: event.target.value,
                })
              }
            />
            <small>{draft.tokenDescription.length}/280</small>
          </label>
        </div>
      ) : null}

      {draft.assetMode === "existing" ? (
        <div className="field-group">
          <label className="field">
            <span>Ethereum token address</span>
            <div className="input-action">
              <input
                className="mono-input"
                value={draft.tokenAddress}
                placeholder="0x…"
                spellCheck={false}
                onChange={(event) => {
                  updateDraft(setDraft, { tokenAddress: event.target.value });
                }}
              />
              <button
                className="secondary-button"
                type="button"
                disabled={tokenLoading || !draft.tokenAddress.trim()}
                onClick={onReadToken}
              >
                {tokenLoading ? (
                  <LoaderCircle
                    className="spin"
                    aria-hidden="true"
                    size={16}
                  />
                ) : (
                  <Search aria-hidden="true" size={16} />
                )}
                {tokenLoading ? "Reading" : "Read token"}
              </button>
            </div>
          </label>

          {tokenError ? (
            <p className="form-error" role="alert">
              {tokenError}
            </p>
          ) : null}

          {tokenResult ? (
            <div className="token-readout">
              <div className="token-readout-heading">
                <CheckCircle2 aria-hidden="true" size={19} />
                <div>
                  <strong>
                    {tokenResult.name ?? "Name unavailable"}{" "}
                    {tokenResult.symbol ? `(${tokenResult.symbol})` : ""}
                  </strong>
                  <span>{tokenResult.address}</span>
                </div>
              </div>
              <dl>
                <div>
                  <dt>Decimals</dt>
                  <dd>{tokenResult.decimals ?? "Unavailable"}</dd>
                </div>
                <div>
                  <dt>Total supply</dt>
                  <dd>{tokenResult.totalSupply ?? "Unavailable"}</dd>
                </div>
                <div>
                  <dt>Factory origin</dt>
                  <dd>
                    {tokenResult.factoryVerified
                      ? "Uniswap UERC20Factory"
                      : "Not supported"}
                  </dd>
                </div>
                <div>
                  <dt>Recorded creator</dt>
                  <dd>
                    {tokenResult.recordedCreator
                      ? shortenAddress(tokenResult.recordedCreator)
                      : "Unavailable"}
                  </dd>
                </div>
              </dl>
              <p>
                {tokenResult.factoryVerified
                  ? "Factory provenance is verified before launch"
                  : "This token remains outside the verified launch path"}
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function PoolStep({
  draft,
  setDraft,
  onToggleBehavior,
}: {
  draft: LaunchDraft;
  setDraft: Dispatch<SetStateAction<LaunchDraft>>;
  onToggleBehavior: (id: BehaviorId) => void;
}) {
  const [activeTier, setActiveTier] = useState<BehaviorTier>("standard");
  const [behaviorPage, setBehaviorPage] = useState(0);
  const visibleBehaviors = behaviorDefinitions.filter(
    (behavior) => behavior.tier === activeTier,
  );
  const behaviorPageSize = activeTier === "review" ? 6 : visibleBehaviors.length;
  const behaviorPageCount = Math.max(
    1,
    Math.ceil(visibleBehaviors.length / behaviorPageSize),
  );
  const pagedBehaviors = visibleBehaviors.slice(
    behaviorPage * behaviorPageSize,
    (behaviorPage + 1) * behaviorPageSize,
  );
  const behaviorTiers: { id: BehaviorTier; label: string }[] = [
    { id: "standard", label: "Standard" },
    { id: "review", label: "Advanced" },
    { id: "custom", label: "Custom" },
  ];

  return (
    <div className="form-section rules-form-section">
      <div className="form-section-heading">
        <div>
          <p className="step-kicker">Step 3</p>
          <h2>Configure the pool</h2>
          <p>Set liquidity details and choose how the v4 pool behaves</p>
        </div>
      </div>

      <div className="rules-layout">
        <div className="rules-column">
          {draft.liquidityMode === "auction" ? (
            <div className="rule-card allocation-rule-card auction-rule-card">
              <div className="rule-card-heading">
                <h3>Standard auction</h3>
                <span>No creator ETH</span>
              </div>
              <label className="field auction-valuation-field">
                <span>Minimum valuation</span>
                <div className="input-suffix">
                  <input
                    value={draft.auctionFloorValuationEth}
                    inputMode="decimal"
                    placeholder="10"
                    onChange={(event) =>
                      updateDraft(setDraft, {
                        auctionFloorValuationEth: event.target.value,
                        auctionStartBlock: "",
                        auctionEndBlock: "",
                        auctionClaimBlock: "",
                        auctionMigrationBlock: "",
                      })
                    }
                  />
                  <span>ETH</span>
                </div>
              </label>
              <dl className="auction-policy">
                <div>
                  <dt>Auction</dt>
                  <dd>50% supply</dd>
                </div>
                <div>
                  <dt>LP reserve</dt>
                  <dd>50% supply</dd>
                </div>
                <div>
                  <dt>Pool funding</dt>
                  <dd>All proceeds</dd>
                </div>
                <div>
                  <dt>Duration</dt>
                  <dd>4 hours</dd>
                </div>
              </dl>
              <p className="rule-note">
                Any tokens left after the auction and pool setup return to the creator
              </p>
            </div>
          ) : (
            <div className="rule-card allocation-rule-card">
              <div className="rule-card-heading">
                <h3>Opening liquidity</h3>
                <span>Creator supplied</span>
              </div>
              <div className="two-column-fields">
                <label className="field">
                  <span>ETH amount</span>
                  <input
                    value={draft.directEthAmount}
                    inputMode="decimal"
                    placeholder="5"
                    onChange={(event) =>
                      updateDraft(setDraft, {
                        directEthAmount: event.target.value,
                      })
                    }
                  />
                </label>
                <label className="field">
                  <span>Token amount</span>
                  <input
                    value={draft.directTokenAmount}
                    inputMode="decimal"
                    placeholder="100000000"
                    onChange={(event) =>
                      updateDraft(setDraft, {
                        directTokenAmount: event.target.value,
                      })
                    }
                  />
                </label>
              </div>
              <label className="field opening-rate-field">
                <span>Opening rate</span>
                <div className="input-suffix">
                  <input
                    value={draft.directTokensPerEth}
                    inputMode="decimal"
                    placeholder="50000"
                    onChange={(event) =>
                      updateDraft(setDraft, {
                        directTokensPerEth: event.target.value,
                      })
                    }
                  />
                  <span>tokens per ETH</span>
                </div>
              </label>
              <p className="rule-note">
                The opening rate sets the initial Uniswap v4 price
              </p>
            </div>
          )}

          {draft.selectedBehaviors.includes("fixed-fee") ? (
            <div className="rule-card fee-rule-card">
              <div>
                <h3>Pool fee</h3>
                <p>Separate from the 0.10% Launcher fee</p>
              </div>
              <strong className="fixed-fee-value">0.30%</strong>
            </div>
          ) : null}

          {draft.selectedBehaviors.includes("dynamic-fee") ? (
            <div className="rule-card fee-rule-card dynamic-fee-rule-card">
              <div>
                <h3>Bounded pool fee</h3>
                <p>
                  Rises with recent onchain price movement and updates at most
                  once per block
                </p>
                <small>
                  It changes the fee only and does not claim to prevent MEV
                </small>
              </div>
              <strong className="fixed-fee-value">0.30–1.00%</strong>
            </div>
          ) : null}
        </div>

        <div className="rule-card behavior-picker">
          <div className="behavior-picker-heading">
            <div>
              <h3>Token behavior</h3>
              <p>Add only what this token needs</p>
            </div>
            <div
              className="behavior-tabs"
              role="tablist"
              aria-label="Behavior type"
            >
              {behaviorTiers.map((tier) => {
                const selectedCount = behaviorDefinitions.filter(
                  (behavior) =>
                    behavior.tier === tier.id &&
                    draft.selectedBehaviors.includes(behavior.id),
                ).length;
                return (
                  <button
                    key={tier.id}
                    type="button"
                    role="tab"
                    aria-selected={activeTier === tier.id}
                    className={activeTier === tier.id ? "active" : undefined}
                    onClick={() => {
                      setActiveTier(tier.id);
                      setBehaviorPage(0);
                    }}
                  >
                    {tier.label}
                    {selectedCount > 0 ? <span>{selectedCount}</span> : null}
                  </button>
                );
              })}
            </div>
          </div>

          <div
            className={`behavior-grid behavior-grid-${activeTier}`}
            role="tabpanel"
          >
            {pagedBehaviors.map((behavior) => (
              <BehaviorRow
                key={behavior.id}
                behavior={behavior}
                selected={draft.selectedBehaviors.includes(behavior.id)}
                disabled={
                  behavior.id === "dynamic-fee" &&
                  draft.liquidityMode !== "auction"
                }
                onToggle={onToggleBehavior}
              />
            ))}
          </div>

          {behaviorPageCount > 1 ? (
            <div className="behavior-pagination" aria-label="Behavior pages">
              <span>
                {behaviorPage + 1} of {behaviorPageCount}
              </span>
              <div>
                <button
                  type="button"
                  onClick={() =>
                    setBehaviorPage((current) => Math.max(0, current - 1))
                  }
                  disabled={behaviorPage === 0}
                >
                  Previous
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setBehaviorPage((current) =>
                      Math.min(behaviorPageCount - 1, current + 1),
                    )
                  }
                  disabled={behaviorPage === behaviorPageCount - 1}
                >
                  Next
                </button>
              </div>
            </div>
          ) : null}

          {activeTier === "custom" &&
          draft.selectedBehaviors.includes("custom-hook") ? (
            <div className="custom-hook-fields">
              <p className="inline-notice warning-notice">
                <Code2 aria-hidden="true" size={16} />
                One custom hook replaces the standard behavior set
              </p>
              <div className="two-column-fields">
                <label className="field">
                  <span>Source repository</span>
                  <input
                    value={draft.customHookSource}
                    placeholder="https://github.com/…"
                    inputMode="url"
                    onChange={(event) =>
                      updateDraft(setDraft, {
                        customHookSource: event.target.value,
                      })
                    }
                  />
                </label>
                <label className="field">
                  <span>Hook address</span>
                  <input
                    className="mono-input"
                    value={draft.customHookAddress}
                    placeholder="0x…"
                    spellCheck={false}
                    onChange={(event) =>
                      updateDraft(setDraft, {
                        customHookAddress: event.target.value,
                      })
                    }
                  />
                </label>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function BehaviorRow({
  behavior,
  selected,
  disabled,
  onToggle,
}: {
  behavior: (typeof behaviorDefinitions)[number];
  selected: boolean;
  disabled: boolean;
  onToggle: (id: BehaviorId) => void;
}) {
  return (
    <button
      className={`behavior-row ${selected ? "selected" : ""}`}
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={() => onToggle(behavior.id)}
    >
      <span className="choice-indicator" aria-hidden="true">
        {selected ? <Check size={14} /> : null}
      </span>
      <span className="behavior-copy">
        <strong>{behavior.name}</strong>
        <small>
          {disabled
            ? `Auction only. ${behavior.description}`
            : behavior.description}
        </small>
      </span>
      <span className="behavior-tier">
        {disabled
          ? "Auction only"
          : getBehaviorTierLabel(behavior.tier)}
      </span>
    </button>
  );
}

function ReviewStep({
  draft,
  summary,
  selectedDefinitions,
  walletConnected,
  preflight,
  preflightLoading,
  preflightError,
  transactionSending,
  transactionHash,
  onCheck,
  onSubmit,
  onSave,
  onCopy,
  onBack,
}: {
  draft: LaunchDraft;
  summary: string;
  selectedDefinitions: ReturnType<typeof findBehavior>[];
  walletConnected: boolean;
  preflight: LaunchPreflightResponse | null;
  preflightLoading: boolean;
  preflightError: string;
  transactionSending: boolean;
  transactionHash: string;
  onCheck: () => void;
  onSubmit: () => void;
  onSave: () => void;
  onCopy: () => void;
  onBack: () => void;
}) {
  const assetName =
    draft.assetMode === "existing"
      ? draft.existingTokenSymbol || "Existing token"
      : draft.tokenName || "New token";
  const checks: LaunchPreflightCheck[] = preflight?.checks ?? [
    {
      id: "token",
      label: "Token setup",
      status: "pending",
      detail: "Validated from the final token and pool settings",
    },
    {
      id: "wallet",
      label: "Wallet",
      status: walletConnected ? "pending" : "blocked",
      detail: walletConnected
        ? "Connected account and network are checked next"
        : "Connect the creator wallet to continue",
    },
    {
      id: "contracts",
      label: "Launcher contracts",
      status: "pending",
      detail: "Addresses, bytecode and immutable settings are checked next",
    },
    {
      id: "simulation",
      label: "Simulation",
      status: "pending",
      detail: "The exact transaction is simulated before wallet review",
    },
  ];
  const preparedTransaction = preflight?.transaction;
  const launchSubmitted =
    Boolean(transactionHash) &&
    preparedTransaction?.kind === "launch";
  const submitPrepared =
    Boolean(preparedTransaction) && !transactionHash;
  const preparedLabel =
    preparedTransaction?.kind === "approval"
      ? "Approve token"
      : preparedTransaction?.kind === "lock-setup"
        ? "Create LP lock"
        : preparedTransaction?.kind === "hook-setup"
          ? "Create fee hook"
          : "Launch token";
  const submittedLabel =
    preparedTransaction?.kind === "approval"
      ? "Approval submitted"
      : preparedTransaction?.kind === "lock-setup"
        ? "LP lock submitted"
        : preparedTransaction?.kind === "hook-setup"
          ? "Fee hook submitted"
          : "Launch submitted";
  const primaryLabel = preflightLoading
    ? "Checking"
    : transactionSending
      ? "Opening wallet"
      : launchSubmitted
        ? "Launch submitted"
        : transactionHash
          ? preparedTransaction?.kind === "approval"
            ? "Check approval"
            : "Continue setup"
          : submitPrepared
            ? preparedLabel
            : walletConnected
              ? preflight
                ? "Check again"
                : "Check launch"
              : "Connect wallet";

  return (
    <div className="form-section review-section">
      <div className="form-section-heading">
        <div>
          <p className="step-kicker">Step 4</p>
          <h2>Review the token</h2>
          <p>Check the token, liquidity, behavior and fees in one place</p>
        </div>
      </div>

      <div className="review-statement">
        <p className="eyebrow">Token summary</p>
        <p>{summary}</p>
      </div>

      <dl className="review-details">
        <div>
          <dt>Asset</dt>
          <dd>
            <strong>{assetName}</strong>
            <span>
              {draft.assetMode === "new"
                ? `${draft.tokenSupply} fixed supply`
                : `${draft.tokenAddress}${
                    draft.existingTokenSupply
                      ? `, ${draft.existingTokenSupply} total supply`
                      : ""
                  }`}
            </span>
          </dd>
        </div>
        <div>
          <dt>Liquidity</dt>
          <dd>
            <strong>
              {draft.liquidityMode === "auction"
                ? "Auction launch"
                : "Direct v4 pool"}
            </strong>
            <span>
              {draft.liquidityMode === "auction"
                ? `${draft.auctionSalePercent}% auctioned, 50% reserved for liquidity, all auction proceeds allocated to the pool, ${draft.auctionFloorValuationEth} ETH minimum valuation`
                : `${draft.directEthAmount} ETH and ${draft.directTokenAmount} tokens at ${draft.directTokensPerEth} tokens per ETH, LP permanently locked`}
            </span>
          </dd>
        </div>
        <div>
          <dt>Behavior</dt>
          <dd>
            <strong>
              {selectedDefinitions.length > 0
                ? selectedDefinitions
                    .map((behavior) => behavior?.name)
                    .join(", ")
                : "Base configuration"}
            </strong>
            <span>
              {hasReviewBehavior(draft)
                ? "Contract review required"
                : "Standard behavior selected"}
            </span>
          </dd>
        </div>
        <div>
          <dt>Fees</dt>
          <dd>
            <strong>
              {(PLATFORM_FEE_BPS / 100).toFixed(2)}% Launcher fee
            </strong>
            <span>
              {draft.selectedBehaviors.includes("fixed-fee")
                ? `${draft.lpFeePercent}% pool fee, LP fees to creator`
                : draft.selectedBehaviors.includes("dynamic-fee")
                  ? "0.30–1.00% bounded pool fee, LP fees to creator"
                : "Pool fee follows the selected behavior, LP fees to creator"}
            </span>
          </dd>
        </div>
      </dl>

      <div className="review-gates">
        <div className="block-heading">
          <div>
            <h3>Required checks</h3>
            <p>The wallet opens only after the exact call passes these checks</p>
          </div>
        </div>
        <ul>
          {checks.map((check) => (
            <li
              key={check.id}
              className={`review-check review-check-${check.status}`}
            >
              <ReviewCheckIcon status={check.status} />
              <span>
                <strong>{check.label}</strong>
                <small>{check.detail}</small>
              </span>
            </li>
          ))}
        </ul>
      </div>

      {preflight ? (
        <div
          className={`preflight-result preflight-result-${preflight.status}`}
          role="status"
        >
          <div>
            <strong>{preflight.title}</strong>
            <span>{preflight.detail}</span>
          </div>
        </div>
      ) : null}

      {preflightError ? (
        <p className="form-error preflight-error" role="alert">
          {preflightError}
        </p>
      ) : null}

      {transactionHash ? (
        <a
          className="transaction-link"
          href={`https://etherscan.io/tx/${transactionHash}`}
          target="_blank"
          rel="noreferrer"
        >
          {submittedLabel}
          <span>{shortenAddress(transactionHash)}</span>
        </a>
      ) : null}

      <div className="review-actions">
        <button className="secondary-button" type="button" onClick={onBack}>
          <ArrowLeft aria-hidden="true" size={16} />
          Back
        </button>
        <button
          className="primary-button"
          type="button"
          disabled={
            preflightLoading ||
            transactionSending ||
            launchSubmitted
          }
          onClick={submitPrepared ? onSubmit : onCheck}
        >
          {preflightLoading || transactionSending ? (
            <LoaderCircle
              className="spinning-icon"
              aria-hidden="true"
              size={16}
            />
          ) : null}
          {primaryLabel}
        </button>
        <button className="secondary-button" type="button" onClick={onSave}>
          <Check aria-hidden="true" size={16} />
          Save token
        </button>
        <button className="secondary-button" type="button" onClick={onCopy}>
          <Copy aria-hidden="true" size={16} />
          Copy summary
        </button>
      </div>
    </div>
  );
}

function ReviewCheckIcon({
  status,
}: {
  status: LaunchPreflightCheck["status"];
}) {
  if (status === "pass") {
    return <CheckCircle2 aria-hidden="true" size={18} />;
  }
  if (status === "blocked") {
    return <AlertCircle aria-hidden="true" size={18} />;
  }
  return <Minus aria-hidden="true" size={18} />;
}
