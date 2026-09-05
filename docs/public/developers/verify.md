---
description: Verify a token or pool through the canonical Router on Ethereum or Robinhood Chain
---

# Verify a launch

A Router stamp records a launch executed through the canonical Programmable Router. Verification uses the selected
chain's manifest and direct reads at one canonical finalized block. The hosted launch feed is optional.

## Select the chain

| Chain | Manifest |
| --- | --- |
| Ethereum · `1` | [Ethereum manifest](https://developers.programmable.family/api/v2/manifests/1) |
| Robinhood · `4663` | [Robinhood manifest](https://developers.programmable.family/api/v2/manifests/4663) |

Resolve `launchStampRouter`, its address, block range, runtime hash, ABI and evidence from the manifest. Validate those
bindings before decoding events. Use that chain's finality policy; do not copy Ethereum's confirmation count to Robinhood.

## Verify a token

From a clone of the [Developers repository](https://github.com/programmablehq/Developers), run the generic verifier with
Node.js 20 or later. Replace `<token-address>` with the token to check:

```sh
PROGRAMMABLE_CHAIN_ID=4663 \
PROGRAMMABLE_RPC_URL=https://rpc-robinhood.blockmachine.io \
  node examples/verify-launch-stamp.mjs token '<token-address>'
```

For Ethereum, select chain `1` and an Ethereum RPC. The [example directory](https://github.com/programmablehq/Developers/tree/main/examples)
also documents pool and exclusive-component lookups.

The verifier checks the canonical Router runtime and immutable bindings, reads `launchIdByToken` and `launchStamp`,
and cross-checks `stampProof` at the same canonical block.

| Result | Meaning |
| --- | --- |
| `stamped` | The record, proof and deployment bindings agree |
| `not-stamped` | A successful canonical lookup returned zero |
| `indeterminate` | Required reads or evidence are incomplete or inconsistent |
| `unavailable` | The Router or required activation data is unavailable for the requested block |

## Assign the label

A consistent `CustomGraph = 1` stamp maps to `Programmable Custom`. A consistent `Classic = 2` stamp maps to
`Programmable Classic`. A shared Classic hook cannot identify a launch. Use token or pool lookup; component lookup is
only suitable for a recorded exclusive component.

Existing and future stamped Custom launches use the same verification, regardless of the developer or individual
hook address. Metadata cannot create a stamp. Router V1 does not backfill historical launches or direct factory calls
that bypassed it; historical launcher and Registry records use their separate documented verification paths.

A valid stamp proves provenance. It does not prove current liquidity, audit status, sellability, quoting support or
price quality.

The [complete Router reference](https://github.com/programmablehq/Developers/blob/main/docs/reference/launch-stamp.md)
defines the ABI, algorithm, finality and test vectors. The [Robinhood guide](robinhood-terminal-indexer.md) covers
continuous indexing on chain `4663`.
