"use client";

import Image from "next/image";
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

const LazyCustomLaunchExperience = lazy(async () => {
  const customModule = await loadCustomLaunch();
  return { default: customModule.CustomLaunchExperience };
});

const LazyDevelopmentCustomLaunchPreview = process.env.NODE_ENV === "development"
  ? lazy(async () => {
      const previewModule = await import("@/components/custom-launch-local-preview");
      return { default: previewModule.CustomLaunchLocalPreview };
    })
  : null;

type LaunchBuilderComponent =
  (typeof import("@/components/launch-builder"))["LaunchBuilderForm"];

function LaunchFormLoading({
  onBack,
  title = "Create Classic Token",
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
  customLaunchPublicEnabled: boolean;
  trustedLaunchPermitSigners?: readonly TrustedLaunchPermitSignerV2[];
}>;

export function LaunchExperience(props: LaunchExperienceProps) {
  if (process.env.NODE_ENV !== "development") {
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
  const localPreviewStage = previewCandidate
    && LOCAL_PREVIEW_STAGES.has(previewCandidate as CustomLaunchStageV1)
    ? previewCandidate as CustomLaunchStageV1
    : undefined;
  if (localPreviewStage === undefined || LazyDevelopmentCustomLaunchPreview === null) {
    return <LaunchExperienceRuntime {...props} />;
  }
  return (
    <Suspense fallback={<LaunchFormLoading title="Approved project launch" onBack={() => undefined} />}>
      <LazyDevelopmentCustomLaunchPreview
        initialStage={localPreviewStage}
        onBack={() => window.location.assign("/launch")}
      />
    </Suspense>
  );
}

function LaunchExperienceRuntime({
  customLaunchPublicEnabled,
  trustedLaunchPermitSigners = [],
}: LaunchExperienceProps) {
  const [selectedModel, setSelectedModel] = useState<LaunchModel | "custom" | null>(null);
  const [loadedLaunchBuilder, setLoadedLaunchBuilder] =
    useState<LaunchBuilderComponent | null>(null);
  const [preparingModel, setPreparingModel] = useState<LaunchModel | null>(null);
  const [modelLoadError, setModelLoadError] = useState("");
  const customLaunchButtonRef = useRef<HTMLButtonElement>(null);
  const restoreCustomLaunchFocusRef = useRef(false);

  useEffect(() => {
    if (selectedModel !== null || !restoreCustomLaunchFocusRef.current) return;
    restoreCustomLaunchFocusRef.current = false;
    customLaunchButtonRef.current?.focus();
  }, [selectedModel]);

  useEffect(() => {
    void loadLaunchForm().catch(() => undefined);
  }, []);

  async function chooseModel(candidate: LaunchModel | "custom") {
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
    restoreCustomLaunchFocusRef.current = selectedModel === "custom";
    window.scrollTo({ left: 0, top: 0, behavior: "auto" });
    setSelectedModel(null);
  }

  if (!selectedModel) {
    return (
      <LaunchModelPicker
        customLaunchPublicEnabled={customLaunchPublicEnabled}
        customLaunchButtonRef={customLaunchButtonRef}
        modelLoadError={modelLoadError}
        onChoose={chooseModel}
        preparingModel={preparingModel}
      />
    );
  }

  if (selectedModel === "custom") {
    return (
      <Suspense fallback={<LaunchFormLoading title="Custom launch" onBack={returnToModels} />}>
        <LazyCustomLaunchExperience
          onBack={returnToModels}
          trustedLaunchPermitSigners={trustedLaunchPermitSigners}
        />
      </Suspense>
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
  customLaunchPublicEnabled = false,
  customLaunchButtonRef,
  modelLoadError = "",
  onChoose,
  preparingModel = null,
}: {
  /**
   * This is the same closed-world gate used by the generic Custom Launch API.
   * The picker must never infer launchability from a legacy/manual flag.
   */
  customLaunchPublicEnabled?: boolean;
  customLaunchButtonRef?: RefObject<HTMLButtonElement | null>;
  modelLoadError?: string;
  onChoose: (model: LaunchModel | "custom") => void | Promise<void>;
  preparingModel?: LaunchModel | null;
}) {
  const preloadAvailableForm = () => {
    void loadLaunchForm();
  };
  const preloadCustomLaunch = () => {
    if (!customLaunchPublicEnabled) return;
    void loadCustomLaunch();
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
          <strong id="launch-model-custom-title">Custom</strong>
          {!customLaunchPublicEnabled ? (
            <small data-status="pending">Soon</small>
          ) : null}
        </span>
        <span
          className={`launch-model-description ${launchExperience.modelDescription}`}
          id="launch-model-custom-description"
        >
          {customLaunchPublicEnabled
            ? "Launch an approved GitHub revision through your browser wallet, then follow it to its public record."
            : "Custom launch models are coming soon."}
        </span>
        {customLaunchPublicEnabled ? (
          <span
            className={`launch-model-action ${launchExperience.modelAction}`}
          >
            Open approved Custom launch
            <ArrowRight aria-hidden="true" size={16} />
          </span>
        ) : null}
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
        <h1>Choose a launch model</h1>
      </header>

      <div className={`launch-model-grid ${launchExperience.modelGrid}`}>
        <button
          ref={customLaunchButtonRef}
          className={`launch-model-card ${launchExperience.modelCard} liquid-glass-surface`}
          data-launch-model-option="custom"
          data-launch-model-available={customLaunchPublicEnabled}
          data-launch-model-launchable={customLaunchPublicEnabled}
          type="button"
          disabled={!customLaunchPublicEnabled}
          aria-labelledby="launch-model-custom-title"
          aria-describedby="launch-model-custom-description"
          onPointerEnter={
            customLaunchPublicEnabled ? preloadCustomLaunch : undefined
          }
          onFocus={customLaunchPublicEnabled ? preloadCustomLaunch : undefined}
          onClick={
            customLaunchPublicEnabled
              ? () => void onChoose("custom")
              : undefined
          }
        >
          {customCardContent}
        </button>

        <button
          className={`launch-model-card ${launchExperience.modelCard} liquid-glass-surface`}
          data-launch-model-option="classic"
          data-launch-model-available={classicV3LaunchAvailable}
          data-launch-model-launchable={classicV3LaunchAvailable}
          type="button"
          disabled={!classicV3LaunchAvailable || preparingModel !== null}
          aria-busy={preparingModel === "classic-v3"}
          aria-labelledby="launch-model-classic-title"
          aria-describedby="launch-model-classic-description"
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
                {preparingModel === "classic-v3"
                  ? "Opening Classic"
                  : "Create a Classic coin"}
                <ArrowRight aria-hidden="true" size={16} />
              </span>
            ) : null}
          </span>
        </button>

      </div>
      {modelLoadError ? (
        <p className={launchExperience.modelLoadError} role="alert">
          {modelLoadError}
        </p>
      ) : null}
    </div>
  );
}
