# Owner gate ledger

## Current decision

There is no owner gate. Testnet preparation stops before owner review because
the specification, release identity, Collector and deployer inputs are not
complete. Mainnet is prohibited by the locked Draft and its
`production_eligible=false` status.

| Gate input or action | Testnet | Mainnet | Evidence |
| --- | --- | --- | --- |
| Twelve Protocol gaps resolved | No | No | `protocol-gap-report.json` is `BLOCKED_BY_SPEC` |
| Binding Release | Absent | Absent | locked Protocol inventory has zero |
| Passing Conformance Report | Absent | Absent | cannot be completed against current gaps |
| Exact reviewed deployment-ready implementation release | Absent | Absent | non-production architecture or revision-bound foundations evidence does not satisfy this gate |
| Proposed Collector address supplied and reviewed | No | No | no owner-supplied proposal or address-type/code/dependency review recorded; selection occurs at owner approval |
| Deployer selected | No | No | no address recorded |
| Constructor arguments frozen | No | No | depend on Collector and release |
| Predicted addresses frozen | No | No | depend on deployer, nonce and artifacts |
| Unsigned payload built | No | No | exact inputs unavailable |
| Gas/cost ceiling approved | No | No | no payload or fresh estimate |
| Owner-provided Robinhood/provider Terms acceptance evidence | Absent | Absent | no owner record or click-through action is present; legal effect of read-only access is not assessed |
| Owner action requested | No | No | preparation has not reached owner gate |
| Owner transaction signed | No | No | owner-controlled and not requested |
| Canonical-network transaction broadcast | No | No | no canonical-network transaction evidence |
| Canonical deployment verified | No | No | no canonical runtime or explorer evidence |

## Inputs required for a future testnet gate

A future package must bind the resolved Protocol lock; Binding Release and
Conformance Report; implementation commit/tree; compiler and artifact digests;
deployer; owner-supplied proposed Collector address plus address-type, code,
dependency and ultimate-beneficiary review; exact constructor arguments;
expected addresses;
fresh network/finality observation; unsigned transaction; gas estimate and
maximum ETH cost; expiry rules; and post-deployment verification steps.

The package must be technically unable to read a key, sign or broadcast. The
owner must review the consequence of fixing that Collector address in Core and
the total cost, then select and approve the address only through that exact gate
before any external action. No owner-provided acceptance record or click-through
acceptance action is present. The legal effect of access to official
documentation, public RPC, testnet or explorer services is not assessed here,
and this record makes no non-acceptance claim. Any future access to those
services requires explicit owner authorization for that run.

## Evidence handling

Do not insert zero, null, example or predicted addresses into a deployment record
and count them as evidence. If a prepared package becomes stale, preserve its
identity and write a separate invalidation record; do not silently rewrite it.
After authorization, record signature, broadcast, receipt, runtime, source
verification and finality as separate evidence axes.
