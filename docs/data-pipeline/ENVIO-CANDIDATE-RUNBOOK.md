# Envio release candidate

Candidate `3c785e4` is prepared but not deployed. It retains the existing
Classic V2/V3 and Stock-Paired V1/V2/V3 history. It does not add or activate a
new Stock launch path.

The candidate fixes the authenticated Stock coordinator creator transition,
adds the complete runtime artifact identity and widens log placement fields to
their exact uint32 domain. Its source and rollback identities are pinned in
[`envio-candidate-3c785e4.json`](./envio-candidate-3c785e4.json).

## Local source gate

Use a clean checkout at the exact source commit. Do not generate the mirror
from a later working tree.

```bash
git worktree add --detach /private/tmp/programmable-envio-source-3c785e4 \
  3c785e473f5ca903c461018417e65c32d1b39a3d
cd /private/tmp/programmable-envio-source-3c785e4/indexer
pnpm install --frozen-lockfile
pnpm codegen
pnpm typecheck
pnpm test
node scripts/release-candidate.mjs identity \
  --source-commit 3c785e473f5ca903c461018417e65c32d1b39a3d
```

The identity output must match the candidate JSON byte for byte at every
identity field.

## Deployment mirror

The private `0xprogrammable/programmable-indexer` repository is the only Envio
deployment mirror. Create a review branch there, replace only `indexer/` with
the tree from source commit `3c785e4`, and set its root `SOURCE_COMMIT` to the
full source SHA. Keep the existing deployment manifests unchanged. Review the
tree diff before committing and pushing that branch.

Record the resulting mirror commit in a new evidence manifest. Do not edit this
prepared manifest in place, and do not push the candidate directly to the
mirror's `production` branch.

Before deploying the mirror commit, set the eight exact `ENVIO_*` identity
values from the candidate JSON. Envio environment changes apply to the next
deployment. Confirm the values with `indexer env list` before continuing.

```bash
npx --yes envio-cloud@0.10.0 indexer env set \
  programmable-indexer 0xprogrammable \
  ENVIO_DEPLOYMENT_LABEL=production-3c785e4 \
  ENVIO_SOURCE_COMMIT=3c785e473f5ca903c461018417e65c32d1b39a3d \
  ENVIO_CONFIG_SHA256=0x378e3a799c762cb31107792c7123f5f90b54b5826884c398995e7465176fe1c2 \
  ENVIO_SCHEMA_SHA256=0xdf3d65e033e96d7ebbe62b6f114b6a30f10c8944e5c6fca6b020c3130bb738c0 \
  ENVIO_HANDLER_SHA256=0x9f68d05cc8907f1c422cb2584b338ed42375eb4b6033cbec1338d00577267491 \
  ENVIO_SOURCE_REGISTRY_SHA256=0x55e7a7c7cd0e419a6be0f9c784990f5048b9845e46e329939025c3fab405565a \
  ENVIO_EVENT_SET_SHA256=0x7481d6fa986d706e46b9834e40574dd84f21be80b041d35e7d47dbfa59d69243 \
  ENVIO_EVENT_COUNT=51
```

The following command is intentionally not run during candidate preparation:

```bash
npx --yes envio-cloud@0.10.0 deployment deploy \
  programmable-indexer <mirror-commit> 0xprogrammable --yes
```

## Replay inventory gate

Immediately before replay, freeze the complete production inventory. The file
contains every launch identity and a digest; its count is derived from the live
inventory rather than hard-coded in application logic.

```bash
node indexer/scripts/release-candidate.mjs snapshot \
  --endpoint https://indexer.hyperindex.xyz/f6714ef/v1/graphql \
  --output /secure/release/envio-baseline.json
```

After the candidate reports fully synced, obtain its deployment-specific
endpoint and run the audit against the frozen baseline:

```bash
npx --yes envio-cloud@0.10.0 deployment status \
  programmable-indexer <mirror-commit> 0xprogrammable --watch-till-synced

npx --yes envio-cloud@0.10.0 deployment endpoint \
  programmable-indexer <mirror-commit> 0xprogrammable

node indexer/scripts/release-candidate.mjs audit \
  --endpoint <candidate-endpoint> \
  --identity /secure/release/envio-candidate-identity.json \
  --baseline /secure/release/envio-baseline.json \
  --output /secure/release/envio-candidate-inventory.json
```

The audit fails if any frozen launch is missing or changed, any supported
release is absent, any candidate is incomplete, provenance is invalid, the
runtime identity differs, or duplicate launch identities appear. New eligible
launches are accepted only when they pass the same checks.

## Promotion boundary

Do not promote from Envio sync status alone. Promotion still requires the
Postgres backfill, dual-RPC reconciliation, release parity, reorg, performance,
monitoring and staged website gates in
[`READ-MODEL-RELEASE-GATE.md`](./READ-MODEL-RELEASE-GATE.md).

Only after those gates pass may the integration owner promote the exact mirror
commit and update `config/data-pipeline-release.v1.json` to the new identity.
The website release must bind to that exact product commit.

## Rollback

The active rollback deployment is mirror commit
`2cb1c35c7738fea63e656ad11589664dc93d785d`. Before rollback, stop the
projector and public-route cutover, restore the pre-cutover database snapshot
and product binding, then promote the old deployment:

```bash
npx --yes envio-cloud@0.10.0 deployment promote \
  programmable-indexer 2cb1c35 0xprogrammable --yes
```

Verify that the endpoint reports deployment `production-1e7c381` and the exact
rollback identity in the candidate JSON before restoring website traffic. A
promotion command by itself is not complete rollback evidence.
