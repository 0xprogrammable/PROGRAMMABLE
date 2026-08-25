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
  sendCustomLaunchWalletAction: (
    input: CustomLaunchWalletActionV1,
  ) => Promise<`0x${string}`>;
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
const submittedPollIntervalMs = 12_000;
const authorizedPollIntervalMs = 4_000;
const transactionHashPattern = /^0x[0-9a-fA-F]{64}$/u;

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
    case "prepared": return "Prepared";
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
    case "prepared": return "The launch transaction has been prepared.";
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
}: DeveloperLaunchHistoryProps) {
  const [launches, setLaunches] = useState<LaunchResource[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [pollingIds, setPollingIds] = useState<
    Readonly<Record<string, true>>
  >({});
  const [submittedHashes, setSubmittedHashes] = useState<
    Readonly<Record<string, `0x${string}`>>
  >({});
  const [error, setError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const requestSequenceRef = useRef(0);
  const loadMoreInFlightRef = useRef(false);
  const checkInFlightRef = useRef(false);
  const sendInFlightRef = useRef(false);
  const pollControllersRef = useRef(new Map<string, AbortController>());

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
      if (refreshRequest) setStatusMessage("Launch history refreshed.");
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      if (requestSequence !== requestSequenceRef.current) return;
      setError(
        cause instanceof Error ? cause.message : "Unable to load launch history.",
      );
      if (cursor === null && !refreshRequest) setState("error");
    } finally {
      if (cursor !== null) loadMoreInFlightRef.current = false;
      if (requestSequence === requestSequenceRef.current) setLoadingMore(false);
      if (refreshRequest) setRefreshing(false);
    }
  }, [account, getAuthHeaders]);

  const readLaunchResource = useCallback(async (
    requestId: string,
    signal?: AbortSignal,
  ) => {
    const response = await fetch(
      `/api/developer/custom-launches/${encodeURIComponent(requestId)}?walletAddress=${encodeURIComponent(account)}`,
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
    if (!updated || updated.requestId !== requestId) {
      throw new Error("The API returned an invalid launch status.");
    }
    return updated;
  }, [account, getAuthHeaders]);

  const updateLaunch = useCallback((updated: LaunchResource) => {
    setLaunches((current) => current.map((candidate) =>
      candidate.requestId === updated.requestId ? updated : candidate
    ));
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
    for (const controller of pollControllersRef.current.values()) {
      controller.abort();
    }
    pollControllersRef.current.clear();
  }, []);

  const refresh = () => {
    if (state === "loading" || loadingMore || refreshing) return;
    setRefreshing(true);
    setError("");
    setStatusMessage("Refreshing launch history.");
    void load(null, undefined, true);
  };

  const checkOnchainStatus = async (launch: LaunchResource) => {
    if (checkInFlightRef.current || pollingIds[launch.requestId]) return;
    checkInFlightRef.current = true;
    setCheckingId(launch.requestId);
    setError("");
    try {
      const updated = await readLaunchResource(launch.requestId);
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

  const startStatusPolling = useCallback((requestId: string) => {
    pollControllersRef.current.get(requestId)?.abort();
    const controller = new AbortController();
    pollControllersRef.current.set(requestId, controller);
    setPollingIds((current) => Object.freeze({
      ...current,
      [requestId]: true as const,
    }));

    void (async () => {
      let waitMs = 0;
      while (!controller.signal.aborted) {
        if (waitMs > 0 && !await pollDelay(waitMs, controller.signal)) return;
        try {
          const updated = await readLaunchResource(requestId, controller.signal);
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
          if (
            cause instanceof LaunchHistoryRequestError
            && cause.status === 429
            && cause.retryAfterMs !== null
          ) {
            waitMs = cause.retryAfterMs;
            continue;
          }
          return;
        }
      }
    })().finally(() => {
      if (pollControllersRef.current.get(requestId) === controller) {
        pollControllersRef.current.delete(requestId);
        setPollingIds((current) => {
          const next = { ...current };
          delete next[requestId];
          return Object.freeze(next);
        });
      }
    });
  }, [readLaunchResource, updateLaunch]);

  const submitWalletTransaction = async (launch: LaunchResource) => {
    if (
      sendInFlightRef.current
      || submittingId !== null
    ) return;
    sendInFlightRef.current = true;
    setSubmittingId(launch.requestId);
    setError("");
    try {
      const current = await readLaunchResource(launch.requestId);
      updateLaunch(current);
      if (current.status !== "authorized") {
        throw new Error(
          "This launch is no longer awaiting a wallet signature. Review its current status.",
        );
      }
      const action = prepareCustomLaunchWalletActionV1(current.output, account);
      const transactionHash = await sendCustomLaunchWalletAction(action);
      if (!transactionHashPattern.test(transactionHash)) {
        throw new Error("The wallet returned an invalid transaction hash.");
      }
      setSubmittedHashes((currentHashes) => Object.freeze({
        ...currentHashes,
        [launch.requestId]: transactionHash,
      }));
      setStatusMessage(
        "Transaction submitted from the wallet. Tracking its Router status.",
      );
      startStatusPolling(launch.requestId);
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
      aria-busy={state === "loading" || loadingMore || refreshing}
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
            const transactionHash = onchainTransactionHash(launch)
              ?? submittedHashes[launch.requestId]
              ?? null;
            return (
              <li className={styles.launchItem} key={launch.launchId}>
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
                {transactionHash ? (
                  <div className={styles.transactionHash}>
                    <span>Transaction hash</span>
                    <code>{transactionHash}</code>
                  </div>
                ) : null}
                {launch.status === "authorized" || launch.status === "submitted" ? (
                  <div className={styles.launchActions}>
                    {launch.status === "authorized" ? (
                      <button
                        className={styles.walletButton}
                        disabled={
                          submittingId !== null
                          || Boolean(pollingIds[launch.requestId])
                          || checkingId !== null
                        }
                        type="button"
                        onClick={() => void submitWalletTransaction(launch)}
                      >
                        {submittingId === launch.requestId
                          ? "Opening wallet review"
                          : "Review and sign in wallet"}
                      </button>
                    ) : null}
                    <button
                      className={styles.checkButton}
                      disabled={
                        checkingId !== null
                        || submittingId !== null
                        || Boolean(pollingIds[launch.requestId])
                      }
                      type="button"
                      onClick={() => void checkOnchainStatus(launch)}
                    >
                      {pollingIds[launch.requestId]
                        ? "Tracking transaction"
                        : checkingId === launch.requestId
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
