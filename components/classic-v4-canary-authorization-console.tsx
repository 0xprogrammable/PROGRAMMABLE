"use client";

import {
  useRef,
  useState,
  type FormEvent,
} from "react";

import { useWallet } from "@/components/wallet-provider";
import styles from "@/components/classic-v4-canary-authorization-console.module.css";

const COMMAND_SCHEMA =
  "programmable.classic-v4.canary-authorization-command.v1";
const DOWNLOAD_SCHEMA =
  "programmable.classic-v4.canary-authorization-download.v1";
const AUTHORIZATION_SCHEMA =
  "programmable.classic-launch-authorization.v1";

type ConsoleStatus = Readonly<{
  kind: "idle" | "success" | "error";
  message: string;
}>;

type Props = Readonly<{
  authorizationRequestDigest: `0x${string}`;
  launchWallet: `0x${string}`;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isMainnetChain(chainId: string) {
  const normalized = chainId.toLowerCase();
  return normalized === "1"
    || normalized === "0x1"
    || normalized === "eip155:1";
}

function shortenedAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

async function readResponseBody(response: Response) {
  return response.json().catch(() => null) as Promise<unknown>;
}

function responseError(response: Response, body: unknown) {
  if (!isRecord(body) || !isRecord(body.error)) {
    return "Authorization could not be downloaded. Try again.";
  }
  const message = typeof body.error.message === "string"
    ? body.error.message
    : "Authorization could not be downloaded. Try again.";
  const requestId = typeof body.error.requestId === "string"
    ? body.error.requestId
    : null;
  const retryAfter = response.headers.get("retry-after");
  return `${message}${retryAfter ? ` Try again in ${retryAfter} seconds.` : ""}${
    requestId ? ` Request ID: ${requestId}.` : ""
  }`;
}

function requireAuthorizationDownload(
  value: unknown,
  expectedDigest: string,
  expectedWallet: string,
) {
  if (
    !isRecord(value)
    || value.schemaVersion !== DOWNLOAD_SCHEMA
    || typeof value.authorizationRequestDigest !== "string"
    || value.authorizationRequestDigest.toLowerCase()
      !== expectedDigest.toLowerCase()
    || !isRecord(value.authorization)
    || value.authorization.schemaVersion !== AUTHORIZATION_SCHEMA
    || value.authorization.chainId !== "1"
    || !isRecord(value.authorization.transaction)
    || typeof value.authorization.transaction.from !== "string"
    || value.authorization.transaction.from.toLowerCase()
      !== expectedWallet.toLowerCase()
  ) {
    throw new Error(
      "The authorization response did not match the installed request.",
    );
  }
  return value.authorization;
}

function downloadAuthorization(
  authorization: Readonly<Record<string, unknown>>,
  digest: string,
) {
  const bytes = `${JSON.stringify(authorization, null, 2)}\n`;
  const objectUrl = URL.createObjectURL(new Blob([bytes], {
    type: "application/json",
  }));
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = `classic-v4-launch-authorization-${digest.slice(2, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  queueMicrotask(() => URL.revokeObjectURL(objectUrl));
}

export function ClassicV4CanaryAuthorizationConsole({
  authorizationRequestDigest,
  launchWallet,
}: Props) {
  const {
    authReady,
    connecting,
    getAccessToken,
    getIdentityToken,
    openWallet,
    preloadWallet,
    switchNetwork,
    switchingNetwork,
    wallet,
  } = useWallet();
  const [acknowledged, setAcknowledged] = useState(false);
  const [acknowledgementError, setAcknowledgementError] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<ConsoleStatus>({
    kind: "idle",
    message: "",
  });
  const acknowledgementRef = useRef<HTMLInputElement>(null);

  const accountMatches = wallet?.account.toLowerCase()
    === launchWallet.toLowerCase();
  const networkMatches = wallet ? isMainnetChain(wallet.chainId) : false;

  const requestAuthorization = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    if (!acknowledged) {
      setAcknowledgementError(
        "Confirm that you verified the installed request digest.",
      );
      queueMicrotask(() => acknowledgementRef.current?.focus());
      return;
    }
    if (!wallet || !accountMatches || !networkMatches) {
      setStatus({
        kind: "error",
        message: "Reconnect the installed launch wallet on Ethereum and try again.",
      });
      return;
    }

    setBusy(true);
    setAcknowledgementError("");
    setStatus({ kind: "idle", message: "Requesting authorization…" });
    try {
      const identityToken = await getIdentityToken().catch(() => null);
      const accessToken = await getAccessToken();
      if (!accessToken) {
        throw new Error(
          "Your wallet session expired. Reconnect the launch wallet and try again.",
        );
      }
      const headers = new Headers({
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      });
      if (identityToken) {
        headers.set("X-Privy-Identity-Token", identityToken);
      }
      const response = await fetch(
        "/api/ops/classic-v4-canary/authorization",
        {
          method: "POST",
          cache: "no-store",
          credentials: "same-origin",
          headers,
          body: JSON.stringify({
            schemaVersion: COMMAND_SCHEMA,
            authorizationRequestDigest,
          }),
        },
      );
      const body = await readResponseBody(response);
      if (!response.ok) throw new Error(responseError(response, body));
      const authorization = requireAuthorizationDownload(
        body,
        authorizationRequestDigest,
        launchWallet,
      );
      downloadAuthorization(authorization, authorizationRequestDigest);
      setStatus({
        kind: "success",
        message:
          "Authorization downloaded. Use it only within its embedded window of no more than 330 seconds.",
      });
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error
          ? error.message
          : "Authorization could not be downloaded. Try again.",
      });
    } finally {
      setBusy(false);
    }
  };

  const switchToMainnet = async () => {
    setStatus({ kind: "idle", message: "Switching to Ethereum…" });
    const switched = await switchNetwork("1");
    setStatus(switched
      ? { kind: "idle", message: "Ethereum selected." }
      : {
          kind: "error",
          message: "Ethereum could not be selected. Change the network in your wallet.",
        });
  };

  return (
    <section className={styles.page} aria-labelledby="canary-authorization-title">
      <header className={styles.header}>
        <p className={styles.eyebrow}>Classic V4 / canary</p>
        <h1 id="canary-authorization-title">
          Issue the exact launch authorization
        </h1>
        <p className={styles.intro}>
          The launch request is installed on the server. This page sends only
          your digest acknowledgement and authenticated wallet session.
        </p>
      </header>

      <div className={styles.layout}>
        <aside className={styles.binding} aria-labelledby="binding-title">
          <div className={styles.bindingHeading}>
            <span aria-hidden="true" />
            <h2 id="binding-title">Authorization binding</h2>
          </div>
          <ol className={styles.bindingSteps}>
            <li>
              <span>01</span>
              <div>
                <strong>Server request</strong>
                <p>Canonical request bytes are not accepted from the browser.</p>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <strong>Privy session</strong>
                <p>The linked wallet must equal the installed launch wallet.</p>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <strong>Bound download</strong>
                <p>The signed Router authorization keeps its short time window.</p>
              </div>
            </li>
          </ol>
        </aside>

        <div className={styles.console}>
          <div className={styles.factRow}>
            <span>Network</span>
            <strong>Ethereum mainnet</strong>
          </div>
          <div className={styles.factRow}>
            <span>Launch wallet</span>
            <code title={launchWallet}>{launchWallet}</code>
          </div>
          <div className={styles.digestBlock}>
            <span>Installed request digest</span>
            <code>{authorizationRequestDigest}</code>
          </div>

          <div className={styles.walletBoundary}>
            {!authReady ? (
              <div className={styles.sessionPending} aria-label="Checking wallet session">
                <span />
                <span />
                <p>Checking wallet session…</p>
              </div>
            ) : !wallet ? (
              <div className={styles.actionState}>
                <p>Connect the wallet bound to this request.</p>
                <button
                  type="button"
                  onClick={openWallet}
                  onPointerEnter={preloadWallet}
                  onFocus={preloadWallet}
                  disabled={connecting}
                >
                  {connecting ? "Connecting wallet…" : "Connect launch wallet"}
                </button>
              </div>
            ) : !accountMatches ? (
              <div className={styles.actionState}>
                <p>
                  Connected as {shortenedAddress(wallet.account)}. Open wallet
                  settings and select the installed launch wallet.
                </p>
                <button type="button" onClick={openWallet}>
                  Open wallet settings
                </button>
              </div>
            ) : !networkMatches ? (
              <div className={styles.actionState}>
                <p>The installed request is bound to Ethereum mainnet.</p>
                <button
                  type="button"
                  onClick={() => void switchToMainnet()}
                  disabled={switchingNetwork}
                >
                  {switchingNetwork ? "Switching network…" : "Switch to Ethereum"}
                </button>
              </div>
            ) : (
              <form className={styles.form} onSubmit={requestAuthorization}>
                <div className={styles.sessionMatch}>
                  <span aria-hidden="true" />
                  <p>
                    {shortenedAddress(wallet.account)} matches on Ethereum
                  </p>
                </div>
                <label className={styles.acknowledgement}>
                  <input
                    ref={acknowledgementRef}
                    type="checkbox"
                    checked={acknowledged}
                    aria-invalid={acknowledgementError ? "true" : undefined}
                    aria-describedby={acknowledgementError
                      ? "canary-acknowledgement-error"
                      : undefined}
                    onChange={(event) => {
                      setAcknowledged(event.target.checked);
                      if (event.target.checked) setAcknowledgementError("");
                    }}
                  />
                  <span>
                    I verified this digest against the fresh canary request.
                  </span>
                </label>
                <p
                  className={styles.fieldError}
                  id="canary-acknowledgement-error"
                >
                  {acknowledgementError}
                </p>
                <button className={styles.primaryAction} type="submit" disabled={busy}>
                  {busy ? "Requesting authorization…" : "Download signed authorization"}
                </button>
              </form>
            )}
          </div>

          <p
            className={`${styles.status} ${
              status.kind === "success"
                ? styles.statusSuccess
                : status.kind === "error"
                  ? styles.statusError
                  : ""
            }`}
            role="status"
            aria-live="polite"
          >
            {status.message}
          </p>
        </div>
      </div>
    </section>
  );
}
