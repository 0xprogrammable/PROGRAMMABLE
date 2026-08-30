# Robinhood foundation owner-wallet handoff

This handoff prepares and verifies one chain-4663 EIP-1559 wallet request.
Envelope preparation does not read a balance; the final read-only action-time
verifier does. The handoff does not select an owner, open a wallet, sign,
broadcast, bridge funds, or retry a transaction. The owner remains responsible
for the final wallet review and authorization.

Run every command below from the repository root at the exact reviewed
`production` commit. The checkout must be clean, its canonical `origin` must be
`https://github.com/programmablehq/PROGRAMMABLE.git`, and local
`origin/production` must equal `HEAD`. The tooling also queries GitHub and binds
the current successful protected `Verify` run, aggregate job and immutable
production-proof artifact for that exact commit and tree. A different clean
descendant is rejected.

## Review-frozen provider commitments

Before the handoff, a separate release reviewer must derive and retain the two
non-secret endpoint commitments under the release evidence policy. In that
separate review session, use the same no-history input procedure shown below,
leave both commitment variables unset, and run:

```sh
npm run --silent contracts:robinhood:provider-commitments
```

The helper prints exactly two non-secret assignment lines. Stop after recording
and approving them; do not turn its output into a file that the live handoff
overwrites or immediately sources. The live handoff must start from those
already review-frozen values. Computing new hashes from the URLs being used and
then accepting those same hashes proves only self-consistency, not review.

## Secret-safe provider input

Use an approved secret runner when one is available. The manual fallback below
keeps credential URLs out of shell history and command arguments. Do not use it
with shell tracing, paste a URL into an `export` command, store a URL in a repo
`.env` file, pass a URL as a CLI flag, echo it, or capture an environment dump.
Replace the two commitment placeholders only with the earlier review-frozen,
non-secret SHA-256 values.

```sh
set +x
umask 077

export ROBINHOOD_OWNER_ENVELOPE_ROOT="${HOME}/.programmable-robinhood-owner-envelope"
install -d -m 700 "$ROBINHOOD_OWNER_ENVELOPE_ROOT"

cleanup_robinhood_owner_handoff() {
  unset ROBINHOOD_MAINNET_RPC_URL_PRIMARY
  unset ROBINHOOD_MAINNET_RPC_URL_SECONDARY
  unset ROBINHOOD_MAINNET_RPC_COMMITMENT_PRIMARY
  unset ROBINHOOD_MAINNET_RPC_COMMITMENT_SECONDARY
}
trap cleanup_robinhood_owner_handoff EXIT HUP INT TERM

export ROBINHOOD_MAINNET_RPC_COMMITMENT_PRIMARY='<review-frozen-sha256-primary>'
export ROBINHOOD_MAINNET_RPC_COMMITMENT_SECONDARY='<review-frozen-sha256-secondary>'

IFS= read -r -s ROBINHOOD_MAINNET_RPC_URL_PRIMARY </dev/tty
printf '\n' >/dev/tty
IFS= read -r -s ROBINHOOD_MAINNET_RPC_URL_SECONDARY </dev/tty
printf '\n' >/dev/tty
export ROBINHOOD_MAINNET_RPC_URL_PRIMARY
export ROBINHOOD_MAINNET_RPC_URL_SECONDARY

npm run --silent contracts:robinhood:provider-commitments
```

The commitment helper accepts only the exact credential-bearing QuickNode
primary and Alchemy secondary Robinhood URL forms:

```text
https://<HOOD_EXPLORER_INDEXER_ENDPOINT>.robinhood-mainnet.quiknode.pro/<TOKEN>/
https://robinhood-mainnet.g.alchemy.com/v2/<ALCHEMY_API_KEY>
```

The primary URL must be copied from the existing QuickNode **Hood Explorer
Indexer** project. The secondary URL must be copied from the existing Alchemy
**Programmable Production 3** app. The helper can validate the authenticated
provider URL shape, role, provider ID and trust domain; it cannot prove either
dashboard display name, account ownership, plan or archive entitlement. Those
facts and both providers' required historical reads remain separate release
checks. A legacy one-label QuickNode host or an Ethereum endpoint ending in
`.ethereum-mainnet.quiknode.pro` is rejected in this Robinhood-only slot.

This ordered role pair is compatible with backend provider-profile digest
`sha256:c03afd37c077e78bea30f69d1ce139d026cb4fad86fa74122257bba8f5e9a910`.
That digest is not owner-envelope or backend-release evidence by itself; the
cross-repository promotion must still bind the exact backend artifact and its
attested runtime readiness. With the two review-frozen commitment variables
present, the helper prints only
`ROBINHOOD_RPC_PROVIDER_COMMITMENTS_MATCH_REVIEW` after an exact match.
Replacing a credential URL, changing the QuickNode endpoint host or credential
path, reversing provider roles, or substituting two new otherwise valid
credential URLs fails against the independently frozen commitments.

Public Robinhood RPC, dRPC and provider demo endpoints are not substitutes for
the current owner action-time pair. A public endpoint may return
`safe`/`finalized` headers while failing historical state reads at that same
block. The credentialed providers must pass the exact fixed-block code, nonce,
pending-state, simulation and closing-state inventory. Robinhood produces blocks
fast enough that authenticated providers can legitimately observe different
pending parents or fees during one bounded preflight. The guard therefore
requires two identical state-relevant snapshots (runtime code, target vacancy,
owner nonce, owner balance, simulation return and gas estimate) while recording
both pending observations. Fee fields use the highest base fee, gas price and
priority fee reported by either provider and remain bounded by the owner's
explicit ceilings.

## Fresh envelope

The owner chooses one allowed sender and explicit decimal fee ceilings. These
values are not fee suggestions. Use a new output name for every attempt; the
writer never overwrites a receipt.

```sh
npm run contracts:robinhood:owner-envelope:refresh -- \
  --owner '<one-exact-allowed-owner>' \
  --max-fee-per-gas-wei '<owner-reviewed-decimal-ceiling>' \
  --max-priority-fee-per-gas-wei '<owner-reviewed-decimal-ceiling>' \
  --max-total-cost-wei '<owner-reviewed-decimal-ceiling>' \
  --output "$ROBINHOOD_OWNER_ENVELOPE_ROOT/owner-envelope-<unique-id>.json"
```

The owner-only `0600` receipt binds the exact source commit/tree, successful
hosted Verify run and proof artifact, endpoint commitments, calldata, nonce,
gas, fees, fixed/pending/closing provider reads and five-minute expiry. It never
contains a provider URL or token.

## Canonical wallet request and action-time verification

The signing interface must export the exact request it is about to open as the
canonical one-LF JSON shape below. `request.params` contains exactly one
type-`0x2` transaction with exactly these keys: `chainId`, `from`, `to`,
`value`, `data`, `nonce`, `gas`, `maxFeePerGas`, `maxPriorityFeePerGas`,
`accessList`, and `type`. `accessList` is required and must be exactly `[]`;
no missing, non-empty or differently shaped access list, `gasPrice`, signature
or extra key is accepted.

An integration that needs a deterministic candidate may derive it from the
protected envelope without printing the calldata:

```sh
jq '{
  schemaVersion: "programmable.robinhood-custom-launch.owner-wallet-request.v1",
  chainId: .chainIdHex,
  request: {
    method: "eth_sendTransaction",
    params: [{
      chainId: .transaction.chainId,
      from: .transaction.from,
      to: .transaction.to,
      value: "0x0",
      data: .transaction.input,
      nonce: .transaction.nonceQuantity,
      gas: .transaction.gasQuantity,
      maxFeePerGas: .transaction.maxFeePerGasQuantity,
      maxPriorityFeePerGas: .transaction.maxPriorityFeePerGasQuantity,
      accessList: [],
      type: .transaction.type
    }]
  }
}' "$ROBINHOOD_OWNER_ENVELOPE_ROOT/owner-envelope-<unique-id>.json" \
  >"$ROBINHOOD_OWNER_ENVELOPE_ROOT/wallet-request-<unique-id>.json"
chmod 600 "$ROBINHOOD_OWNER_ENVELOPE_ROOT/wallet-request-<unique-id>.json"
```

Immediately before the owner opens the wallet, run the strictly read-only
verifier. It rechecks freshness, the protected source and production ref, the
exact hosted Verify proof, provider commitments and every wallet field,
including exact `accessList: []`. It then uses both frozen credentialed
providers to re-read chain ID; owner `latest` and `pending` nonce; owner pending
balance; pending base fee, gas price and maximum priority fee; pending code and
nonce vacancy for all three targets; and the exact pending simulation and gas
estimate. It repeats a second closing
nonce/balance/fee/code/vacancy/simulation/gas snapshot immediately before wallet
delivery. Both providers must agree on the owner balance, and the opening and
closing balance must remain identical. The balance must cover the maximum debit
`gasLimit * maxFeePerGas`; the transaction fee caps must cover the highest
opening-or-closing provider gas price and the conservative
`2 * pendingBaseFee + maxPriorityFeePerGas` formula without exceeding the
owner-reviewed envelope ceilings. Any funding, fee or state drift fails closed.
It then re-reads the canonical GitHub `production` ref and revalidates the same
persisted immutable Verify run, attempt and artifact before one final local
source/freshness guard. Its output contains only a bounded safe summary, never
calldata or a credential.

```sh
npm run contracts:robinhood:owner-wallet-request:verify -- \
  --envelope "$ROBINHOOD_OWNER_ENVELOPE_ROOT/owner-envelope-<unique-id>.json" \
  --wallet-request "$ROBINHOOD_OWNER_ENVELOPE_ROOT/wallet-request-<unique-id>.json"
```

Do not proceed if fewer than 60 seconds remain, any check fails, the wallet
shows a different field, or the owner does not independently confirm chain
`4663`, Multicall3 destination, zero value, sender, calldata hash, nonce, gas,
fee caps and maximum debit. The command does not grant signing or broadcast
authority.

## Recovery matrix

| Observation | Required action | Forbidden action |
| --- | --- | --- |
| Preflight, source, CI-proof or protected-write failure | Treat as no onchain action; remove a safely owned incomplete file and start with a new name after fixing the cause | Do not open a wallet from partial output |
| Envelope expired, field mismatch, or owner rejects | Discard/archive under evidence policy and perform a complete fresh preflight | Do not extend timestamps or edit fields |
| Wallet/provider returned a transaction hash | Record the hash and track that exact transaction through both providers | Never submit the deployment again |
| Submission response was lost and no hash is available | Mark `AMBIGUOUS`; reconcile sender plus nonce and all three target addresses through both providers before any decision | Never infer failure or resend from a timeout |
| Transaction remains pending after envelope expiry | Continue tracking the same transaction; envelope TTL does not cancel a broadcast transaction | Do not replace/resend without a separately reviewed recovery decision |
| Receipt status is `0` | Preserve the receipt; prove all three target code and nonce values remain vacant with both providers before preparing any new attempt | Do not assume atomic rollback without readback |
| Receipt status is `1` | Never rerun foundation deployment; proceed to capture, Ethereum finality and source publication | Do not create a second deployment transaction |
| Mixed or partial target occupancy | Stop as an incident; exact `aggregate3` is atomic, so this contradicts the reviewed transaction/evidence model | Do not repair one component ad hoc |
| Provider or source-publication read failed after a known successful mutation | Retry only the read against the same immutable identity | Do not repeat deployment or publication blindly |
| Provider credential may be exposed | Rotate it, compute/review new endpoint commitments, invalidate old handoff files and rerun from the start | Do not keep using an old commitment |

Every stale or rejected envelope/request should be scrubbed or archived only
according to the owner's evidence policy. Always run `cleanup_robinhood_owner_handoff`
or let the trap unset provider variables before leaving the shell.
