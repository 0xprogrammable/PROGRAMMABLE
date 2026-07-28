# LiquidityGrowth V1 gas snapshot

> **Status: IN DEVELOPMENT. DO NOT DEPLOY.**
>
> **Legacy range-based prototype.** Current Deep FullRange measurements are in
> [`GAS-LIQUIDITY-GROWTH-FULL-RANGE-V1.md`](./GAS-LIQUIDITY-GROWTH-FULL-RANGE-V1.md).

Measured with Foundry, Solidity 0.8.26, Cancun EVM, optimizer enabled with 1,000 runs. The values below are gross
`gasleft()` call deltas from deterministic local fixtures. They are regression measurements, not gas-price or
transaction-cost estimates.

Command:

```sh
forge test --match-contract LiquidityGrowthGasV1Test --match-test 'test_gas_' -vv
```

## Measured paths

| Path | Measured gas | Test ceiling |
| --- | ---: | ---: |
| Complete atomic launch with initial buy and `1 -> 2` oracle prime | 8,182,805 | 9,000,000 |
| One permissionless 16-slot observation stage | 377,361 | 450,000 |
| Directly grow the initialized same-pool oracle from 1 to 192 slots (reference) | 4,253,510 | 4,350,000 |
| Deploy a fresh deterministic growth vault | 3,917,655 | 4,100,000 |
| Reuse the exact factory-recorded growth vault | 22,818 | 60,000 |
| Permissionless `process()` including a successful compound | 488,698 | 600,000 |
| Permissionless `compoundPending()` | 79,340 | 225,000 |

The previous one-shot path measured 12,248,344 gas for the atomic launch. Staging storage allocation reduces the
creator-paid launch by 4,065,539 gas, or 33.19%. The launch preserves the baseline observation with a `1 -> 2` prime;
later permissionless calls allocate at most 16 additional slots and cap at 192.

The safety gate was not reduced. The range source rejects every compound below the 192-slot capacity target, then
independently asks the hook for `[30 minutes, 0]`. That observation call still fails when a full real history is not
available. Capacity allocation does not count as elapsed history.

`process()` includes the upstream creator-fee claim, routing, fail-closed TWAP quote, PoolManager unlock, add-only
liquidity modification, settlement and accounting. `compoundPending()` measures a later compound after fees were
already pulled into the vault.

## Bytecode

From `forge build --skip test --sizes`:

| Contract | Runtime | Initcode | EIP-170 runtime margin |
| --- | ---: | ---: | ---: |
| `LiquidityGrowthAutomationV1` | 9,508 bytes | 9,714 bytes | 15,068 bytes |
| `LiquidityGrowthFeeOracleHookV1` | 18,085 bytes | 19,291 bytes | 6,491 bytes |
| `LiquidityGrowthRangeSourceFactoryV1` | 9,312 bytes | 9,340 bytes | 15,264 bytes |
| `LiquidityGrowthRangeSourceV1` | 4,203 bytes | 5,886 bytes | 20,373 bytes |
| `LiquidityGrowthVaultV1` | 14,288 bytes | 21,752 bytes | 10,288 bytes |
| `LiquidityGrowthVaultFactoryV1` | 24,038 bytes | 24,066 bytes | 538 bytes |
| `LiquidityGrowthLaunchV1` | 22,921 bytes | 25,188 bytes | 1,655 bytes |

The vault factory embeds `LiquidityGrowthVaultV1` creation code, so every increase to the vault's creation code
directly consumes factory runtime margin. The current 538-byte margin is a hard release constraint. A material margin
increase requires a separate deployer or linked-library architecture and therefore a fresh trust, deployment and
verification review; it is not treated as a semantics-preserving gas edit.

The launcher is 79 bytes below the repository's stricter 23,000-byte internal ceiling. Both contracts must repeat
the size gate after any production change.

These are local prototype measurements. They do not authorize deployment, establish a mainnet gas budget or resolve
the open release blockers.
