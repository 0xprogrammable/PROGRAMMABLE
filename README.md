# Programmable

Programmable is a focused interface for creating a fixed-supply token with permanently locked, one-sided Uniswap v4 liquidity.

## Classic

Classic is the only launch product in this release.

- Uniswap UERC20Factory creates a fixed supply of 1,000,000,000 tokens with 18 decimals
- The creator and Programmable receive no token allocation
- The complete supply enters one one-sided v4 position atomically
- The opening tick produces a starting FDV of approximately 1.36 ETH
- The position NFT and rounding dust remain permanently locked
- Launching costs no protocol fee and requires no liquidity deposit; the creator selects a Dev Buy of at least 0.0006 ETH and pays Ethereum gas
- The creator selects a total swap fee from 1% through 10% in whole percentage points
- Programmable receives 0.10 percentage points from that selected total
- The creator receives the remainder in native ETH

At a selected 1.00% fee, the creator receives 0.90% and Programmable receives 0.10%. The trader-facing fee remains 1.00%; the platform share is deducted, not added.

The release uses the official UERC20 v2.0.0 metadata shape:

```text
(string description, string website, string image, bytes extraData)
```

Optional X and Telegram links are encoded as versioned UTF-8 JSON inside `extraData`. Empty social metadata is encoded as `0x`.

## Application

- Explore accepts only tokens emitted by the verified `MemeLaunchV1` deployment
- Launch contains the Classic Token, Fee and Review flow
- Profile groups the connected address's tokens and native ETH fee claims
- Privy supports MetaMask, Phantom, WalletConnect and an embedded Ethereum wallet
- The server owns deployment selection, ABI selection, calldata construction and simulation
- Launch and trading preparation fail closed unless the selected deployment is marked ready
- No sample or preview token is presented as a launched token

## Trading and read model

Classic trades use the canonical hooked pool only. Exact-input quotes come from the official V4Quoter. Swaps are encoded for Universal Router v2.0 with the official v4 SDK. Buys send native ETH to the router. Sells first establish the required token-to-Permit2 and Permit2-to-router allowances. Minimum output and a bounded deadline are included in every prepared swap.

Explore and Profile use a confirmation-delayed read model. It pairs `MemeTokenLaunched` and `MemeLiquidityConfigured` events from the verified launcher, accepts fee events only for those canonical pool IDs, and reads price and active liquidity from the official StateView at one snapshot block. A shared-hook event by itself is not launch provenance.

The current implementation reads through confirmed chain data and is suitable for development and release rehearsal. Public traffic still requires a durable index with backfill checkpoints, reorg rollback, reconciliation, cache invalidation and rate limits.

The ERC-20 remains freely transferable. Its fee applies only in the canonical Classic pool; a separate v3 or v4 pool can trade without the hook.

## Release status

Classic V1 infrastructure is deployed and source-matched on Ethereum mainnet, and one V1 Test launch exists. That is not
the public release: its lifecycle record remains incomplete and production launch/trade preparation stays disabled.
Classic V2, which adds machine-readable symmetric fee disclosure events and getters, is fully simulated but not yet
deployed on either network.

The prior Ethereum Sepolia V1 release is deployed, source-verified and backed by a signed atomic Dev Buy lifecycle
reconciled across two independent RPCs. It remains historical V1 evidence; it cannot replace the required V2 Test2
lifecycle. Start the app with `npm run dev:sepolia` only for the recorded V1 rehearsal deployment.

There has been no external smart-contract audit or public security contest. Nothing in this repository is a promise that a token is safe, immune to abuse or accepted by third-party scanners.

Provider-backed Privy login, session recovery and disconnect must be rehearsed on an allowed production origin before launch. If Privy does not initialize, the interface now surfaces that failure instead of leaving the wallet button disabled indefinitely.

Mainnet V2 still requires a frozen passing release, a signed V2 Test2 lifecycle on Sepolia, durable production indexing
and operated monitoring, fresh provider-backed wallet rehearsal, a final read-only preflight and explicit approval for
the three-transaction broadcast and monitored canary.

## Local development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

Create a Privy project, allow the production and local domains, and enable wallet and email login. Then copy `.env.example` to `.env.local`:

```text
NEXT_PUBLIC_PRIVY_APP_ID=your-privy-app-id
NEXT_PUBLIC_PRIVY_CLIENT_ID=your-optional-privy-client-id
ETHEREUM_RPC_URL=https://your-mainnet-rpc.example
SEPOLIA_RPC_URL=https://your-sepolia-rpc.example
```

The Privy identifiers are public browser configuration. No private key or Privy App Secret belongs in this repository.

## Verification

```bash
npm run verify
npm run contracts:verify
npm run contracts:official-deployments
npm run contracts:sepolia:validate
```

The exact product specification is [meme-eth-fee-locked-v1.json](contracts/spec/meme-eth-fee-locked-v1.json). The launch trust boundary is documented in [frontend-transaction-preflight.md](docs/frontend-transaction-preflight.md). Current release gates are in [product-brief.md](docs/product-brief.md) and [MAINNET-READINESS.md](contracts/security/MAINNET-READINESS.md).
