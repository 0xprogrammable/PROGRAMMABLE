# Programmable Custom Registry V1

## Release status

This source tree is a release candidate, not evidence of a deployment. Custom remains `prelaunch` and every public
manifest must keep `address` and `startBlock` null until all release gates below have real evidence. A local test,
simulation, RPC response, preview, or verified source page does not make the Registry live.

The release becomes active only after:

1. the three registry components are deployed on the intended chain with no placeholder addresses;
2. source and deployed runtime code are independently verified;
3. the address, ABI, start block, event set, and canonical hash specification are published;
4. roles, delayed administration, finality policy, and manifest bindings pass read-only verification;
5. Website, Launch Gate, Indexer, Explorer, API, and Developer Manifest consume that same binding;
6. one real launch deploys and registers atomically, finalizes, and appears in every public surface; and
7. the negative production probes fail closed.

The fixed public identity is:

- `platformId: programmable`
- `category: custom`
- display label: `Programmable Custom`

Partner, provider, model, and template values are attribution and policy dimensions. They do not create another
primary category.

## Deployed components

The release contains three mandatory contracts:

- `ProgrammableCustomRegistryV1`: append-only approval, registration, finality, correction, and revocation state;
- `ProgrammableCustomPartnerFactoryRegistryV1`: allowlist for exact provider-owned factories, source commits,
  deployed runtime code, launch runtime set, permissions, and fee policy; and
- `ProgrammableCustomFeePolicyVerifierV1`: stateless canonical V1 fee-policy verifier.

`ProgrammableCustomAtomicRegistrarV1` is the first-party atomic deployment adapter for compatible native Custom
launches. In the canonical V1 four-transaction release its nonce-derived address is bound as the main Registry's only
initial writer before the registrar is deployed at that exact address. It is not an AEON launcher.

All deployed addresses are immutable release-manifest values. The main Registry binds the exact partner-factory
registry and fee verifier in its constructor. None of these contracts is a proxy.

## Approval and launch lifecycle

The Registry state machine is:

```text
None -> Observed -> Finalized -> Revoked
                \-> Revoked

Finalized revision 1 -> correction 2 -> correction 3 -> ...
```

`APPROVER_ROLE` first authorizes one exact `approvalId`, launch ID, approval binding, full registration binding,
validity window, and evidence hash. Approval and registration are different transitions. Approval evidence is
append-only and one-use. `APPROVER_ROLE` and the first-party `WRITER_ROLE` cannot be held by the same account.

A registration binds the exact:

- chain and immutable Registry generation;
- repository, source commit, source/build/artifact commitments;
- deployment plan, deployment ID, deployed address, runtime code and runtime set;
- provider/model/template IDs and versions;
- deterministic configuration and permissions hashes;
- launch wallet;
- market path, asset/market/capability sets;
- security policy, review result, approval/deployment binding;
- provider/model/version/market-path fee policy; and
- public registered-record commitment.

`Observed` is not public finality. `FINALIZER_ROLE` must later bind the actual registration transaction/log identity,
the observed block and a confirmed head, and prove both native block hashes within the EVM's 256-block historical
window. The Indexer must reconcile the finalizer-attested transaction and log indexes against the actual receipt.
Only `Finalized` may be shown as a live official launch. Corrections are append-only and revocation is terminal.

## Same-transaction registration

Every successful launch must deploy and register in one EVM transaction. A deployment without registration, or a
registration detached from its approved deployment, is invalid.

For first-party compatible launches, `ProgrammableCustomAtomicRegistrarV1.deployInitializeAndRegister`:

1. requires the launch-wallet caller;
2. predicts and deploys the exact CREATE2 address;
3. executes the approved initializer and checks its result;
4. checks the deployed `EXTCODEHASH`; and
5. calls `registerLaunch` before returning.

Any failure reverts deployment, initialization, and registration together. The registrar must hold `WRITER_ROLE`.

Provider-owned factories use their own atomic method. The approved factory must call `registerLaunch` in the same
transaction that creates the launch. `ProgrammableCustomPartnerFactoryRegistryV1.validateRegistration` accepts only
the exact approved factory address while its current `EXTCODEHASH`, configuration hash, source/runtime/permission/fee
bindings, validity window, and revocation status all match.

## Partner factories and AEON

Partners deploy and maintain their own factories and launchers. Programmable does not deploy an AEON factory or
represent it as a first-party launcher.

Before an exact partner factory can register anything, Programmable must:

1. review the exact model and factory source commits;
2. reproduce and compare the deployed factory runtime code;
3. verify the launch runtime set, permissions, owners, pause/upgrade/custody paths, and fee behavior;
4. authorize the exact factory, provider, model, template, versions, deterministic configuration hash, validity
   window, and evidence; and
5. retain independent immediate revocation authority.

The factory authorization layer is provider-neutral. The active V1 partner fee verifier is intentionally narrower:
it recognizes only the currently specified AEON policy. Adding another provider's fee plan requires a new published
verifier and Registry generation; it cannot inherit AEON's or native Custom's fee.

For AEON:

- public `providerId`: `aeon`;
- model submissions: `https://github.com/0xprogrammable/aeon-launch-models`;
- AEON selects its stable model/template IDs, semantic version, source commit, and recipient addresses;
- Programmable selects neither the launcher nor a free-form configuration hash; and
- a catalog entry is not launch approval. The exact source commit, version, deployed factory address, deployed runtime,
  configuration hash, and approval record must all match.

AEON must deploy its final mainnet factory only after the Registry address, ABI, event set, and hash specification have
been frozen and published. Programmable then verifies and authorizes that deployed factory.

The future generic intake is `https://github.com/0xprogrammable/programmable-registry/submissions`. It remains
`prelaunch` until the public generic intake is separately activated. The Registry deployment does not silently enable
that submission path.

## Canonical hash specification

`CUSTOM_REGISTRY_HASH_SPEC_V1.md` is normative. It defines public-string-to-`bytes32` mapping, exact source-commit
encoding, partner `configurationHash`, fee-policy hashes, and golden vectors. The configuration hash is calculated
from the approved provider/model/template/version and source commit, chain, exact factory and runtime, launch runtime
set, permissions, and fee policy. Neither AEON nor Programmable may choose it arbitrarily.

The built ABI files under `docs/security/abi/` are the normative callable/event surfaces for this release.

## Fee policy

Fees are explicit per provider, model, version, and market path. Registry membership alone never implies a fee.

The V1 verifier accepts:

- native Programmable Custom: 10 bps total, all 10 bps to
  `0x4957f49620AFf3Adbbe8195a4f633E49cc93376c`, added on top only for the approved qualifying market path;
- AEON Partner Custom: 20 bps total in the hook, 15 bps to AEON and 5 bps to the Programmable recipient, with
  `nativeCustomFeeBps = 0` and therefore no additional 10 bps; or
- no qualifying market: zero total fee and completely empty fee legs.

For every active leg, the policy binds recipient, currency, charge mode, basis, rounding, accrual, claim mechanism,
claim right, and control evidence. AEON's two legs must use the same currency/basis/rounding but distinct recipients
and claim rights. Nonzero claim-isolation, accounting-safety, and verification evidence are mandatory.

The API and Developer Manifest must expose the same provider/model/version/market-path policy and its onchain
`feePolicyHash`. They must never synthesize a global Custom fee, add the native 10 bps to AEON, or infer a market where
the record has none.

## Event and indexing contract

`CUSTOM_REGISTRY_EVENT_SET_V1.json` is the machine-readable event allowlist. It covers Registry registration and
lifecycle events, partner-factory authorization/revocation events, and the first-party atomic execution event.

The indexer must bind logs to:

- exact chain ID;
- exact Registry generation;
- manifest-published emitter address;
- manifest-published start block; and
- exact event topic/signature.

It must retain block hash/number, transaction hash/index, log index, removed status, emitter, topics, and decoded
payload; process removed logs and reorg corrections; and publish a launch only after finality reconciliation. A copied
event from another address has no Programmable provenance.

All registration companion events occur in the launch transaction or the whole launch transaction reverts:

- `CustomLaunchRegisteredV1`;
- `CustomLaunchProvenanceBoundV1`;
- `CustomLaunchReviewBoundV1`;
- `CustomLaunchAttributionBoundV1`;
- `CustomLaunchFeePolicyBoundV1`;
- `CustomLaunchFeeScopeBoundV1`; and
- `CustomLaunchFeeEvidenceBoundV1`.

Lifecycle events are `CustomLaunchFinalizedV1`, `CustomLaunchRecordCorrectedV1`, and `CustomLaunchRevokedV1`.
Partner-factory events are `CustomPartnerFactoryAuthorizedV1`, `CustomPartnerFactorySourceBoundV1`, and
`CustomPartnerFactoryRevokedV1`.

## Roles and administration

Both stateful contracts use OpenZeppelin `AccessControlDefaultAdminRules`: one default administrator and a delayed,
two-step admin transfer. Production requires a real threshold authority and nonzero delay.

Main Registry roles:

- `APPROVER_ROLE`: exact launch approval bindings;
- `WRITER_ROLE`: first-party registration adapters only;
- `FINALIZER_ROLE`: finality attestations;
- `CORRECTOR_ROLE`: append-only record corrections; and
- `REVOKER_ROLE`: terminal launch revocation.

Partner-factory registry roles:

- `APPROVER_ROLE`: exact factory/source/runtime configuration approvals; and
- `REVOKER_ROLE`: immediate terminal factory revocation.

A new implementation requires a new address and Registry generation. V1 history is never rewritten.

## Deployment and verification order

1. Freeze this source revision, ABIs, hash specification, event set, chain profile, Registry policy, generation,
   finality depth, and role addresses.
2. Run formatting, build/size, unit, fuzz, invariant, static-analysis, and secret-scan gates from that revision.
3. Freeze the deployer and exact pending nonce, predict the four sequential `CREATE` addresses, and simulate the full
   nonce-bound deployment without interleaving transactions.
4. Deploy, in order, the fee verifier, partner-factory registry, main Registry, and first-party atomic registrar. The
   main Registry constructor must bind the predicted registrar as its only initial writer, and transaction four must
   deploy the registrar at that exact address. A failure or nonce change stops the sequence and requires a new freeze.
5. Verify all four sources, constructor bindings, roles, deployed runtime hashes, and per-contract receipt blocks on the
   intended chain. Do not run the legacy post-deployment registrar grant/revoke script for this canonical path.
6. Publish real addresses and start blocks in the Developer Manifest; `address: null` is forbidden after activation.
7. Publish the frozen address/ABI/hash/event bundle before AEON's final factory deployment.
8. After AEON deploys, verify its exact source/runtime and authorize its exact deterministic configuration.
9. Execute a real same-transaction launch and registration, finalize it, and reconcile its receipt/log.
10. Verify the same record and fee policy in Website, Registry, Explorer, API, and Developer Manifest.
11. Run negative probes for wrong commit/version/factory/runtime/configuration/permissions/fees/wallet, replay,
    expiration, revocation, reorg, and cross-chain/generation substitution.

Deployment scripts require an explicit configured chain ID and explicit role/policy inputs. Verification scripts are
read-only and check runtime presence, immutable component bindings, chain/generation, roles, policy hashes, finality
depth, and the fixed Programmable recipient. A successful script run is still not a production claim without the
published onchain transaction, source/runtime verification, public-surface evidence, and real canary.

## Non-guarantees

`Programmable Verified` means reviewed against the published Programmable policy and cryptographically bound to the
exact deployed revision. It does not mean independently audited, risk-free, immutable, profitable, liquid, or safe.
Registry inclusion does not enable charting, quotes, simulation, trading, or any other capability absent from the
verified record.
