# Builder upgrades and private release planning

Use this reference when checking a Builder version, evaluating an authenticated update, previewing a standards
migration, or calculating caller-declared inputs for one bundled daily release candidate. Release planning is local and
advisory: it does not prove privacy, complete release history, trusted time, artifact bytes, owner authority, cadence
compliance, planned source identity, or release readiness. These tools do not download, install, activate, publish, tag,
push, or make anything live.

## Contents

- [Trust boundary](#trust-boundary)
- [Commands](#commands)
- [Closed input examples](#closed-input-examples)
- [Version and update records](#version-and-update-records)
- [Migration rules](#migration-rules)
- [Caller-declared release candidates](#caller-declared-release-candidates)
- [Human and machine output](#human-and-machine-output)
- [Limits and handoff](#limits-and-handoff)

## Trust boundary

Treat update, migration, release-history, candidate, evidence, and owner-GO files as untrusted input. A supplied update
is cryptographically authenticated only to the supplied installed state and trust pin when all of these checks pass:

1. The supplied trust pin byte-for-byte hashes to the digest stored in the installed state.
2. Its Ed25519 public key derives the stored key id.
3. The pin authorizes the update channel and is valid at the explicit trusted time.
4. The signed payload hash and Ed25519 signature verify over the canonical payload bytes.
5. Signature, payload, release sequence, semantic version, and minimum-installed-version checks do not roll back.
6. Every package artifact and release-evidence reference is content addressed.

The update command reads only supplied local files. It has no network implementation and cannot replace a complete TUF
client, authenticated package download, reproducible build, independent review, or release-owner decision. A later
runtime may feed files verified by the frozen TUF design into this same local evaluator.

An authenticated update is staged data, not running code. Never load or activate new executable bytes in the current
agent session. A major release, trust-key change, tool-permission change, or standards migration needs explicit review
and consent outside these commands.

Release planning has a narrower trust result. The planner validates closed JSON shapes and computes consistency, intent
digests, and elapsed time from caller-supplied data. It does not authenticate release-history completeness or the clock,
resolve the declared Git commit/tree/tag, read referenced artifact or manifest bytes, verify their digests, inspect
repository visibility, authenticate the owner, or perform W5 review. Its output therefore remains
`caller-declared-local-release-plan` even when every local declaration is complete.

## Commands

Set the skill root once:

```bash
SKILL_ROOT="<directory-containing-SKILL.md>"
```

Report the installed version and exact standards:

```bash
node "$SKILL_ROOT/scripts/builder-lifecycle.mjs" version
```

This default reports the constants bundled with the checked-out Builder. The v0.5.1 package reports
`publicationState: release-package` and `publicationStateVerified: false`; the bundled constant identifies release
package bytes but does not independently resolve or authenticate a public tag. To inspect an explicit pinned installed-state record instead, add
`--state path/to/installed-state.json`; the JSON output marks that source as an installed-state override and keeps
publication state `not-verified`. Neither path establishes update trust or public release state.

Check one already-supplied signed update against one already-pinned trust record:

```bash
node "$SKILL_ROOT/scripts/builder-lifecycle.mjs" update-check \
  --state path/to/installed-state.json \
  --update path/to/signed-update.json \
  --pin path/to/trusted-pin.json \
  --now 2026-08-03T12:00:00Z
```

Preview a migration. `--dry-run` is mandatory; there is deliberately no apply mode:

```bash
node "$SKILL_ROOT/scripts/builder-lifecycle.mjs" migrate \
  --current path/to/current-document.json \
  --proposal path/to/migration-proposal.json \
  --state path/to/installed-state.json \
  --update path/to/signed-update.json \
  --pin path/to/trusted-pin.json \
  --now 2026-08-03T12:00:00Z \
  --dry-run
```

Calculate one caller-declared candidate against caller-supplied release history and time:

```bash
node "$SKILL_ROOT/scripts/builder-lifecycle.mjs" plan-release \
  --candidate path/to/release-candidate.json \
  --history path/to/release-history.json \
  --now 2026-08-03T12:00:00Z
```

Add `--human` to any command for a short stderr summary. Stdout stays one canonical JSON object so an agent, CLI,
MCP adapter, or test harness can consume the same result.

## Closed input examples

The CLI rejects unknown and missing fields. Start from these complete packaged examples instead of reconstructing input
objects from source code or tests:

| Input | Packaged example | Boundary |
| --- | --- | --- |
| Installed state | `assets/templates/lifecycle/installed-state.TEST-ONLY.example.json` | Bound only to the packaged fixture pin |
| Trust pin | `assets/templates/lifecycle/trusted-pin.TEST-ONLY.example.json` | Public key is for parser and signature demonstrations only |
| Signed update | `assets/templates/lifecycle/signed-update.TEST-ONLY.example.json` | Signature is valid only under the fixture pin; artifact paths and hashes are deliberately not real evidence |
| Current migration document | `assets/templates/lifecycle/migration-current-document.example.json` | Small inert example whose digest matches the proposal |
| Migration proposal | `assets/templates/lifecycle/migration-proposal.example.json` | Changes only the standard version and preserves economics, wallet, authority, risk, and evidence values |
| Release history | `assets/templates/lifecycle/release-history.caller-declared.example.json` | Demonstrates shape and cadence calculation; `releasedAt` is not authenticated history |
| Release candidate | `assets/templates/release-candidate.example.json` | Binds the planned 0.5.1 transition but deliberately leaves source and release-artifact coordinates incomplete |
| Critical-hotfix candidate | `assets/templates/lifecycle/release-candidate.critical-hotfix.caller-declared.example.json` | Closed critical-hotfix draft with security-only change kinds; all placeholder incident, owner, source, and artifact data remains unverified and incomplete |

The three filenames containing `TEST-ONLY` form one internally consistent historical `0.3.0` / submission `1.4.0`
fixture set. It tests generic update and migration behavior; it is not the current `0.5.1` candidate record. Never copy their trust key, pin
digest, signature, artifact hashes, or evidence paths into production state. `update-check` reports
`verification.fixtureOnly: true` and `productionTrustEstablishedByThisCommand: false` for this pin. The packaged fixture
public-key id remains test-only even if an input relabels the pin id. Non-fixture updates can authenticate to a supplied
installed pin, but establishing that pin as the real production root remains outside this local command.

Exercise the fixture without installing anything:

```bash
node "$SKILL_ROOT/scripts/builder-lifecycle.mjs" update-check \
  --state "$SKILL_ROOT/assets/templates/lifecycle/installed-state.TEST-ONLY.example.json" \
  --update "$SKILL_ROOT/assets/templates/lifecycle/signed-update.TEST-ONLY.example.json" \
  --pin "$SKILL_ROOT/assets/templates/lifecycle/trusted-pin.TEST-ONLY.example.json" \
  --now 2026-08-03T12:00:00Z \
  --human
```

Exercise the matching migration preview:

```bash
node "$SKILL_ROOT/scripts/builder-lifecycle.mjs" migrate \
  --current "$SKILL_ROOT/assets/templates/lifecycle/migration-current-document.example.json" \
  --proposal "$SKILL_ROOT/assets/templates/lifecycle/migration-proposal.example.json" \
  --state "$SKILL_ROOT/assets/templates/lifecycle/installed-state.TEST-ONLY.example.json" \
  --update "$SKILL_ROOT/assets/templates/lifecycle/signed-update.TEST-ONLY.example.json" \
  --pin "$SKILL_ROOT/assets/templates/lifecycle/trusted-pin.TEST-ONLY.example.json" \
  --now 2026-08-03T12:00:00Z \
  --dry-run \
  --human
```

## Version and update records

The installed state binds:

- current semantic release version and monotonic decimal release sequence;
- `stable` or `canary` channel;
- exact skill, engine, policy, schema, and submission-standard versions;
- trusted pin SHA-256 and Ed25519 key id.

The trusted pin binds its id, canonical raw 32-byte Ed25519 public key, validity interval, channels, and minimum release
sequence. The signed update binds release version and sequence, channel, minimum installed version, release and expiry
times, standards, migration requirement, sorted content-addressed artifacts, and evidence for checksums, SBOM, evals,
and canary verification.

A `pinId` beginning with `TEST-ONLY-` is always reported as fixture trust. A valid signature under that fixture proves
only that the packaged parser example is internally consistent. It never establishes production release authority.

An update check returns one of:

| State | Meaning |
| --- | --- |
| `up-to-date` | Version and sequence exactly match. |
| `update-available` | A same-major update is authenticated and may be staged for a later session. |
| `migration-required` | Authentication passed, but the signed update requires a field-by-field dry-run. |
| `major-migration-required` | Authentication passed, but explicit migration and consent are required. |
| `channel-mismatch` | The update is authentic but is not selected by the installed channel. |

A downgrade, stale pin, stale signature, mismatched key, invalid payload hash, sequence/version conflict, or unsupported
intermediate jump fails closed. No result says installed, activated, published, audited, or live.

## Migration rules

A migration proposal contains the exact current-document SHA-256, source and target standard versions, a complete
proposed document, and one explicit reason for each changed JSON Pointer. The target standard must match the
authenticated signed update.

The dry-run emits a stable field-by-field diff with `add`, `remove`, or `replace`, the prior value, proposed value,
reason, and protected classifications. Missing reasons, duplicate reason paths, or reasons that no longer match a
change make the plan `blocked-ambiguous`.

These classes always require named confirmation:

- economics, fees, rates, and taxes;
- wallets, owners, recipients, and beneficiaries;
- authority, roles, permissions, and administrators;
- risk and threat classifications;
- evidence, receipts, proofs, and findings;
- every major submission-standard change.

The tool never silently changes these fields, never writes the proposed document, never relabels old evidence, and
never deletes historical standards. Applying an accepted migration is a separate owner-controlled implementation and
review step.

## Caller-declared release candidates

Start from `assets/templates/release-candidate.example.json`. Templates are accelerators, not claims. The example is
intentionally incomplete. Its `privateCandidate: true` and `publicState: not-published` values are caller declarations;
the local planner does not inspect GitHub, remotes, tags, releases, websites, or any other publication surface.

Programmable policy permits one normal public Builder release per rolling 24 hours. This internal Builder release policy
does not limit how often an applicant may release its own hook, app, game, or service. The local planner calculates an
absolute elapsed-time window from caller-supplied RFC 3339 time and caller-supplied history; it does not authenticate
either input and therefore cannot prove cadence compliance. W5 must independently resolve complete release history and
trusted time.

Operationally, a history entry's `releasedAt` is the independently verified GitHub Release `published_at`. Do not push
the final release tag before the release action. If a tag, package, release asset, release notes, repository state, or
another release byte becomes public earlier, W5 must use that earliest independently verified public exposure instead
of the later GitHub timestamp. The planner cannot query GitHub or discover that earlier exposure; its `releasedAt`
remains a caller declaration.

The example candidate's closed `plannedRelease` object binds the intended identity. For the historical packaged private
0.5.1 planning example it declares:

- Builder `0.4.0 -> 0.5.1` with semantic classification `minor`;
- submission standard `1.5.0 -> 1.6.0`;
- fee policy `1.1.0 -> 1.1.0`;
- one full 40-hex Git commit, full 40-hex tree, and planned tag name; and
- one builder-artifact path/SHA-256 coordinate and one release-manifest path/SHA-256 coordinate.

The private example deliberately leaves commit, tree, tag, artifact, and manifest coordinates `null`. That is valid
draft shape but keeps `plannedRelease.callerDeclaredComplete: false`. Supplying well-shaped values makes only the caller
declaration complete: `commitVerified`, `treeVerified`, `tagVerified`, `bytesRead`, `digestVerified`, and
`externallyVerified` remain false. W5 must bind those values to the exact reviewed and eventually published bytes.

Every `changes` entry has a closed `kind`: `breaking-change`, `bug-fix`, `documentation`, `feature`, `maintenance`,
`security-advisory`, or `security-fix`. The intent digest binds the kind as well as the change id and summary, so a
feature cannot be relabelled after owner GO.

Bundle intended Builder changes into one declared candidate and provide coordinates for:

- exact package checksums;
- an SBOM;
- eval results;
- canary evidence;
- daily release notes;
- one ready-to-post public summary;
- explicit owner release GO bound to evidence and the exact candidate intent digest.

The intent digest also binds the complete planned Builder/submission/fee transition, source commit/tree/tag, artifact
and release-manifest coordinates, hotfix severity, affected versions, reason, incident digest, and all change kinds.
Both owner GO and a hotfix owner override must satisfy
`candidate.preparedAt <= grantedAt <= caller-supplied planner now`. This is only local timestamp consistency; W5 still
authenticates the signer, authority, evidence bytes, and time.

`status: complete` plus a nonempty path and SHA-256 makes only `callerDeclaredComplete: true`. The planner deliberately
does not read the path or hash its bytes. Every slot therefore continues to report `artifactRead: false`,
`evidenceDigestVerified: false`, and `externallyVerified: false` until W5 performs those checks.

A `security-hotfix` candidate must declare a closed severity (`low`, `medium`, `high`, or `critical`), a nonempty unique
list of affected semantic versions sorted in ascending SemVer order, a reason code, incident-record SHA-256, and an
intent-bound owner override. Its changes may contain only `security-fix` or `security-advisory`; a feature, maintenance,
documentation, bug-fix, or breaking-change bundle fails closed. A normal candidate must keep `severity: null`,
`affectedVersions: []`, reason and incident digest `null`, and owner override `not-applicable`.

Only a complete caller-declared `critical` hotfix is locally eligible to bypass a closed 24-hour window. `high`,
`medium`, and `low` hotfixes remain subject to the normal window. Even for `critical`, the output says only
`callerDeclaredCadenceExceptionEligible: true`; it always keeps `cadenceExceptionProven: false`,
`ownerIdentityAuthenticated: false`, and `ownerAuthorityVerified: false`. W5 decides whether the incident, severity,
affected versions, authority, and real exception are valid. Owner GO remains separately required.

The result kind is `caller-declared-local-release-plan`. It exposes:

- caller-declared candidate state separately from `privacyProven: false`, `publicationStateVerified: false`, and
  `liveStateVerified: false`;
- caller-declared planned release transitions and coordinates separately from source, tag, artifact, and manifest
  verification flags that remain false;
- `callerDeclaredNormalWindowOpen` separately from `cadenceComplianceProven: false`;
- `callerDeclaredPlanComplete` separately from `releaseReadinessProven: false`;
- every still-pending external W5 requirement; and
- `releaseActionAuthorized: false` plus `readyForOwnerControlledReleaseAction: false` unconditionally.

The command truthfully records only its own behavior: it used no network and performed no publication or other external
action. It cannot prove that another actor did not publish the candidate before or after the calculation.

## Human and machine output

Every stdout result is canonical JSON with:

- command and schema version;
- exact result or stable failure code;
- `networkAccessed: false` where applicable;
- an empty `externalActionsPerformed` list;
- factual blockers and one next action.

Human release summaries lead with “local release calculation,” identify caller-declared incompleteness, and state that
privacy, cadence, planned source identity, artifact and release-manifest bytes, owner authority, and release readiness
remain unverified. They never replace the JSON record and never label the candidate private, live, published, approved,
audited, safe, or release-ready.

## Limits and handoff

These files implement deterministic local evaluation and caller-declared release calculation only. They do not provide
authenticated network transport, TUF metadata rotation, package installation, rollback execution, authenticated release
history or time, evidence-file hashing for release plans, repository-visibility proof, owner authentication, Git tags,
Git commit/tree/tag resolution, earliest-public-exposure discovery, GitHub releases, public repository pushes, wallet
signatures, deployment, or website activation.

Before a public release, W5 still needs independently bound candidate and repository state, authenticated release
history and time, independently reviewed package bytes, two-host reproducibility, verified checksum and SBOM artifacts,
fresh-host and multi-agent evals, canary receipts, signed release metadata, stable/canary channel records, authenticated
owner release authority, resolved commit/tree/tag and artifact/manifest digests, verified GitHub `published_at` or an
earlier public-exposure timestamp, and the exact public action authorization and receipt. Keep caller declaration,
verified candidate privacy, public release, deployment, source verification, runtime matching, lifecycle verification,
provider indexing, and availability as separate states.
