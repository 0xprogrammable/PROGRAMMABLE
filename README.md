# Programmable

Programmable is an interface for launching Uniswap v4 tokens on Ethereum.

The contracts behind Classic V2 live here, together with the tests and deployment record. The app, indexer, provider
configuration and production tooling do not.

[Launch a token](https://programmable.family) ·
[View the V4 token](https://etherscan.io/token/0x7987f03462200b3D8A072E02C89A8A41dCB124EE) ·
[Follow Programmable](https://x.com/0xProgrammable)

## Classic V2

One transaction creates the token, opens its Uniswap v4 pool, locks the launch position and completes the creator's
initial buy. In detail, it:

1. creates a fixed-supply UERC20;
2. registers and initializes its ETH pool on Uniswap v4;
3. places the complete supply into a one-sided position;
4. sends that position to a forwarder with no operator and a maximum timelock; and
5. executes the creator's initial buy.

The current interface fixes the total swap fee at `1.00%`: `0.90%` accrues to the token creator and `0.10%` accrues
to Programmable. The deployed hook supports total fees from `1%` to `10%` in one-point increments, but the current
product does not expose those higher settings. The token has no transfer tax. The Uniswap v4 pool LP fee is zero.

## Ethereum deployment

| Contract | Address |
| --- | --- |
| Classic V2 launcher | [`0xD240…E6bAd`](https://etherscan.io/address/0xD240D06f8586eB799f20056054e5b527405E6bAd#code) |
| Creator fee hook | [`0x025a…b20CC`](https://etherscan.io/address/0x025a386eAa79f6067d29848FD05ccC71bEAb20CC#code) |
| Hook factory | [`0xD405…5fd67`](https://etherscan.io/address/0xD405D8d88D7E4Dae4e1dAdce9A458234D9A5fd67#code) |
| Position forwarder factory | [`0x291a…4dB507`](https://etherscan.io/address/0x291a9ff1059d225d02B1659430804486404dB507#code) |

Machine-readable addresses, transactions and runtime code hashes are in
[`deployments/ethereum.json`](deployments/ethereum.json).

## Repository map

```text
src/                 Exact Classic V2 contract sources
test/                Unit, integration, fuzz, invariant and regression tests
deployments/         Public Ethereum deployment evidence
spec/                Machine-readable product and contract parameters
scripts/             Reproducible dependency bootstrap
ARCHITECTURE.md       Launch, swap and claim flows
SECURITY.md           Trust model, invariants and disclosure
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

Classic V2 has not received an independent smart-contract audit or public security contest. The repository includes
unit, integration, fuzz, invariant and regression coverage. Read [`SECURITY.md`](SECURITY.md) before integrating.

## License

[MIT](LICENSE)
