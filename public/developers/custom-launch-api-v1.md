# Programmable Custom Launch API V1

The Custom Launch API is live at `https://api.programmable.market`. It prepares and tracks one concrete Custom hook
launch per request for the wallet bound to an API key. Legacy Registry and GitHub submission intake is closed.

Normative OpenAPI: <https://programmable.market/openapi/custom-launch-v1.json>

Human guide: <https://programmable.market/docs/developers/custom-launch>

Readiness: <https://api.programmable.market/readyz>

## Install the public CLI

```sh
npm install --global \
  https://github.com/0xprogrammable/PROGRAMMABLE/releases/download/programmable-launch-v1.0.0/programmable-launch-1.0.0.tgz
programmable-launch --version
```

The package name is `@programmable/launch`; the binary is `programmable-launch`. The pinned GitHub Release asset is
the install authority. Do not substitute an unverified npm-registry package.

The CLI has exactly four commands:

```sh
programmable-launch pack --config programmable-launch.config.json --output launch.json
programmable-launch validate launch.json --config programmable-launch.config.json
programmable-launch submit launch.json --config programmable-launch.config.json
programmable-launch status REQUEST_UUID --watch --until authorized
```

The release tarball includes `examples/no-broadcast/README.md` with real Solidity source, exact Standard JSON, matching
solc artifacts and a config generator. Its pack-native hook salt grind is deterministic after source, wallet and nonce
are fixed. The rehearsal submits and polls to `authorized`, then stops without a wallet signature or broadcast.

`pack` derives the sorted manifest, source descriptor, ABI-encoded arguments, graph, target locators, CREATE2
predictions, evidence digests, canonical hashes and exact-source verification bundle from exact source, Standard JSON,
compiler artifacts and evidence files. It accepts no hand-written derived hashes. If a deployed runtime cannot be
derived exactly because immutable references remain, it stops with `RUNTIME_MATERIALIZATION_REQUIRED`.

`validate` recomputes those commitments. With `--config`, it requires byte-identical reproduction of `launch.json`.

## Secret boundary

Create or revoke a key at <https://programmable.market/developers/api-keys>. Store it only in an encrypted secret or
environment variable named `PROGRAMMABLE_API_KEY`, or in the supported operating system secret store. Put only
`$PROGRAMMABLE_API_KEY` in chat, prompts and agent setup. The CLI has no API-key argument, never prints the key and
never stores it in its journal.

V1 grants `custom-launch:create` and `custom-launch:read`. The key is not a wallet key and cannot sign or broadcast.

## Create request

`POST /v1/custom-launches` uses `Authorization: Bearer $PROGRAMMABLE_API_KEY`, `Content-Type: application/json` and a
16 to 128 character `Idempotency-Key`. The closed body is limited to 8,388,608 bytes (8 MiB).

The eight legacy V1 fields remain required:

| Field | Requirement |
| --- | --- |
| `schemaVersion` | `programmable.custom-launch-create-request.v1` |
| `launchWallet` | Exact wallet bound to the API key |
| `chainId` | String `1` |
| `nonce` | Nonzero lowercase `bytes32` |
| `sourceDescriptor` | `DeterministicSourceBundleV2` |
| `sourceBundleManifest` | Complete non-empty UTF-8 path-sorted manifest |
| `graphBundle` | `programmable.custom-graph-bundle.v1` |
| `agentAttestation` | Evidence digests bound to the exact graph hash |

The optional additive field is:

```text
verificationBundle = {
  schemaVersion: "programmable.exact-source-verification-bundle.v1",
  compilationUnits: [{
    compilationUnitId,
    compilerVersion,
    standardJsonInputBase64,
    standardJsonInputSha256
  }],
  components: [{
    targetId,
    compilationUnitId,
    sourcePath,
    contractName,
    constructorArguments
  }]
}
```

Compilation units are unique and UTF-8 sorted by `compilationUnitId`. Components are unique and UTF-8 sorted by
`targetId` and exactly cover every graph target. Standard JSON is exact UTF-8, canonically base64-encoded, closed to
`language`, `sources` and `settings`, and uses inline source content only. Compiler version includes the exact solc
commit. Constructor arguments are lowercase even hex after graph locators are resolved.
Decoded Standard JSON is limited to 5,242,880 bytes per compilation unit and across all units in one request.

The server checks `creationBytecode || constructorArguments` against the prepared init code and binds the canonical
verification bundle hash into the prepared artifact only when the bundle exists. Legacy requests without the field
remain accepted and unverified.

## Idempotent transport

Before its first POST, `submit` proves that `launch.json` is byte-identical to a fresh pack of the supplied exact
artifacts. It then persists the exact request bytes, local byte SHA-256, API origin and Idempotency-Key in a mode `0600`
journal. It retries identical bytes after a timeout, transport ambiguity, `429` or `503` and honors
`Retry-After` as seconds or an HTTP date. A changed body with the same key fails locally. It does not retry permanent
`400`, `401`, `403`, `409`, `413`, `415` or `422` responses.

The resource `requestHash` is the server's canonical idempotency digest. It is not the local SHA-256 of the exact HTTP
body stored by the CLI.

## Read status

Read one resource with:

```sh
programmable-launch status REQUEST_UUID --watch --until authorized
```

The command uses `GET /v1/custom-launches/{launchId}`. The path keeps a legacy name, but its value is the API request
UUID returned as both `launchId` and `requestId`. `onchainLaunchId` is a separate Router bytes32 value. The list route
can make a bounded best-effort reconciliation pass over pending rows, but it returns `output: null`; the single-resource
GET is the precise status and full-output path.

```text
received -> validating -> prepared -> authorized -> submitted -> finalized
```

`failed` and `cancelled` are terminal alternatives. `prepared` has no wallet transaction. `authorized` contains the
exact transaction for separate controller-wallet review, signing and broadcast. The CLI stops at that wallet handoff;
it never signs or broadcasts. After broadcast, run:

```sh
programmable-launch status REQUEST_UUID --watch --until finalized
```

## Exact-source verification

Finality is independent from explorer availability. After a bundled request is finalized, the server enqueues
idempotent verification work for each exclusive component. Optional `sourceVerification` is server-authored and uses
`queued`, `retrying`, `exact_match` or `needs_attention`. Only literal `exact_match` for every component is Source
verified. A client must never submit or infer this state. Legacy or unbundled requests remain compatible and unverified.

Finalized Router identities remain eligible for Explore and Profile after discovery refreshes even when optional market
enrichment or an explorer is unavailable. Provenance is not an audit, safety claim, liquidity guarantee or endorsement.

## Errors and support

Honor `Retry-After` on `429` and `503`. For support, send only `error.requestId`, HTTP status, UTC time and the public
error code. Never send the API key.

Generic fee claiming and buyback management for arbitrary hooks are not live. FADE uses a specifically bound adapter.
The reserved `fees:claim` and `buybacks:manage` scopes are disabled and promise no future behavior. Public Hookbuilder
and reusable-template intake are not part of V1.
