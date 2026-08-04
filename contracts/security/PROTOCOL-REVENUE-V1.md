# Protocol revenue V1

## Status

This release candidate is implemented and tested locally against current Ethereum Mainnet state. It is not deployed,
delegated or active. No production revenue has moved through this code.

## Policy

Every successful 24-hour cycle applies one fixed split to the native ETH claimed in that cycle:

| Destination | Share |
| --- | ---: |
| Treasury `0x2Bb333d48DFAF1596D9036671d2E43168994249E` | 50% |
| `$V4` purchase | 50% |

The purchase uses Uniswap's deployed Universal Router and the existing native ETH / `$V4` main pool:

`0xd9ca22573437a06a12d5c757b151aa1a76265c1dfdde4b76507233d7ad2b6df0`

The bought `$V4` is sent to the fixed revenue wallet
`0x4957f49620AFf3Adbbe8195a4f633E49cc93376c`. This policy adds no liquidity and burns no tokens.

The router is non-upgradeable and has no owner, proxy, pause, recovery, arbitrary-call, token-approval,
liquidity-management or configuration function. The shares, addresses, exact pool, cadence, dependencies and price
bounds are compile-time constants.

## Exact claim scope

The executor snapshots the accrued native protocol fees on four pinned shared hooks:

1. Classic V1;
2. Classic V2;
3. Classic V3;
4. Deep V1.

Non-zero Classic fees are claimed directly to the router. Deep V1 can only claim to the fixed revenue wallet, so the
same atomic batch forwards exactly the Deep snapshot from that wallet to the router. It never sweeps the wallet's prior
ETH balance.

The final process call includes the exact aggregate snapshot. The enforcer independently reconstructs that value and
rejects any altered amount, recipient, target, selector, ordering or transfer value. The router spends exactly the
declared claim amount; ETH already held by the wallet or router is not included implicitly.

One shared-hook claim covers every token using that hook version. Future hooks are not included automatically and need
an explicit reviewed source update. Stock-paired quote-asset fees remain excluded because they require separate
conversion and market controls.

## Wallet delegation

The revenue wallet already uses MetaMask's v1.3.0 EIP-7702 Stateless Delegator. It signs one revocable EIP-712 root
delegation to the exact executor runtime with one custom caveat. The deployment manager, delegator, delegate, redeemer,
execution mode, caveat terms, empty unsigned arguments and final postcondition are all checked. Revoking that delegation
stops future automated cycles.

## Cadence and price controls

A successful cycle starts a 24-hour wall-clock cooldown. Scheduler timestamps cannot bypass it. Zero, stale, future or
replayed reports fail.

Chainlink CRE reads the main-pool tick from the last finalized Ethereum block and includes it in the signed report. The
router requires the execution tick to remain within 100 ticks of that reference. Purchases are split into at most 32
chunks of `0.1 ETH`; every chunk has a fee-aware minimum output and a 100-tick movement limit. The complete purchase has
a separate 500-tick limit. The maximum input per cycle is therefore `3.2 ETH`, subject to the tighter price bound.
Larger or excessively price-impacting cycles fail atomically instead of weakening execution safety.

These checks are not a TWAP and do not eliminate MEV. Production monitoring must cover reverts, price bounds and
accumulated backlog.

The minimum claim is `0.001 ETH`. If any claim, exact Deep transfer, Treasury payment or swap fails, the complete cycle
reverts.

## CRE workflow

The disabled release configuration schedules one report at midnight UTC. The receiver accepts only the code-hash-pinned
Ethereum Mainnet CRE Forwarder, the Treasury workflow owner and workflow name `revenue-v1`. The checked-in production
configuration remains `enabled: false` with a zero receiver. Activation requires the deployed executor address and an
explicit reviewed release.

The manual fallback is `executeCycle(int24)` called by the revenue wallet. It uses the same delegation and enforcer.

## Local evidence

The Mainnet-fork suite covers the current hook backlog, exact 50/50 accounting, old wallet and router balance exclusion,
delivery of bought `$V4`, chunked Universal Router execution, cooldown, capacity, cumulative price impact, CRE identity,
replay protection, delegation revocation and every caveat-controlled execution surface.

The deployment suite verifies the three-contract order, predicted addresses, nonce progression, immutable bindings,
runtime sizes and source commitment. The CRE workflow passes its TypeScript and codec tests. Slither raw results and
manual triage are stored beside this document.

This is internal engineering evidence, not an independent audit.

## Activation gates

Production remains blocked until all of these are complete:

1. clean integration review, full regression, lint and static-analysis triage;
2. reviewed Mainnet deployment of router, enforcer and executor;
3. Etherscan and Sourcify source matches for all three contracts;
4. one valid EIP-712 delegation signed by the revenue wallet and configured on the executor;
5. CRE receiver configuration, deployment funding and activation;
6. one deliberately small Mainnet lifecycle with exact receipts;
7. monitoring for missed cycles, reverts, code-hash drift, revocation, backlog and pool binding.
