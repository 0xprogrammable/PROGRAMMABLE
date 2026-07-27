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

Production operations replay confirmed chain data through two authenticated RPC providers, require both providers to
agree on the snapshot block, runtime code, canonical events, fee accounting and hydrated token state, then persist an
integrity-checked private snapshot in Vercel Blob. Vercel refreshes it every five minutes. The public health endpoint
fails when either RPC disagrees or the snapshot is more than fifteen minutes old. Full replay is reorg-safe at the
current event volume; it must move to incremental checkpoints before it approaches the function-duration budget.

The ERC-20 remains freely transferable. Its fee applies only in the canonical Classic pool; a separate v3 or v4 pool can trade without the hook.

## Release status

Classic V2 infrastructure is deployed and source-matched on Ethereum mainnet. Its three transactions, constructor
configuration, official dependencies and runtime code hashes reconcile through two independent RPCs. A signed Mainnet
canary then completed the atomic Dev Buy, a separate Universal Router buy, Permit2 authorization, sell and both native
ETH fee claims. The independent lifecycle verifier reconciled all six receipts, the permanent position, final balances
and the immutable treasury payment through two RPCs.

Classic V2, which adds machine-readable symmetric fee disclosure events and getters, is deployed and source-verified on
Ethereum Sepolia. Its signed Test2 lifecycle atomically launched the official UERC20 v2 token, sold through the official
Universal Router, claimed both fee shares and reconciled the permanent position and recipient balances through two
independent RPCs. Start the app with `npm run dev:sepolia` for this current V2 rehearsal deployment. Earlier Sepolia V1
lifecycles remain historical evidence only.

There has been no external smart-contract audit or public security contest. Nothing in this repository is a promise that a token is safe, immune to abuse or accepted by third-party scanners.

Provider-backed Privy session recovery, disconnect and reconnect pass on `programmable.family`. The active Privy web
client allows the production domain and the Vercel production alias. The Privy app remains in Development because
upgrading even its free tier requires payment information and accepts possible billing above 500 monthly active users.

The owner approved the Classic release on July 27, 2026. Mainnet launch and trade preparation remains fail-closed
pending named incident ownership and Privy production billing approval.

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
PRIVY_APP_SECRET=your-server-side-privy-app-secret
ETHEREUM_RPC_URL=https://your-mainnet-rpc.example
ETHEREUM_RPC_URL_B=https://your-independent-mainnet-rpc.example
SEPOLIA_RPC_URL=https://your-sepolia-rpc.example
OPS_BLOB_READ_WRITE_TOKEN=your-private-index-blob-token
TOKEN_IMAGE_BLOB_READ_WRITE_TOKEN=your-public-token-image-blob-token
CRON_SECRET=your-random-cron-secret
```

The Privy App ID and Client ID are public browser configuration. Keep the App Secret and Blob tokens in the deployment
provider only. No private key or server secret belongs in this repository.

## Verification

```bash
npm run verify
npm run contracts:verify
npm run contracts:official-deployments
npm run contracts:sepolia:validate
```

The exact product specification is [meme-eth-fee-locked-v1.json](contracts/spec/meme-eth-fee-locked-v1.json). The launch trust boundary is documented in [frontend-transaction-preflight.md](docs/frontend-transaction-preflight.md). Current release gates are in [product-brief.md](docs/product-brief.md) and [MAINNET-READINESS.md](contracts/security/MAINNET-READINESS.md).
