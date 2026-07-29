# Security

## Current status

Classic is the only available launch model. Its current Ethereum release has unit, integration, fuzz, invariant,
regression and Mainnet-fork coverage. All seven release contracts are Etherscan exact matches and Sourcify matches.
Classic has not received an independent smart-contract audit or public security contest.

Stock-Paired is a deployed candidate, not an available launch model. Its lifecycle canary passed on Mainnet and all
seven contracts have Sourcify matches. One contract has an Etherscan Exact Match; the other six currently have Similar
Matches. Stock-Paired also has no independent audit or public security contest.

These records are evidence, not a safety guarantee.

| Record | Scope |
| --- | --- |
| [Classic security properties](docs/security/CLASSIC_PROPERTIES.md) | Trust boundaries, permissions, accounting and invariant evidence |
| [Classic Slither review](docs/security/SLITHER_CLASSIC_V3.md) | Static-analysis findings and manual dispositions |
| [Classic release](releases/classic-v3/RELEASE.md) | Version-bound source, tests and Mainnet lifecycle evidence |
| [Stock-Paired candidate properties](docs/security/STOCK_PAIRED_PROPERTIES.md) | Quote-asset accounting, issuer controls and remaining release gates |
| [Operations](docs/OPERATIONS.md) | Automated checks, monitoring status and incident response |
| [Independent reviews](audits/README.md) | Published external reports, currently none |
| [Ethereum deployment](deployments/ethereum.json) | Addresses, transactions, runtime hashes and verification status |

## Report a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/0xprogrammable/programmable/security/advisories/new).
Do not open a public issue or pull request for an unpatched vulnerability.

Include:

- the affected model release and contract address;
- impact and required preconditions;
- a minimal reproduction or transaction;
- whether funds are at immediate risk; and
- a safe way to contact you.

Never include private keys, seed phrases, credentials or unrelated user data. No public bug bounty is offered at this
time.

## Classic control model

The fee hook, launcher, policy, factories and vault implementations are non-upgradeable. The hook and launcher expose
no owner, pause function, blacklist, post-launch fee setter or token mint path.

The current release has one disclosed administrative role: the Community Takeover authority. It can replace only a
reward vault's future beneficiaries and shares. The vault checkpoints accrued ETH before any replacement, preserving
the prior wallets' historic rewards. The authority cannot alter fee rates, token supply, trading or launch liquidity.

The intended properties include:

- only `PoolManager` may enter swap callbacks;
- each pool is registered once with immutable buy and sell fees;
- the fixed `0.10` percentage-point Programmable share is deducted from the selected fee;
- the complete launch supply enters permanent position custody;
- each beneficiary alone controls its claims and future payout-wallet changes;
- prior rewards remain with the wallet that earned them after a payout or CTO change;
- initial-buy custody schedules and beneficiaries are immutable;
- token transfers have no tax; and
- unsupported partial-fill accounting reverts.

The property-to-test map is in
[`docs/security/CLASSIC_PROPERTIES.md`](docs/security/CLASSIC_PROPERTIES.md).

## Trust assumptions

- Pinned Uniswap v4, liquidity-launcher and UERC20 contracts behave as documented.
- The disclosed CTO authority is used only for reviewed Community Takeovers.
- Ethereum consensus and native ETH settlement remain available.
- Integrators use the exact addresses and runtime hashes in
  [`deployments/ethereum.json`](deployments/ethereum.json).
- Frontend, wallet, RPC, indexer and metadata availability remain separate from contract safety.

## Known limitations

- There is no emergency pause or upgrade path.
- A compromised CTO authority can replace future creator-reward recipients after existing rewards are checkpointed.
- A native ETH recipient that rejects payment can block its own claim transaction.
- Swaps that produce unsupported partial-fill accounting revert.
- Public ordering and sandwich risks remain applicable to swaps.
- Metadata and project links may be indexed inconsistently by third-party services.
- Permanent lock properties depend on the pinned forwarder and PositionManager semantics described in the
  [Classic model documentation](models/classic/README.md#liquidity-custody).
