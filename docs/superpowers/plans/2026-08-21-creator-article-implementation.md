# Creator Article Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the verified creator of every publicly eligible Programmable launch publish and revise a polished, image-rich article below that token's market surface without changing token metadata or performing an onchain action.

**Architecture:** A strict shared article contract validates a bounded Tiptap JSON document. Server-only authority resolves the authenticated Privy wallet against Envio Classic creator evidence or Registry-verified Custom launch evidence. Immutable revision blobs and an ETag-protected current pointer provide optimistic concurrency in the existing Vercel Blob store. The public token response composes the article as a separate fail-soft field, while `Profile -> My projects` lazy-loads the editor and media uploader.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tiptap 3.30.2, Privy, viem, Sharp 0.35.3, Vercel Blob 2.6.1, Vitest, Playwright/browser QA.

**Spec:** `docs/superpowers/specs/2026-08-21-creator-article-design.md`

## Global Constraints

- Never mutate token, Registry, launch, social-link, claim, trade, or onchain data.
- Never trust a client-provided creator address; resolve write authority from verified public launch evidence.
- Fail closed for edits and fail soft for public reads.
- Accept only HTTPS links and verified image assets; never server-fetch clipboard URLs.
- Do not render stored HTML or use `dangerouslySetInnerHTML`.
- Keep editor dependencies out of the public token-page bundle.
- Use focused tests for changed contracts, then typecheck, changed-path lint, build, and rendered desktop/mobile QA.

---

## Task 1: Install the bounded editor dependencies

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] Run `npm install @tiptap/core@3.30.2 @tiptap/react@3.30.2 @tiptap/starter-kit@3.30.2 @tiptap/extension-image@3.30.2`.
- [ ] Confirm all four packages resolve to 3.30.2 and React 19 remains unchanged.
- [ ] Run `git diff --check`.
- [ ] Commit with `build: add bounded creator article editor` after Task 2 tests pass so the dependency and first consumer stay together.

## Task 2: Define and adversarially validate the article contract

**Files:**

- Create: `lib/creator-article/contract-v1.ts`
- Create: `lib/creator-article/link.ts`
- Create: `tests/creator-article-contract.test.ts`

**Interfaces:**

```ts
export type CreatorArticleDocumentV1 = Readonly<{
  type: "doc";
  content: readonly CreatorArticleBlockV1[];
}>;

export type CreatorArticleV1 = Readonly<{
  schemaVersion: "programmable.creator-article.v1";
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

export function parseCreatorArticleDraftV1(value: unknown): CreatorArticleDraftV1;
export function parseCreatorArticleV1(value: unknown): CreatorArticleV1;
export function canonicalCreatorArticleDraftV1(value: CreatorArticleDraftV1): string;
export function displayHttpsLinkV1(url: string): string;
```

- [ ] Write failing tests for the exact node/mark allowlist, depth/count/text limits, heading levels 2/3, compact/content/wide image sizing, nonempty alt text, HTTPS-only links, canonical URL normalization, duplicate mark rejection, unknown attributes, raw HTML/data/javascript URL rejection, and domain-only display labels.
- [ ] Implement recursive strict parsing with explicit key allowlists and bounded depth; normalize addresses with `getAddress` and timestamps with exact ISO serialization.
- [ ] Keep the public article object structurally separate from token/custom-project types.
- [ ] Run `npm test -- --run tests/creator-article-contract.test.ts` and expect green.
- [ ] Commit Tasks 1-2 with `feat: define creator article contract`.

## Task 3: Authenticate a wallet principal and resolve verified creator authority

**Files:**

- Create: `lib/server/creator-article/wallet-principal.server.ts`
- Create: `lib/server/creator-article/authority.server.ts`
- Create: `tests/creator-article-authority.test.ts`

**Interfaces:**

```ts
export type AuthenticatedWalletPrincipalV1 = Readonly<{
  privyUserId: string;
  privySessionId: string;
  wallets: readonly `0x${string}`[];
}>;

export interface CreatorArticleAuthorityV1 {
  readonly chainId: 1;
  readonly tokenAddress: `0x${string}`;
  readonly creatorAddress: `0x${string}`;
  readonly source: "envio-classic-v3" | "registry.custom-launched" | "official-main-token";
}
```

- [ ] Write failing boundary tests for matching access/identity token sessions, app-id mismatch, mismatched Privy subjects, malformed/non-Ethereum linked accounts, no wallet, and normalized duplicate wallets.
- [ ] Reuse the existing Privy verification semantics but require no GitHub account and expose no private subject in responses.
- [ ] Write failing authority tests for Classic V3 creator match, Registry-verified Custom launching-wallet match, Registry unavailable, hidden Custom, unknown token, wrong wallet, and the already-authorized official Main-token exception only when its public record exposes creator evidence.
- [ ] Implement authority reads without Dexscreener and without inferring identity from a token address.
- [ ] Run `npm test -- --run tests/creator-article-authority.test.ts` and expect green.
- [ ] Commit with `feat: bind articles to verified launch creators`.

## Task 4: Persist immutable revisions with an ETag current pointer

**Files:**

- Create: `lib/server/creator-article/storage.server.ts`
- Create: `tests/creator-article-storage.test.ts`

**Interfaces:**

```ts
export interface CreatorArticleStoreV1 {
  readCurrent(input: ArticleIdentityV1): Promise<CreatorArticleReadV1 | null>;
  publish(input: PublishCreatorArticleV1): Promise<CreatorArticleReadV1>;
}

export type CreatorArticleReadV1 = Readonly<{
  article: CreatorArticleV1;
  etag: string;
}>;
```

- [ ] Write failing tests for no current article, immutable revision pathname/content hash, successful create, successful revision update, stale ETag conflict, idempotent revision content, malformed pointer, malformed selected revision, identity mismatch, and read failure.
- [ ] Store canonical revisions under `creator-articles/v1/eip155-1/<lower-token>/revisions/<sha256>.json` with `allowOverwrite:false`.
- [ ] Store the current pointer under `creator-articles/v1/eip155-1/<lower-token>/current.json`; create without overwrite and update with exact `ifMatch` ETag.
- [ ] Read back and re-parse both revision and pointer before reporting success.
- [ ] Map `BlobPreconditionFailedError` to a typed revision conflict; never delete a written orphan revision.
- [ ] Run `npm test -- --run tests/creator-article-storage.test.ts` and expect green.
- [ ] Commit with `feat: persist immutable creator articles`.

## Task 5: Add authenticated project, article, and media APIs

**Files:**

- Create: `lib/server/creator-article/image.server.ts`
- Create: `app/api/profile/projects/route.ts`
- Create: `app/api/profile/projects/[address]/article/route.ts`
- Create: `app/api/profile/projects/[address]/article/media/route.ts`
- Create: `tests/creator-article-api.test.ts`
- Create: `tests/creator-article-image.test.ts`

**HTTP contract:**

```text
GET /api/profile/projects
GET /api/profile/projects/:address/article
PUT /api/profile/projects/:address/article  If-Match: <etag or *>
POST /api/profile/projects/:address/article/media  multipart file=<image>
```

- [ ] Write failing API tests for authentication headers, exact wallet authority, address normalization, JSON content type, body ceiling, no-store mutation responses, conflict status 412, and 503 fail-closed authority failures.
- [ ] Write failing image tests for PNG/JPEG/WebP/AVIF decode, oversized encoded and decoded inputs, animated/malformed files, metadata removal, max dimensions, WebP output, preserved aspect ratio, banner 3:1 crop, and exact readback digest.
- [ ] Implement project listing from verified public identity sources, filtered by authenticated linked wallets.
- [ ] Implement GET/PUT with server canonicalization; ignore any client creator field.
- [ ] Implement media upload only after authority verification. Store public media under `creator-article-media/v1/eip155-1/<token>/<uuid>.webp`, verify Blob response and downloaded bytes, and return width, height, URL, digest, and media kind.
- [ ] Set `Vary: Authorization, X-Privy-Identity-Token`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, and bounded timeouts.
- [ ] Run `npm test -- --run tests/creator-article-api.test.ts tests/creator-article-image.test.ts` and expect green.
- [ ] Commit with `feat: add creator article APIs`.

## Task 6: Compose a fail-soft public article into token detail

**Files:**

- Modify: `app/api/explore/token/route.ts`
- Modify: `components/token-detail-view.tsx`
- Create: `components/creator-article.tsx`
- Create: `components/creator-article.module.css`
- Modify: `tests/token-detail-api.test.ts`
- Create: `tests/creator-article-renderer.test.tsx`

- [ ] Add `creatorArticle` as a separate top-level response field; never merge it into `token` or `customProject`.
- [ ] Start the store read only after verified public identity is selected, in parallel with market enrichment when possible.
- [ ] Return `creatorArticle:null` on missing article, storage outage, or validation failure while preserving the existing token/custom response and status.
- [ ] Extend the client parser with strict article parsing. Invalid article data becomes null; it never invalidates the token.
- [ ] Render semantic headings, paragraphs, lists, links, responsive images/captions, and updated date below both canonical and Custom market surfaces and before the footer.
- [ ] Style the section as an editorial continuation: broad 3:1 banner, readable text measure, pale-blue underlined links, responsive wide media, visible focus, and `content-visibility:auto`.
- [ ] Write tests proving no article placeholder, safe semantic rendering, no HTML injection, and article outage identity retention.
- [ ] Run `npm test -- --run tests/token-detail-api.test.ts tests/creator-article-renderer.test.tsx` and expect green.
- [ ] Commit with `feat: render creator articles on token pages`.

## Task 7: Build `Profile -> My projects` and lazy-load the editor

**Files:**

- Modify: `components/profile-view.tsx`
- Create: `components/profile-projects.tsx`
- Create: `components/profile-projects.module.css`
- Create: `components/creator-article-editor.tsx`
- Create: `components/creator-article-editor.module.css`
- Create: `lib/creator-article/editor-image.ts`
- Create: `tests/creator-article-editor.test.tsx`
- Modify: `tests/profile-view-state.test.ts`

- [ ] Add a `My projects` section that shows only authenticated wallet-owned verified launches and offers `Create article` or `Edit article` plus `View token`.
- [ ] Load `creator-article-editor.tsx` with a dynamic import only after an edit action.
- [ ] Configure StarterKit with headings 2/3, lists, bold, italic, undo/redo, and Link with autolink/paste-link enabled and an HTTPS-only validator.
- [ ] Add a custom bounded image node with alt, caption, verified URL, intrinsic dimensions, and semantic size `compact | content | wide`.
- [ ] Handle clipboard image `File` items in cursor order: insert an accessible upload placeholder, POST with current Privy headers, then replace with the verified node. Never fetch clipboard HTML image URLs.
- [ ] Convert a standalone pasted HTTPS URL to a hostname label while retaining the complete href; autolink inline typed HTTPS URLs.
- [ ] Provide visible toolbar controls for Normal, Bold, Italic, H2, H3, bullet list, numbered list, link, undo, redo, image upload, and image size. Keep every control keyboard accessible with `aria-pressed` where applicable.
- [ ] Preserve local draft content after upload/save errors. On 412 show a reload/copy-draft conflict action; never overwrite.
- [ ] Add live preview using the same public renderer and show exact publish state without an onchain/signature prompt.
- [ ] Run `npm test -- --run tests/creator-article-editor.test.tsx tests/profile-view-state.test.ts` and expect green.
- [ ] Commit with `feat: add creator article editor`.

## Task 8: Add the Programmable Main-token example as an explicit seed artifact

**Files:**

- Create: `lib/creator-article/programmable-example-v1.ts`
- Create: `scripts/seed-programmable-creator-article.mjs`
- Create: `tests/programmable-creator-article-example.test.ts`
- Modify: `package.json`

- [ ] Create factual, understated article copy for `0x7987f03462200b3D8A072E02C89A8A41dCB124EE` using owned Programmable imagery and no fabricated claims, partners, metrics, or guarantees.
- [ ] Include a 3:1 cover and at least one inline image so responsive behavior is visible.
- [ ] Make the seed script dry-run by default. Require `--write`, production Blob credentials, exact expected current ETag, and the authenticated official creator authority before any external write.
- [ ] Emit values-free identity, content SHA, revision, and readback ETag receipts; never print credentials.
- [ ] Do not run `--write` and do not deploy/publish without explicit external-publication authority.
- [ ] Run `npm test -- --run tests/programmable-creator-article-example.test.ts` and expect green.
- [ ] Commit with `feat: add Programmable article example`.

## Task 9: Focused verification and rendered correction pass

**Files:**

- Modify only files implicated by failed checks or the rendered correction pass.

- [ ] Run the focused article suite from Tasks 2-8 once at the final combined tip.
- [ ] Run `npm run typecheck`.
- [ ] Run changed-path ESLint on the changed TypeScript/TSX files.
- [ ] Run `npm run build`.
- [ ] Start the production build locally and verify the main token plus an authenticated profile editor in a real browser.
- [ ] Capture desktop and mobile screenshots; check clipboard image paste, upload state, image sizing, formatting, link normalization, save conflict, keyboard/focus, console, network failures, and horizontal overflow.
- [ ] Perform one focused correction pass and rerun only the affected tests plus typecheck/build if bytes changed.
- [ ] Record final commit/tree and exact local evidence. Stop before push/deploy/public seed write unless separately authorized.

