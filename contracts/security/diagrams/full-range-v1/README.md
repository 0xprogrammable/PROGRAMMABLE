# Deep FullRange V1 security diagrams

This directory contains the visual-inspection stage for the frozen Deep FullRange V1 source.

## Scope

The core scope is the launcher, automation coordinator, vault factory, vault, position planner and fixed policy.
The shared fee-oracle hook, range source, fee-split vault and their factories are included because the core binds them
as security dependencies. Uniswap PoolManager, PositionManager, UERC20Factory and PositionFeesForwarder are shown as
external trust boundaries rather than re-documented in full.

## Artifacts

- `inheritance.md` is the readable inheritance view.
- `public-external-functions.md` is generated from the compiler AST.
- `state-authorization.md` maps mutable state to the callers allowed to change it.
- `compiler-surface.json` is the deterministic machine-readable source for declared functions, state variables and
  inheritance.
- `slither-inheritance.raw.dot` is the unmodified Slither inheritance printer output.
- `slither-ir-limitations.raw.txt` records the printer warnings discussed below.

Regenerate the compiler-derived files after a source change:

```sh
forge build --ast --force
node security/diagrams/full-range-v1/generate-surface.mjs
```

The Slither pass used:

```sh
slither src/LiquidityGrowthFullRangeLaunchV1.sol \
  --exclude-dependencies \
  --print inheritance-graph,function-summary,vars-and-auth
```

## Known Slither limitation

Slither 0.11.5 reports packed-v4 IR generation errors for callbacks and tuple-heavy functions such as
`unlockCallback`, `_compoundOneChunk`, `_compoundInsideUnlock` and `quoteRange`. The printers still complete, but some
call edges and write relationships can be absent. The readable views therefore use Slither for the first pass and the
Solidity compiler AST plus direct sender-check review to restore those omitted edges. This is a tooling limitation, not
evidence that the omitted code paths are unreachable or safe.
