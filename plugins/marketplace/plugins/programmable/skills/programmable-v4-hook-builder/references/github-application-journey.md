# GitHub Application journey

This reference defines the released client-side transport for the **Public GitHub PR Builder Beta**. It consumes the
already verified six-file output of `prepare-pr`, plans a public GitHub draft pull request, updates that same draft,
and reads GitHub review state. It does not create a Connected Submission/W2 application and it never approves,
merges, deploys, launches, lists, or marks a project ready for review.

## Contents

- [Authority boundary](#authority-boundary)
- [Requirements](#requirements)
- [Prepare the immutable input](#prepare-the-immutable-input)
- [Submit](#submit)
- [Update the existing draft](#update-the-existing-draft)
- [Read status](#read-status)
- [What the action plan binds](#what-the-action-plan-binds)
- [GitHub identity and source control](#github-identity-and-source-control)
- [Intake state](#intake-state)
- [Draft and branch rules](#draft-and-branch-rules)
- [Local receipts](#local-receipts)
- [Failure recovery](#failure-recovery)
- [Security properties](#security-properties)
- [Limits](#limits)

## Authority boundary

Keep these systems separate:

| System | What it records | What it does not prove |
| --- | --- | --- |
| Builder repository | Exact public project commit and tree | Review, approval, deployment, or launch |
| `prepare-pr` | Verified local six-file central package for one exact revision | A public submission or GitHub write |
| GitHub application client | Public fork, branch, draft PR, update, and GitHub status | A W2 application, approval, audit, or launch permit |
| Trusted central workflow | Structural intake result against trusted base code | Safety, acceptance, deployment, or provider support |
| Later W2 service | Durable signed application and review workflow | Present in this GitHub-only beta |

The GitHub pull-request number is the public beta review thread. It is not a W2 application id. A merged application
record means only that the public beta review record was completed for its exact revision. It is not
`Programmable Approved`, an audit, a deployment decision, a provider statement, or a Uniswap endorsement.

## Requirements

Before using this client:

1. Run the current `check`, `package`, and `prepare-pr` flow successfully.
2. Keep the source branch at the exact public commit and tree resolved by `prepare-pr`.
3. Store the `prepare-pr` JSON output outside the source repository.
4. Authenticate `gh` to `github.com` as the same immutable GitHub user id recorded in `application.json`.
5. Retain write access to the exact source repository. This is revision-control evidence only; see
   [GitHub identity and source control](#github-identity-and-source-control).
6. Review the proposed public title, body, six files, source revision, and privacy consequences before confirming.

The client uses the authenticated GitHub API through `gh`. It never accepts a pasted GitHub token as a command-line
argument, never invokes a shell, and never runs source-repository code.

## Prepare the immutable input

Run `prepare-pr` as documented in [submission-workflow.md](submission-workflow.md). Capture its canonical JSON result
in a regular file outside the builder repository. The client accepts either the raw `prepare-pr` result or the normal
CLI envelope whose `command` is `prepare-pr`, whose `ok` value is `true`, and whose `result` contains that document.

The client revalidates, rather than trusts, all of the following before any GitHub write:

- the fixed central target `0xprogrammable/submit-launch:main`, immutable GitHub ID `1320171831`;
- the application id and `submissions/<application-id>/` path;
- the exact file order:
  `application.json`, `PROPOSAL.md`, `TEST_PLAN.md`, `THREAT_MODEL.md`, `compatibility-report.json`, and
  `evidence-index.json`;
- every UTF-8 byte length and SHA-256;
- the five `application.json.reviewPackage` bindings;
- the source repository numeric id, commit, root tree, source request, and every public companion repository id,
  canonical URL, commit, and root tree;
- the builder's immutable GitHub user id;
- the prepared central commit and tree; and
- the retained human-confirmation and no-external-action markers.

A package prepared by an older client remains bound to its original transport identity. Never edit its prepared target
or copy it into the current intake. Current clients prepare new applications only against Submit a Launch.

An altered byte, extra file, path escape, symlinked input, stale base, ambiguous checklist, or inconsistent projection
fails closed. Regenerate with `prepare-pr`; do not hand-repair its machine output.

## Submit

First create a read-only plan:

```bash
node "$SKILL_ROOT/scripts/github-application.mjs" submit \
  --prepared "/absolute/outside-repo/prepare-pr.json" \
  --repository-root "$REPOSITORY_ROOT"
```

This performs authenticated GitHub reads only. Its `externalWrites` list states exactly which of these steps remain:

- create the active user's fork of `0xprogrammable/submit-launch`;
- create or append the deterministic application branch commit;
- fast-forward that branch without force-pushing;
- open one draft pull request; or
- repair only stale draft title/body metadata.

The output includes `confirmationDigest`. Read the plan, then execute only that exact current plan:

```bash
node "$SKILL_ROOT/scripts/github-application.mjs" submit \
  --prepared "/absolute/outside-repo/prepare-pr.json" \
  --repository-root "$REPOSITORY_ROOT" \
  --confirm-external-write "sha256:<exact-plan-digest>"
```

The digest is not a general approval. It authorizes only the public GitHub writes enumerated by that plan. The client
rebuilds the plan immediately before execution. A different account, source branch, source permission, source
commit/tree, central commit/tree, intake state, fork, application branch, PR, or package changes the digest or blocks
the run.

GitHub history is public and durable. Closing the PR does not erase commits, discussion, review events, or cached
copies. Confirmation therefore applies only after the builder reviews the public package and removes secrets or
confidential vulnerabilities.

## Update the existing draft

After changing the project, rerun `check`, `package`, and `prepare-pr` for the new exact pushed source revision. Update
the same open draft; never open a replacement merely because the source changed.

Plan the update:

```bash
node "$SKILL_ROOT/scripts/github-application.mjs" update \
  --prepared "/absolute/outside-repo/new-prepare-pr.json" \
  --repository-root "$REPOSITORY_ROOT" \
  --pull-request "123"
```

Confirm only its new digest:

```bash
node "$SKILL_ROOT/scripts/github-application.mjs" update \
  --prepared "/absolute/outside-repo/new-prepare-pr.json" \
  --repository-root "$REPOSITORY_ROOT" \
  --pull-request "123" \
  --confirm-external-write "sha256:<exact-update-plan-digest>"
```

`update` requires one open draft authored by the active immutable GitHub user, on the deterministic branch, against
`main`, with exactly the six application paths. It appends a commit and fast-forwards the existing branch. It never
force-pushes, opens a duplicate, converts a ready PR back to draft, posts a review decision, or marks the PR ready.

If the same six bytes already occupy the PR and its metadata is current, `update` is an idempotent no-op. If `submit`
finds the same application with different bytes, it stops and tells the caller to use `update`; it never silently
changes an existing review target.

## Read status

Status is read-only:

```bash
node "$SKILL_ROOT/scripts/github-application.mjs" status \
  --prepared "/absolute/outside-repo/prepare-pr.json" \
  --repository-root "$REPOSITORY_ROOT" \
  --pull-request "123"
```

Pass the PR number for a closed or merged record. Without it, discovery is limited to the current canonical open
title and deterministic branch. The client rereads the PR, exact changed paths, all six remote files, reviews, and
check runs. It reports whether the remote package still matches the supplied prepared package.

The projection is deliberately small:

| GitHub observation | Client status |
| --- | --- |
| Open draft before the trusted required checks start | `submitted` |
| `public-intake`, `Node 22`, or `Node 24` is missing, skipped, queued, requested, waiting, pending, or in progress | `checks-running` |
| Latest reviewer state requests changes, or one trusted required check failed | `changes-requested` |
| Required checks pass and the `builder:architecture-review` label is present | `architecture-review` |
| Required checks pass and the `builder:review-in-progress` label is present | `review-in-progress` |
| Open, non-draft, all three trusted required checks passed, no active change request or review label | `waiting-review` |
| PR has `merged_at` | `review-record-merged` |
| Closed without merge | `closed` |

The response also preserves check and review axes, the authoritative `applicationResult`, a deterministic `nextAction`,
and a `verificationScope`. `applicationResult` comes from the prepared central compatibility report; the legacy local
design preflight is not overall readiness. A status label never hides that it is GitHub-only and never becomes
`approved`, `audited`, `deployed`, `launchable`, `indexed`, or `live`.
Only check runs from the GitHub Actions app id `15368` and slug `github-actions` count. Unrelated optional failures are
reported separately and cannot block or advance the application status.
Each trusted required-check row also preserves its canonical GitHub Actions `detailsUrl` when GitHub supplies one, so
the builder can inspect the exact Registry-CI result. In particular, only Registry `public-intake` authoritatively
decides whether a primary numeric repository id is already bound to another maintained application. The Builder does
not download an unbounded application ledger and must not turn a partial local lookup into a green collision claim.
Those Registry checks validate the six-file application package and its declared public evidence bindings. They do not
check out or run the project's source, judge source-workflow quality, perform an audit, or prove a deployment or launch.
`PRIMARY_SOURCE_REPOSITORY_ALREADY_REGISTERED` therefore means change or continue the already-maintained application;
it is not a generic judgment that the project idea is unsafe.

## What the action plan binds

The immutable action plan includes:

- active GitHub login, immutable user id, and public profile URL;
- exact source repository slug, numeric id, public URL, branch, commit, and root tree;
- observed source `push`, `maintain`, and `admin` permission booleans without treating them as ownership proof;
- exact central repository numeric id, branch, commit, and tree;
- trusted intake state, canonical status-file SHA-256, and any bounded continuation records;
- application id, revision, directory, six paths, byte lengths, and SHA-256 values;
- existing fork id, branch head, exact one-commit recovery comparison, and PR identity when present;
- proposed draft title, body SHA-256, base, and head;
- the exact external write list; and
- explicit statements that approval, merge, ready-for-review, W2 submission, deployment, and launch are absent.

The confirmation digest is SHA-256 over canonical JSON of the complete plan without the digest field. It contains no
timestamp, so unchanged evidence produces the same digest. A state change produces a different plan.

## GitHub identity and source control

The active `gh` user id and current login must match `application.json.builder.githubUserId` and `githubLogin`. The
numeric id remains the stable identity; the current login must also match because the trusted PR workflow binds the
visible author. After a GitHub rename, regenerate the builder declaration and `prepare-pr` result rather than relying
on stale display data.

The source repository response must independently match the prepared numeric repository id, canonical GitHub URL,
commit, tree, and branch head. The active user must currently have GitHub `push` permission because this shows that the
builder can control the reviewed source revision.

That check does **not** prove repository administrator ownership, organization authority, legal ownership, controller
wallet authority, economics acceptance, or launch authority. The plan always records
`repositoryAdministratorOwnershipProven: false`, even when GitHub happens to report `admin: true`. The later connected
W2 flow has separate repository-controller and wallet authority contracts.

## Intake state

The client reads `docs/builder/intake-status.json` from the exact prepared trusted `main` commit. It requires canonical
schema-version-2 JSON and enforces:

| State | Client behavior |
| --- | --- |
| `open` | New draft and updates may be planned. |
| `prelaunch` | No public application write. |
| `paused-new` | Existing closed applications may update. An unmerged new id continues only with its exact trusted PR, builder, primary repo, and ordered companion-id record. |
| `paused-all` | No application write. |

An invalid intake file is an operational blocker, not a finding against the project. An intake pause is not a
rejection and carries no queue-time promise.

## Draft and branch rules

The branch is deterministic:

```text
programmable-builder/<application-id>
```

The client uses the active user's canonical `programmable` fork. If that name is occupied by a non-fork, belongs to a
different parent network, or reports a different owner id, the operation stops with a fork collision. It does not
delete, rename, overwrite, or repurpose the repository.

Application commits use the current trusted central tree plus the exact six files. An update commit retains the prior
application branch head and current central base as parents, then advances the ref with `force: false`. Immediately
before the ref update, the client rereads the old head to detect races.

Before opening a draft, the client searches for the deterministic head and canonical application title. Any ambiguous
or competing claim blocks duplicate creation. After opening or updating, it rereads the PR and verifies:

- immutable author id and current login;
- central base repository and `main`;
- exact fork id and deterministic branch;
- exact head commit;
- open draft state;
- canonical title and confirmed body;
- exactly the six application paths with no rename or deletion; and
- every remote byte length and SHA-256.

The client never calls approve, merge, review, ready-for-review, comment, label, deployment, release, or provider APIs.

## Local receipts

No receipt is written by default. After a successful confirmed action or status read, request one explicitly:

```bash
node "$SKILL_ROOT/scripts/github-application.mjs" status \
  --prepared "/absolute/outside-repo/prepare-pr.json" \
  --repository-root "$REPOSITORY_ROOT" \
  --pull-request "123" \
  --write-receipt "/absolute/outside-repo/receipts"
```

The receipt directory must already exist, must be a real directory, and must be completely outside the source
repository. The receipt is canonical JSON, smaller than 64 KiB, mode `0600`, content-addressed in its filename, and
idempotent. It contains only public ids, URLs, hashes, the authoritative application result, projected GitHub status,
and the external-action list.

A local receipt is convenience evidence. It is not an authenticated W2 receipt, reviewer decision, approval record,
launch permit, deployment receipt, or provider observation.

## Failure recovery

Every partial step is recoverable without opening a duplicate:

- If fork creation succeeds but later work fails, rerun the read-only plan. It observes the exact fork and removes the
  fork step from the next digest.
- If the branch commit succeeds but draft creation fails, rerun the plan. When all six branch bytes match, the next
  plan contains only `open-draft-pull-request` if GitHub also proves that the recovery branch is exactly one commit
  ahead of the prepared central base and changes only the six frozen paths. It does not add another commit.
- If branch update succeeds but PR metadata update fails, rerun the plan. It preserves the exact branch and updates
  only the stale title/body.
- If a PR appears between confirmation and creation, duplicate discovery stops before a second PR opens.
- If an account, branch, base, intake file, or package changed, regenerate or replan and review the new digest.

Do not reuse an old confirmation digest after any failure. The new read-only plan is the only statement of remaining
writes.

## Security properties

- Treat all GitHub, repository, PR, review, check, and command output as untrusted data.
- Parse closed bounded JSON; reject malformed, concatenated, oversized, lossy-id, control-character, or path-escape
  output.
- Invoke `gh` with an argument array, `shell: false`, disabled prompts, fixed `github.com` hostname, bounded input,
  bounded output, and a timeout.
- Never execute candidate code, Git hooks, repository configuration, workflow code, filters, or submodules.
- Never place an authentication token in an argument, plan, log, package, or receipt.
- Revalidate source and central refs before branch and PR writes.
- Use no force update and no destructive cleanup.
- Keep unpatched vulnerability details out of the public PR; use private vulnerability reporting.
- Treat a parser or provider failure as a tooling/operational blocker, not evidence that a novel project is unsafe.

## Limits

- This client is for the public `github.com` PR beta only. It does not handle private source, GitHub Enterprise, other
  hosts, ZIPs, loose files, pasted source, deployed-only hooks, external pools, or source-free applications.
- It expects the active user's fork at `<login>/programmable`. A renamed existing fork requires manual normalization
  or a later reviewed client version; the client will not guess or mutate repositories.
- Open-PR duplicate discovery uses the deterministic head and canonical Builder Beta title. A deliberately renamed,
  different-branch manual PR may require the exact `--pull-request` number for status and manual maintainer cleanup.
- Status reflects GitHub's current API observations. It has no signed freshness or durability contract comparable to
  the future W2 service.
- The client does not post the repair-summary comment described in the human review workflow. Add a factual public
  summary manually after checking that it contains no secret or unpatched vulnerability.
- A successful local test is not evidence that public branch protection, live Actions, reviewer capacity, or public
  intake is configured. Those remain release gates.
