"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import { ChevronLeft, ChevronRight, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatUnits, getAddress, isAddress } from "viem";

import {
  acquireCreatorArticleAuthHeadersV1,
  loadCreatorArticleEditorV1,
  type CreatorArticleEditorStateV1 as EditorState,
  type CreatorProjectSummaryV1,
} from "@/components/creator-article-editor-loader";
import { useWallet } from "@/components/wallet-provider";

import styles from "./profile-projects.module.css";

export {
  acquireCreatorArticleAuthHeadersV1,
  loadCreatorArticleEditorV1,
} from "@/components/creator-article-editor-loader";
export type { CreatorProjectSummaryV1 } from
  "@/components/creator-article-editor-loader";

const loadCreatorArticleEditorModule = () =>
  import("@/components/creator-article-editor");
const preloadCreatorArticleEditorModule = () => {
  void loadCreatorArticleEditorModule().catch(() => undefined);
};
const CreatorArticleEditor = dynamic(
  loadCreatorArticleEditorModule,
  { ssr: false, loading: () => <p className={styles.loading}>Opening editor…</p> },
);

export const creatorProjectPageSize = 5;

export type CreatorProjectMarketCapV1 = Readonly<{
  tokenAddress: `0x${string}`;
  usdWad: string | null;
  ethWei: string | null;
  label: string | null;
}>;

export type CreatorProjectInitialBuyV1 = Readonly<{
  tokenAddress: `0x${string}`;
  ethAmountWei: string;
  tokenAmountRaw: string;
  tokenDecimals: number;
  custodyAddress: `0x${string}` | null;
  custodyMode: "unlocked" | "fixed-lock" | "linear" | "cliff-linear";
  durationDays: number;
  cliffDays: number;
  cliffAt: string;
  releaseAt: string;
}>;

export function ProfileProjects({
  initialBuys = [],
  marketCaps = [],
  onRefresh,
  walletProjects = [],
}: Readonly<{
  initialBuys?: readonly CreatorProjectInitialBuyV1[];
  marketCaps?: readonly CreatorProjectMarketCapV1[];
  onRefresh?: () => void;
  walletProjects?: readonly CreatorProjectSummaryV1[];
}>) {
  const { wallet, getAccessToken, getIdentityToken } = useWallet();
  const [projects, setProjects] = useState<readonly CreatorProjectSummaryV1[]>([]);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [openingProject, setOpeningProject] = useState<CreatorProjectSummaryV1 | null>(null);
  const [projectPage, setProjectPage] = useState(1);
  const [projectError, setProjectError] = useState("");
  const editorRequestsRef = useRef(new Map<string, Promise<EditorState>>());
  const editorTriggerRef = useRef<HTMLButtonElement | null>(null);
  const openRequestRef = useRef(0);

  const getAuthHeaders = useCallback(
    () => acquireCreatorArticleAuthHeadersV1({
      getAccessToken,
      getIdentityToken,
    }),
    [getAccessToken, getIdentityToken],
  );

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
      const nextProjects = parseProjectList(body);
      setProjects(nextProjects);
      setProjectPage(1);
      editorRequestsRef.current.clear();
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

  const visibleProjects = useMemo(
    () => mergeCreatorWalletProjectsV1(walletProjects, projects),
    [projects, walletProjects],
  );
  const editableTokens = useMemo(
    () => new Set(projects.map((project) => project.tokenAddress.toLowerCase())),
    [projects],
  );
  const pageData = useMemo(
    () => paginateCreatorProjectsV1(visibleProjects, marketCaps, projectPage),
    [marketCaps, projectPage, visibleProjects],
  );
  const marketCapByToken = useMemo(() => new Map(
    marketCaps.map((marketCap) => [marketCap.tokenAddress.toLowerCase(), marketCap]),
  ), [marketCaps]);
  const initialBuyByToken = useMemo(() => new Map(
    initialBuys.map((initialBuy) => [
      initialBuy.tokenAddress.toLowerCase(),
      initialBuy,
    ]),
  ), [initialBuys]);

  const getEditorState = useCallback((project: CreatorProjectSummaryV1) => {
    const key = project.tokenAddress.toLowerCase();
    const current = editorRequestsRef.current.get(key);
    if (current) return current;
    const request = loadCreatorArticleEditorV1(project, getAuthHeaders).catch((error) => {
      editorRequestsRef.current.delete(key);
      throw error;
    });
    editorRequestsRef.current.set(key, request);
    return request;
  }, [getAuthHeaders]);

  const warmEditor = useCallback((project: CreatorProjectSummaryV1) => {
    preloadCreatorArticleEditorModule();
    void getEditorState(project).catch(() => undefined);
  }, [getEditorState]);

  const focusEditorTrigger = useCallback(() => {
    window.requestAnimationFrame(() => editorTriggerRef.current?.focus());
  }, []);

  async function openEditor(
    project: CreatorProjectSummaryV1,
    trigger: HTMLButtonElement,
  ) {
    const requestId = ++openRequestRef.current;
    editorTriggerRef.current = trigger;
    setOpeningProject(project);
    setProjectError("");
    try {
      const [, nextEditor] = await Promise.all([
        loadCreatorArticleEditorModule(),
        getEditorState(project),
      ]);
      if (openRequestRef.current !== requestId) return;
      editorRequestsRef.current.delete(project.tokenAddress.toLowerCase());
      setEditor(nextEditor);
    } catch (error) {
      if (openRequestRef.current !== requestId) return;
      setProjectError(error instanceof Error
        ? error.message
        : "Creator article unavailable");
      focusEditorTrigger();
    } finally {
      if (openRequestRef.current === requestId) setOpeningProject(null);
    }
  }

  const closeOpeningEditor = useCallback(() => {
    openRequestRef.current += 1;
    setOpeningProject(null);
    focusEditorTrigger();
  }, [focusEditorTrigger]);

  const closeEditor = useCallback(() => {
    setEditor(null);
    focusEditorTrigger();
  }, [focusEditorTrigger]);

  if (!wallet) return null;
  return (
    <section className={styles.section} aria-labelledby="my-projects-title">
      <header className={styles.heading}>
        <h2 id="my-projects-title">My projects</h2>
        <div className={styles.headerActions}>
          <button
            className={styles.refresh}
            type="button"
            onClick={() => {
              onRefresh?.();
              void loadProjects();
            }}
            disabled={phase === "loading"}
          >
            <RefreshCw aria-hidden="true" size={15} strokeWidth={1.8} />
            <span>Refresh</span>
          </button>
          {pageData.totalPages > 1 ? (
            <nav className={styles.pagination} aria-label="Creator project pages">
              <button
                type="button"
                aria-label="Previous creator projects page"
                disabled={pageData.currentPage === 1}
                onClick={() => setProjectPage(Math.max(1, pageData.currentPage - 1))}
              >
                <ChevronLeft aria-hidden="true" size={17} strokeWidth={1.8} />
              </button>
              <span aria-live="polite" aria-atomic="true">
                {pageData.currentPage} / {pageData.totalPages}
              </span>
              <button
                type="button"
                aria-label="Next creator projects page"
                disabled={pageData.currentPage === pageData.totalPages}
                onClick={() => setProjectPage(Math.min(
                  pageData.totalPages,
                  pageData.currentPage + 1,
                ))}
              >
                <ChevronRight aria-hidden="true" size={17} strokeWidth={1.8} />
              </button>
            </nav>
          ) : null}
        </div>
      </header>

      {projectError ? <p className={styles.error} role="alert">{projectError}</p> : null}
      {phase === "error" && visibleProjects.length > 0 ? (
        <p className={styles.error} role="alert">
          Article controls are temporarily unavailable. Refresh to try again.
        </p>
      ) : null}

      {phase === "loading" && visibleProjects.length === 0 ? (
        <p className={styles.loading} role="status">Loading your verified launches…</p>
      ) : phase === "error" && visibleProjects.length === 0 ? (
        <p className={styles.error} role="alert">Your projects could not be verified right now.</p>
      ) : visibleProjects.length === 0 ? (
        <p className={styles.empty}>Your verified launches will appear here.</p>
      ) : (
        <div className={styles.list}>
          {pageData.items.map((project) => {
            const initialBuy = initialBuyByToken.get(
              project.tokenAddress.toLowerCase(),
            );
            const initialBuyLabel = initialBuy
              ? formatCreatorProjectInitialBuyV1(initialBuy, project.symbol)
              : null;
            return (
            <article className={styles.project} key={project.tokenAddress}>
              <div className={styles.art}>
                {project.imageUrl ? (
                  <Image src={project.imageUrl} alt="" fill sizes="64px" unoptimized />
                ) : <span aria-hidden="true">{project.symbol?.slice(0, 2) ?? "P"}</span>}
              </div>
              <div className={styles.copy}>
                <strong>{project.name}</strong>
                <span>{project.symbol ? `$${project.symbol}` : "Verified launch"}</span>
                {marketCapByToken.get(project.tokenAddress.toLowerCase())?.label ? (
                  <small>
                    Market cap {marketCapByToken.get(project.tokenAddress.toLowerCase())?.label}
                  </small>
                ) : null}
                {project.article ? <small>Updated {formatDate(project.article.updatedAt)}</small> : null}
                {initialBuyLabel ? (
                  <div className={styles.initialBuy}>
                    <small>{initialBuyLabel.amount}</small>
                    <small
                      className={styles.initialBuyStatus}
                      data-state={initialBuyLabel.state}
                    >
                      {initialBuyLabel.status}
                    </small>
                  </div>
                ) : null}
              </div>
              <div className={styles.actions}>
                {phase === "ready" &&
                editableTokens.has(project.tokenAddress.toLowerCase()) ? (
                  <button
                    type="button"
                    disabled={openingProject !== null}
                    onPointerEnter={() => warmEditor(project)}
                    onPointerDown={() => warmEditor(project)}
                    onFocus={() => warmEditor(project)}
                    onClick={(event) => void openEditor(project, event.currentTarget)}
                  >
                    {openingProject?.tokenAddress === project.tokenAddress
                      ? "Opening…"
                      : project.article ? "Edit article" : "Create article"}
                  </button>
                ) : null}
                <Link href={`/token/${project.tokenAddress}`}>View token</Link>
              </div>
            </article>
            );
          })}
        </div>
      )}

      {editor ? (
        <CreatorArticleEditor
          project={editor.project}
          initialArticle={editor.article}
          initialEtag={editor.etag}
          getAuthHeaders={getAuthHeaders}
          onClose={closeEditor}
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
      {openingProject ? (
        <CreatorArticleEditorOpening
          project={openingProject}
          onClose={closeOpeningEditor}
        />
      ) : null}
    </section>
  );
}

function CreatorArticleEditorOpening({
  project,
  onClose,
}: Readonly<{ project: CreatorProjectSummaryV1; onClose(): void }>) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previousOverflow = window.document.body.style.overflow;
    window.document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  if (typeof document === "undefined") return null;
  return createPortal((
    <div className={styles.openingBackdrop} role="presentation">
      <section
        className={styles.openingDialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="opening-creator-article-title"
      >
        <div className={styles.openingIdentity}>
          <div className={styles.openingArt}>
            {project.imageUrl ? (
              <Image src={project.imageUrl} alt="" fill sizes="48px" unoptimized />
            ) : <span aria-hidden="true">{project.symbol?.slice(0, 2) ?? "P"}</span>}
          </div>
          <div>
            <p>{project.symbol ? `$${project.symbol}` : "Verified project"}</p>
            <h2 id="opening-creator-article-title">Opening article…</h2>
          </div>
        </div>
        <span className={styles.openingProgress} aria-label="Loading" role="status" />
        <button ref={closeRef} type="button" aria-label="Cancel opening article" onClick={onClose}>
          <X aria-hidden="true" size={18} />
        </button>
      </section>
    </div>
  ), document.body);
}

export function paginateCreatorProjectsV1(
  projects: readonly CreatorProjectSummaryV1[],
  marketCaps: readonly CreatorProjectMarketCapV1[],
  requestedPage: number,
) {
  const byToken = new Map(
    marketCaps.map((marketCap) => [marketCap.tokenAddress.toLowerCase(), marketCap]),
  );
  const source = projects.some((project) =>
    unsignedMarketCap(byToken.get(project.tokenAddress.toLowerCase())?.usdWad) !== null)
    ? "usdWad"
    : "ethWei";
  const ordered = [...projects].sort((first, second) => {
    const firstCap = unsignedMarketCap(
      byToken.get(first.tokenAddress.toLowerCase())?.[source],
    );
    const secondCap = unsignedMarketCap(
      byToken.get(second.tokenAddress.toLowerCase())?.[source],
    );
    if (firstCap !== null && secondCap !== null && firstCap !== secondCap) {
      return firstCap > secondCap ? -1 : 1;
    }
    if (firstCap !== null) return -1;
    if (secondCap !== null) return 1;
    const nameOrder = first.name.localeCompare(second.name);
    return nameOrder !== 0
      ? nameOrder
      : first.tokenAddress.toLowerCase().localeCompare(second.tokenAddress.toLowerCase());
  });
  const totalPages = Math.max(1, Math.ceil(ordered.length / creatorProjectPageSize));
  const currentPage = Math.min(
    totalPages,
    Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1,
  );
  const offset = (currentPage - 1) * creatorProjectPageSize;
  return Object.freeze({
    currentPage,
    totalPages,
    items: Object.freeze(ordered.slice(offset, offset + creatorProjectPageSize)),
  });
}

export function mergeCreatorWalletProjectsV1(
  walletProjects: readonly CreatorProjectSummaryV1[],
  authenticatedProjects: readonly CreatorProjectSummaryV1[],
) {
  const byToken = new Map<string, CreatorProjectSummaryV1>();
  for (const project of walletProjects) {
    byToken.set(project.tokenAddress.toLowerCase(), project);
  }
  for (const project of authenticatedProjects) {
    byToken.set(project.tokenAddress.toLowerCase(), project);
  }
  return Object.freeze([...byToken.values()]);
}

export function formatCreatorProjectInitialBuyV1(
  initialBuy: CreatorProjectInitialBuyV1,
  symbol: string | null,
  now = Date.now(),
) {
  const ethAmount = Number(formatUnits(BigInt(initialBuy.ethAmountWei), 18));
  const tokenAmount = Number(formatUnits(
    BigInt(initialBuy.tokenAmountRaw),
    initialBuy.tokenDecimals,
  ));
  const ethLabel = Number.isFinite(ethAmount)
    ? new Intl.NumberFormat("en-US", { maximumSignificantDigits: 6 }).format(ethAmount)
    : formatUnits(BigInt(initialBuy.ethAmountWei), 18);
  const tokenLabel = Number.isFinite(tokenAmount)
    ? new Intl.NumberFormat("en-US", {
        compactDisplay: "short",
        maximumFractionDigits: 2,
        notation: "compact",
      }).format(tokenAmount)
    : formatUnits(BigInt(initialBuy.tokenAmountRaw), initialBuy.tokenDecimals);
  const ticker = symbol ? `$${symbol}` : "tokens";
  const date = (value: string) => new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(value));
  const releaseTime = Date.parse(initialBuy.releaseAt);
  const cliffTime = Date.parse(initialBuy.cliffAt);
  if (initialBuy.custodyMode === "unlocked") {
    return Object.freeze({
      amount: `Initial buy ${ethLabel} ETH → ${tokenLabel} ${ticker}`,
      status: "Unlocked at launch",
      state: "unlocked" as const,
    });
  }
  if (initialBuy.custodyMode === "fixed-lock") {
    return Object.freeze({
      amount: `Initial buy ${ethLabel} ETH → ${tokenLabel} ${ticker}`,
      status: now < releaseTime
        ? `Locked until ${date(initialBuy.releaseAt)}`
        : `Lock ended ${date(initialBuy.releaseAt)}`,
      state: now < releaseTime ? "locked" as const : "complete" as const,
    });
  }
  if (
    initialBuy.custodyMode === "cliff-linear" &&
    now < cliffTime
  ) {
    return Object.freeze({
      amount: `Initial buy ${ethLabel} ETH → ${tokenLabel} ${ticker}`,
      status: `Cliff until ${date(initialBuy.cliffAt)} · vests by ${date(initialBuy.releaseAt)}`,
      state: "locked" as const,
    });
  }
  return Object.freeze({
    amount: `Initial buy ${ethLabel} ETH → ${tokenLabel} ${ticker}`,
    status: now < releaseTime
      ? `Vesting until ${date(initialBuy.releaseAt)}`
      : `Vesting ended ${date(initialBuy.releaseAt)}`,
    state: now < releaseTime ? "vesting" as const : "complete" as const,
  });
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
  return isRecord(value) && typeof value.code === "string" && value.code
    ? `${value.code[0]?.toUpperCase() ?? ""}${value.code.slice(1).replaceAll("_", " ")}`
    : "Project request failed";
}

function unsignedMarketCap(value: string | null | undefined) {
  return value && /^(?:0|[1-9][0-9]*)$/u.test(value) && value.length <= 78
    ? BigInt(value)
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" })
    .format(new Date(value));
}
