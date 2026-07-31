# Model library

A launch model defines how a token is created, how its Uniswap v4 pool behaves, how liquidity is held and how fees are
accounted for. [`models/registry.json`](models/registry.json) is the canonical machine-readable status record.

## Status

| Model | Lifecycle | Ethereum release | Documentation |
| --- | --- | --- | --- |
| Classic | **Available** | [`classic-v3`](releases/classic-v3/RELEASE.md) | [Open model](models/classic/README.md) |
| Stock-Paired | **Candidate** | Deployed candidate | [Open candidate](models/stock-paired/README.md) |
| Deep | **Design** | None | [Open design](models/deep/README.md) |
| Shards | **Design** | None | [Open design](models/shards/README.md) |

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

**Available on Ethereum.** Classic creates a fixed-supply token, initializes its native ETH pool, permanently locks the
complete launch position and executes the creator's initial buy in one transaction. Creators select separate immutable
buy and sell fees, direct native ETH rewards to as many as five wallets and may lock or vest the initial buy.

[Behavior and fees](models/classic/README.md) ·
[Release record](releases/classic-v3/RELEASE.md) ·
[Ethereum deployment](deployments/ethereum.json) ·
[Security properties](docs/security/CLASSIC_PROPERTIES.md)

## Stock-Paired

<p>
  <a href="models/stock-paired/README.md">
    <img
      src="assets/programmable-model-stock-paired.webp"
      alt="A watercolor flower arch reflected in a quiet pool representing the Stock-Paired launch model"
      width="100%"
    />
  </a>
</p>

**Production interface active. Repository release record pending.** Stock-Paired creates a fixed-supply token with one
reviewed Ondo tokenized stock or ETF asset as the quote side of a permanently locked Uniswap v4 pool. Its 1.00% swap
fee is accounted in the selected quote asset: 0.90% for the creator configuration and 0.10% for Programmable.

The launched token is not a share and has no claim on the selected quote asset. The deployed release passed its
Mainnet lifecycle canary and production interface checks. Its public registry remains `candidate` until the
version-bound source and release records are on the default branch, the release verifier records the mixed explorer
state and the routing review is complete. Sourcify reports exact matches for all seven contracts; Etherscan shows one
Exact Match and six Similar Matches.

[Behavior, assets and deployment state](models/stock-paired/README.md) ·
[Security properties](docs/security/STOCK_PAIRED_PROPERTIES.md)

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

## Shards

**Design only.** Shards proposes a single-sided bonding-curve market for a fixed 10,000-piece on-chain-art NFT
collection. Each launch deploys its own hook, token, NFT contract and renderer; the whole supply is locked into a
permanent Uniswap v4 position with no withdrawal path, and art is regenerated on every acquisition from the pool.
Its 1.00% native-ETH swap fee is split 0.80% to collection holders, 0.10% to the hook builder and 0.10% to
Programmable. It has no deployed contracts and is not available for launch.

[Design and open release gates](models/shards/README.md) ·
[Security properties](models/shards/SECURITY.md) ·
[Fixed parameters](spec/shards-v1.json)

## Adding a model

New models start at `design`. They become `candidate` only after source, tests, fixed parameters and security properties
exist. They become `available` only after the exact Ethereum deployment, runtime evidence and public activation checks
are published.

[Read the release process](RELEASING.md) ·
[Create a model record](templates/model/README.md.template) ·
[Submit an external model](BUILDER_PROGRAM.md)
