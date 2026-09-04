# Robinhood V4 public API activation

`api-activation.json` starts with `proof: null`. The public manifest and root OpenAPI derive all three V4 and chain
4663 gates from the same projection. A missing, stale or inconsistent proof keeps `publicAuthorization`,
`publicWrites` and `releaseReady` false and exposes no installable CLI coordinate.

The activation scope is `api-until-wallet`: a protected, authenticated clean-room run reached the exact Router wallet
handoff and verified identical idempotent replay without signing or broadcasting. Onchain finality, source verification,
trading and public indexing remain separate. The manifest retains `indexingStatus: unproven`,
`canaryStatus: not-performed` and `externalIndexingGuaranteed: false`; API activation supplies none of those proofs.

The prerequisite sequence is the existing fresh backend promotion, automatic finalizer, reviewed complete release
binding, protected production verification, owner immutable-release preflight, official immutable CLI release, and
reviewed `clean-room-release-coordinate.json`. Dispatch the existing clean-room workflow from protected production
only after those prerequisites pass. The successful evidence is verified and attested in a separate job that receives
no production environment or API credential. Recovery receipts remain distinct and cannot activate discovery.

Select the exact successful run and its `programmable-launch-v4-clean-room-evidence-attestation-RUN-1` artifact.
Download only that public two-file archive. From a clean, complete checkout of the same protected production source,
run the generator with its exact run ID, artifact ID and GitHub archive digest:

```sh
node scripts/programmable-v4-api-activation.mjs generate \
  --repository-root "$REVIEWED_CHECKOUT" \
  --run-id "$SUCCESS_RUN_ID" \
  --artifact-id "$SUCCESS_ARTIFACT_ID" \
  --artifact-digest "$SUCCESS_ARTIFACT_DIGEST" \
  --archive "$SUCCESS_ARCHIVE" \
  --output-directory "$NEW_EXTERNAL_OUTPUT_DIRECTORY"
```

The generator validates archive contents and digest, exact successful owner-run GitHub provenance, hosted OIDC
attestation identity and subject bytes, protected workflow and runner source, immutable release assets and tag, exact
release binding, reviewed release coordinate, chain deployment, profile, wallet target, zero transaction value and
replay/no-broadcast evidence. Output is generated outside the checkout; never hand-author proof fields.

Review and commit exactly the generated activation record and two canonical success-evidence files through the
normal protected production PR. `Verify` replays authentication of the imported proof with read-only GitHub
permissions. Artifact retention controls downloads, not the lifetime of already imported cryptographic evidence.
Changing release binding, coordinate, workflow or runner requires a corresponding new valid proof; do not relabel a
recovery receipt or a local test fixture as successful release evidence.

After production deployment, verify the canonical live manifest, root OpenAPI, raw agent guide and API-key flow.
A local projection or successful CI build alone does not prove deployed public availability.
