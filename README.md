# Programmable

Programmable publishes open source launch models for Uniswap v4 on Ethereum.

Each release includes its contracts, tests, security assumptions and Ethereum deployment record. Classic is the first
model available on Programmable.

[Launch a token](https://programmable.family) ·
[View the V4 token](https://etherscan.io/token/0x7987f03462200b3D8A072E02C89A8A41dCB124EE) ·
[Follow Programmable](https://x.com/0xProgrammable)

## Launch models

| Model | Purpose | Status |
| --- | --- | --- |
| Classic | Fixed supply, locked one-sided liquidity and creator fees paid in ETH | Available |
| Protected | Public launches with sandwich protection built into the pool | In development |
| Permissioned | Issuer-controlled access to swaps and liquidity | Research |
| Adaptive Fee | Pool fees that respond to market conditions | Research |
| Limit Orders | Onchain orders executed as the pool crosses their price | Research |
| Yield Reserve | Pool reserves that can use ERC-4626 vaults | Research |

Protected is in development. A model is marked `Available` once its source, tests and deployment record are public.
See [`MODELS.md`](MODELS.md) for the full catalog.

## Available now

### Classic

One transaction creates the token, opens its Uniswap v4 pool, locks the launch position and completes the creator's
initial buy. In detail, it:

1. creates a fixed-supply UERC20;
2. registers and initializes its ETH pool on Uniswap v4;
3. places the complete supply into a one-sided position;
4. sends that position to a forwarder with no operator and a maximum timelock; and
5. executes the creator's initial buy.

Classic V2 is the current immutable Ethereum release.

The current interface fixes the total swap fee at `1.00%`: `0.90%` accrues to the token creator and `0.10%` accrues
to Programmable. The deployed hook supports total fees from `1%` to `10%` in one-point increments, but the current
product does not expose those higher settings. The token has no transfer tax. The Uniswap v4 pool LP fee is zero.

## Ethereum deployment

| Contract | Address |
| --- | --- |
| Classic launcher (release V2) | [`0xD240…E6bAd`](https://etherscan.io/address/0xD240D06f8586eB799f20056054e5b527405E6bAd#code) |
| Creator fee hook | [`0x025a…b20CC`](https://etherscan.io/address/0x025a386eAa79f6067d29848FD05ccC71bEAb20CC#code) |
| Hook factory | [`0xD405…5fd67`](https://etherscan.io/address/0xD405D8d88D7E4Dae4e1dAdce9A458234D9A5fd67#code) |
| Position forwarder factory | [`0x291a…4dB507`](https://etherscan.io/address/0x291a9ff1059d225d02B1659430804486404dB507#code) |

Machine-readable addresses, transactions and runtime code hashes are in
[`deployments/ethereum.json`](deployments/ethereum.json).

## Repository map

```text
src/                 Exact sources for the current available deployment
test/                Unit, integration, fuzz, invariant and regression tests
deployments/         Public Ethereum deployment evidence
spec/                Machine-readable product and contract parameters
scripts/             Reproducible dependency bootstrap
MODELS.md             Launch model catalog and status
ARCHITECTURE.md       Architecture of the current available model
SECURITY.md           Security status, trust model and disclosure
```

## Build and test

The dependency script checks out every upstream repository at a fixed commit:

```bash
./scripts/bootstrap-deps.sh
forge fmt --check
forge build
forge test
FOUNDRY_PROFILE=ci forge test
```

The contracts use Solidity `0.8.26`, Cancun opcodes, optimizer runs set to `1,000`, and disabled CBOR metadata. See
[`foundry.toml`](foundry.toml) for the complete compiler configuration.

## Security status

The current Classic deployment has not received an independent smart-contract audit or public security contest. The
repository includes unit, integration, fuzz, invariant and regression coverage. Every future model will have its own
permissions, invariants and deployment record. Read [`SECURITY.md`](SECURITY.md) before integrating.

## License

[MIT](LICENSE)
