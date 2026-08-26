# Custom Launch API V3 release record

This directory defines the additive, detached V2 release record for the public
Custom Launch API V3 profile. It does not replace the immutable V1 history. The
V2 record binds one reviewed Website commit and tree to one independently
deployed `custom-launch-api-v1` commit, tree, Fly image, migration inventory,
API contract, checked-in public admission profile, readiness identity and
Ethereum deployment identity.

The profile digest is release-scoped: `api.publicProfileSha256` is the lowercase
SHA-256 of the RFC 8785/JCS bytes of
`services/custom-launch-api-v1/release/direct-native-hook-graph-admission-profile.v1.json`.
It is never a per-launch hook runtime hash. Each launch keeps its own
request-bound `launchProfileHash`.

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
