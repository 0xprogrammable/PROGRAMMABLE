# Architecture

Programmable is organized around independent launch models. Each model defines its own pool rules, hook permissions,
fee accounting, liquidity custody and security properties.

## Models

- [Classic](models/classic/README.md) is the available fixed-supply launch model.
- [Adaptive](models/adaptive/README.md) is the fee-curve model in development.

## Release structure

Each available model has:

- model documentation under `models/`;
- exact contract source under `src/`;
- model-specific tests under `test/`;
- machine-readable parameters under `spec/`; and
- deployment evidence under `deployments/`.

The deployed Solidity files keep their original contract names and paths. This preserves a direct match between the
repository, verified source and immutable Ethereum bytecode.

Shared upstream dependencies are pinned to exact commits by
[`scripts/bootstrap-deps.sh`](scripts/bootstrap-deps.sh).
