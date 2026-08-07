# Programmable Custom Registry generation 2 hash specification

## Compatibility boundary

Generation 2 deliberately keeps `IProgrammableCustomRegistryV1` as the integration ABI. The
`LaunchRegistrationV1` tuple contains 37 fixed fields followed by the nested fee policy. Field order, function
selectors, and all 15 Custom event signatures remain frozen. A client that already decodes the c988 event set does
not need a contract-specific parser change; it selects the official address and `registryGeneration` from the
per-chain manifest.

The Developer record producer is a separate compatibility boundary: record v3 commits only 34 fixed words and
cannot reproduce this contract commitment. Record v3 remains frozen; contract-parity consumers use additive record
v4 with `configurationHash`, `permissionsHash`, and `marketPathId`. This producer revision does not change the public
contract ABI version. Full contract-parity projection is exposed on the extended public API v2 surface; API v1 and
record v3 remain compatibility-only.

## Frozen 37-field tuple order

The fixed part of `LaunchRegistrationV1` is encoded in this exact ABI order before the nested `feePolicy` tuple:

```text
 1 chainId                         20 launchWallet
 2 registryGeneration             21 modelId
 3 launchId                       22 modelVersion
 4 projectId                      23 templateId
 5 approvalId                     24 templateVersion
 6 approvalBindingHash            25 providerId
 7 repositoryId                   26 builderAttributionHash
 8 commitId                       27 originHash
 9 sourceCommitment               28 assetSetHash
10 buildCommitment                29 marketSetHash
11 artifactSetHash                30 marketPathId
12 deploymentConfigurationHash    31 capabilitySetHash
13 configurationHash              32 reviewPolicyHash
14 permissionsHash                33 securityReviewHash
15 deploymentId                   34 reviewResultId
16 deploymentSetHash              35 reviewDeploymentBindingHash
17 runtimeCodeSetHash             36 finalityPolicyHash
18 primaryContract                37 registeredRecordCommitment
19 primaryRuntimeCodeHash
```

The c988 registered-record commitment itself remains the typed nested construction:

```text
keccak256(abi.encode(
  REGISTERED_RECORD_COMMITMENT_DOMAIN,
  scopeAndApprovalHash,
  sourceAndDeploymentHash,
  attributionHash,
  reviewHash,
  feePolicyHash,
  finalityPolicyHash
))
```

`sourceAndDeploymentHash` is an `abi.encode(bytes32[14])` commitment over fields 7-20, with addresses left-padded to
32 bytes. `attributionHash` is an `abi.encode(bytes32[11])` commitment over fields 21-31. `scopeAndApprovalHash`
commits fields 1-6. `reviewHash` commits fields 32-35. Field 37 must equal the construction above before the Registry
accepts the launch.

## Retained integration domains

Generation 2 keeps the c988 integration domains because chain and generation are already inside every scoped proof:

```text
registry schema:          keccak256("programmable.custom-registry.v1")
approval binding:         keccak256("programmable.custom-approval-binding.v1")
review deployment:        keccak256("programmable.custom-review-deployment-binding.v1")
launch identity:          keccak256("programmable.custom-launch-identity.v1")
registered record:        keccak256("programmable.custom-registered-record.v1")
atomic request:           keccak256("programmable.custom-atomic-request.v1")
```

An approval or record created with `registryGeneration=1` has a different scope hash and is rejected by the
Generation 2 contract's immutable scope check. Partner configuration and fee policy use new V2 domains below.

The main Registry retains the reviewed V1 approval, review-deployment, identity, and registered-record domains.
Replay remains fail-closed because `chainId` and `registryGeneration` are committed in the scope hash and checked
against contract immutables before authorization, registration, finalization, correction, or revocation.

## Generation 2 domains

```text
fee policy:            keccak256("programmable.custom-fee-policy.v2")
partner configuration: keccak256("programmable.custom-partner-configuration.v2")
partner approver role: keccak256("programmable.custom-partner-factory.approver.v2")
partner revoker role:  keccak256("programmable.custom-partner-factory.revoker.v2")
```

The partner configuration preimage is:

```text
keccak256(abi.encode(
  CONFIGURATION_DOMAIN,
  keccak256(abi.encode(
    providerId, modelId, modelVersion, templateId, templateVersion,
    modelRepositoryId, modelSourceCommitId
  )),
  keccak256(abi.encode(
    factorySourceRepositoryId, factorySourceCommitId,
    chainId, registryGeneration, factory, factoryRuntimeCodeHash,
    launchRuntimeCodeSetHash
  )),
  permissionsHash,
  feePolicyHash
))
```

Changing provider, model/template, either source revision, chain, generation, factory, live factory runtime,
authorized launch runtime set, permissions, or fee policy changes the configuration commitment.

## Fee policy

The V2 fee hash commits attribution, economics, lifecycle, and evidence under the V2 domain. The verifier is
provider-neutral and performs only structural/economic validation. The main Registry separately requires exact
factory authorization for every nonzero provider attribution.

- Native Custom: `totalFeeBps=10`, `nativeCustomFeeBps=10`, partner leg zero, Programmable leg `10`.
- Partner template: `totalFeeBps=20`, `nativeCustomFeeBps=0`, partner leg `15`, Programmable leg `5`.
- Both partner legs share currency, charge mode, basis, and rounding, while recipient and claim-right IDs differ.
- No qualifying market: all fee attribution/economic fields are zero; only nonzero policy/evidence commitments remain.

No fee hash proves that a deployed contract actually accrues or pays fees. That fact still requires exact source,
runtime, configuration, permission, accounting, and claim evidence bound by approval and factory authorization.
