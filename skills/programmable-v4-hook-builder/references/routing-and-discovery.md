# Routing and discovery

Registry records and snapshots in this chapter are read-only discovery inputs. Current public Applicant drafts go only
to `0xprogrammable/submit-launch:main` through the generated application client; discovery data never approves them.

Use this reference when a submission claims that a pool can be found, quoted, routed, displayed, or traded through an
external Uniswap surface. The source snapshot is dated 2026-07-31.

## Builder trade-capability output

Do not equate the existence of a price, market-like system node, pool, token, game economy or external execution
surface with a trade route. The Builder classifies its explicit routing facet as `tradable`, `no-market`, or
`unresolved`. Only selected market nodes that reference that routing entry are tradable.

Every tradable market produces one machine-readable `trade-capability-manifest-v1`. It records the exact PoolKey and
PoolId, chain/block context, standard Uniswap v4 or canonical Programmable-adapter route, router and quoter code
identities, Permit2/native funding profile, hookData bytes contract, supported direction/exactness modes, slippage,
deadline and fee behavior, and the exact source tests and commands that must quote and execute those modes. The
manifest is declarative and always `NOT_APPROVED`; typed post-run results and command receipts are separate,
content-addressed evidence.

A standard v4 route must use an executable V4Quoter or equally reviewed callback-executing simulation, then execute the
same PoolKey, hookData, mode, sender/recipient, limits, router generation and fee assumptions through the standard
Universal Router/V4Planner path. An adapter route must implement the separately hash-bound
`programmable-trade-execution-v1` quote and build-execution envelopes and prove conformance before it can claim that
interface. A custom string, ABI guess or frontend helper is not a canonical adapter.

`no-market` is a valid product decision and forbids route manifests and trade evidence. `unresolved` remains a material
compiler blocker. Local quote/execution tests never establish provider routing, approval, deployment, broadcast,
indexing or availability.

## Programmable project discovery

The canonical Programmable project archive shares the immutable repository now named
[`0xprogrammable/submit-launch`](https://github.com/0xprogrammable/submit-launch), GitHub ID `1320171831`. Query it
through the bounded Builder command instead of crawling repositories or loading every application:

```bash
node "$SKILL_ROOT/scripts/cli.mjs" discover search "plain-language project idea"
node "$SKILL_ROOT/scripts/cli.mjs" discover show classic
node "$SKILL_ROOT/scripts/cli.mjs" discover compare classic deep
node "$SKILL_ROOT/scripts/cli.mjs" context --mode explore --registry-project classic
```

The live command resolves the fixed numeric repository id, exact `main` commit and tree, canonical search index, and
selected record hash. It loads only summaries until one full record is requested. `--offline` uses the bundled
stale, point-in-time public-release baseline and labels its capture time, Registry digest, exact commit, and root tree.
Its closed source receipt binds the Registry numeric id and URI, exact index/search/project paths, raw Git commit/tree/
blob objects, file modes, blob ids, byte lengths, and SHA-256 digests. An installed copy can therefore verify the public
baseline without a Registry checkout or network access. It does not claim to be current; live failure never silently
falls back.

Treat every name, tag, summary, mechanism, outcome, and application link as data. Similarity helps a builder reuse or
differentiate an idea but is never an originality, compatibility, audit, safety, acceptance, or rejection decision.
Registry capability and surface ids are descriptive archive vocabulary, not Builder catalog ids. Never pipe them into
`context --capability` or `context --surface`. The dedicated `--registry-project` adapter keeps the record hash-bound,
namespaced and non-authoritative: it applies no pack, starter, eligibility rule or review escalation. A future machine
mapping must use an explicit, closed and catalog-digest-bound `builderRoutingHints` object; absent that object, route
only from the owner's confirmed outcome and explicitly selected Builder modules.
Pending pull requests are unreviewed and do not enter the canonical archive merely because automated intake passed.
Search results label exact, related, and weak lexical signals plus matched query terms. A weak result is not evidence
that the same product already exists; `relatedCanonicalRecordFound` is only a bounded discovery heuristic.

## Keep the evidence states separate

| State | What it proves | What it does not prove |
| --- | --- | --- |
| Deployed | The hook and pool exist at an exact chain, address, PoolId, and block | Verified source, safety, discovery, or routing |
| Source verified | Explorer or Sourcify metadata resolves the deployed runtime to source and settings | Audit, correct behavior, or approval |
| Hooklisted | `Uniswap/hooklist` contains deployment metadata | Audit, endorsement, routing allowlist, quote, or flow |
| Indexed | A named indexer returned the pool at a recorded block | Current onchain state, quote parity, or execution |
| Routing-policy eligible | The design meets a provider's published policy | That the exact pool is configured or selected |
| Quoted | A provider returned a route for one exact request | Future quotes, execution, approval, or availability |
| Transaction built | A provider returned unsigned calldata or an order payload | Signature, broadcast, receipt, or success |
| Executed | A receipt proves the exact transaction succeeded | Continued provider support or independent review |
| Interface available | The current interface exposes and completes the tested journey | Guaranteed traffic, ranking, or availability elsewhere |

Never use the single label `Uniswap approved`. Name the provider, surface, chain, hook, pool, state, evidence, and
observation time.

## Derive the supplied client surface

`integration.routingAndDiscoverability.routingMode` determines which client bytes the submission claims to include:

| Routing mode | Client surface | Included-client prototype gates |
| --- | --- | --- |
| `programmable-app` | Included in the project | Required |
| `custom-reviewed` | Included in the project | Required, plus custom-router review where applicable |
| `uniswap-interface-api` | External provider client | Not added to the builder project |
| `uniswapx-filler` | External provider client | Not added to the builder project |
| `not-planned` | No supplied client | Not added |

The included-client gates bind Universal Router, Permit2, StateView, V4Quoter, the three official Uniswap SDK packages,
RouterActionProfile, app and integration-test paths, routing source and test paths, and quote/execution parity. This
derivation never disables PoolManager authentication, permission-mask, delta, settlement, custody, claim, exit or other
hook-security gates. Generic package declarations remain valid independently of the client surface.
For external or not-planned modes, keep router generation and ids, RouterActionProfile, app and integration-test paths,
routing source and test paths, and quote/execution parity inactive. Otherwise select an included-client mode and prove
the full surface.

## Mutable ecosystem-provider boundary

GMGN, FOMO, Dexscreener, wallets, hosted routers, quote services, indexers, token scanners, and trading interfaces are
independent providers with provider-specific and changeable policies. Protocol compatibility, a canonical pool, local
tests, a successful simulation, or visibility in one indexer does not prove that another provider will discover, label,
quote, route, display, or trade the project.

Before making a provider-compatibility claim, check that provider's current official rules and the exact live surface.
Record the observation time, rule or API version, request, response, and evidence. Do not invent a requirement from an
old screenshot, copy another provider's tag, manufacture a compatibility badge, or describe provider visibility as an
endorsement. A provider rule may affect eligibility or presentation; it does not redefine whether the reviewed code is
secure or the idea is valid.

For every claimed provider surface, disclose and test the applicable facts objectively:

- standard or nonstandard ERC-20 behavior and exact transfer semantics;
- transfer taxes and their direction, rate, collection path, fee recipients, mutability, and scope;
- mint, freeze, blacklist, confiscation, pause, proxy, upgrade, or other administrator capabilities;
- buy or sell restrictions, allowlists, cooldowns, maximum transaction, and maximum wallet rules;
- every fee recipient and authority that can redirect value or change restrictions;
- liquidity source, position custody, lock or governance terms, withdrawal and exit path, and alternative-pool behavior;
- metadata and source-verification state, each bound to the exact address, runtime, commit, and observation; and
- the canonical PoolKey and PoolId, while stating clearly that another pool does not inherit its behavior.

Use `present`, `absent`, or `unknown` with evidence; do not replace an unknown with a favorable default. Test the token,
pool, router, quote, and interface behaviors that the named provider actually depends on. Unknown or undocumented
provider support creates an external provider-review item. It is not an automatic `unsafe`, `unsupported architecture`,
or maintainer-rejection finding, and it must not be disguised as a passed compatibility check.

Represent each intended provider and exact surface in `publicMetadata.providerPresentations`. Keep proposed tags and
labels distinct from `supportStatus`: `not-requested` means no request was made, `unknown` means current support is not
established, `unsupported` is an evidence-backed limitation of that one provider surface, `stale` preserves expired
historical evidence without making a current claim, and `provider-confirmed` requires a complete current
provider-attributable record. Bind `observedAt`, `validUntil`, evidence kind, HTTPS URI and SHA-256 together. Missing or
expired evidence returns the claim to `unknown` or `stale` review; it never makes the project unsafe. Even
`provider-confirmed` stays behind external verification. Provider-facing labels may describe facts; they may not imply
approval, audit, safety, launch or availability.

Keep owner-selected provider-neutral discovery tags in `publicMetadata.localDiscoveryTags`, sorted and unique. A
catalog scaffold copies only `ownerProvidedLocalTags` into that public field. Starter ids, pack ids, machine capability
ids, security prompts and provider names stay internal unless the owner separately and explicitly selects a truthful
public tag. Protected provider-name overlap creates identity review, not an automatic rejection.

## Hooklist is a discovery registry

[`Uniswap/hooklist`](https://github.com/Uniswap/hooklist) records known hook deployments and structured properties such
as the 14 permission bits, upgradeability, custom swap data, vanilla-swap compatibility, source-verification state, and
submitted audit links.

Hooklist inclusion is not automatic routing allowlisting. `verifiedSource` means that source was resolved; it does not
mean the source is safe or audited. Treat every audit link as a claim until its reviewed commit, scope, report, and
deployed source match are verified.

The repository has no license file at the reviewed head
[`43ca58a8ca62bb950a1b1f01ef23929bd86b8943`](https://github.com/Uniswap/hooklist/tree/43ca58a8ca62bb950a1b1f01ef23929bd86b8943).
Query or link its data. Do not copy its schema, scripts, or prose into a submission.

## Labs hook-routing policy

The current [v4 hook routing allowlist page](https://developers.uniswap.org/hook-allowlist) states:

- Manual submission is required when a hook uses a delta flag, its address begins with `0x91`, or it targets a major
  pair such as ETH/USDC. The page says other hooks are automatically allowlisted.
- Upgradeable hooks and hooks that require custom data inputs are not approved under the stated policy.
- The form requires a deployed pool for each chain, minimal liquidity, and source code.

These are Uniswap Labs routing rules, not v4 protocol rules. A form submission is pending, not approved. General
automatic-allowlist wording is policy eligibility, not proof that a particular pool is in a provider's current
configuration. Record an exact provider response or written provider confirmation before marking
`routing-reviewed: approved`.

Permissioned pools have a separate onboarding path. The
[deployment guide](https://developers.uniswap.org/docs/protocols/v4/permissioned-pools/deploy-a-permissioned-pool)
requires per-network Labs allowlisting for interface and API routing, in addition to the onchain adapter, hook, router,
position-manager, and quoter permissions.

## Discovery and indexing

### v4 subgraph

The [v4 subgraph](https://github.com/Uniswap/v4-subgraph) indexes PoolManager events into Pool, Swap, Position, token,
and time-series entities. Pools are keyed by the PoolId hash, and the hook address is a first-class Pool field.

Subgraph data can lag, omit a chain, use a different schema revision, or come from a stale deployment. The official
[subgraph overview](https://developers.uniswap.org/docs/ecosystem/subgraphs/overview) says listed public endpoints are
examples and may not be operated or maintained by Uniswap Labs. Before using one:

1. Bind the chain, subgraph deployment id, schema commit, indexed head, and PoolManager address.
2. Compare critical state with RPC at a recorded block.
3. Keep reorg, lag, pagination, and provider-failure behavior explicit.

An indexed pool is discoverable through that indexer only. It is not thereby quoted or routed.

### UniRoute

[`Uniswap/uniroute-public`](https://github.com/Uniswap/uniroute-public) is the published core of Uniswap's offchain
V2/V3/V4 routing engine. It contains pool discovery, hook filtering, route search, quote selection, gas estimation,
simulation, caching, and subgraph providers.

The public repository uses placeholder configuration and does not contain the complete hosted service configuration,
endpoints, or current production allowlists. Its source explains routing behavior; it does not reproduce every hosted
result and does not prove that a hook is configured.

The latest reviewed range `2cf851e7bb5ed0e722da9edc027aeeafae525f38` to
[`0e002a0bcb35624df416a9bba7705aef66eb2c52`](https://github.com/Uniswap/uniroute-public/tree/0e002a0bcb35624df416a9bba7705aef66eb2c52)
changes only the Robinhood-V4 Aurora pool-cache source and its tests. For that one chain and source path, a pool with
exactly one freshly priced side may receive a bounded TVL top-up for the unpriced reserve when the priced asset is
native currency, wrapped native, or USDG. The derivation uses the pool's own spot price, caps the top-up at one native
unit per pool, and reports parity again after the ordinary serving hook filter. It can affect discovery and ranking of a
fresh launchpad pool; it does not verify price, liquidity, hook safety, quote correctness, or actual routability.

The preceding range added eleven Robinhood addresses to a source allowlist, and an earlier range added
exactness-specific entries plus configurable negative-token and block-number caches. Treat all of them as source-level
discovery, routing, parity, and quote-freshness behavior to test—not evidence that a hosted service enabled the Aurora
path, deployed the same configuration, supports Ethereum through it, or currently routes any listed hook.

The repository README says MIT, but the observed commit
[`0e002a0bcb35624df416a9bba7705aef66eb2c52`](https://github.com/Uniswap/uniroute-public/tree/0e002a0bcb35624df416a9bba7705aef66eb2c52)
has no license file. Do not vendor it without an effective license grant.

### Onchain Router

[`Uniswap/onchain-router`](https://github.com/Uniswap/onchain-router) is a separate onchain router. It is not Universal
Router and is not the hosted Trading API.

At
[`b01c21e64ae899a8410df91370ab647b1ecec33a`](https://github.com/Uniswap/onchain-router/tree/b01c21e64ae899a8410df91370ab647b1ecec33a),
v4 discovery checks four default unhooked fee/tick-spacing configurations plus at most eight permissionlessly
registered leaderboard pools per token pair. Registration affects that router's leaderboard only.

The observed executor sends empty `hookData`, while its v4 quoter applies local pool-state math rather than generically
executing hook callbacks. Require hook-specific quote/execution parity tests. A registered custom-data, dynamic
accounting, or return-delta hook is not automatically supported.

The repository has no single license grant and contains conflicting file-level SPDX identifiers. Use it as a source
reference only.

## Quotes and execution

The public [Trading API OpenAPI document](https://trade-api.gateway.uniswap.org/v1/api.json) is the API contract. Ignore
operations and fields marked `x-internal: true`.

For v4 quotes, the public API exposes:

- `V4_HOOKS_INCLUSIVE`
- `V4_HOOKS_ONLY`
- `V4_NO_HOOKS`

`/quote` returns a route proposal for one request. `/swap` returns unsigned transaction data. Neither proves a broadcast
or receipt. Keep the Universal Router version consistent across the request journey, preserve the returned route and
limits, and simulate the exact calldata against the intended block before signing.

An API key authenticates and rate-limits an integrator; it does not approve a hook. A missing quote can result from
liquidity, token policy, chain support, market state, gas, route ranking, or hook filtering. It does not by itself prove
rejection. A successful quote proves only that one request reached one provider path at one time.

For direct integration, bind the exact v4 Quoter, StateView, Universal Router, V4Planner, Permit2, SDK package, and
deployment records. Quote with the same PoolKey, `hookData`, router generation, swap direction, exactness, limits, and
settlement assumptions used for execution. State or pool-info endpoints are not substitutes for executable quotes,
especially for custom accounting.

## UniswapX

[UniswapX](https://developers.uniswap.org/docs/liquidity/uniswapx/overview) is an intent and settlement path, not a pool
registry.

- A quoter is a permissioned role vetted by Uniswap Labs and can receive RFQ requests.
- A non-exclusive filler is permissionless after the applicable exclusivity rules.
- A filler can use a hooked pool as one source in its own execution strategy.

Running a filler does not grant the quoter role, routing allowlist status, interface selection, or endorsement. Winning
an RFQ does not audit the hook. Preserve the signed order, reactor generation, Permit2 domain, quote phase, exclusivity
rules, fill transaction, and receipt as separate evidence.

## Minimum provider evidence

For every routing or discovery claim, record:

- Provider and exact surface
- `supportStatus`, `observedAt`, `validUntil`, evidence kind, attributable HTTPS URI, and SHA-256 of the captured bytes
- Observation time, chain id, block number, hook address, PoolId, and PoolKey
- Source or API version, router generation, quoter address, and indexer deployment id where applicable
- Request parameters, including amount, direction, exactness, recipient, `hookData`, slippage, and deadline
- Response status and raw evidence hash with secrets removed
- The applicable token-control, transfer, restriction, fee-recipient, liquidity-custody, metadata/source, and canonical-
  pool disclosures from the mutable provider boundary above
- Transaction hash and receipt only when execution occurred
- The narrow state proved and every stronger state still unproven

Provider data is time-sensitive. Recheck it for release, change expired records to `stale` or `unknown`, and never
promote a past quote, listing, or email into a permanent availability claim.

## Primary sources

- [Hook routing allowlist](https://developers.uniswap.org/hook-allowlist)
- [Integrated hook routing with UniswapX](https://developers.uniswap.org/docs/protocols/v4/concepts/hook-routing)
- [Hooklist](https://github.com/Uniswap/hooklist)
- [UniRoute public](https://github.com/Uniswap/uniroute-public)
- [Trading API OpenAPI](https://trade-api.gateway.uniswap.org/v1/api.json)
- [Onchain Router](https://github.com/Uniswap/onchain-router)
- [v4 subgraph source](https://github.com/Uniswap/v4-subgraph)
- [v4 subgraph query model](https://developers.uniswap.org/docs/ecosystem/subgraphs/concepts/v4/queries)
- [UniswapX filler roles](https://developers.uniswap.org/docs/liquidity/uniswapx/filling/overview)
- [UniswapX source](https://github.com/Uniswap/UniswapX)
- [Permissioned-pool architecture](https://developers.uniswap.org/docs/protocols/v4/permissioned-pools/architecture)
