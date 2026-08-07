# Programmable Custom Registry generation 2 hash specification

## Compatibility boundary

Generation 2 deliberately keeps `IProgrammableCustomRegistryV1` as the launch-record integration ABI. The
`LaunchRegistrationV1` tuple contains 37 fixed fields followed by the nested fee policy. Its field order, function
selectors, and 15 registration/lifecycle event signatures remain frozen. Generation 2 adds four capability event types
from a fixed execution-policy Registry. A bare Generation 2 registration without its exact same-transaction summary,
route rows, and source rows is invalid for public projection. The closed public v2 launch object remains unchanged;
the proof is exposed as a separately versioned linked trade-capability resource, so unchanged blind clients continue
to decode launch objects without accepting the new resource as transaction authority.

The Developer record producer is a separate compatibility boundary: record v3 commits only 34 fixed words and
cannot reproduce this contract commitment. Record v3 remains frozen; contract-parity consumers use additive record
v4 with `configurationHash`, `permissionsHash`, and `marketPathId`. This producer revision does not change the public
contract ABI version. Full contract-parity projection is exposed on a linked, versioned API v2 trade-capability
resource; the previously published closed v2 launch object remains byte-for-byte decodable by unchanged clients.

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
provider factory:       keccak256("programmable.custom-provider-factory.v2")
partner approver role: keccak256("programmable.custom-partner-factory.approver.v2")
partner revoker role:  keccak256("programmable.custom-partner-factory.revoker.v2")
revision approval:      keccak256("programmable.custom-execution-policy-revision-approval.v1")
corrected record:       keccak256("programmable.custom-execution-policy-corrected-record.v1")
trade capability:      keccak256("programmable.trade-capability.v1")
trade route:           keccak256("programmable.trade-route.v1")
trade route set:       keccak256("programmable.trade-route-set.v1")
market identity:       keccak256("programmable.trade-market-identity.v1")
market set:            keccak256("programmable.trade-market-set.v1")
market data source:    keccak256("programmable.market-data-source.v1")
market source set:     keccak256("programmable.market-data-source-set.v1")
market metric set:     keccak256("programmable.market-data-metric-set.v1")
market event ABI:       keccak256("programmable.market-event-abi.v1")
market event filter:    keccak256("programmable.market-event-filter.v1")
market derivation:      keccak256("programmable.market-data-derivation.v1")
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

Generation 2 extends that configuration with a companion `ProviderFactoryBindingV2` hash over the launch/approval,
expected primary address/runtime, provider factory/runtime, launch selector/value/calldata/result, exact source/build/
artifact revision, result-decoding policy, and evidence. Registry authority remains with the immutable registrar.
Provider-factory execution accepts only `ProxyKind.None`, `implementation == providerFactory`, the exact direct runtime
hash, and zero proxy/admin/beacon fields. Runtime substitution fails authorization and launch.

## Trade-capability composition

`capabilitySetHash` is exactly `computeTradeCapabilityHashV1(capability)`. The Registry approval and immutable launch
identity commit that hash and a canonical `marketSetHash`. The execution-policy Registry independently recomputes the
approval/registration binding, canonical route/source hashes, and the deduplicated sorted market set before emitting
companions. Native registrar and authorized provider-factory paths use the same validator.

Routes are strictly ordered by `marketId`, `marketPathId`, mode, target, adapter ID, selector, configuration hash,
then full route hash. Multiple targets for the same market/path are allowed; exact duplicates are rejected. The
market-set preimage deduplicates adjacent `(marketId, marketPathId)` tuples. The canonical project-only empty hash is
`0xbd6f28a96b79921f21d91177e262ccb903f8cee746201feb41bcd74385ae3eef`. Sources are strictly ordered by
market ID, source ID, kind, event emitter, StateView, configuration hash, then source hash.

`executionEnabled` declares that at least one non-paused, non-retired `standard` or `adapter` route exists. It does
not depend on the current block. Current execution is dynamically re-evaluated from activation, lifecycle/finality,
pause/retirement, runtime/configuration/dependency matches, and current proxy slot/beacon evidence. A delayed route
can become executable without changing its immutable hash; an unsupported-only set is always false.

Execution modes are `unsupported`, `standard`, and `adapter`. Unsupported disables execution only; exact quote,
simulation, read, and event-source identities may remain bound. Standard v4 execution binds Universal Router policy,
PoolManager and Permit2 dependencies, planner commands/actions, hook data, calldata/value/recipient/deadline/slippage,
delta accounting, settlement, nonstandard-token policy, Hook runtime/permissions/review, and Quoter/StateView
identities. It rejects direct PoolManager execution. Adapter mode additionally binds adapter ID/version and direct or
proxy implementation/admin identity. Event and StateRead sources separately bind target runtime and, for proxies,
implementation/admin identities. Runtime, implementation, admin, or configuration drift disables the affected
capability but never erases immutable origin discovery.

### Canonical market metric set

Every market-data source commits at least one explicit metric identifier through `metricsHash`. The canonical preimage
is:

```text
keccak256(abi.encode(
  keccak256("programmable.market-data-metric-set.v1"),
  metricIds
))
```

`metricIds` is a nonempty `bytes32[]` of at most 256 entries. Entries are interpreted as unsigned 256-bit values and
must be strictly ascending, unique, and nonzero. Unknown future IDs are valid and must be preserved exactly; consumers
must not relabel an unknown ID as one of the standard metrics. The four standard IDs and their hashes are:

```text
charting  keccak256("programmable.market-data-metric.charting.v1")
          0x2a714fded90cab08c12dfa552dbf62db33ad0f88046d103ce8da2333cda5661e
price     keccak256("programmable.market-data-metric.price.v1")
          0x6ded616800dca9683566cb991d1cb94dd2f63cd767ccbf8254ca8510e45333c3
volume    keccak256("programmable.market-data-metric.volume.v1")
          0xa219cc0dbef5b006f060be31eeedc33471a75390d2306bb8ecc19ec2903d6347
liquidity keccak256("programmable.market-data-metric.liquidity.v1")
          0xe937ec83fc68a3f15b1d8169b28114096837f316757c8e8323953622a42f53e9
```

Their numeric order is charting, price, volume, liquidity. The helper rejects an empty input. The theoretical encoding
of an empty list is nevertheless frozen as
`0x7b5384e78f1bd4310c1264ebe06d19b2fc61f8ff2781748daa2e14df0387082a`, and the validator rejects that value in a
source so a buggy approval implementation cannot publish a no-metric source. The Golden Vector file includes exact
ordered arrays and hashes for the four-standard-metric set and the price/liquidity subset.

### Exact market event, filter, and derivation preimages

```text
topic0 = keccak256(bytes(eventSignature))
eventAbiHash = keccak256(abi.encode(
  keccak256("programmable.market-event-abi.v1"), topic0, abiContentHash, abiVersionHash
))
filterHash = keccak256(abi.encode(
  keccak256("programmable.market-event-filter.v1"),
  marketId, marketPathId, poolId, poolAddress, indexedValues, filterVersionHash
))
derivationPolicyHash = keccak256(abi.encode(
  keccak256("programmable.market-data-derivation.v1"),
  metricsHash, formulaHash, calldataPolicyHash, derivationVersionHash
))
```

The ABI digest/version, ordered indexed filter values and market/pool scope, formula, calldata policy, and derivation
version must be published. A metric remains unavailable when any preimage, runtime, configuration, or current proxy
readback is missing or mismatched; consumers must not infer it.

Revision approval binds previous/new policy hashes, the replacement flag, previous Registry record, typed
`correctedRecordPayloadHash`, reason/evidence, window, and approval evidence. The corrected Registry record is
`keccak256(abi.encode(CORRECTED_RECORD_DOMAIN, approvalId, approvalHash, correctedRecordPayloadHash))`. Revisions are
contiguous, one-use, append-only, revocable before use, and either replace the policy or explicitly retain it.

Exact tuple orders, preimages, hashes, selectors, topics, indexed topics, and event data are frozen in
`CUSTOM_REGISTRY_TRADE_CAPABILITY_V1_GOLDEN_VECTORS.json` and independently reproduced by Foundry tests.

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
