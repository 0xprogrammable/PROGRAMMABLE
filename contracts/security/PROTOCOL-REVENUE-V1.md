# Protocol revenue V1

## Status

This release candidate is implemented and tested locally against current Ethereum Mainnet state. It is not deployed,
delegated, enabled on Vercel or active. No production revenue has moved through this code.

## Immutable policy

Every successful cycle applies one fixed allocation to newly claimed native ETH:

| Destination | Share |
| --- | ---: |
| Treasury `0x2Bb333d48DFAF1596D9036671d2E43168994249E` | 50% |
| `$V4` purchase | 49.5% |
| Restricted keeper gas reserve | 0.5% |

The keeper share is 1% of the buyback half. It keeps the disposable transaction signer funded without giving it
custody over protocol revenue. Integer dust is assigned to Treasury, so the three outputs always equal the exact claim.

The buy uses Uniswap's deployed Universal Router and the existing native ETH / `$V4` main pool
`0xd9ca22573437a06a12d5c757b151aa1a76265c1dfdde4b76507233d7ad2b6df0`. Bought `$V4` is delivered to the fixed
revenue wallet `0x4957f49620AFf3Adbbe8195a4f633E49cc93376c`. No liquidity is added and no token is burned.

The router is non-upgradeable. It has no owner, proxy, pause, recovery, arbitrary-call, token-approval,
liquidity-management or configuration function. Recipients, token, pool, shares, cadence, dependencies and price
bounds are fixed in bytecode. The keeper is immutable and cannot redirect funds.

## Exact claim scope

The executor snapshots native protocol fees on four pinned shared hooks: Classic V1, Classic V2, Classic V3 and Deep
V1. A shared-hook claim covers all tokens on that hook version. Non-zero Classic fees are claimed directly to the
router. Deep V1 can only claim to the revenue wallet, so the same atomic batch forwards exactly the Deep snapshot from
that wallet to the router. Prior wallet ETH and unrelated router ETH are never swept.

The enforcer reconstructs the current snapshot and rejects an altered amount, recipient, target, selector, ordering or
transfer value. Future hook versions and non-native fee assets are excluded until a separate reviewed source update.

## Delegation and keeper boundary

The revenue wallet uses MetaMask's EIP-7702 Stateless Delegator. It signs one revocable EIP-712 delegation to the exact
executor runtime with one custom caveat. The manager, delegator, delegate, redeemer, execution mode, immutable caveat
terms, empty unsigned arguments and final postcondition are all checked. Revocation stops future cycles.

Vercel stores only a private key for a disposable keeper EOA. That keeper can call only
`executeKeeperCycle(uint64,int24)`. It cannot claim to itself, change a recipient, change a share, choose another token
or pool, move old wallet balances or call through the delegation with arbitrary calldata. The reward-wallet private key
is never stored on Vercel.

## Scheduling, retries and economics

Vercel calls the authenticated route every 15 minutes. The contract permits at most one successful cycle per 24 hours.
Frequent checks provide retry opportunities because Vercel does not retry failed Cron invocations. Duplicate or
overlapping invocations fail closed through the keeper nonce, replayed-observation rejection and the onchain cooldown.

Before signing, the server requires agreement from two independent Ethereum RPC providers on a finalized block,
runtime code, immutable policy, accrued revenue and pool tick. It skips when the cycle is not due, the delegation is
missing, a keeper transaction is pending, gas exceeds the configured cap, the keeper lacks balance or revenue is too
small to replenish buffered gas. The minimum economic multiplier is 250, matching the 0.5% keeper allocation with
headroom.

## MEV and price controls

The raw signed transaction is submitted only to MEV Blocker's private `noreverts` boost endpoint with Flashbots
fallback. It is not deliberately broadcast to a public mempool. MEV Blocker is an external availability and privacy
dependency, not a cryptographic guarantee.

The reference tick comes from a block agreed as finalized by both read providers. The executor accepts observations no
more than 30 minutes old. The router independently requires the execution tick within 100 ticks of that reference.
Purchases are split into at most 32 chunks of `0.1 ETH`; each chunk has a fee-aware minimum output and a 100-tick
movement limit. The complete purchase has a separate 500-tick limit. Maximum buy input is `3.2 ETH`, subject to the
tighter price bound. A stale price, high impact, excessive amount or failed private simulation stops the whole cycle.

These controls materially reduce sandwich and slippage risk but cannot make MEV, builder trust or price impact zero.

## Local evidence

The Mainnet-fork suite covers live accrued fees, exact three-way conservation, keeper funding, old-balance exclusion,
bought-token delivery, Universal Router execution, cooldown, capacity, price impact, keeper authorization, observation
freshness and replay, delegation revocation and every caveat-controlled call surface. The deployment suite verifies the
three-contract order, predicted addresses, nonce progression, keeper binding, runtime sizes and source commitment.
TypeScript tests cover Cron authentication, safe responses, due-state decisions and economic gates.

This is internal engineering evidence, not an independent audit or production proof.

## Activation gates

Production remains blocked until all of these are complete:

1. clean integration review, full regression, lint and static-analysis triage;
2. reviewed Mainnet deployment of router, enforcer and executor;
3. Etherscan and Sourcify source matches for all three contracts;
4. one valid EIP-712 delegation signed by the revenue wallet and configured on the executor;
5. Vercel sensitive configuration for the restricted keeper, exact executor and runtime hash, initially disabled;
6. keeper seed gas plus one deliberately small Mainnet lifecycle through the private relay;
7. monitoring for missed cycles, pending transactions, reverts, code-hash drift, revocation, backlog and pool binding;
8. explicit enablement only after the lifecycle evidence is accepted.
