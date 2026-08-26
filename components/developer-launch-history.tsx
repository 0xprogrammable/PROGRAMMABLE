"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { RefreshCw } from "lucide-react";

import styles from "@/components/developer-launch-history.module.css";
import {
  prepareCustomLaunchWalletActionV1,
  type CustomLaunchWalletActionV1,
} from "@/lib/custom-launch/wallet-handoff-v1";
import { prepareCustomLaunchWalletActionV2 } from
  "@/lib/custom-launch/wallet-handoff-v2";
import {
  createCustomLaunchFundingSubmissionV3,
  prepareCustomLaunchFundingAuthorizationV3,
  prepareCustomLaunchRouterReviewV3,
  type CustomLaunchFundingAuthorizationSubmissionV3,
  type CustomLaunchFundingAuthorizationV3,
  type CustomLaunchRouterReviewV3,
} from "@/lib/custom-launch/wallet-handoff-v3";

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type LaunchStatus =
  | "received"
  | "validating"
  | "pending_review"
  | "action_required"
  | "prepared"
  | "awaiting_funding_authorization"
  | "funding_authorization_verified"
  | "simulating"
  | "authorized"
  | "submitted"
  | "finalized"
  | "failed"
  | "cancelled";

export type LaunchResource = Readonly<{
  schemaVersion:
    | "programmable.custom-launch.v1"
    | "programmable.custom-launch.v2"
    | "programmable.custom-launch.v3";
  launchId: string;
  requestId: string;
  onchainLaunchId: `0x${string}` | null;
  routeId:
    | "custom-launch:create:v1"
    | "custom-launch:create:v2"
    | "custom-launch:create:v3";
  ownerWallet: `0x${string}`;
  status: LaunchStatus;
  launchProfileHash: `sha256:${string}` | null;
  launchIntentHash: `sha256:${string}` | null;
  fundingIntentHash: `0x${string}` | null;
  createdAt: string;
  updatedAt: string;
  output: Record<string, JsonValue> | null;
  failure: Readonly<{
    code: string;
    message: string;
    retryable: boolean;
  }> | null;
}>;

type HistoryPage = Readonly<{
  launches: LaunchResource[];
  nextCursor: string | null;
}>;

type DeveloperLaunchHistoryProps = Readonly<{
  account: `0x${string}`;
  getAccessToken: () => Promise<string | null>;
  getIdentityToken: () => Promise<string | null>;
  sendCustomLaunchWalletAction: (
    input: CustomLaunchWalletActionV1,
  ) => Promise<`0x${string}`>;
  signCustomLaunchFundingAuthorization: (
    input: CustomLaunchFundingAuthorizationV3,
  ) => Promise<`0x${string}`>;
}>;

const listSchemaVersions = new Set([
  "programmable.custom-launch-history.v1",
  "programmable.custom-launch-list.v1",
  "programmable.custom-launch-list.v2",
  "programmable.custom-launch-list.v3",
]);
const pageSize = 5;
const statuses = new Set<LaunchStatus>([
  "received",
  "validating",
  "pending_review",
  "action_required",
  "prepared",
  "awaiting_funding_authorization",
  "funding_authorization_verified",
  "simulating",
  "authorized",
  "submitted",
  "finalized",
  "failed",
  "cancelled",
]);
const dateFormatter = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
});
const submittedPollIntervalMs = 12_000;
const authorizedPollIntervalMs = 4_000;
const launchHistoryRefreshTimeoutMs = 12_000;
const launchHistoryRefreshTimeoutReason = "launch-history-refresh-timeout";
const transactionHashPattern = /^0x[0-9a-fA-F]{64}$/u;
const sha256Pattern = /^sha256:[0-9a-f]{64}$/u;
const launchStatusRank: Readonly<Record<LaunchStatus, number>> = Object.freeze({
  received: 0,
  validating: 1,
  awaiting_funding_authorization: 2,
  funding_authorization_verified: 3,
  pending_review: 4,
  action_required: 4,
  prepared: 5,
  simulating: 6,
  authorized: 7,
  submitted: 8,
  failed: 9,
  cancelled: 9,
  finalized: 10,
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseLaunch(value: unknown, account: string): LaunchResource | null {
  const v1 = isRecord(value)
    && value.schemaVersion === "programmable.custom-launch.v1"
    && value.routeId === "custom-launch:create:v1";
  const v2 = isRecord(value)
    && value.schemaVersion === "programmable.custom-launch.v2"
    && value.routeId === "custom-launch:create:v2";
  const v3 = isRecord(value)
    && value.schemaVersion === "programmable.custom-launch.v3"
    && value.routeId === "custom-launch:create:v3";
  if (
    !isRecord(value)
    || (!v1 && !v2 && !v3)
    || typeof value.launchId !== "string"
    || typeof value.requestId !== "string"
    || value.requestId !== value.launchId
    || (value.onchainLaunchId !== null
      && typeof value.onchainLaunchId !== "string")
    || typeof value.ownerWallet !== "string"
    || value.ownerWallet.toLowerCase() !== account.toLowerCase()
    || typeof value.status !== "string"
    || !statuses.has(value.status as LaunchStatus)
    || (v1 && [
      "simulating",
      "awaiting_funding_authorization",
      "funding_authorization_verified",
    ].includes(value.status))
    || (v2 && [
      "awaiting_funding_authorization",
      "funding_authorization_verified",
    ].includes(value.status))
    || typeof value.createdAt !== "string"
    || typeof value.updatedAt !== "string"
    || (value.output !== null && !isRecord(value.output))
  ) return null;
  const launchProfileHash = (v2 || v3)
    && typeof value.launchProfileHash === "string"
    && sha256Pattern.test(value.launchProfileHash)
    ? value.launchProfileHash as `sha256:${string}`
    : null;
  const launchIntentHash = (v2 || v3)
    && typeof value.launchIntentHash === "string"
    && sha256Pattern.test(value.launchIntentHash)
    ? value.launchIntentHash as `sha256:${string}`
    : null;
  if ((v2 || v3) && (!launchProfileHash || !launchIntentHash)) return null;
  const fundingIntentHash = v3
    && typeof value.fundingIntentHash === "string"
    && /^0x[0-9a-f]{64}$/u.test(value.fundingIntentHash)
    ? value.fundingIntentHash as `0x${string}`
    : null;
  let failure: LaunchResource["failure"] = null;
  if (value.failure !== null) {
    if (
      !isRecord(value.failure)
      || typeof value.failure.code !== "string"
      || typeof value.failure.message !== "string"
      || typeof value.failure.retryable !== "boolean"
    ) return null;
    failure = {
      code: value.failure.code,
      message: value.failure.message,
      retryable: value.failure.retryable,
    };
  }
  return {
    schemaVersion: value.schemaVersion as LaunchResource["schemaVersion"],
    launchId: value.launchId,
    requestId: value.requestId,
    onchainLaunchId: value.onchainLaunchId as `0x${string}` | null,
    routeId: value.routeId as LaunchResource["routeId"],
    ownerWallet: value.ownerWallet as `0x${string}`,
    status: value.status as LaunchStatus,
    launchProfileHash,
    launchIntentHash,
    fundingIntentHash,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    output: value.output as Record<string, JsonValue> | null,
    failure,
  };
}

export function parseHistoryPage(
  value: unknown,
  account: string,
): HistoryPage | null {
  if (
    !isRecord(value)
    || typeof value.schemaVersion !== "string"
    || !listSchemaVersions.has(value.schemaVersion)
    || !Array.isArray(value.launches)
    || value.launches.length > pageSize * 2
    || (value.nextCursor !== null && typeof value.nextCursor !== "string")
  ) return null;
  const launches: LaunchResource[] = [];
  for (const candidate of value.launches) {
    const parsed = parseLaunch(candidate, account);
    if (!parsed) return null;
    launches.push(parsed);
  }
  return {
    launches,
    nextCursor: value.nextCursor as string | null,
  };
}

class LaunchHistoryRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfterMs: number | null,
  ) {
    super(message);
    this.name = "LaunchHistoryRequestError";
  }
}

export function launchPollingRetryAfterMs(
  status: number,
  retryAfterMs: number | null,
) {
  return (status === 429 || status === 503) && retryAfterMs !== null
    ? retryAfterMs
    : null;
}

function readApiError(
  response: Response,
  value: unknown,
  fallback = "Unable to load launch history.",
) {
  const retryAfter = response.headers.get("retry-after");
  const retryAfterSeconds = retryAfter && /^[1-9][0-9]{0,4}$/u.test(retryAfter)
    ? Number(retryAfter)
    : null;
  if (!isRecord(value) || !isRecord(value.error)) {
    return new LaunchHistoryRequestError(
      fallback,
      response.status,
      retryAfterSeconds === null ? null : retryAfterSeconds * 1_000,
    );
  }
  const message = typeof value.error.message === "string" && value.error.message.trim()
    ? value.error.message
    : fallback;
  const requestId = typeof value.error.requestId === "string"
    && /^[A-Za-z0-9][A-Za-z0-9._:@+-]{0,127}$/u.test(value.error.requestId)
    ? value.error.requestId
    : null;
  const retryCopy = response.status === 429 && retryAfterSeconds !== null
    ? ` Try again in ${retryAfterSeconds} seconds.`
    : "";
  const requestCopy = requestId ? ` Request ID: ${requestId}.` : "";
  return new LaunchHistoryRequestError(
    `${message}${retryCopy}${requestCopy}`,
    response.status,
    retryAfterSeconds === null ? null : retryAfterSeconds * 1_000,
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : dateFormatter.format(date);
}

function shortId(value: string) {
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

function statusCopy(status: LaunchStatus) {
  switch (status) {
    case "received": return "Received";
    case "validating": return "Validating";
    case "pending_review": return "Admission checks running";
    case "action_required": return "Review required";
    case "prepared": return "Prepared";
    case "awaiting_funding_authorization": return "Funding signature required";
    case "funding_authorization_verified": return "Funding verified";
    case "simulating": return "Simulating";
    case "authorized": return "Wallet action required";
    case "submitted": return "Confirming onchain";
    case "finalized": return "Finalized";
    case "failed": return "Failed";
    case "cancelled": return "Cancelled";
  }
}

function statusDescription(status: LaunchStatus) {
  switch (status) {
    case "received": return "The API accepted this request.";
    case "validating": return "The API is validating the request.";
    case "pending_review": return "Exact-source checks and the bounded static baseline are still running.";
    case "action_required": return "A blocking static indicator needs platform review before Router simulation.";
    case "prepared": return "The launch transaction has been prepared.";
    case "awaiting_funding_authorization": return "Review and sign the exact USDC funding authorization. This does not send a transaction.";
    case "funding_authorization_verified": return "The funding signature passed verification. The Router transaction is being prepared.";
    case "simulating": return "The exact wallet transaction is being simulated.";
    case "authorized": return "Review and sign the prepared transaction in your wallet.";
    case "submitted": return "The wallet transaction is being tracked onchain.";
    case "finalized": return "The Router recorded this launch.";
    case "failed": return "This request did not complete.";
    case "cancelled": return "This request was cancelled.";
  }
}

function walletTransaction(launch: LaunchResource) {
  const candidate = launch.output?.walletTransaction;
  return isRecord(candidate) ? candidate : null;
}

function fundingAuthorizationReview(launch: LaunchResource) {
  if (
    launch.routeId !== "custom-launch:create:v3"
    || launch.status !== "awaiting_funding_authorization"
    || !launch.fundingIntentHash
  ) return null;
  try {
    return prepareCustomLaunchFundingAuthorizationV3(
      launch.output,
      launch.ownerWallet,
      launch.launchId,
      launch.fundingIntentHash,
    );
  } catch {
    return null;
  }
}

function routerTransactionReview(launch: LaunchResource) {
  if (
    launch.routeId !== "custom-launch:create:v3"
    || launch.status !== "authorized"
  ) return null;
  try {
    return prepareCustomLaunchRouterReviewV3(
      launch.output,
      launch.ownerWallet,
    );
  } catch {
    return null;
  }
}

function sameFundingAuthorization(
  left: CustomLaunchFundingAuthorizationV3,
  right: CustomLaunchFundingAuthorizationV3,
) {
  return left.fundingIntentHash === right.fundingIntentHash
    && left.typedDataDigest === right.typedDataDigest
    && left.chainId === right.chainId
    && left.launchId === right.launchId
    && left.submissionPath === right.submissionPath
    && left.token === right.token
    && left.from === right.from
    && left.to === right.to
    && left.value === right.value
    && left.validAfter === right.validAfter
    && left.validBefore === right.validBefore
    && left.nonce === right.nonce
    && JSON.stringify(left.typedData) === JSON.stringify(right.typedData);
}

function sameRouterReview(
  left: CustomLaunchRouterReviewV3,
  right: CustomLaunchRouterReviewV3,
) {
  return left.transactionPreimageHash === right.transactionPreimageHash
    && left.graphCommitment === right.graphCommitment
    && left.artifactHash === right.artifactHash
    && left.permitDigest === right.permitDigest
    && left.initializerCalldataHash === right.initializerCalldataHash
    && left.selector === right.selector
    && left.calldataLengthBytes === right.calldataLengthBytes
    && JSON.stringify(left.walletAction) === JSON.stringify(right.walletAction);
}

function reviewResourceForLaunch(
  launch: LaunchResource,
  hydrated: LaunchResource | undefined,
) {
  return hydrated
    && launchResourceKey(hydrated) === launchResourceKey(launch)
    && hydrated.status === launch.status
    && hydrated.updatedAt === launch.updatedAt
    ? hydrated
    : launch;
}

function formatUsdcAmount(value: string) {
  const raw = BigInt(value).toString().padStart(7, "0");
  const whole = raw.slice(0, -6);
  const fraction = raw.slice(-6).replace(/0+$/u, "");
  return `${whole}${fraction ? `.${fraction}` : ""} USDC`;
}

function fundingValidityCopy(value: string) {
  const milliseconds = Number(BigInt(value) * 1_000n);
  return Number.isSafeInteger(milliseconds)
    ? formatDate(new Date(milliseconds).toISOString())
    : "Invalid";
}

function onchainTransactionHash(launch: LaunchResource) {
  const onchain = launch.output?.onchain;
  if (!isRecord(onchain) || typeof onchain.transactionHash !== "string") {
    return null;
  }
  return transactionHashPattern.test(onchain.transactionHash)
    ? onchain.transactionHash as `0x${string}`
    : null;
}

function terminalStatus(status: LaunchStatus) {
  return status === "finalized" || status === "failed" || status === "cancelled";
}

function launchResourceKey(
  launch: Pick<LaunchResource, "routeId" | "requestId">,
) {
  return `${launch.routeId}:${launch.requestId}`;
}

function updatedAtTime(value: string) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function selectMonotonicLaunchResource(
  current: LaunchResource,
  incoming: LaunchResource,
) {
  if (launchResourceKey(current) !== launchResourceKey(incoming)) {
    return incoming;
  }
  if (terminalStatus(current.status) && current.status !== incoming.status) {
    return current;
  }

  const currentRank = launchStatusRank[current.status];
  const incomingRank = launchStatusRank[incoming.status];
  if (incomingRank < currentRank) return current;
  if (incomingRank > currentRank) return incoming;
  return updatedAtTime(incoming.updatedAt) > updatedAtTime(current.updatedAt)
    ? incoming
    : current;
}

export function mergeLaunchResources(
  current: readonly LaunchResource[],
  incoming: readonly LaunchResource[],
  incomingOrderFirst: boolean,
) {
  const currentByRequestId = new Map(
    current.map((launch) => [launchResourceKey(launch), launch] as const),
  );
  const incomingByRequestId = new Map(
    incoming.map((launch) => [launchResourceKey(launch), launch] as const),
  );

  if (incomingOrderFirst) {
    return [
      ...incoming.map((launch) => {
        const existing = currentByRequestId.get(launchResourceKey(launch));
        return existing
          ? selectMonotonicLaunchResource(existing, launch)
          : launch;
      }),
      ...current.filter((launch) =>
        !incomingByRequestId.has(launchResourceKey(launch))),
    ];
  }

  return [
    ...current.map((launch) => {
      const updated = incomingByRequestId.get(launchResourceKey(launch));
      return updated
        ? selectMonotonicLaunchResource(launch, updated)
        : launch;
    }),
    ...incoming.filter((launch) =>
      !currentByRequestId.has(launchResourceKey(launch))),
  ];
}

function pollDelay(milliseconds: number, signal: AbortSignal) {
  return new Promise<boolean>((resolve) => {
    if (signal.aborted) {
      resolve(false);
      return;
    }
    const timeout = window.setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve(true);
    }, milliseconds);
    const abort = () => {
      window.clearTimeout(timeout);
      resolve(false);
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}

function HistorySkeleton() {
  return (
    <>
      <span className={styles.visuallyHidden} role="status">
        Loading launch history
      </span>
      <div className={styles.skeletonList} aria-hidden="true">
        <span className={styles.skeletonRow} />
      </div>
    </>
  );
}

export function DeveloperLaunchHistory({
  account,
  getAccessToken,
  getIdentityToken,
  sendCustomLaunchWalletAction,
  signCustomLaunchFundingAuthorization,
}: DeveloperLaunchHistoryProps) {
  const [launches, setLaunches] = useState<LaunchResource[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [hydratingId, setHydratingId] = useState<string | null>(null);
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [fundingId, setFundingId] = useState<string | null>(null);
  const [fundingRetryDelayMs, setFundingRetryDelayMs] = useState<number | null>(
    null,
  );
  const [pendingFundingIds, setPendingFundingIds] = useState<
    Readonly<Record<string, true>>
  >({});
  const [pollingIds, setPollingIds] = useState<
    Readonly<Record<string, true>>
  >({});
  const [submittedHashes, setSubmittedHashes] = useState<
    Readonly<Record<string, `0x${string}`>>
  >({});
  const [hydratedReviews, setHydratedReviews] = useState<
    Readonly<Record<string, LaunchResource>>
  >({});
  const [error, setError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const requestSequenceRef = useRef(0);
  const refreshControllerRef = useRef<AbortController | null>(null);
  const loadMoreInFlightRef = useRef(false);
  const checkInFlightRef = useRef(false);
  const hydrateInFlightRef = useRef(false);
  const sendInFlightRef = useRef(false);
  const fundingInFlightRef = useRef(false);
  const pendingFundingRef = useRef(new Map<string, Readonly<{
    authorization: CustomLaunchFundingAuthorizationV3;
    body: CustomLaunchFundingAuthorizationSubmissionV3;
    idempotencyKey: string;
  }>>());
  const pollControllersRef = useRef(new Map<string, AbortController>());

  const rememberPendingFunding = useCallback((
    key: string,
    pending: Readonly<{
      authorization: CustomLaunchFundingAuthorizationV3;
      body: CustomLaunchFundingAuthorizationSubmissionV3;
      idempotencyKey: string;
    }>,
  ) => {
    pendingFundingRef.current.set(key, pending);
    setPendingFundingIds((current) => current[key]
      ? current
      : Object.freeze({ ...current, [key]: true }));
  }, []);

  const forgetPendingFunding = useCallback((key: string) => {
    if (!pendingFundingRef.current.delete(key)) return;
    setPendingFundingIds((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return Object.freeze(next);
    });
  }, []);

  const getAuthHeaders = useCallback(async () => {
    const identityToken = await getIdentityToken().catch(() => null);
    const accessToken = await getAccessToken();
    if (!accessToken) {
      throw new Error(
        "Your wallet session expired. Reconnect your wallet and try again.",
      );
    }
    const headers = new Headers({
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
    });
    if (identityToken) headers.set("X-Privy-Identity-Token", identityToken);
    return headers;
  }, [getAccessToken, getIdentityToken]);

  const load = useCallback(async (
    cursor: string | null,
    signal?: AbortSignal,
    refreshRequest = false,
  ) => {
    if (cursor !== null && loadMoreInFlightRef.current) return;
    if (cursor !== null) {
      loadMoreInFlightRef.current = true;
      setLoadingMore(true);
    }
    const requestSequence = ++requestSequenceRef.current;
    setError("");
    try {
      const query = new URLSearchParams({
        walletAddress: account,
        limit: String(pageSize),
      });
      if (cursor !== null) query.set("cursor", cursor);
      const response = await fetch(
        `/api/developer/custom-launches?${query.toString()}`,
        {
          cache: "no-store",
          headers: await getAuthHeaders(),
          signal,
        },
      );
      const body = await response.json().catch(() => null);
      if (!response.ok) throw readApiError(response, body);
      const page = parseHistoryPage(body, account);
      if (!page) throw new Error("The API returned an invalid launch history.");
      if (requestSequence !== requestSequenceRef.current) return;
      setLaunches((current) => mergeLaunchResources(
        current,
        page.launches,
        cursor === null,
      ));
      setNextCursor(page.nextCursor);
      setState("ready");
      if (refreshRequest) setStatusMessage("Launch history refreshed.");
    } catch (cause) {
      const refreshTimedOut =
        signal?.aborted
        && signal.reason === launchHistoryRefreshTimeoutReason;
      if (
        cause instanceof DOMException
        && cause.name === "AbortError"
        && !refreshTimedOut
      ) return;
      if (requestSequence !== requestSequenceRef.current) return;
      setError(
        refreshTimedOut
          ? "Launch history refresh took too long. Try again."
          : cause instanceof Error
            ? cause.message
            : "Unable to load launch history.",
      );
      if (refreshTimedOut) {
        setStatusMessage("Launch history refresh timed out.");
      }
      if (cursor === null && !refreshRequest) setState("error");
    } finally {
      if (cursor !== null) loadMoreInFlightRef.current = false;
      if (requestSequence === requestSequenceRef.current) setLoadingMore(false);
      if (refreshRequest) setRefreshing(false);
    }
  }, [account, getAuthHeaders]);

  const readLaunchResource = useCallback(async (
    launch: Pick<LaunchResource, "requestId" | "routeId">,
    signal?: AbortSignal,
  ) => {
    const version = launch.routeId === "custom-launch:create:v3"
      ? "v3"
      : launch.routeId === "custom-launch:create:v2"
        ? "v2"
        : "v1";
    const response = await fetch(
      `/api/developer/custom-launches/${encodeURIComponent(launch.requestId)}?walletAddress=${encodeURIComponent(account)}&version=${version}`,
      {
        cache: "no-store",
        headers: await getAuthHeaders(),
        signal,
      },
    );
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      throw readApiError(
        response,
        body,
        "Unable to check launch status.",
      );
    }
    const updated = parseLaunch(body, account);
    if (
      !updated ||
      updated.requestId !== launch.requestId ||
      updated.routeId !== launch.routeId
    ) {
      throw new Error("The API returned an invalid launch status.");
    }
    return updated;
  }, [account, getAuthHeaders]);

  const updateLaunch = useCallback((updated: LaunchResource) => {
    setLaunches((current) => mergeLaunchResources(current, [updated], false));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const initialRead = window.setTimeout(() => {
      void load(null, controller.signal);
    }, 0);
    return () => {
      window.clearTimeout(initialRead);
      controller.abort();
    };
  }, [load]);

  useEffect(() => () => {
    refreshControllerRef.current?.abort();
    refreshControllerRef.current = null;
    for (const controller of pollControllersRef.current.values()) {
      controller.abort();
    }
    pollControllersRef.current.clear();
    pendingFundingRef.current.clear();
  }, []);

  useEffect(() => {
    if (fundingRetryDelayMs === null) return;
    const timeout = window.setTimeout(() => {
      setFundingRetryDelayMs(null);
      setStatusMessage("Funding authorization submission can be retried.");
    }, fundingRetryDelayMs);
    return () => window.clearTimeout(timeout);
  }, [fundingRetryDelayMs]);

  const refresh = () => {
    if (state === "loading" || loadingMore || refreshing) return;
    const controller = new AbortController();
    refreshControllerRef.current?.abort();
    refreshControllerRef.current = controller;
    const timeout = window.setTimeout(
      () => controller.abort(launchHistoryRefreshTimeoutReason),
      launchHistoryRefreshTimeoutMs,
    );
    setRefreshing(true);
    setError("");
    setStatusMessage("Refreshing launch history.");
    void load(null, controller.signal, true).finally(() => {
      window.clearTimeout(timeout);
      if (refreshControllerRef.current === controller) {
        refreshControllerRef.current = null;
      }
    });
  };

  const checkOnchainStatus = async (launch: LaunchResource) => {
    const key = launchResourceKey(launch);
    if (checkInFlightRef.current || pollingIds[key]) return;
    checkInFlightRef.current = true;
    setCheckingId(key);
    setError("");
    try {
      const updated = await readLaunchResource(launch);
      updateLaunch(updated);
      setStatusMessage("Launch status updated.");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to check launch status.",
      );
    } finally {
      checkInFlightRef.current = false;
      setCheckingId(null);
    }
  };

  const loadWalletReview = async (launch: LaunchResource) => {
    const key = launchResourceKey(launch);
    if (
      hydrateInFlightRef.current
      || launch.routeId !== "custom-launch:create:v3"
      || !["awaiting_funding_authorization", "authorized"]
        .includes(launch.status)
    ) return;
    hydrateInFlightRef.current = true;
    setHydratingId(key);
    setError("");
    setStatusMessage(
      launch.status === "awaiting_funding_authorization"
        ? "Loading the exact funding authorization for review."
        : "Loading the exact Router transaction for review.",
    );
    try {
      const current = await readLaunchResource(launch);
      if (
        current.routeId !== "custom-launch:create:v3"
        || current.status !== launch.status
      ) {
        updateLaunch(Object.freeze({ ...current, output: null }));
        setHydratedReviews((reviews) => {
          if (!reviews[key]) return reviews;
          const next = { ...reviews };
          delete next[key];
          return Object.freeze(next);
        });
        throw new Error(
          "This launch changed while its wallet review was loading. Review its current status.",
        );
      }
      if (current.status === "awaiting_funding_authorization") {
        if (!fundingAuthorizationReview(current)) {
          throw new Error(
            "The funding challenge failed its safety checks. Refresh the launch and try again.",
          );
        }
        setStatusMessage(
          "Funding review loaded. Check every field before the separate wallet signature.",
        );
      } else if (!routerTransactionReview(current)) {
        throw new Error(
          "The Router transaction failed its safety checks. Refresh the launch and try again.",
        );
      } else {
        setStatusMessage(
          "Router review loaded. Check every field before the separate wallet transaction.",
        );
      }
      updateLaunch(current);
      setHydratedReviews((reviews) => Object.freeze({
        ...reviews,
        [key]: current,
      }));
      setHydratedReviews((reviews) => Object.freeze({
        ...reviews,
        [key]: current,
      }));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to load the wallet review.",
      );
    } finally {
      hydrateInFlightRef.current = false;
      setHydratingId(null);
    }
  };

  const startStatusPolling = useCallback((launch: LaunchResource) => {
    const key = launchResourceKey(launch);
    pollControllersRef.current.get(key)?.abort();
    const controller = new AbortController();
    pollControllersRef.current.set(key, controller);
    setPollingIds((current) => Object.freeze({
      ...current,
      [key]: true as const,
    }));

    void (async () => {
      let waitMs = 0;
      while (!controller.signal.aborted) {
        if (waitMs > 0 && !await pollDelay(waitMs, controller.signal)) return;
        try {
          const updated = await readLaunchResource(launch, controller.signal);
          updateLaunch(updated);
          setError("");
          if (terminalStatus(updated.status)) {
            setStatusMessage(
              updated.status === "finalized"
                ? "Launch finalized onchain."
                : "Launch tracking reached a terminal state.",
            );
            return;
          }
          if (updated.status !== "authorized" && updated.status !== "submitted") {
            throw new Error("The launch returned an unexpected status after broadcast.");
          }
          setStatusMessage(
            updated.status === "submitted"
              ? "Transaction found. Waiting for finality."
              : "Transaction submitted. Waiting for the Router record.",
          );
          waitMs = updated.status === "submitted"
            ? submittedPollIntervalMs
            : authorizedPollIntervalMs;
        } catch (cause) {
          if (controller.signal.aborted) return;
          setError(
            cause instanceof Error
              ? cause.message
              : "Unable to track the submitted transaction.",
          );
          if (cause instanceof LaunchHistoryRequestError) {
            const retryAfterMs = launchPollingRetryAfterMs(
              cause.status,
              cause.retryAfterMs,
            );
            if (retryAfterMs !== null) {
              waitMs = retryAfterMs;
              continue;
            }
          }
          return;
        }
      }
    })().finally(() => {
      if (pollControllersRef.current.get(key) === controller) {
        pollControllersRef.current.delete(key);
        setPollingIds((current) => {
          const next = { ...current };
          delete next[key];
          return Object.freeze(next);
        });
      }
    });
  }, [readLaunchResource, updateLaunch]);

  const startV3PreparationPolling = useCallback((launch: LaunchResource) => {
    const key = launchResourceKey(launch);
    pollControllersRef.current.get(key)?.abort();
    const controller = new AbortController();
    pollControllersRef.current.set(key, controller);
    setPollingIds((current) => Object.freeze({
      ...current,
      [key]: true as const,
    }));
    void (async () => {
      let waitMs = 0;
      while (!controller.signal.aborted) {
        if (waitMs > 0 && !await pollDelay(waitMs, controller.signal)) return;
        try {
          const updated = await readLaunchResource(launch, controller.signal);
          updateLaunch(updated);
          setError("");
          if (updated.status === "authorized") {
            setStatusMessage(
              "The exact Router transaction is ready for separate wallet review.",
            );
            return;
          }
          if (updated.status === "action_required") {
            setStatusMessage(
              "Platform review is required before Router simulation. No wallet action is needed.",
            );
            return;
          }
          if (terminalStatus(updated.status)) {
            setStatusMessage("Launch preparation reached a terminal state.");
            return;
          }
          if (
            updated.routeId !== "custom-launch:create:v3"
            || ![
              "awaiting_funding_authorization",
              "funding_authorization_verified",
              "pending_review",
              "prepared",
              "simulating",
            ].includes(updated.status)
          ) {
            throw new Error("The V3 launch returned an unexpected preparation status.");
          }
          setStatusMessage(
            updated.status === "simulating"
              ? "The exact Router transaction is being simulated."
              : updated.status === "pending_review"
                ? "Admission checks are still running before Router simulation."
                : updated.status === "prepared"
                  ? "The exact Router transaction is prepared and waiting for simulation."
                  : updated.status === "awaiting_funding_authorization"
                    ? "Funding authorization acceptance is still being reconciled."
                    : "The funding authorization is verified. Preparing the Router transaction.",
          );
          waitMs = authorizedPollIntervalMs;
        } catch (cause) {
          if (controller.signal.aborted) return;
          setError(
            cause instanceof Error
              ? cause.message
              : "Unable to prepare the Router transaction.",
          );
          if (cause instanceof LaunchHistoryRequestError) {
            const retryAfterMs = launchPollingRetryAfterMs(
              cause.status,
              cause.retryAfterMs,
            );
            if (retryAfterMs !== null) {
              waitMs = retryAfterMs;
              continue;
            }
          }
          return;
        }
      }
    })().finally(() => {
      if (pollControllersRef.current.get(key) === controller) {
        pollControllersRef.current.delete(key);
        setPollingIds((current) => {
          const next = { ...current };
          delete next[key];
          return Object.freeze(next);
        });
      }
    });
  }, [readLaunchResource, updateLaunch]);

  const submitFundingAuthorization = async (launch: LaunchResource) => {
    if (
      fundingInFlightRef.current
      || fundingId !== null
      || fundingRetryDelayMs !== null
    ) return;
    const key = launchResourceKey(launch);
    fundingInFlightRef.current = true;
    setFundingId(key);
    setError("");
    try {
      const reviewedAuthorization = fundingAuthorizationReview(launch);
      if (!reviewedAuthorization) {
        throw new Error(
          "Load and review the exact funding authorization before opening the wallet.",
        );
      }
      const current = await readLaunchResource(launch);
      updateLaunch(current);
      if (
        current.routeId !== "custom-launch:create:v3"
        || current.status !== "awaiting_funding_authorization"
        || !current.fundingIntentHash
      ) {
        forgetPendingFunding(key);
        throw new Error(
          "This launch is no longer awaiting a funding signature. Review its current status.",
        );
      }
      const authorization = prepareCustomLaunchFundingAuthorizationV3(
        current.output,
        account,
        current.launchId,
        current.fundingIntentHash,
      );
      if (!sameFundingAuthorization(reviewedAuthorization, authorization)) {
        forgetPendingFunding(key);
        throw new Error(
          "The funding authorization changed after review. Review the refreshed fields; no wallet signature was requested.",
        );
      }
      let pending = pendingFundingRef.current.get(key);
      if (
        pending
        && (
          pending.authorization.fundingIntentHash
            !== authorization.fundingIntentHash
          || pending.authorization.typedDataDigest
            !== authorization.typedDataDigest
        )
      ) {
        forgetPendingFunding(key);
        pending = undefined;
      }
      if (!pending) {
        setStatusMessage(
          "Opening the wallet for step 1 of 2: USDC funding authorization.",
        );
        const signature = await signCustomLaunchFundingAuthorization(
          authorization,
        );
        pending = Object.freeze({
          authorization,
          body: createCustomLaunchFundingSubmissionV3(
            authorization,
            signature,
          ),
          idempotencyKey: crypto.randomUUID(),
        });
        rememberPendingFunding(key, pending);
      } else {
        setStatusMessage("Retrying the verified funding authorization submission.");
      }
      const headers = await getAuthHeaders();
      headers.set("Content-Type", "application/json");
      headers.set("Idempotency-Key", pending.idempotencyKey);
      const response = await fetch(
        `/api/developer/custom-launches/${
          encodeURIComponent(current.requestId)
        }/funding-authorization?walletAddress=${
          encodeURIComponent(account)
        }&version=v3`,
        {
          method: "POST",
          cache: "no-store",
          headers,
          body: JSON.stringify(pending.body),
        },
      );
      const body = await response.json().catch(() => null);
      if (!response.ok) throw readApiError(
        response,
        body,
        "Unable to submit the funding authorization.",
      );
      const updated = parseLaunch(body, account);
      if (
        !updated
        || updated.routeId !== "custom-launch:create:v3"
        || updated.requestId !== current.requestId
      ) throw new Error("The API returned an invalid V3 launch status.");
      forgetPendingFunding(key);
      setFundingRetryDelayMs(null);
      updateLaunch(updated);
      if (updated.status === "authorized") {
        setStatusMessage(
          "Funding verified. Step 2 of 2 is ready for separate Router review.",
        );
      } else if (terminalStatus(updated.status)) {
        setStatusMessage("Funding verification reached a terminal state.");
      } else {
        setStatusMessage(
          "Funding verified. Preparing and simulating the exact Router transaction.",
        );
        startV3PreparationPolling(updated);
      }
    } catch (cause) {
      if (
        cause instanceof LaunchHistoryRequestError
        && cause.retryAfterMs !== null
      ) {
        setFundingRetryDelayMs(cause.retryAfterMs);
      }
      if (
        cause instanceof LaunchHistoryRequestError
        && cause.status >= 400
        && cause.status < 500
        && cause.status !== 429
      ) forgetPendingFunding(key);
      setError(
        cause instanceof Error
          ? cause.message
          : "The funding authorization could not be submitted.",
      );
    } finally {
      fundingInFlightRef.current = false;
      setFundingId(null);
    }
  };

  const submitWalletTransaction = async (launch: LaunchResource) => {
    if (
      sendInFlightRef.current
      || submittingId !== null
    ) return;
    const key = launchResourceKey(launch);
    sendInFlightRef.current = true;
    setSubmittingId(key);
    setError("");
    try {
      const reviewedRouter = launch.routeId === "custom-launch:create:v3"
        ? routerTransactionReview(launch)
        : null;
      if (launch.routeId === "custom-launch:create:v3" && !reviewedRouter) {
        throw new Error(
          "Load and review the exact Router transaction before opening the wallet.",
        );
      }
      const current = await readLaunchResource(launch);
      updateLaunch(current);
      setHydratedReviews((reviews) => Object.freeze({
        ...reviews,
        [key]: current,
      }));
      if (current.status !== "authorized") {
        throw new Error(
          "This launch is no longer awaiting a wallet signature. Review its current status.",
        );
      }
      let action: CustomLaunchWalletActionV1;
      if (current.routeId === "custom-launch:create:v3") {
        const currentRouter = prepareCustomLaunchRouterReviewV3(
          current.output,
          account,
        );
        if (!reviewedRouter || !sameRouterReview(reviewedRouter, currentRouter)) {
          throw new Error(
            "The Router transaction changed after review. Review the refreshed fields; no transaction was requested from the wallet.",
          );
        }
        action = currentRouter.walletAction;
      } else {
        action = current.routeId === "custom-launch:create:v2"
          ? prepareCustomLaunchWalletActionV2(
              current.output,
              account,
              current.launchProfileHash!,
            )
          : prepareCustomLaunchWalletActionV1(current.output, account);
      }
      const transactionHash = await sendCustomLaunchWalletAction(action);
      if (!transactionHashPattern.test(transactionHash)) {
        throw new Error("The wallet returned an invalid transaction hash.");
      }
      setSubmittedHashes((currentHashes) => Object.freeze({
        ...currentHashes,
        [key]: transactionHash,
      }));
      setStatusMessage(
        "Transaction submitted from the wallet. Tracking its Router status.",
      );
      startStatusPolling(current);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The wallet transaction could not be submitted.",
      );
    } finally {
      sendInFlightRef.current = false;
      setSubmittingId(null);
    }
  };

  return (
    <section
      className={styles.history}
      aria-busy={
        state === "loading"
        || loadingMore
        || refreshing
        || hydratingId !== null
        || fundingId !== null
        || submittingId !== null
      }
      aria-labelledby="launch-history-title"
    >
      <p className={styles.visuallyHidden} role="status" aria-live="polite">
        {statusMessage}
      </p>
      <div className={styles.heading}>
        <div>
          <p className={styles.kicker}>Custom Launch API</p>
          <h2 id="launch-history-title">Launch history</h2>
        </div>
        <button
          className={styles.textButton}
          disabled={state === "loading" || loadingMore || refreshing}
          type="button"
          onClick={refresh}
        >
          <RefreshCw
            aria-hidden="true"
            className={styles.refreshIcon}
            data-spinning={state === "loading" || refreshing ? "true" : "false"}
            size={16}
            strokeWidth={1.9}
          />
          {state === "loading" || refreshing ? "Refreshing" : "Refresh history"}
        </button>
      </div>
      <p className={styles.intro}>
        Requests prepared for this wallet. A launch is onchain only after the
        wallet signs and broadcasts it. V3 funding authorization and Router
        submission remain two separate reviews.
      </p>

      {state === "loading" ? <HistorySkeleton /> : null}

      {state === "error" ? (
        <div className={styles.statePanel} role="alert">
          <h3>Launch history is unavailable</h3>
          <p>{error}</p>
          <button className={styles.secondaryButton} type="button" onClick={refresh}>
            Try again
          </button>
        </div>
      ) : null}

      {state === "ready" && launches.length === 0 ? (
        <div className={styles.statePanel}>
          <h3>No launch requests</h3>
          <p>Accepted API requests will appear here.</p>
        </div>
      ) : null}

      {state === "ready" && launches.length > 0 ? (
        <ul className={styles.launchList}>
          {launches.map((launch) => {
            const key = launchResourceKey(launch);
            const reviewLaunch = reviewResourceForLaunch(
              launch,
              hydratedReviews[key],
            );
            const fundingReview = fundingAuthorizationReview(reviewLaunch);
            const routerReview = routerTransactionReview(reviewLaunch);
            const transaction = reviewLaunch.routeId
              === "custom-launch:create:v3"
              ? routerReview?.walletAction ?? null
              : walletTransaction(reviewLaunch);
            const transactionHash = onchainTransactionHash(reviewLaunch)
              ?? submittedHashes[key]
              ?? null;
            return (
              <li className={styles.launchItem} key={key}>
                <div className={styles.launchTopline}>
                  <div>
                    <h3>Launch {shortId(launch.requestId)}</h3>
                  </div>
                  <span className={styles.status} data-status={launch.status}>
                    {statusCopy(launch.status)}
                  </span>
                </div>
                <p className={styles.statusDescription}>
                  {statusDescription(launch.status)}
                </p>
                <dl className={styles.metadata}>
                  <div>
                    <dt>Created</dt>
                    <dd>{formatDate(launch.createdAt)}</dd>
                  </div>
                  <div>
                    <dt>Updated</dt>
                    <dd>{formatDate(launch.updatedAt)}</dd>
                  </div>
                  {launch.onchainLaunchId ? (
                    <div>
                      <dt>Onchain launch ID</dt>
                      <dd>
                        <code title={launch.onchainLaunchId}>
                          {shortId(launch.onchainLaunchId)}
                        </code>
                      </dd>
                    </div>
                  ) : null}
                </dl>
                {launch.failure ? (
                  <p className={styles.failure} role="alert">
                    {launch.failure.message}
                  </p>
                ) : null}
                {launch.status === "action_required" ? (
                  <div className={styles.admissionNotice} role="status">
                    <strong>Platform review required</strong>
                    <p>
                      A deterministic indicator blocked Router simulation. This
                      is not a wallet action, audit, or safety verdict. Contact
                      support with request ID <code>{launch.requestId}</code>.
                      Never send your API key.
                    </p>
                    <a
                      href="https://discord.com/invite/programmable"
                      rel="noreferrer"
                      target="_blank"
                    >
                      Open Programmable support
                    </a>
                  </div>
                ) : null}
                {fundingReview ? (
                  <div className={styles.fundingReview}>
                    <div className={styles.stepHeading}>
                      <span>Step 1 of 2</span>
                      <strong>USDC funding authorization</strong>
                    </div>
                    <p>
                      This signature lets the predicted initializer receive
                      exactly the amount below. It does not send a transaction
                      and Programmable does not sign automatically.
                    </p>
                    <dl className={styles.reviewGrid}>
                      <div>
                        <dt>Amount</dt>
                        <dd>{formatUsdcAmount(fundingReview.value)}</dd>
                      </div>
                      <div>
                        <dt>Valid until</dt>
                        <dd>{fundingValidityCopy(fundingReview.validBefore)}</dd>
                      </div>
                      <div>
                        <dt>From</dt>
                        <dd><code>{fundingReview.from}</code></dd>
                      </div>
                      <div>
                        <dt>Recipient</dt>
                        <dd><code>{fundingReview.to}</code></dd>
                      </div>
                      <div>
                        <dt>Token</dt>
                        <dd><code>{fundingReview.token}</code></dd>
                      </div>
                      <div>
                        <dt>Authorization nonce</dt>
                        <dd><code>{fundingReview.nonce}</code></dd>
                      </div>
                    </dl>
                  </div>
                ) : null}
                {reviewLaunch.routeId === "custom-launch:create:v3"
                  && reviewLaunch.status === "awaiting_funding_authorization"
                  && reviewLaunch.output !== null
                  && !fundingReview ? (
                    <p className={styles.failure} role="alert">
                      The funding challenge failed its safety checks. Refresh
                      this launch before opening the wallet.
                    </p>
                  ) : null}
                {transaction ? (
                  <details className={styles.transaction}>
                    <summary>Prepared transaction</summary>
                    <p>
                      Review these fields before approving the separate wallet
                      request. Programmable never signs automatically.
                    </p>
                    <pre>{JSON.stringify(transaction, null, 2)}</pre>
                  </details>
                ) : null}
                {routerReview ? (
                  <div className={styles.routerReview}>
                    <div className={styles.stepHeading}>
                      <span>Step 2 of 2</span>
                      <strong>Router transaction</strong>
                    </div>
                    <p>
                      The funding signature is verified and embedded in this
                      exact CustomGraph route. Review the separate transaction
                      in your wallet before sending it.
                    </p>
                    <dl className={styles.reviewGrid}>
                      <div>
                        <dt>Network</dt>
                        <dd>Ethereum mainnet</dd>
                      </div>
                      <div>
                        <dt>Native value</dt>
                        <dd>{routerReview.walletAction.valueWei} wei</dd>
                      </div>
                      <div>
                        <dt>Router</dt>
                        <dd><code>{routerReview.walletAction.to}</code></dd>
                      </div>
                      <div>
                        <dt>Function selector</dt>
                        <dd><code>{routerReview.selector}</code></dd>
                      </div>
                      <div>
                        <dt>Graph commitment</dt>
                        <dd><code>{routerReview.graphCommitment}</code></dd>
                      </div>
                      <div>
                        <dt>Permit digest</dt>
                        <dd><code>{routerReview.permitDigest}</code></dd>
                      </div>
                      <div>
                        <dt>Initializer calldata hash</dt>
                        <dd><code>{routerReview.initializerCalldataHash}</code></dd>
                      </div>
                      <div>
                        <dt>Calldata size</dt>
                        <dd>{routerReview.calldataLengthBytes.toLocaleString("en")} bytes</dd>
                      </div>
                    </dl>
                  </div>
                ) : null}
                {reviewLaunch.routeId === "custom-launch:create:v3"
                  && reviewLaunch.status === "authorized"
                  && reviewLaunch.output !== null
                  && !routerReview ? (
                    <p className={styles.failure} role="alert">
                      The Router transaction failed its safety checks. Refresh
                      this launch before opening the wallet.
                    </p>
                  ) : null}
                {transactionHash ? (
                  <div className={styles.transactionHash}>
                    <span>Transaction hash</span>
                    <code>{transactionHash}</code>
                  </div>
                ) : null}
                {[
                  "awaiting_funding_authorization",
                  "funding_authorization_verified",
                  "simulating",
                  "authorized",
                  "submitted",
                ].includes(launch.status) ? (
                  <div className={styles.launchActions}>
                    {launch.status === "awaiting_funding_authorization"
                      && launch.routeId === "custom-launch:create:v3" ? (
                        fundingReview ? (
                          <button
                            className={styles.walletButton}
                            disabled={
                              fundingId !== null
                              || hydratingId !== null
                              || submittingId !== null
                              || checkingId !== null
                              || Boolean(pollingIds[key])
                              || fundingRetryDelayMs !== null
                            }
                            type="button"
                            onClick={() => void submitFundingAuthorization(
                              reviewLaunch,
                            )}
                          >
                            {fundingId === key
                              ? "Authorizing USDC funding"
                              : pendingFundingIds[key]
                                ? "Retry funding submission"
                                : "Review and sign USDC authorization"}
                          </button>
                        ) : (
                          <button
                            className={styles.walletButton}
                            disabled={
                              hydratingId !== null
                              || fundingId !== null
                              || submittingId !== null
                              || checkingId !== null
                              || Boolean(pollingIds[key])
                            }
                            type="button"
                            onClick={() => void loadWalletReview(launch)}
                          >
                            {hydratingId === key
                              ? "Loading funding review"
                              : reviewLaunch.output === null
                                ? "Load funding review"
                                : "Reload funding review"}
                          </button>
                        )
                      ) : null}
                    {launch.status === "authorized" ? (
                      launch.routeId !== "custom-launch:create:v3"
                        || routerReview ? (
                          <button
                            className={styles.walletButton}
                            disabled={
                              submittingId !== null
                              || hydratingId !== null
                              || Boolean(pollingIds[key])
                              || checkingId !== null
                              || fundingId !== null
                            }
                            type="button"
                            onClick={() => void submitWalletTransaction(
                              launch.routeId === "custom-launch:create:v3"
                                ? reviewLaunch
                                : launch,
                            )}
                          >
                            {submittingId === key
                              ? "Opening wallet review"
                              : launch.routeId === "custom-launch:create:v3"
                                ? "Review and sign in wallet"
                                : "Review and sign in wallet"}
                          </button>
                        ) : (
                          <button
                            className={styles.walletButton}
                            disabled={
                              hydratingId !== null
                              || submittingId !== null
                              || checkingId !== null
                              || fundingId !== null
                              || Boolean(pollingIds[key])
                            }
                            type="button"
                            onClick={() => void loadWalletReview(launch)}
                          >
                            {hydratingId === key
                              ? "Loading Router review"
                              : reviewLaunch.output === null
                                ? "Load Router review"
                                : "Reload Router review"}
                          </button>
                        )
                    ) : null}
                    <button
                      className={styles.checkButton}
                      disabled={
                        checkingId !== null
                          || submittingId !== null
                          || fundingId !== null
                          || hydratingId !== null
                          || Boolean(pollingIds[key])
                      }
                      type="button"
                      onClick={() => void checkOnchainStatus(launch)}
                    >
                      {pollingIds[key]
                        ? "Tracking transaction"
                        : checkingId === key
                          ? "Checking status"
                          : "Check onchain status"}
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {state === "ready" && nextCursor ? (
        <button
          className={styles.secondaryButton}
          disabled={loadingMore}
          type="button"
          onClick={() => void load(nextCursor)}
        >
          {loadingMore ? "Loading" : "Load more"}
        </button>
      ) : null}
      {state === "ready" && error ? (
        <p className={styles.inlineError} role="alert">{error}</p>
      ) : null}
    </section>
  );
}
