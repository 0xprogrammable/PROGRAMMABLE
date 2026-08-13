"use client";

import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
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
import { CreateGuide } from "@/components/create-guide";
import launchExperience from "@/components/launch-experience.module.css";
import { isConfiguredClassicV3ReleaseReady } from "@/lib/classic-v3-release";
import { resolveImplementedLaunchModel } from "@/lib/launch-model-gating";
import type { LaunchModel } from "@/lib/launch";
import type { TrustedLaunchPermitSignerV2 } from "@/lib/custom-launch/contract-v2";
import type { CustomLaunchStageV1 } from "@/components/custom-launch-experience";

const launchEnvironment =
  process.env.NEXT_PUBLIC_PROGRAMMABLE_ONCHAIN_NETWORK === "rehearsal"
    ? "rehearsal"
    : "production";
const classicV3LaunchAvailable =
  isConfiguredClassicV3ReleaseReady(launchEnvironment);
const LOCAL_PREVIEW_STAGES = new Set<CustomLaunchStageV1>([
  "github",
  "repositories",
  "approval",
  "prepare",
  "wallet",
  "registry",
]);

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

function LaunchFormLoading({
  onBack,
  title = "Create token",
}: {
  onBack: () => void;
  title?: string;
}) {
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
          <h1>{title}</h1>
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

type LaunchExperienceProps = Readonly<{
  customLaunchLocalPreviewStage?: CustomLaunchStageV1;
  customLaunchPublicEnabled: boolean;
  trustedLaunchPermitSigners?: readonly TrustedLaunchPermitSignerV2[];
}>;

export function LaunchExperience(props: LaunchExperienceProps) {
  if (
    process.env.NODE_ENV !== "development"
    || props.customLaunchLocalPreviewStage
  ) {
    return <LaunchExperienceRuntime {...props} />;
  }

  return (
    <Suspense fallback={<LaunchExperienceRuntime {...props} />}>
      <DevelopmentLaunchPreviewRoute {...props} />
    </Suspense>
  );
}

function DevelopmentLaunchPreviewRoute(props: LaunchExperienceProps) {
  const searchParams = useSearchParams();
  const previewCandidate = searchParams.get("localPreview");
  const customLaunchLocalPreviewStage = previewCandidate
    && LOCAL_PREVIEW_STAGES.has(previewCandidate as CustomLaunchStageV1)
    ? previewCandidate as CustomLaunchStageV1
    : undefined;
  return (
    <LaunchExperienceRuntime
      {...props}
      customLaunchLocalPreviewStage={customLaunchLocalPreviewStage}
    />
  );
}

function LaunchExperienceRuntime({
  customLaunchLocalPreviewStage,
  customLaunchPublicEnabled,
  trustedLaunchPermitSigners = [],
}: LaunchExperienceProps) {
  const [selectedModel, setSelectedModel] = useState<LaunchModel | "custom" | null>(
    customLaunchLocalPreviewStage ? "custom" : null,
  );
  const customLaunchButtonRef = useRef<HTMLButtonElement>(null);
  const restoreCustomLaunchFocusRef = useRef(false);

  useEffect(() => {
    if (selectedModel !== null || !restoreCustomLaunchFocusRef.current) return;
    restoreCustomLaunchFocusRef.current = false;
    customLaunchButtonRef.current?.focus();
  }, [selectedModel]);

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
    restoreCustomLaunchFocusRef.current = selectedModel === "custom";
    window.scrollTo({ left: 0, top: 0, behavior: "auto" });
    setSelectedModel(null);
  }

  if (!selectedModel) {
    return (
      <LaunchModelPicker
        customLaunchPublicEnabled={customLaunchPublicEnabled}
        customLaunchButtonRef={customLaunchButtonRef}
        onChoose={chooseModel}
      />
    );
  }

  if (selectedModel === "custom") {
    return (
      <Suspense fallback={<LaunchFormLoading title="Custom launch" onBack={returnToModels} />}>
        <LazyCustomLaunchExperience
          onBack={returnToModels}
          trustedLaunchPermitSigners={trustedLaunchPermitSigners}
          localPreviewStage={customLaunchLocalPreviewStage}
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
  customLaunchButtonRef,
  onChoose,
}: {
  /**
   * This is the same closed-world gate used by the generic Custom Launch API.
   * The picker must never infer launchability from a legacy/manual flag.
   */
  customLaunchPublicEnabled?: boolean;
  customLaunchButtonRef?: RefObject<HTMLButtonElement | null>;
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
        <CreateGuide />
      </header>

      <div className={`launch-model-grid ${launchExperience.modelGrid}`}>
        {customLaunchPublicEnabled ? (
          <button
            ref={customLaunchButtonRef}
            className={`launch-model-card ${launchExperience.modelCard} liquid-glass-surface`}
            data-launch-model-option="custom"
            data-launch-model-available="true"
            data-launch-model-launchable="true"
            type="button"
            aria-labelledby="launch-model-custom-title"
            aria-describedby="launch-model-custom-description"
            onPointerEnter={preloadCustomLaunch}
            onFocus={preloadCustomLaunch}
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
                <strong id="launch-model-custom-title">
                  Custom Hook
                </strong>
                <small data-status="available">Available</small>
              </span>
              <span
                className={`launch-model-description ${launchExperience.modelDescription}`}
                id="launch-model-custom-description"
              >
                Launch a project only after its exact GitHub revision has been
                reviewed and approved by Programmable.
              </span>
              <span
                className={`launch-model-action ${launchExperience.modelAction}`}
              >
                Open approved Custom Hook launch
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
