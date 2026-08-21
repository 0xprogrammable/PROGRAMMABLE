import { getAddress, isAddress } from "viem";

import { normalizeHttpsLinkV1 } from "./link";
import {
  assertCreatorArticleMediaBindingV1,
  type CreatorArticleMediaKindV1,
} from "./media";

export const CREATOR_ARTICLE_SCHEMA_V1 =
  "programmable.creator-article.v1" as const;
export const CREATOR_ARTICLE_DRAFT_SCHEMA_V1 =
  "programmable.creator-article-draft.v1" as const;

export type CreatorArticleImageSizeV1 = "compact" | "content" | "wide";

export type CreatorArticleImageV1 = Readonly<{
  url: string;
  alt: string;
  caption: string | null;
  width: number;
  height: number;
  size: CreatorArticleImageSizeV1;
}>;

export type CreatorArticleMarkV1 =
  | Readonly<{ type: "bold" }>
  | Readonly<{ type: "italic" }>
  | Readonly<{ type: "link"; attrs: Readonly<{ href: string }> }>;

export type CreatorArticleInlineV1 =
  | Readonly<{
      type: "text";
      text: string;
      marks?: readonly CreatorArticleMarkV1[];
    }>
  | Readonly<{ type: "hardBreak" }>;

export type CreatorArticleParagraphV1 = Readonly<{
  type: "paragraph";
  content?: readonly CreatorArticleInlineV1[];
}>;

export type CreatorArticleHeadingV1 = Readonly<{
  type: "heading";
  attrs: Readonly<{ level: 2 | 3 }>;
  content: readonly CreatorArticleInlineV1[];
}>;

export type CreatorArticleListItemV1 = Readonly<{
  type: "listItem";
  content: readonly CreatorArticleParagraphV1[];
}>;

export type CreatorArticleListV1 = Readonly<{
  type: "bulletList" | "orderedList";
  content: readonly CreatorArticleListItemV1[];
}>;

export type CreatorArticleImageNodeV1 = Readonly<{
  type: "articleImage";
  attrs: CreatorArticleImageV1;
}>;

export type CreatorArticleBlockV1 =
  | CreatorArticleParagraphV1
  | CreatorArticleHeadingV1
  | CreatorArticleListV1
  | CreatorArticleImageNodeV1;

export type CreatorArticleDocumentV1 = Readonly<{
  type: "doc";
  content: readonly CreatorArticleBlockV1[];
}>;

export type CreatorArticleDraftV1 = Readonly<{
  schemaVersion: typeof CREATOR_ARTICLE_DRAFT_SCHEMA_V1;
  chainId: 1;
  tokenAddress: `0x${string}`;
  title: string;
  bannerImage: CreatorArticleImageV1 | null;
  document: CreatorArticleDocumentV1;
}>;

export type CreatorArticleV1 = Readonly<{
  schemaVersion: typeof CREATOR_ARTICLE_SCHEMA_V1;
  chainId: 1;
  tokenAddress: `0x${string}`;
  revision: number;
  status: "published";
  title: string;
  bannerImage: CreatorArticleImageV1 | null;
  document: CreatorArticleDocumentV1;
  createdAt: string;
  updatedAt: string;
}>;

const MAX_BLOCKS = 160;
const MAX_NODES = 500;
const MAX_TEXT_BYTES = 80_000;

type ParseBudget = { nodes: number; textBytes: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
) {
  const present = Object.keys(value);
  const allowed = new Set([...required, ...optional]);
  if (
    required.some((key) => !Object.prototype.hasOwnProperty.call(value, key))
    || present.some((key) => !allowed.has(key))
  ) throw new TypeError("Creator article shape is invalid");
}

function boundedString(
  value: unknown,
  label: string,
  maximumBytes: number,
  options: Readonly<{ allowEmpty?: boolean; singleLine?: boolean }> = {},
) {
  if (typeof value !== "string") throw new TypeError(`${label} is invalid`);
  const normalized = value.normalize("NFC");
  if (
    (!options.allowEmpty && normalized.trim() === "")
    || Buffer.byteLength(normalized, "utf8") > maximumBytes
    || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(normalized)
    || (options.singleLine && /[\r\n]/u.test(normalized))
  ) throw new TypeError(`${label} is invalid`);
  return normalized;
}

function parsePositiveInteger(value: unknown, label: string, maximum: number) {
  if (!Number.isSafeInteger(value) || Number(value) <= 0 || Number(value) > maximum) {
    throw new TypeError(`${label} is invalid`);
  }
  return Number(value);
}

function parseImage(
  value: unknown,
  tokenAddress: `0x${string}`,
  kind: CreatorArticleMediaKindV1,
): CreatorArticleImageV1 {
  if (!isRecord(value)) throw new TypeError("Article image is invalid");
  exactKeys(value, ["url", "alt", "caption", "width", "height", "size"]);
  const size = value.size;
  if (size !== "compact" && size !== "content" && size !== "wide") {
    throw new TypeError("Article image size is invalid");
  }
  const caption = value.caption === null
    ? null
    : boundedString(value.caption, "Article image caption", 1_000, {
        allowEmpty: true,
      });
  const url = normalizeHttpsLinkV1(boundedString(value.url, "Article image URL", 2_048));
  const width = parsePositiveInteger(value.width, "Article image width", 6_000);
  const height = parsePositiveInteger(value.height, "Article image height", 6_000);
  assertCreatorArticleMediaBindingV1({ url, tokenAddress, kind, width, height });
  return Object.freeze({
    url,
    alt: boundedString(value.alt, "Article image alt text", 480, {
      singleLine: true,
    }).trim(),
    caption: caption?.trim() || null,
    width,
    height,
    size,
  });
}

function addBudget(budget: ParseBudget, text = "") {
  budget.nodes += 1;
  budget.textBytes += Buffer.byteLength(text, "utf8");
  if (budget.nodes > MAX_NODES || budget.textBytes > MAX_TEXT_BYTES) {
    throw new TypeError("Creator article is too large");
  }
}

function parseMarks(value: unknown): readonly CreatorArticleMarkV1[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0 || value.length > 3) {
    throw new TypeError("Article text marks are invalid");
  }
  const seen = new Set<string>();
  const marks = value.map((candidate): CreatorArticleMarkV1 => {
    if (!isRecord(candidate) || typeof candidate.type !== "string") {
      throw new TypeError("Article text mark is invalid");
    }
    if (seen.has(candidate.type)) throw new TypeError("Article text mark is duplicated");
    seen.add(candidate.type);
    if (candidate.type === "bold" || candidate.type === "italic") {
      exactKeys(candidate, ["type"]);
      return Object.freeze({ type: candidate.type });
    }
    if (candidate.type === "link") {
      exactKeys(candidate, ["type", "attrs"]);
      if (!isRecord(candidate.attrs)) throw new TypeError("Article link is invalid");
      exactKeys(candidate.attrs, ["href"]);
      return Object.freeze({
        type: "link",
        attrs: Object.freeze({
          href: normalizeHttpsLinkV1(String(candidate.attrs.href)),
        }),
      });
    }
    throw new TypeError("Article text mark is not supported");
  });
  return Object.freeze(marks);
}

function parseInline(value: unknown, budget: ParseBudget): CreatorArticleInlineV1 {
  if (!isRecord(value) || typeof value.type !== "string") {
    throw new TypeError("Article inline node is invalid");
  }
  if (value.type === "hardBreak") {
    exactKeys(value, ["type"]);
    addBudget(budget);
    return Object.freeze({ type: "hardBreak" });
  }
  if (value.type !== "text") throw new TypeError("Article inline node is not supported");
  exactKeys(value, ["type", "text"], ["marks"]);
  const text = boundedString(value.text, "Article text", 20_000, { allowEmpty: true });
  if (text.length === 0) throw new TypeError("Article text is invalid");
  addBudget(budget, text);
  const marks = parseMarks(value.marks);
  return Object.freeze({
    type: "text",
    text,
    ...(marks ? { marks } : {}),
  });
}

function parseInlineContent(
  value: unknown,
  budget: ParseBudget,
  allowEmpty: boolean,
) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || value.length > 300) {
    throw new TypeError("Article inline content is invalid");
  }
  return Object.freeze(value.map((candidate) => parseInline(candidate, budget)));
}

function parseParagraph(
  value: unknown,
  budget: ParseBudget,
): CreatorArticleParagraphV1 {
  if (!isRecord(value) || value.type !== "paragraph") {
    throw new TypeError("Article paragraph is invalid");
  }
  exactKeys(value, ["type"], ["content"]);
  addBudget(budget);
  const content = value.content === undefined
    ? undefined
    : parseInlineContent(value.content, budget, true);
  return Object.freeze({ type: "paragraph", ...(content ? { content } : {}) });
}

function parseBlock(
  value: unknown,
  budget: ParseBudget,
  tokenAddress: `0x${string}`,
): CreatorArticleBlockV1 {
  if (!isRecord(value) || typeof value.type !== "string") {
    throw new TypeError("Article block is invalid");
  }
  if (value.type === "paragraph") return parseParagraph(value, budget);
  if (value.type === "articleImage") {
    exactKeys(value, ["type", "attrs"]);
    addBudget(budget);
    return Object.freeze({
      type: "articleImage",
      attrs: parseImage(value.attrs, tokenAddress, "inline"),
    });
  }
  if (value.type === "heading") {
    exactKeys(value, ["type", "attrs", "content"]);
    if (!isRecord(value.attrs)) throw new TypeError("Article heading is invalid");
    exactKeys(value.attrs, ["level"]);
    const level = value.attrs.level;
    if (level !== 2 && level !== 3) throw new TypeError("Article heading level is invalid");
    addBudget(budget);
    return Object.freeze({
      type: "heading",
      attrs: Object.freeze({ level }),
      content: parseInlineContent(value.content, budget, false),
    });
  }
  if (value.type === "bulletList" || value.type === "orderedList") {
    exactKeys(value, ["type", "content"]);
    if (!Array.isArray(value.content) || value.content.length === 0 || value.content.length > 80) {
      throw new TypeError("Article list is invalid");
    }
    addBudget(budget);
    const content = value.content.map((item): CreatorArticleListItemV1 => {
      if (!isRecord(item) || item.type !== "listItem") {
        throw new TypeError("Article list item is invalid");
      }
      exactKeys(item, ["type", "content"]);
      if (!Array.isArray(item.content) || item.content.length === 0 || item.content.length > 8) {
        throw new TypeError("Article list item is invalid");
      }
      addBudget(budget);
      return Object.freeze({
        type: "listItem",
        content: Object.freeze(item.content.map((node) => parseParagraph(node, budget))),
      });
    });
    return Object.freeze({ type: value.type, content: Object.freeze(content) });
  }
  throw new TypeError("Article block is not supported");
}

function parseDocument(
  value: unknown,
  tokenAddress: `0x${string}`,
): CreatorArticleDocumentV1 {
  if (!isRecord(value) || value.type !== "doc") {
    throw new TypeError("Article document is invalid");
  }
  exactKeys(value, ["type", "content"]);
  if (!Array.isArray(value.content) || value.content.length === 0 || value.content.length > MAX_BLOCKS) {
    throw new TypeError("Article document is invalid");
  }
  const budget = { nodes: 1, textBytes: 0 };
  return Object.freeze({
    type: "doc",
    content: Object.freeze(value.content.map((node) =>
      parseBlock(node, budget, tokenAddress))),
  });
}

function parseIdentity(value: Record<string, unknown>) {
  if (value.chainId !== 1 || typeof value.tokenAddress !== "string" || !isAddress(value.tokenAddress)) {
    throw new TypeError("Creator article identity is invalid");
  }
  return { chainId: 1 as const, tokenAddress: getAddress(value.tokenAddress) };
}

export function parseCreatorArticleDraftV1(value: unknown): CreatorArticleDraftV1 {
  if (!isRecord(value)) throw new TypeError("Creator article draft is invalid");
  exactKeys(value, [
    "schemaVersion", "chainId", "tokenAddress", "title", "bannerImage", "document",
  ]);
  if (value.schemaVersion !== CREATOR_ARTICLE_DRAFT_SCHEMA_V1) {
    throw new TypeError("Creator article draft version is invalid");
  }
  const identity = parseIdentity(value);
  return Object.freeze({
    schemaVersion: CREATOR_ARTICLE_DRAFT_SCHEMA_V1,
    ...identity,
    title: boundedString(value.title, "Article title", 240, { singleLine: true }).trim(),
    bannerImage: value.bannerImage === null
      ? null
      : parseImage(value.bannerImage, identity.tokenAddress, "banner"),
    document: parseDocument(value.document, identity.tokenAddress),
  });
}

function isoTimestamp(value: unknown, label: string) {
  if (typeof value !== "string") throw new TypeError(`${label} is invalid`);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== value) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

export function parseCreatorArticleV1(value: unknown): CreatorArticleV1 {
  if (!isRecord(value)) throw new TypeError("Creator article is invalid");
  exactKeys(value, [
    "schemaVersion", "chainId", "tokenAddress", "revision", "status", "title",
    "bannerImage", "document", "createdAt", "updatedAt",
  ]);
  if (value.schemaVersion !== CREATOR_ARTICLE_SCHEMA_V1 || value.status !== "published") {
    throw new TypeError("Creator article version is invalid");
  }
  const identity = parseIdentity(value);
  const revision = parsePositiveInteger(value.revision, "Article revision", Number.MAX_SAFE_INTEGER);
  const createdAt = isoTimestamp(value.createdAt, "Article creation time");
  const updatedAt = isoTimestamp(value.updatedAt, "Article update time");
  if (updatedAt < createdAt) throw new TypeError("Article timestamps are invalid");
  return Object.freeze({
    schemaVersion: CREATOR_ARTICLE_SCHEMA_V1,
    ...identity,
    revision,
    status: "published",
    title: boundedString(value.title, "Article title", 240, { singleLine: true }).trim(),
    bannerImage: value.bannerImage === null
      ? null
      : parseImage(value.bannerImage, identity.tokenAddress, "banner"),
    document: parseDocument(value.document, identity.tokenAddress),
    createdAt,
    updatedAt,
  });
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Canonical value is invalid");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
  }
  throw new TypeError("Canonical value is invalid");
}

export function canonicalCreatorArticleDraftV1(value: CreatorArticleDraftV1): string {
  return canonicalize(parseCreatorArticleDraftV1(value));
}

export function canonicalCreatorArticleV1(value: CreatorArticleV1): string {
  return canonicalize(parseCreatorArticleV1(value));
}
