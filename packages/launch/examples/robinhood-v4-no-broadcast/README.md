# Robinhood V4 fee-gate no-broadcast clean room

This negative example compiles three real Solidity targets with exact `solc` 0.8.26 and prepares a
`programmable.launch-pack-config.v4` file for chain `4663`. It never embeds planned Programmable deployment
addresses. At build time it fetches the unauthenticated production V4 capabilities document and copies the exact
chain-deployment descriptor and integer-revision profile reference into the generated config. It fails closed while
that route, any required trust root, the finality digest, or the production profile digest is unavailable.

The request declares funding mode `none`, value `0`, an uninitialized empty pool, and no liquidity action. The hook
authenticates `beforeSwap` calls against the capabilities-bound PoolManager. It deliberately has no canonical
Programmable fee component, so V4 `pack` and `validate` must reject it with
`ROBINHOOD_V4_CANONICAL_FEE_PROFILE_UNAVAILABLE`. This fixture does not claim a fee, claiming, liquidity, deployment,
or launched-token outcome. A successful local build is not API admission, wallet approval, onchain deployment, or
public availability.

## Prepare

Use Node.js 24.14 and an exact reviewed checkout containing this clean-room example. Package version `4.0.0` is an
unreleased source candidate, not a published or publicly installable release, and its release binding remains
`releaseReady: false`. Copy the project from that checkout, then install its exact compiler lock:

```sh
PACKAGE_ROOT="/absolute/path/to/exact-reviewed-checkout/packages/launch"
cp -R "$PACKAGE_ROOT/examples/robinhood-v4-no-broadcast/project" ./robinhood-v4-clean-room
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

## Confirm the fail-closed package gate

```sh
programmable-launch pack \
  --config programmable-launch.config.json \
  --output launch.json \
  --receipt launch.receipt.json

# Independently, with any pre-existing V4 request and its exact pack config:
programmable-launch validate existing-v4-launch.json \
  --config programmable-launch.config.json
```

The first command must stop with `ROBINHOOD_V4_CANONICAL_FEE_PROFILE_UNAVAILABLE` and therefore does not produce
`launch.json`. The second command is a separate example for a V4 request produced before this gate; it stops with the
same code and does not reach remote preflight. No environment variable, API response, pack config or client-supplied
graph can open the gate. Do not edit the generated chain deployment or profile to bypass it. Positive packaging
remains disabled until the reviewed canonical profile and deployed non-bypassable fee path are available.

The four public CLI commands are `pack`, `validate`, `submit`, and `status`. This example stops at the local package
gate. It never calls `submit`, never reads an API key, never asks for a wallet signature, and never broadcasts a
transaction.
