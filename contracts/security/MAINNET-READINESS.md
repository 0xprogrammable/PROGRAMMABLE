# Classic mainnet readiness

Current state: **Sepolia V2 verified; Mainnet V2 monitored; public release blocked by owner gates**.

| Environment | Manifest state | Release meaning |
| --- | --- | --- |
| Ethereum mainnet | V2 deployed, lifecycle pending | Source and deployment evidence are current; public preparation remains disabled |
| Ethereum Sepolia | V2 ready | Test2 lifecycle and source evidence are current; V1 lifecycles are historical |

There has been no external smart-contract audit or public contest.

## Implemented engineering

- One public composition: Classic
- Official UERC20Factory v2.0.0 dependency pinned to commit `6f18f1cdf80dc173d33d3cd6bbe91ee52c314f68`
- Exact UERC20 metadata tuple `(string description,string website,string image,bytes extraData)`
- Payable atomic launch with one creator-selected Dev Buy of at least 0.0006 ETH, no creator liquidity deposit and no protocol launch fee
- Fixed one-billion-token supply and no creator or Programmable allocation at issuance; initial-buy tokens go directly to the creator
- Complete token supply in one permanently locked, one-sided v4 position
- Opening tick 204200 and starting FDV of `1.355657760817103798 ETH`
- Total hook fee restricted to whole 1–10% steps
- Fixed 0.10 percentage-point Programmable share deducted from the selected total
- Native ETH accrual across exact-input and exact-output swap directions
- Native-specified partial fills revert
- Permissionless fixed-recipient claims and recipient-authorized recovery claims
- Canonical-pool isolation and alternative-pool bypass tested and documented
- Stateful accounting invariants and security regression tests
- Server-owned launch ABI, deployment selection, calldata construction and simulation
- Direct exact-input trading path using V4Quoter, Universal Router v2.0 and Permit2
- Confirmation-delayed event and StateView read model for Explore and Profile
- Private five-minute durable snapshot with full confirmed replay and dual-RPC agreement
- Scheduled reorg-aware invariant monitor with durable cursor, evidence artifacts and automatic incident issues
- Official deployment registry and pinned runtime snapshot validation

These include repository-level properties plus current provider-backed operating evidence. They do not replace
third-party assurance or guarantee future service availability.

## Sepolia evidence

The recorded V2 Classic launcher, hook and hook factory are source-verified on Sepolia. Its signed Test2 lifecycle launched an
official UERC20 v2 token with nonempty dynamic `bytes extraData` and a 0.0006 ETH atomic creator buy, authorized the
official Universal Router through Permit2, sold, and claimed both creator and Programmable native ETH fees.

Two independent RPCs reconcile all five receipts, runtime hashes, token provenance, fee math, balance deltas, canonical
pool state and permanent position custody. Four Blockscout records confirm source verification. The V2 Sepolia manifest
is `ready`; the earlier V1 deployment and lifecycle remain historical because V1 cannot emit the V2 disclosure events.

The older lifecycle that used the legacy fourth metadata field remains separately marked `historical-invalid-metadata-abi` with `releaseEligible: false`. Its addresses and receipts are retained in [`../DEPLOYMENT.md`](../DEPLOYMENT.md) for historical traceability and cannot enable transaction preparation.

## Required before public launch

1. Rehearse the final transaction review after public preparation receives explicit owner approval
2. Move the full-replay index to incremental checkpoints before event volume approaches the function-duration budget
3. Assign primary and backup incident owners and rehearse the response process with them
4. Keep the two-RPC monitor and durable index healthy before enabling public preparation
5. Complete legal review for platform operation and exclude unsupported securities, RWA and custody claims
6. Approve Privy billing details and possible MAU overage before upgrading the app from Development
7. Keep the scoped OpenZeppelin 4.9.6 Universal Router SDK override covered by tests. The 2026-07-27 production audit
    has zero critical, high or moderate findings; 19 low-severity `ethers` v5/`elliptic` findings remain without a
    compatible upstream fix

## Owner decisions

- Privy billing approval and later public enablement
- Incident-response and public-communication owners

## Frontend gate

The public form always normalizes to Classic. The server accepts no target address or calldata from the browser. It verifies the deployment manifest, runtime code, factory provenance, immutable dependencies, treasury, hook mask, fee constants, the 0.0006 ETH minimum Dev Buy, predicted token address and exact selected call value before simulation.

Launch and trading preparation remain disabled while the selected release lacks current lifecycle evidence. Sepolia V2
preparation is enabled only when the application is explicitly configured for that verified rehearsal environment.
Mainnet V2 lifecycle evidence and production operations are current, but the production manifest deliberately remains
fail-closed pending named incident ownership, Privy production billing approval and final owner release approval.

The absence of an external audit leaves additional residual smart-contract risk. Product and release copy must not describe the system or any launched token as audited, safe, unruggable, scam proof or guaranteed compatible with third-party scanners.
