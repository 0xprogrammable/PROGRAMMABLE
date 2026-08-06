# Shards V1 launch runbook

This runbook reproduces a Shards launch from canonical source. It deliberately separates factory deployment, salt mining, and launch broadcast. Do not mine against a guessed factory address: the factory deployer's nonce must first produce a stable deployed factory.

Shards remains in `design` status. None of the commands below authorizes a production deployment.

## Fixed inputs

- Ethereum PoolManager: `0x000000000004444c5dc75cB358380D2e3dE08A90`
- pinned evidence block: `25639000`
- tick spacing: `60`
- production tick lower: `-887220`
- production tick band: `22980`
- production tick upper: `69060`
- production start price: `TickMath.getSqrtPriceAtTick(69060)`
- required low hook bits: exactly `beforeInitialize`, `beforeSwap`, `afterSwap`, `beforeSwapReturnDelta`, and `afterSwapReturnDelta`

The launcher recipient, builder recipient, raw token salt, and factory address are release inputs. Changing any of them changes one or more predicted addresses or the configuration hash.

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

`bytecode` is the constructor-free creation-code artifact. Record it separately from full deployment initcode,
which appends constructor arguments. Every runtime must remain below 24,576 bytes and full factory deployment
initcode must remain below 49,152 bytes.

## 2. Simulate factory deployment

Use current finalized Ethereum state and the intended deployment account. Record the observed block and verify
the account nonce immediately before simulation; an old pinned fork cannot predict a future CREATE deployment:

```bash
forge script script/LaunchShardsV1.s.sol:LaunchShardsV1 \
  --rpc-url "$ETHEREUM_RPC_URL" \
  --sender "$DEPLOYER" \
  --sig "deployFactory(address,address,bytes32)" \
  0x000000000004444c5dc75cB358380D2e3dE08A90 "$LAUNCHER" "$HOOK_CODE_HASH"
```

This is a simulation because `--broadcast` is absent. Check the predicted factory and its renderer before
proceeding. If the deployer nonce changes, discard the prediction and repeat this step.

## 3. Deploy and verify the stable factory

After explicit deployment authorization, use a configured hardware wallet or encrypted Foundry account:

```bash
forge script script/LaunchShardsV1.s.sol:LaunchShardsV1 \
  --rpc-url "$ETHEREUM_RPC_URL" --account "$FOUNDRY_ACCOUNT" --broadcast \
  --sig "deployFactory(address,address,bytes32)" \
  0x000000000004444c5dc75cB358380D2e3dE08A90 "$LAUNCHER" "$HOOK_CODE_HASH"
```

Verify `poolManager`, `launcherFeeRecipient`, `renderer`, and `hookCreationCodeHash` from chain state. Verify the factory and shared renderer source using the exact build settings in `foundry.toml`.

Never put a private key, mnemonic, API token, or broadcast secret in a command line, repository file, shell history, or plan. Use a hardware signer or encrypted account prompt.

## 4. Mine twice against the deployed factory

Mining is a non-broadcast view call. Use identical inputs twice and save both complete outputs:

```bash
forge script script/LaunchShardsV1.s.sol:LaunchShardsV1 \
  --rpc-url "$ETHEREUM_RPC_URL" \
  --sig "predictAndMine(address,bytes32,bytes32,(int24,int24,int24,uint160,address))" \
  "$FACTORY" "$TOKEN_SALT" 0x0 \
  "(-887220,22980,69060,$START_SQRT_PRICE_X96,$BUILDER)"
```

Repeat the exact command from a clean shell. The raw and effective salts, creation-code and initcode hashes,
predicted SHARD, hook and NFT, expected configuration hash, and mined hook salt must match byte-for-byte. Confirm
the hook's low 14 bits equal the exact required mask.

## 5. Simulate the canonical launch

```bash
forge script script/LaunchShardsV1.s.sol:LaunchShardsV1 \
  --rpc-url "$ETHEREUM_RPC_URL" \
  --sender "$DEPLOYER" \
  --sig "launch(address,bytes32,bytes32,(int24,int24,int24,uint160,address))" \
  "$FACTORY" "$TOKEN_SALT" "$HOOK_SALT" \
  "(-887220,22980,69060,$START_SQRT_PRICE_X96,$BUILDER)"
```

Run this against a block at or after the confirmed factory receipt. For an offline rehearsal, replay factory
deployment and launch in the same local fork. The returned SHARD, hook, and NFT must equal the mined predictions,
and the configuration hash must equal the pre-broadcast commitment. Confirm the simulation emits one
`ShardLaunched` event and leaves the factory with zero SHARD.

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
2. recompute token, hook, and NFT CREATE2 addresses from the deployed factory;
3. hash the actual `ShardHookV1` creation bytes and exact constructor initcode;
4. recompute the configuration hash in the field order used by `ConfigurationData`;
5. check `configurationHashOf(hook)` and the `ShardLaunched` event;
6. check the exact five hook permission bits and PoolManager authentication;
7. check `hook.deployer() == factory`, NFT-to-hook and hook-to-NFT back-references, and consumed one-shot powers;
8. check both liquidity positions and the SHARD/NFT backing identity.

A second launch with the same raw token salt, builder, and hook salt must revert because the predicted addresses are occupied. It must not change the first launch.

## Rehearsal record

The source gate ran a local Anvil fork from `eth.drpc.org` at block `25639000`, using Anvil's unlocked development
account only. No public-network transaction was signed. Results:

```text
anvil --fork-url https://eth.drpc.org --fork-block-number 25639000 --port 8547
forge script ... --sig deployFactory(...) --broadcast --unlocked
  factory: 0x2E3D971A9b81493DDfFE10853453189434bCBD02
  renderer: 0xb713C2B867DbF3dd429985eCBAaeb665F8ef337f
forge script ... --sig predictAndMine(...)   # executed twice from clean invocations
  raw token salt: 0x4553ff5ac6f55461c3aa80289af4ab56c6aa86ff1fc1711c6fb6ed347f63aaa5
  effective token salt: 0x4231bfd14fc1e52b1a13a2c1207349a3f4a9d067d8c1bc60c0af32e8a53a21af
  hook salt: 0x00000000000000000000000000000000000000000000000000000000000031cc
  SHARD: 0x568698E0A8c73889Ad7F73B09979d92E5F611395
  hook: 0x4F714b4eAbb3cF1E6b4b75c1f157404B84A820cC
  NFT: 0xF9FD88Bc94688FD350c3A46233ce2a75042b2C6c
  expected configuration hash: 0xe22309a4ecc5a473daf8722117d5cf6b1e15b9e4919a1ed64a27180223925795
forge script ... --sig launch(...) --broadcast --unlocked
  NFT: 0xF9FD88Bc94688FD350c3A46233ce2a75042b2C6c
  configuration hash: 0xe22309a4ecc5a473daf8722117d5cf6b1e15b9e4919a1ed64a27180223925795
same launch invocation repeated
  reverted AddressOccupied(0x568698E0A8c73889Ad7F73B09979d92E5F611395)
cast call <factory> configurationHashOf(address)(bytes32) <hook>
  unchanged: 0xe22309a4ecc5a473daf8722117d5cf6b1e15b9e4919a1ed64a27180223925795
ETHEREUM_RPC_URL=https://rpc.flashbots.net forge test --match-contract ShardV1MainnetForkTest -vv
  provider failure: requested historical state was pruned
ETHEREUM_RPC_URL=https://eth.drpc.org forge test --match-contract ShardV1MainnetForkTest -vv
  4 passed; factory deployment gas 7,180,480; atomic launch gas 8,667,331
```

The two mining invocations produced byte-identical outputs. The first launch matched both predictions. The repeat
reverted without changing the first configuration or code. The factory unit suite separately covers failure
after each deployment stage and full rollback. The pinned Mainnet-fork suite reproduces the configuration hash.
