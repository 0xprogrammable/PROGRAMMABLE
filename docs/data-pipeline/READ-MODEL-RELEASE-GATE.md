# Read model release gate

This gate decides whether a reviewed Vercel deployment has enough current evidence to enable indexed reads. It does not deploy, promote, or change a production flag.

## What the evidence proves

The release bundle keeps two questions separate.

### Dataset cardinality

The runtime capture must contain every eligible launch returned by the private performance dataset. The gate requires at least 200 unique launches and accepts at most 400 for this profile. The current production expectation is 260.

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

## Release sequence

1. Build a clean integration commit.
2. Deploy that exact commit to a deployment-specific Vercel URL without assigning the production domain.
3. Capture the private runtime dataset, raw dual-RPC trace, and signed HTTP samples.
4. Verify artifact digests, Git SHA, deployment ID, Vercel project, response identities, cache contracts, latency, parity, and fallback state.
5. Promote only when every check passes and the integration owner has approved publication.

A local test, simulation, preview build, or successful provider request is not production activation evidence.
