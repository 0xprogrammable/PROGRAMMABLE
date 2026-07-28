# Adaptive Curve V1

This note defines the contract semantics and security boundary of
`AdaptiveCurveFeeHookV1`, `AdaptiveCurveFeeHookFactoryV1`,
`AdaptiveCurvePositionPlannerV1` and `AdaptiveCurveLaunchV1`. It is
engineering evidence, not an external audit, a Uniswap approval or a
mainnet-readiness statement.

## Economic semantics

Each registered ETH/token pool has an immutable piecewise-linear curve with
between two and eight control points:

```text
(fdvIndex, totalSwapFeeBps)
```

The total swap fee is bounded to 100–1,000 basis points. The Launcher share is
always 10 basis points of gross ETH volume. It is deducted from the selected
total fee. The creator receives the remainder. There is no LP fee and no ERC-20
transfer tax.

The same curve applies to buys and sells. All fees accrue as native ETH claims
inside PoolManager. Permissionless claim functions can send funds only to the
immutable recipients. A recorded recipient may redirect its own claim to
recover from an address that cannot receive ETH.

| Swap | User-facing treatment |
| --- | --- |
| Buy, exact ETH input | The selected fee is deducted from the supplied ETH before the pool swap. |
| Buy, exact token output | Required ETH is grossed up so the requested token output remains exact. |
| Sell, exact token input | The selected fee is deducted from the pool's gross ETH output. |
| Sell, exact ETH output | Required token input is grossed up so the requested ETH output remains exact. |

Native-specified partial fills are rejected. This prevents a fee calculated
from the requested amount from surviving when the pool processed a different
amount at a price limit.

## FDV index and price orientation

The supported pool shape is fixed:

```text
currency0 = native ETH
currency1 = fixed-supply token
```

For raw fixed supply `S`, Uniswap tick `t` and implied ETH-denominated FDV `M`
in wei:

```text
1.0001^t = token raw units / wei
M = S / 1.0001^t
fdvIndex = log_1.0001(M / S) = -t
```

Therefore `fdvIndex` rises when the token's ETH price and ETH-denominated FDV
rise. Token decimals do not enter the ratio because both `S` and the pool price
use raw units.

The hook reads PoolManager's current integer tick immediately before the swap
and uses `fdvIndex = -tick`. An offchain encoder can map a target FDV `M` to an
integer point with:

```text
fdvIndex = ceil(log_1.0001(M / S))
```

The exact onchain threshold represented by integer point `i` is
`S * 1.0001^i` wei, subject to Uniswap's integer-tick discretization. The
contract stores `S` at registration for disclosure, but does not use an
external USD oracle. The UI must call this ETH-denominated FDV, not USD market
cap.

The complete swap uses the fee selected from its starting tick. A swap that
crosses one or more control points does not blend fees within the swap. The
next swap observes the new tick.

Between adjacent points, the fee is interpolated linearly in integer
`fdvIndex` space. Division truncates toward the lower-index control point.
Exact control points return their exact configured fee.

## Immutability and provenance

- Registration is one-time per PoolId.
- Every curve spans the full supported tick range and has strictly increasing
  indexes.
- There is no owner, admin, proxy, upgrade, pause, fee setter, curve setter,
  router allowlist or wallet exception.
- The token's recorded `creator()` must register the pool and is the only
  address allowed to initialize it.
- The hook factory uses CREATE2, validates the low-bit permission mask before
  deployment and records a configuration hash for factory provenance.
- The launcher creates each token through the pinned official UERC20Factory and
  creates one deterministic factory hook for that token. A launcher mapping
  prevents the same hook from being assigned to a second token.
- The launcher validates the official PoolManager, PositionManager,
  UERC20Factory, adaptive hook factory and locked-position factory in its
  immutable constructor dependencies.
- The one-sided position calculation is delegated by `STATICCALL` to the
  stateless `AdaptiveCurvePositionPlannerV1`. The launcher pins its exact
  runtime codehash in the constructor. The helper has no storage, authority or
  external calls and wraps the pinned official Uniswap `PositionPlanner`.
- The complete fixed supply enters one official Uniswap liquidity-launcher
  position. Its PositionManager NFT is sent to an official
  PositionFeesForwarder with no operator and a `type(uint256).max` timelock.
- There is no launcher owner, admin, proxy, pause, token mint path, curve setter
  or custody withdrawal.

## Atomic launch path

`AdaptiveCurveLaunchV1.launch(bytes)` decodes the exact launch parameters and
performs one all-or-nothing transaction:

1. validate token metadata, curve endpoints, ordering and fee bounds;
2. predict the creator-bound UERC20 address;
3. deploy or verify the CREATE2 adaptive hook;
4. deploy or verify the permanent position recipient;
5. create the fixed-supply official UERC20;
6. register the immutable curve and initialize the v4 pool;
7. ask the codehash-pinned stateless planner for the exact one-sided plan and
   place the complete token supply in the locked position;
8. optionally execute a creator buy and send the purchased tokens directly to
   the creator;
9. store the curve, metadata and launch commitments.

The optional initial buy may be zero. A later public ETH buy can cross the
initialized boundary and activate the one-sided position. Any revert rolls back
the token, hook, pool, position and record together. Successful launches leave
no loose ETH or token balance in the launcher or PositionManager.

The hook salt is mined offchain. The factory rejects any CREATE2 address whose
low bits do not equal the exact callback permission mask. The app derives the
salt deterministically from the connected account and creator-bound launch
salt, then validates the complete prepared calldata again before opening the
wallet.

Every token record commits to:

```text
creator
token
adaptive hook
position recipient and PositionManager token ID
PoolId
curve hash
metadata hash
launch hash
```

The curve points themselves are emitted by the hook at registration. The
launcher emits the curve hash, point count, liquidity quantities, optional buy
and final launch hash.

## Hook permissions and accounting

The implementation extends OpenZeppelin `BaseHook` and uses the pinned
OpenZeppelin `CurrencySettler`, transient reentrancy guard and transient slot
utilities. It uses pinned Uniswap v4 core price, delta, casting and full
precision math libraries. This keeps callback validation, settlement and
rounding aligned with the dependencies already used by the Classic model.

Only these permissions are enabled:

```text
beforeInitialize
beforeSwap
afterSwap
beforeSwapReturnDelta
afterSwapReturnDelta
```

Both return-delta permissions are required because native ETH can be either
the specified or unspecified currency across the four swap modes. Removing
either one would break fee collection for two modes.

`beforeSwap` stores the selected index and fee in EIP-1153 transient storage.
`afterSwap` consumes and clears it. This makes token-specified swaps charge the
same pre-swap fee even though their native amount is only known after pool math.
The hook makes no untrusted external call between these operations.

For every successful fee accrual:

```text
creatorAccrued + launcherAccrued = totalNativeFeesAccrued
PoolManager native claims held by hook >= totalNativeFeesAccrued
PoolManager token claims held by hook = 0
hook loose ETH balance = 0
hook loose token balance = 0
```

Registration and accrual emit machine-readable curve, disclosure and fee
events. Empty `hookData` remains supported. The canonical event schema and
fork-derived fixture are stored in `spec/adaptive-indexer-v1.json` and
`spec/fixtures/adaptive-mainnet-fork-v1.json`.

## Security assumptions and unresolved risks

- A one-block spot tick is intentionally the fee input. It can be moved by
  trading, including deliberately. The 1–10% bound limits the fee result but
  does not make the spot price manipulation-resistant.
- The curve is linear in logarithmic FDV-index space, not linear in ETH FDV.
- The model assumes a fixed-supply official UERC20. Launcher-level factory
  provenance checks are required before this becomes a public launch path.
- Router and indexer support for custom-accounting hooks is external. Passing
  Universal Router and Quoter fork tests does not guarantee every aggregator
  will route or display the fee.
- Deploying one hook per token adds substantial launch gas. This is deliberate
  provenance isolation, not a cheap-launch design.
- `AdaptiveCurveLaunchV1` is 19,038 bytes in the reviewed optimizer build,
  leaving 5,538 bytes below EIP-170 and 3,962 bytes below the internal
  23,000-byte release ceiling. Any contract change must repeat the size gate.
- The stateless position planner is an additional deployed dependency. A
  launcher cannot be constructed against altered planner bytecode, and release
  verification must still bind its address and runtime hash in the manifest.
- Source verification, hook registry review, monitoring and an independent
  security review remain separate release gates.

## Product release boundary

The product exposes the curve editor and exact disclosures, but its wallet
transaction remains disabled until the deployment manifest contains verified
Adaptive planner, factory and launcher addresses and runtime hashes.
Mainnet-fork tests do not satisfy that release gate.
