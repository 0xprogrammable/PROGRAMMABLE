# Stock-Paired V2 route and registry review

## Scope

Stock-Paired V2 expands the reviewed quote-asset set without changing the swap-fee hook, launch
economics, reward vault, position planner or permanent lock design.

- `StockQuoteRegistryV2`
- `DeployMainnetStockPairedInfrastructureV2`
- `config/stock-paired-assets.v2.json`
- `contracts/scripts/audit-stock-paired-v2.mjs`
- the Stock-Paired quote-asset selector and ETH route map

The V2 deployment creates new instances because the V1 registry and every contract that references it
are immutable. It does not modify the deployed V1 stack.

## Reviewed assets

| Asset | Symbol | Reviewed stock-to-USDC pool fee |
| --- | --- | ---: |
| NVIDIA | `NVDAon` | 1.00% |
| S&P 500 | `SPYon` | 0.30% |
| Alphabet | `GOOGLon` | 1.00% |
| Silver | `SLVon` | 1.00% |
| Tesla | `TSLAon` | 1.00% |
| Apple | `AAPLon` | 1.00% |
| Alibaba | `BABAon` | 1.00% |
| Copper Miners | `COPXon` | 1.00% |
| Circle | `CRCLon` | 1.00% |
| 20+ Year Treasuries | `TLTon` | 1.00% |
| Oil | `USOon` | 1.00% |

The official Ondo asset page and logo URL are pinned next to each token and route in the release
configuration. Logos are presentation data, not evidence that a route or token is safe.

## Admission checks

An asset is included only when all of the following pass on Ethereum Mainnet:

1. Ondo's GM token manager reports the token as accepted.
2. Token runtime, beacon runtime, implementation runtime and manager runtime match the reviewed hashes.
3. The token reports the expected symbol and 18 decimals.
4. The Uniswap V3 factory resolves the exact reviewed USDC pool and fee tier.
5. The pool runtime matches the reviewed runtime hash.
6. A `0.01 ETH` WETH → USDC → stock → USDC → WETH quote returns at least 90% of its input.
7. Two independent RPC providers agree at the same block.

`GMEon` and `RDDTon` currently have no reviewed ETH route. `SPCXon` has an official token and pool but
failed the round-trip floor. They are not exposed as launchable assets.

The route floor is an admission and monitoring rule, not a promise of future liquidity or execution.
Every user transaction still needs a fresh quote, deadline and minimum output.

## Contract behavior

`StockQuoteRegistryV2` is ownerless and fixes exactly eleven addresses at construction. Before every
new launch it repeats the manager-acceptance, shared-runtime, token-runtime, decimals and symbol
checks. A manager rejection or runtime change stops new launches.

The registry cannot stop Ondo from pausing, restricting or upgrading an asset, and it cannot protect
an already-created pool from issuer controls. Token holders are exposed to issuer, custody,
jurisdiction, transfer-control and secondary-market liquidity risk.

The V2 deployment reuses the reviewed Stock-Paired launch and hook bytecode. The ETH coordinator pins
all eleven V3 routes at construction and retains no user balances after a successful launch.

## Current evidence

- 5 deterministic registry tests cover the exact count, issuer revocation, token drift, manager drift,
  duplicate assets and rejected assets.
- 4 pinned Mainnet-fork deployment tests cover the exact seven-transaction plan, dependency and issuer
  checks, a direct Alibaba-paired launch, and an ETH-first Alibaba-paired launch through the reviewed
  route.
- The live route audit verifies all eleven assets, official logo responses, shared runtimes, manager
  acceptance, pool identity and the round-trip floor against two Mainnet RPCs.
- TypeScript tests pin the exact asset order and ensure excluded candidates cannot enter the route map.
- Slither 0.11.5 ran with 101 detectors. Its only results are the three expected external metadata and
  manager calls inside the constructor's fixed eleven-item loop. Deployment is atomic and reverts if
  any call fails.

These checks are release-candidate evidence. They are not an external audit and do not justify calling
the system perfect.

## Release boundary

The expanded list is not live until the seven V2 deployment transactions are signed on Mainnet. After
deployment, every source must be verified and a lifecycle canary must prove:

- ETH-first launch through a newly added quote asset
- buy and sell execution with current quotes and explicit slippage
- creator claim in the quote asset
- creator conversion from the quote asset to ETH
- Programmable claim
- permanent position ownership and lock state

The production UI must continue using V1 until the V2 manifest, runtime bindings, source verification
and lifecycle evidence all pass.
