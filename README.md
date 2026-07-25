# Launcher

Launcher is a focused interface for planning markets on Uniswap v4. It keeps the public product simple while making the launch path, market behavior, and review requirements explicit.

## What this version includes

- An Explore view reserved for markets created through Launcher.
- A guided launch planner for a new token or an existing Ethereum ERC-20.
- Auction-funded and direct-liquidity launch paths.
- A curated behavior library for v4 hook concepts.
- Read-only ERC-20 metadata inspection on Ethereum mainnet.
- Browser-wallet discovery through EIP-6963, including installed MetaMask and Phantom providers.
- Local launch drafts and an address-specific Profile view.

## Deliberate boundary

This version does not deploy contracts or ask a wallet to sign a transaction. Contract deployment stays disabled until the launch factory, hook compositions, fee routing, simulation gates, and production recipient are reviewed and connected. A saved launch plan is a local draft, not an onchain asset.

No interface can guarantee how every third-party scanner will classify a new v4 pool. The planned contract gate therefore excludes transfer taxes, blacklists, rebases, sell restrictions, mutable supply controls, and opaque proxy behavior from the standard launch path.

## Local development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Verification

```bash
npm run verify
```

The verification command runs ESLint, TypeScript, unit tests, and the production build.

## Configuration

Copy `.env.example` to `.env.local` to use a dedicated read-only Ethereum RPC:

```text
ETHEREUM_RPC_URL=https://your-mainnet-rpc.example
```

No private key belongs in this application.
