# {{MODEL_NAME}} test plan

## Universal prototype evidence

- Validate the structured package and bind the exact clean source revision, declared files, dependency lock, and review
  target.
- Build and test every declared implementation surface with its pinned language, compiler or runtime, package manager,
  and configuration.
- Test the authorities, value flows, configuration bounds, state transitions, events or observable outputs, failures,
  recovery paths, and exits the design actually introduces.
- Use adversarial cases, fuzzing, stateful invariants, static analysis, and resource-bound tests where the declared
  capability and risk require them.
- Give every dependency a stable id and test the applicable source, chain, address, interface, runtime, deployment,
  upgrade, freshness, failure, and fallback assumptions.
- Create product-integration test plans for every intended UI, game, service, API, indexer, quote, trade, claim, keeper,
  oracle, and monitoring surface.

Mark a lifecycle action or capability family `not applicable` only with a reason and a test, source inspection, schema
constraint, or structural argument showing why it cannot be reached. Do not add an implementation language or report a
tool result merely to fill a section.

## Solidity contracts, when declared

- Prove the compiler-resolved source and import closure, exact compiler/EVM/settings, dependency revisions, build
  artifacts, and runtime or deployment expectations.
- Test configuration, authorization, arithmetic, events, bounds, reverts, hostile tokens, reentrancy, and applicable
  value-conservation properties.
- Record static-analysis dispositions plus applicable fuzz, invariant, pinned-fork, current-head smoke, gas, runtime-size,
  and initcode-size evidence.

## Custom hook, only when `hook.used` is true

- Reproduce all 14 permission flags, the derived mask, deployment method, salt/initcode when CREATE2 applies, and the
  expected hook address.
- Test PoolManager and PoolKey authentication, callback selector and return length, parent permission, sender meaning,
  hookData policy, nested/self-call suppression, and revert atomicity for every enabled callback.
- Cover both directions and exact-input and exact-output modes, or explicit rejection tests for unsupported modes.
- Test ordered settlement, final-zero deltas, ERC-6909 solvency where used, rounding, partial fills, and failure atomicity.
- For dynamic fees, test initialization, application mode, override flag, persistent actor and call sites, update path,
  rate limit, bounds, observation, cadence, manipulation, liquidity decrease, and failure.
- For hook-owned charges, test the collection path, value-flow id, liability keys, event, recipient sums and bindings,
  duplicates, zero and failed recipients, claims, redirects, address mutation, and historic entitlements.

## Ordinary no-hook path, when `hook.used` is false

- Prove explicit selection of `official-launchpad` or `model-specific-no-hook` and the canonical pool lifecycle. For the
  official route, bind the current pinned profile. For the model-specific route, bind its own exact source, compiler,
  dependency closure and constructor configuration without borrowing the official profile identity.
- Confirm that the declared project does not introduce custom callbacks, a hook permission mask, or a hook CREATE2
  address, and that its proposal, submission, threat model, and tests agree on that boundary.
- Test any separately declared token, app, game, service, integration, or launch configuration on its own merits. No
  custom Solidity or hook test is required merely because the project uses a Uniswap v4 pool.

When a model-specific no-hook transfer tax is used, test `buy-sell-peer-tax-rates`, `zero-tax-path`,
`immutable-maximum-tax-bound`, `recipient-split-conservation`, `exemption-boundaries`,
`poolmanager-requested-versus-received`, `poolmanager-liquidity-and-alternative-pool-classification`,
`quote-execution-received-amount`, and
`unrestricted-buy-sell-transfer-liveness`; add `authority-and-delay` when mutable. When automatic liquidity is used,
also test `auto-liquidity-threshold-boundaries`, `auto-liquidity-maximum-swap-bound`,
`auto-liquidity-slippage-and-deadline`, `auto-liquidity-reentrancy`, `auto-liquidity-failure-atomicity`, and
`lp-custody-and-exit`. Exercise provider-supported and unsupported routes without turning a local canary into approval.

## App or game, when declared

- Test rules and state transitions, wallet and signing boundaries, input validation, persistence, replay and duplicate
  actions, loading and error states, unsupported states, recovery, and any client/server trust split.
- Test intended browsers and breakpoints, keyboard and screen-reader behavior where applicable, transaction progress,
  stale or conflicting data, and user-visible value or entitlement calculations.

## Service, keeper, oracle, or indexer, when declared

- Test API and event schemas, authentication and authorization, idempotency, retries, ordering, timeouts, rate limits,
  stale data, reorgs, backfill, reconciliation, funding, failover, recovery, and denial-of-service bounds where relevant.
- Test monitoring thresholds, alert ownership, incident runbooks, degraded modes, and the effect of unavailable or
  malicious dependencies.

## Product integration cases

During proposal and prototype work, plan these against the intended PoolKey, model version, contract addresses, router
generation, and event schema. Mark values that are not fixed yet as unresolved. Executable product-contract tests begin
after maintainers accept the model and assign product paths.

- UI renders canonical identity, lifecycle state, balances, fees, claims, disclosures, unsupported modes, stale data,
  transaction progress, and failures from the declared source of truth
- App or game interactions preserve the declared rules, wallet boundary, persistence, value flow, failure states, and
  recovery behavior
- API request and response schemas preserve chain, model version, amount semantics, errors, freshness, and cache rules
- Services, keepers, and oracles preserve their declared trigger, authority, freshness, retry, fallback, and funding
  behavior
- Indexer replay from the declared start block survives reorgs, resumes backfill, reconciles receipts and chain reads,
  and reports lag without presenting stale state as current
- Quote and trade use the same PoolKey, direction, exactness, amount semantics, hookData when used, fee model, and proposed
  configuration; test slippage, deadlines, partial fills, native refunds, final deltas, simulation failures, and receipts
- Claim preview and execution agree on entitlement and liability keys; test caller and recipient authorization, payout
  changes, historical rights, failed recipients, retries, and displayed transaction state
- Monitoring detects contract, solvency, keeper, oracle, RPC, indexer, routing, and provider failures that apply; test
  alert ownership, fallback, escalation, and the incident runbook

Tests may prove only the surface and revision they exercise. They do not prove deployment, source verification,
provider approval, or production availability.

## Semantic cases

Record a worked numerical example for every fee or accounting rule the project introduces. Turn each example, its
rounding boundary, its value-conservation equation, and one failure case into a test. For a project that changes or
mediates swaps, cover all four quadrants or explicit rejection. An ordinary no-hook project states that it adds no
custom swap accounting. A structurally valid submission with inconsistent examples is not prototype-ready.

## Evidence status

Record each command as `planned`, `passed`, `failed`, `blocked`, or `not-applicable-with-reason`. Include exact tool
versions, counts, fork block, useful invariant calls, reverts, gas, size, skips, and failures where applicable.

Track maintainer acceptance, platform review, deployment authorization, deployment execution, source verification,
runtime matching, lifecycle verification, monitoring readiness, routing/discovery, and availability as separate gates
with separate evidence.

Planned work is not test evidence.
