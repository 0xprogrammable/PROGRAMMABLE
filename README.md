# Launcher

Launcher is a focused interface for launching tokens on Uniswap v4. It keeps the public product simple while making the launch path, token behavior, and review requirements explicit.

## What this version includes

- An Explore view reserved for tokens created through Launcher.
- A guided launch planner for a new token or an existing Ethereum ERC-20.
- Auction-funded and direct-liquidity launch paths.
- A curated behavior library for v4 hook concepts.
- Read-only ERC-20 metadata inspection on Ethereum mainnet.
- Privy-managed sign-in with MetaMask, Phantom, WalletConnect, and an embedded Ethereum wallet for users without one.
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

Create a Privy project, allow the production and local domains, and enable wallet and email login. Then copy `.env.example` to `.env.local`:

```text
NEXT_PUBLIC_PRIVY_APP_ID=your-privy-app-id
NEXT_PUBLIC_PRIVY_CLIENT_ID=your-optional-privy-client-id
ETHEREUM_RPC_URL=https://your-mainnet-rpc.example
```

The App ID and optional App Client ID are public browser configuration. No private key or Privy App Secret belongs in this application.
