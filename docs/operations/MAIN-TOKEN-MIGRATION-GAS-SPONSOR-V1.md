# Main Token Migration Gas Sponsor V1

Status: active for the checked-in 72-hour migration window. The activation manifest binds the exact start, exclusive
deadline and finalized eligibility block. No committed file contains the operational Privy wallet ID, policy ID or
release budget.

## Purpose

This runbook defines two server-only gas paths during the exact 72-hour migration window. Current V4 holders using a
normal EOA without enough ETH or an EIP-7702 delegated EOA sign an exact EIP-2612 permit. This includes tokens bought
or received after the window opened. Funded normal EOAs can still use the direct wallet transfer. The same
dedicated sponsor pays gas for the permit and an exact `transferFrom` to the fixed migration wallet. No private key is
requested or exported, and neither path uses the migration recipient wallet as the sponsor. The legacy native ETH
top-up endpoint retains its narrower pre-window ownership rules; widening the token-bound relay does not open an ETH faucet.

The machine-readable companion is
[`config/main-token-migration-gas-sponsor-contract.v1.json`](../../config/main-token-migration-gas-sponsor-contract.v1.json).
The gasless current-holder companion is
[`config/main-token-migration-gasless-transfer-contract.v1.json`](../../config/main-token-migration-gasless-transfer-contract.v1.json).
The exact provider-enforced policy is
[`config/main-token-migration-gas-sponsor-privy-policy.v2.json`](../../config/main-token-migration-gas-sponsor-privy-policy.v2.json).
The release activation source is
[`config/main-token-migration-activation.v1.json`](../../config/main-token-migration-activation.v1.json).

## Activation contract

All six sponsor settings are server-only deployment values. None may use a `NEXT_PUBLIC_` prefix or be committed with
an operational value.

| Environment variable | Required activation value |
| --- | --- |
| `MAIN_TOKEN_MIGRATION_GAS_SPONSOR_ENABLED` | Exact string `true`; any other value disables the sponsor |
| `MAIN_TOKEN_MIGRATION_GAS_SPONSOR_PRIVY_WALLET_ID` | Exact ID of the dedicated Privy Ethereum wallet |
| `MAIN_TOKEN_MIGRATION_GAS_SPONSOR_PRIVY_POLICY_ID` | Exact ID of the wallet's single attached Privy policy |
| `MAIN_TOKEN_MIGRATION_GAS_SPONSOR_ADDRESS` | Checksummed address returned for that exact wallet ID |
| `MAIN_TOKEN_MIGRATION_GAS_SPONSOR_MAX_TOP_UP_WEI` | Positive decimal wei, at most `2000000000000000` (0.002 ETH) |
| `MAIN_TOKEN_MIGRATION_GAS_SPONSOR_TOTAL_BUDGET_WEI` | Decimal wei, at least the top-up cap and at most `1000000000000000000` (1 ETH) |

Activation additionally requires the normal runtime dependencies:

| Dependency | Purpose |
| --- | --- |
| `NEXT_PUBLIC_PRIVY_APP_ID` | Public identifier of the same deployed Privy app that owns the sponsor wallet |
| `PRIVY_APP_SECRET` | Server-only Privy authentication secret |
| `PROGRAMMABLE_WEBSITE_PROJECTION_DATABASE_URL` | Server-only attested durable reservation database |
| `PROGRAMMABLE_WEBSITE_PROJECTION_DATABASE_CA_PEM` | Server-only database trust root |
| `PROGRAMMABLE_WEBSITE_PROJECTION_DATABASE_ROLE` | Exact least-privilege runtime role |
| `PROGRAMMABLE_WEBSITE_MAINNET_RPC_PRIMARY_PROVIDER` | Exact provider label; production requires dRPC |
| `PROGRAMMABLE_WEBSITE_MAINNET_RPC_PRIMARY_URL` | Server-only primary Ethereum endpoint |
| `PROGRAMMABLE_WEBSITE_MAINNET_RPC_PRIMARY_ENDPOINT_COMMITMENT` | Commitment to the primary endpoint |
| `PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL` | Server-only independent migration witness endpoint |
| `PROGRAMMABLE_ALCHEMY_MAINNET_RPC_ENDPOINT_COMMITMENT` | Commitment to the Alchemy migration witness endpoint |

The root migration manifest must independently bind the exact release, token, runtime-code hash, migration wallet,
72-hour timestamps, finalized pre-window eligibility block number and block hash. Sponsor configuration is accepted only while that
manifest has `enabled: true`, the current time is inside the window, and at least five minutes remain.

## Privy wallet and policy

Use a dedicated Privy Ethereum EOA. It must not be the V4 token contract or the migration recipient wallet. Before
every eligibility response and transfer, the server re-reads the wallet and policy from Privy and requires all of the
following:

- the returned wallet ID equals `MAIN_TOKEN_MIGRATION_GAS_SPONSOR_PRIVY_WALLET_ID`;
- `chain_type` is `ethereum` and the returned address equals the configured checksummed address; and
- exactly one policy is attached and its ID equals `MAIN_TOKEN_MIGRATION_GAS_SPONSOR_PRIVY_POLICY_ID`.
- the policy has no owner, is Ethereum policy version 1.0, and its normalized rules exactly match the checked-in V2
  policy contract; an extra, missing or broader rule fails closed.

The policy has three non-overlapping allow rules and defaults to deny everything else. The native rule requires a
strictly positive Mainnet value no greater than 0.002 ETH, so it cannot authorize zero-value contract calls. The
permit rule pins the V4 token, sponsor spender, total-supply ceiling and release deadline. The `transferFrom` rule pins
the V4 token, total-supply ceiling and fixed migration destination. The server independently binds the dynamic holder,
exact signed amount, empty native calldata or byte-exact token calldata, sender, type-2 gas/fee fields and calculated
value. Every submitted transaction is independently read back through two RPCs.

## Current-holder gasless path

The gasless route accepts plain EOAs and addresses with the canonical EIP-7702 delegation indicator. Both RPCs
must agree on that code, the pinned token runtime, token name `Programmable`, permit domain separator, current nonce
and current balance. No historical balance or acquisition route is required. General smart-contract wallets are not
supported by this token's EIP-2612 owner-signature path. The wallet reviews a permit binding chain ID 1, the pinned V4
token, the dedicated sponsor as spender, exact raw amount, current nonce and a deadline of at most 20 minutes. The
server recovers the exact connected owner before reserving anything.

The private ledger stores each signed attempt with its request binding and separate deterministic provider references for `permit` and
`transferFrom`. The sponsor first submits the byte-exact permit. Only after two providers confirm its successful
receipt and the allowance is visible may the sponsor call `transferFrom(owner, fixedMigrationWallet, exactAmount)`.
Both calls have zero native value, 100,000-gas ceilings and share the existing release budget and durable holder replay
guard. The ordinary ETH endpoint still rejects delegated wallets. The UI
never signs automatically and never treats a provider response as a confirmed token transfer.

An authenticated `resume` request binds the same linked holder, amount and idempotency key to an already signed private
ledger intent. It cannot create a reservation or change the amount. It resumes without another signature or a fresh
balance requirement, so a completed transfer remains recoverable after the wallet balance decreases. After the
window closes, recovery only reads existing receipts and does not send transactions.

### Expired, unused permit recovery

During the open window, an authenticated resume may return `recovery_available`. This is an offer to review a new
attempt, not a successful transfer and not permission to reuse the old signature. The server must first establish
all of these facts:

- Two independent RPCs agree on a finalized canonical block whose timestamp is past the old permit deadline.
- The holder's permit nonce still equals the old signed nonce and its allowance to the sponsor is zero.
- No transfer transaction is stored or returned for the old provider reference. Provider errors, ambiguous lookups
  and any possible transfer submission stop recovery.
- The holder, release, sponsor, amount and predecessor request binding are unchanged, and the release is still open.

`prepare_recovery` and `submit_recovery` carry `previousRequestBindingHash` and a fresh idempotency key. Preparation
does not consume a budget reservation. The holder explicitly reviews and signs a fresh permit; submit rechecks the
recovery conditions. An atomic predecessor check under the shared release advisory lock appends the new attempt and
its history edge. No previous intent, signature, completion or alias is deleted or rewritten. Each attempt has its
own provider references and completion records, and stale predecessor requests cannot send for the successor.

At most three signed attempts exist per holder, including the original. All reservations remain counted against
the shared gas budget; recovery does not reset spending limits or the native ETH faucet guard. The browser preserves
its old marker on cancellation and writes an atomic successor marker only after signing and before submitting.
Lost responses resume the exact successor rather than silently starting another attempt. It stores no permit
signature in browser storage.

An executed permit, changed nonce, nonzero sponsor allowance, possible transfer submission, exhausted attempt limit
or unavailable proof still requires support. A provider status of `replaced` by itself is never sufficient evidence
to restart. No new attempt can start after the migration window closes.

The release budget and per-holder/principal admission limits bound spending, but do not make arbitrary current-holder
eligibility Sybil-resistant. Splitting tokens among many wallets can consume the finite budget. Keep funding bounded,
monitor reservations and never present gas sponsorship as unlimited or guaranteed during provider outages.

## Fixed fee and budget boundaries

These limits are code-bound and are not operator-tunable:

| Boundary | Exact value | Behavior at or beyond the boundary |
| --- | ---: | --- |
| Token-transfer gas ceiling | `100000` gas | A larger estimate fails closed |
| Quote multiplier | `12500` bps (125%) | Applied to the conservative transfer-gas quote |
| Maximum fee per gas | `20000000000` wei (20 gwei) | A higher quote returns unavailable; it never increases the cap |
| Sponsor transaction gas | `21000` gas | Only a plain EOA can receive a native top-up; delegated wallets use the gasless token path |
| Absolute top-up cap | `2000000000000000` wei (0.002 ETH) | The configured cap may be lower, never higher |
| Absolute release budget cap | `1000000000000000000` wei (1 ETH) | The configured budget may be lower, never higher |
| Deadline safety margin | `300` seconds | New sponsorship closes before the migration deadline |

The calculated requirement is `ceil(100000 * maxFeePerGas * 12500 / 10000)`. Existing holder ETH is subtracted, so
only the deficit is sent. The quote uses the higher max fee and higher priority fee observed across the two
independent providers, and the priority fee must not exceed the max fee. Each durable budget reservation includes
both that top-up and the sponsor's exact reserved `sponsorGasLimit * maxFeePerGas` transaction cost. Native and
gasless holder rows are summed under the same advisory lock. The total budget
must cover the configured maximum top-up. It must also be
chosen below the wallet's funded balance with an operator-owned safety margin; the absolute code cap is not a funding
recommendation.

## Native ETH top-up eligibility and replay boundary

The endpoint authenticates the Privy access token and requires the requested address to be linked to that Privy
principal. Both independent Ethereum providers must agree on chain ID, canonical head, the finalized pre-window
eligibility block and the pinned V4 runtime code. The holder and sponsor must be EOAs or an explicitly supported
EIP-7702 delegated EOA. The native top-up path accepts only a plain EOA; a supported delegated holder is routed
exclusively to the gasless transfer. The current holder must own at least the requested V4 amount at the canonical read. It is
eligible either by owning that amount at the pre-window block or through one finalized direct V4 transfer from an
eligible pre-window root wallet. Both providers must return the exact same transfer log, transaction and pre-window
root balance. The transaction must originate from that root EOA, call the pinned V4 token directly and encode the
exact `transfer(destination, amount)` matching the log. `transferFrom`, multi-hop transfers and contract sources
remain ineligible. Dust transfers below the requested amount are discarded before the bounded candidate set is
formed, so unrelated transfer spam cannot displace a valid relocation.

The POST is same-origin, request-size bounded and idempotency-bound. The durable store reserves at most one sponsor
intent per release and holder under a database advisory lock. A pre-window root wallet is also atomically bound to
at most one sponsored destination, so moving the same tokens through additional wallets cannot create more sponsor
claims. A relocated reservation also writes a valid, non-broadcastable root guard into the existing holder namespace.
That makes an older deployment fail closed on the root holder without relying on the newer eligibility alias. The
guard reserves 21,001 wei of accounting headroom but never calls the sponsor provider and never represents an ETH
transfer. Every provider request stores a unique, 64-character reconciliation reference and a separate idempotency
key before submission. If a provider response is lost, the server first looks up that exact reference. During
Privy's documented 24-hour idempotency window it may retry only the byte-identical persisted request with the same
key; it never creates a new key or changes transaction bytes. Outside that window an unresolved reservation stays
fail-closed for operator reconciliation. Confirmation requires both RPCs to read back the exact sender, recipient,
value, fee fields, gas limit, empty calldata and successful receipt on the same block.

## Staging and activation

1. Keep `MAIN_TOKEN_MIGRATION_GAS_SPONSOR_ENABLED=false` and the activation manifest disabled while preparing the
   immutable candidate.
2. Read back the dedicated wallet from Privy. Capture its ID, checksummed address, exact single policy ID and policy
   definition without logging an app secret.
3. Confirm the policy has the restrictions above and that the dedicated wallet contains only the deliberately
   bounded funding amount.
4. Choose explicit decimal-wei values for maximum top-up and total budget. Verify the budget is no greater than the
   funded balance after the retained safety margin.
5. Configure the Privy secret, projection database bindings and exact independent RPC commitments on the immutable
   deployment candidate.
6. Before the migration opens, record one exact block number/hash already finalized by both providers and calculate
   timestamps whose exclusive deadline is exactly 259,200 seconds after the start.
7. Only the integration owner may change the reviewed activation manifest to `enabled: true`, inject all six sponsor
   values with `MAIN_TOKEN_MIGRATION_GAS_SPONSOR_ENABLED=true`, and deploy the exact reviewed `production` commit.
8. Run the separate readiness checklist before exposing the migration entry point.

## Disable and incident response

Set `MAIN_TOKEN_MIGRATION_GAS_SPONSOR_ENABLED=false` to stop new sponsor handling. A manifest with `enabled: false`, a
closed window, a missing dependency, a wallet/policy mismatch, exhausted budget, RPC disagreement or fee quote above
the cap also fails closed. After the window, disable the deployment value and revoke or detach the dedicated Privy
policy through the normal owner-controlled Privy process. The application reconciles an ambiguous submission through
its stored provider reference and idempotency key. An operator must never issue a fresh top-up or a fresh provider key
for the same reservation; use the stored request ID and onchain transaction readback for review.

Never include the Privy app secret, database credentials, RPC URLs, holder access tokens or operational wallet IDs in
public logs, screenshots or release evidence.
