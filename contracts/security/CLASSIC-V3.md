# Classic security and economic semantics

## Scope

Classic supports independently selected buy and sell fees plus beneficiary-owned creator rewards. It deliberately reuses the existing UERC20 factory, Uniswap v4 PoolManager, PositionManager, permanent `PositionFeesForwarder` lock, zero-LP-fee pool and atomic initial-buy flow.

Existing Classic tokens and contracts are not modified.

## Deployment status

The configurable Classic stack is deployed on Ethereum, verified on Etherscan and
Sourcify, and enabled by the production manifest. The seven-contract deployment is
recorded in `deployments/mainnet-classic-v3.json`.

- Launcher: `0xC3bd04aAc2fb2ba58efD7Eb673E544E0B80De770`
- Fee hook: `0x35Fe236EA82F7cF525c9719d7df8F49F94D720CC`
- Launcher fee recipient: `0x4957f49620AFf3Adbbe8195a4f633E49cc93376c`

The Mainnet canary completed an atomic launch, buy, sell, creator claim and
Programmable claim against the official Uniswap v4 contracts. Two independent RPC
endpoints confirmed the deployment code, immutable bindings and permanent position
custody. Earlier Classic contracts remain unchanged and are retained as historical
releases.

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

Every pool has one deterministic `ClassicRewardVaultV1`, including single-recipient launches.

- The launch configuration contains one to five nonzero, unique payout wallets.
- Every share is positive and the launch shares total exactly 10,000 basis points.
- The deployer may be a payout wallet but receives no special claim authority.
- An external payout wallet does not need to accept the allocation.
- Only the wallet that currently owns an allocation may claim its ETH or move that allocation's future rewards.

A payout-wallet change checkpoints the old configuration before it updates one allocation. Accrued rewards remain
claimable by the old wallet. Only later rewards use the new wallet. The new wallet does not need to accept, and it may
already own another allocation.

Programmable's disclosed CTO authority may replace the complete future reward configuration after the vault checkpoints
the old configuration. A CTO cannot move historic rewards, change swap fees, change the Programmable share or touch
token and liquidity custody. Each change emits the previous and next configuration hashes, epoch and approval reference.

No deployer, keeper, other beneficiary or platform wallet can claim another wallet's creator rewards.

## Accounting and rounding

Swap callbacks perform constant work. Creator fees accrue once per pool in the hook. Recipient iteration never occurs
during a swap.

The first beneficiary through the penultimate beneficiary receives:

`floor(total received * share / 10,000)`

The final active allocation receives the remainder after those cumulative allocations. This makes rounding deterministic
and conserves all creator-fee wei.

Every checkpoint credits claimable balances before a payout-wallet or CTO configuration change takes effect. Claims zero
the caller's checkpointed balance before sending ETH. This prevents double claims and preserves historic entitlement
across configuration epochs.

The vault counts only ETH redeemed from the registered hook. Forced ETH is excluded from reward accounting. Its `receive` function accepts ordinary transfers only from the immutable PoolManager.

## Call and trust boundaries

- Pool registration is bound to the creator recorded by the launched UERC20.
- A reward vault must be deployed and recorded by the immutable vault factory and must match the hook, PoolManager and pool ID.
- Hook deployment must satisfy the exact Uniswap v4 permission-bit mask.
- Only the registered vault may redeem creator fees from the hook.
- Only the immutable launcher-fee recipient may claim or redirect the Programmable portion.
- The next Mainnet release binds that recipient directly to
  `0x4957f49620AFf3Adbbe8195a4f633E49cc93376c`.
- Only the disclosed CTO authority may replace future creator-reward allocations.
- Claims and payout changes use OpenZeppelin `ReentrancyGuardTransient`.
- State is updated before the untrusted payout call.
- A reverting payout reverts only that beneficiary's claim and does not block another beneficiary.
- Matching counterfactually predeployed vaults and position recipients are reused. Unknown code or unmatched factory configuration is rejected.

There is no proxy, owner, administrator, pause, blacklist, mint authority, fee setter, recovery function or beneficiary-reward sweep.

## Permanent liquidity behavior

Classic retains the existing one-sided position policy:

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
- Five beneficiaries, uniqueness, positive shares and exact totals.
- One-step payout changes, duplicate payout destinations and future-only reward redirection.
- CTO checkpoints, future-only configuration replacement and two-step authority transfer.
- Every unauthorized claim and payout-change path.
- Reverting payout isolation, no double claim and no cross-vault claim.
- Fuzzed fee arithmetic and split conservation.
- Stateful native-claim accounting, reward conservation, active-share and immutable-dependency invariants.
- A lifecycle against code-hash-pinned Ethereum mainnet PoolManager, PositionManager, Universal Router, Permit2,
  Quoter, UERC20 factory and the deployed Programmable position-forwarder factory.
- Regression execution of the existing contract suite.

The Slither 0.11.5 review is recorded in `security/slither-results-classic-v3.json`. Individual source-target runs covered
the hook, launcher, reward vault, CTO authority, launch policy, vesting wallet and their factories. The report records the
raw detector categories and the disposition of each finding; it does not replace the findings with an empty success
object. The launcher produced one reviewed reentrancy-balance warning, one reviewed strict-equality warning and timestamp
noise. The hook/factory compilation produced Slither's false `BaseHook.getHookPermissions` report. Dependency pragma
differences are informational.

Architecture and authorization diagrams are in `security/diagrams/classic-v3`.

## Release evidence and limitations

The exact deployment commit, compiler settings, constructor arguments, salt,
addresses, runtime hashes and transaction receipts are recorded in the release
manifest. Etherscan and Sourcify match all seven contracts. The small-value Mainnet
lifecycle verified launch, permanent position custody, buy, sell and both fee-claim
paths.

This is still not an independent audit. Scanner and indexer support for directional
v4 hook fees varies, so a third-party interface may show incomplete fee information
even when the onchain disclosure is correct.
