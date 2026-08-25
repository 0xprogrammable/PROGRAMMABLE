// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @dev Hermetic ABI mirror of the Uniswap v4 types used by this module. The
/// selectors and tuple layouts are identical to v4-core while this canonical
/// source remains independently compilable by the admission engine.
type ProgrammableCurrency is address;
type ProgrammableBalanceDelta is int256;

struct ProgrammablePoolKey {
    ProgrammableCurrency currency0;
    ProgrammableCurrency currency1;
    uint24 fee;
    int24 tickSpacing;
    address hooks;
}

struct ProgrammableSwapParams {
    bool zeroForOne;
    int256 amountSpecified;
    uint160 sqrtPriceLimitX96;
}

struct ProgrammableHookPermissions {
    bool beforeInitialize;
    bool afterInitialize;
    bool beforeAddLiquidity;
    bool afterAddLiquidity;
    bool beforeRemoveLiquidity;
    bool afterRemoveLiquidity;
    bool beforeSwap;
    bool afterSwap;
    bool beforeDonate;
    bool afterDonate;
    bool beforeSwapReturnDelta;
    bool afterSwapReturnDelta;
    bool afterAddLiquidityReturnDelta;
    bool afterRemoveLiquidityReturnDelta;
}

interface IProgrammableV4HookV1 {
    function afterSwap(
        address sender,
        ProgrammablePoolKey calldata key,
        ProgrammableSwapParams calldata params,
        ProgrammableBalanceDelta delta,
        bytes calldata hookData
    ) external returns (bytes4, int128);
}

interface IProgrammableV4PoolManagerV1 {
    function unlock(bytes calldata data) external returns (bytes memory result);
    function mint(address to, uint256 currencyId, uint256 amount) external;
    function burn(address from, uint256 currencyId, uint256 amount) external;
    function take(ProgrammableCurrency currency, address to, uint256 amount) external;
    function balanceOf(address owner, uint256 currencyId) external view returns (uint256);
}

interface IProgrammableFeeAdapterBindingV1 {
    function poolManager() external view returns (address);
    function platformFeeVault() external view returns (ProgrammableFeeVaultV1);
}

interface IProgrammableFeeAccrualContextV1 {
    function platformFeeAccrualContextHash() external view returns (bytes32);
}

/// @notice Typed external custom boundary for the isolated composition profile.
/// Module bytecode executes in its own storage context and can use arbitrary
/// Solidity or assembly without gaining the sealed hook's vault authority.
interface IProgrammableIsolatedAfterSwapModuleV1 {
    function afterSwapCustom(
        address sender,
        ProgrammablePoolKey calldata key,
        ProgrammableSwapParams calldata params,
        ProgrammableBalanceDelta delta,
        bytes calldata hookData
    ) external returns (bytes4 selector, int128 customDelta);
}

/// @title ProgrammableFeeVaultV1
/// @notice Isolated owner of all platform ERC-6909 claims. Arbitrary custom
/// hook code never owns, operates, approves, burns, or redirects these claims.
contract ProgrammableFeeVaultV1 {
    uint24 public constant PLATFORM_FEE_PPM = 1000;
    uint24 public constant FEE_DENOMINATOR_PPM = 1_000_000;
    address public constant PLATFORM_FEE_RECIPIENT = 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c;
    uint160 public constant REQUIRED_ADAPTER_FLAGS = (1 << 6) | (1 << 2);
    uint160 public constant ALL_HOOK_MASK = (1 << 14) - 1;

    bytes32 private constant PLATFORM_FEE_ACCRUAL_CONTEXT_DOMAIN =
        keccak256("programmable.platform-fee-accrual-context.v1");

    address public immutable poolManager;
    address public bindingAuthority;
    address public authorizedAdapter;
    bytes32 public authorizedAdapterCodeHash;

    mapping(address currency => uint256 amount) public platformFeesAccrued;
    mapping(address currency => uint256 amount) public pendingPlatformFeeFunding;
    mapping(address currency => bytes32 contextHash) public pendingPlatformFeeContextHash;
    mapping(bytes32 poolId => mapping(address currency => uint256 scaledRemainder)) public platformFeeRemainderPpm;

    bool private bindingInProgress;
    bool private claimInProgress;
    bool private claimCallbackConsumed;
    bytes32 private activeClaimHash;

    error AdapterAlreadyBound(address adapter);
    error AdapterBindingStateChanged();
    error AdapterCodeHashChanged(bytes32 expected, bytes32 observed);
    error AdapterFeeAccrualContextPending(address currency, bytes32 contextHash);
    error AdapterFeeFundingPending(address currency, uint256 amount);
    error AdapterFeeFundingMismatch(address currency, uint256 expected, uint256 observed);
    error HookAddressPermissionMismatch(uint160 actual, uint160 required);
    error InvalidAdapterBinding(address adapter);
    error InvalidAddress();
    error InvalidPlatformFeeAccrualContext(bytes32 expected, bytes32 observed);
    error NoFeesToClaim(address currency);
    error ReentrantClaim();
    error ReentrantAdapterBinding();
    error UnauthorizedAdapter(address caller);
    error UnauthorizedBinding(address caller);
    error UnauthorizedClaim(address caller);
    error UnauthorizedPoolManager(address caller);
    error UnexpectedClaimCallback();
    error UnlockResponseNotEmpty();

    event AdapterBound(address indexed adapter);
    event PlatformFeeFundingRecorded(
        bytes32 indexed poolId,
        address indexed currency,
        bool exactInput,
        uint256 feeBasisAmount,
        uint256 platformFee,
        uint256 nextRemainderPpm
    );
    event PlatformFeeFundingConfirmed(address indexed currency, uint256 amount);
    event PlatformFeesClaimed(address indexed currency, address indexed treasury, uint256 amount);

    constructor(address poolManager_, address bindingAuthority_) {
        if (poolManager_ == address(0) || bindingAuthority_ == address(0)) {
            revert InvalidAddress();
        }
        poolManager = poolManager_;
        bindingAuthority = bindingAuthority_;
    }

    /// @notice One-time, self-sealing adapter binding performed by the exact
    /// atomic launch route after both vault and hook have been deployed.
    function bindAdapter(address adapter) external {
        if (msg.sender != bindingAuthority) revert UnauthorizedBinding(msg.sender);
        _beforeAdapterBinding();
        if (bindingInProgress) revert ReentrantAdapterBinding();
        if (authorizedAdapter != address(0)) revert AdapterAlreadyBound(authorizedAdapter);
        // The adapter getters below are external calls. Lock before validating
        // them and re-check the exact pre-bind state before sealing so a
        // selector-spoof adapter cannot create a transient alternate binding.
        bindingInProgress = true;
        bytes32 adapterCodeHash = adapter.codehash;
        uint160 flags = uint160(adapter) & ALL_HOOK_MASK;
        uint160 requiredFlags = requiredAdapterFlags();
        if (adapter == address(0) || adapter.code.length == 0 || flags != requiredFlags) {
            revert HookAddressPermissionMismatch(flags, requiredFlags);
        }
        try IProgrammableFeeAdapterBindingV1(adapter).poolManager() returns (address manager) {
            if (manager != poolManager) revert InvalidAdapterBinding(adapter);
        } catch {
            revert InvalidAdapterBinding(adapter);
        }
        try IProgrammableFeeAdapterBindingV1(adapter).platformFeeVault() returns (ProgrammableFeeVaultV1 vault) {
            if (address(vault) != address(this)) revert InvalidAdapterBinding(adapter);
        } catch {
            revert InvalidAdapterBinding(adapter);
        }
        try IProgrammableFeeAccrualContextV1(adapter).platformFeeAccrualContextHash() returns (bytes32 contextHash) {
            if (contextHash != bytes32(0)) revert InvalidAdapterBinding(adapter);
        } catch {
            revert InvalidAdapterBinding(adapter);
        }
        if (!bindingInProgress || authorizedAdapter != address(0) || bindingAuthority != msg.sender) {
            revert AdapterBindingStateChanged();
        }
        if (adapter.codehash != adapterCodeHash) {
            revert AdapterCodeHashChanged(adapterCodeHash, adapter.codehash);
        }
        authorizedAdapter = adapter;
        authorizedAdapterCodeHash = adapterCodeHash;
        bindingAuthority = address(0);
        bindingInProgress = false;
        emit AdapterBound(adapter);
    }

    /// @notice Exact address permission mask accepted by this vault version.
    /// V1 remains 0x0044; versioned descendants can strengthen the mask while
    /// retaining the proven accounting and claim implementation.
    function requiredAdapterFlags() public pure virtual returns (uint160) {
        return REQUIRED_ADAPTER_FLAGS;
    }

    function _beforeAdapterBinding() internal view virtual { }

    /// @notice Returns the exact context that the bound adapter must expose
    /// during the private mandatory fee phase for these immutable inputs.
    function platformFeeAccrualContextHash(
        bytes32 poolId,
        ProgrammableCurrency currency,
        uint256 feeBasisAmount,
        bool exactInput
    ) public view returns (bytes32) {
        return keccak256(
            abi.encode(
                PLATFORM_FEE_ACCRUAL_CONTEXT_DOMAIN,
                block.chainid,
                address(this),
                poolManager,
                authorizedAdapter,
                poolId,
                ProgrammableCurrency.unwrap(currency),
                feeBasisAmount,
                exactInput
            )
        );
    }

    /// @dev Starts one exact fee obligation only while the bound base module's
    /// private mandatory phase exposes the matching context. The context lock
    /// remains nonzero even when rounding produces a zero fee, so custom code
    /// cannot advance dust or create a second zero-value obligation.
    function recordPlatformFee(
        bytes32 poolId,
        ProgrammableCurrency currency,
        uint256 feeBasisAmount,
        bool exactInput,
        bytes32 accrualContextHash
    ) external returns (uint256 platformFee) {
        _onlyAdapter();
        address currencyAddress = ProgrammableCurrency.unwrap(currency);
        bytes32 pendingContext = pendingPlatformFeeContextHash[currencyAddress];
        if (pendingContext != bytes32(0)) {
            revert AdapterFeeAccrualContextPending(currencyAddress, pendingContext);
        }
        uint256 pending = pendingPlatformFeeFunding[currencyAddress];
        if (pending != 0) revert AdapterFeeFundingPending(currencyAddress, pending);

        bytes32 expectedContext = platformFeeAccrualContextHash(poolId, currency, feeBasisAmount, exactInput);
        if (accrualContextHash == bytes32(0) || accrualContextHash != expectedContext) {
            revert InvalidPlatformFeeAccrualContext(expectedContext, accrualContextHash);
        }
        _requireActiveAdapterAccrualContext(expectedContext);

        uint256 accounted = platformFeesAccrued[currencyAddress];
        uint256 observed = IProgrammableV4PoolManagerV1(poolManager).balanceOf(address(this), uint160(currencyAddress));
        if (observed < accounted) {
            revert AdapterFeeFundingMismatch(currencyAddress, accounted, observed);
        }

        uint256 nextRemainder;
        (platformFee, nextRemainder) = _computePlatformFee(poolId, currencyAddress, feeBasisAmount, exactInput);
        platformFeeRemainderPpm[poolId][currencyAddress] = nextRemainder;
        pendingPlatformFeeContextHash[currencyAddress] = expectedContext;
        pendingPlatformFeeFunding[currencyAddress] = platformFee;
        emit PlatformFeeFundingRecorded(poolId, currencyAddress, exactInput, feeBasisAmount, platformFee, nextRemainder);
    }

    function confirmPlatformFeeFunding(ProgrammableCurrency currency, uint256 amount, bytes32 accrualContextHash)
        external
    {
        _onlyAdapter();
        address currencyAddress = ProgrammableCurrency.unwrap(currency);
        bytes32 pendingContext = pendingPlatformFeeContextHash[currencyAddress];
        if (accrualContextHash == bytes32(0) || pendingContext == bytes32(0) || pendingContext != accrualContextHash) {
            revert InvalidPlatformFeeAccrualContext(pendingContext, accrualContextHash);
        }
        _requireActiveAdapterAccrualContext(pendingContext);
        uint256 pending = pendingPlatformFeeFunding[currencyAddress];
        if (pending != amount) {
            revert AdapterFeeFundingMismatch(currencyAddress, pending, amount);
        }
        uint256 nextAccounted = platformFeesAccrued[currencyAddress] + amount;
        uint256 observed = IProgrammableV4PoolManagerV1(poolManager).balanceOf(address(this), uint160(currencyAddress));
        if (observed < nextAccounted) {
            revert AdapterFeeFundingMismatch(currencyAddress, nextAccounted, observed);
        }
        pendingPlatformFeeContextHash[currencyAddress] = bytes32(0);
        pendingPlatformFeeFunding[currencyAddress] = 0;
        platformFeesAccrued[currencyAddress] = nextAccounted;
        emit PlatformFeeFundingConfirmed(currencyAddress, amount);
    }

    function claimPlatformFees(ProgrammableCurrency currency) external returns (uint256 amount) {
        if (msg.sender != PLATFORM_FEE_RECIPIENT) revert UnauthorizedClaim(msg.sender);
        if (claimInProgress) revert ReentrantClaim();

        address currencyAddress = ProgrammableCurrency.unwrap(currency);
        bytes32 pendingContext = pendingPlatformFeeContextHash[currencyAddress];
        if (pendingContext != bytes32(0)) {
            revert AdapterFeeAccrualContextPending(currencyAddress, pendingContext);
        }
        if (pendingPlatformFeeFunding[currencyAddress] != 0) {
            revert AdapterFeeFundingPending(currencyAddress, pendingPlatformFeeFunding[currencyAddress]);
        }
        amount = platformFeesAccrued[currencyAddress];
        if (amount == 0) revert NoFeesToClaim(currencyAddress);
        uint256 observed = IProgrammableV4PoolManagerV1(poolManager).balanceOf(address(this), uint160(currencyAddress));
        if (observed < amount) {
            revert AdapterFeeFundingMismatch(currencyAddress, amount, observed);
        }

        // Effects precede the only external call. Any failure, malformed
        // response, callback mismatch, or recipient reentry restores all state.
        platformFeesAccrued[currencyAddress] = 0;
        claimInProgress = true;
        claimCallbackConsumed = false;
        bytes memory callbackData = abi.encode(currency, amount);
        activeClaimHash = keccak256(callbackData);
        bytes memory result = IProgrammableV4PoolManagerV1(poolManager).unlock(callbackData);
        // The trusted PoolManager must have consumed the callback exactly once.
        // A return without callback cannot erase accounting without settlement.
        if (!claimCallbackConsumed || activeClaimHash != bytes32(0)) revert UnexpectedClaimCallback();
        if (result.length != 0) revert UnlockResponseNotEmpty();
        claimInProgress = false;
        claimCallbackConsumed = false;

        emit PlatformFeesClaimed(currencyAddress, PLATFORM_FEE_RECIPIENT, amount);
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != poolManager) revert UnauthorizedPoolManager(msg.sender);
        if (!claimInProgress || claimCallbackConsumed) revert ReentrantClaim();
        if (keccak256(data) != activeClaimHash) revert UnexpectedClaimCallback();
        // Consume the one-shot callback before invoking PoolManager settlement.
        // The outer claim lock intentionally remains active until unlock fully
        // returns, so settlement callbacks cannot start a nested treasury claim.
        // Any downstream failure rolls this state change back atomically.
        claimCallbackConsumed = true;
        activeClaimHash = bytes32(0);
        (ProgrammableCurrency currency, uint256 amount) = abi.decode(data, (ProgrammableCurrency, uint256));
        uint256 currencyId = uint160(ProgrammableCurrency.unwrap(currency));
        IProgrammableV4PoolManagerV1(poolManager).burn(address(this), currencyId, amount);
        IProgrammableV4PoolManagerV1(poolManager).take(currency, PLATFORM_FEE_RECIPIENT, amount);
        return "";
    }

    function _onlyAdapter() private view {
        if (msg.sender != authorizedAdapter) revert UnauthorizedAdapter(msg.sender);
        bytes32 expectedCodeHash = authorizedAdapterCodeHash;
        bytes32 observedCodeHash = msg.sender.codehash;
        if (observedCodeHash != expectedCodeHash) {
            revert AdapterCodeHashChanged(expectedCodeHash, observedCodeHash);
        }
    }

    function _requireActiveAdapterAccrualContext(bytes32 expectedContext) private view {
        bytes32 observedContext = bytes32(0);
        try IProgrammableFeeAccrualContextV1(authorizedAdapter).platformFeeAccrualContextHash() returns (
            bytes32 contextHash
        ) {
            observedContext = contextHash;
        } catch {
            revert InvalidPlatformFeeAccrualContext(expectedContext, bytes32(0));
        }
        if (observedContext != expectedContext) {
            revert InvalidPlatformFeeAccrualContext(expectedContext, observedContext);
        }
    }

    function _computePlatformFee(bytes32 poolId, address currencyAddress, uint256 feeBasisAmount, bool exactInput)
        private
        view
        returns (uint256 platformFee, uint256 nextRemainder)
    {
        uint256 remainder = platformFeeRemainderPpm[poolId][currencyAddress];
        uint256 scaledPoolAmount = feeBasisAmount * PLATFORM_FEE_PPM;
        if (exactInput) {
            // The unspecified output amount is already the gross qualifying
            // amount. Carry one per-pool/currency remainder so splitting a
            // trade cannot change the cumulative 0.10% charge.
            uint256 scaledFee = scaledPoolAmount + remainder;
            return (scaledFee / FEE_DENOMINATOR_PPM, scaledFee % FEE_DENOMINATOR_PPM);
        }

        // The unspecified input amount excludes the hook fee. Solve the
        // integer fixed point with its minimum valid integer solution.
        uint256 scaledNetAmount = scaledPoolAmount + remainder;
        uint256 feeDivisor = FEE_DENOMINATOR_PPM - PLATFORM_FEE_PPM;
        platformFee =
            scaledNetAmount < FEE_DENOMINATOR_PPM ? 0 : (scaledNetAmount - FEE_DENOMINATOR_PPM) / feeDivisor + 1;
        uint256 grossAmount = feeBasisAmount + platformFee;
        nextRemainder = (remainder + grossAmount * PLATFORM_FEE_PPM) % FEE_DENOMINATOR_PPM;
    }
}

/// @title ProgrammableAdditiveFeeModuleV1
/// @notice Single-hook execution adapter that composes arbitrary custom
/// afterSwap logic with an independently owned, fixed 0.10% platform claim.
abstract contract ProgrammableAdditiveFeeModuleV1 is IProgrammableV4HookV1 {
    uint24 public constant PLATFORM_FEE_PPM = 1000;
    uint24 public constant FEE_DENOMINATOR_PPM = 1_000_000;
    address public constant PLATFORM_FEE_RECIPIENT = 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c;
    uint160 public constant ALL_HOOK_MASK = (1 << 14) - 1;
    uint160 public constant AFTER_SWAP_FLAG = 1 << 6;
    uint160 public constant AFTER_SWAP_RETURNS_DELTA_FLAG = 1 << 2;
    uint160 public constant REQUIRED_HOOK_FLAGS = AFTER_SWAP_FLAG | AFTER_SWAP_RETURNS_DELTA_FLAG;

    address public immutable poolManager;
    ProgrammableFeeVaultV1 public immutable platformFeeVault;

    bytes32 private activePlatformFeeAccrualContextHash;

    error AfterSwapDeltaOverflow(int128 customDelta, int128 platformDelta);
    error HookAddressPermissionMismatch(uint160 actual, uint160 expected);
    error InvalidPlatformFeeVault();
    error InvalidPoolManager();
    error ReentrantPlatformFeeAccrual();
    error UnexpectedPoolHook(address actual);
    error UnexpectedUnlockCallback();
    error UnexpectedUnspecifiedDelta(int128 amount);
    error UnauthorizedPoolManager(address caller);

    event PlatformFeeAccrued(
        bytes32 indexed poolId,
        address indexed currency,
        address indexed swapSender,
        bool exactInput,
        uint256 grossQualifyingAmount,
        uint256 platformFee,
        address feeVault
    );

    constructor(address poolManager_, ProgrammableFeeVaultV1 platformFeeVault_) {
        if (poolManager_ == address(0)) revert InvalidPoolManager();
        if (
            address(platformFeeVault_) == address(0) || platformFeeVault_.poolManager() != poolManager_
                || platformFeeVault_.PLATFORM_FEE_RECIPIENT() != PLATFORM_FEE_RECIPIENT
        ) revert InvalidPlatformFeeVault();
        uint160 flags = uint160(address(this)) & ALL_HOOK_MASK;
        if (flags != REQUIRED_HOOK_FLAGS) {
            revert HookAddressPermissionMismatch(flags, REQUIRED_HOOK_FLAGS);
        }
        poolManager = poolManager_;
        platformFeeVault = platformFeeVault_;
    }

    function afterSwap(
        address sender,
        ProgrammablePoolKey calldata key,
        ProgrammableSwapParams calldata params,
        ProgrammableBalanceDelta delta,
        bytes calldata hookData
    ) external returns (bytes4, int128) {
        if (msg.sender != poolManager) revert UnauthorizedPoolManager(msg.sender);
        if (key.hooks != address(this)) revert UnexpectedPoolHook(key.hooks);

        int128 platformDelta = _accrueProgrammablePlatformFee(sender, key, params, delta);
        // The mandatory platform path always executes before optional custom
        // behavior. A later revert rolls the entire callback back atomically.
        int128 customDelta = _afterSwapCustom(sender, key, params, delta, hookData);
        return (IProgrammableV4HookV1.afterSwap.selector, _checkedAddAfterSwapDelta(customDelta, platformDelta));
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

    /// @notice Exact mandatory-phase capability observed by the isolated vault.
    /// This non-virtual getter is zero before optional custom code executes.
    function platformFeeAccrualContextHash() public view returns (bytes32) {
        return activePlatformFeeAccrualContextHash;
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
        if (platformFee > uint128(type(int128).max)) {
            revert UnexpectedUnspecifiedDelta(unspecifiedDelta);
        }
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

    function _checkedAddAfterSwapDelta(int128 customDelta, int128 platformDelta)
        internal
        pure
        returns (int128 combinedDelta)
    {
        int256 combined = int256(customDelta) + int256(platformDelta);
        if (combined < type(int128).min || combined > type(int128).max) {
            revert AfterSwapDeltaOverflow(customDelta, platformDelta);
        }
        return int128(combined);
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != poolManager) revert UnauthorizedPoolManager(msg.sender);
        return _unlockCallbackCustom(data);
    }

    function _unlockCallbackCustom(bytes calldata) internal virtual returns (bytes memory) {
        revert UnexpectedUnlockCallback();
    }

    function platformFeesAccrued(address currency) external view returns (uint256) {
        return platformFeeVault.platformFeesAccrued(currency);
    }

    function platformFeeRemainderPpm(bytes32 poolId, address currency) external view returns (uint256) {
        return platformFeeVault.platformFeeRemainderPpm(poolId, currency);
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

/// @title ProgrammableAdditiveFeeHookV1
/// @notice Standalone zero-custom-fee adapter with exact 0x0044 permissions.
contract ProgrammableAdditiveFeeHookV1 is ProgrammableAdditiveFeeModuleV1 {
    constructor(address poolManager_, ProgrammableFeeVaultV1 platformFeeVault_)
        ProgrammableAdditiveFeeModuleV1(poolManager_, platformFeeVault_)
    {
        uint160 flags = uint160(address(this)) & ALL_HOOK_MASK;
        if (flags != REQUIRED_HOOK_FLAGS) {
            revert HookAddressPermissionMismatch(flags, REQUIRED_HOOK_FLAGS);
        }
    }

    function getHookPermissions() external pure returns (ProgrammableHookPermissions memory permissions) {
        permissions.afterSwap = true;
        permissions.afterSwapReturnDelta = true;
    }
}

/// @title ProgrammableIsolatedAfterSwapFeeHookV1
/// @notice Sealed platform-fee adapter for custom logic that requires
/// arbitrary raw-storage writes or delegatecall. Ordinary compiler-laid-out
/// state remains eligible for same-address composition after exact review. The
/// immutable external module runs with separate storage and returns only one
/// bounded unspecified-currency delta.
/// The sealed hook, never the custom module, settles that delta under the hook
/// address that PoolManager accounts when it processes the callback return.
contract ProgrammableIsolatedAfterSwapFeeHookV1 is ProgrammableAdditiveFeeModuleV1 {
    IProgrammableIsolatedAfterSwapModuleV1 public immutable customModule;
    address public immutable customDeltaAccount;
    uint128 public immutable maximumCustomDeltaAbsolute;

    error CustomDeltaExceedsBound(int128 customDelta, uint128 maximumAbsolute);
    error InvalidCustomDeltaAccount();
    error InvalidCustomDeltaBound(uint128 maximumAbsolute);
    error InvalidCustomModule(address module);
    error UnexpectedCustomModuleSelector(bytes4 actual);

    event IsolatedCustomDeltaSettled(
        address indexed module, address indexed account, address indexed currency, int128 customDelta
    );

    constructor(
        address poolManager_,
        ProgrammableFeeVaultV1 platformFeeVault_,
        IProgrammableIsolatedAfterSwapModuleV1 customModule_,
        address customDeltaAccount_,
        uint128 maximumCustomDeltaAbsolute_
    ) ProgrammableAdditiveFeeModuleV1(poolManager_, platformFeeVault_) {
        address module = address(customModule_);
        if (
            module == address(0) || module == poolManager_ || module == address(platformFeeVault_)
                || module.code.length == 0
        ) revert InvalidCustomModule(module);
        if (
            customDeltaAccount_ == address(0) || customDeltaAccount_ == poolManager_
                || customDeltaAccount_ == address(platformFeeVault_) || customDeltaAccount_ == address(this)
        ) revert InvalidCustomDeltaAccount();
        if (maximumCustomDeltaAbsolute_ > uint128(type(int128).max)) {
            revert InvalidCustomDeltaBound(maximumCustomDeltaAbsolute_);
        }
        uint160 flags = uint160(address(this)) & ALL_HOOK_MASK;
        if (flags != REQUIRED_HOOK_FLAGS) {
            revert HookAddressPermissionMismatch(flags, REQUIRED_HOOK_FLAGS);
        }
        customModule = customModule_;
        customDeltaAccount = customDeltaAccount_;
        maximumCustomDeltaAbsolute = maximumCustomDeltaAbsolute_;
    }

    function getHookPermissions() external pure returns (ProgrammableHookPermissions memory permissions) {
        permissions.afterSwap = true;
        permissions.afterSwapReturnDelta = true;
    }

    function _afterSwapCustom(
        address sender,
        ProgrammablePoolKey calldata key,
        ProgrammableSwapParams calldata params,
        ProgrammableBalanceDelta delta,
        bytes calldata hookData
    ) internal override returns (int128 customDelta) {
        bytes4 selector;
        (selector, customDelta) = customModule.afterSwapCustom(sender, key, params, delta, hookData);
        if (selector != IProgrammableIsolatedAfterSwapModuleV1.afterSwapCustom.selector) {
            revert UnexpectedCustomModuleSelector(selector);
        }

        uint256 magnitude = customDelta >= 0 ? uint128(customDelta) : uint128(-(customDelta + 1)) + 1;
        if (magnitude > maximumCustomDeltaAbsolute) {
            revert CustomDeltaExceedsBound(customDelta, maximumCustomDeltaAbsolute);
        }
        if (magnitude == 0) return 0;

        bool exactInput = params.amountSpecified < 0;
        bool unspecifiedIsCurrency0 = exactInput != params.zeroForOne;
        ProgrammableCurrency currency = unspecifiedIsCurrency0 ? key.currency0 : key.currency1;
        uint256 currencyId = uint160(ProgrammableCurrency.unwrap(currency));
        if (customDelta > 0) {
            IProgrammableV4PoolManagerV1(poolManager).mint(customDeltaAccount, currencyId, magnitude);
        } else {
            // Negative custom deltas are explicit rebates. They succeed only
            // when the immutable account pre-authorized this sealed hook to
            // burn enough PoolManager claims; otherwise the whole swap reverts.
            IProgrammableV4PoolManagerV1(poolManager).burn(customDeltaAccount, currencyId, magnitude);
        }
        emit IsolatedCustomDeltaSettled(
            address(customModule), customDeltaAccount, ProgrammableCurrency.unwrap(currency), customDelta
        );
    }
}
