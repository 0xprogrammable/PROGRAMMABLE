# Meme Launch V1 security properties

This document defines testable properties for `MemeLaunchV1`, `EthCreatorFeeHookV1`,
`EthCreatorFeeHookFactoryV1` and the permanent-position factory. It is an engineering specification, not an audit
certificate.

## Trust boundary

The release trusts the immutable official Uniswap v4 PoolManager, PositionManager and UERC20Factory selected at
deployment. The hook and the launcher's initial-buy unlock callback accept calls only from their PoolManager. Each pool is registered before initialization and only
the token’s recorded creator may register it. For Launcher-created UERC20s, that recorded creator is `MemeLaunchV1`, so
registration and initialization remain atomic.

The launcher, hook and factories have no owner, proxy, upgrade, pause or arbitrary-call entry point. The hook is shared
across pools and stores an immutable creator and total fee for each registered `poolId`.

The initial position belongs to an official Uniswap `PositionFeesForwarder` deployed with the zero operator and
`type(uint256).max` timelock. The complete position cannot practically be approved, transferred or reduced. Token
rounding dust is sent to the same permanent recipient.

## Core properties

| ID | Property | Evidence |
| --- | --- | --- |
| AUTH-01 | Only the configured PoolManager can invoke hook callbacks or `unlockCallback`. | `BaseHook.onlyPoolManager`; callback test |
| AUTH-02 | Only the registrar stored for a pool may initialize it. | `_beforeInitialize`; registration and initialization tests |
| REG-01 | Registration requires native ETH as currency0, a nonzero token as currency1, this hook, LP fee 0 and tick spacing 200. | `_validatePoolShape`; configuration tests |
| REG-02 | The caller must equal `token.creator()`; each `poolId` can be registered once. | creator-bound and duplicate-registration tests |
| REG-03 | An official Explore record requires the paired Meme Launch events, not a shared-hook registration alone. | event schema and monitoring specification |
| FEE-01 | The selected total is exactly 100–1000 basis points in steps of 100. | launch and registration validation; all-step tests |
| FEE-02 | Launcher receives exactly 10 basis points from the selected total; the creator receives the remainder. | quote fuzz tests and 1% split fixture |
| FEE-03 | No separate Launcher fee is added on top of the selected total. | gross and exact-output conservation properties |
| FEE-04 | All four exact-input and exact-output swap quadrants accrue only native ETH claims. | directional integration tests |
| FEE-05 | Gross-input math rounds down; exact-output math grosses up once and preserves the requested net native amount. | quote fuzz tests and tiny-amount fixtures |
| FEE-06 | A native-specified partial fill reverts before any fee state can persist. | tight-price-limit and liquidity-exhaustion tests |
| FEE-07 | Internal creator plus Launcher accounting never exceeds native claims held by the hook. | stateful invariant suite |
| CLAIM-01 | Anyone may trigger a standard claim, but it pays only the recorded creator or immutable treasury. | permissionless-claim test |
| CLAIM-02 | Only the recorded recipient may redirect its own payout; a zero destination is rejected. | rejecting-wallet recovery and unauthorized redirect tests |
| CLAIM-03 | Claims use checks-effects-interactions under `ReentrancyGuardTransient`; a failed payout restores accounting. | recovery test and transaction rollback |
| FLAGS-01 | The hook address exposes exactly beforeInitialize, beforeSwap, afterSwap and both swap return-delta flags. | factory mask 8396; unit and invariant tests |
| LOCK-01 | The initial NFT is minted to a factory-recorded PositionFeesForwarder with zero operator and maximum timelock. | Meme launch integration test |
| LOCK-02 | Token liquidity plus locked rounding dust always equals the complete fixed supply. | launch accounting assertion |
| FLOW-01 | Token creation, registration, initialization, position minting, the creator's selected Dev Buy and launch recording are atomic. | `nonReentrant` launch and rollback tests |
| FLOW-02 | The launch requires at least 0.0006 ETH for the creator's Dev Buy, no creator liquidity deposit and no protocol launch fee. A value below the minimum reverts before token creation. | minimum-value rollback, balance and integration assertions |
| FLOW-03 | The launcher and PositionManager retain no launched-token balance after success. | custody assertions |
| FLOW-04 | A matching predeployed permanent recipient is reused only after factory and immutable-configuration checks. | predeployment regression test |
| FLOW-05 | The initial-buy PoolManager delta must consume the complete creator-selected amount, produce a positive token amount, settle to zero and transfer those tokens directly to the creator. | callback authorization, delta and custody assertions |
| PROV-01 | A successful launch records a chain-, contract-, pool-, position- and economics-bound hash. | `launchHashOf` and paired launch events |
| UI-01 | The server encodes the selected total directly as `totalSwapFeeBps`, validates a Dev Buy of at least 0.0006 ETH and binds the exact selected value into the prepared transaction and plan hash. | Vitest calldata and prepared-transaction fixtures |
| UI-02 | No wallet request exists until deployment, codehash, immutable and exact-call simulation gates pass. | fail-closed manifest and preflight route |
| FORK-01 | The prepared deployment stack can launch against the pinned official Sepolia contracts. | `DeploySepoliaMemeInfrastructureV1.t.sol` |

## Stateful and fuzz scope

The hook invariant handler exercises buy and sell swaps in all four exact-input and exact-output modes, plus both claim
paths. Each local invariant property runs 256 sequences at depth 64, or 16,384 state-changing calls. It checks immutable
configuration, exact callback permissions, native-claim solvency, internal accounting equality and absence of loose ETH
or token balances.

Fee quote properties fuzz gross and net values across every allowed whole-percent selection. Integration tests cover
tiny-wei rounding, alternative-pool bypass, tight price limits, exhausted liquidity, rejecting recipient contracts and
the full one-sided launch composition.

## Expected failure behavior

- Empty identity fields or an invalid total fee revert before token creation
- An occupied deterministic token address reverts
- A malformed token creator interface or unauthorized registrar reverts
- A mismatched PoolManager, PositionManager, hook or position factory reverts at deployment
- An incorrect callback address salt reverts in the factory
- An unregistered or incorrectly shaped pool cannot initialize or swap through this hook
- A native-specified partial fill reverts the complete swap
- A failed ETH payout reverts and preserves the accrued claim
- Amounts below integer precision may round either share to zero
- An alternative pool does not accrue this hook’s fee

## Out of scope

These properties do not guarantee market value, price stability, scanner labels, profitable trading, legal status,
router support, protocol-fee policy, indexer correctness or the safety of upstream contracts outside the pinned release.
The ERC-20 remains freely transferable, so anyone may create a pool without this hook. High selected fees may trigger
third-party warnings. Production router evidence, a signed testnet lifecycle, a frozen passing release and the other
internal gates in `MAINNET-READINESS.md` remain mandatory before mainnet. No external smart-contract audit is planned,
so the release must remain explicitly described as unaudited.

The older auction, direct-liquidity and dynamic-fee properties remain covered by their own regression tests. They do not
expand the public Meme Launch security claim.
