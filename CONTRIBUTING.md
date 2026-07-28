# Contributing

This repository contains the available Programmable launch models and their public deployment evidence. Classic is
currently the only available model. Proposed changes should be small, reviewable and backed by a test that fails
before the change.

Before opening a pull request:

```bash
./scripts/bootstrap-deps.sh
forge fmt --check
forge build
FOUNDRY_PROFILE=ci forge test
```

Contract changes do not alter an existing deployment. A new model or contract revision requires a separate release,
source verification, model-specific security documentation and updated deployment evidence before it is marked
`Available` in [`MODELS.md`](MODELS.md).

For security vulnerabilities, follow [`SECURITY.md`](SECURITY.md) instead of opening a public issue.
