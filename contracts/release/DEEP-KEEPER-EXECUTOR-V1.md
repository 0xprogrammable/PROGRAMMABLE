# Deep Keeper Executor V1

Status: source complete and locally tested; not deployed or active.

`DeepKeeperExecutorV1` is a permissionless relay for sponsored Deep keeper
transactions. It does not replace the deployed automation contract. It binds
each submitted vault to the action observed by the keeper, reassesses that vault
in the same transaction, and only calls the existing automation contract when
both actions still match.

## Fixed behavior

- The immutable automation target is
  `LiquidityGrowthFullRangeAutomationV1`.
- A batch contains at most eight unique, nonzero vaults.
- `None` is not a valid expected action.
- A fresh `assessVault` result of `None` or a different action is skipped.
- Assessment and execution calls have fixed gas stipends.
- One reverting or out-of-gas candidate cannot spend the gas reserved for later
  candidates.
- Every accepted candidate emits exactly one `CandidateResult`, bound to the
  ordered batch hash, candidate index and vault.
- There is no owner, role, upgrade path, payable entry point or withdrawal
  function.

The action stipends are:

| Action | Gas stipend |
| --- | ---: |
| Assessment | 150,000 |
| Process fees | 700,000 |
| Compound pending | 220,000 |
| Grow oracle | 450,000 |

These are transaction-level isolation limits, not gas-price or transaction-cost
estimates. The relay reserves additional gas for every result event and rejects
a transaction whose supplied gas cannot cover the complete submitted batch
envelope.

## Result semantics

Actions use the existing automation enum:

| Value | Action |
| ---: | --- |
| 0 | None |
| 1 | ProcessFees |
| 2 | CompoundPending |
| 3 | GrowOracle |

Relay outcomes are:

| Value | Outcome |
| ---: | --- |
| 0 | SkippedNone |
| 1 | SkippedActionDrift |
| 2 | AssessmentFailed |
| 3 | ExecutionFailed |
| 4 | Succeeded |

`errorSelector` is the revert selector when return data contains one. An empty
selector on `ExecutionFailed` can mean an out-of-gas or empty-data revert.
Synthetic selectors identify a malformed result, an execution-time action
change, or an automation call that returned `succeeded = false`.

## Deployment integration

`DeployMainnetDeepKeeperExecutorV1.s.sol` is a separate one-transaction
deployment. It pins the existing Mainnet automation address and runtime hash,
predicts the relay address from the reviewed deployer nonce, rejects occupied
targets and validates the immutable target and fixed gas policy after
deployment.

The relay is not part of the original six-transaction Deep deployment or its
existing source commitment. Before the product can use it:

1. simulate the one-transaction deployment from the final deployer nonce;
2. review and explicitly broadcast that exact transaction;
3. verify the relay source and constructor argument on Etherscan and Sourcify;
4. record its address, transaction, block, runtime hash and source commitment in
   the Deep release and app manifests;
5. update the keeper to call `execute` with `(vault, expectedAction)` candidates
   and reconcile every `CandidateResult` with the downstream automation event;
6. refresh the keeper gas envelope because the relay performs a second onchain
   assessment for drift protection;
7. prove a real Mainnet fee-processing and compounding lifecycle through the
   relay before enabling sponsored submissions.

Until those steps are complete, this contract is reviewed source only and does
not make Deep release-eligible.
