# Read-model scheduler cutover

The production scheduler keeps the durable legacy index active while the
Postgres read model is staged. This avoids a gap in Explore or token discovery
during backfill and parity checks.

## Schedule

| Worker | Route | UTC schedule | Activation |
| --- | --- | --- | --- |
| Legacy index | `/api/ops/index-v2` | Every five minutes | Retained until indexed reads are promoted |
| Source projector | `/api/ops/projector` | Every minute | `PROGRAMMABLE_PROJECTOR_ACTIVE=true` |
| Market projector | `/api/ops/market-projector` | Every minute | `PROGRAMMABLE_MARKET_PROJECTOR_ACTIVE=true` |
| QuickNode stream wake | `POST /api/ops/projector-wake` | Every delivered block | `PROGRAMMABLE_QUICKNODE_STREAM_SECRET` configured |

Each projector has its own singleton execution guard. A second invocation
returns busy instead of overlapping an unfinished run. The market projector
only reads the last fully committed source checkpoint, never in-flight source
state. Both routes require Vercel's `CRON_SECRET` bearer token. Missing or exact
`false` activation values are harmless disabled runs. Exact `true` is the only
active value. Any other non-empty value is a configuration error and must fail
closed.

The QuickNode stream is an authenticated latency trigger, not a third source of
truth. Its payload never enters the read model. A valid delivery returns `202`
immediately and uses Next.js background work to run the existing source
projector followed by the market projector. Envio remains the event source;
the independent Alchemy and QuickNode RPC reads, atomic publication fences and
singleton database leases remain mandatory. Duplicate deliveries are safe, and
the per-minute crons remain the watchdog if a webhook is delayed or lost.

Configure the stream only after the exact staged deployment has passed its
normal release gate:

1. Create a dedicated random secret of 32 to 1,024 UTF-8 bytes. Store it as
   `PROGRAMMABLE_QUICKNODE_STREAM_SECRET` in the Vercel Production environment,
   the protected GitHub Production environment and the QuickNode webhook
   security-token field. The values must match. Keep the committed
   `.env.example` value empty, pass the secret only through the environment and
   never reuse `CRON_SECRET`.
2. Use the Ethereum mainnet block dataset, one block per batch, sequential
   delivery, reorg correction enabled and the smallest block-only payload the
   stream filter permits. The endpoint accepts JSON and QuickNode gzip bodies,
   but rejects encoded bodies above 64 KiB or decoded bodies above 128 KiB.
3. Point the test destination at
   `https://<exact-staged-deployment>/api/ops/projector-wake`. Confirm a signed
   test delivery returns `202` and `Cache-Control: no-store`; invalid, stale or
   malformed deliveries must not schedule work. Duplicate or replayed valid
   deliveries can currently return `202`; the singleton database leases make
   their projector cycles safe. Do not claim persistent nonce replay rejection
   until a reviewed durable nonce store and an exact second-delivery rejection
   test exist.
4. After production promotion and binding checks, move the destination to
   `https://programmable.family/api/ops/projector-wake`, capture the stream ID
   and destination evidence, then verify source and market projector telemetry
   for at least two delivered blocks. Disable the stream on repeated `401`,
   `413` or `5xx` responses; the minute crons keep the read model progressing.

Visible Explore, token detail and price-chart clients refresh every five
seconds while the tab is visible and on focus. Ready public read-model
responses use a two-second CDN freshness window. This removes the scheduler and
cache minute-scale delay; it does not promise sub-second chain finality or hide
Envio, RPC, reorg or database latency.

`/api/ops/index-v2` is the only legacy writer route. The former
`/api/ops/index` alias is permanently closed and is not scheduled.

The route, runtime and migration SHA-256 values in
`config/read-model-operations.v1.json` are release inputs, not documentation.
The operations gate rejects any byte drift until the changed source is reviewed
and the approved digest is updated in the same commit.

The pre-parity reconciler is deliberately absent from `vercel.json`. It remains
manual until its exact-block reader covers every active Classic and Stock-Paired
release family.

## Promotion order

Before this workflow is enabled, turn off **Auto-assign Custom Production
Domains** for the Vercel project. Git-connected production pushes must create
deployments without moving `programmable.family`; only the reviewed workflow
may promote it. The workflow records the current deployment before staging and
fails if Vercel has already moved production to the candidate commit.

1. Produce and review the deterministic hosted database plan, then apply and
   verify every ordered `supabase/migrations/*.sql` file at the exact reviewed
   commit. `config/read-model-operations.v1.json` pins worker-specific release
   inputs; it is not the complete migration inventory. Follow
   `docs/data-pipeline/HOSTED-DATABASE-OPERATOR.md` and keep bootstrap separate.
2. Backfill Envio and Postgres at an exact, recorded checkpoint.
3. Enable the source projector and prove it catches up without partial-block
   publication.
4. Enable the market projector and prove its market lineage at the same source
   checkpoint.
5. Configure and test the QuickNode stream against the exact staged deployment,
   but keep its production destination disabled.
6. Capture one organic mainnet block through the real stream path and pass the
   real-block SLA gate below. This step performs no signing and spends no funds.
7. Capture signed staged-deployment evidence and run the normal read-model gate.
8. Promote the exact staged deployment ID, never a mutable alias.
9. Verify that `programmable.family` resolves to that deployment ID and commit,
   then verify health, populated Explore, the token list, and every indexed
   route using the same release corpus.
10. Enable indexed read flags only after every check is green, then activate and
   verify the stream's production destination.
11. Remove the legacy cron in a later reviewed cutover commit.

When either projector is active, the deploy policy requires the stream-secret
key in the pulled Vercel environment. A Vercel Sensitive placeholder is enough
for static preflight because its value is intentionally unavailable there. The
workflow then runs the following canary against the exact unaliased staged
deployment before release attestation or promotion:

```sh
npm run perf:read-model:wake-canary -- \
  --target-url 'https://<exact-staged-deployment>.vercel.app'
```

The command reads `PROGRAMMABLE_QUICKNODE_STREAM_SECRET` from its existing
process environment; there is deliberately no CLI secret argument.

The canary sends, in order, a fresh request with an invalid signature, a
correctly signed stale request and a fresh valid request. It requires exact
`401`, `401` and `202` responses, JSON bodies and `Cache-Control: no-store`.
Its output contains only the target origin, route, payload digest and statuses;
it never emits the secret, signatures, nonces or payload. A mismatch between
the protected GitHub secret and the Vercel runtime secret therefore fails the
stage without disclosing either value.

### Real-block SLA promotion gate

The HMAC canary above proves only route authentication. Its synthetic auth-only
payload cannot satisfy the latency gate and must never be reported as live-data
evidence. Before production promotion, the reviewed runtime capture bridge must
write one DB-authored, challenge-bound JSON document matching
`config/read-model-real-block-sla-db-attestation.schema.json` from an organic Ethereum
mainnet block. A block without Programmable events is acceptable when at least
one tracked market state is read and published; no launch, swap, signing or
spending is required.

The wake worker captures both public surfaces immediately after the optimistic
bundle receipt and before canonical catch-up. The later protected operator POST
only creates a one-time challenge-bound export; it never re-fetches or replaces
the original DB-timestamped observations. The document binds the exact repository commit, unaliased Vercel deployment,
QuickNode delivery and nonce digest, queue row committed before the deliberately
staged `503`, the provider's authentic retry and its final `202`, independent Alchemy and QuickNode observations, optimistic database
block/event/market commitments, and the first no-store API response exposing
the same block. The API proof is exactly one Classic token-detail response and
the corresponding Classic chart response for the same token and release; other
API paths and duplicate URLs are rejected. `firstVisibleAt` must equal the
earliest recorded observation, and both required surfaces must be visible
within the ten-second bound. The retry may carry a different nonce; the exact
stream, block hint, payload commitment and deployment must still resolve to the
same wake ID without creating a second queue job. Raw RPC endpoint URLs, HMAC signatures,
secrets and payloads are excluded; only endpoint hostnames and one-way URL
commitments are allowed.

QuickNode must be configured to retry a non-2xx webhook response after roughly
one second. On the exact `vercel deploy --prebuilt --prod --skip-domain`
candidate only, set
`PROGRAMMABLE_REAL_BLOCK_SLA_FORCE_PROVIDER_RETRY_ONCE=true`. Leave it false in
normal builds. While the Candidate database is still explicitly unpromoted,
arm one five-minute, single-use probe against the exact unaliased deployment:

```sh
curl --fail-with-body --request PUT \
  --header 'content-type: application/json' \
  --header 'x-programmable-performance-probe: 1' \
  --header "x-programmable-performance-probe-token: $PROGRAMMABLE_PERFORMANCE_PROBE_TOKEN" \
  --data '{"action":"arm-provider-retry","streamId":"<configured-stream-id>"}' \
  "$STAGED_TARGET_URL/api/ops/read-model-real-block-sla"
```

The first matching organic delivery is durably queued, finalized in the
database as `503`, and processed even though the HTTP response asks QuickNode
to retry. The authentic second HTTP delivery is stored as its own receipt,
deduplicated to the existing wake, and returns `202`. An expired or unmatched
arm produces no forced failure. A production/custom-domain request can never
consume the probe. After this capture, reset the flag to `false` for subsequent
builds; do not arm another probe during or after production promotion.

Run the gate immediately after capture because evidence older than ten minutes
is rejected:

```sh
npm run perf:read-model:real-block-sla -- \
  --evidence "$REAL_BLOCK_SLA_EVIDENCE_PATH" \
  --expected-commit "$GITHUB_SHA" \
  --deployment-id "$STAGED_DEPLOYMENT_ID" \
  --target-url "$STAGED_TARGET_URL"
```

`PROGRAMMABLE_PERFORMANCE_PROBE_TOKEN` must also be present in the gate process
so the exported HMAC can be verified without exposing the secret. The gate CLI
rejects the legacy caller-assembled evidence format entirely. It fails closed unless delivery-to-first-visible latency is at most ten
seconds, both providers agree on the exact block, finality is explicitly
`optimistic`, confirmations are in `0..11`, every nested commitment matches, and
the overall evidence commitment is intact. The committed gate validates this
evidence only; promotion remains blocked until the runtime capture bridge and
read-only evidence query are bound to the deployed queue, optimistic writer and
public API.

Source files, migrations, schedules, activation names, workflow ordering and
post-promotion probes are checked by `npm run perf:read-model:ops-gate`.

## Failure behavior

An unauthorized cron call returns `401`. Invalid configuration, unavailable
dependencies or incomplete evidence returns `503` with `Cache-Control:
no-store`. A disabled worker does not open database or RPC connections. Public
read flags stay on the legacy path until signed release evidence for the exact
Vercel deployment is accepted. If any post-promotion binding or route check
fails, the workflow rolls the production domains back to the exact deployment
captured before staging and verifies that rollback binding.
