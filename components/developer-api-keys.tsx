"use client";

import Image from "next/image";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";

import styles from "@/components/developer-api-keys.module.css";
import { useWallet } from "@/components/wallet-provider";

type ApiKeySummary = Readonly<{
  id: string;
  label: string;
  keyPrefix: string;
  scopes: readonly string[];
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}>;

type CreatedApiKey = Readonly<{
  apiKey: ApiKeySummary;
  apiKeySecret: string;
}>;

type ListState = "idle" | "loading" | "ready" | "error";
type CreateState = "idle" | "creating";
type DeveloperApiKeysViewProps = Readonly<{
  account: `0x${string}` | null;
  authReady: boolean;
  connecting: boolean;
  getAccessToken: () => Promise<string | null>;
  getIdentityToken: () => Promise<string | null>;
  openWallet: () => void;
}>;

const expiryOptions = [
  { value: 30, label: "30 days" },
  { value: 90, label: "90 days" },
  { value: 180, label: "180 days" },
  { value: 366, label: "366 days" },
] as const;

const fixedScopes = ["custom-launch:create", "custom-launch:read"] as const;
const schemaVersion = "programmable.custom-launch-api.v1";

const dateFormatter = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nullableString(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === "string" ? value : undefined;
}

function parseApiKeySummary(value: unknown): ApiKeySummary | null {
  if (!isRecord(value)) return null;

  const lastUsedAt = nullableString(value.lastUsedAt);
  const revokedAt = nullableString(value.revokedAt);
  if (
    typeof value.id !== "string" ||
    typeof value.label !== "string" ||
    typeof value.keyPrefix !== "string" ||
    !Array.isArray(value.scopes) ||
    !value.scopes.every((scope) => typeof scope === "string") ||
    typeof value.createdAt !== "string" ||
    typeof value.expiresAt !== "string" ||
    lastUsedAt === undefined ||
    revokedAt === undefined
  ) {
    return null;
  }

  return {
    id: value.id,
    label: value.label,
    keyPrefix: value.keyPrefix,
    scopes: value.scopes,
    createdAt: value.createdAt,
    expiresAt: value.expiresAt,
    lastUsedAt,
    revokedAt,
  };
}

function parseApiKeyList(value: unknown): ApiKeySummary[] | null {
  if (
    !isRecord(value) ||
    value.schemaVersion !== schemaVersion ||
    !Array.isArray(value.apiKeys)
  ) {
    return null;
  }
  const apiKeys: ApiKeySummary[] = [];
  for (const candidate of value.apiKeys) {
    const parsed = parseApiKeySummary(candidate);
    if (!parsed) return null;
    apiKeys.push(parsed);
  }
  return apiKeys;
}

function parseCreatedApiKey(value: unknown): CreatedApiKey | null {
  if (
    !isRecord(value) ||
    value.schemaVersion !== schemaVersion ||
    typeof value.apiKeySecret !== "string"
  ) {
    return null;
  }
  const apiKey = parseApiKeySummary(value.apiKey);
  if (!apiKey || value.apiKeySecret.length === 0) return null;
  return { apiKey, apiKeySecret: value.apiKeySecret };
}

function readApiError(value: unknown, fallback: string) {
  if (!isRecord(value) || !isRecord(value.error)) return fallback;
  return typeof value.error.message === "string" && value.error.message.trim()
    ? value.error.message
    : fallback;
}

async function readJson(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

function formatDate(value: string | null, fallback: string) {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : dateFormatter.format(date);
}

function shortenAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function keyStatus(key: ApiKeySummary) {
  if (key.revokedAt) return "Revoked";
  if (key.expiresAt && new Date(key.expiresAt).getTime() <= Date.now()) {
    return "Expired";
  }
  return "Active";
}

function displayPrefix(prefix: string) {
  return prefix.endsWith("…") || prefix.endsWith("...") ? prefix : `${prefix}…`;
}

async function copyToClipboard(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const field = document.createElement("textarea");
  field.value = value;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.appendChild(field);
  field.select();
  const copied = document.execCommand("copy");
  field.remove();
  if (!copied) throw new Error("Clipboard access is unavailable");
}

function KeyListSkeleton() {
  return (
    <div className={styles.skeletonList} aria-hidden="true">
      {[0, 1].map((index) => (
        <div className={styles.skeletonRow} key={index}>
          <span className={styles.skeletonTitle} />
          <span className={styles.skeletonLine} />
          <span className={styles.skeletonLineShort} />
        </div>
      ))}
    </div>
  );
}

export function DeveloperApiKeys() {
  const {
    authReady,
    connecting,
    getAccessToken,
    getIdentityToken,
    openWallet,
    wallet,
  } = useWallet();
  const account = wallet?.account ?? null;
  const viewKey = authReady ? (account ?? "disconnected") : "loading";

  return (
    <DeveloperApiKeysView
      key={viewKey}
      account={account}
      authReady={authReady}
      connecting={connecting}
      getAccessToken={getAccessToken}
      getIdentityToken={getIdentityToken}
      openWallet={openWallet}
    />
  );
}

function DeveloperApiKeysView({
  account,
  authReady,
  connecting,
  getAccessToken,
  getIdentityToken,
  openWallet,
}: DeveloperApiKeysViewProps) {
  const [apiKeys, setApiKeys] = useState<ApiKeySummary[]>([]);
  const [listState, setListState] = useState<ListState>(() =>
    account ? "loading" : "idle",
  );
  const [listError, setListError] = useState("");
  const [label, setLabel] = useState("");
  const [expiresInDays, setExpiresInDays] = useState(90);
  const [labelError, setLabelError] = useState("");
  const [createState, setCreateState] = useState<CreateState>("idle");
  const [createError, setCreateError] = useState("");
  const [createdApiKey, setCreatedApiKey] = useState<CreatedApiKey | null>(
    null,
  );
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">(
    "idle",
  );
  const [confirmingRevokeId, setConfirmingRevokeId] = useState<string | null>(
    null,
  );
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const labelRef = useRef<HTMLInputElement>(null);
  const revealRef = useRef<HTMLDivElement>(null);
  const createButtonRef = useRef<HTMLButtonElement>(null);
  const revokeTriggerRef = useRef<HTMLButtonElement | null>(null);
  const confirmRevokeRef = useRef<HTMLButtonElement>(null);

  const getAuthHeaders = useCallback(
    async (json = false) => {
      const [accessToken, identityToken] = await Promise.all([
        getAccessToken(),
        getIdentityToken().catch(() => null),
      ]);
      if (!accessToken) {
        throw new Error(
          "Your wallet session expired. Reconnect your wallet and try again.",
        );
      }

      const headers = new Headers({
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      });
      if (identityToken) {
        headers.set("X-Privy-Identity-Token", identityToken);
      }
      if (json) headers.set("Content-Type", "application/json");
      return headers;
    },
    [getAccessToken, getIdentityToken],
  );

  const loadApiKeys = useCallback(
    async (walletAddress: string, signal?: AbortSignal) => {
      try {
        const headers = await getAuthHeaders();
        const response = await fetch(
          `/api/developer/api-keys?walletAddress=${encodeURIComponent(walletAddress)}`,
          {
            cache: "no-store",
            headers,
            signal,
          },
        );
        const body = await readJson(response);
        if (!response.ok) {
          throw new Error(readApiError(body, "Unable to load API keys."));
        }
        const parsed = parseApiKeyList(body);
        if (!parsed) throw new Error("The API returned an invalid key list.");
        setApiKeys(parsed);
        setListState("ready");
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError")
          return;
        setListError(
          error instanceof Error ? error.message : "Unable to load API keys.",
        );
        setListState("error");
      }
    },
    [getAuthHeaders],
  );

  const refreshApiKeys = () => {
    if (!account) return;
    setListState("loading");
    setListError("");
    void loadApiKeys(account);
  };

  useEffect(() => {
    if (!authReady || !account) return;

    const controller = new AbortController();
    const initialRead = window.setTimeout(() => {
      void loadApiKeys(account, controller.signal);
    }, 0);
    return () => {
      window.clearTimeout(initialRead);
      controller.abort();
    };
  }, [account, authReady, loadApiKeys]);

  useEffect(() => {
    if (createdApiKey) revealRef.current?.focus();
  }, [createdApiKey]);

  useEffect(() => {
    if (confirmingRevokeId) confirmRevokeRef.current?.focus();
  }, [confirmingRevokeId]);

  const activeCount = useMemo(
    () => apiKeys.filter((apiKey) => keyStatus(apiKey) === "Active").length,
    [apiKeys],
  );

  const createApiKey = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!account || createState === "creating") return;

    const cleanLabel = label.trim();
    if (!cleanLabel) {
      setLabelError("Enter a name that identifies this agent or workflow.");
      labelRef.current?.focus();
      return;
    }
    if (cleanLabel.length > 64) {
      setLabelError("Use 64 characters or fewer.");
      labelRef.current?.focus();
      return;
    }

    setLabelError("");
    setCreateError("");
    setCopyState("idle");
    setCreateState("creating");
    try {
      const headers = await getAuthHeaders(true);
      const response = await fetch("/api/developer/api-keys", {
        body: JSON.stringify({
          expiresInDays,
          label: cleanLabel,
          schemaVersion,
          walletAddress: account,
        }),
        headers,
        method: "POST",
      });
      const body = await readJson(response);
      if (!response.ok) {
        throw new Error(readApiError(body, "Unable to create the API key."));
      }
      const parsed = parseCreatedApiKey(body);
      if (!parsed) throw new Error("The API returned an invalid new key.");

      setApiKeys((current) => [
        parsed.apiKey,
        ...current.filter((apiKey) => apiKey.id !== parsed.apiKey.id),
      ]);
      setListState("ready");
      setCreatedApiKey(parsed);
      setLabel("");
      setStatusMessage(
        `${parsed.apiKey.label} was created. Save the secret now because it will not be shown again.`,
      );
    } catch (error) {
      setCreateError(
        error instanceof Error
          ? error.message
          : "Unable to create the API key.",
      );
    } finally {
      setCreateState("idle");
    }
  };

  const copyApiKey = async () => {
    if (!createdApiKey) return;
    try {
      await copyToClipboard(createdApiKey.apiKeySecret);
      setCopyState("copied");
      setStatusMessage("API key copied.");
    } catch {
      setCopyState("error");
      setStatusMessage("Copy failed. Select the key and copy it manually.");
    }
  };

  const dismissApiKey = () => {
    setCreatedApiKey(null);
    setCopyState("idle");
    setStatusMessage("The one time key display was cleared.");
    window.setTimeout(() => createButtonRef.current?.focus(), 0);
  };

  const beginRevoke = (apiKeyId: string, trigger: HTMLButtonElement) => {
    revokeTriggerRef.current = trigger;
    setRevokeError("");
    setConfirmingRevokeId(apiKeyId);
  };

  const cancelRevoke = () => {
    setConfirmingRevokeId(null);
    setRevokeError("");
    window.setTimeout(() => revokeTriggerRef.current?.focus(), 0);
  };

  const revokeApiKey = async (apiKey: ApiKeySummary) => {
    if (!account || revokingId) return;
    setRevokeError("");
    setRevokingId(apiKey.id);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(
        `/api/developer/api-keys/${encodeURIComponent(apiKey.id)}?walletAddress=${encodeURIComponent(account)}`,
        { headers, method: "DELETE" },
      );
      const body = await readJson(response);
      if (!response.ok) {
        throw new Error(readApiError(body, "Unable to revoke the API key."));
      }
      if (
        !isRecord(body) ||
        body.schemaVersion !== schemaVersion ||
        body.revoked !== true ||
        body.credentialId !== apiKey.id
      ) {
        throw new Error("The API returned an invalid revoke result.");
      }

      setApiKeys((current) =>
        current.map((candidate) =>
          candidate.id === apiKey.id
            ? { ...candidate, revokedAt: new Date().toISOString() }
            : candidate,
        ),
      );
      setConfirmingRevokeId(null);
      setStatusMessage(`${apiKey.label} was revoked.`);
      window.setTimeout(() => revokeTriggerRef.current?.focus(), 0);
    } catch (error) {
      setRevokeError(
        error instanceof Error
          ? error.message
          : "Unable to revoke the API key.",
      );
    } finally {
      setRevokingId(null);
    }
  };

  return (
    <div className={`${styles.page} page-width`}>
      <p
        className={styles.visuallyHidden}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {statusMessage}
      </p>

      <header className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className={styles.kicker}>Developer access</p>
          <h1>Give your agent a launch key</h1>
          <p className={styles.intro}>
            Create a scoped API key for custom launches. Your agent can submit
            and read launch preparations, while your wallet keeps control of the
            final transaction.
          </p>
        </div>

        <ol className={styles.launchPath} aria-label="Custom launch path">
          <li>
            <span>1</span>
            <strong>Connect wallet</strong>
          </li>
          <li>
            <span>2</span>
            <strong>Give the key to your agent</strong>
          </li>
          <li>
            <span>3</span>
            <strong>Review the prepared launch</strong>
          </li>
          <li>
            <span>4</span>
            <strong>Confirm in your wallet</strong>
          </li>
        </ol>
      </header>

      {!authReady ? (
        <section className={styles.walletGate} aria-busy="true">
          <span className={styles.walletGateMark} aria-hidden="true" />
          <span className={styles.walletGateTitle} aria-hidden="true" />
          <span className={styles.walletGateLine} aria-hidden="true" />
          <span className={styles.visuallyHidden}>Loading wallet session</span>
        </section>
      ) : !account ? (
        <section className={styles.walletGate} aria-labelledby="connect-title">
          <Image
            className={styles.loopMark}
            src="/brand/loop/programmable-loop-mark-header-warm-ivory-v1-1536.png"
            alt=""
            width={1168}
            height={1536}
            sizes="64px"
          />
          <h2 id="connect-title">Connect the wallet that owns your keys</h2>
          <p>
            Your wallet session controls key creation and revocation. No wallet
            signature is requested just to manage keys.
          </p>
          <button
            className={styles.primaryButton}
            disabled={connecting}
            type="button"
            onClick={openWallet}
          >
            {connecting ? "Opening wallet" : "Connect wallet"}
          </button>
        </section>
      ) : (
        <>
          <div className={styles.accountBar}>
            <div>
              <span className={styles.accountLabel}>Key owner</span>
              <code title={account}>{shortenAddress(account)}</code>
            </div>
            <p>
              {activeCount} active {activeCount === 1 ? "key" : "keys"}
            </p>
          </div>

          {createdApiKey ? (
            <div
              ref={revealRef}
              className={styles.keyReveal}
              tabIndex={-1}
              aria-labelledby="new-api-key-title"
            >
              <div className={styles.revealHeading}>
                <div>
                  <p className={styles.kicker}>Created</p>
                  <h2 id="new-api-key-title">Save this key now</h2>
                </div>
                <span className={styles.oneTimeBadge}>Shown once</span>
              </div>
              <p className={styles.revealWarning}>
                This secret will not be available again. Store it in your
                agent&apos;s secret manager. Do not commit it or paste it into a
                public chat.
              </p>
              <div className={styles.secretRow}>
                <code>{createdApiKey.apiKeySecret}</code>
                <button
                  className={styles.secondaryButton}
                  type="button"
                  onClick={() => void copyApiKey()}
                >
                  {copyState === "copied" ? "Copied" : "Copy key"}
                </button>
              </div>
              {copyState === "error" ? (
                <p className={styles.inlineError} role="alert">
                  Copy failed. Select the key and copy it manually.
                </p>
              ) : null}
              <button
                className={styles.dismissButton}
                type="button"
                onClick={dismissApiKey}
              >
                I saved this key
              </button>
            </div>
          ) : null}

          <div className={styles.workspace}>
            <section
              className={`${styles.panel} ${styles.createPanel}`}
              aria-labelledby="create-key-title"
            >
              <div className={styles.panelHeading}>
                <div>
                  <p className={styles.kicker}>New credential</p>
                  <h2 id="create-key-title">Create an API key</h2>
                </div>
              </div>

              <form className={styles.createForm} onSubmit={createApiKey}>
                <label className={styles.field} htmlFor="api-key-label">
                  <span>Key name</span>
                  <input
                    ref={labelRef}
                    id="api-key-label"
                    aria-describedby={
                      labelError ? "api-key-label-error" : "api-key-label-help"
                    }
                    aria-invalid={Boolean(labelError)}
                    autoComplete="off"
                    maxLength={64}
                    name="label"
                    placeholder="Launch agent"
                    spellCheck={false}
                    type="text"
                    value={label}
                    onChange={(event) => {
                      setLabel(event.target.value);
                      if (labelError) setLabelError("");
                    }}
                  />
                </label>
                <p
                  className={labelError ? styles.inlineError : styles.fieldHelp}
                  id={labelError ? "api-key-label-error" : "api-key-label-help"}
                >
                  {labelError || "Use a name you will recognize later."}
                </p>

                <label className={styles.field} htmlFor="api-key-expiry">
                  <span>Expires after</span>
                  <select
                    id="api-key-expiry"
                    name="expiresInDays"
                    value={expiresInDays}
                    onChange={(event) =>
                      setExpiresInDays(Number(event.target.value))
                    }
                  >
                    {expiryOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <p className={styles.fieldHelp}>
                  You can revoke the key immediately at any time.
                </p>

                <div className={styles.scopeLedger}>
                  <div className={styles.scopeHeading}>
                    <span>Granted now</span>
                    <strong>2 scopes</strong>
                  </div>
                  <ul>
                    {fixedScopes.map((scope) => (
                      <li key={scope}>
                        <code>{scope}</code>
                      </li>
                    ))}
                  </ul>
                </div>

                <p className={styles.securityNote}>
                  This key cannot sign or broadcast wallet transactions. Fee
                  claims and automated buybacks will require separate scopes
                  when those API operations become available.
                </p>

                {createError ? (
                  <p className={styles.inlineError} role="alert">
                    {createError}
                  </p>
                ) : null}

                <button
                  ref={createButtonRef}
                  className={styles.primaryButton}
                  disabled={createState === "creating"}
                  type="submit"
                >
                  {createState === "creating" ? "Creating key" : "Create key"}
                </button>
              </form>
            </section>

            <section
              className={`${styles.panel} ${styles.listPanel}`}
              aria-labelledby="api-keys-title"
              aria-busy={listState === "loading"}
            >
              <div className={styles.panelHeading}>
                <div>
                  <p className={styles.kicker}>Credentials</p>
                  <h2 id="api-keys-title">Your API keys</h2>
                </div>
                <button
                  className={styles.textButton}
                  disabled={listState === "loading"}
                  type="button"
                  onClick={refreshApiKeys}
                >
                  Refresh
                </button>
              </div>

              {listState === "loading" ? <KeyListSkeleton /> : null}

              {listState === "error" ? (
                <div className={styles.statePanel} role="alert">
                  <h3>API keys are unavailable</h3>
                  <p>{listError}</p>
                  <button
                    className={styles.secondaryButton}
                    type="button"
                    onClick={refreshApiKeys}
                  >
                    Try again
                  </button>
                </div>
              ) : null}

              {listState === "ready" && apiKeys.length === 0 ? (
                <div className={styles.statePanel}>
                  <h3>No API keys yet</h3>
                  <p>
                    Create a key for the agent or workflow that prepares your
                    first custom launch.
                  </p>
                </div>
              ) : null}

              {listState === "ready" && apiKeys.length > 0 ? (
                <ul className={styles.keyList}>
                  {apiKeys.map((apiKey) => {
                    const status = keyStatus(apiKey);
                    const confirming = confirmingRevokeId === apiKey.id;
                    const revoking = revokingId === apiKey.id;
                    return (
                      <li className={styles.keyItem} key={apiKey.id}>
                        <div className={styles.keyIdentity}>
                          <div>
                            <h3>{apiKey.label}</h3>
                            <span
                              className={styles.keyStatus}
                              data-status={status.toLowerCase()}
                            >
                              {status}
                            </span>
                          </div>
                          <code>{displayPrefix(apiKey.keyPrefix)}</code>
                        </div>

                        <dl className={styles.keyMetadata}>
                          <div>
                            <dt>Created</dt>
                            <dd>{formatDate(apiKey.createdAt, "Unknown")}</dd>
                          </div>
                          <div>
                            <dt>Expires</dt>
                            <dd>
                              {formatDate(apiKey.expiresAt, "Unavailable")}
                            </dd>
                          </div>
                          <div>
                            <dt>Last used</dt>
                            <dd>{formatDate(apiKey.lastUsedAt, "Never")}</dd>
                          </div>
                          {apiKey.revokedAt ? (
                            <div>
                              <dt>Revoked</dt>
                              <dd>
                                {formatDate(apiKey.revokedAt, "Unavailable")}
                              </dd>
                            </div>
                          ) : null}
                        </dl>

                        <ul
                          className={styles.keyScopes}
                          aria-label="Key scopes"
                        >
                          {apiKey.scopes.map((scope) => (
                            <li key={scope}>
                              <code>{scope}</code>
                            </li>
                          ))}
                        </ul>

                        {confirming ? (
                          <div
                            className={styles.revokeConfirmation}
                            role="group"
                            aria-label={`Revoke ${apiKey.label}`}
                            onKeyDown={(event) => {
                              if (event.key === "Escape" && !revoking) {
                                event.preventDefault();
                                cancelRevoke();
                              }
                            }}
                          >
                            <p>
                              Revoke this key? Requests using it will stop
                              immediately.
                            </p>
                            {revokeError ? (
                              <p className={styles.inlineError} role="alert">
                                {revokeError}
                              </p>
                            ) : null}
                            <div>
                              <button
                                className={styles.secondaryButton}
                                disabled={revoking}
                                type="button"
                                onClick={cancelRevoke}
                              >
                                Cancel
                              </button>
                              <button
                                ref={confirmRevokeRef}
                                className={styles.dangerButton}
                                disabled={revoking}
                                type="button"
                                data-confirm-revoke
                                onClick={() => void revokeApiKey(apiKey)}
                              >
                                {revoking ? "Revoking key" : "Revoke key"}
                              </button>
                            </div>
                          </div>
                        ) : status === "Active" ? (
                          <button
                            className={styles.revokeButton}
                            type="button"
                            onClick={(event) =>
                              beginRevoke(apiKey.id, event.currentTarget)
                            }
                          >
                            Revoke key
                          </button>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
