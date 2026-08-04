# Public GitHub PR Builder Beta records

This directory is the public intake area for the **Public GitHub PR Builder Beta**. It contains small application
records and public check evidence. The complete builder project remains in the builder-controlled public GitHub
repository named by each record.

Read the [Programmable v4 Builder Program](../BUILDER_PROGRAM.md) and the complete
[Public GitHub PR Builder Beta guide](../docs/builder/PUBLIC_GITHUB_PR_BETA.md) before opening a pull request.

Legacy model pull requests opened before beta activation—including #35, #43 and #44 at activation—keep their existing
review path and contribution format. New applications use the public builder repository plus a small `submissions/**`
manifest pull request. Do not retroactively rewrite or relabel an existing legacy pull request.

## Exact-revision contract

Each beta record binds one review target:

- immutable decimal GitHub builder user id plus current display login and public contact;
- canonical public GitHub repository URL;
- immutable GitHub numeric repository id;
- full commit SHA;
- full Git tree SHA; and
- public check-evidence reference and digest.

Repository owner/name, branch and tag are display information only. A record cannot bind a private repository, local
path, ZIP, pasted source or mutable branch head.

The builder user id is resolved anonymously by `prepare-pr`, rechecked against GitHub's authenticated pull-request
author, and preserved across application revisions. The login may change after a GitHub rename because it is display
data. This author binding does not prove control of the linked source repository.

Use `package` to validate the local review package and report deterministic hashes. Use `prepare-pr` to resolve the
clean pushed public revision and generate the central record and evidence. Do not invent identifiers, hand-edit
generated digests or claim a check that did not run. The exact invocation is defined by the released tooling; this
document does not publish unreviewed flags.

Every central directory contains exactly `application.json`, `PROPOSAL.md`, `TEST_PLAN.md`, `THREAT_MODEL.md`,
`compatibility-report.json` and `evidence-index.json`. Its `applicationId` is the stable lower-case project slug and
must equal the directory name. The pull-request number is the public review thread, not the manifest id.

## Keep the pull request small

A beta application pull request should contain only the generated beta record, its public evidence and a completed
pull-request description. Do not copy the full builder project into this repository and do not edit the model registry,
acceptance records, deployment records, provider data, production configuration or existing models.

One pull request represents one public project. When the builder changes the project:

1. push a new commit in the same public project repository;
2. rerun `check`, `package` and `prepare-pr`;
3. replace only the exact prior generated six-file directory and update the same Programmable pull request; and
4. explain which finding or architecture question the new revision addresses.

The previous commit and review stay in GitHub history. Review conclusions apply only to the exact repository id,
commit, tree and evidence they name.

## Review states

GitHub is the beta status and audit trail:

| GitHub state | Meaning |
| --- | --- |
| Draft | The builder is preparing the application or discussing architecture. |
| Ready for review | The latest exact revision is queued. |
| Changes requested | An objective finding needs repair or more evidence. |
| Merged beta record | Review of the bound beta record is complete; no product or launch state is implied. |
| Closed | The application stopped without a merged beta record; read the closing reason and next step. |

An unknown mechanic starts an architecture discussion. It is not rejected for lacking a known category. An objective
finding names the exact evidence, applicable rule, impact, repair path and check to rerun.

## Public data and security

Everything in this directory and its pull-request history is public and non-confidential. Include only the GitHub
identity and public contact information you intend to publish.

Never include private keys, seed phrases, wallet files, credentials, tokens, API keys, private RPC or database URLs,
environment files, confidential third-party material, unrelated personal information or an unpatched vulnerability.

Report vulnerabilities through
[GitHub private vulnerability reporting](https://github.com/0xprogrammable/programmable/security/advisories/new) and
follow [`SECURITY.md`](../SECURITY.md). Do not publish exploit details in an application pull request, issue or review
comment.

## Boundary

A record in this directory—draft, open, reviewed, merged or closed—is not an audit, safety or rug-free claim, model
acceptance, deployment, launch authorization, provider statement or Uniswap endorsement. The beta uses no private
repository access, wallet claim, GitHub App installation or connected-service application identity.
