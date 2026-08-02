# Read model release gate

This gate decides whether a reviewed Vercel deployment has enough current evidence to enable indexed reads. It does not deploy, promote, or change a production flag.

## What the evidence proves

The release bundle keeps two questions separate.

### Dataset cardinality

The runtime capture must contain every eligible launch returned by the private performance dataset. The gate requires at least 200 unique launches and accepts at most 400 for this profile. Do not hard-code the current production count: freeze the complete inventory immediately before each release, record its anchor and digest, and require every frozen launch plus any later eligible arrivals.

Every launch must belong to exactly one of these releases, and every release must have at least one launch:

- `classic-v2`
- `classic-v3`
- `stock-paired-v1`
- `stock-paired-v2`
- `stock-paired-v3`

Token addresses and transaction hashes must be unique. Projection row counts must meet the per-launch ratios in `config/read-model-load-profile.v1.json`.

### Throughput corpus

The load run uses deterministic samples selected from the real cardinality dataset:

- 100 unique eligible token addresses
- 100 unique accounts with profile or reward rows
- 32 unique Classic v3 launches
- 32 unique Stock-Paired launches
- 8 unique mainnet projector candidates

These lists are repeated during the load run. They are not padded to match the full launch count. A repeated load sample and a complete launch inventory are different evidence.

### Complete Explore activation matrix

The 1,000-request throughput corpus remains a latency and capacity sample. It is
not accepted as proof that Explore pagination is complete. After that load run,
the capture therefore records a separate aggregate matrix in:

- `explore-matrix-evidence.v1.json`
- `explore-matrix-pages.v1.jsonl`

The matrix is derived from the complete `eligibleLaunches` inventory returned by
the same protected runtime capture. It never repeats a sampled token to make a
coverage count look complete. The manifest binds the release profile, capture
nonce, staged Vercel URL and deployment id, exact Git SHA, dataset file digest,
dataset timestamp, per-release counts, canonical inventory digest, one snapshot
block/hash commitment, query-case commitments, page artifact digest, and final
corpus digest.

For the normalized empty query, the capture walks every real six-token page and
one `Number.MAX_SAFE_INTEGER` clamp for each supported sort:

- `newest`
- `oldest`
- `market-cap`
- `market-cap-asc`

Those page calls exercise every adjacent indexed cursor through the public route.
The route adapter validates each internal start/end cursor before returning, and
the signed shadow comparison must still match the independently produced legacy
response. The gate additionally reconstructs each traversal from the page
evidence and rejects any gap, duplicate token, missing token, unexpected token,
wrong page count, or clamp that does not resolve to the final real page.

The capture also commits exactly eight unique cases per query kind for real token
names, symbols, and addresses. Cases are selected deterministically from the frozen
inventory, use trimmed mixed-case input (and `$`-prefixed symbol input), and are
accepted only when their normalized query matches their committed source token.
Each selected case is bounded to one real page, then exercised under all four
sorts plus the same maximum-page clamp. A corpus with fewer than eight distinct
bounded real cases in any query kind is rejected; synthetic values and duplicate
padding are rejected.

The empty-query traversal must reproduce every token from each of these release
families under every sort:

- `classic-v2`
- `classic-v3`
- `stock-paired-v1`
- `stock-paired-v2`
- `stock-paired-v3`

All matrix pages must share one public snapshot checkpoint. If the projector
advances during capture, the checkpoint commitments differ and the release gate
fails; operators must take a fresh coherent capture instead of combining pages
from different snapshots.

## Database boundary

The corpus comes from `programmable_private.get_read_model_performance_dataset_v1(bigint)` and its private view. The capture must record the database identity checks from the same runtime transaction.

The accepted evidence proves all of the following:

- session login `programmable_projector_login`
- active role `programmable_projector`
- API reader login `programmable_api_reader_login`
- active API reader role `programmable_api_reader`
- API reader call denied with SQLSTATE `42501`
- API reader has no function execute privilege
- API reader has no view select privilege

The public API reader cannot manufacture or retrieve this corpus.

## Indexer replay boundary

The Envio deployment used for a release must be the exact handler, schema and
source registry committed by the release manifest. A deployment being marked
ready is not enough. Before database backfill, enumerate the complete launch
inventory and require every eligible launch to be both complete and provenance
valid for its declared release. Raw launch counts are never promotable evidence.

The replay must also prove release-specific identity transitions. In
Stock-Paired ETH launches, the launcher may first record the authenticated
coordinator as the provisional deployer. The coordinator event may replace that
value only when it comes from the manifest-bound coordinator and names the
actual creator. A replay that treats this transition as a conflict, accepts an
unbound coordinator, or leaves any supported release incomplete must remain
outside the projector and public route activation.

## Signed route probes

Each parity request carries a unique route-bound HMAC. The secret in `PROGRAMMABLE_SHADOW_PROBE_TOKEN` remains on the capture runner and server. It is never sent in an HTTP header.

The signed payload is:

```text
programmable-release-probe-v1
<indexed route key>
<unique nonce>
```

The deployment validates freshness, route binding, signature, and replay before returning private probe headers. Probe responses must use `Cache-Control: private, no-store`.

## Load and parity contract

The profile runs 1,000 distributed real requests over at least 60 seconds with observed concurrency of at least 20. Every request must be unique, reach the origin, return a successful status, and match its requested dataset key.

The release is rejected if any of these conditions occur:

- any HTTP error
- any cache hit or stale response
- any missing real sample key
- any route p95 or p99 above its configured budget
- any parity result other than `match`
- any missing or true `x-programmable-live-fallback` value
- fewer than 880 signed comparison samples
- any projector deadline, retry, provider, candidate, or commitment mismatch
- any missing Explore matrix sidecar or digest mismatch
- any matrix response that is cached, non-200, non-`match`, missing a signed
  probe measurement, or reports a fallback
- any missing sort, query case, real page, internal-cursor traversal, clamp, token,
  release family, or single-checkpoint binding

## Release sequence

1. Build a clean integration commit.
2. Deploy that exact commit to a deployment-specific Vercel URL without assigning the production domain.
3. Capture the private runtime dataset, raw dual-RPC trace, signed throughput
   samples, and the separately committed complete Explore matrix.
4. Verify artifact digests, Git SHA, deployment ID, Vercel project, response
   identities, cache contracts, latency, parity, fallback state, inventory/page
   completeness, clamping, and the single matrix checkpoint.
5. Promote only when every check passes and the integration owner has approved publication.

A local test, simulation, preview build, or successful provider request is not production activation evidence.
