# Proposal

## Outcome

Overtime v1 is a recurring leader-time game implemented as one fee-enforcing Uniswap v4 hook. An opt-in exact-input WETH buy takes the crown. Ordinary swaps pay the same hook-owned fee but never change the leader or clock.

The proposal is bound to source commit `12507ab8626fb707a21777be0ed88fdb1bd63429` and tree `c6d575f7f2cd30d04f7bd5383b3bd63a1eaf4ca7` in repository id `1326198143`.

## Game

The first valid challenge starts a round with a 15-minute soft deadline and a fixed 60-minute hard deadline. Each later challenge extends the soft deadline to the lesser of the hard deadline and the greater of the existing deadline or five minutes after the challenge.

A challenge requires at least 0.01 WETH of actual settled quote volume. It pays the ordinary 110-basis-point hook-owned fee and a crown cost equal to the active pot times 50 basis points, clamped between 0.001 WETH and 0.05 WETH. A same-block displacement credits the displaced challenger contribution to a pull-based refund.

At a soft-deadline knockout, 40 percent goes to the champion, 50 percent is distributed by crown-seconds, and 10 percent rolls over. At the hard-cap decision, no champion bonus exists, 90 percent is distributed by crown-seconds, and 10 percent rolls over. Claims and refunds are pull-based without an administrator redirect path.

## Fee kernel

The hook calculates liabilities from actual settled WETH. Exactly 10 basis points of gross quote volume accrue to the Programmable liability and 100 basis points accrue to the game liability. The implementation covers exact-input buys, exact-output buys, exact-input sells, and exact-output sells. Empty hook data selects ordinary mode; authenticated challenge mode accepts only exact-input WETH-to-token buys and rejects partial fills atomically.

Programmable fees, pending-pot funds, active-pot funds, finalized champion pools, finalized crown-time pools, same-block refunds, and claimed amounts remain separate accounting domains. Available funds are not inferred from the hook's raw WETH balance.

## Contracts and custody

The source contains the seven requested implementation units: `OvertimeHook.sol`, `OvertimeChallengeRouter.sol`, `OvertimeToken.sol`, `OvertimeLauncher.sol`, `LockedLiquidityVault.sol`, `RoundMath.sol`, and `HookDataCodec.sol`.

The launcher has one atomic deployment-and-launch entrypoint. It deterministically creates the fixed-supply token, challenge router, hook, and locked-liquidity vault; initializes the canonical WETH pool; and transfers the initial position claim into the vault in the same transaction. Any failed initialization or liquidity-lock step reverts the entire child deployment graph.

There is no owner sweep, WETH or game-token rescue, pause, parameter setter, payout redirection, arbitrary router call, post-deployment mint, or removable initial-liquidity path.

## Architecture review item

The launch-session wallet has not been selected. That wallet determines the launcher root address, while the declared child-salt rules determine the token, router, hook, vault, and canonical PoolKey beneath it. The package therefore requests architecture review rather than claiming approval. Before execution, the compiler must bind one wallet, derive every address, verify the hook permission mask `0x20cc`, and rehearse the exact atomic transaction.

## Requested assessment

Assess the exact source and evidence bindings, the `beforeSwapReturnDelta` fee signs across all four ordinary quadrants, challenge settlement authentication, liability conservation, deterministic address graph, and permanent initial-liquidity custody. This submission does not request deployment authority and does not claim an audit, endorsement, or launch.
