"use client";

import Image from "next/image";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleCheck,
  ImagePlus,
  RotateCcw,
  Trash2,
  X,
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
  type LaunchPreflightResponse,
} from "@/lib/launch-transaction";
import {
  CLASSIC_TOTAL_SWAP_FEE_BPS,
  CLASSIC_TOTAL_SWAP_FEE_PERCENT,
  createEmptyDraft,
  MEME_MIN_INITIAL_BUY_ETH,
  MEME_MIN_INITIAL_BUY_ETH_LABEL,
  parseInitialBuyWei,
  PLATFORM_FEE_BPS,
  type LaunchDraft,
} from "@/lib/launch";
import { prepareTokenImage } from "@/lib/token-image";

type TokenImageState = {
  status: "idle" | "preparing" | "waiting" | "uploading" | "ready" | "error";
  message: string;
};

type LaunchPhase = "idle" | "preparing" | "confirming";

export type IndexedLaunch = {
  address: `0x${string}`;
  href: string;
  name: string;
  symbol: string;
};

const emptyTokenImageState: TokenImageState = {
  status: "idle",
  message: "",
};

export function findIndexedLaunch(
  value: unknown,
  transactionHash: string,
): IndexedLaunch | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const tokens = (value as { tokens?: unknown }).tokens;
  if (!Array.isArray(tokens)) return null;

  for (const token of tokens) {
    if (!token || typeof token !== "object" || Array.isArray(token)) {
      continue;
    }
    const candidate = token as Record<string, unknown>;
    if (
      typeof candidate.launchTransactionHash !== "string" ||
      candidate.launchTransactionHash.toLowerCase() !==
        transactionHash.toLowerCase() ||
      typeof candidate.tokenAddress !== "string" ||
      !/^0x[a-fA-F0-9]{40}$/.test(candidate.tokenAddress) ||
      typeof candidate.name !== "string" ||
      typeof candidate.symbol !== "string"
    ) {
      continue;
    }

    const href =
      typeof candidate.href === "string" &&
      candidate.href.startsWith("/token/")
        ? candidate.href
        : `/token/${candidate.tokenAddress}`;
    return {
      address: candidate.tokenAddress as `0x${string}`,
      href,
      name: candidate.name,
      symbol: candidate.symbol,
    };
  }

  return null;
}

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
    totalSwapFeePercent: CLASSIC_TOTAL_SWAP_FEE_PERCENT,
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
              <span>Uniswap v4</span>
              <span>No liquidity deposit</span>
              <span>1.00% swap fee</span>
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
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const [launchPhase, setLaunchPhase] = useState<LaunchPhase>("idle");
  const [transactionHash, setTransactionHash] = useState("");
  const [submittedAccount, setSubmittedAccount] = useState("");
  const [indexedLaunch, setIndexedLaunch] =
    useState<IndexedLaunch | null>(null);
  const [successOpen, setSuccessOpen] = useState(false);
  const [tokenImageState, setTokenImageState] =
    useState<TokenImageState>(emptyTokenImageState);
  const currentLaunchContext = useRef({ draft, wallet });
  const draftVersion = useRef(0);
  const launching = launchPhase !== "idle";

  useEffect(() => {
    currentLaunchContext.current = { draft, wallet };
  }, [draft, wallet]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 2400);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!transactionHash || !submittedAccount || indexedLaunch) return;

    const controller = new AbortController();
    let timer = 0;
    let attempt = 0;

    const pollForLaunch = async () => {
      try {
        const response = await fetch(
          `/api/explore/profile?account=${encodeURIComponent(
            submittedAccount,
          )}&launch=${encodeURIComponent(
            transactionHash,
          )}&attempt=${attempt}`,
          {
            cache: "no-store",
            headers: { Accept: "application/json" },
            signal: controller.signal,
          },
        );
        const body: unknown = await response.json();
        if (response.ok) {
          const launch = findIndexedLaunch(body, transactionHash);
          if (launch) {
            setIndexedLaunch(launch);
            setSuccessOpen(true);
            setNotice("Token launched");
            return;
          }
        }
      } catch (caught) {
        if (
          caught instanceof DOMException &&
          caught.name === "AbortError"
        ) {
          return;
        }
      }

      attempt += 1;
      timer = window.setTimeout(pollForLaunch, 3_000);
    };

    void pollForLaunch();
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [
    indexedLaunch,
    submittedAccount,
    transactionHash,
  ]);

  function validateLaunch() {
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
      validateMemeLaunchDraft(draft);
      return "";
    } catch (caught) {
      return caught instanceof Error
        ? caught.message
        : "Check the token details and try again";
    }
  }

  function markDraftEdited() {
    draftVersion.current += 1;
    setFormError("");
    setTransactionHash("");
    setSubmittedAccount("");
    setIndexedLaunch(null);
    setSuccessOpen(false);
  }

  async function requestLaunchCheck(
    checkedDraft: LaunchDraft,
    connectedWallet: NonNullable<typeof wallet>,
  ) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20_000);

    try {
      const response = await fetch("/api/launch/preflight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account: connectedWallet.account,
          walletChainId: connectedWallet.chainId,
          draft: checkedDraft,
        }),
        signal: controller.signal,
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
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") {
        throw new Error("The launch check timed out. Try again");
      }
      throw caught;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function persistLaunchDraft(
    nextDraft: LaunchDraft,
    connectedWallet = currentLaunchContext.current.wallet,
  ) {
    saveLocalDraft(nextDraft);
    setDraft(nextDraft);
    currentLaunchContext.current = {
      draft: nextDraft,
      wallet: connectedWallet,
    };
  }

  async function prepareLaunch(
    initialLaunchDraft: LaunchDraft,
    connectedWallet: NonNullable<typeof wallet>,
  ) {
    let checkedDraft = initialLaunchDraft;
    let result = await requestLaunchCheck(checkedDraft, connectedWallet);

    if (result.draftPatch) {
      checkedDraft = {
        ...checkedDraft,
        ...result.draftPatch,
        updatedAt: new Date().toISOString(),
      };
      persistLaunchDraft(checkedDraft, connectedWallet);
      result = await requestLaunchCheck(checkedDraft, connectedWallet);
    }

    if (
      result.status !== "ready" ||
      !result.transaction ||
      !result.planHash
    ) {
      throw new Error(result.detail || "The launch could not be prepared");
    }

    return {
      checkedDraft,
      planHash: result.planHash,
      transaction: result.transaction,
    };
  }

  async function launchToken() {
    if (launching || transactionHash) return;

    if (!wallet) {
      openWallet();
      return;
    }

    const validationError = validateLaunch();
    if (validationError) {
      setFormError(validationError);
      return;
    }

    const launchWallet = { ...wallet };
    const launchDraftVersion = draftVersion.current;
    let checkedDraft = normalizeStandardDraft(draft);
    if (!/^0x[a-fA-F0-9]{64}$/.test(checkedDraft.launchSalt)) {
      checkedDraft = {
        ...checkedDraft,
        launchSalt: createLaunchSalt(),
        updatedAt: new Date().toISOString(),
      };
    }
    persistLaunchDraft(checkedDraft, launchWallet);
    setFormError("");
    setLaunchPhase("preparing");
    setTransactionHash("");

    try {
      const prepared = await prepareLaunch(checkedDraft, launchWallet);
      checkedDraft = prepared.checkedDraft;

      const latest = currentLaunchContext.current;
      if (
        draftVersion.current !== launchDraftVersion ||
        !latest.wallet ||
        latest.wallet.account.toLowerCase() !==
          launchWallet.account.toLowerCase() ||
        latest.wallet.chainId.toLowerCase() !==
          launchWallet.chainId.toLowerCase()
      ) {
        throw new Error("The token or connected wallet changed. Try again");
      }

      const validatedTransaction =
        validatePreparedClassicLaunchTransaction({
          transaction: prepared.transaction,
          draft: checkedDraft,
          account: launchWallet.account,
          planHash: prepared.planHash,
        });
      setLaunchPhase("confirming");
      const hash = await sendTransaction(validatedTransaction);
      setSubmittedAccount(launchWallet.account);
      setTransactionHash(hash);
      setNotice("Confirming launch");
    } catch (caught) {
      setFormError(
        caught instanceof Error
          ? caught.message
          : "The launch did not complete. Try again",
      );
    } finally {
      setLaunchPhase("idle");
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
        </div>
      </header>

      <form
        className="classic-launch-sheet"
        aria-busy={launching}
        onSubmit={(event) => {
          event.preventDefault();
          void launchToken();
        }}
      >
        <div className="classic-launch-content">
          <TokenStep
            draft={draft}
            setDraft={setDraft}
            onEdit={markDraftEdited}
            onImageStateChange={setTokenImageState}
          />
          <FeeStep
            draft={draft}
            setDraft={setDraft}
            onEdit={markDraftEdited}
          />
        </div>

        <footer className="classic-launch-footer">
          <div className="classic-launch-status">
            {formError ? (
              <p className="form-error" role="alert">
                {formError}
              </p>
            ) : indexedLaunch ? (
              <p>
                {indexedLaunch.name} <span>·</span> ${indexedLaunch.symbol}
              </p>
            ) : transactionHash ? (
              <a
                className="transaction-link"
                href={`${
                  wallet?.chainId === "0xaa36a7"
                    ? "https://sepolia.etherscan.io"
                    : "https://etherscan.io"
                }/tx/${transactionHash}`}
                target="_blank"
                rel="noreferrer"
              >
                Confirming launch
                <span>{shortenAddress(transactionHash)}</span>
              </a>
            ) : (
              <p>
                1B fixed supply <span>·</span> Uniswap v4 <span>·</span>{" "}
                Locked liquidity
              </p>
            )}
          </div>
          {indexedLaunch ? (
            <Link
              className="primary-button classic-launch-button"
              href={indexedLaunch.href}
            >
              View your token
            </Link>
          ) : (
            <button
              className="primary-button classic-launch-button"
              type="submit"
              disabled={launching || Boolean(transactionHash)}
              style={{
                animation: "none",
                transform: "none",
                transition: "none",
              }}
            >
              {launchPhase === "preparing"
                ? "Preparing launch"
                : launchPhase === "confirming"
                  ? "Confirm in wallet"
                  : transactionHash
                    ? "Confirming launch"
                    : wallet
                      ? "Launch token"
                      : "Connect wallet"}
            </button>
          )}
        </footer>
      </form>

      {indexedLaunch && successOpen ? (
        <LaunchSuccessDialog
          launch={indexedLaunch}
          onClose={() => setSuccessOpen(false)}
        />
      ) : null}

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

function LaunchSuccessDialog({
  launch,
  onClose,
}: {
  launch: IndexedLaunch;
  onClose: () => void;
}) {
  const viewLinkRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    viewLinkRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  return (
    <div
      className="launch-success-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="launch-success-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="launch-success-title"
      >
        <button
          className="icon-button launch-success-close"
          type="button"
          aria-label="Close launch confirmation"
          onClick={onClose}
        >
          <X aria-hidden="true" size={18} />
        </button>
        <CircleCheck
          className="launch-success-icon"
          aria-hidden="true"
          size={36}
          strokeWidth={1.6}
        />
        <p className="eyebrow">Launch complete</p>
        <h2 id="launch-success-title">Your token is live</h2>
        <p>
          {launch.name} <span>${launch.symbol}</span>
        </p>
        <Link
          ref={viewLinkRef}
          className="primary-button"
          href={launch.href}
        >
          View your token
        </Link>
      </section>
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
    <section className="classic-token-section">
      <div className="classic-section-heading">
        <h2>Token details</h2>
      </div>

      <div className="classic-token-grid">
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
            className={`token-image-upload${imagePreview ? " has-image" : ""}`}
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
                <ImagePlus aria-hidden="true" size={21} />
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
              role={imageState.status === "error" ? "alert" : undefined}
            >
              {imageState.message || "JPG, PNG or WebP"}
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

        <div className="classic-token-main">
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

          <label className="field classic-description-field">
            <span>Description (optional)</span>
            <textarea
              value={draft.tokenDescription}
              maxLength={MAX_TOKEN_DESCRIPTION_BYTES}
              rows={2}
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
        </div>
      </div>

      <div className="classic-link-fields">
        <label className="field">
          <span>Website (optional)</span>
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
          <span>X link (optional)</span>
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
          <span>Telegram (optional)</span>
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
    </section>
  );
}

function FeeStep({
  draft,
  setDraft,
  onEdit,
}: {
  draft: LaunchDraft;
  setDraft: Dispatch<SetStateAction<LaunchDraft>>;
  onEdit: () => void;
}) {
  const creatorFeeBps =
    CLASSIC_TOTAL_SWAP_FEE_BPS - PLATFORM_FEE_BPS;
  const selectedFeePercent = Number(CLASSIC_TOTAL_SWAP_FEE_PERCENT);

  return (
    <section className="classic-fee-section">
      <div className="classic-section-heading classic-fee-heading">
        <h2>Swap fee</h2>
        <p>
          Creator receives {(creatorFeeBps / 100).toFixed(2)}%
          <span>·</span>
          Programmable receives {(PLATFORM_FEE_BPS / 100).toFixed(2)}%
        </p>
      </div>

      <div className="classic-fee-layout">
        <div className="classic-fee-slider">
          <div className="classic-fee-slider-row">
            <div className="classic-fee-slider-control">
              <span className="classic-fee-slider-track" aria-hidden="true">
                <span style={{ width: "0%" }} />
              </span>
              <input
                id="classic-swap-fee"
                type="range"
                min="1"
                max="10"
                step="1"
                value={selectedFeePercent}
                aria-label="Total swap fee"
                aria-valuetext="Fixed 1.00% total swap fee"
                disabled
              />
            </div>
            <output htmlFor="classic-swap-fee">
              1.00%
            </output>
          </div>
          <div className="classic-fee-slider-limits" aria-hidden="true">
            <span>1.00%</span>
            <span>Fixed</span>
          </div>
        </div>

        <label className="meme-dev-buy" htmlFor="classic-dev-buy">
          <span>
            <strong>Dev Buy</strong>
            <small>
              Minimum {MEME_MIN_INITIAL_BUY_ETH_LABEL}
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
              onChange={(event) => {
                onEdit();
                updateDraft(setDraft, {
                  initialBuyEth: event.target.value,
                });
              }}
            />
            <span>ETH</span>
          </span>
        </label>
      </div>
    </section>
  );
}
