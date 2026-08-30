# Main Token Migration Gas Sponsor V1

Status: release-dark. The checked-in migration activation manifest remains disabled, no production activation is
authorized by this document, and no committed file contains the operational Privy wallet ID, policy ID, sponsor
address or release budget.

## Purpose

This runbook defines the server-only activation contract for one bounded Ethereum Mainnet gas top-up per eligible
V4 holder during the exact 96-hour migration window. The sponsor sends native ETH only to the authenticated holder
wallet so that the holder can separately approve the exact V4 token transfer in their own wallet. It never sends V4,
never submits the holder's token transfer, and never uses the migration recipient wallet as the sponsor.

The machine-readable companion is
[`config/main-token-migration-gas-sponsor-contract.v1.json`](../../config/main-token-migration-gas-sponsor-contract.v1.json).
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
| `PROGRAMMABLE_WEBSITE_MAINNET_RPC_SECONDARY_PROVIDER` | Exact provider label; production requires QuickNode |
| `PROGRAMMABLE_WEBSITE_MAINNET_RPC_SECONDARY_URL` | Server-only independent secondary Ethereum endpoint |
| `PROGRAMMABLE_WEBSITE_MAINNET_RPC_SECONDARY_ENDPOINT_COMMITMENT` | Commitment to the secondary endpoint |

The root migration manifest must independently bind the exact release, token, runtime-code hash, migration wallet,
96-hour timestamps, finalized pre-window eligibility block number and block hash. Sponsor configuration is accepted only while that
manifest has `enabled: true`, the current time is inside the window, and at least five minutes remain. In this branch
the manifest deliberately remains `enabled: false` with null timing and block fields.

## Privy wallet and policy

Use a dedicated Privy Ethereum EOA. It must not be the V4 token contract or the migration recipient wallet. Before
every eligibility response and transfer, the server re-reads the wallet from Privy and requires all of the following:

- the returned wallet ID equals `MAIN_TOKEN_MIGRATION_GAS_SPONSOR_PRIVY_WALLET_ID`;
- `chain_type` is `ethereum` and the returned address equals the configured checksummed address; and
- exactly one policy is attached and its ID equals `MAIN_TOKEN_MIGRATION_GAS_SPONSOR_PRIVY_POLICY_ID`.

The attached policy must allow only `eth_sendTransaction` for Ethereum Mainnet (`eip155:1`), native value no greater
than the configured top-up cap and never greater than 0.002 ETH; its default action must deny unrelated wallet
methods. Privy's transaction-policy fields do not attest calldata or the dynamic holder recipient. The server
therefore independently constructs a type-2 transaction with chain ID 1, empty calldata, fixed
21,000 gas, the sponsor as `from`, the authenticated eligible holder as `to`, and the exact calculated deficit as
`value`. A broader policy is not activation-ready even though these server checks remain in place.

## Fixed fee and budget boundaries

These limits are code-bound and are not operator-tunable:

| Boundary | Exact value | Behavior at or beyond the boundary |
| --- | ---: | --- |
| Token-transfer gas ceiling | `100000` gas | A larger estimate fails closed |
| Quote multiplier | `12500` bps (125%) | Applied to the conservative transfer-gas quote |
| Maximum fee per gas | `20000000000` wei (20 gwei) | A higher quote returns unavailable; it never increases the cap |
| Sponsor transaction gas | `21000` gas | Fixed native transfer with empty calldata |
| Absolute top-up cap | `2000000000000000` wei (0.002 ETH) | The configured cap may be lower, never higher |
| Absolute release budget cap | `1000000000000000000` wei (1 ETH) | The configured budget may be lower, never higher |
| Deadline safety margin | `300` seconds | New sponsorship closes before the migration deadline |

The calculated requirement is `ceil(100000 * maxFeePerGas * 12500 / 10000)`. Existing holder ETH is subtracted, so
only the deficit is sent. The quote uses the higher max fee and higher priority fee observed across the two
independent providers, and the priority fee must not exceed the max fee. Each durable budget reservation includes
both that top-up and the sponsor's own
`21000 * maxFeePerGas` transaction cost. The total budget must cover the configured maximum top-up. It must also be
chosen below the wallet's funded balance with an operator-owned safety margin; the absolute code cap is not a funding
recommendation.

## Eligibility and replay boundary

The endpoint authenticates the Privy access token and requires the requested address to be linked to that Privy
principal. Both independent Ethereum providers must agree on chain ID, canonical head, the finalized pre-window
eligibility block and the pinned V4 runtime code. The holder and sponsor must be EOAs. The holder must own at least
the requested V4 amount both at the eligibility block and at the current canonical read.

The POST is same-origin, request-size bounded and idempotency-bound. The durable store reserves at most one sponsor
intent per release and holder under a database advisory lock. An ambiguous provider response is never automatically
rebroadcast. Confirmation requires both RPCs to read back the exact sender, recipient, value, fee fields, gas limit,
empty calldata and successful receipt on the same block.

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
   timestamps whose exclusive deadline is exactly 345,600 seconds after the start.
7. Only the integration owner may change the reviewed activation manifest to `enabled: true`, inject all six sponsor
   values with `MAIN_TOKEN_MIGRATION_GAS_SPONSOR_ENABLED=true`, and deploy the exact reviewed `production` commit.
8. Run the separate readiness checklist before exposing the migration entry point.

## Disable and incident response

Set `MAIN_TOKEN_MIGRATION_GAS_SPONSOR_ENABLED=false` to stop new sponsor handling. A manifest with `enabled: false`, a
closed window, a missing dependency, a wallet/policy mismatch, exhausted budget, RPC disagreement or fee quote above
the cap also fails closed. After the window, disable the deployment value and revoke or detach the dedicated Privy
policy through the normal owner-controlled Privy process. Do not repeat a top-up after an ambiguous submission; use
the stored request ID and onchain transaction readback for review.

Never include the Privy app secret, database credentials, RPC URLs, holder access tokens or operational wallet IDs in
public logs, screenshots or release evidence.
