# Adaptive

**Status:** In development<br>
**Network:** Ethereum

Adaptive is a launch model with an immutable swap-fee curve selected when the token is created. The active fee follows
published onchain value bands without an administrator changing the curve after launch.

Adaptive is not available for launch yet.

## Intended behavior

- The creator selects one published fee curve during launch.
- The selected curve cannot be changed after the pool is initialized.
- Each value band and its total swap fee can be read before a trade.
- Creator and Programmable fees remain inside the displayed total fee.
- The token itself has no transfer tax.

The exact value calculation, fee bounds and curve set will be published with the contracts.

## Security focus

Adaptive adds price-dependent accounting to the hook. Its test suite must cover:

- trades around every curve boundary;
- manipulation of the pool state used to select a fee;
- exact-input and exact-output swaps in both directions;
- extreme ticks, rounding and partial fills;
- claim accounting for creator and Programmable fees;
- reentrancy and unauthorized pool registration; and
- agreement between the interface quote and the amount settled onchain.

## Release requirements

Adaptive will be marked `Available` after this repository contains:

1. the immutable curve specification and fee bounds;
2. the exact hook and launcher sources;
3. unit, integration, fuzz, invariant and regression tests;
4. a model-specific security document;
5. verified Ethereum contracts and runtime code hashes; and
6. an interface that reads the fee from the same onchain rules used during settlement.

## References

- [Uniswap v4 dynamic fees](https://docs.uniswap.org/contracts/v4/concepts/dynamic-fees)
- [OpenZeppelin BaseDynamicFee](https://docs.openzeppelin.com/uniswap-hooks/api/fee#BaseDynamicFee)
- [OpenZeppelin BaseOverrideFee](https://docs.openzeppelin.com/uniswap-hooks/api/fee#BaseOverrideFee)
