# Full-Range V1 gas policy

Status: local gas measurement for the deployed but inactive Full-Range V1 release.

The numbers below were measured on the 28 July 2026 working tree with Forge
1.7.1 and Solidity 0.8.26. They are call-gas measurements from `gasleft()`.
Transaction base gas, calldata gas, the prevailing gas price and L1 conditions
are separate.

## Measured calls

Run:

```sh
forge test --match-contract 'LiquidityGrowthFullRange(Gas|Size)V1Test' -vv
```

| Path | Measured gas | CI ceiling |
| --- | ---: | ---: |
| Atomic launch, including the 1 to 2 oracle prime | 5,991,657 | 6,800,000 |
| One 16-slot oracle stage | 380,981 | 450,000 |
| One-vault 16-slot stage batch | 385,452 | 460,000 |
| Complete activation through direct stages, 2 to 192 | 4,567,929 | 5,400,000 |
| Complete activation through one-vault batches, 2 to 192 | 4,595,584 | 5,500,000 |
| Four-vault 16-slot stage batch | 1,530,566 | 1,800,000 |
| Eight-vault 16-slot stage batch | 3,057,399 | 3,600,000 |
| Direct process plus first compound | 513,471 | 620,000 |
| Direct process during cooldown | 45,009 | 55,000 |
| Direct later `compoundPending` | 110,032 | 135,000 |
| Automation first process plus compound | 583,938 | 700,000 |
| Automation later process plus compound | 269,166 | 325,000 |
| Automation later `compoundPending` | 182,080 | 220,000 |
| Four-vault first-process batch | 2,344,075 | 3,000,000 |
| Eight-vault first-process batch | 4,688,266 | 6,000,000 |

Oracle activation takes 12 post-launch calls:

```text
2, 18, 34, 50, 66, 82, 98, 114, 130, 146, 162, 178, 192
```

Capacity does not create price history. After reaching 192 slots, the vault
still requires a real, mature 30-minute observation window.

## Stage and batch policy

Keep the oracle stage at 16 slots. It is the smallest practical step for this
release: each vault stays below 450,000 call gas while activation completes in
12 bounded calls. An 8-slot step would double transaction count without adding
an oracle-safety property. Larger steps reduce transaction count but reduce
per-vault failure isolation and batch headroom.

The sponsored worker should use:

- Four vaults per batch by default.
- Eight vaults as the operational hard maximum.
- One oracle stage per vault in a batch.
- Separate oracle-growth batches from process and compound batches.
- Full worst-case gas reservation for every candidate before sending.

The contract accepts up to 32 candidates for permissionless use. That is not a
sponsored-worker target. A four-vault first-process batch costs 2,344,075 call
gas. With the worker's 20% estimate padding it remains below the current
3,000,000 gas transaction ceiling. The eight-vault path does not: staging needs
about 3.67 million padded gas and a first-process batch needs about 5.63
million.

Keep the production worker at four while its gas ceiling is 3,000,000. Enabling
eight requires a separately reviewed ceiling of at least 6,000,000 or an
automatic batch-shrinking policy. Merely changing the batch-size setting to
eight is not sufficient. The current keeper configuration rejects any batch
limit above four unless its reviewed gas ceiling is at least 6,000,000; it does
not silently send an oversized transaction.

## Lifecycle estimate

At the launch price, the fixed 0.05 ETH target is expected to take about 18
successful compounds. Price and trusted depth can change the actual count.

Using the measured Automation paths:

| Fee arrival pattern | Keeper call gas | With 30 transaction base costs |
| --- | ---: | ---: |
| Growth fees routed early, then 17 pending compounds | 8,274,882 | 8,904,882 |
| Fees claimed and compounded across 18 rounds | 9,755,344 | 10,385,344 |

The table includes the 12 oracle stages and 18 lifecycle calls. It excludes
calldata gas. The 30-minute successful-compound cooldown makes 18 rounds take
at least nine hours.

The atomic launch is paid by the creator. Including its measured call path, the
combined launch and keeper lifecycle is approximately 14.9 to 16.4 million gas
after adding the 21,000 gas transaction base floor. Calldata remains extra.

The creator-side launch transaction is about 6,012,657 gas after adding the
21,000 gas base floor:

| Effective gas price | Launch gas cost |
| --- | ---: |
| 1 gwei | 0.00601 ETH |
| 2 gwei | 0.01203 ETH |
| 5 gwei | 0.03006 ETH |
| 10 gwei | 0.06013 ETH |
| 20 gwei | 0.12025 ETH |
| 30 gwei | 0.18038 ETH |

This excludes calldata and the separate 0.0006 ETH initial-buy value.

## Keeper subsidy

The hard subsidy ceiling remains **0.03 ETH per vault**, disabled by default.
It is a budget cap, not a liveness guarantee.

At the measured lifecycle:

| Effective gas price | Early-routed fees | Streamed fees |
| --- | ---: | ---: |
| 1 gwei | 0.00890 ETH | 0.01039 ETH |
| 2 gwei | 0.01781 ETH | 0.02077 ETH |
| 3 gwei | 0.02671 ETH | 0.03116 ETH |
| 5 gwei | 0.04452 ETH | 0.05193 ETH |
| 10 gwei | 0.08905 ETH | 0.10385 ETH |
| 20 gwei | 0.17810 ETH | 0.20771 ETH |
| 30 gwei | 0.26715 ETH | 0.31156 ETH |

Those estimates include the 21,000 gas base floor and exclude calldata. The
0.03 ETH ceiling has useful headroom at 2 gwei. Under the measured streamed-fee
path it is exhausted around 2.89 gwei before calldata. Under the stricter CI
ceilings, the same 0.03 ETH budget covers the modeled streamed lifecycle at
2 gwei with about 0.00529 ETH left before calldata, but not at 3 gwei.

The worker must fail closed:

1. Do not spend on a launch that has no meaningful fees. Oracle staging begins
   only when accrued creator fees plus pending growth reach at least 0.002 ETH.
2. Read and simulate the exact current action immediately before submission.
3. Deduplicate vaults and reserve the full batch ceiling against every vault's
   remaining subsidy.
4. Skip the whole candidate when the projected maximum cost exceeds its
   remaining budget. Never rely on a later refund.
5. Record `gasUsed * effectiveGasPrice` from the receipt. Failed and no-op
   transactions still consume that vault's budget.
6. Stop staging at 192. Wait for the real 30-minute history and the onchain
   oracle, reserve, depth and cooldown gates.
7. Pause sponsored work when gas is too expensive. Permissionless execution
   remains available.

## Runtime size

Run:

```sh
forge build --skip test --sizes
```

| Contract | Runtime bytes | Initcode bytes |
| --- | ---: | ---: |
| `LiquidityGrowthFullRangeLaunchV1` | 18,785 | 40,123 |
| `LiquidityGrowthFullRangeVaultV1` implementation | 21,941 | 22,147 |
| `LiquidityGrowthFullRangeAutomationV1` | 8,548 | 8,869 |
| `LiquidityGrowthFullRangeVaultFactoryV1` | 9,154 | 32,192 |
| `LiquidityGrowthFullRangePositionPlannerV1` | 7,813 | 7,841 |

All runtime sizes are below the EIP-170 limit of 24,576 bytes. The vault has
2,635 bytes of protocol-limit margin. The launcher has 5,791 bytes of margin.
All initcodes are below the EIP-3860 limit of 49,152 bytes. The largest is the
launcher, with 9,029 bytes of protocol-limit margin.

CI also enforces tighter internal runtime ceilings of 23,000 bytes for the
vault, 20,000 for the launcher, 10,000 for the Automation and factory, and
9,000 for the planner. Initcode ceilings are 44,000 for the launcher, 35,000
for the factory, 24,000 for the vault, 10,000 for Automation and 9,000 for the
planner.

## Safe reduction assessment

No core optimization is justified for the frozen V1.

Oracle-stage gas is dominated by the required storage initialization for 190
additional observations. One-vault batching adds only 27,655 gas across the
complete 12-call activation, and batching eight instead of four saves less than
500 call gas per vault for a single stage. Removing the coordinator's
failure-isolating self-call would save little while weakening batch isolation.

Most launch gas comes from deploying the token, locked position recipient,
oracle guard, reward vault and initialized growth-vault clone. Material savings
would require converting more of those deployments to clone-based
architectures or changing shared factories. That changes provenance and
security assumptions and would require a fresh review. It is not a safe
late-stage optimization.
