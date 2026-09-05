---
description: Verify a first Programmable launch or read the Ethereum launch feed
---

# Quickstart

Both examples are read only. They require no Programmable API key or wallet.

## Verify a Robinhood launch

Use Node.js 20 or later and an RPC that supports finalized, historical block-hash reads. No package installation is
required for this example.

```sh
git clone https://github.com/programmablehq/Developers.git
cd Developers
PROGRAMMABLE_RPC_URL=https://rpc-robinhood.blockmachine.io \
  node examples/verify-robinhood-release.mjs
```

The verifier discovers the chain manifest and checks the existing finalized launch referenced by its evidence. A
successful result includes:

```json
{
  "state": "stamped",
  "category": "custom",
  "publicLabel": "Programmable Custom"
}
```

This is a result excerpt. An incomplete RPC read or failed cross-check returns `indeterminate`. It does not mean the
token is absent. Use a suitable RPC and retry; never replace finalized reads with `latest`.

To check another token, follow [Verify a launch](verify.md). For continuous indexing and future Custom hooks, use the
[Robinhood terminal integration](robinhood-terminal-indexer.md).

## Read the Ethereum feed

Fetch discovery, the chain manifest and current status, then read the first page:

```sh
curl -fsSL https://developers.programmable.family/.well-known/programmable.json
curl -fsSL https://developers.programmable.family/api/v2/manifests/1
curl -fsSL 'https://developers.programmable.family/api/v2/status?chainId=1'
curl -fsSL 'https://developers.programmable.family/api/v2/launches?chainId=1&limit=25'
```

The feed returns `status`, `snapshot`, `items` and `page`. Keep recognized launches even when optional metadata or
markets are unavailable. HTTP `200` alone does not establish complete coverage.

1. Process every `items` record.
2. Follow `page.nextCursor` while `page.hasMore` is true, preserving chain and filters.
3. Persist `page.resumeCursor` only after the traversal and records are durably committed.
4. Use that resume cursor as `after` for the next incremental poll.

The [hosted feed reference](https://github.com/programmablehq/Developers/blob/main/docs/reference/hosted-feed.md)
contains the complete algorithm, retries and recovery rules. See [Index launches](indexing.md) before production use.

## Prepare a launch

Launching uses the separate [Custom Launch API](custom-launch.md), its live discovery and a scoped credential. The
controller wallet reviews, signs and broadcasts separately. The read examples above do not launch a token.
