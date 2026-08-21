# Creator Article Design

Date: 2026-08-21  
Status: Owner direction captured; implementation plan pending review

## Product decision

A creator article is mutable website content. It is not token metadata, launch
metadata, Registry presentation data, or contract state.

The verified creator of a publicly visible Programmable launch may publish and
later revise one article that is rendered below the market and trading surfaces
on that token's website page. The creator manages the article from
`Profile -> My projects`.

The feature must never mutate or replace the token name, symbol, token image,
description, canonical social links, launch provenance, market identity, pool
identity, hook identity, or any onchain value. Saving an article performs no
signature transaction and no onchain action.

## User experience

### Public token page

The existing token identity, chart, metrics, and trading experience remain the
primary surface. When a published article exists, a new editorial section is
shown after those surfaces and before the global footer.

The section may contain:

- an optional 3:1 article banner;
- an article title;
- structured headings and paragraphs;
- ordered and unordered lists;
- article images with optional captions;
- safe inline HTTPS links and explicit link buttons;
- an unobtrusive `Updated` date.

The section must not present article links as canonical token social metadata.
It must not add or alter the social icons beside the contract address.

When no article exists, the section is absent. There is no empty card, setup
prompt, or public placeholder.

### Creator profile

An authenticated wallet sees a `My projects` section containing only public
Programmable launches for which that wallet is the verified creator authority.
Each entry links to the public token page and exposes `Create article` or
`Edit article`.

The editor supports a live preview, save, and discard. A successful save
publishes the new revision immediately. Editing an existing article creates a
new revision and never changes the token or its launch record.

The article editor is loaded only after the creator opens it. It is not part of
the initial public token-page bundle or the initial profile bundle.

## Authority boundary

Article placement is identified by `(chainId, tokenAddress)`. This is only the
website location at which the article renders; it does not make the article
part of token metadata.

Write authority is derived server-side from existing verified launch evidence:

- Classic V3: the exact creator address from the verified Envio launch record;
- verified Custom: the launching wallet from the verified public Registry
  record;
- any explicitly supported historical public exception: only when its existing
  public launch record exposes equally strong creator evidence.

The server authenticates the existing Privy session, resolves its verified
Ethereum wallet identities, and requires an exact match with the launch creator
authority. A client-supplied creator address is never trusted. Unknown,
unverified, hidden, or Registry-unready launches fail closed and cannot acquire
an article through this feature.

Normal website authentication may prompt the user to connect a wallet. Saving
an article does not request a transaction, contract call, token approval, or
fee payment.

## Content model

The article uses a bounded structured-block contract rather than arbitrary HTML
or a general-purpose document format. The first version contains:

```text
CreatorArticleV1
  schemaVersion
  chainId
  tokenAddress
  revision
  status: published
  title
  bannerImage | null
  blocks[]
  createdAt
  updatedAt
```

Supported blocks are `heading`, `paragraph`, `list`, `image`, and `link-card`.
Paragraph and list text use a small mark model for emphasis and HTTPS links.
Raw HTML, script, iframe, embedded widgets, arbitrary CSS, data URLs, and
javascript URLs are forbidden.

Content limits are enforced in both the client and server contracts. The
server canonicalizes the accepted document before hashing and persistence.
Optimistic concurrency requires the expected current revision so two stale
editor tabs cannot silently overwrite one another.

## Persistence and media

Creator articles use dedicated website tables and a dedicated current-article
read view. Existing token-project metadata and Custom launch presentation rows
are not repurposed or mutated.

The database keeps immutable article revisions plus a single current pointer.
The current public view returns only the latest valid published revision. All
writes are audited with article identity, creator wallet, previous revision,
new revision, and a content commitment; no private session material is stored.

Article media uses the existing Programmable Vercel Blob account through a new
article-media upload boundary. The server authenticates creator authority
before writing, verifies decoded image bytes, strips metadata, produces a
bounded web-safe image, performs readback verification, and stores only the
verified asset reference in the article.

The banner target is 3000 x 1000 pixels. Article images preserve their aspect
ratio within bounded dimensions. Public rendering uses responsive image sizes
so mobile visitors do not download desktop-sized media.

## API composition

The article remains a separately typed object even when composed into the
token-detail response. It can never override fields in `token` or
`customProject`.

Public article reads are fail-soft: an article-store outage hides only the
article and must never hide the verified token identity, chart, or trading
surface. Successful public reads use a short CDN cache with stale-while-
revalidate. A successful article mutation invalidates only the affected
article cache key.

Authenticated profile routes provide:

- the wallet's verified editable project list;
- the current article revision for one eligible project;
- a compare-and-swap publish operation;
- authenticated article-media upload.

All mutation responses are `no-store`. Public data never exposes Privy user
IDs, access tokens, identity tokens, internal database IDs, or operational
credentials.

## Rendering and visual direction

The article is an editorial continuation of the token page, not another glass
dashboard card. It uses a readable centered measure, restrained typography,
large media, strong whitespace, and the existing Programmable palette. The
banner spans the article container at 3:1 without affecting the token artwork
above it.

Desktop supports a broad banner and a narrow reading column. Mobile preserves
the same hierarchy, uses edge-safe media, and prevents horizontal overflow.
The renderer supports keyboard navigation, visible focus, meaningful image alt
text, reduced motion, and semantic heading order.

## Performance work in the same product slice

The new feature must improve rather than regress token-page loading:

1. Stream the token-page shell instead of holding first-byte delivery behind
   the existing four-second initial-detail deadline.
2. Keep the public article renderer server-first and ship no editor code to
   visitors.
3. Lazy-load the editor only from `My projects`.
4. Defer the Privy wallet runtime on token pages until idle time or a direct
   wallet/trade interaction, while preloading it on intent.
5. Use responsive article media and `content-visibility` for below-the-fold
   article content.
6. Preserve the existing short API caches and invalidate only the changed
   article rather than the launch catalog.

The live baseline captured before implementation was approximately 60-70 ms
for warm Explore/token APIs, while a cold token document could wait about
4.6 seconds because its server render awaited the initial detail deadline.
Validation compares the final build and rendered route against that baseline.

## Failure behavior

- Article read unavailable: render the normal token page without the article.
- Creator verification unavailable: disable mutation and retain the last
  published article.
- Stale revision: return a conflict and let the creator reload or copy their
  draft; never overwrite silently.
- Media verification failure: do not attach the asset to an article revision.
- Invalid link or block: reject the complete mutation with a field-level error.
- Token ceases to be publicly eligible: do not render or edit its article until
  public launch eligibility is restored.

## Verification scope

Implementation verification is focused on the changed contracts:

- creator-authority allow and deny cases for Classic V3 and verified Custom;
- strict separation from token and Registry metadata;
- article parsing, canonicalization, limits, unsafe URL rejection, and revision
  conflicts;
- authenticated media validation and readback;
- profile `My projects` ownership and editor interaction;
- public token rendering with and without an article;
- article-store outage preserving token identity, chart, and trade;
- desktop and mobile rendering, keyboard/focus, console/network, and overflow;
- token-page response streaming and bundle/loading comparison.

No contract, launcher, claim, trade-preparation, Registry-verification, or
onchain behavior is changed by this feature.
