# Manual Applicant launch v1

This lane lets an approved Hookbuilder Applicant execute exactly one prepared
Router transaction from the Ethereum wallet named in the approved GitHub pull
request. It is independent of legacy Custom Launch and is disabled unless
`PROGRAMMABLE_MANUAL_APPLICANT_LAUNCH_ENABLED=true` is present in the protected
production environment and deployment dispatch.

## Applicant flow

1. The Website authenticates both Privy tokens, re-reads the current Privy user,
   binds the one numeric GitHub subject, and requires the exact linked EIP-55
   Ethereum wallet from the approved pull request.
2. Approved artifacts load automatically. There is no JSON/file import or
   public artifact-list endpoint.
3. Immediately before opening the wallet, the browser re-resolves the launch
   through the server's dual-RPC clock and requires the same subject,
   descriptor, preparation, exact Router action, and linked wallet with at
   least 120 seconds of verified send window remaining.
4. The browser persists `wallet-prompt-opened` before opening the wallet and
   persists the returned transaction hash synchronously before any network
   request. Pending nonce values are diagnostic only and never authorize a
   send or retry.
5. The Applicant wallet submits the one Router transaction. The Website never
   sends from an operator or developer wallet.
   During this beta, never speed up or replace a submitted transaction; recover
   and verify only the exact original transaction hash.
6. Both the browser and the private scheduled worker can converge on the same
   dual-provider finality proof. A one-provider result, an ambiguous result, or
   an unfinalized receipt fails closed.

## Signed publication and reissue

The signed-artifact endpoint has no operator secret and no unsigned reservation
phase. It deep-verifies the complete hash/calldata/GitHub/Safe/runtime/simulation
chain, reads the current private Applicant head and its provider ETag on the
server, writes immutable evidence, and performs one real Blob `If-Match`
transition. The request contains only `expectedPreviousPointerHash`; a provider
ETag is rejected anywhere in an artifact, Ceremony payload, or client request.
Concurrent different signed publishes have one winner.

Initial Ceremony preparation makes no Website call. Reissue uses a read-only
POST containing the exact previous complete signed artifact as possession
proof. Only a current artifact receives its own current pointer/index/status.
A stale artifact receives the fixed `stale_previous_artifact` response without
successor data. Ceremony never receives `OPS_BLOB_READ_WRITE_TOKEN`, a Privy
credential, or an operator secret.

The system cannot prevent a Safe owner from signing conflicting artifacts
outside the durable Ceremony workflow. That is an authority risk outside this
system boundary; Website CAS ensures conflicting artifacts cannot both become
the current Applicant head.

## Frozen cross-surface contract

- Hookbuilder Applicant 1.1 public main: commit
  `279dd2fc2ea8c488943ca4e60ca889cb00bab40e`, tree
  `48149d436bf222c440980e1fc31a71899b833af7`.
- Adapter manual-Router export: commit
  `d91d8e90af19acd61e9d46eeb652b418f4186f58`, tree
  `070dcbc016fe4c053d64e3b918e5afe728c8d02b`; portable bundle SHA-256
  `9f29b1d00ce602fa8673d7e96574933f1e29f46794718433242e1d5c3fe250f1`,
  closure SHA-256
  `8ab16787174763546439d421f704c03d17a7a5d9c091bb565ac7d1688e13bab0`,
  and Golden v6 SHA-256
  `5a50a7c9851d8c42332f4221a5410c56d40b9aee067d7ea4a343bcf334bea73a`.
- Exact Shards direct-profile compile input:
  `sha256:1d7c191dc3e16ba9967be76622b76269b6ac1673637212fab41594ff1665394a`;
  profile binding
  `sha256:ffba60e856fb210e11e8b22e27a319378887f99a328b3448fe069962965e98cd`.
- Ceremony contract: commit `9710b7a04363fd26c3eba3c0add2524353059b4d`,
  tree `8528dc6f98e52dfd033a3270c4f4cf94dffa5796`, manifest SHA-256
  `dbcf04360d433ed327901d4e68bed5af36e8424eaf2d20db84496fd8a83d5603`.
  Its publish request is exactly
  `{schemaVersion, expectedPreviousPointerHash, signedArtifact}` and has Golden
  semantic SHA-256
  `0c841a1b7a591b7c710505b4d8dfea2cb4bf20671793b2377c450981b0518711`.

The Website vendor manifest independently rebuilds and byte-compares the
Adapter bundle, source map, metafile, closure, schemas, and Golden before a
release can pass.

## Private finality and public discovery

Manual artifacts, Applicant heads, failed-transaction evidence, and finalized
proofs remain private in the existing OPS Blob store. The authenticated
`/api/ops/manual-router-finality` job resumes submitted transactions when the
browser is closed. It does not produce a public list, profile, or legacy
`WebsiteRecordV2` record.

Public Explore, feed, and profile visibility remains exclusively owned by the
canonical production Router scanner. It discovers the onchain launch stamp
after its existing 64-confirmation policy, which keeps every terminal and
indexer on the same public source of truth.

## Protected production environment

- `PROGRAMMABLE_MANUAL_APPLICANT_LAUNCH_ENABLED` (default `false`)
- `PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL`
- `PROGRAMMABLE_QUICKNODE_MAINNET_RPC_URL`
- existing `NEXT_PUBLIC_PRIVY_APP_ID` and `PRIVY_APP_SECRET`
- existing `OPS_BLOB_READ_WRITE_TOKEN`
- existing `CRON_SECRET`

The RPC names are exact and server-only. Alchemy must use
`eth-mainnet.g.alchemy.com`; QuickNode must use one or more subdomains under
`quiknode.pro`. Both require HTTPS, a non-root path, at most 2,048 trimmed
characters, and no credentials, non-default port, query, or fragment. Aliases,
missing providers, and provider-family swaps are rejected. Enabling this lane
does not enable or modify legacy Custom Launch.
