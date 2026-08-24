# Prediction V2 public view boundary

Prediction V2 has two deliberately separate display layers.

1. The base market view is reconstructed from the application-pinned release,
   its release-bound Robinhood settlement RPC, the Factory record, Registry
   snapshot, checkpoint and v4 pool state at one confirmed block. It is
   sufficient to keep an existing market visible with its canonical symbol,
   condition, lifecycle, probability and bundled fallback artwork.
2. Optional presentation enrichment supplies a name, owned logo snapshot,
   social links and creation-time display context. It must be signed by the
   release-pinned presentation attestor and match the base market's release,
   Factory, runtime hash, economic key, market id, Registry revision and
   confirmed block exactly.

Enrichment is display-only. It never selects a token identity, price source,
settlement rule, contract target, spender, quote, permit or transaction.
Invalid, stale, unavailable or revoked enrichment is dropped without hiding
the canonical base market.

During creation only, verified discovery may carry a server-issued
`{assetId, capability}` pair for the internal logo proxy. The raw provider
image URL stays server-private and is removed from the discovery wire profile.
The HMAC binds the asset id to the exact verified signed release payload, a
revocable key epoch and an explicit short expiry. Malformed optional projection
data becomes a bundled fallback; it never invalidates an independently verified
candidate. Only the immutable asset id may enter an append-only presentation
record, never the capability. Public market cards use content-addressed owned
artwork or a bundled fallback and never depend on the provider proxy.

The public route remains disabled until the separate Protocol V2 release,
settlement-RPC, deployment-readback, lifecycle-canary and wallet gates pass.
The RPC only supplies application reads and transaction preparation; Chainlink
proofs and the onchain contracts remain settlement authority. An unavailable
or internally inconsistent canonical read fails closed without automatic
fallback. With one provider, a consistently false canonical view cannot be
independently detected by the application.
