# Test plan

## Executed local coverage

The current prototype has local unit, integration, fuzz and invariant coverage. Exact commands, revision, versions and counts belong in `evidence/test-evidence.json` after the evidence-origin commit is created.

| Area | Executed cases |
| --- | --- |
| Hook/contracts | Foundry coverage includes PoolManager authentication, PoolKey admission, mask, all four quadrants, floor and 3% rates, exact-output rounding, partial-fill rejection, fragmentation resistance, liability conservation, complete custom-leg event fields, claims, cross-pool isolation, vault delay/caps/replay/pause, typed CCTP forwarding, hostile-messenger rollback, automatic cumulative payments, option-A allocation and exact one-wallet Ethereum role binding, treasury vesting, exact LP identity/timelock, the real Uniswap PositionManager atomic launch and late-failure rollback, plus the complete deploy/swap/bridge/return/payout lifecycle. |
| Domain | Proportional top-holder allocation, exclusions, largest remainder, cycle transitions, 75/25 pack policy, stale data, pack cap, payout gas threshold and max-40 batches. |
| Integrations | CCTP route/fee mode and ATA setup; Collector machine normalization, turbo recipients, missing key and secret-free errors; crash-safe source-burn, memo, pack, buyback and completion reconciliation; real legacy Solana transaction parsing with exact domain, signer, program, memo, mint, amount and recipient checks; durable replay rejection and signer-output verification. |
| Indexer | Block replacement, disconnected branch rejection, time-weight integration, mint/burn, log ordering and window bounds. |
| Rewards | Deterministic roots, cumulative unpaid accounts, tamper rejection, empty-root rejection, JSON serialization, Solidity/JavaScript golden vector, atomic artifact storage and automatic max-40-recipient publication. |
| Operator/API | End-to-end simulated cycle, completed-cycle replay, stale fail-close, durable restart at every external boundary, public projections, immutable artifacts, GET-only behavior and secret-free failures. |
| Website | Production build, complete server rendering, accessibility/prototype language, metadata freeze and lint. |

## Required before a Programmable application

- Preserve the owner-approved option-A allocation, vesting and LP-lock invariants and rerun repository-aware preflight for the exact revision.
- Preserve the currently clean deterministic dependency/source closure on the exact candidate revision.
- Rerun `forge fmt --check`, `forge build`, all tests, bytecode/initcode size and gas reports after the final evidence-origin commit.
- Rerun Slither and refresh every disposition after any Solidity source change.
- Rerun the pinned Ethereum fork plus current-head smoke against exact reviewed PoolManager, USDC and CCTP deployments; no router is included in this submission.
- Mine/reproduce the CREATE2 launcher, token and hook addresses; bind the final launcher init code; and prove the child hook has mask `0x20cc` with final constructor arguments.
- Bind exactly one Privy Ethereum wallet to every Ethereum role and one Privy Solana wallet to the Solana destinations; verify exact wallet/policy IDs and hashes, reject legacy Safe/third-wallet fields and recompute every derived address and timestamp before rehearsal.
- Add malicious ERC-20, failed recipient, claim/remainder and ERC-6909 aggregate solvency adversarial cases if independent review requests them.
- Preserve operator crash tests at every external boundary, including accepted-but-not-journaled CCTP/Collector/reward publication.
- Preserve the executed signer-policy cases for wrong chain, recipient, mint, amount, signer, program, memo, blockhash, replay after restart and raw-signer message mutation.
- Prove allowlist rotation/revocation and actual provider transaction compatibility in a supervised sandbox canary after written Collector permission; do not relax the parser to accommodate an unreviewed payload.
- Add live sandbox canaries only after written Collector permission; never use production secrets in untrusted test code.

## Mainnet lifecycle tests

- Run `pnpm --filter @hookemon/operator preflight:mainnet` with exact public receipts and independently supplied RPC/Privy/PostgreSQL observations; require a secret-free `MAINNET_PREFLIGHT_READY` receipt before any signer adapter is constructed.
- Reject wrong chain IDs, dependency/runtime code, Privy wallet/policy hash, undisclosed third wallet, Solana ATA/programs, CCTP route, reserve/gas balance or database lock.
- Keep the Render Blueprint on manual deploy with one readiness worker. Do not treat the readiness monitor as production transaction execution.
- `HookemonAtomicLauncher` conserves the full allocation table, retains no token or USDC and rolls back all children, registration and transfers after a late mint failure.
- Treasury vesting releases zero before day 365, 25% at the cliff and 100% at day 1,460 only to the bound Ethereum wallet.
- The canonical position timelock accepts only the exact reviewed token ID whose PositionManager PoolKey derives the reviewed PoolId; decoy token IDs and decoy pools revert, and release is impossible before day 730.
- Canonical PoolKey, sorted currencies, fee, tick spacing, initial price and hook address match the reviewed plan.
- `HookemonDeploymentPlan:v4` requires the same Ethereum wallet for every Ethereum role, derives the canonical PoolId, binds exact LP identity and derives the atomic launcher from its deployer, salt and init-code hash; any second Ethereum authority or mismatched executable identity is rejected.
- LP position identity, owner/lock, fee collection and removal/retirement rules match public disclosure.
- Buy and sell, exact input and exact output quotes match final receipt deltas and disclosed 3%/0.30% components.
- `0 selected` yields 10 bps Programmable and zero project; `3% selected` yields exactly 10/290 bps.
- Split swaps and owner claims do not change cumulative component entitlement.
- Each bridge direction reconciles source burn, attestation/forwarding and destination mint for the same native USDC amount.
- Each Collector memo reconciles machine, funds recipient, NFT recipient, opened pack, buyback and returned USDC.
- Reward root, funded amount, public artifact and onchain payments reconcile at one confirmed epoch.
- Guardian pause and operator outage leave trading, LP exits, fee claims and historic entitlement behavior exactly as declared.

## Product and operations tests

- API cache/freshness behavior, rate limiting at the hosting edge and large top-200 artifact response size.
- Website responsive layouts, keyboard focus, reduced motion, screen reader names, stale/error states and truthful simulator/live labels.
- Indexer full backfill, deep reorg drill, provider disagreement, lag alert and confirmed-read reconciliation.
- Monitoring alerts for liability deficit, vault cap, stuck bridge, stale catalog, memo mismatch, payout delay, signer gas and root-funding mismatch.
- Runbook drill for compromised Collector key, Privy app/authorization credentials, Ethereum policy and Solana policy, including credential revocation and reviewed rotation.

## Evidence semantics

A local pass proves only the recorded command and revision. It does not prove an audit, deployment, live fee collection, source/runtime match, Collector permission, Programmable acceptance, Uniswap routing or availability. Skipped or unavailable checks stay explicit blockers.
