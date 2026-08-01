# Programmable v4 Builder Program

Programmable's first public builder intake is the **Public GitHub PR Builder Beta**.

Bring an idea or an existing public Uniswap v4 project. Your project stays in your own public GitHub repository. The
beta application is a small pull request to Programmable that binds the repository's immutable GitHub numeric id, one
exact commit, its exact tree and the public check evidence for that revision.

Read the complete [Public GitHub PR Builder Beta guide](docs/builder/PUBLIC_GITHUB_PR_BETA.md) before submitting.

## The simple path

```text
Idea or existing public project
  -> build in your own repository
  -> doctor
  -> scaffold, when starting a new project
  -> check
  -> package
  -> prepare-pr
  -> open one small public PR to Programmable
  -> architecture discussion or evidence-based review
  -> repair with a new commit in the same PR when needed
```

The released tooling defines the exact command invocation. These user-facing operation names are stable for the beta;
this document does not invent unreviewed flags.

Legacy model pull requests opened before beta activation keep their existing review path and contribution format. At
activation, that includes #35, #43 and #44. New applications use a builder-controlled public repository plus a small
`submissions/**` manifest pull request. Existing pull requests are not retroactively rewritten or assigned a new
status.

Compatible coding agents can use the portable
[Programmable v4 Builder skill](skills/programmable-v4-hook-builder/SKILL.md). Installation and agent behavior are
documented in [`docs/builder/AGENT_SKILL.md`](docs/builder/AGENT_SKILL.md). The same public-source and exact-revision
rules apply when you work manually.

## What stays in your repository

Keep the complete project in the builder-controlled public repository:

- contracts and application source;
- tests and test configuration;
- dependency and compiler locks;
- threat model and design documentation;
- required third-party notices; and
- the evidence inputs needed to reproduce the public checks.

Do not copy the full project into the Programmable application pull request. The small beta record points reviewers to
the exact public source and binds it by repository numeric id, commit and tree.

A mutable branch, tag, repository name or URL is not the review identity. Display names can change. The bound numeric
repository id and exact Git objects identify the revision under review.

## What the small application PR records

The beta pull request records:

- the canonical public repository URL and immutable GitHub numeric id;
- the full commit and tree SHA;
- the public check-evidence reference and digest;
- what the project does and why it uses Uniswap v4;
- value flows, fees, authorities, dependencies and failure behavior;
- known limitations and unresolved architecture questions; and
- source license, provenance and public builder contact.

A project may bind one primary public repository and up to eight explicitly declared public companion repositories for
separate contracts, apps, games, services, indexers or other surfaces. Every repository is pinned to immutable Git
objects; a mutable branch or repository name is never the review authority.

Use `package` to validate the local review package and report deterministic hashes. Then use `prepare-pr` to resolve
the clean pushed public GitHub revision and generate the expected central record. Do not hand-write identifiers or
claim checks that did not run.

The central `submissions/<application-id>/` directory contains exactly six files:

- `application.json`;
- `PROPOSAL.md`;
- `TEST_PLAN.md`;
- `THREAT_MODEL.md`;
- `compatibility-report.json`; and
- `evidence-index.json`.

`application-id` is a stable lower-case project slug used only for this public directory and manifest. The GitHub pull
request number is the review thread. Neither value is a connected-service account, credential or approval id.

## Builder responsibilities

Before marking the pull request ready for review:

- keep the referenced public commit reachable;
- make the project and its relevant dependency closure reviewable;
- state actual results separately from planned or blocked checks;
- disclose every value-moving path, fee, authority, custody rule and external trust assumption;
- list known limitations and open decisions;
- confirm the right to submit the project and its evidence for public review; and
- remove secrets, private data and non-public security findings.

`prepare-pr` resolves the builder's current GitHub login to an immutable decimal GitHub user id. The application stores
that id as authority and keeps the login and contact as display data. The trusted check requires the id and current
login to match the pull request author, preserves the id across application revisions, and allows the display login to
change after a GitHub rename. That identity check does not prove control of the linked source repository; reviewers
still verify the public repository, exact revision and contributor relationship as part of the review.

One application pull request represents one public project during this beta. If the project changes, push a new commit
to the same project repository, rerun `check`, `package` and `prepare-pr`, and update the same Programmable pull request.
The generated application revision increments only for a changed primary or companion source authority. The previous
revision and review remain visible in GitHub history.

## Review behavior

Reviewers evaluate the exact revision, not the idea's popularity and not the current head of a mutable branch.

An unfamiliar mechanic enters **architecture discussion**. Reviewers ask what it does, where value moves, who controls
it, what it trusts and how it fails. Lack of a catalog label is not a rejection.

The safer no-hook default uses the pinned official Launchpad profile, but it is not a launch-type allowlist. A
model-specific ordinary token or launcher, including transparent bounded transfer tax and automatic liquidity, may
enter review with its own exact source and dependencies. It must preserve transfer and sell liveness and disclose fee
bounds, recipients, authority, value flows, liquidity custody and exit, provider limits, and test evidence.

An objective finding includes:

- the exact affected revision and location;
- reproducible evidence;
- the applicable published rule or trust boundary;
- practical impact;
- a repair or missing-evidence path; and
- the check that must be rerun.

Review conclusions apply only to the repository numeric id, commit, tree and evidence named in the latest application
record. A new project commit is a new review target. No earlier conclusion transfers automatically.

GitHub pull-request state, commits, reviews and comments are the beta's status and audit trail. Merging a small beta
record means only that the public review record for that exact revision is complete. It is not product approval,
candidate selection, deployment authorization or availability.

## Capacity, ownership and pauses

Programmable maintainers (`@0xprogrammable`) own the review queue. The beta deliberately has no response-time or
review-time promise, and acceptance capacity may be limited.

Check the canonical [`docs/builder/intake-status.json`](docs/builder/intake-status.json) before preparing a pull
request. `prelaunch` means applications are not open. `open` accepts new applications and updates. `paused-new` blocks
new application ids except the exact still-open PRs recorded by maintainers when the pause begins; applications already
present on `main` may still update. `paused-all` temporarily blocks all application changes. The trusted base-branch
validator enforces this state; an applicant cannot enable intake from their pull request.

Each `paused-new` continuation is a reviewed, bounded status record binding the PR number, application id, immutable
builder GitHub user id, primary numeric repository id, and exact ordered companion-repository id list. The workflow
checks the PR/id pair before fetching candidate Git data, then checks the full identity again after bounded manifest
hydration and during final validation. A listed PR cannot switch to another builder or project lineage during a pause.

Existing pull requests and their history stay public during every pause. A pause is not a rejection, approval or queue
position. Maintainers communicate a pause or resume through the reviewed status-file commit. Individual applications
may still be paused privately for a security report. See [`SUPPORT.md`](SUPPORT.md) for the support boundary.

The state may move to `open` only after live `main` protection requires the trusted intake, security and Foundry
checks, CODEOWNER review, resolved conversations, and strict up-to-date branches or a merge queue. This serializes two
updates that target the same prior application revision; a stale check cannot authorize an overwrite.

Repository administrators remain the GitHub trust root and can change or bypass repository settings. Programmable's
solo-maintainer release path therefore keeps the administrator exception for owner-authored maintenance that cannot be
self-approved. It must never be used to merge a Builder application: every application requires the visible trusted
checks, current-base result and maintainer review described here. Applicants have no bypass authority.

## Public and private boundaries

The project repository, application pull request, evidence and review discussion are public and non-confidential.
Include only information you intend to publish.

Never include private keys, seed phrases, wallet files, passwords, access tokens, API keys, cookies, private RPC or
database URLs, environment files, confidential third-party material, unrelated personal data or an unpatched
vulnerability.

Do not disclose a vulnerability in a public application, issue or review comment. Follow [`SECURITY.md`](SECURITY.md)
and use [GitHub private vulnerability reporting](https://github.com/0xprogrammable/programmable/security/advisories/new).
Public review may say only that the review is paused while a private security report is handled.

The Public GitHub PR Builder Beta does not use private repositories, a Programmable wallet claim, a GitHub App
installation, a connected-service application identity, a deployment transaction or provider integration. Its
six-file public record still uses the stable project slug described above.

## Evidence boundary

A local check, generated package, GitHub review or merged beta record is not:

- an audit or security certification;
- a claim that the project is safe or rug-free;
- acceptance as a Programmable launch model;
- deployment, launch or transaction evidence;
- provider routing, indexing or support evidence;
- Uniswap Labs or Uniswap Foundation endorsement; or
- a promise of fees, revenue, grants, review time or future integration.

Any later candidate decision, implementation review, integration, deployment, source verification, runtime matching,
provider work or public release is separate and must bind its own exact revision and evidence.

## Open the application pull request

1. Keep the complete project in a builder-controlled public GitHub repository.
2. Run `doctor`; use `scaffold` only for a new project.
3. Run `check` on the exact pushed revision.
4. Run `package` to validate the complete local review package and report deterministic hashes without executing
   project code.
5. Run `prepare-pr` to verify the clean pushed public repository id, commit and tree and generate the six-file beta
   record plus pull-request body.
6. Open a draft pull request against `0xprogrammable/programmable:main` with a title beginning `[Builder Beta]`.
7. Complete the pull-request template and mark it ready when the record and evidence are current.

Immediately before merge, rerun `check`, `package` and `prepare-pr` from the latest clean pushed builder revision. The
trusted intake check must resolve the declared public source and evidence again; an earlier green run is not proof that
an external repository is still public or unchanged at review time.

Opening or updating the public pull request is an external action. An agent may prepare it, but must not publish it
without the builder's explicit confirmation.

## Honest public description

> Bring an idea or a public GitHub project. The Programmable Builder helps your coding agent check one exact revision,
> prepare a small public application PR and work through evidence-based review findings. Unknown mechanics enter
> architecture discussion. The project stays in your repository, and GitHub keeps the public review trail.

Always pair that description with this boundary:

> Beta review is not an audit, product approval, deployment, provider support or Uniswap endorsement.
