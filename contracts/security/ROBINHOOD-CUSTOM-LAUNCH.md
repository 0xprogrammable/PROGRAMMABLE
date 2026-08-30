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

Run the local preparation and source-input checks from the repository root.
They are read-only and the npm commands keep their working directory explicit:

```sh
ROBINHOOD_CUSTOM_LAUNCH_DEPLOYER='<one-exact-allowed-owner>' \
ETH_RPC_URL="$ROBINHOOD_MAINNET_RPC_URL_PRIMARY" \
forge script --root contracts \
  script/robinhood-custom-launch/PrepareRobinhoodCustomLaunchFoundationV1.s.sol:PrepareRobinhoodCustomLaunchFoundationV1 \
  --sig run -vvvv

ROBINHOOD_CUSTOM_LAUNCH_DEPLOYER='<one-exact-allowed-owner>' \
node contracts/scripts/prepare-robinhood-custom-launch-owner-transaction.mjs

ROBINHOOD_CUSTOM_LAUNCH_DEPLOYER='<the-actual-sender>' \
ETH_RPC_URL="$ROBINHOOD_MAINNET_RPC_URL_PRIMARY" \
forge script --root contracts \
  script/robinhood-custom-launch/PrepareRobinhoodCustomLaunchFoundationV1.s.sol:PrepareRobinhoodCustomLaunchFoundationV1 \
  --sig validate -vvvv

npm run contracts:robinhood:bindings:verify
npm run contracts:robinhood:router-abi:verify
npm run contracts:robinhood:source-inputs:verify
```

Immediately before the owner opens the wallet, follow the complete
[owner-wallet handoff](../../docs/operations/releases/custom-launch-v4/OWNER-WALLET-HANDOFF.md)
from the repository root. It reads the exact credentialed dRPC-primary and
Alchemy-secondary endpoints without placing them in shell history or command
arguments, binds reviewed endpoint commitments, requires clean `HEAD` to equal
canonical `origin/production`, and binds the successful protected hosted
`Verify` run and immutable proof artifact for that exact commit and tree. The
strict action-time verifier compares every canonical wallet request field.
There is intentionally no balance read, wallet opening, signature, broadcast,
bridge or transaction retry in that path.

After the separately owner-signed transaction has an exact successful receipt, do not edit the
predeployment JSON. From the repository root, use the exact Phase A commands described in
[`docs/operations/releases/custom-launch-v4/POSTDEPLOYMENT.md`](../../docs/operations/releases/custom-launch-v4/POSTDEPLOYMENT.md):

```sh
npm run contracts:robinhood:postdeploy:test
npm run release:custom-launch:v4:test
```

The production assembler pins the prepared artifact bytes, requires ordered dRPC/Alchemy L2 evidence and
dRPC/QuickNode Ethereum evidence, checks the exact Multicall3 envelope, proves D-1 to D code
transitions, checks the Router getters and full fresh Safe state, binds source closure, and derives
the live descriptor plus digest. Applying the reviewed bundle is a separate explicit local command.
It still does not activate any runtime or public path.

The Standard JSON verifier consumes the two byte-canonical, one-LF artifacts
under `contracts/spec/robinhood-custom-launch/standard-json/`. It checks their full
source closures against the checkout, authenticates the pinned solc 0.8.26
binary, compiles from an empty temporary directory, and re-derives the
GraphFactory creation/runtime hashes, Router base creation/runtime hashes,
constructor-appended creation hash, ABI/source commitments and unchanged
atomic owner calldata. `--write` regenerates the artifacts only when Forge
produces the exact reviewed canonical bytes and hashes; it never signs or
broadcasts.

After a finalized deployment, source publication is a separate explicitly
authorized external action. Because both reviewed inputs set
`metadata.appendCBOR=false`, Sourcify V2 truthfully reports provider-native
`match`/`match`/`match`, not `exact_match`. That response is required publication
and source-closure evidence but is never release authority by itself. The exact
release claim comes from the separately digested binding of the protected
production revision/tree, authenticated hosted reproduction build, pinned
Standard JSON/compiler settings, exact creation bytes in the finalized owner
transaction and exact deployed runtime bytes from both L2 providers. Before publication,
re-run `npm run contracts:robinhood:source-inputs:verify` from the repository
root. The canonical publication operator uses no RPC credential, wallet,
private key or signing input. Its `review` mode performs bounded GETs only,
requires a stable clean `HEAD` equal to both the local tracking ref and a fresh
`git ls-remote origin refs/heads/production` result, recompiles both exact Standard
JSON inputs with the pinned solc binary, and writes a new mode-`0600` plan in an
existing owner-only directory outside the repository and OS temporary tree:

```sh
npm run contracts:robinhood:sourcify:review -- \
  --creation-transaction-hash "$ROBINHOOD_FOUNDATION_TX_HASH" \
  --output /absolute/owner-only/sourcify-review.json
```

Review the plan, legal notice, exact request-body hashes, both bytecode closures,
`authorizationDigest` and the possible automatic Blockscout `writeOrWarn` side
effect. `submit` is an irreversible public-source publication and license grant;
it is an owner-only external action, never an automated continuation. Only
after explicit approval of that exact plan may the owner run:

```sh
npm run contracts:robinhood:sourcify:submit -- \
  --review-plan /absolute/owner-only/sourcify-review.json \
  --acknowledge-publication-digest 'sha256:<exact-reviewed-digest>' \
  --acknowledge-legal-effects \
    I_ACCEPT_IRREVOCABLE_SOURCIFY_SOURCE_PUBLICATION_AND_POSSIBLE_BLOCKSCOUT_VERIFICATION_SUBMISSION \
  --output /absolute/owner-only/sourcify-publication-receipt.json
```

The operator rechecks the protected tree before every POST, skips an already
verified target, requires bounded post-submission readback and emits only
`match`/`match`/`match` plus independently exact byte/source/build/transaction
evidence. Before each possible POST it durably writes and file- plus
directory-`fsync`s a digest-bound `externalActionPossible=true` marker at the
requested output path. Every completed exact target readback is checkpointed
through the same atomic write and directory-`fsync` discipline. After that boundary it never deletes the marker or a
completed receipt. The final receipt is written through an owner-only sibling
file, `fsync`ed, atomically renamed over the marker and followed by a parent
directory `fsync`. It cannot sign or broadcast an onchain transaction.

If submission becomes uncertain or partially succeeds, preserve both the
protected review and marker. First perform a GET-only recovery attestation:

```sh
npm run contracts:robinhood:sourcify:recover -- \
  --review-plan /absolute/owner-only/sourcify-review.json \
  --recovery-marker /absolute/owner-only/sourcify-publication-receipt.json
```

Recovery never sends a POST. If both targets now have exact independently
validated provider readbacks, it atomically replaces the marker with a
`recovered-read-only` receipt. If either target is still missing, it fails and
retains the marker. A later owner-authorized `submit` with the same still-valid
review and acknowledgements must use a different absent output path; it GETs
both targets first and never repeats a POST for an already verified target.
Receipt-write or post-write source-drift failures retain the marker or completed
receipt and remain promotion blockers until read-only recovery and review.

Robinhood Blockscout is separate optional explorer publication. If it is
explicitly authorized, the submission endpoint is:

```text
--verifier blockscout --verifier-url https://robinhoodchain.blockscout.com/api/
```

The pinned Standard JSON inputs deliberately set `metadata.appendCBOR=false`.
Blockscout v11.2.8 derives `FULL` from CBOR metadata matching, so these exact
binaries are expected to remain provider-classified `PARTIAL` even when their
creation bytes, deployed bytes, compiler settings and complete source closure
match locally. Do not change compiler metadata, bytecode, CREATE2 addresses or
owner calldata to appease the explorer. A successful submission, `is_verified`
flag or provider `PARTIAL` result never satisfies an exact-source gate.

The bounded optional Blockscout V2 observation command is documented in the
postdeployment runbook. It records
`PARTIAL_NO_CBOR_NOT_RELEASE_AUTHORITY`, rejects byte/source/settings drift,
and remains outside every promotion requirement. Per-instance API availability
and Cloudflare challenges are read failures only; they do not weaken or replace
the required composite exact byte/source/build/transaction binding. Sourcify's
corresponding provider classification is `PARTIAL_NO_CBOR_EXACT_BYTES`; neither
provider's partial/no-CBOR label is allowed to satisfy that exact binding.

## Remaining external boundary

Before live use, all of the following remain external gates: owner review and
single transaction signature/broadcast; successful receipt; full Safe and
Router postdeploy readback; Sourcify provider match plus the independent exact
byte/source/build/transaction binding; Ethereum-finalized finality
evidence; indexer start block and replay; backend permit/signature conformance;
product enforcement of CustomGraph-only and 3-16 targets; per-project hook,
token, external-reference, gas and economic security review; monitoring and
release-owner approval.
