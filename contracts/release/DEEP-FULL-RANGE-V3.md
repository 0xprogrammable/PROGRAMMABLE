# Deep

Deep V3 is the internal release line for the Deep launch model. It is not deployed or enabled.

The reviewed infrastructure uses six broadcaster transactions and resolves nine contract runtimes:

1. zap planner
2. growth vault factory, which creates the vault implementation
3. hook factory
4. fee and oracle hook through the factory's CREATE2 deployment
5. launcher, which creates the position planner and automation contract
6. keeper executor

The public product name remains Deep. V3 is only a source and release identifier.

The checked-in release binds the deployed UERC20 v2.0.0 factory to deployment source commit `de5bacd`,
the reviewed dependency pin `6f18f1c` and its exact Mainnet runtime hash.

## Local release check

```sh
node contracts/scripts/verify-deep-full-range-release-v3-manifest.mjs --offline
node --test contracts/scripts/test/deep-full-range-release-v3.test.mjs
node ops/deep-keeper-v3/verify-ops-v2-source-binding.mjs
```

The offline check binds all nine creation bytecodes, fixed policy values, official Ethereum dependencies and the
six-transaction graph to the release manifest. The ops check hashes the exact reviewed keeper route, storage,
configuration, control, execution, Privy and release-gate source bytes. It also commits a canonical projection of
the exact Deep build scripts, five-minute cron and complete resolved runtime dependency closure, including every
reachable package path, version, tarball and integrity hash. Unrelated scripts and packages are excluded. The
production build fails if the reviewed projection or any bound source byte differs from
`ops-v2-source-binding.json`. Neither check makes a deployment claim.

## Read-only Ethereum simulation

Set `ETHEREUM_RPC_URL`, `DEEP_V3_MAINNET_DEPLOYER` and a reviewed `DEEP_V3_HOOK_SALT`, then run:

```sh
node contracts/scripts/simulate-deep-full-range-v3-mainnet.mjs
```

This reads the pending deployer nonce, rejects occupied targets and runs the Foundry script without `--broadcast`.
The hook salt must resolve to the exact v4 permission bitmap.

## Receipt capture

After a separately approved deployment, provide two independent Ethereum RPCs and the six transaction hashes:

```sh
DEEP_V3_ZAP_PLANNER_TRANSACTION=0x... \
DEEP_V3_GROWTH_FACTORY_TRANSACTION=0x... \
DEEP_V3_HOOK_FACTORY_TRANSACTION=0x... \
DEEP_V3_FEE_HOOK_TRANSACTION=0x... \
DEEP_V3_LAUNCHER_TRANSACTION=0x... \
DEEP_V3_KEEPER_EXECUTOR_TRANSACTION=0x... \
node contracts/scripts/capture-deep-full-range-v3-release.mjs
```

The default command prints a candidate. Add `--write` only after reviewing it. Capture requires successful
12-confirmation receipts, consecutive nonces, exact transaction inputs, two-RPC agreement, all nine
artifact-bound runtimes and empty EIP-1967 implementation, admin and beacon slots.

## Local operator flow

The deployment and canary consoles bind only to localhost. Their default mode is read-only and prints the exact
reviewed request. The browser wallet flow is enabled only by appending an explicit `--write`; the server never
holds a key, signs a transaction or exposes a broadcast endpoint.

```sh
npm run contracts:deep-v3:operator:deploy
npm run contracts:deep-v3:operator:deploy -- --write

npm run contracts:deep-v3:operator:canary
npm run contracts:deep-v3:operator:canary -- --write
```

The canary launch uses 0.0006 ETH and cannot by itself reach the 0.002 ETH minimum compound amount. At a 0.9%
growth allocation, reaching that threshold requires roughly 0.2223 ETH of taxable gross trading volume, and
slightly more after integer rounding. The operator therefore stops at `waitFees` until onchain state reports an
eligible compound. Launching and waiting for the 30-minute oracle window is not sufficient.

After the oracle is mature, the separate trade console can prepare bounded canary volume:

```sh
npm run contracts:deep-v3:operator:canary-trades
npm run contracts:deep-v3:operator:canary-trades -- --write
```

The default command is read-only. The explicit wallet mode prepares one action at a time and never broadcasts
from the server. Every action is re-quoted against one block agreed by two independent RPCs, bound to the
original PoolId and checked against pinned runtime hashes. Buy and sell volume is limited to 0.0001–0.025 ETH
of native notional per transaction, quote impact is capped at 5%, execution slippage at 1%, and the deadline at
five minutes. Sells use exact-amount token and Permit2 approvals as separate wallet actions. There is no loop,
automatic submission or lifecycle-evidence write. Once the compound threshold is available, further canary
trades are blocked.

After the launch, oracle-growth and productive keeper transactions each have 12 confirmations, capture the
current-release lifecycle on two independent archive-capable RPCs:

```sh
npm run contracts:deep-v3:lifecycle:capture
npm run contracts:deep-v3:lifecycle:capture:write
```

The dry command prints the candidate evidence and manifest patch. Only the explicit write command can create
`contracts/deployments/evidence/deep-full-range-mainnet-canary-v3.json` or update the lifecycle binding.

## Live eligibility

```sh
node contracts/scripts/verify-deep-full-range-release-v3-manifest.mjs --require-live
```

The live gate stays closed until:

- all six deployment receipts match;
- all nine contracts have exact Etherscan source verification and a Sourcify v2 `match`;
- two RPCs agree on runtimes, constructor bindings and deployment blocks;
- a current-release canary proves launch, oracle maturation and atomic same-pool compounding;
- one idle keeper cycle submits no transaction and one actionable cycle compounds successfully;
- the reviewed keeper binding matches the exact automation and keeper executor runtimes;
- the dedicated Privy policy wallet is configured;
- keeper ops v2 is activated with a durable fair cursor, 32-vault pages, at most two pages per five-minute slot,
  up to four candidates per transaction, one new submission per slot, 12 confirmations and two independent read
  RPCs;
- the dedicated signer, deployment commit, contract source commitment, keeper source commitment and economic
  limits match the reviewed manifest and binding;
- `VERCEL_GIT_COMMIT_SHA`, the configured deployment commit, the contract release commit, the reviewed binding
  and the keeper policy identify the same 40-character commit;
- the source commitment embedded in the built route matches the deterministic reviewed ops allowlist;
- the legacy Deep V3 writer is disabled and its expired control record was migrated without an unresolved pending
  transaction or operator incident.

The current Mainnet-fork measurement for one compound candidate is `2,884,090` gas against a reviewed per-vault
ceiling of `4,428,255`. The exact four-candidate envelopes are `7,870,636` gas for four oracle actions,
`10,308,732` for one compound plus three oracle actions, `12,746,828` for two plus two, `15,184,924` for three plus
one, and `17,623,020` for four compound actions. The operational transaction and per-slot gas caps are both
`18,000,000`.

Pending manifests keep both keeper flags disabled. The terminal
`deployment-source-lifecycle-and-keeper-verified` state requires both flags to be enabled and the application,
keeper and transaction submission gates to be ready. Deployment, source submission, canary funding, keeper
activation and app publication are separate operator actions.

The reviewed binding is promoted only through:

```sh
npm run contracts:deep-v3:keeper-binding:promote
npm run contracts:deep-v3:keeper-binding:promote:write
```

The first command is local and read-only. The explicit write command verifies a temporary candidate against two
Mainnet RPCs, Etherscan, Sourcify, lifecycle evidence, the exact source allowlist and the deployment commit before
it can update the local manifest and binding. It never deploys a contract, signs a transaction or sends funds.

The compiler intentionally omits CBOR metadata. The release therefore never claims a legacy Sourcify
`exact_match` or `full_match`; it records the canonical v2 contract lookup
`https://sourcify.dev/server/v2/contract/1/{address}` with status `match`. Exact creation inputs, runtime
hashes and the source commitment remain separate release evidence.

The Etherscan gate parses both wrapped and unwrapped standard JSON. It requires the complete submitted source
set and every source byte, including comments, to match the local release input and artifact source hashes.
Optimizer settings, `cancun`, `viaIR`, libraries, remappings, output selection, `bytecodeHash: none` and
`appendCBOR: false` must also match the exact input generated by the pinned Foundry build.
