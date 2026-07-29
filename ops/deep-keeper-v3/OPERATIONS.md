# Deep keeper ops v2 operations

This runbook covers activation, monitoring and recovery. It does not authorize
a deployment, wallet creation, funding or transaction.

## Activation

1. Bind the contract release, keeper policy, reviewed binding, configured
   deployment commit and `VERCEL_GIT_COMMIT_SHA` to one reviewed 40-character
   commit.
2. Verify the exact build-time source commitment and run the full offline gate:

   ```sh
   node ops/deep-keeper-v3/verify-ops-v2-source-binding.mjs
   npm run contracts:deep-v3:verify:offline
   ```

3. Complete the separately approved Mainnet deployment.
4. Capture the six deployment receipts from two independent RPC providers.
   Verify all nine runtime hashes, exact transaction inputs and empty EIP-1967
   implementation, admin and beacon slots.
5. Record exact Etherscan verification and the Sourcify v2 `match` for every
   contract.
6. Complete the current-release canary: launch, oracle maturation, one idle
   keeper cycle and one confirmed same-pool compound cycle.
7. Configure one dedicated Privy policy wallet. Its policy must allow only the
   reviewed Mainnet executor and zero-value `execute` calls. Give it a bounded
   gas balance.
8. Configure two independent authenticated HTTPS RPC hosts, private Blob
   storage and `CRON_SECRET`.
9. Set explicit fee, per-tick debit, per-day debit, signer balance floor and
   growth-to-gas limits. Copy the same values into the reviewed manifest.
10. Run the promotion dry check, review its exact signer and commitments, then
    use the explicit write command only with separate release authority:

    ```sh
    npm run contracts:deep-v3:keeper-binding:promote
    npm run contracts:deep-v3:keeper-binding:promote:write
    ```

    The write command verifies a temporary final candidate live before locally
    replacing the manifest and binding. It does not deploy or submit a
    transaction.
11. Confirm the legacy flags remain `false`, the v1 lease is expired, and its
    record contains no pending request or operator incident.
12. Set both v2 activation flags to `true`. A single flag cannot activate
    submissions.

Run the canonical live verifier immediately after promotion and before
production activation:

```sh
npm run contracts:deep-v3:manifest:live
```

## Scheduling and health

Vercel calls `/api/ops/deep-v3-keeper-v2` every five minutes. The route has a
120-second platform limit and a 100-second internal deadline. A cycle uses two
12-second RPC timeouts with one transport retry. Each Privy attempt receives a
fresh absolute request expiry inside the current invocation deadline. A retry
keeps the same transaction body, idempotency key and reference while replacing
only that signed expiry header.

Oracle staging is an explicit, bounded operations subsidy. Its gas can be
justified by the same accrued growth later used for a compound action, so
neither monitoring nor public reporting may describe the combined lifecycle as
self-funding. Review oracle and compound debit separately and retain the
per-action ratio, tick budget, daily budget and signer-floor alerts.

Because vault work is permissionless, a third party can complete an action
between simulation and transaction inclusion. The official transaction can
then be stale, revert or confirm with no productive candidate. The executor
cannot redirect funds, but the attempt can consume bounded signer gas and
budget. Preserve the exact receipt and candidate logs and classify the outcome
truthfully.

The authenticated health route at
`/api/ops/deep-v3-keeper-v2/health` reports:

- last canonical block and slot;
- scan lag;
- active pending batches and operator incidents;
- signer balance alert;
- current tick and daily committed debit.

Alert on:

- any repeated `503`;
- repeated `409` lease contention;
- scan lag above two expected intervals;
- an active batch older than 30 minutes;
- a signer balance alert;
- any operator incident;
- a missing expected cron invocation.

## Recovery

The private control record is
`ops/deep-keeper-v3/control-v2.json`. Preserve its exact value and ETag before
investigating. Never delete it or edit a request hash, idempotency key, nonce,
budget or transaction hash.

Collect:

1. The v2 control record and ETag.
2. The unchanged legacy v1 record and ETag.
3. The Privy request and idempotency record.
4. Confirmed and pending signer nonces from both RPC providers.
5. Transaction and receipt results from both providers.
6. A common block at least 12 confirmations deep.
7. Executor and automation runtime hashes and topology at that block.
8. The exact EIP-1559 envelope: signer, executor target, zero value, calldata,
   gas, fees and nonce.
9. Canonical `CandidateResult` logs.

Classify the incident as:

- **Confirmed and bound:** both RPCs agree on the canonical transaction,
  receipt, envelope and candidate logs.
- **Confirmed reverted:** both RPCs agree on the canonical reverted receipt
  and exact envelope.
- **Never broadcast:** Privy proves no submission, both RPCs find no
  transaction or receipt, and nonce history is consistent.
- **Unresolved:** any source disagrees or required evidence is absent.

An unresolved incident remains blocked. Any state repair requires a reviewed,
incident-specific maintenance change and the full keeper and live release
gates before submissions resume. There is no reset endpoint.

## Credential or provider incident

Set both v2 flags to `false` before rotating Privy, Blob, RPC or cron
credentials. A signer change requires a new reviewed manifest and binding.
Re-enable only after both RPCs agree on the release and neither control record
contains pending or unresolved work.
