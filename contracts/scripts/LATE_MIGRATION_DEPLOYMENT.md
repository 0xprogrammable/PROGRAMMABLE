# Late migration V3 intake deployment

This is the active source-only procedure. Earlier V2 source/reserve, retryable, reserve-funding and payout procedures are superseded. The tools below only read RPC state and print unsigned handoffs. They do not sign, broadcast, fund, update server configuration or publish the website.

The frozen round contains 1,499 wallets, gross `176529129261873518239425341`, and manual payout `141223303409498814591539678`. Each wallet's payout is floored separately at 80%; the total is 594 smallest units below flooring the aggregate. The root is `0x2817f23e9af279fe00d478f47cee3d36393677af6ac9d00c6ae4a0f821b423a0`. Do not rebuild a new entitlement policy or assume continued holdings after this frozen artifact.

Ethereum intake sends the exact old V4 amount from `0x7987f03462200b3D8A072E02C89A8A41dCB124EE` to `0x2Bb333d48DFAF1596D9036671d2E43168994249E`. It has no target-chain transaction capability. The owner later manually distributes new V4 `0xC60bA256B44334A0Cd2C7242E98B88f031abB006` on Robinhood 4663. There is no intake closing date.

## Reproduce local artifacts

From the repository root:

```sh
(cd contracts && FOUNDRY_PROFILE=late-migration forge build src/late-migration/ProgrammableLateMigrationIntakeV3.sol)
node contracts/scripts/update-late-migration-artifact-fixtures.mjs check
node --test contracts/scripts/test/late-migration-deployment-preflight.test.mjs contracts/scripts/test/late-migration-deployment-stages.test.mjs
```

Solidity `0.8.26`, optimizer 1,000 runs, Cancun, via-IR and no CBOR metadata produce creation hash `0x1252db6fb2539db7b52736e891dfae7c3a09892e2d2d5b3a46f64d8b8f87bbc5`. Patching the compiled `oldToken` immutable yields deployed runtime hash `0xecdf575038f4a7c3b839c7de527389187d8408e13b0e5b2344b9b30135f2cb70`.

After an intentional reviewed source/compiler change only, `update-late-migration-artifact-fixtures.mjs write` regenerates local fixture and preflight pins. Review those changes together. A successful local check does not prove deployed runtime or authorize release.

## Owner handoffs

The constructor takes only activation authority `0x245099E77F8F0Cad9a75B1B56db8FDE7C948d5B1`. Deployment leaves deposits closed. That same wallet may activate exactly once; activation deletes authority and cannot be reversed.

```sh
node contracts/scripts/prepare-late-migration-deployment.mjs check
node contracts/scripts/prepare-late-migration-deployment.mjs prepare > work/intake-deployment-handoff.json
```

The public preflight requires two independent Ethereum providers, literal finalized blocks, canonical block agreement and exact old-token code/domain/supply/decimals. `prepare` additionally binds an agreed current owner nonce with no pending transactions, an empty predicted CREATE address, exact initcode/runtime and bounded gas estimate. Handoffs expire after five minutes; regenerate for owner wallet review. No tool reads a deployer private key. The final gas/fee selection and signature remain owner actions.

After the owner explicitly approves and deploys:

```sh
node contracts/scripts/prepare-late-migration-stage.mjs verify-source SOURCE_DEPLOYMENT_TX_HASH > work/intake-source-verified.json
node contracts/scripts/prepare-late-migration-stage.mjs prepare-activate work/intake-source-verified.json > work/intake-activation-handoff.json
```

Activation preparation requires authenticated production RPC endpoints and commitments described below. It re-verifies the exact finalized deployment transaction, constructor authority, compiled runtime, frozen getters and closed state. It simulates the exact zero-value `activateDeposits()` call, bounds gas, and rechecks owner nonce and canonical anchor. Review the irreversible effect before the owner's activation signature.

After that owner action finalizes:

```sh
node contracts/scripts/prepare-late-migration-stage.mjs verify-activation work/intake-source-verified.json ACTIVATION_TX_HASH > work/intake-activation-verified.json
```

Verification checks successful canonical transactions, block positions, exact calldata, the `DepositsActivated` event, open state and deleted authority against both providers. It prints a **disabled** activation-config candidate containing verified source address/runtime/deployment block and activation height. Sponsor fields remain null. Journals are untrusted transaction pointers and are fully reverified on every use; serialized verification output cannot bypass checks.

## Production RPC and sponsor gates

`LATE_MIGRATION_ETHEREUM_PRODUCTION_PROVIDERS_JSON` is a secret JSON array of two to four independently operated Ethereum endpoints. Each entry has `id`, `trustDomain`, `url`, `headers`, and `endpointCommitmentSha256`. Use HTTPS endpoints with authenticated headers and fresh literal `finalized` plus historical transaction/receipt/code reads. The production adapter requires the trust domain to equal the last two hostname labels; use supported provider domains accordingly. Do not commit endpoint credentials.

To print public commitments without exposing URLs or headers:

```sh
node contracts/scripts/prepare-late-migration-provider-commitments.mjs source
```

This deployment-verification endpoint set is separate from the backend's configured Ethereum quorum. Configure the backend's independent providers and verify their own readiness; a tool preflight is not backend provider proof.

A bounded isolated sponsor wallet requires explicit owner agreement before creation/funding. Do not put the owner treasury key on a server. Backend configuration requires separate `relayerWalletOwnerId` and `relayerPolicyOwnerId`; both offline administration quorums must match the approved P-256 SPKI public key in `PROGRAMMABLE_LATE_MIGRATION_PRIVY_OWNER_PUBLIC_KEY`. The transaction signer must be separate, and the treasury address cannot be the relayer.

The reviewed sponsor exposure is its entire funded ETH balance. Provider destination/selector policy does not enforce a gas-spend cap. Record exact finalized funding block/hash with `relayerFundingBalanceWei == totalRelayerBudgetWei`; backend submissions reject balances above that budget. Funding, server credentials, wallet/policy ownership proof, budget choice, durable store setup, backend provider readiness and production publication remain separate owner/release gates. These deployment tools neither fill sponsor evidence nor enable the manifest.

## Manual payout evidence

Only canonical finalized `MigrationDepositAccepted` events from this exact Ethereum intake/round establish a valid deposit. A direct transfer to the recipient or a UI/database status is insufficient. A later owner-requested payout ledger must retain source chain/contract/round, offer index/source/deposit ID, transaction/block/log identity, exact gross/manual-payout integers, fixed recipient and target-token commitment, plus an explicit paid ledger to prevent repeated manual payouts. These tools do not prepare or execute payouts.
