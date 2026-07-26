# Deployment runbook

The four-contract Launcher infrastructure was deployed to Ethereum Sepolia from
`0x2Bb333d48DFAF1596D9036671d2E43168994249E` on 2026-07-26. All four receipts succeeded, the
nonce-derived addresses match the dry run, the runtime configuration was checked onchain and Blockscout serves verified
Solidity source for every deployment. Mainnet remains undeployed.

## Public configuration

- Platform treasury: `0x4957f49620AFf3Adbbe8195a4f633E49cc93376c`
- Sepolia deployment wallet: `0x2Bb333d48DFAF1596D9036671d2E43168994249E`
- Creator LP custody: official Uniswap `PositionFeesForwarder`
- Transfer operator: zero address
- Approval block: `type(uint256).max`
- LP fee recipient: immutable launch creator

The Sepolia deployment wallet and Ethereum treasury were EOAs when rechecked on 2026-07-26. Google Cloud funded the
Sepolia wallet with `0.05 Sepolia ETH` in successful transaction
`0x1ef3f04c455cd98197b3900cc233638fc97127eeab8683e0bfdc4d9d5174d122` at block `11,353,700`. The
four infrastructure deployments consumed `0.026749699213745908 Sepolia ETH`; the wallet finished at nonce four with
`0.023250300786254092 Sepolia ETH`.

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

## Reproduce the deployment

Use a reliable Sepolia RPC. The final pre-broadcast simulation estimated `13,771,674` gas and
`0.030015162664449732 Sepolia ETH` at `2.179485418 gwei`. The four mined transactions used `10,593,597` gas and
`0.026749699213745908 Sepolia ETH`.

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

If the test wallet exists only in MetaMask, serve the local deployment panel after the same dry run:

```sh
npm run contracts:sepolia:metamask
```

Open `http://127.0.0.1:4173` in the Chrome profile that contains MetaMask. The panel reads the exact four CREATE transactions from Foundry's ignored `dry-run/run-latest.json`, rejects every account except the configured test wallet, enforces Sepolia and checks the pending nonce, predicted address, gas estimate, receipt status and runtime bytecode before continuing. It never reads or stores a password, recovery phrase or private key. Each contract still requires an explicit MetaMask confirmation.

## Sepolia deployment evidence

The deployed creation sequence is bound to commit `5d97ad58870ca328d411e837ab8580ebd2383c71`.

| Contract | Address | Transaction | Block | Runtime code hash |
| --- | --- | --- | ---: | --- |
| `PlatformFeeHookFactoryV1` | [`0x291a…B507`](https://eth-sepolia.blockscout.com/address/0x291a9ff1059d225d02B1659430804486404dB507) | [`0x7874…ca6c`](https://eth-sepolia.blockscout.com/tx/0x7874d856fecd2616b9b125ee7ed85f876c93596adbc9189f8420f0b97abbca6c) | 11,353,879 | `0x7792dba76c190e746dc7fbf7f8a8f690f7cf5ce6fab448c858069b1852974306` |
| `LockedPositionFeeForwarderFactoryV1` | [`0xaE3C…8448`](https://eth-sepolia.blockscout.com/address/0xaE3C324B742a7576863A546120c4280b7c9E8448) | [`0x4969…faf6`](https://eth-sepolia.blockscout.com/tx/0x4969ca925b82c881c978f1d88722af61eea04f1294da55c45e5e7392e294faf6) | 11,353,893 | `0x49e040806b0664b2fa4f41c5abc11241cdb8f847c538c13d6874c32804b74ebc` |
| `DirectLiquidityLauncherV1` | [`0x5fc6…Fa1E`](https://eth-sepolia.blockscout.com/address/0x5fc6aDd062329742EFefA9c4b11C355AAe02Fa1E) | [`0xc61c…dd8d`](https://eth-sepolia.blockscout.com/tx/0xc61ca9972391717c454e6bdf9cbbf4bfb5aa1987cf0f29542f6523e9ed6cdd8d) | 11,353,896 | `0x41fa4dbe9709e93f601e0406a3a9d61826144ca56e16f748e063f850fc0af48b` |
| `BoundedDynamicFeeHookFactoryV1` | [`0x51d7…C775`](https://eth-sepolia.blockscout.com/address/0x51d702731db281EE223904A4663E05BfCA26C775) | [`0x8188…69d97`](https://eth-sepolia.blockscout.com/tx/0x8188cfa559981c4e03f55a99e19c7f87c5917e4e6a981c1793e5ba7a09e69d97) | 11,353,915 | `0xe6bbbdba0194caba268f5546db2574dc416b3c74331bd44f33d04d4b2251ffbc` |

The direct launcher points to the official Sepolia PoolManager, PositionManager and UERC20Factory, the two Launcher
factories above and the configured treasury. The locked-position factory points to the official PositionManager, uses
the zero operator and exposes `type(uint256).max` as its timelock block. The deployment created no token, hook, auction
or pool.

## Remaining rehearsal evidence

- A full Sepolia auction launch, bid, graduation, v4 migration and both fee-collection paths
- A full Sepolia bounded dynamic-fee auction, migration, cross-block fee update and both fee-collection paths
- A full Sepolia direct launch, bidirectional swaps and both fee-collection paths
- A full Sepolia existing-UERC20 launch proving factory origin and creator authorization, followed by bidirectional swaps and both fee-collection paths
- Browser transaction simulation bound to the same machine-readable specification

Do not reuse a failed or uncertain broadcast command until its nonce and receipt state have been checked.
