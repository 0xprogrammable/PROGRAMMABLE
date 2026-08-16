# Custom Gateway Route V1 release candidate

## Status

This closure is a local, candidate-neutral source release candidate. It has not been deployed, signed,
broadcast, pushed, merged, or activated. It does not claim that any launch is registered or finalized.
The authenticated internal `routeAdapterRelease.adapterBindingHash` remains a required integration input;
deployment must fail closed until its raw `bytes32` value is frozen with the corresponding adapter release.

The rejected Shards revision `8afe4548553b406bd0374b3a8958f1a186104b11` is Registry V1 and
candidate-specific. None of its route contracts is reused here.

## Frozen architecture

The stack has four immutable contracts:

1. `ProgrammableCreate2GraphDeployerV1` is the byte-for-byte current Generic-v2 implementation from
   internal commit `0ab53dcc50e3245eb653eacadd10545a6df8d49c`. Its expected runtime code hash is
   `0xd23692fae59331592048e71a96d4963e170ee56e449683dc9f7fa3f9470018b8`.
2. `ProgrammableRouteGatedCreate2GraphFactoryV1` reproduces the implementation's two storage slots and
   delegates only the existing `deployGraph` selector to that exact runtime. Only its immutable Gateway may
   invoke the state-changing route. It rechecks all dependency runtime hashes before every graph execution.
3. `ProgrammableCustomLaunchGatewayV1` is the single user-transaction boundary. It accepts only the exact
   Registry-v2 descriptor already bound to an active approval, the exact descriptor launch wallet, the exact
   Gateway/factory route, and the exact reviewed graph and output commitments. It has no administrator,
   upgrade, sweep, arbitrary call, registration, or finalization function.
4. `ProgrammableCustomGatewayRoutePairCoordinatorV1` atomically deploys the implementation, factory, and
   Gateway with CREATE nonces 1, 2, and 3. This resolves their circular immutable address binding without a
   CREATE2 fixed point. Its initcode is 28,332 bytes, below the 49,152-byte EIP-3860 mainnet limit.

Both execution contracts are pinned to Ethereum chain ID 1, live `CustomRegistryV2`
`0x845506084a1AfB969fa4DeF444A2bdeEe794AAad`, Registry runtime hash
`0x74d8196e2d40d030c66b147e835cbdf6dd0ab61c964fb3ef3890d86ed7daf074`, Registry generation 2,
policy commitment `0xa51733b58306cf89580bd3c4f39935583db3196c3ab62ecd73644fff2e13b892`,
12 finality blocks, canonical PoolManager `0x000000000004444c5dc75cB358380D2e3dE08A90`, and PoolManager runtime hash
`0x785f1014552b7ce7d5fb7d0c970ca60edee94fd00425d7ca21609acac7ce1293`.

## Minimal interface delta

The Generic-v2 `GraphAuthorization` and `Target` ABI and `deployGraph` selector `0x196d9f22` remain unchanged.
The wrapper also preserves the previously missing full-ABI compatibility getters
`GRAPH_DEPLOYMENT_ACCUMULATOR_TYPEHASH()` (`0x8997cff4`) and `MAX_INITIALIZER_REVERT_BYTES()`
(`0xffde2a6d`) with the exact Generic-v2 values. Its published artifact ABI includes every Generic-v2 function,
both delegate-emitted events, and every delegate-bubbled custom error as exact canonical ABI entries.
The unavoidable adapter delta is one Gateway entry point:

`executeApprovedGraph(ApprovedGraphExecutionV1 execution, Target[] targets)`

The internal route builder must target the Gateway instead of the ungated Generic-v2 factory and set
`authorization.authorizedLauncher` to that Gateway. It must preserve the current Generic-v2 derivations of
`routeNamespace` and `routeNonce` from application/source/chain/route-generation inputs; the independent
`approvalId` remains a separate Registry identity. The Gateway does not reinterpret descriptor fields:
`descriptor.launchPlanHash` remains the SHA-256 digest of the authenticated current `launch/plan.json` artifact.
The Registry approval commits the complete descriptor, including its source, configuration, plan, project, market
mode, and fee fields. The Gateway additionally verifies the exact approved primary address/runtime and atomically
checks the preflight-derived graph-deployment accumulator after execution. Before approval, the internal adapter
must derive `approvalId` with `Gateway.computeExecutionApprovalId`. That ID commits the descriptor hash, exact
Generic-v2 graph commitment, route namespace/nonce/topology, Gateway launcher, value, primary index, expected
graph-deployment accumulator, adapter/Gateway/Registry/factory release identities, and approval window. The live
Registry then authorizes that exact ID without any Registry ABI change.

## State transitions and security properties

- An approval may be used only while its live Registry-v2 state has the exact descriptor hash, is current, and
  is not consumed. The Gateway reconstructs the execution-bound approval ID from the supplied targets before any
  target deployment; an initializer, sidecar, salt, initcode, value, route, primary index, or expected accumulator
  mutation therefore fails before CREATE2 or target initialization. The Gateway additionally consumes the approval
  ID locally before its first external graph execution. Any later failure reverts that write atomically.
- `msg.sender` must be the exact approved launch wallet. Copying the public calldata cannot steal the launch.
- The Gateway's reentrancy lock covers Registry reads, graph deployment, constructors, initializers, runtime
  observation, and event emission. The delegated implementation has a separate compatible guard in factory
  storage.
- The graph is bounded to 16 targets and 524,288 total input bytes. CREATE2 salts, constructor code,
  initializer calldata, values, topology, launcher, and route are committed before execution. Target runtime
  hashes and the graph-deployment accumulator are verified after initialization; every mismatch reverts the
  complete transaction.
- The exact implementation extcodehash is checked at use time. Factory and Gateway runtimes and bindings are
  cross-read during construction, and dependency hashes are checked at use time. There is no mutable trusted
  implementation or owner.
- `msg.value` must equal both the authorization total and the sum of deployment and initializer values. The
  stack retains no intended funds; force-fed ETH is inert and excluded from this accounting.
- A successful Gateway event is execution evidence only. It is neither Registry registration nor finality.
  Registry approver, registrar, and finalizer controllers remain distinct authority boundaries.
- Execution requires 13 approval blocks remaining: the reviewed Ethereum route confirmation depth of 12 plus one
  registrar-inclusion block. Execution at an approval's last confirmation block therefore fails before deployment.

The current Registry-v2 ABI treats `approvalId` as an approver-authorized opaque `bytes32`. The Gateway uses that
existing field as a domain-separated SHA-256 execution commitment, avoiding any Registry or descriptor ABI change
while preserving the existing descriptor meanings. The internal approval adapter must replace its prior opaque ID
derivation with the exact Gateway formula and retain the signed approval receipt as `approvalEvidenceHash`. The
later registrar/finality verifier must still keep the authenticated adapter, artifact, exact calldata, receipt,
event, and runtime checks and must refuse registration on any mismatch. It must accept the execution event only
from the frozen Gateway address, Generic-v2 target/summary events only from the frozen route-gated factory address,
and Registry transition events only from the canonical Registry address; topic signatures without emitter binding
are not evidence. The Gateway transaction alone does not make a deployment official.

The immutable design intentionally has no emergency admin. A defect requires deploying and explicitly approving
a new stack; the old Gateway can no longer execute a given approval ID after success, but it cannot be paused.
Registry controllers may refuse or delay official registration/finalization, but cannot revert an already-final
project deployment. Therefore the approval validity window must cover the user transaction and later registration
in addition to the enforced 13-block safety margin, and the website must present a launch as official only after
the canonical Registry reports `Finalized`.

## Exact later operator and wallet transactions

These actions are deliberately not performed by this release-candidate task:

1. Freeze the authenticated internal adapter release and substitute the raw, non-zero
   `routeAdapterRelease.adapterBindingHash` into the deployment input.
2. Authorized deployment operator sends one Ethereum mainnet transaction creating
   `ProgrammableCustomGatewayRoutePairCoordinatorV1(bindingHash)`. Before signing, derive the coordinator from
   the operator address and exact nonce; derive its three CREATE child addresses; simulate the exact transaction.
3. Wait for the production confirmation policy, verify every source and compiler setting, compare every runtime
   hash, and read back all immutable cross-bindings. Do not activate a route whose readback differs from the
   generated release manifest.
4. For each launch, derive the exact approval ID with `Gateway.computeExecutionApprovalId` from the final descriptor,
   Generic-v2 authorization, primary target index, expected graph-deployment accumulator, and intended window. The
   `APPROVER_ROLE` controller calls `CustomRegistryV2.authorizeApproval(ApprovalAuthorizationV2)` for that ID and
   descriptor hash with a window that leaves at least 13 blocks at execution time.
5. The exact descriptor `launchWallet` sends one transaction to
   `Gateway.executeApprovedGraph{value: authorization.totalValue}(execution, targets)`.
6. After the execution receipt and project runtimes meet the operational confirmation policy, the
   `REGISTRAR_ROLE` controller calls `CustomRegistryV2.registerLaunch(descriptor, approvalId,
   registrationEvidenceHash)` with fresh, non-reused evidence.
7. After at least 12 blocks beyond the observed registration block, while its block hash remains available to
   the EVM, the `FINALIZER_ROLE` controller calls `CustomRegistryV2.finalizeLaunch(launchId, evidence)` with the
   canonical observed and confirmed-head hashes and fresh finality evidence.
8. Read back the finalized Registry state and exact descriptor before the public product reports an official
   launch.

No transaction hash alone is proof of deployment correctness, registration, finality, or public activation.

## Local verification gates

- Foundry format and compilation under the repository's pinned Solidity 0.8.26 settings.
- Reproduction of the frozen Generic-v2 source and runtime hashes.
- Mainnet-fork dependency identity and runtime checks at pinned block `25767247`, hash
  `0x4f5631c21b5b4ef7c08931546621bbf028213138377f3d591de1874e8336d48d`.
- A real local-fork Registry-v2 controller lifecycle using the deployed Registry's approver, registrar, and finalizer
  roles: authorization, user Gateway execution, 12 route-confirmation blocks, registration, 12-block Registry
  finality, finalization, counters, state, descriptor, commitments, and emitter-bound event topics. Only future block
  hashes required by the finality proof are simulated.
- Unit, 1,000-run fuzz, and 256-run invariant coverage of exact execution, direct-factory rejection, launch-wallet
  binding, plan mutation, replay, dependency drift, non-zero deployment/initializer value accounting, initializer
  reentry rollback, full Generic-v2 operational ABI getters/selectors, and the immutable Gateway gate.
- Storage-layout equality for the delegated implementation and route-gated factory.
- Artifact-level Generic-v2 ABI subset parity for all 16 functions, 2 events, and 18 custom errors.
- EIP-170 runtime and EIP-3860 initcode size checks.
- Deterministic source/artifact manifest generation and a clean local Git commit/tree/patch freeze.

These gates support a later release decision; they are not a substitute for an independent professional audit,
an authenticated adapter binding, operator authorization, onchain deployment/readback, or a real end-to-end
launch.
