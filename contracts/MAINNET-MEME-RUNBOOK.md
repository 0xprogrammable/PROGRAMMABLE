# Programmable Meme Launch V1 Mainnet Runbook

This runbook covers one immutable Ethereum Mainnet deployment of the Classic launch stack. It is intentionally fail-closed. A simulation, a passing fork test, or an estimated address is not a Mainnet deployment.

No raw private key belongs in a command, shell history, `.env` file, repository, browser, or chat. Use a Foundry keystore or a hardware-backed signer. Broadcasting requires a separate, explicit owner decision.

## Reused Uniswap infrastructure

Programmable does not redeploy protocol infrastructure. The deployment script requires the current official Ethereum contracts and their exact runtime hashes before it will simulate or broadcast.

| Dependency | Ethereum address |
| --- | --- |
| PoolManager | `0x000000000004444c5dc75cB358380D2e3dE08A90` |
| PositionManager | `0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e` |
| StateView | `0x7fFE42C4a5DEeA5b0feC41C94C136Cf115597227` |
| V4Quoter | `0x52F0E24D1c21C8A0cB1e5a5dD6198556BD9E1203` |
| UERC20Factory | `0x000000e200088D55C39a11F609E5F667729ad49b` |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` |
| Universal Router | `0xd92A36B0000531EF3063dEd4De20A0783308446C` |

The current Universal Router runtime hash is `0x41ccd905c8e4de29ce9536ff49233b79e3085a0987d490664e703ee1e7b1dc49`. Do not substitute the older `0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af` address.

Programmable deploys only four transactions:

1. `LockedPositionFeeForwarderFactoryV1`
2. `EthCreatorFeeHookFactoryV1`
3. `EthCreatorFeeHookV1` through the factory with CREATE2
4. `MemeLaunchV1`

All four transactions have zero ETH value. The fixed launcher treasury is `0x4957f49620AFf3Adbbe8195a4f633E49cc93376c`.

## Gate 1: freeze and test the exact source

Record the reviewed commit and do not change Solidity sources, libraries, compiler settings, deployer, treasury, or starting nonce after review.

From the repository root:

```bash
npm run contracts:official-deployments
cd contracts
forge fmt --check
forge build
forge lint script/DeployMainnetMemeInfrastructureV1.s.sol test/DeployMainnetMemeInfrastructureV1.t.sol test/MainnetMemeLifecycleFork.t.sol
forge test --match-contract DeployMainnetMemeInfrastructureV1Test -vvv
forge test --match-contract MainnetMemeLifecycleForkTest -vvv
```

The lifecycle test must complete an actual launch, quote, buy, sell, creator claim, launcher claim, and locked-position custody check against a pinned Ethereum fork using the official contracts above.

## Gate 2: approve the signer and RPCs

Use two independent, authenticated Mainnet RPCs for production. Public endpoints are acceptable for a rehearsal, not for durable production monitoring.

Set local shell values without committing them:

```bash
export MAINNET_RPC_URL_A="https://your-first-mainnet-rpc"
export MAINNET_RPC_URL_B="https://your-second-mainnet-rpc"
export MAINNET_RPC_URLS="$MAINNET_RPC_URL_A,$MAINNET_RPC_URL_B"
export LAUNCHER_MAINNET_DEPLOYER="0x..."
export LAUNCHER_MAINNET_START_NONCE="..."
export LAUNCHER_MAINNET_TREASURY="0x4957f49620AFf3Adbbe8195a4f633E49cc93376c"
export LAUNCHER_MAX_FEE_PER_GAS_WEI="..."
export LAUNCHER_MAX_PRIORITY_FEE_PER_GAS_WEI="..."
```

Check both RPCs immediately before simulation and again immediately before signing:

```bash
cast chain-id --rpc-url "$MAINNET_RPC_URL_A"
cast chain-id --rpc-url "$MAINNET_RPC_URL_B"
cast nonce "$LAUNCHER_MAINNET_DEPLOYER" --block latest --rpc-url "$MAINNET_RPC_URL_A"
cast nonce "$LAUNCHER_MAINNET_DEPLOYER" --block pending --rpc-url "$MAINNET_RPC_URL_A"
cast nonce "$LAUNCHER_MAINNET_DEPLOYER" --block latest --rpc-url "$MAINNET_RPC_URL_B"
cast nonce "$LAUNCHER_MAINNET_DEPLOYER" --block pending --rpc-url "$MAINNET_RPC_URL_B"
cast balance "$LAUNCHER_MAINNET_DEPLOYER" --ether --rpc-url "$MAINNET_RPC_URL_A"
cast balance "$LAUNCHER_MAINNET_DEPLOYER" --ether --rpc-url "$MAINNET_RPC_URL_B"
cast code "$LAUNCHER_MAINNET_DEPLOYER" --rpc-url "$MAINNET_RPC_URL_A"
cast code "$LAUNCHER_MAINNET_DEPLOYER" --rpc-url "$MAINNET_RPC_URL_B"
```

Required result:

- both chain IDs are `1`
- both RPCs report identical latest and pending nonces
- the reviewed starting nonce equals that value
- deployer code is `0x`
- the deployer has enough ETH for the reviewed gas limits at the chosen maximum fee, plus an explicit safety margin

Required balance is not a fixed number. Calculate the cap as `sum(gasLimit) × reviewed maxFeePerGas`, add the chosen margin, and repeat the estimate immediately before signing. Never infer funding from an old gas-price snapshot.

## Gate 3: simulate without signing

This command does not broadcast because it deliberately omits `--broadcast`:

```bash
forge script script/DeployMainnetMemeInfrastructureV1.s.sol:DeployMainnetMemeInfrastructureV1 \
  --rpc-url "$MAINNET_RPC_URL_A" \
  --sender "$LAUNCHER_MAINNET_DEPLOYER" \
  -vvvv
```

Review all four simulated transactions. They must use consecutive nonces, zero value, the expected CREATE or CREATE2 target, and the exact calldata produced by the reviewed artifacts. Re-run the simulation if the source, compiler output, signer nonce, dependency code, fee environment, or Mainnet state changes.

### Current read-only preflight

At Ethereum block `25,621,557` on `2026-07-27`, dRPC and PublicNode independently agreed that the owner-approved
Mainnet deployer `0x2Bb333d48DFAF1596D9036671d2E43168994249E` was an EOA with latest nonce `0`, pending
nonce `0`, no code and balance `0 ETH`. The signer address and immutable treasury are approved, but the deployer is
not fund-ready.

dRPC and PublicNode independently matched the pinned runtime hashes for PoolManager, PositionManager, StateView,
V4Quoter, UERC20Factory, Permit2 and Universal Router. Both also reported all four predicted Programmable addresses
as vacant.

A read-only simulation from nonce `0` produced:

| Nonce | Transaction | Predicted address or target | Gas limit | Input hash |
| --- | --- | --- | ---: | --- |
| 0 | deploy forwarder factory | `0x291a9ff1059d225d02B1659430804486404dB507` | 1,460,088 | `0x89cb54539d29d133369969d5e7de786a0b53d74de739fe3681c5f73432ce2487` |
| 1 | deploy hook factory | `0xaE3C324B742a7576863A546120c4280b7c9E8448` | 3,833,758 | `0xd6973bf2aae7f3461d6d627b893bedb93cc1df601f5a3f8246d0ff0067ea3762` |
| 2 | deploy fee hook through factory | `0x48bB2672c7fd2a12e7fb5D46c441ccD3726520Cc` | 3,144,095 | `0xf71e1f979b4204d99acaec66b974350eb04c695f29257c4a757a9bad59960797` |
| 3 | deploy launcher | `0x51d702731db281EE223904A4663E05BfCA26C775` | 5,532,728 | `0x5cd8feacfaed787484100d58668d904cfbf2016a46402d9dc155d37d180f68cd` |

The total simulated gas limit was `13,970,669`. At Forge's live estimate of `0.082771242 gwei`, the deployment
estimate was `0.001156369624700898 ETH`. The CREATE2 hook salt was
`0x000000000000000000000000000000000000000000000000000000000000e1a3`. The source commitment was
`0x34dba63453f487b6bd3365da526326a0c3f8c7f6c7c1d96756f1dc993623cea3`. The deployed launcher bytecode
commits to a creator-selected atomic Dev Buy with a `0.0006 ETH` minimum.

The machine-readable snapshot is
[`config/mainnet-meme-preflight.v1.json`](config/mainnet-meme-preflight.v1.json). It is deliberately marked
`simulation-only`, `deployed: false`, `broadcastApproved: false` and `releaseEligible: false`.

Those addresses are valid only for that exact signer, nonce, source commitment, dependency set, and treasury. They are not deployed addresses.

### Funding ceiling

The live estimate is not a safe funding target because Mainnet fees can change before signing.

| Reviewed maximum fee | Deployment with 20% margin | Deployment plus Sepolia lifecycle gas reference with 25% margin |
| ---: | ---: | ---: |
| `0.5 gwei` | `0.0083824014 ETH` | `0.0109122775 ETH` |
| `1.0 gwei` | `0.0167648028 ETH` | `0.021824555 ETH` |
| `2.0 gwei` | `0.0335296056 ETH` | `0.04364911 ETH` |

`0.025 ETH` is a practical provisional target if the owner chooses a `1 gwei` maximum fee and wants room for the
deployment plus a small canary lifecycle. It is not a promise of cost or authorization to broadcast. If the fresh
base fee approaches that ceiling, stop and review instead of raising the cap automatically. Unused ETH remains in
the deployer wallet.

## Gate 4: broadcast only after explicit approval

Do not broadcast during preparation. After the owner approves the exact four-transaction review and the signer is funded, use a named Foundry keystore:

```bash
export ETH_KEYSTORE_ACCOUNT="reviewed-keystore-name"
forge script script/DeployMainnetMemeInfrastructureV1.s.sol:DeployMainnetMemeInfrastructureV1 \
  --rpc-url "$MAINNET_RPC_URL_A" \
  --sender "$LAUNCHER_MAINNET_DEPLOYER" \
  --account "$ETH_KEYSTORE_ACCOUNT" \
  --with-gas-price "$LAUNCHER_MAX_FEE_PER_GAS_WEI" \
  --priority-gas-price "$LAUNCHER_MAX_PRIORITY_FEE_PER_GAS_WEI" \
  --broadcast \
  --slow \
  -vvvv
```

`--slow` confirms each transaction before sending the next one. If any transaction fails or the nonce changes, stop. Inspect receipts before considering `--resume`; never blindly retry a deployment transaction.

## Gate 5: collect immutable deployment evidence

Wait for at least 12 confirmations. Record the deployment block, four transaction hashes, four deployed addresses, starting nonce, hook salt, source commitment, and runtime hashes in a dedicated evidence JSON. Do not update production application manifests yet.

Template:

```json
{
  "schemaVersion": 1,
  "chainId": 1,
  "deploymentBlock": 0,
  "startingNonce": 0,
  "sourceCommitment": "0x...",
  "hookSalt": "0x...",
  "addresses": {
    "deployer": "0x...",
    "positionForwarderFactory": "0x...",
    "hookFactory": "0x...",
    "feeHook": "0x...",
    "memeLauncher": "0x..."
  },
  "transactions": {
    "positionForwarderFactory": "0x...",
    "hookFactory": "0x...",
    "feeHook": "0x...",
    "memeLauncher": "0x..."
  },
  "runtimeCodeHashes": {
    "positionForwarderFactory": "0x...",
    "hookFactory": "0x...",
    "feeHook": "0x...",
    "memeLauncher": "0x..."
  }
}
```

For each deployed address, compute the committed runtime hash from the exact returned bytecode:

```bash
cast code "$DEPLOYED_ADDRESS" --rpc-url "$MAINNET_RPC_URL_A" | cast keccak
```

## Gate 6: verify source

Set the deployed addresses and constructor arguments:

```bash
export POOL_MANAGER="0x000000000004444c5dc75cB358380D2e3dE08A90"
export POSITION_MANAGER="0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e"
export UERC20_FACTORY="0x000000e200088D55C39a11F609E5F667729ad49b"
export TREASURY="0x4957f49620AFf3Adbbe8195a4f633E49cc93376c"
export FORWARDER_FACTORY="0x..."
export HOOK_FACTORY="0x..."
export FEE_HOOK="0x..."
export MEME_LAUNCHER="0x..."
export FORWARDER_FACTORY_TX="0x..."
export HOOK_FACTORY_TX="0x..."
export FEE_HOOK_TX="0x..."
export MEME_LAUNCHER_TX="0x..."

export FORWARDER_ARGS
FORWARDER_ARGS="$(cast abi-encode 'constructor(address)' "$POSITION_MANAGER")"
export FEE_HOOK_ARGS
FEE_HOOK_ARGS="$(cast abi-encode 'constructor(address,address)' "$POOL_MANAGER" "$TREASURY")"
export MEME_LAUNCHER_ARGS
MEME_LAUNCHER_ARGS="$(cast abi-encode 'constructor(address,address,address,address,address)' \
  "$POOL_MANAGER" "$POSITION_MANAGER" "$UERC20_FACTORY" "$FEE_HOOK" "$FORWARDER_FACTORY")"
```

Submit each contract to Sourcify:

```bash
forge verify-contract "$FORWARDER_FACTORY" src/LockedPositionFeeForwarderFactoryV1.sol:LockedPositionFeeForwarderFactoryV1 --chain 1 --compiler-version 0.8.26 --num-of-optimizations 1000 --evm-version cancun --creation-transaction-hash "$FORWARDER_FACTORY_TX" --verifier sourcify --watch
forge verify-contract "$HOOK_FACTORY" src/EthCreatorFeeHookFactoryV1.sol:EthCreatorFeeHookFactoryV1 --chain 1 --compiler-version 0.8.26 --num-of-optimizations 1000 --evm-version cancun --creation-transaction-hash "$HOOK_FACTORY_TX" --verifier sourcify --watch
forge verify-contract "$FEE_HOOK" src/EthCreatorFeeHookV1.sol:EthCreatorFeeHookV1 --chain 1 --compiler-version 0.8.26 --num-of-optimizations 1000 --evm-version cancun --creation-transaction-hash "$FEE_HOOK_TX" --verifier sourcify --watch
forge verify-contract "$MEME_LAUNCHER" src/MemeLaunchV1.sol:MemeLaunchV1 --chain 1 --compiler-version 0.8.26 --num-of-optimizations 1000 --evm-version cancun --creation-transaction-hash "$MEME_LAUNCHER_TX" --verifier sourcify --watch
```

Repeat on Etherscan with `ETHERSCAN_API_KEY` set. Add `--verifier etherscan --etherscan-api-key "$ETHERSCAN_API_KEY"` and pass the matching `--constructor-args` value for every contract with constructor arguments. The hook factory has no constructor arguments.

## Gate 7: independent verification

Run the read-only verifier from the repository root:

```bash
MAINNET_RPC_URLS="$MAINNET_RPC_URLS" \
node contracts/scripts/verify-mainnet-meme-deployment.mjs /absolute/path/to/deployment.json
```

Before source publication finishes, `REQUIRE_SOURCE_VERIFICATION=0` may be used only as an intermediate provenance check. It is not the production gate. The final run must require source verification and must pass through two agreeing RPCs.

## Gate 8: monitoring and canary

Perform a one-shot read-only monitor check:

```bash
MAINNET_RPC_URLS="$MAINNET_RPC_URLS" \
MAINNET_MEME_DEPLOYMENT_JSON=/absolute/path/to/deployment.json \
node contracts/scripts/monitor-meme-v1.mjs --once
```

Then run the continuous watcher with durable state:

```bash
MAINNET_RPC_URLS="$MAINNET_RPC_URLS" \
MAINNET_MEME_DEPLOYMENT_JSON=/absolute/path/to/deployment.json \
MEME_MONITOR_STATE_FILE=/var/lib/programmable/meme-v1.json \
node contracts/scripts/monitor-meme-v1.mjs
```

Only after the verifier and monitor pass should the app manifest be updated and a small owner-approved canary launch be prepared. A canary is a real, irreversible Mainnet action and requires separate approval and funding.

## Remaining owner gates and limitations

- fund the approved deployer after selecting the final maximum fee
- confirm the approved account is available for manual wallet signing
- explicitly approve the four-transaction broadcast
- obtain four successful, confirmed receipts and public source matches
- provision two reliable production RPCs and durable monitoring
- explicitly approve and fund the canary launch
- complete the product and legal review appropriate to public token creation

No external audit is included in this plan. The fork lifecycle, runtime-hash checks, source verification, locked position, immutable configuration, and monitoring materially improve evidence, but they do not prove the contracts vulnerability-free or make every launched token economically or legally safe. The v4 hook uses return-delta accounting, so independent review remains a known residual risk even when every operational gate passes.
