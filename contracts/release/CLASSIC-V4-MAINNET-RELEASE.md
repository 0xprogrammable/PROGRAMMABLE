# Classic V4 Mainnet release

Classic V4 is an additive five-contract release:

1. `EthCreatorFeeHookFactoryV4`
2. `EthCreatorFeeHookV4`
3. `ClassicPositionPlannerV1`
4. `ClassicGraduationVaultFactoryV1`
5. `MemeLaunchV3`

The existing Classic V3 authority, reward-vault factory, initial-buy custody factory, launch policy and permanently locked position-forwarder factory are reused only at their exact Mainnet addresses, runtime hashes and immutable bindings.

There is intentionally no checked-in `contracts/deployments/mainnet-classic-v4.json` yet. That canonical file may be created only from finalized deployment receipts, exact source verification and a complete lifecycle canary. A local build or simulation is not a deployment or live proof.

## Local gate

```bash
npm run contracts:classic-v4:release:test
```

The release tooling requires Node.js 24 or newer and a clean named Git revision. Preparation rejects inherited `FOUNDRY_*`, `DAPP_*`, `REMAPPINGS` and compiler override variables, then performs a forced offline build with an allowlisted environment, explicit tracked config and fresh temporary output/cache directories. Artifacts are loaded only from that temporary output; ignored `contracts/out` bytes are never a release authority. Every downstream deployment, source, canary, lifecycle and capture CLI repeats the same sealed fresh build and validates its plan against those exact artifacts. Every local dependency must be its own clean Git checkout with exact pinned `HEAD` and `origin` before and after compilation. The plan commits the tracked source-pins digest, artifact digest, and the exact compiler-metadata dependency source paths and hashes.

## 1. Read-only deployment preparation

```bash
npm run contracts:classic-v4:mainnet:prepare -- \
  --deployer <human-wallet-address>
```

This command:

- reconciles two independent Ethereum Mainnet RPCs;
- verifies all official and reused dependency runtime hashes and bindings;
- requires no pending deployer nonce;
- derives the five exact transaction payloads and predicted addresses;
- mines and verifies the required hook flags;
- binds artifact creation/runtime templates, constructor arguments, treasury, economics, Git commit and tree; and
- prints a `simulation-only` plan without writing, signing or broadcasting.

To preserve the reviewed bytes outside the repository, rerun with an existing absolute output directory, the same explicit wallet and the digest printed by a fresh check:

```bash
npm run contracts:classic-v4:mainnet:prepare -- \
  --deployer <human-wallet-address> \
  --write \
  --output </absolute/outside-repository/classic-v4-plan.json> \
  --wallet <same-human-wallet-address> \
  --acknowledge-plan-digest <printed-plan-digest>
```

This local write still does not authorize or perform a transaction. The owner must review the plan and explicitly sign the five transactions with their wallet. Never pass a private key or mnemonic to these tools.

## 2. Read-only finalized deployment verification

After the owner has submitted the reviewed transactions, create an external JSON file containing exactly these five transaction hashes:

```json
{
  "hookFactory": "<actual-transaction-hash>",
  "feeHook": "<actual-transaction-hash>",
  "positionPlanner": "<actual-transaction-hash>",
  "graduationVaultFactory": "<actual-transaction-hash>",
  "launcher": "<actual-transaction-hash>"
}
```

Choose a fixed block at least 12 confirmations after all five receipts and run:

```bash
npm run contracts:classic-v4:mainnet:deployment:verify -- \
  --plan </absolute/classic-v4-plan.json> \
  --transactions </absolute/classic-v4-transactions.json> \
  --verification-block <finalized-block-number>
```

The verifier checks both RPCs at that exact block, receipt success, sender, nonce, destination, zero value, calldata hash, predicted addresses, normalized source runtime, exact deployed runtime hashes and every new/reused constructor binding. Every distinct receipt block is fetched independently from both RPCs, and the transaction and receipt block number/hash must match that canonical header. Its evidence follows `contracts/deployments/schema/classic-v4-deployment-evidence-v1.schema.json`.

Evidence can be saved outside the repository only with `--write`, `--output`, the matching human wallet and `--acknowledge-evidence-digest` from a fresh check.

## 3. Source verification

All five new addresses must have a public source match. Exact local runtime-template and constructor checks remain mandatory independently of provider labels. Source evidence must bind:

- the preparation `planDigest` and `sourceCommitment`;
- exact address, contract name and fully qualified source name;
- exact ABI-encoded constructor arguments from the plan;
- deployment transaction and block; and
- provider name, exact-match status and public URL.

After an owner has separately published the exact sources, capture the public matches without changing provider state:

```bash
npm run contracts:classic-v4:mainnet:sources:verify -- \
  --plan </absolute/classic-v4-plan.json> \
  --deployment-evidence </absolute/classic-v4-deployment-evidence.json>
```

Sourcify is required and the v2 lookup explicitly requests `fields=sources`; all returned match fields must be `exact_match`. Its exact source-path set and every returned source byte string must hash to the sealed artifact metadata closure. A default/minimal payload without `sources` fails closed. If `ETHERSCAN_API_KEY` is present, Etherscan must return Solidity Standard JSON with the same exact path/content hashes; compiler settings, fully qualified identity and constructor arguments are also checked, and a non-empty `SimilarMatch` is rejected. A provider label or non-empty source body alone is insufficient. The key is never printed. Saving evidence remains an explicit external-path `--write --output ... --wallet ...` operation. The tool does not submit source code.

The required object is `$defs.sourceEvidence` in `contracts/deployments/schema/classic-v4-release-v1.schema.json`. Publishing source to a provider is an external action and is not performed by this repository tooling.

## 4. Canonical Router handoff and lifecycle canary

The launcher is intentionally Mainnet Router-only. Before a lifecycle canary can be prepared, the external permit
authority must produce an exact, time-bounded signature for the canonical Router
`0x8622DD5bAb44185f2A458ac90384Ac99248f8d56` and its `launchAndStampV1` call. Direct launcher calldata is invalid and
does not establish Programmable provenance.

The current repository does not contain that external authority service. Accordingly, the canary preparation command
fails closed after verifying deployment and source evidence until a permit-authority-signed Router handoff artifact is
integrated and independently validated. This is a real release blocker, not a local test failure.

After that handoff integration is installed, the lifecycle remains:

Once deployment and source evidence are verified:

```bash
npm run contracts:classic-v4:mainnet:canary:prepare -- \
  --plan </absolute/classic-v4-plan.json> \
  --deployment-evidence </absolute/classic-v4-deployment-evidence.json> \
  --source-evidence </absolute/classic-v4-source-evidence.json> \
  --rpc-a <https-rpc-one> \
  --rpc-b <https-rpc-two> \
  --wallet <human-canary-wallet>
```

Before constructing a wallet-bound plan, preparation reruns the fixed-block deployment verifier on both RPCs and independently refetches the committed source-provider matches. Saved source timestamps later than the fresh replay are rejected. The preparation is read-only. It binds a small Bonding launch with non-minimum buy/sell fees so both claim paths become non-zero, then requires:

1. launch;
2. buy exact-input;
3. buy exact-output;
4. sell exact-input;
5. sell exact-output;
6. creator reward-vault claim; and
7. launcher treasury claim.

The plan fixes the canary name, symbol, canonicalized deterministic creator salt, metadata, `0.0006 ETH` activation buy, beneficiary, fees and Bonding preset. It also caps all four swap amounts before any signature, pins the D92 Mainnet Universal Router to its V2.0 five-field single-hop ABI, fixes 1% slippage and a five-minute deadline policy, and requires the canonical V4Quoter at each transaction's parent block.

Save the exact plan outside the repository only through a second acknowledged run:

```bash
npm run contracts:classic-v4:mainnet:canary:prepare -- \
  --plan </absolute/classic-v4-plan.json> \
  --deployment-evidence </absolute/classic-v4-deployment-evidence.json> \
  --source-evidence </absolute/classic-v4-source-evidence.json> \
  --rpc-a <https-rpc-one> \
  --rpc-b <https-rpc-two> \
  --wallet <human-canary-wallet> \
  --write \
  --output </absolute/classic-v4-canary-plan.json> \
  --acknowledge-plan-digest <fresh-canary-plan-digest>
```

Preparing the plan does not fund, approve, sign or run the canary. After the two human wallets have submitted the seven reviewed actions, record only their actual hashes in an external file:

```json
{
  "launch": "<transaction-hash>",
  "buyExactInput": "<transaction-hash>",
  "buyExactOutput": "<transaction-hash>",
  "sellExactInput": "<transaction-hash>",
  "sellExactOutput": "<transaction-hash>",
  "creatorClaim": "<transaction-hash>",
  "launcherClaim": "<transaction-hash>"
}
```

Each action must be included in a distinct increasing block so historical pre/post-claim state is unambiguous. At a fixed block with at least 12 confirmations, run the read-only verifier against two independent credential-free HTTPS RPC hosts:

```bash
npm run contracts:classic-v4:mainnet:canary:verify -- \
  --plan </absolute/classic-v4-plan.json> \
  --deployment-evidence </absolute/classic-v4-deployment-evidence.json> \
  --source-evidence </absolute/classic-v4-source-evidence.json> \
  --canary-plan </absolute/classic-v4-canary-plan.json> \
  --transactions </absolute/classic-v4-canary-transactions.json> \
  --verification-block <fixed-finalized-block> \
  --rpc-a <https-rpc-one> \
  --rpc-b <https-rpc-two>
```

The standalone verifier first reruns and compares the same deployment and provider prerequisites; self-digested JSON cannot set `releaseEligible`. It then reconstructs all seven transaction inputs, receipts, canonical blocks and required logs; requotes all four quadrants through V4Quoter at their parent blocks; proves the D92 V2.0 calldata, exact slippage bounds, Permit2 sell allowances, reward-vault beneficiary claim, treasury claim, global zero fee baseline, absence of foreign hook activity, conservation, pool/vault provenance and permanent position lock. It reconciles the complete evidence digest across both RPCs. Saving evidence remains a second explicit external-path `--write --output ... --wallet ... --acknowledge-evidence-digest ...` operation.

## 5. Canonical manifest and indexer handoff

After the lifecycle evidence satisfies `$defs.lifecycleEvidence`, preview the canonical manifest:

```bash
npm run contracts:classic-v4:mainnet:capture -- \
  --plan </absolute/classic-v4-plan.json> \
  --deployment-evidence </absolute/classic-v4-deployment-evidence.json> \
  --source-evidence </absolute/classic-v4-source-evidence.json> \
  --canary-plan </absolute/classic-v4-canary-plan.json> \
  --transactions </absolute/classic-v4-canary-transactions.json> \
  --lifecycle-evidence </absolute/classic-v4-lifecycle-evidence.json> \
  --verification-block <same-fixed-finalized-block> \
  --rpc-a <https-rpc-one> \
  --rpc-b <https-rpc-two>
```

Capture first reconstructs the five deployment transaction hashes from the saved evidence, rejects duplicates, and reruns the deployment verifier against both independent RPCs at the evidence's fixed `verificationBlock`. The canonical block hash, receipts, transaction inputs, constructor/runtime bindings and hashes of the exact runtime bytes returned by `eth_getCode` must equal the saved deployment evidence. Capture then independently queries Sourcify and, when present in the saved evidence, Etherscan; the exact provider/source content must match and the saved observation time cannot be later than the fresh replay. Finally it reruns the complete seven-transaction lifecycle verifier against both RPCs and requires exact canonical equality. A locally fabricated evidence digest cannot reach manifest creation. Only a fresh second run with `--write`, the exact printed manifest digest and the matching deployment wallet may create `contracts/deployments/mainnet-classic-v4.json`. Existing manifests are never overwritten.

All Classic V4 artifact digests commit to a named domain and a typed canonical serialization. Preparation plan, deployment evidence, source evidence, release binding, lifecycle canary plan, lifecycle evidence and release manifest each use a different `programmable.classic-v4.*.v1` domain. Numbers, strings and big integers cannot collide, object keys are sorted, and hexadecimal values are case-canonicalized before hashing.

The manifest exposes `indexerHandoff` with exact `classic-v4` launcher/hook addresses, individual start blocks and event lists. Initially:

- `releaseStatus` is `deployment-source-and-lifecycle-verified`;
- `activationEligible` is `true`;
- `indexerBindingDigest` is `null`;
- `activated` and `verification.indexerActivated` are `false`; and
- `verification.publicAvailable` is `false`.

The launcher handoff contains exactly `MemeTokenLaunchedV2`, `MemeLiquidityConfiguredV2`, `MemeCreatorInitialBuyV2` and `MemeCreatorInitialBuyCustodyV2`. The fee-hook handoff contains exactly `PoolRegistered`, `PoolFeeDisclosure`, `NativeSwapFeesAccrued`, `CreatorFeesClaimed` and `LauncherFeesClaimed`. `HookFee` and `HookSwap` remain lifecycle receipt checks but are not committed as indexer sources until an activated indexer actually handles them. The manifest schema rejects missing, additional or reordered handoff events.

The integration owner must activate those exact sources and prove indexed canary parity. Activation requires the separately reviewed expanded Envio release binding, commits its canonical digest as `indexerBindingDigest`, derives a new `indexer-activated` manifest, and recomputes the final manifest digest. The catalog and browser bindings point to that final digest, never the base capture digest. Supporting files are replaced first and the canonical manifest is the last commit point, so an interrupted write remains fail-closed. Public availability is a later, separate `publicly-available` transition. Deployment, source verification, lifecycle verification, indexer activation and website availability remain separate states.

## Owner and external gates

Local completion does not perform or prove:

- wallet approval, signing, gas spend or deployment;
- Mainnet finality before actual receipts exist;
- Etherscan/Sourcify publication or exact-match status;
- funded Mainnet lifecycle actions and claims;
- Uniswap Labs hook routing allowlisting;
- indexer activation and canary parity; or
- production website activation and browser availability.
