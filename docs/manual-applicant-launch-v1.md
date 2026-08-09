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
  `d928f56218409f8511cec7ab43410b1bdfaa1450`, tree
  `f62326ae214669ef67eb2d43ff5700d6a19503c2`.
- Adapter manual-Router export: commit
  `a8bdd89e55d21aa10d9cc71da6bd5570e5ceb5ca`, tree
  `7f1ff90c88b9f0e9be21640aa59065f910b17e0a`; portable bundle SHA-256
  `0a7f85b0559d4cd3dab7431d92d487cc97239c6a3005f18bdb8cb92ea9163597`,
  closure SHA-256
  `f07c8fe06799f4e1981dba85c6f014a152ed5ed384001f565de8f08d0b347b07`,
  and Golden v6 SHA-256
  `abc0077b403c7db1ee370c6a478c37b1bda6cc84db473e4cf3e4451ac9658d09`.
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
