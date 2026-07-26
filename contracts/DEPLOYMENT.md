# Deployment runbook

No deployment has been broadcast. The current target is an Ethereum Sepolia rehearsal from `0x2Bb333d48DFAF1596D9036671d2E43168994249E`.

## Public configuration

- Platform treasury: `0x4957f49620AFf3Adbbe8195a4f633E49cc93376c`
- Sepolia deployment wallet: `0x2Bb333d48DFAF1596D9036671d2E43168994249E`
- Creator LP custody: official Uniswap `PositionFeesForwarder`
- Transfer operator: zero address
- Approval block: `type(uint256).max`
- LP fee recipient: immutable launch creator

The Sepolia deployment wallet and Ethereum treasury were EOAs when rechecked on 2026-07-26. The Sepolia wallet had zero balance and nonce zero. The four predicted Sepolia infrastructure addresses had no code. Recheck immediately before any transaction.

## Read-only verification

```sh
npm run contracts:verify
npm run contracts:variants
npm run contracts:official-deployments
npm run contracts:slither
npm run contracts:sepolia:validate
```

The Sepolia checks pin eight official runtime-code hashes. The deployment script fails if the selected chain, broadcaster or any pinned bytecode differs. The variant validator also fails if catalog status, evidence, fee or treasury fields drift across the machine-readable specifications.

## Local signing

Never send a private key through chat, commit it, put it in `.env.local` or pass it directly on a command line. Import the test key through Foundry’s hidden prompt:

```sh
cast wallet import launcher-sepolia --interactive
```

Confirm that the imported account is exactly the configured test deployment wallet:

```sh
cast wallet address --account launcher-sepolia
```

## Simulate, then broadcast

Use a reliable Sepolia RPC. The latest read-only simulation on 2026-07-26 estimated 13,751,167 gas and approximately 0.028910040635761992 Sepolia ETH at 2.102369976 gwei. Funding the test wallet with 0.04 Sepolia ETH provides a rehearsal margin at that estimate; simulate again before broadcast because gas prices change.

```sh
export SEPOLIA_RPC_URL=https://your-sepolia-rpc.example
export LAUNCHER_TEST_DEPLOYER=0x2Bb333d48DFAF1596D9036671d2E43168994249E

forge script script/DeploySepoliaInfrastructureV1.s.sol:DeploySepoliaInfrastructureV1 \
  --rpc-url "$SEPOLIA_RPC_URL" \
  --sender "$LAUNCHER_TEST_DEPLOYER"
```

After reviewing the simulation, broadcast with the encrypted local account:

```sh
forge script script/DeploySepoliaInfrastructureV1.s.sol:DeploySepoliaInfrastructureV1 \
  --rpc-url "$SEPOLIA_RPC_URL" \
  --sender "$LAUNCHER_TEST_DEPLOYER" \
  --account launcher-sepolia \
  --broadcast \
  --slow
```

The infrastructure transaction sequence still predicts:

- `PlatformFeeHookFactoryV1`: `0x291a9ff1059d225d02B1659430804486404dB507`
- `LockedPositionFeeForwarderFactoryV1`: `0xaE3C324B742a7576863A546120c4280b7c9E8448`
- `DirectLiquidityLauncherV1`: `0x5fc6aDd062329742EFefA9c4b11C355AAe02Fa1E`
- `BoundedDynamicFeeHookFactoryV1`: `0x51d702731db281EE223904A4663E05BfCA26C775`

These are deterministic nonce-derived predictions, not deployed addresses. The broadcast deploys three factories and the direct-liquidity contract, which contains the new-token and existing-UERC20 entry points. A token, hook, auction or pool is not created by this infrastructure step.

## Evidence required after broadcast

- Successful receipts and final contract addresses
- Source verification for all three factories and the direct launcher
- Runtime bytecode matched to the exact Git commit
- Deployment-wallet nonce and balance deltas
- A full Sepolia auction launch, bid, graduation, v4 migration and both fee-collection paths
- A full Sepolia bounded dynamic-fee auction, migration, cross-block fee update and both fee-collection paths
- A full Sepolia direct launch, bidirectional swaps and both fee-collection paths
- A full Sepolia existing-UERC20 launch proving factory origin and creator authorization, followed by bidirectional swaps and both fee-collection paths
- Browser transaction simulation bound to the same machine-readable specification

Do not reuse a failed or uncertain broadcast command until its nonce and receipt state have been checked.
