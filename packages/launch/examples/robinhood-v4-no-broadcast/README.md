# Robinhood V4 funding-none no-broadcast clean room

This example compiles three real Solidity targets with exact `solc` 0.8.26 and prepares a
`programmable.launch-pack-config.v4` file for chain `4663`. It never hard-codes Programmable deployment
addresses. At build time it fetches the unauthenticated production V4 capabilities document and copies the exact
chain-deployment descriptor and integer-revision profile reference into the generated config. It fails closed while
that route, any required trust root, the finality digest, or the production profile digest is unavailable.

The request declares funding mode `none`, value `0`, an uninitialized empty pool, and no liquidity action. The hook
authenticates `beforeSwap` calls against the capabilities-bound immutable PoolManager. The build binds the compiler's
exact immutable reference to the same address passed to the constructor. This fixture does not claim a fee,
claiming, liquidity, deployment, or launched-token outcome. A successful local build, pack, or validation is not API
admission, wallet approval, onchain deployment, or public availability.

## Prepare

Use Node.js 24.14. For local preparation, use an exact reviewed checkout containing this example. For public use,
first follow the [V4 release checks](../../README.md#robinhood-chain-v4-release-checks) and use the extracted,
verified `@programmable/launch` `4.0.0` release package. A version number or local package is not release evidence.

**Blocked:** If either `customLaunchApi.versions.v4` or the matching `chains` entry in
[live discovery](https://programmable.market/.well-known/programmable.json) has `publicAuthorization: false`,
`publicWrites: false` or `releaseReady: false`, or required release evidence is missing, stop before authenticated
preflight or submission. `pending-public-discovery-promotion` permits no public-launch claim; an unpublished
pre-release source candidate supports local preparation only.

**Activated:** Only when both discovery entries have `publicAuthorization: true`, `publicWrites: true` and
`releaseReady: true`, verify the advertised published immutable GitHub Release `programmable-launch-v4.0.0` in
`programmablehq/PROGRAMMABLE`, its release manifest, exact source commit and tarball checksum against the downloaded package. If any check fails,
stop. This conditional procedure does not assert today's release state; this example still never submits,
signs or broadcasts.

Use the verified CLI with the project from the current reviewed protected checkout. The immutable `4.0.0` release
contains an older example with a mutable PoolManager; that example is rejected by production admission. The CLI
itself supports the corrected immutable binding. Set `PROJECT_SOURCE_ROOT` to the reviewed checkout, then copy
the corrected project and install its exact compiler lock:

```sh
PROJECT_SOURCE_ROOT="/absolute/path/to/reviewed-programmable-checkout"
cp -R "$PROJECT_SOURCE_ROOT/packages/launch/examples/robinhood-v4-no-broadcast/project" ./robinhood-v4-clean-room
cd ./robinhood-v4-clean-room
npm ci --ignore-scripts --no-audit --no-fund
mkdir -p assets
```

Supply only public preparation inputs. The nonce is public launch input, not a private key. The image must be a real
local PNG or single-frame GIF whose public URI belongs to the project; V4 rejects JPEG, WebP, and animated GIF. The source revision must be the exact public
40-character Git commit containing these source bytes.

```sh
export PROGRAMMABLE_LAUNCH_WALLET="0x1111111111111111111111111111111111111111"
export PROGRAMMABLE_LAUNCH_NONCE="0x$(openssl rand -hex 32)"
export PROGRAMMABLE_SOURCE_REVISION="EXACT_40_CHARACTER_PUBLIC_GIT_COMMIT"
export PROGRAMMABLE_PROJECT_IMAGE_SOURCE_PATH="assets/project-logo.png"
export PROGRAMMABLE_PROJECT_IMAGE_URI="https://example.com/project-logo.png"
export PROGRAMMABLE_WEBSITE_URL="https://example.com/"
export PROGRAMMABLE_X_URL="https://x.com/example_project"
npm run build
```

The builder deliberately refuses to run if `PROGRAMMABLE_API_KEY` is present. It makes one credential-free `GET` to
`https://api.programmable.market/v4/chains/4663/capabilities`, compiles locally, and writes only public build evidence
plus `programmable-launch.config.json`. It has no wallet provider, signing method, RPC call, broadcast method,
submission method, or API-origin override.

## Pack and validate locally

```sh
programmable-launch pack \
  --config programmable-launch.config.json \
  --output launch.json \
  --receipt launch.receipt.json

programmable-launch validate launch.json \
  --config programmable-launch.config.json
```

Run `build` again if the one-hour permit window expires or the public capabilities binding changes. Do not edit the
generated chain deployment or profile to bypass that change; generate a new config and pack new bytes.

The four public CLI commands are `pack`, `validate`, `submit`, and `status`. This example stops after local validation.
It never calls `submit`, never reads an API key, never asks for a wallet signature, and never broadcasts a transaction.
