# Classic V2 deployment verification

Run this only after all three reviewed deployment transactions are confirmed. It never signs or sends a transaction.

## 1. Bind the receipts to the reviewed build

```bash
export V2_FACTORY_TX=0x...
export V2_HOOK_TX=0x...
export V2_LAUNCHER_TX=0x...

# Sepolia
node contracts/scripts/verify-v2-deployment.mjs --allow-unverified-source

# Mainnet
PROGRAMMABLE_DEPLOY_NETWORK=mainnet \
  node contracts/scripts/verify-v2-deployment.mjs --allow-unverified-source
```

The verifier compares two independent RPCs, exact sender, nonce, calldata, zero ETH value, receipt target, deployed
address, official dependency hashes and all immutable/getter configuration. Its JSON output is the deployment evidence
candidate. Do not record it as source-verified yet.

## 2. Publish the exact sources

Use the repository compiler settings from `foundry.toml`. The V2 hook and launcher need exact constructor arguments.

```bash
POOL_MANAGER=0x...
POSITION_MANAGER=0x...
UERC20_FACTORY=0x000000e200088D55C39a11F609E5F667729ad49b
TREASURY=0x4957f49620AFf3Adbbe8195a4f633E49cc93376c
POSITION_FORWARDER_FACTORY=0x...
HOOK_FACTORY=0x...
FEE_HOOK=0x...
MEME_LAUNCHER=0x...

HOOK_ARGS=$(cast abi-encode "constructor(address,address)" "$POOL_MANAGER" "$TREASURY")
LAUNCHER_ARGS=$(cast abi-encode \
  "constructor(address,address,address,address,address)" \
  "$POOL_MANAGER" "$POSITION_MANAGER" "$UERC20_FACTORY" "$FEE_HOOK" "$POSITION_FORWARDER_FACTORY")

forge verify-contract "$HOOK_FACTORY" \
  src/EthCreatorFeeHookFactoryV2.sol:EthCreatorFeeHookFactoryV2 \
  --chain "$CHAIN_ID" --compiler-version 0.8.26 --num-of-optimizations 1000 \
  --evm-version cancun --verifier sourcify --watch

forge verify-contract "$FEE_HOOK" \
  src/EthCreatorFeeHookV2.sol:EthCreatorFeeHookV2 \
  --constructor-args "$HOOK_ARGS" \
  --chain "$CHAIN_ID" --compiler-version 0.8.26 --num-of-optimizations 1000 \
  --evm-version cancun --verifier sourcify --watch

forge verify-contract "$MEME_LAUNCHER" \
  src/MemeLaunchV1.sol:MemeLaunchV1 \
  --constructor-args "$LAUNCHER_ARGS" \
  --chain "$CHAIN_ID" --compiler-version 0.8.26 --num-of-optimizations 1000 \
  --evm-version cancun --verifier sourcify --watch
```

Repeat with `--verifier etherscan --etherscan-api-key "$ETHERSCAN_API_KEY"`. Etherscan verification is required before
the Hooklist submission because the Hooklist indexer reads verified source from Etherscan. Sourcify `match` and
`exact_match` are recorded separately; neither is mislabeled.

## 3. Close the source gate

Run the verifier again without `--allow-unverified-source`. It must exit zero before Test2 or a Mainnet canary is treated
as release evidence.
