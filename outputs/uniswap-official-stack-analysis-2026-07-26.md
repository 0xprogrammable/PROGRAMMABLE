# Uniswap official stack analysis

Status updated 2026-07-27: the exact current Classic release is now deployed and source-verified on Sepolia. Its signed nonempty-`extraData` launch, buy, Permit2 authorization, sell and both claim paths are independently reconciled. Mainnet remains `not-deployed`.

## Decision

Launcher should begin with one product, not a hook catalog.

The first public product is **Classic**:

1. Create a new fixed supply ERC-20 through Uniswap UERC20Factory
2. Put the complete supply into one one-sided Uniswap v4 position
3. Require no ETH liquidity deposit and no token allocation for the creator
4. Permanently lock the position and rounding dust
5. Let the creator select a 1–10% total token fee in whole percentage points
6. Deduct Launcher's immutable 0.10 percentage-point share from that selected total
7. Accrue both shares in native ETH rather than launched tokens
8. Charge no launch fee beyond Ethereum network gas

At a selected 1.00% token fee, 0.90% accrues to the creator and 0.10% to Launcher. The hook charges 1.00% in total, not 1.10%.

This is a v4 launch. It is not a "v3 coin." The token is an ERC-20. v3 and v4 describe pool protocols, not token standards.

## Corrections to the original model

### A v3 coin does not exist

Uniswap v3 has standard fee tiers of 0.05%, 0.30% and 1.00%. The 1.00% tier is a pool setting. It does not define a token type and it does not mean that the pool needs little liquidity.

Uniswap v4 supports arbitrary static fees and dynamic fees. A v4 pool can reproduce the familiar fixed fee trading model without becoming a v3 pool.

Source: [Uniswap fee concepts](https://developers.uniswap.org/docs/get-started/concepts/fees)

### Trading directions were reversed

In a token and ETH pool:

- A buyer pays ETH and receives the token
- A seller pays the token and receives ETH
- A liquidity provider deposits assets and receives a liquidity position
- A trader does not receive LP tokens merely by buying or selling

### Low liquidity is not a launch mechanism

Low liquidity creates larger price impact. It does not gradually fill a pool and it is not a v3 feature.

There are two honest opening paths:

1. Direct pool. The creator supplies token and ETH liquidity
2. Auction funded pool. Buyers fund the pool through an auction before migration

The second path matches the stated requirement that creators should be able to launch without an ETH liquidity budget.

## What the deployment explorer contains

The [Uniswap deployment explorer](https://developers.uniswap.org/deployments) is a versioned address registry. It is not a list of token variants.

The machine readable registry was generated on 15 July 2026 from commit `37936185dee7decf681360ec799c124e0e034672` of the Uniswap contracts repository. It contains 940 contract records:

| Protocol family | Records |
| --- | ---: |
| v3 | 469 |
| v4 | 188 |
| Universal Router | 88 |
| Liquidity Launchpad | 66 |
| v2 | 43 |
| Permit2 | 36 |
| UniswapX | 27 |
| Smart Wallet and permissioned pool components | 22 |
| DualPool | 1 |

The large number comes from versions, chains and contract roles. It does not mean that Uniswap exposes 940 one click launch products.

Source: [Uniswap deployments JSON](https://developers.uniswap.org/deployments.json)

## The official Ethereum stack we should reuse

### Uniswap v4

| Component | Ethereum address | Launcher role |
| --- | --- | --- |
| PoolManager | `0x000000000004444c5dc75cB358380D2e3dE08A90` | Holds all v4 pool state and settles pool operations |
| PositionManager | `0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e` | Creates and manages v4 liquidity positions |
| StateView | `0x7fFE42C4a5DEeA5b0feC41C94C136Cf115597227` | Reads pool state |
| V4Quoter | `0x52F0E24D1c21C8A0cB1e5a5dD6198556BD9E1203` | Simulates swap quotes |
| ReservesLens | `0x0000001b173C3bbF3984D417d8614E3eed34865B` | Reads reserves where applicable |

A v4 pool is state inside PoolManager. It is identified by the hash of its `PoolKey`:

```text
currency0
currency1
fee
tickSpacing
hooks
```

There is no separate pool contract address for every v4 pool. Explore and Profile must store the full PoolKey and PoolId.

Source: [v4 pool creation](https://developers.uniswap.org/docs/protocols/v4/guides/create-pool)

### Liquidity Launchpad

| Component | Current Ethereum version | Ethereum address | Launcher role |
| --- | --- | --- | --- |
| ContinuousClearingAuctionFactory | 2.1 | `0x000000001F26a0044BaA66024e7b6599c61963F8` | Creates the opening auction |
| LiquidityLauncher | 3.0 | `0x00004c4ccc709Ef590F7C81102C0689F0263D4e9` | Atomically acquires and distributes launch tokens |
| LBPStrategy | 3.1 | `0x49380c4EfaB1b491006aF7FabAB8B3459F0E6000` | Migrates auction assets into v4 liquidity |
| TokenSplitter | 3.0 | `0x8B7DCeb5639DB986FCf86606C74e6300C40FE3cd` | Splits token distribution across strategies |
| UERC20Factory | 2.0 | `0x000000e200088D55C39a11F609E5F667729ad49b` | Creates deterministic fixed supply tokens |

The old FullRange, Advanced, Basic and Virtual LBP strategy factories are deprecated. The current LBPStrategy uses parameterized position definitions and allocation schedules. We should not reproduce the deprecated factories as separate product choices.

Source: [Liquidity Launchpad overview](https://developers.uniswap.org/docs/liquidity/liquidity-launchpad/overview), [deployments](https://developers.uniswap.org/docs/liquidity/liquidity-launchpad/deployments), [strategy concepts](https://developers.uniswap.org/docs/liquidity/liquidity-launchpad/concepts/liquidity-strategies), [source repository](https://github.com/Uniswap/liquidity-launcher)

### Routing and approvals

Universal Router composes v2, v3 and v4 swaps, wrapping, payments and position operations in one command stream. It is unowned and non-upgradeable. Permit2 provides time-bound allowances and one-time signature transfers.

These components belong in trading and liquidity workflows. They do not define a launch product.

Source: [Universal Router](https://developers.uniswap.org/docs/protocols/universal-router/overview), [Permit2](https://developers.uniswap.org/docs/protocols/permit2/overview)

## What the official SDKs do

The reviewed package snapshot is `@uniswap/sdk-core` 7.19.0, `@uniswap/v4-sdk` 2.3.1 and `@uniswap/liquidity-launcher-sdk` 1.0.1. The SDK monorepo was inspected at commit `57f126e`. Package versions and source commits must be pinned for each Launcher release because public package behavior can change independently of deployed contracts.

### `@uniswap/sdk-core`

This package supplies shared currency, token, amount, price, percentage, chain and address primitives.

### `@uniswap/v4-sdk`

This package models pools, positions, routes and trades and encodes v4 PositionManager and routing calls. It helps an application create pools, quote swaps and manage positions.

It does not choose safe launch parameters. It does not audit a hook. It does not create a launch registry. It does not make a token legitimate.

Source: [v4 SDK overview](https://developers.uniswap.org/docs/sdks/v4/overview), [create pool with the SDK](https://developers.uniswap.org/docs/sdks/v4/guides/create-pool), [Uniswap SDK repository](https://github.com/Uniswap/sdks)

### `@uniswap/liquidity-launcher-sdk`

This is the most relevant application layer package. Version 1.0.1 includes:

- Official address selection by chain
- Deterministic token and auction prediction
- Auction schedule and emission helpers
- Floor price and required raise calculations
- Position range builders
- Liquidity allocation schedules
- Lock recipient builders
- Token, auction and migration calldata encoders
- Atomic launch transaction assembly
- Reads for auction state, outcomes and recovery
- A Quick Launch preset and classifier

We should use these functions instead of rewriting the same math or calldata.

The current Quick Launch source is not a complete production policy. Its comments mark the $50,000 graduation FDV and the 0.25% versus 0.30% LP fee as pending sign-off. Its classifier is explicitly cosmetic and must not suppress token protection warnings. We should therefore reuse the SDK machinery without presenting the preset as a security certification.

Source: [Liquidity Launcher SDK source](https://github.com/Uniswap/sdks/tree/main/sdks/liquidity-launcher-sdk)

## What a hook changes

Each v4 pool can attach one hook contract. One hook can implement several callbacks and can serve several pools.

The hook address encodes which callbacks can run. The address flags are capability metadata. They do not prove that the implementation is safe.

Source: [v4 hooks](https://developers.uniswap.org/docs/protocols/v4/concepts/hooks)

### Fixed LP fee

A fixed LP fee is a PoolKey setting. It is not a special hook product.

### Dynamic LP fee

The pool must be created as a dynamic fee pool. A hook can update the LP fee periodically or return a per-swap override. The choice is immutable once the pool is created.

Dynamic fees are a later product because the algorithm, inputs, manipulation bounds and maximum fee need their own review.

Source: [v4 dynamic fees](https://developers.uniswap.org/docs/protocols/v4/concepts/dynamic-fees)

### Hook fee

A hook can charge a fee separate from the LP fee. Return deltas can alter what the router and hook owe after a swap.

Launcher uses this mechanism for its fixed 0.10% fee. This needs exact bidirectional, exact input, exact output, rounding and partial fill tests.

Source: [v4 custom accounting](https://developers.uniswap.org/docs/protocols/v4/guides/custom-accounting)

### Custom curve

A hook with return delta permissions can bypass native concentrated liquidity pricing and implement its own curve. That is effectively a separate AMM inside the v4 settlement system.

This is the highest risk product lane. It cannot be treated as a normal selectable feature.

### Flash accounting

PoolManager tracks transient debts and credits during an unlocked operation. Every delta must resolve before the call finishes. Flash accounting makes complex atomic flows cheaper. It does not make arbitrary hook logic safe.

Source: [v4 flash accounting](https://developers.uniswap.org/docs/protocols/v4/concepts/flash-accounting)

## Official hooks are not launch variants

The public Uniswap hook repository currently contains several different families:

1. WETH and wstETH wrapper hooks
2. Permissioned pool hooks
3. DualPool and ALF contracts
4. Supporting factories, quoters and base contracts

The Ethereum WETH and wstETH hook deployments solve wrapping and routing problems. They are not token launch templates.

Source: [Uniswap public hooks](https://github.com/Uniswap/v4-hooks-public)

## Permissioned Pools

Permissioned Pools are a separate issuer integration, not a button that turns an arbitrary ERC-20 into a compliant stock or RWA.

The flow requires:

1. An existing permissioned ERC-20
2. The issuer's allowlist checker
3. A verified permissions adapter
4. PermissionedHooks
5. PermissionedPositionManager
6. An approved wrapper or router
7. Uniswap Labs routing allowlist approval for supported routing

The issuer can update the checker, approve or revoke wrappers, pause swaps, manage hook permissions and unwind positions. Position NFTs are non-transferable.

Permissioned Pools do not create the legal claim, custody, price oracle, minting authority, redemption process, KYC policy or regulatory approval for an RWA.

This should become a later **Issuer Pool** product. It should only accept an existing issuer asset and documented issuer controls.

Current Ethereum contracts:

| Component | Address |
| --- | --- |
| PermissionsAdapterFactory | `0x38f9Ab57FBE2704EbB727cB20e33201aF0E5F961` |
| PermissionedPositionManager | `0x89628C9B4CE81951a9BC1F36F0688Fad6A6ee248` |
| PermissionedHooks | `0x69603ab16110Eb0bB5f5E9C8019749eE41A128C0` |
| Permissioned Universal Router | `0xCb640A86855f1A828c27241bA364348de28abe66` |

Source: [Permissioned Pools overview](https://developers.uniswap.org/docs/protocols/v4/permissioned-pools/overview), [architecture](https://developers.uniswap.org/docs/protocols/v4/permissioned-pools/architecture), [security framework](https://developers.uniswap.org/docs/protocols/v4/security)

## DualPool

DualPool is a v4 hook based market-making protocol. Capital rests in ERC-4626 vaults between swaps and is deployed as concentrated liquidity just in time for each swap.

It can earn vault yield and swap fees on the same inventory. It also introduces a strong trust and dependency model:

- The owner controls pool creation, liveness, liquidity distribution, external deposit policy and vault allowances
- Ownership cannot be renounced
- Vaults receive standing token allowances
- A compromised or malicious vault can affect capital
- Native ETH, fee-on-transfer tokens and rebasing tokens are unsupported
- Routers need DualPool specific quote views because resident v4 liquidity is near zero between swaps

DualPool was audited by OpenZeppelin in May and June 2026. The official docs report no critical or high severity findings and state that all findings were resolved.

This is a later **Yield Pool** product for reviewed ERC-4626 vaults. It is not appropriate for Standard Launch.

Source: [DualPool overview](https://developers.uniswap.org/docs/protocols/v4-hooks/dualpool/overview), [security](https://developers.uniswap.org/docs/protocols/v4-hooks/dualpool/security), [deployments](https://developers.uniswap.org/docs/protocols/v4-hooks/dualpool/deployments)

## The community hook registry

The official Uniswap hooklist repository is useful for prior art and discovery. It is not an allowlist.

At commit `9ca1f518c02c5057b0ec96195864e40a675320ca`, the aggregate contained 465 source verified hook records:

| Property | Count |
| --- | ---: |
| Dynamic fee | 158 |
| Requires custom swap data | 39 |
| Upgradeable | 18 |
| `beforeSwap` return delta | 241 |
| `afterSwap` return delta | 255 |
| Non-empty audit field | 29 |

Several non-empty audit fields point to source repositories rather than independent audit reports. Submission also does not allowlist the hook for Uniswap routing.

We may use hooklist to find patterns. We must inspect source, runtime bytecode, authorities, external calls, callback flags, return delta logic, chain deployments and actual audit scope before turning any entry into a product.

Source: [Uniswap hooklist](https://github.com/Uniswap/hooklist)

## What Uniswap already gives us

We should reuse:

- PoolManager and v4 settlement
- PositionManager and v4 position actions
- StateView, V4Quoter and the v4 subgraph schema
- Universal Router and Permit2 where they reduce approval and routing complexity
- UERC20Factory for deterministic fixed supply tokens
- USUPERC20Factory only on supported Superchain networks
- LiquidityLauncher for atomic token acquisition and distribution
- Continuous Clearing Auction for price discovery
- LBPStrategy for parameterized pool migration
- TokenSplitter for reviewed multi-strategy distribution
- Official SDK math, encoders, address selection and reads
- Official lock recipient implementations where their exact authority model fits
- Permissioned Pool components for issuer-led products
- DualPool factory and audited implementation for a later yield product

## What Launcher still has to build

Uniswap does not supply the complete product layer:

- A strict public catalog of reviewed launch products
- Parameter bounds and policy for every product
- The immutable 0.10 percentage-point Launcher share deducted from each token's selected total fee
- A one click transaction flow with bytecode checks and simulation
- A Launcher launch registry
- Explore indexing restricted to launches created through Launcher
- Profile indexing for auctions, pools, locked positions and claimable fees
- Runtime codehash and source provenance
- Hook compatibility and audit scope records
- Recovery and migration lifecycle automation
- Scanner and aggregator metadata work
- Monitoring, incident response and version retirement
- Legal, issuer, custody, oracle and redemption integrations for RWAs

The product advantage is the safe, understandable composition and lifecycle. It is not a new AMM core.

## Current public product

Only Classic is visible. No other launch model is scheduled or presented as an upcoming product.

### Classic

Status: implemented and protocol-tested locally, not deployed or approved for Ethereum mainnet

Composition:

```text
UERC20Factory
→ MemeLaunchV1
→ shared native ETH fee hook
→ complete token supply in one one-sided v4 position
→ permanently locked PositionFeesForwarder
```

Public inputs:

- Token name
- Token symbol
- Token description
- Total token fee from 1% to 10%

Fixed policy:

- 1,000,000,000 token supply
- 18 decimals
- No creator token allocation
- No creator ETH deposit
- Complete supply in one one-sided position
- 0.00% Uniswap LP fee
- Selected total token fee includes the 0.10 percentage-point Launcher share
- Creator receives the selected total minus 0.10 percentage points in native ETH
- Initial position permanently locked
- Network gas is the only launch cost

## Archived and deferred research

The following work is retained as prior art and historical implementation evidence. None of it is offered publicly, scheduled for release or shown as a roadmap.

### Bounded Dynamic Fee

Expose one fixed algorithm with immutable minimum and maximum values. Do not market it as MEV protection without separate evidence.

This remains archived research. Reconsidering it would require a new product decision and a review against the Classic liquidity and custody policy.

### Buyback and Burn

Use the official buyback and burn position recipient only after the exact keeper incentive, burn threshold, price impact and fee destination are clear in the UI.

### Timed Opening

Open swaps for every address at one immutable time. Do not add address-specific sell rules or hidden transfer restrictions.

### NFT Member Fee

Use NFT ownership only for a clearly bounded fee benefit. It must not remove a holder's ability to sell the token.

### Oracle Guard

Check swaps against a named external price source and immutable deviation bounds. Document stale-price and oracle-failure behavior before release.

### Limit Orders

Represent orders as liquidity at a stated price. Specify cancellation, partial fill, keeper and fee behavior as a separate product.

### Advanced Liquidity Layout

Expose reviewed LBPStrategy position definitions and allocation schedules. This is a liquidity product, not a token type.

### Direct Launch

The creator provides token and ETH, chooses an opening price and creates the v4 pool immediately. This is useful for funded teams but does not solve the no liquidity budget use case. It is a different opening and liquidity path, not a hook variant.

### Existing Uniswap Token

Accept only tokens that can be reconstructed through the configured UERC20Factory and whose recorded creator is the caller. Arbitrary ERC-20 imports remain excluded. This is an asset path, not a hook variant.

### Superchain Token

Use USUPERC20Factory only on networks where Uniswap has deployed it. Ethereum mainnet does not currently have this factory.

### Issuer Pool

Integrate Permissioned Pools for an existing permissioned issuer asset. Require issuer, allowlist, redemption, legal and routing readiness.

### Yield Pool

Integrate DualPool only with reviewed ERC-4626 vaults and an explicit owner and vault risk disclosure.

### Reviewed custom hooks

Add one implementation at a time. Every product gets its own fixed parameter schema, contract version, tests, audit scope and launch manifest.

### Custom Lab

Arbitrary user code remains outside the product. Historical research may analyze or simulate it, but it cannot receive the same safety language as a fixed reviewed product.

## Data architecture for Explore and Profile

The v4 subgraph exposes Pool, Token, Swap, Position and time-series entities. Pool records include the PoolId, hook address, fee, liquidity, price and volume.

Source: [v4 subgraph entities](https://developers.uniswap.org/docs/ecosystem/subgraphs/concepts/v4/entities), [v4 query patterns](https://developers.uniswap.org/docs/ecosystem/subgraphs/concepts/v4/queries)

Launcher still needs its own provenance index. The Uniswap subgraph can prove pool activity, but it cannot prove that a pool was created through Launcher or that the hook matches a Launcher release.

The minimum indexed launch record is:

```text
launchId
creator
token
tokenFactory
auction
liquidityLauncher
strategy
poolKey
poolId
hook
hookConfigurationHash
positionTokenId
positionRecipient
platformFeeRecipient
transactionHashes
sourceVersions
runtimeCodeHashes
createdBlock
lifecycleState
```

Explore reads only verified `MemeLaunchV1` events, then reconciles the canonical pool through the v4 subgraph and StateView. Profile resolves the connected address against creator and native ETH claim records.

## Security boundary

Classic can enforce specific properties:

- Fixed supply after creation
- No transfer tax
- No blacklist
- Non-upgradeable fee hook
- Immutable 0.10 percentage-point Launcher share within the selected total
- One bound PoolKey
- Permanently locked initial LP position
- Creator receives native ETH hook fees but cannot withdraw the initial liquidity

It cannot guarantee:

- Positive price performance
- Demand or graduation
- Protection from every unknown contract bug
- Protection from all MEV
- Truth of project claims
- Safety of other pools for the token
- Acceptance by every scanner, router or exchange
- Legal status of an asset

The product must never say "unruggable," "scam proof" or "100% safe."

## Current implementation truth

### Complete

- Current official Ethereum deployment snapshot is pinned and checked
- Official Liquidity Launcher SDK 1.0.1 is integrated
- Classic transaction construction exists
- Inclusive native ETH fee hook exists
- Native-specified partial fills fail closed
- Permanent position fee forwarder factory exists
- Direct launch and bounded dynamic fee prototypes remain archived behind the product boundary
- Mainnet remains fail-closed; the rehearsal manifest is ready only for the source-verified current Sepolia release
- The official UERC20 v2 metadata tuple is encoded and read as `(string description,string website,string image,bytes extraData)`
- Direct contract calls and app acceptance enforce the same UTF-8 byte limits: 48 name, 12 symbol, 280 description, 2048 website, 2048 image and 1200 extra data
- Unit, fuzz, integration and invariant coverage exists for the current local snapshot

### Historical only, not release evidence

- The older Sepolia infrastructure contracts, transaction receipts and source verification remain recorded
- The older launch, buy, sell and both fee claims were independently reconciled
- The launched historical UERC20 source was verified
- The deployed launcher encoded the official UERC20 v2 fourth metadata field as the legacy `uint256` shape, producing invalid 128-byte metadata content instead of current `bytes extraData`
- That older lifecycle remains `historical-invalid-metadata-abi` with `releaseEligible: false`

### Current Sepolia release evidence

- The exact current hook factory, hook and launcher are source-verified
- The official UERC20 v2 metadata path was exercised with nonempty dynamic `bytes extraData`
- Launch, Universal Router buy, Permit2 authorization, sell and both native ETH claims completed
- Two independent RPCs reconcile all six receipts, runtime hashes, fee math, balances, canonical pool state and permanent position custody
- The current rehearsal manifest is `ready`; this status does not authorize Mainnet use

### Not complete

- No independent audit of Launcher contracts
- No Ethereum mainnet Launcher deployment
- No production launch registry or indexer
- No production Explore data
- No production Profile claim accounting
- No scanner and aggregator integration proof
- No incident monitoring or runbook exercise
- No legal product boundary for permissioned assets or RWAs
- The production dependency audit currently reports 23 transitive findings in the official Uniswap SDK graph: 15 low, 6 moderate and 2 high. The findings include legacy `ethers` v5/`elliptic` packages and legacy OpenZeppelin packages pulled in by the pinned SDKs. The suggested forced fix downgrades the Universal Router SDK across a breaking boundary and is not an acceptable automatic remediation.

The website can be production quality while mainnet launching remains disabled. It must not imply that mainnet contracts are live before these gates are complete.

## Mainnet release gates

1. Freeze the Classic contract and parameter specification
2. Deploy the exact frozen release to Sepolia and complete a fresh signed lifecycle with nonempty `extraData`, buy, sell, both fee claims, receipts and balance deltas
3. Run unit, fuzz, invariant and Ethereum fork tests against the pinned release
4. Record the residual risk from shipping without an external audit
5. Verify all source code and publish runtime codehashes
6. Deploy the exact frozen build to Ethereum mainnet
7. Verify immutable treasury, PoolManager, PositionManager, token factory and strategy bindings
8. Run a small controlled mainnet canary
9. Index the canary from Launcher events, the v4 subgraph and StateView
10. Verify Creator and Launcher native ETH claims against balance deltas
11. Confirm public scanner and aggregator behavior without promising universal acceptance
12. Enable the mainnet manifest only after the evidence is public

## Final product rule

The internal system may support many compositions. The public interface should expose one reviewed outcome at a time.

Every later variant answers four questions before it appears in Launch:

1. What exact user problem does it solve
2. Which official components can be reused unchanged
3. Which new authority, dependency and economic risks it introduces
4. What evidence proves that this exact composition is ready
