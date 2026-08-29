# Programmable DEX EVM SDK

This private Node.js 24 package contains deterministic reference helpers for
the draft EVM binding. It does not contain a wallet client and cannot sign or
broadcast transactions.

The package keeps three identity domains separate:

- portable identifiers use the pinned Protocol's restricted RFC 8785 JSON
  Canonicalization Scheme and SHA-256 rules;
- binding-native identifiers use the encoding implemented by the current
  native contracts and exercised by binding-owned foundation vectors; this is
  not a Binding Release or portable conformance claim; and
- the EIP-712 authorization descriptor is explicitly an **UNFROZEN candidate**.

The candidate EIP-712 descriptor is not `AuthorizationScopeIdV1`. The pinned
Draft Protocol does not yet close the complete Capability and Refund grammar.
Do not sign this candidate, use it to authorize execution, or present it as
portable authorization conformance. It exists only for explicitly labeled,
offline review and mutation testing while those semantics remain unfrozen.

Simulation helpers perform `eth_call` and optional gas estimation only. A live
observation returned by `simulateUnsignedTransaction` has module-local
provenance for the current process. Caller-constructed, copied, or deserialized
observations are explicitly reported as unauthenticated input by
`reviewUnsignedTransaction` and cannot pass its local checks. Even a
module-produced observation can only set `localSimulationChecksPassed`; the
release keeps `ownerGateSatisfied` false. Callers must independently review and
revalidate chain state, the canonical block hash, calldata, value, fees, nonce,
and finality immediately before any owner-controlled signing step.

Portable JSON parsing and materialized canonicalization apply binding-local
resource ceilings of 1,048,576 UTF-8 bytes, 100,000 values, and nesting depth
128. Exceeding a ceiling fails with `portable_resource_limit`. These denial-of-
service boundaries do not alter the pinned portable identifier semantics.

The event buffer is also deliberately fail closed. Its caller must supply an
exact allowed topic set, a synchronous exact-boolean block-header
authenticator, and a synchronous exact-boolean log-inclusion authenticator.
Checkpoint state is bound to the chain, Core address, event schema,
authentication policy, allowed topics, confirmation policy, and external
finality policy by a configuration digest. Caller-supplied RPC block hashes and
callbacks are evidence inputs; the SDK cannot authenticate an RPC endpoint for
the caller.

`confirmationDepth` is only a local rollback/checkpoint eligibility rule. It
does not infer Ethereum, L1, Nitro, or Robinhood finality from block count.
When external finality is required, the caller must supply an independently
authenticated monotonically prefixed finality anchor and revalidate it before
owner action.
