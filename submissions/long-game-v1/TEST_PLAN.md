# Test plan

The Foundry suite retains the untouched reference-kernel tests for fee-floor examples, independent cumulative
remainders, fragmentation resistance, all four ordinary quadrants, both quote orderings, partial fills, dust,
PoolKey/PoolManager authentication, exact permission bits, ERC6909 claims, claim destinations, and conservation.

Long Game tests cover frozen constants, verified buy custody/basis, partial and full sells, profitable/loss/mature exits,
no-other-holder full rebate, seller self-reward exclusion, unverified-sell rewards, activation, partial/full withdrawal,
wrong router/pool/manager, malformed/changed/replayed/expired intents, verified exact-output rejection, ordinary
exact-output execution, donation isolation, claim redirection, and double claims. Math fuzzing covers proportional basis
and overflow-safe penalty bounds.

The stateful invariant handler randomizes exact-input buys, partial sells, withdrawals, and rebate claims across every
created position. After each sequence it checks base custody, scaled quote conservation, token conservation, basis
conservation, aggregate position tokens, and zero handler reverts. Exact commands, counts, runs, depth, sizes, gas, and
tool versions are recorded in `evidence/test-evidence.json` only after execution.

Reentrancy is bounded structurally by standard ERC20-only assets, immutable PoolManager callbacks, no arbitrary calls,
checks-effects-interactions, the hook/router transient guards, and the absence of a same-pool self-swap path. A hostile
callback token is unsupported and should revert or be rejected at deployment review; it is not represented as a
supported-token pass.

Before release, independently run Slither or an equivalent reviewed analyzer, a pinned Ethereum mainnet-fork lifecycle,
a current-head smoke test, differential fee/accounting tests, gas and size review, economic/security review, exact
CREATE2/deployment verification, runtime matching, event replay/reconciliation, and incident-monitoring drills. A
missing command is marked blocked or not run, never passed.

Tests prove only the local source revision and mock PoolManager lifecycle they execute. They do not prove deployment,
live fee collection, provider approval, routing support, acceptance, or availability.

