# Shards V1 launch runbook

This runbook reproduces a Shards launch from canonical source. It deliberately separates factory deployment, salt mining, and launch broadcast. The factory is deployed through the canonical CREATE2 proxy, so its address depends only on the factory salt and init-code — never on the deployer's nonce — and can be predicted and reproduced by any sender.

Shards remains in `design` status. None of the commands below authorizes a production deployment.

## Fixed inputs

- Ethereum PoolManager: `0x000000000004444c5dc75cB358380D2e3dE08A90`
- CREATE2 deployment proxy: `0x4e59b44847b379578588920cA78FbF26c0B4956C`
- factory deployer (EOA that broadcasts): `0x2Bb333d48DFAF1596D9036671d2E43168994249E`
- launcher (Programmable 0.10%) recipient: `0x4957f49620AFf3Adbbe8195a4f633E49cc93376c` — an immutable constant in `ShardLaunchFactoryV1`, not a constructor argument
- builder (0.10%) recipient: `0xceeBB3A6543CeBEB2ED66963897A0abEA52A50cC`
- factory salt: `0x655a4b5a2b704bef84b4ff94adde0a7ac40ad0366c82ddca5290180fe4c3986d` (`keccak256("programmable.shards-v1.factory.v1")`)
- raw token salt: `0xca9944c923e24ba5cb3188a29b18c3305158e686e39473e91bbe31fc019816ab` (`keccak256("programmable.shards-v1.token.v1")`)
- hook creation-code hash: `0x64b555958445829d72434216cb47abe10e94ba4d649ec43b76ac873cd83b1e53`
- tick spacing: `60`
- production tick lower: `-887220`
- production tick band: `22980`
- production tick upper: `69060`
- production start price: `TickMath.getSqrtPriceAtTick(69060)`
- required low hook bits: exactly `beforeInitialize`, `beforeSwap`, `afterSwap`, `beforeSwapReturnDelta`, and `afterSwapReturnDelta`

The full pinned plan — factory, renderer, effective token salt, mined hook salt, predicted SHARD/hook/NFT, and expected configuration hash — is recorded in `releases/shards-v1/mainnet-manifest.json` under `candidatePlan`. Every one of those values is valid only for the exact reviewed source at this revision; any source change invalidates them and requires re-mining.

## 1. Build and inspect artifacts

```bash
./scripts/bootstrap-deps.sh
forge fmt --check
forge build --sizes
forge inspect ShardHookV1 bytecode | cast keccak
forge inspect ShardHookV1 deployedBytecode | cast keccak
forge inspect ShardLaunchFactoryV1 bytecode | cast keccak
forge inspect ShardLaunchFactoryV1 deployedBytecode | cast keccak
```

`bytecode` is the constructor-free creation-code artifact. Record it separately from full deployment initcode, which appends constructor arguments. Every runtime must remain below 24,576 bytes and full factory deployment initcode must remain below 49,152 bytes. `keccak256` of the `ShardHookV1` creation-code artifact must equal the hook creation-code hash in Fixed inputs.

## 2. Predict the factory address (no broadcast)

The factory address is nonce-independent — it is `CREATE2(proxy, factorySalt, keccak256(initcode))` — so it can be checked before any transaction:

```bash
forge script script/LaunchShardsV1.s.sol:LaunchShardsV1 \
  --rpc-url "$ETHEREUM_RPC_URL" \
  --sig "previewFactory(address,bytes32,bytes32)" \
  0x000000000004444c5dc75cB358380D2e3dE08A90 "$HOOK_CODE_HASH" "$FACTORY_SALT"
```

Confirm the printed factory and renderer equal the `candidatePlan` values. No nonce is involved; the prediction does not change if the deployer sends other transactions first.

## 3. Deploy the factory through the CREATE2 proxy

After explicit deployment authorization, use a configured hardware wallet or encrypted Foundry account:

```bash
forge script script/LaunchShardsV1.s.sol:LaunchShardsV1 \
  --rpc-url "$ETHEREUM_RPC_URL" --account "$FOUNDRY_ACCOUNT" --broadcast \
  --sig "deployFactory(address,bytes32,bytes32)" \
  0x000000000004444c5dc75cB358380D2e3dE08A90 "$HOOK_CODE_HASH" "$FACTORY_SALT"
```

`deployFactory` reverts unless the supplied hash equals `keccak256(type(ShardHookV1).creationCode)` and unless the deployed address equals the CREATE2 prediction. Verify `poolManager`, `launcherFeeRecipient`, `renderer`, and `hookCreationCodeHash` from chain state. Verify the factory and shared renderer source using the exact build settings in `foundry.toml`.

Never put a private key, mnemonic, API token, or broadcast secret in a command line, repository file, shell history, or plan. Use a hardware signer or encrypted account prompt.

## 4. Mine twice against the factory

Mining is a non-broadcast view call. Use identical inputs twice and save both complete outputs:

```bash
forge script script/LaunchShardsV1.s.sol:LaunchShardsV1 \
  --rpc-url "$ETHEREUM_RPC_URL" \
  --sig "predictAndMine(address,bytes32,bytes32,(int24,int24,int24,uint160,address))" \
  "$FACTORY" "$TOKEN_SALT" 0x0 \
  "(-887220,22980,69060,$START_SQRT_PRICE_X96,$BUILDER)"
```

Repeat the exact command from a clean shell. The raw and effective salts, creation-code and initcode hashes, predicted SHARD, hook and NFT, expected configuration hash, and mined hook salt must match byte-for-byte, and must equal the `candidatePlan` values. Confirm the hook's low 14 bits equal the exact required mask.

## 5. Simulate the canonical launch

```bash
forge script script/LaunchShardsV1.s.sol:LaunchShardsV1 \
  --rpc-url "$ETHEREUM_RPC_URL" \
  --sender "$DEPLOYER" \
  --sig "launch(address,bytes32,bytes32,(int24,int24,int24,uint160,address))" \
  "$FACTORY" "$TOKEN_SALT" "$HOOK_SALT" \
  "(-887220,22980,69060,$START_SQRT_PRICE_X96,$BUILDER)"
```

Run this against a block at or after the confirmed factory receipt. For an offline rehearsal, replay factory deployment and launch in the same local fork. The returned SHARD, hook, and NFT must equal the mined predictions, and the configuration hash must equal the pre-broadcast commitment. Confirm the simulation emits one `ShardLaunched` event and leaves the factory with zero SHARD.

## 6. Broadcast one launch

Only after the source-review, security-review, and explicit deployment-authorization gates are satisfied:

```bash
forge script script/LaunchShardsV1.s.sol:LaunchShardsV1 \
  --rpc-url "$ETHEREUM_RPC_URL" --account "$FOUNDRY_ACCOUNT" --broadcast \
  --sig "launch(address,bytes32,bytes32,(int24,int24,int24,uint160,address))" \
  "$FACTORY" "$TOKEN_SALT" "$HOOK_SALT" \
  "(-887220,22980,69060,$START_SQRT_PRICE_X96,$BUILDER)"
```

Do not retry blindly. First inspect the transaction and `configurationHashOf(predictedHook)`. An exact-configuration observer can sponsor the public launch before the intended sender; that creates the same contracts and recipients rather than redirecting the builder role.

## 7. Post-launch verification

Verify exact source for the factory, renderer, hook, SHARD, and NFT. Then independently:

1. recompute the effective token salt from the raw salt, hook salt, ticks, start price, and builder recipient;
2. recompute token, hook, and NFT CREATE2 addresses from the factory;
3. hash the actual `ShardHookV1` creation bytes and exact constructor initcode;
4. recompute the configuration hash in the field order used by `ConfigurationData`;
5. check `configurationHashOf(hook)` and the `ShardLaunched` event;
6. check the exact five hook permission bits and PoolManager authentication;
7. check `hook.deployer() == factory`, NFT-to-hook and hook-to-NFT back-references, and consumed one-shot powers;
8. check both liquidity positions and the SHARD/NFT backing identity.

A second launch with the same raw token salt, builder, and hook salt must revert because the predicted addresses are occupied. It must not change the first launch.

## Rehearsal record

The predicted plan was generated deterministically from the reviewed source: the factory address was computed as `CREATE2(0x4e59…4956C, factorySalt, keccak256(initcode))`, the factory was deployed at that address through a CREATE2 deployer to run its constructor (which deploys the shared renderer), and the hook salt was mined against it. Pinned outputs (all recorded in `candidatePlan`):

```text
expected factory:            0x3624dd0275A9Bb89E509d4AF90d3b0aE213a9B09
expected renderer:           0x80c5E72d014874b7f09f61dD30395dB81140Bd5E
launcher fee recipient:      0x4957f49620AFf3Adbbe8195a4f633E49cc93376c
builder fee recipient:       0xceeBB3A6543CeBEB2ED66963897A0abEA52A50cC
hook creation-code hash:     0x64b555958445829d72434216cb47abe10e94ba4d649ec43b76ac873cd83b1e53
raw token salt:              0xca9944c923e24ba5cb3188a29b18c3305158e686e39473e91bbe31fc019816ab
effective token salt:        0x99a64e9fde372d1810d5216dc0a332d6d6f0e07a1deee9ee90deef56fba55140
hook salt:                   0x0000000000000000000000000000000000000000000000000000000000005f0a
predicted SHARD:             0xb9d88AA3809ce54d7e54E7954929f437c222FD58
predicted hook:              0x5625aEEfcd36093dd62F1b627b9aD1Db441FA0cc
predicted NFT:               0x2af33A45c8FbD37f02CC6C2C46579e89159907a5
expected configuration hash: 0x97a77a6ca3dcbab17c3e9b6748c3cc30a8f4557bc53a066242b4a392ce3f0712
```

The pinned Mainnet-fork suite reproduces the full lifecycle against the canonical v4 PoolManager:

```text
ETHEREUM_RPC_URL=https://eth.drpc.org forge test --match-contract ShardV1MainnetForkTest -vv
  4 passed; factory deployment gas 7,176,738; atomic launch gas 8,532,815; block 25639000
```

The factory unit suite separately covers deterministic re-mining, failure after each deployment stage with full rollback, and a duplicate launch reverting `AddressOccupied` without changing the first launch.
