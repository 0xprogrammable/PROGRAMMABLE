# Dexscreener market shadow v1

## Status and authority

This adapter is server-only market enrichment. It has no authority over launch
or coin identity and is never called by browser cards. The interim Explore list
and token-detail routes supply identities from the validated durable launch
envelope. A missing, invalid or unavailable envelope fails closed; this interim
does not substitute a smaller static catalog.

The v1 provider priority is intentionally non-composite:

1. validated last-good identities are supplied to the adapter;
2. Dexscreener is the sole Explore market provider;
3. no second market provider is mixed into the same response;
4. a Dexscreener failure returns the same identities with valuation unavailable.

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
currency `USD`, and internal mode `shadow`. A snapshot separately records `assembledAt`
and the oldest/newest provider-read timestamps in `sourceReadWindow`; cache
assembly time is never presented as provider freshness. Dexscreener does not
provide an observation block for this endpoint, so the contract deliberately
has no `asOfBlock`, `current`, or onchain freshness claim. A value fetched no
more than five minutes ago is labeled `provider-recent`; it may participate in
FDV ordering but is never relabeled as onchain-current. The age comparison is
against the captured `fetchedAt`, including on cache hits. Older, future-dated,
or invalid observations are stale and unqualified.

## Request controls

- Endpoint: `GET /tokens/v1/ethereum/{tokenAddresses}`
- Maximum batch: 30 unique sorted token addresses
- Default concurrency: 2 across all concurrent reads of one reader instance
- Default per-reader start interval: 250 ms (at most 240 starts/minute)
- Default request-and-body deadline: 3 seconds
- Default whole-producer deadline: 7 seconds across every batch; unfinished
  tokens become unavailable and no later batch starts
- Explore and token detail pass one absolute 8-second route deadline plus the
  request signal through the durable catalog and Dex waiter; a caller timeout
  does not cancel a producer still serving another waiter
- Default body cap: 2 MB, counted incrementally while streaming, and 1,000 rows
  per batch
- Retry policy: none
- Redirect policy: fail closed; redirected responses are never relabeled as
  Dexscreener observations
- Non-2xx and invalid-header bodies are aborted and cancelled unread
- Successful cache TTL: 5 minutes
- Successful provider reads, including an empty pair result: 5 minutes
- Transport/rate-limit/invalid-response failure cache TTL: at most 15 seconds
- Cache bound: 32 identity-set snapshots per reader with LRU eviction
- Identity-set cache is order-independent; overlapping sets additionally cache
  and singleflight by token, so `[A,B]` and `[B,C]` fetch `B` once
- Durable catalog reads use their own five-second producer ceiling, request
  cancellation, a 4 MB streaming cap, and never leave shared singleflight
  pinned after all callers leave

The limiter and cache are process-local. The 240 starts/minute per reader cap is
well below the documented provider ceiling, but horizontal serverless fan-out
still multiplies it. Production telemetry must therefore watch 429s and keep the
identity-only response path healthy.

Provider documentation and terms must be rechecked before any public cutover:
[API reference](https://docs.dexscreener.com/api/reference) and
[API terms](https://docs.dexscreener.com/api/api-terms-and-conditions).

## Ranking semantics

For an FDV request, available qualified values sort strictly descending with
canonical launch order as the tie-breaker. Unavailable identities follow in
their original launch order. The ranking reports `partial` when this is a
partial ordering. With zero qualified values the complete list stays in launch
order and reports `unavailable`; it never claims Highest FDV.

## Interim limits and rollback

This is an interim route adapter, not the durable atomic read-model cutover.
Launch identity can be stale or partial and is disclosed with `lastIndexedAt`,
source, block/hash and evidence commitment. The independent Custom Registry is
merged only when its public-read lane succeeds; its failure never removes a
durable identity and is reported as unavailable. Rollback is the previous
production commit; there is no DB, environment, wallet, or provider-account
mutation in this change.
