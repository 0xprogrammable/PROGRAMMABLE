# Full-Range V1 economic specification

> **Status: IN DEVELOPMENT. DO NOT DEPLOY.**

This document fixes the economic properties of the first Full-Range liquidity-growth model. It is an audit
specification, not deployment evidence.

## Fixed public policy

| Parameter | V1 value |
| --- | ---: |
| Token supply | 1,000,000,000 tokens |
| Growth reserve | 150,000,000 tokens |
| Initial locked one-sided allocation | 850,000,000 tokens, less planner dust |
| Native growth target | 0.05 ETH |
| Launch tick | 204200 |
| Stress tick | 218000 |
| Full-range ticks | `[-887200, 887200]` |
| Trusted-depth limit | 25 basis points, or 0.25% |
| Maximum native amount per compound | 0.25 ETH |
| Normal minimum native amount per compound | 0.002 ETH |
| Successful-compound cooldown | 30 minutes |
| TWAP history | 30 minutes |
| Minimum principal utilization | 85% on each side |

Creators cannot change these values. The only creator-selected economic fields are the disclosed buy and sell swap
fees and the immutable post-target reward split.

## Official v4 pairing math

Let:

```text
Q = 2^96
A = TickMath.getSqrtPriceAtTick(-887200)
P = current sqrtPriceX96
B = TickMath.getSqrtPriceAtTick(887200)
X = native amount
```

The full-range liquidity and matching token budget are:

```text
L = floor(X * floor(P * B / Q) / (B - P))
Y = ceil(L * (P - A) / Q)
```

The implementation uses `LiquidityAmounts.getLiquidityForAmount0` and full-precision upward rounding. The independent
economic test suite differentials this result against `SqrtPriceMath.getAmount1Delta`.

At tick 204200:

```text
sqrtPriceX96 = 2151813121295408910812139624586144
tokens required for 0.05 ETH = 36,882,465.062467736383588825
four-times launch requirement = 147,529,860.249870945534355300
```

At stress tick 218000:

```text
tokens required for 0.05 ETH = 146,594,055.738328897705609642
```

The fixed 150,000,000-token reserve covers both requirements.

## Economic properties

### FR-ECO-01: exact reserve sufficiency

Before every compound:

```text
currentTokenBalance >= tokensRequired(remainingNativeTarget, stressTick)
```

Only the current ERC-20 balance of the vault counts. Historical token principal already committed to a position
cannot fund another compound.

Every accepted spot price must require no more tokens than the stress price. A price above the stress envelope blocks
the operation.

### FR-ECO-02: reserve conservation

For the fixed, non-rebasing UERC20:

```text
currentTokenBalance + totalTokenAdded
= fixedReserve + recycledTokenFees
```

There is no withdrawal, rescue, beneficiary transfer or administrator path for reserve tokens.

### FR-ECO-03: unused reserve disclosure

If every compound occurs at the launch price, the target needs approximately 36.882465 million tokens. Approximately
113.117535 million reserve tokens, or 11.31% of total supply, remain unused and permanently locked in the vault.

This amount is not liquidity and must not be included in active-liquidity or TVL displays. The realized unused amount
depends on the actual prices of successful compounds.

### FR-ECO-04: trusted depth

The depth limit uses only:

- the vault's own add-only full-range position; and
- the original locked one-sided position while its current tick is inside `[-887200, 204200)`.

External liquidity never increases the limit.

The native virtual depth uses:

```text
anchorSqrtPrice = max(currentSqrtPrice, launchSqrtPrice)
trustedNativeDepth = trustedLiquidity * 2^96 / anchorSqrtPrice
depthCap = trustedNativeDepth * 25 / 10,000
```

The launch-price anchor prevents a lower spot price from inflating the permitted native chunk.

### FR-ECO-05: compound amount

The normal compound amount is:

```text
min(
  remaining native target,
  0.25 ETH,
  0.25% of trusted native virtual depth
)
```

The complete amount must already be aggregated. A smaller pending amount cannot create an arbitrary dust position.
The normal compound must be at least 0.002 ETH.

One below-minimum final compound is allowed only when:

- the entire 0.05 ETH target has already been allocated from creator fees; and
- that final compound can reach the declared completion threshold.

Failed or below-threshold attempts do not advance the cooldown.

### FR-ECO-06: aggregate-ready scheduling

The keeper may poll every five minutes, but a successful compound can occur at most once every 30 minutes.

Fee processing becomes ready when any of the following is true:

- unclaimed creator fees reach 0.002 ETH;
- the unclaimed amount completes the remaining allocation to the target; or
- unclaimed fees plus already pending growth funds complete one full safe depth-bounded chunk and all execution gates
  are ready.

Pending funds that already cover a complete safe chunk become compound-ready only after the cooldown, oracle and
stress-reserve gates pass.

### FR-ECO-07: creator-fee deferral

Before completion:

```text
growthAllocation = min(receivedCreatorFees, remainingUnallocatedTarget)
deferredRewards = receivedCreatorFees - growthAllocation
```

Deferred rewards are not claimable. They become recognized rewards only after the target allocation is complete and
the actual native and token-utilization completion gates pass.

After completion, new creator fees route directly to the immutable beneficiary split.

### FR-ECO-08: completion

The native completion tolerance is:

```text
min(0.01% of target, 0.000001 ETH) = 0.000001 ETH
```

The V1 minimum is therefore `0.049999 ETH` actually added to liquidity.

Completion additionally requires:

- exactly 0.05 ETH allocated from creator fees;
- a nonzero cumulative token budget; and
- cumulative token principal of at least 85% of the cumulative token budget.

Receipt of fees, reservation of funds or a TWAP quote does not by itself complete growth.

## Oracle and manipulation boundary

Full range prevents inactive growth tranches. It does not make the token/native pairing ratio manipulation-safe.
Without the staged 30-minute oracle, a caller could manipulate spot, invoke the permissionless compound and reverse
the manipulation in one transaction.

The trusted-depth cap, reserve envelope and cooldown bound exposure but do not replace price-history validation. V1
therefore retains:

- 192 staged observation slots;
- a mature 30-minute truncated same-pool TWAP;
- the 600-tick spot-to-TWAP circuit breaker; and
- the fixed stress-price reserve envelope.

A distortion sustained through the full TWAP window can still become the observed market price. The design has no
independent fair-price oracle. This limitation must remain in the release risk disclosure.

## Liveness boundary

Automation is conditional, not unconditional:

- a keeper must pay gas and submit work;
- the oracle must be mature;
- a complete safe chunk must be aggregated;
- the cooldown must have elapsed;
- the price must remain inside the reserve envelope; and
- the current token reserve must cover the complete remaining stress target.

Before the first full-range compound, trusted depth depends on the initial one-sided position remaining active. If it
is inactive, the depth cap is zero and compounding pauses rather than trusting external liquidity.

## Executable evidence

The dedicated suite is:

```text
test/LiquidityGrowthFullRangeEconomics.t.sol
```

It covers:

- exact launch and stress reserve values;
- differential official-v4 pairing math;
- reserve monotonicity and multi-compound stress solvency;
- explicit unused-reserve accounting;
- launch-price-anchored depth;
- initial-position activity boundaries;
- minimum compound and final-dust rules;
- the exact completion predicate;
- creator-fee deferral; and
- aggregate-ready keeper and cooldown transitions.

Passing this suite is necessary but not sufficient for release. Mainnet fork evidence, runtime/source verification,
deployment receipts, monitoring, keeper funding and independent review remain separate gates.
