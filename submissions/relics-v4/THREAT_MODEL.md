# Threat model

## Assets and value at risk

- `relics-token` ($RELICS, `0x8F294a99a0609822C233b24867F331c292cE2DA9`): fixed 10,000 × 1e18
  supply, no mint or burn path, owner `address(0)`. Held by public holders and by the canonical
  pool inside the PoolManager. Exit: sell on the pool or transfer; both permissionless.
- `weth` (`0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2`): the quote currency inside the pool.
- Pool liquidity and its accrued 0.30% LP fees: standard v4 accounting inside the PoolManager,
  owned by LP position holders. The genesis position NFT is held in a third-party UNCX
  liquidity lock (lock id 103); holders' balances and awakened Relics are independent of it.
- Relic NFTs (ERC-721): awakened by holders; visual state derives from the hook's
  `GlobalMarketState`. Artistic value only; the hook stores no entitlement to funds.
- **The hook itself holds nothing, ever**: no tokens, no ETH, no ERC-6909 claims, no positions,
  no dust. A total hook compromise could at worst corrupt future art-state writes; it cannot
  touch funds.

## Trust boundaries

- **PoolManager → hook**: the only caller of the callbacks (BaseHook `onlyPoolManager`). The
  hook trusts the PoolManager's slot0 and delta values; both are core-protocol facts.
- **Hook → PoolManager**: read-only `getSlot0` via StateLibrary/extsload. The hook initiates no
  pool actions, no external calls, no token movements.
- **Traders/routers → pool**: any router may swap; hookData is an optional bytes32 entropy salt
  with no identity and no financial meaning, so a malicious router can at most perturb the art
  seed of its own swap — an input the design already treats as adversarial entropy.
- **Token ↔ NFT layer**: $RELICS transfers invoke the project's own RelicsNFT for dormancy
  sync. No third-party contracts are called.
- **Interfaces** (relics.wtf, app.uniswap.org, marketplaces): read-only or standard-protocol
  surfaces; none has authority over any contract.
- **No other boundary exists**: no oracle, keeper, signer, bridge, indexer-with-authority,
  admin, or upgrade path anywhere.

## Custom hook boundary (`hook.used` = true)

Permission flags (all 14, deployed and address-encoded, mask `0x1440`):
`afterInitialize`, `afterAddLiquidity`, `afterSwap` = true; all others — including every
before-hook, both donate hooks, `afterRemoveLiquidity`, and all four return-delta bits — false.
Uniswap v4 reads these bits from the address itself, so they are unforgeable without redeploying
at a different address.

- **Why each callback**: `afterInitialize` binds and price-checks the canonical pool exactly
  once (expected tick -82980) and seeds market state; `afterAddLiquidity` records liquidity
  magnitude; `afterSwap` records amounts/tick/salt. Nothing else is needed to observe, and
  nothing more was enabled.
- **CREATE2 deployment**: deterministic deployer `0x4e59b44847b379578588920cA78FbF26c0B4956C`,
  salt `0x…1302`, init-code hash `0x8a34afea…0535`; reproduced offline by
  `flagship/test/DeploymentProof.t.sol` from the exact published source.
- **Authentication**: every callback is PoolManager-only, then revalidates the complete
  PoolKey (id, both currencies, fee, tickSpacing, hooks address) and reverts
  `UnauthorizedPool`/`HookAddressMismatch` on any mismatch. Consequence: no second pool can
  ever initialize against this hook, and callbacks for the canonical pool cannot be spoofed.
- **hookData validation**: fixed-width decode of the first 32 bytes only, else fallback to
  `sqrtPriceLimitX96`. No length-dependent parsing beyond the single check, no identity, no
  amounts.
- **Return shapes**: `afterSwap` returns `(selector, 0)`; `afterAddLiquidity` returns
  `(selector, ZERO_DELTA)`. The return-delta permissions are disabled at the address level, so
  even a code bug could not smuggle a delta.
- **Revert surface on the canonical pool**: the PoolKey checks pass by construction; the only
  reachable reverts are `Uint128Overflow`/`Int128Overflow` guards on cumulative counters.
  Reaching them requires on the order of 3.4 × 10^16 full-supply round trips — not a practical
  denial-of-service vector. There is deliberately no code path by which the hook can block a
  swap, a liquidity change, or an exit under any market condition.

## Token-layer boundary (declared for honesty; outside the flagship closure)

The $RELICS ERC-20 couples outflows to NFT dormancy: LIFO retirement with real burn events,
bounded at 16 per transfer, `PreparationRequired` above that until the holder self-serves
`prepareSell` (≤ 16 ids, `msg.sender`-only — operators structurally cannot prepare or retire on
a holder's behalf). Threat analysis: no operator authority exists, amounts are never modified,
buys/receipt are never blocked, and the constraint is deterministic and holder-resolvable, so
the residual risk is UX (a large unprepared sell reverts) rather than custody or censorship.
Sell liveness is preserved: any holder can always prepare and then sell their entire balance.
This is declared with `transferImpact: can-restrict` — the strongest honest label — in
`submission.json.tokenBehaviorExtensions`.

## Value flows and accounting

Two flows exist: standard swap settlement (trader ↔ pool via flash accounting) and 0.30% LP fee
accrual to liquidity providers. The hook participates in neither. It maintains no liabilities,
no claims, no balances; therefore no solvency equation, custody exit, or reconciliation path
applies to it. Value conservation is exactly core v4's.

## Programmable fee boundary

Not integrated and not integrable in place: the deployed hook is immutable and ownerless.
`programmableFee` is declared with the required policy constants, `collection.status:
pending-hook-integration`, and no claimed source or tests. No wording in this package claims
fee collection, launch readiness, platform approval, or provider support.

## Failure and recovery

Every failure mode is atomic revert of the enclosing pool action. The hook holds no funds and
gates no exits, so there is nothing to recover, pause, rescue, or migrate — and no authority
that could. If the art-state semantics were ever found undesirable, the only remedy is social
(a new system), never administrative; this is a deliberate design property, disclosed rather
than mitigated.
