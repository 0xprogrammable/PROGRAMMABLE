# Security

## Status

Classic V2 has unit, integration, fuzz, invariant and regression coverage. It has not received an independent
smart-contract audit or public security contest. These checks are evidence, not a safety guarantee.

## Report a vulnerability

Please use GitHub's private vulnerability reporting for this repository. Do not open a public issue for an unpatched
vulnerability and do not include private keys, seed phrases or user data in a report.

No public bug bounty is offered at this time.

## Security model

The live contracts are non-upgradeable and expose no administrator role, pause function, mint path, blacklist or
mutable fee recipient. This removes administrative recovery as well as administrative control.

The intended invariants are:

- only `PoolManager` may enter the unlock callback;
- each pool is registered once and bound to the creator recorded at registration;
- the pool shape is native ETH/token, zero LP fee and tick spacing `200`;
- the token supply is fixed at one billion tokens;
- the complete launch supply is placed into one one-sided position, except deterministic rounding dust that is also
  locked with the position flow;
- the position forwarder has no operator and a maximum timelock;
- hook fees are symmetric on the ETH side of buys and sells;
- the token transfer tax is zero;
- total accounted native claims equal creator claims plus platform claims;
- claims cannot be redirected by an unrelated caller; and
- partial fills that would break exact fee accounting revert.

## Return-delta permissions

The hook intentionally enables:

- `beforeSwap`
- `afterSwap`
- `beforeSwapReturnDelta`
- `afterSwapReturnDelta`
- `beforeInitialize`

Return deltas are required because the fee is collected in native ETH without modifying the launched ERC20 transfer
logic. This permission is high impact: an accounting error can change the amount owed by the swapper or pool.

The implementation checks the pool shape on every relevant callback, allows only registered pools, rejects unexpected
partial fills, uses checked casts and full-precision arithmetic, and keeps claim accounting inside `PoolManager`. The
test suite covers both swap directions, exact input and exact output, rounding, reentrancy, unauthorized redirects and
accounting invariants.

## Trust assumptions

- Uniswap v4 `PoolManager`, `PositionManager`, liquidity-launcher and UERC20 contracts behave as documented at the
  pinned revisions.
- Ethereum consensus and native ETH settlement remain available.
- Integrators use the exact deployed addresses and runtime hashes in [`deployments/ethereum.json`](deployments/ethereum.json).
- Frontend, RPC, indexer and metadata availability are separate from contract safety and are outside this repository.

## Known limitations

- There is no emergency pause or upgrade path.
- A failed native ETH recipient can block a direct claim until that recipient calls its authorized redirect function.
- Swaps that produce unsupported partial-fill accounting revert.
- Metadata and social links are informational and may not be indexed consistently by third-party services.
- Permanent lock properties depend on the pinned forwarder and PositionManager semantics described in
  [`ARCHITECTURE.md`](ARCHITECTURE.md).
