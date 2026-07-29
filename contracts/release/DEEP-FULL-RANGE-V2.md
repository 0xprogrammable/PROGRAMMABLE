# Deep Full Range V2

Deep V2 is a canary release candidate. It is not deployed or enabled.

The release reuses the source-verified V1 fee and oracle stack at fixed Mainnet addresses. Only the V2 growth-vault
factory and V2 launcher are broadcaster-created. Their constructors create the vault implementation, automation and
position planner internally, so the reviewed sequence contains exactly two transactions.

## Local verification

```sh
npm run contracts:deep-v2:deployer:test
npm run contracts:deep-v2:release:test
npm run contracts:deep-v2:manifest:offline
```

The offline manifest check binds the five V2 creation bytecodes, the reused runtime code hashes, official Uniswap
dependencies and fixed policy into the Solidity deployment commitment. It does not make a Mainnet deployment claim.

## Read-only Mainnet simulation

Set `ETHEREUM_RPC_URL` and `DEEP_V2_MAINNET_DEPLOYER`, then run:

```sh
npm run contracts:deep-v2:mainnet:simulate
```

The simulation reads the pending nonce, rejects occupied deterministic targets and runs the Foundry script without
`--broadcast`.

## Post-deployment evidence

Receipt capture requires two independent Mainnet RPCs, the deployer address and the two real transaction hashes:

```sh
DEEP_V2_GROWTH_FACTORY_TRANSACTION=0x... \
DEEP_V2_LAUNCHER_TRANSACTION=0x... \
npm run contracts:deep-v2:manifest:capture
```

The default command prints a candidate and does not modify the manifest. The `:write` variant is explicit. It accepts
only successful, 12-confirmation receipts whose sender, nonces, CREATE addresses, transaction inputs, constructor
arguments and artifact-bound runtime bytes match the reviewed two-transaction plan.

`npm run contracts:deep-v2:manifest:live` remains closed until all V2 contracts and the keeper executor have exact
Etherscan and Sourcify matches, the current-release lifecycle evidence file exists, both RPCs agree and the reviewed
keeper binding has been promoted. Promotion is a separate final step and never broadcasts a transaction.
