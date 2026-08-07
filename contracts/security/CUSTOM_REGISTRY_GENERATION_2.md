# Custom Registry generation 2 security workflow

## Component and inheritance graph

```mermaid
classDiagram
  class AccessControlDefaultAdminRules
  class ReentrancyGuard
  class IProgrammableCustomRegistryV1
  class ProgrammableCustomRegistryV1
  class ProgrammableCustomRegistryV2
  class ProgrammableCustomPartnerFactoryRegistryV2
  class ProgrammableCustomFeePolicyVerifierV2
  class ProgrammableCustomExecutionPolicyRegistryV2
  class ProgrammableCustomExecutionPolicyRevisionRegistryV2
  class ProgrammableCustomAtomicRegistrarV2
  class ProviderOwnedFactory

  AccessControlDefaultAdminRules <|-- ProgrammableCustomRegistryV1
  ProgrammableCustomRegistryV1 <|-- ProgrammableCustomRegistryV2
  AccessControlDefaultAdminRules <|-- ProgrammableCustomPartnerFactoryRegistryV2
  ReentrancyGuard <|-- ProgrammableCustomAtomicRegistrarV2
  IProgrammableCustomRegistryV1 <|.. ProgrammableCustomRegistryV1
  ProgrammableCustomRegistryV2 --> ProgrammableCustomFeePolicyVerifierV2 : same verify selector
  ProgrammableCustomRegistryV2 --> ProgrammableCustomPartnerFactoryRegistryV2 : exact caller authorization
  ProgrammableCustomRegistryV2 --> ProgrammableCustomExecutionPolicyRegistryV2 : fixed companion binding
  ProgrammableCustomRegistryV2 --> ProgrammableCustomExecutionPolicyRevisionRegistryV2 : sole correction authority
  ProgrammableCustomExecutionPolicyRegistryV2 --> ProgrammableCustomRegistryV2 : exact approval and launch identity
  ProgrammableCustomExecutionPolicyRegistryV2 --> ProgrammableCustomPartnerFactoryRegistryV2 : exact provider factory
  ProgrammableCustomExecutionPolicyRevisionRegistryV2 --> ProgrammableCustomExecutionPolicyRegistryV2 : replacement emission
  ProgrammableCustomExecutionPolicyRevisionRegistryV2 --> ProgrammableCustomRegistryV2 : contiguous record correction
  ProgrammableCustomAtomicRegistrarV2 --> ProgrammableCustomRegistryV2 : native atomic path
  ProgrammableCustomAtomicRegistrarV2 --> ProgrammableCustomExecutionPolicyRegistryV2 : same-tx capability proof
  ProviderOwnedFactory --> ProgrammableCustomAtomicRegistrarV2 : exact approved launch call
```

## State transitions and authorization

```mermaid
flowchart LR
  A["Independent approver"] --> AA["authorizeApproval"]
  W["Atomic registrar writer"] --> R["registerLaunch"]
  PF["Exact direct-runtime provider factory"] --> W
  PA["Factory approver"] --> AF["authorizeFactory"]
  PR["Factory revoker"] --> RF["revokeFactory"]
  AA --> O["one-use approval"]
  AF --> E["exact factory configuration"]
  O --> R
  E --> R
  R --> OB["Observed"]
  OB --> FN["Finalized"]
  OB --> RV["Revoked"]
  FN --> CR["Approved contiguous policy/record revision"]
  FN --> RV
  RF --> X["future registrations fail"]
```

| State | Authorized writer | Property |
| --- | --- | --- |
| Factory authorization | `APPROVER_ROLE` | exact source/runtime/config/permissions/fee/chain/generation |
| Factory revocation | independent `REVOKER_ROLE` | terminal for future registrations |
| Approval | independent Registry `APPROVER_ROLE` | exact launch and registration binding, one use |
| Registration | immutable atomic registrar only | live primary runtime match and one-use deployment ID |
| Finality | `FINALIZER_ROLE` | native block hash and configured depth |
| Correction | immutable policy-revision Registry only | exact approved contiguous append-only revision |
| Revocation | `REVOKER_ROLE` | terminal launch state |

## Security properties exercised

1. Generation 2 is compile-time pinned and chain/generation checks reject cross-scope replay.
2. A previously unknown nonzero provider is structurally valid only with exact active factory authorization.
3. A provider tag, copied template metadata, global writer, wrong caller, altered runtime, configuration, permissions,
   repository/commit, fee evidence, or revoked authorization fails closed.
4. Native Custom is exactly 10 BPS; partner templates are exactly 20 = 15 + 5 with no additional native 10 BPS.
5. Partner legs use one currency/basis/charge-mode/rounding basis and separate recipients and claim rights.
6. The 37 fixed registration fields and nested fee policy bind approval, source/build/artifacts, deployment/runtime,
   configuration/permissions, model/template/provider, assets/markets/capabilities, review, and finality.
7. Approval, deployment, transition evidence, and factory evidence are one-use; counts are monotonic.
8. Atomic deployment, initialization, runtime validation, and registration revert together on any failure.
9. Revocation is terminal and correction history remains append-only.
10. A Generation 2 record is publishable only with same-transaction capability summary and exact ordered route/source
    companions whose hash equals the approval-bound `capabilitySetHash` and whose derived market set equals the
    registration-bound `marketSetHash`.
11. `executionEnabled` is a declared set property independent of activation block. Current execution still requires
    activation, lifecycle/finality, live runtime/config/dependency, and current proxy evidence; unsupported-only is false.
12. Standard v4 execution cannot target PoolManager directly; exact router/Permit2/PoolManager, Hook review,
    quote/read identities, policies, and runtime are bound. Adapter and market-source proxies bind implementation and
    admin identities. Later drift disables capabilities, not origin discovery.
13. Every market source binds a canonical nonempty metric set of no more than 256 strictly ordered, unique, nonzero
    IDs. Price, volume, liquidity, and charting have published standard IDs; unknown future IDs remain valid and are
    preserved rather than guessed. The validator rejects both zero and the canonical empty-set hash.

Focused unit and 1,000-run fuzz tests cover provider neutrality, exact factory checks, fee splits, shared basis,
claim isolation, runtime/config/permission mutation, fake attribution, and commitment changes. Stateful invariants run
256 sequences at depth 64 and cover one-use bindings, cross-generation rejection, monotonic counts, and terminal
revocation. The CI profile raises fuzzing to 10,000 runs and invariants to 1,000 sequences at depth 128.

## Static analysis and feature checks

Slither `0.11.5` analyzed the focused Registry source set with 101 detectors (233 compiled contracts because Foundry
resolves the full dependency graph). It reported no High, Medium, Low, or Optimization findings. The six
Informational results were one mixed dependency-pragma group, the inherited V1 constructor's deliberate
configuration-check complexity, and four uppercase immutable/interface naming notices. The constructor branches are
fail-closed checks; uppercase names are stable manifest-facing protocol fields.

- Upgradeability: the six Generation 2 components are direct deployments and contain no proxy/delegatecall upgrade
  path. Provider-factory execution is direct-runtime only. Route/source proxy identities may be retained for discovery,
  but current execution/read remains disabled without current slot/beacon readback.
- ERC conformance: the Registry continues to expose the frozen `IProgrammableCustomRegistryV1` ERC-165 interface.
  The package is not an ERC-20/721/1155 implementation.
- Token integration: the Registry and verifier transfer no tokens. The atomic registrar can forward only the exact
  approved constructor/initializer ETH value and requires the post-launch balance to equal the preexisting forced-ETH
  snapshot; unrelated forced ETH is neither consumed nor a launch blocker.
- Cryptography: commitments use typed `abi.encode` plus Keccak-256 with explicit domains; there is no custom signature
  scheme or randomness.

Slither's contract summary, function summary, and variables-and-authorization printers were also reviewed against
the diagrams above. They found no unmodeled Generation 2 state-writing entry point.

## Manual review areas

- signer, threshold, and operational-role custody;
- exact factory and launch runtime closure, including proxies and upgrade/admin authorities;
- accounting, rounding, accrual currency, claim separation, and reentrancy in provider-owned templates;
- oracle, bridge, hook, PoolManager, external protocol, and off-chain dependencies;
- reproducible build, source publication, and explorer runtime verification;
- nonce freeze, transaction ordering, and exact deployment calldata/value;
- finality, reorg, indexer backfill, cursor, and API projection behavior; and
- real canary, manifest publication, production parity, and current release authorization.

The contract package provides provenance and review bindings, not a guarantee that a launch is safe, risk-free,
non-upgradeable, or independently audited.

Privacy review: all commitments, roles, addresses, and evidence hashes are public calldata/state and must not contain
secrets. Front-running review: copying an approval or atomic request is insufficient because launch wallet, exact
factory caller, CREATE2 target, configuration, runtime and one-use IDs are bound; an authorized factory can still
control its own ordering, which is an operational/provider risk. DeFi review: the verifier proves declared policy
structure, not actual market accounting; each provider template's hook, fee accrual/claim logic, reentrancy boundary,
oracle/bridge dependencies, rounding, and authority controls remain a separate exact-revision release gate.
