# Test plan

## Evidence already run for this local proposal

| Surface | Command | Result | Scope |
| --- | --- | --- | --- |
| Game rules | `npm run test:app` | 4 passed, 0 failed | Determinism, bounds, first-to-three transition and no result while active. |
| Contracts | `forge test -vv` | 28 passed, 0 failed; two fuzz properties ran 256 cases each | Nine escrow lifecycle tests plus 19 real PoolManager fee-hook tests covering formula, four quadrants, routing, dust, partial fills, ownership and cross-pool isolation. |
| Solidity format | `forge fmt --check` | Passed | Declared Solidity files. |
| Solidity size | `forge build --sizes` | Escrow 6,223/7,513 B; hook 7,164/7,987 B; factory 9,370/9,396 B runtime/initcode | Local compiler/settings only. |
| Solidity gas snapshot | `forge snapshot --check` | Passed; 28 tests matched `.gas-snapshot` | Local test gas regression only; no deployment gas claim. |
| Static analysis | `slither . --filter-paths 'node_modules|test'` | 45 contracts, 101 detectors; timestamp findings plus documented tool/parser dispositions | Local source analysis; dispositions below. |
| Browser production build | `npm run build` | Passed; 537.01 kB JS, 135.82 kB gzip | Local Vite build, with one size advisory. |
| Browser behavior | `npm run qa:browser` | Passed at 1440, 390, 320 and 720 CSS px at 2x device scale | Nonzero renderer metrics, input-driven movement, touch/keyboard behavior, no console error or horizontal overflow. |
| Primary dependencies | `npm audit --omit=dev` | 0 vulnerabilities in fresh root rerun | Current npm advisory database and production dependency tree only. |
| Companion | `npm run verify` | 4 passed, 0 failed | Exact EIP-712 sign/verify, tamper, outsider/deadline rejection and key non-exposure. |
| Companion dependencies | `npm audit --omit=dev` | 0 vulnerabilities in fresh root rerun | Current npm advisory database and production dependency tree only. |

The exact machine-readable ledger is `evidence/local-checks.json`.

## Required prototype tests

### Escrow lifecycle and properties

- Add a compatible stateful handler covering create, join, settle, unjoined refund, joined refunds and hostile ordering. Record invariant calls, reverts and seed.
- Assert `token balance >= totalEscrowed` after every reachable state transition and equality when no direct donation exists.
- Fuzz round IDs, deadlines, stakes, player order, refund order and match digests at uint boundaries.
- Add malicious ERC-20 cases for false return, empty return, callback reentrancy, balance manipulation, rebase and recipient-side deduction.
- Test signature malleability, compact signatures if supported, wrong chain, wrong escrow, wrong action, wrong token/stake/players/rules/digest/deadlines and replay across every terminal state.
- Keep ERC-1271 explicitly unsupported for this fixed-EOA design; if contract signers are later added, treat that as an architecture change and add valid, invalid, reverting and gas-griefing contract-wallet tests.
- Measure gas for create, join, settle and each refund at realistic state sizes.

### Canonical Programmable fee hook and trading

- Resolve the committed Sepolia profile source conflict and bind exact deployments, runtime hashes, interfaces, immutables and observation block.
- Run a pinned fork and current-head smoke for token creation, hook registration, pool initialization, liquidity, all four swap quadrants and both fee claim paths.
- Re-run the existing real PoolManager tests for exact `max(selected, 10 bps)` behavior, fixed owner, owner-selected claim destination, LP-fee separation, dust reverts, partial-fill reverts, arbitrary routers and cross-pool isolation.
- Add stateful invariants that keep aggregate native ERC-6909 claims equal to the sum of every PoolId project and Programmable liability through randomized accrual and claim ordering.
- After deployment, record independent Uniswap interface/API quote, transaction-build and receipt evidence for the exact PoolKey, hook-inclusive amount, exactness, fees and user bounds. Routing review remains external.
- Test alternative-pool presentation so it cannot inherit canonical fee enforcement, Programmable approval or arena-support labels.

### Game and service

- Test canonical serialization across browser, service and Solidity typed-data hash with shared fixtures.
- Add production authentication, authorization, distributed rate limits, idempotency, request ordering, replay storage, log redaction and key rotation runbook. A rotation creates a new escrow; it cannot mutate an old one.
- Run long-duration desktop/mobile playtests, WebGL context loss, tab blur, pointer cancellation, reload, reduced motion, keyboard-only flow, screen-reader labels, stale API and wallet rejection states.
- Add server-authoritative match validation. The current service demonstrates bounded signing but does not prove game-result truth.
- Test service outage through both player refunds without operator assistance.

### Product and operations

- Index from exact deployment blocks with finalized `(block, transactionIndex, logIndex)` cursors, forced reorg rollback, bounded backfill, restart and reconciliation to `rounds`, `totalEscrowed` and token balance.
- Show stale/finality state and suppress settlement guidance on divergence.
- Exercise stop-new-rounds behavior while settlement and refunds remain available.
- Define thresholds, owner, escalation and drills for signer errors, signature latency, open rounds near timeout, escrow deficit, indexer lag, RPC/provider outage and route drift.
- Test UI/API/claim status against the exact accepted model version and contract identity after maintainers assign product paths.

## Static-analysis disposition

Foundry lint identifies six `block.timestamp` comparison locations and Slither groups them across five functions. They enforce join, result and refund windows. Timestamps do not determine randomness, match score, swap price or payout amount. Small validator skew remains a disclosed timing risk; realistic windows and boundary tests are required. Foundry also reports safe test-only integer casts whose constants are far below `int256.max`.

Slither's `too-many-digits` detector is locally suppressed on the factory expression because it expands compiler-generated hook creation bytecode and misclassifies embedded bytes as one source decimal literal. The source comment records this narrow disposition. The hook records liability state before its trusted PoolManager claim mint and emits the accrual event before that call; any revert rolls back both. Independent review remains required.

The Vite build's bundle-size warning is accepted only for this local architecture canary. Production work must decide code splitting and budget using measured startup and frame behavior.

## Evidence status

- `passed`: local commands listed above.
- `passed-with-disposition`: timestamp findings and browser bundle advisory.
- `not-executed`: compatible stateful invariant runner, fork/current-head, production auth, deployment, source/runtime verification, live indexer, monitoring drills, independent review and provider decisions.
- `passed`: current app, 28 contract tests, fee formulas and claims, companion, browser and dependency checks listed above.

No local test proves audit, deployment, provider support, acceptance or product availability.
