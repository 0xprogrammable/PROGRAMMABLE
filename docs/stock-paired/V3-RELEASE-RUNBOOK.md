# Stock-Paired release procedure

This procedure covers the internal `stock-paired-v3` contract release. The
public model name remains **Stock-Paired**.

Public launches stay disabled until the deployment, current pricing, source and
full lifecycle evidence are all captured in
`contracts/deployments/mainnet-stock-paired-v3.json`.

## 1. Freeze the release

Run the deterministic and fork gates from a clean checkout:

```bash
npm run contracts:bootstrap
npm run contracts:stock-paired-v3:deployer:test
npm run contracts:stock-paired-v3:fork:test
npm run contracts:stock-paired-v3:price-gate
cd contracts
forge test --match-path 'test/StockPaired*V3.t.sol' -vv
forge build --sizes
forge fmt --check
cd ..
```

Commit the reviewed release, then record the full commit:

```bash
export STOCK_PAIRED_V3_RELEASE_COMMIT="$(git rev-parse HEAD)"
```

The deploy script must return this exact source commitment:

```text
0xda537415a9678c414240ba9849011acef0aeee36bc938cc4597a0a78f0e74f66
```

Recompute it from the reviewed Solidity before signing:

```bash
cd contracts
forge script script/DeployMainnetStockPairedInfrastructureV3.s.sol:DeployMainnetStockPairedInfrastructureV3 \
  --sig 'deploymentSourceCommitment()' --offline -vv
cd ..
```

## 2. Rehearse immediately before signing

Use two independent Ethereum Mainnet RPCs. The deployer nonce must still be
`126`; otherwise stop. The three reviewed CREATE addresses depend on it.

```bash
export STOCK_PAIRED_RPC_A="https://ethereum-rpc.publicnode.com"
export STOCK_PAIRED_RPC_B="https://eth.drpc.org"
cast nonce 0x2Bb333d48DFAF1596D9036671d2E43168994249E --rpc-url "$STOCK_PAIRED_RPC_A"
cast nonce 0x2Bb333d48DFAF1596D9036671d2E43168994249E --rpc-url "$STOCK_PAIRED_RPC_B"
```

The reviewed addresses are:

```text
Position planner  0x92555fb6d357f95fdBc5AAAEC55912626297782D
Launcher          0x0573879f72d8eE8B0e5a4Ec5E8bcDb2fCab9E51c
ETH coordinator   0xdDC3ABbAB0df7F1189310a4f70e7e365796B74E2
```

Create the final Foundry rehearsal. This is simulation only:

```bash
cd contracts
STOCK_PAIRED_V3_MAINNET_DEPLOYER=0x2Bb333d48DFAF1596D9036671d2E43168994249E \
STOCK_PAIRED_V3_MAINNET_START_NONCE=126 \
STOCK_PAIRED_V3_MAINNET_TREASURY=0x4957f49620AFf3Adbbe8195a4f633E49cc93376c \
STOCK_PAIRED_V3_PRICE_COMMITMENT="$(forge script \
  script/DeployMainnetStockPairedInfrastructureV3.s.sol:DeployMainnetStockPairedInfrastructureV3 \
  --sig 'priceCommitment()' --offline -vv | sed -n 's/^0: bytes32 //p')" \
forge script script/DeployMainnetStockPairedInfrastructureV3.s.sol:DeployMainnetStockPairedInfrastructureV3 \
  --rpc-url "$STOCK_PAIRED_RPC_A"
cd ..
```

Review and sign exactly the three zero-value CREATE transactions in nonce order.
Do not retry a transaction until its receipt has been checked.

## 3. Capture deployment evidence

After all three receipts have at least 12 confirmations, keep the Foundry
`run-latest.json` from the signed broadcast and run the capture without writing:

```bash
STOCK_PAIRED_V3_RELEASE_COMMIT="$STOCK_PAIRED_V3_RELEASE_COMMIT" \
STOCK_PAIRED_RPC_A="$STOCK_PAIRED_RPC_A" \
STOCK_PAIRED_RPC_B="$STOCK_PAIRED_RPC_B" \
npm run contracts:stock-paired-v3:release:capture
```

The capture independently verifies:

- sender, nonces, calldata and zero ETH value
- successful receipts and expected CREATE addresses
- 12-block finality on both RPCs
- runtime hashes and EIP-170 sizes
- launcher dependencies and all six immutable start ticks
- coordinator dependencies and all six quote routes

After reviewing the dry-run output:

```bash
STOCK_PAIRED_V3_RELEASE_COMMIT="$STOCK_PAIRED_V3_RELEASE_COMMIT" \
STOCK_PAIRED_RPC_A="$STOCK_PAIRED_RPC_A" \
STOCK_PAIRED_RPC_B="$STOCK_PAIRED_RPC_B" \
npm run contracts:stock-paired-v3:release:capture:write
```

This writes local evidence and the manifest. It does not submit sources, move
funds or enable public launches.

## 4. Capture current pricing

Capture the two-RPC pool observations and independent underlying references at
the same release snapshot. Then run:

```bash
npm run contracts:stock-paired-v3:price-gate
```

All six implied starting FDVs must be within 5% of
`1.355657760817103798 ETH`, underlying-reference drift must remain within 3%,
and the evidence must be no older than 15 minutes. Missing, stale or conflicting
data blocks release.

## 5. Verify the three new sources

The V2 registry, fee vault factory, hook factory and hook are reused with their
existing source records. Submit and capture only:

```text
src/StockPairedPositionPlannerV3.sol:StockPairedPositionPlannerV3
src/StockPairedLaunchV3.sol:StockPairedLaunchV3
src/StockPairedEthLaunchCoordinatorV3.sol:StockPairedEthLaunchCoordinatorV3
```

Use Solidity `0.8.26`, optimizer `1000`, EVM `cancun`, metadata bytecode hash
`none`, and the exact constructor arguments from the signed deployment
calldata. Capture Etherscan and Sourcify results into the V3 manifest. Source
submission and capture are separate steps; a submitted job is not verification.

## 6. Complete the lifecycle canary

The V3 canary can run as soon as deployment capture is complete, in parallel
with explorer source processing:

```bash
STOCK_PAIRED_RELEASE_VERSION=v3 \
STOCK_PAIRED_ETH_COORDINATOR_RELEASE_COMMIT="$STOCK_PAIRED_V3_RELEASE_COMMIT" \
npm run contracts:stock-paired-v3:eth-canary
```

It requires one ETH-first launch, one buy, one sell, one creator claim and one
launcher claim. Each transaction is simulated by two Mainnet RPCs before the
wallet opens.

After every canary transaction has 12 confirmations:

```bash
STOCK_PAIRED_RELEASE_VERSION=v3 \
STOCK_PAIRED_ETH_COORDINATOR_RELEASE_COMMIT="$STOCK_PAIRED_V3_RELEASE_COMMIT" \
npm run contracts:stock-paired-v3:eth-lifecycle:capture
```

Review first, then repeat with
`contracts:stock-paired-v3:eth-lifecycle:capture:write`.

## 7. Activate last

Activation is a separate commit after all four gates are checked:

1. deployment and runtime bindings
2. current pricing evidence
3. source verification
4. lifecycle canary

Run the full app tests, production build and rendered desktop/mobile QA before
changing `activation.publicLaunchesEnabled` to `true`. Confirm the production
domain serves the exact activated commit.
