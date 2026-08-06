"use client";

import Image from "next/image";
import Link from "next/link";
import { lazy, Suspense, useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";

import { XBrandIcon } from "@/components/brand-icons";
import launchExperience from "@/components/launch-experience.module.css";
import { isConfiguredClassicV3ReleaseReady } from "@/lib/classic-v3-release";
import { resolveImplementedLaunchModel } from "@/lib/launch-model-gating";
import type { LaunchModel } from "@/lib/launch";
import type { TrustedLaunchPermitSignerV2 } from "@/lib/custom-launch/contract-v2";

const launchEnvironment =
  process.env.NEXT_PUBLIC_PROGRAMMABLE_ONCHAIN_NETWORK === "rehearsal"
    ? "rehearsal"
    : "production";
const classicV3LaunchAvailable =
  isConfiguredClassicV3ReleaseReady(launchEnvironment);

function loadLaunchForm() {
  return import("@/components/launch-builder");
}

function loadCustomLaunch() {
  return import("@/components/custom-launch-experience");
}

const LazyLaunchBuilderForm = lazy(async () => {
  const launchModule = await loadLaunchForm();
  return { default: launchModule.LaunchBuilderForm };
});

const LazyCustomLaunchExperience = lazy(async () => {
  const customModule = await loadCustomLaunch();
  return { default: customModule.CustomLaunchExperience };
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
        className={`${launchExperience.formLoadingSheet} liquid-glass-surface`}
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
  customLaunchPublicEnabled,
  trustedLaunchPermitSigners = [],
}: {
  customLaunchPublicEnabled: boolean;
  trustedLaunchPermitSigners?: readonly TrustedLaunchPermitSignerV2[];
}) {
  const [selectedModel, setSelectedModel] = useState<LaunchModel | "custom" | null>(null);

  function chooseModel(candidate: LaunchModel | "custom") {
    if (candidate === "custom") {
      if (!customLaunchPublicEnabled) return;
      window.scrollTo({ left: 0, top: 0, behavior: "auto" });
      setSelectedModel("custom");
      return;
    }
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
    return (
      <LaunchModelPicker
        customLaunchPublicEnabled={customLaunchPublicEnabled}
        onChoose={chooseModel}
      />
    );
  }

  if (selectedModel === "custom") {
    return (
      <Suspense fallback={<LaunchFormLoading onBack={returnToModels} />}>
        <LazyCustomLaunchExperience
          onBack={returnToModels}
          trustedLaunchPermitSigners={trustedLaunchPermitSigners}
        />
      </Suspense>
    );
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
  customLaunchPublicEnabled = false,
  onChoose,
}: {
  customLaunchPublicEnabled?: boolean;
  onChoose: (model: LaunchModel | "custom") => void;
}) {
  const preloadAvailableForm = () => {
    void loadLaunchForm();
  };
  const preloadCustomLaunch = () => {
    void loadCustomLaunch();
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
          className={`launch-model-card ${launchExperience.modelCard} liquid-glass-surface`}
          data-launch-model-option="classic"
          data-launch-model-available={classicV3LaunchAvailable}
          data-launch-model-launchable={classicV3LaunchAvailable}
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
              sizes="(max-width: 760px) calc(100vw - 32px), (max-width: 1280px) calc((100vw - 96px) / 4), 260px"
              priority
            />
            <Image
              className={launchExperience.classicLogo}
              src="/brand/loop/programmable-loop-mark-transparent-v1.png"
              alt=""
              width={1254}
              height={1254}
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

        <button
          className={`launch-model-card ${launchExperience.modelCard} liquid-glass-surface`}
          data-launch-model-option="custom"
          data-launch-model-available={customLaunchPublicEnabled}
          data-launch-model-launchable={customLaunchPublicEnabled}
          type="button"
          disabled={!customLaunchPublicEnabled}
          aria-labelledby="launch-model-custom-title"
          aria-describedby="launch-model-custom-description"
          onPointerEnter={customLaunchPublicEnabled ? preloadCustomLaunch : undefined}
          onFocus={customLaunchPublicEnabled ? preloadCustomLaunch : undefined}
          onClick={() => onChoose("custom")}
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
              loading="lazy"
              fetchPriority="low"
              sizes="(max-width: 760px) calc(100vw - 32px), (max-width: 1280px) calc((100vw - 96px) / 4), 260px"
            />
            <Image
              className={`${launchExperience.classicLogo} ${launchExperience.customLogo}`}
              src="/brand/loop/programmable-loop-mark-transparent-v1.png"
              alt=""
              width={1254}
              height={1254}
              sizes="128px"
              loading="lazy"
              fetchPriority="low"
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
              {!customLaunchPublicEnabled ? (
                <small data-status="pending">Coming soon</small>
              ) : null}
            </span>
            <span
              className={`launch-model-description ${launchExperience.modelDescription}`}
              id="launch-model-custom-description"
            >
              Review the framework for token-specific Uniswap v4 hook logic,
              including permissions, fee behavior, liquidity rules, and the
              evidence required for release.
            </span>
            {customLaunchPublicEnabled ? (
              <span
                className={`launch-model-action ${launchExperience.modelAction}`}
              >
                Build or resume
                <ArrowRight aria-hidden="true" size={16} />
              </span>
            ) : null}
          </span>
        </button>

        <Link
          href="https://x.com/aeonframework"
          target="_blank"
          rel="noreferrer"
          className={`launch-model-card ${launchExperience.modelCard} liquid-glass-surface`}
          data-launch-model-option="aeon"
          data-launch-model-available="false"
          data-launch-model-launchable="false"
          aria-labelledby="launch-model-aeon-title"
          aria-describedby="launch-model-aeon-description"
        >
          <span
            className={`launch-model-art ${launchExperience.modelArt} ${launchExperience.aeonArt}`}
            aria-hidden="true"
          >
            <Image
              className={launchExperience.artImage}
              src="/brand/create/aeon-framework-v1.webp"
              alt=""
              fill
              loading="lazy"
              fetchPriority="low"
              sizes="(max-width: 760px) calc(100vw - 32px), (max-width: 1280px) calc((100vw - 96px) / 4), 260px"
            />
          </span>

          <span
            className={`launch-model-card-body ${launchExperience.modelBody}`}
          >
            <span
              className={`launch-model-card-heading ${launchExperience.modelHeading}`}
            >
              <strong id="launch-model-aeon-title">AI and Framework</strong>
              <small data-status="pending">Available soon</small>
            </span>
            <span
              className={`launch-model-description ${launchExperience.modelDescription}`}
              id="launch-model-aeon-description"
            >
              The most autonomous agent framework. AEON launch models are
              coming to Programmable Custom.
            </span>
            <span
              className={`launch-model-action ${launchExperience.modelAction}`}
            >
              <XBrandIcon />
              @aeonframework
            </span>
          </span>
        </Link>

        <Link
          href="https://x.com/basedbidx"
          target="_blank"
          rel="noreferrer"
          className={`launch-model-card ${launchExperience.modelCard} liquid-glass-surface`}
          data-launch-model-option="basedbid"
          data-launch-model-available="false"
          data-launch-model-launchable="false"
          aria-labelledby="launch-model-basedbid-title"
          aria-describedby="launch-model-basedbid-description"
        >
          <span
            className={`launch-model-art ${launchExperience.modelArt} ${launchExperience.basedBidArt}`}
            aria-hidden="true"
          >
            <Image
              className={launchExperience.artImage}
              src="/brand/create/basedbid-v1.png"
              alt=""
              fill
              loading="lazy"
              fetchPriority="low"
              sizes="(max-width: 760px) calc(100vw - 32px), (max-width: 1280px) calc((100vw - 96px) / 4), 260px"
            />
          </span>

          <span
            className={`launch-model-card-body ${launchExperience.modelBody}`}
          >
            <span
              className={`launch-model-card-heading ${launchExperience.modelHeading}`}
            >
              <strong id="launch-model-basedbid-title">BasedBid</strong>
              <small data-status="pending">Available soon</small>
            </span>
            <span
              className={`launch-model-description ${launchExperience.modelDescription}`}
              id="launch-model-basedbid-description"
            >
              BasedBid launch models are coming to Programmable Custom.
            </span>
            <span
              className={`launch-model-action ${launchExperience.modelAction}`}
            >
              <XBrandIcon />
              @basedbidx
            </span>
          </span>
        </Link>
      </div>
    </div>
  );
}
