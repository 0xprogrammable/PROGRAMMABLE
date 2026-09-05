---
description: Guides, examples and API references for integrating Programmable launches
---

# Developers

Verify and index Programmable launches on Ethereum and Robinhood Chain, or build an integration with the Custom
Launch API. Start with the guide for your task.

[Quickstart](quickstart.md) · [GitHub documentation](https://github.com/programmablehq/Developers) · [Examples](https://github.com/programmablehq/Developers/tree/main/examples)

## Choose a guide

| Task | Guide |
| --- | --- |
| Verify a token or pool | [Verify a launch](verify.md) |
| Add Programmable labels to a terminal | [Index launches](indexing.md) |
| Index existing and future Robinhood Custom launches | [Robinhood terminal integration](robinhood-terminal-indexer.md) |
| Prepare and track a launch through the API | [Custom Launch API](custom-launch.md) |
| Find endpoints, schemas and ABIs | [API reference](machine-readable.md) |

## Choose a chain

- **Ethereum (chain `1`):** Classic and Custom discovery, direct Router verification and the hosted Developer feed.
- **Robinhood (chain `4663`):** Direct Custom Router verification, with separate V4 metadata and launch API contracts.

Select the chain in [discovery](https://developers.programmable.family/.well-known/programmable.json), then fetch its
`manifestUrl` for deployment addresses, start blocks, runtime hashes and finality policy. Check status before relying
on a hosted feed.

The same Router verification applies to future stamped Custom launches by any developer. A new token or hook address
does not require a new allowlist. A terminal still needs to implement the integration before it displays a label.

## Read data or prepare a launch

The Developer API at `https://developers.programmable.family` is read only and requires no API key.
Use it for discovery, manifests and normalized launch records. Direct Router verification uses the selected chain's RPC.

The Custom Launch API at `https://api.programmable.market` accepts authenticated requests under its published
chain-specific policy. Use [live launch discovery](https://programmable.market/.well-known/programmable.json) to select
the API version and CLI release. For Robinhood, `publicWrites`, `publicAuthorization` and `releaseReady` must all be true
in the required discovery entries before authenticated preflight or submission. The [launch guide](custom-launch.md)
contains the exact checks, credentials, request lifecycle and wallet handoff.

An API key does not sign or broadcast. The controller wallet reviews and signs the exact transaction separately.

## Interpret a Programmable label

A canonical stamp establishes launch provenance. A terminal can display `Programmable Classic` or `Programmable Custom`
when the corresponding evidence verifies. Metadata, an API response or a familiar hook address cannot assign the label.

Keep provenance, finality, source verification, indexing and trading support separate. A stamp does not establish
current liquidity, fee behavior, an audit or sellability. Historical launches use their documented launcher or Registry
proofs; Router V1 does not stamp them retroactively.

## References

- [Complete documentation index](https://github.com/programmablehq/Developers/blob/main/docs/README.md)
- [Hosted feed integration](https://github.com/programmablehq/Developers/blob/main/docs/reference/hosted-feed.md)
- [Robinhood finalized metadata feed](reference/robinhood-finalized-feed.md)
- [Protocol fee claim discovery](reference/protocol-fee-claims.md)
- [Integration status](https://github.com/programmablehq/Developers/blob/main/docs/status.md)
- [Agent index](https://github.com/programmablehq/Developers/blob/main/llms.txt)

Each website documentation page is also available as Markdown by appending `.md` to its URL.
