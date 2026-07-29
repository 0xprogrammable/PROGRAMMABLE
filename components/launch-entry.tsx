"use client";

import Image from "next/image";
import { lazy, Suspense, useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";

import launchExperience from "@/components/launch-experience.module.css";
import { isConfiguredClassicV3ReleaseReady } from "@/lib/classic-v3-release";
import { isConfiguredDeepV3ReleaseReady } from "@/lib/deep-v3-release";
import { resolveImplementedLaunchModel } from "@/lib/launch-model-gating";
import type { LaunchModel } from "@/lib/launch";

const launchEnvironment =
  process.env.NEXT_PUBLIC_PROGRAMMABLE_ONCHAIN_NETWORK === "rehearsal"
    ? "rehearsal"
    : "production";
const classicV3LaunchAvailable =
  isConfiguredClassicV3ReleaseReady(launchEnvironment);
const deepLaunchAvailable =
  isConfiguredDeepV3ReleaseReady(launchEnvironment);

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
      (model === "deep" && !deepLaunchAvailable) ||
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
          type="button"
          aria-describedby="launch-model-classic-description"
          onPointerEnter={preloadAvailableForm}
          onFocus={preloadAvailableForm}
          onClick={() =>
            onChoose(classicV3LaunchAvailable ? "classic-v3" : "classic")
          }
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
            </span>
            <span
              className={`launch-model-description ${launchExperience.modelDescription}`}
              id="launch-model-classic-description"
            >
              Fixed swap fees with creator rewards paid in ETH. A familiar
              token launch on Uniswap v4.
            </span>
            <span
              className={`launch-model-action ${launchExperience.modelAction}`}
            >
              Launch
              <ArrowRight aria-hidden="true" size={16} />
            </span>
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
              Pair a token with a reviewed Ondo Global Markets asset in a
              Uniswap v4 pool.
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

        <button
          className={`launch-model-card launch-model-card-deep ${launchExperience.modelCard}`}
          data-launch-model-option="deep"
          data-launch-model-available={deepLaunchAvailable}
          type="button"
          disabled={!deepLaunchAvailable}
          aria-describedby="launch-model-deep-description"
          onPointerEnter={deepLaunchAvailable ? preloadAvailableForm : undefined}
          onFocus={deepLaunchAvailable ? preloadAvailableForm : undefined}
          onClick={() => onChoose("deep")}
        >
          <span
            className={`launch-model-art launch-model-art-deep ${launchExperience.modelArt}`}
            aria-hidden="true"
          >
            <Image
              src="/brand/programmable-deep-liquidity-teaser-v1-1774x887.webp"
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
              <strong>Deep</strong>
              {!deepLaunchAvailable ? (
                <small data-status="pending">Coming soon</small>
              ) : null}
            </span>
            <span
              className={`launch-model-description ${launchExperience.modelDescription}`}
              id="launch-model-deep-description"
            >
              Trading fees automatically deepen the original locked Uniswap
              v4 pool.
            </span>
            {deepLaunchAvailable ? (
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
