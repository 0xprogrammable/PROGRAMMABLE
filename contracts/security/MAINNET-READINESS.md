# Classic mainnet readiness

Current state: **Mainnet blocked by design; Sepolia rehearsal verified**.

| Environment | Manifest state | Release meaning |
| --- | --- | --- |
| Ethereum mainnet | `not-deployed` | No launch or trade transaction can be prepared |
| Ethereum Sepolia | `ready` | Current atomic Dev Buy release and lifecycle are independently reconciled |

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
- Official deployment registry and pinned runtime snapshot validation

These are repository-level implementation and test properties. They are not Mainnet deployment evidence or third-party assurance.

## Sepolia evidence

The current Classic launcher, hook and hook factory are source-verified on Sepolia. Its signed lifecycle launched an official UERC20 v2 token with nonempty dynamic `bytes extraData` and a 0.0006 ETH atomic creator buy, authorized the official Universal Router through Permit2, sold, and claimed both creator and Programmable native ETH fees.

Two independent RPCs reconcile all five receipts, runtime hashes, token provenance, fee math, balance deltas, canonical pool state and permanent position custody. Four Blockscout records confirm source verification. The current Sepolia manifest is `ready`.

The older lifecycle that used the legacy fourth metadata field remains separately marked `historical-invalid-metadata-abi` with `releaseEligible: false`. Its addresses and receipts are retained in [`../DEPLOYMENT.md`](../DEPLOYMENT.md) for historical traceability and cannot enable transaction preparation.

## Required before Mainnet

1. Freeze the exact release commit and preserve passing unit, fuzz, invariant, fork, static-analysis and remote CI evidence
2. Rerun the proven V4Quoter, Universal Router and Permit2 lifecycle after that exact release commit is frozen
3. Rehearse the public buy and sell flow against the ready deployment on an allowed production wallet origin
4. Productionize event and StateView reads with durable indexing, reconciliation, confirmation policy and availability controls
5. Add live alerts, named incident owners and a rehearsed response process
6. Fund the owner-approved deployer only after reviewing a fresh gas ceiling
7. Recheck the approved deployer nonce and balance, official deployment records, dependency runtime bytecode and predicted-address vacancy immediately before signing
8. Bind the frozen source commitment to the machine-readable Mainnet evidence, run a fresh read-only simulation and review all four zero-value transactions
9. Obtain explicit approval for the exact gas ceiling and broadcast, then source-verify the deployment and run a low-value monitored canary before enabling public preparation
10. Complete legal review for platform operation and exclude unsupported securities, RWA and custody claims
11. Resolve or explicitly accept the 2026-07-27 `npm audit --omit=dev` result: 23 production dependency entries in the Uniswap SDK graph, comprising 15 low, 6 moderate and 2 high severities. A forced breaking version change must not be applied without compatibility review

## Owner decisions

- Final funding amount and maximum Mainnet fee ceiling
- Explicit approval for the reviewed four-transaction broadcast and later public enablement
- Incident-response and public-communication owners

## Frontend gate

The public form always normalizes to Classic. The server accepts no target address or calldata from the browser. It verifies the deployment manifest, runtime code, factory provenance, immutable dependencies, treasury, hook mask, fee constants, the 0.0006 ETH minimum Dev Buy, predicted token address and exact selected call value before simulation.

Launch and trading preparation remain disabled while Mainnet is `not-deployed`. Sepolia preparation is enabled only when the application is explicitly configured for the verified rehearsal environment; it never silently replaces the production manifest.

The absence of an external audit leaves additional residual smart-contract risk. Product and release copy must not describe the system or any launched token as audited, safe, unruggable, scam proof or guaranteed compatible with third-party scanners.
