# Robinhood Custom Launch V1 security and deployment boundary

Review date: 2026-08-29

This record covers the chain-4663 deployment foundation for the recovered
`ProgrammableLaunchStampRouterV1`, the current
`ProgrammableCreate2GraphDeployerV1`, and a new Safe 1.4.1 permit authority. It
is internal engineering evidence, not an audit, a deployment claim, a source-
verification claim, or evidence that any launch is safe or tradable.

The checked-in state is **prepared, not broadcast**. No private key, wallet
signature, transaction submission, or source-publication request is performed
by the preparation code.

## Frozen deployment unit

| Binding         | Prepared address                             | Required identity                                                                                                |
| --------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| PermitAuthority | `0xeD617CE7f82e2AB589aDeFFD319D1D872Bc8De06` | Safe 1.4.1 proxy plus exact singleton, owners, threshold, fallback handler, modules and guard state              |
| GraphFactory    | `0x0B6b3F40f84Df25D3bd69238f937096177DD09Bd` | current `ProgrammableCreate2GraphDeployerV1` runtime `0xd23692fa...0018b8`                                       |
| Router          | `0x34965F2A2ee9254522232C32F02056E92BE0C98a` | recovered Router V1 with chain-4663 authority, factory and PoolManager immutables; runtime `0x1dbbdaaa...817388` |
| PoolManager     | `0x8366a39CC670B4001A1121B8F6A443A643e40951` | official Uniswap chain-4663 binding and runtime `0xbd388118...95626`                                             |

The Router source is byte-identical to the source at disconnected public commit
`0a7134bbb912222639627fb9078df2f8dd3a6c38` (tree
`24ffb0c6b04af7993254560b4f03608de8f52231`). The current GraphFactory source
was introduced at `518fd05066edeb6017db995af520819151173a3b`.
The source hashes, compiler identity, creation-code hashes, salts, runtime hashes
and exact external bindings are recorded in
`spec/robinhood-custom-launch/chain-4663.v1.json`.

The product route on Robinhood is **CustomGraph only**. The recovered Router
also contains a Classic path, but current `MemeLaunchV3` and `MemeLaunchV4`
hardcode the Ethereum Router. They fail the Router's `launcher.ROUTER() ==
address(this)` check on chain 4663. Classic must remain unadvertised and must
not receive permits unless a separate chain-bound launcher is built and
reviewed.

## Atomic no-broadcast preparation

One owner transaction targets canonical Multicall3 at
`0xcA11bde05977b3631167028862bE2a173976CA11`. Its live Robinhood runtime is
3,808 bytes with hash `0xd5c15df6...e770891`, byte-identical to the canonical
same-address Ethereum runtime. The transaction has:

```text
chainId       4663
to            0xcA11bde05977b3631167028862bE2a173976CA11
value         0
function      aggregate3((address,bool,bytes)[])
selector      0x82ad56cb
calldata      33,412 bytes
calldata hash 0x3ba04469085b17e12843a94c154a335c9c384837f8f6531f179cb4915fd237d9
```

Its three decoded subcalls are ordered as SafeProxyFactory, deterministic
GraphFactory deployment, deterministic Router deployment. Every subcall has
`allowFailure = false`; the fork test forces the third call to fail after the
first two succeed and proves that neither earlier deployment survives. The
component calls are review material, not three wallet actions.

At pinned Robinhood block `49,220,000` (`0xabc4e2a6...120025`), the complete
owner transaction used 7,009,707 execution gas inside the fork harness. A
separate live `eth_estimateGas` observation between blocks `49,228,085` and
`49,228,090` returned 7,169,706 including transaction overhead. Gas, sender
nonce and fee fields must be refreshed immediately before signing; they are not
baked into the calldata commitment.

The only owner choice in the preparation interface is
`ROBINHOOD_CUSTOM_LAUNCH_DEPLOYER`, which must equal one of the two observed
Ethereum authority owners. The script rejects every other value. It never
calls `vm.startBroadcast`, reads a key, signs, or submits. The owner still has
one external action: select the sender, review the chain/to/value/data and live
gas envelope, then sign and broadcast the single transaction.

## PermitAuthority boundary

The Ethereum authority at `0x755509eA6e3F5Ec1aA2E797bb68f1B87DD8b886b`
is a canonical Safe 1.4.1 proxy. At Ethereum block `25,861,371` its exact
configuration was:

- ordered owners `0x032b1c7b96793717F0BD2f11eb86cd10CdefC4a3` and
  `0x2Bb333d48DFAF1596D9036671d2E43168994249E`;
- threshold `1`;
- singleton `0x41675C099F32341bf84BFc5382aF534df5C7461a`;
- CompatibilityFallbackHandler
  `0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99`;
- no modules, zero guard and Safe transaction nonce `2`.

Threshold one means either owner can authorize independently. This is not a
two-signature quorum and must not be described as one. The second owner address
had an EIP-7702 delegation designator at the observation block, so the owners
must be described as Safe owner addresses, not assumed to be two code-empty
EOAs. Contract-signature or delegated-account use adds nested authority
semantics that the operator must review.

The prepared Robinhood Safe is a **new authority identity** initialized directly
to that current governance configuration with a fresh nonce of zero. It does not
replay the historical one-owner Ethereum creation, later owner changes or
transaction history at the same address. This deliberate one-transaction design
produces `0xeD617C...De06`; it does not claim cross-chain address equality with
the Ethereum authority.

Router V1 pins only the Safe proxy runtime. That hash does not bind the
singleton, owners, threshold, fallback handler, modules, guard or storage. A
changed handler can redefine ERC-1271 behavior without changing proxy runtime;
removing the handler prevents Router permits from validating. The postdeploy
validator therefore requires all of the following at one explicit block:

- proxy, singleton and handler runtime hashes;
- `VERSION() == "1.4.1"` and exact `masterCopy()`;
- exact ordered owners and threshold one;
- nonce zero immediately after foundation deployment;
- empty `getModulesPaginated(0x1, 16)` result;
- zero guard storage slot and exact fallback-handler storage slot.

Any later authority state change is a governance event. Production admission
must re-read and policy-check Safe state, not rely only on the deployment
receipt or Router's captured proxy hash.

Safe permit validation uses ERC-1271 through the CompatibilityFallbackHandler.
Application code must build the Safe message digest according to the handler's
Safe-message convention; it must not assume that owners sign only the raw
Router EIP-712 digest. Signature ordering and contract-signature rules remain
Safe semantics.

## Router V1 admission invariants

The Router enforces the following onchain:

- authority, GraphFactory and PoolManager are distinct contracts captured with
  chain ID and runtime hashes at construction, then runtime-checked per launch;
- `launchAndStampV1` (`0xe5f6b8cd`) is the sole payable mutable entrypoint and is
  non-reentrant; there is no receive or fallback;
- the caller is the exact launch wallet;
- the EIP-712 permit binds chain ID, Router, wallet, CustomGraph kind, canonical
  route payload, expected result, stamp request, nonzero nonce, time window and
  exact native value;
- permit lifetime is at most one hour, and both permit digest and wallet nonce
  are single-use;
- launch ID, pool, token and exclusive components cannot be stamped twice;
- the pool is uninitialized before route execution and initialized afterward;
- route, graph, pool and stamp writes revert atomically on any failed
  postcondition;
- every CustomGraph expected address/runtime/result and every exclusive stamp
  component matches the factory's observed return, live code and signed hashes;
- token and hook are mandatory distinct graph outputs; the pool uses ordered
  currencies and contains the token;
- successful execution cannot retain the current launch value in the Router.

The GraphFactory binds chain, factory, namespace, route nonce, topology,
authorized launcher, total value, target order, target IDs, CREATE2 salts,
init-code hashes, initializer hashes and per-target values. It deploys all
targets before running initializers in reviewed order, observes every final
runtime, and reverts the complete graph on collision, replay, deployment or
initializer failure. A direct caller can use this public generic factory with
itself as launcher, but that creates a different launcher-bound commitment and
does not create an official Router stamp.

## Admission limits not enforced by Router V1

A Router stamp proves provenance through this exact Router. It is not an audit,
safety, immutability, tokenomics, liquidity, fee, claim, tradability, source-
verification or finality claim.

In particular:

- Router and GraphFactory accept 1-16 graph targets. The Robinhood product
  policy must enforce **3-16** targets before permit issuance.
- Router does not inspect a hook address's 14 permission bits, enabled callback
  set, PoolManager caller authentication, return-delta accounting, settlement,
  currency deltas, or hook economic behavior. Admission must statically and
  dynamically review all of those properties and fork-simulate the exact graph.
- Router validates current runtime hashes. A proxy runtime hash does not bind
  implementation, admin, beacon, storage or future upgrades. V1 admission
  should reject upgradeable/proxy token and hook components unless their full
  implementation and state trust roots are separately bound and immediately
  revalidated. Immutable direct code is the conservative default.
- CustomGraph stamps require every stamped component to be a newly deployed
  exclusive graph output. Existing external references can be embedded only in
  reviewed initcode/initializers and bound in offchain evidence; Router V1 does
  not stamp them as shared components. Mutable external references require
  separate code/state/authority checks.
- The foundation implements no generic platform-fee basis points, revenue
  split, token supply, liquidity lock, withdrawal or claim semantics. No such
  claim may be inferred from this deployment.
- The factory's byte caps (49,152 bytes per initcode, 131,072 bytes per
  initializer, 524,288 bytes total input) are protocol ceilings, not an
  operational gas guarantee.

The measured target-count benchmark used minimal contracts:

| Targets | `deployGraph` calldata | Execution gas |
| ------: | ---------------------: | ------------: |
|       3 |            2,084 bytes |       433,479 |
|      16 |            9,988 bytes |     2,091,212 |

This proves the operational floor and maximum target count fit for the tested
minimal graph. It is not a worst-case byte-cap proof. Every real 3-16 target
request still needs exact calldata-size checks, chain-4663 fork simulation and
a gas policy before a permit is issued.

## Registry, finality and release gates

The binding verifier checks both the pinned and current official Uniswap 4663
registry and rejects the superseded Universal Router
`0x8876789976decbfcbbbe364623c63652db8c0904`. It checks pinned and current Safe
1.4.1 records for Safe, SafeL2, ProxyFactory, CompatibilityFallbackHandler,
MultiSend and MultiSendCallOnly, then validates their live runtime hashes. The
prepared Programmable addresses must remain vacant before owner signing.

Registry membership and runtime presence are not source verification. A
deployment receipt is not Ethereum finality, indexing, application activation
or public availability. Promotion uses the byte-locked finality reference:

```text
policyId       robinhood-stage-finality-v1
revision       1
digest         sha256:537d531423d1285a3808556a57303ec68f1e6bdeea3c9aaf6320f9e5a0e47153
stages         sequencer_soft_confirmation -> ethereum_posted -> ethereum_finalized
promotable     ethereum_finalized only
```

Arbitrary L2 confirmation counts are not finality. The final chain deployment
descriptor digest remains null until the deployment transaction, exact receipt,
start block, runtime/state readbacks, source-verification evidence and
Ethereum-finalized checkpoint exist.

## Operator commands

From `contracts/`, preparation and readback are read-only:

```sh
ROBINHOOD_CUSTOM_LAUNCH_DEPLOYER=<one-exact-allowed-owner> \
ROBINHOOD_MAINNET_RPC_URL=<authenticated-chain-4663-rpc> \
forge script \
  script/robinhood-custom-launch/PrepareRobinhoodCustomLaunchFoundationV1.s.sol:PrepareRobinhoodCustomLaunchFoundationV1 \
  --sig run --rpc-url "$ROBINHOOD_MAINNET_RPC_URL" -vvvv

ROBINHOOD_CUSTOM_LAUNCH_DEPLOYER=<one-exact-allowed-owner> \
node scripts/prepare-robinhood-custom-launch-owner-transaction.mjs

ROBINHOOD_CUSTOM_LAUNCH_DEPLOYER=<the-actual-sender> \
ROBINHOOD_MAINNET_RPC_URL=<authenticated-chain-4663-rpc> \
forge script \
  script/robinhood-custom-launch/PrepareRobinhoodCustomLaunchFoundationV1.s.sol:PrepareRobinhoodCustomLaunchFoundationV1 \
  --sig validate --rpc-url "$ROBINHOOD_MAINNET_RPC_URL" -vvvv

node scripts/verify-robinhood-custom-launch-bindings.mjs
node scripts/verify-robinhood-custom-launch-router-abi.mjs
```

There is intentionally no `--broadcast`, wallet flag or private-key input.

After a finalized deployment, source publication is a separate explicitly
authorized external action. Sourcify needs no API key; Blockscout's public
chain endpoint currently needs no API key. Both require the finalized creation
transaction hash, compiled artifacts and RPC access. Exact prepared invocations
are:

```sh
forge verify-contract 0x0B6b3F40f84Df25D3bd69238f937096177DD09Bd \
  src/ProgrammableCreate2GraphDeployerV1.sol:ProgrammableCreate2GraphDeployerV1 \
  --chain 4663 --rpc-url "$ROBINHOOD_MAINNET_RPC_URL" \
  --compiler-version 0.8.26 --num-of-optimizations 1000 --evm-version cancun \
  --creation-transaction-hash "$ROBINHOOD_FOUNDATION_TX_HASH" \
  --verifier sourcify --watch

ROUTER_CONSTRUCTOR_ARGS=$(cast abi-encode 'constructor(address,address,address)' \
  0xeD617CE7f82e2AB589aDeFFD319D1D872Bc8De06 \
  0x0B6b3F40f84Df25D3bd69238f937096177DD09Bd \
  0x8366a39CC670B4001A1121B8F6A443A643e40951)
forge verify-contract 0x34965F2A2ee9254522232C32F02056E92BE0C98a \
  src/robinhood-custom-launch/ProgrammableLaunchStampRouterV1.sol:ProgrammableLaunchStampRouterV1 \
  --chain 4663 --rpc-url "$ROBINHOOD_MAINNET_RPC_URL" \
  --compiler-version 0.8.26 --num-of-optimizations 1000 --evm-version cancun \
  --constructor-args "$ROUTER_CONSTRUCTOR_ARGS" \
  --creation-transaction-hash "$ROBINHOOD_FOUNDATION_TX_HASH" \
  --verifier sourcify --watch
```

To submit the same sources to Robinhood Blockscout, replace `--verifier
sourcify` with:

```text
--verifier blockscout --verifier-url https://robinhoodchain.blockscout.com/api/
```

Post-publication evidence must query both providers by address and store exact
match status. A successful submission alone is not verification evidence.

## Remaining external boundary

Before live use, all of the following remain external gates: owner review and
single transaction signature/broadcast; successful receipt; full Safe and
Router postdeploy readback; exact source matches; Ethereum-finalized finality
evidence; indexer start block and replay; backend permit/signature conformance;
product enforcement of CustomGraph-only and 3-16 targets; per-project hook,
token, external-reference, gas and economic security review; monitoring and
release-owner approval.
