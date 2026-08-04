"use client";

import Image from "next/image";
import Link from "next/link";
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
          <h1>Create token</h1>
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

export function LaunchExperience() {
  const [selectedModel, setSelectedModel] = useState<LaunchModel | null>(null);

  function chooseModel(candidate: LaunchModel) {
    const model = resolveImplementedLaunchModel(candidate);
    if (
      !model ||
      model === "deep" ||
      model === "stock-paired" ||
      (model === "classic-v3" && !classicV3LaunchAvailable)
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
    <Suspense fallback={<LaunchFormLoading onBack={returnToModels} />}>
      <LazyLaunchBuilderForm
        model={selectedModel}
        onBackToModels={returnToModels}
        stockPairedPublicLaunchEnabled={false}
      />
    </Suspense>
  );
}

export function LaunchModelPicker({
  onChoose,
}: {
  onChoose: (model: LaunchModel) => void;
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
        <h1>Choose your launch model</h1>
      </header>

      <div className={`launch-model-grid ${launchExperience.modelGrid}`}>
        <button
          className={`launch-model-card ${launchExperience.modelCard}`}
          data-launch-model-option="classic"
          data-launch-model-available={classicV3LaunchAvailable}
          type="button"
          disabled={!classicV3LaunchAvailable}
          aria-labelledby="launch-model-classic-title"
          aria-describedby="launch-model-classic-description"
          onPointerEnter={
            classicV3LaunchAvailable ? preloadAvailableForm : undefined
          }
          onFocus={classicV3LaunchAvailable ? preloadAvailableForm : undefined}
          onClick={() => onChoose("classic-v3")}
        >
          <span
            className={`launch-model-art launch-model-art-classic ${launchExperience.modelArt} ${launchExperience.classicArt}`}
            aria-hidden="true"
          >
            <Image
              className={launchExperience.artImage}
              src="/brand/create/classic-botanical-v4.webp"
              alt=""
              fill
              sizes="(max-width: 760px) calc(100vw - 32px), (max-width: 1280px) calc((100vw - 88px) / 2), 560px"
              priority
              unoptimized
            />
            <Image
              className={launchExperience.classicLogo}
              src="/brand/loop/programmable-loop-mark-transparent-v1.png"
              alt=""
              width={1254}
              height={1254}
              sizes="128px"
              priority
              unoptimized
            />
          </span>

          <span
            className={`launch-model-card-body ${launchExperience.modelBody}`}
          >
            <span
              className={`launch-model-card-heading ${launchExperience.modelHeading}`}
            >
              <strong id="launch-model-classic-title">Classic</strong>
              {!classicV3LaunchAvailable ? (
                <small data-status="pending">Unavailable</small>
              ) : null}
            </span>
            <span
              className={`launch-model-description ${launchExperience.modelDescription}`}
              id="launch-model-classic-description"
            >
              Create a fixed-supply token with permanently locked, one-sided
              Uniswap v4 liquidity. Set buy and sell fees, reward recipients,
              and the initial buy before you sign.
            </span>
            {classicV3LaunchAvailable ? (
              <span
                className={`launch-model-action ${launchExperience.modelAction}`}
              >
                Create a Classic coin
                <ArrowRight aria-hidden="true" size={16} />
              </span>
            ) : null}
          </span>
        </button>

        <Link
          href="/docs/models/custom"
          className={`launch-model-card ${launchExperience.modelCard}`}
          data-launch-model-option="custom"
          data-launch-model-available="true"
          aria-labelledby="launch-model-custom-title"
          aria-describedby="launch-model-custom-description"
        >
          <span
            className={`launch-model-art ${launchExperience.modelArt} ${launchExperience.customArt}`}
            aria-hidden="true"
          >
            <Image
              className={launchExperience.artImage}
              src="/brand/create/custom-galaxy-v3.webp"
              alt=""
              fill
              loading="eager"
              sizes="(max-width: 760px) calc(100vw - 32px), (max-width: 1280px) calc((100vw - 88px) / 2), 560px"
              unoptimized
            />
            <span
              className={`${launchExperience.brandMark} ${launchExperience.customMark}`}
            />
            <span className={launchExperience.customSparkles}>
              <span />
              <span />
              <span />
              <span />
              <span />
              <span />
              <span />
              <span />
              <span />
              <span />
            </span>
          </span>

          <span
            className={`launch-model-card-body ${launchExperience.modelBody}`}
          >
            <span
              className={`launch-model-card-heading ${launchExperience.modelHeading}`}
            >
              <strong id="launch-model-custom-title">Custom Hook</strong>
            </span>
            <span
              className={`launch-model-description ${launchExperience.modelDescription}`}
              id="launch-model-custom-description"
            >
              Review the framework for token-specific Uniswap v4 hook logic,
              including permissions, fee behavior, liquidity rules, and the
              evidence required for release.
            </span>
            <span
              className={`launch-model-action ${launchExperience.modelAction}`}
            >
              Create a Custom Hook
              <ArrowRight aria-hidden="true" size={16} />
            </span>
          </span>
        </Link>
      </div>
    </div>
  );
}
