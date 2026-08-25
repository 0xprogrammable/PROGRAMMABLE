// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {
    IProgrammableIsolatedAfterSwapModuleV1,
    IProgrammableV4HookV1,
    IProgrammableV4PoolManagerV1,
    ProgrammableBalanceDelta,
    ProgrammableCurrency,
    ProgrammableHookPermissions,
    ProgrammablePoolKey,
    ProgrammableSwapParams
} from "./ProgrammableAdditiveFeeHookV1.sol";
import {
    PROGRAMMABLE_CANONICAL_GRAPH_DEPLOYER_RUNTIME_CODE_HASH_V2,
    PROGRAMMABLE_CANONICAL_GRAPH_DEPLOYER_V2,
    PROGRAMMABLE_CANONICAL_POOL_MANAGER_RUNTIME_CODE_HASH_V2,
    PROGRAMMABLE_CANONICAL_POOL_MANAGER_V2,
    ProgrammableFeeVaultV2Core
} from "./ProgrammableFeeVaultV2.sol";

uint16 constant PROGRAMMABLE_FEE_POLICY_VERSION_V2 = 2;
uint256 constant PROGRAMMABLE_FEE_POLICY_CHAIN_ID_V2 = 1;
uint24 constant PROGRAMMABLE_FEE_POLICY_RATE_PPM_V2 = 1000;
uint24 constant PROGRAMMABLE_FEE_POLICY_DENOMINATOR_PPM_V2 = 1_000_000;
address constant PROGRAMMABLE_FEE_POLICY_RECIPIENT_V2 = 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c;
uint160 constant PROGRAMMABLE_FEE_POLICY_REQUIRED_HOOK_FLAGS_V2 = (1 << 13) | (1 << 6) | (1 << 2);

bytes32 constant PROGRAMMABLE_FEE_POLICY_DOMAIN_V2 = keccak256("programmable.custom-fee-policy.v2");
bytes32 constant PROGRAMMABLE_FEE_BASIS_V2 =
    keccak256("programmable.fee-basis.v2.gross-unspecified-pool-currency-amount");
bytes32 constant PROGRAMMABLE_FEE_ASSET_MODE_V2 =
    keccak256("programmable.fee-asset-mode.v2.unspecified-pool-currency-per-swap");
bytes32 constant PROGRAMMABLE_ZERO_CUSTOM_PROFILE_V2 = keccak256("programmable.fee-hook-profile.v2.zero-custom");
bytes32 constant PROGRAMMABLE_ISOLATED_AFTER_SWAP_PROFILE_V2 =
    keccak256("programmable.fee-hook-profile.v2.isolated-after-swap-zero-delta-opcode-safe");
bytes32 constant PROGRAMMABLE_COMPILER_SETTINGS_HASH_V2 =
    keccak256("solc-0.8.26|evm-cancun|optimizer-true|runs-1000|viaIR-false|bytecodeHash-ipfs|cborMetadata-true");
bytes32 constant PROGRAMMABLE_DEPLOYMENT_PROFILE_DOMAIN_V2 = keccak256("programmable.fee-deployment-profile.v2");
bytes32 constant PROGRAMMABLE_COMPOSITION_DOMAIN_V2 = keccak256("programmable.fee-composition.v2");

bytes32 constant PROGRAMMABLE_FEE_VAULT_V2_RUNTIME_CODE_HASH =
    0xf2cbc21a3f07c05909d664ba8d8b66fe6576eb8a5d016faa53e31e73ed6acbd4;
bytes32 constant PROGRAMMABLE_LAUNCH_TOKEN_V2_RUNTIME_CODE_HASH =
    0xf98eb029ee9c1face4b56fafd83612be8b813bf15a402a959ac107de8b203eef;

function programmableFeePolicyIdV2(bytes32 profile) pure returns (bytes32) {
    return keccak256(
        abi.encode(
            PROGRAMMABLE_FEE_POLICY_DOMAIN_V2,
            PROGRAMMABLE_FEE_POLICY_VERSION_V2,
            PROGRAMMABLE_FEE_POLICY_CHAIN_ID_V2,
            profile,
            PROGRAMMABLE_FEE_BASIS_V2,
            PROGRAMMABLE_FEE_ASSET_MODE_V2,
            PROGRAMMABLE_FEE_POLICY_RATE_PPM_V2,
            PROGRAMMABLE_FEE_POLICY_DENOMINATOR_PPM_V2,
            PROGRAMMABLE_FEE_POLICY_RECIPIENT_V2,
            PROGRAMMABLE_FEE_POLICY_REQUIRED_HOOK_FLAGS_V2
        )
    );
}

function programmableDeploymentProfileHashV2(
    bytes32 profile,
    bytes32 hookRuntimeCodeHash,
    bytes32 vaultRuntimeCodeHash,
    bytes32 tokenRuntimeCodeHash,
    bytes32 customModuleRuntimeCodeHash
) pure returns (bytes32) {
    return keccak256(
        abi.encode(
            PROGRAMMABLE_DEPLOYMENT_PROFILE_DOMAIN_V2,
            programmableFeePolicyIdV2(profile),
            PROGRAMMABLE_COMPILER_SETTINGS_HASH_V2,
            PROGRAMMABLE_CANONICAL_POOL_MANAGER_V2,
            PROGRAMMABLE_CANONICAL_POOL_MANAGER_RUNTIME_CODE_HASH_V2,
            PROGRAMMABLE_CANONICAL_GRAPH_DEPLOYER_V2,
            PROGRAMMABLE_CANONICAL_GRAPH_DEPLOYER_RUNTIME_CODE_HASH_V2,
            hookRuntimeCodeHash,
            vaultRuntimeCodeHash,
            tokenRuntimeCodeHash,
            customModuleRuntimeCodeHash,
            uint128(0)
        )
    );
}

struct ProgrammableCompositionV2 {
    bytes32 deploymentProfileHash;
    address hook;
    bytes32 hookRuntimeCodeHash;
    address vault;
    bytes32 vaultRuntimeCodeHash;
    address initializer;
    bytes32 initializerRuntimeCodeHash;
    bytes32 poolId;
    uint160 initialSqrtPriceX96;
    address token;
    bytes32 tokenRuntimeCodeHash;
    address customModule;
    bytes32 customModuleRuntimeCodeHash;
    address customDeltaAccount;
    uint128 maximumCustomDeltaAbsolute;
}

function programmableCompositionHashV2(ProgrammableCompositionV2 memory composition) pure returns (bytes32) {
    bytes32 platformComposition = keccak256(
        abi.encode(
            composition.hook,
            composition.hookRuntimeCodeHash,
            composition.vault,
            composition.vaultRuntimeCodeHash,
            composition.initializer,
            composition.initializerRuntimeCodeHash
        )
    );
    bytes32 poolComposition = keccak256(
        abi.encode(
            composition.poolId, composition.initialSqrtPriceX96, composition.token, composition.tokenRuntimeCodeHash
        )
    );
    bytes32 customComposition = keccak256(
        abi.encode(
            composition.customModule,
            composition.customModuleRuntimeCodeHash,
            composition.customDeltaAccount,
            composition.maximumCustomDeltaAbsolute
        )
    );
    return keccak256(
        abi.encode(
            PROGRAMMABLE_COMPOSITION_DOMAIN_V2,
            composition.deploymentProfileHash,
            platformComposition,
            poolComposition,
            customComposition
        )
    );
}

function programmableModuleCodeIsSafeV2(bytes memory runtimeCode) pure returns (bool) {
    uint256 cursor;
    while (cursor < runtimeCode.length) {
        uint8 opcode = uint8(runtimeCode[cursor]);
        if (opcode == 0xf2 || opcode == 0xf4 || opcode == 0xff) return false;
        unchecked {
            if (opcode >= 0x60 && opcode <= 0x7f) cursor += uint256(opcode) - 0x5f + 1;
            else ++cursor;
        }
    }
    return true;
}

interface IProgrammableFeePolicyProfileV2 {
    function feePolicyVersion() external view returns (uint16);
    function feePolicyChainId() external view returns (uint256);
    function feePolicyId() external view returns (bytes32);
    function feePolicyProfile() external view returns (bytes32);
    function feePolicyBasis() external view returns (bytes32);
    function feePolicyAssetMode() external view returns (bytes32);
    function feePolicyRatePpm() external view returns (uint24);
    function feePolicyDenominatorPpm() external view returns (uint24);
    function feePolicyRecipient() external view returns (address);
    function feePolicyRequiredHookFlags() external view returns (uint160);
    function feePolicyCustomModule() external view returns (address);
    function feePolicyCustomModuleRuntimeCodeHash() external view returns (bytes32);
    function feePolicyCustomDeltaAccount() external view returns (address);
    function feePolicyMaximumCustomDeltaAbsolute() external view returns (uint128);
}

interface IProgrammableV4HookV2 is IProgrammableV4HookV1 {
    function beforeInitialize(address sender, ProgrammablePoolKey calldata key, uint160 sqrtPriceX96)
        external
        returns (bytes4);
}

abstract contract ProgrammableAdditiveFeeHookV2Core is IProgrammableV4HookV2, IProgrammableFeePolicyProfileV2 {
    uint24 public constant PLATFORM_FEE_PPM = PROGRAMMABLE_FEE_POLICY_RATE_PPM_V2;
    uint24 public constant FEE_DENOMINATOR_PPM = PROGRAMMABLE_FEE_POLICY_DENOMINATOR_PPM_V2;
    address public constant PLATFORM_FEE_RECIPIENT = PROGRAMMABLE_FEE_POLICY_RECIPIENT_V2;
    uint160 public constant ALL_HOOK_MASK = (1 << 14) - 1;
    uint160 public constant BEFORE_INITIALIZE_FLAG = 1 << 13;
    uint160 public constant AFTER_SWAP_FLAG = 1 << 6;
    uint160 public constant AFTER_SWAP_RETURNS_DELTA_FLAG = 1 << 2;
    uint160 public constant REQUIRED_HOOK_FLAGS = PROGRAMMABLE_FEE_POLICY_REQUIRED_HOOK_FLAGS_V2;

    address public poolManager;
    address public graphDeployer;
    ProgrammableFeeVaultV2Core public platformFeeVault;
    bool public poolBindingComplete;
    bool public poolInitialized;
    address public authorizedInitializer;
    bytes32 public authorizedInitializerRuntimeCodeHash;
    bytes32 public boundPoolId;
    uint160 public boundInitialSqrtPriceX96;
    address public boundToken;
    bytes32 public boundHookRuntimeCodeHash;
    bytes32 public boundVaultRuntimeCodeHash;
    bytes32 public boundTokenRuntimeCodeHash;
    bytes32 public deploymentProfileHash;
    bytes32 public compositionHash;
    bytes32 private activePlatformFeeAccrualContextHash;

    error AfterSwapDeltaOverflow(int128 customDelta, int128 platformDelta);
    error AlreadyPoolBound(bytes32 poolId);
    error CompositionDrift(bytes32 expected, bytes32 actual);
    error HookAddressPermissionMismatch(uint160 actual, uint160 expected);
    error InvalidAddress();
    error InvalidCustomModule(address module);
    error InvalidCustomModuleOpcode(address module);
    error InvalidPlatformFeeVault();
    error PoolAlreadyInitialized(bytes32 poolId);
    error PoolBindingIncomplete();
    error ReentrantPlatformFeeAccrual();
    error RuntimeCodeHashMismatch(address target, bytes32 expected, bytes32 actual);
    error UnexpectedInitialSqrtPrice(uint160 actual, uint160 expected);
    error UnexpectedPool(bytes32 actual, bytes32 expected);
    error UnexpectedPoolHook(address actual);
    error UnexpectedUnlockCallback();
    error UnexpectedUnspecifiedDelta(int128 amount);
    error UnauthorizedGraphDeployer(address caller);
    error UnauthorizedInitializer(address caller);
    error UnauthorizedPoolManager(address caller);
    error UnsupportedFeePolicyChain(uint256 actual, uint256 required);

    event PoolBindingSealed(
        bytes32 indexed poolId,
        address indexed initializer,
        bytes32 indexed deploymentProfileHash,
        bytes32 compositionHash,
        bytes32 hookRuntimeCodeHash,
        bytes32 vaultRuntimeCodeHash,
        bytes32 initializerRuntimeCodeHash,
        uint160 initialSqrtPriceX96
    );
    event PoolInitializationAuthorized(bytes32 indexed poolId, address indexed initializer, uint160 sqrtPriceX96);
    event PlatformFeeAccrued(
        bytes32 indexed poolId,
        address indexed currency,
        address indexed swapSender,
        bool exactInput,
        uint256 grossQualifyingAmount,
        uint256 platformFee,
        address feeVault
    );

    constructor(address poolManager_, address graphDeployer_, ProgrammableFeeVaultV2Core platformFeeVault_) {
        if (poolManager_ == address(0) || graphDeployer_ == address(0) || address(platformFeeVault_) == address(0)) {
            revert InvalidAddress();
        }
        uint160 flags = uint160(address(this)) & ALL_HOOK_MASK;
        if (flags != REQUIRED_HOOK_FLAGS) revert HookAddressPermissionMismatch(flags, REQUIRED_HOOK_FLAGS);
        poolManager = poolManager_;
        graphDeployer = graphDeployer_;
        platformFeeVault = platformFeeVault_;
    }

    function bindPool(ProgrammablePoolKey calldata key, address initializer, uint160 initialSqrtPriceX96) external {
        if (msg.sender != graphDeployer) revert UnauthorizedGraphDeployer(msg.sender);
        _requireEnvironment();
        if (poolBindingComplete) revert AlreadyPoolBound(boundPoolId);
        if (initializer == address(0) || initializer.code.length == 0 || initialSqrtPriceX96 == 0) {
            revert InvalidAddress();
        }
        if (key.hooks != address(this)) revert UnexpectedPoolHook(key.hooks);
        if (
            ProgrammableCurrency.unwrap(key.currency0) != address(0)
                || ProgrammableCurrency.unwrap(key.currency1) == address(0)
        ) revert UnexpectedPool(keccak256(abi.encode(key)), bytes32(0));

        bytes32 hookRuntime = address(this).codehash;
        bytes32 vaultRuntime = address(platformFeeVault).codehash;
        address token = ProgrammableCurrency.unwrap(key.currency1);
        bytes32 tokenRuntime = token.codehash;
        bytes32 expectedTokenRuntime = _expectedTokenRuntimeCodeHash();
        if (tokenRuntime != expectedTokenRuntime) {
            revert RuntimeCodeHashMismatch(token, expectedTokenRuntime, tokenRuntime);
        }
        bytes32 expectedVaultRuntime = _expectedVaultRuntimeCodeHash();
        if (vaultRuntime != expectedVaultRuntime) {
            revert RuntimeCodeHashMismatch(address(platformFeeVault), expectedVaultRuntime, vaultRuntime);
        }
        if (
            platformFeeVault.bindingAuthority() != address(0) || platformFeeVault.authorizedAdapter() != address(this)
                || platformFeeVault.authorizedAdapterCodeHash() != hookRuntime
                || platformFeeVault.poolManager() != poolManager
                || platformFeeVault.requiredAdapterFlags() != REQUIRED_HOOK_FLAGS
        ) revert InvalidPlatformFeeVault();
        _validateCustomModule();

        bytes32 poolId = keccak256(abi.encode(key));
        bytes32 profileHash = programmableDeploymentProfileHashV2(
            _profileKind(), hookRuntime, vaultRuntime, tokenRuntime, _customModuleRuntimeCodeHash()
        );

        authorizedInitializer = initializer;
        authorizedInitializerRuntimeCodeHash = initializer.codehash;
        boundPoolId = poolId;
        boundInitialSqrtPriceX96 = initialSqrtPriceX96;
        boundToken = token;
        boundHookRuntimeCodeHash = hookRuntime;
        boundVaultRuntimeCodeHash = vaultRuntime;
        boundTokenRuntimeCodeHash = tokenRuntime;
        deploymentProfileHash = profileHash;
        poolBindingComplete = true;
        compositionHash = _currentCompositionHash();
        _emitPoolBindingSealed();
    }

    function _emitPoolBindingSealed() private {
        emit PoolBindingSealed(
            boundPoolId,
            authorizedInitializer,
            deploymentProfileHash,
            compositionHash,
            boundHookRuntimeCodeHash,
            boundVaultRuntimeCodeHash,
            authorizedInitializerRuntimeCodeHash,
            boundInitialSqrtPriceX96
        );
    }

    function beforeInitialize(address sender, ProgrammablePoolKey calldata key, uint160 sqrtPriceX96)
        external
        returns (bytes4)
    {
        if (msg.sender != poolManager) revert UnauthorizedPoolManager(msg.sender);
        if (!poolBindingComplete) revert PoolBindingIncomplete();
        if (poolInitialized) revert PoolAlreadyInitialized(boundPoolId);
        if (sender != authorizedInitializer) revert UnauthorizedInitializer(sender);
        bytes32 actualPoolId = keccak256(abi.encode(key));
        if (actualPoolId != boundPoolId) revert UnexpectedPool(actualPoolId, boundPoolId);
        if (sqrtPriceX96 != boundInitialSqrtPriceX96) {
            revert UnexpectedInitialSqrtPrice(sqrtPriceX96, boundInitialSqrtPriceX96);
        }
        _requireBoundComposition();
        poolInitialized = true;
        emit PoolInitializationAuthorized(actualPoolId, sender, sqrtPriceX96);
        return IProgrammableV4HookV2.beforeInitialize.selector;
    }

    function afterSwap(
        address sender,
        ProgrammablePoolKey calldata key,
        ProgrammableSwapParams calldata params,
        ProgrammableBalanceDelta delta,
        bytes calldata hookData
    ) external returns (bytes4, int128) {
        if (msg.sender != poolManager) revert UnauthorizedPoolManager(msg.sender);
        if (!poolInitialized) revert PoolBindingIncomplete();
        bytes32 actualPoolId = keccak256(abi.encode(key));
        if (actualPoolId != boundPoolId) revert UnexpectedPool(actualPoolId, boundPoolId);
        if (key.hooks != address(this)) revert UnexpectedPoolHook(key.hooks);
        _requireBoundComposition();
        int128 platformDelta = _accrueProgrammablePlatformFee(sender, key, params, delta);
        int128 customDelta = _afterSwapCustom(sender, key, params, delta, hookData);
        return (IProgrammableV4HookV1.afterSwap.selector, _checkedAddAfterSwapDelta(customDelta, platformDelta));
    }

    function getHookPermissions() external pure returns (ProgrammableHookPermissions memory permissions) {
        permissions.beforeInitialize = true;
        permissions.afterSwap = true;
        permissions.afterSwapReturnDelta = true;
    }

    function platformFeeAccrualContextHash() public view returns (bytes32) {
        return activePlatformFeeAccrualContextHash;
    }

    function platformFeesAccrued(address currency) external view returns (uint256) {
        return platformFeeVault.platformFeesAccrued(currency);
    }

    function platformFeeRemainderPpm(bytes32 poolId, address currency) external view returns (uint256) {
        return platformFeeVault.platformFeeRemainderPpm(poolId, currency);
    }

    function feePolicyVersion() external pure returns (uint16) {
        return PROGRAMMABLE_FEE_POLICY_VERSION_V2;
    }

    function feePolicyChainId() external pure returns (uint256) {
        return PROGRAMMABLE_FEE_POLICY_CHAIN_ID_V2;
    }

    function feePolicyId() external view returns (bytes32) {
        return programmableFeePolicyIdV2(_profileKind());
    }

    function feePolicyProfile() external view returns (bytes32) {
        return _profileKind();
    }

    function feePolicyBasis() external pure returns (bytes32) {
        return PROGRAMMABLE_FEE_BASIS_V2;
    }

    function feePolicyAssetMode() external pure returns (bytes32) {
        return PROGRAMMABLE_FEE_ASSET_MODE_V2;
    }

    function feePolicyRatePpm() external pure returns (uint24) {
        return PROGRAMMABLE_FEE_POLICY_RATE_PPM_V2;
    }

    function feePolicyDenominatorPpm() external pure returns (uint24) {
        return PROGRAMMABLE_FEE_POLICY_DENOMINATOR_PPM_V2;
    }

    function feePolicyRecipient() external pure returns (address) {
        return PROGRAMMABLE_FEE_POLICY_RECIPIENT_V2;
    }

    function feePolicyRequiredHookFlags() external pure returns (uint160) {
        return PROGRAMMABLE_FEE_POLICY_REQUIRED_HOOK_FLAGS_V2;
    }

    function feePolicyMaximumCustomDeltaAbsolute() external pure returns (uint128) {
        return 0;
    }

    function feePolicyCustomDeltaAccount() external pure returns (address) {
        return address(0);
    }

    function feePolicyCompilerSettingsHash() external pure returns (bytes32) {
        return PROGRAMMABLE_COMPILER_SETTINGS_HASH_V2;
    }

    function feePolicyDeploymentProfileDomain() external pure returns (bytes32) {
        return PROGRAMMABLE_DEPLOYMENT_PROFILE_DOMAIN_V2;
    }

    function feePolicyCompositionDomain() external pure returns (bytes32) {
        return PROGRAMMABLE_COMPOSITION_DOMAIN_V2;
    }

    function canonicalPoolManagerRuntimeCodeHash() external view returns (bytes32) {
        return _canonicalPoolManagerRuntimeCodeHash();
    }

    function canonicalGraphDeployerRuntimeCodeHash() external view returns (bytes32) {
        return _canonicalGraphDeployerRuntimeCodeHash();
    }

    function expectedVaultRuntimeCodeHash() external view returns (bytes32) {
        return _expectedVaultRuntimeCodeHash();
    }

    function expectedTokenRuntimeCodeHash() external view returns (bytes32) {
        return _expectedTokenRuntimeCodeHash();
    }

    function unlockCallback(bytes calldata) external view returns (bytes memory) {
        if (msg.sender != poolManager) revert UnauthorizedPoolManager(msg.sender);
        revert UnexpectedUnlockCallback();
    }

    function _requireEnvironment() internal view {
        if (block.chainid != PROGRAMMABLE_FEE_POLICY_CHAIN_ID_V2) {
            revert UnsupportedFeePolicyChain(block.chainid, PROGRAMMABLE_FEE_POLICY_CHAIN_ID_V2);
        }
        _requireRuntimeCodeHash(poolManager, _canonicalPoolManagerRuntimeCodeHash());
        _requireRuntimeCodeHash(graphDeployer, _canonicalGraphDeployerRuntimeCodeHash());
    }

    function _requireBoundComposition() internal view {
        _requireEnvironment();
        bytes32 hookRuntime = address(this).codehash;
        bytes32 vaultRuntime = address(platformFeeVault).codehash;
        address token = boundToken;
        bytes32 tokenRuntime = token.codehash;
        if (hookRuntime != boundHookRuntimeCodeHash) {
            revert RuntimeCodeHashMismatch(address(this), boundHookRuntimeCodeHash, hookRuntime);
        }
        if (vaultRuntime != boundVaultRuntimeCodeHash) {
            revert RuntimeCodeHashMismatch(address(platformFeeVault), boundVaultRuntimeCodeHash, vaultRuntime);
        }
        if (tokenRuntime != boundTokenRuntimeCodeHash) {
            revert RuntimeCodeHashMismatch(token, boundTokenRuntimeCodeHash, tokenRuntime);
        }
        bytes32 initializerRuntime = authorizedInitializer.codehash;
        if (initializerRuntime != authorizedInitializerRuntimeCodeHash) {
            revert RuntimeCodeHashMismatch(
                authorizedInitializer, authorizedInitializerRuntimeCodeHash, initializerRuntime
            );
        }
        bytes32 actualComposition = _currentCompositionHash();
        if (actualComposition != compositionHash) revert CompositionDrift(compositionHash, actualComposition);
        _validateCustomModule();
    }

    function _currentCompositionHash() private view returns (bytes32) {
        address token = boundToken;
        bytes32 tokenRuntime = token.codehash;
        return programmableCompositionHashV2(
            ProgrammableCompositionV2({
                deploymentProfileHash: deploymentProfileHash,
                hook: address(this),
                hookRuntimeCodeHash: address(this).codehash,
                vault: address(platformFeeVault),
                vaultRuntimeCodeHash: address(platformFeeVault).codehash,
                initializer: authorizedInitializer,
                initializerRuntimeCodeHash: authorizedInitializer.codehash,
                poolId: boundPoolId,
                initialSqrtPriceX96: boundInitialSqrtPriceX96,
                token: token,
                tokenRuntimeCodeHash: tokenRuntime,
                customModule: _customModuleAddress(),
                customModuleRuntimeCodeHash: _customModuleRuntimeCodeHash(),
                customDeltaAccount: address(0),
                maximumCustomDeltaAbsolute: uint128(0)
            })
        );
    }

    function _accrueProgrammablePlatformFee(
        address sender,
        ProgrammablePoolKey calldata key,
        ProgrammableSwapParams calldata params,
        ProgrammableBalanceDelta delta
    ) private returns (int128 platformDelta) {
        if (activePlatformFeeAccrualContextHash != bytes32(0)) {
            revert ReentrantPlatformFeeAccrual();
        }
        bytes32 poolId = keccak256(abi.encode(key));
        bool exactInput = params.amountSpecified < 0;
        bool unspecifiedIsCurrency0 = exactInput != params.zeroForOne;
        int128 unspecifiedDelta = unspecifiedIsCurrency0 ? _amount0(delta) : _amount1(delta);
        ProgrammableCurrency feeCurrency = unspecifiedIsCurrency0 ? key.currency0 : key.currency1;
        uint256 feeBasisAmount;
        if (exactInput) {
            if (unspecifiedDelta < 0) revert UnexpectedUnspecifiedDelta(unspecifiedDelta);
            feeBasisAmount = uint128(unspecifiedDelta);
        } else {
            if (unspecifiedDelta > 0) revert UnexpectedUnspecifiedDelta(unspecifiedDelta);
            feeBasisAmount = _absolute(unspecifiedDelta);
        }
        bytes32 accrualContextHash =
            platformFeeVault.platformFeeAccrualContextHash(poolId, feeCurrency, feeBasisAmount, exactInput);
        if (accrualContextHash == bytes32(0)) revert ReentrantPlatformFeeAccrual();
        activePlatformFeeAccrualContextHash = accrualContextHash;
        uint256 platformFee =
            platformFeeVault.recordPlatformFee(poolId, feeCurrency, feeBasisAmount, exactInput, accrualContextHash);
        if (platformFee > uint128(type(int128).max)) revert UnexpectedUnspecifiedDelta(unspecifiedDelta);
        if (platformFee > 0) {
            IProgrammableV4PoolManagerV1(poolManager)
                .mint(address(platformFeeVault), uint160(ProgrammableCurrency.unwrap(feeCurrency)), platformFee);
        }
        platformFeeVault.confirmPlatformFeeFunding(feeCurrency, platformFee, accrualContextHash);
        activePlatformFeeAccrualContextHash = bytes32(0);
        uint256 grossQualifyingAmount = exactInput ? feeBasisAmount : feeBasisAmount + platformFee;
        emit PlatformFeeAccrued(
            poolId,
            ProgrammableCurrency.unwrap(feeCurrency),
            sender,
            exactInput,
            grossQualifyingAmount,
            platformFee,
            address(platformFeeVault)
        );
        return int128(uint128(platformFee));
    }

    function _afterSwapCustom(
        address,
        ProgrammablePoolKey calldata,
        ProgrammableSwapParams calldata,
        ProgrammableBalanceDelta,
        bytes calldata
    ) internal virtual returns (int128) {
        return 0;
    }

    function _validateCustomModule() internal view virtual;
    function _profileKind() internal view virtual returns (bytes32);
    function _customModuleAddress() internal view virtual returns (address);
    function _customModuleRuntimeCodeHash() internal view virtual returns (bytes32);
    function _expectedVaultRuntimeCodeHash() internal view virtual returns (bytes32);
    function _expectedTokenRuntimeCodeHash() internal view virtual returns (bytes32);
    function _canonicalPoolManagerRuntimeCodeHash() internal view virtual returns (bytes32);
    function _canonicalGraphDeployerRuntimeCodeHash() internal view virtual returns (bytes32);

    function _requireRuntimeCodeHash(address target, bytes32 expected) private view {
        bytes32 actual = target.codehash;
        if (actual != expected) revert RuntimeCodeHashMismatch(target, expected, actual);
    }

    function _checkedAddAfterSwapDelta(int128 customDelta, int128 platformDelta)
        private
        pure
        returns (int128 combinedDelta)
    {
        int256 combined = int256(customDelta) + int256(platformDelta);
        if (combined < type(int128).min || combined > type(int128).max) {
            revert AfterSwapDeltaOverflow(customDelta, platformDelta);
        }
        return int128(combined);
    }

    function _amount0(ProgrammableBalanceDelta delta) private pure returns (int128) {
        return int128(ProgrammableBalanceDelta.unwrap(delta) >> 128);
    }

    function _amount1(ProgrammableBalanceDelta delta) private pure returns (int128) {
        return int128(ProgrammableBalanceDelta.unwrap(delta));
    }

    function _absolute(int128 value) private pure returns (uint256) {
        if (value >= 0) return uint128(value);
        return uint128(-(value + 1)) + 1;
    }
}

contract ProgrammableAdditiveFeeHookV2 is ProgrammableAdditiveFeeHookV2Core {
    constructor(ProgrammableFeeVaultV2Core platformFeeVault_)
        ProgrammableAdditiveFeeHookV2Core(
            PROGRAMMABLE_CANONICAL_POOL_MANAGER_V2, PROGRAMMABLE_CANONICAL_GRAPH_DEPLOYER_V2, platformFeeVault_
        )
    { }

    function feePolicyCustomModule() external pure returns (address) {
        return address(0);
    }

    function feePolicyCustomModuleRuntimeCodeHash() external pure returns (bytes32) {
        return bytes32(0);
    }
    function _validateCustomModule() internal pure override { }

    function _profileKind() internal pure override returns (bytes32) {
        return PROGRAMMABLE_ZERO_CUSTOM_PROFILE_V2;
    }

    function _customModuleAddress() internal pure override returns (address) {
        return address(0);
    }

    function _customModuleRuntimeCodeHash() internal pure override returns (bytes32) {
        return bytes32(0);
    }

    function _expectedVaultRuntimeCodeHash() internal pure override returns (bytes32) {
        return PROGRAMMABLE_FEE_VAULT_V2_RUNTIME_CODE_HASH;
    }

    function _expectedTokenRuntimeCodeHash() internal pure override returns (bytes32) {
        return PROGRAMMABLE_LAUNCH_TOKEN_V2_RUNTIME_CODE_HASH;
    }

    function _canonicalPoolManagerRuntimeCodeHash() internal pure override returns (bytes32) {
        return PROGRAMMABLE_CANONICAL_POOL_MANAGER_RUNTIME_CODE_HASH_V2;
    }

    function _canonicalGraphDeployerRuntimeCodeHash() internal pure override returns (bytes32) {
        return PROGRAMMABLE_CANONICAL_GRAPH_DEPLOYER_RUNTIME_CODE_HASH_V2;
    }
}

contract ProgrammableIsolatedAfterSwapFeeHookV2 is ProgrammableAdditiveFeeHookV2Core {
    IProgrammableIsolatedAfterSwapModuleV1 public customModule;
    bytes32 public customModuleRuntimeCodeHash;
    error CustomDeltaMustBeZero(int128 actual);
    error UnexpectedCustomModuleSelector(bytes4 actual);

    constructor(ProgrammableFeeVaultV2Core platformFeeVault_, IProgrammableIsolatedAfterSwapModuleV1 customModule_)
        ProgrammableAdditiveFeeHookV2Core(
            PROGRAMMABLE_CANONICAL_POOL_MANAGER_V2, PROGRAMMABLE_CANONICAL_GRAPH_DEPLOYER_V2, platformFeeVault_
        )
    {
        address module = address(customModule_);
        bytes memory runtimeCode = module.code;
        if (module == address(0) || runtimeCode.length == 0) revert InvalidCustomModule(module);
        if (!programmableModuleCodeIsSafeV2(runtimeCode)) revert InvalidCustomModuleOpcode(module);
        customModule = customModule_;
        customModuleRuntimeCodeHash = module.codehash;
    }

    function feePolicyCustomModule() external view returns (address) {
        return address(customModule);
    }

    function feePolicyCustomModuleRuntimeCodeHash() external view returns (bytes32) {
        return customModuleRuntimeCodeHash;
    }

    function _afterSwapCustom(
        address sender,
        ProgrammablePoolKey calldata key,
        ProgrammableSwapParams calldata params,
        ProgrammableBalanceDelta delta,
        bytes calldata hookData
    ) internal override returns (int128) {
        _validateCustomModule();
        (bytes4 selector, int128 customDelta) = customModule.afterSwapCustom(sender, key, params, delta, hookData);
        if (selector != IProgrammableIsolatedAfterSwapModuleV1.afterSwapCustom.selector) {
            revert UnexpectedCustomModuleSelector(selector);
        }
        if (customDelta != 0) revert CustomDeltaMustBeZero(customDelta);
        return 0;
    }

    function _validateCustomModule() internal view override {
        address module = address(customModule);
        bytes32 actualRuntimeCodeHash = module.codehash;
        if (actualRuntimeCodeHash != customModuleRuntimeCodeHash) {
            revert RuntimeCodeHashMismatch(module, customModuleRuntimeCodeHash, actualRuntimeCodeHash);
        }
        if (!programmableModuleCodeIsSafeV2(module.code)) revert InvalidCustomModuleOpcode(module);
    }

    function _profileKind() internal pure override returns (bytes32) {
        return PROGRAMMABLE_ISOLATED_AFTER_SWAP_PROFILE_V2;
    }

    function _customModuleAddress() internal view override returns (address) {
        return address(customModule);
    }

    function _customModuleRuntimeCodeHash() internal view override returns (bytes32) {
        return customModuleRuntimeCodeHash;
    }

    function _expectedVaultRuntimeCodeHash() internal pure override returns (bytes32) {
        return PROGRAMMABLE_FEE_VAULT_V2_RUNTIME_CODE_HASH;
    }

    function _expectedTokenRuntimeCodeHash() internal pure override returns (bytes32) {
        return PROGRAMMABLE_LAUNCH_TOKEN_V2_RUNTIME_CODE_HASH;
    }

    function _canonicalPoolManagerRuntimeCodeHash() internal pure override returns (bytes32) {
        return PROGRAMMABLE_CANONICAL_POOL_MANAGER_RUNTIME_CODE_HASH_V2;
    }

    function _canonicalGraphDeployerRuntimeCodeHash() internal pure override returns (bytes32) {
        return PROGRAMMABLE_CANONICAL_GRAPH_DEPLOYER_RUNTIME_CODE_HASH_V2;
    }
}
