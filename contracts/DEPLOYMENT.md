# Deployment runbook

No deployment has been broadcast. The current target is an Ethereum Sepolia rehearsal from `0x2Bb333d48DFAF1596D9036671d2E43168994249E`.

## Public configuration

- Platform treasury: `0x4957f49620AFf3Adbbe8195a4f633E49cc93376c`
- Sepolia deployment wallet: `0x2Bb333d48DFAF1596D9036671d2E43168994249E`
- Creator LP custody: official Uniswap `PositionFeesForwarder`
- Transfer operator: zero address
- Approval block: `type(uint256).max`
- LP fee recipient: immutable launch creator

The deployment wallet and treasury were EOAs with zero balance and nonce zero on Ethereum and Sepolia when checked on 2026-07-26. Recheck immediately before any transaction.

## Read-only verification

```sh
npm run contracts:verify
npm run contracts:sepolia:validate
```

The Sepolia checks pin eight official runtime-code hashes. The deployment script fails if the selected chain, broadcaster or any pinned bytecode differs.

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

Use a reliable Sepolia RPC. The latest read-only simulation on 2026-07-26 estimated 4,659,901 gas and approximately 0.0102 Sepolia ETH at 2.1853 gwei. Funding the test wallet with 0.02 Sepolia ETH provides a reasonable rehearsal margin; simulate again before broadcast because gas prices change.

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

The broadcast deploys only `PlatformFeeHookFactoryV1` and `LockedPositionFeeForwarderFactoryV1`. A token, hook, auction or pool is not created by this infrastructure step.

## Evidence required after broadcast

- Successful receipts and final contract addresses
- Source verification for both factories
- Runtime bytecode matched to the exact Git commit
- Deployment-wallet nonce and balance deltas
- A full Sepolia token launch, bid, graduation, v4 migration and both fee-collection paths
- Browser transaction simulation bound to the same machine-readable specification

Do not reuse a failed or uncertain broadcast command until its nonce and receipt state have been checked.
