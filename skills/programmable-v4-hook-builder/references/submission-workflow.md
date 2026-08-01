# Submission workflow

The current public path is the **Public GitHub PR Builder Beta**. The complete project stays in the builder's own public
GitHub repository. A draft pull request to `0xprogrammable/programmable` carries only one bounded six-file application
record that points to the exact public source revision. No wallet connection, GitHub App installation, claim link,
remote application draft, launch permit, or connected application service is part of this beta.

Submission remains separate from the release registry. A builder can propose and test any reviewable v4 project without
creating the appearance that Programmable has selected, accepted, scheduled, deployed, or made it available.

Chain choice does not close the application door. Any positive JavaScript-safe EVM chain can be proposed. Ethereum,
Unichain, Base and Sepolia use the standard's exact canonical slugs; an unknown chain enters architecture review. The
current Programmable launch integration remains Ethereum Mainnet-only, so every non-Mainnet application carries a
separate release gate and cannot claim current platform launchability. Exact Base or Unichain official deployment
records remain a runtime-unverified reference tier, not Programmable-tested deployment evidence.

Submission standard `1.2.0` adds the open project-surface and capability graph. It preserves unfamiliar games, maps,
services, databases, data sources, keepers, claims and later kinds for architecture review while deriving non-bypassable
security profiles from explicit triggers. It also separates a signed offchain data source from an optional onchain
oracle verifier. The same version adds explicit `official-launchpad` and `model-specific-no-hook` architecture paths
plus structured transfer-tax, automatic-liquidity, provider-limit and test declarations. A `1.1.0` submission is not
silently reinterpreted. Regenerate it from the current template; review every surface, capability, exposure, path,
profile, no-hook route, target chain, network slug, dependency and deployment trust tier; then commit the fresh report
and gate-status authority digests.

## Stages

### Proposal

The builder repository contains:

- `submission.json`
- `PROPOSAL.md`
- `THREAT_MODEL.md`
- `TEST_PLAN.md`
- `EVIDENCE.md`
- Deterministic preflight report
- Builder identity, contact, license declaration, and optional beneficiary address

No implementation language is required at proposal stage. The proposal must still resolve the user outcome, project
surfaces, value flow, canonical PoolKey, whether a custom hook is used, authorities, dependencies, hard failure behavior,
and expected evidence. Hook callbacks, a permission mask, and CREATE2 planning apply only when `hook.used` is true. A
no-hook proposal selects the safer official Launchpad default or the model-specific route; the latter completes its own
token mechanics, fee bounds, recipients, authority, liquidity custody and exit, provider limits, and test scenarios.

### Prototype

Adds:

- Source for every declared contract, app, game, service, keeper, indexer, or other project surface
- A complete demonstrator for the declared creation-to-retirement path
- Unit, integration, and adversarial tests appropriate to the implemented capabilities
- Fuzz and invariant properties where state, value, authorization, or arithmetic requires them
- Pinned dependencies, languages, compilers, runtimes, and build configuration that the implementation actually uses
- `TEST_PLAN.md` with actual results separated from planned checks

Solidity and Foundry evidence is required only when Solidity is declared. Callback authentication, hook permission,
PoolManager-delta, and CREATE2 evidence is required only when a custom hook is implemented. A no-hook ordinary launch
does not need placeholder Solidity. Apps, games, and services instead provide the relevant source closure, build and
test evidence, trust boundaries, failure behavior, and integration evidence for their declared surfaces.

A prototype provides implementation evidence for review. It is not accepted, audited, approved for deployment, or
available by default.

## Maintainer candidate state

A contributor cannot set `stage` to `candidate`. Maintainers may select an exact reviewed prototype commit as a
candidate after confirming:

- Complete declared source and supported dependency closure
- All capability-triggered tests and security documents
- Static-analysis dispositions
- Gas and size evidence for deployed contracts
- Pinned-chain lifecycle and current-head smoke evidence for surfaces that touch chain state
- Reproducible permission mask and CREATE2 plan when a custom hook is used
- Deployment plan for deployable components without credentials or signed transactions
- UI, app, game, service, router, indexer, monitoring, and incident requirements for intended surfaces
- All independent reviews required at candidate selection by the risk tier

Candidate selection is not acceptance, deployment, routing approval or availability.

### Acceptance and availability are separate

These are maintainer-owned release states, not submission stages. An acceptance record binds an exact model version,
commit, submission hash, review-target hash, builder, license, scope, open conditions, and any agreed beneficiary and
fee allocation. Acceptance does not authorize product edits, deployment, provider submissions, or activation.

Availability is later. It additionally requires exact deployment, source, runtime, lifecycle, product-integration,
monitoring, routing, discovery, and production evidence.

## Directory layouts

### Builder-controlled public project repository

```text
<project-root>/
├── .programmable/companions/          # optional exact-revision bindings
│   └── <surface>.json
├── submissions/<application-id>/
│   ├── submission.json
│   ├── compatibility-report.json
│   ├── PROPOSAL.md
│   ├── THREAT_MODEL.md
│   ├── TEST_PLAN.md
│   └── EVIDENCE.md
├── <declared project source and configuration>
└── <declared project tests and evidence>
```

Prototype submissions add `submissions/<application-id>/evidence/` plus source and tests under that project's existing
conventions. Do not put executable source inside Markdown or generated evidence files. The builder repository is the
source identity; every reviewed file must be bound to its clean, pushed commit and Git tree.

Projects split across repositories may declare up to eight additional public GitHub repositories. Each companion
manifest must be canonical JSON committed in the primary repository's exact HEAD and contains only
`schemaVersion`, `repositoryUri`, a full `revisionObjectId`, sorted `sourcePaths`, and sorted `contractPaths`.
`prepare-pr` resolves the companion's immutable numeric repository id and root tree independently. A branch, tag,
private repository, credentialed URL, local path, ZIP, pasted source, symlink, gitlink, or Git LFS pointer is not an
accepted source binding.

### Programmable central application pull request

```text
submissions/<application-id>/
├── application.json
├── PROPOSAL.md
├── TEST_PLAN.md
├── THREAT_MODEL.md
├── compatibility-report.json
└── evidence-index.json
```

These are the exact six allowed central files. `prepare-pr` deterministically derives them from the builder package and
the independently resolved public GitHub revision. Do not copy `submission.json`, `EVIDENCE.md`, project source, tests,
build output, dependency directories, or workflows into the central repository. `applicationId` is the stable lowercase
project slug and directory name. The GitHub pull-request number is the public review thread, not a connected-service
application identity.

The local report may say `PROTOTYPE_READY`, but that is not a trusted public status. The official generator retains the
unavoidable candidate and maintainer gates and therefore does not legitimately emit central `prototype-ready` today.
Until trusted-base intake reconstructs the exact review target and source/evidence blob digests, a hand-edited central
claim fails with `PROTOTYPE_READY_REQUIRES_TRUSTED_REVIEW_TARGET`. Submit the generated
`architecture-review-required`, `changes-required`, or `tooling-blocked` result and let maintainer review advance the
public record.

`prepare-pr` also resolves the declared builder login through GitHub's anonymous public user endpoint. It writes the
lossless decimal `githubUserId` as immutable builder identity and keeps `githubLogin` plus `contact` as display data.
The trusted workflow requires the id and current login to match the pull-request author, preserves the id on revisions,
and permits a login rename. Never hand-enter or infer the numeric id from a profile URL.

## Scaffold

Resolve the skill installation and target repository separately:

```bash
SKILL_ROOT="<directory-containing-this-SKILL.md>"
REPOSITORY_ROOT="$(git -C "$PWD" rev-parse --show-toplevel)"
APPLICATION_ID="example-project"
node "$SKILL_ROOT/scripts/cli.mjs" scaffold \
  "$APPLICATION_ID" \
  --repository-root "$REPOSITORY_ROOT" \
  --name "<Model name>"
```

The scaffold creates only a submission package. It does not modify `models/registry.json`, create an acceptance record,
open a pull request, or publish anything.

## Validate

```bash
node "$SKILL_ROOT/scripts/cli.mjs" check \
  "submissions/$APPLICATION_ID/submission.json" \
  --write-report "submissions/$APPLICATION_ID/compatibility-report.json" \
  --repository-root "$REPOSITORY_ROOT"

node "$SKILL_ROOT/scripts/cli.mjs" package \
  "submissions/$APPLICATION_ID" \
  --repository-root "$REPOSITORY_ROOT"
```

Commit the generated report. If the design changes, regenerate it. CI should fail when the report no longer matches the
submission contents or standard version. A proposal package may preserve a `REDESIGN_REQUIRED` or `UNSUPPORTED`
decision so reviewers can discuss the design. Prototype packages require `PROTOTYPE_READY`.

`REDESIGN_REQUIRED` does not make an empty scaffold application-ready. A proposal package must replace the generated
instructions with a concrete idea, base architecture, lifecycle, value flows, authority inventory or explicit
no-authority statement, failure response, and project-specific proposal, threat model, test plan, and evidence status.
It may retain specific named architecture questions in `unresolved`; each question must identify the actual decision
instead of repeating a generic template task. `package` rejects placeholder fields and substantially unchanged scaffold
documents before `prepare-pr` performs any public-source work.

`check` also records `closure.status` and closed diagnostics for the exact repository. A proposal may retain an
incomplete closure for aliases, bundler globs, runtime module selection, a language without a bundled scanner, a
non-Foundry Solidity build profile, or a separately pinned companion repository; its central result remains
`architecture-review-required` when no independent design blocker requires changes. `--require-ready`, prototype
packaging, and prototype `prepare-pr` stay blocked until that closure is proven. Missing literal relative files, unsafe
paths, symlinks, Gitlinks or unmaterialized LFS source are source-binding errors, not architecture-review shortcuts.

The prototype package gate also checks the complete compatibility report, dependency lock, declared file closure, gate
evidence hashes, and review-target hash. Solidity import and compiler-resolved source closure applies when Solidity is
declared. Static or literal local JavaScript and TypeScript module closure applies when those languages are declared.
Other languages and project types enter the matching supported tooling gate or an explicit architecture/tooling review;
they are not mislabeled as Solidity failures. Arbitrary runtime loading is outside the static proof: it remains
proposal-eligible with an explicit incomplete-closure diagnostic, but it cannot pass prototype readiness. The result is
`intakeValidated`, not `verified` or `accepted`.

For a prototype, create source, tests, and final evidence artifacts first. Create `gate-status.json` with those evidence
paths, build `review-target.json`, copy its exact hash into the gate status and every completed gate-evidence metadata
record, then rebuild the target. The two targets must be identical. Closure method v10 also binds project-surface
source, test, schema and evidence files. It hashes the evidence artifacts but
not `gate-status.json` or `review-target.json` themselves; `prepare-pr` binds both authority records separately to exact
HEAD and the primary GitHub source request. A gate evidence `commit` is an exact 40-character provenance value and need
not equal the later packaging HEAD.

These checks do not audit, accept, deploy, approve routing or prove availability.
Contributor-controlled `submission.json`, `gate-status.json`, and evidence files can complete only declared prototype
checks. They cannot complete candidate, maintainer-review, deployment, verification, provider, or availability gates.

For prototype product planning, use `submission.json.integration.platformHandoff`. When `intended` is true, provide
concrete `handoffNotes`. The registry, UI, API, indexer, and test paths are contributor proposals and may remain empty
until maintainers accept the exact prototype and assign product work. Contributor packages keep `reviewStatus` at
`not-requested` or `pending-maintainer-review`, `maintainerReviewRequired: true`, `selfApproval: false`, and
`availabilityClaimed: false`.

Prototype gates follow the actual project shape. `routingMode` values `programmable-app` and `custom-reviewed` declare
an included swap client and therefore require its router, view, quoter, SDK, source, test and parity evidence.
`uniswap-interface-api` and `uniswapx-filler` declare an external client, while `not-planned` declares no supplied
client; neither invents app evidence for the builder repository. `dataReconstruction.mode: not-applicable` requires a
fully inactive data profile and is invalid when accounting, claims, external liquidity or a declared indexer needs
reconstruction. A `model-specific-pinned` lock remains builder evidence and candidate review, never maintainer approval.

## Prepare the six-file application package

Commit every reviewed project file, make the builder worktree clean, push its named branch, and confirm that the public
GitHub repository exposes that exact commit. Then run:

```bash
node "$SKILL_ROOT/scripts/cli.mjs" prepare-pr \
  "submissions/$APPLICATION_ID" \
  --repository-root "$REPOSITORY_ROOT"
```

For a split project, repeat `--companion-manifest` for each committed manifest:

```bash
node "$SKILL_ROOT/scripts/cli.mjs" prepare-pr \
  "submissions/$APPLICATION_ID" \
  --repository-root "$REPOSITORY_ROOT" \
  --companion-manifest ".programmable/companions/backend.json" \
  --companion-manifest ".programmable/companions/game-client.json"
```

Use companion manifest v2 when an npm game, app, or service can declare an exact static closure. It binds the numeric
repository id, commit, root tree, separate source/test/runtime/build paths, package-lock v3 and successful
exact-revision Actions evidence from the closed JSON workflow in `assets/templates/companion-closure-workflow.yml`.
That workflow unconditionally runs the pinned install, named build, and named test steps; the resulting canonical
receipt is also embedded in the central `application.json` for downstream authority checks. Validate and canonicalize
the manifest first with `cli.mjs companion <manifest> --write-canonical`.
Keep v1 for proposal-only or unsupported build/runtime mechanics. Read `companion-manifests.md` and use
`companion-manifest-v2.schema.json`; a v1 companion intentionally retains the closure-review diagnostic.

`prepare-pr` independently resolves every declared public repository's numeric id, exact commit, root tree, and
declared paths. It also observes the exact current `0xprogrammable/programmable:main` commit before deriving the
central package. A new application remains revision `1` while its pull request is open. If central main contains
revision n, its open update remains n+1 and must bind a primary or companion source change relative to main. Repeated
project commits or package-only corrections in that same pull request do not increment again. Inconsistent lineage or
a moving central base fails before output is written.

The result separates `sourceHead` from `centralPullRequestTarget`, includes the observed central base commit and next
application revision, and embeds the deterministic six-file package plus a copy-ready draft PR body. It does not push a
branch or open a pull request.

Large declared path sets are not verified with one anonymous REST request per file. The resolver keeps GitHub REST as
the bounded repository/commit/tree control plane. The central intake reads exact declared objects through one anonymous
HTTPS Git smart-protocol batch per repository; `prepare-pr` may instead bind the clean local primary HEAD bytes against
complete REST tree metadata. Evidence blobs are declared primary-source paths, so central intake retains only those
exact source bytes and reuses them for evidence binding without another REST tree walk or smart-Git fetch. The remote
path uses a blobless partial fetch, a sparse `git backfill` and raw `git cat-file` object reads. It
never checks out project files, recurses into submodules, runs project hooks, loads project or user Git config, supplies
credentials, or executes candidate code. Every returned path must still be a regular blob under the exact requested
commit and root tree; its raw object id, two-megabyte file ceiling, twenty-megabyte aggregate ceiling and non-LFS bytes
are checked.
GitHub recursive-tree truncation is never treated as evidence: the same exact-object path proof is required instead.
Git 2.49.0 or newer is required and the `git backfill` capability is probed before any repository fetch. If the
installed Git cannot provide this no-checkout flow, the result is `TOOLING_BLOCKED`, not an unsafe rejection.
The central source control plane admits at most 48 REST requests and reserves 12 additional physical request slots for
bounded transport retries. At 125 ms pacing, all admitted pacing plus worst-case retry delay is 19.375 seconds inside
the 30-second deadline. Provider throttling, exhausted anonymous quota, incomplete fallback data, and local tooling
failure remain system/tooling blockers; none is converted into a finding that an unusual project is unsafe.
Accepted source content is hard-capped at two megabytes per file and twenty megabytes per repository. Exact-Git runs
as a detached process group whose leader and helpers inherit a 64 MiB regular-file limit and a 20 CPU-second limit;
Linux additionally enforces a 512 MiB address-space limit. Output is byte-bounded. Aggregate temporary Git storage has
a separate 64 MiB process-monitor cap and post-command measurement; it is fail-closed but is not a native filesystem
quota, so multiple fast writes can briefly overshoot before the complete process group is killed and the temporary
repository is removed. A successful leader is also followed by a group kill so a remote helper or `index-pack` cannot
survive the bounded operation.

To materialize the generated files, pass an explicit new target directory outside the builder source repository. Its
parent `submissions/` directory must already exist, the target itself must not exist, and its basename must equal the
application id:

```bash
CENTRAL_APPLICATION_DIR="/absolute/path/to/clean-programmable-fork/submissions/$APPLICATION_ID"
node "$SKILL_ROOT/scripts/cli.mjs" prepare-pr \
  "submissions/$APPLICATION_ID" \
  --repository-root "$REPOSITORY_ROOT" \
  --output-dir "$CENTRAL_APPLICATION_DIR"
```

The `--output-dir` form creates that target and writes only the six canonical files listed above. It refuses an existing
target or a basename that differs from the application id. With the separate path shown above, the builder source
repository remains unchanged. The command still performs no push or pull-request creation. Review the generated files
and reported hashes before committing them to the separate clean central-repository branch. The CLI does not discover a
central checkout or infer this path for the builder.

For the first update after revision n is merged, refresh the clean central checkout to the exact base commit reported
by `prepare-pr`. Then replace only that byte-exact main package:

```bash
node "$SKILL_ROOT/scripts/cli.mjs" prepare-pr \
  "submissions/$APPLICATION_ID" \
  --repository-root "$REPOSITORY_ROOT" \
  --output-dir "$CENTRAL_APPLICATION_DIR" \
  --replace-existing
```

`--replace-existing` refuses a missing target, extra file, symlink, hard link, stale byte, wrong prior revision, or
different observed central base. It uses a verified local replacement with rollback; it is not a push, merge, or
single-system-call cross-platform atomic publication.

For every later commit or package-only correction in that same open pull request, replace the current local draft with:

```bash
node "$SKILL_ROOT/scripts/cli.mjs" prepare-pr \
  "submissions/$APPLICATION_ID" \
  --repository-root "$REPOSITORY_ROOT" \
  --output-dir "$CENTRAL_APPLICATION_DIR" \
  --replace-draft
```

`--replace-draft` snapshots the exact six non-executable regular files before public resolution, binds them to current
immutable main, preserves the pending revision and full numeric repository lineage, then rechecks directory, file
inodes, bytes, and main stability before a rollback-capable swap. It does not prove which pull request owns the local
directory, so use it only for the already-open application pull request you are updating.

## Open a draft pull request

1. Keep the complete project in its own public GitHub repository and push the exact clean revision prepared above.
2. Fork [`0xprogrammable/programmable`](https://github.com/0xprogrammable/programmable).
3. Create a branch from the current central `main` branch.
4. Materialize or copy exactly the generated six files into `submissions/<application-id>/`.
5. Confirm that the central diff contains no project source, extra submission files, registry edits, or workflows.
6. Push the central branch to the fork.
7. Open a draft pull request against `0xprogrammable/programmable:main` with the generated PR body.

Do not edit the model registry, create an acceptance record or set candidate status. Submission contents are untrusted
input. Intake automation must use trusted code from the base repository and must not execute contributor-supplied
scripts with credentials, signing access or repository write permission.

The central repository's `main` branch holds bounded application and release-evidence records. It is neither the
builder-project source branch nor the website production branch. Never put project source or a website release into an
application PR.

## Pull request contents

A submission PR states:

- Stage: proposal or prototype
- Exact compatibility decision and risk tier
- User outcome, project surfaces, and model difference
- Whether a custom hook is used; permissions and mask only when it is
- Assets, fees, custody, value flow, authorities, and dependencies
- Tests actually run and tests still required
- Known limitations and open decisions
- Builder GitHub identity and one contact handle
- License and third-party provenance
- Optional beneficiary address for a future accepted release

The PR must not include private keys, seed phrases, API tokens, RPC credentials, private vulnerability details, personal
data not required for attribution, or misleading approval and revenue claims.

## Review boundary

The agent may:

- Create and validate local files
- Explain findings and propose redesigns
- Prepare a branch, commit, or copy-ready PR body when the user requests it

The agent may not, without separate explicit authority:

- Open or merge the pull request
- Write a maintainer acceptance record
- Add the submission to the release registry
- Deploy or sign transactions
- Submit to Uniswap Hooklist or routing intake
- Promise a response time, acceptance, launch count, trading volume, or revenue

## After maintainer acceptance

An accepted model moves to a separate platform-integration handoff. Confirm that the acceptance record resolves to the
same model id, version, prototype commit, submission hash, review-target hash, scope, and open conditions as the reviewed
package. A merged PR, passing tests, candidate record, or maintainer comment is not a substitute.

Load `official-model-patterns.md` when the release derives from an official pattern. Load
`routing-and-discovery.md` for product indexing, discovery, Hooklist, quoting, routing, and provider boundaries.

The handoff must define every accepted or intended UI, app, game, API, service, keeper, oracle, indexer, quote, trade,
claim, and monitoring surface:

- Human owner and exact repository paths
- Source of truth and dependency trust level
- Inputs, outputs, schemas, events, or transaction states
- Chain, model version, contracts, SDKs, router, Permit2, and provider assumptions
- Errors, stale data, reorgs, retries, partial fills, recovery, and unsupported states where relevant
- Executable integration checks and the evidence required to call them passed
- Feature gate, rollout plan, and rollback limitation

For an intended trading surface, the product team must be able to trace one quote through execution, receipt
reconciliation, indexed state, displayed state, and any claim without changing PoolKey, direction, exactness, amount
semantics, hookData when used, or accepted configuration along the way. Other surfaces need the equivalent end-to-end
trace for their declared user action and value flow.

The handoff also carries a gate ledger. Keep these decisions separate:

1. Maintainer acceptance
2. Platform implementation review
3. Deployment authorization
4. Deployment execution
5. Source verification
6. Runtime matching
7. Lifecycle verification
8. Monitoring readiness
9. Hooklist, routing, indexing, and discovery-provider decisions
10. Product activation and availability

Each gate names its owner, exact evidence, current state, blocker, and next action. One gate never grants authority for
the next. A completed post-acceptance gate points to a maintainer-owned record bound to the accepted release; a
contributor gate record cannot satisfy it.

Registry, UI, API, indexer, and executable-test review use the candidate gates
`programmable-registry-integration-review`, `programmable-ui-integration-review`,
`programmable-api-integration-review`, `programmable-indexer-integration-review`, and
`programmable-integration-test-review`. Uniswap routing stays external as `uniswap-hook-routing-review`; permissioned
pools add `permissioned-pool-routing-allowlist`.
Quote, trade, claim, and monitoring stay as separate evidence rows inside integration-test review; no row is inferred
from another.

Platform changes target `production`, not `main`, and only the integration owner may combine them. Preparing a handoff
does not modify product code. Creating a product branch or PR, merging, deploying, verifying, submitting provider forms,
and activating the model each require their own task and authority.

## Security reports

Never disclose an unpatched vulnerability in a public proposal or PR. Use the repository's private vulnerability
reporting process.
