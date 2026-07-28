# Classic V3 gas snapshot

Generated with:

```sh
forge snapshot --match-contract 'FeeSplitVaultV1Test|EthCreatorFeeHookV3Test|MemeLaunchV2Test' --snap .gas-snapshot-classic-v3
```

Selected results:

| Path | Gas |
| --- | ---: |
| Buy, exact input | 244,420 |
| Buy, exact output | 252,702 |
| Sell, exact input | 238,520 |
| Sell, exact output | 238,042 |
| Split accrual and two claims | 432,509 |
| Payout change plus existing and future reward claims | 491,928 |
| Single-beneficiary launch lifecycle test | 3,750,758 |
| External-beneficiary launch and claim test | 3,847,236 |
| Three-beneficiary split launch test | 3,880,238 |
| Eight-beneficiary launch test | 4,246,543 |
| Matching predeployed vault reuse test | 3,748,443 |

These values are test-level gas measurements, not user transaction estimates. Launch rows include test assertions and surrounding calls. Production estimates must be generated from the final deployment bytecode and actual calldata.

The complete snapshot is stored in `.gas-snapshot-classic-v3`.

## Deployed bytecode

`forge build --sizes` reports:

| Contract | Runtime bytes | EIP-170 margin |
| --- | ---: | ---: |
| `FeeSplitVaultV1` | 3,186 | 21,390 |
| `FeeSplitVaultFactoryV1` | 6,994 | 17,582 |
| `EthCreatorFeeHookV3` | 12,944 | 11,632 |
| `EthCreatorFeeHookFactoryV3` | 15,702 | 8,874 |
| `MemeLaunchV2` | 22,841 | 1,735 |

`MemeLaunchV2` is below the 24,576-byte EIP-170 limit but has limited headroom. Additional launch behavior should remain in separate composable versions rather than extending this launcher.
