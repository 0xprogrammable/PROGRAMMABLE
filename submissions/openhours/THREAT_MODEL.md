# Threat model

## Assets and trust boundaries

- Mock RWA and mock quote have no affiliation, backing, legal claim or production value. Test minting is outside the deployed concept.
- PoolManager holds AMM liquidity and the hook's ERC-6909 quote claims. Core pool liquidity is never hook reserve backing.
- EpochRedemptionVault holds pre-funded quote reserves and queued RWA. Its accounting must remain solvent by asset.
- The registrar, issuer, NAV signer, Programmable fee owner and zero-share project fee owner are immutable and have disjoint capabilities.
- A future real token may pause, blacklist, freeze, confiscate, upgrade, mint or charge transfer fees. OpenHours cannot override those external controls.

## Hook boundary

Only the immutable PoolManager may enter callbacks, and every callback verifies the exact canonical PoolKey. Hook data is ignored. The hook never calls the vault, signer, API or oracle during a swap and exposes no same-pool swap path. A full or closed queue selects the maximum sell LP fee but does not intentionally reject trading.

The only `updateDynamicLPFee` call site is the registrar-only, one-shot registration path immediately after self-initialization. PoolManager permits the call because the hook itself is the caller; non-hook actors fail Core authorization. If initialization or the hardcoded 3,000-pip update fails, canonical hook state, vault binding and PoolManager initialization all revert. A second registration fails before another write. There is no persistent updater, keeper path, pressure-update write, or arbitrary external fee mutation.

The exact five-bit permission mask is `0x20cc`; `afterInitialize` is disabled. Core suppresses `beforeInitialize` for canonical hook-self-initialization, so that callback is not treated as registration logic. It remains enabled to reject external alternate-pool initialization. CREATE2 mining and registration reject wrong hook bits, assets, dynamic flag, tick spacing, vault binding, registrar or second registration. All failures revert the parent transaction.

## Fee accounting threats

The fee basis is actual gross quote volume across four quadrants. Specified-quote partial fills revert; unspecified quote uses the executed delta. Gross positive amounts below 1,000 quote base units revert to prevent fee fragmentation. Independent cumulative remainder streams prevent repeated accepted small swaps from evading lifetime fees.

Liabilities are isolated by PoolId, currency and immutable owner. The hook's total accrual must equal project plus Programmable liability and be covered by its PoolManager quote-claim balance. Only `0x4957f49620AFf3Adbbe8195a4f633E49cc93376c` may claim the Programmable liability, to a nonzero destination selected for that claim. No admin, rescue, sweep, mutable recipient or cross-pool netting path exists. Liability is zeroed before claim unlock; a failed burn or transfer reverts it.

## Epoch threats

- Underfunding is prevented with ceiling reserve math at maximum NAV and exact incoming balance deltas.
- Queue overfill, zero/dust receipts, late deposits and early cancellation revert.
- Reports bind chain, vault, PoolId, epoch, both assets, NAV band and both deadlines under EIP-712; EOA and ERC-1271 signers are accepted through SignatureChecker.
- A compromised signer can choose only an in-band NAV and cannot withdraw reserve. A missing report expires to exact RWA recovery.
- A compromised issuer can stop future epochs or choose future bands and capacity, but cannot change a live epoch or withdraw unresolved liabilities.
- New epochs may open after the prior queue closes; accounting remains per epoch.

## Hostile token and reentrancy behavior

Fee-on-transfer quote funding and RWA queueing are rejected by exact balance checks. False-return transfers revert through SafeERC20. Paused or blacklisted payout transfers fail without consuming the receipt. Reentrant token callbacks cannot duplicate settlement because state is updated before transfer and guarded transiently. These controls cannot guarantee liveness for a production token whose issuer deliberately blocks transfers.

## Manipulation, indexing and operations

Next-block pressure activation prevents the same transaction or same block from queueing and receiving the changed LP fee. It does not prevent strategic manipulation by an actor willing to irrevocably lock real RWA. Queue closure remains timestamp-driven and keeper-independent.

An indexer must order logs by block, transaction and log index; handle reorg rollback and full backfill; and reconcile event-derived liabilities with confirmed balances and views. No live indexer or monitoring service is included. The incident response is to stop future epoch construction and publish the exact affected identities while preserving contractual claim and expiry paths; there is no pause or rescue switch.

## Residual risk

Local tests and structural checks are not an audit. Mainnet PoolManager runtime was observed read-only at one block, but source matching is not asserted. MEV, stale quotes, external token controls, signer compromise within the NAV band, integration bugs and unavailable routing remain for independent review.
