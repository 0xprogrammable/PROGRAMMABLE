// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";

import {
    IProgrammableNestedFactoryProfileV1,
    IProgrammableNestedFactoryProviderV1,
    IProgrammableNestedFactoryPostconditionVerifierV1
} from "programmable-src/router_vnext/IProgrammableNestedFactoryProfileV1.sol";
import {
    IProgrammableRuntimeBindingV1,
    IProgrammableUniversalLaunchKernelV1
} from "programmable-src/router_vnext/IProgrammableUniversalLaunchKernelV1.sol";
import { IProgrammableExactShardsProfileV1 } from "programmable-src/interfaces/IProgrammableExactShardsProfileV1.sol";
import { IProgrammableLaunchStampRouterV2 } from "programmable-src/interfaces/IProgrammableLaunchStampRouterV2.sol";
import {
    IProgrammableNestedFactoryV1,
    IProgrammableNestedHookV1,
    IProgrammableNestedNftV1
} from "programmable-src/interfaces/IProgrammableNestedFactoryV1.sol";

interface IProgrammableShardsHookCodeStoreV1 {
    function readHookCreationCodeV1() external view returns (bytes memory);

    function runtimeBindingHashV1() external view returns (bytes32);
}

interface IProgrammableNestedFactoryProfileBindingV1 {
    function KERNEL() external view returns (IProgrammableUniversalLaunchKernelV1);

    function PROVIDER() external view returns (address);

    function POSTCONDITION_VERIFIER() external view returns (address);

    function PROFILE_KEY() external view returns (bytes32);

    function PROVIDER_BINDING_HASH() external view returns (bytes32);

    function VERIFIER_BINDING_HASH() external view returns (bytes32);

    function computeNestedFactoryPlanHashV1(IProgrammableNestedFactoryProfileV1.NestedFactoryPlanV1 calldata plan)
        external
        pure
        returns (bytes32);
}

interface IProgrammableExactShardsHookStateV1 is IProgrammableNestedHookV1 {
    function builderFeesAccrued() external view returns (uint256);

    function launcherFeesAccrued() external view returns (uint256);

    function accFeePerNFT() external view returns (uint256);

    function dustScaled() external view returns (uint256);

    function releasedDustScaled() external view returns (uint256);

    function escrowBalance() external view returns (uint256);

    function circulating() external view returns (uint256);

    function pendingCount() external view returns (uint256);
}

interface IProgrammableExactShardsNftStateV1 is IProgrammableNestedNftV1 {
    function circulatingSupply() external view returns (uint256);
}

/// @notice Shared closed formulas for the one exact Shards execution plan.
/// @dev The legacy exact validator remains the source of truth for all route, prediction, runtime and liquidity
///      checks. This adapter only maps that already-frozen route into the Universal typed profile ABI.
abstract contract ProgrammableExactShardsNestedFactoryBaseV1 is IProgrammableRuntimeBindingV1 {
    using StateLibrary for IPoolManager;

    bytes32 internal constant NESTED_FACTORY_SCHEMA_ID = keccak256("NESTED_FACTORY_SCHEMA_V1");
    bytes32 internal constant NESTED_FACTORY_PLAN_TYPEHASH = keccak256(
        "NestedFactoryPlanV1(uint16 schemaVersion,bytes32 actionHash,bytes32 orderedComponentHeadHash,bytes32 componentGraphHash,bytes32 componentSetHash,bytes32 componentRuntimeSetHash,bytes32 expectedStateHash)"
    );
    bytes32 internal constant PROFILE_KEY = 0xb90e215e0e29c0dacf021e5e778847af4100433ee7d22014b73f8ca4add09d0c;
    bytes32 internal constant PROVIDER_PLAN_ID = keccak256("PROGRAMMABLE_EXACT_SHARDS_UNIVERSAL_PLAN_V1");
    bytes32 internal constant SOURCE_LAUNCH_ID = keccak256("JESSE_STAHL_SHARDS_V1_91B38F3_MAINNET_LAUNCH_V1");
    bytes32 internal constant SEMANTIC_MAPPING_SCHEMA_HASH =
        keccak256("PROGRAMMABLE_EXACT_SHARDS_OWNERLESS_SPLIT_REVENUE_SEMANTICS_V1");
    address internal constant TOKEN_OWNERLESS_SENTINEL =
        address(uint160(uint256(keccak256("PROGRAMMABLE_EXACT_SHARDS_TOKEN_OWNERLESS_V1"))));
    address internal constant HOOK_CONTROL_SENTINEL =
        address(uint160(uint256(keccak256("PROGRAMMABLE_EXACT_SHARDS_HOOK_BUILDER_ROLE_ONLY_V1"))));
    address internal constant SPLIT_REVENUE_SENTINEL =
        address(uint160(uint256(keccak256("PROGRAMMABLE_EXACT_SHARDS_HOLDER_BUILDER_LAUNCHER_SPLIT_V1"))));

    address internal constant POOL_MANAGER = 0x000000000004444c5dc75cB358380D2e3dE08A90;
    bytes32 internal constant POOL_MANAGER_RUNTIME_CODE_HASH =
        0x785f1014552b7ce7d5fb7d0c970ca60edee94fd00425d7ca21609acac7ce1293;
    address internal constant LAUNCH_WALLET = 0xceeBB3A6543CeBEB2ED66963897A0abEA52A50cC;
    address internal constant FACTORY_DEPLOYMENT_PROXY = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    bytes32 internal constant FACTORY_DEPLOYMENT_PROXY_RUNTIME_CODE_HASH =
        0x2fa86add0aed31f33a762c9d88e807c475bd51d0f52bd0955754b2608f7e4989;
    bytes32 internal constant FACTORY_SALT = 0x655a4b5a2b704bef84b4ff94adde0a7ac40ad0366c82ddca5290180fe4c3986d;
    bytes32 internal constant FACTORY_CREATION_CODE_HASH =
        0xc6b8a2cd51ccf198c4e6e41f668c4e4f558f81de0e677ef27373c614bf4c02f8;
    bytes32 internal constant FACTORY_INIT_CODE_HASH =
        0x7d05592489495559b1288f8ad342239b3fb95a6aa005b5b0b1551c9523401585;
    bytes32 internal constant FACTORY_DEPLOYMENT_CALLDATA_HASH =
        0xf37ce9748abe4d5243cbd26f48c6ea5789ab1ebe8e19ea96d2198693e957c4ec;
    address internal constant FACTORY = 0x9442a520e7b31D10177C75A363355C2C29141ac5;
    bytes32 internal constant FACTORY_RUNTIME_CODE_HASH =
        0x134a9e5674f22e62e939c2238693077b8027c553bb26d6a4e9e3d8554e5f85b5;
    address internal constant RENDERER = 0x090DBD2FaB1a467f90ed82a443eFa9AAb658DE14;
    bytes32 internal constant RENDERER_CREATION_CODE_HASH =
        0x910d02d740c71d608b1dc3f49e26288b0f8a62abda0c7767e251d53520a6b51e;
    bytes32 internal constant RENDERER_RUNTIME_CODE_HASH =
        0x9b54a61918b2ddf9b7daf41d9bf2d705cbef3a0fd618275762b99e19c53459bf;
    address internal constant LAUNCHER_FEE_RECIPIENT = 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c;
    address internal constant BUILDER_FEE_RECIPIENT = LAUNCH_WALLET;
    bytes32 internal constant TOKEN_CREATION_CODE_HASH =
        0xa6461c32c0121f0090519945d9c22ed6406a783994e020f72a20e85796cad107;
    bytes32 internal constant HOOK_CREATION_CODE_HASH =
        0x3fbdbc069ee5bfcb1ded77a8d4e550f1bb0692a488b6eb5d23dac090fbca0716;
    bytes32 internal constant NFT_CREATION_CODE_HASH =
        0x888e18b33ff193b65eb61f44bc578d8d9365b505014af3782762a9d61fa39150;
    bytes32 internal constant TOKEN_SALT = 0xca9944c923e24ba5cb3188a29b18c3305158e686e39473e91bbe31fc019816ab;
    bytes32 internal constant EFFECTIVE_TOKEN_SALT = 0x2fb771368a131f3ebf686980b44c57230bf257f4b82e95a10ef46d9b2bd7db37;
    bytes32 internal constant HOOK_SALT = bytes32(uint256(0x52e1));
    bytes32 internal constant NFT_SALT = 0xd6d0434679cca1aa62e44e4f50902908a6858b908a18916daa546084fc1aaa87;
    address internal constant TOKEN = 0x50d17EAaeB52c66E64b918385AbF6523fDAE57CF;
    bytes32 internal constant TOKEN_RUNTIME_CODE_HASH =
        0xb2737fd93f2ff31e850e2be773e6e7a92a239b28091be1d4b122ff864cd7aae8;
    address internal constant HOOK = 0xbA318baA8649962fD77CC7082d098f2C09Fd60cC;
    bytes32 internal constant HOOK_RUNTIME_CODE_HASH =
        0x2a2174aff52c3ea9ddf0a6081464c9c6dbc43ddc93609c74d9610f50f486c1e1;
    address internal constant NFT = 0x9fDA98dE1B7061ae02A9Aec7A6f8ed75a8Feb8F3;
    bytes32 internal constant NFT_RUNTIME_CODE_HASH =
        0xc3e3ea6cf4d2e13fa07a3b053d57cd7d6a6ecac7633aed86ab971d5e53959bb3;
    bytes32 internal constant TOKEN_INIT_CODE_HASH = 0x6e68433c748d6bac0a119815b0447aaa016c5fec1334cc9a412e76aa8149a358;
    bytes32 internal constant HOOK_INIT_CODE_HASH = 0x6eb7c7447fa82da98f4776bcc0362303574b96c2584d1bef6ebf4aca2cc80d58;
    bytes32 internal constant NFT_INIT_CODE_HASH = 0x0b92ef914725a8a4cc39c39fd62fdd1b5123f3159e1eb71e20ae517c090a0c9b;
    bytes32 internal constant CONFIGURATION_HASH = 0xa98b7b95777267181a2b93a33632991e80a49f4a57d94150f8dfbd90421f34c1;
    bytes32 internal constant POOL_ID = 0x075885e47ec15084de91826faafab9c2cd4fda4d24fd9e5ce3af6a4be4ad926d;
    bytes32 internal constant POOL_KEY_HASH = 0x95c1d301b4a0be5bf2ec99270902aae6e8d8bd16a96a005d5985583c0b49835a;
    bytes32 internal constant SOURCE_REVISION_HASH = 0x3352fe14662ce467e98f475cf91f10304ce4d69b6342fae4bf3dc968c494d6dc;
    bytes32 internal constant MANIFEST_HASH = 0x4672dfda95c9765916397701479483b8e1db852165949518cdc9932fd8e1b359;
    bytes32 internal constant REVENUE_POLICY_HASH = 0xaa78b0bf63fca83fa9b969fbb6b2bb1ecabcbe49908a48f92403e8e51e4adab2;
    bytes32 internal constant LAUNCH_CALLDATA_HASH = 0x39d08baf1cdececc5829853fd1274547c2e8260779d0c227ec30dc44daf1ae89;
    bytes32 internal constant LEGACY_EXACT_RESULT_HASH =
        0x29de1a5462fe7b07a0d58894f7ec5e2eb4e870c83153e2109647c7f4094c828b;
    int24 internal constant TICK_LOWER = -887_220;
    int24 internal constant TICK_BAND = 22_980;
    int24 internal constant TICK_UPPER = 69_060;
    uint160 internal constant START_SQRT_PRICE_X96 = 2_502_784_483_440_051_878_955_016_419_363;
    uint160 internal constant REQUIRED_HOOK_FLAGS = 0x20cc;
    uint256 internal constant SEED_AMOUNT = 10_000 ether;
    uint128 internal constant SEED_FULL_RANGE_LIQUIDITY = 94_968_020_265_212_007_478;
    uint128 internal constant SEED_BAND_LIQUIDITY = 246_177_857_746_328_406_540;
    uint256 internal constant SEED_DUST = 18;
    uint256 internal constant POOL_MANAGER_TOKEN_BALANCE = SEED_AMOUNT - SEED_DUST;

    bytes32 private constant RUNTIME_IMMUTABLE_BINDING_TYPEHASH = keccak256(
        "ProgrammableExactShardsNestedFactoryImmutableBindingV1(uint256 chainId,address adapter,bytes32 roleId,address kernel,bytes32 kernelRuntimeCodeHash,address exactValidator,bytes32 exactValidatorRuntimeCodeHash,address hookCodeStore,bytes32 hookCodeStoreRuntimeCodeHash,bytes32 hookCodeStoreBindingHash)"
    );
    bytes32 private constant RUNTIME_ROUTE_BINDING_TYPEHASH = keccak256(
        "ProgrammableExactShardsNestedFactoryRouteBindingV1(bytes32 infrastructureHash,bytes32 componentHash,bytes32 evidenceHash)"
    );
    bytes32 private constant RUNTIME_INFRASTRUCTURE_BINDING_TYPEHASH = keccak256(
        "ProgrammableExactShardsNestedFactoryInfrastructureBindingV1(bytes32 profileKey,bytes32 providerPlanId,bytes32 sourceLaunchId,address factory,bytes32 factoryRuntimeCodeHash,address renderer,bytes32 rendererRuntimeCodeHash,address poolManager,bytes32 poolManagerRuntimeCodeHash,bytes32 poolId)"
    );
    bytes32 private constant RUNTIME_COMPONENT_BINDING_TYPEHASH = keccak256(
        "ProgrammableExactShardsNestedFactoryComponentBindingV1(address token,bytes32 tokenRuntimeCodeHash,address hook,bytes32 hookRuntimeCodeHash,address nft,bytes32 nftRuntimeCodeHash,bytes32 configurationHash)"
    );
    bytes32 private constant RUNTIME_EVIDENCE_BINDING_TYPEHASH = keccak256(
        "ProgrammableExactShardsNestedFactoryEvidenceBindingV1(bytes32 sourceRevisionHash,bytes32 manifestHash,bytes32 revenuePolicyHash,bytes32 launchCalldataHash,bytes32 semanticMappingSchemaHash)"
    );
    bytes32 private constant RUNTIME_BINDING_TYPEHASH = keccak256(
        "ProgrammableExactShardsNestedFactoryRuntimeBindingV1(bytes32 immutableBindingHash,bytes32 routeBindingHash)"
    );
    bytes32 private constant ACTION_IDENTITY_TYPEHASH = keccak256(
        "NestedFactoryActionIdentityV1(bytes32 providerPlanId,bytes32 factorySalt,address applicantWallet,bytes32 sourceLaunchId,address poolManager,bytes32 poolManagerRuntimeCodeHash,bytes32 poolId,address tokenOwner,address hookOwner,address treasury)"
    );
    bytes32 private constant ACTION_ECONOMICS_TYPEHASH = keccak256(
        "NestedFactoryActionEconomicsV1(uint256 tokenSupply,uint256 nativeValue,bytes32 hookPermissionsHash,bytes32 configurationHash)"
    );
    bytes32 private constant ACTION_TYPEHASH =
        keccak256("NestedFactoryActionV1(bytes32 identityHash,bytes32 economicsHash)");
    bytes32 private constant COMPONENT_TYPEHASH = keccak256(
        "NestedFactoryComponentV1(uint8 role,uint8 scope,address account,bytes32 runtimeCodeHash,bytes32 creationProvenanceHash,bytes32 ownershipBindingHash,bytes32 configurationHash)"
    );
    bytes32 private constant PROVIDER_EXECUTION_ID_TYPEHASH = keccak256(
        "NestedFactoryProviderExecutionIdV1(bytes32 providerBindingHash,bytes32 executionKey,bytes32 grantDigest,bytes32 stampLaunchId,bytes32 antiReplayNonce,bytes32 actionHash,bytes32 orderedComponentHeadHash)"
    );
    bytes32 private constant COMPONENT_PROVENANCE_TYPEHASH = keccak256(
        "ProgrammableExactShardsComponentProvenanceV1(uint8 role,uint8 deploymentKind,address deployer,uint64 createNonce,bytes32 salt,bytes32 initCodeHash,address account)"
    );
    bytes32 private constant COMPONENT_OWNERSHIP_TYPEHASH = keccak256(
        "ProgrammableExactShardsComponentOwnershipV1(uint8 role,address semanticSentinel,address launcherFeeRecipient,address builderFeeRecipient,bytes32 semanticMappingSchemaHash)"
    );
    bytes32 private constant COMPONENT_CONFIGURATION_TYPEHASH = keccak256(
        "ProgrammableExactShardsComponentConfigurationV1(uint8 role,address account,bytes32 configurationHash,bytes32 poolId)"
    );
    bytes32 private constant COMPONENT_GRAPH_TYPEHASH = keccak256(
        "ProgrammableExactShardsComponentGraphV1(address factory,address renderer,address token,address hook,address nft,address poolManager,bytes32 poolId)"
    );
    bytes32 private constant RETURNED_IDENTITIES_TYPEHASH = keccak256(
        "ProgrammableExactShardsReturnedIdentitiesV1(address factory,address renderer,address token,address hook,address nft)"
    );
    bytes32 private constant ARCHITECTURE_STATE_TYPEHASH = keccak256(
        "ProgrammableExactShardsArchitectureStateV1(bytes32 exactResultHash,bytes32 componentGraphHash,bytes32 componentSetHash,bytes32 componentRuntimeSetHash)"
    );
    bytes32 private constant POOL_STATE_TYPEHASH =
        keccak256("ProgrammableExactShardsPoolStateV1(bytes32 configurationHash,bytes32 liquidityHash)");
    bytes32 private constant POOL_CONFIGURATION_STATE_TYPEHASH = keccak256(
        "ProgrammableExactShardsPoolConfigurationStateV1(address poolManager,bytes32 poolId,bytes32 poolKeyHash,address hook,int24 tickLower,int24 tickBand,int24 tickUpper,uint160 startSqrtPriceX96)"
    );
    bytes32 private constant POOL_LIQUIDITY_STATE_TYPEHASH = keccak256(
        "ProgrammableExactShardsPoolLiquidityStateV1(uint128 seedLiquidity,uint128 seedLiquidityBand,uint256 seedDust)"
    );
    bytes32 private constant REVENUE_POLICY_STATE_TYPEHASH = keccak256(
        "ProgrammableExactShardsRevenuePolicyStateV1(bytes32 revenuePolicyHash,address launcherFeeRecipient,address builderFeeRecipient,uint16 holderShareBps,uint16 builderShareBps,uint16 launcherShareBps)"
    );
    bytes32 private constant REVENUE_COUNTER_STATE_TYPEHASH = keccak256(
        "ProgrammableExactShardsRevenueCounterStateV1(uint256 builderFeesAccrued,uint256 launcherFeesAccrued,uint256 accFeePerNft,uint256 dustScaled,uint256 releasedDustScaled,uint256 escrowBalance,uint256 circulating,uint256 pendingCount)"
    );
    bytes32 private constant REVENUE_STATE_TYPEHASH =
        keccak256("ProgrammableExactShardsRevenueStateV1(bytes32 policyStateHash,bytes32 counterStateHash)");
    bytes32 private constant VALUE_FLOW_TYPEHASH = keccak256(
        "ProgrammableExactShardsValueFlowV1(uint256 nativeValue,uint256 tokenSupply,address factory,uint256 factoryTokenBalance,address hook,uint256 hookTokenBalance,address poolManager,uint256 poolManagerTokenBalance)"
    );
    bytes32 private constant HOOK_PERMISSIONS_TYPEHASH =
        keccak256("ProgrammableExactShardsHookPermissionsV1(uint160 flags)");
    bytes32 internal constant PREFLIGHT_READBACK_TYPEHASH =
        keccak256("ProgrammableExactShardsPreflightReadbackV1(bytes32 bindingHash,bytes32 stateHash)");
    bytes32 internal constant PREFLIGHT_BINDING_TYPEHASH = keccak256(
        "ProgrammableExactShardsPreflightBindingV1(uint256 chainId,address verifier,bytes32 verifierBindingHash,address profile,bytes32 planHash)"
    );
    bytes32 internal constant PREFLIGHT_STATE_TYPEHASH = keccak256(
        "ProgrammableExactShardsPreflightStateV1(bytes32 exactResultHash,bytes32 componentGraphHash,bytes32 architectureStateHash,bytes32 poolStateHash,bytes32 revenueStateHash,bytes32 valueFlowHash)"
    );

    IProgrammableUniversalLaunchKernelV1 internal immutable KERNEL;
    bytes32 internal immutable KERNEL_RUNTIME_CODE_HASH;
    IProgrammableExactShardsProfileV1 internal immutable EXACT_VALIDATOR;
    bytes32 internal immutable EXACT_VALIDATOR_RUNTIME_CODE_HASH;
    IProgrammableShardsHookCodeStoreV1 internal immutable HOOK_CODE_STORE;
    bytes32 internal immutable HOOK_CODE_STORE_RUNTIME_CODE_HASH;
    bytes32 internal immutable HOOK_CODE_STORE_BINDING_HASH;

    struct ProviderCorrelationV1 {
        bytes32 executionKey;
        bytes32 grantDigest;
        bytes32 stampLaunchId;
        bytes32 antiReplayNonce;
    }

    error InvalidBinding(uint256 field);
    error RuntimeCodeHashDrift(address account);

    constructor(
        IProgrammableUniversalLaunchKernelV1 kernel,
        bytes32 kernelRuntimeCodeHash,
        IProgrammableExactShardsProfileV1 exactValidator,
        bytes32 exactValidatorRuntimeCodeHash,
        IProgrammableShardsHookCodeStoreV1 hookCodeStore,
        bytes32 hookCodeStoreRuntimeCodeHash,
        bytes32 hookCodeStoreBindingHash
    ) {
        _requireRuntime(address(kernel), kernelRuntimeCodeHash);
        _requireRuntime(address(exactValidator), exactValidatorRuntimeCodeHash);
        _requireRuntime(address(hookCodeStore), hookCodeStoreRuntimeCodeHash);
        if (
            hookCodeStoreBindingHash == bytes32(0) || hookCodeStore.runtimeBindingHashV1() != hookCodeStoreBindingHash
                || keccak256(hookCodeStore.readHookCreationCodeV1()) != HOOK_CREATION_CODE_HASH
        ) revert InvalidBinding(1);
        KERNEL = kernel;
        KERNEL_RUNTIME_CODE_HASH = kernelRuntimeCodeHash;
        EXACT_VALIDATOR = exactValidator;
        EXACT_VALIDATOR_RUNTIME_CODE_HASH = exactValidatorRuntimeCodeHash;
        HOOK_CODE_STORE = hookCodeStore;
        HOOK_CODE_STORE_RUNTIME_CODE_HASH = hookCodeStoreRuntimeCodeHash;
        HOOK_CODE_STORE_BINDING_HASH = hookCodeStoreBindingHash;
    }

    function runtimeBindingHashV1() public view override returns (bytes32) {
        bytes32 immutableBindingHash = keccak256(
            abi.encode(
                RUNTIME_IMMUTABLE_BINDING_TYPEHASH,
                block.chainid,
                address(this),
                _adapterRoleId(),
                KERNEL,
                KERNEL_RUNTIME_CODE_HASH,
                EXACT_VALIDATOR,
                EXACT_VALIDATOR_RUNTIME_CODE_HASH,
                HOOK_CODE_STORE,
                HOOK_CODE_STORE_RUNTIME_CODE_HASH,
                HOOK_CODE_STORE_BINDING_HASH
            )
        );
        bytes32 infrastructureHash = keccak256(
            abi.encode(
                RUNTIME_INFRASTRUCTURE_BINDING_TYPEHASH,
                PROFILE_KEY,
                PROVIDER_PLAN_ID,
                SOURCE_LAUNCH_ID,
                FACTORY,
                FACTORY_RUNTIME_CODE_HASH,
                RENDERER,
                RENDERER_RUNTIME_CODE_HASH,
                POOL_MANAGER,
                POOL_MANAGER_RUNTIME_CODE_HASH,
                POOL_ID
            )
        );
        bytes32 componentHash = keccak256(
            abi.encode(
                RUNTIME_COMPONENT_BINDING_TYPEHASH,
                TOKEN,
                TOKEN_RUNTIME_CODE_HASH,
                HOOK,
                HOOK_RUNTIME_CODE_HASH,
                NFT,
                NFT_RUNTIME_CODE_HASH,
                CONFIGURATION_HASH
            )
        );
        bytes32 evidenceHash = keccak256(
            abi.encode(
                RUNTIME_EVIDENCE_BINDING_TYPEHASH,
                SOURCE_REVISION_HASH,
                MANIFEST_HASH,
                REVENUE_POLICY_HASH,
                LAUNCH_CALLDATA_HASH,
                SEMANTIC_MAPPING_SCHEMA_HASH
            )
        );
        bytes32 routeBindingHash =
            keccak256(abi.encode(RUNTIME_ROUTE_BINDING_TYPEHASH, infrastructureHash, componentHash, evidenceHash));
        return keccak256(abi.encode(RUNTIME_BINDING_TYPEHASH, immutableBindingHash, routeBindingHash));
    }

    function componentGraphHashV1() public pure returns (bytes32) {
        return
            keccak256(abi.encode(COMPONENT_GRAPH_TYPEHASH, FACTORY, RENDERER, TOKEN, HOOK, NFT, POOL_MANAGER, POOL_ID));
    }

    function hookPermissionsHashV1() public pure returns (bytes32) {
        return keccak256(abi.encode(HOOK_PERMISSIONS_TYPEHASH, REQUIRED_HOOK_FLAGS));
    }

    function returnedIdentitiesHashV1() public pure returns (bytes32) {
        return keccak256(abi.encode(RETURNED_IDENTITIES_TYPEHASH, FACTORY, RENDERER, TOKEN, HOOK, NFT));
    }

    function poolStateHashV1() public pure returns (bytes32) {
        bytes32 configurationHash = keccak256(
            abi.encode(
                POOL_CONFIGURATION_STATE_TYPEHASH,
                POOL_MANAGER,
                POOL_ID,
                POOL_KEY_HASH,
                HOOK,
                TICK_LOWER,
                TICK_BAND,
                TICK_UPPER,
                START_SQRT_PRICE_X96
            )
        );
        bytes32 liquidityHash = keccak256(
            abi.encode(POOL_LIQUIDITY_STATE_TYPEHASH, SEED_FULL_RANGE_LIQUIDITY, SEED_BAND_LIQUIDITY, SEED_DUST)
        );
        return keccak256(abi.encode(POOL_STATE_TYPEHASH, configurationHash, liquidityHash));
    }

    function revenueStateHashV1() public pure returns (bytes32) {
        bytes32 policyStateHash = keccak256(
            abi.encode(
                REVENUE_POLICY_STATE_TYPEHASH,
                REVENUE_POLICY_HASH,
                LAUNCHER_FEE_RECIPIENT,
                BUILDER_FEE_RECIPIENT,
                uint16(8000),
                uint16(1000),
                uint16(1000)
            )
        );
        bytes32 counterStateHash =
            keccak256(abi.encode(REVENUE_COUNTER_STATE_TYPEHASH, uint256(0), 0, 0, 0, 0, 0, 0, 0));
        return keccak256(abi.encode(REVENUE_STATE_TYPEHASH, policyStateHash, counterStateHash));
    }

    function valueFlowHashV1() public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                VALUE_FLOW_TYPEHASH,
                uint256(0),
                SEED_AMOUNT,
                FACTORY,
                uint256(0),
                HOOK,
                SEED_DUST,
                POOL_MANAGER,
                POOL_MANAGER_TOKEN_BALANCE
            )
        );
    }

    function expectedComponentsV1()
        external
        pure
        returns (IProgrammableNestedFactoryProfileV1.ComponentExpectationV1[] memory components)
    {
        components = _expectedComponents();
    }

    function expectedStateHashesV1()
        external
        pure
        returns (
            bytes32 componentSetHash,
            bytes32 componentRuntimeSetHash,
            bytes32 architectureStateHash,
            bytes32 poolStateHash,
            bytes32 revenueStateHash,
            bytes32 valueFlowHash,
            bytes32 returnedIdentitiesHash
        )
    {
        IProgrammableNestedFactoryProfileV1.ComponentExpectationV1[] memory components = _expectedComponents();
        (, componentSetHash, componentRuntimeSetHash) = _componentHashesMemory(components);
        architectureStateHash = _architectureStateHash(componentSetHash, componentRuntimeSetHash);
        poolStateHash = poolStateHashV1();
        revenueStateHash = revenueStateHashV1();
        valueFlowHash = valueFlowHashV1();
        returnedIdentitiesHash = returnedIdentitiesHashV1();
    }

    function _requireProfileBinding(address profile, bool providerRole) internal view {
        _requireRuntime(address(KERNEL), KERNEL_RUNTIME_CODE_HASH);
        IProgrammableUniversalLaunchKernelV1.ProfileDescriptorV1 memory descriptor =
            KERNEL.profileDescriptorV1(PROFILE_KEY);
        IProgrammableNestedFactoryProfileBindingV1 boundProfile = IProgrammableNestedFactoryProfileBindingV1(profile);
        bytes32 profileProviderBindingHash = boundProfile.PROVIDER_BINDING_HASH();
        if (
            descriptor.profileKey != PROFILE_KEY || descriptor.schemaId != NESTED_FACTORY_SCHEMA_ID
                || descriptor.profileVersion != 1
                || descriptor.capabilitySemantics != IProgrammableUniversalLaunchKernelV1.CapabilitySemantics.Execute
                || descriptor.module != profile || descriptor.moduleRuntimeCodeHash != profile.codehash
                || descriptor.actionTypeHash != NESTED_FACTORY_PLAN_TYPEHASH
                || descriptor.exactContractBindingHash != profileProviderBindingHash
                || descriptor.providerBindingHash != profileProviderBindingHash
                || descriptor.revenuePolicyHash != REVENUE_POLICY_HASH
                || descriptor.status != IProgrammableUniversalLaunchKernelV1.ProfileStatus.Active
                || address(boundProfile.KERNEL()) != address(KERNEL) || boundProfile.PROFILE_KEY() != PROFILE_KEY
                || (providerRole && boundProfile.PROVIDER() != address(this))
                || (!providerRole && boundProfile.POSTCONDITION_VERIFIER() != address(this))
                || (providerRole && profileProviderBindingHash != runtimeBindingHashV1())
                || (!providerRole && boundProfile.VERIFIER_BINDING_HASH() != runtimeBindingHashV1())
        ) revert InvalidBinding(2);
    }

    function _validateAction(IProgrammableNestedFactoryProfileV1.NestedFactoryActionV1 calldata action) internal pure {
        if (
            action.providerPlanId != PROVIDER_PLAN_ID || action.factorySalt != FACTORY_SALT
                || action.applicantWallet != LAUNCH_WALLET || action.sourceLaunchId != SOURCE_LAUNCH_ID
                || action.poolManager != POOL_MANAGER
                || action.poolManagerRuntimeCodeHash != POOL_MANAGER_RUNTIME_CODE_HASH || action.poolId != POOL_ID
                || action.tokenOwner != TOKEN_OWNERLESS_SENTINEL || action.hookOwner != HOOK_CONTROL_SENTINEL
                || action.treasury != SPLIT_REVENUE_SENTINEL || action.tokenSupply != SEED_AMOUNT
                || action.nativeValue != 0 || action.hookPermissionsHash != hookPermissionsHashV1()
                || action.configurationHash != CONFIGURATION_HASH
        ) revert InvalidBinding(3);
    }

    function _validateComponents(IProgrammableNestedFactoryProfileV1.ComponentExpectationV1[] calldata components)
        internal
        pure
        returns (bytes32 orderedHead, bytes32 componentSetHash, bytes32 componentRuntimeSetHash)
    {
        IProgrammableNestedFactoryProfileV1.ComponentExpectationV1[] memory expected = _expectedComponents();
        if (components.length != expected.length) revert InvalidBinding(4);
        for (uint256 i; i < expected.length; ++i) {
            IProgrammableNestedFactoryProfileV1.ComponentExpectationV1 calldata actual = components[i];
            IProgrammableNestedFactoryProfileV1.ComponentExpectationV1 memory wanted = expected[i];
            if (
                actual.role != wanted.role || actual.scope != wanted.scope || actual.account != wanted.account
                    || actual.runtimeCodeHash != wanted.runtimeCodeHash
                    || actual.creationProvenanceHash != wanted.creationProvenanceHash
                    || actual.ownershipBindingHash != wanted.ownershipBindingHash
                    || actual.configurationHash != wanted.configurationHash
            ) revert InvalidBinding(5 + i);
            bytes32 leaf = _componentLeaf(actual);
            orderedHead = keccak256(abi.encode(orderedHead, i, leaf));
            componentSetHash = keccak256(abi.encode(componentSetHash, i, actual.role, actual.account, leaf));
            componentRuntimeSetHash = keccak256(
                abi.encode(componentRuntimeSetHash, i, actual.role, actual.account, actual.runtimeCodeHash)
            );
        }
    }

    function _validatePlan(IProgrammableNestedFactoryProfileV1.NestedFactoryPlanV1 calldata plan)
        internal
        pure
        returns (bytes32 componentSetHash, bytes32 componentRuntimeSetHash)
    {
        _validateAction(plan.action);
        (, componentSetHash, componentRuntimeSetHash) = _validateComponents(plan.components);
        if (
            plan.schemaVersion != 1 || plan.componentGraphHash != componentGraphHashV1()
                || plan.componentSetHash != componentSetHash || plan.componentRuntimeSetHash != componentRuntimeSetHash
                || plan.expectedReturnedIdentitiesHash != returnedIdentitiesHashV1()
                || plan.expectedArchitectureStateHash
                    != _architectureStateHash(componentSetHash, componentRuntimeSetHash)
                || plan.expectedPoolStateHash != poolStateHashV1()
                || plan.expectedRevenueStateHash != revenueStateHashV1()
                || plan.expectedValueFlowHash != valueFlowHashV1()
        ) revert InvalidBinding(11);
    }

    function _exactPreflight(bytes32 launchId)
        internal
        view
        returns (IProgrammableLaunchStampRouterV2.NestedFactoryRouteV1 memory route)
    {
        IProgrammableLaunchStampRouterV2.StampRequestV2 memory request;
        (route, request) = _routeAndRequest(launchId);
        _requireRuntime(address(EXACT_VALIDATOR), EXACT_VALIDATOR_RUNTIME_CODE_HASH);
        (
            bytes32 poolId,
            bytes32 poolKeyHash,
            bytes32 expectedResultHash,
            IProgrammableLaunchStampRouterV2.ExecutionModeV2 executionMode
        ) = EXACT_VALIDATOR.validatePreV1(route, request, IPoolManager(POOL_MANAGER));
        if (
            poolId != POOL_ID || poolKeyHash != POOL_KEY_HASH || expectedResultHash != LEGACY_EXACT_RESULT_HASH
                || executionMode != IProgrammableLaunchStampRouterV2.ExecutionModeV2.EXACT_FACTORY_LAUNCH_EXECUTED
        ) revert InvalidBinding(12);
    }

    function _exactPostflight(IProgrammableLaunchStampRouterV2.NestedFactoryRouteV1 memory route, bytes32 launchId)
        internal
        view
    {
        (, IProgrammableLaunchStampRouterV2.StampRequestV2 memory request) = _routeAndRequest(launchId);
        bytes32 observed = EXACT_VALIDATOR.validatePostV1(
            route,
            request,
            IPoolManager(POOL_MANAGER),
            IProgrammableLaunchStampRouterV2.ExecutionModeV2.EXACT_FACTORY_LAUNCH_EXECUTED
        );
        if (observed != LEGACY_EXACT_RESULT_HASH) revert InvalidBinding(13);
        _assertSupplementalPostState();
    }

    function _routeAndRequest(bytes32 launchId)
        internal
        view
        returns (
            IProgrammableLaunchStampRouterV2.NestedFactoryRouteV1 memory route,
            IProgrammableLaunchStampRouterV2.StampRequestV2 memory request
        )
    {
        _requireRuntime(address(HOOK_CODE_STORE), HOOK_CODE_STORE_RUNTIME_CODE_HASH);
        if (HOOK_CODE_STORE.runtimeBindingHashV1() != HOOK_CODE_STORE_BINDING_HASH) revert InvalidBinding(14);
        bytes memory hookCreationCode = HOOK_CODE_STORE.readHookCreationCodeV1();
        if (keccak256(hookCreationCode) != HOOK_CREATION_CODE_HASH) revert InvalidBinding(15);

        IProgrammableNestedFactoryV1.LaunchParams memory params = IProgrammableNestedFactoryV1.LaunchParams({
            tickLower: TICK_LOWER,
            tickBand: TICK_BAND,
            tickUpper: TICK_UPPER,
            startSqrtPriceX96: START_SQRT_PRICE_X96,
            renderer: address(0),
            tokenName: "Shard",
            tokenSymbol: "SHARD",
            nftName: "Shards",
            nftSymbol: "SHARDS"
        });
        route.profileIdHash = keccak256("exact-shards-nested-factory");
        route.profileVersionHash = keccak256("1.0.0");
        route.profileKey = PROFILE_KEY;
        route.sourceRevisionHash = SOURCE_REVISION_HASH;
        route.manifestHash = MANIFEST_HASH;
        route.revenuePolicyHash = REVENUE_POLICY_HASH;
        route.factoryDeploymentProxy = FACTORY_DEPLOYMENT_PROXY;
        route.factorySalt = FACTORY_SALT;
        route.factoryCreationCodeHash = FACTORY_CREATION_CODE_HASH;
        route.factoryInitCodeHash = FACTORY_INIT_CODE_HASH;
        route.factoryDeploymentCalldataHash = FACTORY_DEPLOYMENT_CALLDATA_HASH;
        route.factory = FACTORY;
        route.factoryRuntimeCodeHash = FACTORY_RUNTIME_CODE_HASH;
        route.renderer = RENDERER;
        route.rendererCreationCodeHash = RENDERER_CREATION_CODE_HASH;
        route.rendererRuntimeCodeHash = RENDERER_RUNTIME_CODE_HASH;
        route.launcherFeeRecipient = LAUNCHER_FEE_RECIPIENT;
        route.builderFeeRecipient = BUILDER_FEE_RECIPIENT;
        route.tokenCreationCodeHash = TOKEN_CREATION_CODE_HASH;
        route.hookCreationCodeHash = HOOK_CREATION_CODE_HASH;
        route.nftCreationCodeHash = NFT_CREATION_CODE_HASH;
        route.tokenSalt = TOKEN_SALT;
        route.effectiveTokenSalt = EFFECTIVE_TOKEN_SALT;
        route.hookSalt = HOOK_SALT;
        route.hookCreationCode = hookCreationCode;
        route.params = params;
        route.expectedToken = TOKEN;
        route.expectedTokenRuntimeCodeHash = TOKEN_RUNTIME_CODE_HASH;
        route.expectedHook = HOOK;
        route.expectedHookRuntimeCodeHash = HOOK_RUNTIME_CODE_HASH;
        route.expectedNft = NFT;
        route.expectedNftRuntimeCodeHash = NFT_RUNTIME_CODE_HASH;
        route.expectedConfigurationHash = CONFIGURATION_HASH;
        route.expectedLaunchCalldataHash = LAUNCH_CALLDATA_HASH;

        request.launchId = launchId;
        request.token = TOKEN;
        request.tokenRuntimeCodeHash = TOKEN_RUNTIME_CODE_HASH;
        request.hook = HOOK;
        request.hookRuntimeCodeHash = HOOK_RUNTIME_CODE_HASH;
        request.nft = NFT;
        request.nftRuntimeCodeHash = NFT_RUNTIME_CODE_HASH;
        request.poolKey = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(TOKEN),
            fee: 0,
            tickSpacing: 60,
            hooks: IHooks(HOOK)
        });
    }

    function _assertSupplementalPostState() internal view {
        IProgrammableExactShardsHookStateV1 hook = IProgrammableExactShardsHookStateV1(HOOK);
        IProgrammableExactShardsNftStateV1 nft = IProgrammableExactShardsNftStateV1(NFT);
        (uint160 sqrtPriceX96, int24 tick,,) = IPoolManager(POOL_MANAGER).getSlot0(PoolId.wrap(POOL_ID));
        if (
            sqrtPriceX96 != START_SQRT_PRICE_X96 || tick != TICK_UPPER
                || hook.builderFeeRecipient() != BUILDER_FEE_RECIPIENT
                || hook.launcherFeeRecipient() != LAUNCHER_FEE_RECIPIENT || hook.builderFeesAccrued() != 0
                || hook.launcherFeesAccrued() != 0 || hook.accFeePerNFT() != 0 || hook.dustScaled() != 0
                || hook.releasedDustScaled() != 0 || hook.escrowBalance() != 0 || hook.circulating() != 0
                || hook.pendingCount() != 0 || nft.circulatingSupply() != 0 || IERC20(TOKEN).balanceOf(FACTORY) != 0
                || IERC20(TOKEN).balanceOf(HOOK) != SEED_DUST
                || IERC20(TOKEN).balanceOf(POOL_MANAGER) != POOL_MANAGER_TOKEN_BALANCE || HOOK.balance != 0
        ) revert InvalidBinding(16);
    }

    function _expectedComponents()
        internal
        pure
        returns (IProgrammableNestedFactoryProfileV1.ComponentExpectationV1[] memory components)
    {
        components = new IProgrammableNestedFactoryProfileV1.ComponentExpectationV1[](5);
        components[0] = _component(
            1,
            false,
            TOKEN,
            TOKEN_RUNTIME_CODE_HASH,
            2,
            FACTORY,
            0,
            EFFECTIVE_TOKEN_SALT,
            TOKEN_INIT_CODE_HASH,
            TOKEN_OWNERLESS_SENTINEL
        );
        components[1] = _component(
            2, false, HOOK, HOOK_RUNTIME_CODE_HASH, 2, FACTORY, 0, HOOK_SALT, HOOK_INIT_CODE_HASH, HOOK_CONTROL_SENTINEL
        );
        components[2] = _component(
            3, false, NFT, NFT_RUNTIME_CODE_HASH, 2, FACTORY, 0, NFT_SALT, NFT_INIT_CODE_HASH, HOOK_CONTROL_SENTINEL
        );
        components[3] = _component(
            4,
            true,
            FACTORY,
            FACTORY_RUNTIME_CODE_HASH,
            2,
            FACTORY_DEPLOYMENT_PROXY,
            0,
            FACTORY_SALT,
            FACTORY_INIT_CODE_HASH,
            SPLIT_REVENUE_SENTINEL
        );
        components[4] = _component(
            5,
            true,
            RENDERER,
            RENDERER_RUNTIME_CODE_HASH,
            1,
            FACTORY,
            1,
            bytes32(0),
            RENDERER_CREATION_CODE_HASH,
            SPLIT_REVENUE_SENTINEL
        );
    }

    function _component(
        uint8 role,
        bool shared,
        address account,
        bytes32 runtimeCodeHash,
        uint8 deploymentKind,
        address deployer,
        uint64 createNonce,
        bytes32 salt,
        bytes32 initCodeHash,
        address semanticSentinel
    ) private pure returns (IProgrammableNestedFactoryProfileV1.ComponentExpectationV1 memory component) {
        component.role = role;
        component.scope = shared
            ? IProgrammableNestedFactoryProfileV1.ComponentScopeV1.SharedInfrastructure
            : IProgrammableNestedFactoryProfileV1.ComponentScopeV1.ExclusiveCreate;
        component.account = account;
        component.runtimeCodeHash = runtimeCodeHash;
        component.creationProvenanceHash = keccak256(
            abi.encode(
                COMPONENT_PROVENANCE_TYPEHASH, role, deploymentKind, deployer, createNonce, salt, initCodeHash, account
            )
        );
        component.ownershipBindingHash = keccak256(
            abi.encode(
                COMPONENT_OWNERSHIP_TYPEHASH,
                role,
                semanticSentinel,
                LAUNCHER_FEE_RECIPIENT,
                BUILDER_FEE_RECIPIENT,
                SEMANTIC_MAPPING_SCHEMA_HASH
            )
        );
        component.configurationHash =
            keccak256(abi.encode(COMPONENT_CONFIGURATION_TYPEHASH, role, account, CONFIGURATION_HASH, POOL_ID));
    }

    function _componentHashesMemory(IProgrammableNestedFactoryProfileV1.ComponentExpectationV1[] memory components)
        private
        pure
        returns (bytes32 orderedHead, bytes32 componentSetHash, bytes32 componentRuntimeSetHash)
    {
        for (uint256 i; i < components.length; ++i) {
            IProgrammableNestedFactoryProfileV1.ComponentExpectationV1 memory component = components[i];
            bytes32 leaf = keccak256(
                abi.encode(
                    COMPONENT_TYPEHASH,
                    component.role,
                    uint8(component.scope),
                    component.account,
                    component.runtimeCodeHash,
                    component.creationProvenanceHash,
                    component.ownershipBindingHash,
                    component.configurationHash
                )
            );
            orderedHead = keccak256(abi.encode(orderedHead, i, leaf));
            componentSetHash = keccak256(abi.encode(componentSetHash, i, component.role, component.account, leaf));
            componentRuntimeSetHash = keccak256(
                abi.encode(componentRuntimeSetHash, i, component.role, component.account, component.runtimeCodeHash)
            );
        }
    }

    function _componentLeaf(IProgrammableNestedFactoryProfileV1.ComponentExpectationV1 calldata component)
        private
        pure
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                COMPONENT_TYPEHASH,
                component.role,
                uint8(component.scope),
                component.account,
                component.runtimeCodeHash,
                component.creationProvenanceHash,
                component.ownershipBindingHash,
                component.configurationHash
            )
        );
    }

    function _hashAction(IProgrammableNestedFactoryProfileV1.NestedFactoryActionV1 calldata action)
        internal
        pure
        returns (bytes32)
    {
        bytes32 identityHash = keccak256(
            abi.encode(
                ACTION_IDENTITY_TYPEHASH,
                action.providerPlanId,
                action.factorySalt,
                action.applicantWallet,
                action.sourceLaunchId,
                action.poolManager,
                action.poolManagerRuntimeCodeHash,
                action.poolId,
                action.tokenOwner,
                action.hookOwner,
                action.treasury
            )
        );
        bytes32 economicsHash = keccak256(
            abi.encode(
                ACTION_ECONOMICS_TYPEHASH,
                action.tokenSupply,
                action.nativeValue,
                action.hookPermissionsHash,
                action.configurationHash
            )
        );
        return keccak256(abi.encode(ACTION_TYPEHASH, identityHash, economicsHash));
    }

    function _providerExecutionId(
        ProviderCorrelationV1 memory correlation,
        IProgrammableNestedFactoryProfileV1.NestedFactoryActionV1 calldata action,
        bytes32 componentHead
    ) internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                PROVIDER_EXECUTION_ID_TYPEHASH,
                runtimeBindingHashV1(),
                correlation.executionKey,
                correlation.grantDigest,
                correlation.stampLaunchId,
                correlation.antiReplayNonce,
                _hashAction(action),
                componentHead
            )
        );
    }

    function _architectureStateHash(bytes32 componentSetHash, bytes32 componentRuntimeSetHash)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                ARCHITECTURE_STATE_TYPEHASH,
                LEGACY_EXACT_RESULT_HASH,
                componentGraphHashV1(),
                componentSetHash,
                componentRuntimeSetHash
            )
        );
    }

    function _requireRuntime(address account, bytes32 expectedCodeHash) internal view {
        if (
            account == address(0) || expectedCodeHash == bytes32(0) || account.code.length == 0
                || account.codehash != expectedCodeHash
        ) revert RuntimeCodeHashDrift(account);
    }

    function _adapterRoleId() internal pure virtual returns (bytes32);
}

/// @notice Fixed, stateless provider for exactly one vacant Shards factory launch.
contract ProgrammableExactShardsNestedFactoryProviderV1 is
    ProgrammableExactShardsNestedFactoryBaseV1,
    IProgrammableNestedFactoryProviderV1
{
    bytes32 internal constant ADAPTER_ROLE_ID = keccak256("PROGRAMMABLE_EXACT_SHARDS_NESTED_PROVIDER_V1");

    constructor(
        IProgrammableUniversalLaunchKernelV1 kernel,
        bytes32 kernelRuntimeCodeHash,
        IProgrammableExactShardsProfileV1 exactValidator,
        bytes32 exactValidatorRuntimeCodeHash,
        IProgrammableShardsHookCodeStoreV1 hookCodeStore,
        bytes32 hookCodeStoreRuntimeCodeHash,
        bytes32 hookCodeStoreBindingHash
    )
        ProgrammableExactShardsNestedFactoryBaseV1(
            kernel,
            kernelRuntimeCodeHash,
            exactValidator,
            exactValidatorRuntimeCodeHash,
            hookCodeStore,
            hookCodeStoreRuntimeCodeHash,
            hookCodeStoreBindingHash
        )
    { }

    function executeNestedFactoryV1(
        bytes32 executionKey,
        bytes32 grantDigest,
        bytes32 stampLaunchId,
        bytes32 antiReplayNonce,
        IProgrammableNestedFactoryProfileV1.NestedFactoryActionV1 calldata action,
        IProgrammableNestedFactoryProfileV1.ComponentExpectationV1[] calldata components
    ) external payable returns (IProgrammableNestedFactoryProfileV1.NestedFactoryResultV1 memory result) {
        if (msg.value != 0 || executionKey == bytes32(0) || grantDigest == bytes32(0)) revert InvalidBinding(20);
        ProviderCorrelationV1 memory correlation = ProviderCorrelationV1({
            executionKey: executionKey,
            grantDigest: grantDigest,
            stampLaunchId: stampLaunchId,
            antiReplayNonce: antiReplayNonce
        });
        _requireProfileBinding(msg.sender, true);
        _validateAction(action);
        (bytes32 componentHead, bytes32 componentSetHash, bytes32 componentRuntimeSetHash) =
            _validateComponents(components);
        IProgrammableUniversalLaunchKernelV1.LaunchGrantV1 memory grant = KERNEL.launchGrantV1(grantDigest);
        if (
            KERNEL.activeExecutionGrantDigestV1() != grantDigest || grant.profileKey != PROFILE_KEY
                || grant.sourceLaunchId != SOURCE_LAUNCH_ID || grant.stampLaunchId != stampLaunchId
                || grant.antiReplayNonce != antiReplayNonce || grant.componentGraphHash != componentGraphHashV1()
                || grant.componentRuntimeSetHash != componentRuntimeSetHash
                || grant.configurationHash != CONFIGURATION_HASH || grant.providerBindingHash != runtimeBindingHashV1()
        ) revert InvalidBinding(21);

        _executeExactLaunch();

        result.providerExecutionId = _providerExecutionId(correlation, action, componentHead);
        result.configurationHash = CONFIGURATION_HASH;
        result.componentSetHash = componentSetHash;
        result.componentRuntimeSetHash = componentRuntimeSetHash;
        result.architectureStateHash = _architectureStateHash(componentSetHash, componentRuntimeSetHash);
        result.poolStateHash = poolStateHashV1();
        result.supplyValueFlowHash = valueFlowHashV1();
        result.returnedIdentitiesHash = returnedIdentitiesHashV1();
    }

    function _executeExactLaunch() private {
        // The bound profile executes the exact verifier preflight before entering the kernel and the exact
        // verifier postflight immediately after this call. Rebuild the same frozen route here, but do not duplicate
        // both legacy validator passes inside the provider's bounded execution window.
        (IProgrammableLaunchStampRouterV2.NestedFactoryRouteV1 memory route,) = _routeAndRequest(SOURCE_LAUNCH_ID);
        (address hook, address token, address nft) =
            IProgrammableNestedFactoryV1(FACTORY).launch(TOKEN_SALT, HOOK_SALT, route.hookCreationCode, route.params);
        if (hook != HOOK || token != TOKEN || nft != NFT) revert InvalidBinding(22);
    }

    function _adapterRoleId() internal pure override returns (bytes32) {
        return ADAPTER_ROLE_ID;
    }
}

/// @notice Fixed, stateless verifier for the exact Shards prestate and poststate.
contract ProgrammableExactShardsNestedFactoryVerifierV1 is
    ProgrammableExactShardsNestedFactoryBaseV1,
    IProgrammableNestedFactoryPostconditionVerifierV1
{
    bytes32 internal constant ADAPTER_ROLE_ID = keccak256("PROGRAMMABLE_EXACT_SHARDS_NESTED_VERIFIER_V1");

    constructor(
        IProgrammableUniversalLaunchKernelV1 kernel,
        bytes32 kernelRuntimeCodeHash,
        IProgrammableExactShardsProfileV1 exactValidator,
        bytes32 exactValidatorRuntimeCodeHash,
        IProgrammableShardsHookCodeStoreV1 hookCodeStore,
        bytes32 hookCodeStoreRuntimeCodeHash,
        bytes32 hookCodeStoreBindingHash
    )
        ProgrammableExactShardsNestedFactoryBaseV1(
            kernel,
            kernelRuntimeCodeHash,
            exactValidator,
            exactValidatorRuntimeCodeHash,
            hookCodeStore,
            hookCodeStoreRuntimeCodeHash,
            hookCodeStoreBindingHash
        )
    { }

    function verifyNestedPreflightV1(
        address profile,
        IProgrammableNestedFactoryProfileV1.NestedFactoryPlanV1 calldata plan
    ) external view returns (bytes32 profilePreflightReadbackHash) {
        if (msg.sender != profile) revert InvalidBinding(30);
        _requireProfileBinding(profile, false);
        (bytes32 componentSetHash, bytes32 componentRuntimeSetHash) = _validatePlan(plan);
        _exactPreflight(plan.action.sourceLaunchId);
        bytes32 planHash = IProgrammableNestedFactoryProfileBindingV1(profile).computeNestedFactoryPlanHashV1(plan);
        bytes32 bindingHash = keccak256(
            abi.encode(
                PREFLIGHT_BINDING_TYPEHASH, block.chainid, address(this), runtimeBindingHashV1(), profile, planHash
            )
        );
        bytes32 stateHash = keccak256(
            abi.encode(
                PREFLIGHT_STATE_TYPEHASH,
                LEGACY_EXACT_RESULT_HASH,
                componentGraphHashV1(),
                _architectureStateHash(componentSetHash, componentRuntimeSetHash),
                poolStateHashV1(),
                revenueStateHashV1(),
                valueFlowHashV1()
            )
        );
        profilePreflightReadbackHash = keccak256(abi.encode(PREFLIGHT_READBACK_TYPEHASH, bindingHash, stateHash));
    }

    function verifyNestedPostconditionsV1(
        address profile,
        IProgrammableNestedFactoryProfileV1.NestedFactoryPlanV1 calldata plan,
        IProgrammableNestedFactoryProfileV1.NestedFactoryResultV1 calldata result
    ) external view returns (IProgrammableNestedFactoryProfileV1.NestedPostconditionResultV1 memory postconditions) {
        if (msg.sender != profile) revert InvalidBinding(31);
        _requireProfileBinding(profile, false);
        (bytes32 componentSetHash, bytes32 componentRuntimeSetHash) = _validatePlan(plan);
        (
            IProgrammableLaunchStampRouterV2.NestedFactoryRouteV1 memory route,
            IProgrammableLaunchStampRouterV2.StampRequestV2 memory request
        ) = _routeAndRequest(plan.action.sourceLaunchId);
        bytes32 observed = EXACT_VALIDATOR.validatePostV1(
            route,
            request,
            IPoolManager(POOL_MANAGER),
            IProgrammableLaunchStampRouterV2.ExecutionModeV2.EXACT_FACTORY_LAUNCH_EXECUTED
        );
        _assertSupplementalPostState();
        bytes32 architectureStateHash = _architectureStateHash(componentSetHash, componentRuntimeSetHash);
        if (
            observed != LEGACY_EXACT_RESULT_HASH || result.configurationHash != CONFIGURATION_HASH
                || result.componentSetHash != componentSetHash
                || result.componentRuntimeSetHash != componentRuntimeSetHash
                || result.architectureStateHash != architectureStateHash || result.poolStateHash != poolStateHashV1()
                || result.supplyValueFlowHash != valueFlowHashV1()
                || result.returnedIdentitiesHash != returnedIdentitiesHashV1()
        ) revert InvalidBinding(32);
        postconditions.architectureStateHash = architectureStateHash;
        postconditions.poolStateHash = poolStateHashV1();
        postconditions.revenueStateHash = revenueStateHashV1();
        postconditions.valueFlowHash = valueFlowHashV1();
    }

    function _adapterRoleId() internal pure override returns (bytes32) {
        return ADAPTER_ROLE_ID;
    }
}
