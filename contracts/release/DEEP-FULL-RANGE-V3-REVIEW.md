# Deep release candidate review

Review date: 2026-07-29
Public model: Deep
Contract release: `deep-full-range-v3`
Keeper release: `deep-keeper-v3-ops-v2`

## Verdict

The current source is suitable as a local release candidate.

It is not approved for Mainnet activation. The checked-in Mainnet manifest remains `not-deployed`, the application and keeper gates remain blocked, and transaction submission remains disabled.

This review is internal. It is not an external audit.

## Verified locally

- 86 focused Solidity tests pass across 14 suites.
- Both fee-conservation fuzz tests pass with 10,000 cases.
- Five stateful invariants pass 1,000 campaigns at depth 128, for 640,000 handler calls.
- Three tests pass against the pinned Ethereum Mainnet fork.
- The six-transaction deployment graph and all nine runtime identities pass their deterministic deployment tests.
- Fifteen release-manifest tests and fifteen operator tests pass.
- 87 keeper tests pass.
- 52 focused Deep application tests pass across launch, release, Explore, Profile and trading boundaries.
- The complete application test suite passes 682 tests.
- TypeScript, scoped ESLint and the optimized Next.js production build pass.
- Rendered Chrome checks pass at 924 by 998 and 390 by 844 with no horizontal overflow or application-console errors. The pending release shows Deep as unavailable, and its launch-confirmation endpoint returns a no-store 503 before any RPC access.
- The build verifies the exact keeper source commitment:
  `0x1828e9c3a25d5ba7c6e08f72f2ef0190cbc33c40e9b61a6fd216571c7151abd0`.
- The pending manifest passes its offline structure and source checks while remaining fail-closed.
- The official deployment registry verifies 24 active records and all six canonical Mainnet runtime hashes at block
  25,636,148. Newer upstream heads were reviewed without moving the frozen release pins: v4 Core and UERC20 Factory
  have no source changes in their consumed contract trees, while the two consumed v4 Periphery files add an event
  declaration and formatting only.

The production build statically includes the Deep release manifest and reviewed keeper bindings. It no longer relies on a broad runtime filesystem trace.

## Release boundaries

The contracts bind every vault to the original PoolId and expose no owner, upgrade, rescue, payout or liquidity-removal path. Ordinary swaps charge the fixed Deep hook fee. Growth fees can only be used by the registered vault for the authenticated same-pool compound path.

The keeper uses two independent RPC readers, a 12-confirmation common block, a durable fenced lease, one signer lane, one submission per five-minute slot, bounded batches, explicit gas and debit budgets, exact transaction persistence and fail-closed receipt reconciliation.

The deployment and canary consoles refuse to prepare wallet requests unless every executable operator input is tracked and the complete release worktree is clean. This prevents an uncommitted script, manifest or dependency-lock change from reaching the signer.

The application accepts Deep launches, profiles and trades only when the live manifest, reviewed binding, deployed runtimes, source commitment, keeper posture and release commit all agree. The configured application commit, contract release, reviewed binding and keeper policy must identify the same commit.

## Residual risks

- A distortion sustained for the complete same-pool oracle window can become the TWAP. Price limits and rolling exposure reduce the amount at risk but cannot remove this market assumption.
- Five minutes is the earliest eligible retry, not an execution guarantee.
- Permanent ownerless liquidity cannot be recovered if a latent defect is discovered.
- Keeper gas is externally funded. Oracle staging and compounding are separate actions and the complete lifecycle must not be described as self-funding.
- Permissionless execution can make a prepared keeper transaction stale and consume bounded signer gas. It cannot redirect fees or remove liquidity.
- Keeper state integrity depends on the private Blob store and its credentials in addition to the lease and ETag controls.
- The production dependency tree currently reports 20 low-severity findings through the official Uniswap SDK dependency chain to ethers v5 and `elliptic`. No upstream fix is currently available.
- No independent external audit, live Mainnet canary or production incident exercise has been completed.

## Mainnet activation gates

Mainnet remains blocked until all of the following are complete:

1. Freeze and publish one exact release commit.
2. Obtain explicit owner approval for deployment cost and wallet signatures.
3. Simulate and broadcast the reviewed six-transaction deployment.
4. Capture 12-confirmation receipts from two independent RPC providers.
5. Verify all nine runtime identities, constructor bindings and storage slots.
6. Complete exact Etherscan source verification and record the Sourcify v2 matches.
7. Run the bounded canary launch, mature the oracle and confirm one productive same-pool compound.
8. Confirm one idle keeper cycle sends no transaction.
9. Fund and policy-bind the dedicated keeper signer.
10. Promote the reviewed keeper binding and activate both submission flags.
11. Build and publish the application from the same release commit.

Until those steps are recorded in the manifest, Deep remains unavailable to normal users by design.
