# Protocol fee claim

Private local interface for claiming native ETH and stock-asset protocol revenue to the immutable Programmable treasury.

## Run

From the repository root:

```sh
python3 -m http.server 4178
```

Open:

```text
http://127.0.0.1:4178/ops/protocol-fee-claim/
```

The page verifies each hook's `launcherFeeRecipient()` before enabling a claim. It sends one direct claim transaction per non-empty hook or quote asset because the current contracts require the treasury EOA to be `msg.sender`.

No private key or seed phrase is read, stored or transmitted. MetaMask signs and broadcasts every transaction.
