"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import styles from "@/components/developer-launch-history.module.css";

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

type LaunchStatus =
  | "received"
  | "validating"
  | "prepared"
  | "authorized"
  | "submitted"
  | "finalized"
  | "failed"
  | "cancelled";

type LaunchResource = Readonly<{
  launchId: string;
  requestId: string;
  onchainLaunchId: `0x${string}` | null;
  ownerWallet: `0x${string}`;
  status: LaunchStatus;
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
}>;

const schemaVersion = "programmable.custom-launch-list.v1";
const pageSize = 5;
const statuses = new Set<LaunchStatus>([
  "received",
  "validating",
  "prepared",
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseLaunch(value: unknown, account: string): LaunchResource | null {
  if (
    !isRecord(value)
    || value.schemaVersion !== "programmable.custom-launch.v1"
    || typeof value.launchId !== "string"
    || typeof value.requestId !== "string"
    || value.requestId !== value.launchId
    || (value.onchainLaunchId !== null
      && typeof value.onchainLaunchId !== "string")
    || value.routeId !== "custom-launch:create:v1"
    || typeof value.ownerWallet !== "string"
    || value.ownerWallet.toLowerCase() !== account.toLowerCase()
    || typeof value.status !== "string"
    || !statuses.has(value.status as LaunchStatus)
    || typeof value.createdAt !== "string"
    || typeof value.updatedAt !== "string"
    || (value.output !== null && !isRecord(value.output))
  ) return null;
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
    launchId: value.launchId,
    requestId: value.requestId,
    onchainLaunchId: value.onchainLaunchId as `0x${string}` | null,
    ownerWallet: value.ownerWallet as `0x${string}`,
    status: value.status as LaunchStatus,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    output: value.output as Record<string, JsonValue> | null,
    failure,
  };
}

function parseHistoryPage(value: unknown, account: string): HistoryPage | null {
  if (
    !isRecord(value)
    || value.schemaVersion !== schemaVersion
    || !Array.isArray(value.launches)
    || value.launches.length > pageSize
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

function readApiError(value: unknown) {
  if (!isRecord(value) || !isRecord(value.error)) {
    return "Unable to load launch history.";
  }
  return typeof value.error.message === "string" && value.error.message.trim()
    ? value.error.message
    : "Unable to load launch history.";
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
    case "received": return "Request saved";
    case "validating": return "Checks in progress";
    case "prepared": return "Launch prepared";
    case "authorized": return "Ready for wallet confirmation";
    case "submitted": return "Submitted onchain";
    case "finalized": return "Finalized onchain";
    case "failed": return "Launch failed";
    case "cancelled": return "Cancelled";
  }
}

function walletTransaction(launch: LaunchResource) {
  const candidate = launch.output?.walletTransaction;
  return isRecord(candidate) ? candidate : null;
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
}: DeveloperLaunchHistoryProps) {
  const [launches, setLaunches] = useState<LaunchResource[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [loadingMore, setLoadingMore] = useState(false);
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const requestSequenceRef = useRef(0);
  const loadMoreInFlightRef = useRef(false);
  const checkInFlightRef = useRef(false);

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
      if (!response.ok) throw new Error(readApiError(body));
      const page = parseHistoryPage(body, account);
      if (!page) throw new Error("The API returned an invalid launch history.");
      if (requestSequence !== requestSequenceRef.current) return;
      setLaunches((current) => cursor === null
        ? page.launches
        : [
            ...current,
            ...page.launches.filter((launch) =>
              !current.some((existing) => existing.launchId === launch.launchId)
            ),
          ]);
      setNextCursor(page.nextCursor);
      setState("ready");
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      if (requestSequence !== requestSequenceRef.current) return;
      setError(
        cause instanceof Error ? cause.message : "Unable to load launch history.",
      );
      if (cursor === null) setState("error");
    } finally {
      if (cursor !== null) loadMoreInFlightRef.current = false;
      if (requestSequence === requestSequenceRef.current) setLoadingMore(false);
    }
  }, [account, getAuthHeaders]);

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

  const refresh = () => {
    setState("loading");
    setNextCursor(null);
    void load(null);
  };

  const checkOnchainStatus = async (launch: LaunchResource) => {
    if (checkInFlightRef.current) return;
    checkInFlightRef.current = true;
    setCheckingId(launch.requestId);
    setError("");
    try {
      const response = await fetch(
        `/api/developer/custom-launches/${encodeURIComponent(launch.requestId)}?walletAddress=${encodeURIComponent(account)}`,
        {
          cache: "no-store",
          headers: await getAuthHeaders(),
        },
      );
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(readApiError(body));
      const updated = parseLaunch(body, account);
      if (!updated || updated.requestId !== launch.requestId) {
        throw new Error("The API returned an invalid launch status.");
      }
      setLaunches((current) => current.map((candidate) =>
        candidate.requestId === updated.requestId ? updated : candidate
      ));
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

  return (
    <section
      className={styles.history}
      aria-busy={state === "loading" || loadingMore}
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
          disabled={state === "loading" || loadingMore}
          type="button"
          onClick={refresh}
        >
          Refresh
        </button>
      </div>
      <p className={styles.intro}>
        Requests prepared for this wallet. A launch is onchain only after the
        wallet signs and broadcasts it.
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
            const transaction = walletTransaction(launch);
            return (
              <li className={styles.launchItem} key={launch.launchId}>
                <div className={styles.launchTopline}>
                  <div>
                    <h3>Request {shortId(launch.requestId)}</h3>
                  </div>
                  <span className={styles.status} data-status={launch.status}>
                    {statusCopy(launch.status)}
                  </span>
                </div>
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
                {transaction ? (
                  <details className={styles.transaction}>
                    <summary>Prepared transaction</summary>
                    <p>Review these fields before signing in your wallet.</p>
                    <pre>{JSON.stringify(transaction, null, 2)}</pre>
                  </details>
                ) : null}
                {launch.status === "authorized" || launch.status === "submitted" ? (
                  <button
                    className={styles.checkButton}
                    disabled={checkingId !== null}
                    type="button"
                    onClick={() => void checkOnchainStatus(launch)}
                  >
                    {checkingId === launch.requestId
                      ? "Checking status"
                      : "Check onchain status"}
                  </button>
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
