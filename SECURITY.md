# Security

## Current status

Security properties are recorded per launch model. Classic is currently the only available model. It has unit,
integration, fuzz, invariant, regression, static-analysis and coverage checks. It has not received an independent
smart-contract audit or public security contest.

These checks are evidence, not a safety guarantee.

| Record | Scope |
| --- | --- |
| [Classic security properties](docs/security/CLASSIC_PROPERTIES.md) | Trust boundaries, permissions, accounting and invariant evidence |
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

The live Classic contracts are non-upgradeable and expose no administrator role, pause function, mint path, blacklist
or mutable fee allocation. This removes administrative recovery as well as administrative control.

The intended properties include:

- only `PoolManager` may enter swap callbacks;
- each pool is registered once and bound to its recorded creator;
- the pool shape, hook permissions and public fee disclosure remain fixed;
- the complete launch supply enters permanent position custody;
- creator and Programmable claims are accounted separately in native ETH;
- unrelated callers cannot redirect a claim;
- token transfers have no tax; and
- unsupported partial-fill accounting reverts.

The detailed property-to-test map is in
[`docs/security/CLASSIC_PROPERTIES.md`](docs/security/CLASSIC_PROPERTIES.md).

## Trust assumptions

- Pinned Uniswap v4, liquidity-launcher and UERC20 contracts behave as documented.
- Ethereum consensus and native ETH settlement remain available.
- Integrators use the exact addresses and runtime hashes in
  [`deployments/ethereum.json`](deployments/ethereum.json).
- Frontend, wallet, RPC, indexer and metadata availability remain separate from contract safety.

## Known limitations

- There is no emergency pause or upgrade path.
- A native ETH recipient that rejects payment can block its direct claim until that recipient uses its authorized
  redirect function.
- Swaps that produce unsupported partial-fill accounting revert.
- Public ordering and sandwich risks remain applicable to swaps.
- Metadata and project links may be indexed inconsistently by third-party services.
- Permanent lock properties depend on the pinned forwarder and PositionManager semantics described in the
  [Classic model documentation](models/classic/README.md#liquidity-custody).
