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

The legacy index also has a GitHub Actions watchdog at minutes `2-57/5` on
the protected `production` branch. It calls the same canonical
`/api/ops/index-v2` route on `https://programmable.market` with the existing
`CRON_SECRET`; it is not a second writer implementation. The offset avoids
deliberately duplicating the nominal Vercel invocation, while the workflow
concurrency group prevents two watchdog runs from overlapping.

The watchdog succeeds only after the public health route exposes a durable
snapshot at the same or a newer block, no more than ten minutes old, while the
Ethereum RPC read and independent quorum are healthy. It additionally requires
the concrete nonzero hash of an RPC-confirmed block at or beyond the durable
snapshot, plus both independent provider heads at or beyond that confirmed
block and no more than five minutes old. A status-only quorum response is not
accepted. The target origin is
fixed in reviewed source, redirects and oversized or non-JSON responses are
rejected, and the exact health route plus its dual-RPC implementation are
content-bound in the operations manifest. No Vercel token or
deployment-protection bypass is available to the job. This repairs delivery of
the existing generic public read model; it
does not activate the staged Postgres projectors, promote a deployment, or
publish any third-party submission.

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
the independent private dRPC and QuickNode RPC reads, atomic publication fences and
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
   `https://programmable.market/api/ops/projector-wake`, capture the stream ID
   and destination evidence, then verify source and market projector telemetry
   for at least two delivered blocks. Disable the stream on repeated `401`,
   `413` or `5xx` responses; the minute crons keep the read model progressing.

Visible Explore and token detail clients continue their bounded refreshes while
the tab is visible. Historical chart requests use the bounded Bitquery reader
only after exact token, quote-asset and Uniswap v4 pool binding. A provider
outage returns an unavailable chart without hiding the verified token identity;
the route does not fall back to the retired dRPC history scan.

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
deployments without moving `programmable.market`. The reviewed workflow is
stage-only and must never call `vercel promote`; only the reviewed manual
operator sequence below may promote after the real-block SLA gate. The workflow
records the current deployment before staging and fails if Vercel has already
moved production to the candidate commit.

1. Produce and review the deterministic hosted database plan, then apply and
   verify every ordered `supabase/migrations/*.sql` file at the exact reviewed
   commit. `config/read-model-operations.v1.json` pins worker-specific release
   inputs; it is not the complete migration inventory. Follow
   `docs/data-pipeline/HOSTED-DATABASE-OPERATOR.md`. The historical candidate
   bootstrap is retired and must not be substituted for current release
   evidence.
2. Bind Envio and Postgres to the current canonical release at an exact,
   recorded checkpoint. If current database activation evidence is absent,
   stop: a staged website is not production-readiness evidence.
3. Bind the current database release to the exact staged commit and deployment
   ID through a separately reviewed current release authority. The retired
   `production-7f24e63` candidate operator is not such an authority.
4. Enable the source projector and prove it catches up without partial-block
   publication.
5. Enable the market projector and prove its market lineage at the same source
   checkpoint.
6. Configure and test the QuickNode stream against the exact staged deployment,
   but keep its production destination disabled.
7. Capture one organic mainnet block through the real stream path and pass the
   real-block SLA gate below. This step performs no signing and spends no funds.
8. Capture signed staged-deployment evidence and run the normal read-model gate.
9. Reverify and promote the exact staged deployment ID with the reviewed manual
   commands below, never a mutable alias.
10. Verify that `programmable.market` resolves to that deployment ID and commit,
   then verify health, populated Explore, the token list, and every indexed
   route using the same release corpus.
11. Enable indexed read flags only after every check is green, then activate and
   verify the stream's production destination.
12. Remove the legacy cron in a later reviewed cutover commit.

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
staged `503`, the provider's authentic retry and its final `202`, independent dRPC and QuickNode observations, optimistic database
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
normal builds. After the current database release is product-bound to this exact
staged commit and deployment ID, and the staged projectors have published a
complete Classic launch, arm one five-minute, single-use probe against the
exact unaliased deployment while the production domain still points to the
previous release. Set `PROGRAMMABLE_QUICKNODE_STREAM_ID` to the exact provider
stream ID recorded during step 6:

```sh
test ! -e /secure/cutover/real-block-sla-db-attestation.json
npm run perf:read-model:real-block-sla-operator -- \
  --target-url "$STAGED_TARGET_URL" \
  --deployment-id "$STAGED_DEPLOYMENT_ID" \
  --expected-commit "$GITHUB_SHA" \
  --project-id "$VERCEL_PROJECT_ID" \
  --stream-id "$PROGRAMMABLE_QUICKNODE_STREAM_ID" \
  --output /secure/cutover/real-block-sla-db-attestation.json
```

The first matching organic delivery is durably queued, finalized in the
database as `503`, and processed even though the HTTP response asks QuickNode
to retry. The authentic second HTTP delivery is stored as its own receipt,
deduplicated to the existing wake, and returns `202`. An expired or unmatched
arm produces no forced failure. A production/custom-domain request can never
consume the probe. After this capture, reset the flag to `false` for subsequent
builds; do not arm another probe during or after production promotion.
The operator reads `PROGRAMMABLE_PERFORMANCE_PROBE_TOKEN` and
`VERCEL_AUTOMATION_BYPASS_SECRET` only from its environment, never from command
arguments. It validates the returned arm UUID, polls only the exact unaliased
deployment for at most five minutes, and accepts only the exact commit,
deployment, project and stream binding. The evidence path is created once with
mode `0600`; an existing path blocks the release and is never overwritten.

Run the gate immediately after capture because evidence older than ten minutes
is rejected:

```sh
npm run perf:read-model:real-block-sla -- \
  --evidence /secure/cutover/real-block-sla-db-attestation.json \
  --expected-commit "$GITHUB_SHA" \
  --deployment-id "$STAGED_DEPLOYMENT_ID" \
  --target-url "$STAGED_TARGET_URL"
```

The staging workflow stops here and records the exact deployment ID, URL and
previous production binding. Only after the command above succeeds, reverify
the same immutable deployment immediately before the manual promotion, then
verify the production binding and public routes immediately afterward:

```sh
test ! -e "$PRE_PROMOTE_BINDING_OUTPUT"
npm run perf:read-model:staged-deployment -- \
  --target-url "$STAGED_TARGET_URL" \
  --github-output "$PRE_PROMOTE_BINDING_OUTPUT"
grep -Fx "deployment_id=$STAGED_DEPLOYMENT_ID" "$PRE_PROMOTE_BINDING_OUTPUT"
grep -Fx "target_url=$STAGED_TARGET_URL" "$PRE_PROMOTE_BINDING_OUTPUT"

vercel promote "$STAGED_DEPLOYMENT_ID" --yes --token="$VERCEL_TOKEN"

npm run perf:read-model:post-promotion -- \
  --target-url "https://programmable.market" \
  --deployment-id "$STAGED_DEPLOYMENT_ID" \
  --git-head "$GITHUB_SHA"
```

If the promotion command or post-promotion gate returns an uncertain result,
first read the live production binding. Roll back only when it resolves to the
staged deployment, using the exact previous deployment recorded by the
staging workflow, then reverify its deployment ID and Git commit. Keep the
current database release and public-read flags fenced throughout that recovery.

The earlier real-block SLA commands require
`PROGRAMMABLE_PERFORMANCE_PROBE_TOKEN` so the exported HMAC can be verified
without exposing the secret. The post-promotion command does not reload the
retired Bitquery-era caller-assembled evidence bundle; it verifies the exact
deployment and the Durable-identity/Dex public surface directly. The real-block
gate fails closed unless delivery-to-first-visible latency is at most ten
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
fails, the manual operator follows the exact rollback sequence above. The
retired historical candidate runbook grants no rollback or promotion authority,
and the stage-only workflow never mutates production domains.
