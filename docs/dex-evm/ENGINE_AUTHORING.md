# Engine authoring

## Current status

An Engine can be authored and its immutable descriptor can be derived or
registered for architecture testing. It cannot cause protected execution in
this release because `CoreV1.executeProtected` hard-reverts. Registration is
permissionless and grants no authority, endorsement, admission or economic
quality claim.

## Admitted interface shape

The foundation admits one binding-local interface profile:

```solidity
proposeOpaque(OpaqueEngineRequestV1 request)
    external
    returns (OpaqueEngineResponseV1 response);
```

The selector-set commitment covers only `proposeOpaque`. The request binds
Core Deployment, Engine Revision, Market, Scope candidate, session, execution
target, action digest, segment and phase, and carries an action payload. The
interface constants specify mandatory limits for a future enabled Core caller;
the current Core does not call the interface and therefore does not enforce
those caps. A direct third-party caller can choose different inputs and gas.
The response shape is opaque and return-only; response bytes confer no Core
authority and are not an executable arbitrary-call bundle.

[`OpaqueStateEngineV1`](../../packages/dex-evm/src/reference-engines/OpaqueStateEngineV1.sol)
is a reference fixture for bounded return data and Engine-owned state. It is not
a production Engine and no response from it can be settled by the current Core.

## Registration checklist

An `EngineRevisionDescriptorV1` must provide:

1. the Core's immutable deployment chain ID and a nonzero Engine contract
   address;
2. the exact current `EXTCODEHASH` of that entry address;
3. the return-only interface profile ID and exact selector-set hash;
4. the `entry-runtime-codehash-only` policy ID; and
5. nonzero immutable-configuration, dependency-policy and capability-profile
   commitments.

Core validates those fields and stores the descriptor under a derived Engine
Revision ID. It does not decode the three opaque commitments.

## Code-policy warning

The admitted policy does not reject proxy-shaped code. An Engine entry address
can keep the same runtime code while its storage-selected implementation or
external dependency changes. The descriptor commitments are identity-bearing
bytes, not proof that Core enforces them. Engine documentation must separately
state every mutable implementation, configuration and dependency surface.

## Return-only boundary still blocked

The portable Protocol does not specify whether the proposer Engine call itself
consumes the first one-shot target slot or happens outside the ordered target
sequence (`SPEC-GAP-012`). Until that transcript rule is frozen, an Engine
author must not claim that its call order, target reuse or Receipt transcript is
Protocol conforming. Do not design around a locally selected interpretation.

## Hostile-call rules for a future binding

Any future enabled Core path must authenticate the Engine Revision, establish
the mutation lock before calling it, bound gas and copied return data, validate
the returned proposal against exact authority, and reauthenticate entry code
before acceptance. Engine state changes remain Engine-owned; they are not
rolled back independently from the enclosing EVM transaction.
