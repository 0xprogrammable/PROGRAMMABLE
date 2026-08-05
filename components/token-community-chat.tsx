"use client";

import Image from "next/image";
import { Send } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
} from "react";

import styles from "@/components/token-community-chat.module.css";
import { useWallet } from "@/components/wallet-provider";

type CommunityMessage = {
  authorAddress?: string;
  authorLabel?: string;
  body: string;
  createdAt: number;
  id: string;
};

const COMMUNITY_STORAGE_VERSION = "v1";
const MAX_STORED_MESSAGES = 40;
const MAX_AUTHOR_LABEL_LENGTH = 32;
const MAX_MESSAGE_ID_LENGTH = 128;
const ethereumAddressPattern = /^0x[a-fA-F0-9]{40}$/;
const messageTimeFormatter = new Intl.DateTimeFormat("en", {
  hour: "2-digit",
  minute: "2-digit",
});

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
      const id = entry.id.trim().slice(0, MAX_MESSAGE_ID_LENGTH);
      const body = entry.body.trim().slice(0, 280);
      if (!id || !body) return [];

      const authorAddress =
        "authorAddress" in entry &&
        typeof entry.authorAddress === "string" &&
        ethereumAddressPattern.test(entry.authorAddress)
          ? entry.authorAddress.toLowerCase()
          : undefined;
      const authorLabel =
        "authorLabel" in entry && typeof entry.authorLabel === "string"
          ? entry.authorLabel.trim().slice(0, MAX_AUTHOR_LABEL_LENGTH)
          : "";
      return [
        {
          id,
          body,
          createdAt: entry.createdAt,
          ...(authorAddress ? { authorAddress } : {}),
          ...(authorLabel ? { authorLabel } : {}),
        },
      ];
    })
    .slice(-MAX_STORED_MESSAGES);
}

function readMessages(storageKey: string) {
  try {
    const stored = window.localStorage.getItem(storageKey);
    return {
      available: true,
      messages: stored
        ? parseStoredCommunityMessages(JSON.parse(stored))
        : [],
    };
  } catch {
    return { available: false, messages: [] };
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
  return messageTimeFormatter.format(value);
}

function authorInitial(label: string) {
  return label.trim().charAt(0).toUpperCase() || "Y";
}

function createCommunityMessage(input: {
  authorAddress?: string;
  authorLabel: string;
  body: string;
}): CommunityMessage {
  const createdAt = Date.now();
  return {
    ...(input.authorAddress ? { authorAddress: input.authorAddress } : {}),
    authorLabel: input.authorLabel,
    body: input.body,
    createdAt,
    id:
      typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${createdAt}-${Math.random().toString(16).slice(2)}`,
  };
}

export function TokenCommunityChat({
  tokenAddress,
  tokenName,
}: {
  memberCount?: number;
  preview: boolean;
  tokenAddress: string;
  tokenName: string;
}) {
  const { avatarDataUrl, username, wallet } = useWallet();
  const [messages, setMessages] = useState<CommunityMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [storageAvailable, setStorageAvailable] = useState(true);
  const inputId = useId();
  const conversationRef = useRef<HTMLDivElement>(null);
  const storageKey = getTokenCommunityStorageKey(tokenAddress);
  const currentAuthorAddress = wallet?.account.toLowerCase();
  const currentAuthorLabel = username.trim() || "You";
  const currentAvatarDataUrl = wallet ? avatarDataUrl : "";

  useEffect(() => {
    const readFrame = window.requestAnimationFrame(() => {
      const stored = readMessages(storageKey);
      setMessages(stored.messages);
      setStorageAvailable(stored.available);
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

  useEffect(() => {
    const conversation = conversationRef.current;
    if (conversation) conversation.scrollTop = conversation.scrollHeight;
  }, [messages]);

  function submitMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = draft.trim().slice(0, 280);
    if (!body) return;

    const nextMessage = createCommunityMessage({
      ...(currentAuthorAddress ? { authorAddress: currentAuthorAddress } : {}),
      authorLabel: currentAuthorLabel,
      body,
    });
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
    <section
      className={`${styles.panel} liquid-glass-surface liquid-glass-distortion`}
      aria-labelledby={`${inputId}-title`}
    >
      <header className={styles.heading}>
        <h2 id={`${inputId}-title`}>Community</h2>
      </header>

      <div
        className={styles.conversation}
        ref={conversationRef}
        role="log"
        aria-label={`${tokenName} community messages`}
        aria-live="polite"
        aria-relevant="additions"
      >
        {messages.length === 0 ? (
          <p className={styles.emptyMessage}>No messages yet.</p>
        ) : (
          messages.map((message) => {
            const authorLabel = message.authorLabel || "Member";
            const usesCurrentAvatar = Boolean(
              currentAvatarDataUrl &&
                currentAuthorAddress &&
                message.authorAddress === currentAuthorAddress,
            );

            return (
              <article className={styles.message} key={message.id}>
                <span className={styles.avatar} aria-hidden="true">
                  {usesCurrentAvatar ? (
                    <Image
                      src={currentAvatarDataUrl}
                      alt=""
                      fill
                      sizes="36px"
                      unoptimized
                    />
                  ) : (
                    authorInitial(authorLabel)
                  )}
                </span>
                <div>
                  <p className={styles.messageMeta}>
                    <strong>{authorLabel}</strong>
                    <time dateTime={new Date(message.createdAt).toISOString()}>
                      {formatMessageTime(message.createdAt)}
                    </time>
                  </p>
                  <p>{message.body}</p>
                </div>
              </article>
            );
          })
        )}
      </div>

      <form className={styles.composer} onSubmit={submitMessage}>
        <span className={styles.composerAvatar} aria-hidden="true">
          {currentAvatarDataUrl ? (
            <Image
              src={currentAvatarDataUrl}
              alt=""
              fill
              sizes="36px"
              unoptimized
            />
          ) : (
            authorInitial(currentAuthorLabel)
          )}
        </span>
        <label className="sr-only" htmlFor={inputId}>
          Write message
        </label>
        <input
          id={inputId}
          autoComplete="off"
          maxLength={280}
          name="community-message"
          placeholder="Write message"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit" disabled={!draft.trim()}>
          <Send aria-hidden="true" size={15} />
          <span>Send</span>
        </button>
      </form>
      <p className={styles.storageError} role="status" aria-live="polite">
        {storageAvailable ? "" : "Messages could not be saved."}
      </p>
    </section>
  );
}
