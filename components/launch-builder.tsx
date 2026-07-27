"use client";

import Image from "next/image";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Copy,
  ImagePlus,
  Minus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import {
  saveLocalDraft,
  useLocalDraft,
} from "@/components/local-draft";
import { useWallet } from "@/components/wallet-provider";
import { validatePreparedClassicLaunchTransaction } from "@/lib/classic-launch-validation";
import {
  MAX_METADATA_URL_BYTES,
  MAX_SOCIAL_URL_BYTES,
  MAX_TOKEN_DESCRIPTION_BYTES,
  MAX_TOKEN_NAME_BYTES,
  MAX_TOKEN_NAME_CHARACTERS,
  MAX_TOKEN_SYMBOL_CHARACTERS,
  characterLength,
  normalizeOptionalHttpsUrl,
  normalizeOptionalSocialUrl,
  utf8ByteLength,
  validateMemeLaunchDraft,
  type LaunchPreflightCheck,
  type LaunchPreflightResponse,
} from "@/lib/launch-transaction";
import {
  buildLaunchSummary,
  buildPlainTextPlan,
  createEmptyDraft,
  getInitialBuyEthLabel,
  getMemeFeeBreakdown,
  MEME_MIN_INITIAL_BUY_ETH,
  MEME_MIN_INITIAL_BUY_ETH_LABEL,
  MEME_STARTING_FDV_ETH_LABEL,
  parseInitialBuyWei,
  parseTotalSwapFeeBps,
  PLATFORM_FEE_BPS,
  type LaunchDraft,
} from "@/lib/launch";
import { prepareTokenImage } from "@/lib/token-image";

const steps = [
  { number: 1, label: "Token details" },
  { number: 2, label: "Fees" },
  { number: 3, label: "Review" },
];

type TokenImageState = {
  status: "idle" | "preparing" | "waiting" | "uploading" | "ready" | "error";
  message: string;
};

const emptyTokenImageState: TokenImageState = {
  status: "idle",
  message: "",
};

function updateDraft(
  setDraft: Dispatch<SetStateAction<LaunchDraft>>,
  patch: Partial<LaunchDraft>,
) {
  setDraft((current) => ({ ...current, ...patch }));
}

function normalizeStandardDraft(initialDraft: LaunchDraft): LaunchDraft {
  return {
    ...initialDraft,
    assetMode: "new",
    tokenSupply: "1000000000",
    liquidityMode: "meme",
    directEthAmount: "",
    directTokenAmount: "",
    directTokensPerEth: "",
    selectedBehaviors: ["fixed-fee"],
    lpFeePercent: "0",
    totalSwapFeePercent:
      parseTotalSwapFeeBps(initialDraft.totalSwapFeePercent) === null
        ? "1"
        : initialDraft.totalSwapFeePercent,
    initialBuyEth:
      parseInitialBuyWei(initialDraft.initialBuyEth) === null
        ? MEME_MIN_INITIAL_BUY_ETH
        : initialDraft.initialBuyEth.trim(),
    customHookAddress: "",
    customHookSource: "",
  };
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
  const [selectedModel, setSelectedModel] = useState<"classic" | null>(null);

  if (!selectedModel) {
    return <LaunchModelPicker onChoose={() => setSelectedModel("classic")} />;
  }

  if (localDraft === undefined) {
    return (
      <div className="launch-page page-width">
        <header className="page-heading">
          <div>
            <p className="eyebrow">Classic</p>
            <h1>Set up your token</h1>
          </div>
          <p>Loading your launch settings</p>
        </header>
        <div className="launch-loading" aria-label="Loading launch" />
      </div>
    );
  }

  return (
    <LaunchBuilderForm
      initialDraft={normalizeStandardDraft(localDraft ?? createEmptyDraft())}
      onBackToModels={() => setSelectedModel(null)}
    />
  );
}

function LaunchModelPicker({ onChoose }: { onChoose: () => void }) {
  return (
    <div className="launch-model-page page-width">
      <header className="launch-model-heading">
        <h1>Launch a token</h1>
      </header>

      <div className="launch-model-grid">
        <button
          className="launch-model-card"
          type="button"
          style={{ animation: "none", transform: "none", transition: "none" }}
          onClick={onChoose}
        >
          <span className="launch-model-art" aria-hidden="true">
            <Image
              src="/brand/programmable-classic-launch-art.webp"
              alt=""
              fill
              sizes="(max-width: 800px) 100vw, 420px"
              priority
              unoptimized
            />
          </span>

          <span className="launch-model-card-body">
            <span className="launch-model-card-heading">
              <strong>Classic</strong>
            </span>
            <span className="launch-model-description">
              A fixed-supply token with locked liquidity and creator fees paid in ETH
            </span>
            <span className="launch-model-details">
              <span>No liquidity deposit</span>
              <span>{MEME_MIN_INITIAL_BUY_ETH_LABEL} minimum Dev Buy</span>
              <span>1–10% swap fee</span>
            </span>
            <span className="launch-model-action">
              Launch
              <ArrowRight aria-hidden="true" size={16} />
            </span>
          </span>
        </button>
      </div>
    </div>
  );
}

function LaunchBuilderForm({
  initialDraft,
  onBackToModels,
}: {
  initialDraft: LaunchDraft;
  onBackToModels: () => void;
}) {
  const { wallet, openWallet, sendTransaction } = useWallet();
  const [draft, setDraft] = useState<LaunchDraft>(initialDraft);
  const [step, setStep] = useState(1);
  const [formError, setFormError] = useState("");
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
  const [tokenImageState, setTokenImageState] =
    useState<TokenImageState>(emptyTokenImageState);
  const currentLaunchContext = useRef({ draft, wallet });

  useEffect(() => {
    currentLaunchContext.current = { draft, wallet };
  }, [draft, wallet]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 2400);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const summary = useMemo(() => buildLaunchSummary(draft), [draft]);
  const launchCheckKey = useMemo(
    () => getLaunchCheckKey(draft, wallet?.account, wallet?.chainId),
    [draft, wallet?.account, wallet?.chainId],
  );
  const preflight =
    preflightState?.key === launchCheckKey ? preflightState.result : null;
  const preflightLoading = preflightLoadingKey === launchCheckKey;
  const preflightError =
    preflightErrorState?.key === launchCheckKey
      ? preflightErrorState.message
      : "";
  const transactionSending = transactionSendingKey === launchCheckKey;
  const transactionHash =
    transactionState?.key === launchCheckKey ? transactionState.hash : "";

  function validateToken() {
    if (
      tokenImageState.status === "preparing" ||
      tokenImageState.status === "waiting" ||
      tokenImageState.status === "uploading"
    ) {
      return "Wait for the token image to finish uploading";
    }
    if (tokenImageState.status === "error") {
      return tokenImageState.message || "Choose the token image again";
    }
    try {
      validateMemeLaunchDraft({
        ...draft,
        totalSwapFeePercent: "1",
        initialBuyEth: MEME_MIN_INITIAL_BUY_ETH,
      });
      return "";
    } catch (caught) {
      return caught instanceof Error
        ? caught.message
        : "Check the token details and project links";
    }
  }

  function validateFee() {
    if (parseTotalSwapFeeBps(draft.totalSwapFeePercent) === null) {
      return "Choose a total swap fee from 1% to 10%";
    }
    if (parseInitialBuyWei(draft.initialBuyEth) === null) {
      return `Enter a Dev Buy of at least ${MEME_MIN_INITIAL_BUY_ETH_LABEL}`;
    }
    return "";
  }

  function continueTo(nextStep: number) {
    const error =
      step === 1 ? validateToken() : step === 2 ? validateFee() : "";
    if (error) {
      setFormError(error);
      return;
    }
    setFormError("");
    setStep(nextStep);
    window.scrollTo({ top: 0 });
  }

  function saveDraft() {
    const saved = {
      ...normalizeStandardDraft(draft),
      updatedAt: new Date().toISOString(),
    };
    saveLocalDraft(saved);
    setDraft(saved);
    setNotice("Token saved");
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
        "error" in body ? body.error : "The launch could not be checked",
      );
    }
    return body;
  }

  async function checkLaunch() {
    if (!wallet) {
      openWallet();
      return;
    }

    let checkedDraft = normalizeStandardDraft(draft);
    if (!/^0x[a-fA-F0-9]{64}$/.test(checkedDraft.launchSalt)) {
      checkedDraft = {
        ...checkedDraft,
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
        setPreflightState({ key: patchedKey, result: refreshed });
        setNotice("Launch details updated");
        return;
      }
      if (
        !refreshed.transaction ||
        refreshed.planHash !== preflight.planHash
      ) {
        setPreflightState({ key: launchCheckKey, result: refreshed });
        setNotice("Launch check updated");
        return;
      }

      const latest = currentLaunchContext.current;
      if (
        !latest.wallet ||
        getLaunchCheckKey(
          latest.draft,
          latest.wallet.account,
          latest.wallet.chainId,
        ) !== launchCheckKey
      ) {
        throw new Error(
          "The token setup or connected wallet changed. Check the launch again",
        );
      }
      const validatedTransaction =
        validatePreparedClassicLaunchTransaction({
          transaction: refreshed.transaction,
          draft: latest.draft,
          account: latest.wallet.account,
          planHash: refreshed.planHash,
        });
      setPreflightState({ key: launchCheckKey, result: refreshed });
      const hash = await sendTransaction(validatedTransaction);
      setTransactionState({ key: launchCheckKey, hash });
      setNotice("Launch submitted");
    } catch (caught) {
      setPreflightState(null);
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
        <button
          className="launch-model-back"
          type="button"
          onClick={onBackToModels}
        >
          <ArrowLeft aria-hidden="true" size={15} />
          Back
        </button>
        <div className="launch-page-title">
          <p className="eyebrow">Classic</p>
          <h1>Set up your token</h1>
          <p>Name the token, choose the fee and review the transaction</p>
        </div>
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
                  {step > item.number ? (
                    <Check size={14} />
                  ) : (
                    String(item.number).padStart(2, "0")
                  )}
                </span>
                {item.label}
              </button>
            </li>
          ))}
        </ol>

        <div className="launch-layout">
          <div className="launch-form-panel">
            {step === 1 ? (
              <TokenStep
                draft={draft}
                setDraft={setDraft}
                onEdit={() => setFormError("")}
                onImageStateChange={setTokenImageState}
              />
            ) : null}

            {step === 2 ? (
              <FeeStep draft={draft} setDraft={setDraft} />
            ) : null}

            {step === 3 ? (
              <ReviewStep
                draft={draft}
                summary={summary}
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
                  setStep(2);
                }}
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

function TokenStep({
  draft,
  setDraft,
  onEdit,
  onImageStateChange,
}: {
  draft: LaunchDraft;
  setDraft: Dispatch<SetStateAction<LaunchDraft>>;
  onEdit: () => void;
  onImageStateChange: (state: TokenImageState) => void;
}) {
  const { getAccessToken, openWallet, wallet } = useWallet();
  const imageInputRef = useRef<HTMLInputElement>(null);
  const previewObjectUrlRef = useRef("");
  const [imagePreview, setImagePreview] = useState(draft.tokenImage);
  const [pendingImage, setPendingImage] = useState<Blob | null>(null);
  const [imageState, setImageState] =
    useState<TokenImageState>(emptyTokenImageState);

  const updateTokenDraft = useCallback(
    (patch: Partial<LaunchDraft>) => {
      onEdit();
      updateDraft(setDraft, patch);
    },
    [onEdit, setDraft],
  );

  const updateImageState = useCallback(
    (state: TokenImageState) => {
      setImageState(state);
      onImageStateChange(state);
    },
    [onImageStateChange],
  );

  useEffect(
    () => () => {
      if (previewObjectUrlRef.current) {
        URL.revokeObjectURL(previewObjectUrlRef.current);
      }
    },
    [],
  );

  const uploadTokenImage = useCallback(
    async (image: Blob) => {
      updateImageState({
        status: "uploading",
        message: "Uploading image",
      });

      try {
        const accessToken = await getAccessToken();
        if (!accessToken) {
          throw new Error("Connect your wallet to upload the image");
        }

        const form = new FormData();
        form.append(
          "file",
          new File([image], "token-image.webp", {
            type: "image/webp",
          }),
        );
        const response = await fetch("/api/token-image", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
          body: form,
        });
        const body = (await response.json()) as
          | { url: string }
          | { error: string };
        if (!response.ok || !("url" in body)) {
          throw new Error(
            "error" in body ? body.error : "The image could not be uploaded",
          );
        }

        updateTokenDraft({ tokenImage: body.url });
        setPendingImage(null);
        updateImageState({
          status: "ready",
          message: "Image ready",
        });
      } catch (caught) {
        updateImageState({
          status: "error",
          message:
            caught instanceof Error
              ? caught.message
              : "The image could not be uploaded",
        });
      }
    },
    [getAccessToken, updateImageState, updateTokenDraft],
  );

  async function selectTokenImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    updateImageState({
      status: "preparing",
      message: "Preparing image",
    });

    try {
      const prepared = await prepareTokenImage(file);
      if (previewObjectUrlRef.current) {
        URL.revokeObjectURL(previewObjectUrlRef.current);
      }
      const previewUrl = URL.createObjectURL(prepared);
      previewObjectUrlRef.current = previewUrl;
      setImagePreview(previewUrl);
      setPendingImage(prepared);

      if (!wallet) {
        updateImageState({
          status: "waiting",
          message: "Connect your wallet to finish the upload",
        });
        openWallet();
        return;
      }

      await uploadTokenImage(prepared);
    } catch (caught) {
      updateImageState({
        status: "error",
        message:
          caught instanceof Error
            ? caught.message
            : "The image could not be prepared",
      });
    }
  }

  function removeTokenImage() {
    if (previewObjectUrlRef.current) {
      URL.revokeObjectURL(previewObjectUrlRef.current);
      previewObjectUrlRef.current = "";
    }
    setImagePreview("");
    setPendingImage(null);
    updateTokenDraft({ tokenImage: "" });
    updateImageState(emptyTokenImageState);
  }

  function normalizeWebsite() {
    try {
      updateTokenDraft({
        tokenWebsite: normalizeOptionalHttpsUrl(
          draft.tokenWebsite,
          "the website",
          MAX_METADATA_URL_BYTES,
        ),
      });
    } catch {
      return;
    }
  }

  function normalizeSocial(kind: "x" | "telegram") {
    const key = kind === "x" ? "tokenX" : "tokenTelegram";
    try {
      updateTokenDraft({
        [key]: normalizeOptionalSocialUrl(
          draft[key],
          kind === "x" ? "the X link" : "the Telegram link",
          MAX_SOCIAL_URL_BYTES,
          kind,
        ),
      });
    } catch {
      return;
    }
  }

  const descriptionRemaining =
    MAX_TOKEN_DESCRIPTION_BYTES -
    utf8ByteLength(draft.tokenDescription);

  return (
    <div className="form-section standard-token-section">
      <div className="form-section-heading">
        <h2>Token details</h2>
      </div>

      <div className="standard-token-fields">
        <div className="two-column-fields">
          <label className="field">
            <span>Token name</span>
            <input
              value={draft.tokenName}
              maxLength={MAX_TOKEN_NAME_CHARACTERS}
              placeholder="Token name"
              autoComplete="off"
              onChange={(event) => {
                const value = event.target.value.replace(/[\r\n]/g, "");
                if (utf8ByteLength(value) <= MAX_TOKEN_NAME_BYTES) {
                  updateTokenDraft({ tokenName: value });
                }
              }}
            />
            <small>
              {characterLength(draft.tokenName)}/{MAX_TOKEN_NAME_CHARACTERS}
            </small>
          </label>
          <label className="field">
            <span>Ticker</span>
            <input
              value={draft.tokenSymbol}
              maxLength={MAX_TOKEN_SYMBOL_CHARACTERS}
              placeholder="TOKEN"
              spellCheck={false}
              autoComplete="off"
              onChange={(event) =>
                updateTokenDraft({
                  tokenSymbol: event.target.value
                    .toUpperCase()
                    .replace(/[^A-Z0-9]/g, ""),
                })
              }
            />
            <small>
              {characterLength(draft.tokenSymbol)}/
              {MAX_TOKEN_SYMBOL_CHARACTERS}
            </small>
          </label>
        </div>

        <label className="field">
          <span>Description (optional)</span>
          <textarea
            value={draft.tokenDescription}
            maxLength={MAX_TOKEN_DESCRIPTION_BYTES}
            rows={3}
            placeholder="Describe what the token represents"
            onChange={(event) => {
              if (
                utf8ByteLength(event.target.value) <=
                MAX_TOKEN_DESCRIPTION_BYTES
              ) {
                updateTokenDraft({
                  tokenDescription: event.target.value,
                });
              }
            }}
          />
          <small>{descriptionRemaining} left</small>
        </label>

        <div className="field-group token-project-details">
          <div className="block-heading">
            <h3>Project links</h3>
          </div>

          <div className="token-project-grid">
            <div className="token-image-field">
              <span>Token image</span>
              <input
                ref={imageInputRef}
                hidden
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={selectTokenImage}
              />
              <button
                className={`token-image-upload${
                  imagePreview ? " has-image" : ""
                }`}
                type="button"
                aria-label={
                  imagePreview ? "Change token image" : "Choose token image"
                }
                onClick={() => imageInputRef.current?.click()}
              >
                {imagePreview ? (
                  <span
                    className="token-image-preview"
                    role="img"
                    aria-label="Token image preview"
                    style={{ backgroundImage: `url("${imagePreview}")` }}
                  />
                ) : (
                  <span className="token-image-placeholder">
                    <ImagePlus aria-hidden="true" size={23} />
                    <strong>Choose image</strong>
                    <small>Square preview</small>
                  </span>
                )}
              </button>
              <div className="token-image-meta">
                <span
                  className={
                    imageState.status === "error" ? "form-error" : undefined
                  }
                  role={
                    imageState.status === "error" ? "alert" : undefined
                  }
                >
                  {imageState.message ||
                    "JPG, PNG or WebP. Cropped to a square."}
                </span>
                <div>
                  {(imageState.status === "error" ||
                    imageState.status === "waiting") &&
                  pendingImage &&
                  wallet ? (
                    <button
                      type="button"
                      onClick={() => void uploadTokenImage(pendingImage)}
                    >
                      <RotateCcw aria-hidden="true" size={13} />
                      Try again
                    </button>
                  ) : null}
                  {imagePreview || draft.tokenImage ? (
                    <button type="button" onClick={removeTokenImage}>
                      <Trash2 aria-hidden="true" size={13} />
                      Remove
                    </button>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="token-link-fields">
              <label className="field">
                <span>Website</span>
                <input
                  type="text"
                  inputMode="url"
                  value={draft.tokenWebsite}
                  maxLength={MAX_METADATA_URL_BYTES}
                  placeholder="project.com"
                  spellCheck={false}
                  autoComplete="url"
                  onBlur={normalizeWebsite}
                  onChange={(event) =>
                    updateTokenDraft({ tokenWebsite: event.target.value })
                  }
                />
              </label>

              <label className="field">
                <span>X link</span>
                <input
                  type="text"
                  inputMode="url"
                  value={draft.tokenX}
                  maxLength={MAX_SOCIAL_URL_BYTES}
                  placeholder="@project or x.com/project/status/…"
                  spellCheck={false}
                  autoComplete="off"
                  onBlur={() => normalizeSocial("x")}
                  onChange={(event) =>
                    updateTokenDraft({ tokenX: event.target.value })
                  }
                />
              </label>

              <label className="field">
                <span>Telegram</span>
                <input
                  type="text"
                  inputMode="url"
                  value={draft.tokenTelegram}
                  maxLength={MAX_SOCIAL_URL_BYTES}
                  placeholder="@project or t.me/project"
                  spellCheck={false}
                  autoComplete="off"
                  onBlur={() => normalizeSocial("telegram")}
                  onChange={(event) =>
                    updateTokenDraft({ tokenTelegram: event.target.value })
                  }
                />
              </label>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function FeeStep({
  draft,
  setDraft,
}: {
  draft: LaunchDraft;
  setDraft: Dispatch<SetStateAction<LaunchDraft>>;
}) {
  const feeBreakdown = getMemeFeeBreakdown(draft);
  const totalSwapFeeBps = feeBreakdown?.totalSwapFeeBps ?? 100;
  const creatorFeeBps = feeBreakdown?.creatorFeeBps ?? 90;

  return (
    <div className="form-section meme-fee-section">
      <div className="form-section-heading">
        <h2>Choose the swap fee</h2>
      </div>

      <div className="meme-fee-card">
        <div className="meme-fee-card-heading">
          <div>
            <strong>Total swap fee</strong>
            <p>Fixed when the token launches</p>
          </div>
          <span>{(totalSwapFeeBps / 100).toFixed(2)}%</span>
        </div>
        <div className="meme-fee-options" role="radiogroup" aria-label="Total swap fee">
          {Array.from({ length: 10 }, (_, index) => index + 1).map((percent) => {
            const selected = draft.totalSwapFeePercent === String(percent);
            return (
              <button
                key={percent}
                type="button"
                role="radio"
                aria-checked={selected}
                className={selected ? "selected" : undefined}
                onClick={() =>
                  updateDraft(setDraft, {
                    totalSwapFeePercent: String(percent),
                  })
                }
              >
                {percent}%
              </button>
            );
          })}
        </div>
        <p className="meme-fee-note">
          Programmable receives 0.10 percentage points from this total. Nothing
          is added on top
        </p>
        <label className="meme-dev-buy" htmlFor="classic-dev-buy">
          <span>
            <strong>Dev Buy</strong>
            <small>
              Minimum {MEME_MIN_INITIAL_BUY_ETH_LABEL}. Larger buys move the
              opening price
            </small>
          </span>
          <span className="meme-dev-buy-input">
            <input
              id="classic-dev-buy"
              inputMode="decimal"
              value={draft.initialBuyEth}
              maxLength={40}
              placeholder={MEME_MIN_INITIAL_BUY_ETH}
              spellCheck={false}
              autoComplete="off"
              onChange={(event) =>
                updateDraft(setDraft, {
                  initialBuyEth: event.target.value,
                })
              }
            />
            <span>ETH</span>
          </span>
        </label>
      </div>

      <dl className="meme-fee-breakdown">
        <div>
          <dt>Total paid</dt>
          <dd>{(totalSwapFeeBps / 100).toFixed(2)}%</dd>
          <span>Applied in the Programmable pool</span>
        </div>
        <div>
          <dt>Creator receives</dt>
          <dd>{(creatorFeeBps / 100).toFixed(2)}%</dd>
          <span>Paid as claimable ETH</span>
        </div>
        <div>
          <dt>Programmable receives</dt>
          <dd>{(PLATFORM_FEE_BPS / 100).toFixed(2)}%</dd>
          <span>Taken from the total above</span>
        </div>
      </dl>

      {totalSwapFeeBps >= 500 ? (
        <p className="meme-fee-warning">
          High swap fees can reduce trading demand and may trigger warnings in
          wallets or market data tools
        </p>
      ) : null}
    </div>
  );
}

function ReviewStep({
  draft,
  summary,
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
  const feeBreakdown = getMemeFeeBreakdown(draft);
  const totalSwapFeeBps = feeBreakdown?.totalSwapFeeBps ?? 100;
  const creatorFeeBps = feeBreakdown?.creatorFeeBps ?? 90;
  const checks: LaunchPreflightCheck[] = preflight?.checks ?? [
    {
      id: "token",
      label: "Token setup",
      status: "pending",
      detail: "Validated from the final token and fee settings",
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
      label: "Launch contracts",
      status: "pending",
      detail: "The launch contracts are verified before the wallet opens",
    },
    {
      id: "simulation",
      label: "Simulation",
      status: "pending",
      detail: "The exact transaction is tested before wallet review",
    },
  ];
  const preparedTransaction = preflight?.transaction;
  const launchSubmitted = Boolean(transactionHash);
  const submitPrepared = Boolean(preparedTransaction) && !transactionHash;
  const primaryLabel = preflightLoading
    ? "Checking"
    : transactionSending
      ? "Opening wallet"
      : launchSubmitted
        ? "Launch submitted"
        : submitPrepared
          ? "Launch token"
          : walletConnected
            ? preflight
              ? "Check again"
              : "Check launch"
            : "Connect wallet";

  return (
    <div className="form-section review-section standard-review-section">
      <div className="form-section-heading">
        <h2>Review the launch</h2>
      </div>

      <div className="review-statement">
        <p className="eyebrow">Summary</p>
        <p>{summary}</p>
      </div>

      <dl className="review-details standard-review-details">
        <div>
          <dt>Token</dt>
          <dd>
            <strong>
              {draft.tokenName} {draft.tokenSymbol ? `(${draft.tokenSymbol})` : ""}
            </strong>
            <span>1,000,000,000 fixed supply with 18 decimals</span>
          </dd>
        </div>
        <div>
          <dt>Launch cost</dt>
          <dd>
            <strong>No launch fee or liquidity deposit</strong>
            <span>
              {getInitialBuyEthLabel(draft)} buys the creator’s first tokens.
              Network gas is separate
            </span>
          </dd>
        </div>
        <div>
          <dt>Liquidity</dt>
          <dd>
            <strong>The complete supply seeds the pool</strong>
            <span>
              One-sided Uniswap v4 liquidity starts at{" "}
              {MEME_STARTING_FDV_ETH_LABEL} FDV and remains permanently locked
            </span>
          </dd>
        </div>
        <div>
          <dt>Fees</dt>
          <dd>
            <strong>{(totalSwapFeeBps / 100).toFixed(2)}% total swap fee</strong>
            <span>
              {(creatorFeeBps / 100).toFixed(2)}% to the creator and {" "}
              {(PLATFORM_FEE_BPS / 100).toFixed(2)}% to Programmable in ETH
            </span>
          </dd>
        </div>
      </dl>

      <div className="review-gates">
        <div className="block-heading">
          <div>
            <h3>Required checks</h3>
            <p>
              Exact call checks run before wallet review. The contracts have
              not been independently audited
            </p>
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
          Launch submitted
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
          disabled={preflightLoading || transactionSending || launchSubmitted}
          style={{ animation: "none", transform: "none", transition: "none" }}
          onClick={submitPrepared ? onSubmit : onCheck}
        >
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
