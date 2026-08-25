---
description: Submit, authorize and track one wallet-bound Custom launch through the V1 API
---

# Custom Launch API

Use the Custom Launch API when an agent or developer has a complete Custom hook project and needs the exact transaction for its controller wallet. Create a key, generate `launch.json` from the built project, submit it and wait for the wallet transaction. The API key never signs or broadcasts that transaction.

The human guide on the website is [programmable.market/docs/developers/custom-launch](https://programmable.market/docs/developers/custom-launch). The [standalone OpenAPI contract](https://programmable.market/openapi/custom-launch-v1.json) is the normative source for request fields, bounds and response schemas. The existing [raw V1 guide](https://programmable.market/developers/custom-launch-api-v1.md) remains available for agents and scripts.

## Quickstart

1. Build and test the hook and every launch component. [Hookbuilder-Skill](https://github.com/0xprogrammable/Hookbuilder-Skill) is an optional way to build and check the project.
2. Generate `launch.json` from that exact build with the project's packaging tooling, then validate it against the [OpenAPI contract](https://programmable.market/openapi/custom-launch-v1.json).
3. Connect the controller wallet at [API keys](https://programmable.market/developers/api-keys), create a key and submit `launch.json` with a stable idempotency key.
4. Poll the request until it is `authorized`. The controller wallet then reviews, signs and broadcasts `output.walletTransaction`. Keep polling until the request is `finalized` or terminally failed.

```bash
curl --fail-with-body https://api.programmable.market/v1/custom-launches \
  --request POST \
  --header "Authorization: Bearer $PROGRAMMABLE_API_KEY" \
  --header "Content-Type: application/json" \
  --header "Idempotency-Key: agent-launch-2026-0001" \
  --data-binary @launch.json
```

`launch.json` contains project-specific bytecode, addresses, permission bits and hashes from one exact build. Generate it from the project being launched. Do not copy test-only hashes or another project's file.

## Authentication

Key management and API authentication are separate:

- Connect the controller wallet on `programmable.market` to create, list or revoke its keys.
- Send `Authorization: Bearer pm_live_...` only to `https://api.programmable.market`.
- Do not send the website wallet session token to the Custom Launch API.
- V1 keys have `custom-launch:create` and `custom-launch:read`. A key can access only requests owned by its bound wallet.
- Store the secret outside source control and logs. Key lists never return the full secret again.

The V1 contract states a 90-day default expiry, a 366-day maximum and no more than 10 active keys per wallet.

## Request contract

`POST /v1/custom-launches` accepts a closed JSON object up to 2 MiB with all eight fields:

| Field | Requirement |
| --- | --- |
| `schemaVersion` | `programmable.custom-launch-create-request.v1` |
| `launchWallet` | The Ethereum wallet bound to the API key |
| `chainId` | String `1` |
| `nonce` | A nonzero lowercase `bytes32` |
| `sourceDescriptor` | One `DeterministicSourceBundleV2` descriptor |
| `sourceBundleManifest` | One complete, non-empty, UTF-8 path-sorted `SourceBundleManifestV2` |
| `graphBundle` | One executable `CustomGraphBundleV1` |
| `agentAttestation` | One self-attestation for the exact graph subject |

The platform recomputes the manifest digest and checks that the source descriptor, manifest and graph name the same source bundle. The graph accepts 1 to 16 acyclic targets, exactly one token target and one hook target. The complete graph input is limited to 524,288 bytes; per-target init code is limited to 49,152 bytes and initializer calldata to 131,072 bytes. Use OpenAPI for every nested field, enum and bound.

These checks bind caller-declared data. The platform does not fetch the source files, reproduce dependencies, compile the project, prove source-to-bytecode correspondence, simulate the transaction, audit the project or attest safety.

## Attested checks

`agentAttestation` requires the exact schema version, canonical graph hash, agent identifier, canonical UTC timestamp and 1 to 64 unique `{ checkId, evidenceSha256 }` entries. Each evidence digest uses `sha256:<64 lowercase hex>`.

V1 does not publish a universal check-ID catalog or define project-independent pass/fail semantics for those IDs. The submitting workflow chooses stable IDs for the checks it actually ran, preserves the underlying evidence and attests the digest for each result. Programmable validates the shape, digest presence and graph-subject binding; it does not fetch or assess the evidence or adopt the attestation as its own claim.

## Submit and retry safely

`Idempotency-Key` must contain 16 to 128 characters from `[A-Za-z0-9._:-]`.

- A new request returns `202`.
- An identical replay may return `200` with the original resource.
- After an ambiguous timeout or `503`, retry with the same key and byte-identical body.
- Never reuse that key with a changed body. That returns `409 IDEMPOTENCY_CONFLICT`.
- A conflicting wallet nonce returns `409 NONCE_CONFLICT`.
- An expired permit requires a new request with a new nonce and idempotency key.

The V1 contract states limits of 30 new reservations per rolling hour and 100 per rolling day for the wallet principal and route. Exact idempotent replays bypass the reservation quota. For `429`, wait for the `Retry-After` delay before creating another reservation.

## Lifecycle and wallet boundary

Read `GET /v1/custom-launches/{launchId}` with the same Bearer key. The path parameter keeps the legacy name `launchId`, but its value is the API request UUID. The resource also returns that UUID as `requestId`; `onchainLaunchId` is the distinct Router `bytes32` identifier.

| Status | Meaning |
| --- | --- |
| `received` | The request is durably accepted. |
| `validating` | Request and graph validation are running. |
| `prepared` | The exact artifact exists. `output.signedPermit` and `output.walletTransaction` are both `null`. There is nothing for the wallet to sign yet. |
| `authorized` | The platform permit and exact `output.walletTransaction` exist. The controller wallet has not signed or broadcast it. |
| `submitted` | Canonical Router event and same-block getter evidence match below 64 confirmations. |
| `finalized` | The matching canonical evidence has at least 64 confirmations. |
| `failed` or `cancelled` | The request is terminal. Read `failure` before deciding whether to create a new request. |

After wallet broadcast, poll the single-request route to drive exact reconciliation. `GET /v1/custom-launches` is a newest-first wallet-owned history view with bounded summaries; its `output` is always `null`. Use the single-resource route for the artifact, wallet transaction and durable failure.

The API key authorizes only the API request. It is never proof that the controller wallet approved the transaction.

## Explore, Profile and claims

A finalized Router launch is eligible for Explore and the connected wallet's Profile after the website's discovery data refreshes. Finality is not an immediate listing SLA, and third-party discovery remains controlled by each indexer. Router provenance does not require a Custom Registry record.

Claims are a separate website capability. Router provenance alone does not create a claim route. Only explicitly supported fee models appear in the current claim flow; an arbitrary Custom hook is not automatically claimable. The V1 API scopes `fees:claim` and `buybacks:manage` are reserved and disabled.

## Errors and recovery

| HTTP | What to do |
| --- | --- |
| `400` | Fix malformed JSON, fields, query values or the idempotency key before retrying. |
| `401` | Use an active, unexpired and unrevoked `pm_live_` key. |
| `403` | Use a key with the required scope and the exact wallet named by the request. |
| `404` | Verify the request UUID and key. Do not infer whether another wallet owns that ID. |
| `409` | For an ambiguous replay, keep the original body unchanged. For nonce conflict or permit expiry, create a new nonce and idempotency key as directed by the error code. |
| `413` | Reduce the body below 2 MiB. |
| `415` | Send `Content-Type: application/json`. |
| `422` | Fix the reported manifest, graph, attestation or permit binding. Do not retry unchanged. |
| `429` | Honor `Retry-After`. An exact replay of an existing request does not consume reservation quota. |
| `503` | Retry later. If the create result is ambiguous, keep the same idempotency key and identical body. |

In an HTTP error, `error.requestId` is a correlation ID for that response. It is not the Custom launch resource `requestId`. A resource-level `failure` is the durable lifecycle failure for that launch request.

## Future extensions

Treat only the operations and scopes in the current OpenAPI contract as active. New scopes or endpoints require an explicit contract update. Existing keys do not gain a newly enabled scope automatically. Wallet signing, fee claims, buyback management, reusable-template publication and source review are not granted by the V1 Custom Launch API.
