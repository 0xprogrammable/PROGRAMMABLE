// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {
    ProgrammableCurrency,
    ProgrammableFeeVaultV1,
    ProgrammableHookPermissions,
    ProgrammablePoolKey
} from "./ProgrammableAdditiveFeeHookV1.sol";
import {
    IProgrammableFeePolicyProfileV2,
    PROGRAMMABLE_FEE_ASSET_MODE_V2,
    PROGRAMMABLE_FEE_BASIS_V2,
    PROGRAMMABLE_FEE_POLICY_CHAIN_ID_V2,
    PROGRAMMABLE_FEE_POLICY_DENOMINATOR_PPM_V2,
    PROGRAMMABLE_FEE_POLICY_RATE_PPM_V2,
    PROGRAMMABLE_FEE_POLICY_RECIPIENT_V2,
    PROGRAMMABLE_FEE_POLICY_REQUIRED_HOOK_FLAGS_V2,
    PROGRAMMABLE_FEE_POLICY_VERSION_V2,
    PROGRAMMABLE_FEE_VAULT_V2_RUNTIME_CODE_HASH,
    PROGRAMMABLE_ISOLATED_AFTER_SWAP_PROFILE_V2,
    PROGRAMMABLE_LAUNCH_TOKEN_V2_RUNTIME_CODE_HASH,
    PROGRAMMABLE_ZERO_CUSTOM_PROFILE_V2,
    ProgrammableCompositionV2,
    programmableCompositionHashV2,
    programmableDeploymentProfileHashV2,
    programmableFeePolicyIdV2,
    programmableModuleCodeIsSafeV2
} from "./ProgrammableAdditiveFeeHookV2.sol";
import {
    PROGRAMMABLE_CANONICAL_GRAPH_DEPLOYER_RUNTIME_CODE_HASH_V2,
    PROGRAMMABLE_CANONICAL_GRAPH_DEPLOYER_V2,
    PROGRAMMABLE_CANONICAL_POOL_MANAGER_RUNTIME_CODE_HASH_V2,
    PROGRAMMABLE_CANONICAL_POOL_MANAGER_V2,
    ProgrammableFeeVaultV2Core
} from "./ProgrammableFeeVaultV2.sol";

bytes32 constant PROGRAMMABLE_ZERO_CUSTOM_FEE_HOOK_V2_RUNTIME_CODE_HASH =
    0x10267e0a2727fa81bc905bbe17f8d573d98ffea9ba5ef4dfec29a3fd4c582d46;
bytes32 constant PROGRAMMABLE_ISOLATED_FEE_HOOK_V2_RUNTIME_CODE_HASH =
    0xe2bbc60d8e8fbe2fa16576f02785445063acf342cdeb1acfea1539d7cb96f067;

interface IProgrammableV4PoolInitializerManagerV2 {
    function initialize(ProgrammablePoolKey calldata key, uint160 sqrtPriceX96) external returns (int24 tick);
}

interface IProgrammableFeeHookBindingV2 is IProgrammableFeePolicyProfileV2 {
    function poolManager() external view returns (address);
    function graphDeployer() external view returns (address);
    function platformFeeVault() external view returns (ProgrammableFeeVaultV1);
    function platformFeeAccrualContextHash() external view returns (bytes32);
    function PLATFORM_FEE_PPM() external pure returns (uint24);
    function FEE_DENOMINATOR_PPM() external pure returns (uint24);
    function PLATFORM_FEE_RECIPIENT() external pure returns (address);
    function REQUIRED_HOOK_FLAGS() external pure returns (uint160);
    function getHookPermissions() external pure returns (ProgrammableHookPermissions memory permissions);
    function poolBindingComplete() external view returns (bool);
    function poolInitialized() external view returns (bool);
    function authorizedInitializer() external view returns (address);
    function authorizedInitializerRuntimeCodeHash() external view returns (bytes32);
    function boundPoolId() external view returns (bytes32);
    function boundInitialSqrtPriceX96() external view returns (uint160);
    function boundToken() external view returns (address);
    function boundHookRuntimeCodeHash() external view returns (bytes32);
    function boundVaultRuntimeCodeHash() external view returns (bytes32);
    function boundTokenRuntimeCodeHash() external view returns (bytes32);
    function deploymentProfileHash() external view returns (bytes32);
    function compositionHash() external view returns (bytes32);
}

abstract contract ProgrammableFeePoolInitializerV2Core {
    uint24 private constant DYNAMIC_FEE_FLAG = 0x800000;
    uint24 public constant MAX_STATIC_LP_FEE_PPM = 100_000;
    uint160 private constant ALL_HOOK_MASK = (1 << 14) - 1;

    address public poolManager;
    address public graphDeployer;
    ProgrammableFeeVaultV2Core public platformFeeVault;
    IProgrammableFeeHookBindingV2 public feeHook;
    address public token;
    uint24 public poolFee;
    int24 public tickSpacing;
    uint160 public initialSqrtPriceX96;

    bool public initialized;
    bytes32 public initializedPoolId;
    int24 public initializedTick;

    error AdapterCodeHashMismatch(bytes32 sealedCodeHash, bytes32 actualCodeHash);
    error AddressMismatch(bytes32 field, address expected, address actual);
    error AlreadyInitialized();
    error CompositionMismatch(bytes32 expected, bytes32 actual);
    error FeePolicyMismatch(bytes32 field, bytes32 expected, bytes32 actual);
    error InvalidAddress(bytes32 field, address actual);
    error InvalidCustomModuleCodeHash(bytes32 expected, bytes32 actual);
    error InvalidCustomModuleOpcode(address module);
    error InvalidHookAddressFlags(uint160 actual, uint160 required);
    error InvalidHookPermissions();
    error InvalidInitialSqrtPrice(uint160 actual);
    error InvalidPoolFee(uint24 actual, uint24 maximum);
    error InvalidRuntimeTemplate(address target, bytes32 actual);
    error InvalidTickSpacing(int24 actual);
    error PoolBindingMismatch(bytes32 field, bytes32 expected, bytes32 actual);
    error RuntimeCodeHashMismatch(address target, bytes32 expected, bytes32 actual);
    error SealMismatch(address expectedHook, address actualHook, address bindingAuthority);
    error UnauthorizedGraphDeployer(address caller);
    error UnsupportedFeePolicyChain(uint256 actual, uint256 required);

    event ProgrammableFeePoolInitialized(
        bytes32 indexed poolId,
        address indexed hook,
        address indexed token,
        bytes32 feePolicyId,
        uint24 poolFee,
        int24 tickSpacing,
        uint160 initialSqrtPriceX96,
        int24 initializedTick
    );
    event ProgrammableFeeCompositionObserved(
        bytes32 indexed poolId,
        bytes32 indexed deploymentProfileHash,
        bytes32 indexed compositionHash,
        bytes32 hookRuntimeCodeHash,
        bytes32 vaultRuntimeCodeHash,
        bytes32 initializerRuntimeCodeHash,
        bytes32 tokenRuntimeCodeHash
    );

    constructor(
        address poolManager_,
        address graphDeployer_,
        ProgrammableFeeVaultV2Core platformFeeVault_,
        IProgrammableFeeHookBindingV2 feeHook_,
        address token_,
        uint24 poolFee_,
        int24 tickSpacing_,
        uint160 initialSqrtPriceX96_
    ) {
        _requireContract("poolManager", poolManager_);
        _requireContract("graphDeployer", graphDeployer_);
        _requireContract("platformFeeVault", address(platformFeeVault_));
        _requireContract("feeHook", address(feeHook_));
        _requireContract("token", token_);
        if (poolFee_ & DYNAMIC_FEE_FLAG != 0 || poolFee_ > MAX_STATIC_LP_FEE_PPM) {
            revert InvalidPoolFee(poolFee_, MAX_STATIC_LP_FEE_PPM);
        }
        uint160 hookFlags = uint160(address(feeHook_)) & ALL_HOOK_MASK;
        if (hookFlags != PROGRAMMABLE_FEE_POLICY_REQUIRED_HOOK_FLAGS_V2) {
            revert InvalidHookAddressFlags(hookFlags, PROGRAMMABLE_FEE_POLICY_REQUIRED_HOOK_FLAGS_V2);
        }
        if (tickSpacing_ <= 0 || tickSpacing_ > 32_767) revert InvalidTickSpacing(tickSpacing_);
        if (initialSqrtPriceX96_ == 0) revert InvalidInitialSqrtPrice(initialSqrtPriceX96_);

        poolManager = poolManager_;
        graphDeployer = graphDeployer_;
        platformFeeVault = platformFeeVault_;
        feeHook = feeHook_;
        token = token_;
        poolFee = poolFee_;
        tickSpacing = tickSpacing_;
        initialSqrtPriceX96 = initialSqrtPriceX96_;
    }

    function poolKey() public view returns (ProgrammablePoolKey memory key) {
        key = ProgrammablePoolKey({
            currency0: ProgrammableCurrency.wrap(address(0)),
            currency1: ProgrammableCurrency.wrap(token),
            fee: poolFee,
            tickSpacing: tickSpacing,
            hooks: address(feeHook)
        });
    }

    function poolId() public view returns (bytes32) {
        return keccak256(abi.encode(poolKey()));
    }

    function expectedVaultRuntimeCodeHash() external view returns (bytes32) {
        return _vaultRuntimeCodeHash();
    }

    function expectedZeroCustomHookRuntimeCodeHash() external view returns (bytes32) {
        return _zeroCustomHookRuntimeCodeHash();
    }

    function expectedIsolatedHookRuntimeCodeHash() external view returns (bytes32) {
        return _isolatedHookRuntimeCodeHash();
    }

    function expectedTokenRuntimeCodeHash() external view returns (bytes32) {
        return _tokenRuntimeCodeHash();
    }

    function canonicalPoolManagerRuntimeCodeHash() external view returns (bytes32) {
        return _canonicalPoolManagerRuntimeCodeHash();
    }

    function canonicalGraphDeployerRuntimeCodeHash() external view returns (bytes32) {
        return _canonicalGraphDeployerRuntimeCodeHash();
    }

    function initializePool() external returns (bytes32 createdPoolId, int24 tick) {
        if (msg.sender != graphDeployer) revert UnauthorizedGraphDeployer(msg.sender);
        if (initialized) revert AlreadyInitialized();
        initialized = true;
        _requireCanonicalEnvironment();
        (bytes32 profile, bytes32 hookRuntime, bytes32 vaultRuntime) = _requireCanonicalComposition();

        ProgrammablePoolKey memory key = poolKey();
        createdPoolId = keccak256(abi.encode(key));
        tick = IProgrammableV4PoolInitializerManagerV2(poolManager).initialize(key, initialSqrtPriceX96);
        if (!feeHook.poolInitialized()) {
            revert PoolBindingMismatch("hook.poolInitialized", bytes32(uint256(1)), bytes32(0));
        }
        initializedPoolId = createdPoolId;
        initializedTick = tick;

        emit ProgrammableFeePoolInitialized(
            createdPoolId,
            address(feeHook),
            token,
            programmableFeePolicyIdV2(profile),
            poolFee,
            tickSpacing,
            initialSqrtPriceX96,
            tick
        );
        emit ProgrammableFeeCompositionObserved(
            createdPoolId,
            feeHook.deploymentProfileHash(),
            feeHook.compositionHash(),
            hookRuntime,
            vaultRuntime,
            address(this).codehash,
            token.codehash
        );
    }

    function _requireCanonicalEnvironment() private view {
        if (block.chainid != PROGRAMMABLE_FEE_POLICY_CHAIN_ID_V2) {
            revert UnsupportedFeePolicyChain(block.chainid, PROGRAMMABLE_FEE_POLICY_CHAIN_ID_V2);
        }
        _requireRuntimeCodeHash(poolManager, _canonicalPoolManagerRuntimeCodeHash());
        _requireRuntimeCodeHash(graphDeployer, _canonicalGraphDeployerRuntimeCodeHash());
        _requireRuntimeCodeHash(token, _tokenRuntimeCodeHash());
    }

    function _requireCanonicalComposition()
        private
        view
        returns (bytes32 profile, bytes32 hookRuntime, bytes32 vaultRuntime)
    {
        hookRuntime = address(feeHook).codehash;
        vaultRuntime = address(platformFeeVault).codehash;
        bytes32 zeroHookRuntime = _zeroCustomHookRuntimeCodeHash();
        bytes32 isolatedHookRuntime = _isolatedHookRuntimeCodeHash();
        if (hookRuntime == zeroHookRuntime) profile = PROGRAMMABLE_ZERO_CUSTOM_PROFILE_V2;
        else if (hookRuntime == isolatedHookRuntime) profile = PROGRAMMABLE_ISOLATED_AFTER_SWAP_PROFILE_V2;
        else revert InvalidRuntimeTemplate(address(feeHook), hookRuntime);
        bytes32 expectedVaultRuntime = _vaultRuntimeCodeHash();
        if (vaultRuntime != expectedVaultRuntime) {
            revert RuntimeCodeHashMismatch(address(platformFeeVault), expectedVaultRuntime, vaultRuntime);
        }

        address hook = address(feeHook);
        address authority = platformFeeVault.bindingAuthority();
        address sealedHook = platformFeeVault.authorizedAdapter();
        if (authority != address(0) || sealedHook != hook) revert SealMismatch(hook, sealedHook, authority);
        if (platformFeeVault.authorizedAdapterCodeHash() != hookRuntime) {
            revert AdapterCodeHashMismatch(platformFeeVault.authorizedAdapterCodeHash(), hookRuntime);
        }
        _requireAddress("vault.poolManager", poolManager, platformFeeVault.poolManager());
        _requireAddress("hook.poolManager", poolManager, feeHook.poolManager());
        _requireAddress("hook.graphDeployer", graphDeployer, feeHook.graphDeployer());
        _requireAddress("hook.platformFeeVault", address(platformFeeVault), address(feeHook.platformFeeVault()));
        _requireUint(
            "vault.flags", PROGRAMMABLE_FEE_POLICY_REQUIRED_HOOK_FLAGS_V2, platformFeeVault.requiredAdapterFlags()
        );
        _requireUint("vault.rate", PROGRAMMABLE_FEE_POLICY_RATE_PPM_V2, platformFeeVault.PLATFORM_FEE_PPM());
        _requireUint(
            "vault.denominator", PROGRAMMABLE_FEE_POLICY_DENOMINATOR_PPM_V2, platformFeeVault.FEE_DENOMINATOR_PPM()
        );
        _requireAddress(
            "vault.recipient", PROGRAMMABLE_FEE_POLICY_RECIPIENT_V2, platformFeeVault.PLATFORM_FEE_RECIPIENT()
        );
        _requireUint("hook.rate", PROGRAMMABLE_FEE_POLICY_RATE_PPM_V2, feeHook.PLATFORM_FEE_PPM());
        _requireUint("hook.denominator", PROGRAMMABLE_FEE_POLICY_DENOMINATOR_PPM_V2, feeHook.FEE_DENOMINATOR_PPM());
        _requireAddress("hook.recipient", PROGRAMMABLE_FEE_POLICY_RECIPIENT_V2, feeHook.PLATFORM_FEE_RECIPIENT());
        _requireUint("hook.flags", PROGRAMMABLE_FEE_POLICY_REQUIRED_HOOK_FLAGS_V2, feeHook.REQUIRED_HOOK_FLAGS());

        _requirePolicy(profile);
        _requireExactHookPermissions(feeHook.getHookPermissions());
        _requirePoolBinding(profile, hookRuntime, vaultRuntime);
    }

    function _requirePolicy(bytes32 profile) private view {
        _requireUint("policy.version", PROGRAMMABLE_FEE_POLICY_VERSION_V2, feeHook.feePolicyVersion());
        _requireUint("policy.chainId", PROGRAMMABLE_FEE_POLICY_CHAIN_ID_V2, feeHook.feePolicyChainId());
        _requireBytes32("policy.profile", profile, feeHook.feePolicyProfile());
        _requireBytes32("policy.id", programmableFeePolicyIdV2(profile), feeHook.feePolicyId());
        _requireBytes32("policy.basis", PROGRAMMABLE_FEE_BASIS_V2, feeHook.feePolicyBasis());
        _requireBytes32("policy.assetMode", PROGRAMMABLE_FEE_ASSET_MODE_V2, feeHook.feePolicyAssetMode());
        _requireUint("policy.rate", PROGRAMMABLE_FEE_POLICY_RATE_PPM_V2, feeHook.feePolicyRatePpm());
        _requireUint(
            "policy.denominator", PROGRAMMABLE_FEE_POLICY_DENOMINATOR_PPM_V2, feeHook.feePolicyDenominatorPpm()
        );
        _requireAddress("policy.recipient", PROGRAMMABLE_FEE_POLICY_RECIPIENT_V2, feeHook.feePolicyRecipient());
        _requireUint(
            "policy.flags", PROGRAMMABLE_FEE_POLICY_REQUIRED_HOOK_FLAGS_V2, feeHook.feePolicyRequiredHookFlags()
        );
        _requireUint("policy.maxCustomDelta", 0, feeHook.feePolicyMaximumCustomDeltaAbsolute());
    }

    function _requirePoolBinding(bytes32 profile, bytes32 hookRuntime, bytes32 vaultRuntime) private view {
        bytes32 expectedPoolId = poolId();
        if (!feeHook.poolBindingComplete()) {
            revert PoolBindingMismatch("hook.poolBindingComplete", bytes32(uint256(1)), bytes32(0));
        }
        _requireAddress("hook.initializer", address(this), feeHook.authorizedInitializer());
        _requireBytes32(
            "hook.initializerRuntime", address(this).codehash, feeHook.authorizedInitializerRuntimeCodeHash()
        );
        _requireBytes32("hook.poolId", expectedPoolId, feeHook.boundPoolId());
        _requireUint("hook.sqrtPrice", initialSqrtPriceX96, feeHook.boundInitialSqrtPriceX96());
        _requireBytes32("hook.runtime", hookRuntime, feeHook.boundHookRuntimeCodeHash());
        _requireBytes32("vault.runtime", vaultRuntime, feeHook.boundVaultRuntimeCodeHash());
        _requireAddress("hook.token", token, feeHook.boundToken());
        _requireBytes32("token.runtime", token.codehash, feeHook.boundTokenRuntimeCodeHash());

        address customModule = feeHook.feePolicyCustomModule();
        bytes32 customModuleRuntime = feeHook.feePolicyCustomModuleRuntimeCodeHash();
        if (profile == PROGRAMMABLE_ZERO_CUSTOM_PROFILE_V2) {
            if (customModule != address(0) || customModuleRuntime != bytes32(0)) {
                revert InvalidCustomModuleCodeHash(bytes32(0), customModuleRuntime);
            }
        } else {
            _requireContract("policy.customModule", customModule);
            bytes32 actualModuleRuntime = customModule.codehash;
            if (customModuleRuntime != actualModuleRuntime) {
                revert InvalidCustomModuleCodeHash(customModuleRuntime, actualModuleRuntime);
            }
            if (!programmableModuleCodeIsSafeV2(customModule.code)) revert InvalidCustomModuleOpcode(customModule);
        }

        bytes32 tokenRuntime = token.codehash;
        bytes32 expectedProfileHash = programmableDeploymentProfileHashV2(
            profile, hookRuntime, vaultRuntime, tokenRuntime, customModuleRuntime
        );
        _requireBytes32("hook.deploymentProfile", expectedProfileHash, feeHook.deploymentProfileHash());
        bytes32 expectedComposition = programmableCompositionHashV2(
            ProgrammableCompositionV2({
                deploymentProfileHash: expectedProfileHash,
                hook: address(feeHook),
                hookRuntimeCodeHash: hookRuntime,
                vault: address(platformFeeVault),
                vaultRuntimeCodeHash: vaultRuntime,
                initializer: address(this),
                initializerRuntimeCodeHash: address(this).codehash,
                poolId: expectedPoolId,
                initialSqrtPriceX96: initialSqrtPriceX96,
                token: token,
                tokenRuntimeCodeHash: tokenRuntime,
                customModule: customModule,
                customModuleRuntimeCodeHash: customModuleRuntime,
                customDeltaAccount: address(0),
                maximumCustomDeltaAbsolute: uint128(0)
            })
        );
        bytes32 actualComposition = feeHook.compositionHash();
        if (actualComposition != expectedComposition) {
            revert CompositionMismatch(expectedComposition, actualComposition);
        }
    }

    function _requireExactHookPermissions(ProgrammableHookPermissions memory permissions) internal pure {
        if (
            !permissions.beforeInitialize || permissions.afterInitialize || permissions.beforeAddLiquidity
                || permissions.afterAddLiquidity || permissions.beforeRemoveLiquidity
                || permissions.afterRemoveLiquidity || permissions.beforeSwap || !permissions.afterSwap
                || permissions.beforeDonate || permissions.afterDonate || permissions.beforeSwapReturnDelta
                || !permissions.afterSwapReturnDelta || permissions.afterAddLiquidityReturnDelta
                || permissions.afterRemoveLiquidityReturnDelta
        ) revert InvalidHookPermissions();
    }

    function _vaultRuntimeCodeHash() internal view virtual returns (bytes32);
    function _zeroCustomHookRuntimeCodeHash() internal view virtual returns (bytes32);
    function _isolatedHookRuntimeCodeHash() internal view virtual returns (bytes32);
    function _tokenRuntimeCodeHash() internal view virtual returns (bytes32);
    function _canonicalPoolManagerRuntimeCodeHash() internal view virtual returns (bytes32);
    function _canonicalGraphDeployerRuntimeCodeHash() internal view virtual returns (bytes32);

    function _requireRuntimeCodeHash(address target, bytes32 expected) private view {
        bytes32 actual = target.codehash;
        if (actual != expected) revert RuntimeCodeHashMismatch(target, expected, actual);
    }

    function _requireContract(bytes32 field, address account) private view {
        if (account == address(0) || account.code.length == 0) revert InvalidAddress(field, account);
    }

    function _requireAddress(bytes32 field, address expected, address actual) private pure {
        if (actual != expected) revert AddressMismatch(field, expected, actual);
    }

    function _requireBytes32(bytes32 field, bytes32 expected, bytes32 actual) private pure {
        if (actual != expected) revert FeePolicyMismatch(field, expected, actual);
    }

    function _requireUint(bytes32 field, uint256 expected, uint256 actual) private pure {
        if (actual != expected) revert FeePolicyMismatch(field, bytes32(expected), bytes32(actual));
    }
}

contract ProgrammableFeePoolInitializerV2 is ProgrammableFeePoolInitializerV2Core {
    constructor(
        ProgrammableFeeVaultV2Core platformFeeVault_,
        IProgrammableFeeHookBindingV2 feeHook_,
        address token_,
        uint24 poolFee_,
        int24 tickSpacing_,
        uint160 initialSqrtPriceX96_
    )
        ProgrammableFeePoolInitializerV2Core(
            PROGRAMMABLE_CANONICAL_POOL_MANAGER_V2,
            PROGRAMMABLE_CANONICAL_GRAPH_DEPLOYER_V2,
            platformFeeVault_,
            feeHook_,
            token_,
            poolFee_,
            tickSpacing_,
            initialSqrtPriceX96_
        )
    { }

    function _vaultRuntimeCodeHash() internal pure override returns (bytes32) {
        return PROGRAMMABLE_FEE_VAULT_V2_RUNTIME_CODE_HASH;
    }

    function _zeroCustomHookRuntimeCodeHash() internal pure override returns (bytes32) {
        return PROGRAMMABLE_ZERO_CUSTOM_FEE_HOOK_V2_RUNTIME_CODE_HASH;
    }

    function _isolatedHookRuntimeCodeHash() internal pure override returns (bytes32) {
        return PROGRAMMABLE_ISOLATED_FEE_HOOK_V2_RUNTIME_CODE_HASH;
    }

    function _tokenRuntimeCodeHash() internal pure override returns (bytes32) {
        return PROGRAMMABLE_LAUNCH_TOKEN_V2_RUNTIME_CODE_HASH;
    }

    function _canonicalPoolManagerRuntimeCodeHash() internal pure override returns (bytes32) {
        return PROGRAMMABLE_CANONICAL_POOL_MANAGER_RUNTIME_CODE_HASH_V2;
    }

    function _canonicalGraphDeployerRuntimeCodeHash() internal pure override returns (bytes32) {
        return PROGRAMMABLE_CANONICAL_GRAPH_DEPLOYER_RUNTIME_CODE_HASH_V2;
    }
}
