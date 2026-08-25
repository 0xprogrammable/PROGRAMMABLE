# No-broadcast clean-room example

This retained V1 compatibility example uses real Solidity 0.8.26 sources, exact Standard JSON input and matching
compiler artifacts. It derives and validates a wallet-specific V1 request offline. New V1 submissions are read-only
fenced, so this rehearsal never submits, polls, signs, broadcasts, or creates a Mainnet coin.

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

Stop after `validate`. The generated `evidence/rehearsal.json` proves only the inspected build inputs before `pack`.
Calling V1 `submit` would return the non-retryable `CUSTOM_LAUNCH_V1_READ_ONLY`; this example does not present that as a
successful wallet handoff. Use the separate fee-enforced V2 no-broadcast example to exercise the held five-role RC
profile offline.
