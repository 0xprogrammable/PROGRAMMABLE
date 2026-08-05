# Proposal

**Stage:** local proposal with implemented prototype source
**Model id:** `hookemon`
**Authoritative preflight state:** owner launch economics are closed; deterministic readiness is established only by the regenerated compatibility report for the exact revision.

Hookemon binds one immutable Uniswap v4 `HOOKEMON/USDC` pool to an inclusive 3% quote-side hook charge, then uses the project portion for automated Collector Crypt pack/buyback cycles and proportional, gas-sponsored USDC holder payments.

## Design card

| Item | Confirmed design |
| --- | --- |
| Outcome | Hold HOOKEMON; eligible top-200 time-weighted holders accrue proportional USDC and never submit a claim transaction. |
| Token | `Hookemon` (`HOOKEMON`), 18 decimals, fixed supply `420,690,000,000`, no owner mint, blacklist, freeze, transfer tax or upgrade path. |
| Launch | No presale. `378,621,000,000 HOOKEMON` plus `25,000 USDC` seed canonical liquidity; `42,069,000,000 HOOKEMON` enter treasury vesting; every other allocation is zero. |
| Custody | Treasury has a 365-day cliff and linear vesting through day 1,460; the LP position is locked for 730 days; both immutable beneficiaries are the Governance Safe. |
| Pool | One canonical Ethereum mainnet HOOKEMON/USDC v4 PoolKey; USDC is the quote asset; static 0.30% LP fee; tick spacing 60. |
| Hook | One non-upgradeable hook, one PoolId, permission mask `0x20cc`; beforeInitialize, beforeSwap and afterSwap plus the two swap return-delta bits. |
| Hook charge | Inclusive 3% of executed gross USDC-side volume: exactly 0.1% Programmable and 2.9% CycleVault. It is not 3.1%. |
| Pack cycle | Batch CCTP to Solana, use fresh Collector data, maximum 20 orders, 75% floor lane and 25% showcase lane, accept/reconcile buybacks, batch proceeds back. |
| Rewards | Close accounting every 20 minutes; top 200 direct eligible holders by time-weighted balance; cumulative Merkle roots; permissionless batches of at most 40. |
| Dust/gas | Minimum payout `max(5 USDC, estimated recipient gas cost × 20)` and batch gas at most 5% of batch value; unpaid value rolls forward without expiry. |
| Authorities | Immutable Programmable owner; one-time registrar; 48-hour CycleVault Safe; pause-only guardian; policy-constrained Ethereum/Solana operators. |
| Failure | Trading remains atomic; the offchain cycle stops at its last confirmed custody checkpoint and reconciles by `cycleId` before retry. |
| Privy | Optional dashboard login only. Eligibility and automatic payment never depend on Privy. |
| Not used | Oracle pricing, dynamic LP fees, transfer taxes, permissioned assets, ZK proofs, custom curves and asynchronous Uniswap swaps. |

## Why Uniswap v4

The hook must observe the final quote-side amount and alter the final caller delta atomically. A router-only fee, token transfer tax, LP fee or alternative pool would not provide the same canonical PoolKey enforcement or the mandatory Programmable liability. Cross-network pack execution remains outside the callback so an API, bridge or signer outage cannot make PoolManager depend on an offchain service.

The reference source is `packages/contracts/src/ProgrammableVolumeFeeHookV1.sol`. Callback and accounting tests are in `packages/contracts/test/ProgrammableVolumeFeeHookV1.t.sol`.

## Lifecycle and value flow

1. A reviewed executor deploys the immutable token and one hook instance.
2. The immutable registrar binds and initializes exactly one sorted PoolKey.
3. The deployment Safe assigns 90% of supply plus 25,000 USDC to canonical liquidity, sends 10% to treasury vesting, locks the LP position for 730 days and leaves no residual token allocation.
4. Every supported swap pays the separate LP fee and inclusive 3% hook charge.
5. Programmable claims only its liability; CycleVault claims only the 2.9% project liability.
6. The operator batches a capped cycle through CCTP, Collector pack creation/open/buyback and CCTP return.
7. The indexer closes a finalized window, excludes documented protocol/custody addresses and computes the top 200.
8. The publisher commits a cumulative root only after Ethereum USDC funding is confirmed. A sponsor automatically settles proof-valid batches.
9. Retirement can stop new cycles, but cannot upgrade the hook, sweep another liability, cancel historic roots or forfeit unpaid entitlement.

## Swap accounting

USDC is planned as `currency0`; deployment must derive a HOOKEMON address above the fixed mainnet USDC address or revise and re-review the PoolKey plan.

| Quadrant | Quote position | Collection path | Rule |
| --- | --- | --- | --- |
| zeroForOne exact input | specified gross USDC input | beforeSwap return delta | PoolManager receives gross minus the cumulative 3% components. |
| zeroForOne exact output | unspecified USDC input | afterSwap return delta | Find gross input whose gross minus both fee streams equals executed net input. |
| oneForZero exact input | unspecified gross USDC output | afterSwap return delta | Caller receives gross output minus both cumulative components. |
| oneForZero exact output | specified net USDC output | beforeSwap return delta | Find gross output whose gross minus both streams equals requested net output. |

The hook takes the exact charge as a PoolManager ERC-6909 USDC claim. The invariant is:

```text
totalQuoteFeesAccrued
  = programmableFeesAccrued + projectFeesAccrued
  <= PoolManager ERC-6909 USDC claim balance owned by the hook
```

Liabilities are keyed by PoolId, currency and beneficiary. Claims cannot reset the independent lifetime remainder streams, and another pool cannot net against the canonical pool.

### Central 1.5 self-call projection

The central `1.5.0` structural checker treats every direct hook-to-PoolManager call as if it could be a nested same-pool swap. Hookemon therefore carries the checker-required `programmableFee.collection.selfCallPolicy="same-pool-swap-fee-enforced-internally"` projection while declaring the exact executable boundary under `hook.nestedActions`: the hook exposes no nested swap, liquidity or donation path at all. Its only direct calls are typed ERC-6909 claim `take`/`settle` accounting, and `SAME_POOL_SWAP_FORBIDDEN=true` is bound by source, artifact, manifest and test. Reviewers should evaluate this claim-only boundary rather than infer an unexposed internal swap path from the structural projection.

## Numerical examples

- Selected `0`: effective charge is the 10 bps floor, all 10 bps accrue to Programmable and the project receives zero.
- Selected `3%`: effective charge is exactly 300 bps; 10 bps accrue to Programmable and 290 bps to the project.
- For gross `1,000 USDC`, before carried remainder effects, total fee is `30 USDC`, Programmable receives `1 USDC`, and CycleVault receives `29 USDC`. The separate target LP fee is not added to the hook liability.
- For `1 USDC` (`1,000,000` base units), the components are `1,000` and `29,000` base units. Fragmented swaps carry each fractional stream independently so splitting cannot evade the 0.1% floor.
- Exact-output gross-up accepts only a gross base-unit value whose gross minus both actual cumulative components equals the requested net. If none exists in the bounded search, the swap reverts instead of silently changing exact-output semantics.
- A nonzero executed quote amount below `1,000` USDC base units reverts because the fee quantum is intentionally explicit.

## Packs and holder economics

Collector pack returns are uncertain and are not described as yield. The policy spends up to 75% on the best current instant-buyback floor and up to 25% on the best current expected-value/upside quote. Missing or older-than-120-second machine data stops purchases. The per-window cap is 20 packs.

Reward allocation uses time-weighted balances, largest-remainder integer conservation and an address tie-break. Excluded addresses include the zero/burn address, PoolManager, hook, CycleVault, distributor, operator/treasury, launch contracts and documented custody aggregation. Smart wallets remain eligible unless they are a documented exclusion.

## Product surface plan

| Surface | Boundary and state |
| --- | --- |
| Website | Locally built and tested marketing/dashboard shell. It states prototype status, fee split, automation, risks and trademark disclaimer. It is not part of the deterministic Programmable source closure because the current builder cannot parse TSX reliably. |
| API | Read-only health, system status, cycle summaries, holder state and immutable reward artifacts. No mutation or claim endpoint. |
| Operator | Durable checkpoint state machine with bounded Collector/CCTP/reward ports. The fail-closed Solana signing policy and direct simulate/broadcast/confirm path completed one supervised Devnet pack cycle; unattended production credentials and broadcast remain disabled. |
| Indexer | Finalized ERC-20 and protocol events, block-hash checkpoints, rollback to common ancestor, time-weighted balances and confirmed-read reconciliation. |
| Quote/trade | No swap client is supplied by this repository (`routingMode: not-planned`). A later Programmable-owned or third-party client is a separate maintainer/provider review boundary. |
| Claim | Holders do not claim. Programmable/project owner claims and automatic holder settlement are distinct contract paths. |
| Monitoring | Planned liability/backing, bridge stage, provider freshness, root funding, payment delay, indexer lag and signer gas alerts. |

## Authorities

| Role | Controller | Capabilities | Mutable | Delay | User-exit impact |
| --- | --- | --- | --- | --- | --- |
| Immutable hook registrar | The Hookemon deployment Safe supplied immutably to the hook constructor; its exact address is a pre-deployment binding. | Register and initialize the one canonical PoolKey exactly once. | No | None | No hook authority remains after registration; it cannot change fees, PoolId, claims or exits. |
| Programmable fee owner | `0x4957f49620AFf3Adbbe8195a4f633E49cc93376c` | Claim only the exact Programmable liability to a nonzero per-claim recipient. | No | None | Cannot change the project liability, pool, token, fees or holder rewards. |
| Governance/CycleVault Safe | One new Hookemon-only 1-of-1 Safe; its exact sole hardware-wallet owner is also the immutable guardian, while the Safe contract remains distinct from that EOA and the operator. | Deploy/register, administer delayed CycleVault configuration and receive only vested treasury tokens and the LP position after its lock. | Safe owner/threshold/module changes are technically possible but invalidate this reviewed profile | 48 hours for CycleVault configuration; vesting/LP schedules immutable | Cannot redirect the Programmable liability; compromise of the single hardware key can control Safe actions and pause automation, so it is a material single point of failure. |
| Guardian | The exact hardware-wallet EOA that is the Governance Safe's sole owner; it is distinct from the Safe contract and Ethereum operator. | Pause new bridge cycles and pause reward funding/settlement. | The deployed guardian role is immutable; replacing it requires a new reviewed deployment | Immediate pause only | Can delay automation but cannot sweep or forfeit accrued claims and cannot block LP release; key loss removes the pause path. |
| Ethereum/Solana policy wallets | New low-balance policy-constrained wallets; exact public addresses and Solana ATA are bound and reviewed before deployment. | Submit bounded CCTP/Collector transactions, publish reviewed roots and sponsor settlement gas. | CycleVault operator configuration rotates after 48 hours; other immutable roles require a reviewed replacement | Policy-controlled rotation | Failure delays cycles; contract caps, public proofs and immutable fee liabilities limit redirection. |

## Provenance

- **Builder-stated:** project name Hookemon; memecoin/collectible concept; 3% total; automatic Collector packs; automatic top-holder distribution; option A with no presale, 90% liquidity, 25,000 USDC, 10% vested treasury, 730-day LP lock and separate 500 USDC gacha reserve.
- **Agent-derived:** fixed supply, static LP fee, 20-minute accounting cadence, 75/25 pack lanes, top 200, gas thresholds, caps, delays and technical architecture.
- **Evidence-backed locally:** source exists; the recorded local tests and builds passed for their exact revisions. No external acceptance, audit, deployment, runtime, routing or availability claim follows.

## Closed owner decision

Option A is bound in source and tests: no presale; 90% liquidity allocation; 25,000 USDC initial liquidity; 10% treasury with a 12-month cliff and continued linear vesting through month 48; 730-day LP lock; no residual allocation; and a separately sponsor-funded 500 USDC gacha reserve. The exact launch timestamp, derived contract addresses and public role addresses remain deployment inputs, not open product economics.

## Deployment and release prerequisites

- Bind the public Governance Safe, exact sole hardware owner/guardian, Ethereum operator, Solana operator, derived Solana USDC ATA and equal NFT recipient listed in `docs/MAINNET_WALLETS.md` before any deployment rehearsal. Verify Safe threshold `1`, the exact one-owner list and no unreviewed module or guard.
- Keep Collector live mode disabled until Collector Crypt supplies written automation permission and the server-only partner key; prototype tests use the fail-closed simulator boundary.
- Treat both items as candidate/deployment gates, not as evidence that the local prototype is deployed, approved or live.

This proposal is not an audit, acceptance, deployment, listing, routing approval or public launch.
