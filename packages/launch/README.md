# Programmable Launch CLI

`@programmable/launch` is the public, installable packager and API client for the Programmable Custom Launch API. It
has exactly four commands: `pack`, `validate`, `submit`, and `status`. It never signs or broadcasts a wallet
transaction.

## Install the versioned public release

```sh
npm install --global \
  https://github.com/0xprogrammable/PROGRAMMABLE/releases/download/programmable-launch-v1.0.1/programmable-launch-1.0.1.tgz
programmable-launch --version
```

The release asset is the installation authority. Do not substitute an unverified npm-registry package with the same
name. The human guide is <https://programmable.market/docs/developers/custom-launch> and the normative API contract is
<https://programmable.market/openapi/custom-launch-v1.json>.

## Cold-agent flow

1. Produce exact Solidity Standard JSON input and compiler artifacts from one pinned build. Standard JSON sources must
   contain exact `content`; URL-only sources are rejected. Exact decoded Standard JSON is limited to 5,242,880 bytes
   per compilation unit and across all units in one request.
2. Create `programmable-launch.config.json` using the closed config contract below. Use exact file paths, constructor
   values, initializer values, salts, public source revision, and evidence files. Do not enter derived hashes.
3. Run the four commands:

```sh
programmable-launch pack --config programmable-launch.config.json --output launch.json
programmable-launch validate launch.json --config programmable-launch.config.json
programmable-launch submit launch.json --config programmable-launch.config.json
programmable-launch status REQUEST_UUID --watch --until authorized
```

Before `submit`, save the API key only as the encrypted environment secret `PROGRAMMABLE_API_KEY` or in the supported OS
secret store. Put the literal text `$PROGRAMMABLE_API_KEY` in agent setup or chat, never the key. On macOS, the fallback
secret-store lookup is the Keychain service `api.programmable.market`, account `PROGRAMMABLE_API_KEY`.

At `authorized`, stop the agent flow. The controller reviews the exact returned `walletTransaction` and signs it in a
separate wallet flow. After broadcast, use `status REQUEST_UUID --watch --until finalized`. `finalized`, `failed`, and
`cancelled` always stop polling.

For an executable cold-room rehearsal, use `examples/no-broadcast/README.md` from the installed package. It contains
real Solidity sources, exact Standard JSON, matching solc artifacts and a config generator. The generated evidence is
truthfully scoped to `pre-submit`; separate commands can then pack, validate, submit and poll to `authorized`, where
the workflow explicitly stops without signing or broadcasting.

## Pack config V1

The top-level fields are:

- `schemaVersion`: `programmable.launch-pack-config.v1`
- `launchWallet`, `chainId: "1"`, and a nonzero lowercase bytes32 `nonce`
- `source`: relative `root`, non-empty exact `paths`, decimal `sourceLineageNonce`, and public HTTPS `url` plus exact
  lowercase Git `revision`
- `compilationUnits`: unique `{ compilationUnitId, standardJson }` entries
- `targets`: 1–16 target definitions
- `pool`: exact token/hook target IDs, fee, and tick spacing
- `agentAttestation`: stable agent ID, explicit millisecond UTC `checkedAt`, and checks that point to exact evidence files

Each target has exactly `targetId`, `compilationUnitId`, `artifact`, `applicantSalt`, `constructorArguments`,
`initializer`, `deploymentValueWei`, `initializerValueWei`, `componentKind`, and `declaredHookPermissions`.
Constructor arguments are JSON ABI values. Use `{ "target": "another-target-id" }` in an ABI `address` slot; `pack`
encodes a zero placeholder and derives the locator and resolved CREATE2 address. `initializer` is either `null` or
`{ "function": "functionName", "arguments": [...] }`.

`applicantSalt` is either a fixed lowercase bytes32 or, for the hook only, a closed deterministic grind request:

```json
{
  "mode": "deterministic-hook-permission-grind-v1",
  "start": "0",
  "maxAttempts": "262144"
}
```

The packer fixes the source bundle, wallet, nonce, target init code and declared permissions first. It then tries salts
in unsigned integer order and selects the first CREATE2 hook address whose low 14 bits equal those permissions. A failed
bounded search stops with `HOOK_SALT_GRIND_EXHAUSTED`; it never substitutes different permissions.

`pack` derives bytecode and the exact solc build from the artifact, exact Standard JSON bytes and SHA-256, sorted source
manifest, source descriptor, graph bundle, address locators, CREATE2 predictions, agent evidence hashes, verification
bundle, graph hash, verification hash, and exact request-byte hash. It rejects unresolved libraries. It derives the
full expected runtime hash only when the compiler artifact has no unresolved immutable references. Otherwise it stops
with `RUNTIME_MATERIALIZATION_REQUIRED`; it never accepts a hand-written runtime hash.

The deterministic source-content digest is SHA-256 of RFC 8785/JCS bytes for
`{schemaVersion:"programmable.source-bundle-content.v1",entries:[manifest fields plus contentBase64]}`. Entries are
unique and sorted by UTF-8 path bytes; `contentBase64` encodes exact file bytes or exact UTF-8 symlink-target bytes.

The closed API request body is limited to 8,388,608 bytes. The decoded Standard JSON limit leaves room for canonical
base64 and the rest of the request envelope; `pack` and `validate` enforce both limits before network access.

## Retry and local state

`submit` requires the pack config and first proves that `launch.json` is byte-identical to a fresh pack of the exact
source and build artifacts. It then stores the idempotency key, API origin, request SHA-256, and the exact request bytes
before the first network call. State defaults to the OS application state directory and can be redirected with
`PROGRAMMABLE_LAUNCH_STATE_DIR`. Reusing a key with different bytes fails locally. Timeouts, transport ambiguity,
`503`, and `429` retry only the persisted bytes with the same key. `Retry-After` supports both seconds and HTTP dates.

The API key is never written to the journal or output. For support, send only the response `requestId`, HTTP status,
UTC time, and the public error code. Never send the API key.

## Scope boundary

This package prepares, submits, and tracks Custom launches. It contains no approval, platform signer, wallet signing,
wallet broadcast, fee-claim, buyback-management, or public Hookbuilder logic. Generic fee claims and buyback management
for arbitrary hooks are not active. The reserved `fees:claim` and `buybacks:manage` scopes grant no operation.
