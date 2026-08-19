# v4 hook Lego and composition map

Use this map to reuse reviewed primitives instead of rebuilding protocol mechanics from memory. It maps outcomes to
candidate components; it is not an allowlist, an audit inheritance claim, or permission to copy code. Unknown ideas
remain eligible and enter architecture review with their owner-defined capability intact.

## Selection rules

1. Start from the user outcome and value flow, not a named base contract.
2. Prefer the smallest stable pinned primitive whose exact semantics match.
3. Inspect the installed source and dependency closure. A repository head, npm tag, docs page, or generated scaffold is
   not the build authority.
4. Enable only the required hook permissions and compose the mandatory Programmable 10 bps policy into the pool's one
   fee-enforcing hook.
5. One PoolKey has one hook address. Compose behaviors inside one reviewed hook or through explicit modules; do not
   pretend several independent hook addresses can attach to the same pool.
6. One hook contract may serve several pools only with exact PoolKey admission and PoolId-namespaced state,
   liabilities, claims, configuration, events, and tests.
7. Re-run permission mining, source/runtime binding, threat model, tests, and review whenever composition changes.

## Candidate primitive families

The stable OpenZeppelin package is the default library candidate when its semantics fit. The observed stable and
preview package/source identities, missing modules, and audit boundaries are recorded in `upstream-sources.json`.

| Desired behavior | Candidate family | Main proof burden |
| --- | --- | --- |
| Exact callback shell | `BaseHook` | PoolManager auth, permission mask, selectors, self-calls |
| Dynamic LP fee | `BaseDynamicFee` or override-fee base | fee bounds, update authority, stale input, exact-output limit |
| Hook-owned project fee | fee base plus project split module | all quadrants, currency, liabilities, claims, no fee-owner override |
| Async swap or custom settlement | `BaseAsyncSwap` | backing, claims, final deltas, partial fills, exits |
| Custom accounting | `BaseCustomAccounting` | zero-sum deltas, settlement, solvency, routing parity |
| Custom curve | `BaseCustomCurve` | curve invariants, rounding, price limits, quote path, MEV |
| Anti-sandwich or LP penalty | `AntiSandwichHook`, `LiquidityPenaltyHook` | ordering assumptions, false positives, LP exit, composability |
| Limit orders or long-term orders | limit-order/TWAMM family | fill accounting, cancellation, keeper liveness, price/time bounds |
| Oracle observation | oracle base or v3 adapter | manipulation window, freshness, decimals, failure and fallback |
| Idle-liquidity yield | rehypothecation/ERC-4626 family | share math, loss, liquidity recall, vault controls, withdrawal liveness |

Preview-only or specialized components do not inherit the stable profile. A historical audit covers only its named
commit and files; it does not cover derived code, configuration, integration, dependency upgrades, deployment, or
Programmable economics.

## Official public research patterns

The observed Uniswap v4 Hooks Public repository includes useful architecture examples beyond a basic hook:

- native/wrapped-asset conversion hooks such as WETH and wstETH patterns;
- permissioned pool admission;
- external-liquidity aggregator hooks for several AMM or settlement families;
- ALF active-liquidity and native-book components, quoters, vaults, and a multiplexer; and
- BaseHook and HookMiner utilities.

Treat these as pinned research candidates. Verify license, dependency gitlinks/locks, maturity, audit scope, and exact
runtime semantics before reuse. The repository's dependency references have observed drift, so do not assume its head
is one ready-to-install compatibility set.

External-liquidity aggregators need additional caution:

- authenticate the exact adapter implementation and target protocol;
- bind quote, execution, fees, callbacks, refunds, reentrancy, and failure isolation end to end;
- prove reserves and liabilities across both systems;
- reject address-prefix or first-byte heuristics as authorization, because collisions are expected; and
- preserve a route where users can understand and bound the extra dependency.

Active-liquidity or orderbook-style hooks combine custom pricing, inventory, vault shares, quoting, settlement,
liveness, and MEV. Use their concepts to design a dedicated high-review model; do not copy them as a generic market
maker template.

## Product-to-Lego examples

| Product idea | Likely composition |
| --- | --- |
| Ordinary token launch | fixed-supply token + standard Programmable fee hook + launch/custody modules |
| Dynamic tax launch | custom-token starter + transfer-tax accumulator + standard or integrated pool fee hook |
| Auto-liquidity token | token accumulator + bounded swap/add-liquidity state machine + custody/exit module |
| Three.js PvP rewards | browser game + authenticated outcome service + claim contract + canonical fee hook |
| Maps quest | map/location client + evidence or attestation service + bounded claim contract + canonical fee hook |
| Wallet transaction quest | chain-event indexer + anti-replay eligibility + bounded claim contract + canonical fee hook |
| Yielding pool inventory | rehypothecation/ERC-4626 module + recall buffer + loss policy + canonical fee accounting |
| Wrapped-asset pool | conversion base + rate/rounding and exit policy + canonical fee accounting |
| External-liquidity pool | adapter registry + exact protocol adapters + quote/execution parity + failure isolation |
| Active liquidity market | custom accounting/curve + vault inventory + dedicated quoter + liveness and MEV controls |
| Position automation | PositionManager client + subscriber/keeper + safe explicit liquidity actions + user exit |

Apps, games, maps, services, tokens, hooks, and contracts are project surfaces, not mutually exclusive launch types.
Compose the surfaces and capabilities needed by the idea. Templates accelerate repeated review questions; they never
define everything that may be built.

## Composition red flags

- Rebuilding PoolManager, router, Permit2, PositionManager, or hook permission logic without a demonstrated need.
- Copying a hook because its name resembles the desired feature while its currency, sender, delta, or lifecycle
  semantics differ.
- Assuming a base handles access control, recipients, fee splits, pausing, recovery, or upgradeability when it leaves a
  virtual handler for the application.
- Combining independent modules that each assume they own the same callback return delta or settlement step.
- Treating hook-owned ERC-6909 claims, underlying tokens, vault shares, and accounting liabilities as interchangeable.
- Relying on a custom quoter that does not execute the same callback, hook-data, sender, and state path as execution.
- Hiding a service, keeper, signer, indexer, provider, or oracle behind an “onchain” product label.

When no candidate fits, keep the blank custom starter, record the novel capability, and derive interfaces, invariants,
failure modes, tests, and review evidence from the actual value flow.
