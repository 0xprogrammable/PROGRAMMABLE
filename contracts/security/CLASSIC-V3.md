# Classic V3 security and economic semantics

## Scope

Classic V3 adds independently selected buy and sell fees plus beneficiary-owned creator rewards. It deliberately reuses the existing UERC20 factory, Uniswap v4 PoolManager, PositionManager, permanent `PositionFeesForwarder` lock, zero-LP-fee pool and atomic initial-buy flow.

Existing Classic V1 and Classic V2 tokens and contracts are not modified.

## Immutable economics

- `buySwapFeeBps` applies to native ETH to token swaps.
- `sellSwapFeeBps` applies to token to native ETH swaps.
- Each value must be 100 to 1,000 basis points in 100-basis-point steps.
- The Programmable share is always 10 basis points of the gross native amount and is deducted from the selected directional fee.
- The creator-reward portion is the selected directional fee minus the Programmable share.
- ERC-20 transfer tax is zero.
- The pool LP fee is zero.
- Fee configuration is registered once. There is no setter or upgrade path.

Exact-input fees use floor division against the gross native amount. Exact-output fees derive the minimum gross native amount with rounding up, preserving the requested net output. The implementation rejects unsupported partial fills instead of charging against an amount that the pool did not exchange.

The hook exposes `feeDisclosure`, `totalSwapFeeBpsFor` and `poolFeeConfig`. Registration and accrual events identify the direction and applied fee.

## Reward configuration

Every pool has one deterministic `FeeSplitVaultV1`, including single-recipient launches.

- One to eight immutable beneficiary identities are supported.
- Each identity is nonzero and unique.
- Each share is positive.
- Shares total exactly 10,000 basis points.
- The deployer may be a beneficiary but has no special reward authority.
- An external beneficiary does not accept or approve assignment.
- Beneficiary identities and shares cannot change.

Each beneficiary initially pays to itself. Only that immutable beneficiary may change its payout address or initiate its claim. A payout address receives funds but receives no claim or configuration authority.

Payout changes are one-step and accept any nonzero address. Contract wallets, counterfactual wallets and duplicate payout destinations are valid. Existing unclaimed and future rewards follow the current payout address.

No deployer, keeper, other beneficiary or platform address can initiate a beneficiary claim.

## Accounting and rounding

Swap callbacks perform constant work. Creator fees accrue once per pool in the hook. Recipient iteration never occurs during a swap.

The first beneficiary through the penultimate beneficiary receives:

`floor(total received * share / 10,000)`

The final immutable beneficiary receives the remainder after those cumulative allocations. This makes rounding deterministic and conserves all creator-fee wei.

Claims use cumulative entitlement minus cumulative claimed value. This prevents double claims and preserves entitlement when beneficiaries claim at different times.

The vault counts only ETH redeemed from the registered hook. Forced ETH is excluded from reward accounting. Its `receive` function accepts ordinary transfers only from the immutable PoolManager.

## Call and trust boundaries

- Pool registration is bound to the creator recorded by the launched UERC20.
- A reward vault must be deployed and recorded by the immutable vault factory and must match the hook, PoolManager and pool ID.
- Hook deployment must satisfy the exact Uniswap v4 permission-bit mask.
- Only the registered vault may redeem creator fees from the hook.
- Only the immutable Programmable treasury may claim or redirect the Programmable portion.
- Claims and payout changes use OpenZeppelin `ReentrancyGuardTransient`.
- State is updated before the untrusted payout call.
- A reverting payout reverts only that beneficiary's claim and does not block another beneficiary.
- Matching counterfactually predeployed vaults and position recipients are reused. Unknown code or unmatched factory configuration is rejected.

There is no proxy, owner, administrator, pause, blacklist, mint authority, fee setter, recovery function or beneficiary-reward sweep.

## Permanent liquidity behavior

Classic V3 retains the existing one-sided position policy:

- The fixed token supply is deposited through the official PositionManager.
- The position NFT is held by the official `PositionFeesForwarder`.
- Operator is the zero address.
- Timelock block is `type(uint256).max`.
- No practical position transfer or liquidity-withdrawal path is exposed.

The position's fee recipient remains the deployer. This does not alter creator swap-fee ownership because the Classic pool LP fee is zero.

## Tests and analysis

The dedicated tests cover:

- Buy and sell direction for exact input and exact output.
- One to ten percent bounds and one-percentage-point steps.
- The fixed 10-basis-point Programmable share.
- Deployer, external and split reward configurations.
- Eight beneficiaries, uniqueness, positive shares and exact totals.
- One-step payout changes, duplicate payout destinations and reward redirection.
- Every unauthorized claim and payout-change path.
- Reverting payout isolation, no double claim and no cross-vault claim.
- Fuzzed fee arithmetic and split conservation.
- Stateful native-claim accounting and immutable-economics invariants.
- A lifecycle against official Ethereum mainnet PoolManager, PositionManager, Universal Router, Permit2 and Quoter contracts on a pinned fork.
- Regression execution of the existing contract suite.

Slither output is stored in `security/slither-results-classic-v3.json`. The run excluded dependency findings, mixed dependency pragma findings and Slither's false `BaseHook.getHookPermissions` implementation report. The remaining 99 detectors returned zero findings.

## Remaining release gates

This work is not a security audit and is not mainnet-ready solely because local and fork tests pass.

Before deployment:

- Obtain independent review of the hook, vault and launcher composition.
- Pin and record the exact deployment commit, compiler settings, constructor arguments, salts and addresses.
- Verify every deployed source and constructor argument on Etherscan.
- Validate scanner and indexer disclosure for directional hook fees, transfer tax, LP fee, vault and locked position.
- Run live small-value buy, sell and each beneficiary claim path on the intended network.
- Confirm the public UI derives fees and reward authority from onchain getters rather than duplicated frontend constants.
- Monitor ecosystem support for directional v4 hook fees. Third-party scanners may display incomplete or unknown tax information even when the onchain disclosure is correct.
