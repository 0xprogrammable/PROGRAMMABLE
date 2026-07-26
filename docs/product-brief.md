# Launcher product brief

## Product sentence

Launcher is a clear, guided interface for creating a token and defining how its Uniswap v4 pool should behave.

## Audience

The first audience is a project creator who understands the asset they want to launch but should not need to understand hook flags, pool-key ordering, salt mining, or router internals. Experienced teams still need a path to bring a reviewed custom hook.

## Information architecture

- **Explore** contains only tokens launched through Launcher.
- **Launch** turns a token, a liquidity path, and selected pool behavior into a reviewable plan.
- **Profile** groups the connected address's launches, positions, and claims.

## Launch paths

### Auction-funded liquidity

Bids establish an opening price. A configured share of the raised ETH and reserved token supply then seeds a Uniswap v4 pool. This path does not require the creator to contribute ETH, but it still depends on demand and the final auction allocation.

### Direct v4 pool

The creator supplies the token and ETH liquidity used to initialize a v4 pool. This path is appropriate when a team already has its opening price and liquidity budget.

### Liquidity custody

Every verified launch sends its initial v4 position to a deterministic instance of Uniswap's official `PositionFeesForwarder`. Launcher fixes the operator to the zero address and the timelock to the maximum `uint256` block. The creator receives LP fees but cannot transfer the position or remove the initial liquidity. The separate 0.10% Launcher hook fee goes only to the platform treasury.

## Contract boundary

The website can describe and save launch plans before contracts are connected. Mainnet deployment must remain unavailable until:

1. The factory and allowed hook compositions have been implemented and independently reviewed.
2. The permanent platform fee recipient has been supplied.
3. Token and pool simulations pass bidirectional buy and sell checks.
4. Source verification, ownership disclosure, and launch-record indexing are working.
5. Each advanced behavior has an explicit risk model and audit status.

## Visual direction

The interface should feel like a quiet launch desk: dark, precise, and calm. It uses restrained fuchsia as an action color, a narrow set of surfaces, fine dividers, and plain English. The behavior sentence is the signature element: selections should visibly change what the pool will do.

The product must not use fabricated activity, partner logos, unsupported token numbers, testimonials, network-status ornaments, or decorative claims.
