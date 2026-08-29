# DEX EVM architecture baseline

## Target enabled-binding authority boundary

The Engine and settlement arrows in this diagram are unreachable in the
current sentinel Core. Its reachable surface is descriptor registration,
deterministic vault creation and a protected-execution entry that hard-reverts.

```text
explicit Principal authorization
              |
              v
       immutable Core ---- CALL ---- untrusted Engine
              |                         |
              | validates typed         | arbitrary state and calls
              | protected effects       | with Engine-owned authority
              v                         v
      isolated DomainVaults        bounded opaque result
```

In a future enabled binding, Core is the only component that may commit protected custody, Principal spend,
Protocol Assessment, Core-native liability, or Receipt state. An Engine is not
sandboxed. Containment comes from withholding protected authority: no
`delegatecall`, approval, signer role, arbitrary target/calldata primitive,
callback capability, router authority, or access to another DomainVault is
conferred.

## Immutable deployment

The Core deployment binds one Constitution, Core major, chain, and Collector
address. It has no proxy, beacon, diamond, implementation pointer,
owner, configuration setter, fee setter, pause, quarantine, rescue, sweep,
forced migration, or mutable protected-profile registry. A new protected
authority primitive requires a new side-by-side Core major.

The pinned Draft does not currently permit the protected execution interface
to be frozen without inventing portable semantics. The candidate Core exposes
only unambiguous identity, descriptor, code-authentication, and deterministic
vault foundations. On the immutable deployment chain, protected execution
reverts with the stable binding-local fail-closed sentinel
`DEX_EVM_SPEC_PROTECTED_EXECUTION_GRAMMAR_V1`; after chain-ID drift it first
reverts with `DeploymentChainIdMismatch`. The binding-local sentinel covers the
twelve recorded portable gaps; it is not a thirteenth gap or a
Protocol-assigned issue ID.

## Identities

Native identities are domain-separated and bind their complete authoritative
descriptor. In particular:

- an Engine Revision binds chain ID, Engine address, runtime code hash, exact
  interface/selectors, code policy, immutable-configuration commitment,
  dependency-policy commitment, and capability-profile commitment;
- an authority-relevant Market change creates a new Market ID. A separate
  authority-bearing Market Revision ID does not exist in the portable model;
- a Domain Revision binds admission, custody, exit, authority, and immutable
  policy commitments; and
- a DomainVault identity binds `(Core, Domain Revision, Asset Profile, native
  Asset)` and is deployed deterministically.

Entry runtime code hash proves only entry code. It does not prove storage,
proxy implementation, configuration, or external dependency immutability. The
foundation's explicitly named entry-codehash-only policy therefore permits a
proxy-shaped Engine to be registered, but registration grants no authority and
protected execution remains hard-reverted. No `CORE_ENFORCED` immutability or
proxy-rejection claim is made.

## Custody

Each Domain/asset tuple rests in its own immutable DomainVault. The vault:

- accepts commands only from its immutable Core;
- exposes fixed typed operations;
- never calls arbitrary target/calldata;
- never approves an Engine, router, or arbitrary dependency;
- has no administration, sweep, rescue, or migration path; and
- measures physical pre/post balances under an exact Asset Profile.

This is a structural foundation, not usable custody in this release. The
immutable sentinel Core has no vault-command call site. Native ETH reaching a
canonical vault has no release path; ERC-20 balances have no release path
controlled by this Core, although unsupported token or issuer behavior could
change them externally. Do not fund the vaults, deploy this sentinel for
custody, or present its predicted addresses as usable custody. Resolving the
portable gaps later cannot add an exit path to this Core deployment.

The first profiles are native ETH and strict measured ERC-20. The ERC-20
profile requires exact requested source debit and exact spendable destination
credit. At transfer time it rejects false, empty, malformed or oversized return
data and any observed debit/credit mismatch. ERC-721, ERC-1155,
fee-on-transfer, rebasing, callback, permissioned, upgradeable,
deceptive-balance, confiscatable and issuer-managed assets are unsupported; the
foundation does not claim to reject every such asset at admission.

## Protocol Assessment

The independent evaluator and Solidity library implement only the unambiguous
unsigned 128-bit arithmetic:

```text
A(B) = B / 2,000
fee_delta = A(B_after) - A(B_before)
```

The six-field grouping, refund causality, funding movement, and Receipt mapping
remain execution-layer concerns. A pure arithmetic pass is not an assessment
coverage or funded-liability claim.

## Execution state machine target

The intended binding phases remain:

```text
AUTHENTICATE -> ENGINE -> VALIDATE -> SETTLE -> POSTCHECK -> COMMIT
```

The lock is active before the first hostile call. All nested mutating entries
are rejected. Engine, wallet, token, recipient, and profile calls require fixed
gas and copied-data caps plus a terminal Core reserve. Nonce, fill, accounting,
and Receipt state commit only after all physical and logical postconditions.

That design is retained as the target, but the affected ABI and storage slots
are intentionally not frozen while the recorded portable issues are open.
