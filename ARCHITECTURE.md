# Architecture

Programmable is a registry of independent Uniswap v4 launch models. Each model owns its pool rules, hook permissions,
fee accounting, liquidity custody, tests and release history.

## System boundary

```mermaid
flowchart TB
    subgraph interface["Programmable interface"]
        selection["Model selection"]
        setup["Token and model configuration"]
        transaction["Wallet transaction"]
    end

    subgraph release["Versioned model release"]
        launcher["Launcher"]
        hook["Uniswap v4 hook"]
        custody["Liquidity custody"]
        accounting["Fee accounting"]
    end

    subgraph upstream["Pinned external contracts"]
        poolManager["Uniswap v4 PoolManager"]
        positionManager["PositionManager"]
        tokenFactory["UERC20 factory"]
    end

    selection --> setup --> transaction --> launcher
    launcher --> hook
    launcher --> custody
    hook --> accounting
    launcher --> poolManager
    launcher --> positionManager
    launcher --> tokenFactory
```

The interface is not the source of contract behavior. It selects a published model release and prepares a transaction
for that release. A frontend update cannot change contracts that have already been deployed.

## Records

```mermaid
flowchart LR
    registry["models/registry.json"] --> model["models/&lt;id&gt;/model.json"]
    model --> source["src/"]
    model --> specification["spec/"]
    model --> releaseManifest["releases/"]
    releaseManifest --> deployment["deployments/"]
    releaseManifest --> tests["test/"]
    releaseManifest --> security["security record"]
```

| Layer | Responsibility |
| --- | --- |
| Registry | Name, lifecycle status and canonical document for every model |
| Model manifest | Current release, network, contract identities and review state |
| Specification | Fixed compiler, dependency and economic parameters |
| Release manifest | Evidence bound to one model version |
| Deployment record | Addresses, transactions, runtime hashes and explorer verification |
| Security record | Permissions, invariants, trust assumptions and known limitations |

README files explain these records. They do not override the JSON manifests.

## Contract versioning

Published contracts are immutable. A material change to source, accounting, permissions, custody, parameters or
beneficiaries creates a new technical release. Multiple releases may exist for one public model name.

Deployed Solidity files keep their original contract names and paths. This preserves a direct match between the
repository, verified explorer source and Ethereum bytecode.

## Dependency boundary

Shared upstream dependencies are checked out at exact commits by
[`scripts/bootstrap-deps.sh`](scripts/bootstrap-deps.sh). Compiler and EVM settings are fixed in
[`foundry.toml`](foundry.toml) and repeated in each available release manifest.

External Uniswap and UERC20 contracts remain separate trust assumptions. Repository tests do not make those systems
part of Programmable's administrative control.

## Release and operations

The lifecycle gate is defined in [`RELEASING.md`](RELEASING.md). Automated evidence and incident handling are documented
in [`docs/OPERATIONS.md`](docs/OPERATIONS.md).
