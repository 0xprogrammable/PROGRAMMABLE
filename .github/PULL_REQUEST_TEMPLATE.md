## Submission type

- [ ] New launch model
- [ ] Existing model change
- [ ] Tests, documentation or tooling

## Change

Describe the behavior, the user it serves and why it belongs in Programmable.

For a new launch model:

- Model name:
- Builder GitHub identity:
- Builder beneficiary address:
- Source paths:
- Model documentation:

## Model behavior

For a new model or contract change, describe:

- pool shape and supported assets;
- hook permissions and return deltas;
- fee paths, rounding and accounting;
- external calls and dependencies;
- privileged roles, upgradeability or autonomous actions; and
- expected invariants and failure modes.

## Verification

- [ ] `node scripts/verify-model-registry.mjs`
- [ ] `node scripts/verify-release-evidence.mjs`
- [ ] `forge fmt --check`
- [ ] `forge build`
- [ ] `FOUNDRY_PROFILE=ci forge test`
- [ ] Gas snapshot changes are intentional and explained
- [ ] Unit and integration coverage is included
- [ ] Fuzz and invariant coverage is included where applicable
- [ ] Compiler and dependency versions are fixed
- [ ] Model documentation states trust assumptions and known limitations
- [ ] Deployment evidence is updated when addresses or runtime code change

## Security

List any new hook permissions, accounting paths, external calls or trust assumptions. Write `None` when the change
does not affect them.

Do not include an undisclosed vulnerability in this pull request. Follow
[`SECURITY.md`](https://github.com/0xprogrammable/programmable/blob/main/SECURITY.md).

## Submission terms

For a new launch model:

- [ ] I have read the [Hook Builder Program](https://github.com/0xprogrammable/programmable/blob/main/BUILDER_PROGRAM.md)
- [ ] I used the model template or provided equivalent registry, security and test-plan records
- [ ] I have the right to submit this code under the repository's MIT License
- [ ] Required notices for third-party code are included
- [ ] I understand that a pull request does not guarantee acceptance, deployment, volume or revenue
- [ ] I understand that any builder allocation applies only after an acceptance record identifies the exact model version, commit and beneficiary
