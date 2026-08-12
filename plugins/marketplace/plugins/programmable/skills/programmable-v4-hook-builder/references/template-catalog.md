# Starter and capability-pack catalog

## Contents

- [Purpose](#purpose)
- [Selection model](#selection-model)
- [Commands](#commands)
- [Starters](#starters)
- [Capability packs](#capability-packs)
- [Implementation Legos](#implementation-legos)
- [Owner-defined capabilities](#owner-defined-capabilities)
- [Owner-defined local tags](#owner-defined-local-tags)
- [Composition rules](#composition-rules)
- [Materialized files](#materialized-files)
- [Adding a catalog entry](#adding-a-catalog-entry)
- [Evidence boundary](#evidence-boundary)
- [Release history](#release-history)

## Release history

`template-catalog-history.json` preserves each prior released Builder commit, skill tree, catalog digest, raw manifest
digest, and every starter or pack definition digest. Old template bytes remain reconstructable from the immutable
release tag; a later Builder never silently rewrites an old definition. A project plan retains its catalog and
definition digests, so migration can compare the exact prior composition before changing anything.

## Purpose

Use the catalog to start common projects faster and ask the right architecture, security, evidence and disclosure
questions. A catalog entry is an accelerator only. It is not an allowlist, implementation, acceptance decision, audit,
deployment receipt, provider promise or launch permit.

Never infer that an idea is unsafe, rejected or unsupported because its category is absent. Preserve every owner-defined
capability, describe its actors, assets, authorities, value flows, dependencies and failure behavior, and route it to
architecture review. Objective hard findings still come from the main policy and evidence workflow, not this catalog.

Every starter includes the Programmable fee-applicability, metadata/disclosure and test/evidence planning packs. The fee
pack first derives whether any `programmable-canonical` execution scope exists. Canonical scopes require the real Fee V2
instance and evidence; an exact zero-scope plan remains `not-applicable` and must not invent a market, PoolKey, hook or
receipt. Generated artifacts prove no integrated implementation or runtime behavior.

## Selection model

Choose one starter, then add any number of capability packs:

1. Use `ordinary-launch` for the smallest conventional fixed-supply token and canonical-pool path.
2. Use `custom-token-standard-fee-hook` when special behavior belongs in the token while the Programmable fee hook
   remains standard.
3. Use `custom-hook` when the canonical pool needs custom callbacks; token-side packs can still be added.
4. Use `blank-custom` when a known starter would distort the idea.
5. Add packs when their complete behavior and dependency closure applies.
6. Add a known behavior atomically with repeatable `--capability` when sibling capabilities from its source pack do not
   apply. The selection keeps exact definition receipts, requirements and digests without pack expansion.
7. Add every unlisted behavior with `--custom-capability` rather than omitting or renaming it.
8. Add any safe project-specific discovery slugs with repeatable `--local-tag`; catalog membership is not required.
9. Resolve a template-composition conflict by selecting a better foundation. A composition conflict is not a safety or
   eligibility decision.

Pack dependencies are included automatically. Output ordering, definition hashes, catalog digest and selection digest
are deterministic. The same catalog and selection produce byte-identical files.

## Commands

Resolve `SKILL_ROOT` to the directory containing the loaded `SKILL.md`.

List the complete catalog:

```bash
node "$SKILL_ROOT/scripts/template-catalog.mjs" list
```

List only starters or packs:

```bash
node "$SKILL_ROOT/scripts/template-catalog.mjs" list --kind starter
node "$SKILL_ROOT/scripts/template-catalog.mjs" list --kind pack
```

Inspect one hash-bound definition:

```bash
node "$SKILL_ROOT/scripts/template-catalog.mjs" show threejs-pvp-rewards
```

Inspect the separate implementation-Lego layer:

```bash
node "$SKILL_ROOT/scripts/template-catalog.mjs" list-legos
node "$SKILL_ROOT/scripts/template-catalog.mjs" list-legos --maturity experimental
node "$SKILL_ROOT/scripts/template-catalog.mjs" show-lego zero-amm-fee-adapter
```

Materialize a conventional launch into a target that does not exist:

```bash
node "$SKILL_ROOT/scripts/template-catalog.mjs" materialize \
  --starter ordinary-launch \
  --target /absolute/path/to/new-project-plan
```

Materialize token-side transfer tax and tax-financed liquidity while keeping the standard fee hook:

```bash
node "$SKILL_ROOT/scripts/template-catalog.mjs" materialize \
  --starter custom-token-standard-fee-hook \
  --pack tax-financed-auto-liquidity \
  --target /absolute/path/to/new-token-plan
```

Materialize an open-ended game with known and owner-defined capabilities:

```bash
node "$SKILL_ROOT/scripts/template-catalog.mjs" materialize \
  --starter custom-hook \
  --pack threejs-pvp-rewards \
  --custom-capability moving-arena='Moving arena changes the next swap rule' \
  --local-tag community-tournament \
  --target /absolute/path/to/new-game-plan
```

Materialize only the known randomness Lego, without selecting loot or rewards:

```bash
node "$SKILL_ROOT/scripts/template-catalog.mjs" materialize \
  --starter blank-custom \
  --capability randomness \
  --target /absolute/path/to/new-randomness-plan
```

The command performs local reads and creates only the new target. It does not initialize Git, fetch dependencies, run
project code, connect a wallet, submit an application, deploy or publish.

## Starters

| Starter | Use it for | Route |
| --- | --- | --- |
| `ordinary-launch` | Fixed-supply token, conventional price discovery and the smallest behavior surface | Standard review |
| `custom-token-standard-fee-hook` | Token-side special behavior with the standard Programmable fee hook | Custom review |
| `custom-hook` | One custom canonical-pool hook with integrated fee behavior | Custom review |
| `blank-custom` | Any idea that does not fit a known foundation without distortion | Architecture review |

The ordinary starter cannot accept `custom-hook-behavior`, whether selected directly or pulled in by another pack. The
command returns `CUSTOM_HOOK_STARTER_REQUIRED` with `recommendedStarterId: custom-hook`; preserve the idea and selected
packs, then continue with `--starter custom-hook`. Token-side special packs instead return
`CUSTOM_TOKEN_STARTER_REQUIRED` with `recommendedStarterId: custom-token-standard-fee-hook`.

The custom-token starter accepts token-side packs without pulling in `custom-hook-behavior`. If a selected pack does
need custom callbacks, it redirects to `custom-hook`, where the token-side pack remains composable. A permissioned or
external asset does not conflict with `ordinary-launch` merely because it is external: record whether its PoolKey role
is `launched`, `quote` or `both`, then derive the actual architecture and review obligations. Foundation routing is not
a rejection or safety decision.

## Capability packs

| Pack | Covers |
| --- | --- |
| `programmable-volume-fee` | Fee applicability and, for each canonical scope, the mandatory non-additive 0.1 percent share, exposed execution modes, claims and liabilities |
| `custom-hook-behavior` | Callback purpose, PoolManager authentication, permission bits, deltas and settlement |
| `dynamic-lp-fee` | Bounded LP-fee changes and input manipulation resistance |
| `hook-owned-project-fee` | Disclosed project share inside the selected total fee |
| `automatic-liquidity` | Hook-owned proceeds, callback execution, LP custody, removal and exits |
| `token-managed-automatic-liquidity` | Token-owned inventory, router or PoolManager execution and standard-hook separation |
| `token-transfer-tax` | Token-level tax scope, exemptions, gross/net accounting, authority and pool compatibility |
| `tax-financed-auto-liquidity` | Transfer-tax accumulator feeding token-managed liquidity, solvency and LP custody |
| `launch-distribution-vesting-lp-custody` | Conserved allocations, vesting claims, LP ownership, locks and exits |
| `continuous-clearing-auction` | Clearing-price math, bids, fills, refunds, finalization and pool transition |
| `contract-priced-sell-and-burn` | Standalone contract-priced sales, payment settlement, irreversible burn and supply accounting without assuming a pool or hook |
| `contract-priced-sell-and-burn-v4-custom-accounting` | Optional canonical v4 custom-accounting adapter for the standalone sell-and-burn mechanism |
| `limit-orders-twamm` | Escrowed price-triggered and long-term orders, virtual execution and liveness |
| `mev-protection` | Named MEV adversary, protection mechanism, bypass, outage and trust boundaries |
| `staking-liquidity-incentives` | Reward funding, accrual, custody, claims and emergency exits |
| `verifiable-randomness` | Entropy lifecycle, provider failure, replay, manipulation and fixed-seed evidence without assuming loot or rewards |
| `randomness-loot-rewards` | Loot odds, reward reservation, replay and solvency on top of verifiable randomness |
| `multi-pool-hooks` | Pool registration, PoolKey domain separation, isolation and cross-pool actions |
| `threejs-pvp-rewards` | Game outcome authority, anti-cheat, replay, disputes and reward solvency without assuming a signer architecture |
| `maps-location-quest` | Location evidence, spoofing, privacy, retention and provider failure without assuming a signer architecture |
| `wallet-transaction-quest` | EOA and smart-account attribution, reorgs, replay and one-time claims |
| `v4-claim-client` | ERC-6909 claim ownership, operator authority, mint/burn preparation and confirmed reconciliation |
| `v4-swap-client` | Hooked quote simulation, explicit router generation, per-hop hookData, price bounds and final slippage |
| `v4-liquidity-position-client` | Safe explicit PositionManager actions, deprecated-action exclusion, discovery, fee collection and reconciliation |
| `position-subscriber-automation` | Subscriber callback trust, donation-inflated fees, keeper liveness, unsubscribe and user exit |
| `hook-owned-idle-yield` | ERC-4626-style idle inventory, share math, losses, liquidity recall and withdrawal liveness |
| `wrapped-asset-conversion` | Underlying/wrapped conversion rates, rounding, external controls, solvency and exits |
| `external-liquidity-aggregator` | Exact protocol adapters, cross-protocol quote/settlement parity, reserves and failure isolation |
| `active-liquidity-market` | Orderbook/bin/inventory pricing, vault shares, dedicated quoter, maker and keeper liveness |
| `signed-outcome-service` | Domain-separated signatures, nonce, expiry, rotation and compromise |
| `oracle-keeper` | Data provenance, freshness, automation, idempotency and outages |
| `async-swap` | Deferred liabilities, partial fills, fulfillment, cancellation and exits |
| `custom-curve` | Invariant, rounding, boundary, differential and provider-parity evidence |
| `permissioned-external-asset` | Issuer controls, redemption, restrictions, trust and legal disclosures |
| `multi-repo-app-service-indexer` | Primary lineage, companion commits, services and reconstruction |
| `metadata-disclosures` | Names, tags, URIs, media hashes, affiliations, fees and provider states |
| `test-evidence-threat-model` | Project-specific properties, commands, results and evidence separation |

Selecting `token-transfer-tax`, `token-managed-automatic-liquidity`, or `tax-financed-auto-liquidity` requires matching
Submission V2 assets, components, value flows, authorities and capability-profile records. The standard-fee-hook
custom-token starter keeps those mechanics token-side; it does not force `custom-hook-behavior`. Historical V1
`tokenMechanics` and `noHookArchitecture` fields belong only to explicit V1 reproduction or migration and are not fields
in a new Submission V2 graph.

Packs are composable prompts and output templates, not code mixins. A selected pack still requires an implementation
that matches the project, plus the main skill's compatibility, security, source-binding and review gates.
The game and location packs deliberately do not auto-select `signed-outcome-service`: physical markers, onchain or
zero-knowledge attestations, and other reviewed proof systems remain possible. Add the signed-service pack only after
the owner chooses that trust model.

## Implementation Legos

Implementation Legos are a separate, hash-bound source layer under
`assets/starter-catalog/implementation-legos/`. They never change whether an idea is eligible. Exact starter, pack or
known-capability triggers may select a reusable source file; dependencies add only the explicitly required Lego. When
no Lego matches, the project and every owner-defined capability remain intact and route through the normal custom
architecture review.

Each closed descriptor binds its source bytes, materialized target path, integration facts, dependency requirements,
exact unsafe behavior predicates, review route and fee-applicability state. The top-level catalog digest binds the Lego
manifest, every descriptor and every source hash. Extra, missing, traversing, duplicated or modified source files fail
before composition.

Maturity has only these meanings:

- `code-ready`: deterministic reusable source is packaged and hash-bound; project integration, compilation, tests and
  review are still required.
- `experimental`: reference scaffold only; project-specific implementation and evidence are required before prototype
  readiness.

Neither label claims fee conformance, safety, audit, deployment, production readiness or provider support. Every
descriptor records those claims as false or not claimed. Exact hard-conflict predicates address concrete unsafe
behavior; they are never category bans.

Every materialized plan also carries the immutable Programmable fee owner
`0x4957f49620AFf3Adbbe8195a4f633E49cc93376c`, the 10-basis-point platform share and the 10-basis-point effective total
fee floor for each applicable canonical execution scope, including a selected total fee of zero. Until each actual
standard-AMM, zero-AMM, async/batched or custom-reviewed path has scope-specific code and tests, fee conformance remains
explicitly unresolved. A supporting Lego marked `not-a-fee-enforcement-component` never creates an exemption.

## Owner-defined capabilities

Known catalog capabilities use `--capability <known-id>`. This selects one exact Lego without adding sibling
capabilities or pack dependencies. Its hash-bound definition receipts and any atomic capability requirements are stored
under `directCapabilityLegos`; when the catalog does not yet have an atomic requirement definition, the capability is
still preserved but visibly routes to capability-specific architecture review.

Unlisted behavior uses `--custom-capability` with a lowercase hyphenated id and a visible NFC label:

```text
--custom-capability capability-id='Plain visible label'
```

The materialized manifest records:

- `catalogStatus: unlisted`
- `automaticDecision: none`
- `reviewRoute: architecture-review-required`
- `eligibilityEffect: none`

The generated checklist asks for actors and assets, authority and trust, value flow and conservation, failure and exit,
and exact source and tests. Continue the normal architecture conversation to derive more specific obligations. Do not
invent a near-enough known label merely to avoid review.

## Owner-defined local tags

Use repeatable lowercase slug-safe tags for local discovery without waiting for a catalog update:

```text
--local-tag weird-squid-market --local-tag community-lore
```

These values are deliberately not checked against a tag allowlist. They are NFC-safe lowercase slugs, required to be
unique, sorted, included in the selection digest, stored as `tagSuggestions.ownerProvidedLocalTags`, and rendered in
`TAGS.md`. `catalogMembershipRequired` is `false`, `machineCapabilityInference` is `forbidden`, and
`providerSupportInference` is `forbidden`.

Starter, pack, security and capability ids live separately under `machineCapabilities`. They support internal planning
and review routing, but never become public local tags automatically. Owner-defined capabilities also remain machine
capabilities until the owner separately chooses a `--local-tag`. Therefore `ownerProvidedLocalTags` is the only list of
explicit public local discovery suggestions in a materialized plan.

A local tag describes the owner's project only. It never proves or claims GMGN, Fomo, Dexscreener, Uniswap, wallet,
router, marketplace or search-provider support. Track each external provider separately from attributable evidence.

## Composition rules

The loader rejects malformed packaged data before materialization:

- unknown or missing fields in the closed catalog objects;
- noncanonical ids or paths;
- duplicate or unsorted ids;
- hash mismatches, unlisted files or missing definitions;
- invalid, non-NFC, invisible, control, bidirectional, private-use or noncharacter label text;
- missing mandatory packs, dangling requirements or requirement cycles;
- a selected starter/pack pair with contradictory template assumptions.

In addition, `ordinary-launch` composition stops with a specific `custom-hook` redirect whenever dependency closure
contains `custom-hook-behavior`. The selected behavior remains eligible and can be composed unchanged on the
`custom-hook` starter. Token-side special packs redirect ordinary composition to
`custom-token-standard-fee-hook`. Selecting custom-hook behavior from that token foundation redirects to
`custom-hook`, which can combine both behavior families.

A composition conflict means only that the selected templates cannot describe one coherent foundation. It returns
`eligibilityEffect: none` and `adverseDecision: false`. Change the selection while preserving the original idea.

## Materialized files

The target contains the fixed planning files plus zero or more exact-trigger implementation sources:

- `programmable-template.json` — catalog and selection digests, selected definitions, separated machine capabilities,
  custom capabilities and owner-provided local tags;
- `PROPOSAL.md` — outcome, architecture facts, lifecycle, value and authority questions;
- `CAPABILITY_CHECKLIST.md` — selected known and owner-defined capabilities;
- `THREAT_MODEL.md` — capability-specific risk prompts and security-property section;
- `TEST_PLAN.md` — required scenarios, adversarial checks and reproducibility section;
- `EVIDENCE.md` — required artifacts and separate evidence states;
- `TAGS.md` — only owner-provided local slug suggestions plus a separate provider-evidence table;
- `METADATA_AND_DISCLOSURES.md` — public identity, fees, controls, tags and per-provider evidence;
- `IMPLEMENTATION_LEGOS.md` — selected source receipts, maturity boundary, integration boundary and fee applicability;
- `programmable-code-legos.json` — machine-readable pinned Lego selection and fee-policy receipt;
- `implementation/<lego-id>/...` — byte-identical packaged source selected by exact starter, pack or capability triggers.

Replace prompts with project-specific facts. Leaving template text unchanged is not implementation or evidence.

## Adding a catalog entry

Keep additions data-only and reviewable:

1. Add one closed JSON definition under `assets/starter-catalog/starters/` or `assets/starter-catalog/packs/`.
2. Use a unique lowercase hyphenated id and visible NFC text.
3. State required facts, files, tests and risks without claiming approval.
4. Add only real composition dependencies or conflicts. Do not use conflicts as a disguised product allowlist.
5. Add the sorted manifest entry with the exact raw-file SHA-256.
6. Add focused tests for selection, dependency closure, conflicts and unknown-capability preservation.
7. Run the complete catalog test and the skill verification gates before a release candidate.

Do not add executable downloads, remote URLs, credentials, wallet actions or provider assertions to the catalog.

Add or change an implementation Lego only as a separate reviewed source change: update its source hash, descriptor hash,
sorted Lego manifest, top-level Lego-manifest hash, catalog digest expectation, exact-trigger tests, tamper tests and
materialization receipts. Keep the blank/custom escape hatch and `missingLegoOutcome: preserve-project-capability`.

## Evidence boundary

A valid catalog and deterministic materialization prove only that packaged template/source bytes, selection rules and
receipts are self-consistent. They do not prove integrated source behavior, fee correctness, security review, clean
builds, deployment, source verification, lifecycle operation, provider indexing, routing or public availability. Track
those states independently through the main Programmable workflow.
