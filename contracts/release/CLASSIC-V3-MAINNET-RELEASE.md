# Classic Mainnet release

Status: tested release candidate, not deployed.

Classic V2 remains the historical Mainnet release. Its immutable launcher-fee
recipient cannot be changed. This candidate deploys a new Classic stack and
routes the fixed 10-basis-point Programmable share directly to the revenue
wallet:

`0x4957f49620AFf3Adbbe8195a4f633E49cc93376c`

The website and production manifest remain disabled until the new contracts
are deployed, source verified and exercised on Mainnet.

## Bound release

- Network: Ethereum Mainnet
- Deployer: `0x2Bb333d48DFAF1596D9036671d2E43168994249E`
- Launcher fee recipient: `0x4957f49620AFf3Adbbe8195a4f633E49cc93376c`
- Source commitment:
  `0x58991ed1743aaba5f1988a4576d36eb10af70b96bdb61661ba96e1f80acc9800`
- Transactions: seven
- ETH value transferred by infrastructure deployment: zero

The checked-in candidate plan is a simulation snapshot. Its nonce and
predicted addresses are not reserved. Regenerate the entire plan immediately
before any signature.

## Revenue path

1. Classic swaps accrue the fixed Programmable share as native currency in
   `EthCreatorFeeHookV3`.
2. The hook permits only its immutable `launcherFeeRecipient` to call
   `claimLauncherFees()`.
3. The revenue wallet initiates its own claim.
4. Uniswap v4 `PoolManager` redeems the exact native amount directly to that
   wallet.

No keeper or Deep launch-model contract participates in this path.

## Candidate snapshot

The latest checked-in simulation used block `25,639,328`, deployer nonce `87`
and estimated `21,955,928` gas across all seven transactions. The predicted
addresses and CREATE2 salt are recorded in
`deployments/mainnet-classic-v3.json`.

This snapshot is evidence of deterministic construction, not permission to
broadcast. A changed nonce requires a new simulation, addresses and hook salt.

## Verification

Run:

```sh
forge test --match-contract DeployClassicV3InfrastructureV1MainnetTest --offline
forge test --match-contract ClassicV3MainnetForkTest --offline
node scripts/verify-classic-v3-release-manifest.mjs --network=mainnet
```

The fork lifecycle uses the official Mainnet PoolManager, PositionManager,
Universal Router, Permit2, Quoter, UERC20 factory and position-forwarder
factory. It launches a token, buys, sells, claims creator rewards, rejects a
direct launcher-fee claim from an arbitrary caller, then pays the exact
launcher fee to the immutable revenue wallet.

## Remaining release gates

- Refresh the candidate against the current confirmed and pending nonce.
- Simulate the exact final commit through two independent Mainnet RPCs.
- Review and sign each transaction explicitly.
- Wait for final receipts and verify every runtime and immutable binding.
- Verify all new contract sources and constructor arguments.
- Run a small-value Mainnet launch, buy, sell, creator claim and launcher claim.
- Finalize the production manifest and only then enable the website.

No local test, fork result or dry run completes these live gates.
