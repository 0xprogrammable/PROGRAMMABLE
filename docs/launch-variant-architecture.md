# Launch product architecture

## Public boundary

The current public catalog contains one product: Classic.

```text
Uniswap UERC20Factory
→ MemeLaunchV1
→ shared ETH fee hook
→ native ETH and token Uniswap v4 pool
→ complete supply in one one-sided position
→ permanently locked PositionFeesForwarder
→ atomic creator-selected Dev Buy of at least 0.0006 ETH into the canonical pool
```

The earlier auction, direct liquidity and bounded dynamic fee implementations remain internal prototypes. They are not public launch choices.

## Launch composition

The token remains a standard fixed supply ERC-20. A launch product is a reviewed composition of five axes:

1. Asset creation
2. Opening mechanism
3. Liquidity formation
4. Pool behavior
5. Position custody and fee rights

These axes document the current fixed composition. They are not a roadmap or public configuration surface.

## Classic specification

| Axis | Fixed choice |
| --- | --- |
| Asset | New fixed supply Uniswap UERC20 |
| Supply | 1,000,000,000 tokens at 18 decimals |
| Creator token allocation | Zero at issuance; the creator receives only tokens purchased in the initial buy |
| Creator liquidity deposit | Zero |
| Launch charge | Zero |
| Creator Dev Buy | At least 0.0006 ETH, selected by the creator, plus network gas |
| Opening | One-sided v4 range order |
| Pool | Native ETH and token |
| Initial tick | 204200 |
| Tick spacing | 200 |
| Starting FDV | 1.355657760817103798 ETH |
| LP fee | 0.00% |
| Swap fee | Fixed 1.00% total; 0.90% to the creator and 0.10% to Programmable |
| Launcher share | Fixed 0.10 percentage points, deducted from the fixed total |
| Creator share | Fixed 0.90 percentage points |
| Position | Minimum usable tick through initial tick |
| Custody | Permanently locked official PositionFeesForwarder |
| Platform recipient | Immutable Launcher treasury |
| Name | At most 48 UTF-8 bytes |
| Symbol | At most 12 UTF-8 bytes |
| Description | At most 280 UTF-8 bytes |
| Website and image | At most 2048 UTF-8 bytes each |
| Extra metadata | At most 1200 bytes |

The public creator controls the identity fields and Dev Buy amount. The 1.00% total swap fee, supply, pool ordering, price range, fee split, hook, liquidity layout and custody remain fixed by the release.

The pool is initialized before the buy, but the one-sided position begins exactly at its upper tick boundary. The atomic
creator buy moves the price into the active range and sends the purchased tokens directly to the creator. If any part of
that buy or its PoolManager settlement fails, the complete launch reverts.

## Fee accounting

Classic fixes the total fee at 100 basis points:

```text
launcherFeeBps = 10
creatorFeeBps = 90
total charged by the hook = 100
```

Gross exact-input fees round down to whole wei. Exact-output quotes gross up once so the requested net native amount is preserved, then allocate the fixed Launcher share from that total. The contract rejects partial fills for native-specified swaps rather than charging against the requested amount.

Fee claims are held as native-currency PoolManager ERC-6909 claims and not as launched tokens. A standard permissionless claim cannot redirect either recipient. Only the recorded creator or treasury may redirect its own claim when direct ETH reception fails.

## Boundaries that cannot be hidden

- The fee applies only to the canonical pool emitted by MemeLaunchV1
- Anyone can create an alternative pool because the token has no transfer restrictions
- The fixed 1.00% hook fee can affect demand and third-party token warnings
- A shared hook registration event is not proof that a token launched through Launcher
- Any independently enabled Uniswap protocol fee is outside the Creator and Launcher split
- Return-delta routing requires compatibility evidence for the production router

## Internal status language

`protocol-tested` means repository unit, fuzz, integration and invariant tests cover the implementation. It does not mean independently audited or approved for mainnet.

`archived` means an older prototype or research direction remains in the repository as factual history. It is not public, scheduled or presented as an upcoming product.

`requires-redeploy` means historical deployment records exist, but transaction preparation must remain disabled until the exact current release is deployed and verified.

`historical-invalid-metadata-abi` means the recorded lifecycle used the legacy fourth metadata field instead of official UERC20 v2 `bytes extraData`. The receipts and verified source remain historical evidence only and cannot satisfy a current release gate.

## Release gate

Classic becomes public only when all of the following exist:

1. One plain-language user outcome
2. A fixed parameter schema with bounds and authorities
3. Pinned official upstream versions
4. Complete contract implementation
5. Unit, fuzz, invariant and fork tests
6. Signed testnet lifecycle evidence
7. A frozen release commit with internal security review, static analysis and regression evidence
8. Verified deployment and runtime codehash manifest
9. Indexing for lifecycle, canonical pools and fee claims
10. Recovery and incident procedures

## Current scope

Classic is the only active product. Additional launch models, arbitrary custom hooks, auctions, timed openings,
dynamic fees, RWA, NFT, permissioned-pool and oracle products are not scheduled.

Earlier prototypes and research files may remain in the repository as historical evidence. They are not a roadmap,
cannot enable public transaction preparation and cannot inherit Classic security language.

## Official component policy

Use current active Uniswap contracts and encoders where their semantics match the product. Do not rebuild PoolManager, PositionManager, UERC20Factory, Universal Router or Permit2.

Permissioned Pools are an issuer integration for existing permissioned assets. They are not a generic RWA minter. DualPool is a yield AMM with owner and ERC-4626 vault trust. It is not a Classic option.

The Uniswap hook list is prior art, not a product allowlist. A listed hook does not expand the current product scope.

## Catalog source of truth

`contracts/spec/launch-variants.v1.json` records historical internal implementation and research status. The website must
not render this file as a public picker or roadmap.

`npm run contracts:variants` validates internal catalog structure. It does not prove mainnet readiness.
