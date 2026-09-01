# Custom V2 production stage gate

This contract adds a dedicated Custom V2 production Verify lane and an
unaliased, stage-only Vercel health gate. It does not deploy Registry values,
run database migrations, change activation, assign a domain, promote, or roll
back a deployment.

## Closed path scope

`scripts/ci/classify-verify-paths.mjs` classifies the versioned Registry V2
deployment binding, Generic V2 public API/projector/read/signer/UI surface, and
Approval V3 website projection target as `custom_v2=true`. Those exact paths do
not set `contracts`, `database`, `indexer`, `interface`, or `read_model`.

Unknown paths and workflow, dependency, or non-V2 configuration changes still
set every lane. A Custom V2 change can therefore avoid Classic, Stock, Explore,
and global market read-model gates without weakening those gates for any other
change. On the first production commit, the trusted base classifier has no
`custom_v2` output; Verify preserves every base result and appends
`custom_v2=true` once.

The production proof schema is
`programmable.production-verify-proof.v4`. Its exact added check is
`custom-v2` / `Custom V2`, required precisely when the `custom_v2` scope is
true. `scripts/production-verify-proof.mjs` continues to bind the production
commit, tree, workflow digest, GitHub run and attempt, complete hosted-runner
job inventory, immutable artifact, and Sigstore attestation.

An exact Generic V2 production release first dispatches `Verify` on the
`production` ref with `verification_mode=custom-v2-release`. That mode is
classified as a current-tree release verification rather than as a changed
path: it requires the complete Custom V2 lane, emits `scope.custom_v2=true`,
and binds `run.event=workflow_dispatch` plus
`run.verificationMode=custom-v2-release` in the v4 proof. The staging workflow
selects that exact proof whenever any Custom V2 stage input is non-default.
Ordinary production staging continues to consume the exact path-scoped
`push` / `change` proof. This keeps unrelated production commits from
silently downgrading a later Generic V2 release while never representing an
unexecuted lane as verified.

## Workflow dispatch matrix

The canonical workflow remains `.github/workflows/deploy-production.yml` and
remains dispatch-only. The existing Custom Launch enabled and dark inputs are
unchanged. These additional inputs are observations of the candidate, not
activation controls:

| Input                                             | Type    | Default | Contract                                                                                                                                                     |
| ------------------------------------------------- | ------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `custom_v2_registry_live`                         | boolean | `false` | `false` requires the exact prelaunch manifest and fail-closed Registry readiness; `true` requires the live manifest and dual-provider readiness.             |
| `custom_v2_generic_public_read_enabled`           | boolean | `false` | `false` requires readiness/feed/detail to return the disabled contract; `true` requires ready/feed/detail success. It is invalid unless Registry V2 is live. |
| `custom_v2_detail_record_hash`                    | string  | empty   | Optional exact `sha256:` record key. Otherwise the gate selects the first feed record, or verifies the exact detail `404` contract when the feed is empty.   |
| `custom_v2_authenticated_ingress_evidence_sha256` | string  | empty   | Optional exact SHA-256 of protected, short-lived authenticated ingress evidence.                                                                             |

Any non-default Custom V2 input is rejected unless the consumed v3 production
proof says `verified_custom_v2=true`.

Authenticated evidence, when used, is provided only through the protected
`PROGRAMMABLE_CUSTOM_V2_STAGE_AUTHENTICATED_EVIDENCE_V1_JSON` environment
value. Its exact JSON fields are:

- `schemaVersion`, fixed to
  `programmable.custom-v2-authenticated-ingress-evidence.v1`
- `projectionKey`
- `idempotencyKey`
- `canonicalPutBody`
- `putBearerToken`
- `getBearerToken`

The public dispatch digest must match the exact UTF-8 JSON bytes. Credentials
and the canonical body are never written to the evidence artifact or step
summary. The PUT and GET credentials are intentionally separate because the
Approval V3 workload credential is method-bound.

## Exact stage sequence

The workflow performs this sequence:

1. Resolve, download, attest, and verify the exact v3 production Verify proof.
2. Revalidate the same proof after production-environment approval.
3. Pull the Production configuration, derive the GMGN requirement from the
   reviewed value-free sensitive metadata, and run the read-model deploy policy.
4. Stage one source build with `vercel deploy --prod --skip-domain --archive=tgz`.
   The command pins the exact commit and sets
   `PROGRAMMABLE_REAL_BLOCK_SLA_FORCE_PROVIDER_RETRY_ONCE=true` only on that
   immutable candidate; it does not mutate the Vercel Production environment.
5. Run `npm run perf:read-model:staged-deployment -- --target-url` to require a
   `READY` deployment in the configured Vercel project whose deployment Git
   SHA is the checked-out production commit.
6. If either projector is active, run the signed wake canary against that exact
   staged deployment and require `401`, `401`, then `202`.
7. When `verified_custom_v2=true`, load production environment values only into
   the subprocess with `vercel env run -e production --`, then run
   `npm run probe:custom-v2:stage` against that exact `.vercel.app` origin and
   deployment ID.
8. Upload `custom-v2-stage-evidence-${{ github.run_id }}-${{ github.run_attempt }}` for 90 days. The
   evidence binds deployment ID, unaliased URL, Git SHA, observed modes, public
   response digests, and passed checks, with no credential material.
9. Re-resolve the staged deployment and require the same deployment ID and
   URL before the handoff.

The staged public smoke records both `gmgn_requests_per_second` and
`gmgn_account_gate_mode`. When Production metadata makes GMGN required, it
fails closed unless the health response proves exactly 20 requests per second
and `providers[0].accountGateMode=multiflight-v1`. The
`legacy-singleflight-v1` mode from a database through migration `0006` is a
rolling-availability prefix only; Stage does not apply migration `0007`, and
that mode cannot authorize promotion at Pro throughput.

The Custom V2 probe verifies:

- Registry V2 manifest and readiness in the selected prelaunch/live mode
- unauthenticated Approval V3 GET and PUT rejection when its exact audience
  and target binding are configured
- exact `503 target_unavailable` responses for both Approval V3 methods when
  Generic V2 is disabled, no authenticated evidence is supplied, and both
  Approval V3 bindings are absent, whether Registry V2 is prelaunch or live;
  partial configuration, authenticated evidence, and every Generic-ready
  matrix remain invalid without both bindings
- unauthenticated projector POST and reconciliation GET rejection
- authenticated Approval V3 delivery, separate authenticated readback, and
  authenticated projection when digest-bound evidence is supplied
- authenticated reconciliation with zero failed records in Generic-ready mode;
  Registry-live candidates with Generic disabled require no reconciliation
  credential and make no authenticated reconciliation request
- Generic V2 readiness, feed and detail contracts, including the transitive
  Postgres posture, exact Registry binding, dual-RPC deployment check, and
  remote read-signer verification enforced by those handlers
- stable `/custom-launches` and `/custom-launches/{recordHash}` HTML routes
- fail-closed prelaunch and disabled responses when activation is not expected

The production workflow's staged public read-model smoke remains required for
every non-Custom release and for changes that combine Custom V2 with
`interface` or `read_model`. It verifies the canonical Envio and Router launch
identities, GMGN as the bounded primary for visible token market/detail reads
and token-address chart history, fresh liquidity-qualified GMGN market-cap
ranking as a canonical-only prefix, then bounded canonical-supply hydration and
strict GMGN `token_info` FDV ranking for eligible rank-unobserved entries.
Dexscreener remains the visible market fallback and ranks only the GMGN-null,
timed-out, deferred, or unqualified remainder. GMGN search relevance may add or
reorder only Ethereum tokens already present in the canonical Programmable
catalog; local exact and substring matches remain in stable launch order, and
provider wallet or foreign-token rows are never admitted. Bitquery remains the
exact-pool chart fallback. The market-cap response reports every provider tier,
the stable launch-order tail, and a full-order commitment; it does not claim a
global cross-provider numeric sort or full GMGN coverage. Chart responses must report
their selected provider, series scope (`token` or `pool`), and pool attribution
(`unavailable` or `exact`). A GMGN visible-market observation remains
token-scoped. Its current `token_info` proof accepts coherent, nonzero 20-byte
pool locators with unavailable attribution, or coherent bytes32 locators with
exact current admission only when both equal the canonical Uniswap v4 PoolId.
Neither form claims historical per-candle pool provenance. A pure Custom-V2-only
change skips that unrelated Explore/read-model smoke and is proved by the
Registry, Generic readiness/feed/detail, and Custom UI route checks above. The
retired global read-model gates are not reintroduced.

## Handoff boundary

A green artifact means only that the exact unaliased candidate passed its
selected matrix. It is not public-live proof and authorizes no promotion.
Before separate promotion authority is considered, the reviewer still owns
desktop and mobile route QA, keyboard traversal, console errors, failed network
requests, loading/error/recovery behavior, and a final check that the candidate
deployment ID and Git SHA match the preserved evidence.
