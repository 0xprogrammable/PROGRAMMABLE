# Project surfaces and capabilities

Use this reference when a project includes anything beyond one isolated contract, or when an unfamiliar mechanism must
remain open for review. The structure covers contracts, games, map clients, wallet experiences, APIs, services,
databases, indexers, signed data sources, optional onchain oracle verifiers, keepers, claims and later surface kinds.

## Contents

- [Open inventory](#open-inventory)
- [Capability dependencies and handoffs](#capability-dependencies-and-handoffs)
- [Security profiles](#security-profiles)
- [Common surface kinds](#common-surface-kinds)
- [Signed data and oracle verification](#signed-data-and-oracle-verification)
- [Reference and closure rules](#reference-and-closure-rules)
- [Examples](#examples)

## Open inventory

Declare every executable or state-owning boundary once in `projectSurfaces`. Declare what those boundaries can do in
`projectCapabilities`.

- `kind` is an open kebab-case slug. An unfamiliar kind remains schema-valid and enters architecture review.
- `surfaceIds` and `capabilityIds` must link in both directions.
- A new kind does not bypass a security profile. Each capability supplies all ten trigger booleans and the exact
  `requiredProfiles` derived from them.
- Every legacy `capabilityExtensions` entry uses the same id in `projectCapabilities`; an extension outside the graph is
  a blocker because it would have no derived security profiles.
- `authority`, `sourceOfTruth`, `sourceTestSchema`, and `failureRecovery` are always true. A permissionless, value-free
  component still documents who can invoke it, what state is authoritative, what bytes are reviewed, and how it fails.
- Sensitive triggers activate the matching surface profile. The surface exposure flags and capability triggers must
  agree.
- An unfamiliar capability produces a review warning and candidate architecture gate, not an unsafe verdict merely
  because the catalog does not know its name.

The surface inventory describes boundaries, not deployment units. One repository can contain several surfaces, and a
surface can live in a separately pinned companion repository. Keep the exact source contract in the public-source and
review-target records.

## Capability dependencies and handoffs

The current agent's toolset is not a product-category boundary. A Three.js game, maps client, mobile app, backend,
database, data pipeline, specialized cryptography or unfamiliar language remains eligible when its actual mechanism can
be reviewed. Distinguish three facts:

1. **Design eligibility:** the idea is preserved unless a concrete mechanism conflicts with an exact safety invariant.
2. **Current implementation capability:** name the host, tool, skill or expertise that is present, absent or unverified.
3. **Completion evidence:** only source, tests and receipts for the exact component establish that it was built.

When a required capability is absent, use `INTEGRATION_PENDING`. Complete independent layers that can be soundly built,
but never mark the whole project complete and never reject it by category. The handoff must bind the missing surface,
expected inputs and outputs, API or schema, authority and source of truth, security profiles, failure behavior, test
vectors, owner, tool/expertise dependency, acceptance criteria and exact condition for resuming review. A later agent or
specialist may satisfy the handoff; its work still enters the ordinary source, test and evidence closure.

Do not silently substitute a simpler game, map, backend, chain, token model or settlement route because a tool is
missing. Any product-changing fallback returns to the owner as a material choice. A compatible installed domain skill
may be used only within the user's authority; the skill name or successful invocation is not evidence that its generated
component works.

## Security profiles

Every surface contains all profiles. Use `applicable` with concrete controls when linked capabilities require the
profile. Use `not-applicable` with a specific reason when the surface has no such exposure.

| Profile | Required when | Minimum question |
| --- | --- | --- |
| `authority` | Always | Who may invoke, change, pause, replace or publish this boundary? |
| `value-flow` | A capability moves, awards, claims, fees or settles value | Which declared value-flow ids and assets cover every transfer and failure? |
| `source-of-truth` | Always | Which exact chain state, signed payload, database record or derived state is authoritative? |
| `signatures-replay` | A surface consumes a signature or signed data | What is signed, by whom, for which domain, with what expiry and replay key? |
| `external-calls` | A surface calls another contract, API, provider or service | How are targets authenticated, return values checked, retries bounded and partial failure prevented? |
| `custody` | A surface holds funds, positions, claims, keys or withdrawal authority | What is held, by whom, under which solvency and enforceable terminal-state rule: exit, timed/conditional claim, refund, maturity, disclosed forfeiture/burn, legal freeze, or knowingly permanent contribution? |
| `pii-geolocation` | A surface collects personal data or location | Which data, precision, purpose, consent, retention, deletion and disclosure boundary apply? |
| `secret-boundary` | A surface needs API keys, signing keys or private configuration | Which server-only boundary stores, rotates, revokes and audits each secret? |
| `source-test-schema` | Always | Which source, tests, payload/storage schemas and evidence bytes enter the review target? |
| `failure-recovery` | Always | What fails closed, what degrades, how state is reconciled, and can users still exit? |

Do not mark a profile `not-applicable` merely because its controls are inconvenient. Change the capability trigger only
when the actual implementation removes the exposure.

## Common surface kinds

Known kinds accelerate routing; they do not limit what can be proposed.

| Kind | Typical boundary |
| --- | --- |
| `onchain-contract` | Hook, launcher, token, adapter, claim or settlement contract |
| `web-app` / `mobile-app` | User interface, wallet intent and displayed state |
| `game-client` | Local rendering, input and non-authoritative gameplay state |
| `map-client` | Map interaction, public places, location precision and wallet intent |
| `api-service` | Authenticated request/response service and rate/failure policy |
| `database` | Stored records, mutation authority, migration, backup and restore |
| `indexer` | Chain reconstruction, reorg handling, cursor, freshness and reconciliation |
| `signed-data-source` | Offchain producer of canonical signed payload bytes |
| `onchain-oracle-verifier` | Optional contract that verifies a separately declared signed source |
| `keeper` | Scheduled or permissionless bounded execution with idempotency and fallback |
| `claim-service` | Eligibility, entitlement, proof or signed-claim preparation |
| `monitoring` | Health, invariant, freshness and incident signals |
| `external-provider` | Third-party API, storage, RPC, identity or data boundary |

Games and maps are not special safety exceptions. A game result that awards tokens declares value flow, authority,
signatures/replay and failure profiles. A map that uses precise user location declares PII/geolocation. A browser-only
renderer that handles no identity, secret or value may mark those profiles not applicable with exact reasons.

Scientific work, prediction/wagering, transparent participant-funded redistribution, reserve-backed/RWA systems,
privacy flows, AI agents, cross-chain systems, and unknown future concepts use the same open inventory. Their label never
passes or fails review. Triggered value, authority, solvency, truth/freshness, privacy, custody, failure, disclosure,
provider, legal, and platform properties determine the work instead.

## Signed data and oracle verification

Keep production and verification as distinct surfaces:

1. The offchain producer sets `signedDataSource.used: true`, declares signer authority, signature scheme, canonical
   payload schema, freshness, replay protection, and an optional `onchainVerifierSurfaceId`.
2. The optional verifier uses a separate onchain surface with `onchainOracleVerifier.used: true` and lists the signed
   source in `verifiedSourceSurfaceIds`.
3. Both references must agree. One surface cannot be both producer and verifier.
4. A signed source is valid without an onchain verifier when the consumer and threat model do not require one. Keep the
   optional verifier id `null`; do not fabricate a contract.
5. An onchain verifier is not the data source. It verifies declared bytes and signer/domain/freshness/replay rules; it
   does not make the offchain observation objectively true.

The existing `capabilities.oracle` profile remains the onchain model's oracle policy when oracle data can change hook,
pool, claim or settlement behavior. A signed source used only by an offchain display still declares the project-surface
signature and source-of-truth profiles without pretending a hook oracle exists.

## Reference and closure rules

- `authorityRefs` resolve to exact `authorities[].role` values.
- `valueFlowRefs` resolve to `valueFlows[].id`; every value-moving surface has at least one.
- `assetRefs` resolve to `assets[].id`; every custodial surface names what it can hold.
- Surface source and test paths enter the implementation manifest at prototype stage.
- Surface source, test, schema and evidence paths enter the review target. Profile evidence refs must point to one of
  those surface-bound paths.
- Public claim checks follow only declared application/UI paths and `browser` or `mobile-client` surface source paths.
  Bind shipped locale and content JSON, YAML, Markdown or text files to that public surface so visible approval, audit,
  safety, deployment and provider claims are reviewed. Tests, comments, code examples, tool configuration, lockfiles and
  unrelated repository data are not public copy merely because they contain a marketing word.
- Signed payload schemas belong in both `signedDataSource.payloadSchemaPath` and the surface `schemaPaths` list.
- Prototype services, databases, signed sources, verifier contracts and claim services bind a machine-readable API,
  payload, storage, ABI or protocol schema.
- Unknown languages or closure mechanics remain architecture/tooling review items. They do not justify omitting source,
  tests or schemas.

## Examples

Start from the complete `projectSurfaces` and `projectCapabilities` objects in
`assets/templates/submission.example.json`. Copy one surface per actual execution or state boundary, then replace every
id, path, authority, value flow, control and failure rule with project-specific facts. For a game, add a client surface
and any authoritative result service separately. For a map, activate PII/geolocation whenever precise user location is
collected. For signed results, add the offchain source first and add a distinct onchain verifier only when the design
actually consumes one.
