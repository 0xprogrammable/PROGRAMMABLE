# Contributing

Programmable publishes independent Uniswap v4 launch models. Start with the submission workflow below for a new model,
or the relevant document under [`models/`](models/) before changing an existing one.

Changes should be small, reviewable and covered by a test that fails before the fix.
Participation is governed by [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).

## Writing and evidence

Write direct, factual English. State what the code does, what it assumes and what was actually tested. Keep planned,
completed and externally verified work separate. Do not include prompt transcripts, internal task notes, filler or
marketing claims in public files.

Words such as `safe`, `audited`, `verified`, `approved` and `available` require evidence for the exact source,
configuration and release being described. Prefer the narrower fact when only a local test, simulation or source match
exists.

## New Uniswap v4 projects

Submit a new model as a proposal or prototype pull request. Use a draft pull request while architecture or
implementation remains unresolved. Contributors cannot assign candidate status. Do not disclose vulnerabilities
publicly.

Read the [Programmable v4 Builder Program](BUILDER_PROGRAM.md) before starting. The
[builder skill](skills/programmable-v4-hook-builder/SKILL.md) is the recommended agent workflow; its schemas and
deterministic validators define the intake format for agents and manual contributors alike.

Keep the complete project in a builder-controlled public GitHub repository. From that repository, use the five stable
operations exposed by the installed skill:

```bash
node "$SKILL_ROOT/scripts/cli.mjs" doctor --repository-root "$REPOSITORY_ROOT"
node "$SKILL_ROOT/scripts/cli.mjs" scaffold MODEL_ID --repository-root "$REPOSITORY_ROOT"
node "$SKILL_ROOT/scripts/cli.mjs" check path/to/submission.json --repository-root "$REPOSITORY_ROOT"
node "$SKILL_ROOT/scripts/cli.mjs" package path/to/submission-directory --repository-root "$REPOSITORY_ROOT"
node "$SKILL_ROOT/scripts/cli.mjs" prepare-pr path/to/submission-directory --repository-root "$REPOSITORY_ROOT"
```

Use `scaffold` only for a new project. `package` validates the local review package and reports deterministic hashes;
`prepare-pr` resolves the clean pushed public revision and outputs the six-file central application package. A
`PROTOTYPE_READY` report means only that deterministic checks found no structural blocker.

A proposal needs a compatibility record, value flow, threat model, public builder identity, one contact handle and
license declaration. It does not need Solidity. A prototype adds an implementation of the proposed mechanism, pinned dependencies, focused
tests and factual evidence. Maintainers may select an exact reviewed prototype commit as a candidate. The pull request
template contains the stage-specific checklist.

To submit:

1. Commit and push the exact project revision to the builder-controlled public GitHub repository.
2. Run `check`, `package` and `prepare-pr` against that clean revision.
3. Fork [`0xprogrammable/programmable`](https://github.com/0xprogrammable/programmable) and branch from `main`.
4. Add only the generated `application.json`, `PROPOSAL.md`, `TEST_PLAN.md`, `THREAT_MODEL.md`,
   `compatibility-report.json` and `evidence-index.json` under `submissions/<application-id>/`.
5. Push the central-record branch and open one draft pull request against `0xprogrammable/programmable:main`.
6. Record the exact checks run, observed results, limitations and open decisions in the pull request.

The builder project branch and the central-record branch are different branches in different repositories.
`prepare-pr` anonymously resolves the builder login to GitHub's immutable decimal user id. The trusted pull-request
check binds that id and the current display login to GitHub's authenticated pull-request author. A later login rename
keeps the same application identity; a different numeric user id cannot take over an application revision. This author
binding does not by itself prove control of the linked source repository. Immediately before merge, rerun `prepare-pr`
from the latest clean pushed builder revision and let the trusted intake check resolve every declared source and
evidence byte again.

Do not add the submission to `models/registry.json`, create an acceptance record, include credentials or run a
submitter-provided script with wallet or repository secrets. Repository CI treats submission files as untrusted data.
Intake checks must use trusted validator code from the base repository. Contributor code that needs execution is
reviewed later in an isolated environment without credentials, signing access or write permission.

A generated package, compatibility result or passing check is not an audit, acceptance, candidate selection, deployment,
routing approval or proof of availability. A pull request is public and non-confidential and does not guarantee review,
acceptance, deployment, volume or revenue. An acceptance record may define a builder allocation for one exact model
version; revenue exists only when a deployed contract implements that allocation and activity generates the relevant
fees.

## Existing models

Bug fixes, test improvements and documentation corrections are welcome. Explain the affected behavior and keep changes
scoped to the relevant model.

For a model submission, run the validator appropriate to its stage as shown above. For a release-record change or an
existing model, run the repository checks that apply to the change:

```bash
./scripts/bootstrap-deps.sh
node scripts/verify-model-registry.mjs
node scripts/verify-release-evidence.mjs
forge fmt --check
forge build --sizes
FOUNDRY_PROFILE=ci forge test
forge snapshot --fuzz-seed 0x70726f6772616d6d61626c65 --check .gas-snapshot
```

Changing source does not change a contract that is already deployed. A new model or contract revision needs its own
tests, security documentation, source verification and deployment record before it can be marked `Available` in
[`MODELS.md`](MODELS.md).

By submitting code, each contributor confirms that they have the right to submit it under the repository's
[MIT License](LICENSE). Preserve notices for compatible third-party code.

Use [`SECURITY.md`](SECURITY.md) for vulnerability reports instead of opening a public issue.
