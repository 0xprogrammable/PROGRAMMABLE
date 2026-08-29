# EVM binding vectors

`foundations-v1.json` is a binding-owned vector set for the exact native
identity encodings and unambiguous ProtocolAssessmentV1 arithmetic implemented
by the foundations-only Core candidate. Passing it is not a portable
conformance claim, a Binding Release, or protected-execution evidence.

`domain-vault-v1.creation-code.hex` is the exact `DomainVaultV1` creation
bytecode produced by the compiler profile recorded in `foundations-v1.json`.
The vector differentially locks constructor encoding, initcode hash, salt, and
CREATE2 address calculation against Solidity. It is a revision-unbound test
input for the recorded source/compiler relationship, not execution evidence, a
deployment address or a generally reusable ABI.

`asset-foundations-v1.json` executes binding-local native ETH and strict
measured ERC-20 point-in-time observation cases, including exact and
max-plus-one returndata boundaries. It explicitly claims neither Asset Profile
conformance nor EVM-013, lifetime token safety, portable conformance, or
protected execution. `test/unit/AssetFoundationVectors.t.sol` reads and
executes the committed JSON cases.

`portable/334bb26703a4dab18ce0fca8485c6275a879933a/` is a byte-exact local
snapshot of only the portable vector and example files exercised by the SDK's
independent reference evaluators. `portable-snapshot-lock.json` records the
individual source-file digests. This subset is not the complete portable
vector set and does not reproduce or replace the pinned
`VectorSetDigestV1` value.

The EIP-712 candidate remains `UNFROZEN_BLOCKED_BY_SPEC`. The binding-owned
vectors deliberately contain no purported protected-execution Authorization
ABI and no normalized portable Receipt.
