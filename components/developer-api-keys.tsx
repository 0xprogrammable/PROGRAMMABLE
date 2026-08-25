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
import { DeveloperLaunchHistory } from "@/components/developer-launch-history";
import { useWallet } from "@/components/wallet-provider";
import { PROGRAMMABLE_AGENT_SETUP_TEXT_V1 } from
  "@/lib/custom-launch/agent-setup-v1";
import type { CustomLaunchWalletActionV1 } from
  "@/lib/custom-launch/wallet-handoff-v1";

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
type ActiveSection = "keys" | "history";
type DeveloperApiKeysViewProps = Readonly<{
  account: `0x${string}` | null;
  authReady: boolean;
  connecting: boolean;
  getAccessToken: () => Promise<string | null>;
  getIdentityToken: () => Promise<string | null>;
  openWallet: () => void;
  sendCustomLaunchWalletAction: (
    input: CustomLaunchWalletActionV1,
  ) => Promise<`0x${string}`>;
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

function readApiError(response: Response, value: unknown, fallback: string) {
  if (!isRecord(value) || !isRecord(value.error)) return fallback;
  const message = typeof value.error.message === "string" && value.error.message.trim()
    ? value.error.message
    : fallback;
  const requestId = typeof value.error.requestId === "string"
    && /^[A-Za-z0-9][A-Za-z0-9._:@+-]{0,127}$/u.test(value.error.requestId)
    ? value.error.requestId
    : null;
  const retryAfter = response.headers.get("retry-after");
  const retryCopy = response.status === 429
    && retryAfter !== null
    && /^[1-9][0-9]{0,4}$/u.test(retryAfter)
    ? ` Try again in ${retryAfter} seconds.`
    : "";
  const requestCopy = requestId ? ` Request ID: ${requestId}.` : "";
  return `${message}${retryCopy}${requestCopy}`;
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
    <>
      <span className={styles.visuallyHidden} role="status">
        Loading API keys
      </span>
      <div className={styles.skeletonList} aria-hidden="true">
        <div className={styles.skeletonRow}>
          <span className={styles.skeletonTitle} />
          <span className={styles.skeletonLine} />
          <span className={styles.skeletonLineShort} />
        </div>
      </div>
    </>
  );
}

export function DeveloperApiKeys() {
  const {
    authReady,
    connecting,
    getAccessToken,
    getIdentityToken,
    openWallet,
    sendCustomLaunchWalletAction,
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
      sendCustomLaunchWalletAction={sendCustomLaunchWalletAction}
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
  sendCustomLaunchWalletAction,
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
  const [keyCopyState, setKeyCopyState] = useState<"idle" | "copied" | "error">(
    "idle",
  );
  const [setupCopyState, setSetupCopyState] = useState<
    "idle" | "copied" | "error"
  >(
    "idle",
  );
  const [confirmingRevokeId, setConfirmingRevokeId] = useState<string | null>(
    null,
  );
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [activeSection, setActiveSection] = useState<ActiveSection>("keys");
  const [walletSessionTimedOut, setWalletSessionTimedOut] = useState(false);
  const labelRef = useRef<HTMLInputElement>(null);
  const revealRef = useRef<HTMLDivElement>(null);
  const createButtonRef = useRef<HTMLButtonElement>(null);
  const revokeTriggerRef = useRef<HTMLButtonElement | null>(null);
  const confirmRevokeRef = useRef<HTMLButtonElement>(null);
  const createInFlightRef = useRef(false);

  const getAuthHeaders = useCallback(
    async (json = false) => {
      // Privy may refresh the identity session while resolving this token.
      // Read the access token afterwards so both headers describe one session.
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
          throw new Error(readApiError(
            response,
            body,
            "Unable to load API keys.",
          ));
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

  useEffect(() => {
    if (authReady) return;
    const timeoutId = window.setTimeout(() => {
      setWalletSessionTimedOut(true);
    }, 8_000);
    return () => window.clearTimeout(timeoutId);
  }, [authReady]);

  const activeCount = useMemo(
    () => apiKeys.filter((apiKey) => keyStatus(apiKey) === "Active").length,
    [apiKeys],
  );

  const createApiKey = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!account || createState === "creating" || createInFlightRef.current) return;
    if (createdApiKey) {
      setStatusMessage("Save the visible API key before creating another.");
      revealRef.current?.focus();
      return;
    }

    const cleanLabel = label.trim();
    if (!cleanLabel) {
      setLabelError("Enter a name for this key.");
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
    setKeyCopyState("idle");
    setSetupCopyState("idle");
    createInFlightRef.current = true;
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
        throw new Error(readApiError(
          response,
          body,
          "Unable to create the API key.",
        ));
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
      createInFlightRef.current = false;
      setCreateState("idle");
    }
  };

  const copyApiKey = async () => {
    if (!createdApiKey) return;
    try {
      await copyToClipboard(createdApiKey.apiKeySecret);
      setKeyCopyState("copied");
      setStatusMessage("API key copied.");
    } catch {
      setKeyCopyState("error");
      setStatusMessage("Copy failed. Select the key and copy it manually.");
    }
  };

  const copyAgentSetup = async () => {
    if (!createdApiKey) return;
    try {
      await copyToClipboard(PROGRAMMABLE_AGENT_SETUP_TEXT_V1);
      setSetupCopyState("copied");
      setStatusMessage("Agent setup copied without the API key.");
    } catch {
      setSetupCopyState("error");
      setStatusMessage("Agent setup could not be copied.");
    }
  };

  const dismissApiKey = () => {
    setCreatedApiKey(null);
    setKeyCopyState("idle");
    setSetupCopyState("idle");
    setStatusMessage("Key hidden.");
    window.setTimeout(() => createButtonRef.current?.focus(), 0);
  };

  const showSection = (section: ActiveSection) => {
    setActiveSection(section);
    setStatusMessage(
      section === "keys" ? "Showing API keys." : "Showing launch history.",
    );
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
        throw new Error(readApiError(
          response,
          body,
          "Unable to revoke the API key.",
        ));
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
          <h1>API keys</h1>
          <p className={styles.intro}>
            Create and revoke keys for Custom launch workflows. A key can
            prepare a launch, but only your wallet can sign it.
          </p>
        </div>
      </header>

      {!authReady ? (
        walletSessionTimedOut ? (
          <section className={styles.walletGate} role="alert">
            <Image
              className={styles.loopMark}
              src="/brand/loop/programmable-loop-mark-header-warm-ivory-v1-1536.png"
              alt=""
              width={1168}
              height={1536}
              sizes="52px"
            />
            <h2>Wallet access is unavailable</h2>
            <p>Reload the page or try again shortly.</p>
            <button
              className={styles.secondaryButton}
              type="button"
              onClick={() => window.location.reload()}
            >
              Reload page
            </button>
          </section>
        ) : (
          <section className={styles.walletGate} aria-busy="true">
            <span className={styles.walletGateMark} aria-hidden="true" />
            <span className={styles.walletGateTitle} aria-hidden="true" />
            <span className={styles.walletGateLine} aria-hidden="true" />
            <span className={styles.visuallyHidden} role="status">
              Loading wallet session
            </span>
          </section>
        )
      ) : !account ? (
        <section className={styles.walletGate} aria-labelledby="connect-title">
          <Image
            className={styles.loopMark}
            src="/brand/loop/programmable-loop-mark-header-warm-ivory-v1-1536.png"
            alt=""
            width={1168}
            height={1536}
            sizes="52px"
          />
          <h2 id="connect-title">Connect your wallet</h2>
          <p>
            Use the wallet that will own these keys. Connecting does not request
            a signature.
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
            <div className={styles.accountActions}>
              <p>
                {activeCount} active {activeCount === 1 ? "key" : "keys"}
              </p>
            </div>
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
                Copy this secret now. It will not be shown again. Store it in
                encrypted secrets or the environment, never in chat, a prompt,
                source code, or command history.
              </p>
              <div className={styles.secretRow}>
                <code>{createdApiKey.apiKeySecret}</code>
                <div className={styles.secretActions}>
                  <button
                    className={styles.secondaryButton}
                    type="button"
                    onClick={() => void copyApiKey()}
                  >
                    {keyCopyState === "copied" ? "Copied" : "Copy key"}
                  </button>
                  <button
                    className={styles.secondaryButton}
                    type="button"
                    onClick={() => void copyAgentSetup()}
                  >
                    {setupCopyState === "copied"
                      ? "Setup copied"
                      : "Copy agent setup"}
                  </button>
                </div>
              </div>
              <p className={styles.setupNote}>
                Agent setup contains only <code>$PROGRAMMABLE_API_KEY</code>,
                install instructions, and public CLI, guide, and OpenAPI links.
                It never includes this key.
              </p>
              {keyCopyState === "error" ? (
                <p className={styles.inlineError} role="alert">
                  Copy failed. Select the key and copy it manually.
                </p>
              ) : null}
              {setupCopyState === "error" ? (
                <p className={styles.inlineError} role="alert">
                  Agent setup could not be copied. Try again.
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

          <div
            className={styles.sectionSwitch}
            role="group"
            aria-label="Developer access view"
          >
            <button
              aria-pressed={activeSection === "keys"}
              type="button"
              onClick={() => showSection("keys")}
            >
              API keys
            </button>
            <button
              aria-pressed={activeSection === "history"}
              type="button"
              onClick={() => showSection("history")}
            >
              Launch history
            </button>
          </div>

          {activeSection === "keys" ? (
            <div className={styles.workspace}>
              <section
                className={`${styles.panel} ${styles.createPanel}`}
                aria-labelledby="create-key-title"
              >
                <div className={styles.panelHeading}>
                  <div>
                    <p className={styles.kicker}>New key</p>
                    <h2 id="create-key-title">Create key</h2>
                  </div>
                </div>

                <form className={styles.createForm} onSubmit={createApiKey}>
                  <div className={styles.formFields}>
                    <div>
                      <label className={styles.field} htmlFor="api-key-label">
                        <span>Name</span>
                        <input
                          ref={labelRef}
                          id="api-key-label"
                          aria-describedby={
                            labelError ? "api-key-label-error" : undefined
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
                      {labelError ? (
                        <p
                          className={styles.inlineError}
                          id="api-key-label-error"
                        >
                          {labelError}
                        </p>
                      ) : null}
                    </div>

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
                  </div>

                  <details className={styles.scopeLedger}>
                    <summary>
                      <span>Permissions</span>
                      <strong>2 launch scopes</strong>
                    </summary>
                    <ul>
                      {fixedScopes.map((scope) => (
                        <li key={scope}>
                          <code>{scope}</code>
                        </li>
                      ))}
                    </ul>
                  </details>

                  <p className={styles.securityNote}>
                    API keys cannot sign or broadcast wallet transactions.
                  </p>

                  {createError ? (
                    <p className={styles.inlineError} role="alert">
                      {createError}
                    </p>
                  ) : null}

                  <button
                    ref={createButtonRef}
                    className={styles.primaryButton}
                    disabled={
                      createState === "creating" || Boolean(createdApiKey)
                    }
                    type="submit"
                  >
                    {createState === "creating"
                      ? "Creating key"
                      : createdApiKey
                        ? "Save current key first"
                        : "Create key"}
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
                    <p className={styles.kicker}>Existing</p>
                    <h2 id="api-keys-title">Your keys</h2>
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
                    <h3>Unable to load keys</h3>
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
                    <h3>No keys yet</h3>
                    <p>Create a key to start preparing Custom launches.</p>
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
          ) : (
            <DeveloperLaunchHistory
              account={account}
              getAccessToken={getAccessToken}
              getIdentityToken={getIdentityToken}
              sendCustomLaunchWalletAction={sendCustomLaunchWalletAction}
            />
          )}
        </>
      )}
    </div>
  );
}
