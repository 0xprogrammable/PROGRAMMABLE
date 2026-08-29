# Deployment and verification

## Current release disposition

Robinhood Chain mainnet is `BLOCKED_BY_SPEC`. No Core address, Collector,
deployer, transaction, runtime readback or explorer-verification evidence exists
and none is represented by a null or example address.

Robinhood Chain Testnet is `PRE_OWNER_GATE_READ_ONLY_PREPARATION` and
terminates at `BLOCKED_BY_SPEC`. It is not an owner gate or testnet candidate.
No deployer or proposed Collector address has been supplied, no unsigned
transaction package can yet be constructed, and no signing or broadcast was
requested. The agent has not selected a Collector. A proposed address would be
immutable in Core, but its code, dependencies and ultimate-beneficiary behavior
require review before the owner selects and approves it at the gate.

This foundations-only Core and its vaults must not be deployed for custody or
funded on any network. `executeProtected` is an immutable hard revert and Core
has no vault-command call site. Native ETH has no release path and ERC-20
balances have no Core-controlled release path; unsupported token or issuer
behavior is outside this claim.

The canonical-network-read-only/local-fork verification lane may deploy
contracts and read their runtime only inside a disposable localhost Anvil fork.
That is local simulation evidence, not a transaction, deployment, source
verification or runtime readback on canonical Robinhood Chain Testnet.

Machine-readable states:

- [mainnet deployment status](../../deployments/dex/robinhood/4663/deployment-status.json)
- [testnet preparation status](../../deployments/dex/robinhood/46630/preparation-status.json)

## Stable network identity and mutable operations

Mainnet is chain ID 4663 with block-zero hash
`0xaad15f3d702aaea00caf3e9bb56395efe9127bc3b31b24921abf1eee3409305c`.
Testnet is chain ID 46630 with block-zero hash
`0x829a42e6d68c872aafcef3abb2123fe371138fc415dd8b44381bbbf23049dd32`.
Those anchors are identity evidence. The bootstrap-resource digests are locally
computed SHA-256 snapshots of bytes retrieved from official CDN URLs; they are
not provider-published official checksums.

RPC URLs, explorers, sequencer endpoints, heads, finality tags, node versions,
gas conditions and source-verification availability are mutable observations.
Robinhood labels the public RPCs rate-limited and unsuitable for production;
deployment operations need reviewed providers and fresh observations.

## Gates before any owner review

The release coordinator must first have:

1. a portable Protocol resolution for all twelve gaps;
2. an updated exact Protocol lock that permits the proposed release class;
3. a complete Binding Release and passing Conformance Report;
4. a reviewed implementation commit/tree and reproducible compiler artifacts;
5. exact ABI, creation/runtime bytecode, size and native-test evidence; and
6. a deployment plan that preserves the immutable Core and vault boundary.

Only then can an owner-gate package name the deployer, owner-supplied proposed
Collector address and address-type/code/dependency review, constructor
arguments, predicted addresses, fresh chain anchor, unsigned payloads, gas
estimate, maximum ETH cost, expiry and post-deployment checks. The owner selects
and approves the Collector only by approving that exact gate.

## Owner-controlled actions

Selecting the Collector or deployer, funding, signing, broadcasting and
publishing an irreversible production release remain owner actions.
Preparation tooling must not read a key or sign/broadcast a transaction. A
missing exact input is a blocker, not a reason to publish a partial gate.

No owner-provided acceptance record or click-through acceptance action is
present. The legal effect of access to official documentation, public RPC,
testnet or explorer services is not assessed here, and this document makes no
non-acceptance claim. Any future access to those services requires explicit
owner authorization for that run.

## Post-deployment evidence procedure

After a separately authorized transaction, record each axis independently:

- transaction hash, receipt status, block number/hash and created address;
- constructor arguments and immutable getter readback;
- deployed entry runtime bytecode hash and code size;
- source/compiler settings and explorer verification result;
- Core identity and expected CREATE2 vault-address differential checks;
- read-only smoke calls and the expected `executeProtected` hard revert;
- an authenticated finality observation under the stated policy; and
- any provider or explorer limitation.

Explorer publication is not runtime equality; runtime equality is not source
verification; source verification is not conformance; testnet deployment is not
production eligibility.
