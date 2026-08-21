"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { getAddress, isAddress } from "viem";

import { useWallet } from "@/components/wallet-provider";
import { parseCreatorArticleV1, type CreatorArticleV1 } from
  "@/lib/creator-article/contract-v1";

import styles from "./profile-projects.module.css";

const CreatorArticleEditor = dynamic(
  () => import("@/components/creator-article-editor"),
  { ssr: false, loading: () => <p className={styles.loading}>Opening editor…</p> },
);

export type CreatorProjectSummaryV1 = Readonly<{
  chainId: 1;
  tokenAddress: `0x${string}`;
  name: string;
  symbol: string | null;
  imageUrl: string | null;
  source: "envio-classic-v3" | "registry.custom-launched" | "official-main-token";
  article: Readonly<{ revision: number; title: string; updatedAt: string }> | null;
}>;

type EditorState = Readonly<{
  project: CreatorProjectSummaryV1;
  article: CreatorArticleV1 | null;
  etag: string | null;
}>;

export function ProfileProjects() {
  const { wallet, getAccessToken, getIdentityToken } = useWallet();
  const [projects, setProjects] = useState<readonly CreatorProjectSummaryV1[]>([]);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [opening, setOpening] = useState<string | null>(null);

  const getAuthHeaders = useCallback(async () => {
    const [accessToken, identityToken] = await Promise.all([
      getAccessToken(),
      getIdentityToken(),
    ]);
    if (!accessToken || !identityToken) throw new Error("Reconnect your wallet and try again");
    return {
      Authorization: `Bearer ${accessToken}`,
      "X-Privy-Identity-Token": identityToken,
    };
  }, [getAccessToken, getIdentityToken]);

  const loadProjects = useCallback(async (signal?: AbortSignal) => {
    if (!wallet) return;
    setPhase("loading");
    try {
      const response = await fetch("/api/profile/projects", {
        headers: { Accept: "application/json", ...(await getAuthHeaders()) },
        signal,
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(readError(body));
      setProjects(parseProjectList(body));
      setPhase("ready");
    } catch {
      if (signal?.aborted) return;
      setPhase("error");
    }
  }, [getAuthHeaders, wallet]);

  useEffect(() => {
    if (!wallet) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => void loadProjects(controller.signal), 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [loadProjects, wallet]);

  async function openEditor(project: CreatorProjectSummaryV1) {
    setOpening(project.tokenAddress);
    try {
      const response = await fetch(
        `/api/profile/projects/${project.tokenAddress}/article`,
        { headers: { Accept: "application/json", ...(await getAuthHeaders()) } },
      );
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(readError(body));
      const record = isRecord(body) ? body : null;
      const article = record?.article === null
        ? null
        : parseCreatorArticleV1(record?.article);
      setEditor({ project, article, etag: response.headers.get("etag") });
    } finally {
      setOpening(null);
    }
  }

  if (!wallet) return null;
  return (
    <section className={styles.section} aria-labelledby="my-projects-title">
      <header className={styles.heading}>
        <div>
          <p>Creator workspace</p>
          <h2 id="my-projects-title">My projects</h2>
        </div>
        <button type="button" onClick={() => void loadProjects()} disabled={phase === "loading"}>
          Refresh
        </button>
      </header>

      {phase === "loading" && projects.length === 0 ? (
        <p className={styles.loading} role="status">Loading your verified launches…</p>
      ) : phase === "error" ? (
        <p className={styles.error} role="alert">Your projects could not be verified right now.</p>
      ) : projects.length === 0 ? (
        <p className={styles.empty}>Your verified launches will appear here.</p>
      ) : (
        <div className={styles.grid}>
          {projects.map((project) => (
            <article className={styles.project} key={project.tokenAddress}>
              <div className={styles.art}>
                {project.imageUrl ? (
                  <Image src={project.imageUrl} alt="" fill sizes="64px" unoptimized />
                ) : <span aria-hidden="true">{project.symbol?.slice(0, 2) ?? "P"}</span>}
              </div>
              <div className={styles.copy}>
                <strong>{project.name}</strong>
                <span>{project.symbol ? `$${project.symbol}` : "Verified launch"}</span>
                {project.article ? <small>Updated {formatDate(project.article.updatedAt)}</small> : null}
              </div>
              <div className={styles.actions}>
                <button
                  type="button"
                  disabled={opening === project.tokenAddress}
                  onClick={() => void openEditor(project)}
                >
                  {opening === project.tokenAddress
                    ? "Opening…"
                    : project.article ? "Edit article" : "Create article"}
                </button>
                <Link href={`/token/${project.tokenAddress}`}>View token</Link>
              </div>
            </article>
          ))}
        </div>
      )}

      {editor ? (
        <CreatorArticleEditor
          project={editor.project}
          initialArticle={editor.article}
          initialEtag={editor.etag}
          getAuthHeaders={getAuthHeaders}
          onClose={() => setEditor(null)}
          onPublished={(article) => {
            setProjects((current) => current.map((project) =>
              project.tokenAddress === article.tokenAddress
                ? {
                    ...project,
                    article: {
                      revision: article.revision,
                      title: article.title,
                      updatedAt: article.updatedAt,
                    },
                  }
                : project));
          }}
        />
      ) : null}
    </section>
  );
}

function parseProjectList(value: unknown): readonly CreatorProjectSummaryV1[] {
  if (!isRecord(value)
    || value.schemaVersion !== "programmable.creator-project-list.v1"
    || !Array.isArray(value.projects)) throw new Error("Invalid project list");
  return value.projects.map((candidate) => {
    if (!isRecord(candidate)
      || candidate.chainId !== 1
      || typeof candidate.tokenAddress !== "string" || !isAddress(candidate.tokenAddress)
      || typeof candidate.name !== "string"
      || (candidate.symbol !== null && typeof candidate.symbol !== "string")
      || (candidate.imageUrl !== null && typeof candidate.imageUrl !== "string")
      || !["envio-classic-v3", "registry.custom-launched", "official-main-token"].includes(String(candidate.source))) {
      throw new Error("Invalid project record");
    }
    let article: CreatorProjectSummaryV1["article"] = null;
    if (candidate.article !== null) {
      if (!isRecord(candidate.article)
        || !Number.isSafeInteger(candidate.article.revision)
        || typeof candidate.article.title !== "string"
        || typeof candidate.article.updatedAt !== "string") throw new Error("Invalid article summary");
      article = {
        revision: Number(candidate.article.revision),
        title: candidate.article.title,
        updatedAt: candidate.article.updatedAt,
      };
    }
    return Object.freeze({
      chainId: 1 as const,
      tokenAddress: getAddress(candidate.tokenAddress),
      name: candidate.name,
      symbol: candidate.symbol as string | null,
      imageUrl: candidate.imageUrl as string | null,
      source: candidate.source as CreatorProjectSummaryV1["source"],
      article,
    });
  });
}

function readError(value: unknown) {
  return isRecord(value) && typeof value.code === "string"
    ? value.code
    : "Project request failed";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" })
    .format(new Date(value));
}
