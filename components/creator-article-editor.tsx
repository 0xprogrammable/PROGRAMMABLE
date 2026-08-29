"use client";

import Image from "next/image";
import {
  Node,
  type Editor,
  type JSONContent,
} from "@tiptap/core";
import {
  EditorContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
  useEditor,
} from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  Bold,
  Heading2,
  Heading3,
  ImagePlus,
  Italic,
  List,
  ListOrdered,
  Redo2,
  Undo2,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ChangeEvent,
} from "react";
import { createPortal } from "react-dom";

import { CreatorArticle } from "@/components/creator-article";
import { CreatorArticleLinkIcon } from "@/components/creator-article-link-icon";
import type { CreatorProjectSummaryV1 } from
  "@/components/creator-article-editor-loader";
import {
  CREATOR_ARTICLE_DRAFT_SCHEMA_V1,
  CREATOR_ARTICLE_SCHEMA_V1,
  parseCreatorArticleDraftV1,
  parseCreatorArticleV1,
  type CreatorArticleDraftV1,
  type CreatorArticleV1,
} from "@/lib/creator-article/contract-v1";
import {
  displayHttpsLinkV1,
  isAllowedArticleHrefV1,
  normalizeHttpsLinkV1,
} from "@/lib/creator-article/link";

import styles from "./creator-article-editor.module.css";

type AuthHeaders = Readonly<{
  Authorization: string;
  "X-Privy-Identity-Token"?: string;
}>;

type ArticleEditorProps = Readonly<{
  project: CreatorProjectSummaryV1;
  initialArticle: CreatorArticleV1 | null;
  initialEtag: string | null;
  getAuthHeaders(): Promise<AuthHeaders>;
  onClose(): void;
  onPublished(article: CreatorArticleV1): void;
}>;

type UploadedMedia = Readonly<{
  url: string;
  width: number;
  height: number;
  kind: "banner" | "inline";
}>;

type EditorNotice = Readonly<{
  tone: "error" | "success" | "warning" | "info";
  text: string;
}>;

const ArticleImageNode = Node.create({
  name: "articleImage",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      url: { default: "" },
      alt: { default: "" },
      caption: { default: null },
      width: { default: 1 },
      height: { default: 1 },
      size: { default: "content" },
      uploadId: { default: null },
      status: { default: "ready" },
    };
  },
  parseHTML() {
    return [{ tag: "figure[data-creator-article-image]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["figure", { "data-creator-article-image": "", ...HTMLAttributes }];
  },
  addNodeView() {
    return ReactNodeViewRenderer(ArticleImageEditorNode);
  },
});

function ArticleImageEditorNode({ node, selected, updateAttributes, deleteNode }: NodeViewProps) {
  const attrs = node.attrs as Record<string, unknown>;
  const status = attrs.status === "uploading" || attrs.status === "error"
    ? attrs.status
    : "ready";
  const size = attrs.size === "compact" || attrs.size === "wide"
    ? attrs.size
    : "content";
  const url = typeof attrs.url === "string" ? attrs.url : "";
  const alt = typeof attrs.alt === "string" ? attrs.alt : "";
  const caption = typeof attrs.caption === "string" ? attrs.caption : "";
  const width = Number.isSafeInteger(attrs.width) ? Number(attrs.width) : 1;
  const height = Number.isSafeInteger(attrs.height) ? Number(attrs.height) : 1;
  return (
    <NodeViewWrapper
      as="figure"
      className={`${styles.editorImage} ${styles[size]} ${selected ? styles.imageSelected : ""}`}
    >
      {status === "ready" && url ? (
        <Image src={url} alt={alt} width={width} height={height} unoptimized />
      ) : (
        <div className={styles.imageStatus} role="status">
          {status === "uploading" ? "Uploading image…" : "Image upload failed"}
        </div>
      )}
      <div className={styles.imageControls} contentEditable={false}>
        {(["compact", "content", "wide"] as const).map((value) => (
          <button
            type="button"
            aria-pressed={size === value}
            onClick={() => updateAttributes({ size: value })}
            key={value}
          >
            {value === "compact" ? "Small" : value === "content" ? "Medium" : "Wide"}
          </button>
        ))}
        <button type="button" onClick={deleteNode}>Remove</button>
      </div>
      {status === "ready" ? (
        <div className={styles.imageFields} contentEditable={false}>
          <label>
            <span>Image description</span>
            <input
              value={alt}
              maxLength={240}
              placeholder="Describe the image"
              onChange={(event) => updateAttributes({ alt: event.target.value })}
            />
          </label>
          <label>
            <span>Caption</span>
            <input
              value={caption}
              maxLength={500}
              placeholder="Optional caption"
              onChange={(event) => updateAttributes({ caption: event.target.value || null })}
            />
          </label>
        </div>
      ) : null}
    </NodeViewWrapper>
  );
}

export default function CreatorArticleEditor({
  project,
  initialArticle,
  initialEtag,
  getAuthHeaders,
  onClose,
  onPublished,
}: ArticleEditorProps) {
  const editorRef = useRef<Editor | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const requestCloseRef = useRef<() => void>(() => undefined);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(initialArticle?.title ?? "");
  const [bannerImage, setBannerImage] = useState(initialArticle?.bannerImage ?? null);
  const [document, setDocument] = useState<JSONContent>(
    initialArticle
      ? JSON.parse(JSON.stringify(initialArticle.document)) as JSONContent
      : emptyDocument(),
  );
  const [etag, setEtag] = useState(initialEtag);
  const [linkValue, setLinkValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploadingBanner, setUploadingBanner] = useState(false);
  const [uploadingCount, setUploadingCount] = useState(0);
  const [notice, setNotice] = useState<EditorNotice | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [discardArmed, setDiscardArmed] = useState(false);
  const portalTarget = useSyncExternalStore<HTMLElement | null>(
    subscribeToDocumentBody,
    getClientDocumentBody,
    getServerDocumentBody,
  );
  const publishedFingerprintRef = useRef(creatorArticleEditorFingerprintV1({
    title: initialArticle?.title ?? "",
    bannerImage: initialArticle?.bannerImage ?? null,
    document: initialArticle
      ? JSON.parse(JSON.stringify(initialArticle.document)) as JSONContent
      : emptyDocument(),
  }));

  const uploadMedia = useCallback(async (
    file: File,
    kind: "banner" | "inline",
  ): Promise<UploadedMedia> => {
    const form = new FormData();
    form.set("file", file);
    form.set("kind", kind);
    const response = await fetch(
      `/api/profile/projects/${project.tokenAddress}/article/media`,
      { method: "POST", headers: await getAuthHeaders(), body: form },
    );
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok || !isRecord(body) || !isRecord(body.media)) {
      throw new Error(readApiError(body));
    }
    const media = body.media;
    if (typeof media.url !== "string" || !isAllowedArticleHrefV1(media.url)
      || !Number.isSafeInteger(media.width) || Number(media.width) <= 0
      || !Number.isSafeInteger(media.height) || Number(media.height) <= 0
      || media.kind !== kind) throw new Error("The uploaded image is invalid");
    return {
      url: media.url,
      width: Number(media.width),
      height: Number(media.height),
      kind,
    };
  }, [getAuthHeaders, project.tokenAddress]);

  const uploadInlineImages = useCallback(async (files: readonly File[]) => {
    const activeEditor = editorRef.current;
    if (!activeEditor || files.length === 0) return;
    setNotice(null);
    setDiscardArmed(false);
    for (const file of files) {
      const uploadId = crypto.randomUUID();
      activeEditor.chain().focus().insertContent({
        type: "articleImage",
        attrs: {
          url: "",
          alt: readableFileName(file.name),
          caption: null,
          width: 1,
          height: 1,
          size: "content",
          uploadId,
          status: "uploading",
        },
      }).run();
      setUploadingCount((current) => current + 1);
      try {
        const media = await uploadMedia(file, "inline");
        updateImageNode(activeEditor, uploadId, {
          ...media,
          alt: readableFileName(file.name),
          caption: null,
          size: "content",
          status: "ready",
        });
      } catch (error) {
        updateImageNode(activeEditor, uploadId, { status: "error" });
        setNotice({
          tone: "error",
          text: error instanceof Error ? error.message : "Image upload failed",
        });
      } finally {
        setUploadingCount((current) => Math.max(0, current - 1));
      }
    }
  }, [uploadMedia]);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        link: {
          autolink: true,
          linkOnPaste: true,
          defaultProtocol: "https",
          openOnClick: false,
          isAllowedUri: (url) => isAllowedArticleHrefV1(url),
          shouldAutoLink: (url) => isAllowedArticleHrefV1(url),
        },
      }),
      ArticleImageNode,
    ],
    content: document,
    editorProps: {
      attributes: {
        class: styles.prose,
        "aria-label": "Project article",
      },
      handlePaste: (_view, event) => {
        const imageFiles = [...(event.clipboardData?.files ?? [])]
          .filter((file) => file.type.startsWith("image/"));
        if (imageFiles.length > 0) {
          event.preventDefault();
          void uploadInlineImages(imageFiles);
          return true;
        }
        const standaloneLink = standaloneArticleLinkPasteV1(
          event.clipboardData?.getData("text/plain") ?? "",
        );
        if (standaloneLink) {
          event.preventDefault();
          editorRef.current?.chain().focus().insertContent({
            type: "text",
            text: standaloneLink.text,
            marks: [{ type: "link", attrs: { href: standaloneLink.href } }],
          }).run();
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: activeEditor }) => {
      setDocument(activeEditor.getJSON());
      setNotice(null);
      setDiscardArmed(false);
    },
  });
  useEffect(() => {
    editorRef.current = editor;
    return () => {
      if (editorRef.current === editor) editorRef.current = null;
    };
  }, [editor]);

  const requestClose = useCallback(() => {
    const fingerprint = creatorArticleEditorFingerprintV1({
      title,
      bannerImage,
      document: editorRef.current?.getJSON() ?? document,
    });
    if (fingerprint === publishedFingerprintRef.current) {
      onClose();
      return;
    }
    setDiscardArmed(true);
    setNotice({
      tone: "warning",
      text: "Discard your unpublished changes?",
    });
  }, [bannerImage, document, onClose, title]);
  useEffect(() => {
    requestCloseRef.current = requestClose;
  }, [requestClose]);

  useEffect(() => {
    if (portalTarget === null) return;
    const previouslyFocused = window.document.activeElement instanceof HTMLElement
      ? window.document.activeElement
      : null;
    const previousOverflow = window.document.body.style.overflow;
    window.document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    const inertedElements: HTMLElement[] = [];
    let activeLayer = dialogRef.current?.parentElement;
    while (activeLayer?.parentElement && activeLayer !== window.document.body) {
      for (const sibling of activeLayer.parentElement.children) {
        if (sibling !== activeLayer && sibling instanceof HTMLElement && !sibling.inert) {
          sibling.inert = true;
          inertedElements.push(sibling);
        }
      }
      activeLayer = activeLayer.parentElement;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        requestCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [contenteditable="true"], [tabindex]:not([tabindex="-1"])',
      )).filter((element) => !element.hidden && element.getClientRects().length > 0);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && window.document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && window.document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.document.body.style.overflow = previousOverflow;
      for (const element of inertedElements) element.inert = false;
      window.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus({ preventScroll: true });
    };
  }, [portalTarget]);

  const preview = useMemo(() => {
    try {
      const draft = createDraft(project, title, bannerImage, document);
      return parseCreatorArticleV1({
        ...draft,
        schemaVersion: CREATOR_ARTICLE_SCHEMA_V1,
        revision: initialArticle?.revision ?? 1,
        status: "published",
        createdAt: initialArticle?.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    } catch {
      return null;
    }
  }, [bannerImage, document, initialArticle, project, title]);

  async function selectBanner(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setUploadingBanner(true);
    setUploadingCount((current) => current + 1);
    setNotice({ tone: "info", text: "Uploading cover image…" });
    setDiscardArmed(false);
    try {
      const media = await uploadMedia(file, "banner");
      setBannerImage({
        url: media.url,
        alt: `${project.name} article cover`,
        caption: null,
        width: media.width,
        height: media.height,
        size: "wide",
      });
    } catch (error) {
      setNotice({
        tone: "error",
        text: error instanceof Error ? error.message : "Banner upload failed",
      });
    } finally {
      setUploadingBanner(false);
      setUploadingCount((current) => Math.max(0, current - 1));
    }
  }

  async function publish() {
    setSaving(true);
    setNotice(null);
    setDiscardArmed(false);
    try {
      const draft = createDraft(project, title, bannerImage, editor?.getJSON() ?? document);
      const response = await fetch(
        `/api/profile/projects/${project.tokenAddress}/article`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            ...(etag ? { "If-Match": etag } : { "If-None-Match": "*" }),
            ...(await getAuthHeaders()),
          },
          body: JSON.stringify(draft),
        },
      );
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(response.status === 412
          ? "A newer version was published. Copy your draft or reload before saving."
          : readApiError(body));
      }
      if (!isRecord(body)) throw new Error("The published article is invalid");
      const article = parseCreatorArticleV1(body.article);
      const nextEtag = response.headers.get("etag");
      if (!nextEtag) throw new Error("The published revision could not be verified");
      setEtag(nextEtag);
      publishedFingerprintRef.current = creatorArticleEditorFingerprintV1({
        title,
        bannerImage,
        document: editor?.getJSON() ?? document,
      });
      setNotice({ tone: "success", text: "Published" });
      onPublished(article);
    } catch (error) {
      setNotice({
        tone: "error",
        text: error instanceof Error ? error.message : "Article could not be published",
      });
    } finally {
      setSaving(false);
    }
  }

  function applySocial() {
    if (!editor) return;
    if (!linkValue.trim()) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    try {
      const href = normalizeHttpsLinkV1(linkValue);
      if (editor.state.selection.empty) {
        editor.chain().focus().insertContent({
          type: "text",
          text: displayHttpsLinkV1(href),
          marks: [{ type: "link", attrs: { href } }],
        }).run();
      } else {
        editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
      }
      setLinkValue("");
      setNotice(null);
    } catch {
      setNotice({ tone: "error", text: "Use a complete HTTPS link" });
    }
  }

  function togglePreview() {
    if (showPreview) {
      setShowPreview(false);
      return;
    }
    if (!preview) {
      setNotice({
        tone: "error",
        text: "Add a title and article content before previewing.",
      });
      return;
    }
    setNotice(null);
    setShowPreview(true);
  }

  if (portalTarget === null) return null;
  return createPortal((
    <div
      className={styles.backdrop}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <section
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="article-editor-title"
        aria-describedby={notice ? "article-editor-notice" : undefined}
      >
        <header className={styles.dialogHeader}>
          <div className={styles.dialogIdentity}>
            <div className={styles.dialogArt}>
              {project.imageUrl ? (
                <Image src={project.imageUrl} alt="" fill sizes="42px" unoptimized />
              ) : (
                <span aria-hidden="true">{project.symbol?.slice(0, 2) ?? "P"}</span>
              )}
            </div>
            <div>
              <p>{project.symbol ? `$${project.symbol}` : "Verified project"}</p>
              <h2 id="article-editor-title">{initialArticle ? "Edit article" : "Create article"}</h2>
            </div>
          </div>
          <button ref={closeButtonRef} type="button" aria-label="Close article editor" onClick={requestClose}><X aria-hidden="true" /></button>
        </header>

        <div className={styles.toolbar}>
          <ToolbarButton label="Normal" active={editor?.isActive("paragraph") ?? false} onClick={() => editor?.chain().focus().unsetAllMarks().setParagraph().run()} />
          <ToolbarIcon label="Bold" active={editor?.isActive("bold") ?? false} onClick={() => editor?.chain().focus().toggleBold().run()}><Bold /></ToolbarIcon>
          <ToolbarIcon label="Italic" active={editor?.isActive("italic") ?? false} onClick={() => editor?.chain().focus().toggleItalic().run()}><Italic /></ToolbarIcon>
          <ToolbarIcon label="Heading 2" active={editor?.isActive("heading", { level: 2 }) ?? false} onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 /></ToolbarIcon>
          <ToolbarIcon label="Heading 3" active={editor?.isActive("heading", { level: 3 }) ?? false} onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}><Heading3 /></ToolbarIcon>
          <ToolbarIcon label="Bullet list" active={editor?.isActive("bulletList") ?? false} onClick={() => editor?.chain().focus().toggleBulletList().run()}><List /></ToolbarIcon>
          <ToolbarIcon label="Numbered list" active={editor?.isActive("orderedList") ?? false} onClick={() => editor?.chain().focus().toggleOrderedList().run()}><ListOrdered /></ToolbarIcon>
          <ToolbarIcon label="Undo" disabled={!editor?.can().undo()} onClick={() => editor?.chain().focus().undo().run()}><Undo2 /></ToolbarIcon>
          <ToolbarIcon label="Redo" disabled={!editor?.can().redo()} onClick={() => editor?.chain().focus().redo().run()}><Redo2 /></ToolbarIcon>
          <input ref={imageInputRef} hidden type="file" multiple accept="image/png,image/jpeg,image/webp,image/avif" onChange={(event) => {
            const files = [...(event.target.files ?? [])];
            event.target.value = "";
            void uploadInlineImages(files);
          }} />
          <ToolbarIcon label="Add image" onClick={() => imageInputRef.current?.click()}><ImagePlus /></ToolbarIcon>
          <div className={styles.linkControl}>
            <CreatorArticleLinkIcon href={linkValue} className={styles.linkProviderIcon} />
            <input
              value={linkValue}
              aria-label="Link URL"
              inputMode="url"
              placeholder="Website or social link"
              onChange={(event) => setLinkValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") { event.preventDefault(); applySocial(); }
              }}
            />
            <button
              type="button"
              disabled={!linkValue.trim()}
              onClick={applySocial}
            >Add link</button>
          </div>
        </div>

        <div className={styles.editorLayout}>
          <div className={styles.editorPane}>
            <label className={styles.titleField}>
              <span>Title</span>
              <input
                value={title}
                maxLength={120}
                placeholder="Tell your project story"
                onChange={(event) => {
                  setTitle(event.target.value);
                  setNotice(null);
                  setDiscardArmed(false);
                }}
              />
            </label>

            <div className={styles.bannerField}>
              <span>Cover image · 3:1</span>
              {bannerImage ? (
                <div className={styles.bannerPreview}>
                  <Image src={bannerImage.url} alt={bannerImage.alt} width={bannerImage.width} height={bannerImage.height} unoptimized />
                  <button type="button" onClick={() => setBannerImage(null)}>Remove cover</button>
                </div>
              ) : null}
              <input ref={bannerInputRef} hidden type="file" accept="image/png,image/jpeg,image/webp,image/avif" onChange={selectBanner} />
              <button className={styles.coverButton} type="button" disabled={uploadingBanner} onClick={() => bannerInputRef.current?.click()}>
                <ImagePlus aria-hidden="true" size={16} /> {uploadingBanner ? "Uploading cover…" : bannerImage ? "Replace cover" : "Add cover"}
              </button>
            </div>

            <EditorContent editor={editor} />
          </div>

          {showPreview && preview ? (
            <div className={styles.previewPane}>
              <CreatorArticle article={preview} />
            </div>
          ) : null}
        </div>

        <footer className={styles.dialogFooter}>
          <p
            id="article-editor-notice"
            data-tone={notice?.tone}
            role={notice?.tone === "error" || notice?.tone === "warning" ? "alert" : "status"}
          >{notice?.text ?? ""}</p>
          {discardArmed ? (
            <div>
              <button type="button" onClick={() => { setDiscardArmed(false); setNotice(null); }}>Keep editing</button>
              <button className={styles.danger} type="button" onClick={onClose}>Discard changes</button>
            </div>
          ) : (
            <div>
              <button type="button" onClick={togglePreview}>{showPreview ? "Hide preview" : "Preview"}</button>
              <button type="button" onClick={requestClose}>Discard changes</button>
              <button className={styles.publish} type="button" disabled={saving || uploadingCount > 0 || !preview} onClick={() => void publish()}>
                {saving ? "Publishing…" : uploadingCount > 0 ? "Uploading…" : "Publish article"}
              </button>
            </div>
          )}
        </footer>
      </section>
    </div>
  ), portalTarget);
}

function ToolbarButton({ label, active = false, onClick }: Readonly<{
  label: string;
  active?: boolean;
  onClick(): void;
}>) {
  return <button type="button" aria-pressed={active} onClick={onClick}>{label}</button>;
}

function ToolbarIcon({ label, active = false, disabled = false, onClick, children }: Readonly<{
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick(): void;
  children: React.ReactNode;
}>) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function createDraft(
  project: CreatorProjectSummaryV1,
  title: string,
  bannerImage: CreatorArticleV1["bannerImage"],
  document: JSONContent,
): CreatorArticleDraftV1 {
  return parseCreatorArticleDraftV1({
    schemaVersion: CREATOR_ARTICLE_DRAFT_SCHEMA_V1,
    chainId: project.chainId,
    tokenAddress: project.tokenAddress,
    title,
    bannerImage,
    document: cleanCreatorArticleEditorDocumentV1(document),
  });
}

export function cleanCreatorArticleEditorDocumentV1(value: JSONContent): unknown {
  if (value.type === "articleImage") {
    const attrs = value.attrs ?? {};
    if (attrs.status !== "ready") throw new TypeError("Wait for image uploads to finish");
    return {
      type: "articleImage",
      attrs: {
        url: attrs.url,
        alt: attrs.alt,
        caption: attrs.caption ?? null,
        width: attrs.width,
        height: attrs.height,
        size: attrs.size,
      },
    };
  }
  const result: Record<string, unknown> = { type: value.type };
  if (value.attrs !== undefined) {
    result.attrs = value.type === "heading" ? { level: value.attrs.level } : value.attrs;
  }
  let normalizedMarks: unknown[] | undefined;
  if (value.marks !== undefined) {
    normalizedMarks = value.marks.map((mark) => mark.type === "link"
      ? { type: "link", attrs: { href: mark.attrs?.href } }
      : { type: mark.type });
    result.marks = normalizedMarks;
  }
  if (value.text !== undefined) {
    result.text = readableAutolinkTextV1(value.text, normalizedMarks);
  }
  if (value.content !== undefined) {
    result.content = value.content.map(cleanCreatorArticleEditorDocumentV1);
  }
  return result;
}

export function creatorArticleEditorFingerprintV1(value: unknown) {
  if (!isRecord(value)
    || typeof value.title !== "string"
    || !("bannerImage" in value)
    || !isRecord(value.document)) {
    throw new TypeError("Creator article editor snapshot is invalid");
  }
  return JSON.stringify({
    title: value.title,
    bannerImage: value.bannerImage,
    document: normalizeEditorFingerprintDocumentV1(value.document),
  });
}

function normalizeEditorFingerprintDocumentV1(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeEditorFingerprintDocumentV1);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, candidate]) => {
      if (key === "attrs" && value.type === "link" && isRecord(candidate)) {
        return [key, { href: candidate.href }];
      }
      if (key !== "attrs" || value.type !== "articleImage" || !isRecord(candidate)) {
        return [key, normalizeEditorFingerprintDocumentV1(candidate)];
      }
      return [key, Object.fromEntries(Object.entries(candidate).flatMap(([attribute, current]) => {
        if (attribute === "uploadId" || (attribute === "status" && current === "ready")) return [];
        return [[attribute, normalizeEditorFingerprintDocumentV1(current)]];
      }))];
    }));
}

function emptyDocument(): JSONContent {
  return {
    type: "doc",
    content: [{ type: "paragraph" }],
  };
}

export function standaloneArticleLinkPasteV1(value: string): Readonly<{
  href: string;
  text: string;
}> | null {
  const raw = value.trim();
  if (!raw || /\s/u.test(raw) || !isAllowedArticleHrefV1(raw)) return null;
  const href = normalizeHttpsLinkV1(raw);
  return Object.freeze({ href, text: displayHttpsLinkV1(href) });
}

function updateImageNode(editor: Editor, uploadId: string, attrs: Record<string, unknown>) {
  let position: number | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "articleImage" && node.attrs.uploadId === uploadId) {
      position = pos;
      return false;
    }
    return true;
  });
  if (position === null) return;
  const node = editor.state.doc.nodeAt(position);
  if (!node) return;
  editor.view.dispatch(editor.state.tr.setNodeMarkup(position, undefined, {
    ...node.attrs,
    ...attrs,
  }));
}

function readableFileName(value: string) {
  const name = value.replace(/\.[^.]+$/u, "").replace(/[-_]+/gu, " ").trim();
  return name || "Project image";
}

function readableAutolinkTextV1(value: string, marks: unknown[] | undefined) {
  if (!isAllowedArticleHrefV1(value) || !marks) return value;
  const link = marks.find((mark) => isRecord(mark)
    && mark.type === "link"
    && isRecord(mark.attrs)
    && typeof mark.attrs.href === "string");
  if (!isRecord(link) || !isRecord(link.attrs)
    || typeof link.attrs.href !== "string") return value;
  try {
    return normalizeHttpsLinkV1(value) === normalizeHttpsLinkV1(link.attrs.href)
      ? displayHttpsLinkV1(value)
      : value;
  } catch {
    return value;
  }
}

function readApiError(value: unknown) {
  return isRecord(value) && typeof value.code === "string"
    ? value.code.replaceAll("_", " ")
    : "The request could not be completed";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function subscribeToDocumentBody() {
  return () => undefined;
}

function getClientDocumentBody(): HTMLElement | null {
  return window.document.body;
}

function getServerDocumentBody(): HTMLElement | null {
  return null;
}
