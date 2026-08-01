## Change type

- [ ] Public GitHub PR Builder Beta application
- [ ] Existing model or release change
- [ ] Tests, documentation or tooling

Legacy model pull requests opened before beta activation keep their existing review path and contribution format. Do
not convert or relabel them with this template. New Builder Beta applications use the public builder repository plus
one closed six-file `submissions/**` record pull request.

## Summary

Describe the user outcome, the exact change and any known limitation.

## Public GitHub PR Builder Beta application

Complete this section only for a Builder Beta application. The complete project stays in the builder-controlled public
repository. This pull request contains only the small beta record and public evidence described in the
[beta guide](https://github.com/0xprogrammable/programmable/blob/main/docs/builder/PUBLIC_GITHUB_PR_BETA.md).

### Project and exact revision

- Project name:
- Plain-language summary:
- Canonical public GitHub repository URL:
- Immutable GitHub numeric repository id:
- Full commit SHA:
- Full Git tree SHA:
- Public check-evidence reference:
- Evidence digest:
- Builder GitHub identity:
- Public contact, if different:
- Project source license:
- Required third-party notices:

### Behavior and boundaries

- Why this project uses Uniswap v4:
- Pool assets and canonical-pool assumptions:
- Value-moving paths, fees, rounding, accounting and custody:
- Hook permissions, callbacks and return deltas:
- Privileged roles, upgrades, keepers, oracles or autonomous actions:
- External contracts, services and pinned dependencies:
- Router, hook data, partial-fill and indexing assumptions:
- Failure behavior, expected invariants and known limitations:
- Open architecture questions:

Write `None` when an item does not apply. Do not leave a material behavior implicit.

### Builder operations

Record the observed result or public evidence reference for each operation. The released tooling defines the exact
invocation; do not add invented flags or report a command that did not run.

`package` validates the local review package. `prepare-pr` performs the public GitHub revision binding and generates the
six central files; do not claim that `package` alone proved a public repository or pushed commit.

- `doctor`:
- `scaffold`, if this was a new project:
- `check`:
- `package`:
- `prepare-pr`:

### Builder confirmation

- [ ] The repository is public and the full commit under review is pushed and reachable.
- [ ] The repository numeric id, commit, tree and evidence all identify the same exact revision.
- [ ] The declared builder login matches the author of this pull request. I understand that this identity check does
      not by itself prove control of the linked source repository.
- [ ] This pull request contains only the small generated beta record, its public evidence and this description; the
      complete project remains in the public builder repository.
- [ ] Actual, planned, skipped, blocked and unavailable checks are reported as different states.
- [ ] Every value-moving path, fee, authority, custody rule, external trust assumption and known limitation is disclosed.
- [ ] I have the right to publish this project and its evidence under the stated licenses, and required notices are
      present.
- [ ] No private key, seed phrase, wallet file, credential, token, private URL, unrelated personal data, confidential
      material or non-public vulnerability is included.
- [ ] I understand that review applies only to the exact bound repository id, commit, tree and evidence.
- [ ] If the project changes, I will push a new commit in the same public repository, rerun `check`, `package` and
      `prepare-pr`, and update this same pull request without erasing the earlier review history.
- [ ] Immediately before merge, the latest central commit must pass a fresh trusted intake run that re-resolves every
      declared external source and evidence byte.
- [ ] I understand that this beta application and its GitHub state are not an audit, safety or rug-free claim, product
      approval, model acceptance, deployment, launch authorization, provider statement or Uniswap endorsement.

## Existing repository change checks

Complete the checks that apply when changing an existing model, release record, test, document or tool:

- [ ] `node scripts/verify-model-registry.mjs`
- [ ] `node scripts/verify-release-evidence.mjs`
- [ ] `forge fmt --check`
- [ ] `forge build`
- [ ] `FOUNDRY_PROFILE=ci forge test`
- [ ] Gas snapshot changes are intentional and explained.
- [ ] Deployment evidence is updated when an address or runtime changes.
- [ ] Skipped or inapplicable checks are named and explained.

## Reviewer record

Maintainers use GitHub's native comments, requested changes, reviews, commits and pull-request state as the beta audit
trail. A review conclusion must name the latest repository numeric id, commit, tree and evidence it actually covers.

- Architecture discussion or unresolved question:
- Objective finding, evidence and repair path:
- Superseded revision, if any:
- Latest exact revision reviewed:

An unfamiliar mechanic starts an architecture discussion. An objective finding names reproducible evidence, the
published rule or trust boundary, practical impact, a repair or missing-evidence path and the check to rerun. Do not use
a review result to imply an audit, product decision, deployment state, provider support or third-party endorsement.

## Security

Do not publish an unpatched vulnerability in this pull request, an issue or a public review comment. Follow
[`SECURITY.md`](https://github.com/0xprogrammable/programmable/blob/main/SECURITY.md) and use
[GitHub private vulnerability reporting](https://github.com/0xprogrammable/programmable/security/advisories/new).
