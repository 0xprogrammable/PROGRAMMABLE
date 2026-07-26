# Launcher

Launcher is a focused interface for launching tokens on Uniswap v4. It keeps the public product simple while making the launch path, token behavior, and review requirements explicit.

## What this version includes

- An Explore view reserved for tokens created through Launcher.
- A guided launch planner for a new token or an existing fixed-supply Uniswap UERC20.
- Auction-funded and direct-liquidity launch paths.
- A curated behavior library for v4 hook concepts.
- Read-only ERC-20 metadata inspection on Ethereum mainnet.
- Privy-managed sign-in with MetaMask, Phantom, WalletConnect, and an embedded Ethereum wallet for users without one.
- Exact integer-only opening-price calculation for the protocol-tested direct launch.
- An official Uniswap LiquidityLauncher auction encoder with a fixed 50/50 supply split, four-hour CCA schedule, minimum valuation input, full-range migration and no creator ETH deposit.
- A separate bounded dynamic-fee auction composition whose LP fee stays between 0.30% and 1.00%.
- A server-built transaction preflight that verifies chain, runtime bytecode, immutable contract settings, token provenance, balance, allowance, gas and the complete `eth_call` before opening the wallet.
- Local launch drafts and an address-specific Profile view.

## Deliberate boundary

The application can prepare a transaction only from fixed contract ABIs, the official Liquidity Launcher SDK and a
machine-readable deployment manifest. It never accepts a transaction target or calldata from the browser. The three
Launcher factories and direct launcher are deployed, source-verified and recorded with exact runtime-code hashes on
Sepolia. Mainnet preparation still fails closed because the production manifest is deliberately marked `not-deployed`;
it cannot return production transactions until separately reviewed mainnet deployments are recorded.

The auction encoder is implemented locally. It derives a server-owned block schedule, converts the minimum fully diluted valuation to the CCA Q96 floor, derives the graduation threshold and convex emission steps, predicts the token and auction addresses, checks pool availability, and builds one atomic official token-and-auction launch. The permanent LP lock and selected immutable hook are deterministic setup transactions that must exist before that atomic launch. A saved launch plan is still a local draft, not an onchain asset.

The complete browser-to-wallet trust boundary is documented in [`docs/frontend-transaction-preflight.md`](docs/frontend-transaction-preflight.md).

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

The `contracts/` workspace contains four protocol-tested Uniswap v4 launch paths. Auction launch reuses the official UERC20Factory, LiquidityLauncher, Continuous Clearing Auction and LBPStrategy. Its pool can use either the fixed 0.30% LP fee or the separately tested bounded 0.30–1.00% rule. Direct v4 pool creates the fixed-supply token, bound hook, pool and locked full-range position atomically with creator-supplied liquidity. Existing token pool verifies a previously created UERC20 against the configured official factory and requires its recorded creator before opening the same locked direct-liquidity path. Every path uses a deterministic, non-upgradeable hook with a fixed 0.10% platform fee and immutable recipient. Initial LP positions use Uniswap’s PositionFeesForwarder with a zero operator and maximum-block timelock; LP fees remain claimable to the immutable launch creator.

```bash
npm run contracts:verify
npm run contracts:variants
npm run contracts:official-deployments
npm run contracts:sepolia:validate
```

The suite covers all four fixed-fee swap modes, bounded dynamic-fee transitions, new-token and existing-token budget
fuzzing, UERC20 factory provenance, creator authorization, stateful invariants, the full auction-to-v4 migration,
locked direct liquidity, fee collection in ERC-20 and native ETH, factory front-running regression, exact direct and
auction calldata, CCA price and emission math, hook-address mining and pinned Ethereum deployment snapshots. The
deployment check also compares 24 required Mainnet and Sepolia records with Uniswap’s current machine-readable registry,
including each active address and official source-code link. The infrastructure is live on Sepolia, but none of the four
launch variants has completed its full signed lifecycle rehearsal or an independent audit. The open mainnet gates are
documented in [`contracts/security/MAINNET-READINESS.md`](contracts/security/MAINNET-READINESS.md).
