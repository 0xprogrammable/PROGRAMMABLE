"use client";

import dynamic from "next/dynamic";
import { Pencil } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  acquireCreatorArticleAuthHeadersV1,
  loadCreatorArticleEditorV1,
  type CreatorArticleEditorStateV1,
  type CreatorProjectSummaryV1,
} from "@/components/creator-article-editor-loader";
import { useWallet } from "@/components/wallet-provider";
import type { CreatorArticleV1 } from "@/lib/creator-article/contract-v1";

import styles from "./creator-article.module.css";

const loadCreatorArticleEditorModule = () =>
  import("@/components/creator-article-editor");
const CreatorArticleEditor = dynamic(
  loadCreatorArticleEditorModule,
  { ssr: false },
);

export function CreatorArticleEditAction({
  project,
  creatorAddress,
  onPublished,
}: Readonly<{
  project: CreatorProjectSummaryV1;
  creatorAddress: `0x${string}`;
  onPublished(article: CreatorArticleV1): void;
}>) {
  const { wallet, getAccessToken, getIdentityToken } = useWallet();
  const walletAccount = wallet?.account.toLowerCase() ?? null;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const requestRef = useRef<Readonly<{
    account: string;
    request: Promise<CreatorArticleEditorStateV1>;
  }> | null>(null);
  const [verifiedAccount, setVerifiedAccount] = useState<string | null>(null);
  const [editorAccount, setEditorAccount] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [editorState, setEditorState] =
    useState<CreatorArticleEditorStateV1 | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [error, setError] = useState("");
  const walletMatchesCreator = walletAccount === creatorAddress.toLowerCase();

  const getAuthHeaders = useCallback(
    () => acquireCreatorArticleAuthHeadersV1({
      getAccessToken,
      getIdentityToken,
    }),
    [getAccessToken, getIdentityToken],
  );

  const loadEditorState = useCallback(() => {
    if (walletAccount === null) {
      return Promise.reject(new Error("Connect your wallet to edit this article"));
    }
    if (requestRef.current?.account === walletAccount) {
      return requestRef.current.request;
    }
    const request = loadCreatorArticleEditorV1(project, getAuthHeaders)
      .then((next) => {
        setEditorState(next);
        setEditorAccount(walletAccount);
        setVerifiedAccount(walletAccount);
        return next;
      })
      .finally(() => {
        if (requestRef.current?.request === request) requestRef.current = null;
      });
    requestRef.current = Object.freeze({ account: walletAccount, request });
    return request;
  }, [getAuthHeaders, project, walletAccount]);

  useEffect(() => {
    if (walletAccount === null) return;
    void loadEditorState().catch(() => undefined);
  }, [loadEditorState, walletAccount]);

  if (
    walletAccount === null
    || (!walletMatchesCreator && verifiedAccount !== walletAccount)
  ) return null;

  async function openEditor() {
    setOpening(true);
    setError("");
    try {
      const currentEditorState = editorAccount === walletAccount
        ? editorState
        : null;
      const [, nextEditorState] = await Promise.all([
        loadCreatorArticleEditorModule(),
        currentEditorState
          ? Promise.resolve(currentEditorState)
          : loadEditorState(),
      ]);
      setEditorState(nextEditorState);
      setEditorOpen(true);
    } catch {
      setError("Article editor unavailable. Try again.");
    } finally {
      setOpening(false);
    }
  }

  return (
    <>
      <div className={styles.editActionGroup}>
        <button
          ref={triggerRef}
          className={styles.editAction}
          type="button"
          disabled={opening}
          onPointerEnter={() => void loadCreatorArticleEditorModule()}
          onFocus={() => void loadCreatorArticleEditorModule()}
          onClick={() => void openEditor()}
        >
          <Pencil aria-hidden="true" size={15} strokeWidth={1.8} />
          {opening ? "Opening…" : "Edit article"}
        </button>
        {error ? <p className={styles.editActionError} role="alert">{error}</p> : null}
      </div>
      {editorOpen && editorState ? (
        <CreatorArticleEditor
          project={editorState.project}
          initialArticle={editorState.article}
          initialEtag={editorState.etag}
          getAuthHeaders={getAuthHeaders}
          onClose={() => {
            setEditorOpen(false);
            window.requestAnimationFrame(() => triggerRef.current?.focus());
          }}
          onPublished={(article) => {
            setEditorState((current) => current
              ? { ...current, article }
              : current);
            onPublished(article);
          }}
        />
      ) : null}
    </>
  );
}
