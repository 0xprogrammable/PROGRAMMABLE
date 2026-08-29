# Markets and Domains

## Permissionless identity creation

`CoreV1` exposes permissionless creation of immutable descriptor identities.
`MarketCreated` and `DomainRevisionCreated` record the caller as `creator`;
`EngineRevisionRegistered` and `DomainVaultCreated` do not. A recorded creator
does not become an owner. Creating an identity is not admission, approval,
protected authority, liquidity, a deployment recommendation or proof that any
opaque policy commitment is true.

## Market creation

`MarketDescriptorV1` contains:

- an authenticated Engine Revision ID;
- an immutable-parameters commitment;
- a Domain-admission-policy commitment;
- an asset-admission-policy commitment; and
- a required-capability-profile commitment.

Every commitment must be nonzero. Core reauthenticates the Engine entry runtime
code hash at Market creation. If an authority-relevant Market term changes, the
descriptor and Market ID change; this binding does not create a separate Market
Revision identity.

Opaque commitments are identifiers, not executable policy. The foundation does
not validate that the committed policy admits a Domain or asset, and protected
execution remains unavailable.

## Domain Revision creation

`DomainRevisionDescriptorV1` contains a logical Domain ID plus commitments for
admission policy, custody profile, exit profile, authority policy and immutable
configuration. All fields must be nonzero. A material change creates a new
Domain Revision ID; it never mutates the old descriptor.

A Domain Revision registration does not prove engine-independent exit. The
locked vector set contains no applicable cases for the independently claimable
`engine-independent-exit-v1` profile (`SPEC-GAP-009`).

## DomainVault creation

For an existing Domain Revision, anyone can ask Core to deploy the physical
vault for `(Core Deployment, Domain Revision, Asset Profile, native asset)`.
Core derives a vault identity and deploys `DomainVaultV1` with CREATE2. Repeated
requests return the existing address for the exact tuple.

The vault accepts typed transfer commands only from its immutable Core. It has
no arbitrary target/calldata call, approval path, owner, rescue, sweep or
migration function. Native ETH uses the zero native-asset address; strict ERC-20
uses the token address and records its entry runtime code hash at construction.

Vault construction is not evidence of a funded position or protected
liability. The current Core has no enabled path that commands a protected
settlement. A vault created by this immutable foundations-only Core must not be
funded: no Core command can release ETH or tokens under this major, and there is
no rescue, sweep, owner, or migration path. More precisely, native ETH has no
release path and ERC-20 balances have no Core-controlled release path;
unsupported token or issuer behavior is not constrained by this claim.

## Authoring discipline

Publish the canonical preimage for every commitment outside the chain before
using the descriptor in review. Hashes without retrievable preimages are not
reviewable policy evidence. Do not reuse one commitment for semantically
different policies, and never describe creation events as admission decisions.
