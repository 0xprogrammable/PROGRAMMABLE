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
- Custom event count: `15`
- Programmable fee recipient: `0x4957f49620AFf3Adbbe8195a4f633E49cc93376c`
- native Custom fee: exactly `10` BPS
- partner-template fee: exactly `20` BPS = `15` partner + `5` Programmable
- native surcharge on a partner template: `0` BPS
- proxy: none
- OpenZeppelin Contracts pin: `21c8312b022f495ebe3621d5daeed20552b43ff9`

Partner IDs are provider-neutral. A nonzero provider ID is necessary but never sufficient: the main Registry accepts
the launch only when `msg.sender` is the exact active factory whose live code hash, repository/commit, model/template,
launch runtime set, permissions, fee-policy hash, chain, and generation match an append-only factory authorization.

## Nonce-bound deployment

`contracts/script/DeployProgrammableCustomRegistryReleaseV2.s.sol` deploys, in order:

1. `ProgrammableCustomFeePolicyVerifierV2`;
2. `ProgrammableCustomPartnerFactoryRegistryV2`;
3. `ProgrammableCustomRegistryV2`; and
4. `ProgrammableCustomAtomicRegistrarV2`.

The registry receives the nonce-predicted fourth address as its initial and only writer. The script checks every
predicted address, writer binding, chain, starting nonce, and generation. Any interleaved or failed transaction voids
the freeze and requires a new predeployment record. The script does not publish a manifest, enable submissions,
deploy a provider factory, or perform a canary.

## Published ABI hashes

These SHA-256 hashes cover the exact JSON bytes in `docs/security/abi`:

| Artifact | SHA-256 |
| --- | --- |
| Registry ABI | `sha256:7c5fe7d25cc874a319c3621435c31cd8f531a7abfcd7d5073fc163d10d60524f` |
| Partner-factory Registry ABI | `sha256:054b5d2740314335d202e37d405273cbb9d0922398cbc2909e7cb7cee845061e` |
| Fee-policy verifier ABI | `sha256:0bc9bdda4a1e78e2c498568ddfa164b35c3cb5c297f563dd4771935e75304f62` |
| Atomic registrar ABI | `sha256:a053f14e59c3c54a0dad47e6e772ba411c7659a46eab3313a6c124260ebcff1f` |

The combined 15-event semantic commitment is
`sha256:bcff2958529fecaa7ef8c4c654389829bfb7dd61a3246f0d681cf7db0a42a58c`. The byte-level SHA-256
of `CUSTOM_REGISTRY_EVENT_SET_V2.json` is
`sha256:0c6c32e0db5eb55b8e0bd148a6206e0c0ab8605cda75338f3a556e75cd3eff1a`.

## Source and candidate runtime hashes

| Component | Source SHA-256 | Candidate deployed-bytecode Keccak-256 |
| --- | --- | --- |
| Registry | `6f013c147a5f1d4aba70aa335a905346bb4011fd266b75ea311e75362002051f` | `0x5b614de34459bb52a89f3ea876d3ea6c7a5e1fbeec688a8d11df9bc29684cb6e` |
| Partner-factory Registry | `e81544a2c30ffb35179f2e701fe54def0b5ac9bac5d4f7086d5b173905f03432` | `0x990af413455471779a9a1b76bf75943dabf95fdcc2821889c132f6c363aecde6` |
| Fee-policy verifier | `f18da940392fe45c61982617e6739145112562b251206ba908c69bd773f6cef6` | `0x21a9704c30cbac965d99b1932503ebc786bd9f54026a7d6b8539dd051f454e5f` |
| Atomic registrar | `a289e7bd0b6c5efe813c5acef0c2d9dab449f91fb090f56b46efb4123bfb446a` | `0xa98592bb24d40bd88cd774d9e9d03aabdc251d01bf00cacc22cbb86fe9339d69` |

Candidate bytecode hashes are build artifacts only; they are not live runtime evidence and must be rederived from
the final committed source before deployment.

## External release blockers

- exact target chain and finalized chain-profile/policy commitments;
- current Command Center release approval;
- deployer, signer, operational roles, and nonce freeze;
- deployment receipts and source verification;
- a real provider-owned factory authorization, if a partner canary is selected;
- finalized Custom canary and automatic Registry-to-feed projection;
- public manifest address/start-block publication and production parity; and
- production activation of `publicSubmissionsEnabled`.
