# Security and evidence workflow

This workflow scales evidence to the model's capability risk. It is not an audit substitute.

## 1. Freeze the review target

Before security work, record:

- Model id and semantic version
- Git commit and clean-worktree status
- Solidity version, source commit and tree, resolved executable hash, EVM target, optimizer, runs, via-IR, bytecode
  metadata, FFI settings, standard JSON input and output, and build-info
- Every dependency repository and exact commit when available, exact package version and sha512 integrity declaration,
  license, tree hash, and whether the package closure was independently verified or only builder-declared
- Deployment-feed timestamp and source revision used for chain addresses
- Stable dependency ids and exact trusted deployment record ids for supported onchain protocol contracts
- Hook permission mask, constructor arguments, CREATE2 deployer, salt, initcode hash, expected address, and expected
  runtime hash
- Exact router generation, SDK versions, chain ID, PoolManager, PositionManager, StateView, Quoter, and Permit2

Any change to these values creates a new review target. Never carry a result across a changed target silently.

## 2. Static and structural checks

Run and preserve results for:

- Exact compiler known-bug review
- Compilation warnings and runtime/initcode size
- Slither detectors with dependencies separated from model-owned findings
- Inheritance graph
- Function and modifier surface
- State-variable writers and authorization map
- Proxy, clone, implementation, admin, beacon, delegatecall, selfdestruct, pause, arbitrary-call, mint, sweep, and rescue
  detection
- Permission declaration versus hook address bits
- Callback selector and return length, immutable PoolManager authentication, parent permission, and self-call suppression
- Import closure and license provenance
- Declared dependency id, address, chain, source revision, runtime hash, interface, and deployment-record reconciliation

Do not delete a finding because it looks inconvenient. Record a technical disposition with file, line, impact, and test
evidence. A false-positive label without reasoning is not a disposition.

## 3. Security properties

Write properties before or alongside implementation. At minimum cover:

### Authorization

- Only the immutable PoolManager enters callbacks.
- Every enabled callback returns its exact selector and ABI shape; disabled callbacks are unreachable.
- Callback `sender` is never treated as the end user without separate authenticated identity.
- Nested or self-initiated actions cannot bypass callback suppression, pool admission, or accounting namespaces.
- Each privileged action has one explicit authorized capability set.
- No role can gain an undisclosed capability through arbitrary calls, delegatecall, upgrades, rescue, or initializer reuse.
- A recipient can claim or redirect only its own entitlement unless a disclosed model explicitly says otherwise.

### Accounting

- Every account-currency delta touched during an unlock is settled to zero before the unlock ends.
- Every settlement step has one actor, currency, delta owner, sign, amount rule, operation, and completion deadline.
- A `sync → transfer-to-PoolManager → settle` sequence preserves actor, currency, and amount basis.
- Positive credits and negative debts use the correct sign and currency in all four swap quadrants.
- Hook-returned deltas are balance-backed and cannot create unexplained credit.
- Internal liabilities never exceed assets or PoolManager claims controlled by the responsible contract.
- Fee, reward, share, liquidity, and dust accounting conserves value under explicit rounding rules.
- Recipient shares sum to the disclosed total; duplicate, zero, reverting, and reentrant recipients cannot redirect or
  block another beneficiary's entitlement.
- ERC-6909 aggregate liabilities remain bounded by the corresponding claim balance or redeemable underlying for every
  currency, PoolId, and beneficiary namespace.

### Configuration

- The registered PoolKey, fee mode, tick spacing, hook, asset ordering, beneficiaries, bounds, and custody match the
  compatibility lock.
- Immutable values never change. Mutable values remain inside declared bounds and can only be changed by declared roles.
- CREATE2 address and permission bits are reproducible from the exact creation code.

### Custody and exits

- Every deposited asset has an owner, claim, withdrawal, lock, or deliberately permanent destination.
- A failing recipient cannot steal or redirect another recipient's value.
- A dependency failure preserves the stated exit or fail-closed behavior.
- Position and share ownership match public custody claims.

### Liveness

- User exits, claims, cancellation, and recovery remain bounded.
- Keeper or oracle failure cannot create a silent inconsistent state.
- Autonomous actions are idempotent, bounded, observable, and safe to retry.

## 4. Test layers

### Unit tests

Cover every parameter boundary, error, role, event, permission, fee step, rounding example, and failure path. Include zero,
one, minimum, maximum, and overflow-adjacent values.

### Integration lifecycle

Run the complete model path through real PoolManager semantics:

```text
create/register
→ initialize
→ add or lock liquidity
→ initial transaction
→ buy exact input
→ buy exact output
→ sell exact input
→ sell exact output
→ accrue and claim
→ dependency failure
→ recovery or expected fail-closed state
```

Mark an action `not applicable` only with a reason and a test or structural argument showing that no callback, public
entry point, or dependency can trigger it.

### Fuzz tests

Fuzz amounts, actors, bounds, currencies, malformed calldata, hookData, timestamps, signatures, token returns, oracle
values, and recipient behavior. Assert useful-call and revert counts.

### Stateful invariants

Exercise mixed sequences of swaps, liquidity changes, donations, claims, configuration changes, keepers, oracle updates,
and failures. Check conservation, solvency, authorization, immutable configuration, custody, fee bounds, and exits after
every sequence.

For share, hook-owned reserve, active/idle or JIT models, add exploit-derived sequence regressions:

- drive price or one asset balance to an extreme, fragment a withdrawal into repeated tiny burns, then reverse the swap;
  absent external inflow or yield, attacker round-trip profit after fees is non-positive;
- compare `N` tiny withdrawals with one aggregate withdrawal; assets, shares, allocation and executable output may differ
  only by declared, bounded dust that does not grow materially with call count;
- cross every token-side, range, active/idle, asset/share and vault-conversion branch in both rounding directions;
- interleave swaps, claims, vault actions and same-currency cross-pool operations at zero, one, boundary and
  asymmetric-decimal values;
- preserve first/last-depositor, donation/inflation, solvency and non-zero-total-supply safety.

Keep a fixed incident-shaped regression and a generalized stateful invariant suite. Assert value conservation, bounded
dust and no unexplained profit; raw liquidity need not be monotonic when price legitimately changes.

### Adversarial mocks

Add only those triggered by the design, including:

- false/no/malformed-return ERC-20
- fee-on-transfer and rebasing token
- reentrant ERC-777/ERC-1363-like token
- reverting and reentrant ETH recipient
- malicious router, hookData, callback, flash lender, smart account, signer, oracle, keeper, proxy, vault, or bridge
- alternate PoolKey and shared-hook fake launch

### Callback and settlement evidence

For every enabled callback test:

- correct and wrong PoolManager
- exact selector and return-data length
- declared parent and return-delta permission pairing
- malformed hookData and false end-user assumptions
- direct and router-mediated nested actions, including maximum depth
- revert before and after state writes
- final PoolManager deltas and hook liabilities after the unlock

For custom accounting, test ordered settlement actions under positive credit, negative debt, zero, rounding dust,
partial fill, recipient failure, and repeated execution.

For JIT or vault-backed accounting, separately prove per-`(PoolId, Currency)` ownership of raw ERC-20, ERC-6909 claims
and vault shares. Test economic assets versus immediately realizable assets, claim backing within the same unlock,
no persistent JIT position after the swap, preview/execution divergence, vault loss/pause/cap/revert, standing allowance
risk, and cross-pool same-currency isolation.

### Reserve and routing evidence

For reserve reads, label fee-excluded core principal separately from hook-reported reserves and effective liquidity.
`ReservesLens.hasCustomAccounting` is a permission-bit warning; optional `IHookStats` values remain self-reported.
Evaluate every page at the same explicit block, preserve the returned cursor, use only a completed scan, and do not add
core and hook values without same-block, same-unit, non-overlap proof. For indexed state, bind deployment, schema
revision, start block and confirmation policy; test rollback and deterministic replay after a reorg or interrupted sync.

For multihop execution, bind every `PathKey` field and test every hook sequentially within one unlock. Include the same
hook on repeated hops, shared hook state, dynamic changes between hops, exact input/output, partial fills, Permit2,
native wrapping, refunds, intermediate zero deltas and final quote/execution parity. Universal Router, Hooklist,
UniswapX and permissioned-pool onboarding are separate evidence states.

### Dynamic-fee and recipient evidence

For a dynamic LP fee test initialization, initial value, application mode, override flag, persistent update actor and
call sites, min and max, every update path, stale input, manipulation, liquidity decrease, rate or cadence boundary, and
failure behavior. Test both swap directions and exactness modes. A 100% maximum requires explicit proof of supported core
semantics; do not assume exact-output compatibility.

For hook-owned fees, test the collection path, matching value-flow id, liability namespace, and collection event. For
recipients test the parts-per-million total, address source and launch binding, exact or derived address, rounding
remainder, duplicate and zero addresses, failed and reentrant recipients, beneficiary-only claim and redirect rules,
address validation and mutation event, historic entitlement after an address change, and the charged currency in every
supported swap quadrant.

### Dependency evidence

For every dependency id, prove that it resolves once to the declared source and configuration. Onchain evidence binds
chain, address, interface, runtime hash, block, and trusted deployment record when available. Test missing code,
unexpected runtime, upgrade or admin change, pause, revert, stale state, insolvency, and the declared fallback. Offchain
evidence binds source revision, operator, integrity where available, authentication, freshness, funding, and failure
behavior.

### Fork evidence

Use two distinct suites:

1. A reproducible fork pinned to an exact block for review and regression.
2. A current-head smoke test for current deployment compatibility.

Record chain, RPC class, block, expected contracts, runtime checks, transactions simulated, and result. A fork test is not
a deployment receipt.

### Gas and size

Set hard maximums for callbacks, launch, claims, user exits, and keeper actions. Test the declared maximum array, split,
pool, recipient, or position counts. A gas snapshot without a maximum-bound scenario is incomplete.

## 5. Capability-triggered review

| Capability | Minimum escalation before release consideration |
| --- | --- |
| Custom math or curve | Specialist math review, differential tests, formal properties where practical |
| Return deltas | High-risk accounting review, stateful invariants, fork lifecycle, independent audit |
| Hook-held or external liquidity | Custody and loss review, invariant audit, monitoring, incident plan |
| JIT liquidity or ERC-4626 inventory | Per-pool reserve/claim/share invariants, exact-vault review, sequence economics, correlated allowance and incident plan |
| Oracle or external pricing | Manipulation and stale-data review, dependency monitoring, math review |
| Keeper or autonomous action | Liveness, idempotency, gas-runway, fallback, monitoring, incident plan |
| Upgradeability or material admin control | Storage and initializer validation, governance/timelock review, public trust disclosure |
| Permissioned or regulated asset | Issuer, redemption, legal, compliance, custody, freeze/pause, jurisdiction, and routing review |
| ZK proof | Verifier and circuit review, domain/nullifier/replay tests, setup provenance, privacy analysis |
| Cross-chain message | Bridge-specific security review, finality/reorg/replay/liveness plan |
| High value at risk | Independent audit, monitoring, incident process, bug-bounty decision |

Repository tests alone cannot satisfy these review gates.

## 6. Deployment and release evidence

Do not combine deployment planning with broadcast.

### Deployment plan

Record chain, deployer, nonce strategy, expected addresses, constructor or initializer arguments, exact value, required
post-deploy reads, source verification inputs, lifecycle transactions, rollback limitations, and monitoring setup. Store no
secret material.

### Post-deploy evidence

After separately authorized execution, capture:

- Transaction hashes, receipts, blocks, chain ID, deployer, and constructor inputs
- Runtime hashes at `latest` and a confirmed or safe block
- Proxy, implementation, admin, beacon, clone, and delegatecall evidence
- PoolManager, permissions, fee bounds, roles, recipients, custody, and initialization state
- Exact source and compiler metadata verification
- Buy, sell, liquidity, claim, recovery, and model-specific lifecycle receipts
- Independent RPC reconciliation
- Monitoring state and remaining blockers

### Availability gate

Only maintainers may move the exact release to `available`. Source verification, Hooklist inclusion, routing review,
indexer visibility, and product activation are separate provider or maintainer states.

## 7. Security wording

Allowed:

- “Repository tests passed at commit …”
- “The runtime hash matched the recorded release at block …”
- “No independent audit has been completed.”
- “This design requires review of return-delta accounting.”
- “The pinned upstream report reviewed the named files and revision; this derived model is outside that scope.”

Not allowed:

- “Safe”
- “Unruggable”
- “Uniswap approved”
- “Verified” without naming exactly what was verified
- “Live” based only on code, simulation, source match, or one canary
- “Audited” because a dependency, ancestor, factory or similar upstream model was reviewed

## Primary references

- [Uniswap Foundation Hooks Security Framework](https://github.com/uniswapfoundation/security-framework/tree/e7e8da52fd5717b6eb4517ea779b766f63148c41)
- [Uniswap known effects of hook permissions](https://github.com/Uniswap/v4-core/blob/46c6834698c48bc4a463a86d8420f4eb1d7f3b75/docs/security/Known_Effects_of_Hook_Permissions.pdf)
- [Uniswap permissioned-pool architecture](https://developers.uniswap.org/docs/protocols/v4/permissioned-pools/architecture)
- [Uniswap DualPool inventory and yield](https://developers.uniswap.org/docs/protocols/v4-hooks/dualpool/concepts/inventory-and-yield)
- [Uniswap v4 reserve-reading guide](https://developers.uniswap.org/docs/protocols/v4/guides/reading-pool-reserves)
- [Bunni exploit postmortem](https://blog.bunni.xyz/posts/exploit-post-mortem/)
- [Foundry invariant testing](https://getfoundry.sh/forge/invariant-testing)
- [Solidity compiler bug list](https://docs.soliditylang.org/en/latest/bugs.html)
- [Ethereum source verification](https://ethereum.org/developers/docs/smart-contracts/verifying)
