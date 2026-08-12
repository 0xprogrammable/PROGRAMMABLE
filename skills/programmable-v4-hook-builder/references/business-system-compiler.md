# Business-system compiler

Load first in Explore/Autopilot. Compile product before callbacks/templates/code; reject only a concrete unsafe/impossible
mechanism.

## Artifacts

Preserve public-safe verbatim UTF-8 intent, language and byte hash. Emit:

| Artifact | Required meaning |
| --- | --- |
| `project-spec.v1.json` | Intent, facets, provenance, trade applicability |
| `product-graph.v1.json` | Nine typed graphs |
| `architecture-candidates.v1.json` | Three compared roles and selection |
| `repository-plan.v1.json` | Files, locks, applicable trade manifests/tests, deploy/evidence/argv |
| `.programmable/project-states/*.v1.json` | Hashes, blockers, receipts, resume argv |
| `submission.v2.json` and declared trade manifests | Exact ApplicationId, trade facet, MarketRefs, route types and content-addressed evidence |

Process schemas outside context. Summaries, templates and code never replace verbatim intent.

`validate` never runs code; `execute` runs reviewed argv and binds receipts. After architecture selection use SKILL.md's
`project materialize`; never hand-author derived hashes, state, inventory or applicability. Before handoff run
`project require-output` with exact state/package. Schemas must yield one identity/facet/market/route projection; invented claims
block. `CLEAR` is source-only, `DRAFT_UNRESOLVED` noncanonical, and only exit zero with `PROJECT_PREFLIGHT_VALID`
completes Autopilot. Unsigned receipts prove content, not execution; completion stays `NOT_PROVEN` until fresh E2E.

## ProjectSpec

Model even `unresolved`: UX, actors, assets, value/loss, markets, custody, lifecycle, fees, authority, dependencies,
failures, routing, assumptions and owner decisions.

The routing facet contains exactly one `trade-capability`: applicable only for a real market, not-applicable for an
explicit no-market product, or unresolved while that material decision is open. Never invent a pool, route, adapter,
Fee V2 scope, or trade test to complete a no-market design.

Label entries `confirmed`, `builder-assumption`, `owner-required` or `external-unresolved`; bind confirmed claims to
intent spans. Ask only when no reversible safe default preserves a material outcome.

## Graphs

1. Map actors, assets, services, interfaces, protocols, components, calls, data and dependencies.
2. Bind states to authority, invariant, transition, failure, fallback, recovery and terminal disposition.
3. Conserve each asset, right, liability, fee, claim and loss through custody to settlement/exit.
4. Inventory powers, trust crossings, deployables, dependencies, detection and recovery; invent no address.

Include every contract/child/backend/indexer/router/provider. Close funding, use, result, failure, exit, and owner loops.

## Architectures

Compare all three; explain inapplicability:

- `minimum-correct`: least machinery preserving intent;
- `v4-native`: strongest correct canonical v4 use;
- `hybrid`: sound split across v4, contracts and offchain surfaces.

Reject intent, authorization, conservation, solvency, limit, custody/exit or implementation failures. Among passes,
minimize capital, duplicate liquidity, trust, latency, gas, operations and drift.

Use hooks only for PoolManager-atomic logic; keep escrow, games, markets, vaults, claims and computation elsewhere.
Choose no hook/pool or an external market when minimum-correct; invent no Fee scope.

## Gate

Derive one typed capability contract per component. Before materialization run the composition checker; resolve/route
each permission, storage/namespace, delta, fee, authority, lifecycle, router, settlement, or dependency finding.
`NO_KNOWN_CONFLICT` means no detected modeled conflict, never approval.

Render the first slice's Design Card; later ideas are non-goals. Checkpoint hashes, unresolved provenance, obligations,
blockers, resume argv, and false authorizations. Continue to [open-world-v2-workflow.md](open-world-v2-workflow.md) only
when the selected architecture and required owner facts are stable enough to materialize.

The materializer maps ProjectSpec `applicable/not-applicable/unresolved` to RepositoryPlan/Submission
`tradable/no-market/unresolved`; never hand-map it. Transport stays `NOT_SUBMITTED` without public GitHub identity.

Escalate novel/ambiguous/cross-domain/value-bearing slices; use smaller models for bounded known work. If capability is
unavailable, preserve the design and emit `INTEGRATION_PENDING` or `EXTERNAL_BLOCKED`.
