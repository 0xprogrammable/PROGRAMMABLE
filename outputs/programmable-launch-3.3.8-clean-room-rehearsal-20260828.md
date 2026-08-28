# Programmable Launch CLI 3.3.8 clean-room rehearsal

## Outcome

- Completed at `2026-08-28T15:21:07Z` from a fresh temporary directory.
- Inputs came only from the immutable public GitHub Release, the public tag, the packaged public example, and the public unauthenticated capabilities route.
- Release checksum verification passed.
- Isolated installation reported CLI version `3.3.8` on Node.js `v24.14.0` and npm `11.16.0`.
- The packaged example compiled real Solidity with exact solc `0.8.26+commit.8a97fa7a.Emscripten.clang`, 41 source files, four graph targets, exact Standard JSON, and compiler artifacts.
- `pack` passed twice from the same source/build/config inputs. Both launch files and both receipts were byte-identical.
- Local `validate` passed for live/default profile `programmable.direct-native-hook-graph.v1`, revision `3`, version `3.3.0`.
- Public `GET /v3/capabilities` confirmed Ethereum Mainnet, live/current and fresh-write profile `3.3.0`, and `productionLaunchAuthorized: true`.
- Authenticated remote preflight was deliberately not attempted. A syntactically invalid public placeholder prevented macOS Keychain lookup and stopped the CLI locally before any authenticated preflight request. A real `PROGRAMMABLE_API_KEY` must be supplied by the partner rehearsal.
- No submit, API resource creation, wallet signature, wallet provider, transaction, broadcast, RPC call, Mainnet coin, or spend occurred.

This proves the public cold-agent path through exact download, isolated install, real compilation, deterministic pack, local validation, and unauthenticated capability compatibility. It does not prove server admission, behavior evidence, wallet handoff, deployment, liquidity, trading, or launch finality. The packaged initializer deliberately reverts and must never be submitted or funded.

## Public inputs

- Release: <https://github.com/0xprogrammable/PROGRAMMABLE/releases/tag/programmable-launch-v3.3.8>
- Tarball: <https://github.com/0xprogrammable/PROGRAMMABLE/releases/download/programmable-launch-v3.3.8/programmable-launch-3.3.8.tgz>
- Checksum: <https://github.com/0xprogrammable/PROGRAMMABLE/releases/download/programmable-launch-v3.3.8/programmable-launch-3.3.8.tgz.sha256>
- Public tag/source commit: `475c0f31f15babd28c4e20b0577aa0f0fc08820d`
- Public package guide: `packages/launch/README.md` at that tag
- Packaged rehearsal guide: `examples/direct-native-v3-no-broadcast/README.md`
- Rehearsal image bytes: `public/brand/loop/programmable-loop-mark-512.png` at that public commit
- Capabilities: <https://api.programmable.market/v3/capabilities>

No private repository, private API schema, private fixture, private credential, or unpublished source was used.

## Exact commands

The following is the public-only sequence used. `$ROOM` was a fresh directory created with `mktemp`.

```sh
ROOM="$(mktemp -d /tmp/programmable-clean-room-3.3.8.XXXXXX)"
cd "$ROOM"

curl --fail --location --silent --show-error --retry 3 \
  --output programmable-launch-3.3.8.tgz \
  https://github.com/0xprogrammable/PROGRAMMABLE/releases/download/programmable-launch-v3.3.8/programmable-launch-3.3.8.tgz
curl --fail --location --silent --show-error --retry 3 \
  --output programmable-launch-3.3.8.tgz.sha256 \
  https://github.com/0xprogrammable/PROGRAMMABLE/releases/download/programmable-launch-v3.3.8/programmable-launch-3.3.8.tgz.sha256
curl --fail --location --silent --show-error --retry 3 \
  --output README.public.md \
  https://raw.githubusercontent.com/0xprogrammable/PROGRAMMABLE/programmable-launch-v3.3.8/packages/launch/README.md
shasum -a 256 -c programmable-launch-3.3.8.tgz.sha256

mkdir isolated
cd isolated
npm init --yes >/dev/null
npm install --ignore-scripts --no-audit --no-fund ../programmable-launch-3.3.8.tgz
./node_modules/.bin/programmable-launch --version

PACKAGE_ROOT="$PWD/node_modules/@programmable/launch"
cp -R "$PACKAGE_ROOT/examples/direct-native-v3-no-broadcast/project" ./direct-native-v3-clean-room
mkdir -p ./direct-native-v3-clean-room/release-modules
cp "$PACKAGE_ROOT/test/fixtures/programmable-settlement-fee-vault-v1.json" \
  ./direct-native-v3-clean-room/release-modules/
cp "$PACKAGE_ROOT/test/fixtures/programmable-settlement-fee-vault-v1.standard-json.json" \
  ./direct-native-v3-clean-room/release-modules/
cd ./direct-native-v3-clean-room

mkdir -p assets
curl --fail --location --silent --show-error --retry 3 \
  --output assets/project-logo.png \
  https://raw.githubusercontent.com/0xprogrammable/PROGRAMMABLE/475c0f31f15babd28c4e20b0577aa0f0fc08820d/public/brand/loop/programmable-loop-mark-512.png
npm ci --ignore-scripts --no-audit --no-fund

export PROGRAMMABLE_LAUNCH_WALLET=0x1111111111111111111111111111111111111111
export PROGRAMMABLE_SOURCE_REVISION=475c0f31f15babd28c4e20b0577aa0f0fc08820d
export PROGRAMMABLE_LAUNCH_NONCE=0x0000000000000000000000000000000000000000000000000000000000000001
export PROGRAMMABLE_TOKEN_NAME='No Broadcast V3 Token'
export PROGRAMMABLE_TOKEN_SYMBOL=NBV3
export PROGRAMMABLE_PROJECT_DESCRIPTION='Deterministic no-broadcast V3 reference launch'
export PROGRAMMABLE_PROJECT_IMAGE_SOURCE_PATH=assets/project-logo.png
export PROGRAMMABLE_PROJECT_IMAGE_URI=https://raw.githubusercontent.com/0xprogrammable/PROGRAMMABLE/475c0f31f15babd28c4e20b0577aa0f0fc08820d/public/brand/loop/programmable-loop-mark-512.png
export PROGRAMMABLE_WEBSITE_URL=https://programmable.market/
export PROGRAMMABLE_X_URL=https://x.com/0xProgrammable

npm run build
../node_modules/.bin/programmable-launch pack \
  --config programmable-launch.config.json \
  --output launch.json
../node_modules/.bin/programmable-launch validate launch.json \
  --config programmable-launch.config.json

../node_modules/.bin/programmable-launch pack \
  --config programmable-launch.config.json \
  --output launch-repacked.json \
  --receipt launch-repacked.receipt.json
../node_modules/.bin/programmable-launch validate launch-repacked.json \
  --config programmable-launch.config.json
cmp launch.json launch-repacked.json
cmp launch.json.receipt.json launch-repacked.receipt.json

curl --fail --silent --show-error --retry 3 \
  --output capabilities.json \
  https://api.programmable.market/v3/capabilities
jq -e '.chain.id == "1"
  and .profile.profileId == "programmable.direct-native-hook-graph.v1"
  and .profile.profileRevision == 3
  and .profile.profileVersion == "3.3.0"
  and .profile.productionLaunchAuthorized == true
  and .requestProfiles.current == "3.3.0"
  and (.requestProfiles.freshSubmissionExactVersions == ["3.3.0"])
  and .authentication.capabilities == "none"
  and .authentication.preflight == "bearer-api-key"' capabilities.json >/dev/null

# This invalid public placeholder prevents Keychain access and fails local key-shape
# validation before any authenticated preflight request is sent.
PROGRAMMABLE_API_KEY=public-clean-room-placeholder \
  ../node_modules/.bin/programmable-launch validate launch.json \
  --config programmable-launch.config.json \
  --remote \
  --max-attempts 1
```

The last command exited `1` with exactly:

```text
PROGRAMMABLE_API_KEY has an invalid shape
```

The authenticated `POST /v3/custom-launches/preflight` and `submit` were intentionally left to a rehearsal holding an authorized secret.

## Release evidence

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `programmable-launch-3.3.8.tgz` | 308587 | `13b7a73ab87fa2acca8d3be672e32b89c2d895fe7a715c09f3b3617379f77a30` |
| `programmable-launch-3.3.8.tgz.sha256` | 96 | `2982c5d4cb24fc2f2eb685d049f2f116da519fac5e90a95e3bb6e5a7aeaf54f8` |
| public `README.md` | 30255 | not used as a launch artifact |

Exact checksum-file contents:

```text
13b7a73ab87fa2acca8d3be672e32b89c2d895fe7a715c09f3b3617379f77a30  programmable-launch-3.3.8.tgz
```

`shasum -a 256 -c` returned `programmable-launch-3.3.8.tgz: OK`.

## Deterministic pack receipt

| Binding | Value |
| --- | --- |
| Request bytes | `574853` |
| Request SHA-256 | `sha256:5f35ffdc058fcf6d331dfdd93d2161938a260152d9e3a5173dce7df6fa7ddd92` |
| Graph bundle | `sha256:a2e0c5e25f72867b0db26e303ed2f58d5af9d995784bc2fd8c66c61da1cfa6cd` |
| Unbound graph bundle | `sha256:4328c460f1c6a5a3e152c95f1e01061edc97fae72185c2fd4e9d0656dca9ebfa` |
| Verification bundle | `sha256:b03159056f20dded09fb0bba2bd8000c2323725c05125d8c84cdbc7f7ca8bf90` |
| Project metadata | `sha256:f61ab7071330c3fc9c58910c5bcf5b676fe7353bab8712c00655198e9e3aad03` |
| Launch profile | `sha256:2383862de6169970e4c83b03a4c0a8c621f475af79b88e8e1892d8df2e640e9d` |
| Launch intent | `sha256:38ba9ce584462f26fa0b513d01e2cac09b5d06f667a1b5f64edea823420b0b51` |
| Funding intent | `0x56ede36e99051eaccbab0bd5be7d74afe9543bf370207dae91d4e64e32787442` |

Both pack executions produced these exact file hashes:

- `launch.json`: `5f35ffdc058fcf6d331dfdd93d2161938a260152d9e3a5173dce7df6fa7ddd92`
- `launch.json.receipt.json`: `bd30c0c3050bac0ec985c20a7887c215e9240685e615c5e51bcb93b22d61644a`

`cmp` reported no difference between the original and repacked launch bytes or receipts.

Predicted CREATE2 targets:

- settlement fee vault: `0x8dC00E72B827552A7F92A1b8dFb264D55be47fDb`
- initializer: `0xD6d2e6f2cA6a0337154888d92a42ff1a203DD15F`
- hook: `0x6C4620c1fb703cd60FFa23902502D04136Fee0CC`
- token: `0x4bb7Be24aD31e6A2D9d6df150F7a8a36E570fcF7`

## Exact source/build hashes

| Artifact | SHA-256 |
| --- | --- |
| `standard-json/direct-native-v3.json` | `31ac5f6eefa3cc297daeaf288f83a21d2e7cea14dad5e555b400ee34ca0700a0` |
| `standard-json/programmable-settlement-fee-vault-v1.json` | `840f0827714818dd9cf28ce15b684eb907d58b3701d3b3a9f28d0f3be137c7d9` |
| `artifacts/hook.json` | `b0b03a0e2857769d5fafed0cba91fc5eb6f66f920c73753024b363a2605ca04f` |
| `artifacts/token.json` | `b7184f299969cf6efff44fd3fd51b65631732eca6974ed50fe7d7a4acb216a43` |
| `artifacts/initializer.json` | `f0c18b7f665d9bec6e6d5dcf494d3b926f1cb0c22fe387c289468593ef63eed0` |
| `artifacts/settlement-fee-vault.json` | `6818be21e326b95d5295eac682431b3d3c450646a6e803bcb4877156b0103615` |
| `programmable-launch.config.json` | `b8a422ba364b7ca7b7f59dc2630cc52647c88a9182b4f17b052ae1f00756687a` |
| `evidence/rehearsal.json` | `23945d2d50b49a5a54c59d0a8c18e39ea5c51baca81f00a0e08131ab6ff249fe` |
| `assets/project-logo.png` | `21d8df2e89989132a82bd1327b412b50fa976ab35bf5264fb873e9cf987b31da` |

Local validation preserved one non-blocking warning, `FUNDING_NONCE_CONFORMANCE_UNPROVEN`. The fixture intentionally leaves the unsigned EIP-3009 nonce path for exact server simulation; the warning was not suppressed or represented as a safety claim.

## Live public capability receipt

- Response `serverTime`: `2026-08-28T15:19:45.259Z`
- Response file SHA-256: `6c37294192a4cc03c53fe7dd6bbdd3ffad98c7c12d8c10803ca1b30001dda2ee`
- Chain: Ethereum Mainnet, chain ID `1`
- Profile: `programmable.direct-native-hook-graph.v1`, revision `3`, version `3.3.0`
- Current profile: `3.3.0`
- Fresh-submission versions: exactly `["3.3.0"]`
- Production launch authorized: `true`
- Capabilities authentication: `none`
- Preflight and create authentication: `bearer-api-key`
- Remote stop stderr SHA-256: `2028cea918e43032e9641d8a56dabf28db23eecd33b652c1813d14582b0b92be`

## Authority boundary

The next meaningful remote step is authenticated quota-free preflight with an authorized `PROGRAMMABLE_API_KEY`. This clean room had no authorized key and therefore stopped before authentication. It did not run `submit`. The partner rehearsal owns authenticated preflight and must still stop before wallet signature or broadcast unless a separate owner-controlled test explicitly authorizes those actions.
