# Test plan

The exact evidence target is source revision `c9163f1947553734393e8e44e558feacc4d4fa4c` and review-target hash `sha256:10d4413cdc656521e8bbdaef1203423933f7c5aca721e7602623467eb2532070`.

## Completed local evidence

- Run `forge fmt --check`, `forge build`, `forge test -vv`, and `forge build --sizes --skip test --skip script` with Solidity 0.8.26, Cancun, optimizer 200, and via-IR.
- Require all 64 unit, integration, fuzz, and invariant tests to pass with no failures or skips. Require all four stateful invariant handlers to complete 64 runs and 2,048 calls per property with zero handler reverts.
- Cover PoolManager callback authentication, exact `0x20cc` hook permissions, invalid permission-salt rollback, exact PoolKey registration, router-before-hook order, one-shot launch, two-sided PoolManager settlement, and permanent launcher ownership of the initial position.
- Cover the 10-bps Programmable floor, fixed claim authority, independent cumulative rounding, all four swap quadrants, exact-input and ordinary exact-output behavior, partial-fill rejection, quote-delta conservation, ERC-6909 claim solvency, and claim redirection failures.
- Cover verified buy custody and basis, partial/full sells, profit/loss/maturity penalties, seller self-exclusion, activation, withdrawal, rebate/reward claims, replay/deadline failures, donation isolation, and public solvency equations.
- Reproduce the declared launcher, router, factory, hook, runtime hashes, permission mask, market-derived initial price, and liquidity amounts at pinned Ethereum block `25693788` without broadcasting a transaction.
- Run the React demo’s four unit tests and Vite production build. The recorded large-chunk warning is a demo optimization item, not a contract gate.
- Validate the exact `launch.json` against the `programmable:production` autonomous launch contract and rebuild the deterministic source/dependency closure.

## Required independent and platform gates

- Independently rebuild from the exact commit and dependency lock; rerun Foundry, fork, gas, size, and invariant suites in an isolated environment.
- Run Slither or an equivalent reviewed Solidity analyzer and disposition every finding. Local Forge lint is not independent static analysis.
- Review v4 delta signs, exact-output inversion, cumulative rounding, custody, solvency, intent authentication, reentrancy, unsupported tokens, economic manipulation, MEV, and the deliberate absence of recovery powers.
- Execute the real-token initializer only after approval, funding authorization, fresh dependency-code checks, fresh price review, and final signed deployment verification.
- Build and test provider-owned quoting, SDK actions, event indexing/reorg recovery, reconciliation, monitoring, registry, routing, and incident-response surfaces separately.

No local test proves deployment, acceptance, provider support, routing, or availability.
