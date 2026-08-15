# Dexscreener market shadow v1

## Status and authority

This adapter is server-only shadow evidence. It has no authority over launch or
coin identity, does not mutate `TokenMarketDataV1`, and is not called by a
public route or browser component. Public market responses therefore remain on
their existing Bitquery contract until a separate, reviewed cutover explicitly
changes that contract.

The v1 provider priority is intentionally non-composite:

1. canonical onchain identities are supplied to the adapter;
2. Bitquery remains the public market provider;
3. Dexscreener observations are retained only as a separate shadow result;
4. no field from the two providers is silently merged or used as a fallback.

Dexscreener cannot prove catalog completeness. The 351-token and 20/19/18
coverage figures are a reconciliation baseline from the 2026-08-15 owner
audit, not an acceptance target and not a production observation made by this
commit.

## Binding and value contract

An observation is available only when exactly one response row satisfies every
binding:

- `chainId` is `ethereum`;
- `dexId` is `uniswap`;
- `labels` contains `v4`;
- `pairAddress` equals the canonical bytes32 pool ID;
- `baseToken` is the canonical launch token and `quoteToken` is the canonical
  quote, case-insensitively and without native/WETH substitution;
- `priceUsd`, `liquidity.usd`, `fdv`, and `marketCap` are finite positive USD
  values whose raw JSON lexemes normalize exactly to the website WAD contract.

Zero matches are unavailable. Multiple exact matches are ambiguous and
unavailable. A foreign or more liquid pool is never selected. Missing,
malformed, 429, 5xx, timeout, transport, and oversized-response failures are
isolated to their batch and never remove an input identity.

A valid observation is not automatically a qualified FDV. Ranking eligibility
also requires the existing canonical minimum of $10,000 liquidity. Values below
that boundary remain inspectable shadow observations while their FDV
qualification is explicitly unavailable for `insufficient-liquidity`.

Each observation records its provider-read `fetchedAt`, source `dexscreener`,
currency `USD`, and mode `shadow`. A snapshot separately records `assembledAt`
and the oldest/newest provider-read timestamps in `sourceReadWindow`; cache
assembly time is never presented as provider freshness. Dexscreener does not
provide an observation block for this endpoint, so the contract deliberately
has no `asOfBlock`, `current`, or onchain freshness claim.

## Request controls

- Endpoint: `GET /tokens/v1/ethereum/{tokenAddresses}`
- Maximum batch: 30 unique sorted token addresses
- Default concurrency: 2 across all concurrent reads of one reader instance
- Default per-reader start interval: 750 ms (at most 80 starts/minute)
- Default request-and-body deadline: 3 seconds
- Default body cap: 2 MB, counted incrementally while streaming, and 1,000 rows
  per batch
- Retry policy: none
- Redirect policy: fail closed; redirected responses are never relabeled as
  Dexscreener observations
- Non-2xx and invalid-header bodies are aborted and cancelled unread
- Successful cache TTL: 5 minutes
- Partial/unqualified/failure cache TTL: at most 15 seconds from read completion
- Cache bound: 32 identity-set snapshots per reader with LRU eviction
- Identity-set cache is order-independent; overlapping sets additionally cache
  and singleflight by token, so `[A,B]` and `[B,C]` fetch `B` once

The limiter and cache are process-local. A public serverless fan-out could
multiply that rate, which is another reason this entrypoint is restricted to a
controlled server worker until the persistent read model owns scheduling and
storage.

Provider documentation and terms must be rechecked before any public cutover:
[API reference](https://docs.dexscreener.com/api/reference) and
[API terms](https://docs.dexscreener.com/api/api-terms-and-conditions).

## Ranking semantics

For an FDV request, available qualified values sort strictly descending with
canonical launch order as the tie-breaker. Unavailable identities follow in
their original launch order. The ranking reports `partial` when this is a
partial ordering. With zero qualified values the complete list stays in launch
order and reports `unavailable`; it never claims Highest FDV.

## Promotion gates

Before this source can affect public bytes, a later change must provide all of:

- a versioned public provider-priority and conflict contract;
- a persistent, globally rate-limited worker/cache rather than per-route calls;
- staged shadow evidence with exact identity-preservation and coverage counts;
- explicit UI handling for partial/unavailable ranking and valuation source;
- real identity and market health probes;
- legal/terms revalidation and an owner-approved cutover.

This commit supplies none of those promotion claims and performs no deployment.
