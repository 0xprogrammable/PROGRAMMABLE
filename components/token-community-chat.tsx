"use client";

import { Send } from "lucide-react";
import { useEffect, useId, useState, type FormEvent } from "react";

import styles from "@/components/token-community-chat.module.css";

type CommunityMessage = {
  body: string;
  createdAt: number;
  id: string;
};

const COMMUNITY_STORAGE_VERSION = "v1";
const MAX_STORED_MESSAGES = 40;

export function getTokenCommunityStorageKey(tokenAddress: string) {
  return `programmable-community:${COMMUNITY_STORAGE_VERSION}:${tokenAddress.toLowerCase()}`;
}

export function parseStoredCommunityMessages(value: unknown): CommunityMessage[] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((entry) => {
      if (
        typeof entry !== "object" ||
        entry === null ||
        !("id" in entry) ||
        !("body" in entry) ||
        !("createdAt" in entry) ||
        typeof entry.id !== "string" ||
        typeof entry.body !== "string" ||
        typeof entry.createdAt !== "number" ||
        !Number.isFinite(entry.createdAt)
      ) {
        return [];
      }
      const body = entry.body.trim().slice(0, 280);
      return body ? [{ id: entry.id, body, createdAt: entry.createdAt }] : [];
    })
    .slice(-MAX_STORED_MESSAGES);
}

function readMessages(storageKey: string) {
  try {
    const stored = window.localStorage.getItem(storageKey);
    return stored ? parseStoredCommunityMessages(JSON.parse(stored)) : [];
  } catch {
    return [];
  }
}

function parseStoredCommunityJson(value: string | null) {
  if (!value) return [];
  try {
    return parseStoredCommunityMessages(JSON.parse(value));
  } catch {
    return [];
  }
}

function formatMessageTime(value: number) {
  return new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

export function TokenCommunityChat({
  memberCount,
  preview,
  tokenAddress,
  tokenName,
}: {
  memberCount?: number;
  preview: boolean;
  tokenAddress: string;
  tokenName: string;
}) {
  const [messages, setMessages] = useState<CommunityMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [storageAvailable, setStorageAvailable] = useState(true);
  const inputId = useId();
  const storageKey = getTokenCommunityStorageKey(tokenAddress);

  useEffect(() => {
    const readFrame = window.requestAnimationFrame(() => {
      setMessages(readMessages(storageKey));
    });

    function syncMessages(event: StorageEvent) {
      if (event.key !== storageKey) return;
      setMessages(parseStoredCommunityJson(event.newValue));
    }

    window.addEventListener("storage", syncMessages);
    return () => {
      window.cancelAnimationFrame(readFrame);
      window.removeEventListener("storage", syncMessages);
    };
  }, [storageKey]);

  function submitMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = draft.trim().slice(0, 280);
    if (!body) return;

    const nextMessage = {
      body,
      createdAt: Date.now(),
      id:
        typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    };
    const nextMessages = [...messages, nextMessage].slice(-MAX_STORED_MESSAGES);
    setMessages(nextMessages);
    setDraft("");
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(nextMessages));
      setStorageAvailable(true);
    } catch {
      setStorageAvailable(false);
    }
  }

  return (
    <section className={styles.panel} aria-labelledby={`${inputId}-title`}>
      <header className={styles.heading}>
        <div>
          <h2 id={`${inputId}-title`}>Community</h2>
          <p>
            {memberCount
              ? `${memberCount.toLocaleString("en-US")} members`
              : `Project room for ${tokenName}`}
          </p>
        </div>
        <span className={styles.status}>
          <span aria-hidden="true" />
          {preview ? "Preview room" : "Local room"}
        </span>
      </header>

      <div className={styles.conversation} aria-live="polite">
        <article className={styles.systemMessage}>
          <span className={styles.avatar} aria-hidden="true">
            P
          </span>
          <div>
            <p className={styles.messageMeta}>
              <strong>Programmable</strong>
              <span>Room notice</span>
            </p>
            <p>
              This room belongs to {tokenName}. Messages are kept separately
              for this token and saved in this browser.
            </p>
          </div>
        </article>

        {messages.map((message) => (
          <article className={styles.message} key={message.id}>
            <span className={styles.avatar} aria-hidden="true">
              Y
            </span>
            <div>
              <p className={styles.messageMeta}>
                <strong>You</strong>
                <time dateTime={new Date(message.createdAt).toISOString()}>
                  {formatMessageTime(message.createdAt)}
                </time>
              </p>
              <p>{message.body}</p>
            </div>
          </article>
        ))}
      </div>

      <form className={styles.composer} onSubmit={submitMessage}>
        <label className="sr-only" htmlFor={inputId}>
          Message {tokenName}
        </label>
        <input
          id={inputId}
          autoComplete="off"
          maxLength={280}
          placeholder={`Message ${tokenName}`}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button
          type="submit"
          aria-label={`Send message to ${tokenName}`}
          disabled={!draft.trim()}
        >
          <Send aria-hidden="true" size={17} />
        </button>
      </form>
      <p className={styles.storageNote} role="status">
        {storageAvailable
          ? "Messages sync across tabs on this device."
          : "This message could not be saved on this device."}
      </p>
    </section>
  );
}
