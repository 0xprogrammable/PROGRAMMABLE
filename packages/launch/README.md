# Programmable Launch CLI

`@programmable/launch` is the public, installable packager and API client for the Programmable Custom Launch API. It
has exactly four commands: `pack`, `validate`, `submit`, and `status`. It never signs or broadcasts a wallet
transaction.

## Install a versioned release

```sh
npm install --global \
  https://github.com/0xprogrammable/PROGRAMMABLE/releases/download/programmable-launch-v1.0.1/programmable-launch-1.0.1.tgz
programmable-launch --version
```

That immutable release remains the V1 compatibility package. V1 request preparation and status reads remain valid,
but new V1 submissions are read-only fenced with non-retryable `CUSTOM_LAUNCH_V1_READ_ONLY`.

This source tree is the dual-version `2.0.0-rc.2` candidate. After its immutable release asset and digest are
published, install that exact asset rather than an unverified npm-registry package with the same name:

```sh
npm install --global \
  https://github.com/0xprogrammable/PROGRAMMABLE/releases/download/programmable-launch-v2.0.0-rc.2/programmable-launch-2.0.0-rc.2.tgz
programmable-launch --version
```

The V2 Rev2 profile is a canary artifact with `productionLaunchAuthorized:false`; package installation is not launch
authority. The human guide is <https://programmable.market/docs/developers/custom-launch>.

## RC2 fee policy (private canary)

This disclosure describes only the frozen RC2 profile. It does not activate public V2 submission. The profile is for
Ethereum Mainnet only (`chainId: "1"`) and has `productionLaunchAuthorized: false`.

For each successful swap, the mandatory platform charge is 1,000 parts per 1,000,000 of the documented
`gross-unspecified-pool-currency-amount` basis: `1,000 ppm = 0.10% = 10 bps`. It accrues in the profile's unspecified
pool currency to `0x4957f49620AFf3Adbbe8195a4f633E49cc93376c`. The frozen profile enforces this path independently
of custom behavior; a Custom module cannot reduce or redirect it. A reverted swap rolls back the fee with the rest of
the transaction.

The pool's LP fee is separate from this platform charge and must be disclosed separately. Generic fee claiming and
buyback management for arbitrary hooks are not live. The reserved `fees:claim` and `buybacks:manage` scopes remain
disabled.

## Cold-agent flow

1. Produce exact Solidity Standard JSON input and compiler artifacts from one pinned build. Standard JSON sources must
   contain exact `content`; URL-only sources are rejected. Exact decoded Standard JSON is limited to 5,242,880 bytes
   per compilation unit and across all units in one request.
2. Create `programmable-launch.config.json` using the closed config contract below. Use exact file paths, constructor
   values, initializer values, salts, public source revision, and evidence files. Do not enter derived hashes.
3. Run the offline commands first:

```sh
programmable-launch pack --config programmable-launch.config.json --output launch.json
programmable-launch validate launch.json --config programmable-launch.config.json
```

For an executable V2 cold-room rehearsal, use `examples/fee-enforced-v2-no-broadcast/README.md` from the installed RC.
It invokes real solc 0.8.26, uses the exact distributed profile sources and artifacts, and ends after byte-reproducible
`pack` and `validate`. The older `examples/no-broadcast` fixture remains only for V1 golden compatibility.

If a later API activation authorizes this exact profile revision, save the API key only as the encrypted environment
secret `PROGRAMMABLE_API_KEY` or in the supported OS
secret store. Put the literal text `$PROGRAMMABLE_API_KEY` in agent setup or chat, never the key. On macOS, the fallback
secret-store lookup is the Keychain service `api.programmable.market`, account `PROGRAMMABLE_API_KEY`.

V2 `submit` routes only to `/v2/custom-launches`; while the profile is held it stops on
`CUSTOM_LAUNCH_V2_UNAVAILABLE` and preserves `Retry-After` and `requestId`. It never falls back to V1. If a future
authorized response is returned, stop the agent flow: the controller reviews the exact `walletTransaction` and signs
it in a separate wallet flow. After a human broadcast, use `status REQUEST_UUID --api-version 2 --watch --until
finalized`. `finalized`, `failed`, and `cancelled` always stop polling.

Neither included rehearsal claims authenticated submit, status, authorization, signing, or broadcast evidence.

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
