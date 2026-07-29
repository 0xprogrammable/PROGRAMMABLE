<p align="center">
  <img
    src="assets/programmable-repository-cover.jpg"
    alt="Programmable mark above a field of watercolor flowers"
    width="100%"
  />
</p>

<h1 align="center">Programmable</h1>

<p align="center">Open source launch models for Uniswap v4 on Ethereum.</p>

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

Programmable is a launchpad for tokens whose market behavior lives in Uniswap v4. Creators choose a launch model, set
the token details and launch without writing Solidity.

This repository contains the contracts behind every published model. Each available release includes its exact source,
tests, security documentation and Ethereum deployment record.

Independent builders can submit complete launch models through the
[Hook Builder Program](BUILDER_PROGRAM.md). Submissions are reviewed before any model is accepted or released.

## Launch models

| Model | Pool behavior | Status |
| --- | --- | --- |
| [Classic](models/classic/README.md) | Fixed supply, locked one-sided liquidity and creator fees paid in ETH | Available |
| [Adaptive](models/adaptive/README.md) | An immutable swap-fee curve linked to onchain value | In development |
| [Deep](models/deep/README.md) | Creator fees build locked main-pool liquidity to a fixed target before beneficiary routing begins | In development |

[`MODELS.md`](MODELS.md) contains the full catalog and release requirements.

## What is published

Every available model includes:

- the hook and supporting contract sources;
- unit, integration, fuzz and invariant tests;
- compiler and dependency versions;
- security assumptions and known limitations; and
- Ethereum addresses, deployment transactions and runtime code hashes.

Classic is live on Ethereum. Its [model documentation](models/classic/README.md) links each deployed contract to
Etherscan. Machine-readable deployment evidence is in
[`deployments/ethereum.json`](deployments/ethereum.json).

## Repository

```text
models/              Behavior, economics and security notes for each launch model
src/                 Exact Solidity sources for deployed contracts
test/                Unit, integration, fuzz, invariant and regression tests
deployments/         Ethereum addresses, transactions and runtime code hashes
spec/                Machine-readable contract parameters
scripts/             Reproducible dependency bootstrap
BUILDER_PROGRAM.md    External model submission and participation terms
SECURITY.md           Repository security policy and current contract status
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

The contracts use Solidity `0.8.26`, Cancun opcodes, optimizer runs set to `1,000`, and disabled CBOR metadata. See
[`foundry.toml`](foundry.toml) for the complete compiler configuration.

## Security

Classic has unit, integration, fuzz, invariant and regression coverage. It has not received an independent
smart-contract audit or public security contest. Read [`SECURITY.md`](SECURITY.md) before integrating.

Report vulnerabilities through
[GitHub private vulnerability reporting](https://github.com/0xprogrammable/programmable/security/advisories/new).

## License

Contract source is available under the [MIT License](LICENSE). The Programmable name, mark and artwork are excluded;
see [`assets/README.md`](assets/README.md).
