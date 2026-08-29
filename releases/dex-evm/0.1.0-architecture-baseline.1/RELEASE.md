# DEX EVM 0.1.0 architecture baseline 1

This is a non-production architecture-baseline record. It is not a Binding
Release, Conformance Report, testnet candidate, production candidate or
deployment.

## Disposition

`BLOCKED_BY_SPEC`

This source-unbound architecture snapshot describes paths for immutable Core
identity, Engine/Market/Domain descriptors, deterministic DomainVault creation,
exact transfer primitives, assessment arithmetic, point-in-time
asset-foundation vectors and SDK foundation utilities. It does not prove that
those paths exist or pass at a particular Git revision; that requires a
separate revision-bound record. The asset cases make no Asset Profile or
lifetime token-behavior claim. The described protected execution path is a
deliberate hard-revert sentinel.

The described immutable sentinel Core has no vault-command path and no later
specification resolution can add one to that deployment. Native ETH sent to a
canonical vault has no release path; ERC-20 balances have no release path
controlled by this Core, while unsupported token/issuer behavior remains
outside the claim. Do not fund canonical-network vaults, deploy the sentinel
for custody or canonical use, or present its predicted vault addresses as
usable custody. Disposable local-only testing is a separate evidence class.

The exact Protocol lock is commit
`334bb26703a4dab18ce0fca8485c6275a879933a`, tree
`a0c4d7018eb810c35ac11cdd4e066cd92a6ee513`, specification
`programmable-protocol/0.1.0-draft.1`. It is Draft and
`production_eligible=false`.

## Evidence boundary

The [release record](release-record.json) binds the classification and exact
Protocol identity. The [evidence catalog](evidence-catalog.json) lists only
artifacts that exist and states what each proves and does not prove. No source
commit/tree is claimed because this record intentionally preserves an
architecture-snapshot classification rather than a source release. A later
committed artifact must use a separate revision-bound release record. No
fabricated digest, address, transaction or audit result is substituted.

The twelve specification counterexamples are in
[`protocol-gap-report.json`](../../../packages/dex-evm/binding/reports/protocol-gap-report.json).
They must be returned to the portable Protocol release coordinator; this native
release does not propose fixes.

## Network status

- Robinhood Chain mainnet: `BLOCKED_BY_SPEC`; no deployment/address evidence.
- Robinhood Chain Testnet: `PRE_OWNER_GATE_READ_ONLY_PREPARATION`, terminating
  at `BLOCKED_BY_SPEC`; no transaction package, owner signature,
  canonical-network broadcast or canonical-network deployment.

No independent audit or security contest has been completed.
