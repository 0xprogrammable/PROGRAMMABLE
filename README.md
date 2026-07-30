# Programmable

<img src="./public/brand/programmable-final-x-banner-1500x500.png" alt="Programmable" />

Programmable is an interface for launching tokens whose market behavior is defined by Uniswap v4 hooks.

[programmable.family](https://programmable.family) · [X](https://x.com/0xProgrammable)

## Launch models

| Model | Status | Purpose |
| --- | --- | --- |
| Classic | Live on Ethereum Mainnet | Fixed supply, permanently locked one-sided liquidity and creator rewards in ETH |
| Stock-Paired | Live on Ethereum Mainnet | Fixed supply traded against an allowlisted Ondo tokenized stock or ETF quote asset |
| Deep | Release candidate, not deployed | A fixed 0.90% growth fee buys the token and adds both assets to the original permanently locked pool |

Only models with a completed deployment manifest, matching runtime code and verified lifecycle are exposed for production launches.

## Classic

The current public launch flow creates a fixed supply of 1,000,000,000 tokens through the official Uniswap UERC20Factory.

- The creator and Programmable receive no token allocation
- The complete launch allocation enters one permanently locked, one-sided Uniswap v4 position
- Launching has no protocol fee or liquidity deposit
- The creator makes an initial buy of at least 0.0006 ETH and pays Ethereum gas
- The public interface currently uses a fixed 1.00% swap fee
- The creator receives 0.90% and Programmable receives 0.10%
- The fee applies only in the canonical hooked pool, not to ordinary ERC-20 transfers

The 0.10% Programmable share is deducted from the selected swap fee. It is not added on top.

Token metadata uses the official UERC20 v2.0.0 format:

```text
(string description, string website, string image, bytes extraData)
```

Optional X and Telegram links are encoded as versioned UTF-8 JSON in `extraData`.

## Stock-Paired

Stock-Paired launches use an allowlisted Ondo tokenized stock or ETF as the
canonical v4 pool's quote asset. An initial ETH buy is routed through USDC and
the selected quote asset before purchasing the launched token.

- The launched token remains a separate fixed-supply ERC-20
- The pool charges a fixed 1.00% hook fee
- The creator receives 0.90% and Programmable receives 0.10% in the quote asset
- The full launch allocation enters a permanently locked one-sided v4 position
- The hook supports either v4 currency ordering and discloses that ordering onchain
- Public launches deterministically select the launched token as `currency0` for broad indexer compatibility

## Application

- Explore lists launches emitted by the verified production launcher
- Launch prepares calldata on the server and simulates it before wallet confirmation
- Profile groups tokens and creator rewards for the connected beneficiary
- Privy supports browser wallets, WalletConnect and an embedded Ethereum wallet
- Trading uses the official v4 quoter, Universal Router and Permit2
- Production reads require two independent RPC providers to agree on confirmed chain state
- Launch and trading preparation fail closed when deployment or runtime checks do not match
- Public indexer metadata is available through `/api/indexers/v1/tokens`

The public read model pairs canonical launch events, ignores unrecognized shared-hook events and hydrates token state from the official StateView at one confirmed snapshot block.

## Release status

The active Classic deployment is recorded in [`contracts/deployments/mainnet-classic-v2.json`](./contracts/deployments/mainnet-classic-v2.json). Its deployment receipts, constructor configuration, runtime code hashes and signed launch, buy, sell and claim lifecycle have been reconciled through two RPC providers. The deployed contracts have exact source matches on Etherscan and Sourcify.

The active Stock-Paired deployment is recorded in [`contracts/deployments/mainnet-stock-paired-v2.json`](./contracts/deployments/mainnet-stock-paired-v2.json). Its public indexer records preserve the quote asset, v4 pool ordering, hook, fees and exact Stock-Paired release.

Deep V3 is not deployed. It remains unavailable in the public launcher until its deployment, source verification, canary lifecycle and production keeper evidence are complete. A passing local test suite is not a production release.

There has been no external smart-contract audit or public security contest. This repository does not promise that a token is immune to abuse or accepted by third-party scanners.

## Local development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

Copy `.env.example` to `.env.local` and provide your own Privy, RPC and storage configuration. Browser-facing Privy identifiers are public configuration. App secrets, storage tokens, RPC credentials and signing material must stay outside the repository.

## Verification

```bash
npm run verify
npm run contracts:verify
npm run contracts:official-deployments
npm run contracts:sepolia:validate
```

Key references:

- [`docs/uniswap-source-provenance.md`](./docs/uniswap-source-provenance.md)
- [`contracts/security/MAINNET-READINESS.md`](./contracts/security/MAINNET-READINESS.md)
- [`contracts/security/CLASSIC-V3.md`](./contracts/security/CLASSIC-V3.md)
- [`contracts/security/DEEP-V3.md`](./contracts/security/DEEP-V3.md)
- [`contracts/release/DEEP-FULL-RANGE-V3.md`](./contracts/release/DEEP-FULL-RANGE-V3.md)
- [`docs/frontend-transaction-preflight.md`](./docs/frontend-transaction-preflight.md)
- [`docs/public-indexer-feed.md`](./docs/public-indexer-feed.md)
