# Deep ETH Buy and Lock Design

Status: Design for owner review

Product name: Deep

Internal release line: `deep-full-range-v3`

Network target: Ethereum Mainnet

Deployment status: Not deployed

## 1. Decision

Deep is a separate launch model with one fixed economic policy:

- Every ordinary buy and sell pays a 1.00% Programmable hook fee in ETH.
- 0.10 percentage point accrues to the immutable Programmable treasury.
- The remaining 0.90 percentage point accrues to the token's immutable Deep growth vault.
- The growth vault has no creator reward, beneficiary, payout, rescue, withdrawal, admin, upgrade, or liquidity removal path.
- At most once per eligible five-minute window, the vault uses a bounded part of its accounted ETH to buy the launched token in the original Uniswap v4 pool and immediately combines the acquired token with the remaining accounted ETH in permanently pool-bound full-range liquidity.
- The internal buy and liquidity addition execute atomically inside one `PoolManager.unlock`.
- No token fee or acquired token is ever paid to Programmable, the creator, the keeper, or another recipient.

The current reserve-backed V2 candidate does not satisfy this policy. It pre-funds a token reserve, stops growth at a fixed target, and later pays creator rewards. It remains preserved as an undeployed candidate. Deep will use new versioned contract and release files without modifying deployed V1 contracts or the shared V2 candidate.

The website continues to call the model **Deep**. Internal version labels are release and source identifiers only.

## 2. Product Contract

### 2.1 What Deep guarantees

For a successful launch:

1. The launched token has a fixed supply of 1,000,000,000 tokens with 18 decimals.
2. The original pool is `(native ETH, launched token, LP fee 0, tick spacing 200, Deep hook)`.
3. The initial one-sided position and every growth position use that exact `PoolId`.
4. The initial position cannot be transferred or have liquidity removed.
5. The growth position is owned directly by the growth vault in `PoolManager` under one fixed full-range position key.
6. Growth liquidity is add-only and cannot be rescued, withdrawn, delegated, upgraded, or redirected.
7. Ordinary swap fee accounting is fixed at 90 basis points to growth and 10 basis points to Programmable.
8. The growth vault's internal ETH to token swap is exempt from the Programmable hook fee only for its own registered pool and only during a valid compound.
9. A failed compound changes no fee claim, cooldown, exposure, liquidity, or accounting state.
10. Unsafe or unprofitable keeper slots are skipped and retried later. Missed slots are never accumulated into a larger catch-up order.

### 2.2 What Deep does not guarantee

- A keeper transaction cannot occur without an offchain executor paying gas. The five-minute rule is the earliest eligible retry, not autonomous block execution.
- A TWAP is a manipulation circuit breaker, not an external fair-value oracle.
- Deeper liquidity does not prevent token price loss, low demand, market manipulation, or all MEV.
- Uniswap protocol fees, if active for the pool, are independent of the fixed 1.00% Programmable hook fee. They must be measured and disclosed separately.
- Local tests, fork tests, and simulations do not prove Mainnet deployment, source verification, live keeper operation, or an external security review.

## 3. Release Architecture

The implementation uses new V3 siblings so the dirty shared tree, deployed V1 artifacts, and undeployed V2 candidate remain intact.

### 3.1 New contracts

| Contract | Responsibility |
| --- | --- |
| `LiquidityGrowthFeeOracleHookV2` | Fixed native four-mode fee accounting, oracle observations, pool lifecycle, immutable vault exemption, and Deep liquidity permissions |
| `LiquidityGrowthFeeOracleHookFactoryV2` | CREATE2 deployment and provenance for the new hook permission bitmap |
| `LiquidityGrowthFullRangePolicyV3` | Fixed fee, cooldown, oracle, optimizer, impact, exposure, range, and budget constants |
| `LiquidityGrowthZapPlannerV3` | Stateless exact v4 swap simulation and one-sided full-range optimizer |
| `LiquidityGrowthFullRangeVaultV3` | Direct growth-fee claim, atomic swap and add, permanent position custody, and conservation accounting |
| `LiquidityGrowthFullRangeVaultFactoryV3` | Deterministic clone deployment, initialization commitment, and exact dependency validation |
| `LiquidityGrowthFullRangePositionPlannerV3` | Initial one-sided position plan using the complete launch supply |
| `LiquidityGrowthFullRangeLaunchV3` | Token creation, vault and oracle binding, pool registration, initial liquidity, initial buy, and final oracle baseline |
| `LiquidityGrowthFullRangeAutomationV3` | Permissionless registry, readiness checks, failure-isolated batches, and oracle staging |
| `DeepKeeperExecutorV2` | Reviewed signer boundary for the new atomic compound action after gas re-benchmarking |

### 3.2 Reused official and existing components

- Uniswap v4 `PoolManager`, `PoolKey`, `PoolId`, `SwapMath`, `SqrtPriceMath`, `TickMath`, `FullMath`, `StateLibrary`, and transient delta accounting.
- Uniswap v4 periphery `LiquidityAmounts` and settlement patterns.
- Official Uniswap Liquidity Launcher position planning for the initial mint only.
- OpenZeppelin `BaseHook`, Panoptic oracle observations, `ReentrancyGuardTransient`, `SafeCast`, `SafeERC20`, and deterministic clone utilities.
- The existing 30-minute same-pool observation design, cardinality staging, fixed five-minute cooldown, 30-minute rolling exposure window, exact-pool validation, and failure-isolated keeper scan pattern.

The internal compound does not use Universal Router, PositionManager, or an onchain quoter. The vault calls `PoolManager` directly so the hook sees the vault itself as `sender`, and so the swap and liquidity addition share one unlock and one net settlement.

## 4. Pool Lifecycle

Each pool follows one irreversible state machine:

```text
Unregistered
  -> Registered
  -> Initialized
  -> InitialPositionAdded
  -> LaunchBuyExecuted
  -> Finalized
```

### 4.1 Registration

The launcher registers:

- the complete canonical `PoolKey`;
- the recomputed `PoolId`;
- the factory-authenticated growth vault;
- the immutable Programmable treasury;
- the canonical PositionManager;
- the expected initial range;
- the fixed 1.00% fee policy.

The hook validates the growth vault against `LiquidityGrowthFullRangeVaultFactoryV3`. No owner, allowlist setter, or later vault replacement exists.

### 4.2 Initialization and initial liquidity

The hook permits exactly one bootstrap liquidity addition:

- caller visible to the hook is the canonical PositionManager;
- liquidity delta is positive;
- range equals `[minUsableTick, INITIAL_TICK]`;
- pool matches the registered `PoolId`;
- pool state is `Initialized`;
- the launch transaction supplies the committed bootstrap tag.

The launch is one transaction, so no external transaction can enter between initialization and the initial mint. The successful addition seals the bootstrap path permanently.

The complete token supply is assigned to the initial one-sided plan. Any integer-rounding dust left by that plan is
sent directly to the growth vault, recorded separately as initial locked token dust, and may only be used by a later
compound. There is no discretionary Deep token reserve.

The initial NFT is held by an immutable maximum-timelock recipient with no operator. Its immutable fee recipient is the growth vault rather than a human recipient. The hook rejects donations and all negative or zero-liquidity collection paths, so neither donated tokens nor position fees can be forwarded to a creator.

### 4.3 Initial buy and oracle baseline

Before finalization, only the registered launcher may execute the required exact-input ETH to token launch buy. The transaction commits:

- a nonzero ETH amount meeting the existing `0.0006 ETH` minimum;
- a nonzero minimum token output;
- a non-extreme square-root price limit;
- a deadline.

The initial buy pays the ordinary 1.00% hook fee.

Oracle history does not start from the pre-buy initialization tick. After the initial buy and custody checks succeed, the launcher calls `finalizePool`. Finalization reads the post-buy tick, initializes the observation history at that tick, seals the launch path, and enables ordinary swaps. If finalization fails, the complete launch reverts.

## 5. Hook Permission Policy

The new hook is mined and deployed with these permissions:

| Permission | Policy |
| --- | --- |
| `beforeInitialize` | Registered launcher only |
| `afterInitialize` | Advance lifecycle; do not establish the final oracle baseline |
| `beforeAddLiquidity` | One canonical bootstrap addition, then exact growth-vault full-range additions only |
| `beforeRemoveLiquidity` | Always revert |
| `beforeSwap` | Charge ordinary native fee or authenticate one internal compound swap; write observations after finalization |
| `afterSwap` | Complete ordinary native fee accounting or close the internal exemption |
| `beforeDonate` | Always revert |
| `beforeSwapReturnDelta` | Enabled for native fee collection |
| `afterSwapReturnDelta` | Enabled for native fee collection |

No other liquidity or donation permission is enabled.

After launch, a positive liquidity addition is accepted only when:

- `sender` is the growth vault registered for the same `PoolId`;
- the range is the fixed full range;
- the salt is the fixed Deep growth salt;
- the liquidity delta is positive;
- an authenticated compound intent is active.

This prevents external and just-in-time positions from changing the trusted topology or receiving any benefit from the predictable internal swap. Traders remain permissionless.

## 6. Exact External Fee Accounting

The fixed constants are:

```text
BASIS_POINTS = 10,000
TOTAL_HOOK_FEE_BPS = 100
PROGRAMMABLE_FEE_BPS = 10
GROWTH_FEE_BPS = 90
LP_FEE_PIPS = 0
```

Every ordinary buy and sell charges the Programmable hook fee on the native side. Token hook deltas and token fee event fields are always zero.

For a gross native amount `G`:

```text
totalFee = floor(G * 100 / 10,000)
programmableFee = floor(G * 10 / 10,000)
growthFee = totalFee - programmableFee
```

For an exact-output native amount `N`:

```text
gross = ceil(N * 10,000 / 9,900)
totalFee = gross - N
programmableFee = floor(gross * 10 / 10,000)
growthFee = totalFee - programmableFee
```

Assigning the final division remainder to growth preserves exact wei conservation.

The four required swap quadrants are:

| Trade | Specified side | Fee stage |
| --- | --- | --- |
| Exact-input buy | Gross ETH input | `beforeSwap` |
| Exact-output buy | Token output, native input derived | `afterSwap` |
| Exact-input sell | Token input, native output derived | `afterSwap` |
| Exact-output sell | Net ETH output | `beforeSwap` |

All four modes must prove:

```text
growthFee + programmableFee = totalFee
hookTokenFee = 0
creatorAccrual = 0
```

The hook exposes `claimGrowthFees(poolId)`, callable only by that pool's immutable growth vault. The Programmable treasury alone may claim accrued Programmable fees, and it may not redirect the claim to another address.

## 7. Internal Fee Exemption

The exemption is authority-bound, not flag-bound.

An internal swap is exempt only if every condition holds:

1. `PoolId(key)` equals the registered pool.
2. `sender` equals that pool's factory-authenticated growth vault.
3. Direction is native `currency0` to launched token `currency1`.
4. Mode is exact-input.
5. Hook data contains the fixed compound domain tag and the current intent digest.
6. The digest commits to chain ID, hook, vault, PoolId, exact input, square-root price limit, and compound nonce.
7. The registered vault called `armCompound` with that exact digest before entering `PoolManager.unlock`.
8. No other internal exemption is active for that pool.

The transient hook lifecycle is:

```text
Empty
  -> Armed       by armCompound, registered vault only
  -> InSwap      by beforeSwap
  -> Swapped     by afterSwap
  -> Added       by beforeAddLiquidity
  -> Empty       by closeCompound, same registered vault only
```

`beforeSwap` requires the armed digest. `afterSwap` requires the same digest and returns zero fee deltas.
`beforeAddLiquidity` requires the `Swapped` state before allowing the vault's positive full-range addition.
After `PoolManager.unlock` returns, `closeCompound` requires `Added` and clears the transient state. Oracle
observation writing remains active. Hook data is a domain and integrity input only; it never grants authority.

A wrong pool, vault, direction, mode, router, clone, tag, digest, or replay receives no exemption and reverts. An exempt internal swap leaves growth, Programmable, and total hook fee counters unchanged.

## 8. Compound Eligibility

The fixed initial execution policy is:

```text
COMPOUND_COOLDOWN = 5 minutes
TWAP_WINDOW = 30 minutes
SHORT_TWAP_WINDOW = 5 minutes
ROLLING_EXPOSURE_WINDOW = 30 minutes
ROLLING_RECORD_CAPACITY = 8
MIN_COMPOUND_NATIVE = 0.002 ETH
MAX_COMPOUND_NATIVE = 0.25 ETH
TRUSTED_DEPTH_CYCLE_CAP_BPS = 25
MIN_OBSERVATION_CARDINALITY_NEXT = 192
MAX_ABS_OBSERVATION_TICK_DELTA = 400
MAX_RAW_TRUNCATED_TWAP_DELTA = 25 ticks
MAX_PRE_SPOT_TWAP_DEVIATION = 100 ticks
MAX_SHORT_LONG_TWAP_DEVIATION = 50 ticks
MAX_INTERNAL_SWAP_IMPACT = 25 ticks
MAX_POST_SPOT_TWAP_DEVIATION = 125 ticks
```

A vault is eligible only when:

- at least 300 seconds passed since its last successful compound;
- a complete 30-minute history exists;
- observation capacity is at least 192;
- raw and truncated 30-minute TWAPs differ by at most 25 ticks;
- the 5-minute and 30-minute TWAPs differ by at most 50 ticks;
- pre-swap spot differs from the 30-minute TWAP by at most 100 ticks;
- accounted pending growth ETH is at least `0.002 ETH`;
- a nonzero rolling exposure capacity remains;
- the exact optimizer finds a fully fillable nonzero internal buy;
- all contract runtime, pool, position, and binding checks agree.

The cycle budget is:

```text
budget = min(
  accountedPendingGrowthETH,
  0.25 ETH,
  remainingRollingExposureCapacity
)
```

The rolling capacity is 25 basis points of permanent, factory-proven active native virtual depth, anchored when the first still-active record is written. External balances, forced transfers, and arbitrary pool liquidity never increase the budget.

Exposure records the complete native economic action:

```text
cycleExposure = internalSwapETH + nativeETHAddedToLiquidity
```

It does not record only the liquidity leg.

## 9. Exact One-Sided Optimizer

### 9.1 Objective

Given:

- canonical pool state;
- an accounted native budget `B`;
- accounted token dust from prior successful cycles;
- the strict price limit;
- the current zero-for-one Uniswap protocol fee;

the optimizer selects the exact-input native amount `x` that produces the maximum full-range liquidity which can be added atomically without exceeding `B` or the price limit.

The keeper supplies no amount, pool, route, recipient, range, price, or quote.

### 9.2 Known liquidity topology

The hook permits only:

1. the initial locked range `[minUsableTick, INITIAL_TICK]`; and
2. the vault's full-range position `[minUsableTick, maxUsableTick]`.

An internal zero-for-one buy can therefore cross at most the known `INITIAL_TICK` boundary before the immutable price limit. The planner validates the onchain tick bitmap and liquidity net against this topology. Any unexpected initialized tick or liquidity discrepancy makes the vault ineligible.

### 9.3 Simulation

For each candidate `x`, the stateless planner reproduces the pinned v4 swap math using:

- current square-root price and active liquidity;
- the one permitted initialized boundary;
- exact `SwapMath.computeSwapStep` rounding;
- the current zero-for-one Uniswap protocol fee;
- zero Programmable hook fee for the authenticated internal swap;
- the strict square-root price limit.

It returns:

```text
swapNativeIn = x
tokenOut = y
postSwapSqrtPrice = P
fullFill
```

At `P`, the planner computes:

```text
availableToken = accountedTokenDust + y
liquidity = LiquidityAmounts.getLiquidityForAmount1(fullRangeLower, P, availableToken)
nativeForLiquidity = amount0 required by that liquidity at P
tokenForLiquidity = amount1 required by that liquidity at P
nativeCost = x + nativeForLiquidity
```

A candidate is feasible only if:

```text
x > 0
fullFill = true
P >= sqrtPriceLimit
liquidity > 0
tokenForLiquidity <= availableToken
nativeCost <= B
```

Feasibility is monotonic. The planner binary-searches the greatest feasible `x` within at most 64 iterations and compares adjacent wei candidates for rounding. The production result must satisfy:

```text
cost(x) <= B
cost(x + 1) > B
```

unless the immutable price limit is the binding constraint.

The planner is a separate stateless contract so the vault remains below the EIP-170 runtime limit.

### 9.4 Price limit and TWAP floor

For native to token, the square-root price moves downward. The execution limit tick is:

```text
limitTick = max(
  spotTick - 25,
  longTwapTick - 125,
  minUsableTick + 1
)
```

The limit must be strictly below the starting price and above Uniswap's minimum square-root price.

The selected output must also meet a minimum token output derived from the 30-minute TWAP, the 125-tick maximum adverse boundary, and the current Uniswap protocol fee. The current spot alone never defines acceptable output.

After the real swap, the vault requires:

```text
actualNativeIn = simulatedNativeIn
actualTokenOut = simulatedTokenOut
actualPostSqrtPrice = simulatedPostSqrtPrice
postSpotLongTwapDeviation <= 125 ticks
ownSwapImpact <= 25 ticks
```

A price-limit partial fill reverts the complete compound. Reaching the limit exactly is accepted only when the complete selected exact input was consumed.

## 10. Atomic Swap and Liquidity Addition

The outer vault call:

1. Claims growth fees directly from the hook.
2. Verifies the exact ETH receipt and updates temporary accounted pending value.
3. Revalidates cooldown, oracle, topology, depth, and exposure.
4. Obtains the exact onchain planner result.
5. Calls the hook's vault-only `armCompound` with the exact compound digest.
6. Calls `PoolManager.unlock` once.

Inside the PoolManager-authenticated callback:

1. Recompute `_poolKey.toId()` and require the stored `PoolId`.
2. Revalidate the planner inputs against current state.
3. Execute the exact-input native to token swap on the stored key.
4. Validate signs, complete input consumption, exact output, post-price, TWAP floor, and the `Swapped` intent state.
5. Compute the maximum full-range liquidity from actual token output, accounted token dust, and remaining native budget.
6. Call `modifyLiquidity` on the same key, full range, positive delta, and fixed salt.
7. Separate principal deltas from `feesAccrued`; donation-inflated fee fields are never treated as principal.
8. Settle negative native and token deltas and take only residual token credit back to the vault.
9. Require the PoolManager currency deltas to finish at zero.

The internal operation never touches Universal Router or PositionManager. The v4 flash-accounting credit from the swap is netted directly against the token debt of the liquidity addition.

After `unlock` returns, the vault calls the hook's vault-only `closeCompound`, which requires the `Added` state.
Only after that closure and every postcondition pass does the vault record:

- claimed growth ETH;
- native ETH swapped;
- token acquired;
- native ETH added;
- token added;
- liquidity added;
- accounted native dust;
- accounted token dust;
- rolling exposure;
- successful compound nonce;
- last successful compound timestamp.

Any failure reverts the fee claim and every later step.

## 11. Dust and Conservation

Only values created by authenticated hook claims and successful compounds enter protocol accounting. Forced ETH or token transfers are excluded and can never be rescued.

For each successful cycle:

```text
budget = swapNativeIn + nativeAdded + nativeDust
availableToken = tokenAdded + tokenDust
```

For every ordinary fee:

```text
grossNativeFee = growthFee + programmableFee
```

For the lifetime of a vault:

```text
totalGrowthETHReceived
  = totalNativeSwapped
  + totalNativeAdded
  + accountedPendingNative

totalTokenAcquired
  + accountedProtocolTokenReceipts
  = totalTokenAdded
  + accountedTokenDust
```

The token dust rule is:

```text
LiquidityAmounts.getLiquidityForAmount1(current full range, tokenDust) = 0
```

unless the immutable price limit is binding. Native dust remains pending for the next eligible slot. Token dust remains trapped in the vault and is included in the next optimizer run. No dust is paid to a user or keeper.

## 12. Permanent Liquidity and No Escape

The growth position key is:

```text
(PoolId, growthVault, fullRangeLower, fullRangeUpper, fixedGrowthSalt)
```

The vault exposes no method that can submit a negative liquidity delta. The hook independently rejects every negative or zero liquidity delta for the pool. There is no:

- owner;
- administrator;
- proxy;
- beacon;
- upgrade;
- delegatecall;
- arbitrary external call;
- rescue;
- sweep;
- withdrawal;
- beneficiary;
- payout address;
- creator claim;
- token recipient;
- selfdestruct path.

Position liquidity must be monotonically non-decreasing for the lifetime of the pool.

## 13. Keeper Semantics

The onchain surface remains permissionless. The official keeper is an operational convenience, not an authority.

`AutomationV3` exposes:

- bounded registry scanning;
- exact-vault assessment;
- failure-isolated batch assessment;
- one atomic `Compound` action;
- oracle capacity staging.

There is no two-transaction `ProcessFees` then `CompoundPending` workflow. A successful action claims fees, swaps, and adds liquidity atomically.

The official keeper:

1. Uses deterministic five-minute slots with scheduling jitter.
2. Reconciles pending and replaced receipts before retrying.
3. Requires two independent HTTPS RPC providers to agree on chain, finalized block, runtimes, immutable topology, and current work.
4. Re-simulates the exact action and gas immediately before signing.
5. Uses a lease and fencing token so two workers cannot submit the same slot.
6. Prefers protected or private submission but remains safe in the public mempool.
7. Records a slot complete only after a confirmed success or a confirmed common-block no-action result.
8. Does not consume eligibility after simulation failure, RPC disagreement, revert, dropped transaction, replacement, or reorg.
9. Skips high-gas or unsafe slots and alerts; it never weakens limits, changes pools, or enlarges the next order.

Keeper gas is paid by the executor. Growth ETH is never reserved for gas.

## 14. Minimal App and Indexer Binding

Only the minimum Deep binding is part of this task. Unrelated design work remains untouched.

New versioned app modules bind:

- exact release manifest and runtime hashes;
- launch event and PoolId provenance;
- Deep trade PoolKey;
- growth-vault state;
- keeper readiness;
- compound events;
- release eligibility.

The public model name is `Deep`, not `V3`.

The launch disclosure is:

> A fixed 1.00% swap fee is collected in ETH. 0.90% is used to buy this token and add permanent liquidity to its original Uniswap v4 pool. 0.10% goes to Programmable.

The Deep profile exposes:

- growth ETH received;
- pending growth ETH;
- ETH swapped;
- tokens acquired;
- ETH and tokens added;
- permanently added liquidity;
- last successful compound;
- next eligible time;
- oracle and safety readiness.

It exposes no claim or payout action.

The indexer accepts a Deep launch only when token, launcher, hook, vault, PoolKey, PoolId, position, oracle, and release manifest provenance all agree. Internal exempt swaps are labeled as compounds and excluded from user fee revenue.

The app remains fail-closed until a release manifest is genuinely eligible.

## 15. Threat Controls

| Threat | Required control |
| --- | --- |
| Recursive fee on internal buy | Exact pool and vault sender binding, exact direction and mode, transient intent, zero fee deltas |
| Wrong-pool routing | Stored PoolKey, recomputed PoolId before and inside unlock, no caller pool input |
| Sandwich or cadence MEV | TWAP-relative output floor, strict square-root limit, per-cycle impact cap, rolling exposure, keeper jitter, protected submission |
| Slow TWAP manipulation | Mature full-window history, raw/truncated comparison, short/long comparison, pre-spot and post-spot limits |
| JIT liquidity | Hook rejects every non-canonical liquidity addition; trusted depth uses permanent positions only |
| Liquidity removal | Hook rejects negative and zero deltas; vault has no removal call |
| Donation and token-fee leakage | Hook rejects donations; initial fee recipient is growth vault; no human token recipient |
| Exemption spoofing | PoolManager sender identity plus factory vault provenance; hook data is not authority |
| Partial fill | Exact simulated input, output, and post-price required; otherwise atomic revert |
| Keeper race | Onchain cooldown and nonce plus offchain lease, fencing, revalidation, and receipt reconciliation |
| Forced ETH or tokens | Excluded from accounted balances; no rescue path |
| Unexpected pool topology | Tick bitmap and liquidity net must match the two permitted position shapes |
| Protocol fee drift | Read actual directional protocol fee in planner and fork tests; disclose separately |
| Runtime size | Planner separated; `forge build --sizes` is an early hard gate |

## 16. Test-Driven Implementation Gate

Implementation starts with failing tests in these independent lanes.

### 16.1 Hook and fee tests

- Exact-input buy.
- Exact-output buy.
- Exact-input sell.
- Exact-output sell.
- Tiny amounts and wei rounding boundaries.
- Growth plus Programmable equals total fee.
- Token fee delta always zero.
- No creator or beneficiary state.
- Sole bound-vault exemption.
- Wrong vault, pool, router, clone, direction, mode, tag, digest, and replay.
- Internal swap leaves all fee counters unchanged.
- Oracle observation remains active.
- Bootstrap, add, remove, zero-delta, and donate permission matrix.

### 16.2 Optimizer tests

- Exhaustive integer reference search over bounded small domains.
- Differential single-segment closed-form reference.
- Exact v4 rounding.
- Current protocol fee zero and maximum supported directional fee.
- Below, at, and across the single permitted initialized tick.
- Adjacent-wei optimality.
- Exact price-limit hit and partial fill.
- Existing accounted token dust.
- Unexpected bitmap or liquidity net.
- Bound reason and deterministic dust.

### 16.3 Vault and adversarial tests

- One unlock containing swap then positive `modifyLiquidity`.
- Same PoolId for launch, swap, and add.
- Zero terminal PoolManager deltas.
- Claim, swap, add, and accounting revert together on every failure.
- Cooldown exact boundary.
- Whole-cycle rolling exposure.
- TWAP maturity and all deviation boundaries.
- One-block, held, and pre-keeper manipulation.
- Public mempool sandwich and backrun bounds.
- Two keepers racing.
- Reentrancy and callback spoofing.
- Forced ETH and token transfers.
- No admin, rescue, removal, beneficiary, payout, token recipient, delegatecall, or selfdestruct surface.
- Monotonic liquidity.

### 16.4 Stateful invariants

- All Programmable hook fees are accounted in native ETH.
- Internal compounds create zero new Programmable hook fees.
- Accounted ETH and token conservation always holds.
- Every operation uses the original PoolId.
- Liquidity never decreases.
- Cooldown and exposure never exceed policy.
- Failed work changes no persistent accounting.
- No token reaches Programmable, a creator, keeper, or fee recipient.
- Successful-action counters prove the invariant harness is not vacuously all-reverting.

### 16.5 Mainnet fork

The pinned fork must use official Mainnet PoolManager, PositionManager, and token factory runtimes and prove:

- mined hook address permission bits;
- complete launch provenance;
- all four ordinary fee modes;
- the authenticated internal exemption;
- a real mature 30-minute history;
- one atomic swap and liquidity addition;
- actual Mainnet protocol-fee behavior;
- exact settlement;
- monotonic permanent liquidity;
- actionable, idle, unsafe, and failure-isolated keeper paths.

A second safe-head dry run must compare two independent RPC providers. Fork success is compatibility evidence only.

## 17. Build, Security, and Release Gates

### 17.1 Local gates

Run:

```sh
cd contracts
forge fmt --check
forge build --sizes
FOUNDRY_PROFILE=ci forge test
forge snapshot --match-contract '.*Deep.*|.*LiquidityGrowth.*' --snap .gas-snapshot-deep-eth
```

Hard limits:

- deployed runtime below 24,576 bytes;
- initcode below 49,152 bytes;
- one compound below 80% of its keeper gas limit;
- worst configured batch below its keeper ceiling;
- no unexplained ordinary-swap storage or gas regression.

The current V2 vault is already close to the EIP-170 runtime ceiling, so optimizer logic may not be added to it in place.

### 17.2 Security gates

- Slither on the exact release source.
- Security diff against V1 and the preserved V2 candidate.
- High-run fuzz and invariants under the CI profile.
- An independent second review of return-delta fee accounting, PoolManager settlement, optimizer math, hook
  permissions, oracle policy, and permanent custody. This may be performed within the project; a paid external audit
  is not assumed by this plan.
- Mainnet eligibility remains blocked until that second review is resolved.

### 17.3 Release artifacts

The V2 manifest remains unchanged and ineligible. V3 receives its own:

- deployment script;
- release manifest and JSON schema;
- source commitment;
- hook salt and permission proof;
- creation and runtime hashes;
- optimizer and policy commitment;
- dual-RPC simulation and receipt capture;
- Etherscan and Sourcify verification records;
- keeper binding and promotion script;
- indexer binding;
- Mainnet fork and canary evidence.

Every new contract requires:

- a clean 40-character release commit;
- successful receipt with sender, nonce, constructor input, and created address;
- twelve confirmations;
- runtime agreement across two RPCs;
- exact compiler and dependency settings;
- exact Etherscan and Sourcify match;
- empty proxy, admin, and beacon slots;
- no owner, upgrade, rescue, delegatecall, or selfdestruct path.

The Hooklist and routing packet may be prepared locally, but external submission, Mainnet deployment, and any fund movement require separate explicit approval.

## 18. Implementation Sequence

After owner approval of this design:

1. Write the executable implementation plan against the dirty shared tree.
2. Create a scoped Deep checkpoint containing the preserved V2 candidate before parallel contract edits.
3. Implement the new hook lifecycle, permission policy, four-mode fees, and exemption with tests.
4. Implement the exact stateless optimizer with independent reference tests.
5. Implement the vault's atomic swap and add with conservation and adversarial tests.
6. Implement launcher, factories, automation, and keeper executor.
7. Integrate the complete contract stack and run size, gas, fuzz, invariant, Slither, and fork gates.
8. Add the isolated V3 release, keeper, indexer, and minimum app binding.
9. Prepare but do not execute source-verification and external submission packets.
10. Stop before Mainnet deployment, spending, or external publication and request explicit approval.

No Mainnet deployment, transaction, external submission, or fund movement is authorized by this design approval.
