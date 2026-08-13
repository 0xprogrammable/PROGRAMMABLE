# Read-model RPC cursor

`GET /api/ops/index-v2` remains the only writer for the durable public Explore
model. Its source path is:

1. `app/api/ops/index-v2/route.ts`
2. `readLiveExploreModel` in `lib/onchain/read-model.ts`
3. Classic V2, Classic V3 and Stock-Paired event readers
4. `writeDurableExploreModel`

The event readers intentionally continue to reconstruct and compare the same
complete model across both configured RPC providers. Each event stream is one
logical full-range request. The transport splits a cold or uncovered range into
the manifest's existing `logBlockRange` before contacting that provider, then
returns only after the complete stream has passed its final integrity closure.
This preserves the provider-safe chunk size without paying cursor and log-block
proof reads once per artificial chunk on every warm run.

## Persistence and identity

Finite `eth_getLogs` ranges are stored under
`indexes/rpc-log-cursors/v2/<chain>/<provider>/<stream>/`. A stream identity is
derived from the chain, a one-way endpoint digest, the address and topics. It
never contains the endpoint or its credential. Primary and secondary providers
therefore have separate histories and still produce independently compared
event fingerprints.

Each cursor is a content-hashed, ordered list of non-overlapping immutable
segments. Each segment is content-hashed and bound to its final block hash.
Cursor updates use the Blob ETag as a compare-and-swap precondition. A completed
segment is persisted before coverage advances, so a retry or a new server
process fills only uncovered gaps instead of repeating prior ranges. This also
allows a canonical full-history indexer to persist an earlier prefix when a
public incremental read happened to seed a later tail first.

The cursor is bounded to at most eight segment descriptors. Adding a ninth
adjacent suffix triggers a verified immutable rollup before the cursor CAS;
non-adjacent fragmentation that cannot be compacted fails closed. A segment is
limited to 4 MiB and the cursor envelope to 64 KiB. Serving a covered range
therefore performs at most one cursor read plus eight segment reads, independent
of how many original suffixes have already been rolled up. Segment count,
persisted byte length and the rollup sources are revalidated after every restart.

Before cached history is served, the provider must return the cursor block with
the same hash. The same logical stream request validates it again after reading
all covered segments. A mismatch fails closed with
`PersistentRpcCacheReorgError`; it does not silently rebuild from an arbitrary
ancestor or weaken the two-provider quorum. Duplicate log provenance,
non-canonical ordering, malformed content, missing segments and overlapping or
unordered cursor coverage also fail closed.

Fresh log and runtime-code reads are bracketed by two exact reads of the same
provider's canonical anchor block. The result is persisted only when both anchor
hashes are identical. Every distinct block hash referenced by returned logs is
also checked against that provider before persistence. After all Blob writes and
the cursor CAS, the anchor and every returned log-block proof are checked again.
Identical block-number/hash proofs are deduplicated only inside that one final
anchored provider operation; cached-prefix checks are not memoized across
operations.

Classic V2, Classic V3 and Stock-Paired wrap their complete event-stream group
for one provider in that explicit operation. Each stream cursor is checked
before use. All stream calls must finish, including every Blob CAS, before the
operation rereads the union of its cursor, fresh-log and fresh-anchor proofs and
allows the reader to return. Cursor changes made inside the operation reference
a random integrity-commit ID. Its bounded provider-and-store-specific markers
are created as `pending`, promoted only after their target is present, and
tombstoned as `aborted` if publication or the final proof fails. Each integrity
scope is deliberately limited to one concrete request/store domain; attempting
to mix another domain fails before any marker exists because a distributed
cross-store commit cannot be made atomic. The shared final proof reserves one
highest canonical proof for that concrete request wrapper until
after every marker is committed. That final provider read closes reorgs during
marker publication without adding another RPC to the proof union. If a later
stream aborts before publication, the marker remains absent; pending, aborted
or missing markers all make a restart rescan instead of serving their segments.
The marker also lists the exact digests of every cursor admitted by the scope;
a late or substituted cursor carrying the same commit ID is therefore uncovered.
Proof deduplication and singleflight also bind that wrapper identity, so two
injected stores or backends cannot share results merely because their public
provider ID matches. The scope is synchronously sealed when its callback
settles. Every request rechecks that lease after each external RPC/store helper
and immediately before returning, so detached child work cannot return or
persist after the final-proof window. This is a two-phase admission boundary,
not a cross-request proof cache.

A cached segment's historical log blocks are not
individually reread forever: they were checked before and after their immutable
persistence, and their cursor block hash recursively commits to that complete
history. The operation's cursor precheck and final recheck therefore close the
cached history independent of historical log density. No proof is reused by a
later request or by a different provider. A provider that returns
old-fork logs or bytecode and then a new-fork anchor therefore cannot return a
successful result, including when the reorg occurs inside Blob persistence.

Exact runtime bytecode checks remain in every read-model implementation. For
manifest-bound runtime addresses in the active Classic V2, Classic V3 and
Stock-Paired readers, a provider-specific runtime proof may be reused only while
its attestation block remains canonical and the expected runtime hash is
unchanged. The ordinary caller still hashes and compares the returned bytecode.

## Operations

No new environment variable or database migration is required. The cache uses
the existing `OPS_BLOB_READ_WRITE_TOKEN` (or existing
`BLOB_READ_WRITE_TOKEN`) private Blob store. Without either token the transport
passes through to the RPC provider and makes no persistence claim. It still
preserves the configured provider range bound, but a failure after a successful
internal prefix stops the logical request with `PersistentRpcCacheError`; the
outer adaptive reader does not immediately replay that discarded prefix.
Internal ranges are generated lazily, so an unusually small configured block
range does not materialize an unbounded range array before the first RPC.

The bounded format uses a new `v2` Blob namespace. Existing `v1` objects are
neither trusted nor deleted and may be retired separately after production
verification. The first `v2` run is intentionally a cold historical seed; this
is a cache-format cutover, not a database migration.

Blob reads enforce the path-specific size before parsing: cursor 64 KiB,
segment 4 MiB and runtime proof 256 KiB. Both Blob metadata size and any
`Content-Length` must agree and fit before reading. The `ReadableStream` is then
consumed chunk by chunk with the same hard cap and canceled on overflow,
while truncation, invalid UTF-8 and malformed JSON fail closed. No Blob body
reaches `JSON.parse` before those byte gates pass.

The first successful run seeds historical segments. Subsequent runs read the
canonical cursor and request only the uncommitted suffix of the final range.
The adversarial regression fixture covers restarts, reorgs, duplicates,
concurrent requests, retry-after-partial behavior, fetch-time reorgs, 200-suffix
rollup/restart/reorg behavior and hard byte/read limits. Its regression gate
counts every `eth_getLogs` and `eth_getBlockByNumber`, not only the expensive
method. The production-shaped fixture models five event streams across twenty
provider chunks, then advances the confirmed head by 25 blocks within the same
provider range, matching a five-minute mainnet cron interval. It runs both a
sparse history and a dense history with one log block per historical chunk. The
old full scan is exactly 100 RPC requests. The sparse advancing scan is exactly
18 requests: five suffix `eth_getLogs` calls and thirteen block reads covering
the shared cursor precheck, each stream's stable fresh-read brackets, and the
shared final cursor/new-anchor closure. The dense fixture also returns one fresh
log block before the new end anchor, so its explicit shared pre/final proof
raises the measured total to 20 requests. These are 82 and 80 percent total
request reductions respectively; neither grows with historical log density.
Additional distinct fresh suffix log blocks add their explicit pre/final proofs
and are not misreported by this advancing gate.

The same gate applies the current conservative method costs published by
[Alchemy](https://www.alchemy.com/docs/reference/compute-unit-costs) on
2026-08-13: 60 CU for `eth_getLogs` and 20 CU for
`eth_getBlockByNumber`. The advancing fixtures fall from 6,000 to 560 sparse or
600 dense weighted CU, reductions of 90.67 and 90 percent. Both the raw-request
and method-weighted reductions must remain at least 80 percent. If the provider
changes those costs, update the explicit weights and rebind this evidence
instead of silently treating all RPC methods as equal.

The one-time cold `v2` seed is intentionally not claimed as a reduction. In the
same fixtures it performs 100 log scans plus 222 sparse or 260 dense integrity
block reads (322 or 360 total RPC requests). That higher seed cost buys the
immutable, restart-safe proof used by every later advancing run; failed seeds
resume only uncovered ranges. Production CU verification must distinguish this
cutover from advancing steady state and from an identical-head cache hit.

ETH/USD remains a dual-provider Chainlink read at the exact confirmed model
block. It is not replaced by an offchain price cache. The complete enriched
model is already durably written on the scheduler cadence, so no additional
price-cache environment or weaker freshness contract is introduced here.
