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
  The public product, contracts, read model and release evidence for Programmable on Ethereum.
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
rewards. Custom is the reviewed path for products that need their own hook, application logic or execution graph. In
both models, the connected wallet reviews and signs its own Ethereum transaction.

## Launch models

| Model       | What it creates                                                       | Access                                                    |
| ----------- | --------------------------------------------------------------------- | --------------------------------------------------------- |
| **Classic** | A fixed supply token with configurable buy and sell transaction fees  | Open through [Create](https://programmable.market/launch) |
| **Custom**  | A token or application with an individually reviewed hook and release | Accepted and activated revisions only                     |

A hook is a smart contract attached to a Uniswap v4 pool. The pool calls it at defined points in a transaction, which
lets the product apply behavior at the pool level. A hook can change fees, accounting, access or other pool behavior,
but the word hook does not establish safety, compatibility or launch approval.

[Compare Classic and Custom](https://programmable.market/docs/tokens)

<p align="center">
  <img
    src="./assets/readme/programmable-repository-system-v4.jpg"
    alt="A river connects distinct flowering regions inside Programmable's night garden"
    width="100%"
  />
</p>

## How public state is built

1. A creator configures Classic or prepares one exact reviewed Custom release.
2. The connected wallet checks the network, destination, calldata and value before signing.
3. Ethereum confirms the transaction and the launch reaches the required finality.
4. The read model publishes the canonical token, pool and launch identity.
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

| Surface             | Canonical location                                                                                       |
| ------------------- | -------------------------------------------------------------------------------------------------------- |
| Product             | [programmable.market](https://programmable.market)                                                       |
| Explore             | [programmable.market/explore](https://programmable.market/explore)                                       |
| Documentation       | [programmable.market/docs](https://programmable.market/docs)                                             |
| Developer reference | [programmable.market/docs/developers](https://programmable.market/docs/developers)                       |
| Service status      | [developers.programmable.family/api/v2/status](https://developers.programmable.family/api/v2/status)     |
| Deployment manifest | [developers.programmable.family/api/v2/manifest](https://developers.programmable.family/api/v2/manifest) |

Contract addresses and integration data should come from the versioned manifest rather than screenshots, token names
or third-party metadata.

## Related repositories

| Repository                                                             | Responsibility                                                            |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| [`hookbuilder`](https://github.com/0xprogrammable/hookbuilder)         | Agent Skill and local tools for building reproducible Uniswap v4 projects |
| [`submit-launch`](https://github.com/0xprogrammable/submit-launch)     | Exact-revision intake and public review records for one completed project |
| [`submit-template`](https://github.com/0xprogrammable/submit-template) | Requirements and version binding for reusable hook templates              |
| [`developers`](https://github.com/0xprogrammable/developers)           | Discovery manifests, API contracts and direct verification rules          |

## Release and security boundaries

`production` is the canonical full-product branch and the only source for website releases. `main` preserves public
contract and release-evidence history. Feature branches merge through reviewed pull requests.

Source verification, passing tests, a Registry record, a review result or a visible token page are not an external
audit, a safety guarantee, proof of liquidity or launch authorization. Deployment, activation, finality and public
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
