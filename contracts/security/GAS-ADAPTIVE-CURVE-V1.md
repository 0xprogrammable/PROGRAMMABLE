# Adaptive Curve V1 gas snapshot

Measured with Foundry, Solidity 0.8.26, Cancun EVM, optimizer enabled with
1,000 runs. These are test-harness measurements, not gas-price estimates.

Command:

```sh
forge test --match-path test/AdaptiveCurveFeeHookV1.t.sol --gas-report
```

## Contract calls

| Call | Gas |
| --- | ---: |
| Factory deploy, successful median | 3,218,735 |
| Register five-point curve, successful | 311,319 |
| Current fee, median | 18,384 |
| Fee lookup, median across tested indexes | 16,199 |
| Gross fee quote, median | 1,127 |
| Exact-output fee quote | 1,444 |
| Creator claim, average | 66,777 |
| Launcher claim, average | 57,475 |

## End-to-end unit fixtures

These figures include the Foundry swap router and assertions around the hook:

| Fixture | Gas |
| --- | ---: |
| Buy exact ETH input | 322,261 |
| Buy exact token output | 275,547 |
| Sell exact token input with band crossing check | 353,919 |
| Sell exact ETH output | 317,856 |

## Atomic launcher

Command:

```sh
forge test --match-contract AdaptiveCurveLaunchV1Test --gas-report
```

| Fixture | Gas |
| --- | ---: |
| Zero-buy atomic launch | 6,464,014 |
| Atomic launch with 0.002 ETH creator buy | 6,430,218 |
| First public buy after zero-buy launch, complete fixture | 7,947,511 |
| Optional-buy custody fuzz, median launch call | 6,389,046 |

The launcher deploys a dedicated hook, token and permanent position recipient
inside the same transaction. The codehash-pinned position planner adds one
static call to the launch. These figures are therefore materially higher than
the shared-hook Classic path.

## Bytecode

From `forge build --sizes`:

| Contract | Runtime | Initcode | Runtime margin |
| --- | ---: | ---: | ---: |
| `AdaptiveCurvePositionPlannerV1` | 7,725 bytes | 7,753 bytes | 16,851 bytes |
| `AdaptiveCurveFeeHookV1` | 15,571 bytes | 16,553 bytes | 9,005 bytes |
| `AdaptiveCurveFeeHookFactoryV1` | 18,162 bytes | 18,190 bytes | 6,414 bytes |
| `AdaptiveCurveLaunchV1` | 19,038 bytes | 28,025 bytes | 5,538 bytes |

The factory initcode embeds the hook creation code. Every runtime size is below
the 24,576-byte EIP-170 limit in this build. The launcher also passes the
stricter internal ceiling of 23,000 bytes. The higher launcher initcode embeds
the planner runtime hash used by its constructor trust check.
