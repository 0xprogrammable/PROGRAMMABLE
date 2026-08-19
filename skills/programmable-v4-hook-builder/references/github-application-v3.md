# GitHub application v3

> Candidate Application V3 contract, not the released package version. Both released and future Applicant transports
> use the canonical `0xprogrammable/submit-launch:main` repository identity; never create a new Applicant PR in
> Hookbuilder.

Use this reference only for `submission.v2.json` and `public-pr-application-v3`. Do not route a v2 project through the
historical v1 `prepare-pr` contract, six-file `application.json` package or maximum-eight-companion path.

Application v3 is a candidate until its local generator, trusted Registry validator, update/status client and release
gates pass together. Schema presence or a locally valid example is not evidence that public v3 intake is active.

The authenticated approval-to-Website bridge is part of the same local release candidate and remains pending production
activation. The target path is GitHub application and exact-revision status, then Website Custom Launcher eligibility
for that same unchanged approved source SHA. The Builder never derives that eligibility locally.

Application V3 is GitHub-only. Every source surface must be an exact public GitHub repository. Another Git host, private
repository, ZIP, pasted source, upload form or email is not an alternate V3 transport; it needs a different versioned
contract and threat model. Keep the idea `ELIGIBLE_FOR_REVIEW`, report `INTEGRATION_PENDING`, and materialize or write
no public Application V3 package for that source.

## Contents

1. [Application contract](#application-contract)
2. [Source closure](#source-closure)
3. [Revision and lineage preparation](#revision-and-lineage-preparation)
4. [Application-package preparation](#application-package-preparation)
5. [External-write boundary](#external-write-boundary)
6. [Review and status](#review-and-status)
7. [Historical applications](#historical-applications)

## Application contract

Generate `application.v3.json` only through the released v3 generator. Bind:

- application id, revision and explicit lineage;
- builder identity and public-data acknowledgements;
- the exact idea-source repository/path/digest as the sole normative intent source;
- intent and fidelity state without inherited approval;
- `submission.v2.json` by repository, path and digest;
- Fee V2 schema, derived `feeApplicability`, and a real project instance only when applicability is `applicable`;
- security schema plus source-assessed security and verification records derived after source freeze;
- exact review-package records and evidence; and
- every primary/companion repository by local id, GitHub numeric id, URI, commit and tree.

Preserve every embedded V2 `chainId` as a canonical positive `uint256` decimal string. Application, Registry acceptance
and Launch Bundle V2 must never narrow it to a JSON number or JavaScript safe integer.

Encode `applicationRevision` itself as a canonical positive decimal string (`"1"`, not a JSON number) across Application
V3, Registry Acceptance V3 and Launch V2. Do not impose the historical V1 integer shape, a `1,000,000` ceiling or a
JavaScript safe-integer ceiling. A new application starts at `"1"`; every later revision must be exactly the prior
content-bound decimal revision plus one using arbitrary-precision semantics. Frozen V1 application revisions remain
integers.

For a V3 predecessor, derive `lineage.previous` with
`derivePublicPrApplicationV3PreviousBinding`; do not hand-author its fields. The helper binds only facts provable from
the immutable predecessor root and package bytes: application identity/revision/digests, primary source repository
id/commit/tree, Submission V2 schema/standard/path/digest, Fee V2 id/version, and the predecessor's exact
`feeApplicability` plus nullable `feePolicyInstanceSha256`. The current Registry base belongs to the transport plan and pull request, so it is not a
historical predecessor field. Never relabel the Keccak-based `programmableFeePolicyHash` as SHA-256; it remains an
exact global-policy field in the predecessor Application root.

Allow only a non-normative public-safe idea excerpt. Keep it null for redacted or unavailable intent. Never copy a
second normative summary that can replace provenance.

Keep a submitted application `unreviewed`. Require no acceptance binding and grant no approval. A later trusted review
decision is a separate authority record for one exact revision.

Derive fee applicability from the exact bound Submission V2 graph:

- `proposal` requires `unresolved` and null fee-instance path, repository and digest;
- a prototype with at least one `programmable-canonical` scope requires `applicable` plus a real instance path,
  repository and digest; and
- an exact zero-scope prototype requires `not-applicable` and keeps all three instance fields null.

Do not use N/A to hide a canonical execution path, and do not fabricate a market or fee artifact for a zero-scope app,
service, indexer, game or standalone external settlement.

Let a source-owned proposal keep its security assessment null or explicitly pending/unassessed. Do not place a
source-assessed security instance or source-verification report in the source commit whose id it contains. After
freezing source, derive the assessed instance and one verification report per repository into the central application
package. Bind them as `source: application-package`, `repositoryRef: null`, while their content binds the
already-existing source commit, tree and manifest.

## Source closure

Use one closure mode per repository:

- `inline`: bind one to 4,096 unique repository-relative paths and no source manifest.
- `manifest`: bind no inline paths; bind one versioned root manifest by path, SHA-256, byte length, Git blob, entry count
  and fragment count.

Treat inline as a small-package fast path, not a product tier. Crossing 4,096 paths selects manifest transport and
never makes a large game, service or unfamiliar architecture unsafe or ineligible.

In manifest mode, let the outer application repository record bind repository id/URI plus exact commit/tree. Read the
root manifest as an exact blob inside that pinned tree. The root repeats repository id/URI and binds ordered fragments;
it deliberately does not embed its own containing commit/tree because that would require a cryptographic fixed point.

Verify every fragment and canonical JSONL entry against raw Git objects. Check global UTF-8 bytewise path order,
uniqueness, ranges, counts, modes, roles, blob ids, byte lengths, per-object hashes and the closure digest. Do not follow
symlinks or execute candidate code, hooks, filters, submodules or build scripts. Return a precise split-review hold when
a bounded verifier budget is exceeded; preserve idea eligibility.

Coverage is per repository. A path in one companion can never satisfy a fee, submission, evidence or review binding in
another repository.

`source-closure-manifest-v1` binds 40-hex SHA-1 Git object ids, separately records SHA-256 byte digests, and requires
UTF-8 committed paths. A Git SHA-256 object database or non-UTF-8 path exits without a write as `INTEGRATION_PENDING`,
`ideaEligibility: ELIGIBLE_FOR_REVIEW`, classification `tooling-transport`. A UTF-8 path above the current 16 KiB byte
budget returns `HOLD_SPLIT_REVIEW` and `tooling-split-review`. Add other object formats or path encodings through a new
versioned closure contract, generator and verifier; never silently widen V1 or call the product unsafe.

The optional top-level `publicDisclosureAttestations[]` can move only an exact intentionally public
`public-financial-identifier` candidate from privacy block to human review. Bind each candidate's RFC 6901 string pointer, SHA-256 of
the matched substring, application id, owner-stated purpose and exactly one `public-disclosure-authorization` review
record. It proves neither ownership nor approval. Wrong, unused or blanket attestations fail closed; credentials, keys,
seed phrases, passwords and API/auth tokens are never attestable.

All raw JSON reaches the strict bounded parser before semantic, privacy or integrity interpretation. Duplicate decoded
keys are invalid even when their values match and even when one spelling uses a Unicode escape. This prevents a secret,
authority or digest from being hidden behind a later visible value. Resource ceilings route to a typed split-review hold
where the contract permits it; they never become an unsupported-product or unsafe-category verdict.

## Revision and lineage preparation

Keep `applicationRevision` and `lineage` absent from the canonical revision draft. Derive both from the highest exact
eligible Registry or open-draft predecessor; never copy, increment or repair them by hand. From the installed skill:

```bash
REVISION_DRAFT="/absolute/outside-source/application-v3-draft.json"
REVISION_ROOT="/absolute/outside-source/prepared-revision"
node "$SKILL_ROOT/scripts/cli.mjs" open-world prepare-revision "$REVISION_DRAFT" \
  --source-root primary="$REPOSITORY_ROOT" \
  --output "$REVISION_ROOT" \
  --write
```

Repeat `--source-root <repository-ref>=<git-root>` for every current repository. Preview is the default. The command uses
authenticated GET-only GitHub requests and exact local raw-Git replay; it performs no candidate-code execution, GitHub
write, approval, submission or launch action. `--write` creates one new output root containing only
`application.v3.json` through an atomic rename. The output cannot be inside the Builder worktree, the input-draft
directory, a source worktree, a linked-worktree Git directory, a shared Git common directory or an object store.

Run this command again after every source, source-closure, evidence or recheck change. If the predecessor uses the same
numeric GitHub repository identity, the current mapped object database may replay its earlier commit automatically.
Use repeatable `--predecessor-source-root <repository-ref>=<git-root>` only for a selected removed or replaced historical
repository whose exact objects are not available from the current mappings. A mixed manifest/inline predecessor needs
the explicit old root for a removed inline companion. An entirely inline predecessor that can be replayed from the
immutable remote package must not receive a needless old-root mapping. Missing historical objects are a typed
`INTEGRATION_PENDING` availability state; a supplied but corrupt, mismatched or incomplete object graph is invalid.

## Application-package preparation

Feed the resulting `$REVISION_ROOT/application.v3.json` into `cli.mjs open-world application`. Inspect `--help` for the
complete review/security inputs and repeatable current-source mappings. This second operation is zero-network and must:

- preview by default and perform no write, network request, push, submission or approval;
- accept only already-derived immutable repository identities, revision/lineage and exact local Git objects;
- validate the complete v2 package and source closure;
- derive source-assessed security and repository verification reports only after all source commits are fixed;
- generate canonical deterministic `application.v3.json` bytes;
- refuse an existing destination unless a separately documented update path owns that exact revision; and
- write only after an explicit local write flag through staging and atomic rename.

Do not hand-edit a prepared application to bypass a finding. Regenerate it from the exact corrected source revision.
Application-package preparation never opens a pull request and never claims that the Registry validated the Git objects
remotely. Every destination must be a new root outside every input, source worktree and Git-control directory. Passing
that package to submit/update is a later operation.

Validate a closed package before transport from any working directory, including an installed skill with no Git
checkout:

```bash
node "$SKILL_ROOT/scripts/cli.mjs" open-world validate-application "$APPLICATION_PACKAGE"
```

Repeat `--source-root <repository-ref>=<git-root>` for every repository when a fresh local source-closure replay is
required. Without mappings, the command still validates the closed schema and semantic bindings, canonical package
bytes, privacy scan and every persisted source-verification report. It performs no network request, filesystem write or
candidate-code execution.

## External-write boundary

Keep GitHub preparation and GitHub mutation separate. After trusted V3 intake is active, use only namespaced
`cli.mjs open-world submit`, `update`, and `status`; top-level application commands remain the released V1 path. The first V3
submit or update invocation must be a read-only plan
that reports:

- target repository, base revision, application id and revision;
- exact branch/pull-request action;
- every external write;
- the bytes/digests being sent; and
- one current confirmation digest.

The fixed public target is
[`0xprogrammable/submit-launch:main`](https://github.com/0xprogrammable/submit-launch), immutable GitHub repository ID
`1320171831`. The confirmed
client uses the builder's fork to create or update one draft application pull request there.

Require explicit user authority for that exact digest before creating a fork, advancing a branch or opening/updating a
pull request. Recompute the plan immediately before execution and fail closed if source, base, identity, package,
intake state or requested writes changed. Never reuse a stale confirmation.

Every confirmed submit or update requires `--mutation-receipt <absolute-json>` outside the application package. The
client holds one exclusive `<receipt>.lock` for the complete confirmed execution or confirmed resume, records each
mutation before its request, records returned identifiers before readback, and atomically replaces and fsyncs the
receipt after every state transition. It never retries a POST or PATCH. Only bounded GitHub GETs may retry transient or
rate-limited failures.

Use `--resume --mutation-receipt <absolute-json>` without a confirmation digest for GET-only reconciliation. This mode
does not create, fsync, rewrite or remove the receipt lock or receipt. If a prior crash left a lock, the result reports
its safe metadata, owner-process observation, possible-stale assessment and manual recovery guidance while retaining
the lock exactly. Confirm that no live process owns it, preserve both files, complete GET-only remote reconciliation,
and obtain maintainer review before manually removing it. Continuing after reconciliation reacquires the exclusive lock
and requires the receipt's exact original confirmation digest; an unknown tree or commit POST outcome is never replayed
automatically.

Planning, reconciliation and execution verify the trusted Registry intake object and every declared source CI run. A CI
run counts only when its repository identity, head repository identity, exact head SHA, workflow id/path, completed
state and successful conclusion all match the application binding. `open-world status` independently re-reads the
remote package and review state; optional local source roots add evidence but are not a substitute for remote status.

The confirmed client may perform only the writes listed in the plan. It must never mark the pull request ready, approve,
merge, deploy, sign, launch, change an account or move funds.

`open-world status` is read-only. Do not claim that the client, trusted intake or public Registry path exists merely
because the local command schema is present; require the exact released client, protected workflow and live canary.

## Review and status

Use GitHub as public transport and the review thread. Keep these axes separate:

- application transport: not submitted, draft/open, checks running, changes requested, merged or closed;
- design: unresolved, changes required or design ready;
- implementation: not started, in progress or structurally complete;
- independent review: required, hold, disposition recorded or accepted for the exact revision;
- Registry acceptance: absent/null or a content-bound accepted revision;
- authenticated approval: absent, approved for the exact revision, stale or revoked;
- Website launch handoff: pending activation, details required, permit ready, blocked or consumed;
- launch preparation: matched, unresolved or conflict; Builder-local output is never authorization;
- runtime: not deployed, deployed/verified or monitored; and
- availability: not indexed, indexed, quoted or tradable.

Let unfamiliar mechanics enter architecture discussion. An objective finding must name the exact revision, rule,
location, evidence, impact and repair path. The builder may attach counter-evidence but cannot self-disposition the
finding. A Registry/maintainer disposition must bind the application revision, finding identity, evidence and
accountable reviewer; preserve the original observation and never carry the disposition into another commit.

For a project change, create a new public commit, rerun invalidated checks, regenerate v2 artifacts and
`application.v3.json`, then use the released read-only update-plan path and explicitly authorize only its current
digest. Keep prior revisions and conclusions visible as history.

Merging the GitHub application pull request proves only that the public transport/review thread was merged. It does not
by itself create canonical acceptance, deploy, index, quote or launch the project and is not an audit or Uniswap
endorsement.

A merged GitHub thread is not canonical acceptance by itself. Acceptance requires a Registry-controlled record that
binds the exact application, source, Submission V2, fee applicability and conditional Fee V2 instance, security
assessment, verification reports, findings and maintainer decision. Registry Acceptance V3 permits `applicable` with a
real fee instance or exact zero-scope `not-applicable` with null instance fields. It omits its own containing commit/tree;
the later outer launch input binds its exact Registry repository, commit, tree, path, blob and digest. Before that record
exists, launch input keeps acceptance null and reports `UNRESOLVED` and `NOT_AUTHORIZED`. Launch Bundle V2 is a separate
canonical fee-bearing contract: a `not-applicable` acceptance cannot become a fabricated fee binding or launch
authorization and must remain a launch conflict.

After activation, the authenticated approval service may convert only a valid exact-revision approval into Website
launch eligibility. The same GitHub subject must sign in, and the service must re-resolve the approved application and
source SHA and recheck current source, rights, policy, compiler, launch specification, release, chain, and incident
state. Any changed source SHA is stale and returns to analysis. A PR review, label, comment, merge, local receipt, or
caller-provided status is not launch authority.

Builder launch analysis is preflight only. Its protected resolver re-reads the central Registry repository by numeric ID,
the closed-and-merged Application PR, `refs/pull/<number>/head`, the current-head OWNER approval and the exact raw-Git
base-to-head package change set under one bounded deadline. It also reads central `refs/heads/main` twice and replays the
exact bound acceptance path, Git blob and SHA-256 from that stable current commit. The immutable PR-author GitHub user ID is authoritative;
the stored Application login is historical and may have been renamed. Maintainer and Registry authority likewise use
their immutable numeric GitHub IDs; current login, full name and URI are observed metadata that must be internally
consistent but may change. Caller JSON and results produced with an injected or mocked transport are inspection-only and never
become process-local authority. Production must independently repeat this verification before any later authorization.

## Historical applications

Keep published v1 application bytes, six-file packages, pull requests, receipts and statuses immutable. Do not rename
`application.json` to `application.v3.json`, reinterpret a v1 fee receipt as Fee V2 evidence or silently widen old
source limits. Migrate forward through a separate v2 revision with explicit lineage, legacy-unconfirmed intent,
unassessed fidelity and no inherited acceptance.
