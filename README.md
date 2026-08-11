<p align="center">
  <img src="./assets/readme/programmable-repository-cover-v1.jpg" alt="The Warm Ivory Programmable mark stands between two flowering plants in Programmable's night garden" width="100%" />
</p>

<h1 align="center">Programmable</h1>

<p align="center">
  Application, contracts and public data for tokens built with Uniswap v4 hooks.
</p>

<p align="center">
  <a href="https://programmable.market">Website</a>
  ·
  <a href="https://programmable.market/explore">Explore</a>
  ·
  <a href="https://programmable.market/launch">Create</a>
  ·
  <a href="https://programmable.market/docs/developers">Documentation</a>
</p>

Programmable is an Ethereum application for launching, exploring and trading tokens whose market behavior is defined by Uniswap v4 hooks. This repository contains the website, the contract workspace, the public read model and the evidence that binds what the application shows to deployed code.

## Inside this repository

The product interface and API routes live in [`app/`](./app) and [`components/`](./components). The Solidity workspace, deployment scripts and release evidence live in [`contracts/`](./contracts). Chain reads, indexing and shared product logic live in [`indexer/`](./indexer) and [`lib/`](./lib). Verification, documentation and operations are maintained in [`scripts/`](./scripts), [`tests/`](./tests), [`docs/`](./docs) and [`ops/`](./ops).

The complete directory guide is in [`docs/PROJECT-STRUCTURE.md`](./docs/PROJECT-STRUCTURE.md).

## Public repositories

Programmable uses five public repositories with separate responsibilities.

| Repository                                                             | Purpose                                                                             |
| :--------------------------------------------------------------------- | :---------------------------------------------------------------------------------- |
| [`programmable`](https://github.com/0xprogrammable/programmable)       | The application, contract releases, public read model and release evidence          |
| [`hookbuilder`](https://github.com/0xprogrammable/hookbuilder)         | The agent skill and local tools used to build reproducible Uniswap v4 projects      |
| [`submit-launch`](https://github.com/0xprogrammable/submit-launch)     | One concrete project, token and hook revision prepared for exact-revision review    |
| [`submit-template`](https://github.com/0xprogrammable/submit-template) | Reusable hook template requirements, version binding and acceptance rules           |
| [`developers`](https://github.com/0xprogrammable/developers)           | Discovery manifests, API contracts and verification examples for external platforms |

Use this repository for product, contract and website work. Use `hookbuilder` to build a project, `submit-launch` for one concrete launch submission, `submit-template` for reusable hook logic and `developers` to integrate Programmable data into another product. Review services remain internal; the public repositories describe the inputs and records they consume.

## How data reaches the application

Programmable reads recognized contract events and finalized public records, then reconstructs project and market state at a defined chain snapshot. The application uses that data for Explore, token pages, profiles and transaction preparation.

The connected wallet confirms user transactions. A listing, source match or public record does not by itself authorize a launch or prove that a project is safe.

External consumers can use the public token feed at [`/api/indexers/v1/tokens`](https://programmable.market/api/indexers/v1/tokens). The integration contract and discovery manifest are maintained in [`0xprogrammable/developers`](https://github.com/0xprogrammable/developers).

## Local development

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`.

Provide your own Privy, RPC and storage configuration in `.env.local`. Do not commit RPC credentials, storage tokens, signing material or other secrets.

## Verification

Run the complete product gate:

```bash
npm run verify
```

For contract changes, also use the dedicated contract gate:

```bash
npm run contracts:verify
```

These are local repository checks. They do not prove that a change has been deployed or activated in production.

## Reference

- [Project structure](./docs/PROJECT-STRUCTURE.md)
- [Developer documentation](https://programmable.market/docs/developers)
- [Public indexer feed](./docs/public-indexer-feed.md)
- [Transaction preflight](./docs/frontend-transaction-preflight.md)
- [Uniswap source provenance](./docs/uniswap-source-provenance.md)
- [Mainnet readiness](./contracts/security/MAINNET-READINESS.md)

## Release and security boundaries

`production` contains the complete website product and is the only source for website releases. `main` preserves the public contract and release evidence history. Feature branches merge through reviewed pull requests.

Source verification, local tests, a Registry record or a Programmable listing are not an external audit, a safety guarantee or proof of liquidity. Deployment, activation and public availability require their own evidence.

The smart contracts in this repository have not undergone an external audit or public security contest.
