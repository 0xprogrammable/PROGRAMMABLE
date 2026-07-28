# Launch models

A launch model defines how a token is created, how its Uniswap v4 pool behaves, how liquidity is held and how fees are
accounted for.

| Model | Status | Documentation |
| --- | --- | --- |
| Classic | Available | [Read the Classic documentation](models/classic/README.md) |
| Adaptive | In development | [Read the Adaptive design](models/adaptive/README.md) |

## Classic

Classic launches a fixed-supply token against native ETH. The complete supply enters a locked, one-sided Uniswap v4
position, and a disclosed fee is collected on the ETH side of swaps.

[Behavior, fees, contracts and deployment evidence](models/classic/README.md)

## Adaptive

Adaptive introduces an immutable fee curve selected at launch. The displayed swap fee changes automatically as the
pool moves through published onchain value bands.

[Design and release requirements](models/adaptive/README.md)

## Release requirements

A model is marked `Available` when the repository contains:

1. the exact hook and supporting contract sources;
2. tests for permissions, accounting and model-specific invariants;
3. compiler and dependency versions;
4. Ethereum addresses, deployment transactions and runtime code hashes; and
5. its security status, trust assumptions and known limitations.

Open source code makes contract behavior inspectable. It does not replace independent review.
