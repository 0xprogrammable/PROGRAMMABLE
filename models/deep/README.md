# Deep

**Status:** In development<br>
**Deployment:** None<br>
**Availability:** Not available for launch

Deep is a launch model in which the creator fee share builds add-only, locked liquidity in the token's main Uniswap v4
pool. The liquidity target and later beneficiaries are fixed when the token is launched.

No Deep contracts have been deployed.

## Intended behavior

- Programmable's disclosed fee share remains separate from the creator fee share.
- Before the target is reached, the creator fee share is reserved for main-pool liquidity growth.
- Liquidity can be added to the launch position but cannot be removed, transferred or approved.
- The pool, position, liquidity target and beneficiary allocation cannot be changed after launch.
- Once the target is reached, later creator fees are routed to the immutable beneficiaries.
- Compounding runs outside swap callbacks so a failed attempt does not stop normal trading.

## Open release gates

Deep remains unavailable until these points are resolved and tested:

1. **TWAP bounds:** fee conversion and compounding need fixed onchain price limits, a defined observation window, batch
   limits and a cooldown.
2. **Atomic launch:** one transaction must bind the pool, hook, locked add-only position, liquidity target and
   beneficiaries to verified factory deployments.
3. **Accounting:** tests must prove that every fee is assigned once, target progress cannot move backwards and failed
   compounding leaves balances unchanged.
4. **Mainnet-fork lifecycle:** launch, buy, sell, compound, target crossing and beneficiary claims must pass against the
   pinned Ethereum Uniswap v4 deployments.

The exact contracts, parameters and security assumptions will be published before Deep can be marked `Available`.
