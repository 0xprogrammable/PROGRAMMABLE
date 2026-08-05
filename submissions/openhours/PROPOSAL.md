# Proposal

OpenHours is a 24/7 canonical Uniswap v4 AMM plus a separate, fully pre-funded epoch redemption vault for assets whose issuer settlement is periodic.

## Design card

| Item | Frozen prototype design |
| --- | --- |
| User outcome | Choose an immediate pool sale or irrevocably queue RWA for bounded signed-NAV settlement. |
| Pool | One address-sorted mock RWA/mock USD PoolKey, dynamic fee flag, tick spacing 60, one hook instance. |
| LP fee | Registration stores a one-time hardcoded 3,000-pip fallback. Buys override to 3,000; sells override to `3000 + floor(17000*u^2)` while a lane is open and 20,000 otherwise. |
| Pressure | Vault writes active/pending snapshots; block N changes become eligible in N+1. Swaps call no vault or signer. |
| Hook-owned fee | Exactly 10 bps of successful canonical-pool gross quote volume accrues to the immutable Programmable owner. |
| NAV lane | Issuer deposits `ceil(capacityRwa * maxNav / rwaUnit)` quote before opening an epoch. |
| Report | Immutable signer, EIP-712 domain, exact epoch and asset fields, in-band NAV, bounded report window. |
| Failure exit | No report by the deadline permits permissionless expiry and holder recovery of exact queued RWA. |
| Excluded | Upgrade, pause, rescue, sweep, mutable signer, governance, randomness, tokenized receipts, deployment and production client. |

## Why v4

One custom hook must atomically combine an economic buy/sell classification, a dynamic sell-side LP override, canonical-PoolKey admission, and the mandatory quote-denominated return-delta fee. Router-only enforcement or a token transfer tax could be bypassed and cannot provide the same PoolManager delta accounting.

The hook enables `beforeInitialize`, `beforeSwap`, `afterSwap`, `beforeSwapReturnDelta`, and `afterSwapReturnDelta`, producing permission mask `0x20cc`. `afterInitialize` remains disabled. The CREATE2 factory mines exactly those five address bits. Registration validates the complete PoolKey and vault binding, stores canonical state, binds the vault, self-initializes the pool, and immediately calls `updateDynamicLPFee(key, 3000)` in one atomic transaction. Core suppresses `beforeInitialize` for that hook-initiated initialization; the permission remains solely as the external alternate-pool initialization guard.

The stored write is hardcoded and one-shot. No persistent update actor, call site, cadence or rate limit exists. Every externally initiated canonical swap still returns the bounded buy/sell fee ORed with `LPFeeLibrary.OVERRIDE_FEE_FLAG`; pressure updates never call `updateDynamicLPFee` and never mutate the stored 3,000-pip fallback.

## Value and lifecycle

The pool handles instant buys and sells. The hook mints PoolManager ERC-6909 quote claims equal to accrued fees, records liabilities by pool, currency and immutable owner, and burns claims before taking underlying quote to an owner-selected claim destination.

The vault accepts exact-transfer quote funding and exact-transfer RWA queue deposits. A finalized epoch pays `floor(receiptRwa * finalNav / rwaUnit)`. An expired epoch returns the receipt's RWA. Only after every receipt is resolved may the issuer withdraw residual quote and, after finalization, the redeemed RWA.

## Worked fee cases

- Selected hook fee 0: effective 10 bps, Programmable 10 bps, project 0.
- Selected hook fee 3%: effective 3%, Programmable 0.1%, project 2.9%; it is never 3.1%.
- At gross quote 1,000,000 units and selected zero, the liability is 1,000 units.
- For exact input with quote specified, `beforeSwap` subtracts the fee from the pool leg and `afterSwap` requires the expected quote execution; a partial fill reverts atomically.
- For exact output with quote specified, a bounded 17-candidate search finds gross quote such that `gross - cumulativeFee = requestedNet`.
- When quote is unspecified, `afterSwap` charges the actual executed gross quote delta. Both directions and both exactness modes are tested.
- Independent platform and project numerator remainders persist for the canonical pool lifetime and claims do not reset them.

## Product surface boundary

A browser-only React mechanism lab is included for local demonstration. Its pure reducer mirrors the frozen queue, fee, settlement and recovery states; it has no wallet, RPC, API, signer, executable quote, chain read, contract write or transaction path. It is not an execution client and its model estimates omit pool price movement and slippage.

No production UI, router client, indexer, keeper, or monitor is included. Future integrations must derive the exact PoolKey and state from confirmed chain reads; handle slippage, deadlines, reorgs, stale data, partial-fill reverts and recipient failures; and retain the mock/non-affiliation disclosures. Provider discovery and routing are separate external decisions.

The signed NAV producer is an external future surface. This repository defines its canonical schema and onchain verifier but contains no signing key or producer implementation. Signer outage is not a swap dependency.

## Provenance and limitations

Builder-stated requirements include the immutable 10 bps owner and policy v1.1. Agent-derived design includes the pressure snapshot and epoch state machine. Evidence-backed claims are limited to the recorded local compilation, tests, invariants and structural fee check.

The manifest truthfully declares `external-authorized-updateDynamicLPFee` only for the registrar-authenticated one-time initialization write and retains `before-swap-override` as its application mode. It declares no persistent updater. The package claims no audit, acceptance, deployment, runtime/source match, legal backing, routing support or availability.
