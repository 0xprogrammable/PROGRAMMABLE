# Website projection target v1

Status: local integration candidate. This implementation is not deployed,
configured, migrated, or production-authorized by its presence in the repository.

## Purpose and authority boundary

The Website receives immutable delivery projections from the autonomous approval
service. It owns two lanes:

- `website.entitlement` at
  `PUT|GET /v1/internal/projections/website-entitlements/{projectionKey}`;
- `website.custom-launched` at
  `PUT|GET /v2/internal/projections/custom-launches/{projectionKey}`.

The target authenticates the approval-service workload, validates the exact
canonical write contract, stores the original acknowledgement and readback, and
supports byte-exact retry recovery. It cannot approve a submission, mint a grant,
issue a launch permit, move funds, finalize a launch, or publish a Registry record.
An entitlement returned by the Website means only that the authenticated GitHub
principal may ask the approval service for the next launch-permit step.

The protocol and conformance runner in
`lib/server/projection-target/` are vendored from the approval service target kit.
Both Website routes share one durable store, but their lane and target bindings
remain separate.

## Persistence

Use the dedicated fail-closed operator in
`docs/operations/WEBSITE-PROJECTION-DATABASE-OPERATOR-V1.md`. It creates the
fixed runtime role without superuser, role/database creation, replication,
inheritance, or `BYPASSRLS`, then applies these migrations with a database owner
before starting the runtime, in this exact order:

1. `ops/website-projection-target/migrations/0001_projection_records_v1.sql`
2. `ops/website-projection-target/migrations/0002_custom_launch_wallet_profile_v2.sql`
3. `ops/website-projection-target/migrations/0003_registry_custom_public_read_v1.sql`
4. `ops/website-projection-target/migrations/0004_approval_v3_artifacts_v1.sql`
5. `ops/website-projection-target/migrations/0005_generic_launch_materializations_v2.sql`
6. `ops/website-projection-target/migrations/0006_gmgn_account_gate_v1.sql`

`0001` creates the private schema, immutable projection and credential-use
tables, policies and initial indexes. `0002` then upgrades finalized Custom
Launch records to bind the launching-wallet identity and the complete
post-launch-authority inventory hash, and replaces the GitHub-derived Custom
profile index with the wallet-derived profile index. `0003` adds the separate
Registry-current-state materialization. `0004` adds approval-v3 artifact
commitments. `0005` adds the Generic V2 launch, reconciliation, and
reconciliation-attempt materializations. `0006` adds the private singleton and
bounded decision history used to serialize GMGN account-wide reservations,
leases, completions, provider failures, and provider cooldowns across production
instances. Together they provide:

- a primary key on `(lane, projection_key)`;
- a global unique index on `idempotency_key`;
- the exact canonical write, acknowledgement, and readback bytes;
- a derived GitHub-principal index only for recognized entitlement projections;
- a wallet-derived profile index only for finalized Custom Launch projections;
- a durable request-bound workload-credential replay ledger;
- a separate current-state materialization for authenticated
  `registry.custom-launched` observations, including exact Registry/event,
  finality, provider/model, GitHub revision, approval/launch-plan, runtime, fee,
  and post-launch-role bindings;
- a fail-closed distributed GMGN account gate with one exact singleton, bounded
  leases, exact-holder failure release, and the latest 256 generations of
  reservation, completion, and provider-block decisions (at most 512 gate-path
  rows);
- lane-specific constraints requiring complete entitlement metadata and forbidding
  that metadata on custom-launch records;
- enabled and forced RLS on every application table;
- immutable projection and credential rows, and only the narrow Registry,
  reconciliation, GMGN gate updates, and old GMGN history pruning listed below.

The runtime resolves both the lane/key identity and idempotency identity inside
one PostgreSQL transaction. A first write returns `201`; an exact retry returns
`200` with the original acknowledgement; either identity reused with different
bytes returns `409`.

The migrations deliberately have no `IF NOT EXISTS` escape hatch: applying
`0001` over an unexpected pre-existing schema, or applying `0002` without the
exact `0001` state, fails instead of silently trusting weaker objects. Grant
only the following runtime privileges after all migrations:

```sql
GRANT USAGE ON SCHEMA programmable_website_projection_v1
  TO programmable_website_projection_runtime;
GRANT SELECT, INSERT
  ON programmable_website_projection_v1.projection_records,
     programmable_website_projection_v1.credential_uses
  TO programmable_website_projection_runtime;
GRANT SELECT, INSERT
  ON programmable_website_projection_v1.registry_custom_launch_records,
     programmable_website_projection_v1.generic_launch_materializations_v2,
     programmable_website_projection_v1.generic_launch_reconciliations_v2,
     programmable_website_projection_v1.generic_launch_reconciliation_attempts_v2
  TO programmable_website_projection_runtime;
GRANT UPDATE (
  lifecycle_generation, lifecycle_state, lifecycle_binding_hash,
  observed_at, canonical_materialization, canonical_public_record,
  record_binding_hash, launch_security_binding_hash,
  launching_wallet_namespace, launching_wallet_value, updated_at
) ON programmable_website_projection_v1.registry_custom_launch_records
  TO programmable_website_projection_runtime;
GRANT UPDATE (
  outcome, observation_common_head, observation_common_head_hash, observed_at
) ON programmable_website_projection_v1.generic_launch_reconciliations_v2
  TO programmable_website_projection_runtime;
GRANT UPDATE (attempted_at)
  ON programmable_website_projection_v1.generic_launch_reconciliation_attempts_v2
  TO programmable_website_projection_runtime;
GRANT SELECT
  ON programmable_website_projection_v1.gmgn_account_gate_v1
  TO programmable_website_projection_runtime;
GRANT UPDATE (
  generation, next_slot_at, blocked_until, lease_holder, lease_until, updated_at
) ON programmable_website_projection_v1.gmgn_account_gate_v1
  TO programmable_website_projection_runtime;
GRANT INSERT, DELETE
  ON programmable_website_projection_v1.gmgn_account_gate_decisions_v1
  TO programmable_website_projection_runtime;
GRANT EXECUTE ON FUNCTION
  programmable_website_projection_v1.enforce_approval_v3_capacity_v1()
  TO programmable_website_projection_runtime;
```

Do not grant `UPDATE` on the immutable projection or credential tables. Do not
grant `DELETE` except on the GMGN decision history, or grant `TRUNCATE`, schema
creation, role management, or access to approval-service tables. The narrowly
scoped column-level `UPDATE` grant on the
Registry materialization is required to hide a record immediately after a correction,
revocation, or reorg. The GMGN runtime may read and update only the singleton;
it may append decisions and delete only generations made eligible by the RLS
retention policy. Its two column-level `SELECT` grants expose only the gate ID
and generation of those already-prunable rows; it cannot read decision contents,
update, truncate, or trigger against decision history. Each reserve, complete,
and provider-block statement prunes generations
older than the latest 256 in the same serialized gate path. Fetch and timeout
failures complete only the exact generation-and-holder lease; an observed 429 or
provider ban instead advances the generation and publishes the bounded shared
cooldown. The runtime attests the exact current role,
grants, RLS/force-RLS state, policies, provider-role exclusion, table ownership,
and live `pg_stat_ssl` connection before serving requests.

Put the dedicated role's connection string in
`PROGRAMMABLE_WEBSITE_PROJECTION_DATABASE_URL`, its exact role name in
`PROGRAMMABLE_WEBSITE_PROJECTION_DATABASE_ROLE`, and the provider Server root
certificate in `PROGRAMMABLE_WEBSITE_PROJECTION_DATABASE_CA_PEM`. Connection-URL
SSL parameters are rejected so they cannot override the code-owned TLS config.
The runtime always supplies the URL hostname as TLS `servername`, the separate CA,
and `rejectUnauthorized: true`.

## Workload credential

Static shared bearer tokens are not supported. The target verifies a short-lived
Ed25519 JWT from the reviewed workload token exchange. The JWT is canonical JSON,
uses unpadded canonical base64url segments, and has this exact protected header:

```json
{"alg":"EdDSA","kid":"<configured-key-id>","typ":"JWT"}
```

Each token authorizes exactly one request. A PUT payload has exactly these fields:

```json
{
  "aud": "<PROGRAMMABLE_WEBSITE_PROJECTION_AUDIENCE>",
  "exp": 1785931500,
  "iat": 1785931200,
  "iss": "<configured-issuer>",
  "jti": "<unique-credential-id>",
  "lane": "website.entitlement",
  "method": "PUT",
  "projectionKey": "sha256:<64 lowercase hex>",
  "idempotencyKey": "sha256:<64 lowercase hex>",
  "requestDigest": "sha256:<64 lowercase hex>",
  "schemaVersion": "programmable.projection-workload-access-token.v2",
  "sub": "<configured-approval-service-subject>",
  "targetBindingHash": "sha256:<64 lowercase hex>"
}
```

GET uses the same schema with `method: "GET"` and omits `idempotencyKey` and
`requestDigest`. Method, lane, audience, target, projection key, and the PUT
write identities are all signed. GET, PUT, and both lanes cannot share a token.
The target stores each `jti` with the canonical verified claim binding. The same
`jti` is accepted again only for the identical token and byte-identical recovery
request, including after process restart.

The lifetime may not exceed ten minutes. Signature, key ID, issuer, subject,
audience, current time, HTTP method, lane, projection key, and signed target binding
must all match. The target never accepts a caller-provided authentication Boolean.

Configure:

- `PROGRAMMABLE_WEBSITE_PROJECTION_AUDIENCE`;
- `PROGRAMMABLE_WEBSITE_ENTITLEMENT_TARGET_BINDING_HASH`;
- `PROGRAMMABLE_WEBSITE_CUSTOM_LAUNCH_TARGET_BINDING_HASH`;
- `PROGRAMMABLE_PROJECTION_WORKLOAD_ISSUER`;
- `PROGRAMMABLE_PROJECTION_WORKLOAD_SUBJECT`;
- `PROGRAMMABLE_PROJECTION_WORKLOAD_KEY_ID`;
- `PROGRAMMABLE_PROJECTION_WORKLOAD_PUBLIC_KEY_PEM`.

The target binding hashes must come from the exact signed approval-service
deployment composition. They are not invented by the Website or supplied by a
request.

## Authenticated user read

`GET /api/custom-launch/entitlements` is the Website-facing read boundary. It
requires:

- `Authorization: Bearer <Privy access token>`;
- `X-Privy-Identity-Token: <Privy identity token>`;
- `Accept: application/json`.

The server verifies both Privy signatures and requires user, application, and
`sid` session bindings to match. It then re-reads the current user from Privy's
server API and takes the numeric ID from exactly one currently linked
`github_oauth` account. Identity-token linked-account snapshots never authorize
this read. It derives
`sha256(programmable.github-submitter-principal.v1, {githubUserId})` and queries
only active entitlements under that exact principal. GitHub usernames are never
used as authority.

The response is a bounded safe view and explicitly returns
`launchAuthority: false`. The actual permit service must independently recheck
the current approval, source, wallet, fee, and generation bindings.

Before UI integration, enable GitHub OAuth and identity tokens for the existing
Privy application. The client must obtain a fresh identity token immediately
before the entitlement request; it must never copy linked-account data from
unverified browser state into an authorization decision.

## Authenticated Custom Launch v2 Website boundary

Browser code talks to application routes under `/api/custom-launch/v3` and to
the unchanged session, grant, report, profile, and project routes under
`/api/custom-launch/v2`. The Website authenticates the current Privy session,
re-resolves the current numeric GitHub account, and then relays the request to
the fixed HTTPS approval-service origin in
`PROGRAMMABLE_APPROVAL_SERVICE_V2_ORIGIN`.

The Custom surface is enabled only when
`PROGRAMMABLE_CUSTOM_LAUNCH_PUBLIC_ENABLED=true`, Privy and the fixed service
origin are complete, and `PROGRAMMABLE_LAUNCH_PERMIT_SIGNERS_V2_JSON` is a
valid non-empty Ed25519 public-key ring. Each exact signer identity binds its
key id, positive epoch, component binding hash, canonical raw 32-byte public
key, and SPKI SHA-256. Malformed entries, duplicate identities, and SPKI
mismatches disable the entire surface. Rotation retains previous public keys
only until every permit from those epochs has expired. Immediately before a
wallet action, the trusted-time route also requires the verified permit's exact
key id, epoch, component binding hash, and SPKI hash to remain in that current
keyring. This closes stale browser tabs when a signer is removed.

The bridge currently exposes:

- the current principal's bounded application list and exact application status;
- launch eligibility and the service-owned route/configuration descriptor;
- challenge creation and preparation binding;
- wallet authentication;
- launch authorization;
- one service-built EOA wallet action, transaction-hash reporting, and durable
  execution/finality status.

The application-list route is
`GET /api/custom-launch/v3/applications?limit=N[&cursor=BASE64URL]`. It accepts
only a limit from 1 through 100 and one opaque bounded cursor. It has no
principal, repository, or application-id filter: the approval service derives
ownership from the independently verified numeric GitHub principal. The response
is deterministically paginated and contains only that principal's applications.

Every application response carries two identities. `applicationId` is the
bounded public display identity and remains the portable identity inside the
presentation commit and record. `applicationHandle` is the opaque
`github-`-prefixed 256-bit identity and is the only valid authenticated route,
selection, cache, and browser-recovery key. It must be copied from the
authenticated list response, never derived from the public id. Public ids may
repeat across repositories; application handles may never repeat.

The bridge forwards the user's Privy access credential so the approval service
can independently authenticate the same principal. It never forwards the Privy
identity token, provider API credentials, database credentials, workload keys,
or service signing material. Request and response bodies are bounded, redirects
are rejected, response headers are allowlisted, and every response is
`no-store`.

The approval-service boundary retains its V2 envelope
`{schemaVersion: "2.0.0", requestId, data}` or
`{schemaVersion: "2.0.0", requestId, error}`. The Website validates that exact
envelope server-side, exposes only the allowlisted route data, and maps bounded
service error code/message fields into the Website error contract. The service
request id and any additional envelope field never cross the public Website
boundary.

The Website also retains two compatibility read views that do not grant
execution authority:

- `GET /api/custom-launch/v2/profile` returns only finalized projects bound to
  the exact queried launching-wallet identity;
- `GET /api/custom-launch/v2/projects/{projectId}` returns one exact finalized
  project or a non-enumerating not-found response.

Finalized project reads preserve the Registry-authenticated discoverable asset
and market sets. A project advertises a token only when its exact asset set has
one evidence-bound primary token. A Uniswap v4 market appears only with its full
verified PoolKey facts and market-set hash. An empty market set means no
registered market and must never be rendered or exported as an inferred pair.

The public v2 project, profile, Explorer, and discovery reads use only the
separate Registry materialization. An immutable `website.custom-launched` row
alone is never public evidence. A Registry observation is readable only when
its current monotonic lifecycle state is exactly `finalized`, its canonical
record is present, its launch-security binding is unchanged, and its explicit
head/block confirmation arithmetic satisfies the bound finality policy. The
states `pending`, `corrected`, `revoked`, and `reorged` are all non-public;
stale generations cannot resurrect a prior finalized record, and revocation is
terminal for that launch identity.

The materializer accepts only an opaque
`AuthenticatedRegistryCustomLaunchProjectionV1`. That object is minted after a
trusted Registry transport verifier authenticates the exact canonical
`registry.custom-launched` materialization and its lifecycle binding. Raw
Website-v2 records and unverified Registry-shaped JSON cannot call the database
materializer. After a correction or reorg, the record remains hidden until a
newer authenticated generation is finalized; an older finalization is stale.
Refinalization may update canonical block/finality evidence, but a change to the
launch's security binding (repository revision, approval/launchplan, runtime,
fee, roles, configuration, or launch transaction) fails closed.

Registry public-read enablement depends only on the existing
`PROGRAMMABLE_CUSTOM_LAUNCH_PUBLIC_ENABLED=true` gate and successful database
readiness attestation. Privy, approval-service origin, and permit-signer
configuration remain mandatory for launch-write/authenticated execution
surfaces, but are not dependencies of finalized public Registry reads.

The proof-bearing public endpoints are:

- `GET /api/custom-launch/registry/v1/projects`;
- `GET /api/custom-launch/registry/v1/projects/{projectId}`.

Both are `no-store`. They expose the exact verified Registry materialization;
the existing v2 project/profile shapes remain unchanged for client
compatibility but are backed by the same Registry-only store.

No Website status or projection is a launch permit. The approval service remains
the sole authority for route selection, preparation, wallet binding, permit
issuance, execution recovery, and finality. UI integration must consume the
service-owned selection/preparation contract; it must not invent or hardcode a
route adapter, execution mode, native value, artifact hash, or permit request
hash in browser code. The browser may submit only the returned
`eth_sendTransaction` action and report its transaction hash. It never supplies
the action's `from`, `to`, `data`, `value`, or chain to the service.

## Local verification

```bash
npx vitest run tests/website-projection-target.test.ts
npx vitest run tests/custom-launch-website-bridge-v2.test.ts
npm run typecheck
npm run lint
npm run build
```

The focused suite executes the vendored conformance runner against a real PGlite
PostgreSQL engine, verifies durable restart/readback behavior, signs and verifies
real Ed25519 workload JWTs, proves forged credentials do not reach storage,
executes create/replay/read under the documented `SELECT` plus `INSERT` runtime
grants, rejects request-crossing or restarted JTI replays, exercises complete
entitlement-poisoning regressions, verifies forced RLS/provider-role exclusion,
and checks Privy session/current-link and principal-scoped entitlement reads.

## Production activation gates

Do not call the complete projection target with its GMGN account gate active
until all of the following are separately evidenced. The existing `0001`
through `0005` projection paths retain their independent readiness contract;
an absent `0006` must disable GMGN enrichment without disabling those paths.

1. migrations `0001` through `0006` were applied in that exact order on the
   intended hosted database, their exact reviewed digests are retained, and live
   catalog proof confirms the complete application schema, including the `0002`
   wallet/profile changes and the `0006` GMGN gate singleton, policies, grants,
   decision history, and constraints;
2. the runtime uses the dedicated least-privilege role, the base production
   readiness attestation proves the existing `0001` through `0005` contract,
   and the separate GMGN readiness attestation proves the `0006` schema,
   grants, forced RLS and provider-role exclusion against that hosted database;
3. Supabase Postgres SSL enforcement is enabled, the current Server root
   certificate is configured, and the runtime readiness attestation succeeds;
4. Privy GitHub OAuth and identity tokens are enabled and tested on the intended
   application;
5. the workload token issuer emits only the request-bound v2 schema and its
   public key, audience, and subject are reviewed;
6. both target binding hashes match the exact signed approval-service release;
7. the approval-service clients point to the exact deployed HTTPS Website origin;
8. the Website bridge points to the exact deployed HTTPS approval-service v2
   origin and that service exposes the reviewed principal-scoped list,
   preparation, route-selection, execution-recovery, and finality contracts;
9. the Website keyring exactly matches the reviewed permit-signing release,
   including signer epoch, component binding, raw public key, and SPKI hash;
10. the trusted-time route is live, dynamic, same-origin, `no-store`, and passes
   its malformed-request and disabled-readiness gates;
11. the conformance suite passes against the deployed routes, not only locally;
12. a real test submission proves approval → entitlement → authenticated user
   read without granting launch authority early;
13. a real wallet-bound rehearsal proves one idempotent preparation → signature
    → authorization → execution → finality → Registry/Website projection path;
14. alerts cover 401/403/409/503 rates, delivery backlog, database availability,
   credential expiry, and projection readback mismatch.

Registry delivery, onchain finality, public terminal feeds, and provider indexing
remain separate workstreams and are not proven by this Website target.
