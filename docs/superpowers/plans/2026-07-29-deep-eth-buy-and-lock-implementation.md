# Deep ETH Buy and Lock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Deep launch model so a user can launch a fixed-supply Ethereum token whose fixed native swap fee continuously buys that token and adds permanent liquidity to its original Uniswap v4 pool.

**Architecture:** Deep uses a new internal V3 release line and leaves deployed V1 plus the undeployed V2 candidate unchanged. A new hook binds one factory-authenticated growth vault to one PoolId, charges all ordinary trades in native ETH, and permits only the launch position plus the vault's permanent full-range position. The vault uses one direct `PoolManager.unlock` to execute an onchain-optimized ETH-to-token swap and same-pool liquidity addition atomically.

**Tech Stack:** Solidity 0.8.26, Foundry, Uniswap v4 core and periphery, OpenZeppelin hooks and transient storage, Uniswap Liquidity Launcher, TypeScript 5.9, viem, Vitest, Next.js 16, Vercel cron and Blob.

## Global Constraints

- Ordinary hook fee is fixed at 100 basis points: 10 basis points to Programmable and the exact remainder to growth.
- Hook token fee deltas are always zero; no creator, beneficiary, payout, rescue, withdrawal, admin, upgrade, delegatecall, selfdestruct, or negative-liquidity path may exist.
- Internal compounding is exact-input native ETH to launched token in the original stored PoolId, followed by a positive full-range liquidity addition in the same PoolManager unlock.
- Internal compounding is exempt only for the factory-authenticated growth vault, exact PoolId, exact direction, exact mode, and transient compound digest.
- Cooldown is 300 seconds; long TWAP is 1,800 seconds; short TWAP is 300 seconds; rolling exposure is 1,800 seconds with eight records.
- Minimum compound is `0.002 ether`; maximum cycle budget is `0.25 ether`; cycle exposure cap is 25 basis points of anchored permanent native virtual depth.
- Oracle thresholds are 25 ticks raw-versus-truncated, 50 ticks short-versus-long, 100 ticks pre-spot-versus-long, 25 ticks own impact, and 125 ticks post-spot-versus-long.
- Observation cardinality target is 192; per-observation truncation remains 400 ticks.
- Public product copy says `Deep`; `V3` appears only in internal source, manifest, keeper, and release identifiers.
- Preserve all unrelated dirty UI and app work. Stage and commit only files explicitly owned by the current task.
- Do not deploy Mainnet, sign a transaction, spend funds, submit an external listing, or activate production without a later explicit approval.

---

## File Map

### Contract core

- Create `contracts/src/interfaces/ILiquidityGrowthFeeOracleHookV2.sol`: the exact hook surface consumed by the vault, launcher, automation, and app ABI.
- Create `contracts/src/LiquidityGrowthFullRangePolicyV3.sol`: fixed constants and pure policy validation.
- Create `contracts/src/libraries/LiquidityGrowthSwapMathV3.sol`: exact one-boundary zero-for-one swap simulation and optimality helpers.
- Create `contracts/src/LiquidityGrowthZapPlannerV3.sol`: stateless oracle quote, topology validation, binary search, and compound plan.
- Create `contracts/src/LiquidityGrowthFeeOracleHookV2.sol`: pool lifecycle, four-mode native fees, oracle, permissions, and transient exemption.
- Create `contracts/src/LiquidityGrowthFeeOracleHookFactoryV2.sol`: CREATE2 hook deployment and provenance.
- Create `contracts/src/LiquidityGrowthFullRangeVaultV3.sol`: direct claims and atomic swap/add custody.
- Create `contracts/src/LiquidityGrowthFullRangeVaultFactoryV3.sol`: deterministic clones and initialization commitments.
- Create `contracts/src/LiquidityGrowthFullRangePositionPlannerV3.sol`: complete-supply initial plan.
- Create `contracts/src/LiquidityGrowthFullRangeLaunchV3.sol`: launch transaction and post-buy oracle baseline.
- Create `contracts/src/LiquidityGrowthFullRangeAutomationV3.sol`: registry, readiness, and atomic work execution.
- Create `contracts/src/DeepKeeperExecutorV2.sol`: reviewed automation execution boundary.

### Contract tests and release

- Create `contracts/test/utils/LiquidityGrowthFullRangeV3Fixture.sol`.
- Create `contracts/test/LiquidityGrowthFullRangeV3FeeAccounting.t.sol`.
- Create `contracts/test/LiquidityGrowthFeeOracleHookV2Permissions.t.sol`.
- Create `contracts/test/LiquidityGrowthZapPlannerV3.t.sol`.
- Create `contracts/test/LiquidityGrowthFullRangeV3.t.sol`.
- Create `contracts/test/LiquidityGrowthFullRangeV3Adversarial.t.sol`.
- Create `contracts/test/LiquidityGrowthFullRangeV3Security.t.sol`.
- Create `contracts/test/invariant/LiquidityGrowthFullRangeV3StatefulInvariant.t.sol`.
- Create `contracts/test/LiquidityGrowthFullRangeV3MainnetFork.t.sol`.
- Create `contracts/test/DeployMainnetDeepFullRangeInfrastructureV3.t.sol`.
- Create `contracts/test/DeployMainnetDeepFullRangeInfrastructureV3Security.t.sol`.
- Create `contracts/script/DeployMainnetDeepFullRangeInfrastructureV3.s.sol`.
- Create `contracts/deployments/mainnet-deep-full-range-v3.json`.
- Create `contracts/deployments/schema/deep-full-range-release-v3.schema.json`.
- Create `contracts/release/DEEP-FULL-RANGE-V3.md`.
- Create `contracts/scripts/deep-full-range-release-v3-core.mjs`.
- Create `contracts/scripts/verify-deep-full-range-release-v3-manifest.mjs`.
- Create `contracts/scripts/capture-deep-full-range-v3-release.mjs`.
- Create `contracts/scripts/simulate-deep-full-range-v3-mainnet.mjs`.
- Create `contracts/scripts/promote-deep-v3-reviewed-keeper-binding.mjs`.

### Keeper and minimum app binding

- Create `ops/deep-keeper-v3/config.mjs`, `core.mjs`, `core.d.mts`, `lease.mjs`, `release-gate.mjs`, `release-gate.d.mts`, `state-store.mjs`, and `README.md`.
- Create `app/api/ops/deep-v3-keeper/handler.ts` and `route.ts`.
- Create `lib/deep-v3.ts`, `deep-v3-release-binding.ts`, and `deep-v3-runtime-binding.ts`.
- Create `lib/trade/deep-v3.ts`.
- Create `lib/onchain/deep-v3-read-model.ts`.
- Create `lib/profile/deep-v3-profile.server.ts`.
- Modify only the release-selection branches in `lib/deep-launch-validation.ts`, `lib/launch-model-gating.ts`, `lib/onchain/indexer-feed.ts`, `lib/trade/server.ts`, and the Deep launch API.
- Modify `package.json` and `vercel.json` only for V3 verification commands and the disabled V3 keeper route.
- Create focused `tests/deep-v3-*.test.ts` files for every new binding and route.

---

### Task 1: Freeze Interfaces and Fixed Policy

**Files:**
- Create: `contracts/src/interfaces/ILiquidityGrowthFeeOracleHookV2.sol`
- Create: `contracts/src/LiquidityGrowthFullRangePolicyV3.sol`
- Test: `contracts/test/LiquidityGrowthFullRangeV3Policy.t.sol`

**Interfaces:**
- Produces:
  - `ILiquidityGrowthFeeOracleHookV2.PoolFeeConfig`
  - `claimGrowthFees(bytes32 poolId) returns (uint256)`
  - `armCompound(bytes32 poolId, bytes32 digest)`
  - `closeCompound(bytes32 poolId, bytes32 digest)`
  - `observe(uint32[] secondsAgos, PoolId poolId)`
  - `poolFeeConfig(bytes32 poolId)`
  - all fixed constants consumed by later contracts.

- [ ] **Step 1: Write the failing fixed-policy tests**

```solidity
function test_fixedPolicyMatchesApprovedDeepEconomics() public pure {
    assertEq(Policy.TOTAL_HOOK_FEE_BPS, 100);
    assertEq(Policy.PROGRAMMABLE_FEE_BPS, 10);
    assertEq(Policy.GROWTH_FEE_BPS, 90);
    assertEq(Policy.LP_FEE_PIPS, 0);
    assertEq(Policy.COMPOUND_COOLDOWN_SECONDS, 5 minutes);
    assertEq(Policy.TWAP_WINDOW, 30 minutes);
    assertEq(Policy.SHORT_TWAP_WINDOW, 5 minutes);
    assertEq(Policy.MIN_COMPOUND_NATIVE, 0.002 ether);
    assertEq(Policy.MAX_COMPOUND_NATIVE, 0.25 ether);
    assertEq(Policy.TRUSTED_DEPTH_CYCLE_CAP_BPS, 25);
}

function test_fixedPolicyValidatesTickRelationships() public pure {
    Policy.validateFixedPolicy();
    assertEq(Policy.FULL_RANGE_TICK_LOWER, TickMath.minUsableTick(Policy.TICK_SPACING));
    assertEq(Policy.FULL_RANGE_TICK_UPPER, TickMath.maxUsableTick(Policy.TICK_SPACING));
    assertEq(
        Policy.MAX_PRE_SPOT_TWAP_DEVIATION_TICKS + Policy.MAX_INTERNAL_SWAP_IMPACT_TICKS,
        Policy.MAX_POST_SPOT_TWAP_DEVIATION_TICKS
    );
}
```

- [ ] **Step 2: Run the policy test and confirm red**

Run:

```sh
cd contracts
forge test --match-path test/LiquidityGrowthFullRangeV3Policy.t.sol -vv
```

Expected: compilation fails because `LiquidityGrowthFullRangePolicyV3` does not exist.

- [ ] **Step 3: Add the exact interface and constants**

The interface must declare this pool record:

```solidity
struct PoolFeeConfig {
    address growthVault;
    address registrar;
    uint8 lifecycle;
    uint256 growthFeesAccrued;
}
```

The policy must define the global constants verbatim and expose:

```solidity
function validateFixedPolicy() internal pure {
    assert(TOTAL_HOOK_FEE_BPS == PROGRAMMABLE_FEE_BPS + GROWTH_FEE_BPS);
    assert(MAX_PRE_SPOT_TWAP_DEVIATION_TICKS + MAX_INTERNAL_SWAP_IMPACT_TICKS
        == MAX_POST_SPOT_TWAP_DEVIATION_TICKS);
    assert(ROLLING_EXPOSURE_RECORD_CAPACITY
        >= ROLLING_EXPOSURE_WINDOW_SECONDS / COMPOUND_COOLDOWN_SECONDS + 2);
    assert(FULL_RANGE_TICK_LOWER == TickMath.minUsableTick(TICK_SPACING));
    assert(FULL_RANGE_TICK_UPPER == TickMath.maxUsableTick(TICK_SPACING));
}
```

- [ ] **Step 4: Run the focused test**

Run:

```sh
cd contracts
forge fmt
forge test --match-path test/LiquidityGrowthFullRangeV3Policy.t.sol -vv
```

Expected: all policy tests pass.

- [ ] **Step 5: Commit only the policy lane**

```sh
git add contracts/src/interfaces/ILiquidityGrowthFeeOracleHookV2.sol \
  contracts/src/LiquidityGrowthFullRangePolicyV3.sol \
  contracts/test/LiquidityGrowthFullRangeV3Policy.t.sol
git commit -m "Add fixed Deep V3 policy"
```

---

### Task 2: Implement Four-Mode Native Fee Accounting

**Files:**
- Create: `contracts/src/LiquidityGrowthFeeOracleHookV2.sol`
- Create: `contracts/test/LiquidityGrowthFullRangeV3FeeAccounting.t.sol`
- Reuse fixture logic from: `contracts/test/LiquidityGrowthFullRangeV2FeeAccounting.t.sol`

**Interfaces:**
- Consumes: Policy constants and `ILiquidityGrowthFeeOracleHookV2`.
- Produces:
  - `quoteGrossFees(uint256 gross) returns (uint256 growthFee, uint256 programmableFee)`
  - `quoteExactOutputFees(uint256 net) returns (uint256 growthFee, uint256 programmableFee)`
  - ordinary `beforeSwap` and `afterSwap` native return-delta behavior.

- [ ] **Step 1: Port four tests as red V3 specifications**

Each test must execute a real PoolManager swap and assert:

```solidity
assertEq(growthFee + programmableFee, totalFee);
assertEq(programmableFee, grossNative * 10 / 10_000);
assertEq(growthFee, totalFee - programmableFee);
assertEq(hookTokenDelta, 0);
assertEq(hook.totalNativeFeesAccrued(), growthFee + programmableFee);
```

Exact-output native math must use:

```solidity
uint256 gross = FullMath.mulDivRoundingUp(netNative, 10_000, 9_900);
uint256 totalFee = gross - netNative;
```

Add fuzz bounds:

```solidity
grossNative = bound(grossNative, 1, type(uint128).max);
netNative = bound(netNative, 1, type(uint128).max / 2);
```

- [ ] **Step 2: Run the fee tests and confirm red**

Run:

```sh
cd contracts
forge test --match-path test/LiquidityGrowthFullRangeV3FeeAccounting.t.sol -vv
```

Expected: compilation fails because the V2 hook interface does not provide the V3 fixed-growth semantics.

- [ ] **Step 3: Port only the proven V1 native fee algorithm**

Implement:

```solidity
function _feesForGross(uint256 grossNative)
    private pure returns (uint256 growthFee, uint256 programmableFee)
{
    uint256 totalFee = FullMath.mulDiv(grossNative, 100, 10_000);
    programmableFee = FullMath.mulDiv(grossNative, 10, 10_000);
    if (programmableFee > totalFee) programmableFee = totalFee;
    growthFee = totalFee - programmableFee;
}

function _feesForNet(uint256 netNative)
    private pure returns (uint256 growthFee, uint256 programmableFee)
{
    uint256 grossNative = FullMath.mulDivRoundingUp(netNative, 10_000, 9_900);
    uint256 totalFee = grossNative - netNative;
    programmableFee = FullMath.mulDiv(grossNative, 10, 10_000);
    if (programmableFee > totalFee) programmableFee = totalFee;
    growthFee = totalFee - programmableFee;
}
```

Use the V1 before/after split so every fee is charged in native currency and every token return delta remains zero. Rename creator fields and events to growth fields. Do not add beneficiary or payout state.

- [ ] **Step 4: Run deterministic and fuzz fee tests**

Run:

```sh
cd contracts
forge test --match-path test/LiquidityGrowthFullRangeV3FeeAccounting.t.sol -vv
FOUNDRY_PROFILE=ci forge test --match-path test/LiquidityGrowthFullRangeV3FeeAccounting.t.sol
```

Expected: all four modes and fuzz cases pass.

- [ ] **Step 5: Commit the fee lane**

```sh
git add contracts/src/LiquidityGrowthFeeOracleHookV2.sol \
  contracts/test/LiquidityGrowthFullRangeV3FeeAccounting.t.sol
git commit -m "Add Deep V3 native fee accounting"
```

---

### Task 3: Add Pool Lifecycle, Liquidity Permissions, and Exemption

**Files:**
- Modify: `contracts/src/LiquidityGrowthFeeOracleHookV2.sol`
- Create: `contracts/src/LiquidityGrowthFeeOracleHookFactoryV2.sol`
- Create: `contracts/test/LiquidityGrowthFeeOracleHookV2Permissions.t.sol`

**Interfaces:**
- Produces:
  - `registerPool(PoolKey key, address growthVault) returns (bytes32 poolId)`
  - `finalizePool(PoolKey key)`
  - `armCompound(bytes32 poolId, bytes32 digest)`
  - `closeCompound(bytes32 poolId, bytes32 digest)`
  - `compoundIntentState(bytes32 poolId) returns (uint8 state, bytes32 digest)`.

- [ ] **Step 1: Write the permission-matrix tests**

Required assertions:

```solidity
assertTrue(permissions.beforeInitialize);
assertTrue(permissions.afterInitialize);
assertTrue(permissions.beforeAddLiquidity);
assertTrue(permissions.beforeRemoveLiquidity);
assertTrue(permissions.beforeSwap);
assertTrue(permissions.afterSwap);
assertTrue(permissions.beforeDonate);
assertTrue(permissions.beforeSwapReturnDelta);
assertTrue(permissions.afterSwapReturnDelta);
```

Write failing tests for:

- one launcher bootstrap addition;
- second PositionManager addition reverts;
- arbitrary positive addition reverts;
- all zero and negative deltas revert;
- all donations revert;
- ordinary swaps are blocked before finalization;
- launcher initial buy is allowed before finalization;
- finalization initializes the oracle at the post-buy tick;
- only the exact growth vault can arm and close;
- exact vault, PoolId, direction, exact-input mode, tag, and digest are all required;
- internal swap changes no fee counter;
- `Armed -> InSwap -> Swapped -> Added -> Empty`;
- transient replay and nested arm revert.

- [ ] **Step 2: Run the permission tests and confirm red**

Run:

```sh
cd contracts
forge test --match-path test/LiquidityGrowthFeeOracleHookV2Permissions.t.sol -vv
```

Expected: tests fail because lifecycle and permission hooks are absent.

- [ ] **Step 3: Implement the transient lifecycle**

Use pool-derived transient slots:

```solidity
bytes32 private constant INTENT_NAMESPACE =
    keccak256("programmable.deep.v3.compound.intent");

function _intentBase(bytes32 poolId) private pure returns (bytes32) {
    return keccak256(abi.encode(INTENT_NAMESPACE, poolId));
}
```

Store state and digest in separate `TransientSlot` offsets. `armCompound` authenticates `msg.sender == config.growthVault`, requires `Empty`, then stores `Armed`. `beforeSwap`, `afterSwap`, and `beforeAddLiquidity` advance the exact state. `closeCompound` authenticates the same vault and digest, requires `Added`, and clears both slots.

- [ ] **Step 4: Implement pool and liquidity lifecycle**

The hook must:

- validate native `currency0`, nonzero token `currency1`, fee `0`, spacing `200`, and itself as hook;
- validate the growth vault with `VaultFactoryV3.configurationHashOf`;
- allow one bootstrap addition from canonical PositionManager in the registered initial range;
- allow later positive additions only from the bound vault, full range, fixed salt, and `Swapped` intent;
- reject every donation and nonpositive liquidity delta;
- initialize observations only in `finalizePool` at the post-buy tick;
- write normal and internal pre-swap observations after finalization.

- [ ] **Step 5: Add CREATE2 factory provenance tests**

Assert predicted equals deployed, hook address has the exact permission bits, configuration hash is nonzero, repeated deployment reverts, and an address with a wrong permission bitmap is rejected.

- [ ] **Step 6: Run the focused suite**

Run:

```sh
cd contracts
forge fmt
forge test --match-path test/LiquidityGrowthFeeOracleHookV2Permissions.t.sol -vv
forge build --sizes
```

Expected: permission tests pass and hook runtime is below 24,576 bytes.

- [ ] **Step 7: Commit the lifecycle lane**

```sh
git add contracts/src/LiquidityGrowthFeeOracleHookV2.sol \
  contracts/src/LiquidityGrowthFeeOracleHookFactoryV2.sol \
  contracts/test/LiquidityGrowthFeeOracleHookV2Permissions.t.sol
git commit -m "Bind Deep V3 pool lifecycle"
```

---

### Task 4: Build the Exact One-Sided Optimizer

**Files:**
- Create: `contracts/src/libraries/LiquidityGrowthSwapMathV3.sol`
- Create: `contracts/src/LiquidityGrowthZapPlannerV3.sol`
- Create: `contracts/test/LiquidityGrowthZapPlannerV3.t.sol`

**Interfaces:**
- Produces:

```solidity
struct OracleQuote {
    int24 longTwapTick;
    int24 shortTwapTick;
    int24 rawLongTwapTick;
    int24 spotTick;
    uint160 spotSqrtPriceX96;
    uint160 sqrtPriceLimitX96;
}

struct CompoundPlan {
    uint256 budgetNative;
    uint256 swapNative;
    uint256 expectedTokenOut;
    uint256 nativeForLiquidity;
    uint256 tokenForLiquidity;
    uint256 nativeDust;
    uint256 tokenDust;
    uint128 liquidity;
    uint160 postSwapSqrtPriceX96;
    int24 postSwapTick;
    uint24 protocolFeePips;
    bytes32 digest;
}

function plan(
    PoolKey calldata key,
    address vault,
    uint256 nonce,
    uint256 budgetNative,
    uint256 accountedTokenDust
) external view returns (OracleQuote memory, CompoundPlan memory);
```

- [ ] **Step 1: Write exhaustive and differential red tests**

The exhaustive reference iterates every candidate in small integer domains and chooses the feasible candidate with maximum liquidity. Assert:

```solidity
assertEq(plan.swapNative, reference.swapNative);
assertEq(plan.liquidity, reference.liquidity);
assertLe(plan.swapNative + plan.nativeForLiquidity, plan.budgetNative);
```

For one segment and zero protocol fee, compare against:

```text
R0 = activeLiquidity / currentSqrtPrice
x = sqrt(R0 * (R0 + budget)) - R0
```

within the exact integer-rounding neighbor.

Add cases for zero fee, maximum v4 directional protocol fee, below/at/across `INITIAL_TICK`, exact price-limit hit, one-wei boundaries, token dust, malformed bitmap, and unexpected liquidity net.

- [ ] **Step 2: Run the optimizer test and confirm red**

Run:

```sh
cd contracts
forge test --match-path test/LiquidityGrowthZapPlannerV3.t.sol -vv
```

Expected: compilation fails because the swap math and planner do not exist.

- [ ] **Step 3: Implement exact zero-for-one simulation**

Mirror the pinned `Pool.swap` behavior with `SwapMath.computeSwapStep`. Include:

- current active liquidity;
- zero-for-one protocol fee from `ProtocolFeeLibrary.getZeroForOneFee`;
- LP fee zero;
- the one permitted `INITIAL_TICK` crossing;
- exact `amountSpecifiedRemaining`, amount out, fee, tick, and liquidity updates;
- full-fill flag when the exact input is fully consumed.

Reject a tick bitmap containing any initialized tick other than full-range bounds and `INITIAL_TICK`.

- [ ] **Step 4: Implement oracle quote and strict limits**

Query `[1800, 300, 0]` from the hook and calculate raw and truncated means with negative-floor rounding. Enforce:

```solidity
abs(rawLong - truncatedLong) <= 25;
abs(shortTwap - truncatedLong) <= 50;
abs(spotTick - truncatedLong) <= 100;
limitTick = max(spotTick - 25, truncatedLong - 125, minUsableTick + 1);
```

Require cardinality-next at least 192 and a complete history.

- [ ] **Step 5: Implement bounded binary search**

Search at most 64 iterations over `[1, budgetNative]`. For each candidate:

1. simulate exact swap;
2. combine output with accounted token dust;
3. calculate token-supported full-range liquidity;
4. calculate required native;
5. accept only full fills with `swap + nativeRequired <= budget`.

Compare the adjacent candidate and return a digest:

```solidity
keccak256(
    abi.encode(
        block.chainid,
        address(key.hooks),
        vault,
        key.toId(),
        nonce,
        swapNative,
        sqrtPriceLimitX96,
        expectedTokenOut,
        liquidity
    )
);
```

- [ ] **Step 6: Run optimizer tests and size gate**

Run:

```sh
cd contracts
forge fmt
FOUNDRY_PROFILE=ci forge test --match-path test/LiquidityGrowthZapPlannerV3.t.sol -vv
forge build --sizes
```

Expected: exhaustive, differential, boundary, and fuzz tests pass; planner and all runtimes are deployable.

- [ ] **Step 7: Commit optimizer files**

```sh
git add contracts/src/libraries/LiquidityGrowthSwapMathV3.sol \
  contracts/src/LiquidityGrowthZapPlannerV3.sol \
  contracts/test/LiquidityGrowthZapPlannerV3.t.sol
git commit -m "Add exact Deep V3 zap planner"
```

---

### Task 5: Implement Atomic Growth Vault

**Files:**
- Create: `contracts/src/LiquidityGrowthFullRangeVaultV3.sol`
- Create: `contracts/src/LiquidityGrowthFullRangeVaultFactoryV3.sol`
- Create: `contracts/test/utils/LiquidityGrowthFullRangeV3Fixture.sol`
- Create: `contracts/test/LiquidityGrowthFullRangeV3.t.sol`

**Interfaces:**
- Consumes: V2 hook interface, V3 policy, planner, PoolManager.
- Produces:

```solidity
enum WorkAction { None, Compound }

struct CompoundResult {
    uint256 growthFeesClaimed;
    uint256 budgetNative;
    uint256 swapNative;
    uint256 tokenAcquired;
    uint256 nativeAdded;
    uint256 tokenAdded;
    uint256 nativeDust;
    uint256 tokenDust;
    uint128 liquidityAdded;
    uint160 preSqrtPriceX96;
    uint160 postSqrtPriceX96;
    int24 longTwapTick;
    uint256 rollingExposure;
    bytes32 digest;
}

function compound() external returns (CompoundResult memory);
function workState() external view returns (
    WorkAction action,
    uint256 hookGrowthFees,
    uint256 pendingNative,
    uint256 nextEligibleTimestamp,
    uint256 rollingCapacity,
    bytes4 blockedReason
);
```

- [ ] **Step 1: Write the red atomic lifecycle test**

The test must accrue growth fees, mature the oracle, call `compound`, and assert:

```solidity
assertGt(result.swapNative, 0);
assertGt(result.tokenAcquired, 0);
assertGt(result.nativeAdded, 0);
assertGt(result.tokenAdded, 0);
assertGt(result.liquidityAdded, 0);
assertEq(vault.poolId(), PoolId.unwrap(key.toId()));
assertEq(hook.totalNativeFeesAccrued(), programmableAccrual);
assertEq(vault.lockedLiquidity(), result.liquidityAdded);
assertEq(
    result.budgetNative,
    result.swapNative + result.nativeAdded + result.nativeDust
);
```

Also assert PoolManager currency deltas are zero and hook compound intent is empty after success.

- [ ] **Step 2: Run the vault test and confirm red**

Run:

```sh
cd contracts
forge test --match-path test/LiquidityGrowthFullRangeV3.t.sol -vv
```

Expected: compilation fails because the vault and factory do not exist.

- [ ] **Step 3: Implement factory-authenticated clone initialization**

Use the V2 commitment pattern:

```solidity
initializationCommitment[predicted] =
    keccak256(abi.encode(feeHook, planner, configuration));
vault.initialize(feeHook, planner, configuration);
delete initializationCommitment[predicted];
configurationHashOf[address(vault)] = vault.configurationHash();
```

Validate exact hook-factory provenance, PoolManager, PositionManager, PoolKey, PoolId, oracle binding, initial position recipient, and permanent custody.

- [ ] **Step 4: Implement outer compound**

Order:

1. read hook accrual and exact pre-balance;
2. call `claimGrowthFees`;
3. require actual ETH receipt equals hook return;
4. add received amount to accounted pending;
5. verify cooldown and rolling capacity;
6. get planner result;
7. subtract the selected budget from pending;
8. arm hook intent;
9. call `PoolManager.unlock`;
10. close hook intent;
11. record conservation, exposure, nonce, and timestamp.

No accounting survives a revert.

- [ ] **Step 5: Implement callback swap, add, and net settlement**

The callback accepts only the internally encoded `CompoundPlan`. It must:

```solidity
if (msg.sender != address(poolManager)) revert UnauthorizedUnlockCallback(msg.sender);
if (PoolId.unwrap(_poolKey.toId()) != poolId) revert PoolBindingMismatch();
```

Then execute direct `swap`, require exact simulated deltas and post-price, calculate positive full-range liquidity, call `modifyLiquidity`, settle negative deltas, take only residual token credit to the vault, and require terminal deltas zero.

- [ ] **Step 6: Add rolling exposure and permanent-depth accounting**

Record `swapNative + nativeAdded`. Anchor the depth cap when the first active record is written. Calculate trusted depth only from:

- validated initial locked liquidity when active; and
- the vault's fixed full-range position.

Do not use total arbitrary pool liquidity or raw contract balance.

- [ ] **Step 7: Run focused tests and runtime size**

Run:

```sh
cd contracts
forge fmt
forge test --match-path test/LiquidityGrowthFullRangeV3.t.sol -vv
forge build --sizes
```

Expected: atomic lifecycle tests pass; vault runtime is below 24,576 bytes.

- [ ] **Step 8: Commit vault files**

```sh
git add contracts/src/LiquidityGrowthFullRangeVaultV3.sol \
  contracts/src/LiquidityGrowthFullRangeVaultFactoryV3.sol \
  contracts/test/utils/LiquidityGrowthFullRangeV3Fixture.sol \
  contracts/test/LiquidityGrowthFullRangeV3.t.sol
git commit -m "Add atomic Deep V3 growth vault"
```

---

### Task 6: Add Adversarial Tests and Stateful Invariants

**Files:**
- Create: `contracts/test/LiquidityGrowthFullRangeV3Adversarial.t.sol`
- Create: `contracts/test/LiquidityGrowthFullRangeV3Security.t.sol`
- Create: `contracts/test/invariant/LiquidityGrowthFullRangeV3StatefulInvariant.t.sol`

**Interfaces:**
- Consumes: complete hook, planner, and vault.
- Produces: release-blocking adversarial and invariant evidence.

- [ ] **Step 1: Write atomic rollback adversarial tests**

Cover:

- price-limit partial fill;
- stale planner state;
- malformed topology;
- insufficient TWAP history;
- raw/truncated divergence;
- short/long divergence;
- pre-spot and post-spot boundaries;
- failed modify liquidity;
- settlement mismatch;
- callback spoofing;
- two keepers in one slot.

Before each failing call, snapshot all counters. After revert, assert every value and position liquidity is unchanged.

- [ ] **Step 2: Write authority and escape-surface tests**

Use selector and bytecode scans plus direct calls to prove there is no reachable:

```text
owner
admin
upgradeTo
implementation
rescue
sweep
withdraw
claimRewards
setPayoutAddress
delegatecall
selfdestruct
negative modifyLiquidity
```

Prove wrong vault, router, clone, pool, direction, mode, tag, and digest never receive the exemption.

- [ ] **Step 3: Write manipulation and cadence tests**

Model:

- one-block spot manipulation;
- a held 30-minute manipulation;
- pre-keeper front-run and backrun;
- exact limit boundary;
- cheap dust-swap censorship attempt;
- missed keeper slots without catch-up enlargement.

The vault must skip or remain bounded; unsafe conditions never widen policy.

- [ ] **Step 4: Write stateful invariant handler**

The handler must count successful actions and expose actions for all four user swap modes, oracle growth, time movement, forced transfers, compound attempts, and competing keepers.

Required invariants:

```solidity
assertEq(hook.totalNativeFeesAccrued(), hook.growthFeesAccruedTotal() + hook.programmableFeesAccrued());
assertEq(vault.totalGrowthETHReceived(), vault.totalNativeSwapped() + vault.totalNativeAdded() + vault.pendingGrowthNative());
assertEq(vault.totalTokenAcquired() + vault.initialLockedTokenDust(), vault.totalTokenAdded() + vault.accountedTokenDust());
assertGe(vault.lockedLiquidity(), handler.minimumObservedLiquidity());
assertGt(handler.successfulUserSwaps(), 0);
assertGt(handler.successfulCompounds(), 0);
```

- [ ] **Step 5: Run high-run security evidence**

Run:

```sh
cd contracts
forge test --match-path test/LiquidityGrowthFullRangeV3Adversarial.t.sol -vv
forge test --match-path test/LiquidityGrowthFullRangeV3Security.t.sol -vv
FOUNDRY_PROFILE=ci forge test \
  --match-path test/invariant/LiquidityGrowthFullRangeV3StatefulInvariant.t.sol -vv
```

Expected: all suites pass with nonzero successful-action counters.

- [ ] **Step 6: Commit adversarial evidence**

```sh
git add contracts/test/LiquidityGrowthFullRangeV3Adversarial.t.sol \
  contracts/test/LiquidityGrowthFullRangeV3Security.t.sol \
  contracts/test/invariant/LiquidityGrowthFullRangeV3StatefulInvariant.t.sol
git commit -m "Harden Deep V3 compound lifecycle"
```

---

### Task 7: Build the Launch Transaction

**Files:**
- Create: `contracts/src/LiquidityGrowthFullRangePositionPlannerV3.sol`
- Create: `contracts/src/LiquidityGrowthFullRangeLaunchV3.sol`
- Create: `contracts/test/LiquidityGrowthFullRangeLaunchV3.t.sol`

**Interfaces:**
- Produces:

```solidity
struct LaunchParameters {
    string name;
    string symbol;
    TokenMetadata metadata;
    bytes32 creatorSalt;
    uint256 minimumInitialTokenOut;
    uint160 initialBuySqrtPriceLimitX96;
    uint256 deadline;
}

struct LaunchResult {
    address token;
    bytes32 poolId;
    address growthVault;
    address positionRecipient;
    uint256 positionTokenId;
    address oracleGuard;
    uint256 initialBuyNativeAmount;
    uint256 initialBuyTokenAmount;
    uint256 initialLockedTokenDust;
    bytes32 vaultConfigurationHash;
    bytes32 launchHash;
}
```

- [ ] **Step 1: Write the complete launch red test**

Assert:

- token supply exactly one billion;
- token creator and graffiti match launcher commitments;
- no discretionary reserve;
- initial position recipient is permanent and fee recipient is growth vault;
- registered PoolId recomputes;
- first buy meets minimum output and limit;
- first buy pays 90/10 native fee;
- oracle starts at post-buy tick;
- all launcher, PositionManager, and unaccounted token balances are zero after launch;
- pool lifecycle is finalized;
- automation registers the vault.

- [ ] **Step 2: Run the launch test and confirm red**

Run:

```sh
cd contracts
forge test --match-path test/LiquidityGrowthFullRangeLaunchV3.t.sol -vv
```

Expected: compilation fails because V3 launcher and planner do not exist.

- [ ] **Step 3: Implement complete-supply position plan**

Port the official `PositionPlanner` use, replace V2's `supply - reserve` amount with complete supply, and route integer dust to the predicted growth vault.

- [ ] **Step 4: Implement launch order**

Execute exactly:

1. validate metadata, deadline, minimum initial buy, output floor, and price limit;
2. create token;
3. calculate PoolKey and PoolId;
4. predict and deploy growth vault plus permanent initial recipient;
5. register pool in new hook;
6. initialize pool;
7. mint complete-supply one-sided initial position;
8. execute bounded initial buy;
9. route token dust to growth vault;
10. finalize hook oracle at post-buy tick;
11. register vault with automation;
12. verify custody and emit versioned launch records.

- [ ] **Step 5: Run launch and regression tests**

Run:

```sh
cd contracts
forge fmt
forge test --match-path test/LiquidityGrowthFullRangeLaunchV3.t.sol -vv
forge test --match-path test/LiquidityGrowthFullRangeV3FeeAccounting.t.sol -vv
```

Expected: launch and fee tests pass.

- [ ] **Step 6: Commit launcher files**

```sh
git add contracts/src/LiquidityGrowthFullRangePositionPlannerV3.sol \
  contracts/src/LiquidityGrowthFullRangeLaunchV3.sol \
  contracts/test/LiquidityGrowthFullRangeLaunchV3.t.sol
git commit -m "Add Deep V3 launch transaction"
```

---

### Task 8: Add Automation and Re-benchmarked Keeper Executor

**Files:**
- Create: `contracts/src/LiquidityGrowthFullRangeAutomationV3.sol`
- Create: `contracts/src/DeepKeeperExecutorV2.sol`
- Create: `contracts/test/LiquidityGrowthFullRangeAutomationV3.t.sol`
- Create: `contracts/test/DeepKeeperExecutorV2.t.sol`

**Interfaces:**
- Produces:

```solidity
enum Action { None, Compound, GrowOracle }
struct Work { address vault; Action action; }
function scan(uint256 cursor, uint256 limit) external view returns (Work[] memory, uint256);
function performVault(address vault) external returns (bool succeeded, Action action);
function performBatch(address[] calldata vaults) external returns (uint256 attempted, uint256 succeeded);
```

- [ ] **Step 1: Write red automation tests**

Cover registration, exact factory provenance, bounded scan, failure isolation, oracle growth, atomic compound, idle vault, unsafe vault, competing keeper, and batch size.

- [ ] **Step 2: Implement V3 automation**

Port only the V2 registry and failure-isolation pattern. Remove the two-step process/compound actions. A compound calls exactly `vault.compound()`.

- [ ] **Step 3: Write executor gas and authority tests**

Measure successful and failed actions. Assert the executor rejects unknown automation, arbitrary calldata, unexpected return selector, and gas above the reviewed ceiling.

- [ ] **Step 4: Implement and benchmark executor**

Start with no inherited stipend. Measure the actual compound and choose:

```text
per-vault gas ceiling = ceil(measured worst case / 0.80)
batch ceiling = per-vault ceiling * reviewed batch size + fixed overhead
```

Record the measured values in a contract test event and `.gas-snapshot-deep-eth`.

- [ ] **Step 5: Run automation and gas tests**

Run:

```sh
cd contracts
forge test --match-path test/LiquidityGrowthFullRangeAutomationV3.t.sol -vv
forge test --match-path test/DeepKeeperExecutorV2.t.sol -vv
forge snapshot --match-contract '.*Deep.*|.*LiquidityGrowth.*' --snap .gas-snapshot-deep-eth
```

Expected: automation and executor tests pass; compound uses no more than 80% of the configured ceiling.

- [ ] **Step 6: Commit automation files**

```sh
git add contracts/src/LiquidityGrowthFullRangeAutomationV3.sol \
  contracts/src/DeepKeeperExecutorV2.sol \
  contracts/test/LiquidityGrowthFullRangeAutomationV3.t.sol \
  contracts/test/DeepKeeperExecutorV2.t.sol \
  contracts/.gas-snapshot-deep-eth
git commit -m "Add Deep V3 automation"
```

---

### Task 9: Prove Official Mainnet Compatibility on a Fork

**Files:**
- Create: `contracts/test/LiquidityGrowthFullRangeV3MainnetFork.t.sol`
- Modify: `contracts/scripts/verify-fork-tests-ci.mjs`

**Interfaces:**
- Consumes: complete contract stack.
- Produces: pinned-block and safe-head compatibility evidence.

- [ ] **Step 1: Write a red pinned Mainnet fork test**

Pin the official addresses and runtime hashes from the repository deployment snapshot. The test launches one Deep token, executes all four user modes, grows oracle capacity, advances a real 30-minute history, and performs one atomic compound.

Assert:

```solidity
assertEq(PoolId.unwrap(key.toId()), result.poolId);
assertEq(hook.compoundIntentState(result.poolId).state, 0);
assertGt(vault.lockedLiquidity(), 0);
assertEq(poolManager.currencyDelta(address(vault), key.currency0), 0);
assertEq(poolManager.currencyDelta(address(vault), key.currency1), 0);
```

- [ ] **Step 2: Run fork test and confirm initial failure**

Run:

```sh
cd contracts
ETHEREUM_RPC_URL="$ETHEREUM_RPC_URL" forge test \
  --match-path test/LiquidityGrowthFullRangeV3MainnetFork.t.sol -vv
```

Expected: initial failure identifies the first integration mismatch or missing fork-list registration.

- [ ] **Step 3: Fix only compatibility defects**

Adjust V3 code where the official PoolManager, PositionManager, UERC20 factory, or current directional protocol fee differs from mocks. Do not weaken PoolId, fee, TWAP, impact, or custody policy.

- [ ] **Step 4: Add fork test to CI verifier**

Require both:

- reproducible pinned block;
- two-provider safe/finalized-head dry run when CI secrets are present.

- [ ] **Step 5: Run fork and deterministic suites**

Run:

```sh
npm run contracts:test:deterministic
npm run contracts:test:forks
```

Expected: all deterministic and configured fork tests pass.

- [ ] **Step 6: Commit fork evidence**

```sh
git add contracts/test/LiquidityGrowthFullRangeV3MainnetFork.t.sol \
  contracts/scripts/verify-fork-tests-ci.mjs
git commit -m "Prove Deep V3 Mainnet compatibility"
```

---

### Task 10: Create Fail-Closed Deployment and Release Evidence

**Files:**
- Create all V3 deployment, schema, manifest, release, simulation, capture, verification, and promotion files listed in the File Map.
- Create: `contracts/test/DeployMainnetDeepFullRangeInfrastructureV3.t.sol`
- Create: `contracts/test/DeployMainnetDeepFullRangeInfrastructureV3Security.t.sol`

**Interfaces:**
- Produces:
  - release version `deep-full-range-v3`;
  - keeper compatibility `verified-deep-v3`;
  - exact transaction graph and runtime bindings;
  - manifest status initially `not-deployed` and `releaseEligible: false`.

- [ ] **Step 1: Write deploy-plan and manifest red tests**

The deployment test must reconstruct every predicted address from deployer plus nonce or CREATE2 salt, prove hook permission bits, and assert the constructor graph. The manifest test must reject missing receipts, source matches, runtime hashes, confirmations, policy hashes, or reviewed keeper binding.

- [ ] **Step 2: Implement deployment plan without broadcasting**

The script reads:

```text
DEEP_V3_MAINNET_DEPLOYER
DEEP_V3_MAINNET_TREASURY
DEEP_V3_MAINNET_START_NONCE
```

It creates the hook factory, vault factory, new hook, launcher, automation, and keeper executor in the tested order. `run()` remains guarded by chain ID 1 and explicit environment values.

- [ ] **Step 3: Create a blocked manifest**

Record policy, dependencies, source commitment, runtime templates, hook flags, transaction graph, and empty live evidence. Set:

```json
{
  "releaseVersion": "deep-full-range-v3",
  "deploymentStatus": "not-deployed",
  "releaseEligible": false,
  "keeperCompatibilityStatus": "verified-deep-v3"
}
```

The offline verifier must pass structural evidence while the live verifier must fail.

- [ ] **Step 4: Implement dual-RPC simulation and capture**

Simulation compares chain ID, finalized block, deployer nonce, code occupancy, gas estimates, and deterministic addresses across two independent HTTPS RPCs. Capture requires confirmed receipts, twelve confirmations, exact runtime hashes, Etherscan and Sourcify exact matches, and a clean 40-character commit.

- [ ] **Step 5: Run release tests**

Run:

```sh
npm run contracts:deep-v3:deployer:test
npm run contracts:deep-v3:release:test
npm run contracts:deep-v3:manifest:offline
```

Expected: deployer and offline manifest tests pass; `manifest:live` remains intentionally closed.

- [ ] **Step 6: Commit release scaffolding**

Stage only V3 release files and package scripts, then:

```sh
git commit -m "Prepare fail-closed Deep V3 release"
```

---

### Task 11: Implement the V3 Keeper Boundary

**Files:**
- Create: `ops/deep-keeper-v3/*`
- Create: `app/api/ops/deep-v3-keeper/handler.ts`
- Create: `app/api/ops/deep-v3-keeper/route.ts`
- Create: `tests/deep-v3-keeper-boundary.test.ts`
- Create: `tests/deep-v3-keeper-state.test.ts`
- Create: `tests/deep-v3-keeper-lease.test.ts`
- Create: `tests/deep-v3-keeper-route.test.ts`
- Modify: `vercel.json`

**Interfaces:**
- Consumes: V3 manifest, automation ABI, keeper executor.
- Produces: disabled-by-default five-minute keeper route with fencing and receipt reconciliation.

- [ ] **Step 1: Port V2 keeper tests under a distinct V3 namespace**

Require:

```text
DEEP_V3_KEEPER_ENABLED=true
DEEP_V3_KEEPER_SEND_TRANSACTIONS=true
two distinct HTTPS RPC hosts
exact V3 release manifest
exact automation and executor runtimes
exact 300000 ms interval
lease and fencing token
no private key or mnemonic environment fallback
```

- [ ] **Step 2: Make the tests red against an absent V3 keeper**

Run:

```sh
npx vitest run \
  tests/deep-v3-keeper-boundary.test.ts \
  tests/deep-v3-keeper-state.test.ts \
  tests/deep-v3-keeper-lease.test.ts \
  tests/deep-v3-keeper-route.test.ts
```

Expected: module-not-found failures.

- [ ] **Step 3: Port the generic fail-closed core**

Change the action model to one atomic `Compound` action. Before signing, require two-RPC agreement, fresh `eth_call`, gas within ceiling, lease ownership, fencing token, no pending transaction, and unchanged release binding.

- [ ] **Step 4: Implement state and receipt reconciliation**

A slot is complete only after:

- a confirmed expected compound receipt; or
- a confirmed common-block `None` assessment.

Simulation failure, RPC disagreement, pending, replacement, dropped transaction, revert, or reorg leaves the slot retryable.

- [ ] **Step 5: Add disabled cron route**

Add `/api/ops/deep-v3-keeper` to `vercel.json` at five-minute cadence. With no eligible manifest and no activation environment, the route returns a blocked status and never creates a signer.

- [ ] **Step 6: Run keeper tests**

Run:

```sh
npx vitest run tests/deep-v3-keeper-*.test.ts
```

Expected: all V3 keeper tests pass; live signing remains disabled.

- [ ] **Step 7: Commit keeper files**

Stage only `ops/deep-keeper-v3`, V3 API route, V3 tests, and the precise `vercel.json` hunk, then commit:

```sh
git commit -m "Add fail-closed Deep V3 keeper"
```

---

### Task 12: Add the Minimum Release-Gated App Binding

**Files:**
- Create: `lib/deep-v3.ts`
- Create: `lib/deep-v3-release-binding.ts`
- Create: `lib/deep-v3-runtime-binding.ts`
- Create: `lib/trade/deep-v3.ts`
- Create: `lib/onchain/deep-v3-read-model.ts`
- Create: `lib/profile/deep-v3-profile.server.ts`
- Create focused V3 Vitest files.
- Modify only release-selection branches in the existing launch, gate, indexer, trade, and profile boundaries.

**Interfaces:**
- Produces:
  - `DEEP_V3_RELEASE_VERSION = "deep-full-range-v3"`
  - `getDeepV3ReleaseBinding()`
  - `assertDeepV3RuntimeBinding()`
  - `encodeDeepV3Launch(parameters)`
  - strict PoolId and launch provenance parser
  - read-only growth metrics with no claim transaction.

- [ ] **Step 1: Write red binding tests**

Tests must reject:

- V2 manifest under V3 code;
- any ineligible manifest;
- wrong runtime hash;
- wrong hook, launcher, factory, vault, or automation;
- PoolId mismatch;
- launch event without canonical transaction provenance;
- a profile containing a claim or payout action;
- an internal compound classified as ordinary user fee revenue.

- [ ] **Step 2: Add exact V3 ABI and policy**

`lib/deep-v3.ts` must expose only approved policy and ABI fields. It must contain no token reserve, growth target, creator fee, beneficiary, payout, or reward claim field.

- [ ] **Step 3: Add release and runtime gates**

The app returns Deep unavailable unless the exact manifest is eligible and every required runtime hash is present. No V2 fallback is allowed.

- [ ] **Step 4: Add launch and trade encoding**

Launch encoding includes name, symbol, metadata, creator salt, initial output floor, initial square-root price limit, and deadline. Trade encoding uses the exact V3 PoolKey and hook address.

- [ ] **Step 5: Add indexer and profile read model**

Expose:

```text
growth ETH received
pending growth ETH
ETH swapped
token acquired
ETH added
token added
locked liquidity
last successful compound
next eligible time
oracle readiness
blocked reason
```

Expose no mutating reward action.

- [ ] **Step 6: Run the minimum app suite**

Run:

```sh
npx vitest run tests/deep-v3-*.test.ts
npm run typecheck
npm run lint
```

Expected: all V3 tests, TypeScript, and lint pass.

- [ ] **Step 7: Commit minimum app binding**

Stage only V3 modules, V3 tests, and reviewed release-selection hunks, then:

```sh
git commit -m "Bind Deep V3 to the app"
```

---

### Task 13: Full Verification and Independent Second Review

**Files:**
- Modify only defects discovered by the commands below.
- Create: `contracts/release/DEEP-FULL-RANGE-V3-REVIEW.md`

**Interfaces:**
- Produces: exact local, fork, security, gas, keeper, and app evidence tied to one commit.

- [ ] **Step 1: Run complete contract verification**

```sh
npm run contracts:fmt
npm run contracts:lint
cd contracts && forge build --sizes
cd contracts && FOUNDRY_PROFILE=ci forge test
npm run contracts:slither
npm run contracts:test:forks
```

Expected: every command passes; every runtime and initcode remains below the hard limit.

- [ ] **Step 2: Run complete app verification**

```sh
npm run verify
npm run audit:prod
```

Expected: lint, typecheck, tests, build, SDK provenance, and production dependency audit pass.

- [ ] **Step 3: Perform a fresh security diff**

Compare V3 against V1 and V2 for:

- return-delta fee behavior;
- callback authentication;
- PoolId binding;
- transient intent;
- liquidity permissions;
- settlement;
- oracle;
- exposure;
- absence of escape surfaces.

Record each reviewed invariant and exact command output summary in `DEEP-FULL-RANGE-V3-REVIEW.md`.

- [ ] **Step 4: Re-run after all fixes**

Repeat Step 1 and Step 2 from a clean command invocation. Record the exact commit hash and distinguish:

- local deterministic evidence;
- Mainnet fork evidence;
- blocked live deployment evidence.

- [ ] **Step 5: Commit review evidence**

```sh
git add contracts/release/DEEP-FULL-RANGE-V3-REVIEW.md
git commit -m "Record Deep V3 release review"
```

---

### Task 14: Prepare the Explicit-Approval Deployment Handoff

**Files:**
- No source edits unless a verification defect is found.

**Interfaces:**
- Produces: a truthful handoff showing whether Deep is ready for owner-signed deployment.

- [ ] **Step 1: Run read-only Mainnet preflight**

Run:

```sh
npm run contracts:deep-v3:mainnet:simulate
npm run contracts:deep-v3:manifest:offline
```

Expected: simulation and offline manifest pass against two RPCs; live manifest remains blocked because no deployment receipts exist.

- [ ] **Step 2: Confirm the public app remains gated**

Run the V3 launch preflight against the production configuration. Expected result before deployment:

```json
{
  "available": false,
  "reason": "Deep Mainnet release is not deployed"
}
```

- [ ] **Step 3: Stop before external action**

Report:

- exact release commit;
- tests and invariant counts;
- runtime sizes;
- fork block and RPC agreement;
- gas estimate;
- predicted deployment addresses;
- required wallet, ETH estimate, and signatures;
- Etherscan and Sourcify steps that will follow deployment.

Request explicit approval before broadcasting, signing, spending, source submission, or production activation.
