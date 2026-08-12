---
description: Reproduce Programmable launch provenance from the public manifest and Ethereum
---

# Verify a launch

Router verification begins with the live manifest and ends with direct reads at one canonical block. The hosted launch feed is useful for discovery but is not the trust root.

## Resolve the deployment

Fetch `https://developers.programmable.family/api/v2/manifest`, require Ethereum chain id `1`, and require the `launchStampRouter` entry to be live. Verify the Router runtime hash and ABI SHA 256 before using the published event descriptors or getter selectors.

## Read the launch identity

Backfill Router events from the manifest start block and follow new blocks with the published finality policy. Extract the launch id, token, hook, PoolManager and pool id, then cross check the appropriate point lookup and read `launchStamp` and `stampProof` at the same canonical block.

The token lookup is the primary interoperable path for a token page. Pool identity is the stronger route for trading integrations. Component lookup can confirm an exclusive component but should not be used to identify one launch when the component is shared infrastructure.

## Preserve the boundary

Only assign a Programmable Classic or Programmable Custom label when the Router identity, runtime, record and proof agree. Unknown, zero or inconsistent values should remain unlabelled rather than being forced into a familiar category.

A valid result proves canonical Router provenance. It does not prove present liquidity, audit status, sellability, quoting support or price quality.

The complete implementation reference and conformance fixtures live in the [0xprogrammable developers repository](https://github.com/0xprogrammable/developers).
