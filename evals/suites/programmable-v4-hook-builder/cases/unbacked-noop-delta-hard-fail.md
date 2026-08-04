# A custom curve shortcut

Review this intended `beforeSwap` behavior:

```solidity
function beforeSwap(
    address,
    PoolKey calldata,
    IPoolManager.SwapParams calldata params,
    bytes calldata
) external returns (bytes4, BeforeSwapDelta, uint24) {
    int128 amount = int128(params.amountSpecified);
    return (this.beforeSwap.selector, toBeforeSwapDelta(amount, 0), 0);
}
```

There are no reserves, token transfers, `take`, `settle`, claims, or other accounting paths. The author says the return
value itself proves that the hook supplied the output. Can this pass as a custom curve?
