# Programmable DEX EVM

This package is the isolated EVM implementation track for the independent
Programmable DEX. It is not a Uniswap hook, wrapper, launch model, or frontend.
It does not import the repository's deployed launch-model contracts or use a
legacy registry as settlement authority.

## Current state

The package is pinned to Programmable Protocol commit
`334bb26703a4dab18ce0fca8485c6275a879933a`, specification
`programmable-protocol/0.1.0-draft.1`. That release is Draft and sets
`production_eligible` to `false`.

The exact pinned release also contains portable ambiguities that prevent an
honest freeze of the protected-execution ABI, persistent authorization layout,
normalized Receipt mapping, Binding Release, or conforming testnet candidate.
Those issues are recorded in `binding/reports/` and are reported as
`BLOCKED_BY_SPEC`. The implementation therefore advances only components whose
meaning is not affected by those ambiguities and fails closed at protected
execution.

This status is deliberate. A locally compiling contract, passing test, or
generated artifact does not resolve a portable Protocol contradiction.

The binding-local asset foundation vectors in
`binding/vectors/asset-foundations-v1.json` exercise exact point-in-time native
ETH and strict measured ERC-20 transfer observations and resource boundaries.
They do not establish Asset Profile conformance, EVM-013, lifetime token
safety, or protected-execution support.

**Do not fund a vault created by this foundations-only Core major.** The
immutable `executeProtected` entry always reverts and Core has no vault-command
call site. Native ETH has no release path; ERC-20 balances have no release path
controlled by this Core, although unsupported token or issuer behavior may
change them externally. Ordinary native donations are accepted only as a
transfer-foundation behavior; forced ETH and direct token transfers cannot be
prevented. No owner, rescue, sweep, or migration path exists.

## Package boundary

```text
src/core/               immutable Core and isolated custody foundations
src/interfaces/         binding-owned, product-neutral native interfaces
src/profiles/           exact native ETH and strict measured ERC-20 profiles
src/reference-engines/  semantically different opaque Engine fixtures
test/                    unit, fuzz, invariant, adversarial, and conformance tests
binding/                 exact Protocol lock, native profiles, vectors, and reports
sdk/                     unsigned clients, evaluators, and bounded reorg-aware event buffering
script/                  local and unsigned deployment preparation
```

The package Foundry configuration disables automatic remappings and admits only
the explicitly pinned test dependency. An import-boundary check rejects Uniswap,
PoolManager, periphery, legacy Programmable settlement contracts, and traversal
outside this package.

## Evidence vocabulary

- `implemented` means source exists at the named revision.
- `test-executed` means the named command completed for the exact local tree.
- `BLOCKED_BY_SPEC` means a higher-priority portable decision is required before
  the affected native interface can be frozen.
- `not deployed` means no canonical-network transaction, runtime, or explorer
  evidence exists. Disposable local Anvil execution is labeled separately.

No independent audit has been completed. No source in this package is
production eligible at the pinned Protocol release.
