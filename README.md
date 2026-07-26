# Launcher

Launcher is a focused interface for launching tokens on Uniswap v4. It keeps the public product simple while making the launch path, token behavior, and review requirements explicit.

## What this version includes

- An Explore view reserved for tokens created through Launcher.
- A guided launch planner for a new token or an existing fixed-supply Uniswap UERC20.
- Auction-funded and direct-liquidity launch paths.
- A curated behavior library for v4 hook concepts.
- Read-only ERC-20 metadata inspection on Ethereum mainnet.
- Privy-managed sign-in with MetaMask, Phantom, WalletConnect, and an embedded Ethereum wallet for users without one.
- Local launch drafts and an address-specific Profile view.

## Deliberate boundary

This version does not deploy contracts or ask a wallet to sign a transaction. Contract deployment stays disabled until the launch factory, hook compositions, fee routing, simulation gates, and production recipient are reviewed and connected. A saved launch plan is a local draft, not an onchain asset.

No interface can guarantee how every third-party scanner will classify a new v4 pool. The standard existing-token path therefore accepts only tokens whose CREATE2 origin can be reproduced through the configured Uniswap UERC20Factory and whose recorded creator is connected. Transfer taxes, blacklists, rebases, sell restrictions, mutable supply controls, opaque proxies, and arbitrary ERC-20 contracts remain outside that path.

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
SEPOLIA_RPC_URL=https://your-sepolia-rpc.example
```

The App ID and optional App Client ID are public browser configuration. No private key or Privy App Secret belongs in this application.

## Contract workspace

The `contracts/` workspace contains three protocol-tested Uniswap v4 launch paths. Auction launch reuses the official UERC20Factory, LiquidityLauncher, Continuous Clearing Auction and LBPStrategy. Direct v4 pool creates the fixed-supply token, bound hook, pool and locked full-range position atomically with creator-supplied liquidity. Existing token pool verifies a previously created UERC20 against the configured official factory and requires its recorded creator before opening the same locked direct-liquidity path. Every path uses a deterministic, non-upgradeable hook with a fixed 0.10% platform fee and immutable recipient. Initial LP positions use Uniswap’s PositionFeesForwarder with a zero operator and maximum-block timelock; LP fees remain claimable to the immutable launch creator.

```bash
npm run contracts:verify
npm run contracts:variants
npm run contracts:official-deployments
npm run contracts:sepolia:validate
```

The suite covers all four swap modes, new-token and existing-token budget fuzzing, UERC20 factory provenance, creator authorization, stateful invariants, the full auction-to-v4 migration, locked direct liquidity, fee collection in ERC-20 and native ETH, factory front-running regression and pinned Ethereum deployment snapshots. The deployment check also compares 24 required Mainnet and Sepolia records with Uniswap’s current machine-readable registry, including each active address and official source-code link. None of the three variants is audited or deployed; the open mainnet gates are documented in [`contracts/security/MAINNET-READINESS.md`](contracts/security/MAINNET-READINESS.md).
