"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";

import launchExperience from "@/components/launch-experience.module.css";
import { useViewChain, type ViewChainId } from "@/components/view-chain";
import { isConfiguredClassicV3ReleaseReady } from "@/lib/classic-v3-release";
import { resolveImplementedLaunchModel } from "@/lib/launch-model-gating";
import type { LaunchModel } from "@/lib/launch";
import { DEFAULT_VIEW_CHAIN_ID, VIEW_CHAIN_OPTIONS } from "@/lib/view-chain";

const launchEnvironment =
  process.env.NEXT_PUBLIC_PROGRAMMABLE_ONCHAIN_NETWORK === "rehearsal"
    ? "rehearsal"
    : "production";
const classicV3LaunchAvailable =
  isConfiguredClassicV3ReleaseReady(launchEnvironment);

function loadLaunchForm() {
  return import("@/components/launch-builder");
}

type LaunchBuilderComponent =
  (typeof import("@/components/launch-builder"))["LaunchBuilderForm"];
type LaunchPickerChoice = LaunchModel;

export function LaunchExperience({
  initialViewChainId = DEFAULT_VIEW_CHAIN_ID,
}: Readonly<{ initialViewChainId?: ViewChainId }>) {
  const { hydrated, viewChainId, setViewChainId } = useViewChain();
  return (
    <LaunchExperienceRuntime
      chainId={hydrated ? viewChainId : initialViewChainId}
      onChangeChain={setViewChainId}
    />
  );
}

function LaunchExperienceRuntime({
  chainId,
  onChangeChain,
}: Readonly<{
  chainId: ViewChainId;
  onChangeChain: (chainId: ViewChainId) => void;
}>) {
  const [selectedModel, setSelectedModel] = useState<LaunchPickerChoice | null>(null);
  const [loadedLaunchBuilder, setLoadedLaunchBuilder] =
    useState<LaunchBuilderComponent | null>(null);
  const [preparingModel, setPreparingModel] = useState<LaunchModel | null>(null);
  const [modelLoadError, setModelLoadError] = useState("");

  useEffect(() => {
    if (chainId !== 1 || !classicV3LaunchAvailable) return;
    void loadLaunchForm().catch(() => undefined);
  }, [chainId]);

  async function chooseModel(candidate: LaunchPickerChoice) {
    const model = resolveImplementedLaunchModel(candidate);
    if (
      chainId !== 1 ||
      !model ||
      model === "deep" ||
      model === "stock-paired" ||
      (model === "classic-v3" && !classicV3LaunchAvailable)
    ) {
      return;
    }

    setPreparingModel(model);
    setModelLoadError("");

    try {
      const launchModule = await loadLaunchForm();
      setLoadedLaunchBuilder(() => launchModule.LaunchBuilderForm);
      window.scrollTo({ left: 0, top: 0, behavior: "auto" });
      setSelectedModel(model);
    } catch {
      setModelLoadError("Classic could not open. Try again.");
    } finally {
      setPreparingModel(null);
    }
  }

  function returnToModels() {
    window.scrollTo({ left: 0, top: 0, behavior: "auto" });
    setSelectedModel(null);
  }

  if (!selectedModel || chainId !== 1) {
    return (
      <LaunchModelPicker
        chainId={chainId}
        onChangeChain={(nextChainId) => {
          setSelectedModel(null);
          setModelLoadError("");
          onChangeChain(nextChainId);
        }}
        modelLoadError={modelLoadError}
        onChoose={chooseModel}
        preparingModel={preparingModel}
      />
    );
  }

  if (!loadedLaunchBuilder) return null;

  const LoadedLaunchBuilder = loadedLaunchBuilder;
  return (
    <LoadedLaunchBuilder
      model={selectedModel}
      onBackToModels={returnToModels}
      stockPairedPublicLaunchEnabled={false}
    />
  );
}

export function LaunchModelPicker({
  chainId = DEFAULT_VIEW_CHAIN_ID,
  onChangeChain,
  modelLoadError = "",
  onChoose,
  preparingModel = null,
}: {
  chainId?: ViewChainId;
  onChangeChain?: (chainId: ViewChainId) => void;
  modelLoadError?: string;
  onChoose: (model: LaunchPickerChoice) => void | Promise<void>;
  preparingModel?: LaunchModel | null;
}) {
  const isEthereum = chainId === 1;
  const preloadAvailableForm = () => {
    void loadLaunchForm().catch(() => undefined);
  };

  const customCardContent = (
    <>
      <span
        className={`launch-model-art ${launchExperience.modelArt} ${launchExperience.customArt}`}
        aria-hidden="true"
      >
        <Image
          className={launchExperience.artImage}
          src="/brand/atmosphere/programmable-floral-hooks-v1.avif"
          alt=""
          fill
          loading="eager"
          sizes="(max-width: 760px) calc(100vw - 32px), (max-width: 1280px) calc((100vw - 96px) / 2), 560px"
          priority
        />
        <Image
          className={`${launchExperience.classicLogo} ${launchExperience.customLogo}`}
          src="/brand/loop/programmable-loop-mark-warm-ivory-v1-1536.png"
          alt=""
          width={1536}
          height={1536}
          sizes="128px"
        />
      </span>
      <span
        className={`launch-model-card-body ${launchExperience.modelBody}`}
      >
        <span
          className={`launch-model-card-heading ${launchExperience.modelHeading}`}
        >
          <strong id="launch-model-custom-title">Custom V4 Hook</strong>
        </span>
        <span
          className={`launch-model-description ${launchExperience.modelDescription}`}
          id="launch-model-custom-description"
        >
          Build your own Uniswap v4 hook and submit it with an API key.
          Your wallet reviews and signs the launch.
        </span>
        <span
          className={`launch-model-action ${launchExperience.modelAction}`}
        >
          Open Custom V4 Hook
          <ArrowRight aria-hidden="true" size={16} />
        </span>
      </span>
    </>
  );

  return (
    <div
      className={`launch-model-page page-width ${launchExperience.pickerPage}`}
    >
      <header
        className={`launch-model-heading ${launchExperience.pickerHeading}`}
      >
        <h1 className="sr-only">Launch</h1>
        <fieldset
          className={launchExperience.chainChoice}
          disabled={preparingModel !== null}
        >
          <legend className="sr-only">Launch chain</legend>
          {VIEW_CHAIN_OPTIONS.map((chain) => (
            <label key={chain.id} className={launchExperience.chainOption} title={chain.label}>
              <input
                className="sr-only"
                type="radio"
                name="launch-chain"
                aria-label={chain.label}
                value={chain.id}
                checked={chainId === chain.id}
                onChange={() => onChangeChain?.(chain.id)}
              />
              {chain.id === 1 ? (
                <svg className={launchExperience.chainMark} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
                  <path d="M12 2 5.5 12.2 12 9.25l6.5 2.95L12 2Z" fill="currentColor" />
                  <path d="m5.5 13.35 6.5 3.7 6.5-3.7L12 22 5.5 13.35Z" fill="currentColor" />
                  <path d="m12 9.25-6.5 2.95L12 15.9l6.5-3.7L12 9.25Z" fill="currentColor" />
                </svg>
              ) : <span className={launchExperience.robinhoodMark} aria-hidden="true" />}
            </label>
          ))}
        </fieldset>
      </header>

      <div
        className={`launch-model-grid ${launchExperience.modelGrid} ${isEthereum ? "" : launchExperience.singleModelGrid}`}
      >
        {isEthereum ? (
          <button
            className={`launch-model-card ${launchExperience.modelCard} liquid-glass-surface`}
            data-launch-model-option="classic"
            data-launch-model-available={classicV3LaunchAvailable}
            data-launch-model-launchable={classicV3LaunchAvailable}
            type="button"
            disabled={!classicV3LaunchAvailable || preparingModel !== null}
            aria-busy={preparingModel === "classic-v3"}
            aria-labelledby="launch-model-classic-title"
            aria-describedby={classicV3LaunchAvailable ? "launch-model-classic-description" : "launch-model-classic-description launch-model-classic-status"}
            onPointerEnter={
              classicV3LaunchAvailable ? preloadAvailableForm : undefined
            }
            onPointerDown={
              classicV3LaunchAvailable ? preloadAvailableForm : undefined
            }
            onFocus={classicV3LaunchAvailable ? preloadAvailableForm : undefined}
            onClick={() => void onChoose("classic-v3")}
          >
            <span
              className={`launch-model-art launch-model-art-classic ${launchExperience.modelArt} ${launchExperience.classicArt}`}
              aria-hidden="true"
            >
              <Image
                className={launchExperience.artImage}
                src="/brand/atmosphere/programmable-floral-hooks-v1.avif"
                alt=""
                fill
                sizes="(max-width: 760px) calc(100vw - 32px), (max-width: 1280px) calc((100vw - 96px) / 2), 560px"
                priority
              />
              <Image
                className={launchExperience.classicLogo}
                src="/brand/loop/programmable-loop-mark-warm-ivory-v1-1536.png"
                alt=""
                width={1536}
                height={1536}
                sizes="128px"
              />
            </span>

            <span
              className={`launch-model-card-body ${launchExperience.modelBody}`}
            >
              <span
                className={`launch-model-card-heading ${launchExperience.modelHeading}`}
              >
                <strong id="launch-model-classic-title">Classic</strong>
                {!classicV3LaunchAvailable ? <small
                  id="launch-model-classic-status"
                  data-status="pending"
                >
                  Unavailable
                </small> : null}
              </span>
              <span
                className={`launch-model-description ${launchExperience.modelDescription}`}
                id="launch-model-classic-description"
              >
                Launch a fixed-supply token with permanently locked, one-sided
                Uniswap v4 liquidity. Set buy and sell fees, reward recipients,
                and the initial buy before you sign.
              </span>
              {classicV3LaunchAvailable ? (
                <span
                  className={`launch-model-action ${launchExperience.modelAction}`}
                >
                  {preparingModel === "classic-v3"
                    ? "Opening Classic"
                    : "Launch a Classic Coin"}
                  <ArrowRight aria-hidden="true" size={16} />
                </span>
              ) : null}
            </span>
          </button>
        ) : null}

        <Link
          className={`launch-model-card ${launchExperience.modelCard} liquid-glass-surface`}
          data-launch-model-option="custom"
          data-launch-model-available="true"
          data-launch-model-entry="api-key-launch"
          data-launch-model-launchable="false"
          href="/developers/api-keys"
          aria-labelledby="launch-model-custom-title"
          aria-describedby="launch-model-custom-description"
        >
          {customCardContent}
        </Link>

      </div>
      {modelLoadError ? (
        <p className={launchExperience.modelLoadError} role="alert">
          {modelLoadError}
        </p>
      ) : null}
    </div>
  );
}
