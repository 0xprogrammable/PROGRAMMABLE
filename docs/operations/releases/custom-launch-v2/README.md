# Custom Launch API V3 release record

This directory defines the additive, detached V2 release record for the public
Custom Launch API V3 profile. It does not replace the immutable V1 history. The
V2 record binds one reviewed Website commit and tree to one independently
deployed `custom-launch-api-v1` commit, tree, Fly image, migration inventory,
API contract, checked-in public admission profile, readiness identity and
Ethereum deployment identity.

The profile digest is release-scoped: `api.publicProfileSha256` is the lowercase
SHA-256 of the RFC 8785/JCS bytes of
`services/custom-launch-api-v1/release/direct-native-hook-graph-admission-profile.v3.json`.
It is never a per-launch hook runtime hash. Each launch keeps its own
request-bound `launchProfileHash`. The revision 3 artifact binds the exact
role-aware static admission baseline and Router-simulation boundary. Admission
is not an audit, honeypot guarantee, liquidity or tradeability guarantee, or
fee-behavior certification. Historical bindings for the revision 2 artifact
remain valid evidence; the immutable V1 release-record history and V1 API
compatibility remain unchanged.

## Detached records

Keep the live record only on the `command-center-release-records` branch at:

```text
release-records/custom-launch-v2/release-record.json
```

The record commit must be reachable from that branch, authored and committed by
`0xprogrammable`, use the repository no-reply email, and have a verified GitHub
signature. Never place credentials, API keys, wallet signatures or transaction
payloads in a record.

The backend binding is a one-file attestation commit whose single parent is the
reviewed backend candidate. Its only changed path is:

```text
services/custom-launch-api-v1/release/public-v3-release-binding-v1.json
```

Generate that file from exact artifacts. Do not hand-type hashes. The backend
candidate is deployed first, then the binding records the observed Fly release
version and immutable image digest. The binding commit does not deploy code.

### Deterministic binding materialization

Capture the three unmodified `flyctl --json` readbacks, the public `/readyz`
JSON response and `supabase migration list --linked --output-format json`
outside both repositories. Then run the generator from a clean checkout of the
reviewed Website commit:

```bash
npm run release:custom-launch:v2:binding:generate -- \
  --website-root /absolute/path/to/clean-programmable-production \
  --backend-root /absolute/path/to/clean-backend-candidate \
  --fly-releases /absolute/path/to/fly-releases.json \
  --fly-machines /absolute/path/to/fly-machines.json \
  --fly-images /absolute/path/to/fly-images.json \
  --api-readiness /absolute/path/to/readyz.json \
  --supabase-migration-list /absolute/path/to/supabase-migration-list.json \
  --database-schema-evidence-output /absolute/path/to/database-schema-evidence.json
```

The generator derives both Git commit/tree identities, hashes the exact Website
artifacts, recreates the backend migration inventory, checks all eight local and
remote Supabase migration versions, proves every runtime/Supabase migration
mirror byte-equal, checks the API contract and JCS profile/readiness identities,
and binds the active Fly machines to the same tag and digest. The exact retained
redacted database evidence bytes are the sole preimage of
`database.schemaEvidenceSha256`. The generator writes the canonical backend
binding and the explicitly named external evidence output with exclusive-create
semantics. Dirty or unexpected repositories, stale readbacks, unknown
profile/API facts, mismatched Fly state and an existing output all fail closed.
It neither reads nor prints credentials.

Before creating the staging record, materialize the rollback configuration
snapshot from the already verified prior production binding and a fresh Vercel
production environment listing. Pipe the environment JSON directly into the
snapshot generator so provider-returned values are never retained:

```bash
node scripts/perf/read-model-production-binding.mjs \
  --target-url https://programmable.market \
  --github-output /absolute/path/to/prior-production-binding.outputs \
  > /absolute/path/to/prior-production-binding.json

vercel env list production --format=json --scope aficialais-projects \
  | npm run release:custom-launch:v2:rollback-snapshot:generate -- \
      --production-binding /absolute/path/to/prior-production-binding.json \
      --output /absolute/path/to/rollback-configuration-snapshot.json
```

The retained snapshot contains only the exact prior deployment ID, immutable
deployment URL, commit, production alias, and sorted environment variable
name/type/target metadata. The SHA-256 of those deterministic pretty-JSON bytes
is the sole value permitted for
`rollback.website.configurationSnapshotSha256`. Raw provider values are
discarded in memory, never written or printed. Duplicate names, an unexpected
deployment/alias, malformed metadata or an existing output fails closed.

## Protected GitHub configuration

Configure these values in the `production` environment. Values contain public
digests or commit identities; secrets are read-only credentials:

| Kind | Name | Purpose |
| --- | --- | --- |
| Variable | `PROGRAMMABLE_CUSTOM_LAUNCH_API_RELEASE_ATTESTATION_COMMIT_SHA` | Exact verified backend binding commit |
| Variable | `PROGRAMMABLE_CUSTOM_LAUNCH_API_RELEASE_BINDING_DOCUMENT_SHA256` | SHA-256 of exact binding-file bytes |
| Secret | `PROGRAMMABLE_CUSTOM_LAUNCH_API_RELEASE_READ_TOKEN` | Read-only access to the internal backend release evidence |
| Secret | `PROGRAMMABLE_CUSTOM_LAUNCH_API_FLY_READ_TOKEN` | Read-only Fly app/release/machine access |
| Secret | `PROGRAMMABLE_CUSTOM_LAUNCH_V3_CANARY_API_KEY` | Dedicated wallet-bound key used only for authenticated `GET /v3/custom-launches?limit=1` |

Existing `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, `VERCEL_TOKEN` and
`VERCEL_AUTOMATION_BYPASS_SECRET` remain required. No secret is copied into an
artifact or step summary.

## State transitions

Validate locally before each detached-record commit:

```bash
npm run release:custom-launch:v2:record:verify -- /absolute/path/release-record.json --require template
```

The fail-closed levels are:

1. `template`: schema and secret-field checks only.
2. `staging`: exact subjects, owner approval, all validation gates, both rollback snapshots and backend binding are complete.
3. `candidate`: the immutable Vercel deployment and redacted stage evidence are bound.
4. `promotion`: a separate owner decision binds the exact candidate evidence.
5. `live`: the promoted deployment, production alias, read-only clean-room canary and live declaration are bound.

Dispatch `.github/workflows/deploy-production.yml` from the exact reviewed
`production` commit with:

```text
custom_launch_v3_release=true
custom_launch_v3_release_record_commit_sha=<40 lowercase hex>
custom_launch_v3_release_record_sha256=sha256:<64 lowercase hex>
```

The workflow consumes the exact full production Verify proof, verifies the
detached record and private backend binding, reads Fly release/machine state,
stages an unaliased production build and performs only GET probes. It never
promotes, asks for a wallet signature, or broadcasts a transaction.

## Promotion, canary and rollback

After the stage artifact is reviewed, advance a new detached-record commit to
`candidate_verified`, then to `promotion_approved`. Re-run the V2 verifier at
each level. Promotion is a separate operator action against the exact immutable
deployment ID; a direct `vercel deploy --prod` is not promotion evidence.

```bash
vercel promote <immutable-deployment-id> --scope <team> --token "$VERCEL_TOKEN"
```

Immediately resolve `https://programmable.market` back to that deployment ID,
verify the exact Website commit, re-read the API readiness identity, and run the
public clean-room CLI rehearsal through wallet handoff only. Record
`walletSignatureObserved: false` and `transactionBroadcastObserved: false`.
Only then can a new detached-record commit reach `live`.

Rollback is component-specific and uses the snapshots already bound before
staging:

```bash
vercel rollback <rollback-immutable-deployment-url> --scope <team> --token "$VERCEL_TOKEN"
flyctl deploy --app programmable-custom-launch-api --config services/custom-launch-api-v1/deploy/fly/fly.toml --image registry.fly.io/programmable-custom-launch-api@sha256:<rollback-image-digest> --strategy rolling --yes
```

Both commands are mutating operator actions. Use only when explicitly required,
then re-read the canonical Website alias, Fly image digest, API readiness and
discovery surfaces. A backend or explorer outage never revises an already
finalized onchain launch.
