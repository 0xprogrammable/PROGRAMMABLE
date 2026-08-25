# No-broadcast clean-room example

This example uses real Solidity 0.8.26 sources, exact Standard JSON input and matching compiler artifacts. It derives a
wallet-specific request and provides separate commands that can submit it to the production API and stop at
`authorized`. It must never be signed or broadcast. It creates no Mainnet coin.

After installing the pinned CLI release, copy only the immutable project files into a clean directory:

```sh
PACKAGE_ROOT="$(npm root --global)/@programmable/launch"
cp -R "$PACKAGE_ROOT/examples/no-broadcast/project" ./programmable-no-broadcast
```

Set public, non-secret preparation inputs. Use the controller address bound to the API key and the exact commit behind
the release tag. Choose a fresh nonzero nonce for this one rehearsal.

```sh
export PROGRAMMABLE_LAUNCH_WALLET="0x..."
export PROGRAMMABLE_SOURCE_REVISION="$(
  git ls-remote https://github.com/0xprogrammable/PROGRAMMABLE.git \
    refs/tags/programmable-launch-v1.0.1 \
    'refs/tags/programmable-launch-v1.0.1^{}' |
  tail -n 1 | cut -f 1
)"
export PROGRAMMABLE_LAUNCH_NONCE="0x$(openssl rand -hex 32)"

node "$PACKAGE_ROOT/examples/no-broadcast/prepare-config.mjs" \
  ./programmable-no-broadcast
```

`prepare-config.mjs` writes only pre-submit evidence. Its `scope` records `submit: false`, `status: false` and
`stopAt: "pre-submit"`; it does not claim that any authenticated API action has happened. Preserve the later command
output and request UUID separately if you perform the authenticated steps.

The generated config uses `deterministic-hook-permission-grind-v1`. Its real no-op hook implements the PoolManager-only
`afterInitialize` callback and declares that one permission, so it is a valid static-fee v4 hook. `pack` tries salts in
unsigned integer order from `start` and chooses the first predicted address whose low 14 bits equal that declaration.
The source bundle, wallet and nonce are fixed before the search. The chosen salt appears in `launch.json` and its receipt.

Run the offline gates twice to prove reproducibility:

```sh
cd programmable-no-broadcast
programmable-launch pack \
  --config programmable-launch.config.json \
  --output launch.json
programmable-launch validate launch.json \
  --config programmable-launch.config.json
```

Inject the API key through the encrypted environment or OS secret store. Do not paste it into this file, a prompt, chat
or shell history. Then use the config-bound submit path and poll one resource:

```sh
programmable-launch submit launch.json \
  --config programmable-launch.config.json
programmable-launch status REQUEST_UUID --watch --until authorized
```

Stop at `authorized`. Record the request UUID and confirm that the response contains a wallet transaction for separate
review, but do not sign and do not call `eth_sendTransaction`. The generated `evidence/rehearsal.json` proves only the
inspected build inputs before `pack`. The command output and API resource are the separate evidence for any packaging,
validation, idempotent submission or status polling that is actually performed.
