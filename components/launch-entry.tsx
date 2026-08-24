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
const PREDICTION_V2_LOCAL_PREVIEW_STATES = new Set([
  "address",
  "asset",
  "prediction",
  "review",
  "ambiguous",
  "error",
] as const);
const PREDICTION_V2_LOCAL_PREVIEW_FIXTURES = new Set([
  "base",
  "solana",
] as const);

type PredictionV2LocalPreviewState =
  | "address"
  | "asset"
  | "prediction"
  | "review"
  | "ambiguous"
  | "error";
type PredictionV2LocalPreviewFixture = "base" | "solana";

function loadLaunchForm() {
  return import("@/components/launch-builder");
}

function loadCustomLaunch() {
  return import("@/components/custom-launch-experience");
}

function loadPredictionMarket() {
  return import("@/components/prediction-market-launch");
}

const LazyCustomLaunchExperience = lazy(async () => {
  const customModule = await loadCustomLaunch();
  return { default: customModule.CustomLaunchExperience };
});

const LazyPredictionMarketLaunch = lazy(async () => {
  const predictionModule = await loadPredictionMarket();
  return { default: predictionModule.PredictionMarketLaunch };
});

const LazyDevelopmentCustomLaunchPreview = process.env.NODE_ENV === "development"
  ? lazy(async () => {
      const previewModule = await import("@/components/custom-launch-local-preview");
      return { default: previewModule.CustomLaunchLocalPreview };
    })
  : null;

const LazyDevelopmentPredictionV2Preview = process.env.NODE_ENV === "development"
  ? lazy(async () => {
      const previewModule = await import(
        "@/components/prediction-market-v2-local-preview"
      );
      return { default: previewModule.PredictionMarketV2LocalPreview };
    })
  : null;

type LaunchBuilderComponent =
  (typeof import("@/components/launch-builder"))["LaunchBuilderForm"];
type LaunchPickerChoice = LaunchModel | "custom" | "prediction";

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
  if (
    previewCandidate === "prediction-v2" &&
    LazyDevelopmentPredictionV2Preview !== null
  ) {
    const stateCandidate = searchParams.get("predictionState");
    const fixtureCandidate = searchParams.get("fixture");
    const initialState = stateCandidate &&
      PREDICTION_V2_LOCAL_PREVIEW_STATES.has(
        stateCandidate as PredictionV2LocalPreviewState,
      )
      ? stateCandidate as PredictionV2LocalPreviewState
      : "address";
    const fixture = fixtureCandidate &&
      PREDICTION_V2_LOCAL_PREVIEW_FIXTURES.has(
        fixtureCandidate as PredictionV2LocalPreviewFixture,
      )
      ? fixtureCandidate as PredictionV2LocalPreviewFixture
      : "base";

    return (
      <Suspense fallback={<LaunchFormLoading title="Create a prediction" onBack={() => undefined} />}>
        <LazyDevelopmentPredictionV2Preview
          fixture={fixture}
          initialState={initialState}
          onBack={() => window.location.assign("/launch")}
        />
      </Suspense>
    );
  }
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
  const [selectedModel, setSelectedModel] = useState<LaunchPickerChoice | null>(null);
  const [loadedLaunchBuilder, setLoadedLaunchBuilder] =
    useState<LaunchBuilderComponent | null>(null);
  const [preparingModel, setPreparingModel] = useState<LaunchModel | null>(null);
  const [modelLoadError, setModelLoadError] = useState("");
  const customLaunchButtonRef = useRef<HTMLAnchorElement>(null);
  const predictionButtonRef = useRef<HTMLButtonElement>(null);
  const restorePickerFocusRef = useRef<"custom" | "prediction" | null>(null);

  useEffect(() => {
    if (selectedModel !== null || restorePickerFocusRef.current === null) return;
    const modelToRestore = restorePickerFocusRef.current;
    restorePickerFocusRef.current = null;
    if (modelToRestore === "prediction") {
      predictionButtonRef.current?.focus();
      return;
    }
    customLaunchButtonRef.current?.focus();
  }, [selectedModel]);

  useEffect(() => {
    void loadLaunchForm().catch(() => undefined);
  }, []);

  async function chooseModel(candidate: LaunchPickerChoice) {
    if (candidate === "prediction") {
      window.scrollTo({ left: 0, top: 0, behavior: "auto" });
      setSelectedModel("prediction");
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
    restorePickerFocusRef.current =
      selectedModel === "custom" || selectedModel === "prediction"
        ? selectedModel
        : null;
    window.scrollTo({ left: 0, top: 0, behavior: "auto" });
    setSelectedModel(null);
  }

  if (!selectedModel) {
    return (
      <LaunchModelPicker
        customLaunchPublicEnabled={customLaunchPublicEnabled}
        customLaunchButtonRef={customLaunchButtonRef}
        predictionButtonRef={predictionButtonRef}
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

  if (selectedModel === "prediction") {
    return (
      <Suspense fallback={<LaunchFormLoading title="Create a prediction" onBack={returnToModels} />}>
        <LazyPredictionMarketLaunch onBack={returnToModels} />
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
  customLaunchButtonRef,
  predictionButtonRef,
  modelLoadError = "",
  onChoose,
  preparingModel = null,
}: {
  /** Retained for callers that also host the internal legacy launch runtime. */
  customLaunchPublicEnabled?: boolean;
  customLaunchButtonRef?: RefObject<HTMLAnchorElement | null>;
  predictionButtonRef?: RefObject<HTMLButtonElement | null>;
  modelLoadError?: string;
  onChoose: (model: LaunchPickerChoice) => void | Promise<void>;
  preparingModel?: LaunchModel | null;
}) {
  const preloadAvailableForm = () => {
    void loadLaunchForm();
  };
  const preloadPredictionMarket = () => {
    void loadPredictionMarket().catch(() => undefined);
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
          <small data-status="api">API</small>
        </span>
        <span
          className={`launch-model-description ${launchExperience.modelDescription}`}
          id="launch-model-custom-description"
        >
          Create an API key, submit a deterministic bundle for checks, then
          receive a prepared launch for your wallet to review. The API cannot
          sign or broadcast.
        </span>
        <span
          className={`launch-model-action ${launchExperience.modelAction}`}
        >
          Create a Custom launch API key
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
        <h1>Choose a launch model</h1>
      </header>

      <div className={`launch-model-grid ${launchExperience.modelGrid}`}>
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

        <Link
          ref={customLaunchButtonRef}
          className={`launch-model-card ${launchExperience.modelCard} liquid-glass-surface`}
          data-launch-model-option="custom"
          data-launch-model-available="true"
          data-launch-model-entry="api-first"
          data-launch-model-launchable="false"
          href="/developers/api-keys"
          aria-labelledby="launch-model-custom-title"
          aria-describedby="launch-model-custom-description"
        >
          {customCardContent}
        </Link>

        <button
          ref={predictionButtonRef}
          className={`launch-model-card ${launchExperience.modelCard} ${launchExperience.predictionCard} liquid-glass-surface`}
          data-launch-model-option="prediction"
          data-launch-model-available="true"
          data-launch-model-launchable="false"
          data-launch-model-preview="true"
          type="button"
          aria-labelledby="launch-model-prediction-title"
          aria-describedby="launch-model-prediction-description"
          onPointerEnter={preloadPredictionMarket}
          onPointerDown={preloadPredictionMarket}
          onFocus={preloadPredictionMarket}
          onClick={() => void onChoose("prediction")}
        >
          <span
            className={`launch-model-art ${launchExperience.modelArt} ${launchExperience.predictionArt}`}
            aria-hidden="true"
          >
            <span className={launchExperience.predictionRail}>
              <span
                className={`${launchExperience.predictionSide} ${launchExperience.predictionYes}`}
              >
                <span>YES</span>
                <strong>50¢</strong>
              </span>
              <span className={launchExperience.predictionCondition}>
                <span>BTC</span>
                <strong>&ge; $60K</strong>
              </span>
              <span
                className={`${launchExperience.predictionSide} ${launchExperience.predictionNo}`}
              >
                <span>NO</span>
                <strong>50¢</strong>
              </span>
            </span>
          </span>
          <span
            className={`launch-model-card-body ${launchExperience.modelBody}`}
          >
            <span
              className={`launch-model-card-heading ${launchExperience.modelHeading}`}
            >
              <strong id="launch-model-prediction-title">Prediction</strong>
              <small data-status="preview">Beta</small>
            </span>
            <span
              className={`launch-model-description ${launchExperience.modelDescription}`}
              id="launch-model-prediction-description"
            >
              Create a BTC prediction with YES and NO.
            </span>
            <span
              className={`launch-model-action ${launchExperience.modelAction}`}
            >
              Create a prediction
              <ArrowRight aria-hidden="true" size={16} />
            </span>
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
