"use client";

import {
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  CircleDollarSign,
  Code2,
  Copy,
  Droplets,
  FileCheck2,
  Info,
  LoaderCircle,
  LockKeyhole,
  Search,
  ShieldCheck,
} from "lucide-react";
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
  type LaunchDraft,
  type LiquidityMode,
} from "@/lib/launch";
import {
  saveLocalDraft,
  useLocalDraft,
} from "@/components/local-draft";

type TokenResult = {
  address: `0x${string}`;
  name: string | null;
  symbol: string | null;
  decimals: number | null;
  totalSupply: string | null;
  metadataComplete: boolean;
};

const steps = [
  { number: 1, label: "Token" },
  { number: 2, label: "Market" },
  { number: 3, label: "Confirm" },
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
      "Create a fixed-supply ERC-20 without transfer taxes, rebases or sell restrictions",
  },
  {
    id: "existing",
    name: "Use an existing token",
    description:
      "Use a token contract that is already deployed on Ethereum",
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
    name: "Auction-funded liquidity",
    description:
      "Let demand establish the opening price and fund the first pool",
    detail:
      "No creator ETH deposit · Auction proceeds and reserved tokens seed the pool",
    icon: CircleDollarSign,
  },
  {
    id: "direct",
    name: "Direct v4 pool",
    description:
      "Open the market with liquidity supplied by the creator",
    detail:
      "Set the token and ETH amounts used to initialize the pool",
    icon: Droplets,
  },
];

function isPositiveNumber(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
}

function percentageIsValid(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 100;
}

function updateDraft(
  setDraft: Dispatch<SetStateAction<LaunchDraft>>,
  patch: Partial<LaunchDraft>,
) {
  setDraft((current) => ({ ...current, ...patch }));
}

export function LaunchBuilder() {
  const localDraft = useLocalDraft();

  if (localDraft === undefined) {
    return (
      <div className="launch-page page-width">
        <header className="page-heading">
          <p className="eyebrow">Launch</p>
          <h1>Create a market</h1>
          <p>
            Choose the token, how liquidity starts and what the market can do
          </p>
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
  const [draft, setDraft] = useState<LaunchDraft>(initialDraft);
  const [step, setStep] = useState(1);
  const [formError, setFormError] = useState("");
  const [tokenResult, setTokenResult] = useState<TokenResult | null>(null);
  const [tokenLoading, setTokenLoading] = useState(false);
  const [tokenError, setTokenError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 2400);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const summary = useMemo(() => buildLaunchSummary(draft), [draft]);
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
    return "";
  }

  function validateMarket() {
    if (draft.liquidityMode === "auction") {
      if (!percentageIsValid(draft.auctionSalePercent)) {
        return "Enter a sale allocation between 0 and 100 percent";
      }
      if (!percentageIsValid(draft.auctionLiquidityPercent)) {
        return "Enter a pool-funding share between 0 and 100 percent";
      }
    } else if (
      !isPositiveNumber(draft.directEthAmount) ||
      !isPositiveNumber(draft.directTokenAmount)
    ) {
      return "Enter both ETH and token liquidity amounts";
    }

    if (
      draft.selectedBehaviors.includes("fixed-fee") &&
      !percentageIsValid(draft.lpFeePercent)
    ) {
      return "Enter a pool fee between 0 and 100 percent";
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
      step === 1 ? validateAsset() : step === 2 ? validateMarket() : "";
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
    });
  }

  function saveDraft() {
    const saved = { ...draft, updatedAt: new Date().toISOString() };
    saveLocalDraft(saved);
    setDraft(saved);
    setNotice("Launch saved in this browser");
  }

  async function copyPlan() {
    await navigator.clipboard.writeText(buildPlainTextPlan(draft));
    setNotice("Launch summary copied");
  }

  return (
    <div className="launch-page page-width">
      <header className="page-heading launch-page-heading">
        <div>
          <p className="eyebrow">Launch</p>
          <h1>Create a market</h1>
          <p>
            Choose the token, how liquidity starts and what the market can do
          </p>
        </div>
      </header>

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
              <span>{step > item.number ? <Check size={14} /> : item.number}</span>
              {item.label}
            </button>
          </li>
        ))}
      </ol>

      <div className={step === 2 ? "launch-layout wide-layout" : "launch-layout"}>
        <section className="launch-form-panel">
          {step === 1 ? (
            <AssetStep
              draft={draft}
              setDraft={setDraft}
              tokenResult={tokenResult}
              tokenLoading={tokenLoading}
              tokenError={tokenError}
              onReadToken={readToken}
            />
          ) : null}

          {step === 2 ? (
            <MarketStep
              draft={draft}
              setDraft={setDraft}
              onToggleBehavior={toggleBehavior}
            />
          ) : null}

          {step === 3 ? (
            <ReviewStep
              draft={draft}
              summary={summary}
              selectedDefinitions={selectedDefinitions}
              onSave={saveDraft}
              onCopy={copyPlan}
            />
          ) : null}

          {formError ? (
            <p className="form-error form-error-block" role="alert">
              {formError}
            </p>
          ) : null}

          {step < 3 ? (
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
          ) : (
            <div className="form-navigation">
              <button
                className="secondary-button"
                type="button"
                onClick={() => {
                  setFormError("");
                  setStep(2);
                }}
              >
                <ArrowLeft aria-hidden="true" size={16} />
                Back
              </button>
            </div>
          )}
        </section>

        {step === 2 ? (
          <aside className="plan-aside">
            <p className="eyebrow">Launch summary</p>
            <p className="plan-sentence">{summary}</p>
            <dl className="plan-facts">
              <div>
                <dt>Launcher fee</dt>
                <dd>{(PLATFORM_FEE_BPS / 100).toFixed(2)}%</dd>
              </div>
              <div>
                <dt>Hook structure</dt>
                <dd>One composed hook</dd>
              </div>
              <div>
                <dt>Advanced behavior</dt>
                <dd>{hasReviewBehavior(draft) ? "Review required" : "None"}</dd>
              </div>
            </dl>
            <p className="aside-note">
              Selected behaviors form one market contract · They are not
              separate hooks on the same pool
            </p>
          </aside>
        ) : null}
      </div>

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
        <span>01</span>
        <div>
          <h2>Choose the token</h2>
          <p>
            Create a new token or use a contract that already exists on Ethereum
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
                updateDraft(setDraft, { assetMode: option.id });
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
              </dl>
              <p>
                Metadata read directly from Ethereum · Contract review happens
                before launch
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function MarketStep({
  draft,
  setDraft,
  onToggleBehavior,
}: {
  draft: LaunchDraft;
  setDraft: Dispatch<SetStateAction<LaunchDraft>>;
  onToggleBehavior: (id: BehaviorId) => void;
}) {
  const standard = behaviorDefinitions.filter(
    (behavior) => behavior.tier === "standard",
  );
  const review = behaviorDefinitions.filter(
    (behavior) => behavior.tier === "review",
  );
  const custom = behaviorDefinitions.find(
    (behavior) => behavior.id === "custom-hook",
  );

  return (
    <div className="form-section market-form-section">
      <div className="form-section-heading">
        <span>02</span>
        <div>
          <h2>Set the market rules</h2>
          <p>
            Choose how liquidity starts and add only the behavior the market needs
          </p>
        </div>
      </div>

      <fieldset className="field-block">
        <legend>Liquidity path</legend>
        <div className="liquidity-options">
          {liquidityOptions.map((option) => {
            const Icon = option.icon;
            const selected = draft.liquidityMode === option.id;
            return (
              <button
                key={option.id}
                className={`liquidity-option ${selected ? "selected" : ""}`}
                type="button"
                aria-pressed={selected}
                onClick={() =>
                  updateDraft(setDraft, { liquidityMode: option.id })
                }
              >
                <span className="liquidity-icon" aria-hidden="true">
                  <Icon size={20} strokeWidth={1.7} />
                </span>
                <span>
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
      </fieldset>

      {draft.liquidityMode === "auction" ? (
        <div className="field-block">
          <div className="block-heading">
            <div>
              <h3>Auction allocation</h3>
              <p>
                Set how much supply enters the sale and how much of the proceeds
                funds the opening pool
              </p>
            </div>
          </div>
          <div className="two-column-fields">
            <label className="field">
              <span>Supply offered</span>
              <div className="input-suffix">
                <input
                  value={draft.auctionSalePercent}
                  inputMode="decimal"
                  onChange={(event) =>
                    updateDraft(setDraft, {
                      auctionSalePercent: event.target.value,
                    })
                  }
                />
                <span>%</span>
              </div>
            </label>
            <label className="field">
              <span>Proceeds for pool funding</span>
              <div className="input-suffix">
                <input
                  value={draft.auctionLiquidityPercent}
                  inputMode="decimal"
                  onChange={(event) =>
                    updateDraft(setDraft, {
                      auctionLiquidityPercent: event.target.value,
                    })
                  }
                />
                <span>%</span>
              </div>
            </label>
          </div>
          <p className="inline-notice">
            <Info aria-hidden="true" size={16} />
            No creator ETH deposit · Pool funding depends on the amount raised
          </p>
        </div>
      ) : (
        <div className="field-block">
          <div className="block-heading">
            <div>
              <h3>Opening liquidity</h3>
              <p>
                Enter the token and ETH amounts used to open the pool
              </p>
            </div>
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
        </div>
      )}

      <div className="field-block behavior-block">
        <div className="block-heading">
          <div>
            <h3>Market behavior</h3>
            <p>
              Start with standard rules or add behavior that requires contract review
            </p>
          </div>
        </div>

        <BehaviorList
          title="Standard"
          behaviors={standard}
          selected={draft.selectedBehaviors}
          onToggle={onToggleBehavior}
        />
        <BehaviorList
          title="Advanced"
          behaviors={review}
          selected={draft.selectedBehaviors}
          onToggle={onToggleBehavior}
        />

        {custom ? (
          <div className="behavior-group custom-behavior-group">
            <p className="behavior-group-title">Custom</p>
            <BehaviorRow
              behavior={custom}
              selected={draft.selectedBehaviors.includes(custom.id)}
              onToggle={onToggleBehavior}
            />
            {draft.selectedBehaviors.includes("custom-hook") ? (
              <div className="custom-hook-fields">
                <p className="inline-notice warning-notice">
                  <Code2 aria-hidden="true" size={16} />
                  A custom hook replaces the standard composition · Fee routing
                  and pool compatibility stay inside that hook
                </p>
                <label className="field">
                  <span>Source repository or verified source</span>
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
                  <span>Deployed hook address, if available</span>
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
            ) : null}
          </div>
        ) : null}
      </div>

      {draft.selectedBehaviors.includes("fixed-fee") ? (
        <div className="field-block compact-block">
          <div className="block-heading">
            <div>
              <h3>Pool fee</h3>
              <p>
                The liquidity-provider fee stays separate from the Launcher fee
              </p>
            </div>
          </div>
          <label className="field short-field">
            <span>Swap fee</span>
            <div className="input-suffix">
              <input
                value={draft.lpFeePercent}
                inputMode="decimal"
                onChange={(event) =>
                  updateDraft(setDraft, {
                    lpFeePercent: event.target.value,
                  })
                }
              />
              <span>%</span>
            </div>
          </label>
        </div>
      ) : null}
    </div>
  );
}

function BehaviorList({
  title,
  behaviors,
  selected,
  onToggle,
}: {
  title: string;
  behaviors: typeof behaviorDefinitions;
  selected: BehaviorId[];
  onToggle: (id: BehaviorId) => void;
}) {
  return (
    <div className="behavior-group">
      <p className="behavior-group-title">{title}</p>
      <div className="behavior-list">
        {behaviors.map((behavior) => (
          <BehaviorRow
            key={behavior.id}
            behavior={behavior}
            selected={selected.includes(behavior.id)}
            onToggle={onToggle}
          />
        ))}
      </div>
    </div>
  );
}

function BehaviorRow({
  behavior,
  selected,
  onToggle,
}: {
  behavior: (typeof behaviorDefinitions)[number];
  selected: boolean;
  onToggle: (id: BehaviorId) => void;
}) {
  return (
    <button
      className={`behavior-row ${selected ? "selected" : ""}`}
      type="button"
      aria-pressed={selected}
      onClick={() => onToggle(behavior.id)}
    >
      <span className="choice-indicator" aria-hidden="true">
        {selected ? <Check size={14} /> : null}
      </span>
      <span className="behavior-copy">
        <strong>{behavior.name}</strong>
        <small>{behavior.description}</small>
      </span>
      <span className="behavior-tier">
        {getBehaviorTierLabel(behavior.tier)}
      </span>
    </button>
  );
}

function ReviewStep({
  draft,
  summary,
  selectedDefinitions,
  onSave,
  onCopy,
}: {
  draft: LaunchDraft;
  summary: string;
  selectedDefinitions: ReturnType<typeof findBehavior>[];
  onSave: () => void;
  onCopy: () => void;
}) {
  const assetName =
    draft.assetMode === "existing"
      ? draft.existingTokenSymbol || "Existing token"
      : draft.tokenName || "New token";

  return (
    <div className="form-section review-section">
      <div className="form-section-heading">
        <span>03</span>
        <div>
          <h2>Confirm the launch</h2>
          <p>
            Check the token, liquidity path, market rules and fees in one place
          </p>
        </div>
      </div>

      <div className="review-statement">
        <p className="eyebrow">Launch summary</p>
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
                      ? ` · ${draft.existingTokenSupply} total supply`
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
                ? "Auction-funded"
                : "Direct v4 pool"}
            </strong>
            <span>
              {draft.liquidityMode === "auction"
                ? `${draft.auctionSalePercent}% of supply offered · ${draft.auctionLiquidityPercent}% of proceeds for pool funding`
                : `${draft.directEthAmount} ETH · ${draft.directTokenAmount} tokens`}
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
                ? `${draft.lpFeePercent}% pool fee`
                : "Pool fee follows the selected market rule"}
            </span>
          </dd>
        </div>
      </dl>

      <div className="review-gates">
        <div className="block-heading">
          <div>
            <h3>Launch checks</h3>
            <p>
              Every deployment passes these checks before it appears in Explore
            </p>
          </div>
        </div>
        <ul>
          <li>
            <ShieldCheck aria-hidden="true" size={18} />
            Token and hook source review
          </li>
          <li>
            <FileCheck2 aria-hidden="true" size={18} />
            Bidirectional buy and sell simulation
          </li>
          <li>
            <LockKeyhole aria-hidden="true" size={18} />
            Ownership, fee recipient and liquidity controls confirmed
          </li>
          <li>
            <CheckCircle2 aria-hidden="true" size={18} />
            Deployment and launch record verified on Ethereum
          </li>
        </ul>
      </div>

      <div className="review-actions">
        <button className="primary-button" type="button" onClick={onSave}>
          Save launch
          <Check aria-hidden="true" size={16} />
        </button>
        <button className="secondary-button" type="button" onClick={onCopy}>
          <Copy aria-hidden="true" size={16} />
          Copy summary
        </button>
      </div>
    </div>
  );
}
