# Prediction asset identity V2

This document defines the website boundary between token discovery and a released Prediction V2 market. It is a
candidate integration contract, not evidence that Protocol V2 is deployed or enabled.

## Two keys with different authority

`selectionKey` is a website and provider lookup key. Examples are `preset:btc`,
`evm:8453:0x…`, and `solana:<mainnet-genesis-base58>:<mint>`. Discovery responses contain this key only. Current USD
price and market capitalization are informational display data and cannot make a market eligible for settlement.

`onchainAssetKey` is the exact `AssetRegistryV2` key:

```text
keccak256(abi.encode(
  keccak256("PROGRAMMABLE_ASSET_KEY_V2"),
  sourceNamespace,
  sourceChain,
  assetIdentifier,
  assetStandard
))
```

The website must never pass `selectionKey` where a protocol `bytes32 assetKey` is required.

## Canonical identities

Preset assets are global native identities:

```text
GLOBAL_CRYPTO / GLOBAL / BTC / NATIVE
GLOBAL_CRYPTO / GLOBAL / ETH / NATIVE
GLOBAL_CRYPTO / GLOBAL / SOL / NATIVE
GLOBAL_CRYPTO / GLOBAL / BNB / NATIVE
```

An EVM custom token uses `EIP155`, a numeric chain ID encoded as `bytes32`, a nonzero contract address zero-left-padded
to `bytes32`, and `ERC20`. The supported source chain IDs are Ethereum `1`, BNB Chain `56`, Base `8453`, and Robinhood
Chain `4663`. The user must choose the source chain; the same address can exist on several chains, so the website does
not claim to infer it from a contract address.

A Solana custom token uses `SOLANA`, the raw decoded mainnet genesis hash, the raw decoded nonzero 32-byte mint, and the
raw Token Program or Token-2022 program public key. Discovery can look up the mint without deciding its program. A
release entry must bind the exact verified program before the market becomes available.

## Release-ready entry

One ready or paused entry binds all of the following:

- `selectionKey` for the exact UI selection;
- `onchainAssetKey` recomputed from the included canonical four-field identity;
- Registry snapshot `assetKey`, positive revision, and nonzero `snapshotHash`;
- nonempty release ID and Oracle policy ID;
- the Robinhood Chain settlement profile and the `usd-price-at-utc` market type.

The runtime validator fails closed if identity, hash, snapshot, release, network, or status disagree. Missing entries are
unsupported. Multiple matching entries are ambiguous. Discovery availability never overrides either state.
