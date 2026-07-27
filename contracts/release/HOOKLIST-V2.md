# Uniswap Hooklist submission checklist

Submit only after the exact V2 hook address is live on Ethereum, its source is verified on Etherscan and the complete
canary lifecycle has passed.

Suggested issue fields:

- Chain: Ethereum
- Hook address: the deployed `EthCreatorFeeHookV2`
- Name: `Programmable Classic Fee Hook`
- Description: `A non-upgradeable Uniswap v4 custom-accounting hook that charges the same immutable ETH-denominated fee on buys and sells, splits the selected total between the token creator and Programmable, and exposes zero transfer tax plus explicit fee events.`
- Deployer: the verified deployment wallet
- Audit URL: empty unless a real independent audit is completed

Expected Hooklist classification:

```json
{
  "flags": {
    "beforeInitialize": true,
    "afterInitialize": false,
    "beforeAddLiquidity": false,
    "afterAddLiquidity": false,
    "beforeRemoveLiquidity": false,
    "afterRemoveLiquidity": false,
    "beforeSwap": true,
    "afterSwap": true,
    "beforeDonate": false,
    "afterDonate": false,
    "beforeSwapReturnsDelta": true,
    "afterSwapReturnsDelta": true,
    "afterAddLiquidityReturnsDelta": false,
    "afterRemoveLiquidityReturnsDelta": false
  },
  "properties": {
    "dynamicFee": false,
    "upgradeable": false,
    "requiresCustomSwapData": false,
    "vanillaSwap": false,
    "swapAccess": "none"
  }
}
```

The official Hooklist is a registry, not an approval, audit or routing allowlist. Uniswap routing support must be requested
separately and claimed only after confirmation.
