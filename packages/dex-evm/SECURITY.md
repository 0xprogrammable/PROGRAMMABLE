# DEX EVM security boundary

## Status

This is a Draft architecture and native-foundation implementation. It is not a
security audit, production release, deployment, or guarantee. Protected
execution remains `BLOCKED_BY_SPEC` at the pinned portable release.

## Trust model

Treat every Engine, submitter, router, token, wallet, recipient, RPC, indexer,
and external dependency as hostile. Core immutability does not make an Engine,
asset, dependency, L2, sequencer, or offchain view immutable.

A future enabled design must protect authority, not claim economic quality. A
malicious Engine could propose an economically destructive but
value-conserving transition inside a Principal's exact signed limits. No future
Core result would by itself prove fair price, asset legitimacy, profitability,
legality, or Engine solvency.

## Required properties for any enabled future release

These are release requirements, not claims about the current sentinel Core.
The exact foundation properties that are currently enforced are documented in
[`DEX_EVM_PROPERTIES.md`](../../docs/security/DEX_EVM_PROPERTIES.md).

1. No actor gains Principal, Collector, DomainVault, or Core authority from
   `msg.sender`, `tx.origin`, registration, routing, or an Engine declaration.
2. The effective protected authority is the most restrictive intersection of
   the Constitution, binding, Market, Engine Revision, Domain Revision, Asset
   Profile, and Principal authorization.
3. Core and every vault contain no proxy, `delegatecall`, `selfdestruct`, owner,
   pause, fee setter, sweep, rescue, arbitrary call, or reusable approval path.
4. The execution lock is established before any hostile call and rejects every
   nested mutating entry.
5. Engine code identity is checked before invocation and again before any
   result can be accepted.
6. Every physical asset delta must equal the exact profile observation and the
   corresponding canonical accounting change before commit.
7. One Domain's holdings never cover another Domain's deficit or liability.
8. Assessment arithmetic never wraps or exceeds the unsigned 128-bit domain.
9. Evidence distinguishes Core-verified facts, profile observations,
   Engine-attested statements, external dependencies, and offchain derivation.
10. A failed required call, malformed/oversized response, open obligation,
    failed postcondition, or stale revision reverts the complete Envelope.

## Unsupported claims

Until the Protocol issues are resolved and the resulting binding is frozen and
independently reviewed, this package does not claim:

- portable or EVM Binding Release conformance;
- engine-independent exit conformance;
- generic ERC-20, ERC-721, or ERC-1155 support;
- fee-on-transfer, rebasing, callback, upgradeable, permissioned, confiscatable,
  or deceptive-balance token support;
- Robinhood Chain testnet or mainnet deployment;
- source verification, runtime immutability evidence, provider availability,
  external audit, or production eligibility.

Security findings should identify the exact hostile actor, authority controlled,
pre-state, attempted transition, expected result, and protected post-state.
