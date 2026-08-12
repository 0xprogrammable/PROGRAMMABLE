# Official model patterns

Use this reference only after the intake has identified a matching capability. A resemblance to an upstream model is
not approval to copy it, evidence of compatibility, or inherited audit coverage.

Source snapshot rechecked on `2026-08-03`:

| Source | Pinned revision | Relevant surface |
| --- | --- | --- |
| [Uniswap v4 periphery](https://github.com/Uniswap/v4-periphery/tree/545a5d2a87228167edde48f3b9eda122d1e3c4d6) | `545a5d2a87228167edde48f3b9eda122d1e3c4d6` | Permissioned adapters, exact-output full-fill routing, position manager and `ReservesLens` |
| [Uniswap v4 hooks public](https://github.com/Uniswap/v4-hooks-public/tree/7da5210f2c81a700820a6b4f585264233d91f349) | `7da5210f2c81a700820a6b4f585264233d91f349` | `PermissionedHooks`, DualPool and its audit report |
| [Uniswap Universal Router](https://github.com/Uniswap/universal-router/tree/d203e7f5525aeae385800f9490b93886711701df) | `d203e7f5525aeae385800f9490b93886711701df` | Bounded command decoding, signed-route dual identity and v4 action routing |
| [Uniswap UniRoute public](https://github.com/Uniswap/uniroute-public/tree/0e002a0bcb35624df416a9bba7705aef66eb2c52) | `0e002a0bcb35624df416a9bba7705aef66eb2c52` | Public routing-engine reference |
| [Uniswap onchain router](https://github.com/Uniswap/onchain-router/tree/b01c21e64ae899a8410df91370ab647b1ecec33a) | `b01c21e64ae899a8410df91370ab647b1ecec33a` | Limited onchain quoting and execution reference |
| [Uniswap Hooklist](https://github.com/Uniswap/hooklist/tree/43ca58a8ca62bb950a1b1f01ef23929bd86b8943) | `43ca58a8ca62bb950a1b1f01ef23929bd86b8943` | Known hook deployments and compatibility metadata |
| [Uniswap v4 subgraph](https://github.com/Uniswap/v4-subgraph/tree/0c13ab2fbd95306272528ed781511d7e2aa338d3) | `0c13ab2fbd95306272528ed781511d7e2aa338d3` | Event-derived discovery and history |
| [OpenZeppelin Uniswap Hooks](https://github.com/OpenZeppelin/uniswap-hooks/tree/26dc8e53f812a1ca390d470342adb6cd8c3286ad) | `26dc8e53f812a1ca390d470342adb6cd8c3286ad` | Reusable base primitives, including experimental custom accounting |
| [Uniswap Foundation security framework](https://github.com/uniswapfoundation/security-framework/tree/e7e8da52fd5717b6eb4517ea779b766f63148c41) | `e7e8da52fd5717b6eb4517ea779b766f63148c41` | Risk and review framework |

Recheck the source heads, licenses, deployments, documentation and provider policy before each review. This snapshot is
evidence of what was inspected, not a floating “latest” dependency.

## Reuse classification

| Classification | Permitted use | Examples | Boundary |
| --- | --- | --- | --- |
| Reusable upstream primitive | Import from an exact compatible package or source pin after license, compiler, dependency and behavior review | v4 core/periphery types; Universal Router action formats; selected OpenZeppelin base contracts | A primitive supplies mechanics, not the model's economics, access policy or security conclusion |
| Concrete official model | Reproduce the complete architecture only when its exact trust and product model fits, or use it as design evidence | Permissioned Pools; DualPool | Extracting one contract or changing configuration creates a different system and review target |
| Read-only evidence or discovery tool | Use to obtain separately labeled observations at an explicit block | `ReservesLens`; `IHookStats`; Hooklist; v4 subgraph | A view or registry does not establish custody, solvency, honesty, route availability or execution |
| Experimental or reference-only | Study and test; do not claim drop-in production compatibility | `BaseCustomAccounting`; UniRoute public; onchain router | Resolve source/package/license coverage and prove exact hook behavior before implementation |

An audit, test suite, factory provenance or official repository name applies only to its exact scope. A derived contract,
different compiler/configuration, new dependency, owner policy or economic parameter is a new target.

## Permissioned Pools

This section applies only when a proposal claims the official Permissioned Pools lane or reuses its components. Another
permissioned or RWA architecture is a new review target, not an automatic failure; evaluate its asset rights, eligibility,
custody, settlement, redemption, routing, failure, and legal/product gates directly.

Use the [architecture guide](https://developers.uniswap.org/docs/protocols/v4/permissioned-pools/architecture) and
[deployment guide](https://developers.uniswap.org/docs/protocols/v4/permissioned-pools/deploy-a-permissioned-pool) as the
product-level source. The official lane is a coordinated system, not a generic allowlist hook.

### Required architecture

1. [`PermissionsAdapter`](https://github.com/Uniswap/v4-periphery/blob/3245c3cb99c48fa1dc2459c3b60abc37d4294aba/src/hooks/permissionedPools/PermissionsAdapter.sol)
   holds the underlying permissioned token and represents it inside PoolManager. Only PoolManager receives the adapter
   ERC-20 representation. The pool currency, settlement id and take id are the adapter, not the underlying token.
2. [`PermissionsAdapterFactory`](https://github.com/Uniswap/v4-periphery/blob/3245c3cb99c48fa1dc2459c3b60abc37d4294aba/src/hooks/permissionedPools/PermissionsAdapterFactory.sol)
   creates and records adapters. Its verification step checks that the created adapter holds a non-zero underlying
   balance; it does not prove issuer identity, legal rights, redemption, custody or audit status.
3. [`PermissionedHooks`](https://github.com/Uniswap/v4-hooks-public/blob/7da5210f2c81a700820a6b4f585264233d91f349/src/permissioned-pools/PermissionedHooks.sol)
   requires at least one verified adapter, rejects an unverified adapter, and checks `SWAP_ALLOWED` or
   `LIQUIDITY_ALLOWED` through `beforeSwap` and `beforeAddLiquidity`. Swapping starts disabled at the adapter.
4. [`PermissionedPositionManager`](https://github.com/Uniswap/v4-periphery/blob/3245c3cb99c48fa1dc2459c3b60abc37d4294aba/src/hooks/permissionedPools/PermissionedPositionManager.sol)
   wraps payment, rechecks user and hook admission, makes position NFTs non-transferable and implements the unwind path.
5. [`PermissionedV4Router`](https://github.com/Uniswap/v4-periphery/blob/3245c3cb99c48fa1dc2459c3b60abc37d4294aba/src/hooks/permissionedPools/PermissionedV4Router.sol),
   the permissioned quoter and the documented Universal Router deployment provide the route-specific wrappers.

Do not replace any one of these roles with a generic router, PositionManager or adapter without a new threat model and
full lifecycle proof.

### Identity and administration

For an accepted route, callback `sender` is an owner-approved wrapper. The hook accepts the wrapper's reported
`msgSender()` as the end-user identity and separately checks `allowedWrappers`. This is a trusted boundary, not
cryptographic identity recovery. Therefore:

- bind every wrapper's address, runtime, source revision and `IMsgSender` behavior;
- test a lying wrapper, an unregistered wrapper and a wrapper whose implementation or admin changes;
- verify the adapter owner, checker, `swappingEnabled` state and wrapper registry at the review block and after deploy;
- treat checker replacement, wrapper admission and swapping activation as adapter-owner capabilities.

Hook revocation or lost user eligibility must stop new mints and increases without trapping exits. The official position
manager intentionally leaves decrease and burn available after revocation; preserve and test that asymmetry.

### Routing and unwind

At this snapshot, the architecture guide requires Universal Router `2.2.0+` for permissioned pools; the deployment guide
defines network-specific onboarding. Do not infer support from a generic router address, repository version or successful
ordinary v4 quote. Bind the exact router, runtime, non-zero adapter-factory wiring, Permit2 domain, quoter and network
allowlisting state.

Either permissioned-asset admin in a position can call `unwindPosition`. Each leg first attempts delivery to the LP. If a
permissioned leg cannot reach the LP, it falls back to that currency's adapter admin and then to an ERC-6909 claim for
that admin. A non-permissioned leg remains the LP's asset or claim. Tests must prove that one issuer cannot receive the
other issuer's currency and that every fallback is observable and withdrawable.

### Legal and product gate

Contracts enforce checker flags, not legal or economic rights. Before implementation, an accountable owner must resolve:

- issuer identity and the holder's exact legal/economic claim;
- eligibility, jurisdiction, KYC/AML, sanctions and privacy obligations;
- custody, mint/burn, redemption, freeze, recall, pause and insolvency behavior;
- adapter, checker, wrapper, router and issuer-admin governance;
- forced-unwind authority, recipient fallback and disclosures;
- route, wallet, venue and network availability limits.

Adapter verification, wrapper admission or routing onboarding is not legal approval and must not be presented as one.

## DualPool, JIT liquidity and ERC-4626

DualPool is an official concrete model, not a generic base hook. Start with
[`DualPoolHook.sol`](https://github.com/Uniswap/v4-hooks-public/blob/7da5210f2c81a700820a6b4f585264233d91f349/src/alf/DualPoolHook.sol),
the [JIT lifecycle](https://developers.uniswap.org/docs/protocols/v4-hooks/dualpool/concepts/jit-liquidity),
[inventory and yield](https://developers.uniswap.org/docs/protocols/v4-hooks/dualpool/concepts/inventory-and-yield),
[LP shares](https://developers.uniswap.org/docs/protocols/v4-hooks/dualpool/concepts/lp-shares) and
[router integration](https://developers.uniswap.org/docs/protocols/v4-hooks/dualpool/guides/router-integration).

### Lifecycle and trust shape

- One hook can serve several owner-created pools. Pool creation and operator actions are controlled; this is not a
  permissionless pool factory.
- Pools use a static fee. Native ETH, fee-on-transfer and rebasing assets are outside the model.
- The owner controls initialization, bootstrap, liveness, deposit admission, distribution and vault allowance. Ownership
  uses two-step transfer and cannot be renounced.
- Resting inventory is partitioned among raw ERC-20, PoolManager ERC-6909 claims and ERC-4626 vault shares. The hook
  deploys bucketed core liquidity in `beforeSwap`, removes it in `afterSwap`, settles, and redeposits.
- There is no keeper in the core JIT lifecycle. Do not invent a keeper dependency for this pattern.

Direct PoolManager initialization or liquidity modification must fail. Bootstrap must precede live trading. Distribution
must contain the supported bucket count and sum exactly to `10_000`. Per-pool and global JIT locks must prevent nested or
cross-pool interference, and `hookData` must not silently change price, fee or distribution.

### Per-pool accounting

For each `(PoolId, Currency)` partition, define:

```text
economicAssets = rawERC20 + erc6909Claims + convertToAssets(partitionVaultShares)
effectiveAssets = rawERC20 + erc6909Claims + realizableVaultAssets(partitionVaultShares)
deployableAssetsWithinUnlock = effectiveAssets - currentlyUnbackedClaims
effectiveAssets <= economicAssets
```

`realizableVaultAssets` is revision-specific. At the pinned source it uses `maxWithdraw`, clamps a non-zero result to the
partition's `convertToAssets` value, and falls back around vault-specific `previewRedeem` behavior. Do not replace this
with a prose-only `previewRedeem + claims + raw` formula. Pin and test the exact
[`InventoryLib`](https://github.com/Uniswap/v4-hooks-public/blob/7da5210f2c81a700820a6b4f585264233d91f349/src/alf/libraries/InventoryLib.sol)
semantics.

Positive after-swap credit may be minted as ERC-6909 claims because the swap payer has not necessarily settled during
the callback. Record the claim against the same pool partition and redeem only backed claims. Claims from one pool may
not fund another pool that shares the currency. For JIT sizing, subtract claims the PoolManager cannot physically honor
yet in the current unlock. The difference between economic and effective assets is not available depth; expose it as a
withdrawal or vault-liquidity constraint.

Never use the hook's global token balance as one pool's balance. The invariant is both per partition and aggregate:

```text
for each currency c:
  sum(raw(pool, c)) <= balanceOf(c, hook)
  sum(claims(pool, c)) <= PoolManager.balanceOf(hook, c.toId())

for each vault v:
  sum(shares(partitions using v)) <= IERC20(v).balanceOf(hook)
```

### Vault and audit boundary

Require exact asset matching and no entry or exit fee. Test preview-versus-execution divergence, share inflation,
donation, loss, pause, cap, illiquidity, revert and rounding for the exact vault. A standing vault allowance is correlated
risk: a compromised vault can attempt to pull the hook's global balance of a shared currency even when internal ledgers
are partitioned.

The pinned repository contains the
[OpenZeppelin DualPool report](https://github.com/Uniswap/v4-hooks-public/blob/7da5210f2c81a700820a6b4f585264233d91f349/docs/audit/openzeppelin-dualpool.pdf).
Record its reviewed revision, files, configuration, findings and fix evidence before making any audit statement. A
factory provenance check identifies origin; it does not establish owner trust or make a fork, parameter change, compiler
change or integration audit-covered.

## Custom-accounting reserve semantics

Use the [reserve-reading guide](https://developers.uniswap.org/docs/protocols/v4/guides/reading-pool-reserves) with the
pinned [`ReservesLens`](https://github.com/Uniswap/v4-periphery/blob/3245c3cb99c48fa1dc2459c3b60abc37d4294aba/src/lens/ReservesLens.sol)
and [`IReservesLens`](https://github.com/Uniswap/v4-periphery/blob/3245c3cb99c48fa1dc2459c3b60abc37d4294aba/src/interfaces/IReservesLens.sol).

The lens fields have narrow meanings:

- `coreAmount0/1` reconstruct fee-excluded principal represented by the current v4 liquidity curve. They are not raw
  PoolManager balances and exclude uncollected LP fees, protocol fees, donations and hook-managed assets.
- `hasCustomAccounting` means at least one return-delta permission bit is set. It is a capability warning, not proof
  that off-curve reserves exist or that a hook without those bits owns no liquidity.
- `hookReserves0/1` and `hookEffective0/1` are optional `IHookStats` reports. Interface support, provider association and
  `effective <= reserves` do not prove the report honest.

Label core-derived and hook-reported values separately. Sum them only when the reviewed model proves same-unit,
same-block, non-overlapping ownership. Use an explicit block for every page, preserve opaque cursors unchanged, accept
only a completed scan, and do not make the lens an onchain dependency: its tick walk is storage-dependent and intended
for RPC reads.

OpenZeppelin
[`BaseCustomAccounting`](https://github.com/OpenZeppelin/uniswap-hooks/blob/26dc8e53f812a1ca390d470342adb6cd8c3286ad/src/base/BaseCustomAccounting.sol)
is an experimental, single-`PoolKey` hook-owned-liquidity primitive. It blocks direct liquidity changes and supplies
mechanics, but the implementer still owns share mint/burn, fee, range, rounding, donation, exit and solvency policy. It is
reusable only under an exact compatible pin and full model review; it is not a finished accounting design.

## Routing and multi-hop behavior

The standard v4 path is a [Universal Router](https://developers.uniswap.org/docs/protocols/universal-router/overview)
`V4_SWAP` command containing V4Planner actions. For exact input, the
[multi-hop guide](https://developers.uniswap.org/docs/sdks/v4/guides/swapping/multi-hop-swapping) encodes every hop as a
`PathKey` with intermediate currency, fee, tick spacing, hook and `hookData`, then settles the endpoint input and takes
the endpoint output. Use the exact pinned SDK for exact-output path order; do not hand-reverse a route from memory.

At observed source head `d203e7f5525aeae385800f9490b93886711701df`, the dispatcher detects an already-unlocked
PoolManager and executes the decoded `V4_SWAP` actions without opening a second unlock; otherwise it uses the ordinary
unlock path. Treat this as a distinct nested execution profile. Bind payer and recipient sentinels to the router's
`execute` caller, not an outer lock owner; prove the nested command cannot spend an outer actor's credit, closes every
delta, preserves `CurrencyNotSettled` failure, composes multiple actions, and handles native value/refunds. This is
source behavior only. It does not prove any deployed router address or provider route runs this revision.

Treat every router command byte string as hostile even when produced by an SDK. Before each read, prove the bounded
static head, dynamic offset, dynamic length, overflow-safe `length * elementSize`, and short selector. Reject truncated,
overlapping, out-of-range or arithmetic-overflow encodings before `calldataload`, copying, dispatch or token movement.
Do not reproduce a decoder that assumes ABI-valid bytes merely because the outer function decoded successfully.

For `signedRouteContext`, authenticate two distinct identities: the hook callback caller must be the exact PoolManager,
and the callback sender carried by PoolManager must be the exact reviewed Universal Router. Checking only one identity
permits direct-callback or alternate-router confusion. Bind chain, router generation, PoolKey, route bytes, payer,
recipient, nonce and expiry into the signed context and test both identity failures independently.

[Flash accounting](https://developers.uniswap.org/docs/protocols/v4/concepts/flash-accounting) nets intermediate
currencies, so a multihop route can transfer only the endpoints while each pool and hook still runs sequentially within
one unlock. Test:

- the same hook appearing more than once and two pools sharing the same hook storage;
- each hop's complete PoolKey, direction, exactness, amount and validated `hookData`;
- sequential dynamic-fee or state changes, self-calls, nested actions and rollback;
- split or interleaved v2/v3/v4 commands, subplans, partial-failure behavior, Permit2, native wrapping and refunds;
- final endpoint deltas, every intermediate zero delta, slippage and quote-to-execution parity at a bound block.

For exact output, success means the requested output is filled in full at every relevant hop or the route reverts. Do
not rely only on final per-currency net deltas: a path that repeats a currency can net an intermediate underfill away.
Test repeated-currency multihop routes, middle-hop price limits, zero progress and requested-versus-actual output for each
hop. This source-level periphery invariant is not present merely because a contracts-registry sibling gitlink or router
head was observed; verify the selected dependency closure.

Provider routes are separate lanes:

- [Hooklist](https://github.com/Uniswap/hooklist/tree/43ca58a8ca62bb950a1b1f01ef23929bd86b8943)
  records known deployment and compatibility metadata. Inclusion or `verifiedSource` does not place a hook on the Labs
  routing allowlist and is not a security conclusion.
- The [hook allowlist](https://developers.uniswap.org/hook-allowlist) is mutable provider policy, not a protocol
  permission, security review or availability guarantee. At this snapshot, manual submission targets delta-return hooks
  for major pairs; the form says upgradeable hooks and custom-data inputs are not approved. Record the exact policy and
  listing result at the review date instead of carrying this snapshot forward.
- Permissioned pools require their documented router generation and per-network onboarding.
- UniswapX filler integration is not equivalent to ordinary Universal Router compatibility; prove that route
  independently for the exact hook capabilities.
- A [Trading API](https://developers.uniswap.org/docs/trading/swapping-api/integration-guide) quote is a simulation and a
  swap response is unsigned calldata. Neither is an execution receipt.
- The [v4 subgraph](https://github.com/Uniswap/v4-subgraph/tree/0c13ab2fbd95306272528ed781511d7e2aa338d3)
  is event-derived discovery and history, not an authoritative reserve source or executable quote. Bind the deployment,
  schema revision, start block, confirmation policy and reorg/resync behavior.

Treat [UniRoute public](https://github.com/Uniswap/uniroute-public/tree/0e002a0bcb35624df416a9bba7705aef66eb2c52)
and the [onchain router](https://github.com/Uniswap/onchain-router/tree/b01c21e64ae899a8410df91370ab647b1ecec33a)
as reference-only until their exact package, license closure, deployment, quote model and hook-data behavior are resolved.
A quote engine that models only v4 core math or executes empty `hookData` does not prove support for dynamic, return-delta,
custom-data or permissioned hooks. Likewise, UniRoute's Robinhood-only, spot-derived, capped pool-cache admission path is
not evidence that the same pool is supported on Ethereum, enabled in the hosted service, safely priced, quoted, or
executable.

## Exploit-derived accounting regressions

The [Bunni incident postmortem](https://blog.bunni.xyz/posts/exploit-post-mortem/) is a primary project source, not a
Uniswap audit. Its useful lesson is general: rounding that appears conservative in one operation can compound across a
sequence and become exploitable when a later branch or representation reverses the estimate.

Any share, active/idle liquidity, custom reserve, JIT or vault model must include:

1. Extreme price or near-zero one-sided balance, repeated tiny withdrawals or share burns, then a reverse swap. Without
   external inflow or yield, attacker round-trip profit after fees must be non-positive.
2. Fragmentation equivalence: `N` small withdrawals versus one aggregate withdrawal may differ only by a declared,
   bounded dust amount that does not grow materially with call count.
3. Both rounding directions at every asset/share, active/idle, bucket and vault conversion; include zero, one, boundary,
   asymmetric-decimal and representation-switch cases.
4. Branch transitions when either token-side estimate reaches zero or a tiny value. Switching formulas or token sides
   may not create spendable value, excess shares, executable output or profitable round trips.
5. First- and last-depositor, donation/inflation and unsafe-zero-total-supply sequences.
6. Interleaved swaps, add/remove, claims, vault conversion, pause/loss and same-currency cross-pool actions.
7. Vault `preview*` versus actual execution, caps, reverts and same-unlock claims that are not yet physically backed.
8. A fixed regression for the incident-shaped sequence plus generalized stateful fuzzing with useful-call and revert
   counters.

Assert conservation, solvency, bounded dust and no unexplained profit. Do not assert raw liquidity monotonicity: price
movement can legitimately change liquidity representations.
