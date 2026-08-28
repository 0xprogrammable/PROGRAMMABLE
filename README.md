<p align="center">
  <a href="https://programmable.market" aria-label="Open Programmable">
    <picture>
      <source
        media="(prefers-reduced-motion: reduce)"
        srcset="./assets/readme/programmable-repository-night-garden-v3.png"
      />
      <img
        src="./assets/readme/programmable-repository-night-garden-v4.gif"
        alt="Programmable's white loop mark above a colorful night garden while small round stars twinkle in a black sky"
        width="100%"
      />
    </picture>
  </a>
</p>

<h1 align="center">Programmable</h1>

<h3 align="center">Shape what assets can do</h3>

<p align="center">
  The public application, Ethereum contracts, read model and maintained product documentation for Programmable.
</p>

<p align="center">
  <a href="https://programmable.market"><strong>Open Programmable</strong></a>
  &nbsp;·&nbsp;
  <a href="https://programmable.market/explore">Explore</a>
  &nbsp;·&nbsp;
  <a href="https://programmable.market/launch">Create</a>
  &nbsp;·&nbsp;
  <a href="https://programmable.market/docs">Docs</a>
  &nbsp;·&nbsp;
  <a href="https://programmable.market/docs/developers">Developers</a>
</p>

## What this repository owns

Programmable is a launch platform for Uniswap v4 products. This repository contains the Next.js application, the
contract workspace, the public read model and the evidence that binds what the product shows to deployed code.

Classic is the direct launch model for a fixed supply token, a permanently locked ETH pool and configurable creator
rewards. Custom is the deterministic bundle model for products that need their own hook, application logic or
execution graph. Public V3.3 general-hook creation and wallet-owned lifecycle reads are live on Ethereum Mainnet. V2
and V1 history and schemas remain readable, while fresh authenticated POSTs are permanently read-only with
non-retryable `409 CUSTOM_LAUNCH_V2_READ_ONLY` and `409 CUSTOM_LAUNCH_V1_READ_ONLY` responses. Only V3.3 accepts new
submissions. CLI `3.3.9` is the current installable release and defaults to live profile `3.3.0`. Explicit profile
`3.4.0` output remains preparatory and is rejected by live capabilities until the backend activates that profile.
Prediction Markets is a separately versioned Uniswap v4 launch model for onchain outcome markets. Its current
capabilities, contracts and release evidence live in the public
[`Prediction-Markets`](https://github.com/0xprogrammable/Prediction-Markets) repository.
Each release defines its funding and signing path. User-funded flows keep the connected wallet in control of its own
transaction.

## Launch models

| Model                  | What it creates                                                       | Access                                                    |
| ---------------------- | --------------------------------------------------------------------- | --------------------------------------------------------- |
| **Classic**            | A fixed supply token with configurable buy and sell transaction fees  | Open through [Create](https://programmable.market/launch) |
| **Custom**             | A token or application with its own deterministic hook graph          | Wallet-bound [Custom Launch API](https://programmable.market/developers/api-keys) |
| **Prediction Markets** | Onchain outcome markets powered by Uniswap v4                         | Open through [Create](https://programmable.market/launch) |

A hook is a smart contract attached to a Uniswap v4 pool. The pool calls it at defined points in a transaction, which
lets the product apply behavior at the pool level. A hook can change fees, accounting, access or other pool behavior,
but the word hook does not establish safety, compatibility or launch approval.

[Compare the launch models](https://programmable.market/docs/tokens)

<p align="center">
  <img
    src="./assets/readme/programmable-repository-system-v4.jpg"
    alt="A river connects distinct flowering regions inside Programmable's night garden"
    width="100%"
  />
</p>

## How public state is built

1. A launch request is normalized under the active Classic, Custom or Prediction Markets release.
2. The active release authenticates and submits the required transaction under its published signer and funding
   policy.
3. The required network confirms the transaction and the launch reaches the required finality.
4. The product read layer publishes the canonical token, pool or prediction market identity.
5. Optional price, chart and liquidity data are attached only when their providers return current evidence.

Canonical launch identity remains visible when optional market data is unavailable. The application does not invent
valuation, liquidity, provenance or provider support from a token name, ticker or image.

## Repository map

| Path                                                            | Responsibility                                                                    |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| [`app/`](./app), [`components/`](./components)                  | Product routes, API handlers and shared interface components                      |
| [`lib/`](./lib), [`indexer/`](./indexer)                        | Product logic, onchain readers, indexing and external integrations                |
| [`contracts/`](./contracts)                                     | Foundry contracts, tests, deployment scripts, specifications and release evidence |
| [`config/`](./config), [`scripts/`](./scripts), [`ops/`](./ops) | Shared configuration, verification and production operations                      |
| [`tests/`](./tests), [`docs/`](./docs)                          | Application tests and maintained product, security and operations documentation   |
| [`public/`](./public), [`assets/`](./assets)                    | Runtime brand files, social previews and repository presentation assets           |

Read the complete [project structure](./docs/PROJECT-STRUCTURE.md).

## Run locally

Use Node.js `24.14.0`, then install the locked dependency tree and start the application:

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`. Supply your own Privy, RPC and storage configuration in `.env.local`. Never commit RPC
credentials, storage tokens, signing material or other secrets.

## Verify a change

Run the complete repository gate:

```bash
npm run verify
```

For a contract-focused change, also run:

```bash
npm run contracts:verify
```

These commands prove only the local revision that was checked. They do not prove deployment, production activation,
provider availability or onchain lifecycle completion.

## Public interfaces

| Surface                      | Canonical location                                                                                       |
| ---------------------------- | -------------------------------------------------------------------------------------------------------- |
| Product                      | [programmable.market](https://programmable.market)                                                       |
| Explore                      | [programmable.market/explore](https://programmable.market/explore)                                       |
| Prediction Markets           | [programmable.market/markets](https://programmable.market/markets)                                       |
| Documentation                | [programmable.market/docs](https://programmable.market/docs)                                             |
| Custom Launch API keys       | [programmable.market/developers/api-keys](https://programmable.market/developers/api-keys)               |
| Wallet-owned V1 launch reads | [api.programmable.market/v1/custom-launches](https://api.programmable.market/v1/custom-launches)          |
| Custom Launch API readiness  | [api.programmable.market/readyz](https://api.programmable.market/readyz)                                  |
| Custom Launch CLI 3.3.9      | [public V3 GitHub Release asset](https://github.com/0xprogrammable/PROGRAMMABLE/releases/download/programmable-launch-v3.3.9/programmable-launch-3.3.9.tgz) |
| Custom Launch CLI 1.0.1      | [V1 compatibility asset](https://github.com/0xprogrammable/PROGRAMMABLE/releases/download/programmable-launch-v1.0.1/programmable-launch-1.0.1.tgz) |
| Custom Launch V1 OpenAPI     | [live reads and write fence](https://programmable.market/openapi/custom-launch-v1.json)                    |
| Custom Launch V2 OpenAPI     | [V2 reads, schemas and write fence](https://programmable.market/openapi/custom-launch-v2.json)             |
| Custom Launch V3 OpenAPI     | [preparatory profile 3.4 contract; live/default remains discovery-bound profile 3.3](https://programmable.market/openapi/custom-launch-v3.json) |
| Read-only developer reference | [programmable.market/docs/developers](https://programmable.market/docs/developers)                       |
| Read-only service status     | [developers.programmable.family/api/v2/status](https://developers.programmable.family/api/v2/status)     |
| Deployment manifest          | [developers.programmable.family/api/v2/manifest](https://developers.programmable.family/api/v2/manifest) |

Ethereum contract addresses and integration data should come from the versioned manifest rather than screenshots,
token names or third-party metadata. For Prediction Markets, use the canonical repository for the current networks,
supported market types, economics, resolution rules, contract addresses and release evidence.

V2 and V1 list and single-resource reads remain live for existing wallet-owned requests. Fresh POSTs return
non-retryable `409 CUSTOM_LAUNCH_V2_READ_ONLY` and `409 CUSTOM_LAUNCH_V1_READ_ONLY`; only V3.3 is the current
production submission contract. CLI and preflight checks prepare and classify exact bytes, while the API server makes
the durable decision and exposes no wallet handoff until the per-launch behavior, fee and liquidity evidence required
by the selected lane is verified. A 10 bps claim applies only to a fee-certified profile or adapter and its exact
stamped PoolKey; arbitrary Custom hooks are not automatically fee-enforced. No admission result is an audit or a
universal safety, honeypot, liquidity, tradeability or fee-behavior guarantee. Legacy Registry and GitHub submission
intake is closed.

## Related repositories

| Repository                                                                                 | Responsibility                                                              |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| [`Launch-Policy`](https://github.com/0xprogrammable/Launch-Policy)                         | Versioned Custom launch requirements, policies and schemas                  |
| [`Developers`](https://github.com/0xprogrammable/Developers)                               | Read-only discovery manifests, API contracts and verification rules         |
| [`Prediction-Markets`](https://github.com/0xprogrammable/Prediction-Markets)               | Prediction market contracts, release specifications and deployment evidence |

## Release and security boundaries

`production` is the canonical full-product branch and the only source for website releases. `main` preserves public
contract and release-evidence history. Feature branches merge through reviewed pull requests.

Source verification, passing tests, a Registry record, a prepared action or a visible token page are not an external
audit, a safety guarantee, proof of liquidity or wallet authorization. Deployment, activation, finality and public
availability require separate evidence.

The smart contracts in this repository have not undergone an external audit or public security contest.

<p align="center">
  <a href="https://programmable.market">Website</a>
  &nbsp;·&nbsp;
  <a href="https://programmable.market/explore">Explore</a>
  &nbsp;·&nbsp;
  <a href="https://programmable.market/launch">Create</a>
  &nbsp;·&nbsp;
  <a href="https://programmable.market/docs">Docs</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/0xprogrammable">GitHub</a>
  &nbsp;·&nbsp;
  <a href="https://x.com/0xprogrammable">X</a>
</p>
