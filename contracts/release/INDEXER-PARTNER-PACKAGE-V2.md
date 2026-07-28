# Programmable Classic partner package

This package is for launchpad-level integrations. It is not a request to
whitelist individual tokens and it is not evidence that a platform has
completed an integration.

## Ethereum Mainnet release

- Launcher: `0xD240D06f8586eB799f20056054e5b527405E6bAd`
- Fee hook: `0x025a386eAa79f6067d29848FD05ccC71bEAb20CC`
- PoolManager: `0x000000000004444c5dc75cB358380D2e3dE08A90`
- PositionManager: `0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e`
- Public registry: `https://programmable.family/api/indexers/v1/tokens`
- Token list: `https://programmable.family/api/indexers/v1/token-list`

The registry is the easiest metadata source. It exposes the confirmed
snapshot, image, description, website, X and Telegram links, canonical pool,
position NFT and explicit fee split. The token list carries the same fields in
the `extensions.programmable` object.

## Provenance topics

Accept a launch only when all three Launcher events share the same token and
launch hash:

- `MemeTokenLaunched`: `0x54f861f401872200b25acd4a9f53153ac06a7be4562b3e43025a4a85740a5675`
- `MemeLiquidityConfigured`: `0x766c3641f5dfe006b69474f0aaa7b03afe255b68ea8ce1c8e4f743af5c73ca15`
- `MemeCreatorInitialBuy`: `0x4396be67bb4168f821727bfb4fb896333da010d963a5902642dea1fc9b3c0c0b`

Fee configuration and executed volume:

- `PoolFeeDisclosure`: `0x9ff62ee9c4064a06789af00b34d3d86315df7110bd605a6296e90a54a7876f67`
- `NativeSwapFeesAccrued`: `0x8a3c632373e78a4c202cd6f4fcfd26550c55614028d55f3b5aa2227caa56da52`

Do not treat a bare hook registration as Programmable provenance. The hook is
shared and only the verified Launcher establishes the platform record.

## Fee model

- ERC-20 transfer tax: 0%
- Canonical-pool buy hook fee: the selected 1–10%
- Canonical-pool sell hook fee: the same selected 1–10%
- Programmable share: 0.10 percentage points inside the selected total
- Creator share: selected total minus 0.10 percentage points
- Canonical-pool LP fee: 0 pips
- Buy and sell fee currency: native ETH

The fee is Uniswap v4 custom accounting, not an ERC-20 transfer tax. A
simulation that only looks for transfer-tax balance differences will produce
the wrong result.

## Position lock

The full-range PositionManager NFT is delivered to the immutable position
forwarder created for the launch. For the current release:

- operator is `address(0)`
- timelock is `uint256.max`
- the forwarder has no principal-withdrawal function
- fee claims do not transfer or reduce the LP position

Indexers should read the position NFT owner and forwarder configuration. Do
not classify the position from ERC-20 LP-token burn heuristics because
Uniswap v4 positions are PositionManager NFTs.

## Metadata

The upstream UERC20 `tokenURI()` includes the canonical description, website
and image, but it does not render `metadata().extraData`. Programmable stores
versioned X and Telegram links in `extraData` and decodes them in the public
registry. Integrators should consume the registry or decode `metadata()`
directly.

## Mainnet reference token

- Token: `0x05204A4Ce651452892A620950Bdc2AdedBF63B0A`
- Pool ID: `0xb12253d75eb143edcb6aab74f543802c6fa72998e092bc7bd1acf27a42adc2ea`
- Successful buy: `0xbd416570fc9de744a53919a6c7e7ea9f849fe3f5e510a13376e6967c68145b48`
- Successful sell: `0x4b461cccf14876cd9ecf05fcf0f295a6337079ceb3a3f4fb5b6fdddc6ada35c1`
- Position NFT: `351734`
- Position owner: `0x9020EeF40E36546Bf34f15070A8d9BCA2eBF4BB8`

The reference token is test evidence, not a recommendation or a claim of
third-party approval.

## Current integration issue

As checked on 27 July 2026, Mobula simultaneously reported zero transfer tax,
no honeypot and an incorrect 100% sell-fee headline for the reference token.
Fomo displayed the downstream warning. The successful Mainnet sell and the
hook disclosure contradict that classification. This should be handled as a
launchpad/factory integration issue, not by changing or forking UERC20.
