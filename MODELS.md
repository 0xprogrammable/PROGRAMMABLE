# Launch models

Programmable turns Uniswap v4 pool behavior into launch flows that do not require a creator to write or deploy
contracts.

Only models marked `Available` can be launched today.

## Available

### Classic

A fixed-supply token launches against native ETH with its complete supply placed into a permanently locked, one-sided
Uniswap v4 position. The hook accounts for a disclosed fee on the ETH side of swaps. Creator and Programmable claims
are separate.

The current Ethereum contract release is V2. Its exact addresses and runtime hashes are in
[`deployments/ethereum.json`](deployments/ethereum.json).

## In development

### Protected

Protected adds sandwich protection to the public launch flow. It is being developed around OpenZeppelin's
[`AntiSandwichHook`](https://docs.openzeppelin.com/uniswap-hooks/api/general#AntiSandwichHook). Its contracts, fee
accounting and tests will be published before release.

## Research

### Permissioned

Issuer-controlled access to swaps and liquidity for tokenized funds, RWAs and other restricted assets. The reference
architecture is Uniswap's
[`Permissioned Pools`](https://developers.uniswap.org/docs/protocols/v4/permissioned-pools/overview), including its
adapter, hook and permissioned position manager.

### Adaptive Fee

A pool whose fee can respond to volatility or other declared market conditions. The current reference components are
OpenZeppelin's
[`BaseDynamicFee`](https://docs.openzeppelin.com/uniswap-hooks/api/fee#BaseDynamicFee) and
[`BaseOverrideFee`](https://docs.openzeppelin.com/uniswap-hooks/api/fee#BaseOverrideFee).

### Limit Orders

Resting onchain orders that fill as the pool crosses a selected price. The current reference component is
OpenZeppelin's [`LimitOrderHook`](https://docs.openzeppelin.com/uniswap-hooks/api/general#LimitOrderHook).

### Yield Reserve

Pool reserves that can use ERC-4626 vaults while remaining available to the pool. The current reference architecture
is Uniswap's [`DualPool`](https://developers.uniswap.org/docs/protocols/v4-hooks/dualpool/overview).

## Release standard

A model moves to `Available` only when the repository contains:

1. the exact hook and supporting contract sources;
2. tests for permissions, accounting and model-specific invariants;
3. compiler and dependency versions;
4. Ethereum addresses, deployment transactions and runtime code hashes; and
5. an explicit security status and known limitations.

Open source code makes behavior inspectable. It does not replace independent review or make a contract risk free.
