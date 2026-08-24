"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";

import { PredictionMarketAssetPreviewCardV2 } from
  "@/components/prediction-market-asset-card-v2";
import styles from "@/components/prediction-market-create-flow-v2.module.css";
import { applyTokenImageFallback } from "@/lib/token-image";
import { predictionAssetCardImageV2 } from
  "@/lib/prediction-v2/asset-logo-v2";
import {
  parsePredictionAssetAutoDiscoveryV2,
  type PredictionAssetAutoDiscoveryClientCandidateV2,
  type PredictionAssetAutoDiscoveryClientResultV2,
} from "@/lib/prediction-v2/asset-auto-discovery-v2";
import {
  evaluatePredictionAssetDiscoveryEligibilityV2,
  type PredictionAssetDiscoveryReasonCodeV2,
  type PredictionAssetMarketCapSupplyEvidenceV2,
} from "@/lib/prediction-v2/asset-eligibility-v2";
import {
  PREDICTION_V2_MAXIMUM_MARKET_DURATION_SECONDS,
  PREDICTION_V2_MINIMUM_MARKET_DURATION_SECONDS,
  PREDICTION_V2_PROTOCOL_PRICE_DECIMALS,
  PREDICTION_V2_SETTLEMENT_CHAIN_ID,
  buildPredictionV2CreateReview,
  predictionV2ExactUtcToUnixSeconds,
  type PredictionV2CreationReferenceSnapshot,
  type PredictionV2CreateMetric,
  type PredictionV2CreateValidationErrors,
  type PredictionV2DetectedAsset,
  type PredictionV2EnabledCreateTemplate,
  type PredictionV2ReferenceMetricSnapshot,
  type PredictionV2ReferenceSupplySnapshot,
} from "@/lib/prediction-v2/create-flow-v2";

const AUTO_DISCOVERY_ENDPOINT = "/api/prediction/asset-auto-discovery";
const MAX_UINT256 = (1n << 256n) - 1n;

type CreateFlowViewV2 = "address" | "asset" | "prediction" | "review";

export type PredictionMarketCreateFlowV2Discovery = (
  locator: string,
  signal: AbortSignal,
) => Promise<unknown>;

export type PredictionMarketCreateFlowV2InitialPrediction = Readonly<{
  metric?: PredictionV2CreateMetric;
  template?: PredictionV2EnabledCreateTemplate;
  targetUsd?: string;
  percentChange?: string;
  observationUtc?: string;
  priceDecimals?: typeof PREDICTION_V2_PROTOCOL_PRICE_DECIMALS;
}>;

export type PredictionMarketCreateFlowV2Props = Readonly<{
  /** Deterministic seed data for local previews and static render tests. */
  discoverToken?: PredictionMarketCreateFlowV2Discovery;
  initialLocator?: string;
  initialDiscoveryResult?: PredictionAssetAutoDiscoveryClientResultV2 | null;
  initialMarketCapSupplyEvidence?: PredictionAssetMarketCapSupplyEvidenceV2 | null;
  initialCreationSnapshot?: PredictionV2CreationReferenceSnapshot | null;
  initialReferenceMetricSnapshot?: PredictionV2ReferenceMetricSnapshot | null;
  initialReferenceSupplySnapshot?: PredictionV2ReferenceSupplySnapshot | null;
  /** Prevents a supply snapshot from being reused for a different detected token. */
  initialReferenceSupplySelectionKey?: string;
  initialPrediction?: PredictionMarketCreateFlowV2InitialPrediction;
  initialView?: CreateFlowViewV2;
}>;

type SearchState = "idle" | "loading";

async function fetchPredictionAssetAutoDiscoveryV2(
  locator: string,
  signal: AbortSignal,
) {
  const response = await fetch(
    `${AUTO_DISCOVERY_ENDPOINT}?locator=${encodeURIComponent(locator)}`,
    {
      cache: "no-store",
      headers: { accept: "application/json" },
      signal,
    },
  );
  return response.json() as Promise<unknown>;
}

function firstCandidate(
  result: PredictionAssetAutoDiscoveryClientResultV2 | null | undefined,
) {
  return result?.status === "unique" ? result.candidate : null;
}

function initialViewFor(
  requested: CreateFlowViewV2 | undefined,
  candidate: PredictionAssetAutoDiscoveryClientCandidateV2 | null,
): CreateFlowViewV2 {
  if (!candidate) return "address";
  return requested ?? "asset";
}

function shortAddress(address: string) {
  return address.length <= 15
    ? address
    : `${address.slice(0, 7)}…${address.slice(-5)}`;
}

function candidateDisplayName(
  candidate: PredictionAssetAutoDiscoveryClientCandidateV2,
) {
  return candidate.profile.name ?? `${candidate.profile.chain.label} token`;
}

function candidateDisplaySymbol(
  candidate: PredictionAssetAutoDiscoveryClientCandidateV2,
) {
  return candidate.profile.symbol ?? shortAddress(candidate.profile.address);
}

function candidateFallbackGlyph(
  candidate: PredictionAssetAutoDiscoveryClientCandidateV2,
) {
  const source = candidate.profile.symbol ??
    candidate.profile.name ??
    candidate.profile.chain.label;
  return Array.from(source)[0]?.toUpperCase() ?? "T";
}

function formatUsd(value: number | undefined, mode: "price" | "compact") {
  if (value === undefined || !Number.isFinite(value) || value < 0) return "—";
  if (mode === "compact" && value >= 1_000) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      notation: "compact",
      maximumFractionDigits: value >= 1_000_000 ? 1 : 2,
    }).format(value);
  }
  if (value === 0) return "$0";
  if (value < 0.01) {
    return `$${value.toLocaleString("en-US", {
      maximumSignificantDigits: 6,
      useGrouping: false,
    })}`;
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value < 1 ? 6 : 2,
  }).format(value);
}

function formatUsdText(value: string) {
  const match = /^(0|[1-9]\d*)(?:\.(\d+))?$/u.exec(value);
  if (!match) return `$${value}`;
  const integer = match[1].replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
  return `$${integer}${match[2] ? `.${match[2]}` : ""}`;
}

function formatAge(seconds: number | undefined) {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0) {
    return "—";
  }
  if (seconds < 3_600) return `${Math.max(1, Math.floor(seconds / 60))} min`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)} hr`;
  const days = Math.floor(seconds / 86_400);
  if (days < 60) return `${days} day${days === 1 ? "" : "s"}`;
  if (days < 730) return `${Math.floor(days / 30)} mo`;
  return `${Math.floor(days / 365)} yr`;
}

function exactUtcFromInput(value: string) {
  const normalized = value.trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u.test(normalized)) {
    return `${normalized}:00Z`;
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/u.test(normalized)) {
    return `${normalized}Z`;
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(normalized)) {
    return normalized;
  }
  return "";
}

function dateTimeInputFromUtc(value: string | undefined) {
  if (!value) return "";
  const exact = exactUtcFromInput(value);
  return exact && predictionV2ExactUtcToUnixSeconds(exact)
    ? exact.slice(0, 16)
    : "";
}

function formatDeadline(value: string) {
  const unixSeconds = predictionV2ExactUtcToUnixSeconds(value);
  if (!unixSeconds) return value;
  const date = new Date(Number(unixSeconds) * 1_000);
  const day = new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(date);
  return `${day}, ${time} UTC`;
}

function dateTimeInputFromUnixSeconds(value: bigint) {
  const milliseconds = Number(value) * 1_000;
  if (!Number.isSafeInteger(milliseconds)) return "";
  return new Date(milliseconds).toISOString().slice(0, 16);
}

type EvidenceSnapshotBase = Readonly<{
  sourceNetwork: string;
  address: string;
  capturedAtUtc: string;
  snapshotReference: string;
  evidenceDigest: string;
  verificationStatus: string;
}>;

function evidenceSnapshotMatchesCandidate(
  snapshot: EvidenceSnapshotBase | null | undefined,
  candidate: PredictionAssetAutoDiscoveryClientCandidateV2,
) {
  if (
    !snapshot ||
    snapshot.sourceNetwork !== candidate.selection.sourceNetwork ||
    snapshot.address !== candidate.profile.address ||
    snapshot.verificationStatus !== "verified" ||
    !predictionV2ExactUtcToUnixSeconds(snapshot.capturedAtUtc) ||
    !/^0x[0-9a-f]{64}$/u.test(snapshot.evidenceDigest) ||
    /^0x0{64}$/u.test(snapshot.evidenceDigest)
  ) return false;
  const position = snapshot.snapshotReference.split(":").at(-1);
  const prefix = candidate.selection.sourceNetwork === "solana"
    ? "solana:slot:"
    : `eip155:${candidate.profile.chain.reference}:block:`;
  return Boolean(
    position &&
    /^(?:0|[1-9]\d{0,19})$/u.test(position) &&
    snapshot.snapshotReference === `${prefix}${position}`,
  );
}

function isValidCreationSnapshot(
  snapshot: PredictionV2CreationReferenceSnapshot | null | undefined,
): snapshot is PredictionV2CreationReferenceSnapshot {
  if (
    !snapshot ||
    snapshot.settlementChainId !== PREDICTION_V2_SETTLEMENT_CHAIN_ID ||
    snapshot.verificationStatus !== "verified" ||
    !predictionV2ExactUtcToUnixSeconds(snapshot.capturedAtUtc) ||
    !/^0x[0-9a-f]{64}$/u.test(snapshot.evidenceDigest) ||
    /^0x0{64}$/u.test(snapshot.evidenceDigest)
  ) return false;
  const prefix = `eip155:${PREDICTION_V2_SETTLEMENT_CHAIN_ID}:block:`;
  if (!snapshot.snapshotReference.startsWith(prefix)) return false;
  const position = snapshot.snapshotReference.slice(prefix.length);
  return /^(?:0|[1-9]\d{0,19})$/u.test(position);
}

function isBoundSupplySnapshot(
  snapshot: PredictionV2ReferenceSupplySnapshot | null | undefined,
  candidate: PredictionAssetAutoDiscoveryClientCandidateV2,
  creationSnapshot: PredictionV2CreationReferenceSnapshot | null,
): snapshot is PredictionV2ReferenceSupplySnapshot {
  if (
    !snapshot ||
    !creationSnapshot ||
    !evidenceSnapshotMatchesCandidate(snapshot, candidate) ||
    snapshot.supplyDefinition !== "fixed-supply-fully-circulating" ||
    !/^[1-9]\d*$/u.test(snapshot.fixedSupplyAtoms) ||
    !Number.isInteger(snapshot.tokenDecimals) ||
    snapshot.tokenDecimals < 0 ||
    snapshot.tokenDecimals > 255 ||
    snapshot.capturedAtUtc !== creationSnapshot.capturedAtUtc
  ) return false;
  try {
    const supply = BigInt(snapshot.fixedSupplyAtoms);
    return supply > 0n && supply <= MAX_UINT256;
  } catch {
    return false;
  }
}

function isBoundMetricSnapshot(
  snapshot: PredictionV2ReferenceMetricSnapshot | null | undefined,
  candidate: PredictionAssetAutoDiscoveryClientCandidateV2,
  creationSnapshot: PredictionV2CreationReferenceSnapshot | null,
  metric: PredictionV2CreateMetric,
): snapshot is PredictionV2ReferenceMetricSnapshot {
  if (!snapshot || !creationSnapshot) return false;
  return Boolean(
    evidenceSnapshotMatchesCandidate(snapshot, candidate) &&
    snapshot.metric === metric &&
    /^(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(snapshot.valueUsd) &&
    snapshot.valueUsd.length <= 96 &&
    Number.isFinite(Number(snapshot.valueUsd)) &&
    Number(snapshot.valueUsd) > 0 &&
    snapshot.capturedAtUtc === creationSnapshot.capturedAtUtc,
  );
}

function detectedAssetFromCandidate(
  candidate: PredictionAssetAutoDiscoveryClientCandidateV2,
  supplySnapshot: PredictionV2ReferenceSupplySnapshot | null,
): PredictionV2DetectedAsset {
  return {
    identity: {
      sourceNetwork: candidate.selection.sourceNetwork,
      address: candidate.profile.address,
    },
    name: candidateDisplayName(candidate),
    symbol: candidateDisplaySymbol(candidate),
    referenceSupplySnapshot: supplySnapshot,
  };
}

function searchErrorFor(result: PredictionAssetAutoDiscoveryClientResultV2) {
  if (result.status === "invalid") {
    return "Enter a valid token address.";
  }
  if (result.status === "not-found") {
    return "No supported token was found for this address.";
  }
  if (result.status === "inconclusive") {
    return "The chain could not be confirmed. Try again.";
  }
  return null;
}

function marketDataReasonText(reason: PredictionAssetDiscoveryReasonCodeV2) {
  switch (reason) {
    case "price-unavailable":
    case "price-not-positive":
      return "A current USD price is unavailable.";
    case "pool-age-unavailable":
      return "Pool age is unavailable.";
    case "pool-too-new":
      return "The pool must be at least 24 hours old.";
    case "liquidity-unavailable":
      return "Liquidity data is unavailable.";
    case "liquidity-below-minimum":
      return "The token needs at least $50K in liquidity.";
    case "volume-24h-unavailable":
      return "24-hour volume is unavailable.";
    case "volume-24h-below-minimum":
      return "The token needs at least $25K in 24-hour volume.";
  }
}

function withoutPredictionErrors(
  current: PredictionV2CreateValidationErrors,
  keys: readonly (keyof PredictionV2CreateValidationErrors)[],
) {
  const next = { ...current };
  for (const key of keys) delete next[key];
  return next;
}

function observationErrorText(error: string | undefined) {
  return error === "Enter an exact UTC time including seconds and Z."
    ? "Choose a result time in UTC."
    : error;
}

const PREDICTION_CHOICE_ERROR_KEYS = Object.freeze([
  "metric",
  "template",
  "targetUsd",
  "percentChange",
  "referenceMetricSnapshot",
  "referenceSupplySnapshot",
  "precision",
  "protocolPredicate",
] as const satisfies readonly (keyof PredictionV2CreateValidationErrors)[]);

const TARGET_FIELD_ERROR_KEYS = Object.freeze([
  "targetUsd",
  "percentChange",
  "referenceMetricSnapshot",
  "precision",
  "protocolPredicate",
] as const satisfies readonly (keyof PredictionV2CreateValidationErrors)[]);

export function PredictionMarketCreateFlowV2({
  discoverToken = fetchPredictionAssetAutoDiscoveryV2,
  initialLocator,
  initialDiscoveryResult = null,
  initialMarketCapSupplyEvidence = null,
  initialCreationSnapshot = null,
  initialReferenceMetricSnapshot = null,
  initialReferenceSupplySnapshot = null,
  initialReferenceSupplySelectionKey,
  initialPrediction,
  initialView,
}: PredictionMarketCreateFlowV2Props) {
  const generatedId = useId();
  const addressId = `${generatedId}-address`;
  const addressErrorId = `${generatedId}-address-error`;
  const targetId = `${generatedId}-target`;
  const targetErrorId = `${generatedId}-target-error`;
  const timeId = `${generatedId}-time`;
  const timeErrorId = `${generatedId}-time-error`;

  const seededCandidate = firstCandidate(initialDiscoveryResult);
  const seededSupplyKey = initialReferenceSupplySelectionKey ?? null;
  const seededMetric = initialPrediction?.metric ?? "price";
  const seededCreationSnapshot = seededCandidate &&
      isValidCreationSnapshot(initialCreationSnapshot)
    ? initialCreationSnapshot
    : null;
  const seededPercentageAvailable = Boolean(
    seededCandidate &&
    isBoundMetricSnapshot(
      initialReferenceMetricSnapshot,
      seededCandidate,
      seededCreationSnapshot,
      seededMetric,
    ),
  );

  const [view, setView] = useState<CreateFlowViewV2>(() =>
    initialViewFor(initialView, seededCandidate)
  );
  const [locator, setLocator] = useState(
    initialLocator ?? initialDiscoveryResult?.locator ?? "",
  );
  const [discoveryResult, setDiscoveryResult] =
    useState<PredictionAssetAutoDiscoveryClientResultV2 | null>(
      initialDiscoveryResult,
    );
  const [candidate, setCandidate] =
    useState<PredictionAssetAutoDiscoveryClientCandidateV2 | null>(
      seededCandidate,
    );
  const [searchState, setSearchState] = useState<SearchState>("idle");
  const [searchError, setSearchError] = useState<string | null>(() =>
    initialDiscoveryResult ? searchErrorFor(initialDiscoveryResult) : null
  );
  const [assetError, setAssetError] = useState<string | null>(null);
  const [metric, setMetric] = useState<PredictionV2CreateMetric>(
    seededMetric,
  );
  const [template, setTemplate] = useState<PredictionV2EnabledCreateTemplate>(
    initialPrediction?.template === "percent-change" && seededPercentageAvailable
      ? "percent-change"
      : "target",
  );
  const [targetUsd, setTargetUsd] = useState(initialPrediction?.targetUsd ?? "");
  const [percentChange, setPercentChange] = useState(
    initialPrediction?.percentChange ?? "",
  );
  const [observationInput, setObservationInput] = useState(
    dateTimeInputFromUtc(initialPrediction?.observationUtc),
  );
  const [predictionErrors, setPredictionErrors] =
    useState<PredictionV2CreateValidationErrors>({});

  const requestIdRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const stepTitleRef = useRef<HTMLHeadingElement | null>(null);
  const addressInputRef = useRef<HTMLInputElement | null>(null);
  const choosePredictionButtonRef = useRef<HTMLButtonElement | null>(null);
  const reviewPredictionButtonRef = useRef<HTMLButtonElement | null>(null);
  const targetInputRef = useRef<HTMLInputElement | null>(null);
  const timeInputRef = useRef<HTMLInputElement | null>(null);
  const assetErrorRef = useRef<HTMLParagraphElement | null>(null);
  const predictionFormErrorRef = useRef<HTMLParagraphElement | null>(null);

  useEffect(() => () => {
    requestIdRef.current += 1;
    abortControllerRef.current?.abort();
  }, []);

  const creationSnapshot = useMemo(() => {
    if (!candidate || !isValidCreationSnapshot(initialCreationSnapshot)) {
      return null;
    }
    return initialCreationSnapshot;
  }, [candidate, initialCreationSnapshot]);

  const supplySnapshot = useMemo(() => {
    if (
      !candidate ||
      (seededSupplyKey !== null && candidate.selectionKey !== seededSupplyKey) ||
      !isBoundSupplySnapshot(
        initialReferenceSupplySnapshot,
        candidate,
        creationSnapshot,
      )
    ) return null;
    return initialReferenceSupplySnapshot;
  }, [
    candidate,
    creationSnapshot,
    initialReferenceSupplySnapshot,
    seededSupplyKey,
  ]);

  const referenceMetricSnapshot = useMemo(() => {
    if (
      !candidate ||
      !isBoundMetricSnapshot(
        initialReferenceMetricSnapshot,
        candidate,
        creationSnapshot,
        metric,
      )
    ) return null;
    return initialReferenceMetricSnapshot;
  }, [
    candidate,
    creationSnapshot,
    initialReferenceMetricSnapshot,
    metric,
  ]);

  const detectedAsset = useMemo(() =>
    candidate ? detectedAssetFromCandidate(candidate, supplySnapshot) : null,
  [candidate, supplySnapshot]);

  const marketDataQuality = useMemo(() => {
    if (!candidate || !discoveryResult) return null;
    const observedAtMs = Date.parse(discoveryResult.observedAt);
    if (!Number.isSafeInteger(observedAtMs) || observedAtMs < 0) return null;
    return evaluatePredictionAssetDiscoveryEligibilityV2({
      profile: candidate.profile,
      observedAtMs,
      volume24hUsd: candidate.pair?.volume24hUsd ?? null,
      marketCapSupplyEvidence: initialMarketCapSupplyEvidence,
    });
  }, [candidate, discoveryResult, initialMarketCapSupplyEvidence]);
  const marketDataReasons = marketDataQuality?.reasonCodes.map(
    marketDataReasonText,
  ) ?? ["Current market data is unavailable."];
  const hasCompleteMarketData = marketDataQuality?.status === "eligible";
  const marketCapAvailable = Boolean(supplySnapshot);
  const percentageAvailable = Boolean(referenceMetricSnapshot);
  const predictionReady = Boolean(creationSnapshot && detectedAsset);
  const assetReadinessId = `${generatedId}-asset-readiness`;
  const searchStatus = searchState === "loading"
    ? "Checking supported chains…"
    : discoveryResult?.status === "ambiguous"
      ? `${discoveryResult.candidates.length} matching tokens found. Choose a chain.`
      : "";

  const referenceMetricUsd = referenceMetricSnapshot?.valueUsd ?? null;
  const observationBounds = useMemo(() => {
    const creationUnixText = creationSnapshot
      ? predictionV2ExactUtcToUnixSeconds(creationSnapshot.capturedAtUtc)
      : null;
    if (!creationUnixText) return null;
    const creationUnix = BigInt(creationUnixText);
    const firstValidSecond = creationUnix +
      PREDICTION_V2_MINIMUM_MARKET_DURATION_SECONDS + 1n;
    const firstValidMinute =
      ((firstValidSecond + 59n) / 60n) * 60n;
    const lastValidSecond = creationUnix +
      PREDICTION_V2_MAXIMUM_MARKET_DURATION_SECONDS;
    const lastValidMinute = (lastValidSecond / 60n) * 60n;
    return {
      min: dateTimeInputFromUnixSeconds(firstValidMinute),
      max: dateTimeInputFromUnixSeconds(lastValidMinute),
    };
  }, [creationSnapshot]);

  const prediction = useMemo(() => {
    if (!creationSnapshot) return null;
    const common = {
      metric,
      observationUtc: exactUtcFromInput(observationInput),
      creationSnapshot,
      priceDecimals: PREDICTION_V2_PROTOCOL_PRICE_DECIMALS,
    } as const;
    if (template === "target") return { ...common, template, targetUsd };
    return referenceMetricSnapshot
      ? { ...common, template, percentChange, referenceMetricSnapshot }
      : null;
  }, [
    creationSnapshot,
    metric,
    observationInput,
    percentChange,
    referenceMetricSnapshot,
    targetUsd,
    template,
  ]);

  const reviewResult = useMemo(() =>
    detectedAsset && prediction
      ? buildPredictionV2CreateReview(detectedAsset, prediction)
      : null,
  [detectedAsset, prediction]);
  const assetImage = useMemo(() => candidate
    ? predictionAssetCardImageV2({
      chainId: candidate.profile.chain.id,
      address: candidate.profile.address,
      logoProxy: candidate.logoProxy,
    })
    : null,
  [candidate]);
  const renderedView = view === "review" && reviewResult?.ok !== true
    ? "prediction"
    : view;

  function cancelPendingRequest() {
    requestIdRef.current += 1;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setSearchState("idle");
  }

  function focusStepTitle() {
    window.setTimeout(() => stepTitleRef.current?.focus(), 0);
  }

  function focusAfterTransition(target: { current: HTMLElement | null }) {
    window.setTimeout(() => target.current?.focus(), 0);
  }

  function changeLocator(value: string) {
    cancelPendingRequest();
    setLocator(value);
    setDiscoveryResult(null);
    setCandidate(null);
    setSearchError(null);
  }

  function chooseCandidate(
    nextCandidate: PredictionAssetAutoDiscoveryClientCandidateV2,
  ) {
    setCandidate(nextCandidate);
    setAssetError(null);
    setPredictionErrors({});
    setMetric("price");
    setTemplate("target");
    setTargetUsd("");
    setPercentChange("");
    setView("asset");
    focusStepTitle();
  }

  async function findToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (searchState === "loading") return;
    const submittedLocator = locator.trim();
    if (!submittedLocator) {
      setSearchError("Enter a token address.");
      addressInputRef.current?.focus();
      return;
    }

    cancelPendingRequest();
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setSearchState("loading");
    setSearchError(null);
    setDiscoveryResult(null);
    setCandidate(null);

    try {
      const body = await discoverToken(submittedLocator, controller.signal);
      const parsed = parsePredictionAssetAutoDiscoveryV2(
        body,
        submittedLocator,
      );
      if (requestId !== requestIdRef.current || controller.signal.aborted) return;
      if (!parsed) throw new Error("invalid discovery response");

      setDiscoveryResult(parsed);
      setLocator(parsed.locator ?? submittedLocator);
      const resultError = searchErrorFor(parsed);
      setSearchError(resultError);
      if (parsed.status === "unique") chooseCandidate(parsed.candidate);
      if (resultError) addressInputRef.current?.focus();
    } catch (error) {
      if (
        requestId !== requestIdRef.current ||
        controller.signal.aborted ||
        (error instanceof DOMException && error.name === "AbortError")
      ) return;
      setSearchError("Token lookup failed. Check your connection and try again.");
      addressInputRef.current?.focus();
    } finally {
      if (requestId === requestIdRef.current) {
        setSearchState("idle");
        abortControllerRef.current = null;
      }
    }
  }

  function changeToken() {
    cancelPendingRequest();
    setView("address");
    setCandidate(null);
    setDiscoveryResult(null);
    setSearchError(null);
    setAssetError(null);
    setPredictionErrors({});
    window.setTimeout(() => addressInputRef.current?.focus(), 0);
  }

  function continueToPrediction() {
    if (!detectedAsset) {
      setAssetError("Choose a detected token before continuing.");
      focusAfterTransition(assetErrorRef);
      return;
    }
    if (!creationSnapshot) {
      setAssetError("This token isn’t ready for predictions yet.");
      focusAfterTransition(assetErrorRef);
      return;
    }
    setAssetError(null);
    setView("prediction");
    focusStepTitle();
  }

  function reviewPrediction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reviewResult || !reviewResult.ok) {
      const errors = reviewResult?.errors ?? (!detectedAsset
        ? { asset: "Choose a detected token before continuing." }
        : !creationSnapshot
          ? { creationSnapshot: "A verified market reference is not available." }
          : template === "percent-change" && !referenceMetricSnapshot
            ? {
                referenceMetricSnapshot:
                  "A verified starting value is not available.",
              }
            : { protocolPredicate: "This prediction cannot be reviewed." });
      setPredictionErrors(errors);
      if (
        errors.targetUsd ||
        errors.percentChange ||
        errors.referenceMetricSnapshot ||
        errors.precision ||
        errors.protocolPredicate
      ) {
        targetInputRef.current?.focus();
      } else if (errors.observationUtc) {
        timeInputRef.current?.focus();
      } else {
        focusAfterTransition(predictionFormErrorRef);
      }
      return;
    }
    setPredictionErrors({});
    setView("review");
    focusStepTitle();
  }

  return (
    <section
      aria-labelledby={`${generatedId}-title`}
      className={styles.root}
      data-prediction-create-v2=""
      data-view={renderedView}
    >
      <header className={styles.intro}>
        <p className={styles.kicker}>Create prediction</p>
        <h1
          className={styles.title}
          id={`${generatedId}-title`}
          ref={stepTitleRef}
          tabIndex={-1}
        >
          {renderedView === "address" ? "Find a token" :
            renderedView === "asset" ? "Token found" :
              renderedView === "prediction" ? "Set the prediction" :
                "Review the market"}
        </h1>
        <p className={styles.subtitle}>
          {renderedView === "address"
            ? "Paste a token address. We’ll find the chain and market data."
            : renderedView === "asset"
              ? "Check the token before choosing what the market predicts."
              : renderedView === "prediction"
                ? "Choose one measurable outcome and an exact UTC time."
                : "Check the token, target and result time."}
        </p>
      </header>

      <div className={styles.surface}>
        {renderedView === "address" ? (
          <form className={styles.addressForm} onSubmit={findToken} noValidate>
            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor={addressId}>
                Token address
              </label>
              <span className={styles.addressInputRow}>
                <input
                  aria-describedby={searchError ? addressErrorId : undefined}
                  aria-invalid={searchError ? true : undefined}
                  autoCapitalize="none"
                  autoComplete="off"
                  className={styles.input}
                  id={addressId}
                  maxLength={128}
                  name="tokenAddress"
                  onChange={(event) => changeLocator(event.target.value)}
                  placeholder="Paste token address"
                  ref={addressInputRef}
                  spellCheck={false}
                  type="text"
                  value={locator}
                />
                <button
                  aria-busy={searchState === "loading"}
                  className={styles.primaryButton}
                  disabled={searchState === "loading"}
                  type="submit"
                >
                  {searchState === "loading" ? (
                    <>
                      <span aria-hidden="true" className={styles.spinner} />
                      Finding token
                    </>
                  ) : "Find token"}
                </button>
              </span>
            </div>

            <div
              aria-atomic="true"
              aria-live="polite"
              className={styles.status}
              role="status"
            >
              {searchStatus}
            </div>
            {searchError ? (
              <p className={styles.error} id={addressErrorId} role="alert">
                {searchError}
              </p>
            ) : null}

            {discoveryResult?.status === "ambiguous" ? (
              <div className={styles.ambiguous}>
                <div className={styles.ambiguousHeader}>
                  <h2>Choose the matching token</h2>
                  <p>This address is active on more than one chain.</p>
                </div>
                <div className={styles.candidateList}>
                  {discoveryResult.candidates.map((option) => (
                    <button
                      className={styles.candidateButton}
                      key={option.selectionKey}
                      onClick={() => chooseCandidate(option)}
                      type="button"
                    >
                      <span className={styles.candidateMain}>
                        <strong>{candidateDisplayName(option)}</strong>
                        <span>{candidateDisplaySymbol(option)}</span>
                      </span>
                      <span className={styles.candidateMeta}>
                        {option.profile.chain.label}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </form>
        ) : null}

        {renderedView === "asset" && candidate ? (
          <article className={styles.profile} aria-label="Detected token">
            <div className={styles.profileHeader}>
              <div className={styles.tokenVisual}>
                {assetImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    alt={assetImage.usesProviderLogo
                      ? `${candidateDisplayName(candidate)} logo`
                      : ""}
                    className={styles.tokenLogo}
                    height={72}
                    onError={(event) => {
                      applyTokenImageFallback(
                        event.currentTarget,
                        predictionAssetCardImageV2({
                          chainId: candidate.profile.chain.id,
                          address: candidate.profile.address,
                        }).source,
                      );
                    }}
                    referrerPolicy="no-referrer"
                    src={assetImage.source}
                    width={72}
                  />
                ) : (
                  <span aria-hidden="true" className={styles.tokenFallback}>
                    {candidateFallbackGlyph(candidate)}
                  </span>
                )}
              </div>

              <div className={styles.identity}>
                <span className={styles.chain}>{candidate.profile.chain.label}</span>
                <h2 className={styles.tokenName}>
                  {candidateDisplayName(candidate)}
                  <span className={styles.tokenSymbol}>
                    {candidateDisplaySymbol(candidate)}
                  </span>
                </h2>
                <a
                  aria-label={`${shortAddress(candidate.profile.address)} · View on ${candidate.profile.chain.label} explorer (opens in a new tab)`}
                  className={styles.addressLink}
                  href={candidate.profile.explorerUrl}
                  rel="noreferrer noopener"
                  target="_blank"
                >
                  {shortAddress(candidate.profile.address)}
                  <span aria-hidden="true">↗</span>
                </a>
              </div>

              <button className={styles.changeButton} onClick={changeToken} type="button">
                Change token
              </button>
            </div>

            <dl className={styles.stats} aria-label="Current token data">
              <div>
                <dt>Price</dt>
                <dd>{formatUsd(candidate.profile.priceUsd, "price")}</dd>
              </div>
              <div>
                <dt>Market cap</dt>
                <dd>{formatUsd(candidate.profile.marketCapUsd, "compact")}</dd>
              </div>
              <div>
                <dt>FDV</dt>
                <dd>{formatUsd(candidate.profile.fdvUsd, "compact")}</dd>
              </div>
              <div>
                <dt>Liquidity</dt>
                <dd>{formatUsd(candidate.profile.liquidityUsd, "compact")}</dd>
              </div>
              <div>
                <dt>Age</dt>
                <dd>{formatAge(candidate.profile.age?.seconds)}</dd>
              </div>
            </dl>

            {candidate.profile.links?.length ? (
              <nav
                aria-label={`${candidateDisplaySymbol(candidate)} links`}
                className={styles.socialLinks}
              >
                {candidate.profile.links.map((link) => (
                  <a
                    className={styles.socialLink}
                    href={link.url}
                    key={link.kind}
                    rel="noopener noreferrer nofollow ugc"
                    target="_blank"
                  >
                    {link.kind === "website" ? "Website" :
                      link.kind === "x" ? "X" : "Telegram"}
                    <span aria-hidden="true">↗</span>
                  </a>
                ))}
              </nav>
            ) : null}

            {!hasCompleteMarketData ? (
              <div className={styles.eligibilityNotice} role="status">
                <strong>Market data incomplete</strong>
                <ul>
                  {marketDataReasons.map((reason) => <li key={reason}>{reason}</li>)}
                </ul>
              </div>
            ) : null}

            {!predictionReady ? (
              <p className={styles.inlineNotice} id={assetReadinessId} role="status">
                This token isn’t ready for predictions yet.
              </p>
            ) : null}

            {assetError ? (
              <p
                className={styles.error}
                ref={assetErrorRef}
                role="alert"
                tabIndex={-1}
              >
                {assetError}
              </p>
            ) : null}

            <div className={styles.profileActions}>
              <button
                aria-describedby={!predictionReady
                  ? assetReadinessId
                  : undefined}
                className={styles.primaryButton}
                disabled={!predictionReady}
                onClick={continueToPrediction}
                ref={choosePredictionButtonRef}
                type="button"
              >
                Continue with {candidate.profile.chain.label}
              </button>
            </div>
          </article>
        ) : null}

        {renderedView === "prediction" && candidate ? (
          <form className={styles.prediction} onSubmit={reviewPrediction} noValidate>
            <div className={styles.sectionHeader}>
              <button
                className={styles.backButton}
                onClick={() => {
                  setView("asset");
                  focusAfterTransition(choosePredictionButtonRef);
                }}
                type="button"
              >
                <span aria-hidden="true">←</span>
                {candidateDisplaySymbol(candidate)}
              </button>
            </div>

            <fieldset className={styles.group}>
              <legend>Measure</legend>
              <div className={styles.segmented}>
                <button
                  aria-pressed={metric === "market-cap"}
                  className={styles.segment}
                  data-active={metric === "market-cap"}
                  disabled={!marketCapAvailable}
                  onClick={() => {
                    setMetric("market-cap");
                    setTemplate("target");
                    setPredictionErrors((current) => withoutPredictionErrors(
                      current,
                      PREDICTION_CHOICE_ERROR_KEYS,
                    ));
                  }}
                  type="button"
                >
                  Market cap
                </button>
                <button
                  aria-pressed={metric === "price"}
                  className={styles.segment}
                  data-active={metric === "price"}
                  onClick={() => {
                    setMetric("price");
                    setTemplate("target");
                    setPredictionErrors((current) => withoutPredictionErrors(
                      current,
                      PREDICTION_CHOICE_ERROR_KEYS,
                    ));
                  }}
                  type="button"
                >
                  Price
                </button>
              </div>
              {!marketCapAvailable ? (
                <p className={styles.inlineHint}>
                  Market cap isn’t available for this token yet.
                </p>
              ) : null}
            </fieldset>

            <fieldset className={styles.group}>
              <legend>Prediction</legend>
              <div className={`${styles.segmented} ${styles.templateSwitch}`}>
                <button
                  aria-pressed={template === "target"}
                  className={styles.segment}
                  data-active={template === "target"}
                  onClick={() => {
                    setTemplate("target");
                    setPredictionErrors((current) => withoutPredictionErrors(
                      current,
                      PREDICTION_CHOICE_ERROR_KEYS,
                    ));
                  }}
                  type="button"
                >
                  Target
                </button>
                <button
                  aria-describedby={!percentageAvailable
                    ? `${generatedId}-percentage-note`
                    : undefined}
                  aria-pressed={template === "percent-change"}
                  className={styles.segment}
                  data-active={template === "percent-change"}
                  disabled={!percentageAvailable}
                  onClick={() => {
                    setTemplate("percent-change");
                    setPredictionErrors((current) => withoutPredictionErrors(
                      current,
                      PREDICTION_CHOICE_ERROR_KEYS,
                    ));
                  }}
                  type="button"
                >
                  Percentage change
                </button>
                <button
                  aria-describedby={`${generatedId}-reach-note`}
                  className={`${styles.segment} ${styles.segmentDisabled}`}
                  disabled
                  type="button"
                >
                  Reach before deadline
                </button>
              </div>
              <p className={styles.inlineHint}>
                {!percentageAvailable ? (
                  <span id={`${generatedId}-percentage-note`}>
                    Percentage change needs a verified starting value.{" "}
                  </span>
                ) : null}
                <span id={`${generatedId}-reach-note`}>
                  Reach markets are coming later.
                </span>
              </p>
            </fieldset>

            <div className={styles.predictionFields}>
              <div className={styles.field}>
                <label className={styles.fieldLabel} htmlFor={targetId}>
                  {template === "target"
                    ? metric === "market-cap" ? "Target market cap" : "Target price"
                    : "Change"}
                </label>
                <span
                  className={styles.adornedInput}
                  data-adornment={template === "target" ? "start" : "end"}
                >
                  <span aria-hidden="true" className={styles.adornment}>
                    {template === "target" ? "$" : "%"}
                  </span>
                  <input
                    aria-describedby={targetErrorId}
                    aria-invalid={Boolean(
                      predictionErrors.targetUsd ||
                      predictionErrors.percentChange ||
                      predictionErrors.referenceMetricSnapshot ||
                      predictionErrors.precision ||
                      predictionErrors.protocolPredicate,
                    )}
                    autoComplete="off"
                    className={styles.input}
                    id={targetId}
                    inputMode="decimal"
                    name={template === "target" ? "targetUsd" : "percentChange"}
                    onChange={(event) => {
                      if (template === "target") setTargetUsd(event.target.value);
                      else setPercentChange(event.target.value);
                      setPredictionErrors((current) => withoutPredictionErrors(
                        current,
                        TARGET_FIELD_ERROR_KEYS,
                      ));
                    }}
                    placeholder={template === "target" ? "1000000" : "25"}
                    ref={targetInputRef}
                    spellCheck={false}
                    type="text"
                    value={template === "target" ? targetUsd : percentChange}
                  />
                </span>
                <span className={styles.fieldFeedback} id={targetErrorId}>
                  {predictionErrors.targetUsd ??
                    predictionErrors.percentChange ??
                    predictionErrors.referenceMetricSnapshot ??
                    predictionErrors.precision ??
                    predictionErrors.protocolPredicate ??
                    (template === "percent-change" && referenceMetricUsd
                      ? `Measured from ${formatUsdText(referenceMetricUsd)}`
                      : "")}
                </span>
              </div>

              <div className={styles.field}>
                <label className={styles.fieldLabel} htmlFor={timeId}>
                  Result time (UTC)
                </label>
                <input
                  aria-describedby={timeErrorId}
                  aria-invalid={Boolean(predictionErrors.observationUtc)}
                  className={styles.input}
                  id={timeId}
                  max={observationBounds?.max}
                  min={observationBounds?.min}
                  name="observationUtc"
                  onChange={(event) => {
                    setObservationInput(event.target.value);
                    setPredictionErrors((current) => withoutPredictionErrors(
                      current,
                      ["observationUtc"],
                    ));
                  }}
                  ref={timeInputRef}
                  step={60}
                  type="datetime-local"
                  value={observationInput}
                />
                <span className={styles.fieldFeedback} id={timeErrorId}>
                  {observationErrorText(predictionErrors.observationUtc) ??
                    "Exact to the minute, shown in UTC."}
                </span>
              </div>
            </div>

            {!creationSnapshot ? (
              <p className={styles.inlineNotice} role="status">
                This token isn’t ready for predictions yet.
              </p>
            ) : null}

            {predictionErrors.referenceSupplySnapshot ||
                predictionErrors.creationSnapshot ||
                predictionErrors.metric ||
                predictionErrors.template ||
                predictionErrors.priceDecimals ||
                predictionErrors.asset ? (
              <p
                className={styles.error}
                ref={predictionFormErrorRef}
                role="alert"
                tabIndex={-1}
              >
                {predictionErrors.referenceSupplySnapshot ??
                  predictionErrors.creationSnapshot ??
                  predictionErrors.metric ??
                  predictionErrors.template ??
                  predictionErrors.priceDecimals ??
                  predictionErrors.asset}
              </p>
            ) : null}

            <div className={styles.profileActions}>
              <button
                className={styles.primaryButton}
                ref={reviewPredictionButtonRef}
                type="submit"
              >
                Review prediction
              </button>
            </div>
          </form>
        ) : null}

        {renderedView === "review" && reviewResult?.ok ? (
          <div className={styles.review}>
            <button
              className={styles.backButton}
              onClick={() => {
                setView("prediction");
                focusAfterTransition(reviewPredictionButtonRef);
              }}
              type="button"
            >
              <span aria-hidden="true">←</span>
              Edit prediction
            </button>

            {candidate ? (
              <div className={styles.reviewCard}>
                <PredictionMarketAssetPreviewCardV2
                  imageLoading="eager"
                  logoProxy={candidate.logoProxy}
                  profile={candidate.profile}
                  review={reviewResult.review}
                />
              </div>
            ) : null}

            <div className={styles.rule}>
              <span className={styles.ruleLabel}>YES resolves if</span>
              <p className={styles.ruleText}>
                The USD price is at least{" "}
                <strong>{formatUsdText(
                  reviewResult.review.protocolPredicate.strikeUsd,
                )}</strong>{" "}
                at {formatDeadline(
                  reviewResult.review.protocolPredicate.observationUtc,
                )}.
              </p>
            </div>

            <div className={styles.reviewActions}>
              <button className={styles.previewButton} disabled type="button">
                Preview only
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
