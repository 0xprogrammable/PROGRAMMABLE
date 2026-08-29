# Programmable DEX EVM guides

These guides describe the non-production EVM architecture baseline pinned to
Programmable Protocol commit
`334bb26703a4dab18ce0fca8485c6275a879933a`, tree
`a0c4d7018eb810c35ac11cdd4e066cd92a6ee513`, specification
`programmable-protocol/0.1.0-draft.1`.

The locked Protocol is Draft and sets `production_eligible` to `false`. Twelve
portable ambiguities prevent a strict Binding Release and Conformance Report.
In the current source, `CoreV1.executeProtected` always reverts. On the
deployment chain it uses `BlockedBySpec`; after chain-ID drift it first uses
`DeploymentChainIdMismatch`. Registration and descriptor creation grant no
protected authority.

## Guide map

- [Architecture boundary](ARCHITECTURE_BOUNDARY.md)
- [Engine authoring](ENGINE_AUTHORING.md)
- [Markets and Domains](MARKETS_AND_DOMAINS.md)
- [Asset Profiles](ASSET_PROFILES.md)
- [Protocol Assessment](PROTOCOL_ASSESSMENT.md)
- [Receipts, indexing, reorgs and finality](RECEIPTS_AND_INDEXING.md)
- [Deployment and verification](DEPLOYMENT_AND_VERIFICATION.md)
- [Protocol lock and conformance](PROTOCOL_LOCK_AND_CONFORMANCE.md)
- [Owner gate ledger](OWNER_GATE_LEDGER.md)
- [Security properties and threat model](../security/DEX_EVM_PROPERTIES.md)

The machine-readable Protocol lock is
[`packages/dex-evm/binding/protocol-lock.json`](../../packages/dex-evm/binding/protocol-lock.json).
The release-coordinator counterexamples are in
[`protocol-gap-report.json`](../../packages/dex-evm/binding/reports/protocol-gap-report.json).

## Evidence vocabulary

- **Implemented** means source exists in the reviewed worktree.
- **Test-executed** means the named command passed against that exact worktree.
- **Observed** means a dated read-only network query returned the recorded value.
- **Verified** means the named verification procedure was completed. It does
  not imply an external independent review.
- **BLOCKED_BY_SPEC** means the portable Protocol must decide the semantics; a
  native implementation is not allowed to invent them.
- **PRE_OWNER_GATE_READ_ONLY_PREPARATION** means only network observations,
  documentation, canonical-network-read-only checks and disposable
  locally-mutating fork tooling exist. No unsigned transaction payload or
  owner-gate package exists.
- An unsigned owner-gate package is a later, distinct evidence state and still
  does not mean signature, broadcast, deployment or testnet candidacy.

No guide turns a placeholder, missing address, successful compilation or public
RPC response into deployment, conformance, audit or production evidence.
