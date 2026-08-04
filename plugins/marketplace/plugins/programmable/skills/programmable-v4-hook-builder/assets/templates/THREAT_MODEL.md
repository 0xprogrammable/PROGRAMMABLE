# {{MODEL_NAME}} threat model

## Assets and value at risk

List every stable asset id, token, ETH balance, PoolManager claim, share, LP position, proof, signature, liability, and
entitlement that exists. Include valuable app or game state, service authority, oracle input, keeper funding, indexed
state, and signing capability where declared, without recording secrets. State origin, custody, owner, exit,
non-standard behavior, and issuer or upgrade control.

## Trust boundaries

List the trust boundaries the project actually uses: PoolManager, routers, factories, launchers, external protocols,
apps or games, browsers, wallets, services, databases, oracles, keepers, signers, issuers, administrators, indexers,
APIs, interfaces, quote providers, routing providers, and monitoring operators. Explain what each can and cannot do.

## Custom hook boundary, only when `hook.used` is true

Record all 14 permission flags, the derived mask, why each enabled callback is necessary, and the expected CREATE2
deployment method. For each enabled callback state PoolManager authentication, intended PoolKey, callback `sender`
meaning, hookData validation, exact selector and return shape, nested-action suppression, and revert effect.

## Ordinary no-hook boundary, only when `hook.used` is false

Identify `official-launchpad` or `model-specific-no-hook` and state that the project introduces no custom callbacks, hook
permission mask, or hook CREATE2 address. Explain which behavior remains in the token, router, app, game, or service and
why it does not require atomic PoolManager callback execution. Treat any separately declared contract or offchain
authority as its own boundary rather than inventing hook controls. For a model-specific path, threat-model transfer and
sell liveness, tax bounds and recipients, requested-versus-received amounts, automatic swaps, reentrancy, MEV, liquidity
position custody and exit, mutable authorities, and provider incompatibility.

State that this route remains proposal-only and `programmableFee.collection.status` is
`pending-hook-integration`. Threat-model a project-specific implementation of the standard Programmable fee-hook profile
or integration into one custom hook; a router, LP fee, transfer tax, or alternative pool is not a launch-ready substitute.

For a taxed v4 token, remember that the token observes the shared PoolManager address, not a trustworthy PoolId or
swap-versus-liquidity label. Model spoofed classifiers and the tax effect on liquidity adds, removals and alternative
pools; never describe PoolManager ingress and egress as buy and sell without this limitation.

## Value flows and accounting

Define assets, signs, settlement order, rounding, custody, fee liabilities, and conservation properties for every
supported value-moving action. For custom swap accounting, define specified and unspecified currencies and have each
settlement step name actor, currency, delta owner, sign, amount rule, operation, and deadline. When project code controls
a PoolManager unlock or callback delta, state and test the invariant that every PoolManager delta reaches zero before the
unlock ends. Do not attribute internal PoolManager settlement responsibility to an ordinary no-hook app that never owns
that execution path.

When ERC-6909 claims are used, define currency-id derivation, owner, operator, PoolId and beneficiary liability keys,
mint, burn, transfer, redemption, dust, and aggregate solvency.

## Dynamic fees and recipients

For the mandatory Programmable fee, model the canonical-PoolKey binding, executed gross quote-side basis after partial
fills, all four swap modes, floor and non-additive split, rounding, liability solvency, event reconciliation, and
alternative-pool/router bypass attempts. The immutable owner and sole claim authority is
`0x4957f49620AFf3Adbbe8195a4f633E49cc93376c`; model unauthorized builder, project, administrator, recipient, rescue,
sweep, redirect, stored-recipient mutation, owner mutation, and cross-pool-netting attempts. Preserve the owner's
ability to claim anytime to itself or an owner-selected destination for that claim.
Treat the accrued 10 bps as a claimable liability, not an automatic transfer. Model partial claims, repeated claims,
failed payout destinations, liability decrement ordering, and balance reconciliation.

Model quadrant-dependent before/after return-delta collection and v4 callback skipping on hook-initiated PoolManager
actions. Forbid same-pool self-swaps or specify and test equivalent internal fee accrual; do not ban unrelated safe
custom-hook behavior.

When used, record initial fee, initialization, application and update paths, override rule, persistent actor and call
sites, rate limit, immutable bounds, metric, observation, cadence, manipulation resistance, liquidity-decrease behavior,
and failure rule. For hook-owned fees, cover collection path, value-flow id, liability keys, event, recipient share,
address source and launch binding, rounding, duplicates, zero and failed recipients, claim and redirect authorization,
address validation, mutation event, and historic entitlements.

For token transfer taxes, separately model buy, sell and peer classification; immutable maximum; exemption boundaries;
recipient conservation; zero, tiny and maximum amounts; PoolManager requested-versus-received behavior; actual user
receipt; and the impossibility of hiding a sell block behind a fee or configuration path. For automatic liquidity, model
threshold manipulation, repeated triggers, pool-transfer suppression, reentrancy, partial external execution, slippage,
deadline, position custody, creator withdrawal, stuck balances, retry, and failure without blocking the user's underlying transfer.

## Attack and failure scenarios

Select scenarios from the declared capabilities. These may include unauthorized callbacks and malformed hookData for a
custom hook; reentrancy and hostile tokens for contracts; alternate pools, partial fills, and MEV for trading paths;
forged client actions, wallet phishing, replay, persistence divergence, and manipulated game state for apps or games;
API abuse, stale data, reorgs, job duplication, dependency failure, denial of service, and funding exhaustion for
services, keepers, or indexers; and bad recipients, insolvency, gas exhaustion, and other model-specific risks. Mark an
irrelevant family not applicable with a reason instead of fabricating a control.

## Dependency identity

Give every dependency a stable id. Bind onchain dependencies to chain, address, interface, exact source revision,
runtime expectation, upgrade authority, and trusted deployment record where available. Record offchain owner, revision,
integrity where available, authentication, freshness, funding, fallback, and monitoring.

## Product and data boundaries

For every intended UI, app, game, API, service, keeper, oracle, indexer, quote, trade, claim, and monitoring surface,
identify the source of truth, proposed model version, inputs, outputs, cache and freshness assumptions, failure states,
owner, and recovery path.

Cover forged or stale indexed data, event omission, reorgs, bad backfills, client/server state divergence, API cache
divergence, quote and execution drift, malicious hookData when accepted, wrong PoolKey or router generation, partial
fills, native refund loss, misleading transaction state, claim-preview mismatch, provider outage, routing drift, alert
failure, and incident-response failure where they apply.

Third-party discovery may locate a pool or route. It cannot prove deployment receipts, runtime identity, balances,
entitlements, claims, or lifecycle completion. State where the product reconciles provider data against confirmed chain
state.

## Authorities and recovery

Map each capability to its controller, delay, mutability, user-exit impact, and historical entitlement behavior.

## Known limitations

State what tests and design cannot guarantee, including live fee collection and unsupported lifecycle actions, assets,
routers, swap modes, and dependency states. Keep acceptance, product integration, deployment, verification, routing, discovery, and availability
as separate trust decisions. Do not call the model safe or audited.
