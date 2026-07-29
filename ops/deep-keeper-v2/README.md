# Deep V2 keeper boundary

This directory isolates Deep V2 operations from the historical Deep V1
release. It reuses the existing keeper execution core only after a separate V2
configuration, release gate, five-minute slot and storage fence have passed.

## Activation model

Deep V2 remains disabled until both of these checked-in files are complete:

- `contracts/deployments/mainnet-deep-full-range-v2.json`
- `ops/deep-keeper-v2/reviewed-release-binding.json`

The deployment manifest contains provider and lifecycle evidence. The reviewed
binding independently pins the release identity, source commitment, automation
address and runtime, and keeper executor address, runtime and source. A
generated manifest cannot certify itself.

The manifest schema is V2-only: `schemaVersion: 2`,
`keeperReleaseVersion: deep-keeper-v2` and
`keeperCompatibilityStatus: verified-deep-v2`. Its fixed policy must exactly
match the onchain Deep V2 policy.

The gate also requires:

- Ethereum Mainnet and two independent HTTPS read RPCs
- exact runtime hashes for automation and the keeper executor
- exact Etherscan and Sourcify source matches
- successful deployment receipts
- one confirmed actionable keeper compound
- one observed no-action cycle that submitted no transaction
- an immutable five-minute interval
- a dedicated Privy policy wallet
- no unresolved release blockers

## Concurrency

`lease.mjs` grants one invocation a monotonically increasing generation and an
opaque fencing token. Ownership and boundary state share one compare-and-swap
control record, so a takeover and a state write cannot cross between two Blob
objects. `core.mjs` rechecks the fence before every durable state write and
immediately before every remote signer call.

An empty scan returns `idle`, records the completed five-minute eligibility
slot and never asks the wallet to sign. A second invocation in the same slot
returns `not-due`. Five minutes is a polling and cooldown boundary, not a
guarantee that a transaction will execute at that time.

## Route status

`/api/ops/deep-v2-keeper` is an authenticated, fail-closed release scaffold.
Vercel polls it every five minutes while the historical V1 cron remains
unchanged. The V2 route returns `503` and does not create a signer when the
deployment manifest is absent, the independently reviewed binding is pending,
the lifecycle or source evidence is incomplete, or the dedicated V2 provider,
storage and Privy policy-wallet configuration is unavailable.

After those release gates pass, each invocation acquires the V2-only fenced
control record. The execution core then checks both Mainnet RPCs at one
confirmed snapshot, including the automation and executor runtime hashes and
their immutable binding, before any remote signer call is possible.

The five-minute cron is only a poll and eligibility cadence. It does not
guarantee a compound or transaction every five minutes. A slot with no
eligible work is recorded without signing, and a repeated call in the same
slot returns `not-due`.
