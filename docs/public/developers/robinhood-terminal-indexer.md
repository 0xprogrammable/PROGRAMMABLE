---
description: Verify and index stamped Custom launches by any developer on Robinhood Chain
---

# Robinhood terminal integration

Identify Programmable Custom tokens on Robinhood Chain Mainnet (`4663`, `eip155:4663`) using the canonical Router's finalized launch stamps. This reference covers token classification and continuous indexing.

Read the [chain manifest (JSON)](https://developers.programmable.family/api/v2/manifests/4663) for current direct-chain availability and deployment evidence. Hosted-feed availability and public V4 write activation have separate release states.

## Verify a token

Requirements: Node.js 20 or later and a Robinhood RPC that supports finalized, historical block-hash reads. No Programmable API key or package installation is required. The public RPC below works for the example; use your own provider for production indexing.

Clone the repository and verify the existing launch referenced by the manifest:

```sh
git clone https://github.com/programmablehq/Developers.git
cd Developers
PROGRAMMABLE_RPC_URL=https://rpc-robinhood.blockmachine.io \
  node examples/verify-robinhood-release.mjs
```

To verify another token, replace `<token-address>` with its address:

```sh
PROGRAMMABLE_CHAIN_ID=4663 \
PROGRAMMABLE_RPC_URL=https://rpc-robinhood.blockmachine.io \
  node examples/verify-launch-stamp.mjs token '<token-address>'
```

The verifier returns JSON. A verified token has `state: "stamped"`, `category: "custom"` and `publicLabel: "Programmable Custom"`. An RPC failure returns `indeterminate`; it does not mean the token is absent.

## Classification

Apply these fields only after the checks below succeed:

| Field | Value |
| --- | --- |
| `chainId` | `4663` |
| `platformId` | `programmable` |
| `category` | `custom` |
| `publicLabel` | `Programmable Custom` |
| Launch kind | `CustomGraph = 1` |

The same rule applies to existing and future stamped launches by any developer. Hook code, permissions and token behavior may differ. No per-token, creator or hook allowlist is needed for classification.

A token name, hook address, pool, provider label or API response alone is insufficient. A deployment without a valid canonical Router stamp does not qualify.

## Index launches

1. Fetch [platform discovery](https://developers.programmable.family/.well-known/programmable.json). Select `chains[]` where `chainId` is `4663`, then fetch that entry's `manifestUrl`.
2. Validate the manifest against the [V2 manifest schema](https://developers.programmable.family/schemas/v2/manifest.schema.json). Require `chainId: 4663`, `caip2: "eip155:4663"`, `directChainIntegration.status: "live"` and `launchStampRouter.status: "live"`. Resolve the Router address, `startBlock`, ABI, runtime hash, bindings and finality policy from this manifest. Do not hardcode deployment addresses.
3. Fetch the Router's `abiUrl` and check its bytes against `abiSha256`. Verify the Router runtime and immutable bindings through your RPC. Check its finalized deployment evidence and the existing finalized launch referenced by the manifest. The [Router reference](https://github.com/programmablehq/Developers/blob/main/docs/reference/launch-stamp.md) specifies these checks.
4. Read `eth_getLogs` in bounded ranges from `startBlock` through the canonical finalized block. Filter by the exact Router address and the manifest's published event topics. The same topic emitted by another address is not a Programmable stamp.
5. For each launch, read the token or pool lookup and `launchStamp` at the same canonical finalized block. Require a nonzero launch ID and `CustomGraph = 1`. For a token or component address, also verify `stampProof`. Match the launch ID, token, hook, PoolManager, pool ID and stamp hash across the event and getter records. Verify the route and component runtime bindings described in the Router reference.
6. Deduplicate logs by chain ID, block hash, transaction hash and log index. Save a range checkpoint only after the whole range verifies. Reduce the range and retry when a provider limits a query; do not skip the failed range.
7. Continue from the saved checkpoint and refresh the manifest. Honor each Router's start and end block. On a canonical block-hash mismatch, rewind affected records and reprocess them. Keep recognized tokens visible even if metadata, charts or trading support are unavailable.

Use the RPC `finalized` boundary and pin the block hash for all reads. An explicit block must be a canonical ancestor at or below that boundary. A number of head confirmations or a `latest` read is not a substitute. If the provider cannot serve the required state, leave verification indeterminate and retry with a suitable provider.

The Router launch ID is `bytes32`. An API request UUID is a separate identifier; do not join records by treating them as interchangeable.

## Verification results

| Result | Meaning and action |
| --- | --- |
| `stamped` | The canonical Router record and required proofs agree. Apply the classification above. |
| `not-stamped` | A successful canonical lookup returned a zero launch ID. Do not assign the Programmable label from this Router lookup. |
| `indeterminate` | A required read or check could not be completed. Retry; do not interpret the result as absence. |
| `unavailable` | The manifest does not provide usable Router release roots. Wait for a supported release state. |

Empty or unavailable hosted feeds are not proof that no launches exist. Index the canonical chain records for this integration.

## Reference files

For metadata from the separate API feed, use the [Robinhood finalized feed reference](reference/robinhood-finalized-feed.md).
It specifies that feed's OpenAPI, pagination, finality and source-verification requirements.

| Resource | Location |
| --- | --- |
| Discovery | [/.well-known/programmable.json](https://developers.programmable.family/.well-known/programmable.json) |
| Robinhood manifest (JSON) | [/api/v2/manifests/4663](https://developers.programmable.family/api/v2/manifests/4663) |
| Chain status | [/api/v2/status?chainId=4663](https://developers.programmable.family/api/v2/status?chainId=4663) |
| Router ABI | [/abis/programmable-launch-stamp-router-v1.json](https://developers.programmable.family/abis/programmable-launch-stamp-router-v1.json) |
| Finalized deployment and launch evidence | [/deployments/robinhood-direct-chain-evidence-v1.json](https://developers.programmable.family/deployments/robinhood-direct-chain-evidence-v1.json) |
| Read API OpenAPI | [/openapi/programmable-v2.yaml](https://developers.programmable.family/openapi/programmable-v2.yaml) |
| Direct-chain schema | [/schemas/v2/direct-chain-integration.schema.json](https://developers.programmable.family/schemas/v2/direct-chain-integration.schema.json) |
| Router verification specification | [docs/reference/launch-stamp.md](https://github.com/programmablehq/Developers/blob/main/docs/reference/launch-stamp.md) |
| Terminal data contract | [docs/guides/terminals-and-scanners.md](https://github.com/programmablehq/Developers/blob/main/docs/guides/terminals-and-scanners.md) |
| Verifier source | [examples/verify-launch-stamp.mjs](https://github.com/programmablehq/Developers/blob/main/examples/verify-launch-stamp.mjs) |

## Scope

The stamp establishes launch provenance. It does not establish an audit, safety, liquidity, sellability, trading support, current pool state or a particular fee. A terminal must assess execution support for each market separately.

This integration reads chain data. It does not submit or sign launches, and it does not depend on the hosted indexer or public V4 submission API. Machine clients can read the [canonical guide as Markdown](https://developers.programmable.family/robinhood-terminal-indexer.md).
