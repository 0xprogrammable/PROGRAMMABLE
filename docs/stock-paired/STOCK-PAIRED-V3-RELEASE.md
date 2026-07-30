# Stock-Paired V3 release

Stock-Paired V3 changes the starting-price policy without changing the
user-facing model name. New launches remain unavailable until every release
gate below has passed and a separate activation change is reviewed.

## Price policy

The release targets Classic's exact 1.355657760817103798 ETH initial FDV. It
does not promise a fixed dollar market cap: the exact USD value moves with ETH
and the selected quote asset.

V3 supports exactly six reviewed quote assets. Each asset has one immutable
absolute start tick, aligned to tick spacing 200. A missing asset or tick must
revert. QQQ is not configured for V3.

The checked-in calibration is a pinned pool midpoint at Ethereum block
25,642,460 plus an independent underlying-price cross-check. It is not an
oracle. Immediately before activation, the release operator must capture a
fresh quote-to-ETH midpoint and an independent underlying-derived midpoint for
every asset. The verifier recomputes the ETH FDV implied by each immutable tick.
All six must remain within 500 basis points of the Classic target, and every
route midpoint must remain within 300 basis points of its independent
reference. RPC state, market-session status and reference retrieval must be
newer than 15 minutes. While the relevant US sessions are closed, a last-trade
price may be up to four hours old only when the capture freshly proves that the
current time falls between the official extended-session close and next open.
Missing data, conflicting data or any threshold breach blocks activation.

The activation artifact binds two distinct Ethereum RPC observations of the
same block and raw pool state. It pins every pool address, fee, runtime code
hash, token order, decimal count and `sqrtPriceX96`, then recomputes TickMath,
quote FDV and ETH FDV with integer arithmetic. Independent references must name
their provider, instrument, observation time and reference ID. The canonical
payload SHA-256 must match both the evidence file and release manifest; changing
any field after review invalidates the gate.

## Release boundary

V1 and V2 deployments remain immutable historical releases. Their launches,
trades and rewards must remain discoverable by launcher and hook address.
Only V3 may become the destination for new Stock-Paired launches.

## Deployment and signing sequence

1. Freeze the exact source commit and generate the V3 release plan.
2. Revalidate Ethereum chain ID, deployer nonce, treasury, official Uniswap
   runtime hashes, Ondo runtime hashes, quote routes and all six quote/tick
   pairs against two independent RPCs.
3. Review the complete transaction list before the first signature. Any nonce,
   calldata, address, runtime or gas-envelope drift invalidates the plan.
4. Sign each deployment transaction in nonce order. After every transaction,
   wait for the receipt and verify the deployed runtime before preparing the
   next signature.
5. Capture a manifest containing deployment transactions, blocks, runtime
   hashes, constructor arguments, source commitment and the exact six quote/tick
   pairs.
6. Verify sources, then complete one ETH-first canary lifecycle: launch,
   permanent position custody, buy, sell, creator claim and launcher claim.
7. Recheck the completed evidence with two independent RPCs.
8. Capture the final pricing evidence and run
   `npm run contracts:stock-paired-v3:price-gate`. This must happen no more
   than 15 minutes before the activation review.
9. Keep public launches disabled. Activation is a separate, reviewable change.

### Pricing capture

The capture command reads exactly two Ethereum RPCs and the reviewed
independent-reference file:

```bash
ETHEREUM_RPC_URL=https://rpc-a.example \
ETHEREUM_RPC_URL_B=https://rpc-b.example \
npm run contracts:stock-paired-v3:price-capture
```

The two URLs must be independently operated. The reference file is
`contracts/deployments/evidence/stock-paired-v3-independent-references.json`.
It must contain exactly NVDA, SPY, GOOGL, SLV, TSLA and AAPL in release order,
with the provider, venue, instrument, USD price, trade time, retrieval time and
provider reference ID for each observation. Retrieval and market-session
observation must be within the 15-minute window. During a freshly proven closed
session, the last trade alone may be up to four hours old. The gate also binds
the official NASDAQ and NYSE Arca schedule sources, the prior extended-session
close and next eligible open. It fails automatically at that next open.

The command is a dry run by default. After reviewing its output, add `--write`
through `npm run contracts:stock-paired-v3:price-capture:write` to commit the
canonical evidence hash to the local release manifest. Writing evidence does
not deploy, sign or activate anything.

## Fail-closed activation gate

The application must return no V3 launch release unless all of the following
are true:

- the manifest identifies `stock-paired-v3` on Ethereum Mainnet
- every required address, deployment transaction and runtime hash is present
- the treasury and official dependency addresses match their pinned values
- the six quote assets and start ticks exactly match the reviewed config
- fresh pricing evidence proves all six implied ETH FDVs are within 500 basis
  points of 1.355657760817103798 ETH
- every route quote midpoint is within 300 basis points of an independently
  derived underlying midpoint
- source verification is complete
- lifecycle evidence is current and release-eligible
- the launch coordinator is bound to the verified V3 launcher

Public launch access remains hard-disabled even after those checks. It requires
one final activation change after the release evidence is reviewed.

## Rollback

Contracts are immutable and cannot be rolled back. Before activation, rollback
means discarding the V3 candidate and leaving V2 history readable. After
activation, rollback means disabling new V3 launch preparation in the
application while keeping existing V3 tokens, trading and rewards indexed.
The app must never silently fall back to an older launcher for new transactions.
