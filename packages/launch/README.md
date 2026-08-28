# Programmable Launch CLI

`@programmable/launch` is the public, installable packager and API client for the Programmable Custom Launch API. It
has exactly four commands: `pack`, `validate`, `submit`, and `status`. It never signs or broadcasts a wallet
transaction.

## Install a versioned release

```sh
programmable_cli_dir="$(mktemp -d)"
curl --fail --location --output "$programmable_cli_dir/programmable-launch-3.3.7.tgz" \
  https://github.com/0xprogrammable/PROGRAMMABLE/releases/download/programmable-launch-v3.3.7/programmable-launch-3.3.7.tgz
curl --fail --location --output "$programmable_cli_dir/programmable-launch-3.3.7.tgz.sha256" \
  https://github.com/0xprogrammable/PROGRAMMABLE/releases/download/programmable-launch-v3.3.7/programmable-launch-3.3.7.tgz.sha256
(cd "$programmable_cli_dir" && shasum -a 256 -c programmable-launch-3.3.7.tgz.sha256)
npm install --global "$programmable_cli_dir/programmable-launch-3.3.7.tgz"
programmable-launch --version
```

The checksum command must report `OK`, and the version command must print `3.3.7`. Install this verified GitHub
Release asset rather than an unverified npm-registry package with the same name.

The release includes `npm-shrinkwrap.json` so the runtime dependency closure is integrity-pinned. Release operators
generate the CycloneDX inventory with `npm run sbom`; that inventory and the tarball checksum are evidence for exact
published bytes, not a substitute for verifying the downloaded asset.

The public CLI source and package are licensed under the included MIT license.

The immutable V1 package remains available only for compatibility preparation and reads. New V1 and V2 submissions
are read-only fenced with non-retryable `CUSTOM_LAUNCH_V1_READ_ONLY` and `CUSTOM_LAUNCH_V2_READ_ONLY`. Existing V1
and V2 resources remain readable through their original status routes:

```sh
npm install --global \
  https://github.com/0xprogrammable/PROGRAMMABLE/releases/download/programmable-launch-v1.0.1/programmable-launch-1.0.1.tgz
programmable-launch --version
```

The V3 general hook profile is the public production profile. Package installation is not wallet authority: the API prepares
the exact Router transaction, then the connected controller reviews and signs it separately. The human guide is
<https://programmable.market/docs/developers/custom-launch>.

## V3 general hook profile

Package `3.3.7` supports production general profile
`programmable.direct-native-hook-graph.v1` version `3.3.0`. New packs use complete-metadata `3.3.0`; exact `3.2.0`
requests retain their original permissive metadata semantics, while metadata-absent `3.1.0`, `3.0.0`, and `2.0.0`
requests remain reproducible for validation and retry compatibility. The [V3 OpenAPI](https://programmable.market/openapi/custom-launch-v3.json)
is the normative request and lifecycle contract. Existing V2 and V1 resources remain readable, but their create
routes are closed. The CLI rejects legacy submit attempts locally before reading request bytes, credentials, state,
or network.

The Router primitive supports 2–16 targets. This V3 profile requires 3–16 direct CREATE2 targets because token, hook
and initializer roles are distinct. The token, hook and all other targets are project-owned exact artifacts. All valid
Uniswap v4 permission masks are supported when the source declaration, compiled permissions and hook-address low bits
match. Every enabled permission must have a concrete reachable callback implementation; an interface declaration or
fallback-only route does not qualify. The 10 bps Programmable share may be additive or included in the selected total; pack derives the effective
and project values. Static pool fees and the `0x800000` dynamic-fee sentinel are supported.

Funding can be absent, carried as exact native value on the separately reviewed Router transaction, or use an unsigned
USDC EIP-3009 descriptor with an exact v2 nonce+r+s+v ABI-path patch. The connected wallet separately signs EIP-3009 data when that
mode is selected. The website presents the Router transaction only after the API server has verified the required
per-launch behavior, platform-fee, liquidity, and routability evidence for the selected launch lane. Missing,
unavailable, conditional, or failed required evidence cannot produce a wallet handoff. The CLI never accepts an API
key argument, decides authorization, signs, requests approval, or broadcasts either wallet action.

Revision 3 preparation binds exact source, compiler output, the complete graph and a role-aware static report. Local
validation, remote preflight, model output, and client-side findings are preparation only. The API server is the
authorization decision point and derives required evidence from the selected launch lane. No stage is a universal
audit or guarantee of safety, honeypot absence, liquidity, tradeability, or fee behavior.

## Platform fee policy

The general V3 profile is public on Ethereum Mainnet only (`chainId: "1"`) and has
`productionLaunchAuthorized: true`.

Every V3 request must bind and disclose a declared Programmable share of 1,000 parts per 1,000,000 of its assessment
basis: `1,000 ppm = 0.10% = 10 bps`. The accounting mode is additive or inclusive, and the server recomputes the
declared buy and sell economics. Its exact claim binding is controlled by
`0x4957f49620AFf3Adbbe8195a4f633E49cc93376c`. That binding is a request commitment, not proof of runtime enforcement:
the revision 3 admission receipt carries `feeBehaviorClaim: false`. Ten bps is enforced only for fee-certified profiles
or adapters and only for the stamped PoolKey after launch-specific server evidence verifies the fee path. Arbitrary
custom hooks are not automatically fee-enforced. Projects and users must inspect the exact implementation and
launch-specific server evidence.

The pool's LP fee is separate from this platform charge and must be disclosed separately. Generic fee claiming and
buyback management for arbitrary hooks are not live. The reserved `fees:claim` and `buybacks:manage` scopes remain
disabled.

Normal Uniswap v4 initialization sets a starting price but does not add liquidity. A project using ordinary
concentrated liquidity must fund and create its own position; volume cannot create initial liquidity from nothing.
Zero classical LP works only when the project hook and initializer implement custom accounting or hold inventory that
can exchange against incoming assets. Funding mode `none` does not make an empty ordinary pool liquid.

## Cold-agent flow

1. Produce exact Solidity Standard JSON input and compiler artifacts from one pinned build. Standard JSON sources must
   contain exact `content`; URL-only sources are rejected. Exact decoded Standard JSON is limited to 5,242,880 bytes
   per compilation unit and across all units in one request, with at most 2,048 sources per unit. Revision 3 requires
   exact solc `0.8.26+commit.8a97fa7a`.
2. Create `programmable-launch.config.json` using shipped schema
   `schemas/programmable-launch-pack-config-v3.json` and the closed config contract below. Its byte-identical public URL
   is <https://programmable.market/schemas/custom-launch/v3/pack-config.json>. Use exact file paths, constructor values,
   initializer values, salts, public source revision, and evidence files. Do not enter derived hashes.
3. Run the offline commands first:

```sh
programmable-launch pack --config programmable-launch.config.json --output launch.json
programmable-launch validate launch.json --config programmable-launch.config.json
```

Before `submit`, run the same validation with `--remote`:

```sh
programmable-launch validate launch.json \
  --config programmable-launch.config.json \
  --remote
```

Remote validation first reads public, unauthenticated `GET /v3/capabilities`, including the advertised profile,
supported shapes and limits, finding classes, scopes, fee-claim boundary, and website wallet-handoff base. It then
sends the byte-identical V3 request to authenticated `POST /v3/custom-launches/preflight`. The API key still comes
only from `PROGRAMMABLE_API_KEY` or the supported OS secret store and must include `custom-launch:create`; the CLI has
no key-valued flag. Authenticated traffic is fixed to the exact origin `https://api.programmable.market`; the release
CLI has no API-origin override. Both remote preflight and V3 submit require the exact public capability contract before
the CLI loads the key. Tests replace the transport implementation without redirecting a production key.

Preflight is a support and evidence classification, not a launch or authorization. A conforming
`programmable.custom-launch-preflight.v1` response binds `requestHash` to the server's domain-separated canonical
JCS digest of the parsed V3 request, while the CLI separately retains the raw launch-file SHA-256 for byte-race and
retry-journal integrity. The response also binds profile revision and server time and reports
one of `supported`, `supported_with_warnings`, `needs_evidence`, or `unsupported`. It exposes separate
`launchEligibility.deployable`, `routable`, and `featured` decisions, the evidence tier, finding-code arrays, static
baseline and typed remediation. The CLI rejects a response unless it explicitly confirms `quotaConsumed: false`,
`nonceAllocated: false`, `persisted: false`, `walletSignatureRequiredLater: true`, and
`walletBroadcastByService: false`. Unknown additive capability and preflight fields remain present in CLI JSON.
`quotaConsumed: false` means the preflight creates no durable launch and consumes no launch-creation quota; it does not
mean the authenticated HTTP request is unmetered. Normal route limits still apply, and a partner preflight consumes its
`prepareRequestsPerHour` budget.
Neither a favorable preflight disposition nor local checks can approve wallet handoff. The server must later bind and
verify the launch-specific behavior, fee, liquidity, and routability evidence required by the selected lane.

Use `examples/direct-native-v3-no-broadcast/README.md` shipped with the release for a no-broadcast cold-room
rehearsal. It invokes real solc, uses exact sources and artifacts, and stops after byte-reproducible `pack` and
`validate`.

Save the API key only as the encrypted environment secret `PROGRAMMABLE_API_KEY` or in the supported OS
secret store. Put the literal text `$PROGRAMMABLE_API_KEY` in agent setup or chat, never the key. On macOS, the fallback
secret-store lookup is the Keychain service `api.programmable.market`, account `PROGRAMMABLE_API_KEY`.

V3 `submit` routes only to `/v3/custom-launches`. V1 and V2 submit are rejected locally and their server create routes
are non-retryable write fences. The CLI never falls back to an older create route. Preserve the exact request bytes and
idempotency key across timeout, `429`, or `503` retries and honor `Retry-After`. At `authorized`, stop the agent flow:
the controller reviews the exact `walletTransaction` and signs it in a separate wallet flow. After a human broadcast,
use `status REQUEST_UUID --watch --until finalized`. V3 is the default status route; use `--api-version 1` or
`--api-version 2` only when reading a legacy request. `finalized`, `failed`, and `cancelled` always stop polling.

When the API returns them, `submit` and `status` promote `actionRequired`, the safe `walletHandoffUrl`, `expiresAt`,
and `secondsRemaining` alongside the complete resource. These handoff fields may appear only after the server has
verified every evidence axis required for the selected launch lane. Open the handoff in the separate website wallet flow. These
fields do not give the CLI signer or broadcaster authority, and an expired handoff must not be reused.

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
  public HTTPS `url` plus the exact lowercase 40-character Git commit containing the submitted source bytes
- `compilationUnits`: unique `{ compilationUnitId, standardJson }` entries
- `targets`: 3–16 target definitions
- `pool`: exact token/hook target IDs, fee, tick spacing, and `quoteCurrency` address; use
  `0x0000000000000000000000000000000000000000` for native ETH or the exact ERC-20 address for a token quote
- `projectMetadata`: the required public token declaration and presentation input described below
- `permitWindow`: exact `validAfter` and `deadline`, no more than one hour apart
- `launchProfile`: target roles, liquidity model, funding mode, fee accounting and claim binding
- `agentAttestation`: stable agent ID, explicit millisecond UTC `checkedAt`, and checks that point to exact evidence files

Current profile `3.3.0` requires this exact public metadata input. Ask the project owner for these values; do not invent
them and do not hand-write either derived hash:

```json
{
  "schemaVersion": "programmable.project-metadata-input.v1",
  "token": {
    "name": "Example Hook",
    "symbol": "HOOK"
  },
  "presentation": {
    "description": "Example Hook adds project-defined swap behavior for its token.",
    "image": {
      "sourcePath": "assets/token.png",
      "uri": "https://example.org/token.png"
    },
    "links": [
      { "kind": "website", "uri": "https://example.org/" },
      { "kind": "x", "uri": "https://x.com/example" }
    ]
  }
}
```

`token.name` is 1–64 UTF-8 bytes and `token.symbol` is 1–16 UTF-8 bytes. Both are NFC, already trimmed public
text; the symbol contains no whitespace. `presentation.description` must contain 20–4,096 UTF-8 bytes and at least
eight Unicode letters or numbers. `presentation.image` must name a non-empty local PNG, JPEG, WebP, or GIF of at most
20 MiB and 8192 pixels per dimension plus its canonical public URI. The packer derives and binds the exact SHA-256,
byte length, media type, dimensions, and source-manifest file entry; it never invents or uploads an image. `links`
must contain exactly one credential-free public HTTPS `website` and exactly one canonical X profile matching
`https://x.com/<handle>`. Up to 30 `documentation`, `telegram`, `discord`, `github`, or `other` HTTPS links are optional.

Use a stable content URI. For an HTTPS image, enable browser-readable CORS so the wallet review can fetch the raw
bytes and verify SHA-256, byte length, media type and dimensions before rendering. IPFS and Arweave use the website's
fixed public gateways for the same check. If remote bytes are unavailable or differ, the review shows the bound digest
and a placeholder; it does not replace metadata, upload content, sign or broadcast automatically.

The request contains the normalized `programmable.project-metadata.v1`, its domain-framed
`projectMetadataHash`, and a `programmable.project-token-metadata-binding.v1`. When exactly one selected token
constructor or initializer string argument clearly represents `name` or `symbol`, `pack` requires an exact match.
Constant, inherited, proxy, initializer-based and other arbitrary token designs are not rejected when a value cannot
be extracted deterministically: the declaration is still bound to the request and onchain launch ID, and the API
requires post-deployment `name()` / `symbol()` readback where supported. A mismatch or unavailable readback is public
truth; it never silently rewrites the owner's declaration.

`projectMetadataHash` is SHA-256 of UTF-8 `programmable.project-metadata.v1`, one NUL byte, and JCS metadata bytes.
The launch identity uses a metadata-bound `graphBundleHash`: SHA-256 of UTF-8
`programmable.custom-graph-project-metadata.v1`, one NUL byte, and JCS
`{graphBundleHash:<unbound graph SHA-256>,projectMetadataHash}`. The receipt exposes both hashes so the website wallet
review and finalized public read model can verify the same identity. Exact legacy `3.2.0` retries preserve their original
metadata rules. Exact `3.1.0`, `3.0.0`, and `2.0.0` retries omit metadata rather than inventing it.

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
`programmable.direct-native-hook-graph-profile-selection.v3`, profile
`programmable.direct-native-hook-graph.v1`, and revision `3`. It names `tokenTargetId`, `hookTargetId`,
`initializerTargetId`, and `platformFeeBindingTargetId`; selects funding mode `none`,
`wallet-transaction-value`, or `eip-3009-receive-with-authorization`; selects `additive-platform-share` or
`inclusive-selected-total`; binds either `executed-gross-declared-quote` with `declared-quote-currency` or
`settled-input-before-platform-fee` with `input-currency`; selects
`immutable-payout-recipient` or `claim-authority-selected-recipient`; and supplies both applicant-selected fee values.
Those applicant-selected fee values are decimal hundredths of a bip from `0` through `100000` for both accounting
modes. The server enforces the same 1,000 bps / 10% applicant cap. The separate `1000` platform units are added in
additive mode or included in the selected total in inclusive mode. `payoutRecipient` is present only for the immutable mode and
must equal `0x4957f49620AFf3Adbbe8195a4f633E49cc93376c`. The EIP-3009 mode additionally requires the exact
`fundingAuthorization` and unsigned `fundingSignaturePatch` top-level objects; the other funding modes forbid them.
For new requests the patch input contains exactly `targetId`, `nonceArgumentPath`, `rArgumentPath`, `sArgumentPath`,
and `vArgumentPath`. Each path is a non-empty array of zero-based ABI indices: its first index selects a top-level
initializer input and later indices descend only static tuples or fixed-size static arrays. The four distinct zero
leaves must resolve to `bytes32`, `bytes32`, `bytes32`, and `uint8`. The CLI derives and proves them from the compiled
ABI and emits `programmable.eip3009-authorization-patch.v2`; applicant byte offsets are absent from the public 3.3.7
schema. Legacy r/s/v-only v1 descriptors remain readable for exact retries and emit
`FUNDING_SIGNATURE_PATCH_V1_LEGACY`, but new integrations must use v2.
`none` requires zero native deployment and initializer value, `wallet-transaction-value` requires a nonzero exact
Router transaction value, and EIP-3009 funding requires zero native deployment and initializer value.

The request also binds one honest liquidity model. `external-concentrated-liquidity` declares
`liquidity_required`: the graph may deploy and initialize the pool identity, but it is not presented as tradeable until
someone adds normal v4 liquidity. `launch-seeded-concentrated-liquidity` binds the exact graph target that seeds the
position and declares the required seed, custody/withdrawal, and buy/sell assessment vectors.
`hook-inventory-custom-accounting` binds the hook inventory path and requires a swap return-delta permission plus
buy, sell, delta-solvency, and backing/withdrawal assessment vectors. A request may only declare those vectors as
`required` with `requestClaimsExecution: false`; it never declares the vectors executed or passed, and neither
packaging nor Router simulation is presented as that evidence. Omitting this field in an
older config is normalized by the CLI to the explicit external-liquidity model, so the emitted request remains fully
hash-bound and never implies that trading volume can create liquidity from nothing.

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

## Machine-readable remediation

Local integration failures expose `programmable.launch-cli-diagnostic.v1` on the thrown error and as canonical JSON
after `Programmable CLI diagnostic:` on stderr. The object includes a stable code, stage, expected and observed values,
typed `requiredChange` and `resumeAt` instructions, and public documentation/catalog URLs. Catalog fragments are
resolvable JSON Pointers such as `#/remediations/0`, rather than non-resolving code-shaped anchors. Stable local repair
codes include `PACK_CONFIG_V3_MISSING`,
`PACK_CONFIG_V3_INVALID`, `FUNDING_AUTHORIZATION_PATCH_PATH_INVALID`, and the legacy migration code
`FUNDING_SIGNATURE_PATCH_NOT_TOP_LEVEL`. Raw source-string indicators never become hard safety findings; a legacy
descriptor may instead return nonblocking `FUNDING_NONCE_DERIVATION_CONFLICT_SUSPECTED` or
`FUNDING_NONCE_CONFORMANCE_UNPROVEN`. Exact Router simulation is one required input, not authorization by itself.

V3 deterministic packaging permits project-owned proxy or delegating hook runtimes. Exact source, compiler, config,
runtime, graph, and request binding proves reproducibility, not safety approval. Role-aware platform admission,
server-executed behavior, fee, liquidity and routability evidence, wallet authorization, deployment, and availability
remain separate gates; admission does not certify fee behavior.

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

Wallet keys, partner root keys, and bounded partner subkeys all use the same `PROGRAMMABLE_API_KEY`, CLI commands, and
V3 create, preflight, list and status endpoints. Launch operations use `custom-launch:create` and reads use
`custom-launch:read`; only a root partner key may hold `partner-subkeys:manage`. A wallet key requires `launchWallet`
to match its wallet binding. A partner credential selects the exact controller in the immutable request but gains no
wallet authority; that controller still owns the launch and separately signs and broadcasts. The current Router V1
permit-reissue disposition endpoint is the wallet-key-only exception.
When a partner credential is used, the server may return immutable `partnerAttribution`; callers cannot supply or
override it. “Launched via” is provenance only, never verification, a safety mark, endorsement, or an economic category.

Partner history is isolated by credential principal. A root cannot list or read child launches, and a child cannot read
root or sibling launches. Rotating a subkey revokes its launch bridges and creates a replacement principal; private
launch history is not migrated to the replacement. The root subkey list retains bounded credential metadata, not the
child's launch resources. Every subkey-admin route consumes the root's `subkeyAdminRequestsPerHour` budget.

For a failed, unconsumed wallet-key `PERMIT_EXPIRED` launch, the Router V1 permit-reissue endpoint returns a typed `409`;
this release defines no `2xx` reissue response and reserves no replacement nonce or permit. Partner credentials are not
authenticated on that endpoint. In either case, repack and submit a new launch request with a fresh nonce and new
Idempotency-Key. All fee and security gates run again and predicted addresses may change.

API errors retain the server's structured `error.details` on `ProgrammableApiError.details.serverDetails` for
programmatic diagnosis and expose validated `programmable.custom-launch-remediation.v1` objects separately. CLI
stderr renders only bounded typed fields; arbitrary request, source, authorization, and signature echoes are not
printed.

## Scope boundary

This package prepares, submits, and tracks Custom launches. It contains no approval, platform signer, wallet signing,
wallet broadcast, fee-claim, buyback-management, or public Hookbuilder logic. Generic fee claims and buyback management
for arbitrary hooks are not active. FADE uses a specifically bound adapter, not a generic capability. The reserved
`fees:claim` and `buybacks:manage` scopes grant no operation.
