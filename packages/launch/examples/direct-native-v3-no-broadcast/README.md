# Direct-native V3 no-broadcast clean room

This packaged fixture compiles real Solidity with exact `solc` 0.8.26, emits the Standard JSON input and selected
compiler artifacts, then prepares and validates a three-target
`programmable.direct-native-hook-graph.v1` revision 3 request. The hook target is the exact
`ProgrammableVolumeFeeHookV2` reference source/build at permission mask `0x20cc`. The initializer uses a static nested
tuple and the real `receiveWithAuthorization` call shape. The CLI derives and proves v2 ABI paths for the API-derived
nonce plus `r`/`s`/`v`; the initializer then deliberately reverts so this offline fixture cannot retain or move funds.

Passing this fixture proves only local source/build reproduction plus deterministic pack and validation for the exact
inputs. The embedded profile is the live revision 3 profile with `productionLaunchAuthorized: true`; that flag does
not turn this deliberately reverting rehearsal initializer into an approved or submitted launch. This fixture is not
admission, deployment, a usable liquidity initializer, a wallet transaction, or a launched coin.

## Install, build, pack, validate

Use Node.js 24.14 or newer. From a neutral temporary directory, locate a locally installed copy of
`@programmable/launch`, then copy only this example:

```sh
PACKAGE_ROOT="$(npm root --global)/@programmable/launch"
cp -R "$PACKAGE_ROOT/examples/direct-native-v3-no-broadcast/project" ./direct-native-v3-clean-room
cd ./direct-native-v3-clean-room
npm ci --ignore-scripts --no-audit --no-fund
```

Bind public preparation inputs. `PROGRAMMABLE_SOURCE_REVISION` must be the exact public 40-character Git commit that
contains these source bytes. The nonce is public launch input, not a private key.

```sh
export PROGRAMMABLE_LAUNCH_WALLET="0x1111111111111111111111111111111111111111"
export PROGRAMMABLE_SOURCE_REVISION="EXACT_40_CHARACTER_PUBLIC_GIT_COMMIT"
export PROGRAMMABLE_LAUNCH_NONCE="0x$(openssl rand -hex 32)"
export PROGRAMMABLE_TOKEN_NAME="No Broadcast V3 Token"
export PROGRAMMABLE_TOKEN_SYMBOL="NBV3"
export PROGRAMMABLE_PROJECT_DESCRIPTION="Deterministic no-broadcast V3 reference launch"
export PROGRAMMABLE_PROJECT_IMAGE_SOURCE_PATH="assets/project-logo.png"
export PROGRAMMABLE_PROJECT_IMAGE_URI="https://example.com/project-logo.png"
export PROGRAMMABLE_WEBSITE_URL="https://example.com/"
export PROGRAMMABLE_X_URL="https://x.com/example_project"
npm run build

programmable-launch pack \
  --config programmable-launch.config.json \
  --output launch.json
programmable-launch validate launch.json \
  --config programmable-launch.config.json
```

`build-and-configure.mjs` fails closed unless the canonical hook, factory, dependency lock, compiler version, and
compiler settings match the frozen profile. It recursively embeds every imported dependency source into one exact
Standard JSON compilation unit. The build invokes only `project/node_modules/.bin/solcjs`, installed at exact version
0.8.26 by the frozen project lock; it does not resolve a parent-worktree compiler or a global `solc`. It never accepts
or writes a derived hash supplied by the operator.

The builder emits required `programmable.project-metadata-input.v1` and fails before compilation unless a real local
image plus its public URI, one website, and one canonical X profile are supplied. Place the project-owned image at the
declared relative path before running the example. A real integration must ask the owner for the exact public name,
symbol, description, image choice, website, and X profile rather than reuse fixture text or invent missing values.
Discord and Telegram remain optional. `npm run build -- --help` lists every bound field.

The default market is native ETH against the minted fixture token (`quoteCurrency` is the v4 native zero address),
with LP fee `3000` and tick spacing `60`. Mainnet USDC is independently fixed as the funding token. Optional public
environment overrides are documented by `npm run build -- --help`; selected buy/sell totals remain within
`0..999999`. The live revision 3 profile supports the v4 dynamic-fee sentinel, but this fixed-fee reference fixture
intentionally does not select it.

Run `pack` promptly after `build`: the generated unsigned funding descriptor uses a fresh, at-most-one-hour validity
window. Re-run `npm run build` to refresh an expired window. The packed request contains the nine-field unsigned
EIP-3009 descriptor and a v2 authorization-patch descriptor. The unsigned initializer has zero nonce, `r`, `s`, and
`v` leaves; those four leaves are patched only after the launch intent and funding nonce exist. It never contains a
wallet signature during pack or validate.

## Optional API submit: stop at the unsigned challenge

The optional wrapper is intentionally one-shot. If and only if the V3 backend route is available, it submits the exact
unsigned request and accepts only `awaiting_funding_authorization`. It never calls a wallet provider, submits a funding
signature, requests the Router transaction, polls status, or broadcasts. A transient `503` is not launch evidence and
must be retried only with the same journaled bytes and idempotency key after `Retry-After`.

Keep the API key in the encrypted `PROGRAMMABLE_API_KEY` environment secret or supported OS secret store. Never put
the key in a config, command argument, log, or chat.

```sh
export PROGRAMMABLE_IDEMPOTENCY_KEY="direct-native-v3-clean-room-0001"
npm run submit:unsigned-challenge
```

The wrapper exits nonzero if the response is anything other than the unsigned funding-review stage. Stop there. Do
not sign the funding authorization for this fixture: its initializer is deliberately non-executable and there is no
broadcast path in this project.

## Generated files and boundary

`npm run build` generates `standard-json/direct-native-v3.json`, three compiler artifacts,
`evidence/rehearsal.json`, and `programmable-launch.config.json`. `pack` adds `launch.json` and its receipt. Generated
files, local API journal state, and `node_modules` are ignored by Git.

No file in this project contains a private key, wallet signature, API key, permit, Router transaction, RPC call, or
`eth_sendTransaction`/`eth_sendRawTransaction` path.
