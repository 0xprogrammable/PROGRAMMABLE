# Token Page Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the cold token document's four-second first-byte stall and keep creator-article/editor bytes off the critical public route.

**Architecture:** Stream an immediate token-page shell through React Suspense while the existing server-side detail read proceeds, let the current client recovery path take over after a bounded server failure, and defer Privy plus the article editor until idle time or direct intent. Preserve existing API caches and market/identity behavior.

**Tech Stack:** Next.js 16 App Router, React 19 Suspense, existing deferred WalletProvider runtime, Vitest, Next production build, browser Performance APIs.

**Spec:** `docs/superpowers/specs/2026-08-21-creator-article-design.md`

## Global Constraints

- Do not alter Explore identity selection, chart semantics, trade preparation, claims, or live-refresh intervals.
- Do not report a performance improvement from source inspection alone; compare rendered and network evidence.
- Do not duplicate the token-detail API call after a successful server response.
- Preserve client recovery when the server read misses its deadline.

---

## Task 1: Stream the token shell before the detail read resolves

**Files:**

- Modify: `app/token/[address]/page.tsx`
- Create: `components/token-detail-shell.tsx`
- Modify: `tests/token-detail-page.test.tsx`

- [ ] Write a failing test proving the route tree can emit the shell while the detail promise remains pending.
- [ ] Move the bounded initial read into an async child rendered inside `Suspense`.
- [ ] Render a stable, accessible token-detail shell as the fallback without fake values, layout jumps, or duplicate footer.
- [ ] Keep the four-second server deadline only for the streamed child, not the document's first-byte delivery.
- [ ] Preserve invalid-address and client retry behavior.
- [ ] Run `npm test -- --run tests/token-detail-page.test.tsx` and expect green.
- [ ] Commit with `perf: stream token detail shell`.

## Task 2: Defer wallet/editor runtimes without delaying intent

**Files:**

- Modify: `components/wallet-provider.tsx`
- Modify: `tests/wallet-provider-boundary.test.ts`
- Verify: `components/profile-projects.tsx`

- [ ] Write a failing boundary test proving `/token/:address` is not eager while `/launch` and `/profile` remain eager.
- [ ] Remove token routes from synchronous module evaluation preload.
- [ ] Schedule an idle token-route preload with a bounded timeout and preserve existing pointer/focus/click preloads on wallet controls.
- [ ] Verify the creator editor remains behind its `My projects` dynamic import and is absent from the public token initial chunk graph.
- [ ] Run `npm test -- --run tests/wallet-provider-boundary.test.ts` and expect green.
- [ ] Commit with `perf: defer token wallet runtime`.

## Task 3: Measure the final combined tip once

**Files:**

- Modify only files implicated by measured regressions.

- [ ] Run the focused performance tests from Tasks 1-2.
- [ ] Run `npm run typecheck`, changed-path lint, and `npm run build` as part of the combined final gate, not a duplicate suite.
- [ ] Measure a cold local production token document and confirm the shell is delivered before the prior four-second deadline.
- [ ] Inspect the token route's initial network graph and confirm no Tiptap/editor chunk is requested.
- [ ] Verify desktop/mobile chart and trade interactions still load correctly and no new console error or horizontal overflow appears.
- [ ] Record measured evidence beside the creator-article verification; do not deploy without separate publication authority.
