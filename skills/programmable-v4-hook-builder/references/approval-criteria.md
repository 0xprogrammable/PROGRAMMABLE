# Launch-admission approval criteria

This is the normative policy for preparing a Programmable launch-admission decision. It is a policy and skill contract,
not a trusted verifier, approval backend, acceptance record, deployment authorization, or launch permit. Until the
trusted review system implements these rules, state explicitly that the result is agent-prepared and requires
maintainer reproduction.

## Contents

- [Review subject](#review-subject)
- [Package and policy contract](#package-and-policy-contract)
- [Builder-reviewer symmetry](#builder-reviewer-symmetry)
- [Review intent](#review-intent)
- [Verdict contract](#verdict-contract)
- [Finding ownership](#finding-ownership)
- [Causal diagnosis](#causal-diagnosis)
- [Applicant gates](#applicant-gates)
- [Platform gates](#platform-gates)
- [Required adversarial properties](#required-adversarial-properties)
- [Review procedure](#review-procedure)
- [Decision record](#decision-record)
- [Observed regression examples](#observed-regression-examples)
- [Future checker integration](#future-checker-integration)

## Review subject

Freeze and report one immutable subject before reviewing. A local/public-source readiness review does not invent a
central PR; an opened central-PR launch-admission review additionally binds its number and exact head:

- central pull-request number and exact head commit, when one exists;
- primary public repository URI, immutable numeric repository id, exact source commit, and root tree;
- every companion repository's numeric id, commit, tree, and declared paths;
- submission, compatibility-report, review-target, dependency-lock, gate-status, and evidence hashes;
- exact compiler, settings, dependency closure, and build-info identity;
- exact launch-plan path and content hash when launch admission is requested; and
- intended chain, canonical PoolKey, hook address derivation, and launch configuration.

Re-resolve the pull-request head and every public source authority immediately before returning or publishing a
decision. If any bound byte or identity changed, the prior result does not transfer. Review one clearly pinned version
and name the newly observed head separately.

The exact source commit must remain anonymously retrievable from the same numeric repository id. A repository rename
may preserve identity; deletion and recreation under the same owner/name does not. A private, deleted, transferred,
recreated, unreachable, or garbage-collected source authority fails A1 until a new exact subject is submitted and
reviewed. Never follow a familiar slug after its numeric identity changes.

Draft status does not waive or fail a technical gate. A draft may receive the same pinned technical verdict as any
other pull request.

## Package and policy contract

Resolve the intake channel before judging package completeness. Bind the exact trusted default-branch workflow or
service revision, target base, validator commit, package-contract id or digest, allowed filenames, skill revision,
criteria revision, and fee-policy version. A green check proves only what that exact validator implements.

The primary v0.5 path is `submission.v2.json` inside a closed Application V3 package. Historical V1 applications retain
their exact six-file contract and never become V3 by reinterpretation. Resolve which version the target Registry accepts
before judging completeness. Bind an executable launch plan as an exact content-addressed applicant-source artifact;
the current V3 schema does not add a standalone central `launch.json` field.

Never silently mix them, infer one from examples, or make an applicant guess. If the published skill, target-branch
documentation, and active trusted intake disagree, record `PACKAGE_CONTRACT_DRIFT` with resolution owner and prevention
cause. Package drift is not evidence that the mechanism is unsafe. Launch admission still requires the same complete,
hash-bound launch semantics regardless of where the versioned channel contract stores them. This policy revision binds
the criteria bytes into the Builder policy digest, but it does not add typed A1-A11 verdict fields to Application V3 or
make the current deterministic validator enforce every prose property.

## Builder-reviewer symmetry

Apply [builder-reviewer-alignment.md](builder-reviewer-alignment.md). Do not enforce a property unless the builder skill
explains how to build, evidence, or prove it inapplicable; do not drop a builder obligation during review. Use the same
gate/property meaning, allow equivalent attributable evidence, and separate applicant integrity from current platform
compatibility and product/legal eligibility.

Review one-prompt, interactive, manual, generated and mixed-authorship projects under the same exact properties. Do not
require a chat transcript or confirmation ceremony when immutable public artifacts fully specify the business rule and
implementation. Reconstruct the objective, economic mechanism, applied defaults, responsibility boundary and component
ownership from the pinned revision. A safe explicit default may pass; a material assumption awaiting an owner, external
fact, provider or legal decision cannot become evidence because generated code and generated tests agree.

## Review intent

Classify the request before applying a verdict:

- **Architecture review** accepts a concept or proposal for feedback. It may identify a path to implementation but
  never produces a positive launch-admission verdict.
- **Launch admission** evaluates an executable prototype that a normal user is intended to launch through
  Programmable after final authorization.

Until a machine-readable `reviewIntent` exists, write the intent in `PROPOSAL.md` and the review output. Do not invent a
schema field or modify a released Application V3 contract in isolation. Keep the applicant's hash-bound launch plan in
public source, include it in exact source closure, and bind it through the existing implementation, specification, and
review-package evidence paths the released schema can represent.

If launch admission is requested for a concept-only proposal, the launch-admission verdict is `CHANGES REQUIRED`. The
idea may remain valid for architecture discussion.

## Verdict contract

Return exactly one of these strings for launch admission:

### `CHANGES REQUIRED`

Use when any applicant-owned gate is failed, contradictory, incomplete, stale, unbound, or not reproducible. This
includes a missing implementation or launch plan, a hard security defect, missing required evidence, and a documented
claim that disagrees with executable behavior.

Missing evidence means the claim is not proven. Do not convert it into a statement that the underlying idea is unsafe.
Name the affected gate, impact, exact artifact, repair, and invalidated checks.

### `PLATFORM PENDING`

Use only when every applicant-owned gate passes for the exact immutable subject and every remaining blocker is owned by
Programmable or an external provider. State that the applicant must not amend the reviewed revision; any change creates
a new review subject.

Platform Pending is not a weaker form of Changes Required. Never use it for missing applicant contracts, tests,
evidence, dependency bindings, launch steps, chain-side adapters, or security properties that the applicant's design
requires.

### `READY FOR FINAL VERIFICATION`

Use only when every applicant gate passes, the exact launch graph is supported by the released platform capability set,
and the maintainer-owned pre-final checks for those same bytes are complete. The remaining action may only be the
identical signed final-verification path.

This verdict is not official launch authorization. Only the signed maintainer process may create the approval record or
launch permission.

### Decision order

1. If any applicant gate is incomplete, return `CHANGES REQUIRED`.
2. Otherwise, if any required platform or provider gate is incomplete, return `PLATFORM PENDING`.
3. Otherwise, return `READY FOR FINAL VERIFICATION`.

Never lower a gate to reach a preferred verdict. Never block merely because a mechanism is unusual.

If maintainer review tooling prevents the first attributable review, return a non-verdict `NO DETERMINATION` state with
owner `review tooling`; do not force one of the three launch-admission verdicts. Preserve an earlier verdict only when the
complete subject and policy inputs are unchanged. Once evidence is sufficient to decide, return exactly one verdict.

## Finding ownership

Assign every blocker to exactly one owner.

| Owner | Examples | Effect |
| --- | --- | --- |
| Applicant | Source, contracts, launch-plan completeness, fee implementation, tests, evidence, dependency and license bindings | `CHANGES REQUIRED` |
| Programmable platform | Supported adapter/module, registry, product integration, deployment authorization, signed final verification, production monitoring | `PLATFORM PENDING` only after every applicant gate passes |
| External provider | Routing, Hooklist, listing, third-party indexer or bridge-provider decision outside either codebase | `PLATFORM PENDING` only after every applicant gate passes |
| Programmable product/legal review | Jurisdictional eligibility, launch policy, regulated activity, consumer protection, sanctions/KYC, age or geofencing requirements | `PLATFORM PENDING` only after every applicant-owned technical and disclosure control passes |
| Review tooling | Maintainer-side outage or parser limitation | Preserve the last proven state; do not call it applicant failure or safety evidence |

When one finding spans owners, split it. For example, the applicant supplies complete bridge contracts, provenance,
replay/finality tests, and a source-to-destination launch plan; Programmable supplies the supported multi-chain release
adapter. Missing applicant bridge code is not excused by the missing platform adapter.

## Causal diagnosis

Verdict ownership and fault prevention are different questions. Record both for every blocker:

| Field | Meaning | Examples |
| --- | --- | --- |
| Resolution owner | Who must act before this exact revision can advance | applicant, Programmable platform, provider, review tooling |
| Prevention cause | Why the defect reached review | skill gap, criteria gap, verifier gap, package/release drift, applicant deviation, newly discovered mechanism |

An applicant may need to regenerate a package even when platform drift caused the mismatch. Say that plainly rather
than calling it an applicant security failure. Conversely, a verifier gap does not waive wrong fee math, an unsafe lock,
or an incomplete applicant launch graph. Use [submission-regressions.md](submission-regressions.md) for the generalized
cause and prevention map.

## Applicant gates

Every gate below must be `passed`, `not-applicable-with-reason`, or `failed`. A positive verdict requires no applicant
gate in `failed`, `planned`, `blocked`, `unknown`, or an unexecuted state.

### A1. Exact source and provenance

- Resolve every repository, commit, tree, declared path, package, compiler, deployment reference, and license exactly.
- Resolve by numeric repository id first, then confirm the displayed owner/name. Require anonymous public retrieval of
  the exact commit, root tree, submodule commits, Git LFS objects, and declared blobs from that same identity.
- Where the released source contract represents an immutable review ref, require the exact commit to remain reachable
  from it through launch. Otherwise bind the exact anonymously retrievable objects and retained-bundle digest the
  released contract can actually prove; do not claim ref retention it cannot represent. Deletion, recreation,
  privatization, transfer without reauthorization, missing LFS data, or lost exact objects invalidates every positive
  result.
- Require one coherent transitive dependency set and exact build settings.
- Bind evidence to the reviewed target; stale, null, mixed-commit, or copy-pasted evidence fails this gate.
- Treat proxy, implementation, beacon, admin, and upgrade authority as separate bound identities.
- Bind the skill revision, criteria revision, fee-policy version, intake package contract, and trusted validator revision
  used to prepare the package. A version label without immutable source or digest is not provenance.

### A2. Executable implementation

- Require executable source for every applicant-controlled contract or service the promised lifecycle depends on.
- For a proprietary external dependency, require exact operator and endpoint or deployment identity, authenticated
  interface/schema, version or observable behavior, trust assumptions, failure/recovery policy, and attributable
  integration evidence. Missing vendor source is a disclosed trust limitation, not missing applicant implementation.
- A concept, Markdown package, interface, pure validator, mock, or test-only scaffold is not an executable prototype.
- Build every deployable target from a clean clone with the pinned toolchain.
- Match the implementation to the public outcome, token behavior, economics, and failure claims.

### A3. Complete launch plan

Require a data-only, hash-bound plan in the applicant repository that an implementation owner can compile into the
complete launch without guessing. It must cover every applicable step:

1. token creation, metadata, supply, and ownership;
2. factory, router, hook, vault, adapter, escrow, timelock, and other required deployments;
3. exact compiler settings, contract artifacts, constructor and initializer ABI arguments;
4. dependency ordering and address locators;
5. CREATE2 deployer, salt/mining rule, initcode hash, predicted hook address, and permission bits;
6. canonical PoolManager, PoolKey, LP fee, tick spacing, quote asset, and initial price;
7. one-shot registration and initialization authority;
8. initial allocations, liquidity amounts, position creation, exact custody identity, and lock/exit policy;
9. required release modules or platform capability ids without pretending they already exist;
10. executable transaction order, atomicity boundaries, failure/rollback behavior, and postconditions for code,
    configuration, pool state, fees, claims, and liquidity.

Text-only post-deployment notes, empty edges, missing targets, null initializers, empty constructor arguments for a
non-empty constructor, or an ordinary CREATE2 salt without the required hook-permission mining fail this gate.

For CREATE2, also bind the deployer's runtime and authority, address-occupancy rule, replay policy, behavior when the
predicted address already contains code, and any assumption that prevents metamorphic replacement. For mutually wired
contracts, bind both identities before value can move or use an authenticated one-shot handshake that rejects a wrong
but interface-compatible counterpart. A manual two-step wiring window is not atomic merely because both calls usually
appear in one script.

The applicant plan may name an unavailable Programmable adapter. If the plan is otherwise complete and executable, the
adapter is a platform gate. If applicant-controlled steps or contracts are absent, this gate fails.

### A4. Uniswap v4 authentication, permissions, and pool identity

- Authenticate every callback against the immutable PoolManager.
- Treat callback `sender` as a router unless separately authenticated; never infer the end user.
- Make all 14 permissions explicit and prove that declaration, parent/return-delta pairing, deployed address bits, and
  runtime behavior agree.
- Bind the complete canonical PoolKey before use and prevent replay, re-registration, or initialization against a
  different pool.
- Precommit every launch-defining constructor and initializer identity. A hook, NFT, vault, router, factory, registrar,
  or controller cannot accept an unintended interface-compatible counterpart during a public wiring window.
- Prove the exact callback selector, return ABI, disabled-callback unreachability, nested/self-call policy, and revert
  atomicity.

### A5. Delta, settlement, and liability conservation

- End every PoolManager unlock with every touched account-currency delta at exactly zero.
- Classify all four swap quadrants. Prove signs, currencies, actors, amounts, and partial fills for every supported mode;
  prove each unsupported mode rejects before value, state, liability, quote, router, or UI behavior can offer a bypass.
- Use an operation- and currency-correct settlement path: ERC-20 or native settlement, `take`, `settleFor`, or a reviewed
  ERC-6909 mint/burn path as applicable. The current profile forbids `clear`; use an explicit claim/transfer/forfeiture
  path instead. A future capped-dust `clear` profile requires coordinated schema/checker release and review.
- Back every returned delta and internal liability with controlled assets or redeemable PoolManager claims.
- Apply transaction-bound maximum-input, minimum-output, exactness, deadline, and refund ownership to the final realized
  payer/recipient wallet settlement and authenticated router/caller delta, not only the residual core swap.
- Prevent cross-pool same-currency contamination and unexplained rounding profit.
- Use checked token calls and reconcile requested, transferred, received, credited, and settled amounts. Explicitly
  reject unsupported false/no/malformed-return, fee-on-transfer, rebasing, callback, paused, or blocklisted behavior.

### A6. Programmable fee

- Accrue exactly 10 bps of successful executed gross quote-side volume to immutable owner
  `0x4957f49620AFf3Adbbe8195a4f633E49cc93376c`.
- Treat the selected total as inclusive: `effective=max(selected,10 bps)` and project share as the remainder.
- Accrue on every successful supported direction and exactness mode, including partial fills, through the correct
  quadrant-dependent before/after path. Unsupported modes must reject deterministically before movement or liability.
- Preserve positive net trader output under the declared execution semantics. A zero core-AMM leg is allowed only when
  reviewed custom accounting supplies the complete promised output, every delta is backed and conserved, final user
  limits hold, and the fee remains below successful executed gross quote-side volume.
- Prevent systematic fee avoidance through trade splitting. Prove cumulative volume, accrued fee, and carried rounding
  remainder by `(poolId,currency,owner)` or an equally exact non-bypassable construction.
- Permit claims only by the immutable owner, at any time, to itself or its per-claim destination. No builder, project,
  admin, rescue, sweep, mutable recipient, or cross-pool netting path may redirect the liability.

### A7. Custody, positions, locks, exits, and administration

- Give every asset, position, claim, share, liability, and dust amount one owner and enforceable terminal-state rule:
  immediate exit, time/condition-bound claim, refund, maturity, disclosed forfeiture or burn, legal freeze process, or
  deliberately permanent destination.
- Permanence is valid only for value knowingly and irrevocably contributed by its owner before custody begins. It cannot
  excuse trapping user deposits, accrued claims, LP withdrawal value, or liability backing. An applicant-controlled
  discretionary emergency pause may stop new risk but must preserve existing claims/exits or expire. A lawful external
  freeze may persist only under the exact disclosed issuer/legal process and must not be misrepresented as liquid or
  unconditionally redeemable.
- Bind an LP lock to the canonical position identity. At minimum bind the expected token id and independently verify the
  canonical PoolKey or PoolId and relevant position parameters.
- Reject a decoy position supplied by an otherwise authorized depositor.
- Test owner, operator, approval, transfer, decrease, collect, unlock, rescue, and emergency paths.
- Inventory every admin, pause, upgrade, mint, sweep, rescue, payout, router, oracle, keeper, and arbitrary-call power;
  disclose its effect and protect historic entitlements.

### A8. Liveness and bounded history

- From every reachable state, enforce the declared terminal-state rule without an undisclosed unrelated administrator.
  Time locks, maturity, dispute escrow, regulated freezes, deliberate burns, and permanent mechanisms are not failures
  when explicit, authorized, bounded by their stated conditions, and consistent with every existing entitlement.
- Bound loops, queues, recipients, positions, jobs, and per-call work.
- Enforce every documented minimum, maximum, duration, expiry, cadence, and capacity in every constructor, initializer,
  setter, and derived path. Test immediately below, at, and above each boundary plus overflow-adjacent values.
- For a fixed-capacity observation buffer, prove that every allowed window remains representable under the fastest
  adversarially allowed sampling. If capacity is `C` and minimum spacing is `S`, a design that depends only on adjacent
  retained samples normally requires `window <= (C - 1) * S`, unless a stronger retained-anchor proof applies.
- Prevent permissionless sampling from permanently evicting the last required anchor.
- Prove ring wrap, stale state, reset, delayed keeper, dependency outage, and eventual recovery while preserving every
  liability.

### A9. Capability-triggered security

Apply every relevant scenario from `scenario-matrix.md` and `security-and-evidence.md`, including return deltas, custom
curves, hook-owned liquidity, oracles, keepers, external calls, bridges, proofs, signatures, permissioned assets,
upgradeability, unusual tokens, and offchain surfaces. Novelty is not a failure; an untested triggered capability is.

For cross-chain behavior, bind direction, both chain endpoints, messenger/bridge identities, proxy implementations and
admins, custody at every phase, finality, replay, reorg, cancellation, maximum pending time, executor loss, upgrade or
pause behavior, recovery, and solvency. Keep applicant contracts separate from a missing Programmable chain adapter.

For delegated funding, an ERC-20 allowance authorizes the spender contract, not any caller to select the payer or launch.
Default `payer` to the authenticated actor. Any other payer requires payer-originated typed authorization binding chain,
verifying contract, action, token, amount or maximum, beneficiary/recipient, complete launch/configuration hash,
PoolKey/hook/router or equivalent target identities, nonce, and deadline. Test a victim with standing allowance against
attacker-selected payer, beneficiary, pool, configuration, amount, and replay mutations, including Permit2 and ERC-1271
where used.

Every applicant/model-owned balance-, delta-, fee-, or authority-bearing assembly block, low-level call, `unchecked`
region, transient-storage key, packed-delta operation, and narrowing or signed cast requires a high-level reference
property, checked success/return shape, range/signedness proof, and differential boundary fuzzing. Pinned upstream
dependencies retain exact-version/audit-scope review rather than being relitigated as applicant-owned code. Unresolved
truncation, signed-minimum negation, high-bit identifier aliasing, or packed/reference disagreement fails this gate.

### A10. Tests, analysis, and evidence

- Run format, build, warnings, runtime/initcode size, unit, integration, fuzz, stateful invariant, pinned-fork,
  current-head smoke, gas-bound, and static-analysis checks that apply. A fork/current-head check is applicable only when
  the design relies on live chain dependencies or runtime state; otherwise record structural N/A reasoning and use a real
  local PoolManager integration where v4 behavior is in scope.
- Require useful-call and expected-revert counts. Reject-heavy fuzzing is not coverage.
- Give every static-analysis finding a file/line, impact, and evidence-backed disposition. A parser failure over a
  value-moving path leaves that path unproved unless an attributable independent review covers it.
- Record a coverage row for every applicable tool or method using `passed`, `failed`, `tooling-blocked`, `no-data`,
  `not-applicable-with-reason`, or `inconclusive`. Empty output, missing scanners, or every tool failing is never clean.
- Treat a scanner hit as a candidate until attacker control, reachability, impact, and the smallest reproduction are
  established. Conversely, a clean regex scan cannot prove callback, permission, dataflow, settlement, or custody safety.
- Identify who generated the code, generated the tests, chose assertions, ran tools, and reproduced results. Same-run
  agent-generated code and tests are useful builder evidence, not independent confirmation. Applicant reproducibility
  belongs to A10; maintainer-controlled independent reproduction belongs to P8 and cannot be reassigned to the applicant.
- A named tool is not mandatory when another attributable method covers the same property. Preserve the unavailable
  tool's truthful status; block only when the triggered property itself remains unproved.
- Rehearse the complete launch lifecycle from a clean clone and assert launch postconditions.
- Record exact commands, tool versions, commit, artifacts, hashes, counts, skips, failures, and timestamps.
- Record a change-impact matrix. Any code, build, dependency, launch, evidence, or public-claim change invalidates every
  dependent result identified in `submission-regressions.md`; unchanged Solidity alone does not preserve review.
- Require an opened Registry application PR to be conflict-free and restricted to the target version's allowed package
  surface. Unrelated
  churn is not a security defect, but it prevents exact bounded review until removed or separately authorized.
- Do not choose a universal magic fuzz-run count. Scale campaigns to risk and demonstrate state/branch reachability.

### A11. Specification and public claims

- Keep the business objective, observable success condition, economic mechanism, applied defaults, proposal, threat
  model, test plan, structured submission, launch plan, source, tests, and public copy consistent.
- Resolve every material Autopilot assumption or keep it as an applicant blocker. A provisional mock, generic oracle,
  invented beneficiary, or unspecified payout, resolution or terminal rule is not a completed implementation.
- Prove the promised onboarding or launch, use, result, failure, claim or exit lifecycle is implemented. Do not require
  revenue for a coherent game, experiment, public good or other non-revenue system, and never score demand, growth,
  profitability, market size, token price or economic attractiveness as technical approval properties.
- Resolve numeric bounds, units, rounding, lifecycle promises, and custody claims in code or correct the claim.
- Bind license and third-party rights for every copied or derived component.
- Do not claim safe, audited, approved, unruggable, deployed, routed, available, or provider-supported without the exact
  attributable evidence for that statement.

## Platform gates

These gates never repair a failed applicant gate:

| Gate | Maintainer-owned requirement |
| --- | --- |
| P1 Launch compiler | One released skill/package/criteria/compiler bundle accepts the exact data-only launch plan and supported capability ids without channel drift |
| P2 Release modules | Required chain, factory, router, custom-hook, bridge, or other adapter exists and is reviewed |
| P3 Product integration | Registry, UI, API, indexer, quote, trade, claim, and monitoring paths support the exact model |
| P4 Deployment control | Planning, simulation, authorization, signing, broadcast, verification, and activation remain separate; mainnet requires an exact-target final record, exact-chain bundle authorization with limits/expiry, and an operator-enabled gas-only signer rail with no secrets in argv or artifacts |
| P5 Runtime verification | A run-scoped content-addressed source/build bundle plus deployment receipt, bytecode, source, configuration, PoolKey, fees, claims, and liquidity match the reviewed target through independent RPC readback |
| P6 Lifecycle verification | Receipt-backed launch, swap, fee accrual, claim, exit/failure, and reconciliation checks pass |
| P7 Provider decisions | Hooklist, routing, discovery, listing, and third-party support are recorded separately |
| P8 Final verification | The signed typed decision and its immutable run-scoped manifest bind the identical target, policy/tool digests, retained source, and artifact bytes; provenance is not correctness, supersession is explicit, and any dependent change invalidates the result |
| P9 Product/legal eligibility | Human owners decide jurisdictional eligibility, regulated activity, consumer-protection controls, sanctions/KYC, age/geofencing, and product-policy acceptance without relabeling a technically sound unusual concept as unsafe |

## Required adversarial properties

Turn each applicable property into both a focused regression and a stateful sequence:

- **Launch completeness:** remove or mutate each target, edge, argument, address locator, salt, initialization value,
  allocation, liquidity step, custody transfer, and postcondition; the plan must fail closed.
- **Source identity:** make the repository private, remove the bound ref, delete/recreate the same slug, change numeric
  identity, omit LFS/submodule objects, and make the commit unreachable; every positive path fails closed.
- **Paired wiring:** substitute a wrong interface-compatible hook, NFT, vault, router, controller, or registrar before,
  during, and after initialization; no partial state or value-moving path survives.
- **CREATE2 occupancy:** predeploy code at every predicted address, mutate deployer runtime, salt, initcode, constructor
  arguments, and permission mask, then retry; the launch neither adopts foreign code nor enters a partial state.
- **Decoy custody:** an authorized depositor presents a valid but non-canonical LP position; the lock rejects it and the
  canonical position cannot remain under a rug-capable controller.
- **Bounded-history liveness:** sample at the minimum spacing through multiple complete buffer wraps; execution, claim,
  and recovery remain reachable and liabilities remain backed.
- **Cumulative fee:** compare `N` small swaps with one aggregate swap under the declared rounding rule; splitting cannot
  systematically erase the 10-bps entitlement.
- **Partial-fill basis:** requested and executed amounts differ in every relevant quadrant; fee and final deltas use the
  executed gross quote amount.
- **Delegated payer:** give a victim a standing ERC-20 allowance, then let an attacker vary payer, beneficiary, token,
  amount, launch configuration, PoolKey, router, chain, verifying contract, nonce, and deadline; allowance alone never
  authorizes the attacker and every typed authorization mutation fails.
- **Supported-mode matrix:** exercise all four quadrants as either successful and fully charged or rejected before any
  value/state/liability movement; no router, quoter, UI, or direct call exposes a declared-unsupported bypass.
- **Custom-accounting completion:** exercise a valid zero-core-AMM design and invalid unbacked/no-op deltas; only the
  asset-backed, conserved, slippage-bounded final settlement with positive net trader output may pass.
- **Settlement operations:** cover ERC-20/native debts, positive credits, `take`, `settleFor`, and ERC-6909 mint/burn;
  the current profile rejects every `clear`, and user value cannot disappear merely because deltas end at zero.
- **Pool identity:** wrong PoolManager, PoolKey, router, initializer, re-registration, and alternative-pool attempts
  cannot inherit the canonical launch behavior.
- **Failure-state exits:** oracle, keeper, token, recipient, bridge, vault, and router fail permanently or reentrantly;
  user exits and owed claims remain bounded according to the declared model.
- **Evidence invalidation:** mutate one source, compiler, dependency, launch, document, and evidence input at a time;
  stale results cannot remain passed.
- **Tool outage and circular evidence:** remove every analyzer, return empty output, and use only same-run generated tests;
  A10 and independent-review state remain incomplete rather than green.
- **Attestation replay:** reuse a valid signature with changed source, workflow, policy, manifest, artifact bytes, or
  target; shared mutable output and cross-run races cannot satisfy the immutable evidence binding.
- **Deployment authorization replay:** reuse authorization across chain, target, transaction bytes, signer, nonce range,
  limits, or expiry; signing and broadcast fail closed, and successful simulation alone grants no authority.
- **Secret exposure:** pass an injected secret as a process argument or place it in a log, report, prompt, or artifact;
  deployment control fails even when the called program suppresses its own output.
- **Decision rendering:** omit or corrupt every immutable identifier and owner field; blank or mixed-revision decisions
  cannot be returned or published.
- **Cold one-prompt reconstruction:** give a fresh agent only the public idea, exact source and exact skill. Require the
  same objective, economic loop, selected architecture, safe defaults, component ownership, capability map, protected
  properties and predicted verdict. Private chat cannot supply reviewed facts.
- **Specialist and context stability:** repeat with irrelevant specialists present, absent and renamed. The selected
  business loop and gate result remain stable; only attributable evidence availability may differ. A specialist cannot
  change intent, policy, authority, or approval state.
- **Vertical-slice necessity:** remove each component and surface in turn. Fail missing closed-loop behavior and
  speculative components that serve neither the outcome, a protected property, operations, nor admission evidence.

## Review procedure

1. Resolve the exact package/policy contract and detect channel drift before attributing a missing file.
2. Freeze and independently resolve the exact review subject, including anonymous source reachability.
3. Classify architecture review versus launch admission.
4. Inspect every central file and every declared public source, test, configuration, dependency, and evidence path.
5. Build from a clean clone before relying on repository test output.
6. Apply applicant gates A1-A11, capability-triggered scenarios, and the submission regression red team.
7. Reproduce suspected hard security findings with the smallest focused test or trace; cluster the last five comparable
   failures when available so a green retry cannot hide a deterministic or systemic error.
8. Record resolution owner and prevention cause separately for every finding.
9. Re-resolve every immutable identity and render-lint the complete decision record.
10. If review evidence is sufficient, return exactly one verdict and state whether a normal user could immediately
    launch the reviewed model after later official approval. Otherwise return the non-verdict `NO DETERMINATION` state
    with the exact review-tool blocker and no positive implication.

Do not mark an unusual mechanism unsafe without a reproducible conflict. Do not waive a reproducible drain, theft,
unintended asset lock, fee bypass, unauthorized power, or launch-integrity failure because many tests pass.

## Decision record

Prepare this factual record; do not create a maintainer acceptance record:

```text
Review intent:
Verdict:
Package contract, trusted validator, skill and criteria revisions:
Central PR and exact head, or explicit not-opened local/public-source review:
Primary repository id, commit, and tree:
Companion repository identities:
Anonymous source reachability and retained bundle digest:
Submission and review-target hashes:
Launch-plan path and hash:
Applicant gates A1-A11:
Platform gates P1-P9:
Hard findings with artifact and reproduction:
Evidence missing without an unsafe claim:
Tool coverage, blocked/no-data/inconclusive results, and scanner dispositions:
Evidence authorship and independent reproduction:
Run-scoped manifest and attestation verification:
Resolution owner and prevention cause per finding:
What passed:
Applicant changes:
Platform work:
Could a normal user launch immediately after later official approval: yes/no, with reason
Immutable identities revalidated at:
Decision rendering validation:
```

The public message must be concise, identify the pinned target, name applicant repairs, separate platform work, and say
that a new commit requires a new review. It must not include estimates of time, duration, turnaround, or implementation
effort; only factual requirements and observed evidence belong in the applicant-facing message. Reject the message
before publication if any required identity, SHA, owner, verdict, or evidence field is blank, placeholder, malformed,
or refers to another revision. The full internal record retains all evidence.

## Observed regression examples

These examples are derived from recurring submission failures and must remain covered:

| Pattern | Verdict | Reason |
| --- | --- | --- |
| Architecture documents with no executable source or tests | `CHANGES REQUIRED` | Concept-only cannot satisfy launch admission |
| Published builder package and active intake require different file contracts | Depends on applicant gates; record channel drift | The platform caused discoverability drift even if the applicant must regenerate |
| Green package intake with text-only post-deployment steps | `CHANGES REQUIRED` | Structural validity is not an executable launch |
| Hook target with missing constructor arguments or mismatched compiler settings | `CHANGES REQUIRED` | Reviewed bytes and deployed bytes are not reproducible |
| Repository slug now resolves to a different numeric id or the bound commit disappeared | `CHANGES REQUIRED` | Exact public source authority no longer exists |
| Public two-step wiring accepts a wrong interface-compatible counterpart | `CHANGES REQUIRED` | Launch identity and custody can be captured |
| Predicted CREATE2 address is occupied or deployer/runtime differs | `CHANGES REQUIRED` | The planned bytes cannot be deployed or trusted atomically |
| Timelock accepts any position from an authorized depositor | `CHANGES REQUIRED` | A decoy position can preserve control of canonical liquidity |
| Permissionless ring-buffer writes can evict the required oracle anchor | `CHANGES REQUIRED` | Accrued liabilities or strategy execution can become permanently locked |
| Fee uses requested volume, loses cumulative rounding, or can consume the complete swap | `CHANGES REQUIRED` | Fee policy or trader execution is bypassed or broken |
| Documentation promises a bound not enforced by every configuration path | `CHANGES REQUIRED` | Executable behavior and reviewed public claim disagree |
| Many tests pass but handler success, launch lifecycle, or triggered states are absent | `CHANGES REQUIRED` | Test count is not semantic coverage |
| Every scanner is unavailable or returns no usable data but the report says clean | No positive A10 result | Missing evidence is not a clean scan |
| Agent-generated code passes applicant tests but lacks maintainer reproduction | Applicant A10 may pass; P8 remains incomplete | Circular builder evidence cannot create final independent verification |
| Open launch method lets an attacker select a victim payer with standing allowance | `CHANGES REQUIRED` | Allowance authorizes the spender contract, not arbitrary caller intent |
| Exact-input-only design rejects exact-output before any movement and charges every supported mode | Depends on current platform adapter | Unsupported modes are not a fee bypass when rejection is complete and disclosed |
| Fully backed custom accounting supplies all output with zero core-AMM leg | May pass applicant gates | Safety depends on final settlement, limits, backing, and conservation, not core-AMM participation |
| Simulation or a valid provenance attestation is presented as deployment or safety proof | Depends on incomplete applicant/platform gate | Simulation proves one execution attempt; attestation proves exact-byte provenance, not correctness or authority |
| Rendered review contains blank or mixed-revision immutable fields | No publishable verdict | Review tooling output is not attributable |
| Implementation and launch plan pass but required platform adapter is unreleased | `PLATFORM PENDING` | No applicant change remains |
| Applicant and platform gates pass for one unchanged target | `READY FOR FINAL VERIFICATION` | Only the identical signed final-verification action remains |

## Future checker integration

The v0.5 policy bundle now content-binds and mutation-tests these normative reference bytes. This section specifies the
remaining typed trusted implementation work; content binding alone does not make the running checker enforce A1-A11,
produce a signed decision, or grant launch authority.

### Deterministic enforcement

The future checker must fail closed on:

1. package/validator/skill/criteria version drift and unrecognized file contracts; one canonical normative manifest must
   include and mutation-test the skill, approval criteria, fee policy, execution gates, regression playbook, alignment
   contract, templates, schemas, and every verdict-affecting reference;
2. repository numeric-id mismatch, deletion/recreation, private visibility, unreachable commits, wrong trees, missing
   submodule/LFS objects, or source-bundle digest drift;
3. source, dependency, compiler standard-input, build-info, ABI, library-link, creation-code, and runtime mismatch;
4. disconnected launch targets or edges, missing constructor/initializer arguments, unresolved locators, incomplete
   atomicity/postconditions, or missing lifecycle components;
5. CREATE2 deployer/runtime/salt/initcode/address/permission mismatch or occupied-address adoption;
6. stale or mixed-revision compatibility, evidence, test, static-analysis, fork, size, and public-claim records;
7. collapsed tool outcomes, all-tool outage treated as clean, missing authorship/independence, mutable attestation subjects,
   provenance presented as correctness, or authorization replay across any bound execution field;
8. delegated-payer authority not bound to the payer's exact intent, supported-mode classification missing, or an
   unsupported mode that moves value/state/liability; and
9. an invalid verdict transition or a decision with blank, placeholder, malformed, spoofable, or mixed-revision fields.

GitHub aggregate `reviewDecision`, labels, checks, editable comments, or comment text are projections only. The launch
system must consume only a typed, signed, immutable final-verification record that binds the exact subject and states
which earlier decision it supersedes.

### Reproduced semantic enforcement

The trusted review worker must reproduce, not merely parse applicant claims for:

- the complete four-quadrant supported/rejected matrix, partial fills, final caller limits, delta conservation,
  operation-specific settlement, `clear` restrictions, and claim backing;
- cumulative 10-bps fee entitlement for every successful supported mode, exact-output gross-up where supported, positive
  net trader output including valid zero-core-AMM custom accounting, owner-only claims, and pool isolation;
- delegated-payer intent, allowance/Permit2/contract-wallet replay boundaries, low-level operations, and signed/narrowing
  cast equivalence;
- canonical PoolKey and mutually wired identity, initialization replay, CREATE2 occupancy, and launch rollback;
- decoy-position rejection, bounded-history liveness, numeric boundaries, failure-state exits, and non-standard tokens;
- useful stateful handler calls, expected reverts, branch/state reachability, clean-clone build, and full launch rehearsal;
- tool-outage behavior, finding dispositions, same-run code/test independence limits, and run-scoped manifest verification.

### Human-only decisions

Keep project labels, novelty, economic merit, provider support, professional-audit sufficiency, legal/compliance
questions, operational risk acceptance, and official launch authorization outside deterministic pass/fail inference.
Scientific experiments, games, wagering/prediction, transparently inflow-funded redistribution, RWA, privacy, AI agents,
cross-chain systems, and future categories are judged by triggered technical properties, not by name. Automation supplies
evidence and blocks objective conflicts; it does not manufacture judgment or authority.
