# Classic contract security review

Snapshot date: 2026-07-26

Release-status correction: 2026-07-27

Scope: `MemeLaunchV1.sol`, `EthCreatorFeeHookV1.sol`, its deterministic factory, the permanent-position factory,
the Classic server preflight and their pinned Uniswap and OpenZeppelin dependencies.

> This review records the 2026-07-26 code snapshot. Its deployment estimate, wallet balance and test counts are historical.
> An initial Sepolia lifecycle used a legacy fourth metadata field and remains separately marked
> `historical-invalid-metadata-abi` with `releaseEligible: false`. A later release was deployed, source-verified and
> exercised with nonempty dynamic `bytes extraData`, but it predates the mandatory creator initial buy added on
> 2026-07-27. The Sepolia manifest is therefore now `requires-redeploy`.

Snapshot verdict: the reviewed code was suitable for a controlled Sepolia deployment and lifecycle rehearsal. It was not
independently audited or approved for mainnet. The later successful Sepolia rehearsal does not change that Mainnet boundary.

## Architecture conclusion

The reviewed snapshot was materially narrower than the earlier launch prototypes. One nonpayable transaction created a fixed
one-billion-supply UERC20, registers and initializes its native ETH pool, and places the complete token supply into one
permanently locked one-sided v4 position. The creator supplies no ETH and receives no token allocation.

The fixed tick 204200 values the one-billion-token supply at a starting FDV of 1.355657760817103798 ETH. Its USD
equivalent is not fixed onchain and changes with ETH/USD.

The selected 1–10% number is the complete hook fee. Programmable's fixed 0.10 percentage-point share is taken from that
number; the creator receives the remainder. Both accrue only in native ETH and only in the canonical hooked pool.

There is no owner, proxy, pause, upgrade or mutable fee authority. That removes administrative rug paths but also means
an immutable defect cannot be paused or repaired in place.

## Review findings resolved in this pass

### Native-specified partial fills

The hook initially calculated a fee from the requested specified amount before the pool had proven that amount executed.
A tight price limit or exhausted liquidity could otherwise charge against a partial fill. The final implementation checks
the PoolManager delta after the swap and reverts unless the pool-side native amount exactly matches the requested amount
after the selected fee. Tight-limit and exhaustion regressions cover the behavior.

### Contract-wallet ETH reception

A creator or treasury contract that rejects native ETH can make a direct payout revert. Accrued claims remain intact
because the transaction rolls back, but they would be unusable without a recovery path. The hook now permits only the
recorded recipient to redirect its own claim to a nonzero address. Permissionless standard claims remain fixed and
unredirectable. Rejecting-wallet and unauthorized-redirect tests cover both recipients.

### Exact-output accounting

Exact-output swaps require one gross-up so that the trader receives the requested net native amount after the hook takes
its fee. Fuzz tests compare the gross amount with `FullMath.mulDivRoundingUp`, and the stateful handler now exercises
exact-output buys and sells as well as exact-input swaps.

### Shared-hook provenance

Any token contract that truthfully reports its caller as `creator()` can register a compatible pool in the shared hook.
This does not affect another pool's immutable accounting, but it means `PoolRegistered` is not a Programmable provenance
signal. Indexers must accept only the paired launch events from the verified `MemeLaunchV1` address.

## Manual risk assessment

### Fee integrity

Gross-input fees round down to whole wei. At 1 ETH and a selected 1%, the creator receives 0.009 ETH and Programmable receives
0.001 ETH. The same fixed 0.001 ETH Programmable share applies at a selected 2%, while the creator receives 0.019 ETH. No
additional hook fee is added.

An independently enabled Uniswap protocol fee is outside this split. Ethereum gas is also outside it. The interface must
not describe the selected percentage as the trader's complete execution cost.

### Pool bypass

The token has no transfer restriction. Anyone may create an alternative v3 or v4 pool without this hook. Such trades do
not accrue creator or Programmable fees. This is an explicit economic boundary, not a contract bug. Explore and Profile must
use the canonical emitted `poolId`.

### Liquidity custody

The position NFT is minted directly to a factory-recorded official PositionFeesForwarder with zero operator and a
maximum-block timelock. The creator and Programmable cannot transfer the position or remove its initial liquidity through this
configuration. Token rounding dust goes to the same recipient.

The pool starts with no ETH. Buyers add ETH while taking tokens from the one-sided range. This resembles a range-order
opening, not a separate bonding-curve contract or a later migration event.

### Routing and market behavior

The hook uses before- and after-swap return deltas. Local routers and the pinned PoolManager tests prove the accounting
model, but production routing compatibility must be proven for the exact router path before launch. High selected fees may
also trigger wallet, router or market-data warnings. No scanner classification can be guaranteed.

### Transaction ordering

The token address and launch parameters are public before inclusion. Only the stored registrar can initialize the
canonical hooked pool, but searchers may back-run the first trade. The contract does not provide MEV protection or price
guarantees.

## Historical automated evidence

The following results were recorded for the 2026-07-26 snapshot. They are not a current test run:

- Frontend lint, TypeScript, 25 Vitest tests and production build passed
- Foundry: 108 tests passed across 17 suites
- Meme fee hook: 23 unit and fuzz tests
- Meme launch composition: 6 integration tests
- Meme hook invariants: four properties, each with 256 runs and 16,384 state-changing calls
- Invariant actions cover exact-input and exact-output buys and sells plus both claim paths
- Sepolia fork: deployment preflight, stack deployment and launch against pinned official contracts passed
- A read-only Sepolia deployment simulation estimated 0.0250703 ETH and exceeded the wallet snapshot by about
  0.00182 Sepolia ETH before a safety margin
- Official registry check: 24 required active records matched the Uniswap dataset generated 2026-07-15
- Slither: 96 contracts analyzed with 101 detectors and zero unsuppressed findings

The two scoped Slither suppressions are documented in source: the analyzer does not recognize OpenZeppelin's transient
reentrancy guard, and it misclassifies hook creation bytecode as a long numeric literal.

## Current automated evidence

The exact local source state was rechecked on 2026-07-27:

- Frontend lint, TypeScript, 102 Vitest tests across 20 files and the production build passed
- Foundry formatting, source lint and compilation passed
- Foundry ran 130 tests across 20 suites with zero failures or skips
- The current Mainnet fork lifecycle launched, bought, sold, claimed both fee shares and retained locked position custody through the current official Universal Router
- All 24 required active Uniswap deployment records matched the dataset generated 2026-07-15 at commit `37936185dee7decf681360ec799c124e0e034672`
- Slither analyzed 96 contracts with 101 detectors and reported zero unsuppressed findings

This is local engineering evidence, not a third-party audit, source-verified deployment or live Mainnet proof.

## Current release blockers

1. Freeze the exact current release and rerun unit, fuzz, invariant, fork, static-analysis and remote CI gates
2. Recheck the Sepolia deployment wallet's current nonce, balance and pending receipts
3. Deploy and source-verify the exact current stack with official UERC20 v2.0.0 `bytes extraData`
4. Launch with nonempty `extraData` and independently reconcile buy, sell and both standard claims
5. Rerun the proven V4Quoter, Universal Router and Permit2 lifecycle after the exact release commit is frozen
6. Productionize the paired-event and StateView read model with durable reconciliation, monitoring and incident response
7. Finalize the immutable treasury choice and controlled deployment-signer policy
8. Recheck official Uniswap addresses and runtime hashes immediately before deployment
9. Run a fresh Mainnet simulation and obtain explicit broadcast approval
10. Run a low-value monitored Mainnet canary before opening public transaction preparation

No Mainnet deployment exists, and none should occur until these gates are closed.

The 2026-07-27 initial-buy change is outside this historical snapshot. The current source requires at least 0.0006 ETH,
executes the buy through a PoolManager-gated unlock callback after locking liquidity, settles the exact native delta and
sends purchased tokens directly to the creator. The exact changed release must pass the gates again and be redeployed on
Sepolia before it can become release evidence.

No external smart-contract audit or public contest is planned for this release. This review is internal evidence only,
does not make the contracts audited and does not remove the additional residual risk accepted by that scope decision.
