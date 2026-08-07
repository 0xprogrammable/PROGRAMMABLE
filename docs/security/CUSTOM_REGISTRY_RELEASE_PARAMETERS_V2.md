# Programmable Custom Registry generation 2 release parameters

## Status

This package is a local **Release Candidate**. It is not deployment or activation evidence. The canonical deployment
address, per-contract start blocks, transaction hashes, runtime hashes, explorer verification, release approval,
Custom canary, and `publicSubmissionsEnabled` activation are deliberately `null` or `false` in
`contracts/spec/custom-registry-generation-2-release-candidate.json`.

Integrators retain the frozen V1 contract tuple/event interface. Full Generation 2 projection targets the extended
public API v2 surface; public API v1 remains compatibility-only and cannot represent the complete contract-parity
record. The existing 34-word registry-record v3 producer also cannot reproduce the 37-fixed-field c988/Generation 2
commitment because it omits `configurationHash`, `permissionsHash`, and `marketPathId`. Contract-parity projection
therefore requires the additive registry-record v4 producer/schema. That projection must expose
`registryGeneration: 2` and source address/start block from the finalized per-chain manifest, never token metadata.

## Frozen contract policy

- registry generation: `2` (compile-time pinned in the deployment path)
- contract integration ABI version: `1`
- minimum full-fidelity public API version: `2`
- registry-record producer/schema version: `4`
- actual emitter-scoped Custom event bindings: `29`; the six ABIs declare `33` rows because the revision ABI
  inherits four capability event declarations that are emitted only by the initial-policy Registry
- Programmable fee recipient: `0x4957f49620AFf3Adbbe8195a4f633E49cc93376c`
- native Custom fee: exactly `10` BPS
- partner-template fee: exactly `20` BPS = `15` partner + `5` Programmable
- native surcharge on a partner template: `0` BPS
- provider-factory execution: direct runtime only (`ProxyKind.None`); route/source proxy evidence is discovery-only
  until current implementation/admin or beacon state is independently read back
- OpenZeppelin Contracts pin: `21c8312b022f495ebe3621d5daeed20552b43ff9`

Partner IDs are provider-neutral. A nonzero provider ID is necessary but never sufficient. The main Registry accepts
launches only from its immutable atomic registrar. The partner-factory Registry separately binds that registrar to one
exact provider factory call, direct provider runtime, launch result, repository/commit, model/template, launch runtime
set, permissions, fee-policy hash, chain, and generation. Provider factories never receive Registry writer authority.

## Nonce-bound deployment

`contracts/script/DeployProgrammableCustomRegistryReleaseV2.s.sol` deploys, in order:

1. `ProgrammableCustomFeePolicyVerifierV2`;
2. `ProgrammableCustomPartnerFactoryRegistryV2`;
3. `ProgrammableCustomExecutionPolicyRegistryV2`;
4. `ProgrammableCustomExecutionPolicyRevisionRegistryV2`;
5. `ProgrammableCustomRegistryV2`; and
6. `ProgrammableCustomAtomicRegistrarV2`.

The Registry receives the nonce-predicted sixth address as its initial and only writer and the predicted fourth address
as its initial and only corrector. Initial-policy and revision Registries are mutually cross-bound; the Registry,
partner-factory Registry, initial-policy Registry, revision Registry, and registrar verify their exact predicted peers.
The script checks every predicted address, role binding, chain, starting nonce, and generation. Any interleaved or failed
transaction voids the freeze and requires a new predeployment record. The script does not publish a manifest, enable
submissions, deploy a provider factory, or perform a canary.

The Generation 2 atomic registrar is an ABI-compatible implementation independent from the immutable Generation 1
registrar. It snapshots ETH that predates each payable launch and requires the launch to preserve that exact balance.
Forced ETH therefore remains unrelated to the launch and cannot permanently block later atomic registrations. The
Generation 1 source and deployment remain unchanged.

## Published ABI hashes

These SHA-256 hashes cover the exact JSON bytes in `docs/security/abi`:

| Artifact | SHA-256 |
| --- | --- |
| Fee-policy verifier ABI | `sha256:702549e5b400e23ec1fac7f58ade143d205299b41289069879d95c38981f6151` |
| Partner-factory Registry ABI | `sha256:7b947c6daea5ff7246eaa357f19680719f030cb85d0413e07f41f48c9a994c9e` |
| Initial execution-policy Registry ABI | `sha256:c4b60026a71fdce20b21201fac2774e48c581bde81c7a16cdec28a654cd2518f` |
| Execution-policy revision Registry ABI | `sha256:3d34770bb729f4afb08d765a9b7faa951da221040d0982d2c768db65f7d3ea22` |
| Registry ABI | `sha256:22da28a286141a7ce2a40f8d0e6df25f3bc8ea1f5b98d171ef3ec72bc29f0cb7` |
| Atomic registrar ABI | `sha256:f6c2a46a1ca4decf327fb2e47f0f55fb39f6f004bdaf3d7c5525b57b9cfb73e4` |

The 29 actual emitter-scoped event bindings have semantic commitment
`sha256:1fce77eed87ebb4e09838448b282960586bcaab4f441e62e17c9b45b2ae1b46f`. The byte-level SHA-256
of `CUSTOM_REGISTRY_EVENT_SET_V2.json` is
`sha256:20724d1652169d4639ed452f91b43b188ba81da44352236b8ba5c889f527b85c`.

The trade-capability Golden Vector file is
`sha256:e88df768650d337bf514427b58df504af45d60f5083b04957c97ac0011d634ef`, with semantic commitment
`sha256:32f45185daf9ede4e68ec87b587776de5cc3a6c6da43c7026b2315650b668765`. The release verifier independently
reconstructs every nested Golden route, market, metric, source, set, capability, helper, indexed topic, and event-data
value from its leaf preimages; it does not trust supplied parent hashes. The six-contract artifact-set commitment,
including both Golden Vector commitments, is
`sha256:c76c279772bb04bd2c5f9a1f311d0920ed3bfd5ac04087e6b3043ffe2667f09f`.

## Source and candidate runtime hashes

| Component | Source SHA-256 | Candidate deployed-bytecode Keccak-256 |
| --- | --- | --- |
| Fee-policy verifier | `f18da940392fe45c61982617e6739145112562b251206ba908c69bd773f6cef6` | `0x21a9704c30cbac965d99b1932503ebc786bd9f54026a7d6b8539dd051f454e5f` |
| Partner-factory Registry | `92672baef9081e4946c6c9105a2d46236cb6314b62bacb76fc823251f9ee9cc1` | `0x3adea701dc7c5a107c8d9309a5d7f3f97ed5ddd2a248051d59defe3a608938aa` |
| Initial execution-policy Registry | `ada1c5b8715c45daa4f39370d8e2b68e6c3dae5fd069f0f4fb2ceb49a92597f8` | `0xa03007368d4d1a05dccfa6eda78acae2188392cddec62628fc677ae995e8da58` |
| Execution-policy revision Registry | `7162c74f60ace5c375068b8f1094af3b62001a2e7112483e0293ea20d6f71892` | `0xc6a81e8a8befcfb57a7359c5460966b7ae772b0e1bf299a9bcf598304ff3bad4` |
| Registry | `9e7e27289fba4fef56be04696ca3d237248f53b37dbc15a8ce0a5771910b57c9` | `0x4ce3f21506e3804e0d544efb2d14074c9ff4cfafa3f814f78f2ffcaa1c10333a` |
| Atomic registrar | `23b7fb556a24849a2d2be3fbc1f0aa84ec71a17814ce12c53d621e3826e5560c` | `0x9dffd1b205a490d8db9af4ff15799136d1a2b3f1c40aa43ca1af64976aed5bd5` |

Candidate deployed-bytecode hashes are compiler templates only. Registry, partner-factory Registry, both
execution-policy Registries, and atomic registrar contain immutable references, so these template hashes cannot equal
their configured deployed runtime hashes. A post-deployment gate must mask only compiler-declared immutable ranges,
verify every immutable through contract getters, and record the actual runtime Keccak from two RPC providers. None of
the table values is live runtime evidence.

## External release blockers

- exact target chain and finalized chain-profile/policy commitments;
- current Command Center release approval;
- deployer, signer, operational roles, and nonce freeze;
- deployment receipts and source verification;
- a real provider-owned factory authorization, if a partner canary is selected;
- finalized Custom canary and automatic Registry-to-feed projection;
- public manifest address/start-block publication and production parity; and
- production activation of `publicSubmissionsEnabled`.
