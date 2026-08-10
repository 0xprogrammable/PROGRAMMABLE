"use client";

import Image from "next/image";
import Link from "next/link";
import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
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

function loadManualApplicantLaunch() {
  return import("@/components/manual-applicant-launch");
}

const LazyLaunchBuilderForm = lazy(async () => {
  const launchModule = await loadLaunchForm();
  return { default: launchModule.LaunchBuilderForm };
});

const LazyCustomLaunchExperience = lazy(async () => {
  const customModule = await loadCustomLaunch();
  return { default: customModule.CustomLaunchExperience };
});

const LazyManualApplicantLaunch = lazy(async () => {
  const applicantModule = await loadManualApplicantLaunch();
  return { default: applicantModule.ManualApplicantLaunch };
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
  manualApplicantLaunchEnabled = false,
  trustedLaunchPermitSigners = [],
}: {
  customLaunchPublicEnabled: boolean;
  manualApplicantLaunchEnabled?: boolean;
  trustedLaunchPermitSigners?: readonly TrustedLaunchPermitSignerV2[];
}) {
  const [selectedModel, setSelectedModel] = useState<
    LaunchModel | "custom" | "manual-applicant" | null
  >(null);
  const manualApplicantButtonRef = useRef<HTMLButtonElement>(null);
  const restoreManualApplicantFocusRef = useRef(false);

  useEffect(() => {
    if (selectedModel !== null || !restoreManualApplicantFocusRef.current) return;
    restoreManualApplicantFocusRef.current = false;
    manualApplicantButtonRef.current?.focus();
  }, [selectedModel]);

  function chooseModel(candidate: LaunchModel | "custom" | "manual-applicant") {
    if (candidate === "manual-applicant") {
      if (!manualApplicantLaunchEnabled) return;
      window.scrollTo({ left: 0, top: 0, behavior: "auto" });
      setSelectedModel(candidate);
      return;
    }
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
    restoreManualApplicantFocusRef.current = selectedModel === "manual-applicant";
    window.scrollTo({ left: 0, top: 0, behavior: "auto" });
    setSelectedModel(null);
  }

  if (!selectedModel) {
    return (
      <LaunchModelPicker
        manualApplicantLaunchEnabled={manualApplicantLaunchEnabled}
        manualApplicantButtonRef={manualApplicantButtonRef}
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

  if (selectedModel === "manual-applicant") {
    return (
      <Suspense fallback={<LaunchFormLoading onBack={returnToModels} />}>
        <LazyManualApplicantLaunch onBack={returnToModels} />
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
  manualApplicantLaunchEnabled = false,
  manualApplicantButtonRef,
  onChoose,
}: {
  manualApplicantLaunchEnabled?: boolean;
  manualApplicantButtonRef?: RefObject<HTMLButtonElement | null>;
  onChoose: (model: LaunchModel | "manual-applicant") => void;
}) {
  const preloadAvailableForm = () => {
    void loadLaunchForm();
  };
  const preloadManualApplicantLaunch = () => {
    void loadManualApplicantLaunch();
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
        {manualApplicantLaunchEnabled ? (
          <button
            ref={manualApplicantButtonRef}
            className={`launch-model-card ${launchExperience.modelCard} liquid-glass-surface`}
            data-launch-model-option="manual-applicant"
            data-launch-model-available="true"
            data-launch-model-launchable="true"
            type="button"
            aria-labelledby="launch-model-manual-applicant-title"
            aria-describedby="launch-model-manual-applicant-description"
            onPointerEnter={preloadManualApplicantLaunch}
            onFocus={preloadManualApplicantLaunch}
            onClick={() => onChoose("manual-applicant")}
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
                sizes="(max-width: 760px) calc(100vw - 32px), (max-width: 1280px) calc((100vw - 96px) / 4), 260px"
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
                <strong id="launch-model-manual-applicant-title">
                  Custom Hook
                </strong>
                <small data-status="ready">Ready</small>
              </span>
              <span
                className={`launch-model-description ${launchExperience.modelDescription}`}
                id="launch-model-manual-applicant-description"
              >
                Sign in with the GitHub account and wallet approved in your
                Hookbuilder submission. Your exact coin loads automatically.
              </span>
              <span
                className={`launch-model-action ${launchExperience.modelAction}`}
              >
                Open Custom Hook launch
                <ArrowRight aria-hidden="true" size={16} />
              </span>
            </span>
          </button>
        ) : null}

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
              src="/brand/create/basedbid-v2.png"
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
