# Project structure

Programmable is one repository with three product layers: the web application, the contract workspace, and release tooling.

```text
Programmable/
├── app/          Next.js routes, pages, and API handlers
├── components/   Shared interface components
├── lib/          Product logic, onchain readers, and integrations
├── public/       Runtime web assets, brand files, and social previews
├── contracts/    Foundry contracts, tests, scripts, specifications, and evidence
├── config/       Shared application configuration
├── scripts/      Development, verification, and release utilities
├── ops/          Versioned external workflow and operations configuration
├── tests/        Application and integration tests
├── docs/         Maintained product, security, and operations documentation
├── outputs/      Research reports and ignored QA output
├── artifacts/    Ignored local publishing masters
├── work/         Ignored research checkouts
└── tmp/          Ignored temporary evidence and local captures
```

## Source directories

`app/`, `components/`, `lib/`, `contracts/`, `config/`, `scripts/`, `ops/`, `tests/`, `docs/`, and referenced files in `public/` are product source. Changes in these paths belong in a scoped branch and must pass their relevant checks.

## Branch model

- `production` contains the complete reviewed product and is the only source for website production releases.
- `main` contains the public contract and release-evidence history. It is not a website deployment source.
- `codex/*` branches contain one scoped workstream and merge through a pull request.

New product work starts from `production` unless a contract-only task explicitly targets `main`. Production is never deployed from a feature branch or a dirty worktree.

## Local generated directories

`node_modules/`, `.next/`, `contracts/out/`, `contracts/cache/`, `artifacts/`, `outputs/qa/`, `work/`, and most of `tmp/` are local or generated. Do not commit them unless a release specification explicitly requires a particular evidence file.

Some files under `tmp/` and `contracts/broadcast/` may contain deployment evidence. Inspect them before cleanup. Never treat those directories as disposable without checking their contents.

## Worktree convention

Parallel tasks use separate worktrees. Use responsibility-based names such as `programmable-web`, `programmable-classic`, or `programmable-integrations`. A feature task owns only its assigned paths. The `production` integration worktree is the sole place where completed branches are combined, verified, and prepared for release.
