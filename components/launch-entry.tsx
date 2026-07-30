"use client";

import Image from "next/image";
import { lazy, Suspense, useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";

import launchExperience from "@/components/launch-experience.module.css";
import { isConfiguredClassicV3ReleaseReady } from "@/lib/classic-v3-release";
import { resolveImplementedLaunchModel } from "@/lib/launch-model-gating";
import type { LaunchModel } from "@/lib/launch";

const launchEnvironment =
  process.env.NEXT_PUBLIC_PROGRAMMABLE_ONCHAIN_NETWORK === "rehearsal"
    ? "rehearsal"
    : "production";
const classicV3LaunchAvailable =
  isConfiguredClassicV3ReleaseReady(launchEnvironment);

function loadLaunchForm() {
  return import("@/components/launch-builder");
}

const LazyLaunchBuilderForm = lazy(async () => {
  const launchModule = await loadLaunchForm();
  return { default: launchModule.LaunchBuilderForm };
});

function LaunchFormLoading({ onBack }: { onBack: () => void }) {
  return (
    <div
      className={`launch-page page-width ${launchExperience.formPage} ${launchExperience.formLoadingPage}`}
      aria-busy="true"
    >
      <header className="launch-page-heading">
        <button
          className="launch-model-back"
          type="button"
          onClick={onBack}
        >
          <ArrowLeft aria-hidden="true" size={15} />
          Back
        </button>
        <div className={`launch-page-title ${launchExperience.formPageTitle}`}>
          <span className={launchExperience.formModelName}>Launch</span>
          <h1>Create your token</h1>
        </div>
      </header>
      <div
        className={launchExperience.formLoadingSheet}
        role="status"
        aria-label="Loading launch form"
      >
        <span className={launchExperience.formLoadingTitle} />
        <span className={launchExperience.formLoadingBlock} />
        <span className={launchExperience.formLoadingRow} />
      </div>
    </div>
  );
}

export function LaunchExperience({
  stockPairedPublicLaunchEnabled,
}: {
  stockPairedPublicLaunchEnabled: boolean;
}) {
  const [selectedModel, setSelectedModel] = useState<LaunchModel | null>(null);

  function chooseModel(candidate: LaunchModel) {
    const model = resolveImplementedLaunchModel(candidate);
    if (
      !model ||
      (model === "classic-v3" && !classicV3LaunchAvailable) ||
      (model === "stock-paired" && !stockPairedPublicLaunchEnabled)
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
    return (
      <LaunchModelPicker
        onChoose={chooseModel}
        stockPairedPublicLaunchEnabled={stockPairedPublicLaunchEnabled}
      />
    );
  }

  return (
    <Suspense fallback={<LaunchFormLoading onBack={returnToModels} />}>
      <LazyLaunchBuilderForm
        model={selectedModel}
        onBackToModels={returnToModels}
        stockPairedPublicLaunchEnabled={stockPairedPublicLaunchEnabled}
      />
    </Suspense>
  );
}

export function LaunchModelPicker({
  onChoose,
  stockPairedPublicLaunchEnabled = false,
}: {
  onChoose: (model: LaunchModel) => void;
  stockPairedPublicLaunchEnabled?: boolean;
}) {
  const preloadAvailableForm = () => {
    void loadLaunchForm();
  };

  return (
    <div
      className={`launch-model-page page-width ${launchExperience.pickerPage}`}
    >
      <header
        className={`launch-model-heading ${launchExperience.pickerHeading}`}
      >
        <h1>Choose a launch model</h1>
      </header>

      <div className={`launch-model-grid ${launchExperience.modelGrid}`}>
        <button
          className={`launch-model-card ${launchExperience.modelCard}`}
          data-launch-model-option="classic"
          data-launch-model-available={classicV3LaunchAvailable}
          type="button"
          disabled={!classicV3LaunchAvailable}
          aria-describedby="launch-model-classic-description"
          onPointerEnter={
            classicV3LaunchAvailable ? preloadAvailableForm : undefined
          }
          onFocus={classicV3LaunchAvailable ? preloadAvailableForm : undefined}
          onClick={() => onChoose("classic-v3")}
        >
          <span
            className={`launch-model-art launch-model-art-classic ${launchExperience.modelArt}`}
            aria-hidden="true"
          >
            <Image
              src="/brand/programmable-classic-launch-art-card.webp"
              alt=""
              fill
              sizes="(max-width: 520px) calc(100vw - 28px), (max-width: 800px) calc(100vw - 48px), 500px"
              priority
            />
          </span>

          <span
            className={`launch-model-card-body ${launchExperience.modelBody}`}
          >
            <span
              className={`launch-model-card-heading ${launchExperience.modelHeading}`}
            >
              <strong>Classic</strong>
              {!classicV3LaunchAvailable ? (
                <small data-status="pending">Unavailable</small>
              ) : null}
            </span>
            <span
              className={`launch-model-description ${launchExperience.modelDescription}`}
              id="launch-model-classic-description"
            >
              Fixed swap fees with creator rewards paid in ETH. A familiar
              token launch on Uniswap v4.
            </span>
            {classicV3LaunchAvailable ? (
              <span
                className={`launch-model-action ${launchExperience.modelAction}`}
              >
                Launch
                <ArrowRight aria-hidden="true" size={16} />
              </span>
            ) : null}
          </span>
        </button>

        <button
          className={`launch-model-card launch-model-card-stock ${launchExperience.modelCard}`}
          data-launch-model-option="stock-paired"
          data-launch-model-available={stockPairedPublicLaunchEnabled}
          type="button"
          disabled={!stockPairedPublicLaunchEnabled}
          aria-describedby="launch-model-stock-description"
          onPointerEnter={
            stockPairedPublicLaunchEnabled
              ? preloadAvailableForm
              : undefined
          }
          onFocus={
            stockPairedPublicLaunchEnabled ? preloadAvailableForm : undefined
          }
          onClick={() => onChoose("stock-paired")}
        >
          <span
            className={`launch-model-art launch-model-art-stock ${launchExperience.modelArt}`}
            aria-hidden="true"
          >
            <Image
              src="/brand/programmable-stock-paired-launch-art-v1.webp"
              alt=""
              fill
              sizes="(max-width: 520px) calc(100vw - 28px), (max-width: 800px) calc(100vw - 48px), 500px"
            />
          </span>

          <span
            className={`launch-model-card-body ${launchExperience.modelBody}`}
          >
            <span
              className={`launch-model-card-heading ${launchExperience.modelHeading}`}
            >
              <strong>Stock-Paired</strong>
              {!stockPairedPublicLaunchEnabled ? (
                <small data-status="pending">Coming soon</small>
              ) : null}
            </span>
            <span
              className={`launch-model-description ${launchExperience.modelDescription}`}
              id="launch-model-stock-description"
            >
              Launch a token on Ethereum with a tokenized stock, ETF, or
              commodity as its quote asset on Uniswap v4.
            </span>
            {stockPairedPublicLaunchEnabled ? (
              <span
                className={`launch-model-action ${launchExperience.modelAction}`}
              >
                Launch
                <ArrowRight aria-hidden="true" size={16} />
              </span>
            ) : null}
          </span>
        </button>

      </div>
    </div>
  );
}
