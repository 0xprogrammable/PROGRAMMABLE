# Programmable DEX EVM security properties

## Status and scope

This document states the security properties of the architecture baseline. It
is not an audit, deployment report, proof or production guarantee. The exact
Protocol lock is Draft and not production eligible; protected execution is
`BLOCKED_BY_SPEC` and `CoreV1.executeProtected` always reverts.

The only currently reachable mutation surface registers immutable descriptors
and creates deterministic vaults. Registration grants no protected authority.

## Trust model

Assume that Engines, submitters, wallets, tokens, recipients, routers, RPCs,
indexers, explorers, sequencers and external dependencies can be malicious,
incorrect, unavailable or mutually inconsistent. Core immutability does not
make any of them immutable or trustworthy.

The design can bound authority; it cannot prove fair price, economic quality,
asset legitimacy, profitability, legality, sequencer neutrality or Engine
solvency. A transition inside a Principal's exact authority can still be a bad
trade.

## Properties enforced by the foundation

### F-1: immutable Core identity

The Core fixes Constitution, Collector address, deployment chain and Core major
in its constructor. It has no owner, proxy or setter for those values. A
different value requires another Core deployment and identity. The source does
not prove that code, dependencies or an ultimate beneficiary behind the
Collector address are immutable. Every mutation entry also requires the runtime
chain ID to equal the immutable deployment chain ID, so a chain-configuration
drift cannot mix descriptor or vault identities.

### F-2: fail-closed protected execution

Every call to `executeProtected` reverts. On the immutable deployment chain it
uses the binding-local protected-execution blocker; after chain-ID drift it
first uses `DeploymentChainIdMismatch`. No Envelope bytes are interpreted, no
Engine is called, no vault is commanded and no protected state is committed.

### F-3: registration grants no authority

Engine, Market and Domain descriptor registration is permissionless and
idempotent by derived identity. `MarketCreated` and `DomainRevisionCreated`
record the caller as `creator`; Engine registration and vault creation events do
not. A recorded creator is evidence of the caller only, not ownership,
endorsement or admission.

### F-4: entry-code authentication is narrow

Engine registration and authentication compare the entry address runtime code
hash to the descriptor. The admitted policy permits proxy-shaped code and does
not prove storage, configuration, implementation, beacon, facet, library or
dependency immutability. Opaque commitments are not interpreted or enforced.

### F-5: isolated vault command authority

Each DomainVault fixes Core Deployment, Domain Revision, Asset Profile and
native asset. Only its immutable Core may call typed transfer methods. The vault
has no owner, arbitrary-call primitive, approval, rescue, sweep or migration.
For this sentinel Core, native ETH in a canonical vault has no release path and
ERC-20 balances have no release path controlled by Core because it contains no
vault-command call site. Unsupported token or issuer behavior is outside that
claim. Do not deploy it for custody or fund its vaults.

### F-6: exact point-in-time transfers

Native ETH and strict ERC-20 primitives require exact observed source debit and
destination credit under bounded external calls. The ERC-20 profile also
requires canonical 32-byte return values and a matching token entry code hash.
These observations do not prove future or historical asset behavior.

### F-7: nested foundation mutations fail

The mutation lock rejects nested mutating entry and committed-evidence reads
during an active phase. A future protected executor must preserve the lock
before its first hostile call; this document does not claim that unimplemented
path has been verified.

## Required but not currently implementable properties

The intended binding additionally requires the most restrictive authority
intersection; exact Principal source binding; derived occurrence identities;
bounded one-shot target execution; complete Effect validation; isolated
physical/logical accounting; funded Protocol Assessment; no hidden deficit;
atomic postchecks; and reconstructible normalized Receipts. The twelve issues in
the [Protocol gap report](../../packages/dex-evm/binding/reports/protocol-gap-report.json)
prevent those rules from being implemented uniquely.

These are blockers, not accepted risks. No native workaround may be represented
as portable conformance.

## Threat scenarios

| Threat | Minimal attempt | Required result in this baseline |
| --- | --- | --- |
| Malicious registrant | Registers hostile or proxy-shaped Engine code | Descriptor may register if entry checks pass; it gains no authority and protected execution remains reverted |
| Proxy implementation change | Keeps proxy entry code while changing implementation | Entry hash can remain equal; no immutability claim is made and no protected execution is allowed |
| Reentrant recipient/token | Calls Core during a bounded transfer | Only-Core vault checks and Core mutation lock must reject nested mutation; current protected path never reaches transfer |
| Taxed/over-debit ERC-20 | Debits or credits a value different from request | Strict measured transfer reverts atomically |
| Malformed token | Returns empty, false or oversized data | Strict measured transfer reverts atomically |
| Async confiscation then donation | Balance 100 becomes 80 then 100 before observation | Historical deficit is unprovable; asset/profile claim remains blocked and unsupported |
| Forged indexer event | Uses wrong Core, topic or header | Authenticated indexer configuration must reject it |
| L2 reorg | Replaces buffered canonical blocks | Roll back the retained branch or stop for checkpoint reconciliation |
| Finality overclaim | Labels confirmation depth as Ethereum finality | Reject the label; require an external authenticated finality policy |
| Fake release evidence | Uses placeholder address or successful build as deployment/conformance | Reject the claim and keep the evidence axis absent |

## Verification obligations for a future enabled release

Before protected execution can be enabled, require unit, fuzz, invariant,
adversarial, differential and portable vector evidence against an exact source
tree and reproducible compiler; independent security review; exact native
profile claims; contract-size and gas ceilings; a complete Binding Release and
Conformance Report; and resolved Protocol production eligibility. Deployment,
source verification, runtime readback, indexer operation and parent-chain
finality each need separate post-deployment evidence.

See the [architecture guide](../dex-evm/ARCHITECTURE_BOUNDARY.md),
[Asset Profile guide](../dex-evm/ASSET_PROFILES.md) and
[deployment guide](../dex-evm/DEPLOYMENT_AND_VERIFICATION.md).
