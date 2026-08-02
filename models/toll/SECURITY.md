# Toll — Security

## Hook permissions

| Permission | Used | Purpose |
|---|---|---|
| `beforeSwap` | Yes | Resolve fee tier, apply dynamic swap fee |
| `afterSwap` | Yes | Record buy entry time, accrue fees |
| `beforeAddLiquidity` | Yes | Block external LP additions (LP locked at launch) |
| `afterAddLiquidity` | No | — |
| `beforeRemoveLiquidity` | No | — |
| `afterRemoveLiquidity` | No | — |
| `beforeDonate` | No | — |
| `afterDonate` | No | — |
| `beforeInitialize` | No | — |
| `afterInitialize` | No | — |

## Return deltas

The hook does not return custom deltas. Fee charging uses the V4 PoolManager's built-in dynamic fee mechanism (`swapFee` override in `beforeSwap`).

## Accounting invariants

1. **Fee conservation:** `creatorFeesAccrued + launcherFeesAccrued ≤ totalNativeFeesAccrued` for all states.
2. **Fee monotonicity:** `totalNativeFeesAccrued` only increases (fees are never refunded).
3. **Tier monotonicity:** For any wallet, hold duration only increases between buys (weighted average shifts forward, never backward).
4. **Tier ordering:** `sniperSellFeeBps ≥ warmSellFeeBps ≥ holderSellFeeBps ≥ diamondSellFeeBps` (enforced at registration).
5. **LP immutability:** Forwarder's `timelockBlockNumber = type(uint256).max` and `operator = address(0)` — no path to unlock.
6. **Registration finality:** Once a pool is registered, its fee configuration cannot be changed.

## Privileged roles

| Role | Address | Scope |
|---|---|---|
| Launcher fee recipient | Set at hook deployment | Can claim platform fees (0.1%) via `claimLauncherFees()` |
| Reward vault | Per-pool, set at registration | Can call `claimCreatorFees(poolId)` to pull creator share |
| Reward beneficiaries | Per-vault, set at launch | Can call `vault.claim()` to receive their share |

No owner, admin, pauser, upgrader or governance role exists on any contract.

## External calls

| Target | Call | Trust assumption |
|---|---|---|
| PoolManager | `swap`, `modifyLiquidity` | Uniswap V4 core — audited, immutable |
| PositionManager | `mint`, `modifyLiquidities` | Uniswap V4 periphery — audited |
| UERC20Factory | `createToken` | Uniswap token factory — audited |
| ClassicRewardVaultV1 | `claim`, fee forwarding | Programmable vault — shared dependency |

No oracles, no external price feeds, no cross-chain bridges, no governance contracts.

## Known limitations

1. **`tx.origin` tracking:** Trader identity uses `tx.origin`, not `msg.sender`. This is required for router compatibility but means:
   - Smart contract wallets (e.g. Safe multisig) track the signer EOA, not the wallet address
   - Flashbots bundles or meta-transactions may attribute tiers to the submitter
   - `tx.origin` is considered unsafe for authorization but is safe here because it only determines fee tier, not access control

2. **ERC-20 transfers untracked:** Direct token transfers (not through the pool) do not update hold time. A wallet receiving tokens via `transfer()` has no entry time until they buy through the pool.

3. **Weighted average manipulation:** A whale can shift their weighted entry forward by making a large buy after holding. This is by design — DCA is rewarded, not penalized.

4. **No fee cap enforcement beyond MAX_FEE_BPS:** Individual tier fees are validated against `MAX_FEE_BPS` (2500 = 25%) at registration. No runtime cap beyond the immutable registered values.

5. **Single pool per token:** Each token can only be registered with one fee configuration on the hook.

## Failure modes

| Scenario | Impact | Mitigation |
|---|---|---|
| PoolManager upgrade | Hook becomes non-functional | V4 PoolManager is immutable — no upgrade path exists |
| Fee rounding at dust amounts | Trader receives 1 wei more than intended | Rounding favors trader (truncation), economically negligible |
| Block timestamp manipulation | Miner shifts tier boundary by seconds | Thresholds are 30min/4h/24h — timestamp manipulation range (~15s) is irrelevant |
| Gas price spike | Claims become expensive | No mitigation — standard L1/L2 risk |
