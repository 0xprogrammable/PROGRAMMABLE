# DEX EVM binding-local profiles

These files describe the native architecture baseline. They are not portable
profile claims, a Binding Release or a Conformance Report. The exact Protocol
lock is Draft, `productionEligible=false`, and protected execution is
`BLOCKED_BY_SPEC`.

- `engine-interface.return-only-opaque.v1.json`: admitted Engine call shape.
- `engine-code.entry-runtime-codehash-only.v1.json`: exact narrow code policy.
- `asset.native-eth-strict.v1.json`: measured native ETH push behavior.
- `asset.erc20-strict-measured.v1.json`: measured ERC-20 pull/push behavior.
- `asset.unsupported.v1.json`: explicit exclusions, not a claimable profile.

The two asset foundation records link to
`../vectors/asset-foundations-v1.json` and its executable Foundry test. Those
cases cover exact point-in-time observations and returndata boundaries only.
They are not Asset Profile conformance, EVM-013 evidence, lifetime token-safety
evidence, or a protected-execution claim.

Profile identifiers use the Keccak-256 hash of their recorded UTF-8 preimage in
the Solidity and SDK sources. The preimage is authoritative here; this catalog
does not insert an unverified copied digest.
