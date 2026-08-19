# Uniswap v4 SDK integration contract

Use this reference whenever the reviewed project includes its own quote, swap, liquidity-position, or pool-state
client. It complements the contract rules in `security-and-evidence.md`; it does not turn an SDK-generated transaction
into approval, deployment, routing support, or evidence that a transaction was executed.

## Bound baseline

The current tested baseline is the exact package set recorded in `upstream-sources.md`, including
`@uniswap/v4-sdk` `2.3.1` at release gitHead `57f126ee4ae5d435938569ad22c489e4a0262ca2`. Keep the installed lockfile
version, registry integrity, official repository, and release gitHead together. A monorepo branch or current HEAD is
useful drift evidence but is not a substitute for the package release bytes used by the reviewed build.

Import `@uniswap/v4-sdk` only from its public package root. Version `2.3.1` exports `.` only; deep imports such as
`@uniswap/v4-sdk/entities/pool` are not part of the public package contract even if a local build layout happens to
contain that file.

Official starting points:

- [v4 SDK overview](https://developers.uniswap.org/docs/sdks/v4/overview)
- [quote a swap](https://developers.uniswap.org/docs/sdks/v4/guides/swapping/quoting)
- [single-hop swap](https://developers.uniswap.org/docs/sdks/v4/guides/swapping/single-hop-swapping)
- [multi-hop swap](https://developers.uniswap.org/docs/sdks/v4/guides/swapping/multi-hop-swapping)
- [create a pool](https://developers.uniswap.org/docs/sdks/v4/guides/create-pool)
- [read pool data](https://developers.uniswap.org/docs/sdks/v4/guides/pool-data)
- [mint a position](https://developers.uniswap.org/docs/sdks/v4/guides/managing-liquidity/position-minting)
- [fetch positions](https://developers.uniswap.org/docs/sdks/v4/guides/managing-liquidity/position-fetching)
- [modify a position](https://developers.uniswap.org/docs/sdks/v4/guides/managing-liquidity/modifying-position)
- [collect fees](https://developers.uniswap.org/docs/sdks/v4/guides/managing-liquidity/collect-fees)

## Pool identity and coherent reads

- Build one canonical `PoolKey` with sorted currencies, fee, tick spacing, and hook address. Native currency maps to
  the zero address. Derive `PoolId` from the complete key; never key application state by a token pair alone.
- Bind dynamic-fee configuration to a nonzero hook and the exact reviewed hook behavior.
- Read slot state, liquidity, and ticks through the exact per-chain `StateView` at one coherent block. Record the block
  and finality policy used by the quote or position view. Do not assemble a synthetic pool from mixed-block reads.
- Re-resolve chain-specific deployment addresses from the committed deployment records. An address copied from a guide
  or another chain is not a deployment binding.

## Hooked quotes are simulations

`Pool.getOutputAmount` and `Pool.getInputAmount` deliberately reject pools whose hooks have swap permissions. Local
v3-style pool math cannot know the behavior of `beforeSwap`, `afterSwap`, return deltas, external state, or hookData.

For a hooked pool:

1. quote with an `eth_call` simulation against the exact `V4Quoter` or another separately reviewed executable
   simulation path;
2. pass the exact `PoolKey`, direction, exact-input or exact-output amount, hookData, sender assumptions, and relevant
   block context that execution will use;
3. never call the Quoter from an onchain contract and never present a successful simulation as execution evidence;
4. compare the quote with the final PoolManager delta after all hook deltas and route legs; and
5. invalidate or refresh the quote when any bound input or material state changes.

The submission must set `integration.sdkSafetyProfile.localHookedPoolMathDisabled` to `true` and name the exact
`hookedQuoteSource`. Tests must fail if a hooked route falls back to `Pool.getOutputAmount`, `Pool.getInputAmount`, or
another local no-hook approximation.

## Router generation, actions, and slippage

Pass the Universal Router generation explicitly to every `V4Planner` or route construction path. The reviewed SDK can
otherwise fall back to `V2_0`. Do not use the removed `V2_1` generation: it had a per-hop precision defect. The current
official profiles are `V2_0`, `V2_1_1`, and `V2_2_0`; permissioned-pool routing currently requires the reviewed
`V2_2_0` adapter path.

- `V2_1_1` and `V2_2_0` swap actions carry `minHopPriceX36`. If supplied for a multi-hop route, its array length must
  match the number of pools. Prove the bound for every hop and both exactness directions.
- `V2_0` has no `minHopPriceX36`. If it remains selected, disclose and test that limitation rather than claiming the
  later ABI's per-hop bound.
- SDK `2.3.x` defines slippage against loss in final output, not merely an intermediate price movement. The application
  must additionally enforce maximum input for exact-output swaps and the final user delta after hook effects.
- Exact-output success must deliver the full requested output at every relevant hop or revert. Compare requested and
  actual hop output, including routes that repeat a currency: PoolManager's final currency netting can conceal an
  intermediate underfill. Do not infer this protection from Universal Router head `d203e7f...`; that tree still pins
  v4-periphery `363226d...`, while the observed full-fill fix is sibling periphery head `545a5d2...`.
- Encode the exact `V4_SWAP` action plan and settlement actions. Test native value forwarding and refunds, ERC-20
  Permit2 allowance or signature scope, deadlines, zero outputs, partial fills, duplicate currencies, and final deltas.

## Multi-hop hookData parity

Every hop has its own `PathKey.hookData`. The SDK convenience encoder `encodeRouteToPath` fills every hop with `0x`.
That is safe only when empty hookData is the reviewed behavior for every hop.

- If any hop requires nonempty or model-specific hookData, build and review the path explicitly; do not rely on the
  empty-data convenience encoder.
- Preserve byte-for-byte hookData parity across quote, simulation, slippage-bound construction, signing display, and
  execution. Reordering or silently dropping bytes invalidates the quote.
- Record whether multi-hop is unsupported, empty on every hop, explicit per hop, or separately custom-reviewed.
- Fuzz mixed hooked and unhooked paths, repeated currencies, exact output, reverted middle hops, stale state, and
  different hookData on otherwise identical PoolKeys.

## Transaction, wallet, and Permit2 boundary

Keep read/simulation clients separate from the wallet or smart-account client that may sign. A backend, browser,
provider response, indexer, or quote result must not acquire signing authority merely because it produced calldata.

- Distinguish the ERC-20 allowance to Permit2, a Permit2 allowance-transfer or signature-transfer authorization, and
  the Universal Router transaction. Bind spender, token, amount, nonce, expiration, signature deadline, chain id,
  owner and recipient at each applicable layer. Never approve an arbitrary quote-provided spender.
- Before requesting a signature, decode or independently reconstruct the final target, function selector, action plan,
  PoolKeys, hookData, input, output bound, recipient, native value, deadline and refund path. Treat returned calldata as
  untrusted bytes and fail if it differs from the reviewed construction.
- Decode untrusted router bytes only after checking every static head, dynamic offset, dynamic length, overflow-safe
  length multiplication and short selector. Malformed, truncated, overlapping and out-of-range encodings must fail
  before any load, copy, dispatch, approval or transfer.
- If a hook consumes `signedRouteContext`, require the callback caller to equal the selected PoolManager and the callback
  sender to equal the selected Universal Router. Bind both identities and the route context; test each mismatch rather
  than accepting either identity alone.
- Simulate the exact `from`, `to`, `data`, `value`, chain, block context and account type that will be submitted. A
  successful simulation is a preflight result, not an execution receipt, and must be refreshed after material state,
  nonce, allowance, code, quote or deadline changes.
- Confirm the connected chain and account immediately before signing. Support smart accounts without `tx.origin`,
  code-less-EOA, fixed gas-payment or immediate-inclusion assumptions; bind the ultimate asset recipient separately
  from the transaction sender when they differ.
- After broadcast, follow replacement, revert and reorg behavior, wait for the required confirmations, decode the exact
  router and PoolManager events, and reconcile final balances. A transaction hash alone is not success.
- Never place private keys, API secrets, approval policy, or privileged RPC credentials in browser bundles, templates,
  submission records or agent context.

## Liquidity positions

Use the public `V4PositionManager` surface for pool initialization, mint, increase, decrease, burn, and fee collection.
Bind its exact deployed address and package release just like the router.

- A v4 PositionManager is not `ERC721Enumerable`. Discover owned token ids from a pinned indexer or subgraph and
  reconcile ownership, pool key, ticks, liquidity, nonce, approvals, and current state onchain before building a write.
- Fee collection is a position modification that decreases liquidity by zero and takes the currency pair. Test the
  recipient, native/ERC-20 handling, accrued fees, empty positions, deadlines, ownership, approvals, and final balances.
- Increasing liquidity can close currencies to account for accrued fees. Test actual token requirements instead of
  assuming the displayed principal delta is the complete payment.
- Never emit `MINT_POSITION_FROM_DELTAS` or `INCREASE_LIQUIDITY_FROM_DELTAS`. Current v4 periphery marks both
  deprecated and sandwich-vulnerable because they lack minimum-liquidity protection. Use explicit liquidity amounts
  with maximum token inputs, and inspect final planner bytes or execution traces rather than only a source enum name.
  Set `integration.sdkSafetyProfile.deprecatedLiquidityActionsDisabled=true` for every included liquidity-position
  client.
- Keep LP NFT owner, fee beneficiary, removal authority, lock, migration, rescue, and emergency-exit rules explicit.
  An SDK call does not prove that liquidity is locked or that a beneficiary controls the position.

Use `v4-liquidity-and-state.md` for subscribers, donation-inflated `feesAccrued`, and coherent state reads.

## Required evidence

For every market the Builder classifies as tradable, the repository also carries one
`trade-capability-manifest-v1`. Treat it as the authoritative machine-readable route contract: complete PoolKey/PoolId,
chain and reference block, router, quoter, Permit2/native funding, hookData, supported modes, slippage/deadline and fee
semantics must agree byte-for-byte with the quote and execution paths. A standard route names
`standard-uniswap-v4`; a compatible custom path names `canonical-programmable-adapter` and binds the exact
`programmable-trade-execution-v1` schema and ABI contract.

The source manifest declares tests but cannot contain its own Git identity or future run receipts. The bounded executor
must author separate typed result artifacts for the declared commands, and completion must bind those results back to
the manifest and tested source. Every supported mode needs quote and execution evidence; every unsupported mode needs
a rejection before approval, funds, PoolManager lock or application state changes. A project explicitly classified
`no-market` must not receive a synthetic route.

Trade test declarations copy exact RepositoryPlan argv/cwd and bind the sanitized execution profile with
`projectCommandEnvironmentSha256(command)`. A content-shaped result from another command environment is not executor
evidence.

For every included client, bind repository-relative source and executable tests that prove:

- root-only imports and the exact package lock closure;
- canonical PoolKey/PoolId and native-currency behavior;
- hooked V4Quoter simulation with quote/execution hookData parity;
- explicit router generation, exact action ABI, per-hop bounds, and SDK `2.3.x` output-loss slippage semantics;
- Permit2, native value, refunds, deadlines, partial fills, and all supported swap quadrants;
- final calldata decoding, exact pre-signature simulation, account/chain checks, receipt/event/final-balance
  reconciliation, replacement and reorg handling;
- coherent-block StateView reads and stale/reorg behavior;
- position discovery, deprecated-action exclusion, and onchain reconciliation when a liquidity client is included; and
- failure without silent fallback when an SDK, deployment, provider, indexer, or external service is unavailable.

These are implementation and review requirements. Local tests do not prove provider routing, onchain execution,
deployment, approval, or public availability.
