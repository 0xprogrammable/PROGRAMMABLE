# Submission regression playbook

Use this playbook during Prototype, Repair, Review, and the final pre-Submit red-team pass. It generalizes failures
observed across real applications without treating any project category as inherently unsafe. The normative verdict
rules remain in [approval-criteria.md](approval-criteria.md).

## Diagnose two different causes

Record both axes for every finding:

| Axis | Question | Allowed values |
| --- | --- | --- |
| Resolution owner | Who must change something before this revision can advance? | applicant, Programmable platform, external provider, review tooling |
| Prevention cause | Why did the problem survive until review? | skill gap, criteria gap, verifier gap, release/channel drift, applicant deviation, newly discovered mechanism |

Do not blame the applicant for a requirement that the released skill and target intake contract contradicted or never
made discoverable. Do not waive an applicant-controlled defect merely because better tooling should have caught it
earlier. State both facts.

## Recurring failure clusters

| Cluster | Prevent before the PR | Review signal |
| --- | --- | --- |
| Architecture presented as launch-ready | Declare review intent before implementation; launch admission requires executable source, tests, and a complete launch plan | Documents, interfaces, mocks, or validators exist but no deployable lifecycle |
| Package-channel drift | Resolve the exact trusted intake validator, package-contract version, and allowed filenames before packaging | A released builder emits six files while the active autonomous intake expects seven, or the inverse |
| Structurally green but semantically incomplete launch | Model the launch as a closed graph and mutation-test every node, edge, locator, argument, initialization value, custody transfer, and postcondition | Green schema check with prose-only steps, empty constructors, missing factories, or disconnected targets |
| Compiler and bytecode drift | Generate the launch artifact from the exact build profile and compare standard JSON input, build info, ABI, creation code, and runtime | Optimizer, via-IR, EVM, metadata, library links, constructor ABI, source hash, or runtime differs |
| Repository identity loss | Keep the exact commit publicly reachable in the same numeric repository and verify it anonymously before every result | Slug resolves to a recreated repository id, bound commit disappears, repository becomes private, or declared ref moves without preserving reachability |
| Evidence drift | Regenerate evidence after every invalidating code, config, dependency, launch, or documentation change | Null, copied, stale, mixed-commit, impossible, or internally contradictory evidence remains green |
| Initialization or wiring capture | Precommit all launch-defining identities and wire mutually dependent contracts atomically or through authenticated one-shot acceptance | Public initializer, second-pool rebind, wrong NFT/hook pairing, caller-supplied initcode, or partially configured deployment |
| Delegated-payer allowance theft | Default payer to the authenticated actor; otherwise require payer-originated typed authorization over the entire spend and launch intent | Any caller can name a victim with standing allowance, change the beneficiary/pool/configuration, or replay Permit2/permit authority |
| CREATE2 ambiguity | Bind deployer code/runtime, salt mining rule, initcode, constructor args, predicted address, permission bits, occupancy rule, and failure behavior | Ordinary salt, wrong permission bits, address already occupied, deployer drift, or unbound child address |
| Fee-basis error | Implement the worked four-quadrant equations before business logic and preserve cumulative entitlement | Requested instead of executed volume, exact-output net/gross confusion, split-swap rounding bypass, fee at least gross, or wrong owner |
| Swap-mode overreach or bypass | Classify all four quadrants as supported-and-charged or unsupported-and-pre-movement-rejected | Safe exact-input-only design is rejected merely by label, or an unsupported direct/router/quoter/UI path bypasses the fee |
| Core-AMM assumption | Specify final combined trader settlement, backing, conservation, and limits instead of requiring core-AMM participation | Valid fully backed custom accounting is rejected, or an unbacked/no-op returned delta passes because PoolManager deltas reach zero |
| False liquidity lock | Bind the canonical position identity independently of the depositor | Any valid NFT or position can satisfy the lock while canonical launch liquidity stays controlled elsewhere |
| Interim allocation capture | Mint or route initial assets directly to final declared owners, or enforce every final allocation/custody postcondition atomically with rollback | Caller-selected interim wallet receives all supply or liquidity assets and can stop before final distribution |
| Bounded-history deadlock | Prove capacity and retained anchors under the fastest allowed writes and repeated wraps | Oracle/strategy remains permanently not ready while fees, collateral, or user value stay locked |
| Specification/code drift | Put every numeric promise, unit, bound, and authority into a code-to-spec table with an enforcing path and regression | Minimum tranche, expiry, floor, winner logic, payout, immutability, or supported range differs from code |
| Unsafe token assumptions | Use checked token calls and explicitly support or reject false/no-return, fee-on-transfer, rebasing, callback, paused, and blocklisted behavior | Raw transfer return ignored, credited amount differs from received amount, or dependency failure traps value |
| Overstated test evidence | Require successful handler calls, branch/state reachability, expected reverts, and exact bounds, not only a large test count | Many tests pass while the launch path, exact-output state, ring wrap, or failure recovery never executes |
| Tool-outage false clean | Use explicit per-tool outcomes and require usable coverage for every triggered property | Every scanner failed, returned empty output, or never parsed while the aggregate report says clean |
| Circular generated evidence | Record code, test, assertion, runner, and reviewer authorship; require independent clean-clone reproduction | One agent generates code and its only tests, then treats their agreement as independent proof |
| Simulation or attestation overclaim | Keep simulation, authorization, receipt, runtime verification, and provenance as separate gates | One fork swap or a valid signature is described as safe, audited, deployed, approved, or launchable |
| Mutable execution evidence | Use run-scoped immutable artifacts and bind authorization to exact target, chain, bundle, signer, limits, nonce range and expiry | Shared `latest` output is overwritten, authorization is replayed, or a secret reaches argv/logs/artifacts |
| Platform-only remainder | Freeze the applicant revision after every applicant gate passes and name the exact missing platform capability | Only released adapter, registry, UI/API/indexer, deployment authorization, runtime verification, routing, or signed final verification remains |
| Questionnaire-dependent builder | Compile through Autopilot, choose safe reversible defaults and ask only for one irreducible owner fact | A normal user must answer protocol jargon or repeat derivable facts before useful work begins |
| Autopilot invented-fact false green | Separate safe defaults from prompt or evidence facts and unresolved decisions | Generated prose, mocks or templates invent an oracle, beneficiary, payout, custody, authority, affiliation or provider support and pass their own tests |
| Technical demo without a business loop | Compile the user job, economic engine, state machine and first closed vertical slice before implementation | Contracts compile but the promised launch, use, result, failure, claim or exit lifecycle is absent |
| Context and specialist flood | Route at most one build and one assurance specialist for the current slice | Irrelevant domain rules add contracts, permissions, dependencies, questions or blockers the design never triggers |
| Specialist authority leak | Require bounded specialist handbacks and reapply shared policy | A generator or reviewer changes product intent, waives the fee, self-approves or expands external actions |

## Mandatory pre-Submit red team

Before preparing a launch-admission package:

1. Resolve the target channel's trusted validator revision and package contract independently of the target PR branch.
2. Re-resolve numeric repository ids, exact commits, trees, and anonymous public reachability. Never follow a reused slug.
3. Rebuild from a clean clone and compare compiler input, ABI, creation/runtime bytecode, and dependency closure with the
   launch artifact.
4. Remove or mutate every launch-graph element and prove deterministic failure.
5. Preoccupy every predicted CREATE2 address, mutate deployer code and constructor args, and test replay and partial
   deployment recovery.
6. Attempt to bind every mutually wired contract to a wrong but interface-compatible counterpart before and during
   initialization.
7. Give a victim a standing allowance, then let an attacker choose payer, beneficiary, token, amount, launch hash,
   PoolKey/router, chain, verifying contract, nonce, and deadline; allowance alone never proves intent.
8. Classify all four swap quadrants, partial fills, aggregate versus split volume, zero/one/dust values, and fee-near-
   gross boundaries. Supported modes must charge; unsupported modes must reject before movement.
9. Exercise valid backed zero-core-AMM custom accounting and invalid unbacked/no-op deltas against final caller limits.
10. Present a valid decoy position from an authorized depositor and verify rejection.
11. Route initial supply or liquidity through a caller-selected interim wallet and prove atomic final allocation or failure.
12. Drive bounded storage through multiple full wraps at minimum spacing and prove claims, exits, and recovery.
13. Exercise every documented numeric minimum and maximum immediately below, at, and above the boundary.
14. Mutate code, build config, dependency lock, launch plan, and public claims independently; stale evidence must stop
   the package.
15. Render the proposed decision record and reject blank, placeholder, malformed, mixed-revision, or unsupported fields.
16. Disable every analyzer and force empty output; A10 must remain blocked instead of becoming clean.
17. Separate same-run generated code/tests from independently reproduced semantic evidence and preserve authorship.
18. Replay an attestation after changing source, policy, workflow, manifest, or artifact bytes; reject every mismatch.
19. Replay deployment authorization across chain, target, bundle, signer, nonce range, limits, or expiry, and pass a
    synthetic secret through argv; execution control must fail closed.
20. Give a fresh agent only the public one-prompt idea and exact skill. Require the same working kernel, architecture,
    explicit defaults and owner facts, capability and property map, and either a complete local pipeline or one material
    question. Remove private chat history; no reviewed fact may disappear or be invented.
21. Repeat the cold prompt with unrelated specialists available, unavailable and renamed. The selected business loop,
    capabilities and gate result remain stable; only attributable tooling evidence may differ.
22. Remove every component and surface from the first vertical slice in turn. Fail both a missing closed-loop step and
    an unnecessary hook, token, oracle, admin, indexer, app or service introduced merely because generation was possible.

## Positive controls against over-strict review

A review is not improved by rejecting every unusual mechanism. Include positive controls:

- A novel design with complete executable behavior, bounded powers, reproducible evidence, and no hard conflict can
  pass applicant gates.
- Missing routing, UI, registry, deployment authorization, or a released platform adapter becomes `PLATFORM PENDING`
  only after applicant gates pass.
- Missing evidence means unproved. It does not prove a drain, theft, or economic defect.
- A parser or infrastructure outage is a tooling result. Preserve the last attributable result and retry safely.
- A scanner hit is a candidate finding until reachability and impact are reproduced; missing scanners are missing
  evidence, not proof that the design is unsafe or clean.
- A valid run attestation can strengthen provenance without raising the underlying security result.
- Economic attractiveness, token price, and likely demand are outside launch-admission security criteria.
- Scientific, game, wagering, participant-funded, RWA, privacy, AI, cross-chain, multi-token, multi-pool, and unknown
  concepts are never rejected by category. Apply objective triggered properties and separate current platform/product/
  legal eligibility from applicant technical integrity.
- A declared lock, maturity, regulated freeze, burn, or permanent mechanism is not automatically an asset-lock defect;
  reject only unauthorized, undisclosed, insolvent, contradictory, or unreachable terminal behavior.
- A one-prompt project with explicit implemented defaults needs no interactive transcript. A project with an unresolved
  material oracle, beneficiary, payout, custody, authority or terminal rule remains unproved even when its generated
  code and generated tests agree.
- Specialist availability and context size are not security properties. Missing evidence for a triggered property
  remains unproved, but irrelevant skills cannot change the exact implementation's result.
- A coherent non-revenue experiment or public-good mechanism can pass without fabricated monetization. Business-loop
  completeness verifies the promised lifecycle, not attractiveness or profit.

## Change-impact rule

Every revision declares which gates are invalidated. Use at least this dependency map:

| Changed surface | Minimum invalidated gates |
| --- | --- |
| Contract source, library, compiler, or build settings | A1-A10 plus every derived bytecode, address, fork, static, and launch result |
| Constructor, initializer, factory, salt, locator, or launch graph | A1, A3-A5, A7, A9, A10 and platform simulation/runtime gates |
| Fee math, rate, currency, owner, claim, or event | A3-A7, A10, A11 |
| Oracle, keeper, queue, timeout, or bounded storage | A3, A7-A10, A11 |
| Position, custody, lock, rescue, or admin path | A3, A5, A7-A10, A11 |
| Proposal, threat model, test plan, launch plan, compatibility, evidence, tool/ruleset/suppression, prompt/model, or attestation manifest | A1, A3, A10, A11 and any gate whose claimed behavior changed |
| Component ownership, policy interpretation, business compiler input, or verdict supersession | A2, A3, A9-A11 and every affected platform gate |
| Repository visibility, numeric identity, reachability, or rights | A1, A10, A11 and every positive verdict |

Never copy a prior result forward merely because Solidity did not change.
