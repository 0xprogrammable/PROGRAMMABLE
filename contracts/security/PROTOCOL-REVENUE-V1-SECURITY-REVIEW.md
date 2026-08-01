# Protocol revenue V1 security review

## Scope

- `ProtocolRevenueRouterV1`
- `ProtocolRevenueExecutionEnforcerV1`
- `ProtocolRevenueMetaMaskExecutorV1`
- `IProtocolRevenueMetaMaskV1`
- `DeployMainnetProtocolRevenueV1`
- the disabled Chainlink CRE workflow in `ops/protocol-revenue-cre`

This is an internal review of the local release candidate. It is not an independent audit and does not prove a live
deployment.

## Security properties

### Access and authority

- Only the fixed revenue wallet can call `process`, configure the one-time delegation, or use the manual fallback.
- The automated path accepts reports only from the code-hash-pinned Ethereum Mainnet CRE Forwarder.
- The accepted CRE workflow owner, workflow name, chain selector, report age and replay sequence are fixed.
- MetaMask's existing EIP-7702 account implementation is preserved. The signed delegation is revocable through the
  deployed MetaMask DelegationManager.
- The caveat enforcer accepts one canonical claim, sweep and process batch. Runtime-supplied caveat arguments must be
  empty.

### Funds and accounting

- New native revenue is split 50% to Treasury, 25% to a `$V4` purchase and 25% to native liquidity principal.
- Existing liquidity dust is accounted separately and is never split as new revenue.
- The batch covers the complete native balance of the dedicated revenue wallet and all accrued native fees on the four
  pinned shared hooks.
- All claim, sweep, split, swap and liquidity operations are atomic. A failure reverts the complete cycle.
- PositionManager receives only the calculated ETH principal. Its unrelated native balance cannot be consumed.

### Liquidity custody

- The router creates one full-range position in the exact existing ETH / `$V4` main pool and reuses it.
- The position NFT is owned by the immutable router.
- The router exposes no approval, transfer, decrease, collect, burn, withdrawal, recovery, proxy or owner function.
- Pool key, token, hook, PoolManager, PositionManager, Permit2 and Universal Router are fixed and runtime-code-hash bound.

### Price and timing bounds

- The last-finalized reference tick may differ from the execution tick by at most 100 ticks.
- Each purchase chunk is at most `0.1 ETH`, includes a fee-aware minimum output and may move the pool by at most 100
  ticks.
- A complete cycle may move the pool by at most 500 ticks from its starting point. This cumulative check prevents many
  individually valid chunks from bypassing the intended total price-impact bound.
- At most 32 chunks execute in one cycle.
- A successful cycle starts a real 24-hour cooldown. Scheduler timestamps cannot accelerate it.

## Property-based tests

The Foundry fork suite fuzzes first-cycle revenue from `0.004 ETH` through `0.4 ETH` and checks:

1. the 50/25/25 gross policy is conserved;
2. Treasury receives exactly half of new revenue;
3. no ETH is stranded in PositionManager;
4. router ETH equals separately accounted liquidity dust;
5. purchased tokens and liquidity principal are non-zero.

The suite also exercises current Mainnet backlog values, a second daily cycle, the deployed MetaMask DelegationManager,
delegation revocation, CRE report identity and replay checks, exact caveat surfaces, cycle capacity, cumulative price
impact, one-position custody and atomic failure behavior.

Echidna and Manticore were not available in the local toolchain. Foundry fuzzing and Mainnet-fork integration tests are
the implemented property-testing evidence.

## Manual review

| Area | Result |
| --- | --- |
| Upgradeability | No proxy, initializer or upgrade function |
| Administration | No owner, role, pause, recovery or arbitrary-call surface |
| Reentrancy | Mutating entry points use transient reentrancy guards; external dependencies are fixed and code-hash bound |
| Token integration | Exact `$V4` token and deployed Uniswap dependencies are bound; SafeERC20 and Permit2 are used |
| MEV | Reference, output, per-chunk and cumulative tick bounds fail closed; a TWAP oracle is not claimed |
| Arithmetic | Solidity 0.8 checked arithmetic, FullMath for proportional calculations and explicit narrowing checks |
| Loops | The only external-call loop is capped at 32 iterations |
| Privacy | No key, signature, credential or environment value is committed |
| Failure mode | Claims, sweep, Treasury transfer, purchase and LP increase revert atomically |
| Dependency drift | Runtime-code-hash mismatch stops execution instead of silently changing behavior |

## Residual risks

- This is not an independent audit.
- The main-pool spot price can be manipulated. The bounds limit execution but do not create a TWAP oracle or remove MEV.
- A reverting Treasury recipient, paused MetaMask manager, revoked delegation, changed dependency runtime, insufficient
  CRE funding or a cycle above the price/capacity bounds can stop automation.
- Native ETH sent to the dedicated revenue wallet is treated as revenue. That wallet must not hold unrelated ETH.
- Future hook versions and non-native fee assets are excluded until explicitly reviewed and added.
- The 50/25/25 policy is gross. The main hook's fixed 1% swap fee slightly reduces same-cycle LP principal, and those
  hook fees accrue for a later cycle.

## Release boundary

Local tests, static analysis and a reproducible workflow build do not make this production-ready. Mainnet deployment,
source verification, a signed delegation, funded CRE activation, a deliberately small live lifecycle and monitoring are
still required.
