# Backed custom accounting

My proposed custom curve needs `beforeSwapReturnDelta`. For each swap, the design records the specified and unspecified
currency in all four direction/exactness combinations. Every returned delta is matched to reserve assets held by the
hook, and the draft includes per-pool solvency, zero-sum, partial-fill, nested-action, slippage, fuzz, invariant, and fork
tests. No code or audit exists yet.

Does the permission bit alone make this idea forbidden, or how should Programmable handle it?
