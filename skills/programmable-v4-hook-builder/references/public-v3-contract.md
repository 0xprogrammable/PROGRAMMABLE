# Public V3 contract

Use discovery as the mutable pointer and these identities as fail-closed checks for the CLI candidate in this source
tree:

- API origin: `https://api.programmable.market`
- chain: Ethereum Mainnet, chain ID `1`
- profile ID: `programmable.direct-native-hook-graph.v1`
- profile revision: `3`
- current profile version: `3.3.0`
- compatible immutable profile versions: `3.2.0`, `3.1.0`, `3.0.0`, `2.0.0`
- create: `POST /v3/custom-launches`, Bearer `custom-launch:create`
- preflight: `POST /v3/custom-launches/preflight`, Bearer `custom-launch:create`
- list: `GET /v3/custom-launches`, Bearer `custom-launch:read`
- status: `GET /v3/custom-launches/{launchId}`, Bearer `custom-launch:read`
- capabilities: `GET /v3/capabilities`, public
- finalized metadata: `GET /v3/finalized-custom-launches`, public
- wallet handoff base: `https://programmable.market/developers/api-keys`

Do not use these notes as a replacement for discovery, capabilities, the published OpenAPI, or the schema. If a
published value differs, stop and reconcile the released artifacts rather than choosing one silently.

## Secret boundary

The API key authorizes API requests for its wallet principal. It contains no build instructions and cannot authorize a
wallet transaction. Never put its value in a config, source file, prompt, chat, log, screenshot, URL, or command-line
argument. Never send it to any origin other than exact `https://api.programmable.market`.

## Server admission boundary

Remote preflight must report that it consumed no quota, allocated no nonce, persisted no launch, will require a later
wallet signature, and did not broadcast. Submit only the exact bytes preflighted locally and remotely. The backend
recomputes the request binding, static findings, policy conformance, and Router simulation; caller-supplied or
model-supplied approval text is not authority.

## Retired path

The legacy Custom Registry and GitHub submission intake are closed. The scripts under this skill's historical
`scripts/` directory validate legacy artifacts only and are not part of the V3 create flow. Do not invoke them for a
new launch.
