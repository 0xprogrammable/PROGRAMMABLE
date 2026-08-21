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
  Link as LinkIcon,
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
  type ChangeEvent,
} from "react";

import { CreatorArticle } from "@/components/creator-article";
import type { CreatorProjectSummaryV1 } from "@/components/profile-projects";
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
  "X-Privy-Identity-Token": string;
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
  const [uploadingCount, setUploadingCount] = useState(0);
  const [message, setMessage] = useState("");
  const [showPreview, setShowPreview] = useState(false);

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
    setMessage("");
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
        setMessage(error instanceof Error ? error.message : "Image upload failed");
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
      setMessage("");
    },
  });
  useEffect(() => {
    editorRef.current = editor;
    return () => {
      if (editorRef.current === editor) editorRef.current = null;
    };
  }, [editor]);

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
    setUploadingCount((current) => current + 1);
    setMessage("");
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
      setMessage(error instanceof Error ? error.message : "Banner upload failed");
    } finally {
      setUploadingCount((current) => Math.max(0, current - 1));
    }
  }

  async function publish() {
    setSaving(true);
    setMessage("");
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
      setMessage("Published");
      onPublished(article);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Article could not be published");
    } finally {
      setSaving(false);
    }
  }

  function applyLink() {
    if (!editor) return;
    if (!linkValue.trim()) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    try {
      const href = normalizeHttpsLinkV1(linkValue);
      editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
      setLinkValue("");
      setMessage("");
    } catch {
      setMessage("Use a complete HTTPS link");
    }
  }

  return (
    <div className={styles.backdrop} role="presentation">
      <section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="article-editor-title">
        <header className={styles.dialogHeader}>
          <div>
            <p>{project.symbol ? `$${project.symbol}` : "Verified project"}</p>
            <h2 id="article-editor-title">{initialArticle ? "Edit article" : "Create article"}</h2>
          </div>
          <button type="button" aria-label="Close article editor" onClick={onClose}><X aria-hidden="true" /></button>
        </header>

        <div className={styles.editorLayout}>
          <div className={styles.editorPane}>
            <label className={styles.titleField}>
              <span>Title</span>
              <input
                value={title}
                maxLength={120}
                placeholder="Tell people what this project is about"
                onChange={(event) => { setTitle(event.target.value); setMessage(""); }}
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
              <button className={styles.coverButton} type="button" onClick={() => bannerInputRef.current?.click()}>
                <ImagePlus aria-hidden="true" size={16} /> {bannerImage ? "Replace cover" : "Add cover"}
              </button>
            </div>

            <div className={styles.toolbar} role="toolbar" aria-label="Article formatting">
              <ToolbarButton label="Normal" active={editor?.isActive("paragraph") ?? false} onClick={() => editor?.chain().focus().unsetAllMarks().setParagraph().run()} />
              <ToolbarIcon label="Bold" active={editor?.isActive("bold") ?? false} onClick={() => editor?.chain().focus().toggleBold().run()}><Bold /></ToolbarIcon>
              <ToolbarIcon label="Italic" active={editor?.isActive("italic") ?? false} onClick={() => editor?.chain().focus().toggleItalic().run()}><Italic /></ToolbarIcon>
              <ToolbarIcon label="Heading 2" active={editor?.isActive("heading", { level: 2 }) ?? false} onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 /></ToolbarIcon>
              <ToolbarIcon label="Heading 3" active={editor?.isActive("heading", { level: 3 }) ?? false} onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}><Heading3 /></ToolbarIcon>
              <ToolbarIcon label="Bullet list" active={editor?.isActive("bulletList") ?? false} onClick={() => editor?.chain().focus().toggleBulletList().run()}><List /></ToolbarIcon>
              <ToolbarIcon label="Numbered list" active={editor?.isActive("orderedList") ?? false} onClick={() => editor?.chain().focus().toggleOrderedList().run()}><ListOrdered /></ToolbarIcon>
              <ToolbarIcon label="Undo" onClick={() => editor?.chain().focus().undo().run()}><Undo2 /></ToolbarIcon>
              <ToolbarIcon label="Redo" onClick={() => editor?.chain().focus().redo().run()}><Redo2 /></ToolbarIcon>
              <input ref={imageInputRef} hidden type="file" multiple accept="image/png,image/jpeg,image/webp,image/avif" onChange={(event) => {
                const files = [...(event.target.files ?? [])];
                event.target.value = "";
                void uploadInlineImages(files);
              }} />
              <ToolbarIcon label="Add image" onClick={() => imageInputRef.current?.click()}><ImagePlus /></ToolbarIcon>
              <div className={styles.linkControl}>
                <LinkIcon aria-hidden="true" size={15} />
                <input value={linkValue} inputMode="url" placeholder="https://domain.com" onChange={(event) => setLinkValue(event.target.value)} onKeyDown={(event) => {
                  if (event.key === "Enter") { event.preventDefault(); applyLink(); }
                }} />
                <button type="button" onClick={applyLink}>Apply</button>
              </div>
            </div>

            <EditorContent editor={editor} />
            <p className={styles.pasteHint}>Paste an image anywhere with CMD‑V or Ctrl‑V. Images keep their proportions on every screen.</p>
          </div>

          {showPreview && preview ? (
            <div className={styles.previewPane}>
              <CreatorArticle article={preview} />
            </div>
          ) : null}
        </div>

        <footer className={styles.dialogFooter}>
          <p role={message && message !== "Published" ? "alert" : "status"}>{message}</p>
          <div>
            <button type="button" onClick={() => setShowPreview((value) => !value)}>{showPreview ? "Hide preview" : "Preview"}</button>
            <button type="button" onClick={onClose}>Discard</button>
            <button className={styles.publish} type="button" disabled={saving || uploadingCount > 0 || !preview} onClick={() => void publish()}>
              {saving ? "Publishing…" : uploadingCount > 0 ? "Uploading…" : "Publish article"}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

function ToolbarButton({ label, active = false, onClick }: Readonly<{
  label: string;
  active?: boolean;
  onClick(): void;
}>) {
  return <button type="button" aria-pressed={active} onClick={onClick}>{label}</button>;
}

function ToolbarIcon({ label, active = false, onClick, children }: Readonly<{
  label: string;
  active?: boolean;
  onClick(): void;
  children: React.ReactNode;
}>) {
  return (
    <button type="button" aria-label={label} title={label} aria-pressed={active} onClick={onClick}>
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
  if (value.text !== undefined) result.text = value.text;
  if (value.attrs !== undefined) {
    result.attrs = value.type === "heading" ? { level: value.attrs.level } : value.attrs;
  }
  if (value.marks !== undefined) {
    result.marks = value.marks.map((mark) => mark.type === "link"
      ? { type: "link", attrs: { href: mark.attrs?.href } }
      : { type: mark.type });
  }
  if (value.content !== undefined) {
    result.content = value.content.map(cleanCreatorArticleEditorDocumentV1);
  }
  return result;
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

function readApiError(value: unknown) {
  return isRecord(value) && typeof value.code === "string"
    ? value.code.replaceAll("_", " ")
    : "The request could not be completed";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
