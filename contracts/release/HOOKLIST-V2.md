# Uniswap Hooklist submission

The exact V2 hook is live on Ethereum, Etherscan reports an exact source match and the complete canary lifecycle passed.
The official submission is [Uniswap/hooklist#1160](https://github.com/Uniswap/hooklist/issues/1160). Its successful
analysis opened [Uniswap/hooklist#1161](https://github.com/Uniswap/hooklist/pull/1161), which passed the registry's
validation and automated review and now awaits maintainer approval.

Submitted issue fields:

- Chain: Ethereum
- Hook address: `0x025a386eAa79f6067d29848FD05ccC71bEAb20CC`
- Name: `Programmable Classic Fee Hook`
- Description: `A non-upgradeable Uniswap v4 custom-accounting hook for Programmable Classic launches. Each pool selects a 1% to 10% total swap fee. The hook charges the same ETH-denominated fee on buys and sells, allocates a fixed 0.10% of swap volume to Programmable, allocates the remainder to the token creator, exposes explicit onchain fee disclosure, and applies zero ERC-20 transfer tax.`
- Deployer: `0x2Bb333d48DFAF1596D9036671d2E43168994249E`
- Audit URL: empty because no independent audit was completed

The registry generated the following classification:

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
    "swapAccess": "governance"
  }
}
```

The registry uses `governance` because swaps revert for unregistered pools and pool registration is restricted to the
creator address recorded by the launched token. The generated registry name is the verified contract name,
`EthCreatorFeeHookV2`.

The official Hooklist is a registry, not an approval, audit or routing allowlist. The operator separately submitted the
verified Ethereum hook and canary pool through the Uniswap Labs routing form on 27 July 2026 after accepting its Terms
of Service and Privacy Policy. The form returned `Submission successful` and stated that the hook is ready for review.
Routing support must still be claimed only after Uniswap Labs confirms the review outcome.
