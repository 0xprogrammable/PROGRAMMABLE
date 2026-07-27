# Contributing

This repository mirrors the live Classic V2 contract surface. Changes should be small, reviewable and backed by a
test that fails before the change.

Before opening a pull request:

```bash
./scripts/bootstrap-deps.sh
forge fmt --check
forge build
FOUNDRY_PROFILE=ci forge test
```

Contract changes do not alter the deployed Classic V2 contracts. A new deployment requires a separate release,
source verification and updated deployment evidence.

For security vulnerabilities, follow [`SECURITY.md`](SECURITY.md) instead of opening a public issue.
