# Classic Modules V1: local provenance normalization

This document describes the local adapter in [`lib/classic-modules/provenance.ts`](../../lib/classic-modules/provenance.ts). It does not activate a Robinhood launch source, expose a feed, scan an RPC, establish finality, or publish a profile coin. The checked-in [Robinhood profile](../../config/classic-modules/robinhood.preview.json) is disabled, has no deployment addresses or hashes, and cannot pass the adapter's active-source gate.

Classic Modules is a new permissionless launch generation. Its canonical source is an explicitly released `ClassicModuleLaunchV1` deployment. It is not an existing Custom Graph stamp. The current Robinhood `finalized-custom-launches` feed and Ethereum Classic readers remain unchanged.

## Trust boundary

`normalizeClassicModuleLaunch(evidence, profile)` is a synchronous, deterministic consistency check. Its caller must be a trusted collector that has already verified the source release, successful transaction, canonical block, contract reads, and Robinhood-to-Ethereum finality. A caller-supplied `status: "verified"`, digest, address, or collection of matching JSON objects cannot establish those facts. Entirely fabricated but internally consistent evidence is still fabricated. Do not expose this function as a public endpoint that grants provenance to submitted JSON.

The adapter verifies strict field sets and scalar encodings, decodes the exact launch event, compares the event with the launcher getter, reconstructs the pool ID and recipe hash, checks the registry revision bindings, and hashes the supplied runtime bytes. It also rejects contradictory finality coordinates and provider checkpoint observations. It does **not** independently authenticate any of the supplied bytes or prove that a claimed Ethereum batch contains the L2 transaction.

`verification.verificationDigest` refers to the collector's separately authenticated proof artifact. This adapter checks its presence and its associated coordinates; resolving and authenticating that artifact belongs to the collector. The same rule applies to `source.releaseDigest`: it must come from an approved release authority, not from the launch request.

## Source release profile

The profile schema is `programmable.classic-modules-source.v1`. V1 fixes:

- `chainId: 4663`, `sourceVersion: "classic-modules-v1"`.
- Native quote currency, zero LP fee, tick spacing 200.
- `finalityPolicy: "robinhood-ethereum-finalized-v1"`.
- Distinct pinned launcher, hook, registry and PoolManager addresses, plus their exact runtime hashes.
- The released token runtime hash, deployment start block, and immutable minimum native initial-buy amount.
- An authenticated release digest.

`bindActiveClassicModuleSource` accepts only exact `status: "active"` and boolean `enabled: true`, with every binding present and valid. It rejects unknown keys, zero addresses and hashes, missing runtime pins, noncanonical integer strings and a zero initial-buy minimum. Editing the preview file to say `active` is not release authorization. No automatic promotion or fallback source exists here.

All uint256 quantities cross the collector boundary as canonical decimal strings. Chain IDs, fee basis points, module kinds, revision numbers and log indices use bounded safe integers. Hex values normalize to lowercase; byte strings must have an even number of hexadecimal digits. This prevents address casing from creating distinct token, module or log identities.

## Contract event and getter

The adapter exports the following ABI:

```solidity
event ClassicModuleLaunched(
    bytes32 indexed launchId,
    address indexed launchWallet,
    address indexed token,
    bytes32 poolId,
    bytes32 recipeHash,
    address hook,
    address positionRecipient,
    uint256 positionTokenId,
    uint256 initialBuyNative,
    uint256 initialBuyTokens
);

function getLaunch(address token) external view returns (LaunchRecord memory);
```

`LaunchRecord` has these same ten fields in this exact order. The real LP NFT ID is a positive integer; the earlier Classic V4 zero sentinel is not accepted. Chain, source address and block binding are collector metadata, not additional fields in this getter.

The raw event must contain exactly four topics and seven ABI data words, originate at the released launcher, belong to the successful bound receipt, and have `removed: false`. Decoding is followed by canonical re-encoding. Every event field must equal `getLaunch(token)` at the same verified L2 block.

The launch wallet is the profile owner. Do not substitute the token's `creator()` getter, a transaction relayer, a bundler, or a reward beneficiary. The adapter does not require the outer Ethereum transaction sender to equal the launch wallet: contract wallets can execute launches through their own call path. The authenticated launcher event and stored record bind the actual launch caller.

## Collector evidence envelope

The evidence schema is `programmable.classic-modules-evidence.v1`. Every object has an exact field set; there are no optional partial-proof objects.

| Field | Source and required binding |
| --- | --- |
| `header` | Verified Robinhood `chainId`, L2 `blockNumber`, and canonical `blockHash`, at or after the source start block. |
| `receipt` | Successful transaction hash and the same chain/block coordinates. |
| `event` | Raw `ClassicModuleLaunched` address, topics, data, log index, removed flag, transaction hash and block coordinates. The collector proves inclusion in `receipt`. |
| `getLaunch` | Block-bound launcher address, queried token, and the complete decoded record. |
| `pool` | Block-bound PoolManager address, pool ID, full PoolKey, and positive uint160 `sqrtPriceX96` from the initialized pool. |
| `recipe` | Block-bound hook address, pool ID, `recipeOf`, registry address, registrar and launch wallet from `poolConfig`, base creator fees, and ordered `recipeModules`. |
| `registry` | Block-bound registry address and `getVersion(versionId)` records with the corresponding immutable family author. |
| `runtimeReads` | The exact complete set of block-bound runtime bytecode reads for launcher, hook, registry, PoolManager, token, and selected module implementations. Duplicate address reads and missing reads fail. |
| `verification` | Authenticated collector proof reference, matching release digest, L2 transaction/block coordinates, L1 batch-posting coordinates, Ethereum finalized checkpoint, and two distinct provider observations agreeing on that checkpoint. |

The pool ID is recomputed from ABI encoding of `(currency0, currency1, fee, tickSpacing, hooks)`. V1 requires `(native, launched token, 0, 200, released hook)`. A repeated forged `poolId` in several input objects therefore still fails.

For the finality envelope, `status` must be `verified`, the policy must match the source, and the L2 locator must match the successful receipt. The L1 posting block cannot follow the Ethereum finalized checkpoint. If their heights coincide their hashes must coincide. Both provider observations must agree on checkpoint number/hash, and their identifiers must differ. These are consistency checks on the trusted collector's proof, not a replacement for independently resolving the rollup batch, SequencerInbox, L1 canonicality and provider identities.

## Exact recipe and revision identity

Each snapshot follows `ClassicModuleTypes.ModuleSnapshot`:

```solidity
struct ModuleSnapshot {
    bytes32 versionId;
    bytes32 familyId;
    address implementation;
    bytes32 codeHash;
    uint8 kind;
    bytes config;
}
```

The adapter allows at most eight entries, strictly sorted by normalized `familyId`. Families and version IDs cannot repeat. Kind 1 is the exclusive creator-fee policy; at most one is allowed. Kind 2 is a trade-limit effect. Unknown kinds and configurations longer than 256 bytes fail. Base creator fees are 0–1,000 bps in 100-bps increments. An empty module list is valid and does not manufacture an author attribution.

The item and recipe commitments match the V1 engine:

```text
itemHash = keccak256(abi.encode(
  versionId, familyId, implementation, codeHash, kind, keccak256(config)
))

recipeHash = keccak256(abi.encode(
  keccak256("programmable.classic.recipe.v1"),
  chainId, hook, registry, baseBuyFeeBps, baseSellFeeBps, itemHashes
))
```

The result must equal both the launch record and the hook's stored recipe. Each registry version additionally satisfies:

```text
versionId = keccak256(abi.encode(familyId, uint32(version)))
```

Its implementation, code hash, family and kind must equal the snapshot; the revision number, review-manifest hash and immutable family author must be present. Metadata normalizes into recipe order regardless of the collector's registry-response order.

The registry `enabled` flag must be boolean but need not remain true. A reviewer can disable future use after a valid launch, even later in the same L2 block. Historical validity comes from the authenticated launcher/hook execution and immutable snapshot; a current availability flag must not erase a launched coin. The current author payout wallet is deliberately absent from recipe identity. Wallet rotation changes future accrual destinations without changing the module version or the launch's creator.

The adapter does not execute a contributed module, evaluate its trading effects, or re-run its safety review. Successful normalization says nothing about profitability, compatibility beyond the supported structural constraints, claimable balances, liquidity depth, or trade routing.

## Canonical normalized keys

`normalizeClassicModuleLaunch` returns an immutable Classic provenance row with:

- Token identity: `4663:<lowercase token address>`.
- Pool identity: `4663:<lowercase PoolManager address>:<lowercase pool ID>`.
- Launch identity: `4663:<lowercase launcher address>:<lowercase launch ID>`.
- `kind: "classic"`, source version/address/runtime/release digest, launch wallet, token, pool, hook, LP recipient/NFT ID, actual initial-buy amounts, recipe hash, module snapshots and revision attribution.
- Original L2 block/transaction/log coordinates and the upstream verification reference.

`normalizeClassicModuleLaunches` rejects the entire batch when any row is invalid or when normalized token, pool, launch or transaction/log identities repeat. It does not silently quarantine or discard a row. An empty batch still requires an active source. This helper is bounded to 1,000 input rows per call; it does not limit the module catalogue.

The collector must discover the complete requested range, retain overlap for reorg detection, compare canonical checkpoint hashes, rewind to a common verified checkpoint when needed, and atomically persist normalized rows together with the matching checkpoint. This adapter neither opens a database nor advances a cursor. Durable storage should enforce the same identity uniqueness. Profile and Explore should read those same verified records and use `launchWallet` for creator membership.

## Local checks and remaining integration

[`tests/classic-modules-provenance.test.ts`](../../tests/classic-modules-provenance.test.ts) uses synthetic runtime bytes, addresses, events and finality coordinates. It covers the successful identity round trip, disabled preview, wrong source or chain, missing or substituted block/receipt/getter/runtime evidence, recomputed pool/recipe commitments, revision mismatches, duplicate modules, module limits and conflicting effects, changed catalogue availability, and atomic batch rejection.

These fixtures are not live-chain evidence. Before activation, integration still needs a released exact deployment profile, source verification, the authenticated RPC/finality collector, persistent checkpoints and reorg handling, actual launch-to-profile/Explore wiring, and a genuine finalized launch round trip. The existing Custom feed must retain its category and trust rules; accepting this new source requires its own explicit integration.
