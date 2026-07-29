# Contributing

Programmable publishes independent Uniswap v4 launch models. Start with the relevant document under [`models/`](models/)
before changing a contract or proposing a new model.

Changes should be small, reviewable and covered by a test that fails before the fix.

## New launch models

Submit a complete model as a pull request. Do not open an issue containing only an idea and do not disclose
vulnerabilities publicly.

Read the [Hook Builder Program](BUILDER_PROGRAM.md) before starting. A model submission must include its contracts,
tests, security assumptions, known limitations, documentation, license declarations and builder beneficiary address.
The pull request template contains the complete checklist.

A pull request is a public, non-confidential submission. It does not guarantee acceptance, deployment or revenue. An
external builder participates in model revenue only after Programmable publishes an acceptance record for the exact
model version.

## Existing models

Bug fixes, test improvements and documentation corrections are welcome. Explain the affected behavior and keep changes
scoped to the relevant model.

Before opening a pull request:

```bash
./scripts/bootstrap-deps.sh
forge fmt --check
forge build
FOUNDRY_PROFILE=ci forge test
```

Changing source does not change a contract that is already deployed. A new model or contract revision needs its own
tests, security documentation, source verification and deployment record before it can be marked `Available` in
[`MODELS.md`](MODELS.md).

By submitting code, each contributor confirms that they have the right to submit it under the repository's
[MIT License](LICENSE). Preserve notices for compatible third-party code.

Use [`SECURITY.md`](SECURITY.md) for vulnerability reports instead of opening a public issue.
