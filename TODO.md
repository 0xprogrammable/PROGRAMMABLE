# Programmable release checklist

Scope locked on 2026-07-26.

## Fixed scope

- [x] The public product contains one launch model: Classic
- [x] No additional launch models, hook variants or custom-code products are part of the current work
- [x] Earlier auction, direct-liquidity and dynamic-fee prototypes remain internal and disabled
- [x] No external smart-contract audit or public contest is planned for this release
- [x] Product and release copy must state the release is unaudited and must not imply certification, guaranteed safety or third-party approval

Skipping an external audit is a scope decision, not security evidence. Mainnet release therefore carries additional
residual smart-contract risk and must satisfy every internal gate below.

## Current state

- [x] Meme Launch V1 contract composition is implemented
- [x] The creator selects a total 1–10% swap fee and Programmable receives 0.10 percentage points from that total
- [x] The creator supplies no liquidity and pays no launch charge; launch includes a creator-selected Dev Buy of at least 0.0006 ETH plus Ethereum gas
- [x] The atomic initial buy sends the purchased tokens directly to the creator and any failed settlement reverts the complete launch
- [x] The complete fixed supply enters one permanently locked, one-sided Uniswap v4 position
- [x] Unit, fuzz, integration, invariant, pinned-fork and static-analysis checks pass on the exact initial-buy release
- [x] The current official Universal Router buy, sell and claim lifecycle passes against a pinned Mainnet fork
- [x] The supplied wallet is owner-approved as the Mainnet deployer and a current read-only three-transaction V2 simulation is documented
- [x] The frontend fails closed while the Meme Launch deployment record is incomplete
- [x] The exact current Classic V2 composition is deployed and source-verified on Sepolia
- [x] A complete signed Sepolia launch, atomic Dev Buy, sell and fee-claim lifecycle using the official UERC20 v2 metadata ABI is valid release evidence
- [x] The previous Sepolia addresses and lifecycle are preserved only as `historical-invalid-metadata-abi`
- [x] The later pre-initial-buy Sepolia release is preserved only as `historical-pre-initial-buy-release`
- [x] Meme Launch V1 infrastructure is deployed on Ethereum mainnet
- [x] Classic V2 is deployed and source-verified on Sepolia
- [x] Test2 completes the V2 launch, buy, sell and both-claims lifecycle
- [ ] Classic V2 is deployed on Ethereum mainnet
- [ ] Public launch preparation is enabled

Sepolia V2 is `ready` with current Test2 lifecycle evidence. Both Sepolia V1 lifecycles remain historical only. Mainnet
V1 infrastructure and one Test launch exist, but public preparation remains disabled until the V2 mainnet release,
canary and monitoring gates are complete.

## Remaining work

### 1. Deploy the exact V2 release on Sepolia

- [x] Freeze the release commit
- [x] Rerun the official-address, runtime-hash, test, invariant and Slither gates on the exact initial-buy release
- [x] Recalculate the three reviewed deployment addresses from the current pending nonce
- [x] Confirm that the deployment wallet covers the fresh gas estimate plus a safety margin
- [x] Prepare and independently validate the nonce-pinned three-transaction MetaMask flow
- [x] Sign and broadcast `EthCreatorFeeHookFactoryV2`, `EthCreatorFeeHookV2` and `MemeLaunchV1`
- [x] Verify source code, receipts, constructor configuration and runtime code hashes
- [x] Record the verified V2 deployment and `releaseVersion: classic-v2` in the manifest

### 2. Prove the complete V2 Sepolia lifecycle

- [x] Prepare the exact Test2 fixture with image, website, X link, description, 1% total fee and 0.0006 ETH Dev Buy
- [x] Launch Test2 through the reviewed browser transaction builder using the official UERC20 v2 `bytes extraData` ABI
- [x] Execute the supported atomic exact-input Dev Buy and Universal Router sell path
- [x] Claim creator fees and Programmable fees, then reconcile PoolManager claims and recipient balance changes
- [ ] If rejecting contract wallets are supported at launch, rehearse the recipient-authorized redirected claim
- [x] Reconcile the canonical pool ID, V2 fee disclosure, fixed supply, opening tick, active liquidity, permanent lock and launch record
- [x] Preserve transaction hashes, blocks, decoded V2 events and runtime hashes as current release evidence

### 3. Product-data foundation

- [x] Accept only `MemeTokenLaunched` events emitted by the deployment selected by the fail-closed manifest
- [x] Bind every accepted token to its emitted canonical pool ID and matching liquidity event
- [x] Read token identity, image, description, project links, launch time, price, market cap and volume from canonical launch metadata and confirmed onchain state
- [x] Support search by name, symbol and contract address, plus newest, oldest and highest-market-cap sorting
- [x] Persist creator username and avatar locally per wallet and browser
- [x] Populate Profile from verified launches, canonical positions, claimable fees and claim history
- [x] Bind creator and Programmable claim preparation to the verified hook, pool, account and exact calldata
- [x] Remove sample token cards and return an honest unavailable or empty state
- [ ] Add a durable production index with backfill checkpoints, reorg rollback, reconciliation and cache invalidation before public traffic
- [ ] Add cross-device profile persistence only after an authenticated storage design is reviewed

### 4. Close the internal mainnet gates

- [x] Prove current official V4Quoter, Universal Router and Permit2 compatibility for every supported Classic swap path in the pinned Mainnet lifecycle
- [x] Resolve all critical, high and moderate production dependency findings with a scoped Universal Router SDK override; retain 19 low `ethers` v5/`elliptic` findings without a compatible upstream fix
- [x] Rerun the full repository verification suite on the exact release commit and preserve remote CI results
- [ ] Verify the production manifest, official Uniswap dependencies, immutable treasury, hook mask and runtime code hashes
- [ ] Add live event reconciliation, alerts, named incident owners and a rehearsed response runbook
- [x] Keep the immutable treasury at the owner-approved supplied EOA for this release
- [x] Use the owner-approved `0x2Bb…249E` EOA as deployer with manual wallet signing and no stored private key
- [x] Keep securities, RWA, custody and guaranteed-safety claims outside the product
- [x] Complete rendered desktop and mobile QA for Explore, the Classic launch flow, Profile and fail-closed token detail states
- [x] Verify that the allowed production origin restores an existing Privy wallet session and opens account management
- [ ] Complete a fresh provider-backed login, disconnect, reconnect and transaction-review rehearsal on the exact release
- [x] Confirm that the launch review and release notes describe the contracts as unaudited

### 5. Release on mainnet

- [x] Run a fresh read-only mainnet deployment simulation from the approved signer for the exact initial-buy release
- [ ] Obtain explicit owner approval for the final addresses, gas cost and broadcast
- [ ] Deploy and source-verify the frozen release
- [ ] Record receipts, blocks, addresses, constructor values and runtime hashes in the production manifest
- [ ] Run one low-value monitored canary launch with buys, sells and both fee claims
- [ ] Enable public launch preparation only after the canary and monitoring checks pass
- [ ] Deploy the exact verified frontend commit and confirm `programmable.family` points only to the production manifest

## Not in the current scope

- Additional launch models or hook variants
- Arbitrary custom hooks
- Auction, timed-opening or dynamic-fee launches
- RWA, securities, NFT, permissioned-pool or oracle products
- Multi-chain deployment
- External smart-contract audit or public contest

Research files and prototype contracts may remain in the repository as historical evidence. They are not a roadmap and
must not appear as available or upcoming products.
