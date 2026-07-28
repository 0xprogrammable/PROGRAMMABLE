# Launch models

Programmable turns Uniswap v4 pool behavior into launch flows that do not require a creator to write or deploy
contracts.

Only models marked `Available` can be launched today.

## Available

### Classic

A fixed-supply token launches against native ETH with its complete supply placed into a permanently locked, one-sided
Uniswap v4 position. The hook accounts for a disclosed fee on the ETH side of swaps. Creator and Programmable claims
are separate.

Its exact Ethereum addresses and runtime hashes are in
[`deployments/ethereum.json`](deployments/ethereum.json).

## In development

### Adaptive

Adaptive lets the creator define an immutable swap-fee curve linked to the token's ETH-denominated onchain value.
Its contracts, tests, security assumptions and Ethereum deployment record will be published before release.

## Release standard

A model moves to `Available` only when the repository contains:

1. the exact hook and supporting contract sources;
2. tests for permissions, accounting and model-specific invariants;
3. compiler and dependency versions;
4. Ethereum addresses, deployment transactions and runtime code hashes; and
5. an explicit security status and known limitations.

Open source code makes behavior inspectable. It does not replace independent review or make a contract risk free.
