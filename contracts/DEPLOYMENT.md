# Deployment runbook

## Current release status

| Environment | Manifest state | Transaction preparation |
| --- | --- | --- |
| Ethereum mainnet V2 | `not-deployed` | Disabled |
| Ethereum Sepolia V2 | `ready` | Enabled when the app runs with the rehearsal network configuration |

The exact current Classic release is deployed and source-verified on Sepolia. Its signed lifecycle atomically launched
an official UERC20 v2 token with a 0.0006 ETH creator Dev Buy, sold through the official Universal Router after Permit2
authorization, and claimed both creator and Programmable fees. Two independent RPCs reconcile the complete evidence.

There has been no external smart-contract audit or public contest. Sepolia evidence is not production approval.
Mainnet remains blocked on a frozen passing release, production indexing and monitoring, deployer funding, a fresh
final simulation and explicit approval for the broadcast.

## Release metadata requirement

The pinned official `uerc20-factory` dependency is tag `v2.0.0`, commit `6f18f1cdf80dc173d33d3cd6bbe91ee52c314f68`.

```solidity
struct UERC20Metadata {
    string description;
    string website;
    string image;
    bytes extraData;
}
```

The current encoder uses `0x` when no social links are supplied. Otherwise it encodes versioned UTF-8 JSON
`{v:1,x?,telegram?}`. The verified Test2 lifecycle stored and read back the nonempty bytes value
`0x7b2276223a312c2278223a2268747470733a2f2f782e636f6d2f656c6f6e6d75736b227d`, which decodes to
`{"v":1,"x":"https://x.com/elonmusk"}`.

## Public configuration

- Programmable treasury: `0x4957f49620AFf3Adbbe8195a4f633E49cc93376c`
- Owner-approved Mainnet deployment wallet: `0x2Bb333d48DFAF1596D9036671d2E43168994249E`
- Sepolia deployment wallet: `0x2Bb333d48DFAF1596D9036671d2E43168994249E`
- Creator LP custody: official Uniswap `PositionFeesForwarder`
- Transfer operator: zero address
- Approval block: `type(uint256).max`
- LP fee recipient: immutable launch creator

The Sepolia deployment wallet and Ethereum treasury were EOAs when checked on 2026-07-27. Funding and balances are
dated operational facts and must be rechecked before another broadcast.

## Current verified Sepolia deployment

| Contract | Address | Transaction | Block | Runtime code hash |
| --- | --- | --- | ---: | --- |
| `EthCreatorFeeHookFactoryV2` | [`0xb974…bcE0`](https://eth-sepolia.blockscout.com/address/0xb974A9EF7B75650428389b63fa6C4906450ABcE0) | [`0xa0fd…d4d0`](https://eth-sepolia.blockscout.com/tx/0xa0fdae1b611d48dd6dba051fe9705b53b4fb75aa3fe3a09561d648f6671ed4d0) | 11,361,267 | `0x8dd7205952dba3efad6f58a4b0193171c4ed825145319c908bc47dab1911c128` |
| `EthCreatorFeeHookV2` | [`0x0c9D…20Cc`](https://eth-sepolia.blockscout.com/address/0x0c9De2721F537C311e05ad3671A17136C14a20Cc) | [`0x9c96…f1b`](https://eth-sepolia.blockscout.com/tx/0x9c9616ee385ca8d8fb18f554de90737936d4369631d9afa6e284c5025a2e5f1b) | 11,361,269 | `0xa1094bdd6c3bd1ba4d17d8f321f0e52a95a6247fae287aae90b008a7eacb05b7` |
| `MemeLaunchV1` | [`0x6Ae8…FF4e`](https://eth-sepolia.blockscout.com/address/0x6Ae84F188468722d8b5970Bc3924C9C31b75FF4e) | [`0x2e47…b624`](https://eth-sepolia.blockscout.com/tx/0x2e473ffcec73d531a2b3bdb50549fea2f1453d7d74053e1985dfbaef1c54b624) | 11,361,270 | `0xf9977ba3a5c859d34beff333d129ae135190423a20e2a6ec5cb19588ff552e5f` |

Blockscout reports the three contracts verified with Solidity `0.8.26`, optimizer enabled for 1,000 runs and Cancun.
The launcher is bound to the official Sepolia PoolManager, PositionManager and UERC20Factory, the verified permanent
position factory and the configured treasury.

## Current verified atomic Dev Buy lifecycle

- Token: [`0x6f71…d771`](https://eth-sepolia.blockscout.com/address/0x6f71A3CDa868d613552f8230790274BbEBB5d771)
- Pool ID: `0x541eca58f02c9bee85cf4edbbc2ecfd8cbd6691c275b232f2f9b9c77ef8f82a6`
- Launch hash: `0x3d33fc925bdb72a7f4b4e3e71495dcd82575271f07361ef2db40b43f54b97fcc`
- Position NFT: `37835`
- Permanent position recipient: `0xbdb2d2F49771Ec34d37DF9fADCBad058e96Db8DC`
- Position liquidity: `36819258015569838458222`

| Lifecycle step | Transaction | Block | Verified result |
| --- | --- | ---: | --- |
| Atomic launch and Dev Buy | [`0xd15b…c141`](https://eth-sepolia.blockscout.com/tx/0xd15b074027a3516ce6ee65fab94df3a2ebbc5170ec7669f6420052a60b82c141) | 11,361,308 | 0.0006 ETH bought `437971781612384114831424` TEST2 units during the same launch transaction |
| Permit2 approval | [`0x32ef…9f41`](https://eth-sepolia.blockscout.com/tx/0x32eff8ce7751eb811dcc94259c3867dd0d4e76c7617e9e6e1b62970bf73a9f41) | 11,361,309 | Official Universal Router authorization |
| Sell | [`0x2582…f4d5`](https://eth-sepolia.blockscout.com/tx/0x258278cb5662ab9d10966c9c48fe1849cff9e8162d73170f85471add0e7ff4d5) | 11,361,331 | Exact-input sell with exactly 30,000 TEST2 retained |
| Creator claim | [`0x0f3a…ed71`](https://eth-sepolia.blockscout.com/tx/0x0f3aebde7e6bff6b41e19b3e26d3705c637a0f99b6de07fc5e4644e7c1e2ed71) | 11,361,333 | `10,379,961,423,422` wei paid to the immutable creator |
| Programmable claim | [`0x57a5…a428`](https://eth-sepolia.blockscout.com/tx/0x57a58b6dd721d87430e51ad894da48d24bb0dc261bed8019e0fdf4f27b14a428) | 11,361,341 | `1,153,329,047,046` wei paid to the immutable treasury |

The 1.00% swap fee remained inclusive: 0.90 percentage points accrued to the creator and 0.10 percentage points to
Programmable. After both claims, the hook reported zero creator fees, zero launcher fees, zero native claims and zero
direct ETH balance.

## Current Mainnet V2 preflight

The read-only simulation at repository commit `f3f99c452ced7b90864f8f4b6e172c8a12ea445e` used the current confirmed and
pending deployer nonce `7`. Two independent RPCs agreed on the nonce, the `0.016860325627722211 ETH` balance, official
dependency runtime hashes and vacant predicted addresses.

| Step | Nonce | Predicted address | Reviewed gas limit |
| --- | ---: | --- | ---: |
| `EthCreatorFeeHookFactoryV2` | 7 | `0xD405D8d88D7E4Dae4e1dAdce9A458234D9A5fd67` | 4,047,374 |
| `EthCreatorFeeHookV2` | 8 | `0x025a386eAa79f6067d29848FD05ccC71bEAb20CC` | 3,553,314 |
| `MemeLaunchV1` | 9 | `0xD240D06f8586eB799f20056054e5b527405E6bAd` | 5,532,728 |

Foundry estimated `0.002096161040827056 ETH` at `0.159605166 gwei`. The wallet handoff is capped at `0.5 gwei` with
an aggregate worst-case deployment ceiling of `0.006566708 ETH`. It fails closed if the nonce, dependency code,
predicted-address vacancy, balance, live gas estimate or reviewed gas ceiling changes. No Mainnet V2 transaction has
been approved, signed or submitted. Any unrelated transaction from the deployer invalidates these addresses and
requires a fresh simulation.

## Historical pre-initial-buy Sepolia deployment

| Contract | Address | Transaction | Block | Runtime code hash |
| --- | --- | --- | ---: | --- |
| `EthCreatorFeeHookFactoryV1` | [`0xDc7d…12A9`](https://eth-sepolia.blockscout.com/address/0xDc7db04244b58Cb3E921958F163203e8b40e12A9) | [`0xc756…a246`](https://eth-sepolia.blockscout.com/tx/0xc756d5976cdc0be916c40ff3a627a38b455744ee37f88cb2e69ae03d2802a246) | 11,358,702 | `0x3014de1f275dc60ae289f7a3a8ab038fdf76929aff19e0efdb19138e4ce8e0d5` |
| `EthCreatorFeeHookV1` | [`0x9F94…a0cC`](https://eth-sepolia.blockscout.com/address/0x9F943aCeFc675DDE34F3998069A958Eb726Da0cC) | [`0xcad0…63f3`](https://eth-sepolia.blockscout.com/tx/0xcad0ebc028a6a56ee5cdbd4cdbc316dd68926f510da36832bdd9de09625363f3) | 11,358,709 | `0x0e0dd0bc1b007e979c0a93412afd282fcbe88b270dc2f26edb94310c334fbf06` |
| `MemeLaunchV1` | [`0x7354…aceB`](https://eth-sepolia.blockscout.com/address/0x73543625D0F8B7ae917135709dD8f25e0cd2aceB) | [`0xb44a…910b`](https://eth-sepolia.blockscout.com/tx/0xb44a3b153110441ec0dbf4b44978473f27fd040ab2fcc26a5105dd6734d6910b) | 11,358,713 | `0x29358eef43ecd6ed09d58b98415a584b6c4e8567c64197af9f035cdb52ec9efb` |

Blockscout reports the three contracts verified with Solidity `0.8.26`, optimizer enabled for 1,000 runs and Cancun.
The launcher is bound to the official Sepolia PoolManager, PositionManager, UERC20Factory, the verified permanent
position factory and the configured treasury. That release reused the already verified
`LockedPositionFeeForwarderFactoryV1` at `0xaE3C324B742a7576863A546120c4280b7c9E8448`.

## Historical pre-initial-buy lifecycle

- Token: [`0x69AE…c0e9`](https://eth-sepolia.blockscout.com/address/0x69AE118837CFe3BE671f59f3D64bCFB8bf1Dc0e9)
- Pool ID: `0x244b724395505dcb5f07c3c89190472ae6f585f70b6934c94e0ca83d0ef26222`
- Launch hash: `0x5e18f1622fe1f93a948040496a3a912903c1a9ec71fa5fe87abef02c2821c6ac`
- Position NFT: `37831`
- Permanent position recipient: `0xdCC451b6976Ed1c23dD9080b240614390E5A0292`
- Position liquidity: `36819258015569838458222`

| Lifecycle step | Transaction | Block | Verified result |
| --- | --- | ---: | --- |
| Launch | [`0x979f…a359`](https://eth-sepolia.blockscout.com/tx/0x979f8d1981a75cd4f44c2fbd1caf9d49cfd498d8fa96948cb24a6a62973fa359) | 11,358,748 | Official UERC20 v2, nonempty dynamic metadata bytes, one billion fixed supply and permanent one-sided position |
| Buy | [`0x74a8…ace`](https://eth-sepolia.blockscout.com/tx/0x74a83a80bb62830359e4caab9b4dbde7279e52563861ad602bc188224feb4ace) | 11,358,770 | 0.0001 native ETH through the official Universal Router |
| Permit2 approval | [`0x16b6…e7c`](https://eth-sepolia.blockscout.com/tx/0x16b6f2085e4e5d31911efb625e7a7296e48385494f2ab8790343b5799e073e7c) | 11,358,775 | Official Universal Router authorization |
| Sell | [`0x743c…d43`](https://eth-sepolia.blockscout.com/tx/0x743ccd06aa20079e7107bc301d104643f4559df3dc6506b838d44e37a6f6bd43) | 11,358,780 | Exact-input sell with exactly 30,000 PMV2 retained |
| Creator claim | [`0x4e26…a1ab`](https://eth-sepolia.blockscout.com/tx/0x4e26d49a6af75c0b6776406e2fc6dcd3b5d87002bc9579b7d8483a126a9ea1ab) | 11,358,784 | `1,424,961,423,422` wei paid to the immutable creator |
| Programmable claim | [`0xab95…8409`](https://eth-sepolia.blockscout.com/tx/0xab95af6e29db575abba5f500d66c46efcdb2dd98695f1ef2b5b25e62a1c88409) | 11,358,787 | `158,329,047,046` wei paid to the immutable treasury |

The verified swap fee was 1.00% inclusive: 0.90 percentage points accrued to the creator and the fixed 0.10
percentage points accrued to Programmable. The launcher share was deducted from the creator-selected total and was
not added on top. After both claims, the hook reported zero creator fees, zero launcher fees, zero native claims and
zero direct ETH balance.

## Read-only verification

```sh
npm run contracts:verify
npm run contracts:official-deployments
npm run contracts:slither
npm run contracts:sepolia:validate
npm run contracts:sepolia:lifecycle:verify
```

The lifecycle verifier is pinned to the current release addresses and all five atomic Dev Buy lifecycle receipts. It
checks the metadata ABI, runtime hashes, token provenance, position custody, fee events and exact native and token
balance deltas through two independent RPCs. The older lifecycles remain separately marked historical in the manifest.

## Local signing

Never send a private key through chat, commit it, put it in `.env.local` or pass it directly on a command line. Import the test key through Foundry's hidden prompt:

```sh
cast wallet import launcher-sepolia --interactive
```

Confirm that the imported account is exactly the configured test deployment wallet:

```sh
cast wallet address --account launcher-sepolia
```

## Reproduce the deployment simulation

Run the exact three-contract deployment as a read-only simulation with a fresh nonce before any future replacement:

```sh
export SEPOLIA_RPC_URL=https://your-sepolia-rpc.example
export LAUNCHER_TEST_DEPLOYER=0x2Bb333d48DFAF1596D9036671d2E43168994249E

forge script script/DeploySepoliaMemeInfrastructureV1.s.sol:DeploySepoliaMemeInfrastructureV1 \
  --rpc-url "$SEPOLIA_RPC_URL" \
  --sender "$LAUNCHER_TEST_DEPLOYER"
```

Before a new Sepolia broadcast:

1. Freeze the exact commit and dependency locks
2. Run the full local, fork and static-analysis gates
3. Recheck official deployment addresses and runtime code
4. Recheck deployer nonce, balance and pending transactions
5. Review predicted addresses and gas
6. Obtain explicit operator approval

After any replacement deployment, source-verify every contract, record exact runtime hashes and deployment blocks,
then repeat the complete nonempty-metadata lifecycle before changing the manifest back to `ready`.

Do not reuse a failed or uncertain broadcast command until its nonce and receipt state have been checked.

## Historical Classic deployment

The following Sepolia contracts are retained for traceability. They are not the current release deployment and must not enable the frontend gate.

| Contract | Address | Transaction | Block | Runtime code hash |
| --- | --- | --- | ---: | --- |
| `EthCreatorFeeHookFactoryV1` | [`0xDdf7…C4C49`](https://eth-sepolia.blockscout.com/address/0xDdf74E1E9e5a4BD4CA0D5ab93AC4FbD6a8dC4C49) | [`0xe33e…89c6`](https://eth-sepolia.blockscout.com/tx/0xe33e48c77a481c578da762a41b4ef294cd3c13af5fc6e162d7dabdfb5c1589c6) | 11,357,423 | `0x3014de1f275dc60ae289f7a3a8ab038fdf76929aff19e0efdb19138e4ce8e0d5` |
| `EthCreatorFeeHookV1` | [`0x3cd9…60cC`](https://eth-sepolia.blockscout.com/address/0x3cd9b2401D8084e0c2dC529dB25CefBbBF6160cC) | [`0xffae…d95`](https://eth-sepolia.blockscout.com/tx/0xffae296effe4da4f5dc9d03ca914c1fbf7df853abfd4904aa21b5531ebfecd95) | 11,357,426 | `0x0e0dd0bc1b007e979c0a93412afd282fcbe88b270dc2f26edb94310c334fbf06` |
| `MemeLaunchV1` | [`0xbF90…1911F`](https://eth-sepolia.blockscout.com/address/0xbF90Abd6e816b545Ab9DDed77d1E694381C1911F) | [`0x76ee…2fc`](https://eth-sepolia.blockscout.com/tx/0x76eed426677e2053a487daac863abdd04806d38fb578e780696994ca548132fc) | 11,357,476 | `0xe7cb4172d9267007d5d83090b1fb2c3e35a965bd8492ee59059ed9360448188b` |

Blockscout verified these contracts with Solidity `0.8.26`, Cancun, 1,000 optimizer runs, no metadata bytecode hash and the recorded constructor configuration. Source verification does not repair the metadata ABI mismatch or make this deployment release eligible.

## Historical lifecycle

The source-verified [`Programmable Test Token`](https://eth-sepolia.blockscout.com/address/0xc335321D60E583ba617B43918Eb7e38768AA638a) is an official Uniswap `UERC20` from source ref `v2.0.0`.

- Token: `0xc335321D60E583ba617B43918Eb7e38768AA638a`
- Pool ID: `0xe5173e4560219a4e3bec0f0c07f9e187cc56811ce0c57b85c2d9c6ae6a6561ab`
- Position NFT: `37828`
- Position forwarder: `0x595300dC132A510c245253Ede7a6A68eBcEfE2a3`

The position forwarder's immutable operator is zero and its timelock is `type(uint256).max`.

| Lifecycle step | Transaction | Block | Historical result |
| --- | --- | ---: | --- |
| Launch | [`0x671a…89d`](https://eth-sepolia.blockscout.com/tx/0x671a14eddb8aa3edd0e64520d3fc4e92619482e6ba8398902d9cda9c8108d89d) | 11,357,532 | One billion PRGTEST, 1.00% inclusive swap fee, permanent one-sided position |
| Buy | [`0x6902…adf`](https://eth-sepolia.blockscout.com/tx/0x69022803b446b66fca73895f6555bd70c373b4e1f781d0b076a00331c3f5fadf) | 11,357,602 | 0.0001 native ETH through the official Universal Router |
| Permit2 approval | [`0xc24e…033`](https://eth-sepolia.blockscout.com/tx/0xc24efd1d9cae6ff9fd51ec346406ad3ef9f8fb9cbfb41d95701b838ed79f3033) | 11,357,610 | Official Universal Router authorized for one day |
| Sell | [`0xe21b…979`](https://eth-sepolia.blockscout.com/tx/0xe21be96eeea4028fe0d0c9e5c9021a10ca0d8b28194b4169518a681c79406979) | 11,357,612 | 43,021.948229 PRGTEST sold; exactly 30,000 PRGTEST retained |
| Creator claim | [`0xa528…b68`](https://eth-sepolia.blockscout.com/tx/0xa528f2c30bbc158464bc08dd95a67c2092c7153d82cb46fbb6b0c68b07b7eb68) | 11,357,616 | 1,424,961,423,422 wei paid to the immutable creator |
| Programmable claim | [`0xc3e1…e0e`](https://eth-sepolia.blockscout.com/tx/0xc3e1a946bb5c2e04257c3ca4d9831dd088d405d0049b9498ab6998786c547e0e) | 11,357,619 | 158,329,047,046 wei paid to the immutable treasury |

Two independent RPCs previously reconciled receipt targets and values, runtime hashes, ETH and token balance deltas, inclusive fee math, claim events, canonical position ownership and nonzero liquidity. The manifest now records this lifecycle as `historical-invalid-metadata-abi` with `releaseEligible: false`.

## Other historical Sepolia contracts

An earlier four-contract experiment was deployed from the same test wallet on 2026-07-26 and bound to commit `5d97ad58870ca328d411e837ab8580ebd2383c71`. These contracts are not Classic products, release variants or frontend choices.

| Contract | Address | Transaction | Block | Runtime code hash |
| --- | --- | --- | ---: | --- |
| `PlatformFeeHookFactoryV1` | [`0x291a…B507`](https://eth-sepolia.blockscout.com/address/0x291a9ff1059d225d02B1659430804486404dB507) | [`0x7874…ca6c`](https://eth-sepolia.blockscout.com/tx/0x7874d856fecd2616b9b125ee7ed85f876c93596adbc9189f8420f0b97abbca6c) | 11,353,879 | `0x7792dba76c190e746dc7fbf7f8a8f690f7cf5ce6fab448c858069b1852974306` |
| `LockedPositionFeeForwarderFactoryV1` | [`0xaE3C…8448`](https://eth-sepolia.blockscout.com/address/0xaE3C324B742a7576863A546120c4280b7c9E8448) | [`0x4969…faf6`](https://eth-sepolia.blockscout.com/tx/0x4969ca925b82c881c978f1d88722af61eea04f1294da55c45e5e7392e294faf6) | 11,353,893 | `0x49e040806b0664b2fa4f41c5abc11241cdb8f847c538c13d6874c32804b74ebc` |
| `DirectLiquidityLauncherV1` | [`0x5fc6…Fa1E`](https://eth-sepolia.blockscout.com/address/0x5fc6aDd062329742EFefA9c4b11C355AAe02Fa1E) | [`0xc61c…dd8d`](https://eth-sepolia.blockscout.com/tx/0xc61ca9972391717c454e6bdf9cbbf4bfb5aa1987cf0f29542f6523e9ed6cdd8d) | 11,353,896 | `0x41fa4dbe9709e93f601e0406a3a9d61826144ca56e16f748e063f850fc0af48b` |
| `BoundedDynamicFeeHookFactoryV1` | [`0x51d7…C775`](https://eth-sepolia.blockscout.com/address/0x51d702731db281EE223904A4663E05BfCA26C775) | [`0x8188…69d97`](https://eth-sepolia.blockscout.com/tx/0x8188cfa559981c4e03f55a99e19c7f87c5917e4e6a981c1793e5ba7a09e69d97) | 11,353,915 | `0xe6bbbdba0194caba268f5546db2574dc416b3c74331bd44f33d04d4b2251ffbc` |

## Evidence still required

- Durable production event and StateView indexing, reorg reconciliation and monitoring
- Resolution or explicit acceptance of the recorded transitive production dependency findings
- Frozen-commit local and remote CI evidence
- Fresh provider-backed wallet login, disconnect, reconnect and transaction-review rehearsal
- Fresh Mainnet nonce, balance, dependency-code and predicted-address checks after funding
- Final read-only Mainnet simulation, explicit approval for the exact gas ceiling and broadcast, and a monitored canary lifecycle
- Release language that states the absence of an external audit without making safety or scanner-compatibility claims
