# Mainnet event and market sources

Status: source inventory for the first realtime read-model migration. Addresses
and blocks below are release-manifest inputs, not environment overrides.

## Included releases

This inventory includes Classic V2, Classic V3, and Stock-Paired V1, V2, and
V3 on Ethereum Mainnet (`chain_id = 1`). Adaptive and Deep contracts are not
event sources for this migration.

Checksummed addresses are used in prose. Indexer configuration, entity IDs,
database keys, and comparisons use lowercase addresses and transaction hashes.

## Static Envio sources

| Release | Contract role | Checksummed address | Inclusive start block | Manifest field |
| --- | --- | --- | ---: | --- |
| Classic V2 | Hook (`EthCreatorFeeHookV2`) | `0x025a386eAa79f6067d29848FD05ccC71bEAb20CC` | 25624130 | `mainnet-classic-v2.json: addresses.feeHook`, deployment transaction block |
| Classic V2 | Launcher (`MemeLaunchV1`) | `0xD240D06f8586eB799f20056054e5b527405E6bAd` | 25624131 | `mainnet-classic-v2.json: addresses.memeLauncher`, deployment transaction block |
| Classic V3 | Reward-vault factory | `0xF28967f9DFaC3Ca21384b59D6D75C8106b3eab2a` | 25639538 | `mainnet-classic-v3.json: deploymentBlocks.rewardVaultFactory` |
| Classic V3 | Vesting-wallet factory | `0xDe21b9c0Cc0AfDB9be20e8236113f066BB8C66f4` | 25639564 | `mainnet-classic-v3.json: deploymentBlocks.initialBuyVestingWalletFactory` |
| Classic V3 | Hook (`EthCreatorFeeHookV3`) | `0x35Fe236EA82F7cF525c9719d7df8F49F94D720CC` | 25639591 | `mainnet-classic-v3.json: deploymentBlocks.feeHook` |
| Classic V3 | Launcher (`MemeLaunchV2`) | `0xC3bd04aAc2fb2ba58efD7Eb673E544E0B80De770` | 25639596 | `mainnet-classic-v3.json: deploymentBlocks.launcher` |
| Stock-Paired V1 | Launcher (`StockPairedLaunchV1`) | `0x195750f33caD5eF2DF857a53226B421297A1e79e` | 25637469 | `mainnet-stock-paired-v1.json: startBlock` |
| Stock-Paired V1 | ETH coordinator | `0xfa5f17389CA28D071781d59750b32C842ab6A54b` | 25637469 | `mainnet-stock-paired-v1.json: startBlock` |
| Stock-Paired V1 | Hook | `0x7773D183fe7B60d4F1885047fa42b815a62Fe0Cc` | 25637469 | `mainnet-stock-paired-v1.json: startBlock` |
| Stock-Paired V1 | Reward-vault factory | `0xD430d9162c153AFDf9E4CACA6D2317E72a044441` | 25637469 | `mainnet-stock-paired-v1.json: startBlock` |
| Stock-Paired V2 | Launcher (`StockPairedLaunchV1` release) | `0x5eA6Be24838061bA45dbE8D82DE1b267DC240Daf` | 25640338 | `mainnet-stock-paired-v2.json: startBlock` |
| Stock-Paired V2 | ETH coordinator | `0xFb9E1034df6161088E8F358502B19E7515c30fD2` | 25640338 | `mainnet-stock-paired-v2.json: startBlock` |
| Stock-Paired V2/V3 | Shared hook | `0x90c67C1E866f86526F0e338459cD435E1F23A0cc` | 25640338 | `mainnet-stock-paired-v2.json: startBlock`; reused by V3 |
| Stock-Paired V2/V3 | Shared reward-vault factory | `0x52d70971D6653a754c29385a2a6f241A481952d4` | 25640338 | `mainnet-stock-paired-v2.json: startBlock`; reused by V3 |
| Stock-Paired V3 | Launcher (`StockPairedLaunchV3`) | `0x0573879f72d8eE8B0e5a4Ec5E8bcDb2fCab9E51c` | 25642745 | `mainnet-stock-paired-v3.json: startBlock` |
| Stock-Paired V3 | ETH coordinator | `0xdDC3ABbAB0df7F1189310a4f70e7e365796B74E2` | 25642745 | `mainnet-stock-paired-v3.json: startBlock` |

The V3 Stock-Paired manifest reuses the V2 hook and reward-vault factory. Those
shared sources must start at `25640338`, not the V3 launcher block, so V2
history is retained.

HyperIndex has one chain-level `start_block`, so it is `25624130`, the minimum
of the source cutoffs. The generated source registry still retains and enforces
each inclusive per-address cutoff. A candidate below its address cutoff is
rejected before promotion.

Lowercase registry input:

```yaml
chain_id: 1
chain_start_block: 25624130
sources:
  classic_v2_hook:
    address: "0x025a386eaa79f6067d29848fd05ccc71beab20cc"
    start_block: 25624130
  classic_v2_launcher:
    address: "0xd240d06f8586eb799f20056054e5b527405e6bad"
    start_block: 25624131
  classic_v3_reward_vault_factory:
    address: "0xf28967f9dfac3ca21384b59d6d75c8106b3eab2a"
    start_block: 25639538
  classic_v3_vesting_wallet_factory:
    address: "0xde21b9c0cc0afdb9be20e8236113f066bb8c66f4"
    start_block: 25639564
  classic_v3_hook:
    address: "0x35fe236ea82f7cf525c9719d7df8f49f94d720cc"
    start_block: 25639591
  classic_v3_launcher:
    address: "0xc3bd04aac2fb2ba58efd7eb673e544e0b80de770"
    start_block: 25639596
  stock_v1_launcher:
    address: "0x195750f33cad5ef2df857a53226b421297a1e79e"
    start_block: 25637469
  stock_v1_eth_coordinator:
    address: "0xfa5f17389ca28d071781d59750b32c842ab6a54b"
    start_block: 25637469
  stock_v1_hook:
    address: "0x7773d183fe7b60d4f1885047fa42b815a62fe0cc"
    start_block: 25637469
  stock_v1_reward_vault_factory:
    address: "0xd430d9162c153afdf9e4caca6d2317e72a044441"
    start_block: 25637469
  stock_v2_launcher:
    address: "0x5ea6be24838061ba45dbe8d82de1b267dc240daf"
    start_block: 25640338
  stock_v2_eth_coordinator:
    address: "0xfb9e1034df6161088e8f358502b19e7515c30fd2"
    start_block: 25640338
  stock_v2_v3_hook:
    address: "0x90c67c1e866f86526f0e338459cd435e1f23a0cc"
    start_block: 25640338
  stock_v2_v3_reward_vault_factory:
    address: "0x52d70971d6653a754c29385a2a6f241a481952d4"
    start_block: 25640338
  stock_v3_launcher:
    address: "0x0573879f72d8ee8b0e5a4ec5e8bcdb2fcab9e51c"
    start_block: 25642745
  stock_v3_eth_coordinator:
    address: "0xddc3abbab0df7f1189310a4f70e7e365796b74e2"
    start_block: 25642745
```

## ABI authority and Classic V2 ambiguity

The Classic V2 Mainnet hook is `EthCreatorFeeHookV2`, not
`EthCreatorFeeHookV1`. `contracts/DEPLOYMENT.md` binds
`0x025a386eAa79f6067d29848FD05ccC71bEAb20CC` to `EthCreatorFeeHookV2`, and
`contracts/src/EthCreatorFeeHookV2.sol` declares `PoolFeeDisclosure`.
`EthCreatorFeeHookV1.sol` does not declare that event and is not an event source
for this migration. No V1-only ABI is applied to the V2 address.

The checked-in TypeScript read ABI currently covers the V2 launch, fee-accrual,
and claim events used by the legacy path. HyperIndex must import the Solidity
event definitions below so `PoolRegistered`, `PoolFeeDisclosure`, and
`LauncherFeesClaimed` are included without changing their indexed parameters.

## Event catalog

Signatures below are copied from the checked-in Solidity declarations. ABI
types and `indexed` placement are part of the contract; parameter names are
retained for generated types and decoded payloads.

This is the migration's required event-family allowlist, not every event in
each contract ABI. Inherited framework and token events remain outside this
read model unless a separately reviewed migration adds them.

### Classic V2 launcher

Source: `contracts/src/MemeLaunchV1.sol`.

```solidity
event MemeTokenLaunched(
    address indexed creator,
    address indexed token,
    bytes32 indexed poolId,
    address feeHook,
    address positionRecipient,
    uint256 positionTokenId,
    uint16 totalSwapFeeBps,
    bytes32 launchHash
);

event MemeLiquidityConfigured(
    address indexed token,
    uint256 totalSupply,
    uint256 tokenLiquidityAmount,
    uint256 lockedTokenDust,
    int24 initialTick,
    int24 tickLower,
    int24 tickUpper,
    uint24 lpFeePips,
    bytes32 launchHash
);

event MemeCreatorInitialBuy(
    address indexed creator,
    address indexed token,
    bytes32 indexed poolId,
    uint256 nativeAmount,
    uint256 tokenAmount,
    bytes32 launchHash
);
```

### Classic V2 hook

Source: `contracts/src/EthCreatorFeeHookV2.sol`.

```solidity
event PoolRegistered(
    bytes32 indexed poolId,
    address indexed token,
    address indexed creator,
    address registrar,
    uint16 totalSwapFeeBps
);

event PoolFeeDisclosure(
    bytes32 indexed poolId,
    address indexed token,
    uint16 buySwapFeeBps,
    uint16 sellSwapFeeBps,
    uint16 launcherFeeBps,
    uint16 transferTaxBps,
    uint24 lpFeePips
);

event NativeSwapFeesAccrued(
    bytes32 indexed poolId,
    address indexed swapSender,
    uint256 grossNativeAmount,
    uint256 creatorFee,
    uint256 launcherFee
);

event CreatorFeesClaimed(
    bytes32 indexed poolId,
    address indexed creator,
    address indexed recipient,
    address caller,
    uint256 amount
);

event LauncherFeesClaimed(
    address indexed treasury,
    address indexed recipient,
    address indexed caller,
    uint256 amount
);
```

### Classic V3 launcher

Source: `contracts/src/MemeLaunchV2.sol`.

```solidity
event MemeTokenLaunchedV2(
    address indexed deployer,
    address indexed token,
    bytes32 indexed poolId,
    address feeHook,
    address rewardVault,
    address positionRecipient,
    uint256 positionTokenId,
    uint16 buySwapFeeBps,
    uint16 sellSwapFeeBps,
    bytes32 rewardConfigurationHash,
    bytes32 launchHash
);

event MemeLiquidityConfiguredV2(
    address indexed token,
    uint256 totalSupply,
    uint256 tokenLiquidityAmount,
    uint256 lockedTokenDust,
    int24 initialTick,
    int24 tickLower,
    int24 tickUpper,
    uint24 lpFeePips,
    bytes32 launchHash
);

event MemeCreatorInitialBuyV2(
    address indexed deployer,
    address indexed token,
    bytes32 indexed poolId,
    uint256 nativeAmount,
    uint256 tokenAmount,
    bytes32 launchHash
);

event MemeCreatorInitialBuyCustodyV2(
    address indexed deployer,
    address indexed token,
    address indexed custody,
    ClassicInitialBuyCustodyMode mode,
    uint16 durationDays,
    uint16 cliffDays,
    bytes32 configurationHash,
    bytes32 launchHash
);
```

`ClassicInitialBuyCustodyMode` is the ABI enum type `uint8`.

### Classic V3 hook

Source: `contracts/src/EthCreatorFeeHookV3.sol`.

```solidity
event PoolRegistered(
    bytes32 indexed poolId,
    address indexed token,
    address indexed rewardVault,
    address registrar,
    uint16 buySwapFeeBps,
    uint16 sellSwapFeeBps,
    bytes32 rewardConfigurationHash
);

event PoolFeeDisclosure(
    bytes32 indexed poolId,
    address indexed token,
    address indexed rewardVault,
    uint16 buySwapFeeBps,
    uint16 sellSwapFeeBps,
    uint16 buyCreatorFeeBps,
    uint16 sellCreatorFeeBps,
    uint16 launcherFeeBps,
    uint16 transferTaxBps,
    uint24 lpFeePips
);

event NativeSwapFeesAccrued(
    bytes32 indexed poolId,
    address indexed swapSender,
    bool indexed isBuy,
    uint16 appliedTotalSwapFeeBps,
    uint256 grossNativeAmount,
    uint256 creatorFee,
    uint256 launcherFee
);

event CreatorFeesClaimed(
    bytes32 indexed poolId,
    address indexed rewardVault,
    address indexed caller,
    uint256 amount
);

event LauncherFeesClaimed(
    address indexed treasury,
    address indexed recipient,
    address indexed caller,
    uint256 amount
);
```

### Classic V3 factories and dynamic vaults

Static factory sources:

- `contracts/src/ClassicRewardVaultFactoryV1.sol`;
- `contracts/src/ClassicInitialBuyVestingWalletFactoryV1.sol`.

Dynamic vault source:
`contracts/src/ClassicRewardVaultV1.sol`.

```solidity
event ClassicRewardVaultDeployed(
    address indexed vault,
    bytes32 indexed poolId,
    address indexed feeHook,
    bytes32 salt,
    bytes32 configurationHash
);

event ClassicInitialBuyVestingWalletDeployed(
    address indexed wallet,
    address indexed token,
    address indexed beneficiary,
    bytes32 salt,
    bytes32 configurationHash
);

event CreatorFeesCheckpointed(
    bytes32 indexed poolId,
    uint64 indexed configurationEpoch,
    uint256 amount,
    uint256 totalCreatorFeesReceived
);

event BeneficiaryFeesClaimed(
    address indexed beneficiary,
    uint256 amount,
    uint256 beneficiaryTotalClaimed,
    uint256 vaultTotalReceived
);

event PayoutWalletChanged(
    bytes32 indexed poolId,
    uint256 indexed allocationIndex,
    address indexed previousPayoutWallet,
    address newPayoutWallet,
    uint16 shareBps,
    uint64 configurationEpoch,
    bytes32 activeConfigurationHash,
    uint256 effectiveTotalCreatorFeesReceived
);

event CtoRewardConfigurationActivated(
    bytes32 indexed poolId,
    bytes32 indexed approvalReference,
    uint64 indexed configurationEpoch,
    bytes32 previousConfigurationHash,
    bytes32 newConfigurationHash,
    address[] beneficiaries,
    uint16[] sharesBps,
    uint256 effectiveTotalCreatorFeesReceived
);
```

The `ClassicRewardVaultDeployed` handler registers `vault` as a dynamic
`ClassicRewardVaultV1` source. Registration is accepted only from the
manifest-pinned factory. Promotion additionally requires the emitted
`feeHook`, `poolId`, and configuration hash to agree with the Classic V3
launcher and hook events.

### Stock-Paired launchers and coordinators

Launcher sources:

- V1 and V2 release ABI: `contracts/src/StockPairedLaunchV1.sol`;
- V3 release ABI: `contracts/src/StockPairedLaunchV3.sol`.

Coordinator sources:

- V1 and V2 release ABI:
  `contracts/src/StockPairedEthLaunchCoordinatorV1.sol`;
- V3 release ABI:
  `contracts/src/StockPairedEthLaunchCoordinatorV3.sol`.

The corresponding event signatures are identical across those release
versions:

```solidity
event StockPairedTokenLaunched(
    address indexed deployer,
    address indexed token,
    address indexed quoteAsset,
    bytes32 poolId,
    address rewardVault,
    address positionRecipient,
    uint256 positionTokenId,
    bytes32 launchHash
);

event StockPairedLiquidityConfigured(
    address indexed token,
    address indexed quoteAsset,
    uint256 totalSupply,
    uint256 tokenLiquidityAmount,
    uint256 lockedTokenDust,
    int24 initialTick,
    int24 tickLower,
    int24 tickUpper,
    uint24 lpFeePips,
    bytes32 launchHash
);

event StockPairedCreatorInitialBuy(
    address indexed deployer,
    address indexed token,
    address indexed quoteAsset,
    bytes32 poolId,
    uint256 quoteAmount,
    uint256 tokenAmount,
    bytes32 launchHash
);

event StockPairedEthTokenLaunched(
    address indexed creator,
    address indexed token,
    address indexed quoteAsset,
    uint256 initialBuyEthAmount,
    uint256 initialBuyQuoteAmount,
    uint256 initialBuyTokenAmount,
    bytes32 launchHash
);
```

`StockPairedEthTokenLaunched` is coordinator provenance for the ETH-funded
path. Direct quote-asset launches do not require that event.

### Stock-Paired hooks and dynamic vaults

Hook source: `contracts/src/QuoteAssetCreatorFeeHookV1.sol`.

Factory source: `contracts/src/QuoteAssetFeeSplitVaultFactoryV1.sol`.

Dynamic vault source: `contracts/src/QuoteAssetFeeSplitVaultV1.sol`.

```solidity
event PoolRegistered(
    bytes32 indexed poolId,
    address indexed token,
    address indexed quoteAsset,
    address rewardVault,
    address registrar,
    bool quoteIsCurrency0,
    bytes32 rewardConfigurationHash,
    bytes32 quoteConfigurationHash
);

event PoolFeeDisclosure(
    bytes32 indexed poolId,
    address indexed token,
    address indexed quoteAsset,
    address rewardVault,
    uint16 buySwapFeeBps,
    uint16 sellSwapFeeBps,
    uint16 creatorFeeBps,
    uint16 launcherFeeBps,
    uint16 transferTaxBps,
    uint24 lpFeePips
);

event QuoteSwapFeesAccrued(
    bytes32 indexed poolId,
    address indexed swapSender,
    address indexed quoteAsset,
    bool isBuy,
    uint256 grossQuoteAmount,
    uint256 creatorFee,
    uint256 launcherFee
);

event CreatorFeesClaimed(
    bytes32 indexed poolId,
    address indexed rewardVault,
    address indexed quoteAsset,
    address caller,
    uint256 amount
);

event LauncherFeesClaimed(
    address indexed treasury,
    address indexed recipient,
    address indexed quoteAsset,
    address caller,
    uint256 amount
);

event QuoteAssetFeeSplitVaultDeployed(
    address indexed vault,
    address indexed feeHook,
    bytes32 indexed poolId,
    address quoteAsset
);

event PayoutAddressUpdated(
    address indexed beneficiary,
    address indexed previousPayoutAddress,
    address indexed newPayoutAddress
);

event BeneficiaryFeesClaimed(
    address indexed beneficiary,
    address indexed payoutAddress,
    address indexed quoteAsset,
    uint256 amount,
    uint256 beneficiaryTotalClaimed,
    uint256 vaultTotalReceived
);
```

The `QuoteAssetFeeSplitVaultDeployed` handler registers `vault` as a dynamic
`QuoteAssetFeeSplitVaultV1` source. Promotion requires the factory, hook,
quote asset, pool ID, reward vault, and launcher event to agree with one
manifest-pinned Stock-Paired release.

## Initial reward-allocation seed

Initial beneficiaries and shares are vault constructor/factory-call inputs.
They are not present in `ClassicRewardVaultDeployed` or
`QuoteAssetFeeSplitVaultDeployed`, and Envio cannot infer them from those
events. Envio handlers only record deterministic event entities and dynamic
addresses; they perform no RPC, HTTP, trace, Postgres, or other external side
effect.

A separate application seed verifier runs only after the factory occurrence is
canonical and its creation block is at or below
`safeHead = min(headA, headB) - 12`, with both RPCs agreeing on that
safe-head hash and the creation occurrence. It uses the exact creation block
hash, never `latest`.

### Historical getter path

The verifier first attempts the complete getter set below independently against
both RPCs with the EIP-1898 block parameter:

```json
{ "blockHash": "<canonical creation block hash>", "requireCanonical": true }
```

When that snapshot represents the initial allocation under the source-specific
rules below, call the applicable factory `predict(...)` against both RPCs with
the same block parameter and recovered initial arrays. This path is selected
only when both RPCs serve the complete getter and prediction set and return the
same normalized values. If either RPC cannot serve that historical hash or any
required call, or the snapshot cannot itself supply the initial allocation,
the verifier selects the transaction-input path below. It does not downgrade
to an unpinned `latest`, mix authority paths, or use a single-RPC result as
authority.

For `ClassicRewardVaultV1`, read:

```solidity
beneficiaryCount() returns (uint256)
beneficiaryAt(uint256 index) returns (address)
shareBpsAt(uint256 index) returns (uint16)
configurationEpoch() returns (uint64)
configurationHash() returns (bytes32)
activeConfigurationHash() returns (bytes32)
feeHook() returns (address)
poolManager() returns (address)
ctoAuthority() returns (address)
poolId() returns (bytes32)
```

Also read
`ClassicRewardVaultFactoryV1.configurationHashOf(address vault)`. When
`configurationEpoch() == 1`, the ordered `beneficiaryAt` and `shareBpsAt`
arrays are the initial allocation and `historical_getters` may be the selected
recovery method. If a later transaction in the creation block already advanced
the epoch, the getter snapshot is not initial-seed authority: select the
applicable calldata recovery method, recover the initial arrays from that
calldata, then replay later canonical `PayoutWalletChanged` or
`CtoRewardConfigurationActivated` occurrences in transaction/receipt-log order.
When both RPCs served the complete getter snapshot, require the replay result
to equal it as conditional enrichment. This does not change the calldata
recovery method or mix getter-derived values into the initial seed.

For `QuoteAssetFeeSplitVaultV1`, read:

```solidity
beneficiaryCount() returns (uint256)
beneficiaryAt(uint256 index) returns (address)
shareBpsOf(address beneficiary) returns (uint16)
payoutAddressOf(address beneficiary) returns (address)
configurationHash() returns (bytes32)
feeHook() returns (address)
poolManager() returns (address)
quoteAsset() returns (address)
poolId() returns (bytes32)
```

Also read
`QuoteAssetFeeSplitVaultFactoryV1.configurationHashOf(address vault)`.
Stock-Paired beneficiaries and shares are immutable; payout addresses may
change. At the creation block, each initial payout address must equal its
beneficiary unless a later canonical `PayoutAddressUpdated` occurrence in that
same block explains the end-of-block value.

Provider equality alone does not verify a `historical_getters` seed. Recompute
the configuration commitments below from the returned ordered allocation and
dependencies, and require them to equal both RPCs' vault and factory getters
and every applicable dual-RPC-canonical event commitment. For Classic epoch
one, the recomputed active-configuration commitment must also equal both
`activeConfigurationHash()` results. All getter dependencies must agree with
the manifest and canonical factory, launcher, and hook event fields. Finally,
both RPCs' exact-block factory `predict(...)` results must equal each other,
the local CREATE2 result, and the vault emitted by the canonical factory
occurrence. Any mismatch rejects this path.

### Transaction-input path

Both RPCs must return the same transaction hash, `from`, `to`, input bytes,
value, block number/hash, and transaction index, and the same successful
receipt containing the canonical factory occurrence. The decoder selects an
ABI only from the manifest-pinned destination and exact selector:

| Source | Selector and canonical signature | Allocation inputs |
| --- | --- | --- |
| Classic V3 launcher | `0xbf388406` — `launch((string,string,uint16,uint16,bytes32,(string,string,string,bytes),address[],uint16[],(uint8,uint16,uint16)))` | `LaunchParameters.rewardBeneficiaries`, `rewardSharesBps` |
| Stock V1/V2/V3 launcher | `0x0f6d2003` — `launch((string,string,address,uint256,bytes32,(string,string,string,bytes),address[],uint16[]))` | `LaunchParameters.rewardBeneficiaries`, `rewardSharesBps` |
| Stock V1/V2/V3 ETH coordinator | `0xdfd98d51` — `launch((uint256,uint256,uint256,(string,string,address,uint256,bytes32,(string,string,string,bytes),address[],uint16[])))` | nested `EthLaunchParameters.launch.rewardBeneficiaries`, `rewardSharesBps` |
| Classic factory | `0x19e3bddc` — `deploy(bytes32,address,bytes32,address[],uint16[])` | `beneficiaries`, `sharesBps` |
| Classic factory | `0x97f32fb5` — `deployOrGet(bytes32,address,bytes32,address[],uint16[])` | `beneficiaries`, `sharesBps` |
| Stock factory | `0xcd12090e` — `deploy(bytes32,address,bytes32,address,address[],uint16[])` | `beneficiaries`, `sharesBps` |

Normal Programmable launches call the factory internally, so a standard
transaction lookup exposes the launcher or ETH-coordinator calldata, not the
internal factory calldata. Direct factory calldata is decoded only when the
factory is the top-level transaction destination. Provider-specific execution
traces are diagnostic evidence and are never the sole seed authority. A direct
factory deployment can verify a vault seed but cannot create a public launch
without the matching launcher events.

For every path, require equal non-empty arrays, ordered unique nonzero
beneficiaries, nonzero shares, and a total of `10_000` basis points. Classic
allows 1–5 entries; Stock-Paired allows 1–8.

For launcher/coordinator transactions derive the factory salt exactly as the
source does:

```text
Classic V3 salt =
  keccak256(abi.encode(
    "programmable.classic-reward-vault.v1", token, launcher-event deployer
  ))

Stock V1/V2 salt =
  keccak256(abi.encode(
    "programmable.stock-paired-reward-vault.v1",
    token, quoteAsset, launcher-event deployer
  ))

Stock V3 salt =
  keccak256(abi.encode(
    "programmable.stock-paired-reward-vault.v3",
    token, quoteAsset, launcher-event deployer
  ))
```

For a direct factory transaction use its decoded `salt`. Rebuild the exact
factory `initCode`, compute
`keccak256(0xff ++ factory ++ salt ++ keccak256(initCode))[12:]`, and require
that address to equal the emitted vault. The init code uses the
manifest-pinned release artifact and immutable constructor dependencies plus
the decoded allocation and canonical event fields. This local computation is
required for every transaction-input recovery and does not depend on an
`eth_call` to the factory's exact-block `predict(...)`.

Recompute and verify the constructor commitments:

```text
Classic configurationHash =
  keccak256(abi.encode(
    chainId, vault, feeHook, poolManager, ctoAuthority, poolId,
    beneficiaries, sharesBps
  ))

Classic initial activeConfigurationHash =
  keccak256(abi.encode(
    chainId, vault, configurationHash, uint64(1),
    beneficiaries, sharesBps
  ))

Stock configurationHash =
  keccak256(abi.encode(
    chainId, vault, feeHook, poolManager, quoteAsset, poolId,
    beneficiaries, sharesBps
  ))
```

For the transaction-input path, the following evidence is sufficient seed
authority:

1. both RPCs return the identical top-level transaction fields and identical
   successful receipt required above, including the canonical factory
   occurrence;
2. the manifest-pinned destination and exact selector decode without trailing
   or non-canonical input, and the decoded ordered allocation passes every
   bound and invariant above;
3. the locally rebuilt release-specific init code and CREATE2 computation
   produce the emitted vault address; and
4. all related dual-RPC-canonical events agree with the decoded and recomputed
   values. For Classic, the factory and launcher events must agree on vault,
   pool, and hook; the factory `configurationHash` and launcher
   `rewardConfigurationHash` must equal the local commitment; and the
   factory-event salt must equal the salt locally derived from the launcher
   inputs. For Stock-Paired, the factory, launcher, and hook `PoolRegistered`
   occurrences must agree on vault, pool, hook, quote asset, and
   `PoolRegistered.rewardConfigurationHash`. A direct factory deployment
   requires its canonical factory occurrence and local CREATE2/commitment
   agreement but remains ineligible as a public launch without the launcher
   and hook occurrences.

The local configuration commitment must equal every applicable canonical
event commitment and the locally derived CREATE2 address must equal the
emitted vault. No historical getter or exact-block `predict(...)` call is a
prerequisite for this calldata authority.

Historical getters and `predict(...)` are conditional enrichment for a
calldata-recovered seed. Compare them only when both RPCs serve the complete
exact-creation-block set and return identical normalized results. A served
comparison that disagrees with the local values quarantines the seed. If
either RPC cannot serve the complete set, record the enrichment as unavailable
and do not require, compare, or trust the other RPC's partial result.

The seed record retains:

```text
chain_id
factory_event_logical_identity
factory_event_receipt_log_ordinal
factory_occurrence_block_hash
factory_occurrence_block_global_log_index
factory_envio_candidate_id
creation_block_number
creation_transaction_index
vault
release_version
recovery_method = historical_getters|launcher_calldata|coordinator_calldata|factory_calldata
top_level_to
method_selector
transaction_input_hash
ordered_beneficiaries
ordered_shares_bps
allocation_hash
configuration_hash
active_configuration_hash
local_init_code_hash
local_create2_address
canonical_event_occurrence_ids
historical_enrichment_status = matched|unavailable
getter_block_hash = <canonical_creation_block_hash>|null
getter_result_hash_a = <hash>|null
getter_result_hash_b = <hash>|null
predict_result_hash_a = <hash>|null
predict_result_hash_b = <hash>|null
rpc_a_result_hash
rpc_b_result_hash
verification_run_id
verified_at
```

`active_configuration_hash` is the Classic epoch-one commitment; it is `null`
for the immutable Stock-Paired allocation.

`rpc_a_result_hash` and `rpc_b_result_hash` commit to the selected authority
path: the complete normalized historical snapshot for `historical_getters`, or
the normalized transaction and successful receipt for a calldata path.
Historical-enrichment fields are nullable only when the status is
`unavailable`.

No seed is verified before finality. A mismatch in the selected authority
path, dual-RPC evidence, local CREATE2 result, canonical events, commitments,
or a fully served historical enrichment quarantines the seed and its
launch/reward projections. Historical-state unavailability alone does not
quarantine a calldata-authorized seed. If the creation occurrence is orphaned,
append an orphaned seed status and recover a new seed against the newly
canonical occurrence, even when the logical transaction hash and receipt-local
log ordinal are unchanged.

## Candidate identity, occurrence, and release assignment

JSON-RPC `logIndex` is block-global, not transaction-receipt-local. It can
change when the same transaction is re-mined after a different number of
preceding block logs. Envio handlers cannot obtain a receipt-local ordinal
without a network read, so they do not create the application identity.

Every Envio event entity instead uses the fork-specific candidate identity:

```text
candidate_id =
  "<chain_id>:<lowercase_block_hash>:<lowercase_transaction_hash>:<block_global_log_index>"
```

The candidate stores the source address, block number/hash, transaction
hash/index, block-global `logIndex`, topics, data, decoded payload, event type,
and release hint as lowercase `0x`-prefixed hex strings where applicable. It
is only upstream evidence.

The projector fetches the transaction receipt independently from both RPCs and
normalizes all receipt fields and the complete ordered log array. It rejects
or defers the candidate unless:

- both complete normalized receipts are byte-for-byte equal and successful;
- their transaction hash, block number/hash, and transaction index equal the
  candidate placement;
- exactly one receipt log has the candidate's block-global `logIndex`; and
- that receipt log's address, topics, and data exactly equal the candidate.

The zero-based position of that exact log in the equal `receipt.logs` arrays is
the `receipt_log_ordinal`. Only the projector then creates:

```text
logical_id =
  "<chain_id>:<lowercase_transaction_hash>:<receipt_log_ordinal>"

occurrence_id =
  "<chain_id>:<lowercase_transaction_hash>:<receipt_log_ordinal>:<lowercase_block_hash>"
```

The application stores strict 20-byte addresses and 32-byte hashes as
Supabase `bytea`, preserving leading zeroes; the shared server codec rejects
missing prefixes, malformed digits, odd lengths, and incorrect typed widths.
Fixed-width addresses, hashes, and four-byte selectors may not be empty.
Variable-length raw event data accepts exactly `0x` as the canonical encoding
of zero bytes, including for indexed-only events such as
`QuoteAssetFeeSplitVaultV1.PayoutAddressUpdated`.
The application stores logical identities separately from occurrences. The
occurrence key is unique and retains block number/hash, transaction index,
receipt-local ordinal, block-global `logIndex`, Envio candidate ID, source
address, event type, raw topics/data, decoded payload, payload hash, and
release version.

When the same transaction is re-mined, a different block hash or block-global
`logIndex` produces a new Envio candidate. If both equal receipts place the
same log at the same receipt-local ordinal, it maps to the same logical
identity and a new occurrence. Different block hashes for one logical identity
are retained, not overwritten.

Only an occurrence whose receipt, exact log, block, and successful status match
on both RPCs at or below the safe head is canonical. At most one occurrence per
logical identity may be current-canonical. A changed payload on a re-mined
occurrence is preserved and raises a high-severity reorg finding; after
dual-RPC agreement the old placement becomes orphaned, the new placement
becomes canonical, and only the new occurrence enters the fold. Different
content or block-global `logIndex` for the same full occurrence key is an
integrity conflict and freezes promotion.

Static address and inclusive start block assign the release before decoding.
The shared Stock-Paired V2/V3 hook and vault factory use related launcher,
pool, reward-vault, and block provenance:

- launches tied to the V2 launcher/coordinator are `stock-paired-v2`;
- launches tied to the V3 launcher/coordinator are `stock-paired-v3`;
- hook or vault events must resolve through an already verified pool/reward
  relationship; unresolved events stay candidates and do not enter an
  application projection.

An event name alone never assigns a release.

## Launch assembly rules

For each launcher transaction, the projector groups records by release,
transaction hash, token, pool ID where present, and launch hash. It rejects
conflicting duplicates.

- A launch event is mandatory.
- The matching liquidity event is mandatory.
- The matching initial-buy event is mandatory even when its amounts are zero;
  token, pool, deployer/creator, and launch hash must agree.
- A Classic V3 custody event is mandatory, including unlocked mode; its mode,
  configuration hash, and custody address must agree with the launcher. Locked
  modes also require matching vesting-factory provenance; unlocked mode
  requires the zero custody address and no vesting-factory event.
- An ETH-funded Stock-Paired launch requires exactly one matching coordinator
  event in the same successful transaction.
- Launcher `rewardVault` must match the corresponding factory event and hook
  registration before reward history is promoted.
- The initial ordered reward allocation must have a verified seed tied to the
  canonical factory occurrence and must satisfy its selected authority path,
  commitment, local CREATE2, and canonical-event checks above. Historical
  getter/prediction enrichment is not required when either RPC cannot serve
  the complete exact-block set.
- Hook registration and fee disclosure must match the recorded pool and
  canonical PoolKey.

Missing or conflicting supporting events produce a reconciliation finding,
not a partial public launch.

## Pinned Uniswap v4 source

Use only:

```text
subgraph_id = DiYPVdygkfjDWhbxGSqAQxwBKmfKnkWQojqeM2rkLb3G
deployment = QmZsgJLiLQKpb8hxTmQ5LWyrFVvfWzVaL4WK8dfFBn7EeK
```

The deployment manifest resolves to schema CID
`QmTwiKpYxqMefzaNv9qqmqPuXNpBuvvKTSVvk28ZY1a7x3`. The queries below use only
fields present in that pinned schema.

The first pool operation receives the dual-RPC-confirmed block number. It must
return `_meta.block.number` equal to that number and `_meta.block.hash` equal
to the dual-RPC block hash. That returned hash becomes the block input for
every Swap, Hour, and Day page. Every entity query sets
`subgraphError: deny`; no partial result produced after a deterministic
indexing error is accepted.

### Pool snapshot

```graphql
query ProgrammablePoolSnapshot($poolId: ID!, $block: Int!) {
  _meta(block: { number: $block }) {
    deployment
    hasIndexingErrors
    block {
      number
      hash
    }
  }
  pool(
    id: $poolId
    block: { number: $block }
    subgraphError: deny
  ) {
    id
    createdAtTimestamp
    createdAtBlockNumber
    token0 {
      id
      decimals
    }
    token1 {
      id
      decimals
    }
    hooks
    feeTier
    tickSpacing
    liquidity
    sqrtPrice
    tick
    txCount
    volumeToken0
    volumeToken1
    volumeUSD
    totalValueLockedToken0
    totalValueLockedToken1
    totalValueLockedUSD
  }
}
```

`Pool.sqrtPrice` is the pinned schema's bigint `sqrtPriceX96` value.

### Swap pages

```graphql
query ProgrammableSwapPage(
  $poolId: String!
  $blockHash: Bytes!
  $from: BigInt!
  $toExclusive: BigInt!
  $cursor: ID!
) {
  _meta(block: { hash: $blockHash }) {
    deployment
    hasIndexingErrors
    block {
      number
      hash
    }
  }
  swaps(
    first: 250
    orderBy: id
    orderDirection: asc
    block: { hash: $blockHash }
    subgraphError: deny
    where: {
      pool: $poolId
      timestamp_gte: $from
      timestamp_lt: $toExclusive
      id_gt: $cursor
    }
  ) {
    id
    transaction {
      id
      blockNumber
      timestamp
    }
    timestamp
    pool {
      id
    }
    sender
    origin
    amount0
    amount1
    amountUSD
    sqrtPriceX96
    tick
    logIndex
  }
}
```

Start with an empty cursor and use the last returned ID for the next 250-row
page. Stop when a page returns fewer than 250 rows. The time interval is
half-open: `[from, toExclusive)`. Sort the collected result by transaction
block, transaction ID, and log index before producing a chart.

### Hour series

```graphql
query ProgrammablePoolHourSeries(
  $poolId: String!
  $blockHash: Bytes!
  $from: Int!
  $toExclusive: Int!
  $cursor: ID!
) {
  _meta(block: { hash: $blockHash }) {
    deployment
    hasIndexingErrors
    block {
      number
      hash
    }
  }
  poolHourDatas(
    first: 250
    orderBy: id
    orderDirection: asc
    block: { hash: $blockHash }
    subgraphError: deny
    where: {
      pool: $poolId
      periodStartUnix_gte: $from
      periodStartUnix_lt: $toExclusive
      id_gt: $cursor
    }
  ) {
    id
    periodStartUnix
    pool {
      id
    }
    liquidity
    sqrtPrice
    token0Price
    token1Price
    tick
    tvlUSD
    volumeToken0
    volumeToken1
    volumeUSD
    feesUSD
    txCount
    open
    high
    low
    close
  }
}
```

### Day series

```graphql
query ProgrammablePoolDaySeries(
  $poolId: String!
  $blockHash: Bytes!
  $from: Int!
  $toExclusive: Int!
  $cursor: ID!
) {
  _meta(block: { hash: $blockHash }) {
    deployment
    hasIndexingErrors
    block {
      number
      hash
    }
  }
  poolDayDatas(
    first: 250
    orderBy: id
    orderDirection: asc
    block: { hash: $blockHash }
    subgraphError: deny
    where: {
      pool: $poolId
      date_gte: $from
      date_lt: $toExclusive
      id_gt: $cursor
    }
  ) {
    id
    date
    pool {
      id
    }
    liquidity
    sqrtPrice
    token0Price
    token1Price
    tick
    tvlUSD
    volumeToken0
    volumeToken1
    volumeUSD
    feesUSD
    txCount
    open
    high
    low
    close
  }
}
```

Hour and day requests use the same 250-row `orderBy: id`, `id_gt` cursor
protocol as Swap. Their time intervals are half-open. Start with an empty
cursor, continue from the last returned ID, and stop when a page returns fewer
than 250 rows. Larger time ranges are split into non-overlapping half-open
windows. `feesUSD` is retained because it is present on both `PoolHourData`
and `PoolDayData` in the pinned schema CID.

## Pool identity and price math

The subgraph receives exactly the lowercased pool ID from the verified
Programmable projection. The response is accepted only when:

- returned `Pool.id` equals that pool ID;
- `Pool.hooks` equals the release hook;
- token0/token1 are exactly the sorted launch currencies;
- tick spacing is consistent with the verified launch and manifest; and
- recomputing the canonical PoolKey from verified launch/manifest fields
  returns the recorded pool ID.

For a dynamic-fee pool, `Pool.feeTier` can represent the most recently applied
fee rather than the fee value encoded in the canonical PoolKey. Treat the
subgraph value as applied-fee analytics only. Never compare it with the
PoolKey fee, use it to recompute a pool ID, or let it override the verified
launch/manifest PoolKey.

For `s = sqrtPriceX96`, the raw currency1-per-currency0 ratio is:

```text
raw_1_per_0 = s * s / 2^192
```

For decimals `d0` and `d1`, the human ratio is:

```text
token1_per_token0 = s * s * 10^d0 / (2^192 * 10^d1)
```

The inverse uses the reciprocal bigint expression. Implement both with
checked bigint `mulDiv`; do not convert the square to JavaScript `number`.
Select the direct or inverse expression from actual token ordering. Do not
assume native ETH or WETH is token0.

`Swap.amountUSD`, `Pool.volumeUSD`, `PoolHourData.volumeUSD`, and
`PoolDayData.volumeUSD` are market analytics. `NativeSwapFeesAccrued.
grossNativeAmount` and `QuoteSwapFeesAccrued.grossQuoteAmount` are hook
accounting. Preserve them as separate metrics and label their source.

## Failure behavior

Envio candidates are ignored for promotion when their address, cutoff,
signature, identity, payload, block hash, or release relationship fails
validation. Advancement freezes on RPC disagreement.

Uniswap data is ignored when the deployment, exact block number/hash, indexing
status, body bound, page bound, pool identity, or PoolKey check fails. The
verified launch remains visible with market data pending.

Neither provider can authorize rewards, claims, payout changes, or transaction
calldata.

## Checked-in evidence map

| Concern | Checked-in authority |
| --- | --- |
| Classic V2 addresses and deployment blocks | `contracts/deployments/mainnet-classic-v2.json`, `contracts/config/app-deployments.v1.json` |
| Classic V3 addresses and deployment blocks | `contracts/deployments/mainnet-classic-v3.json`, `contracts/config/app-deployments.v1.json` |
| Stock-Paired V1 sources | `contracts/deployments/mainnet-stock-paired-v1.json` |
| Stock-Paired V2 sources | `contracts/deployments/mainnet-stock-paired-v2.json` |
| Stock-Paired V3 sources and V2 reuse | `contracts/deployments/mainnet-stock-paired-v3.json` |
| Classic V2 events | `contracts/src/MemeLaunchV1.sol`, `contracts/src/EthCreatorFeeHookV2.sol` |
| Classic V3 events | `contracts/src/MemeLaunchV2.sol`, `contracts/src/EthCreatorFeeHookV3.sol`, `contracts/src/ClassicRewardVaultFactoryV1.sol`, `contracts/src/ClassicRewardVaultV1.sol`, `contracts/src/ClassicInitialBuyVestingWalletFactoryV1.sol` |
| Stock-Paired events | `contracts/src/StockPairedLaunchV1.sol`, `contracts/src/StockPairedLaunchV3.sol`, `contracts/src/StockPairedEthLaunchCoordinatorV1.sol`, `contracts/src/StockPairedEthLaunchCoordinatorV3.sol`, `contracts/src/QuoteAssetCreatorFeeHookV1.sol`, `contracts/src/QuoteAssetFeeSplitVaultFactoryV1.sol`, `contracts/src/QuoteAssetFeeSplitVaultV1.sol` |
