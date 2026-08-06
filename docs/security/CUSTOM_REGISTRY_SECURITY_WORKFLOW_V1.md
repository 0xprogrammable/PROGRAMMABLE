# Programmable Custom Registry V1 security workflow

## Inheritance and component graph

```mermaid
classDiagram
  class AccessControlDefaultAdminRules
  class IProgrammableCustomRegistryV1
  class IProgrammableCustomPartnerFactoryRegistryV1
  class ProgrammableCustomFeePolicyVerifierV1
  class ProgrammableCustomPartnerFactoryRegistryV1
  class ProgrammableCustomRegistryV1
  class ProgrammableCustomAtomicRegistrarV1
  class PartnerOwnedFactory

  AccessControlDefaultAdminRules <|-- ProgrammableCustomRegistryV1
  AccessControlDefaultAdminRules <|-- ProgrammableCustomPartnerFactoryRegistryV1
  IProgrammableCustomRegistryV1 <|.. ProgrammableCustomRegistryV1
  IProgrammableCustomPartnerFactoryRegistryV1 <|.. ProgrammableCustomPartnerFactoryRegistryV1
  ProgrammableCustomRegistryV1 --> ProgrammableCustomFeePolicyVerifierV1 : immutable fee checks
  ProgrammableCustomRegistryV1 --> ProgrammableCustomPartnerFactoryRegistryV1 : exact caller authorization
  ProgrammableCustomAtomicRegistrarV1 --> ProgrammableCustomRegistryV1 : native atomic registration
  PartnerOwnedFactory --> ProgrammableCustomRegistryV1 : partner atomic registration
```

## State-changing function summary

```mermaid
flowchart LR
  A["APPROVER_ROLE"] --> AA["authorizeApproval"]
  W["WRITER_ROLE or exact approved factory"] --> R["registerLaunch"]
  F["FINALIZER_ROLE"] --> FL["finalizeLaunch"]
  C["CORRECTOR_ROLE"] --> CR["correctLaunchRecord"]
  V["REVOKER_ROLE"] --> RV["revokeLaunch"]
  PA["partner APPROVER_ROLE"] --> AF["authorizeFactory"]
  PR["partner REVOKER_ROLE"] --> RF["revokeFactory"]

  AA --> AS["one-use approval state"]
  AF --> FS["exact factory configuration"]
  AS --> R
  FS --> R
  R --> O["Observed"]
  O --> FL
  FL --> FN["Finalized"]
  O --> RV
  FN --> RV
  FN --> CR
```

## Variables and authorization map

| State | Writer | Required authorization | Security property |
| --- | --- | --- | --- |
| `_approvalStates`, `approvalConsumed` | `authorizeApproval` / `registerLaunch` | independent approver / exact registration caller | one approval is consumed once |
| `deploymentConsumed` | `registerLaunch` | first-party writer or exact approved factory | deployment ID cannot replay |
| `_launchStates`, `_launchDetails`, `_recordHashes` | registration, finality, correction, revocation | function-specific role/caller | append-only lifecycle and terminal revocation |
| `transitionEvidenceConsumed` | every control transition | transition-specific role | evidence cannot replay across transitions |
| `_factoryStates`, `evidenceConsumed` | partner authorization/revocation | partner approver/revoker | exact factory config; terminal revocation |
| Registry role mappings | default admin | delayed two-step single admin | operational keys can be revoked; admin transfer is delayed |

`registerLaunch` intentionally has no single Solidity role modifier. It dispatches on `providerId`: native Custom
requires `WRITER_ROLE`; partner-attributed Custom requires the exact approved factory caller and a current runtime and
configuration match. A global writer cannot register a partner launch.

## Security properties and invariant coverage

The release asserts:

1. approval, deployment ID, approval evidence, and transition evidence are one-use;
2. approval and writer authority cannot be co-located;
3. partner approver and partner revoker authority cannot be co-located;
4. a partner launch caller must equal the exact authorized factory and still have its authorized runtime code hash;
5. configuration hash changes with source commit, chain, factory/runtime, launch runtime set, permissions, or fee;
6. AEON partner fee is exactly 20 = 15 + 5 with no native 10-bps surcharge;
7. native Custom fee is exactly 10 bps to the fixed Programmable recipient;
8. no-market records cannot smuggle a recipient, fee leg, market path, or activation;
9. registration checks the live primary-contract runtime;
10. failed atomic registration rolls the deployment back;
11. finality requires native historical block hashes and minimum depth;
12. record revision is contiguous and revocation is terminal; and
13. counts are monotonic and equal successful transitions.

The focused suite includes negative tests for wrong caller/factory/runtime/configuration/permissions/source commit,
wrong provider fee policy, wrong split/recipient/basis/claim rights, extra 10 bps, replay, expiration, cross-chain and
cross-generation substitution, failed initialization, reentrancy, shallow finality, reused evidence, skipped
correction, and post-revocation mutation. Invariant handlers exercise one-use bindings, monotonic counts, and terminal
revocation.

## Static analysis result

Slither was run separately against the final main Registry and partner-factory registry with dependencies excluded.
It reported no High, Medium, Low, or Optimization findings for either target. The main Registry had five
Informational findings: one constructor cyclomatic-complexity notice and four deliberate uppercase immutable/interface
naming notices. The partner registry had four deliberate uppercase immutable/interface naming notices. The
constructor branches are fail-closed deployment configuration checks; the uppercase names match immutable protocol
manifest fields.

## Manual review areas

Static tools do not establish the following and each remains a release gate:

- exact mainnet source-to-runtime reproduction and explorer verification;
- signer and threshold-authority custody;
- AEON factory implementation, hook accounting, claims, permissions, and recipient control;
- proxy and external-dependency closure in the runtime set;
- reproducible build and exact Git object retention;
- indexer reorg handling and receipt/log reconciliation;
- API/manifest canonicalization and per-market fee rendering;
- wallet-chain/account freshness immediately before send;
- simulation equivalence to the exact final calldata/value; and
- full public same-transaction canary across Website, Registry, Explorer, API, and Developer Manifest.
