# Classic Slither review

Slither `0.11.5` reports five findings against the exact deployed `classic-v3` source. The source is preserved byte for
byte in this repository, so reviewed findings are documented instead of being hidden by source-only suppressions.

| Detector | Location | Disposition |
| --- | --- | --- |
| `reentrancy-balance` | `MemeLaunchV2._executeInitialBuy` | The complete launch is protected by `ReentrancyGuardTransient`. The external call is to the immutable Uniswap v4 `PoolManager`; `unlockCallback` accepts only that manager. The before-and-after token balance check is an intentional settlement post-condition. |
| `incorrect-equality` | `MemeLaunchV2._executeInitialBuy` | Exact native-balance equality proves that the launch spent only its own initial-buy ETH while preserving unrelated forced ETH. A mismatch reverts the full transaction. |
| `timestamp` | `MemeLaunchV2.launch` and custody helpers | The timestamp supplies the same-transaction position deadline and the immutable initial-buy custody schedule. It does not determine price, fee rates, reward shares or trading permission. |

The related behavior is exercised by:

- `test_forcedEthCannotBlockFutureLaunchesOrSubsidizeInitialBuy`;
- `test_onlyPoolManagerCanCallInitialBuyUnlockCallback`;
- `test_fixedLockRoutesTheEntireInitialBuyDirectlyIntoAuthenticatedCustody`;
- `test_cliffLinearVestingStartsAtZeroAndUsesTheLaunchWalletForever`;
- `invariant_callbackMaskAndLooseBalancesRemainExact`; and
- the complete official-contract lifecycle in `ClassicV3MainnetForkTest`.

CI emits the complete SARIF report on every push. `--fail-none` keeps reviewed findings visible without treating known
detector limitations as a new release failure. A new or changed finding still requires manual review before release.
