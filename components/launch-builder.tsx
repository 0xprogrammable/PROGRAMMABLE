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
import { useWallet } from "@/components/wallet-provider";
import extendedLayout from "@/components/extended-launch-layout.module.css";
import { validatePreparedClassicLaunchTransaction } from "@/lib/classic-launch-validation";
import { validatePreparedClassicV3LaunchTransaction } from "@/lib/classic-v3-launch-validation";
import {
  buildClassicV3LaunchDisclosure,
  formatClassicV3Percent,
  validateClassicV3LaunchDraft,
} from "@/lib/classic-v3";
import { isConfiguredClassicV3ReleaseReady } from "@/lib/classic-v3-release";
import {
  deepV3PresetDisclosure,
  validateDeepV3LaunchDraft,
} from "@/lib/deep-v3";
import { validatePreparedDeepV3LaunchTransaction } from "@/lib/deep-v3-launch-validation";
import { isConfiguredDeepV3ReleaseReady } from "@/lib/deep-v3-release";
import {
  validatePreparedStockPairedLaunchTransaction,
  validatePreparedStockQuoteApprovalTransaction,
} from "@/lib/stock-paired-launch-validation";
import {
  getStockQuoteAsset,
  STOCK_QUOTE_ASSETS,
  STOCK_PAIRED_MIN_INITIAL_BUY,
  STOCK_PAIRED_MIN_INITIAL_BUY_RAW,
  validateStockPairedLaunchDraft,
} from "@/lib/stock-paired";
import { isConfiguredStockPairedReleaseReady } from "@/lib/stock-paired-release";
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
  createClassicV3Draft,
  createDeepDraft,
  createEmptyDraft,
  createStockPairedDraft,
  maximumClassicDevBuyWei,
  MEME_MIN_INITIAL_BUY_ETH,
  MEME_MIN_INITIAL_BUY_ETH_LABEL,
  parseInitialBuyWei,
  PLATFORM_FEE_BPS,
  type LaunchDraft,
  type LaunchModel,
} from "@/lib/launch";
import { resolveImplementedLaunchModel } from "@/lib/launch-model-gating";
import { prepareTokenImage } from "@/lib/token-image";
import { formatEther, formatUnits, type Hex } from "viem";

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
      typeof candidate.href === "string" && candidate.href.startsWith("/token/")
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

export function findClassicV3IndexedLaunch(
  value: unknown,
): IndexedLaunch | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const launch = (value as { launch?: unknown }).launch;
  if (!launch || typeof launch !== "object" || Array.isArray(launch)) {
    return null;
  }
  const candidate = launch as Record<string, unknown>;
  if (
    typeof candidate.tokenAddress !== "string" ||
    !/^0x[a-fA-F0-9]{40}$/.test(candidate.tokenAddress) ||
    typeof candidate.name !== "string" ||
    typeof candidate.symbol !== "string"
  ) {
    return null;
  }
  return {
    address: candidate.tokenAddress as `0x${string}`,
    href: `/token/${candidate.tokenAddress}`,
    name: candidate.name,
    symbol: candidate.symbol,
  };
}

export function findDeepV3IndexedLaunch(
  value: unknown,
  transactionHash: string,
): IndexedLaunch | null {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !/^0x[a-fA-F0-9]{64}$/.test(transactionHash)
  ) {
    return null;
  }
  const launch = (value as { launch?: unknown }).launch;
  if (!launch || typeof launch !== "object" || Array.isArray(launch)) {
    return null;
  }
  const candidate = launch as Record<string, unknown>;
  const provenance = candidate.deepV3Provenance;
  if (
    typeof candidate.tokenAddress !== "string" ||
    !/^0x[a-fA-F0-9]{40}$/.test(candidate.tokenAddress) ||
    typeof candidate.name !== "string" ||
    typeof candidate.symbol !== "string" ||
    candidate.deepReleaseVersion !== "deep-full-range-v3" ||
    !provenance ||
    typeof provenance !== "object" ||
    Array.isArray(provenance)
  ) {
    return null;
  }
  const proof = provenance as Record<string, unknown>;
  if (
    proof.deepReleaseVersion !== "deep-full-range-v3" ||
    proof.launchModel !== "deep" ||
    typeof proof.tokenAddress !== "string" ||
    proof.tokenAddress.toLowerCase() !== candidate.tokenAddress.toLowerCase() ||
    typeof proof.transactionHash !== "string" ||
    proof.transactionHash.toLowerCase() !== transactionHash.toLowerCase() ||
    typeof proof.launcher !== "string" ||
    !/^0x[a-fA-F0-9]{40}$/.test(proof.launcher) ||
    typeof proof.creator !== "string" ||
    !/^0x[a-fA-F0-9]{40}$/.test(proof.creator) ||
    typeof proof.vaultAddress !== "string" ||
    !/^0x[a-fA-F0-9]{40}$/.test(proof.vaultAddress) ||
    typeof proof.hookAddress !== "string" ||
    !/^0x[a-fA-F0-9]{40}$/.test(proof.hookAddress) ||
    typeof proof.positionRecipient !== "string" ||
    !/^0x[a-fA-F0-9]{40}$/.test(proof.positionRecipient) ||
    typeof proof.positionTokenId !== "string" ||
    !/^(?:0|[1-9]\d*)$/.test(proof.positionTokenId) ||
    typeof proof.poolId !== "string" ||
    !/^0x[a-fA-F0-9]{64}$/.test(proof.poolId) ||
    typeof proof.launchHash !== "string" ||
    !/^0x[a-fA-F0-9]{64}$/.test(proof.launchHash) ||
    typeof proof.vaultConfigurationHash !== "string" ||
    !/^0x[a-fA-F0-9]{64}$/.test(proof.vaultConfigurationHash) ||
    typeof proof.blockNumber !== "string" ||
    !/^\d+$/.test(proof.blockNumber) ||
    typeof proof.blockHash !== "string" ||
    !/^0x[a-fA-F0-9]{64}$/.test(proof.blockHash) ||
    !Number.isSafeInteger(proof.transactionIndex) ||
    (proof.transactionIndex as number) < 0 ||
    !Number.isSafeInteger(proof.logIndex) ||
    (proof.logIndex as number) < 0
  ) {
    return null;
  }
  return {
    address: candidate.tokenAddress as `0x${string}`,
    href: `/token/${candidate.tokenAddress}`,
    name: candidate.name,
    symbol: candidate.symbol,
  };
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
    launchModel: "classic",
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

function normalizeClassicV3Draft(initialDraft: LaunchDraft): LaunchDraft {
  return {
    ...normalizeStandardDraft(initialDraft),
    launchModel: "classic-v3",
    buySwapFeePercent: initialDraft.buySwapFeePercent || "1",
    sellSwapFeePercent: initialDraft.sellSwapFeePercent || "1",
    rewardDestinationMode: initialDraft.rewardDestinationMode || "launcher",
  };
}

export function normalizeDeepDraft(initialDraft: LaunchDraft): LaunchDraft {
  return {
    ...normalizeClassicV3Draft(initialDraft),
    launchModel: "deep",
    totalSwapFeePercent: "1",
    buySwapFeePercent: "1",
    sellSwapFeePercent: "1",
    rewardDestinationMode: "launcher",
    rewardExternalAddress: "",
    rewardSplits: [],
  };
}

export function normalizeStockPairedDraft(
  initialDraft: LaunchDraft,
): LaunchDraft {
  const fallbackAsset = STOCK_QUOTE_ASSETS[0];
  const selectedAsset =
    getStockQuoteAsset(initialDraft.stockQuoteAsset) ?? fallbackAsset;
  return {
    ...normalizeClassicV3Draft(initialDraft),
    launchModel: "stock-paired",
    initialBuyEth: "",
    stockQuoteAsset: selectedAsset.address,
    initialBuyQuoteAmount:
      initialDraft.initialBuyQuoteAmount?.trim() ||
      STOCK_PAIRED_MIN_INITIAL_BUY,
    totalSwapFeePercent: "1",
    buySwapFeePercent: "1",
    sellSwapFeePercent: "1",
    rewardDestinationMode: "launcher",
    rewardExternalAddress: "",
    rewardSplits: [],
  };
}

const launchEnvironment =
  process.env.NEXT_PUBLIC_PROGRAMMABLE_ONCHAIN_NETWORK === "rehearsal"
    ? "rehearsal"
    : "production";
const classicV3LaunchAvailable =
  isConfiguredClassicV3ReleaseReady(launchEnvironment);
const deepLaunchAvailable =
  isConfiguredDeepV3ReleaseReady(launchEnvironment);
const stockPairedLaunchAvailable =
  (process.env.NODE_ENV !== "production" &&
    process.env.NEXT_PUBLIC_STOCK_PAIRED_UI_PREVIEW === "true") ||
  isConfiguredStockPairedReleaseReady(launchEnvironment);

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

async function waitForLaunchTransaction(
  transactionHash: Hex,
  chainId: number,
): Promise<"confirmed" | "reverted"> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const response = await fetch(
      `/api/transaction-status?hash=${encodeURIComponent(
        transactionHash,
      )}&chainId=${chainId}`,
      {
        cache: "no-store",
        headers: { Accept: "application/json" },
      },
    );
    const body = (await response.json()) as {
      status?: "pending" | "confirmed" | "reverted";
    };
    if (!response.ok) {
      throw new Error("The approval status could not be checked");
    }
    if (body.status === "confirmed" || body.status === "reverted") {
      return body.status;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 1_500));
  }
  throw new Error("The approval is still pending");
}

export function LaunchBuilder() {
  const [selectedModel, setSelectedModel] = useState<LaunchModel | null>(null);

  function chooseModel(candidate: LaunchModel) {
    const model = resolveImplementedLaunchModel(candidate);
    if (
      !model ||
      (model === "deep" && !deepLaunchAvailable) ||
      (model === "stock-paired" && !stockPairedLaunchAvailable)
    ) {
      return;
    }

    window.scrollTo({ left: 0, top: 0, behavior: "auto" });
    setSelectedModel(model);
  }

  function returnToModels() {
    window.scrollTo({ left: 0, top: 0, behavior: "auto" });
    setSelectedModel(null);
  }

  if (!selectedModel) {
    return <LaunchModelPicker onChoose={chooseModel} />;
  }

  return (
    <LaunchBuilderForm
      model={selectedModel}
      initialDraft={
        selectedModel === "deep"
          ? createDeepDraft()
          : selectedModel === "stock-paired"
            ? normalizeStockPairedDraft(createStockPairedDraft())
          : selectedModel === "classic-v3"
            ? createClassicV3Draft()
            : normalizeStandardDraft(createEmptyDraft())
      }
      onBackToModels={returnToModels}
    />
  );
}

export function LaunchModelPicker({
  onChoose,
}: {
  onChoose: (model: LaunchModel) => void;
}) {
  return (
    <div className="launch-model-page page-width">
      <header className="launch-model-heading">
        <h1>Launch a token</h1>
      </header>

      <div className="launch-model-grid">
        <button
          className="launch-model-card"
          data-launch-model-option="classic"
          type="button"
          aria-describedby="launch-model-classic-description launch-model-classic-details"
          onClick={() =>
            onChoose(classicV3LaunchAvailable ? "classic-v3" : "classic")
          }
        >
          <span
            className="launch-model-art launch-model-art-classic"
            aria-hidden="true"
          >
            <Image
              src="/brand/programmable-classic-launch-art-card.webp"
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
            <span
              className="launch-model-description"
              id="launch-model-classic-description"
            >
              A straightforward Uniswap v4 token with swap fees fixed at launch.
              Creator rewards accrue in ETH.
            </span>
            <span
              className="launch-model-details"
              id="launch-model-classic-details"
            >
              <span>Uniswap v4</span>
              <span>No liquidity deposit</span>
              <span>
                {classicV3LaunchAvailable
                  ? "Choose buy and sell fees"
                  : "Fixed 1.00% swap fee"}
              </span>
            </span>
            <span className="launch-model-action">
              Launch
              <ArrowRight aria-hidden="true" size={16} />
            </span>
          </span>
        </button>

        {stockPairedLaunchAvailable ? (
          <button
            className="launch-model-card launch-model-card-stock"
            data-launch-model-option="stock-paired"
            type="button"
            aria-describedby="launch-model-stock-description launch-model-stock-details"
            onClick={() => onChoose("stock-paired")}
          >
            <span
              className="launch-model-art launch-model-art-stock"
              aria-hidden="true"
            >
              <Image
                src="/brand/programmable-stock-paired-launch-art-v1.webp"
                alt=""
                fill
                sizes="(max-width: 800px) 100vw, 420px"
                unoptimized
              />
            </span>

            <span className="launch-model-card-body">
              <span className="launch-model-card-heading">
                <strong>Stock-Paired</strong>
              </span>
              <span
                className="launch-model-description"
                id="launch-model-stock-description"
              >
                Launch a token against one of seven reviewed Ondo Stocks quote
                assets.
              </span>
              <span
                className="launch-model-details"
                id="launch-model-stock-details"
              >
                <span>Seven quote assets</span>
                <span>1.00% swap fee</span>
                <span>Initial buy and rewards in the quote asset</span>
              </span>
              <span className="launch-model-action">
                Launch
                <ArrowRight aria-hidden="true" size={16} />
              </span>
            </span>
          </button>
        ) : null}

        <button
          className="launch-model-card launch-model-card-deep"
          data-launch-model-option="deep"
          type="button"
          disabled={!deepLaunchAvailable}
          aria-describedby="launch-model-deep-description launch-model-deep-details"
          onClick={() => onChoose("deep")}
        >
          <span
            className="launch-model-art launch-model-art-deep"
            aria-hidden="true"
          >
            <Image
              src="/brand/programmable-deep-liquidity-teaser-v1-1774x887.webp"
              alt=""
              fill
              sizes="(max-width: 800px) 100vw, 420px"
              unoptimized
            />
          </span>

          <span className="launch-model-card-body">
            <span className="launch-model-card-heading">
              <strong>Deep</strong>
              {!deepLaunchAvailable ? (
                <small data-status="pending">Verification pending</small>
              ) : null}
            </span>
            <span
              className="launch-model-description"
              id="launch-model-deep-description"
            >
              Trading fees buy the token and add both assets to the original
              permanently locked v4 pool.
            </span>
            <span
              className="launch-model-details"
              id="launch-model-deep-details"
            >
              <span>Original v4 pool</span>
              <span>0.90% pool growth</span>
              <span>Five-minute checks</span>
            </span>
            <span className="launch-model-action">
              {deepLaunchAvailable ? "Launch" : "Unavailable"}
              {deepLaunchAvailable ? (
                <ArrowRight aria-hidden="true" size={16} />
              ) : null}
            </span>
          </span>
        </button>
      </div>
    </div>
  );
}

function LaunchBuilderForm({
  model,
  initialDraft,
  onBackToModels,
}: {
  model: LaunchModel;
  initialDraft: LaunchDraft;
  onBackToModels: () => void;
}) {
  const {
    wallet,
    openWallet,
    readNativeBalance,
    readTradeBalances,
    sendTransaction,
  } =
    useWallet();
  const [draft, setDraft] = useState<LaunchDraft>(initialDraft);
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const [launchPhase, setLaunchPhase] = useState<LaunchPhase>("idle");
  const [transactionHash, setTransactionHash] = useState("");
  const [submittedAccount, setSubmittedAccount] = useState("");
  const [indexedLaunch, setIndexedLaunch] = useState<IndexedLaunch | null>(
    null,
  );
  const [successOpen, setSuccessOpen] = useState(false);
  const [settingMaxBuy, setSettingMaxBuy] = useState(false);
  const [tokenImageState, setTokenImageState] =
    useState<TokenImageState>(emptyTokenImageState);
  const currentLaunchContext = useRef({ draft, wallet });
  const draftVersion = useRef(0);
  const launching = launchPhase !== "idle";
  const usesExtendedLayout =
    model === "classic-v3" ||
    model === "deep" ||
    model === "stock-paired";

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
        const endpoint =
          model === "deep"
            ? `/api/explore/launch/deep-v3?account=${encodeURIComponent(
                submittedAccount,
              )}&transaction=${encodeURIComponent(
                transactionHash,
              )}`
            : model === "stock-paired"
              ? `/api/explore/launch/stock-paired?account=${encodeURIComponent(
                  submittedAccount,
                )}&transaction=${encodeURIComponent(transactionHash)}`
            : model === "classic-v3"
            ? `/api/profile/classic-v3?account=${encodeURIComponent(
                submittedAccount,
              )}&launch=${encodeURIComponent(transactionHash)}`
            : `/api/explore/profile?account=${encodeURIComponent(
                submittedAccount,
              )}&launch=${encodeURIComponent(transactionHash)}&attempt=${attempt}`;
        const response = await fetch(endpoint, {
          cache: "no-store",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        const body: unknown = await response.json();
        if (response.ok) {
          const launch =
            model === "deep"
              ? findDeepV3IndexedLaunch(body, transactionHash)
              : model === "stock-paired"
                ? findClassicV3IndexedLaunch(body)
              : model === "classic-v3"
                ? findClassicV3IndexedLaunch(body)
              : findIndexedLaunch(body, transactionHash);
          if (launch) {
            setIndexedLaunch(launch);
            setSuccessOpen(true);
            setNotice("Token launched");
            return;
          }
        }
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === "AbortError") {
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
  }, [indexedLaunch, model, submittedAccount, transactionHash]);

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
      if (model === "deep") {
        if (!wallet) return "Connect a wallet to verify the launch";
        validateDeepV3LaunchDraft(draft, wallet.account);
      } else if (model === "stock-paired") {
        if (!wallet) return "Connect a wallet to verify the launch";
        validateStockPairedLaunchDraft(draft, wallet.account);
      } else if (model === "classic-v3") {
        if (!wallet) return "Connect a wallet to verify the reward setup";
        validateClassicV3LaunchDraft(draft, wallet.account);
      } else {
        validateMemeLaunchDraft(draft);
      }
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
        LaunchPreflightResponse | { error: string };
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
    setDraft(nextDraft);
    currentLaunchContext.current = {
      draft: nextDraft,
      wallet: connectedWallet,
    };
  }

  async function setMaximumDevBuy() {
    if (!wallet || settingMaxBuy || launching) {
      if (!wallet) openWallet();
      return;
    }

    const validationError = validateLaunch();
    if (validationError) {
      setFormError(validationError);
      return;
    }

    setSettingMaxBuy(true);
    setFormError("");

    try {
      let checkedDraft =
        model === "deep"
          ? normalizeDeepDraft(draft)
          : model === "stock-paired"
            ? normalizeStockPairedDraft(draft)
            : model === "classic-v3"
              ? normalizeClassicV3Draft(draft)
              : normalizeStandardDraft(draft);
      if (!/^0x[a-fA-F0-9]{64}$/.test(checkedDraft.launchSalt)) {
        checkedDraft = {
          ...checkedDraft,
          launchSalt: createLaunchSalt(),
          updatedAt: new Date().toISOString(),
        };
      }

      if (model === "stock-paired") {
        const configuration = validateStockPairedLaunchDraft(
          checkedDraft,
          wallet.account,
        );
        const balances = await readTradeBalances(
          configuration.quoteAsset.address,
        );
        if (balances.tokenBalanceRaw < STOCK_PAIRED_MIN_INITIAL_BUY_RAW) {
          throw new Error(
            `This wallet needs at least ${STOCK_PAIRED_MIN_INITIAL_BUY} ${configuration.quoteAsset.symbol}`,
          );
        }
        markDraftEdited();
        persistLaunchDraft(
          {
            ...checkedDraft,
            initialBuyQuoteAmount: formatUnits(
              balances.tokenBalanceRaw,
              18,
            ),
            updatedAt: new Date().toISOString(),
          },
          wallet,
        );
        return;
      }

      const prepared = await prepareLaunch(checkedDraft, wallet);
      if (prepared.kind !== "launch") {
        throw new Error("Approve the quote token before using Max");
      }
      const balances = await readNativeBalance();
      const gasLimit = BigInt(prepared.transaction.gasLimit);
      const maximum = maximumClassicDevBuyWei({
        nativeBalanceWei: balances.nativeBalanceWei,
        gasLimit,
        gasPriceWei: balances.gasPriceWei,
      });
      const minimum = parseInitialBuyWei(MEME_MIN_INITIAL_BUY_ETH) ?? 0n;

      if (maximum < minimum) {
        throw new Error(
          "This wallet needs more ETH for the minimum Dev Buy and network gas",
        );
      }

      markDraftEdited();
      persistLaunchDraft(
        {
          ...prepared.checkedDraft,
          initialBuyEth: formatEther(maximum),
          updatedAt: new Date().toISOString(),
        },
        wallet,
      );
    } catch (caught) {
      setFormError(
        caught instanceof Error
          ? caught.message
          : "The maximum Dev Buy could not be calculated",
      );
    } finally {
      setSettingMaxBuy(false);
    }
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
      result.status === "approval-required" &&
      result.approvalTransaction &&
      result.planHash
    ) {
      return {
        kind: "approval" as const,
        checkedDraft,
        planHash: result.planHash,
        transaction: result.approvalTransaction,
      };
    }

    if (result.status !== "ready" || !result.transaction || !result.planHash) {
      throw new Error(result.detail || "The launch could not be prepared");
    }

    return {
      kind: "launch" as const,
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
    let checkedDraft =
      model === "deep"
        ? normalizeDeepDraft(draft)
        : model === "stock-paired"
          ? normalizeStockPairedDraft(draft)
          : model === "classic-v3"
            ? normalizeClassicV3Draft(draft)
            : normalizeStandardDraft(draft);
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
      let prepared = await prepareLaunch(checkedDraft, launchWallet);
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

      if (prepared.kind === "approval") {
        if (model !== "stock-paired") {
          throw new Error("This launch does not support quote-token approval");
        }
        const approval = validatePreparedStockQuoteApprovalTransaction({
          transaction: prepared.transaction,
          draft: checkedDraft,
          account: launchWallet.account,
          planHash: prepared.planHash,
        });
        setLaunchPhase("confirming");
        const approvalHash = await sendTransaction(approval);
        setNotice("Confirming Initial Buy approval");
        const approvalStatus = await waitForLaunchTransaction(
          approvalHash,
          1,
        );
        if (approvalStatus === "reverted") {
          throw new Error("The Initial Buy approval reverted onchain");
        }

        setLaunchPhase("preparing");
        for (let attempt = 0; attempt < 8; attempt += 1) {
          prepared = await prepareLaunch(checkedDraft, launchWallet);
          if (prepared.kind === "launch") break;
          await new Promise((resolve) =>
            window.setTimeout(resolve, 1_000),
          );
        }
        if (prepared.kind !== "launch") {
          throw new Error(
            "The approval is confirmed, but the launch RPC has not indexed it yet. Try Launch again",
          );
        }
        const latestAfterApproval = currentLaunchContext.current;
        if (
          draftVersion.current !== launchDraftVersion ||
          !latestAfterApproval.wallet ||
          latestAfterApproval.wallet.account.toLowerCase() !==
            launchWallet.account.toLowerCase() ||
          latestAfterApproval.wallet.chainId.toLowerCase() !==
            launchWallet.chainId.toLowerCase()
        ) {
          throw new Error(
            "The token or connected wallet changed after approval. Try Launch again",
          );
        }
      }

      const validatedTransaction =
        model === "deep"
          ? await validatePreparedDeepV3LaunchTransaction({
              transaction: prepared.transaction,
              draft: checkedDraft,
              account: launchWallet.account,
              planHash: prepared.planHash,
            })
          : model === "stock-paired"
            ? validatePreparedStockPairedLaunchTransaction({
                transaction: prepared.transaction,
                draft: checkedDraft,
                account: launchWallet.account,
                planHash: prepared.planHash,
              })
          : model === "classic-v3"
            ? validatePreparedClassicV3LaunchTransaction({
                transaction: prepared.transaction,
                draft: checkedDraft,
                account: launchWallet.account,
                planHash: prepared.planHash,
              })
            : validatePreparedClassicLaunchTransaction({
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
    <div
      className={`launch-page page-width ${
        usesExtendedLayout ? extendedLayout.page : ""
      }`}
      data-launch-model={model}
    >
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
          <h1>Create your token</h1>
        </div>
      </header>

      <form
        className={`classic-launch-sheet ${
          usesExtendedLayout ? extendedLayout.sheet : ""
        }`}
        aria-busy={launching}
        onSubmit={(event) => {
          event.preventDefault();
          void launchToken();
        }}
      >
        <div
          className={`classic-launch-content ${
            usesExtendedLayout ? extendedLayout.content : ""
          }`}
        >
          <TokenStep
            draft={draft}
            setDraft={setDraft}
            onEdit={markDraftEdited}
            onImageStateChange={setTokenImageState}
          />
          {model === "deep" ? <DeepPresetStep /> : null}
          {model === "deep" ? (
            <DeepFeeStep
              draft={draft}
              setDraft={setDraft}
              onEdit={markDraftEdited}
            />
          ) : model === "classic-v3" ? (
            <EnhancedClassicFeeStep
              draft={draft}
              account={wallet?.account}
              setDraft={setDraft}
              onEdit={markDraftEdited}
              settingMaxBuy={settingMaxBuy}
              onMaximumDevBuy={() => void setMaximumDevBuy()}
            />
          ) : model === "stock-paired" ? (
            <StockPairedStep
              draft={draft}
              account={wallet?.account}
              setDraft={setDraft}
              onEdit={markDraftEdited}
              settingMaxBuy={settingMaxBuy}
              onMaximumBuy={() => void setMaximumDevBuy()}
            />
          ) : (
            <FeeStep
              draft={draft}
              setDraft={setDraft}
              onEdit={markDraftEdited}
              settingMaxBuy={settingMaxBuy}
              onMaximumDevBuy={() => void setMaximumDevBuy()}
            />
          )}
        </div>

        <footer
          className={`classic-launch-footer ${
            usesExtendedLayout ? extendedLayout.footer : ""
          }`}
        >
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
            ) : null}
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
              disabled={
                launching ||
                Boolean(transactionHash) ||
                (model === "classic-v3" && !classicV3LaunchAvailable) ||
                (model === "deep" && !deepLaunchAvailable) ||
                (model === "stock-paired" &&
                  !stockPairedLaunchAvailable)
              }
            >
              {model === "deep" && !deepLaunchAvailable
                ? "Deep is being finalized"
                : model === "stock-paired" &&
                    !stockPairedLaunchAvailable
                  ? "Stock-Paired is being finalized"
                : model === "classic-v3" && !classicV3LaunchAvailable
                  ? "Classic is not deployed"
                  : launchPhase === "preparing"
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
          draft={
            model === "classic-v3" ||
            model === "deep" ||
            model === "stock-paired"
              ? draft
              : undefined
          }
          account={submittedAccount}
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
  draft,
  account,
  onClose,
}: {
  launch: IndexedLaunch;
  draft?: LaunchDraft;
  account?: string;
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
  let classicConfiguration:
    | ReturnType<typeof validateClassicV3LaunchDraft>
    | undefined;
  const deepLaunch = draft?.launchModel === "deep";
  try {
    if (draft?.launchModel === "classic-v3" && account) {
      classicConfiguration = validateClassicV3LaunchDraft(
        draft,
        account,
      );
    }
  } catch {
    classicConfiguration = undefined;
  }

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
        {deepLaunch ? (
          <dl className="launch-success-v3">
            <div>
              <dt>Deep fee</dt>
              <dd>1.00%</dd>
            </div>
            <div>
              <dt>Pool growth</dt>
              <dd>0.90%</dd>
            </div>
            <div>
              <dt>Programmable</dt>
              <dd>0.10%</dd>
            </div>
          </dl>
        ) : classicConfiguration ? (
          <dl className="launch-success-v3">
            <div>
              <dt>Buy fee</dt>
              <dd>
                {formatClassicV3Percent(
                  classicConfiguration.fees.buySwapFeeBps,
                )}
              </dd>
            </div>
            <div>
              <dt>Sell fee</dt>
              <dd>
                {formatClassicV3Percent(
                  classicConfiguration.fees.sellSwapFeeBps,
                )}
              </dd>
            </div>
            <div>
              <dt>Reward owners</dt>
              <dd>{classicConfiguration.rewards.beneficiaries.length}</dd>
            </div>
          </dl>
        ) : null}
        <Link ref={viewLinkRef} className="primary-button" href={launch.href}>
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
          { url: string } | { error: string };
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
    MAX_TOKEN_DESCRIPTION_BYTES - utf8ByteLength(draft.tokenDescription);

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
                placeholder="$TOKEN"
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

export function DeepPresetStep() {
  const disclosure = deepV3PresetDisclosure();
  return (
    <section className="deep-preset" aria-labelledby="deep-preset-title">
      <div className="classic-section-heading">
        <h2 id="deep-preset-title">Deep liquidity</h2>
        <p>Original v4 pool</p>
      </div>

      <div className="deep-preset-overview">
        <p className="deep-preset-summary">{disclosure.summary}</p>
        <dl className="deep-preset-stats">
          <div>
            <dt>Deep fee</dt>
            <dd>{disclosure.swapFee}</dd>
          </div>
          <div>
            <dt>Pool growth</dt>
            <dd>{disclosure.growthFee}</dd>
          </div>
          <div>
            <dt>Programmable</dt>
            <dd>{disclosure.programmableFee}</dd>
          </div>
        </dl>
      </div>

      <details className="deep-preset-details">
        <summary>How Deep works</summary>
        <div className="deep-preset-notes">
          <p>{disclosure.automation}</p>
          <p>{disclosure.rewards}</p>
          <p>{disclosure.protocolFees}</p>
        </div>
      </details>

      <p className="deep-preset-review" role="note">
        {disclosure.review}
      </p>
    </section>
  );
}

export function DeepFeeStep({
  draft,
  setDraft,
  onEdit,
}: {
  draft: LaunchDraft;
  setDraft: Dispatch<SetStateAction<LaunchDraft>>;
  onEdit: () => void;
}) {
  const disclosure = deepV3PresetDisclosure();

  return (
    <section
      className="classic-fee-section deep-fee-section"
      aria-labelledby="deep-fee-title"
    >
      <div className="classic-section-heading classic-fee-heading">
        <div>
          <h2 id="deep-fee-title">Initial Buy</h2>
          <p>
            Pool growth {disclosure.growthFee}
            <span>·</span>
            Programmable {disclosure.programmableFee}
          </p>
        </div>
      </div>

      <div className="classic-fee-layout">
        <div
          className="classic-fee-fixed"
          aria-label={`Fixed ${disclosure.swapFee} Deep fee`}
        >
          <span>Deep fee</span>
          <strong>{disclosure.swapFee}</strong>
        </div>

        <label className="meme-dev-buy" htmlFor="deep-initial-buy">
          <span>
            <strong>Initial Buy</strong>
            <small>Minimum {MEME_MIN_INITIAL_BUY_ETH_LABEL}</small>
          </span>
          <span className="meme-dev-buy-input">
            <input
              id="deep-initial-buy"
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

function EnhancedClassicFeeStep({
  draft,
  account,
  setDraft,
  onEdit,
  settingMaxBuy,
  onMaximumDevBuy,
}: {
  draft: LaunchDraft;
  account?: string;
  setDraft: Dispatch<SetStateAction<LaunchDraft>>;
  onEdit: () => void;
  settingMaxBuy: boolean;
  onMaximumDevBuy: () => void;
}) {
  const updateClassicV3Draft = (patch: Partial<LaunchDraft>) => {
    onEdit();
    updateDraft(setDraft, patch);
  };

  function updateSplit(
    index: number,
    patch: Partial<LaunchDraft["rewardSplits"][number]>,
  ) {
    updateClassicV3Draft({
      rewardSplits: draft.rewardSplits.map((row, rowIndex) =>
        rowIndex === index ? { ...row, ...patch } : row,
      ),
    });
  }

  const splitTotal = draft.rewardSplits.reduce((total, row) => {
    const share = Number(row.sharePercent);
    return Number.isFinite(share) ? total + share : total;
  }, 0);
  const splitIsComplete = Math.abs(splitTotal - 100) < 0.001;
  const rewardNote =
    draft.rewardDestinationMode === "launcher"
      ? "The connected wallet owns all creator rewards"
      : draft.rewardDestinationMode === "external"
        ? "The selected wallet owns all creator rewards"
        : "Each recipient owns and claims its share";
  let disclosure: ReturnType<typeof buildClassicV3LaunchDisclosure> | undefined;
  try {
    if (account) {
      disclosure = buildClassicV3LaunchDisclosure(draft, account);
    }
  } catch {
    disclosure = undefined;
  }

  return (
    <section className="classic-v3-settings" aria-labelledby="classic-v3-fees">
      <div className="classic-section-heading">
        <h2 id="classic-v3-fees">Fees and rewards</h2>
        <p>Fixed when the token launches</p>
      </div>

      <div className="classic-v3-core">
        <fieldset className="classic-v3-fees">
          <legend>Swap fees</legend>
          <div className="classic-v3-fee-grid">
            {(["buy", "sell"] as const).map((direction) => {
              const key =
                direction === "buy"
                  ? "buySwapFeePercent"
                  : "sellSwapFeePercent";
              const totalFeeBps = Number(draft[key]) * 100;
              const creatorFeeBps = Math.max(0, totalFeeBps - PLATFORM_FEE_BPS);
              return (
                <label className="classic-v3-fee-control" key={direction}>
                  <span>{direction === "buy" ? "Buy fee" : "Sell fee"}</span>
                  <select
                    aria-label={`${direction === "buy" ? "Buy" : "Sell"} fee`}
                    value={draft[key]}
                    onChange={(event) =>
                      updateClassicV3Draft({ [key]: event.target.value })
                    }
                  >
                    {Array.from({ length: 10 }, (_, index) => (
                      <option value={String(index + 1)} key={index + 1}>
                        {index + 1}.00%
                      </option>
                    ))}
                  </select>
                  <small>
                    Creator{" "}
                    {Number.isFinite(creatorFeeBps)
                      ? formatClassicV3Percent(creatorFeeBps)
                      : "—"}{" "}
                    <span>·</span> Programmable 0.10%
                  </small>
                </label>
              );
            })}
          </div>
        </fieldset>

        <fieldset className="classic-v3-reward-mode">
          <legend>Creator rewards</legend>
          <div>
            {(
              [
                ["launcher", "Launch wallet"],
                ["external", "Another wallet"],
                ["split", "Split rewards"],
              ] as const
            ).map(([value, label]) => (
              <button
                type="button"
                className={
                  draft.rewardDestinationMode === value ? "is-selected" : ""
                }
                aria-pressed={draft.rewardDestinationMode === value}
                onClick={() =>
                  updateClassicV3Draft({ rewardDestinationMode: value })
                }
                key={value}
              >
                {label}
              </button>
            ))}
          </div>
          <small className="classic-v3-reward-note">{rewardNote}</small>
        </fieldset>
      </div>

      {draft.rewardDestinationMode === "external" ? (
        <label className="field classic-v3-address-field">
          <span>Reward wallet</span>
          <input
            value={draft.rewardExternalAddress}
            placeholder="0x…"
            spellCheck={false}
            autoComplete="off"
            onChange={(event) =>
              updateClassicV3Draft({
                rewardExternalAddress: event.target.value,
              })
            }
          />
          <small>Only this wallet can claim or change its payout address</small>
        </label>
      ) : null}

      {draft.rewardDestinationMode === "split" ? (
        <div className="classic-v3-split">
          {draft.rewardSplits.map((row, index) => (
            <div className="classic-v3-split-row" key={index}>
              <label>
                <span>Recipient {index + 1}</span>
                <input
                  value={row.beneficiary}
                  placeholder="0x…"
                  spellCheck={false}
                  autoComplete="off"
                  onChange={(event) =>
                    updateSplit(index, {
                      beneficiary: event.target.value,
                    })
                  }
                />
              </label>
              <label>
                <span>Share</span>
                <span className="classic-v3-share-input">
                  <input
                    inputMode="decimal"
                    value={row.sharePercent}
                    maxLength={6}
                    onChange={(event) =>
                      updateSplit(index, {
                        sharePercent: event.target.value,
                      })
                    }
                  />
                  <span>%</span>
                </span>
              </label>
              {draft.rewardSplits.length > 2 ? (
                <button
                  className="icon-button"
                  type="button"
                  aria-label={`Remove recipient ${index + 1}`}
                  onClick={() =>
                    updateClassicV3Draft({
                      rewardSplits: draft.rewardSplits.filter(
                        (_, rowIndex) => rowIndex !== index,
                      ),
                    })
                  }
                >
                  <Trash2 aria-hidden="true" size={16} />
                </button>
              ) : null}
            </div>
          ))}
          {draft.rewardSplits.length < 8 ? (
            <button
              className="secondary-button classic-v3-add-recipient"
              type="button"
              onClick={() =>
                updateClassicV3Draft({
                  rewardSplits: [
                    ...draft.rewardSplits,
                    { beneficiary: "", sharePercent: "" },
                  ],
                })
              }
            >
              Add recipient
            </button>
          ) : null}
          <p
            className={`classic-v3-split-total${
              splitIsComplete ? " is-complete" : ""
            }`}
            aria-live="polite"
          >
            Total {splitTotal.toFixed(2).replace(/\.00$/, "")}%
          </p>
        </div>
      ) : null}

      <div className="classic-v3-disclosure" role="note">
        <strong>Locked at launch</strong>
        {disclosure ? (
          <>
            <dl>
              <div>
                <dt>Buy</dt>
                <dd>{disclosure.buyFee}</dd>
              </div>
              <div>
                <dt>Sell</dt>
                <dd>{disclosure.sellFee}</dd>
              </div>
            </dl>
            <ul>
              {disclosure.rewards.map((reward) => (
                <li key={reward.beneficiary}>
                  <span>{shortenAddress(reward.beneficiary)}</span>
                  <strong>{reward.share}</strong>
                </li>
              ))}
            </ul>
            <p>
              Fee rates, beneficiaries and shares cannot change. Each
              beneficiary alone can claim or update its payout address.
            </p>
          </>
        ) : (
          <p>
            Complete the reward setup to review every immutable term before
            signing.
          </p>
        )}
      </div>

      <div className="classic-fee-layout">
        <label className="meme-dev-buy" htmlFor="classic-v3-dev-buy">
          <span>
            <strong>Initial Buy</strong>
            <small>Minimum {MEME_MIN_INITIAL_BUY_ETH_LABEL}</small>
          </span>
          <span className="meme-dev-buy-input">
            <input
              id="classic-v3-dev-buy"
              inputMode="decimal"
              value={draft.initialBuyEth}
              maxLength={40}
              placeholder={MEME_MIN_INITIAL_BUY_ETH}
              spellCheck={false}
              autoComplete="off"
              onChange={(event) =>
                updateClassicV3Draft({
                  initialBuyEth: event.target.value,
                })
              }
            />
            <button
              type="button"
              disabled={settingMaxBuy || !classicV3LaunchAvailable}
              onClick={onMaximumDevBuy}
            >
              {settingMaxBuy ? "Checking" : "Max"}
            </button>
            <span>ETH</span>
          </span>
        </label>
      </div>
    </section>
  );
}

function StockPairedStep({
  draft,
  account,
  setDraft,
  onEdit,
  settingMaxBuy,
  onMaximumBuy,
}: {
  draft: LaunchDraft;
  account?: string;
  setDraft: Dispatch<SetStateAction<LaunchDraft>>;
  onEdit: () => void;
  settingMaxBuy: boolean;
  onMaximumBuy: () => void;
}) {
  const selected =
    getStockQuoteAsset(draft.stockQuoteAsset) ?? STOCK_QUOTE_ASSETS[0];

  function updateStockDraft(patch: Partial<LaunchDraft>) {
    onEdit();
    updateDraft(setDraft, {
      ...patch,
      launchModel: "stock-paired",
      rewardDestinationMode: "launcher",
      rewardExternalAddress: "",
      rewardSplits: [],
    });
  }

  return (
    <section
      className="classic-fee-section stock-paired-section"
      aria-labelledby="stock-paired-title"
    >
      <div className="classic-section-heading classic-fee-heading">
        <div>
          <h2 id="stock-paired-title">Quote asset</h2>
          <p>
            Trades and creator rewards settle in the selected token.
          </p>
        </div>
      </div>

      <div
        className="stock-quote-grid"
        role="radiogroup"
        aria-labelledby="stock-paired-title"
      >
        {STOCK_QUOTE_ASSETS.map((asset) => {
          const active =
            asset.address.toLowerCase() === selected.address.toLowerCase();
          return (
            <button
              className="stock-quote-option"
              data-selected={active ? "true" : "false"}
              type="button"
              role="radio"
              aria-checked={active}
              key={asset.address}
              onClick={() =>
                updateStockDraft({ stockQuoteAsset: asset.address })
              }
            >
              <strong>{asset.symbol}</strong>
              <span>{asset.underlying}</span>
            </button>
          );
        })}
      </div>

      <div className="classic-fee-layout stock-paired-controls">
        <div
          className="classic-fee-fixed"
          aria-label="Fixed 1.00% swap fee"
        >
          <span>Swap fee</span>
          <strong>1.00%</strong>
          <small>0.90% creator · 0.10% Programmable</small>
        </div>

        <label className="meme-dev-buy" htmlFor="stock-initial-buy">
          <span>
            <strong>Initial Buy</strong>
            <small>
              Minimum {STOCK_PAIRED_MIN_INITIAL_BUY} {selected.symbol}
            </small>
          </span>
          <span className="meme-dev-buy-input">
            <input
              id="stock-initial-buy"
              inputMode="decimal"
              value={draft.initialBuyQuoteAmount}
              maxLength={40}
              placeholder={STOCK_PAIRED_MIN_INITIAL_BUY}
              spellCheck={false}
              autoComplete="off"
              onChange={(event) =>
                updateStockDraft({
                  initialBuyQuoteAmount: event.target.value,
                })
              }
            />
            <button
              type="button"
              disabled={settingMaxBuy || !account}
              onClick={onMaximumBuy}
            >
              {settingMaxBuy ? "Checking" : "Max"}
            </button>
            <span>{selected.symbol}</span>
          </span>
        </label>
      </div>

      <div className="stock-paired-disclosure">
        <p>
          The token you launch is not a share and is not redeemable for the
          underlying asset. Availability and transferability depend on Ondo
          and your jurisdiction.
        </p>
        <a href={selected.ondoAssetUrl} target="_blank" rel="noreferrer">
          View {selected.symbol}
        </a>
      </div>
    </section>
  );
}

function FeeStep({
  draft,
  setDraft,
  onEdit,
  settingMaxBuy,
  onMaximumDevBuy,
}: {
  draft: LaunchDraft;
  setDraft: Dispatch<SetStateAction<LaunchDraft>>;
  onEdit: () => void;
  settingMaxBuy: boolean;
  onMaximumDevBuy: () => void;
}) {
  const creatorFeeBps = CLASSIC_TOTAL_SWAP_FEE_BPS - PLATFORM_FEE_BPS;

  return (
    <section className="classic-fee-section">
      <div className="classic-section-heading classic-fee-heading">
        <div>
          <h2>Swap fee</h2>
          <p>
            Creator {(creatorFeeBps / 100).toFixed(2)}%<span>·</span>
            Programmable {(PLATFORM_FEE_BPS / 100).toFixed(2)}%
          </p>
        </div>
      </div>

      <div className="classic-fee-layout">
        <div className="classic-fee-fixed" aria-label="Fixed 1.00% swap fee">
          <span>Total swap fee</span>
          <strong>{CLASSIC_TOTAL_SWAP_FEE_PERCENT}.00%</strong>
        </div>

        <label className="meme-dev-buy" htmlFor="classic-dev-buy">
          <span>
            <strong>Initial Buy</strong>
            <small>Minimum {MEME_MIN_INITIAL_BUY_ETH_LABEL}</small>
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
            <button
              type="button"
              disabled={settingMaxBuy}
              onClick={onMaximumDevBuy}
            >
              {settingMaxBuy ? "Checking" : "Max"}
            </button>
            <span>ETH</span>
          </span>
        </label>
      </div>
    </section>
  );
}
