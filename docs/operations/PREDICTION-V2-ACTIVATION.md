# Prediction V2 activation boundary

Protocol V2 is release-dark. The checked-in public release envelope is
`disabled`, the production Ed25519 trust root is unset, the legacy V2 route
guard remains disabled, and no Protocol V2 deployment is assumed by the
application.

## First releasable scope

- Settlement and trading are on Robinhood Chain (chain ID 4663).
- The first enabled Registry policy is BTC/USD only.
- Settlement is `USD price >= strike` at the displayed UTC observation time.
- The winning price is the last completed Chainlink round at or before the
  observation time. The first completed round after it proves adjacency.
- A round more than 25 hours before, or more than 25 hours after, produces an
  `INVALID` result rather than YES or NO.
- Market creation is creator-funded with exactly 2 USDG bootstrap collateral.
  SponsorVault remains disabled for the first release.
- The canonical Router fee is 10 bps in USDG, the v4 LP fee is 2 bps in outcome
  tokens, and the creator fee is zero.

Search and display may support other token identities. That does not make an
asset eligible for settlement. Every additional asset requires its own active,
release-bound Registry and Oracle policy.

## Required activation evidence

Activation requires one immutable contract source commit and tree plus all of
the following against that exact revision:

1. Independent contract review and complete source, fuzz, invariant, v4,
   Oracle, fee-bypass and deployment checks.
2. Final deployment signer, admin, Registry owner, treasury, fee recipient,
   bootstrap reserve and exposure caps.
3. One production-capable, server-only Robinhood settlement RPC that supports
   historical EIP-1898 reads at the fixed three-confirmation policy. Its
   provider, vendor, full endpoint, endpoint-origin and batch-mode commitments
   must exactly match the signed public release.
4. A durable shared atomic budget backend for provider, action and client
   limits. The in-memory adapter is test-only and can never make the release
   production-ready.
5. Exact deployment receipts, runtime hashes, immutable and one-time binding
   readback, source verification and Registry/Oracle evidence.
6. Mainnet lifecycle evidence for create, buy, sell, cutoff, FINAL,
   proof-based INVALID, soft INVALID, hard-fallback INVALID, redemption, fees
   and Registry deactivation. Local and fork tests never count as live evidence.
7. Wallet preparation that binds chain, release, confirmed block, market,
   account, target, action and the client-owned hash of the exact calldata.
8. Desktop, mobile, provider-failure and wallet-failure application checks.
9. A secret-manager-backed random asset-logo capability key and revocable key
   epoch. Issuance is limited to the exact provider image id in a verified
   discovery result and HMAC-bound to the verified Ed25519 release payload.
   Tokens expire after five to ten minutes with at most 30 seconds of clock
   skew. A public capability URL is not a rate limit.

## Activation order

1. Freeze and independently review the contract source.
2. Deploy the shared core without enabling an asset or public application
   route.
3. Verify every deployed runtime and one-time binding through the committed
   settlement RPC and public source readback.
4. Activate one BTC/USD Registry policy and run the complete Mainnet canary
   lifecycle.
5. Produce and independently sign the closed public release envelope.
6. Configure the shared budget backend and server-only provider commitments.
7. Configure the logo capability key/epoch and prove exact signed-release
   binding, bounded expiry, key-epoch revocation, and that missing or malformed
   optional capability data falls back without hiding a verified asset.
8. In a separate reviewed application change, replace the legacy disabled
   route guard with the signed V2 release gate and wire the read, quote,
   lifecycle and wallet-preparation routes.
9. Promote only after the production URL passes the same release and runtime
   readback checks.

Any missing or mismatched gate keeps the public routes at 404 and transaction
preparation unavailable. A successful build, local test, deployment receipt,
HTTP 200 response or wallet simulation is not by itself activation evidence.

## Single-provider trust boundary

The release-bound settlement RPC is only the application read and transaction-
preparation dependency. Chainlink proofs and the deployed onchain contracts
remain the settlement authority.

One RPC removes independent provider comparison. An outage is unavailable, and
a provider that consistently presents one false canonical view cannot be
independently detected by this application. Missing, stale, reorged or
internally inconsistent canonical reads fail closed; the application does not
silently fall back to an uncommitted endpoint. This trade-off can produce a
closed or misleading application view, failed transactions or wasted gas, but
it cannot change the release-bound contract targets or Chainlink settlement
rules.
