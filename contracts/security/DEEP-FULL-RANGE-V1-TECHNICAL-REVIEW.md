# Deep Full-Range V1 technical review

> **Review status: conditional design acceptance. Product activation: NO-SHIP pending complete lifecycle and keeper evidence.**

This note reviews the fixed Full-Range V1 design deployed on Ethereum Mainnet and recorded in the release manifest.
It is an internal manual review, not an external audit or proof that the public product is ready for activation.

The fixed full-range position is materially safer than a dynamically centered range under this model's constraints.
It removes attacker influence over the destination range, remains active across every usable tick and preserves
add-only custody. The same-pool TWAP is still not an independent price oracle. A distortion sustained through the
complete history window can become the accepted reference state. The fixed target, reserve envelope, trusted-depth
cap, utilization floor and cooldown bound that exposure; they do not prove a fair price.

## Fixed policy

| Property | V1 value |
| --- | ---: |
| Token supply | 1,000,000,000 tokens |
| Initial one-sided locked allocation | 850,000,000 tokens, less planner dust |
| Growth reserve | 150,000,000 tokens |
| Native growth target | 0.05 ETH |
| Launch tick | 204200 |
| Stress tick | 218000 |
| Growth range | `[-887200, 887200]` |
| Trusted-depth cap | 25 bps, or 0.25% |
| Normal minimum compound | 0.002 ETH |
| Successful-compound cooldown | 30 minutes |
| Oracle history | 30 minutes |
| Observation target | 192 slots |
| Spot-to-TWAP circuit breaker | 600 ticks |
| Per-observation tick truncation | 400 ticks |
| Principal utilization floor | 85% on each side |

An offchain worker may poll every five minutes. The contracts cannot wake themselves, and five-minute polling does
not shorten the onchain 30-minute successful-compound cooldown.

## Module responsibilities

| Module | Responsibility |
| --- | --- |
| `LiquidityGrowthFullRangePolicyV1` | Fixes supply, reserve, target, full-range ticks, depth cap, utilization and cooldown; quotes the token pairing budget and rejects prices outside the stress envelope. |
| `LiquidityGrowthFullRangeLaunchV1` | Atomically creates the canonical UERC20, registers and initializes the exact v4 pool, creates immutable dependencies, funds the reserve, mints the locked one-sided position and executes the creator's initial buy. |
| `LiquidityGrowthFeeOracleHookV1` | Applies disclosed native-denominated buy and sell fees, accounts for creator and launcher shares and records the exact pool's truncated observations. |
| `LiquidityGrowthRangeSourceV1` | Requires mature same-pool history and enforces the spot-to-TWAP circuit breaker. Its dynamic range quote is deliberately ignored by Full-Range V1. |
| `LiquidityGrowthFullRangeVaultFactoryV1` | Validates every dependency, commits every initialization argument and deploys deterministic locked clones. |
| `LiquidityGrowthFullRangeVaultV1` | Pulls creator fees, routes the first 0.05 ETH to growth, adds bounded full-range liquidity and pays the immutable post-target beneficiary split. |
| `LiquidityGrowthFullRangePositionPlannerV1` | Builds the fixed one-sided initial PositionManager plan. |
| `LiquidityGrowthFullRangeAutomationV1` | Exposes permissionless, failure-isolated oracle staging and vault processing for an external worker. |
| `LockedPositionFeeForwarderFactoryV1` | Creates the initial NFT recipient with zero operator and the maximum timelock block. |

## Pool identity and initialization

The canonical pool is committed as:

```text
currency0   = native ETH
currency1   = the newly created canonical UERC20
fee         = 0
tickSpacing = 200
hooks       = the factory-recognized composite fee/oracle hook
```

The token is created by the pinned `UERC20Factory` with 18 decimals and exactly one billion fixed units. The launcher
verifies the predicted address, creator, graffiti, decimals, supply and complete initial balance. It does not accept
an arbitrary ERC20.

Pool registration precedes initialization. The hook accepts registration only from the token's recorded creator and
accepts `beforeInitialize` only from that recorded registrar. The launcher verifies the registered pool ID and the
returned initialization tick.

The vault factory validates the exact pool, hook factory, PoolManager, PositionManager, range-source factory,
forwarder factory, oracle parameters, initial-position recipient and beneficiary split. It writes a commitment over
all initialization arguments before deploying the clone. The clone accepts initialization only from its immutable
factory and only when the commitment matches, after which the factory deletes the temporary commitment. The
implementation instance is locked in its constructor.

## Authorization and callback matrix

| Entry point | Authorized caller | Security effect |
| --- | --- | --- |
| Launcher `launch` | Anyone | Caller supplies valid metadata, fixed-policy fees, beneficiaries and the minimum initial buy. All creation and the first buy are atomic. |
| Launcher `unlockCallback` | Exact PoolManager only | Executes only the encoded initial buy for the just-created exact pool. |
| Hook callbacks | Exact PoolManager only through `BaseHook` | Prevents direct callback spoofing. |
| Hook `registerPool` | Token's recorded creator | Binds the exact pool and immutable reward vault before initialization. |
| Hook `increaseObservationCardinalityNext` | Anyone | Can only grow observation capacity for a registered pool. |
| Hook `claimCreatorFees` | Exact registered reward vault | Creator fees cannot be redirected by the caller. |
| Hook `claimLauncherFees*` | Immutable launcher-fee recipient | Only the configured treasury may collect or select the launcher-fee destination. |
| Vault factory `deployOrGet` | Anyone | Deployment remains restricted by factory provenance, exact configuration validation and the initialization commitment. |
| Vault `initialize` | Immutable factory only | Rejects implementation initialization, replay and argument substitution. |
| Vault `process` and `compoundPending` | Anyone | Caller cannot choose the pool, range, amount, token, recipient or policy. |
| Vault `unlockCallback` | Exact PoolManager only | Adds liquidity only under the vault's fixed key, ticks and salt. |
| Vault `setPayoutAddress` and `claimRewards` | The immutable beneficiary concerned | One beneficiary cannot redirect or claim another beneficiary's allocation. |
| Automation `registerAndStageOracle` | Immutable launcher only | Registers only the vault produced during atomic launch. |
| Automation staging, checks and performance | Anyone | Every vault and dependency is revalidated against the factory before work. |
| Forwarder `collectFees` | Anyone | Uses a zero-liquidity decrease and forwards both fee sides to the immutable launch recipient. |
| Forwarder `approveOperator` | Anyone after the timelock | The timelock is `uint256.max` and the operator is zero, so no practical transfer authority becomes available. |

Both public vault mutation paths hold a transient reentrancy guard across the complete PoolManager unlock boundary.
The callback independently authenticates the PoolManager. The vault accepts ETH only from its exact upstream reward
vault or the exact PoolManager.

## Fee and asset accounting

The hook accepts separate buy and sell swap fees from 1% through 10%, in one-percentage-point increments. The v4 LP
fee and ERC20 transfer tax are both zero. For every trade, the launcher share is fixed at 10 bps of gross native
volume and the creator share is the configured total less those 10 bps. Exact-input and exact-output paths use
separate gross/net formulas.

The hook conservation identity is:

```text
totalNativeFeesAccrued
= launcherFeesAccrued + sum(registeredPool.creatorFeesAccrued)
```

The vault's cumulative native identity is:

```text
totalCreatorFeesReceived + totalNativeRecycled
= totalNativeAddedToLiquidity
  + pendingGrowthNative
  + deferredRewardFees
  + totalRewardFeesReceived
```

Before growth completion:

```text
totalNativeAllocatedToGrowth + totalNativeRecycled
= totalNativeAddedToLiquidity + pendingGrowthNative
```

The fixed-token identity is:

```text
token.balanceOf(vault) + totalTokenAddedToLiquidity
= tokenReserveTarget + totalTokenRecycled
```

Reward claims satisfy:

```text
totalRewardFeesClaimed <= totalRewardFeesReceived
sum(beneficiary.claimedBy) = totalRewardFeesClaimed
```

At completion:

```text
totalNativeAddedToLiquidity + nativeLiquidityShortfallAtCompletion
= growthTargetNative
pendingGrowthNative = 0
```

Completion additionally requires the complete 0.05 ETH allocation, at least 0.049999 ETH actually added and at
least 85% cumulative token-budget utilization. Fees above the growth allocation remain deferred until those
conditions are met.

## Custody

The initial one-sided position NFT is owned by the official `PositionFeesForwarder`. Its operator is zero and its
timelock block is the maximum unsigned integer. The public fee-collection method uses zero liquidity delta and cannot
remove principal.

Growth liquidity is a PoolManager position keyed by the vault address, the full-range ticks and a fixed salt. The
vault implements no negative-liquidity operation. There is no owner, administrator, proxy upgrade, pause, reserve
withdrawal, rescue or arbitrary-call path in the reviewed Full-Range V1 modules.

This is intentionally strict custody. Mistaken or forced ETH and token transfers can remain permanently stuck.
Unused reserve tokens are not active liquidity or TVL and remain locked after the 0.05 ETH target completes.

## Placement decision

### Rejected: dynamically centered range

A range centered on the same-pool TWAP can be moved by a distortion sustained for the complete history window. Once
that state becomes the TWAP, a permissionless compound can place new liquidity into the attacker-selected region.
This is a release blocker under the stated no-external-oracle design.

### Rejected: fixed launch-anchored narrow range

A launch-anchored narrow range removes later range selection, but it becomes inactive after ordinary repricing. A
roughly 20,000-tick move is about a 7.4-times price ratio. Compounding then loses liveness even when the new price is
legitimate.

### Accepted with fixed bounds: full range

Full range eliminates destination-range selection and stays active across all usable ticks. Only the vault's own
full-range liquidity and the validated original locked position while active contribute to trusted depth. External
and just-in-time liquidity never raises the cap. A lower manipulated spot cannot inflate native virtual depth because
the calculation anchors the square-root price at the greater of current price and launch price.

One compound is bounded by:

```text
min(
  remaining 0.05 ETH target,
  0.25 ETH absolute ceiling,
  0.25% of trusted native virtual depth
)
```

The complete safe chunk must already be funded, normal chunks must be at least 0.002 ETH and successful compounds
are separated by 30 minutes. The 0.25 ETH ceiling is currently dominated by the smaller fixed 0.05 ETH total target.

The defensive economic regression samples sustained states created by 0.02, 0.05, 0.1, 0.2 and 0.5 ETH native
inputs, lets the fixed target compound under the mature same-pool state, restores the state and closes the round
trip. Every sampled round trip is native-loss-making at the frozen bounds. That is regression evidence, not a proof
for every possible market state.

## Manual secure-workflow review

### Privacy

There is no private state or confidential launch data. Metadata, beneficiaries, shares, payout changes, fee accruals,
keeper actions and claims are public. The UI must not imply privacy.

### Transaction ordering and front-running

Token creation, pool registration, initialization, initial liquidity and the creator's first buy are atomic, so a
separate transaction cannot enter the new pool between those steps. The effective token salt includes the deployer,
so copying another user's launch calldata does not create the same token address.

Post-launch processing is permissionless and visible in the public mempool. A third party may choose when to call an
already-ready action, but cannot choose its pool, amount, range or recipient. The same-pool history, 600-tick
circuit breaker, 25-bps trusted-depth cap, 30-minute cooldown, fixed target and stress reserve are therefore required
ordering defenses. Private transaction routing may reduce opportunistic ordering but is not a correctness
assumption.

### Cryptography and deterministic deployment

The design uses `keccak256` commitments and CREATE2 or deterministic clones for provenance and address prediction. It
does not use signatures, randomness, encryption, custom cryptography or offchain authorization. Configuration hashes
bind chain ID, contracts and immutable launch state where applicable. Deployment tooling must publish salts,
constructor arguments, configuration hashes and runtime code hashes.

### DeFi composition

The trusted boundary includes the official v4 PoolManager, PositionManager, canonical UERC20 factory, Uniswap
liquidity-launcher forwarder code and the factory-recognized Programmable hook, range source and vault modules.
PoolManager callbacks and currency deltas are adversarial boundaries and are authenticated and settled atomically.

The model is reviewed only for the factory-created fixed-supply UERC20. Fee-on-transfer, rebasing, callback-capable,
ERC777-like or otherwise nonstandard tokens are out of scope. Supporting arbitrary tokens would require a new
review.

## Known same-pool oracle limitation

The oracle rejects immature history, large per-observation changes and a current spot more than 600 ticks away from
the 30-minute truncated TWAP. It has no independent view of fair value. A price held long enough can become both the
spot and TWAP accepted by the guard.

Full range prevents that state from selecting an inactive or attacker-centered range. It does not prevent the state
from affecting the ETH/token ratio added at that time. The fixed reserve and target bound the maximum principal
affected. User-facing disclosure must say this plainly. Do not describe the model as manipulation-proof,
oracle-safe or unruggable.

## Static-analysis limitations

The stored triaged Slither result contains 0 High, 15 Medium, 16 Low and 13 Informational findings. It is not a clean
automatic report:

- v4 packed deltas and via-IR paths prevent complete Slither IR coverage;
- transient reentrancy guards and PoolManager-only callbacks require manual review;
- ignored tuple fields are deliberate where only exact required values are consumed;
- the locked-ETH result reflects intentional no-rescue custody and forced ETH can remain stuck;
- external calls inside Automation batches are intentionally failure-isolated and bounded;
- timestamp checks implement the 30-minute cooldown and do not authorize value redirection.

The JSON output and triage are evidence inputs, not substitutes for the callback, accounting and custody review
above. Any new unreviewed High result is a release blocker.

## Exact release gates

Full-Range V1 remains **NO-SHIP** until all of the following hold for one frozen commit:

1. The complete Full-Range suite, defensive economic regression, hook suite and fee-accounting suite pass.
2. All nine Full-Range invariants pass at 1,000 runs and 128 calls per run.
3. All six Mainnet-fork tests pass against pinned official PoolManager, PositionManager and UERC20Factory runtime
   hashes.
4. Formatting, lint, gas regressions, runtime-size and initcode-size gates pass.
5. Slither output is regenerated for the frozen source, every result is triaged and no unreviewed High remains.
6. The fixed policy and the same-pool oracle limitation are frozen in public documentation. Increasing the target or
   depth cap, shortening the cooldown, lowering the utilization floor, making the reserve arbitrary or restoring a
   dynamic range requires a new security review.
7. A Mainnet manifest records chain ID, every address, constructor argument, CREATE2 salt, configuration hash,
   runtime code hash, deployment transaction hash and block number.
8. Every deployed module is source-verified, and its live runtime code hash matches the manifest.
9. The external worker is live with five-minute polling, four-vault sponsored batches, simulation before submission,
   per-vault budget accounting and alerts for staging failures, process failures, stalled vaults and reserve gates.
10. The application enables the model only after validating the live manifest. It displays the exact pool, hook,
    vault, locked position, fees, 0.05 ETH target, 150 million-token reserve, 30-minute cooldown and oracle
    limitation.
11. The product owner accepts the documented same-pool limitation and the frozen economic envelope.

Local tests are not Mainnet deployment evidence. Until the manifest, receipts, source verification and worker
operations exist, the correct release decision is NO-SHIP.

## Verification commands

Run from `contracts/`:

```sh
forge fmt --check
forge lint
forge test --match-path 'test/LiquidityGrowthFullRange*.t.sol' -vv
forge test --match-path 'test/LiquidityGrowthDeepAdversarial.t.sol' -vv
FOUNDRY_INVARIANT_RUNS=1000 FOUNDRY_INVARIANT_DEPTH=128 \
  forge test --match-path 'test/invariant/LiquidityGrowthFullRangeInvariant.t.sol' -vv
forge test --match-path 'test/LiquidityGrowthFeeOracleHookV1.t.sol' -vv
forge test --match-path 'test/invariant/ClassicV3FeeAccountingInvariant.t.sol' -vv
forge build --skip test --sizes
```

The Mainnet-fork suite additionally requires the repository's pinned RPC and deployment configuration. Record the
exact command, RPC block and resulting receipts in the release manifest rather than treating a local fork pass as a
deployment.
