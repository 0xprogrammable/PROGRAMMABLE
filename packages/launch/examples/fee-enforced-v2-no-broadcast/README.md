# Fee-enforced V2 no-broadcast clean room

This installed example compiles a real isolated custom module with exact solc 0.8.26, combines it with the package's
closed four-contract profile assets, then runs offline `pack` and `validate`. It does not submit, poll, sign, broadcast,
or create a Mainnet coin. Passing this offline rehearsal does not authenticate an API request or authorize a wallet
transaction.

From a neutral temporary directory, locate the installed package and copy the sample plus immutable profile assets:

```sh
PACKAGE_ROOT="$(npm root --global)/@programmable/launch"
cp -R "$PACKAGE_ROOT/examples/fee-enforced-v2-no-broadcast/project" ./fee-v2-clean-room
cp -R "$PACKAGE_ROOT/contracts/profile-v2" ./fee-v2-clean-room/profile-v2
cd fee-v2-clean-room
npm install --ignore-scripts --no-audit --no-fund
```

Bind only public preparation values. Use the exact release commit and a fresh nonce; no API key is needed for these
offline steps.

```sh
export PROGRAMMABLE_LAUNCH_WALLET="0x1111111111111111111111111111111111111111"
export PROGRAMMABLE_SOURCE_REVISION="EXACT_40_CHARACTER_RELEASE_COMMIT"
export PROGRAMMABLE_LAUNCH_NONCE="0x$(openssl rand -hex 32)"
npm run build

programmable-launch pack --config programmable-launch.config.json --output launch.json
programmable-launch validate launch.json --config programmable-launch.config.json
```

`build-and-configure.mjs` checks the exact compiler version, compiles the module, emits the real Standard JSON and
selected artifact, and records only pre-submit evidence. The evidence says `submit:false`, `status:false`,
`stopAt:"pre-submit"`, and `walletBroadcast:false`. A successful validation proves deterministic preparation only.

V2 creation is retired. The current CLI rejects a V2 `submit` locally, the server returns non-retryable
`409 CUSTOM_LAUNCH_V2_READ_ONLY`, and only historical V2 `status` reads remain available. To submit a new launch, build
the current V3.3 request instead. This example never calls `eth_sendTransaction`.
