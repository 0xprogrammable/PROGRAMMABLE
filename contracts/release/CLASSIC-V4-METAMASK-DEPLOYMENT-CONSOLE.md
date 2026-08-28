# Classic V4 MetaMask deployment console

This localhost console executes only the four exact transactions in a sealed Classic V4 preparation plan. It never reads a private key, signs on the server, or broadcasts without the operator clicking the page action and confirming in MetaMask.

## Prepare the release inputs

Run the focused test first:

```bash
npm run contracts:classic-v4:mainnet:metamask:test
```

The preparation plan binds the clean Git commit and tree. Generate a new plan only after the final release commits have landed, from that clean checkout:

```bash
npm run contracts:classic-v4:mainnet:prepare -- \
  --deployer <human-wallet-address> \
  --write \
  --output </absolute/real-directory/classic-v4-plan.json> \
  --wallet <same-human-wallet-address> \
  --acknowledge-plan-digest <fresh-plan-digest>
```

Choose an absolute transaction hash path outside the repository. Its parent directory must already exist and must not be a symlink. The file itself may be absent; the console creates it after both RPCs see the first submitted transaction.

## Check, then run

The command line check performs the sealed fresh build, dual RPC Mainnet checks, nonce and vacancy checks, and two live simulations without opening a server:

```bash
npm run contracts:classic-v4:mainnet:metamask:check -- \
  --plan </absolute/real-directory/classic-v4-plan.json> \
  --transactions </absolute/real-directory/classic-v4-transactions.json>
```

Start the local console with the same paths:

```bash
npm run contracts:classic-v4:mainnet:metamask -- \
  --plan </absolute/real-directory/classic-v4-plan.json> \
  --transactions </absolute/real-directory/classic-v4-transactions.json>
```

Open the printed `http://127.0.0.1:4179` URL. Connect the exact plan deployer on Ethereum Mainnet. For each of the four steps, review the sender, nonce, destination or contract creation, predicted address, `0 ETH`, full calldata, calldata hash, two gas estimates, fee caps, and maximum gas debit. The next step stays locked until both RPCs agree on the prior transaction, canonical receipt, predicted address, and normalized runtime template.

The external JSON file remains directly compatible with `contracts:classic-v4:mainnet:deployment:verify`:

```json
{
  "hookFactory": "<transaction-hash>",
  "feeHook": "<transaction-hash>",
  "positionPlanner": "<transaction-hash>",
  "launcher": "<transaction-hash>"
}
```

If MetaMask returns a hash but the local record request later fails, do not submit the transaction again. Add that displayed hash under the exact next contract key in the external JSON file, then restart the console. Both RPCs will still revalidate the transaction, receipt, nonce, calldata, gas caps, predicted address, and runtime before another step can unlock.

After all four receipts reach 12 confirmations, the console runs the existing fixed block verifier across both RPCs and displays its evidence digest. Source publication, lifecycle canary actions, indexer activation, and production release remain separate owner controlled gates.

## Browser QA mode

For screenshot and keyboard QA with a real preparation plan, run:

```bash
npm run contracts:classic-v4:mainnet:metamask -- \
  --plan </absolute/real-directory/classic-v4-plan.json> \
  --ui-check
```

This mode uses the plan's actual four addresses, nonces, calldata, and hashes but clearly labels gas fields as UI check values. Wallet access, RPC requests, transaction recording, and signing are disabled.
