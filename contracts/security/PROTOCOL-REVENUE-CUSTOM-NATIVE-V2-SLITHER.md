# Protocol revenue Custom-native V2 Slither triage

Status: **HOLD**. Slither 0.11.5 was run independently against the exact implementation commit
`437d84959153dc7aa8514c48cae462175197cd08` with dependency findings excluded. After two detector-driven code
corrections, all three scoped targets reported zero High and zero Medium findings. This is static-analysis evidence,
not an independent review, deployment, lifecycle verification, or activation approval.

| Target | High | Medium | Low | Main disposition |
| --- | ---: | ---: | ---: | --- |
| `ProtocolRevenueClaimExecutorV1` | 0 | 0 | 3 | bounded self-call isolation and exact UTC recorder comparison |
| `ProtocolRevenueCustomClaimRecorderV1` | 0 | 0 | 1 | exact UTC cycle comparison |
| `ProgrammableCustomRevenueRegistryV2` | 0 | 0 | 1 | false-positive timestamp report in role-account comparison |

## Claim Executor

- **Calls in a loop:** the worker batch is capped at eight unique source IDs. Every low-level call is an exact
  self-call with an immutable 150,000 to 1,500,000 gas bound. The self-call exists to roll back a malformed source
  independently while permitting another finalized Custom source to proceed.
- **Low-level calls and assembly:** external source return and revert data is copied only when its size is exactly one
  ABI word. The failure helper reads only the first word of already bounded self-call data.
- **Reentrancy:** the only enabled public claim entrypoint, `claimBatchAndRecord`, is transiently guarded. The legacy
  unrecorded `claimSource`, `observeSource`, and `claimBatch` selectors always revert. An adversarial reward-wallet
  callback into the enabled recorded entrypoint is covered by the test suite.
- **Registrar boundary:** every source ID must map to a nonzero launch ID whose exact immutable Custom registrar says
  is currently finalized and executable. Core registration alone is insufficient.

## Stateful Claim Recorder

- **Timestamp:** `block.timestamp / 1 days` is the specified UTC cycle identity. It is compared for exact equality and
  does not control a price, privilege, recipient, or claim amount. The record separately binds the exact claim block;
  Phase B must wait for the finalized canonical receipt.
- **Zero totals:** empty batches revert and roll back the complete claim transaction. This prevents permissionless
  callers from filling the durable settlement queue or preempting a later positive batch with empty receipts.
- **Writer and replay:** the writer is one immutable predicted ClaimExecutor address. There is no admin, proxy,
  upgrade, arbitrary writer, transfer, split, swap, or recovery function. Record membership is permanent and the same
  cycle plus exact batch commitment cannot be written twice.
- **Phase-B port:** `claimRecord(bytes32)` returns membership plus cycle, total, source-totals commitment, batch
  commitment, activated source binding, and claim block from state. The event mirrors the common record fields but is
  not the authority for membership.

## Custom Registry V2

- **Timestamp detector:** the reported expression is a comparison of an operational role `account` to the zero address
  and other roles. It does not read `block.timestamp`.
- **Assembly:** the source fee-rate and cumulative-counter reads accept exactly one ABI word and reject malformed or
  oversized returns.
- **Launch binding:** the approval commits the exact expected Launch Stamp hash. Admission equality-checks that hash,
  verifies the exact predicted CREATE2 source/runtime and native 10 bps policy, requires a zero pre-worker claim
  baseline, and binds the canonical Ethereum v4 PoolManager address and runtime code hash.

## Residual release boundary

The candidate remains undeployed. Constructor-specific runtime code hashes contain immutable values and therefore
cannot be replaced by the unpatched artifact-template hashes. Exact addresses, roles, nonce-derived Recorder/Executor
pair, activation commitment, deployed runtime hashes, source verification, settlement direct-read binding, worker
integration, independent review, finality lifecycle, and monitoring must all be proven before activation.
