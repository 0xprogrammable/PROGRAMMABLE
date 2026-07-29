# Model library

A launch model defines how a token is created, how its Uniswap v4 pool behaves, how liquidity is held and how fees are
accounted for. [`models/registry.json`](models/registry.json) is the canonical machine-readable status record.

## Status

| Model | Lifecycle | Ethereum release | Documentation |
| --- | --- | --- | --- |
| Classic | **Available** | [`classic-v2`](releases/classic-v2/RELEASE.md) | [Open model](models/classic/README.md) |
| Deep | **Design** | None | [Open design](models/deep/README.md) |

`Available` means the exact source, parameters, deployment, runtime hashes and security status are public. It does not
mean that a model has received an independent audit.

## Classic

<p>
  <a href="models/classic/README.md">
    <img
      src="assets/programmable-model-classic.jpg"
      alt="A bright watercolor wildflower field representing the Classic launch model"
      width="100%"
    />
  </a>
</p>

**Available on Ethereum.** Classic creates a fixed-supply token, initializes its native ETH pool, locks the complete
launch position and executes the creator's initial buy in one transaction. Its current launch configuration uses a
`1.00%` disclosed ETH-denominated swap fee.

[Behavior and fees](models/classic/README.md) ·
[Release record](releases/classic-v2/RELEASE.md) ·
[Ethereum deployment](deployments/ethereum.json) ·
[Security properties](docs/security/CLASSIC_PROPERTIES.md)

## Deep

<p>
  <a href="models/deep/README.md">
    <img
      src="assets/programmable-model-deep.jpg"
      alt="A dark flower-lined pool representing the Deep launch model"
      width="100%"
    />
  </a>
</p>

**Design only.** Deep proposes directing the creator fee share into add-only locked liquidity until an immutable target
is reached. It has no deployed contracts and is not available for launch.

[Design and open release gates](models/deep/README.md)

## Adding a model

New models start at `design`. They become `candidate` only after source, tests, fixed parameters and security properties
exist. They become `available` only after the exact Ethereum deployment and runtime evidence are published.

[Read the release process](RELEASING.md) ·
[Create a model record](templates/model/README.md.template) ·
[Submit an external model](BUILDER_PROGRAM.md)
