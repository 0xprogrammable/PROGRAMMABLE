# Public GitHub PR Builder Beta

The Public GitHub PR Builder Beta is a simple, public review path for builders working on Uniswap v4 projects.

Your project stays in your own public GitHub repository. A beta application is a small pull request to Programmable
that binds one exact public repository revision and its public check evidence. GitHub commits, reviews and pull-request
history are the beta's status and audit trail.

This is not the connected application service described in the Open Hook v2 plans. It uses no Programmable wallet
claim, GitHub App installation, private repository access or connected-service application identity. The six-file
public record still has a stable lower-case `applicationId` equal to its project slug and directory name; the GitHub
pull-request number is the review thread.

## What the beta promises

The beta helps a builder:

1. turn an idea or existing repository into a concrete project;
2. run the published checks against one exact revision;
3. prepare a small, reviewable application pull request;
4. discuss unfamiliar mechanics without forcing them into a preset model;
5. receive evidence-based findings and a repair path; and
6. update the same pull request when a new project commit is ready.

The beta does not approve, audit, deploy or launch a project. It does not prove that a project is safe, rug-free,
supported by a provider or endorsed by Uniswap.

## Transition for already-open model pull requests

Model pull requests opened before the beta is activated keep the review path and contribution format they started
with. At activation, that includes the currently open legacy model pull requests #35, #43 and #44. Maintainers review
or close those pull requests on their existing record; this beta does not rewrite them or assign them a new status.

New applications opened after beta activation use a builder-controlled public GitHub repository plus a small
`submissions/**` manifest pull request to Programmable. The opening time determines the intake path; later commits do
not silently move an existing pull request between paths.

## Eligibility

A beta application needs:

- one builder-controlled **public GitHub repository**;
- an exact pushed commit that remains reachable during review;
- the exact Git tree for that commit;
- public evidence produced by the published beta checks;
- a clear project summary, known limitations and source license; and
- a GitHub identity the reviewers can contact in the pull request.

`prepare-pr` anonymously resolves that identity through GitHub's public user endpoint. `application.builder.githubUserId`
is the immutable decimal identity; `githubLogin` and `contact` are public display data. The trusted intake check compares
the numeric id and current login with the authenticated pull-request author. A GitHub login rename therefore keeps the
same builder identity, while a different numeric user id cannot replace the builder on a later application revision.
This PR-author binding is not proof that the author controls the linked source repository.

Private repositories, local-only worktrees, ZIP files, pasted source, mutable branch names and deployed bytecode without
the reviewed source are outside this beta. A builder can continue local work, but cannot open a valid beta application
until the exact source is public and pushed.

The project can be a focused hook repository or a larger application that includes contracts, an interface, services,
games, indexers or external dependencies. An unfamiliar mechanic is not rejected merely because it lacks a catalog
name. Reviewers open an architecture discussion to understand its value flow, authority, trust and failure behavior.

The no-hook path stays open for proposals, including separately pinned tokens, launchers, transparent transfer taxes,
and automatic liquidity. It is not launch-ready. Before prototype readiness, a simple project implements the standard
Programmable fee-hook profile and a custom project integrates the policy into its single hook. Exact source, tests, and maintainer review are required. Hidden fees, sell blocks, address
lists, wallet or transaction caps, cooldowns, and a tax bound that can consume the complete transfer remain ineligible
for the permissionless path.

### Mandatory Programmable fee

The legacy beta application path uses Builder `v0.2.1` records. New model work uses the immutable Hookbuilder `v0.5.1`
release and its per-side Fee V1.1 contract; legacy v2 applications remain readable only for migration and historical
review.

- `effective side rate = max(builder-selected side rate, 10 bps)`;
- exactly `10 bps` (`0.10%`) belongs to Programmable and the project receives the remainder;
- the split is inclusive on each side, so selected `3%` means `0.1% + 2.9%`, never `3.1%`;
- the basis is actually executed gross quote-side volume for every successful swap of the canonical PoolKey, in both
  directions and exact-input/exact-output modes;
- LP fees, transfer taxes, router charges, app payments, and alternative pools are not substitutes; and
- immutable owner and sole claim authority `0x4957f49620AFf3Adbbe8195a4f633E49cc93376c` may claim anytime to itself or
  an owner-selected destination for that claim. Builders, projects, and administrators cannot mutate or claim it.

Every idea may still be submitted. Missing integration produces an architecture or changes-required review result, not
an automatic rejection of the idea. The skill and checker do not prove live collection; that requires reviewed source,
authorized deployment, runtime matching, lifecycle receipts, liability reconciliation, and monitoring.

The target may be any positive JavaScript-safe EVM chain. Known chain ids must use their canonical network slug; an
unknown chain opens an architecture review instead of an automatic safety rejection. This makes the project eligible to
apply, not eligible to launch. The current Programmable launch integration is Ethereum Mainnet-only. Base, Unichain,
Sepolia and every other chain remain behind a separate maintainer-owned integration and release gate. A committed
official Uniswap deployment reference is useful provenance, but runtime-unverified records do not become
Programmable-tested or launch-supported merely because they were selected.

## What the application pull request contains

The application pull request is intentionally small. It records:

- the canonical public repository URL;
- the repository's immutable GitHub numeric id;
- the full commit SHA under review;
- the full Git tree SHA for that commit;
- the public check-evidence reference and digest;
- a plain-language behavior and value-flow summary;
- declared authorities, fees, dependencies and known limitations; and
- source license and required third-party notices.

The pull request does not copy the full project into Programmable. It adds exactly six generated files under one
`submissions/<application-id>/` directory—`application.json`, `PROPOSAL.md`, `TEST_PLAN.md`, `THREAT_MODEL.md`,
`compatibility-report.json` and `evidence-index.json`—plus the completed pull-request description. `package` validates
the local review package and reports deterministic hashes. `prepare-pr` independently resolves the clean pushed public
revision and generates the six central files. Do not hand-invent fields, identifiers or tool results.

`PROTOTYPE_READY` in the builder repository is a local preflight result, not a trusted public status. Until the trusted
base validator can reconstruct the exact review target and all bound source/evidence blob digests, the public beta does
not accept a central `prototype-ready` result; a hand-edited claim fails with
`PROTOTYPE_READY_REQUIRES_TRUSTED_REVIEW_TARGET`. The official generator legitimately leaves mandatory candidate and
maintainer gates open, so a reviewable prototype enters as `architecture-review-required`, `changes-required`, or
`tooling-blocked`. Public review completion remains a maintainer decision and is still not product approval or launch
authorization.

A repository URL, owner/name pair, branch or tag is display information, not the review identity. The review identity is
the repository numeric id plus the exact commit, tree and evidence.

The application also binds the declared builder login to the pull request author. This prevents one GitHub user from
submitting under another user's name, but it does not prove ownership or control of the linked source repository.

### Pull-request path isolation

Any pull request that changes `submissions/**` is an application pull request. It must change only one closed
six-file application directory and cannot include documentation, workflow, skill, plugin, eval or product-code
changes. The sole exception is a maintainer-only update to `submissions/README.md`, which uses the separate
`builder-maintenance` path and still cannot be mixed into an application pull request.

Programmable maintainers update the canonical skill, trusted validator, generated plugin, eval suite and builder
documentation through a separate `builder-maintenance` pull request. The trusted `pull_request_target` job uses only
base-branch code to classify that change and never runs candidate validators, generators, tests, workflows or scripts.
Candidate maintenance checks run in the repository's ordinary read-only pull-request CI and still require maintainer
review before merge.

## Builder journey

The public command vocabulary is:

```text
doctor -> scaffold -> check -> package -> prepare-pr
```

The released tooling defines the exact invocation. This document intentionally does not invent flags that have not
been frozen and tested.

### 1. Start in your public project repository

Describe what the project should do in plain language, either to a compatible coding agent or directly in the project.
If a repository already exists, keep its architecture and inspect it before changing it. Do not rebuild a working
project merely to fit a template.

### 2. Run `doctor`

`doctor` checks local readiness. It reports actionable blockers such as a missing Git repository, unsupported GitHub
remote, unpushed revision, unavailable required tools, missing exact-object Git capability or a dirty source state. Live public reachability remains
`notChecked` until `prepare-pr`. It does not create an application or claim that the project passed review.

Before build or package checks, the agent inspects pinned dependency files and materializes the declared dependency
closure. A clean clone can still need a lockfile-driven install before OpenZeppelin, generated bindings, Foundry
libraries or other imports exist locally. Inspect install scripts first and use an isolated environment without
credentials for untrusted code. `doctor` does not claim that project dependencies are installed.

### 3. Use `scaffold` only when needed

`scaffold` creates the minimum local builder structure for a new idea. Existing projects skip unnecessary scaffolding.
Generated files are a starting point, not reviewed code.

### 4. Run `check`

`check` evaluates the current exact project revision against the published deterministic and semantic requirements. It
records findings, missing evidence and tooling blockers. A green local result means only that the checks completed for
that revision; it is not a security review or maintainer decision.

### 5. Run `package`

`package` validates the complete local review package, declared source closure, hashes and evidence without executing
project code. It performs no public GitHub resolution and makes no pushed-commit claim.

Run `check` with `--repository-root`; that is the complete repository-aware preflight and the report includes closed
`closure.status` diagnostics. An unsupported language, alias, bundler glob, runtime loader, non-root-Foundry Solidity
profile, or companion repository may proceed as a proposal under `architecture-review-required`. The same incomplete
closure blocks prototype readiness; independent design blockers can still produce `changes-required`. Objective
source-binding failures such as a wrong or missing literal relative path,
symlink, Gitlink, unmaterialized LFS object, or exceeded limit remain hard errors.

### 6. Run `prepare-pr`

`prepare-pr` requires a clean pushed revision, independently resolves its public GitHub repository id, commit and tree,
and generates the small six-file Programmable application record plus a copy-ready pull-request body. It does not
publish source, push a branch or open a pull request without the builder's explicit confirmation.

When using `--output-dir`, create its parent first, keep it outside the builder repository, avoid symbolic-link aliases,
and pass the canonical real path. On macOS, use `/private/tmp/...` instead of the `/tmp` alias.

Projects may span the primary repository plus up to eight explicitly declared public companion repositories. Each
companion is pinned to a full commit and independently resolved; branches and repository names are not authority. The
output clearly separates the builder's `sourceHead` from the observed central `main` target. New applications start at
revision 1. A merged revision n authorizes one pending n+1 update when primary or companion source authority differs
from main; further commits in that same open pull request remain on the pending revision until merge.

Companion manifest v2 removes the blanket incomplete-closure result for a supported npm game, app, or service only
after `prepare-pr` verifies the declared numeric repository id, commit, root tree, source/test/runtime/build paths,
static module graph, complete package-lock v3 dependency closure and a successful Actions run of the closed
install/build/test workflow bound to that exact revision. Its receipt is preserved in central `application.json` for
downstream authority checks. Manifest v1 remains proposal-compatible and enters architecture review. A v2 closure
result is not an audit or approval; see the
canonical `references/companion-manifests.md` contract in the installed skill.

The source check supports broad repositories without spending one anonymous GitHub API call per declared file. It
binds the public repository, commit and direct root-tree object first, then reads all declared Git objects in one
bounded anonymous, no-checkout Git batch per repository. Evidence blobs are already declared primary-source paths, so
the central check retains only those exact bytes and reuses them for evidence binding instead of walking GitHub REST or
fetching the repository again. Candidate hooks, Git configuration, filters, submodules and project code are never
executed. Git 2.49.0 or newer plus `git backfill` is required. A missing safe Git capability is reported as a tooling
blocker; it is not turned into a claim that an unusual project is unsafe.

Before the central workflow downloads any candidate Git object, it reads the intake state from the exact trusted base
revision. When intake is closed, bounded GitHub pull-request path metadata distinguishes an application from legacy or
builder-maintenance work; application data stops before Git fetch. The exact base-repository PR merge is then fetched
bloblessly under a 32 MiB per-file/pack limit, 64 MiB object-store limit, 64 KiB output limit, 30-second wall limit,
20-second CPU limit and, on the Linux production runner, a 512 MiB address-space limit. The complete Git process group
is terminated on failure. The central read credential is removed before any external project source is resolved.

The anonymous REST control plane admits at most 48 source requests. The transport reserves the remaining 12 requests
of its 60-request physical ceiling for bounded retries; with 125 ms pacing, the worst admitted scheduling and retry
delay is 19.375 seconds inside the single 30-second source deadline. Evidence adds no REST requests on the production
path. Provider throttling, exhausted shared-IP quota, an incomplete REST fallback tree, or missing exact-Git tooling is
a system/tooling blocker, never evidence that a project is unsafe.

A worst-case application can consume the complete 60-request anonymous GitHub allowance available to one runner IP,
so concurrent or abusive pull requests can temporarily make otherwise valid checks unavailable. Maintainers monitor
`public-intake` system-block codes in GitHub Actions, do not spin in unbounded retries, and rerun once after the
provider reset. Repeated quota failures move intake to `paused-new` or `paused-all` while the queue and public history
remain intact. This is an explicit beta availability limit, not a project finding or rejection.

Accepted source remains hard-capped at 2 MB per file and 20 MB per repository. Exact-Git runs in a detached process
group: the leader and helpers inherit a 64 MiB regular-file limit and a 20 CPU-second limit, Linux additionally applies
a 512 MiB address-space limit, and output plus aggregate temporary storage stay bounded. The 64 MiB aggregate
repository guard is process-monitored rather than a native filesystem quota, so multiple fast writes can briefly
overshoot it; any limit failure kills the complete process group and the temporary repository is removed.

Those limits remain strict for code, tests, shaders, WebAssembly and build inputs. Large non-executable models, audio,
textures, levels, maps, tiles and media use the separate runtime-assets v1 manifest. It records the repository path,
exact Git blob, SHA-256 where verifiable, MIME, size, loading behavior, license and provenance. `prepare-pr` binds the
small manifest and its blob declarations to the exact public commit and root tree without fetching or executing the
assets. Unmaterialized LFS objects and external HTTPS/IPFS resources enter attributable asset review; that status is
not an unsafe-code conclusion and does not alone block structural prototype readiness.

### 7. Open one draft pull request

Open a draft pull request against `0xprogrammable/programmable:main` with a title beginning `[Builder Beta]`. Complete
the pull-request template and keep the referenced project commit reachable. One pull request represents one public
project and its revision history during the beta review.

When the record and evidence are ready, mark the pull request ready for review.

## GitHub status model

The beta uses ordinary GitHub state. It does not invent an off-platform application status.

| GitHub state | Beta meaning |
| --- | --- |
| Draft pull request | The builder is preparing the record or answering early architecture questions. |
| Open and ready for review | The latest bound revision is queued for review. |
| Review in progress | A reviewer is checking the exact repository revision and evidence. |
| Architecture discussion | An unfamiliar or unresolved mechanism needs design clarification; this is not a rejection. |
| Changes requested | One or more objective findings need repair or stronger evidence. |
| Application record merged | The public beta review record for the exact bound revision is complete. This is not product approval or launch authorization. |
| Pull request closed | The application stopped without a merged beta record. The closing comment states the public reason and possible next step. |

GitHub's native review and branch-protection signals are repository workflow controls only. They do not certify the
project or change any deployment, provider or product state.

### Intake capacity and pause state

Programmable maintainers (`@0xprogrammable`) own the GitHub review queue. The beta has no review-time or response-time
promise. Its canonical state is [`intake-status.json`](intake-status.json), read from the trusted `main` revision:

| Intake state | Behavior |
| --- | --- |
| `prelaunch` | Applications are not open. |
| `open` | New application ids and updates may run the trusted intake check. |
| `paused-new` | Applications already present on `main` and only exact trusted unmerged PR/application continuations may proceed; every other new id is blocked. |
| `paused-all` | All application changes are temporarily blocked; existing public history remains visible. |

Only a maintainer-reviewed change on `main` can pause or resume intake. An application pull request cannot change this
state. The trusted validator reads the exact base-revision blob, never the candidate's copy. A missing, noncanonical,
malformed or unsupported trusted status blocks the intake check as an operational system error. A pause is an
operational limit, not a rejection, approval or promised queue position. `prelaunch` and `paused-all` stop application
Git data before fetch. In `paused-new`, an id already present as a closed six-file package on the trusted base may
update. A still-unmerged new id proceeds only when `continuingPullRequests` contains its exact PR number, application
id, immutable builder GitHub user id, primary numeric repository id, and ordered companion numeric-id vector. The
PR/id pair is checked from bounded GitHub changed-file metadata before candidate Git fetch. Builder and repository
identity are checked again after bounded `application.json` hydration and during final validation. Renames, deletions,
mixed paths, a different PR, a different id, or source-lineage slot laundering fail closed.

Maintainers populate that bounded canonical list in the same reviewed `main` commit that activates the pause. They
record only open applications intended to continue; the list is never discovered from candidate content. It is empty
in `prelaunch`, `open`, and `paused-all`, may be empty in `paused-new`, and is removed when intake reopens. Removing a
record stops its next workflow run without deleting GitHub history. Builder-maintenance and unrelated legacy pull
requests remain on their existing CI path without loading candidate application data.

Before changing the state to `open`, maintainers record live GitHub evidence that `main` requires the trusted
`public-intake` check, normal security and Foundry checks, CODEOWNER review, resolved conversations, and either a
strictly up-to-date branch or a merge queue. For non-administrator Builder pull requests, these rules force a second
pull request for the same application to rerun against the first merged revision instead of overwriting history from a
stale green check. Local configuration or a documented target is not evidence that the live repository is protected.

Repository administrators remain the GitHub trust root and can change or bypass repository settings. Programmable's
solo-maintainer release path retains the administrator exception for owner-authored maintenance that GitHub does not
allow the same account to self-approve. It must never be used for a Builder application. Every application needs the
visible trusted checks, latest-base result and maintainer review; applicants receive no bypass authority.

## Review and repair loop

Review applies only to the exact repository numeric id, commit, tree and evidence named by the latest application
record.

An objective finding includes:

- the exact affected revision and source or evidence location;
- the observed fact and reproducible evidence;
- the published rule or trust boundary involved;
- the practical impact;
- the repair or missing-evidence path; and
- the check that must be rerun.

A reviewer does not reject a project because its mechanic is novel. When intent, authority, value flow, external trust
or failure behavior is unclear, the reviewer starts an architecture discussion and asks the smallest question that can
resolve it.

Automated public-claim checks catch known misleading audit, safety, endorsement, deployment and availability wording,
including common obfuscation. They are a heuristic, not proof that free text is true or complete. A maintainer must read
the rendered application and evidence before recording a review conclusion.

If the builder changes the project:

1. commit and push the change in the same public project repository;
2. rerun `check` and `package` for the new exact commit;
3. rerun `prepare-pr`, replace the current self-consistent local draft with `--replace-draft`, and update the same
   Programmable pull request (`--replace-existing` is only for creating the first pending update from merged main); and
4. add a comment summarizing the repair and the superseded revision.

The new commit is a new review target, but the open application stays at revision 1 or main n+1 until merge. Findings
and conclusions about the previous commit remain in GitHub history but do not automatically apply to the new target.
Avoid force-pushing or deleting referenced commits while review is open; preserving the commit and review history keeps
the audit trail understandable.

## Reviewer journey

Reviewers use this minimum sequence:

1. Confirm that the pull request is a small beta record and that the public repository, numeric id, commit and tree are
   reachable and consistent.
2. Confirm that the evidence was produced for the same exact revision using trusted beta tooling.
3. Read the project summary, value flows, authorities, mandatory Programmable fee record, project fees, dependencies,
   failure behavior and known limitations.
4. Run any deeper checks against the bound revision in an isolated environment without credentials, signing access or
   repository write permission.
5. Open an architecture discussion for an unknown mechanic, or request changes with an objective finding and repair
   path.
6. After a new commit, re-resolve the identifiers and rerun every invalidated check before recording a new conclusion.
7. Immediately before merge, rerun the trusted intake against the latest central commit so every declared external
   source and evidence byte is fetched and bound again.
8. Merge the small application record only when the public beta review record is complete, or close the pull request
   with a factual reason and next step.

The final reviewer comment names the exact repository id, commit, tree and evidence it covers. It must also say that the
decision is limited to the Public GitHub PR Builder Beta and is not an audit, product approval, deployment decision,
provider statement or Uniswap endorsement.

## Public data and privacy

The project repository, application pull request, commit history, review comments and beta evidence are public and
non-confidential. Include only information you intend to publish.

Never include:

- private keys, seed phrases, wallet files or signing material;
- passwords, access tokens, API keys, cookies or credentials;
- private RPC URLs, database URLs or environment files;
- unrelated personal information or private customer data;
- confidential third-party source or documents; or
- an unpatched vulnerability or exploit instructions.

Use a GitHub handle for public contact unless another public contact is necessary. The beta does not need a wallet
address, legal identity, private repository permission or GitHub App installation.

## Private security reports

Do not describe an unpatched vulnerability in the application pull request, a public issue or a review comment. Use
[GitHub private vulnerability reporting](https://github.com/0xprogrammable/programmable/security/advisories/new) as
described in [`SECURITY.md`](../../SECURITY.md).

If public review uncovers a potentially exploitable issue, stop the public technical discussion. A maintainer may post a
minimal public note that review is paused and move the details to the private report. The public thread can resume after
the issue is safe to discuss.

## What a completed beta review does not mean

A draft, open, reviewed, merged or closed application pull request does not mean that the project is:

- audited, safe, rug-free or free of vulnerabilities;
- accepted as a Programmable model;
- deployed, launchable, tradable or available;
- supported, routed or indexed by any provider;
- endorsed by Uniswap Labs, Uniswap Foundation or another third party; or
- entitled to project fees, revenue, grants or future integration merely because it was submitted.

Any later candidate selection, contract review, integration, deployment, source verification, runtime verification,
provider work or public release is a separate process with its own exact evidence.

## Honest release copy

Use the following copy only after the beta tooling, trusted intake checks and maintainer review path are active on the
public repository. Before that point, describe the beta as upcoming rather than open.

### Short description

> Bring an idea or a public GitHub project. The Programmable Builder helps your coding agent check one exact revision,
> prepare a small public application PR and work through evidence-based review findings.

### Launch announcement

> **The Programmable Public GitHub PR Builder Beta is open.** Describe your Uniswap v4 project to your coding agent, or
> bring an existing public repository. Use `doctor`, `scaffold`, `check`, `package` and `prepare-pr` to bind one exact
> public GitHub revision and open a small application pull request. Unknown mechanics enter architecture discussion;
> objective findings include evidence and a repair path. The project stays in your repository, and GitHub keeps the
> public review history. New launch applications declare the fixed 10 bps Programmable canonical-pool volume fee.
> Beta review is not an audit, product approval, deployment, proof of live fee collection, provider support or Uniswap
> endorsement.

### Compact social copy

> Your idea. Your public repo. One exact revision. The Programmable Public GitHub PR Builder Beta helps coding agents
> prepare a checkable Uniswap v4 project and a small public review PR. Review findings come with evidence and a repair
> path. No audit, launch or endorsement claim.

Do not publish copy that says the agent “does everything,” that applications are approved, or that a beta-reviewed
project can launch a coin. A factual shorthand is: **Your agent handles the build-and-repair loop; GitHub keeps the
exact public review trail.**

## Related documents

- [Programmable v4 Builder Program](../../BUILDER_PROGRAM.md)
- [Builder submission directory](../../submissions/README.md)
- [Use the agent skill](AGENT_SKILL.md)
- [Security reporting](../../SECURITY.md)
- [Contribution guide](../../CONTRIBUTING.md)
