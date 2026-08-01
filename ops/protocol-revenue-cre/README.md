# Protocol revenue workflow

This Chainlink CRE workflow schedules one Ethereum Mainnet protocol-revenue cycle at midnight UTC. It reads the `$V4`
main-pool tick from the last finalized block, encodes the chain selector, scheduled time and reference tick, then submits
the signed report to `ProtocolRevenueMetaMaskExecutorV1`.

The workflow does not choose recipients, percentages, tokens, fee sources or pools. Those values are immutable in the
router, executor and caveat enforcer. The onchain executor rejects the wrong forwarder, workflow owner, workflow name,
chain, timestamp or replay.

## Disabled release configuration

`workflow/config.production.json` is intentionally fail closed:

- `enabled` is `false`;
- `receiver` is the zero address;
- no secret or private key is present.

After the three contracts are deployed and source verified, replace `receiver` with the executor address and set
`enabled` to `true` in a reviewed release. The receiver is the executor, never the revenue wallet.

## Local checks

From `workflow/`:

```sh
npm run typecheck
npm test
npx --yes bun@1.3.14 node_modules/.bin/cre-compile main.ts /tmp/protocol-revenue-workflow.wasm
```

The current build uses `@chainlink/cre-sdk` 1.16.0 and Bun 1.3.14. Using the command and output path above, two builds
produce the same 3,791,885-byte artifact with SHA-256
`3ee59989c167675821338e8a7f68c6eb64ae7169ea7197bc316272f16ee88b2d`. The compiler embeds its output path, so a
different path changes the artifact hash.

The WASM file is ignored and is not deployment evidence. Production still requires CRE access, funding, deployment,
activation, a small Mainnet lifecycle and monitoring.
