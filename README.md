<p align="center">
  <img
    src="assets/programmable-repository-cover-animated.gif"
    alt="Programmable mark above a field of watercolor flowers"
    width="100%"
  />
</p>

<h1 align="center">Programmable</h1>

<p align="center">Launch tokens that work the way you imagine.</p>

<p align="center">
  <a href="https://programmable.family">Launch</a> ·
  <a href="MODELS.md">Models</a> ·
  <a href="BUILDER_PROGRAM.md">Build a model</a> ·
  <a href="deployments/ethereum.json">Ethereum</a> ·
  <a href="SECURITY.md">Security</a> ·
  <a href="https://x.com/0xProgrammable">X</a>
</p>

<p align="center">
  <a href="https://github.com/0xprogrammable/programmable/actions/workflows/verify.yml">
    <img
      src="https://github.com/0xprogrammable/programmable/actions/workflows/verify.yml/badge.svg"
      alt="Repository checks"
    />
  </a>
</p>

Programmable is an interface and open launch-model infrastructure for Uniswap v4. Creators choose a published model,
set the token details and launch from their wallet without writing Solidity.

Models may be built by Programmable or independent builders. This repository is the public record behind them. It
contains the contracts, tests, security assumptions and deployment evidence for every release available through the
interface.

## How it works

A launch model defines how a token is created, how its Uniswap v4 pool is initialized, how fees are accounted for, how
liquidity is held and which behaviors belong in the hook. The interface turns those rules into a clear setup flow.

Each model is versioned independently. A release keeps its own source, parameters, tests, security notes and Ethereum
deployment record, so users and integrators can inspect the exact implementation behind a launch.

## Model library

[`MODELS.md`](MODELS.md) is the canonical catalog. Detailed documentation lives under [`models/`](models/), with links
to the exact contracts, tests, specifications and deployment evidence for each release.

Each model has its own directory and release record. Browse the catalog to see what is available and what is still in
development.

## Build a model

Programmable is not limited to launch models built by its maintainers. Independent builders can submit complete,
open-source Uniswap v4 launch models as pull requests.

A submission includes the contracts, tests, documentation, security assumptions and builder beneficiary address. A
pull request does not guarantee acceptance or deployment. Accepted hook creators receive 0.10% of the trading volume
from every token launched with that exact model version.

[Read the Hook Builder Program](BUILDER_PROGRAM.md)

## Release standard

A model is marked `Available` only when the repository contains:

1. the exact hook and supporting contract sources;
2. unit, integration, fuzz and invariant coverage where applicable;
3. fixed compiler and dependency versions;
4. security assumptions and known limitations; and
5. Ethereum addresses, deployment transactions, source verification and runtime code hashes.

Open source publication makes behavior inspectable. It is not a security guarantee.

## Repository

```text
models/              Model behavior, economics, security notes and acceptance records
src/                 Exact Solidity sources
test/                Unit, integration, fuzz, invariant and regression tests
deployments/         Ethereum addresses, transactions and runtime code hashes
spec/                Machine-readable release parameters
scripts/             Reproducible dependency bootstrap
ARCHITECTURE.md       Repository and release structure
BUILDER_PROGRAM.md    External model submission and participation terms
SECURITY.md           Security policy and current contract status
```

Deployed Solidity sources remain at their original paths so published verification records stay reproducible.

## Build and test

The bootstrap script checks out every upstream dependency at a fixed commit.

```bash
./scripts/bootstrap-deps.sh
forge fmt --check
forge build
FOUNDRY_PROFILE=ci forge test
```

Current compiler settings are recorded in [`foundry.toml`](foundry.toml). Model-specific parameters and dependency
versions are recorded under [`spec/`](spec/).

## Security

Security status is documented per model. The currently available contracts have unit, integration, fuzz, invariant and
regression coverage, but have not received an independent smart-contract audit or public security contest. Read
[`SECURITY.md`](SECURITY.md) and the relevant model documentation before integrating.

Report vulnerabilities through
[GitHub private vulnerability reporting](https://github.com/0xprogrammable/programmable/security/advisories/new).

## License

Contract source is available under the [MIT License](LICENSE). The Programmable name, mark and artwork are excluded;
see [`assets/README.md`](assets/README.md).
