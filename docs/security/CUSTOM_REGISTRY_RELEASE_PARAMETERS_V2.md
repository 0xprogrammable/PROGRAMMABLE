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
- Custom event count: `18` (`15` retained registration/lifecycle events plus `3` execution-policy companions)
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
3. `ProgrammableCustomExecutionPolicyRegistryV2`;
4. `ProgrammableCustomRegistryV2`; and
5. `ProgrammableCustomAtomicRegistrarV2`.

The registry receives the nonce-predicted fifth address as its initial and only writer. The execution-policy Registry
is immutably cross-bound to the predicted Registry, partner-factory Registry, and atomic registrar. The script checks every
predicted address, writer binding, chain, starting nonce, and generation. Any interleaved or failed transaction voids
the freeze and requires a new predeployment record. The script does not publish a manifest, enable submissions,
deploy a provider factory, or perform a canary.

The Generation 2 atomic registrar is an ABI-compatible implementation independent from the immutable Generation 1
registrar. It snapshots ETH that predates each payable launch and requires the launch to preserve that exact balance.
Forced ETH therefore remains unrelated to the launch and cannot permanently block later atomic registrations. The
Generation 1 source and deployment remain unchanged.

## Published ABI hashes

These SHA-256 hashes cover the exact JSON bytes in `docs/security/abi`:

| Artifact | SHA-256 |
| --- | --- |
| Registry ABI | `sha256:4c0330ee055bbd27f395deb7e4c001f27a49a65752a00426840b99f7d6a5dc64` |
| Partner-factory Registry ABI | `sha256:054b5d2740314335d202e37d405273cbb9d0922398cbc2909e7cb7cee845061e` |
| Fee-policy verifier ABI | `sha256:0bc9bdda4a1e78e2c498568ddfa164b35c3cb5c297f563dd4771935e75304f62` |
| Execution-policy Registry ABI | `sha256:071ee1474a7f78aef9d843e880ae5a19f312ee8a566c5501d3f2a059d8d85116` |
| Atomic registrar ABI | `sha256:a48974ccacc97e3b9fcfafd52cdfac1d187a9183eac1a65d5d26221a75561214` |

The combined 18-event semantic commitment is
`sha256:be36b4977143371149695aa8a8702aef56b08ef4b756640d0e0070252c24ee57`. The byte-level SHA-256
of `CUSTOM_REGISTRY_EVENT_SET_V2.json` is
`sha256:cc5b78cc4557909aade5df7ffd614c567ac069219ea0fc7db82bfb657bf159c5`.

The trade-capability Golden Vector file is
`sha256:8a35e3d8b6c597b5d209d8c3c244166d9c1948955ac6ba214c66972980fb7dce`, with semantic commitment
`sha256:da03a4562a19f7800933d9657a5ea3895c01a33ca149954850d846f83b202530`. The five-contract artifact-set
commitment, including both Golden Vector commitments, is
`sha256:fc9d1487c476165675f5d2d12569e33f70b9a3289982c56252607f38849c60b9`.

## Source and candidate runtime hashes

| Component | Source SHA-256 | Candidate deployed-bytecode Keccak-256 |
| --- | --- | --- |
| Registry | `2de88274f88b9819fa3e5f2988dddf8f21d4e6ad202428b884eb67496196df05` | `0x7ff88b8da1d3bdc62608a33b2c2592249d005e802a38284267729274de38d347` |
| Partner-factory Registry | `e81544a2c30ffb35179f2e701fe54def0b5ac9bac5d4f7086d5b173905f03432` | `0x990af413455471779a9a1b76bf75943dabf95fdcc2821889c132f6c363aecde6` |
| Fee-policy verifier | `f18da940392fe45c61982617e6739145112562b251206ba908c69bd773f6cef6` | `0x21a9704c30cbac965d99b1932503ebc786bd9f54026a7d6b8539dd051f454e5f` |
| Execution-policy Registry | `2df71df700b795c5da57117bba456f626afbb57652bbc4dace21fd3a6da2bb36` | `0xbbb8dc3938ebefc3318702ebfcc1e36c667c347eb736a1badf2a26d0ea4cd9dc` |
| Atomic registrar | `87dcd6dc88e7638abba093b7e63619dff643a7771ef6395f3b3f78785e73bf14` | `0x4b35dd0f02cc34898575d7a028c0d68e96dcfe9d76cbe6660477ea334f28e6af` |

Candidate deployed-bytecode hashes are compiler templates only. Registry, partner-factory Registry,
execution-policy Registry, and atomic registrar contain immutable references, so these template hashes cannot equal
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
