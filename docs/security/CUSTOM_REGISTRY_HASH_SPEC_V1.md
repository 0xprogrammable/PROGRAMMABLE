# Programmable Custom Registry V1 canonical hash specification

## Encoding rules

All onchain hashes in this document use Keccak-256 over Solidity `abi.encode`; none use packed encoding. Every
`bytes32` field is exactly 32 bytes and every address is ABI-encoded as a 20-byte address left-padded to one word.
Public strings are UTF-8 and have no surrounding whitespace.

Public identifiers are preserved as strings in the API and manifest and mapped onchain as follows:

- `providerId`, `modelId`, `templateId`, and their versions: `keccak256(utf8(exactPublicString))`;
- repository ID: `keccak256(utf8(canonicalHttpsRepositoryUrl))`;
- source commit ID: `keccak256(utf8("git-sha1:" + lowercase40HexObjectId))` for SHA-1 Git repositories, or the
  corresponding `git-sha256:` form and 64 lowercase hex characters for SHA-256 Git repositories; and
- deployed runtime code hash: the EVM `EXTCODEHASH` of the exact deployed address.

AEON has the public `providerId` string `aeon`, whose onchain value is:

```text
keccak256(utf8("aeon")) =
0x21579779d75cbc7029824d5bc06ea23ba34cbe06f6014c2dc184f0cc32d84ab9
```

AEON chooses its stable public model/template IDs, semantic versions, exact source commit, and recipient addresses.
Programmable does not choose or deploy AEON's launcher. Programmable verifies those inputs and computes the hashes
below.

## Partner factory configuration hash

The configuration domain is:

```text
CONFIGURATION_DOMAIN = keccak256(utf8("programmable.custom-partner-configuration.v1"))
                     = 0xe10be03c13fd6d46240ec9a5c30c425320fb17ed96290a55b43f43ac63db5d8b
```

The exact preimage is:

```text
modelHash = keccak256(abi.encode(
  bytes32 providerId,
  bytes32 modelId,
  bytes32 modelVersion,
  bytes32 templateId,
  bytes32 templateVersion,
  bytes32 modelRepositoryId,
  bytes32 modelSourceCommitId
))

factoryHash = keccak256(abi.encode(
  bytes32 factorySourceRepositoryId,
  bytes32 factorySourceCommitId,
  uint256 chainId,
  address factory,
  bytes32 factoryRuntimeCodeHash,
  bytes32 launchRuntimeCodeSetHash
))

configurationHash = keccak256(abi.encode(
  CONFIGURATION_DOMAIN,
  modelHash,
  factoryHash,
  bytes32 permissionsHash,
  bytes32 feePolicyHash
))
```

`launchRuntimeCodeSetHash` commits the approved, sorted, duplicate-free set of all runtime-code hashes reachable in
the launch plan. `permissionsHash` commits all owner, admin, upgrade, pause, custody, oracle, bridge, and claim
authorities. Their public preimages and evidence are mandatory approval-record fields. A changed commit, chain,
factory, runtime, permission, recipient, fee, model, template, or version changes the configuration hash.

Golden vector:

```text
providerId                 = keccak256("aeon")
modelId                    = keccak256("aeon.example-model")
modelVersion               = keccak256("1.0.0")
templateId                 = keccak256("aeon.example-template")
templateVersion            = keccak256("1.0.0")
modelRepositoryId          = keccak256("https://github.com/0xprogrammable/aeon-launch-models")
modelSourceCommitId        = keccak256("git-sha1:1111111111111111111111111111111111111111")
factorySourceRepositoryId  = keccak256("https://github.com/aeon/example-factory")
factorySourceCommitId      = keccak256("git-sha1:2222222222222222222222222222222222222222")
chainId                    = 1
factory                    = 0x3333333333333333333333333333333333333333
factoryRuntimeCodeHash     = 0x4444444444444444444444444444444444444444444444444444444444444444
launchRuntimeCodeSetHash   = 0x5555555555555555555555555555555555555555555555555555555555555555
permissionsHash            = 0x6666666666666666666666666666666666666666666666666666666666666666
feePolicyHash              = 0x7777777777777777777777777777777777777777777777777777777777777777

modelHash                  = 0xb382f36b08e82a0ecfa5b71412d67a5ff1e6830ef72caaeb2cbb26a0f1d32291
factoryHash                = 0x4e170deadd76b14a9f99e6d8901e93f021bdfa8cb54c32ea06e580218b9700fa
configurationHash          = 0xd0f7b1d29ce6a59052ca9d3b773183a3a3cc40e408fc7cf3ca3beeb20535359b
```

The contract test `test_partnerConfigurationHashGoldenVector` freezes this vector.

## Fee-policy hash

The fee-policy domain is `keccak256("programmable.custom-fee-policy.v1")`. The exact formula is:

```text
legHash = keccak256(abi.encode(
  uint16 shareBps, address recipient, address currency,
  bytes32 chargeModeId, bytes32 basisId, bytes32 roundingId,
  bytes32 accrualId, bytes32 claimId, bytes32 claimRightId,
  bytes32 controlEvidenceHash
))

attributionHash = keccak256(abi.encode(
  uint8 kind, bytes32 providerId, bytes32 partnerStatusId,
  bytes32 modelId, bytes32 modelVersion,
  bytes32 templateId, bytes32 templateVersion, bytes32 marketPathId,
  bytes32 partnerRepositoryId, bytes32 partnerCommitId,
  bytes32 partnerRuntimeCodeSetHash
))

economicsHash = keccak256(abi.encode(
  uint16 totalFeeBps, uint16 nativeCustomFeeBps,
  bytes32 partnerLegHash, bytes32 programmableLegHash
))

lifecycleAndEvidenceHash = keccak256(abi.encode(
  bytes32 activationVersion, uint64 activationBlock, bool paused, bool retired,
  bytes32 publicPolicyBindingHash, bytes32 claimIsolationEvidenceHash,
  bytes32 accountingSafetyEvidenceHash, bytes32 verificationEvidenceHash
))

feePolicyHash = keccak256(abi.encode(
  keccak256("programmable.custom-fee-policy.v1"),
  attributionHash, economicsHash, lifecycleAndEvidenceHash
))
```

The active V1 policy accepts exactly these market-path cases:

- Programmable-native Custom: 10 bps total and 10 bps to
  `0x4957f49620AFf3Adbbe8195a4f633E49cc93376c`, with no partner leg;
- AEON partner Custom: 20 bps total, 15 bps to AEON and 5 bps to the Programmable recipient, with
  `nativeCustomFeeBps = 0`; and
- no qualifying market: zero total economics and completely empty fee legs.

The same policy is exposed by `ProgrammableCustomFeePolicyVerifierV1`. A partner entry that is not AEON is not
launchable under `PartnerTemplate` until a new published verifier version explicitly defines its fee plan. There is
no global partner surcharge and no fallback 10-bps fee.

## Launch approval and registration hashes

`ProgrammableCustomRegistryV1` binds the exact source, deployment, runtime, provider/model/template/version,
configuration, permissions, market path, fee policy, review result, wallet, and public record before registration.
Its public helper methods are the canonical implementation:

- `computeFeePolicyHash`;
- `computeApprovalBindingHash`;
- `computeRegistrationBindingHash`;
- `computeRegisteredRecordCommitment`; and
- `computeReviewDeploymentBindingHash`.

The full ABI in `abi/ProgrammableCustomRegistryV1.json` is normative. Integrations must call these helpers or produce
byte-identical `abi.encode` output. Approval is exact-revision and one-use; changing any bound input invalidates it.

The public launch ID remains the Projection V2 SHA-256/RFC 8785 ID and is carried onchain as raw `bytes32`. Registry
generation, approval ID, and deployment ID are separate bound fields and never create a second public launch-ID
namespace.
