---
description: Official Programmable product, source, community and analytics links
---

# Official links

| Resource                | Link                                                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Website                 | [programmable.market](https://programmable.market)                                                                 |
| Create                  | [programmable.market/launch](https://programmable.market/launch)                                                   |
| Explore                 | [programmable.market/explore](https://programmable.market/explore)                                                 |
| GitHub                  | [github.com/programmablehq](https://github.com/programmablehq)                                                     |
| Custom Launch API keys  | [programmable.market/developers/api-keys](https://programmable.market/developers/api-keys)                         |
| Custom Launch API guide | [programmable.market/developers/custom-launch-api-v1.md](https://programmable.market/developers/custom-launch-api-v1.md) |
| Custom Launch V1 OpenAPI | [live reads and write fence](https://programmable.market/openapi/custom-launch-v1.json)                    |
| Custom Launch V2 OpenAPI | [V2 reads, schemas and write fence](https://programmable.market/openapi/custom-launch-v2.json)                     |
| Custom Launch V3 OpenAPI | [preparatory profile 3.4 contract; live/default remains discovery-bound profile 3.3](https://programmable.market/openapi/custom-launch-v3.json) |
| Custom Launch V4 OpenAPI | [planned Robinhood Chain contract; public writes disabled](https://programmable.market/openapi/custom-launch-v4.json) |
| Custom Launch V4 schema | [planned Robinhood Chain pack config](https://programmable.market/schemas/custom-launch/v4/pack-config.json) |
| Custom Launch API      | [api.programmable.market](https://api.programmable.market)                                                         |
| Custom API readiness    | [api.programmable.market/readyz](https://api.programmable.market/readyz)                                           |
| Custom Launch CLI 3.3.9 | [public V3 GitHub Release asset](https://github.com/programmablehq/PROGRAMMABLE/releases/download/programmable-launch-v3.3.9/programmable-launch-3.3.9.tgz) |
| Custom Launch CLI 1.0.1 | [V1 compatibility asset](https://github.com/programmablehq/PROGRAMMABLE/releases/download/programmable-launch-v1.0.1/programmable-launch-1.0.1.tgz) |
| Launch policy           | [github.com/programmablehq/Launch-Policy](https://github.com/programmablehq/Launch-Policy)                         |
| Read-only developer API | [developers.programmable.family](https://developers.programmable.family)                                           |
| X                       | [x.com/ProgrammableHQ](https://x.com/ProgrammableHQ)                                                               |
| Discord                 | [discord.com/invite/programmable](https://discord.com/invite/programmable)                                         |
| Dune                    | [Programmable analytics](https://dune.com/0xprogrammable6098/programmable-analytics)                               |
| V4 token                | [Dexscreener](https://dexscreener.com/ethereum/0xd9ca22573437a06a12d5c757b151aa1a76265c1dfdde4b76507233d7ad2b6df0) |

Use `api.programmable.market` for authenticated public V3 general-hook creation and exact-credential-principal lifecycle reads with wallet keys, partner roots or bounded partner subkeys. The
default profile is revision 3 with `profileVersion: 3.3.0`; it requires and binds canonical project metadata, including
an exact source-bound image, into the launch hashes. Exact `3.2.0`, `3.1.0` and `3.0.0` requests remain readable and byte-identical retryable under their original immutable policies,
and revision 2 remains compatible. CLI `3.3.9` defaults to live profile `3.3.0`; explicit profile `3.4.0` output remains
preparatory and is rejected by live capabilities until backend activation. V2 and V1 history and schemas remain readable, while fresh creation returns
non-retryable `409 CUSTOM_LAUNCH_V2_READ_ONLY` and `409 CUSTOM_LAUNCH_V1_READ_ONLY`; only V3.3 accepts new submissions.
Legacy Registry and GitHub submission intake is closed. Use the read-only
developer service and current deployment manifest when verifying Ethereum source or deployment data. Community posts
and analytics are useful context but do not replace the contract address, canonical chain record or versioned release evidence.

Robinhood Chain V4 remains planned and not deployed. Its stable V4 links are integration pointers, not evidence that
writes, deployed trust roots, trading, generic fee claiming, buyback management or external indexing are live. API-key
handoff uses only `$PROGRAMMABLE_API_KEY`, while wallet authorization remains separate and server-selected policy
profiles cannot be chosen by clients.
