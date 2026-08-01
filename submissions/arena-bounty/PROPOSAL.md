# Proposal

**Submission stage:** Proposal
**Model id:** `arena-bounty`
**Builder:** `@0xprogrammable`

Canonical public source identities are `https://github.com/0xprogrammable/arena-bounty-canary` and
`https://github.com/0xprogrammable/arena-result-service-canary`; exact repository and commit resolution still requires
independent GitHub verification.

Arena Bounty launches a standard token and a canonical native-ETH Uniswap v4 market with an immutable Programmable fee hook, then lets players opt into a separate two-player browser arena with exact deposits, bounded signed results and direct timeout refunds.

## Design card

| Item | Confirmed design |
| --- | --- |
| Outcome | A normally tradable fixed-supply token plus optional first-to-three arena rounds denominated in that token. |
| Pool | Native ETH / launched token, static 3000 hundredths-of-bip LP fee, tick spacing 60, and the immutable `ArenaProgrammableFeeHook`. |
| During a trade | PoolManager pricing plus a native-ETH hook fee in all four swap quadrants; the game, signer and escrow remain absent from the route. |
| Value | Each player deposits the same exact token amount. A valid result pays both stakes to player A or B. Platform charge is zero. A missed deadline gives each player one direct refund. |
| Creator choices | Standard launch parameters plus a separately deployed prize token, immutable result signer, per-round stake, rules hash, join deadline and resolution deadline. |
| Fixed platform rules | Programmable owns exactly 10 basis points of gross canonical-pool quote volume; creator-selected hook fee below 10 basis points is raised to 10; LP fee stays separate; no transfer tax, hidden tag, upgrade, admin redirect or service custody. |
| Authorities | One immutable result signer can choose only between the two recorded players before the round deadline. |
| Dependencies | Model-specific pinned baseline; exact OpenZeppelin 5.6.1, OpenZeppelin Uniswap Hooks 1.1.1, Uniswap v4 Core 1.0.2, Three.js 0.185.1, Playwright Core 1.62.1 and Vite 8.2.0 package bindings; companion commit `24875f9325d6c055a04089cf2c1543dfa862fcad` binds viem 2.55.10 through the v2 static-closure profile. |
| Failure | Launch and trading revert atomically. The game fails without producing a payable result. Signer failure leaves deposits refundable by each player after timeout. |
| Project surfaces | Solidity escrow, JavaScript/Three.js game and JavaScript/viem companion service in two repositories. |
| Product surfaces | Launch, discovery, quote and trade use the ordinary pool. Game, round status, payout and refund need dedicated UI/API/indexing review. |
| Not used | `hookData`, dynamic LP fees, custom curves, async swaps, external liquidity, oracle, keeper, proof, cross-chain behavior and permissioned assets. |

## Why Uniswap v4 and architecture choice

`hook.used` is `true`. The same hook that defines the canonical v4 pool enforces the non-bypassable Programmable share. A match result is still neither price formation nor atomic pool settlement, so the game remains outside callbacks.

- `ArenaPrizeEscrow` owns round custody, signature validation, payout and refunds.
- The browser owns rendering, controls and unsigned practice state only.
- The companion service owns one bounded signing key and never owns tokens or transaction submission.
- The registrar binds each supported PoolKey before initialization. Quotes and trades are delegated to an external Uniswap interface/API client; this repository supplies no swap client.

The factory mines the exact v4 permission address. `BaseHook` authenticates PoolManager callbacks. The permission mask is limited to `beforeInitialize`, `beforeSwap`, `afterSwap`, `beforeSwapReturnDelta` and `afterSwapReturnDelta`; no custom `hookData` is accepted.

## Lifecycle

| Phase | Actor and value | Custody and observable result | Failure or exit |
| --- | --- | --- | --- |
| Token creation | Creator uses the official fixed-supply launch profile. | Standard launch contracts emit the token identity; game surfaces receive nothing. | Any failure reverts the launch. |
| Pool initialization | Registrar registers the exact native-ETH PoolKey and immutable project owner, then initializes through the fee hook. | `PoolRegistered` plus PoolManager `Initialize` bind PoolId, selected totals, LP fee and owners. | Wrong hook, currency order, registrar or duplicate registration reverts. |
| Liquidity formation | Declared token allocation and creator-confirmed ETH enter the canonical position. | Standard PoolManager and position accounting only. | Atomic revert; no game custody exists. |
| Initial transaction | Creator may separately confirm an ordinary routed trade. | Standard receipt and `Swap` event. | Router deadline and slippage rules apply. |
| Trading | Traders use exact-input or exact-output routing in either direction. | Core pricing and LP fee remain authoritative; hook return deltas collect the pool-scoped native-ETH fee as ERC-6909 claims. | Dust that cannot pay 10 basis points and quote-specified partial fills revert; arena state is unaffected. |
| Round creation | Player A deposits one exact stake and fixes rules plus deadlines. | Escrow stores the round and emits `RoundCreated`. | Non-exact transfer reverts; after join deadline player A refunds. |
| Round join | Player B deposits the identical stake. | Liability becomes two stakes and `RoundJoined` is emitted. | Wrong state, same player, late join or non-exact transfer reverts. |
| Game/service | Browser runs the match; service validates and signs the canonical result. | The signature binds both players, stake, token, rules, match digest, action, chain, escrow and deadlines. | No valid signature means no payout instruction. |
| Settlement | Any caller submits the signed result before both deadlines. | Stored state closes before an exact `2 × stake` transfer and `RoundSettled`. | Forgery, replay, outsider, stale result or transfer drift reverts. |
| Timeout | Either player calls directly after resolution deadline. | Each receives exactly one stake once; the second refund closes the round. | One player cannot block the other's claim. |
| Dependency failure | Each affected actor sees the exact failed surface. | Ordinary pool remains independent; the escrow remains solvent by recorded liability. | Stop new paid rounds, retain settlement and refund paths. |
| Retirement | Product stops offering new launches or matches. | Existing ordinary pools and already-created rounds retain immutable behavior. | Continue indexing until every open round closes. |

Liquidity callbacks, donation callbacks and game callbacks are not used. Ordinary v4 liquidity changes and donations retain standard behavior and do not interact with the escrow.

## Assets, pool behavior and integration

- `eth`: native quote asset, 18 decimals, native supply.
- `launched-token`: new fixed supply of `1000000000000000000000000000` base units, 18 decimals, standard transfer behavior, no issuer controls.
- Canonical ordering follows Uniswap currency ordering; native ETH is address zero.
- Routing mode is `uniswap-interface-api`. Router generation, router dependency ids, action profile, client source/test paths and local quote/execution-parity claims are intentionally inactive because this repository supplies no swap client.
- Any later external quote or execution must independently prove the exact canonical PoolKey, coherent state, hook-inclusive user bounds and provider result. Neither may contain game state or a result signature.
- Alternative pools can exist but do not inherit canonical-market fee enforcement, Programmable approval or arena support claims.

The current Sepolia deployment reference is source-conflicted and runtime-unverified. This proposal therefore defines architecture only; execution remains blocked until maintainer-owned deployment evidence resolves that gate.

## Product integration plan

| Surface | Intended behavior | Source of truth | Failure or unsupported state | Planned paths and tests |
| --- | --- | --- | --- | --- |
| UI | Show launch identity, ordinary trade terms, separate arena terms, signer trust, deadlines and refund state. | Confirmed chain reads plus finalized indexed events. | Stale data is labeled and value actions stop. | Maintainers assign product paths after acceptance. |
| App/game | First-to-three arena, keyboard/touch input and unsigned practice result. | Browser state for play; never for payout. | Renderer or client divergence creates no signature. | `src/*`, `tests/round-engine.test.mjs`, browser QA. |
| API | Return chain, model, round identity, canonical match payload, freshness and explicit errors. | Confirmed escrow state and service validation. | Reject oversize, stale, mismatched or unauthenticated production requests. | Companion repository; maintainer path pending. |
| Result service | Sign one fully bound result for player A or B. | Canonical server-side match record plus confirmed round terms. | Fail closed; players refund after timeout. | Companion commit and four local attestation tests. |
| Indexer | Reconstruct pool identity and every round transition with reorg rollback. | Finalized logs reconciled to StateView and escrow reads. | Quarantine mismatches and expose lag. | Maintainer path pending. |
| Quote | External Uniswap interface/API quote for exact PoolKey, direction, exactness, amount, LP fee and hook fee. | Named provider response plus confirmed pool and hook state. | No game data or custom hookData accepted; absence of a quote is an external-provider state. | External provider observation required after deployment. |
| Trade | User-confirmed transaction prepared by the external Uniswap client. | Transaction receipt, `Swap`, `QuoteFeesAccrued` and confirmed pool-scoped liabilities. | External route failure leaves game and escrow state unaffected. | External provider and receipt evidence required after deployment. |
| Claim | Submit signed settlement or player-controlled timeout refund. | Escrow round state and immutable EIP-712 domain. | Invalid signatures revert; timeout remains available. | Solidity lifecycle, replay and refund tests. |
| Monitoring | Separate pool/indexer, service, open-round and escrow solvency signals. | Chain reads, finalized logs and service health. | Stop new paid rounds without disabling exits. | Release owner and runbook required later. |

Third-party routing, discovery and listing remain separate external decisions. No provider support or product availability is claimed.

## Fees, recipients and settlement

The static LP fee remains separate in core and belongs to liquidity providers. For each canonical-pool swap, let the creator-selected total hook fee be `S`, the effective total be `E = max(S, 10 bps)`, and gross native quote volume be `G`:

- `total hook fee = floor(G × E / 10,000)` for gross-specified accounting;
- `Programmable fee = floor(G × 10 / 10,000)`;
- `project fee = total hook fee − Programmable fee`.

Exact-output quote amounts are grossed up with ceiling division, then split by the same fixed 10-basis-point calculation. A nonzero trade reverts if the Programmable share rounds to zero. Liabilities are keyed by PoolId; no cross-pool netting occurs. Only `0x4957f49620AFf3Adbbe8195a4f633E49cc93376c` can initiate a Programmable claim for one PoolId and select that claim's destination. The immutable project owner can claim only its own pool remainder.

For one joined round:

`escrow liability = player A stake + player B stake = 2 × stored stake`

Valid settlement reduces the complete liability, then transfers exactly `2 × stake` to the signed winner. Timeout processing reduces one player liability before each exact `stake` transfer. A failed transfer reverts its complete state change. Direct token donations are excluded from liabilities and cannot be rescued.

## Semantic examples

- Player A deposits 100 ARENA and player B deposits 100 ARENA. A valid result naming player B pays 200 ARENA to player B, charges 0, and leaves 0 round liability.
- If no result is accepted before the resolution deadline, A claims 100 and B claims 100 in either order. Total refunds equal 200 and leave 0 round liability.
- A token that delivers 99 after a requested transfer of 100 reverts round creation or payout; it is not silently socialized.
- A signed outsider address reverts even if the immutable signer produced the signature.
- All four swap quadrants retain PoolManager pricing while the hook collects the exact pool-scoped native-ETH fee. Quote-specified partial fills revert rather than undercharge; quote-unspecified swaps use the final executed quote delta.

## Fact provenance

- **Builder-stated:** desired game concept, equal-stake winner payout, two-repository structure and intended Programmable handoff.
- **Agent-derived:** same-hook fee boundary, signer capability limit, timeout design, canonical payload fields, threat model and test matrix.
- **Evidence-backed locally:** source compilation, 28 Solidity tests including 19 real PoolManager fee-hook tests, 4 game tests, 4 companion tests, browser renders and interactions, static analysis, size output and primary/companion package locks. These checks do not prove deployment, external routing or acceptance.

## Open decisions

No builder product-intent choice is left open. The proposal still requires maintainer architecture and dependency review,
compatible stateful invariant evidence, pinned-fork evidence, exact deployment identities, service
authentication/operations, product paths and independent security review before it can become prototype-ready.

This is a public, non-confidential proposal. Acceptance, deployment, verification, routing, listing and availability require separate evidence.
