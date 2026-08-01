# Scenario matrix

Use this matrix after the idea brief. Apply every row whose trigger is present. More than one row usually applies.

`Automated gate` means a deterministic check can pass or fail. `Review gate` identifies a decision that requires human
judgment.

## Core v4 behavior

| Trigger | Questions to resolve before code | Automated gate and required evidence | Review gate |
| --- | --- | --- | --- |
| Any callback | Which PoolManager is trusted? Is state keyed by PoolId? What does callback `sender` mean? | PoolManager-only entry tests; wrong-manager tests; pool namespace invariant | Confirm no user identity is inferred from a router without authentication |
| Initialization control | Who may register and initialize a pool? Can it happen twice or with a different PoolKey? | One-shot registration, exact PoolKey, wrong-caller, replay and atomic rollback tests | Confirm the initialization authority matches the product promise |
| Liquidity callbacks | Are deposits or withdrawals gated, transformed, penalized, or accounted? | Both currency orders; add/remove boundary tests; delta and position ownership invariants | Confirm LP exit and penalty policy is understandable and non-deceptive |
| Donations | Can a donation change price, accounting, rewards, or oracle state? | Unauthorized and zero donation tests; donation-manipulation invariant | Economic review of donation-driven state |
| Mandatory Programmable volume fee | Does the canonical PoolKey use a project-specific implementation of the standard fee-hook profile or one custom hook with the policy integrated? Is selected total understood as inclusive rather than additive? Can the hook initiate a same-pool swap? | `effective=max(selected,10 bps)` with selected zero/below/equal/above floor and `3% -> 0.1% + 2.9%`; executed gross quote-side basis after partial fills; quadrant-dependent before/after return-delta paths; same-pool self-call forbidden or internally fee-enforced; immutable owner `0x4957f49620AFf3Adbbe8195a4f633E49cc93376c`; owner-only claims to self or per-claim destination; `(poolId,currency,owner)` liabilities; no cross-pool netting; router/LP-fee/tax/alternative-pool bypass tests | Maintainer review of the exact fee mechanism, canonical-pool binding, rounding, solvency, claim surface and public disclosure; local checks do not prove live collection |
| Dynamic LP fee | What sets the fee? What are min, max, cadence, and stale behavior? | Dynamic flag present; explicit initial fee; bounded fee tests; no overflow past core maximum | Math, governance, manipulation, and user-disclosure review |
| Liquidity-dependent behavior | What exactly does "depth" mean: active in-range liquidity, executable depth for a stated trade size, token quantity, or value in a reference asset? Is it instantaneous, delayed, or time-weighted? | Exact metric and units; reference asset; tick-crossing and range tests; same-block add/swap/remove; donation and flash-liquidity manipulation; liquidity-decrease and cross-pair comparability tests | An instantaneous v4 liquidity value is not TVL, dollars, market cap, or guaranteed trade depth; prefer a bounded delayed or time-weighted rule with explicit failure behavior |
| Per-swap fee override | What state or data selects the override? | Override flag only on a dynamic-fee pool; exact router generation; bound tests | Price-impact and MEV review |
| OpenZeppelin `BaseHookFee` | Is the intended charge hook-owned or an LP fee? Which currency is unspecified in every direction and exactness mode? Is the product claiming ETH or quote-asset revenue? | Exact preview package pin; immutable application cap below the base's 100% ceiling; zero fee and all four direction × exact-input/exact-output tests; ERC-6909 claim and redemption conservation | Mandatory review of fee denomination, trader disclosure, recipient policy, conversion behavior, and whether the model actually matches the stated revenue promise |
| Shared hook fee accounting | Can one hook serve several pools or beneficiaries? How are claims attributed when ERC-6909 balances are aggregated by currency? | PoolId-scoped liability ledger; duplicate-currency and cross-pool adversarial tests; invariant that aggregate liabilities never exceed corresponding claim balance or redeemable underlying | Prefer one hook instance per pool; shared deployment requires explicit complexity and correlated-risk acceptance |
| `beforeSwapReturnDelta` | Which amount is specified, which is unspecified, and what backs every returned delta? Can the AMM leg become zero? | Parent bit; four swap quadrants; balance-backed conservation; partial-fill, nested-action, slippage, fork and stateful invariants | Mandatory high-risk economic and independent security review |
| Other return deltas | Which asset or liquidity amount is changed and who receives the difference? | Parent bit; signed-bound tests; settlement and solvency invariants | High-risk accounting review |
| HookData | Who encodes it, what schema/version applies, and how is identity authenticated? | Length, version, malformed, replay and untrusted-sender tests | Router trust and forward-compatibility review |
| Custom curve | What invariant replaces the AMM math? Where are rounding and boundary proofs? | Domain, monotonicity, precision, overflow, conservation, differential and stateful tests | Specialist math review and independent audit |
| Hook-owned liquidity | Who deposits, owns shares, exits, and absorbs loss? Can accounting be manipulated by donations? | Share/asset solvency; first-depositor; donation; rounding; emergency and exit invariants | Custody, strategy, loss, monitoring, audit, and bug-bounty review |
| DualPool/JIT inventory | Are raw ERC-20, ERC-6909 claims and ERC-4626 shares partitioned by `(PoolId, Currency)`? Which assets are economically owned versus immediately realizable? | No persistent post-swap JIT position; core-liquidity changes only by the hook; per-pool/global JIT locks; `economicAssets` and `effectiveAssets` invariants; cross-pool same-currency isolation; backed-claim redemption | Treat official DualPool as a complete controlled model, not a generic base; review owner powers, vault correlation, exit liquidity and exact audit scope |
| Custom-accounting reserve report | What is core principal, hook-managed reserve, immediately available liquidity and self-reported data? Can values overlap? | Same-block complete `ReservesLens` scan; opaque cursor continuity; core/hook fields separate; `effective <= reserves`; no sum without non-overlap proof; indexer reorg/resync reconciliation | A return-delta permission is a capability warning, and `IHookStats` is a report, not solvency or custody proof |
| Composite rounding and branch transitions | Can repeated tiny operations change a later token-side, range, active/idle or share conversion branch? | Extreme price → repeated tiny burn/withdraw → reverse-swap regression; aggregate-versus-fragmented equivalence with call-count-independent dust; both rounding directions; non-positive unexplained round-trip PnL | Mandatory economic and invariant review for Bunni-style sequence risk |
| Async or delayed swap | Who holds unsettled value? How are orders filled, canceled, expired, and refunded? | Queue bounds; double-fill; cancellation; expiry; liveness; solvency; griefing tests | Market-structure, custody, and operational review |
| Multi-pool hook | Which pools are accepted and how is state separated? | Exact registry; PoolId namespacing; cross-pool contamination invariants | Aggregate exposure and correlated-failure review |

## Upstream packages and evidence

| Trigger | Questions to resolve before code | Automated gate and required evidence | Review gate |
| --- | --- | --- | --- |
| OpenZeppelin Uniswap Hooks import | Is this the stable npm profile, preview npm profile, or the preserved Programmable-tested baseline? Do package integrity, source commit, source tree, compiler, and transitive resolutions all agree? | `compatibility.lock.json`; registry-integrity check; source-tree check; exact compiler and EVM; clean install and complete compile; hard fail on the similarly named `v1.1.1` and `v1.2.1` Git tags | A newer OpenZeppelin profile is an isolated upgrade candidate, never a silent replacement for deployed-release provenance |
| OpenZeppelin Wizard, CLI, or MCP output | Which exact generator version and input produced the scaffold? Which TODO, permission, access, pause, and handler behavior remains? | Exact generator package and integrity; captured input JSON and output hash; zero TODOs; no callback delegating to unimplemented `BaseHook`; every public method has an explicit authorization or safe permissionless specification | Generator output is scaffolding, not acceptance, security review, or compatibility proof; do not copy AGPL tooling code |
| Upstream audit reference | Which report, reviewed commit, file scope, fix commit, and derived diff support the statement? | Evidence record links exact report and commit; source diff against the derived model; hard fail the audit-coverage claim if the release uses `BaseHookFee`, rehypothecation, or oracle code outside the cited scope | Allowed default wording: `Uses OpenZeppelin Uniswap Hooks primitives from the pinned release.` Never say `Audited by OpenZeppelin` without evidence that the exact derived source and configuration received that review |
| Official concrete model | Is the proposal adopting the whole upstream architecture or extracting a convenient contract? | Exact commit, complete component graph, deployment/runtime/config and derived diff; model-specific lifecycle suite | Permissioned Pools and DualPool are complete trust/economic models; a fork or partial extraction is a new review target |
| UniRoute public or onchain-router reference | Does the exact source support this hook's deltas, dynamic state, `hookData`, exactness and route shape? Is package and file-level license coverage resolved? | Differential quote/execution tests for every capability; runtime/deployment proof when claimed; fail closed on empty or dropped `hookData` | Reference-only until provenance, license, deployment and exact hook semantics are established |

## Assets and token behavior

| Trigger | Questions to resolve before code | Automated gate and required evidence | Review gate |
| --- | --- | --- | --- |
| New fixed-supply token | Who creates it? Can anyone mint, pause, freeze, blacklist, confiscate, or tax transfers later? | Supply conservation; no hidden authority; exact factory and metadata ABI tests | Confirm the visible token profile matches code |
| Existing ERC-20 | Does it return false, no data, or malformed data? Does it require allowance reset? | Adversarial return-value and allowance matrix using safe wrappers | Decide which non-standard tokens are supported |
| Transparent no-hook transfer tax | What are buy, sell and peer rates, the immutable maximum, exemptions, recipients, value flows, mutability and PoolManager transfer scope? How are shared PoolManager ingress/egress, liquidity operations and alternative pools classified? Can any valid transfer or sale be blocked? | Direction rates; zero and maximum; recipient conservation; requested-versus-received; liquidity add/remove and alternative-pool classification; classifier spoofing; exact-output/multihop compatibility; unrestricted buy/sell/peer liveness; authority-delay tests | High-risk compatibility and economics review; provider support remains external |
| Automatic liquidity token | Which tax bucket funds it? What safe trigger, pool-transfer suppression, threshold, per-action cap, slippage, deadline and reentrancy rule apply? Who owns the position and can it exit or transfer? | Threshold boundaries; maximum swap; actual received; slippage/deadline; pool-transfer and cross-function reentrancy; failure cannot block the underlying transfer; LP custody and exit tests | Custody, MEV, price impact, user disclosure and independent provider review |
| Other fee-on-transfer token | Is support rejected or based on observed balance deltas? | Requested-versus-received balance tests; solvency invariant | High-risk compatibility and economics review |
| Rebasing token | Who receives positive or negative rebase? What unit is accounted? | Rebase-before/during/after action tests; shares-versus-assets invariant | Decide whether the model can explain rebase loss and gain |
| ERC-777 or ERC-1363 callbacks | Can token movement reenter another function or pool action? | Cross-function and cross-contract reentrancy tests | Decide whether callback tokens are worth the expanded surface |
| Pausable, blacklistable, confiscatable asset | Who controls it and what happens to pool exits? | Paused/frozen/blacklisted dependency-failure tests | Permissioned or external-asset trust disclosure; legal review when applicable |
| ERC-4626 vault share | Are previews treated only as estimates? What are fees, limits, donation and loss behavior? | Preview/execution divergence, rounding, limit, donation and loss tests | Vault strategy, upgrade and oracle risk review |
| Native ETH | Where can forced ETH or failed reception affect accounting? | Forced-balance and rejecting-recipient tests; pull-claim path | Confirm no raw contract balance is used as authoritative accounting |

## Authority, signatures, and deployment

| Trigger | Questions to resolve before code | Automated gate and required evidence | Review gate |
| --- | --- | --- | --- |
| Owner or role | What exact capability is controlled? Can it move user funds or change economics? | Role-capability matrix; every unauthorized caller; zero-address and transfer tests | Least privilege, key custody, multisig and timelock decision |
| Upgradeable contract | Why is immutability insufficient? Who upgrades and after what delay? | Locked implementation initializer; atomic initialization; storage diff; proxy/admin/beacon slots; state-preservation tests | Necessity, centralization, incident and disclosure review |
| Minimal clone | Which implementation and immutable args apply? | EIP-1167 runtime and implementation identity; initializer replay tests | Implementation governance review |
| Pause or rescue | Which states allow it and who owns rescued value? | Authorized states; no confiscation; historic entitlement and exit tests | Emergency design and public-disclosure review |
| EIP-712 or ERC-191 signature | Are chain, verifying contract, action, all parameters, nonce and deadline bound? | Mutation, replay, expiry, cross-chain, cross-contract and low-s tests | Confirm intent scope is narrow enough |
| ERC-1271 wallet | Can validity change over time? | EOA and contract-wallet tests; no cached validity | Wallet-policy compatibility review |
| ERC-2771/meta-transaction | Which forwarder is trusted? Is recovered sender used consistently? | Forged-forwarder and mixed-sender tests | Forwarder governance review |
| Smart accounts or EIP-7702 | Does logic assume code-less EOAs or `tx.origin`? | Contract-like EOA and account-abstraction mocks | Product support policy |
| CREATE2 hook deployment | What exact deployer, salt, creation code and constructor args are used? | Recompute address; permission mask; same deployer; post-deploy runtime and config checks | Confirm reproducibility and deployer custody |
| Arbitrary call or delegatecall | Can user input control target, selector, calldata, or storage context? | Hard fail for user-controlled or unexplained authority | Only a materially redesigned, narrowly typed integration may continue |

## External systems and autonomous behavior

| Trigger | Questions to resolve before code | Automated gate and required evidence | Review gate |
| --- | --- | --- | --- |
| Oracle | What value is read, from where, over what window, and with what stale/deviation rule? | Stale, zero, negative, revert, manipulation, decimal and fallback tests | Oracle economics, source governance and incident review |
| Spot pool price | Can the same transaction or flash liquidity manipulate the decision? | Atomic manipulation and reverse-path tests | Normally redesign around a manipulation-resistant observation |
| Keeper | What action runs, who may call it, how is it funded, and what if it stops? | Idempotency, early/late/duplicate calls, bounded work, zero-funds, revert and permissionless-fallback tests | Liveness, gas runway, key management and monitoring review |
| Autonomous parameters | What state transition changes behavior and what bounds are immutable? | State-machine invariants; rate limits; bounds; recovery and stuck-state tests | High-risk control, monitoring and two-reviewer consideration |
| External protocol | Which exact deployment and capability is trusted? What if it pauses, upgrades, depegs or reverts? | Address/runtime/interface checks; failure and state-drift scenarios | Dependency, contagion and exit review |
| Flash loan | Who is the lender and initiator? What atomic state can be manipulated? | Authenticated callback, repayment and atomic economic invariants | Economic-manipulation review |
| Time or block condition | Is timestamp tolerance acceptable? Is block data misused as randomness? | Boundary, same-block, delayed and reorg-sensitive tests; hard fail for insecure randomness | Timing and liveness assumptions |
| Cross-chain message | Which bridge, domain, finality, replay and failure model applies? | Source/destination, nonce, replay, delay, reorg and forged-message tests | Separate high-risk bridge and operational review |
| ZK proof | What statement is proven? Which chain, contract, model version, public inputs and nullifier are bound? | Invalid/malleated/replayed proof, wrong domain, gas bound, verifier identity and trusted-setup provenance | Cryptographic review, proof-system assumptions and privacy analysis |
| Private or encrypted input | Is any secret assumed to remain private onchain or in calldata? | Hard fail for onchain secrecy assumptions; commit-reveal timing tests where used | Metadata leakage, operator access and user-expectation review |

## Market, routing, and product behavior

| Trigger | Questions to resolve before code | Automated gate and required evidence | Review gate |
| --- | --- | --- | --- |
| Canonical pool claim | Can anyone create an alternative pool and how is the canonical pool proven? | Launcher event plus exact PoolKey and provenance hash; reject shared-hook event alone | Clear UI and indexer disclosure |
| Router restriction | Is the registry immutable or access-controlled? Can a router prove end-user identity? | Unauthorized add/remove tests; code/interface validation; exact supported generations | Governance and routing review; never copy an unrestricted registry example |
| Exact output | How is gross-up rounded and how are partial fills handled? | Tiny amounts, maximum fee, rounding, partial fill and all direction tests | Confirm trader-facing semantics |
| Position custody | Who owns the NFT or hook shares? Can operator, approval, reduce or transfer paths change that? | Owner, operator, timelock, transfer, decrease and dust-conservation tests | Confirm “locked” describes the exact release, not a general claim |
| Fee or reward split | Are shares deducted from the disclosed total? Can any party redirect another party's rewards? | Sum, rounding, duplicate, zero, recipient failure, beneficiary-only claim and historic entitlement tests | Economic clarity and conflict review |
| Permissioned pool | Who controls eligibility, position transfer, swapping, wrapper admission and unwind? Is each permissioned PoolKey currency and settle/take id the adapter? | Adapter factory/adapter/hook/position-manager/router runtime binding; lying and unregistered wrapper tests; hook revocation preserves decrease/burn; per-currency LP/admin/claim unwind cascade | Issuer, asset rights, legal claim, redemption, compliance, custody, forced exit, routing and jurisdiction review; factory verification is not approval |
| Multihop v4 route | Does every `PathKey` bind currency, fee, tick spacing, hook and `hookData`? Can the same hook run twice in one unlock? | Exact-input/output in both directions; per-hop quote parity; repeated/shared-hook state; sequential dynamic changes; all intermediate deltas zero; endpoint slippage/refund proof | Router generation and provider-lane review; ordinary v4 support does not prove UniswapX or permissioned routing |
| Third-party or protocol indexer | Is it used only for discovery or displayed data? Which deployment, schema, start block and confirmation policy apply? | Reconcile against confirmed chain state; reorg rollback and deterministic resync test; never accept it as reserve, quote or receipt proof | Metadata, listing, freshness and chain-coverage limitations disclosure |

## Universal hard tests

Every prototype includes:

- Zero, one, boundary, maximum, and overflow-adjacent values
- Both token orderings where the model supports them
- Both swap directions and exact-input/exact-output modes
- Unauthorized callers and malformed `hookData`
- Reverting and reentrant recipients
- Dependency failure and recovery
- Repeated calls, replay, initialization twice, and cross-pool attempts
- Invariant call and revert counts so reject-heavy fuzzing cannot masquerade as coverage
- Runtime and initcode size checks
- Event replay sufficient to reconstruct the public lifecycle
