# Programmable Launch CLI

`@programmable/launch` is the public, installable packager and API client for the Programmable Custom Launch API. It
has exactly four commands: `pack`, `validate`, `submit`, and `status`. It never signs or broadcasts a wallet
transaction.

## Install a versioned release

```sh
npm install --global \
  https://github.com/0xprogrammable/PROGRAMMABLE/releases/download/programmable-launch-v3.0.0/programmable-launch-3.0.0.tgz
programmable-launch --version
```

The command must print `3.0.0`. Install this immutable GitHub Release asset rather than an unverified npm-registry
package with the same name.

The immutable V1 package remains available only for compatibility preparation and reads. New V1 submissions are
read-only fenced with non-retryable `CUSTOM_LAUNCH_V1_READ_ONLY`:

```sh
npm install --global \
  https://github.com/0xprogrammable/PROGRAMMABLE/releases/download/programmable-launch-v1.0.1/programmable-launch-1.0.1.tgz
programmable-launch --version
```

The V3 general hook profile is the public production profile. Package installation is not wallet authority: the API prepares
the exact Router transaction, then the connected controller reviews and signs it separately. The human guide is
<https://programmable.market/docs/developers/custom-launch>.

## V3 general hook profile

Version `3.0.0` supports the production general profile
`programmable.direct-native-hook-graph.v1`. The [V3 OpenAPI](https://programmable.market/openapi/custom-launch-v3.json)
is the normative request and lifecycle contract. Existing V2 and V1 resources remain readable.

The Router primitive supports 2–16 targets. This V3 profile requires 3–16 direct CREATE2 targets because token, hook
and initializer roles are distinct. The token, hook and all other targets are project-owned exact artifacts. All valid
Uniswap v4 permission masks are supported when the source declaration, compiled permissions and hook-address low bits
match. The 10 bps Programmable share may be additive or included in the selected total; pack derives the effective
and project values. Static pool fees and the `0x800000` dynamic-fee sentinel are supported.

Funding can be absent, carried as exact native value on the separately reviewed Router transaction, or use an unsigned
USDC EIP-3009 descriptor with an exact signature patch. The connected wallet separately signs EIP-3009 data when that
mode is selected. Only after exact graph conformance and transaction simulation does the website present the Router
transaction. The CLI never accepts an API key argument, signs, requests approval, or broadcasts either wallet action.

## Platform fee policy

The general V3 profile is public on Ethereum Mainnet only (`chainId: "1"`) and has
`productionLaunchAuthorized: true`.

For each successful swap, the mandatory platform charge is 1,000 parts per 1,000,000 of the documented
declared assessment basis: `1,000 ppm = 0.10% = 10 bps`. Its exact claim binding is controlled by
`0x4957f49620AFf3Adbbe8195a4f633E49cc93376c`. A platform-signed conformance receipt for the exact final graph is
required before the launch permit signer can run. A reverted swap must roll back the fee with the rest of the transaction.

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

Use the general V3 example shipped with the release for a no-broadcast cold-room rehearsal. It invokes real solc,
uses exact sources and artifacts, and stops after byte-reproducible `pack` and `validate`.

Save the API key only as the encrypted environment secret `PROGRAMMABLE_API_KEY` or in the supported OS
secret store. Put the literal text `$PROGRAMMABLE_API_KEY` in agent setup or chat, never the key. On macOS, the fallback
secret-store lookup is the Keychain service `api.programmable.market`, account `PROGRAMMABLE_API_KEY`.

V3 `submit` routes only to `/v3/custom-launches`. It never falls back to an older create route. Preserve the exact request bytes and
idempotency key across timeout, `429`, or `503` retries and honor `Retry-After`. At `authorized`, stop the agent flow:
the controller reviews the exact `walletTransaction` and signs it in a separate wallet flow. After a human broadcast,
use `status REQUEST_UUID --watch --until finalized`. V3 is the default status route; use `--api-version 1` or
`--api-version 2` only when reading a legacy request. `finalized`, `failed`, and `cancelled` always stop polling.

```sh
programmable-launch submit launch.json --config programmable-launch.config.json
programmable-launch status REQUEST_UUID --watch --until authorized
```

For `eip-3009-receive-with-authorization`, the first status command can stop at
`awaiting_funding_authorization`. The controller signs that exact funding authorization in the website wallet flow,
never in the CLI, then runs the same status command again. At `authorized`, the controller separately reviews and
broadcasts the exact Router transaction from the website. The agent can then track finality:

```sh
programmable-launch status REQUEST_UUID --watch --until finalized
```

The included rehearsal proves only offline pack and validation. It does not submit, poll, sign, or broadcast.

## Pack config V3

The top-level fields are:

- `schemaVersion`: `programmable.launch-pack-config.v3`
- `launchWallet`, `chainId: "1"`, and a nonzero lowercase bytes32 `nonce`
- `source`: relative `root`, non-empty exact `paths`, decimal `sourceLineageNonce`, and `publicOrigin` containing a
  public HTTPS `url` plus the exact lowercase merged production Git `revision` used for the release
- `compilationUnits`: unique `{ compilationUnitId, standardJson }` entries
- `targets`: 3–16 target definitions
- `pool`: exact token/hook target IDs, fee, tick spacing, and `quoteCurrency` address; use
  `0x0000000000000000000000000000000000000000` for native ETH or the exact ERC-20 address for a token quote
- `permitWindow`: exact `validAfter` and `deadline`, no more than one hour apart
- `launchProfile`: target roles, funding mode, fee accounting and claim binding
- `agentAttestation`: stable agent ID, explicit millisecond UTC `checkedAt`, and checks that point to exact evidence files

Each target has exactly `targetId`, `compilationUnitId`, `artifact`, `applicantSalt`, `constructorArguments`,
`initializer`, `deploymentValueWei`, `initializerValueWei`, `componentKind`, `declaredHookPermissions`, and
`runtimeImmutables`.
Constructor arguments are JSON ABI values. Use `{ "target": "another-target-id" }` in an ABI `address` slot; `pack`
encodes a zero placeholder and derives the locator and resolved CREATE2 address. `initializer` is either `null` or
`{ "function": "functionName", "arguments": [...] }`.

`runtimeImmutables` is always an array. Use `[]` when the compiler artifact has no immutable references. Otherwise it
must cover every compiler immutable ID exactly once with its ABI type and either a literal or a target reference, for
example `{ "immutableId": "0", "abiType": "address", "target": "token" }`. `pack` materializes the exact deployed
runtime from those compiler ranges and values before deriving its hash; missing, duplicate, or extra bindings stop
packaging.

The V3 `launchProfile` uses schema
`programmable.direct-native-hook-graph-profile-selection.v2`, profile
`programmable.direct-native-hook-graph.v1`, and revision `2`. It names `tokenTargetId`, `hookTargetId`,
`initializerTargetId`, and `platformFeeBindingTargetId`; selects funding mode `none`,
`wallet-transaction-value`, or `eip-3009-receive-with-authorization`; selects `additive-platform-share` or
`inclusive-selected-total`; binds either `executed-gross-declared-quote` with `declared-quote-currency` or
`settled-input-before-platform-fee` with `input-currency`; selects
`immutable-payout-recipient` or `claim-authority-selected-recipient`; and supplies both applicant-selected fee values.
Those fee values are decimal hundredths of a bip from `0` through `999999`; additive mode stops at `998999` so the
additional `1000` platform units fit the denominator. `payoutRecipient` is present only for the immutable mode and
must equal `0x4957f49620AFf3Adbbe8195a4f633E49cc93376c`. The EIP-3009 mode additionally requires the exact
`fundingAuthorization` and unsigned `fundingSignaturePatch` top-level objects; the other funding modes forbid them.
`none` requires zero native deployment and initializer value, `wallet-transaction-value` requires a nonzero exact
Router transaction value, and EIP-3009 funding requires zero native deployment and initializer value.

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
full expected runtime hash from the compiler runtime template and the required `runtimeImmutables`; it never accepts a
hand-written runtime hash.

V3 deterministic packaging permits project-owned proxy or delegating hook runtimes. Exact source, compiler, config,
runtime, graph, and request binding proves reproducibility, not safety approval. Platform admission, fee-conformance
evidence, review, wallet authorization, deployment, and availability remain separate gates.

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
