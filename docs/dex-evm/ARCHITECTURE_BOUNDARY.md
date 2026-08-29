# Architecture boundary

## Product isolation

Programmable DEX EVM is an independent settlement track. It is not a Uniswap v4
hook, wrapper, router or launch model, and it does not use the repository's
legacy registry or deployed contracts as settlement authority. Its Foundry
package disables automatic remappings and its non-test Solidity import boundary is
restricted to [`packages/dex-evm`](../../packages/dex-evm/README.md).

## Components and authority

The intended architecture separates three roles:

```text
Principal authorization -> immutable Core -> isolated DomainVault
                                |
                                +-- bounded CALL --> untrusted Engine
```

Core is the only intended committer of protected custody, Principal spend,
Protocol Assessment, Core liabilities and Receipts. An Engine is untrusted and
not sandboxed; containment must come from never granting it Core, vault,
Principal or Collector authority.

The current baseline implements only the unaffected foundation:

- [`CoreV1`](../../packages/dex-evm/src/core/CoreV1.sol) fixes the Constitution,
  Collector, deployment chain and Core major at construction;
- [`NativeIdentityV1`](../../packages/dex-evm/src/core/NativeIdentityV1.sol)
  derives binding-local immutable identities;
- [`DomainVaultV1`](../../packages/dex-evm/src/core/DomainVaultV1.sol) is an
  immutable custody boundary controlled only by its Core; and
- [`ExecutionLockV1`](../../packages/dex-evm/src/core/ExecutionLockV1.sol)
  provides phase and nested-entry guards for the future execution path.

`executeProtected(bytes)` is a fail-closed sentinel. It accepts no Envelope
grammar and always reverts. Therefore no registration, Market creation, Domain
Revision creation or vault deployment grants protected execution authority.

## Immutability claims

Core and DomainVault use direct-construction, non-proxy designs with immutable
constructor bindings and no owner, implementation setter, rescue or sweep
path. If instantiated, they are deployed directly. This source topology is not
a canonical-network deployment claim, and it does not make an external Engine
or asset immutable.

The only admitted Engine code policy is
`entry-runtime-codehash-only`. Registration records an Engine address and its
entry runtime code hash; authentication rechecks that entry code hash. This
policy permits proxy-shaped entry code. It does **not** prove configuration,
storage, implementation, beacon, facet, library or dependency immutability, and
it does not interpret the descriptor's opaque commitments. A matching entry
code hash must never be reported as `CORE_ENFORCED` dependency immutability.

## Native identities

The binding-local identities are Keccak-256 hashes over fixed type strings and
ABI-encoded fields:

- Core Deployment: runtime, chain, Core address, Constitution, Core major and
  Collector;
- Engine Revision: chain, Engine address, entry runtime code hash, interface,
  selector set, code policy and three opaque commitments;
- Market: Core Deployment, Engine Revision and four policy commitments;
- Domain Revision: Core Deployment, Domain identity and five policy/profile
  commitments; and
- DomainVault: Core Deployment, Domain Revision, Asset Profile and native asset.

These identities are valid only as binding-local foundation identities. The
portable RFC-8785/SHA-256 Scope ID to native EIP-712/onchain bridge remains
`SPEC-GAP-011`; these hashes do not resolve or substitute for that bridge.

## What is intentionally absent

No protected authorization ABI, execution storage, nonce/fill state, Effect
executor, funded assessment liability or normalized Receipt schema is frozen.
Those components depend on the twelve counterexamples in the
[Protocol gap report](../../packages/dex-evm/binding/reports/protocol-gap-report.json).
