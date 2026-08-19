# Open-world v2 workflow

Use this workflow after the idea compiler selects an architecture, or to repair/review an existing v2 project. Treat v2
as a candidate contract until every applicable gate passes. Local validity never means audit, approval, Registry
acceptance, launch authority, deployment, availability, or provider support.

## 1. Preserve and compile

Store only the public-safe verbatim UTF-8 idea. `open-world init` below creates only an unconfirmed Explore proposal; it
does not create a canonical Autopilot repository:

```bash
node "$SKILL_ROOT/scripts/open-world.mjs" init \
  --application-id "$APPLICATION_ID" \
  --idea-file "$IDEA_FILE" \
  --output "$PACKAGE_DIRECTORY" \
  --repository-root "$REPOSITORY_ROOT"
```

Review the preview, then repeat with `--write` only when an unconfirmed proposal is the intended output. For an
Autopilot build use the productive `project materialize` command after the architecture and implementation inputs are
ready. Perform no network or GitHub action.

For the one bundled tradable profile, require a natural idea that independently names a Uniswap v4 hook, fees on
executed gross quote volume and buy/sell rates immutable after registration. Preview this command without `--write`, inspect the
report, then repeat it with `--write`; never add missing intent merely to satisfy the profile:

```bash
node "$SKILL_ROOT/scripts/cli.mjs" project materialize --idea-file "$IDEA_FILE" --application-id "$APPLICATION_ID" --classification tradable --market-ref "$MARKET_REF" --reference-profile programmable-volume-fee-v2 --output "$NEW_REPOSITORY"
```

Use [business-system-compiler.md](business-system-compiler.md) to produce and validate `project-spec.v1.json`, all nine
graphs in `product-graph.v1.json`, the required three-role `architecture-candidates.v1.json`, and
`repository-plan.v1.json`. Process schemas through the project compiler; inspect only a failing section. Preserve
unresolved facts and owner/external blockers instead of inventing them.

Classify the ProjectSpec routing entry as `tradable`, `no-market`, or `unresolved`. Every selected tradable market gets
one content-addressed `trade-capability.v1.json` and distinct quote/execution commands; `no-market` gets neither. An
unresolved market blocks completion rather than inheriting a route.

Validate the hash-bound phase without executing its planned commands:

```bash
node "$SKILL_ROOT/scripts/project-compiler.mjs" validate \
  --repository-root "$REPOSITORY_ROOT" \
  --state "$PROJECT_STATE_PATH"
```

After materialization, commit the complete source tree first. Bind a `materializing` plan to that exact clean commit and
branch, declare `executionPolicy.externalWrites: false` for every command, and keep only that transient input plan on one
specifically ignored path. Execute the reviewed argv without a shell:

```bash
node "$SKILL_ROOT/scripts/project-compiler.mjs" execute \
  --repository-root "$REPOSITORY_ROOT" \
  --plan ".programmable/repository-plan.materializing.v1.json" \
  --output-plan ".programmable/repository-plan.v1.json"
```

The executor strips inherited credentials, bounds each timeout and output, rejects repeated/trivial commands, unsafe
cwd symlinks and known external-write flags, and stops on source drift. Its receipts and completed plan must not be
ignored. Add them plus the immutable project-state JSON only in a narrow evidence-only descendant commit, then validate
from that clean commit. A fresh clone must retain and revalidate the same source/evidence ancestry and bytes.

Before showing or handing off ProjectSpec, ProductGraph, RepositoryPlan, ProjectState, Submission, or trade manifests,
require them as one byte-bound output. `--submission-root` is repository-relative and must contain only files declared
by the Open World package:

```bash
node "$SKILL_ROOT/scripts/cli.mjs" project require-output \
  --repository-root "$REPOSITORY_ROOT" \
  --state "$PROJECT_STATE_PATH" \
  --previous-state "$PREVIOUS_STATE_PATH" \
  --submission-root "$SUBMISSION_PACKAGE_PATH"
```

Proceed only when the command exits zero with `PROJECT_PREFLIGHT_VALID`; `CLEAR` is source-only and
`DRAFT_UNRESOLVED` remains a noncanonical proposal. The report binds every project artifact plus the sorted complete submission
inventory. It rejects invented contracts, adjacent unbound files, identity/facet/applicability/market/route drift,
manufactured no-market evidence, unresolved completion, and non-byte-identical tradable manifests. It remains local
deterministic validation: commands are not reexecuted and no approval, audit, deployment, production, or issuer trust is
created.

Retain an immutable repository-relative chain:

```text
.programmable/project-states/000001-project-spec.v1.json
.programmable/project-states/000002-product-graphs.v1.json
.programmable/project-states/000003-architecture-selection.v1.json
.programmable/project-states/000004-repository-materialization.v1.json
.programmable/project-states/000005-verification.v1.json
.programmable/project-states/000006-submission-evidence.v1.json
```

Never overwrite a checkpoint. For sequence greater than one pass the immediately preceding path as
`--previous-state "$PREVIOUS_STATE_PATH"`. Each phase is one of `project-spec`, `product-graphs`, `architecture-selection`,
`repository-materialization`, `verification`, and `submission-evidence`. Increment its sequence and bind artifact hashes,
provenance classes, graph obligations, repository head, command receipts, blockers, next action, exact argv resume
command, and every approval/signature/deployment/publication/execution/Registry-write authorization as false.

## 2. Preflight the selected system

Derive `capability-composition-v1.json` with one schema-valid capability contract per component. Check it before code,
after every composition change, and before release evidence:

```bash
node "$SKILL_ROOT/scripts/composition-checker.mjs" \
  --input "$PACKAGE_DIRECTORY/capability-composition-v1.json" \
  --output "$COMPOSITION_REPORT_PATH"
```

Use a new sequence- or digest-bound report path for every run; the checker never overwrites. Resolve permission,
storage/namespace, delta, fee, authority, lifecycle, router, settlement, and dependency conflicts.
Route `INDEPENDENT_REVIEW_REQUIRED`. Every report keeps implementation, security, and deployment authorization
`NOT_GRANTED` and `independentReviewerRequired: true`; `NO_KNOWN_CONFLICT` never means safety or approval.

Derive fee applicability from the full graph. Keep it `unresolved` while an unknown surface might be
Programmable-canonical. Load Fee V2 only for an actual canonical or explicit fee-bearing scope. A service, external
market, no-pool system, or other zero-scope design must not gain a placeholder hook, pool, fee instance, or receipt.

For each v4 hook, require the typed semantic profile in `submission.v2.json`; permission booleans alone are
insufficient. Proposal gaps route to review; prototype gaps block. Bind PoolManager authentication/address, PoolId
isolation, callback/router/end-user identity, hookData domain and replay rules, all swap quadrants, delta signs and
closure, settlement, rounding, reentrancy/nested unlocks, router parity, deploy preimage, runtime hash, and evidence.

## 3. Materialize the whole repository

Build the selected product in a new isolated repository, not as snippets or a contract-only demo. Complete every
required repository-plan group: source, configuration, exact dependency locks, tests, deployment inputs, evidence, and
documentation. Include the app, router, service, indexer, game, oracle, keeper, vault, escrow, or other component only
when its graph node serves the user loop, a protected property, operations, or evidence.

For each tradable market, the configuration inventory contains its schema-valid trade manifest. It binds the exact
chain and PoolKey, router, quoter, Permit2 funding profile, hookData contract, supported and rejected direction/exactness
modes, slippage/deadline limits, fee behavior, dependencies, source and test contracts. Choose either the standard
Uniswap v4 route or an adapter bound to the canonical Programmable trade-execution contract and conformance evidence.
Neither form implies interface allowlisting, routing approval, deployment or availability.

Before choosing or changing a dependency, read [upstream-sources.md](upstream-sources.md). Use
`upstream-snapshot-2026-08-07.json` only as an observed exact-source snapshot and `builder-toolchain-lock-v1.json` as the
reproducible candidate lock; neither proves mutual compatibility. Select one coherent profile and bind compiler binary
hash, EVM target, optimizer/metadata settings, package integrity, full closure, CREATE2 deployer, final creation code,
constructor arguments, initcode hash, permission mask, HookMiner salt, expected address/runtime hash, PoolManager, and
chain profile. Invalidate the preimage after any relevant change.

## 4. Verify fresh behavior

Run reviewed argv commands from a clean checkout/install. Record declared, blocked, simulated, and executed evidence
separately. Require applicable build, compile, typecheck, lint, unit, negative, fuzz, invariant, fork, gas/code-size,
deployment, and submission checks. For v4 execution, exercise the real Universal Router/V4Planner/Permit2 or the exact
custom router, native ETH, exact-input/output, single/multi-hop, per-hop hookData, settlement/refund, and
quote-to-execution path. For no-pool/hybrid systems, test their actual settlement path instead.

Every supported manifest mode needs executor-authored quote and execution domain evidence from its exact declared test
command; every unsupported mode needs a pre-effects rejection test. Bind quote and execution to identical PoolKey,
hookData, direction/exactness, amounts, recipient, block context, route, slippage/deadline and fee model. Local or
read-only fork evidence remains untrusted deterministic evidence after static validation and never authorizes a trade.

Apply [security-and-evidence.md](security-and-evidence.md) to every selected trust/value surface. Require adverse tests
for wrong permissions/manager/sender/domain, malformed or replayed data, open or inverted deltas, NoOp behavior,
rounding, partial fills, cross-pool effects, unbound authority, fee bypass, oracle/keeper/bridge failure, token quirks,
source/runtime drift, and intent drift when applicable. Builder counter-evidence may dispute a finding but never waive it.

Validate the complete local package without network access or candidate-code execution:

```bash
node "$SKILL_ROOT/scripts/open-world.mjs" validate "$PACKAGE_DIRECTORY" \
  --repository-root "$REPOSITORY_ROOT"
```

`COMPLETE` means that durable deterministic receipt content matches the exact local commands and artifacts. Because the
receipts are unsigned and `validate` does not re-execute commands, the compiler reports repository completion as
`NOT_PROVEN` and receipt issuer trust as unverified. Arbitrary package scripts can also be semantically empty. Functional
completeness, unknown-idea quality, thresholds, and install-to-submission remain model-backed E2E release gates.

## 5. Freeze source and prepare evidence

Bind every primary and companion public GitHub repository by numeric id, exact commit, tree, and complete source closure.
Never execute candidate hooks, filters, submodules, or build scripts during closure. Route unsupported object/path forms
or verifier budgets to an exact split-review/tooling hold without rejecting the idea.

After source freeze, derive source-assessed security and verification reports against the already-existing commit; do
not create a Git self-reference. Rerun revision preparation and application generation after any source, closure,
evidence, dependency, or recheck change. Read [github-application-v3.md](github-application-v3.md) only now. Do not write
to GitHub without exact authority, and never treat a PR, merge, label, or Builder verdict as canonical acceptance.
Without a public GitHub numeric repository id, URI, commit and tree, emit only a validated local transport plan marked
`NOT_SUBMITTED`; do not call it a canonical Application V3.

## 6. Run release-only E2E evidence

Do not use response-only or self-judged evals as release evidence. From the Builder repository root, run the sealed
fresh-repository corpus across frontier, mid, and small model tiers with at least three fresh repetitions:

```bash
node scripts/evals/run-e2e-evals.mjs \
  --require-provider \
  --repetitions 3 \
  --output /absolute/new/path/e2e-scorecard.json
```

Use a new absolute scorecard path outside the repository. Configure the external subject and independent-judge
adapters/model ids from `--help`; keep the judge model distinct
from every subject. Give the subject only the installed skill and natural prompt; never reveal rubric, expected
architecture, mutation, or known weakness. Require full corpus, all tiers, holdouts, fresh
install/build/test/fuzz/invariant/fork/deployment/submission stages, p50/p95 token use, retries,
tool errors, questions, and manual intervention for release evidence. Treat filters as `PARTIAL_EVIDENCE`; treat missing
model/provider/RPC access as `EXTERNAL_BLOCKED`, never as a pass. Release only from the declared hard-gate scorecard and
an install-to-submission run; a harness validation proves only harness structure.

## 7. Report or hand off

Read [open-world-v2-output-contract.md](open-world-v2-output-contract.md). Report preserved intent, selected architecture,
exact repositories/revisions/trees, source closure, toolchain/dependencies, fee/security states, phase checkpoint,
commands and results, findings/counter-evidence, E2E evidence state, external actions, blockers, and next owner. Keep
application, independent review, Registry acceptance, launch authorization, deployment, and live availability separate.
Require an authenticated unchanged accepted revision before any later handoff; otherwise restart analysis.
