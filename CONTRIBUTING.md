# Contributing

Programmable publishes independent Uniswap v4 launch models. Start with the relevant document under [`models/`](models/)
before changing a contract or proposing a new model.

Changes should be small, reviewable and covered by a test that fails before the fix.

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

Use [`SECURITY.md`](SECURITY.md) for vulnerability reports instead of opening a public issue.
