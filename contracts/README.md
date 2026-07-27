# Programmable contracts

This workspace contains the Classic release candidate. Nothing in this directory is an audit certificate or a
public-enabled Ethereum mainnet release.

## Classic composition

```text
official Uniswap UERC20Factory v2.0.0
→ MemeLaunchV1
→ native ETH and token v4 pool
→ shared EthCreatorFeeHookV2
→ complete token supply in one one-sided position
→ official PositionFeesForwarder with permanent custody
```

Classic is the only public launch product in this release.

The fixed policy is:

- 1,000,000,000 tokens with 18 decimals
- no creator or Programmable token allocation
- no minting, transfer tax, blacklist, rebase or sell restriction
- no creator ETH liquidity deposit
- one creator-selected atomic Dev Buy of at least 0.0006 ETH, with purchased tokens sent directly to the creator
- no protocol launch fee beyond Ethereum gas
- 0.00% Uniswap LP fee
- initial tick 204200 and tick spacing 200
- starting FDV of `1.355657760817103798 ETH`
- complete supply placed from the minimum usable tick through the initial tick
- position NFT and rounding dust held by a forwarder with zero operator and maximum-block timelock

The creator selects a total swap fee from 1% through 10% in whole percentage points. Programmable's fixed 0.10 percentage-point share is deducted from that selection. At 1%, the creator accrues 0.90% and Programmable accrues 0.10%.

Both shares accrue only from the native ETH side of swaps in the canonical pool. Standard claims are permissionless and pay the recorded creator or treasury directly. A recorded recipient that cannot receive ETH may redirect only its own claim.

## Upstream contracts

Classic does not replace Uniswap v4 core. It reuses pinned official PoolManager, PositionManager, StateView, V4Quoter, Universal Router, Permit2 and UERC20Factory deployments. Contract creation and liquidity placement reuse Uniswap's UERC20 factory, PositionPlanner and PositionFeesForwarder. OpenZeppelin supplies the hook base, CREATE2 utility and transient reentrancy guard.

The `uerc20-factory` dependency is pinned to official tag `v2.0.0`, commit `6f18f1cdf80dc173d33d3cd6bbe91ee52c314f68`. The exact metadata struct is:

```solidity
struct UERC20Metadata {
    string description;
    string website;
    string image;
    bytes extraData;
}
```

The current launch encoder sends versioned UTF-8 JSON for optional X and Telegram links in `extraData`, or `0x` when both are absent.

The exact product specification is [`spec/meme-eth-fee-locked-v1.json`](spec/meme-eth-fee-locked-v1.json).

## Trading and reads

Classic exact-input trades quote the canonical hooked PoolKey through V4Quoter and encode the swap through Universal Router v2.0 with the official v4 SDK. Buys settle native ETH directly. Sells use the pinned Permit2 contract and require token-to-Permit2 and Permit2-to-router approval state before the router transaction.

Explore and Profile pair verified `MemeTokenLaunched` and `MemeLiquidityConfigured` events, accept fee events only for their canonical pool IDs, and read pool state through the official StateView at a confirmation-delayed snapshot block.

Both paths fail closed unless the release manifest is ready and runtime code matches its recorded hashes.

## Verification

```sh
./scripts/bootstrap-deps.sh
forge fmt --check
forge lint src script
forge build
forge test
slither . --filter-paths 'lib|test|script' --exclude-dependencies
```

From the repository root:

```sh
npm run verify
npm run contracts:verify
npm run contracts:slither
npm run contracts:official-deployments
npm run contracts:sepolia:validate
```

Every dependency is pinned to an exact commit. Deployment checks compare checked-in Ethereum snapshots with Uniswap's official registry and fail when required addresses or runtime code hashes drift.

Tests cover the four exact-input and exact-output swap quadrants, inclusive fee splitting, tiny-amount rounding, canonical-pool isolation, partial-fill rejection, rejecting-recipient recovery, atomic token and locked-liquidity creation, claims and stateful accounting invariants.

## Deployment truth

The current Classic V2 Ethereum mainnet infrastructure is deployed and source-matched. Production transaction
preparation remains disabled because the current Mainnet lifecycle is still pending. Historical V1 infrastructure does
not enable production transaction preparation.

The current Ethereum Sepolia deployment is source-verified and its signed atomic Dev Buy, sell and native fee-claim lifecycle is reconciled across two independent RPCs. The release manifest marks Sepolia Classic `ready`; `npm run contracts:sepolia:lifecycle:verify` rechecks the exact deployment, token, pool, position custody, fee split, claims and balance deltas.

The older Sepolia lifecycle with the legacy fourth metadata field remains separately marked `historical-invalid-metadata-abi` and cannot enable transaction preparation.

The detailed evidence and remaining release requirements are in [`DEPLOYMENT.md`](DEPLOYMENT.md) and [`security/MAINNET-READINESS.md`](security/MAINNET-READINESS.md).

There has been no external smart-contract audit or public contest. Public Mainnet availability still requires
production indexing, operated monitoring, a separately approved controlled canary and its independently reconciled
lifecycle evidence.
