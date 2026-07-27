# Programmable product brief

## Product sentence

Programmable creates a fixed-supply token and places its complete supply into permanently locked, one-sided Uniswap v4 liquidity without requiring a liquidity deposit from the creator.

## Product rule

The public interface exposes one launch product: Classic. No other hook, liquidity model, existing-token path or custom-code option is part of this release.

## Audience

Classic is for a creator who can define a token and fee but should not need to work with hook flags, pool keys, salts, Position Manager calldata, Permit2 or router commands.

## Information architecture

- **Explore** contains only tokens emitted by the verified Classic launcher
- **Launch** contains the Classic Token, Fee and Review flow
- **Profile** groups the connected address's tokens and native ETH fee claims

## Classic

Classic creates a new one-billion-supply token through the official Uniswap UERC20Factory. The complete supply enters a one-sided Uniswap v4 position in the same atomic transaction. The position NFT and rounding dust are sent to an official `PositionFeesForwarder` configured with the zero operator and maximum-block timelock.

The creator deposits no ETH, receives no token allocation and pays no protocol launch fee. The wallet pays Ethereum gas.

### Creator inputs

- Token name
- Token symbol
- Token description
- Total token swap fee from 1% through 10% in whole percentage-point steps

### Fixed policy

- 1,000,000,000 token supply
- 18 decimals
- No minting after creation
- No transfer tax, rebase, blacklist or sell restriction
- No creator or Programmable token allocation
- Native ETH as currency0 and the token as currency1
- One one-sided v4 position containing the complete token supply
- 0.00% Uniswap LP fee
- Initial tick 204200 with tick spacing 200
- Starting FDV of `1.355657760817103798 ETH`, shown as `1.36 ETH`
- Permanently locked initial position
- No creator liquidity deposit
- No protocol launch fee beyond network gas

### Metadata

The pinned `uerc20-factory` dependency is the official v2.0.0 release. Its metadata tuple is exact:

```text
(string description, string website, string image, bytes extraData)
```

Optional website and image values are HTTPS URLs. Optional X and Telegram links are encoded as versioned UTF-8 JSON in `extraData`; no social links produce `0x`. A Sepolia release rehearsal must include nonempty `extraData` so the dynamic-bytes ABI path is actually tested.

### Opening price

The launch uses one-sided concentrated liquidity. With one billion tokens and initial tick 204200, the opening spot price is approximately `0.000000001355657760817103798 ETH` per token. Multiplying that price by the fixed supply gives the starting FDV.

This is an initial fully diluted valuation, not guaranteed proceeds, liquidity depth or future market value.

## Fee rule

The creator selects the complete swap fee. Programmable's fixed 0.10 percentage-point share is deducted from that selection.

| Selected total | Creator receives | Programmable receives |
| --- | ---: | ---: |
| 1.00% | 0.90% | 0.10% |
| 2.00% | 1.90% | 0.10% |
| 10.00% | 9.90% | 0.10% |

Both shares accrue from the native ETH side of canonical-pool swaps as PoolManager claims. Anyone may trigger a standard claim to the recorded creator or treasury. A recipient that cannot receive ETH may redirect only its own payout.

The token remains freely transferable. A separate pool can trade without the Classic hook, so Explore, volume and claims must use the canonical `poolId` emitted by the verified `MemeLaunchV1` contract.

Ethereum gas and any independently enabled Uniswap protocol fee are outside the selected hook fee.

## Launch and trading boundary

The application prepares one payable `MemeLaunchV1.launch` call with the creator's selected Dev Buy of at least 0.0006 ETH. Before a wallet prompt, the server verifies the chain, ready deployment record, runtime bytecode, official Uniswap dependencies, immutable treasury, hook callback mask, fee and minimum-buy constants, predicted token address, selected transaction value and exact simulation.

Classic trading uses the direct official path:

1. Quote the canonical pool with V4Quoter
2. Apply the user's minimum output and bounded deadline
3. Encode the v4 swap for Universal Router v2.0
4. Send native ETH for a buy
5. For a sell, establish token approval to Permit2 and Permit2 allowance to Universal Router before the swap

Trading preparation remains disabled while no deployment is ready.

## Explore and Profile boundary

The read model starts at the verified launcher deployment block and uses a confirmation-delayed snapshot. It pairs `MemeTokenLaunched` with `MemeLiquidityConfigured`, rejects unpaired or foreign events, and accepts `NativeSwapFeesAccrued` only for canonical pool IDs. Token metadata comes from the launched UERC20. Price and active liquidity come from the official StateView at the same snapshot block.

This is a read-through model, not a production-grade persistent indexer. Production availability, reconciliation and reorg handling remain release gates.

## Release status

- Ethereum mainnet: `not-deployed`
- Sepolia rehearsal: `requires-redeploy` after the mandatory initial-buy source change
- External contract audit: none
- Public launch products: Classic only

The source-verified Sepolia launcher, hook and hook factory and their signed lifecycle predate the mandatory initial buy.
Two independent RPCs reconcile that historical release, but Sepolia is now `requires-redeploy` and transaction
preparation remains disabled. The still older lifecycle with the legacy fourth metadata field remains separately marked
historical and cannot enable transaction preparation either.

Before Mainnet can be enabled, the exact current release needs:

1. A frozen commit with passing unit, fuzz, invariant, fork, static-analysis and remote CI evidence
2. A provider-backed wallet and public buy and sell rehearsal against the ready Sepolia deployment after that commit is frozen
3. Production indexing, reconciliation, monitoring and incident procedures
4. A funded owner-approved deployer and reviewed maximum fee ceiling
5. Fresh Mainnet state checks and an exact read-only four-transaction simulation
6. Explicit broadcast approval, verified Mainnet source and a monitored canary

There has been no external smart-contract audit or public contest. Product copy may describe exact mechanics, but it must not describe the system or a launched token as audited, safe, unruggable, scam proof or compatible with every scanner.

## Visual direction

The interface is light, quiet and direct, with restrained floral artwork from the Programmable brand. Copy uses complete English sentences without promotional filler, fabricated activity, network ornaments or unsupported trust signals. Explore should fit inside a normal desktop viewport; launch, token and profile screens may scroll when required for accessible controls.
